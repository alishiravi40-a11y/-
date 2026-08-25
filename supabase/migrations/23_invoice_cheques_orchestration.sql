BEGIN;

-- ==============================================================================
-- Migration: 23_invoice_cheques_orchestration.sql
-- Description: Creates atomic PL/pgSQL function public.create_invoice_with_cheques_atomic
--              for orchestrating invoice creation with attached cheques inside a single transaction.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.create_invoice_with_cheques_atomic(
    p_organization_id UUID,
    p_branch_id UUID,
    p_fiscal_year_id UUID,
    p_user_id TEXT,
    p_invoice_type TEXT,
    p_person_id UUID,
    p_date TEXT,
    p_date_jalali TEXT,
    p_is_pro_invoice BOOLEAN,
    p_discount NUMERIC(18, 0),
    p_tax_percent NUMERIC(5, 2),
    p_description TEXT,
    p_cash_paid_amount NUMERIC(18, 0),
    p_pos_paid_amount NUMERIC(18, 0),
    p_pos_terminal_id TEXT,
    p_settlement_commission NUMERIC(18, 0),
    p_cost_center_id UUID,
    p_items JSONB,
    p_cheques JSONB,
    p_operation_key TEXT,
    p_request_fingerprint TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_inv RECORD;
    v_person RECORD;
    v_invoice_number INT;
    v_invoice_id UUID;
    v_voucher_id UUID;
    v_voucher_number BIGINT;
    v_inventory_tx_id UUID;
    v_inventory_doc_number BIGINT;
    v_subtotal NUMERIC(18, 0) := 0;
    v_line_discounts NUMERIC(18, 0) := 0;
    v_general_discount NUMERIC(18, 0) := COALESCE(p_discount, 0);
    v_total_discount NUMERIC(18, 0) := 0;
    v_taxable_base NUMERIC(18, 0) := 0;
    v_tax_amount NUMERIC(18, 0) := 0;
    v_final_amount NUMERIC(18, 0) := 0;
    v_cash_paid NUMERIC(18, 0) := COALESCE(p_cash_paid_amount, 0);
    v_pos_paid NUMERIC(18, 0) := COALESCE(p_pos_paid_amount, 0);
    v_total_paid NUMERIC(18, 0) := 0;
    v_cheques_total NUMERIC(18, 0) := 0;
    v_remaining_amount NUMERIC(18, 0) := 0;
    v_payment_method TEXT;
    v_settlement_status TEXT;
    v_item RECORD;
    v_cheque RECORD;
    v_cheque_id UUID;
    v_sub_ar_id UUID;
    v_sub_ap_id UUID;
    v_sub_sales_id UUID;
    v_sub_inventory_id UUID;
    v_sub_vat_buy_id UUID;
    v_sub_vat_sell_id UUID;
    v_sub_cash_id UUID;
    v_sub_checks_rec_id UUID;
    v_sub_checks_pay_id UUID;
    v_row_num INT := 1;
    v_inv_item_row INT := 1;
    v_user_uuid UUID;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_invoice_date DATE;
    v_result JSONB;
BEGIN
    -- 1. Validate User ID (Fail-Closed)
    IF p_user_id IS NOT NULL AND p_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        SELECT u.id INTO v_user_uuid
        FROM public.user_profiles u
        JOIN public.organization_memberships om ON om.user_id = u.id
        WHERE u.id = p_user_id::UUID 
          AND om.organization_id = p_organization_id 
          AND u.is_active = true 
          AND om.is_active = true;
    END IF;

    IF v_user_uuid IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_USER: User ID is invalid, inactive, or not a member of organization %.', p_organization_id;
    END IF;

    -- 2. Validate Basic Inputs
    IF p_invoice_type NOT IN ('BUY', 'SELL') THEN
        RAISE EXCEPTION 'ERR_INVALID_INVOICE_TYPE: Invoice type must be BUY or SELL.';
    END IF;
    IF p_person_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_PERSON: Person ID is required.';
    END IF;
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'ERR_EMPTY_ITEMS: Invoice must contain at least one item.';
    END IF;

    -- 3. Check Idempotency via (organization_id, operation_key)
    SELECT * INTO v_existing_inv
    FROM public.invoices
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key;

    IF FOUND THEN
        SELECT jsonb_build_object(
            'id', v_existing_inv.id,
            'organization_id', v_existing_inv.organization_id,
            'invoice_number', v_existing_inv.invoice_number,
            'final_amount', v_existing_inv.final_amount,
            'journal_voucher_id', v_existing_inv.journal_voucher_id,
            'inventory_transaction_id', v_existing_inv.inventory_transaction_id,
            'version', v_existing_inv.version,
            'idempotent_replay', true
        ) INTO v_result;
        RETURN v_result;
    END IF;

    -- 4. Validate Organization References
    PERFORM 1 FROM public.branches WHERE id = p_branch_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_INVALID_BRANCH: Branch does not belong to organization.';
    END IF;

    PERFORM 1 FROM public.fiscal_years WHERE id = p_fiscal_year_id AND organization_id = p_organization_id AND is_closed = false;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_INVALID_FISCAL_YEAR: Fiscal year is invalid or closed.';
    END IF;

    SELECT * INTO v_person FROM public.persons WHERE id = p_person_id AND organization_id = p_organization_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_PERSON_NOT_FOUND: Person not found in organization.';
    END IF;
    IF v_person.status = 'inactive' THEN
        RAISE EXCEPTION 'ERR_PERSON_INACTIVE: Person is inactive.';
    END IF;

    IF p_cost_center_id IS NOT NULL THEN
        PERFORM 1 FROM public.cost_centers WHERE id = p_cost_center_id AND organization_id = p_organization_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_INVALID_COST_CENTER: Cost center does not belong to organization.';
        END IF;
    END IF;

    -- 5. Calculate Items & Totals
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        warehouse_id UUID,
        quantity NUMERIC,
        unit_price_amount NUMERIC,
        unit_price NUMERIC,
        discount_amount NUMERIC,
        discount NUMERIC,
        unit_cost_amount NUMERIC,
        total_cost_amount NUMERIC,
        serial_numbers JSONB,
        description TEXT
    ) LOOP
        IF v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'ERR_INVALID_QUANTITY: Item quantity must be greater than zero.';
        END IF;
        IF COALESCE(v_item.unit_price_amount, v_item.unit_price, 0) < 0 THEN
            RAISE EXCEPTION 'ERR_INVALID_UNIT_PRICE: Item unit price cannot be negative.';
        END IF;

        PERFORM 1 FROM public.products WHERE id = v_item.product_id AND organization_id = p_organization_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_INVALID_PRODUCT: Product % does not belong to organization.', v_item.product_id;
        END IF;

        PERFORM 1 FROM public.warehouses WHERE id = v_item.warehouse_id AND organization_id = p_organization_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_INVALID_WAREHOUSE: Warehouse % does not belong to organization.', v_item.warehouse_id;
        END IF;

        v_subtotal := v_subtotal + ROUND(v_item.quantity * COALESCE(v_item.unit_price_amount, v_item.unit_price, 0));
        v_line_discounts := v_line_discounts + ROUND(COALESCE(v_item.discount_amount, v_item.discount, 0));
    END LOOP;

    v_total_discount := v_line_discounts + v_general_discount;
    v_taxable_base := GREATEST(0, v_subtotal - v_total_discount);
    v_tax_amount := ROUND(v_taxable_base * (COALESCE(p_tax_percent, 0) / 100.0));
    v_final_amount := v_taxable_base + v_tax_amount;
    v_total_paid := v_cash_paid + v_pos_paid;

    -- 6. Calculate Cheques Total & Validate Cheques
    IF p_cheques IS NOT NULL AND jsonb_array_length(p_cheques) > 0 THEN
        FOR v_cheque IN SELECT * FROM jsonb_to_recordset(p_cheques) AS x(
            cheque_type TEXT,
            amount NUMERIC,
            check_number TEXT,
            due_date TEXT,
            bank_name TEXT,
            branch_name TEXT,
            account_number TEXT,
            sayadi_identifier TEXT,
            issue_date TEXT,
            description TEXT
        ) LOOP
            IF v_cheque.amount <= 0 THEN
                RAISE EXCEPTION 'ERR_INVALID_CHEQUE_AMOUNT: Cheque amount must be greater than zero.';
            END IF;
            IF p_invoice_type = 'SELL' AND v_cheque.cheque_type <> 'received' THEN
                RAISE EXCEPTION 'ERR_INVALID_CHEQUE_TYPE: Sell invoice can only accept received cheques.';
            END IF;
            IF p_invoice_type = 'BUY' AND v_cheque.cheque_type <> 'paid' THEN
                RAISE EXCEPTION 'ERR_INVALID_CHEQUE_TYPE: Buy invoice can only issue paid cheques.';
            END IF;
            v_cheques_total := v_cheques_total + v_cheque.amount;
        END LOOP;
    END IF;

    -- Validate Settlement Balance (Cash + POS + Cheques <= Final Amount)
    IF (v_total_paid + v_cheques_total) > v_final_amount THEN
        RAISE EXCEPTION 'ERR_SETTLEMENT_EXCEEDS_TOTAL: Total settlement amount (% + %) cannot exceed invoice final amount (%).',
            v_total_paid, v_cheques_total, v_final_amount;
    END IF;

    v_remaining_amount := v_final_amount - (v_total_paid + v_cheques_total);

    -- Determine settlement_status
    IF v_remaining_amount = 0 THEN
        v_settlement_status := 'FULLY_SETTLED';
    ELSIF (v_total_paid + v_cheques_total) > 0 THEN
        v_settlement_status := 'PARTIALLY_SETTLED';
    ELSE
        v_settlement_status := 'UNSETTLED';
    END IF;

    -- Determine payment_method
    IF v_cheques_total > 0 AND v_total_paid > 0 THEN
        v_payment_method := 'COMBINED';
    ELSIF v_cheques_total > 0 AND v_total_paid = 0 AND v_remaining_amount = 0 THEN
        v_payment_method := 'CHEQUE';
    ELSIF v_cheques_total > 0 AND v_total_paid = 0 AND v_remaining_amount > 0 THEN
        v_payment_method := 'COMBINED';
    ELSIF v_total_paid > 0 AND v_remaining_amount = 0 THEN
        IF v_cash_paid > 0 AND v_pos_paid > 0 THEN
            v_payment_method := 'COMBINED';
        ELSIF v_cash_paid > 0 THEN
            v_payment_method := 'CASH';
        ELSE
            v_payment_method := 'BANK';
        END IF;
    ELSIF v_total_paid > 0 AND v_remaining_amount > 0 THEN
        v_payment_method := 'COMBINED';
    ELSE
        v_payment_method := 'CREDIT';
    END IF;

    -- Parse and validate date
    BEGIN
        v_invoice_date := COALESCE(p_date::DATE, CURRENT_DATE);
    EXCEPTION WHEN OTHERS THEN
        v_invoice_date := CURRENT_DATE;
    END;

    -- 7. Allocate Sequential Invoice Number
    SELECT public.get_next_invoice_number(p_organization_id) INTO v_invoice_number;

    -- 8. Insert Invoice Header (Compliant with Migration 15 Schema)
    v_invoice_id := gen_random_uuid();
    INSERT INTO public.invoices (
        id,
        organization_id,
        branch_id,
        fiscal_year_id,
        invoice_number,
        invoice_type,
        invoice_date,
        status,
        person_id,
        person_name,
        subtotal_amount,
        total_amount,
        discount_amount,
        tax_amount,
        final_amount,
        payment_method,
        settlement_status,
        paid_amount,
        remaining_amount,
        version,
        operation_key,
        created_by,
        cost_center_id,
        notes,
        created_at,
        updated_at
    ) VALUES (
        v_invoice_id,
        p_organization_id,
        p_branch_id,
        p_fiscal_year_id,
        v_invoice_number,
        p_invoice_type,
        v_invoice_date::TEXT,
        CASE WHEN p_is_pro_invoice IS TRUE THEN 'DRAFT' ELSE 'POSTED' END,
        p_person_id,
        v_person.name,
        v_subtotal,
        v_final_amount,
        v_total_discount,
        v_tax_amount,
        v_final_amount,
        v_payment_method,
        v_settlement_status,
        v_total_paid + v_cheques_total,
        v_remaining_amount,
        1,
        p_operation_key,
        p_user_id,
        p_cost_center_id,
        p_description,
        v_now,
        v_now
    );

    -- 9. Insert Invoice Items (Compliant with Migration 15 Schema)
    v_inv_item_row := 1;
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        warehouse_id UUID,
        quantity NUMERIC,
        unit_price_amount NUMERIC,
        unit_price NUMERIC,
        discount_amount NUMERIC,
        discount NUMERIC,
        unit_cost_amount NUMERIC,
        total_cost_amount NUMERIC,
        serial_numbers JSONB,
        description TEXT
    ) LOOP
        INSERT INTO public.invoice_items (
            id,
            organization_id,
            invoice_id,
            row_number,
            product_id,
            warehouse_id,
            quantity,
            unit_price_amount,
            discount_amount,
            total_price_amount,
            unit_cost_amount,
            total_cost_amount,
            serial_numbers,
            description,
            created_at
        ) VALUES (
            gen_random_uuid(),
            p_organization_id,
            v_invoice_id,
            v_inv_item_row,
            v_item.product_id,
            v_item.warehouse_id,
            v_item.quantity,
            COALESCE(v_item.unit_price_amount, v_item.unit_price, 0),
            COALESCE(v_item.discount_amount, v_item.discount, 0),
            ROUND(v_item.quantity * COALESCE(v_item.unit_price_amount, v_item.unit_price, 0) - COALESCE(v_item.discount_amount, v_item.discount, 0)),
            COALESCE(v_item.unit_cost_amount, 0),
            COALESCE(v_item.total_cost_amount, 0),
            COALESCE(v_item.serial_numbers, '[]'::jsonb),
            v_item.description,
            v_now
        );
        v_inv_item_row := v_inv_item_row + 1;
    END LOOP;

    -- 10. If Pro-Invoice (DRAFT), finish without Voucher or Inventory movements
    IF p_is_pro_invoice IS TRUE THEN
        SELECT jsonb_build_object(
            'id', v_invoice_id,
            'organization_id', p_organization_id,
            'invoice_number', v_invoice_number,
            'final_amount', v_final_amount,
            'is_pro_invoice', true,
            'version', 1,
            'idempotent_replay', false
        ) INTO v_result;
        RETURN v_result;
    END IF;

    -- 11. Resolve Account Subsidiaries for Journal Voucher
    SELECT 
        MAX(CASE WHEN system_key = 'SUB_DEBTORS' OR code IN ('SUB_DEBTORS', '10301', '1101') THEN id END) AS sub_ar,
        MAX(CASE WHEN system_key = 'SUB_CREDITORS' OR code IN ('SUB_CREDITORS', '20201', '2101') THEN id END) AS sub_ap,
        MAX(CASE WHEN system_key = 'SUB_REVENUE' OR code IN ('SUB_REVENUE', '60101', '4101') THEN id END) AS sub_sales,
        MAX(CASE WHEN system_key = 'SUB_INVENTORY' OR code IN ('SUB_INVENTORY', '10501', '1105') THEN id END) AS sub_inv,
        MAX(CASE WHEN system_key = 'SUB_VAT_BUY' OR code IN ('SUB_VAT_BUY', '10602', '1108') THEN id END) AS sub_vat_buy,
        MAX(CASE WHEN system_key = 'SUB_VAT_SELL' OR code IN ('SUB_VAT_SELL', '20302', '2105') THEN id END) AS sub_vat_sell,
        MAX(CASE WHEN system_key = 'SUB_CASH_MAIN' OR code IN ('SUB_CASH_MAIN', '10101', '1102') THEN id END) AS sub_cash,
        MAX(CASE WHEN system_key = 'SUB_CHECKS_REC' OR code IN ('SUB_CHECKS_REC', '10401') THEN id END) AS sub_checks_rec,
        MAX(CASE WHEN system_key = 'SUB_CHECKS_PAY' OR code IN ('SUB_CHECKS_PAY', '20101') THEN id END) AS sub_checks_pay
    INTO 
        v_sub_ar_id, v_sub_ap_id, v_sub_sales_id, v_sub_inventory_id, 
        v_sub_vat_buy_id, v_sub_vat_sell_id, v_sub_cash_id, 
        v_sub_checks_rec_id, v_sub_checks_pay_id
    FROM public.account_subsidiaries
    WHERE organization_id = p_organization_id;

    IF p_invoice_type = 'SELL' AND (v_sub_ar_id IS NULL OR v_sub_sales_id IS NULL) THEN
        RAISE EXCEPTION 'ERR_ACCOUNT_SUBSIDIARY_NOT_FOUND: Required account subsidiary missing for SELL invoice in organization %.', p_organization_id;
    ELSIF p_invoice_type = 'BUY' AND (v_sub_ap_id IS NULL OR v_sub_inventory_id IS NULL) THEN
        RAISE EXCEPTION 'ERR_ACCOUNT_SUBSIDIARY_NOT_FOUND: Required account subsidiary missing for BUY invoice in organization %.', p_organization_id;
    END IF;

    -- 12. Allocate Sequential Journal Voucher Number via public.voucher_sequences
    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, p_fiscal_year_id, 1, v_user_uuid)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_voucher_number
    FROM public.voucher_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = p_fiscal_year_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_by = v_user_uuid,
        updated_at = v_now
    WHERE organization_id = p_organization_id AND fiscal_year_id = p_fiscal_year_id;

    -- 13. Create Journal Voucher Header
    v_voucher_id := gen_random_uuid();
    INSERT INTO public.journal_vouchers (
        id,
        organization_id,
        branch_id,
        fiscal_year_id,
        voucher_number,
        voucher_date,
        description,
        status,
        voucher_kind,
        is_automatic,
        source_type,
        source_id,
        source_event_key,
        version,
        created_by,
        posted_by,
        posted_at,
        created_at,
        updated_at
    ) VALUES (
        v_voucher_id,
        p_organization_id,
        p_branch_id,
        p_fiscal_year_id,
        v_voucher_number,
        v_invoice_date,
        (CASE WHEN p_invoice_type = 'SELL' THEN 'سند حسابداری فاکتور فروش شماره ' ELSE 'سند حسابداری فاکتور خرید شماره ' END) || v_invoice_number,
        'POSTED',
        'GENERAL',
        true,
        'INVOICE',
        v_invoice_id,
        p_operation_key,
        1,
        v_user_uuid,
        v_user_uuid,
        v_now,
        v_now,
        v_now
    );

    -- 14. Create Journal Voucher Entries
    v_row_num := 1;
    IF p_invoice_type = 'SELL' THEN
        -- Cash Debit
        IF v_cash_paid > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_cash_id, v_cash_paid, 0, 'دریافت نقدی بابت فاکتور فروش شماره ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- POS Debit (mapped to cash subsidiary)
        IF v_pos_paid > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_cash_id, v_pos_paid, 0, 'دریافت پوز بابت فاکتور فروش شماره ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- Received Cheques Debit
        IF v_cheques_total > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_checks_rec_id, v_cheques_total, 0, 'دریافت اسناد (چک‌های صندوق) بابت فاکتور فروش شماره ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- Remaining AR Debit
        IF v_remaining_amount > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description, created_at)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_ar_id, p_person_id, v_remaining_amount, 0, 'فروش نسیه - فاکتور شماره ' || v_invoice_number || ' (' || COALESCE(v_person.name, '') || ')', v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- Revenue Credit
        INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
        VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_sales_id, 0, v_taxable_base, 'فروش طی فاکتور شماره ' || v_invoice_number, v_now);
        v_row_num := v_row_num + 1;

        -- VAT Sell Credit
        IF v_tax_amount > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_vat_sell_id, 0, v_tax_amount, 'مالیات ارزش افزوده فاکتور فروش ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

    ELSE
        -- BUY Invoice
        -- Inventory Debit
        INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
        VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_inventory_id, v_taxable_base, 0, 'خرید طی فاکتور شماره ' || v_invoice_number, v_now);
        v_row_num := v_row_num + 1;

        -- VAT Buy Debit
        IF v_tax_amount > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_vat_buy_id, v_tax_amount, 0, 'مالیات ارزش افزوده خرید فاکتور ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- Paid Cheques Credit
        IF v_cheques_total > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_checks_pay_id, 0, v_cheques_total, 'صدور اسناد (چک‌های پرداختنی) بابت فاکتور خرید شماره ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- Remaining AP Credit
        IF (v_final_amount - v_cheques_total) > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description, created_at)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_ap_id, p_person_id, 0, (v_final_amount - v_cheques_total), 'خرید نسیه - فاکتور شماره ' || v_invoice_number || ' (' || COALESCE(v_person.name, '') || ')', v_now);
            v_row_num := v_row_num + 1;
        END IF;
    END IF;

    -- Update invoice with journal_voucher_id
    UPDATE public.invoices SET journal_voucher_id = v_voucher_id WHERE id = v_invoice_id;

    -- 15. Allocate Sequential Inventory Document Number via public.inventory_document_sequences
    INSERT INTO public.inventory_document_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, p_fiscal_year_id, 1, v_user_uuid)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_inventory_doc_number
    FROM public.inventory_document_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = p_fiscal_year_id
    FOR UPDATE;

    UPDATE public.inventory_document_sequences
    SET next_number = next_number + 1,
        updated_by = v_user_uuid,
        updated_at = v_now
    WHERE organization_id = p_organization_id AND fiscal_year_id = p_fiscal_year_id;

    -- 16. Create Inventory Transaction Header (Compliant with Migration 07 Schema)
    v_inventory_tx_id := gen_random_uuid();
    INSERT INTO public.inventory_transactions (
        id,
        organization_id,
        fiscal_year_id,
        initiating_branch_id,
        document_number,
        transaction_date,
        transaction_type,
        transaction_kind,
        status,
        description,
        source_event_key,
        idempotency_key,
        request_fingerprint,
        journal_voucher_id,
        cost_state,
        version,
        created_by,
        created_at,
        updated_at,
        posted_by,
        posted_at
    ) VALUES (
        v_inventory_tx_id,
        p_organization_id,
        p_fiscal_year_id,
        p_branch_id,
        v_inventory_doc_number,
        v_invoice_date,
        CASE WHEN p_invoice_type = 'SELL' THEN 'SALE_ISSUE' ELSE 'PURCHASE_RECEIPT' END,
        'GENERAL',
        'POSTED',
        (CASE WHEN p_invoice_type = 'SELL' THEN 'خروج انبار بابت فروش فاکتور شماره ' ELSE 'ورود انبار بابت خرید فاکتور شماره ' END) || v_invoice_number,
        p_operation_key,
        p_operation_key,
        p_request_fingerprint,
        v_voucher_id,
        'FINAL',
        1,
        v_user_uuid,
        v_now,
        v_now,
        v_user_uuid,
        v_now
    );

    -- 17. Create Inventory Transaction Items (Compliant with Migration 07 Schema)
    v_row_num := 1;
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        warehouse_id UUID,
        quantity NUMERIC,
        unit_price_amount NUMERIC,
        unit_price NUMERIC,
        discount_amount NUMERIC,
        discount NUMERIC,
        unit_cost_amount NUMERIC,
        total_cost_amount NUMERIC,
        serial_numbers JSONB,
        description TEXT
    ) LOOP
        INSERT INTO public.inventory_transaction_items (
            id,
            organization_id,
            transaction_id,
            row_number,
            product_id,
            source_warehouse_id,
            destination_warehouse_id,
            quantity,
            unit_cost_amount,
            total_cost_amount,
            unit_sales_price,
            total_sales_price,
            created_at
        ) VALUES (
            gen_random_uuid(),
            p_organization_id,
            v_inventory_tx_id,
            v_row_num,
            v_item.product_id,
            CASE WHEN p_invoice_type = 'SELL' THEN v_item.warehouse_id ELSE NULL END,
            CASE WHEN p_invoice_type = 'BUY' THEN v_item.warehouse_id ELSE NULL END,
            v_item.quantity,
            COALESCE(v_item.unit_cost_amount, 0),
            COALESCE(v_item.total_cost_amount, 0),
            COALESCE(v_item.unit_price_amount, v_item.unit_price, 0),
            ROUND(v_item.quantity * COALESCE(v_item.unit_price_amount, v_item.unit_price, 0)),
            v_now
        );
        v_row_num := v_row_num + 1;
    END LOOP;

    -- Update invoice with inventory_transaction_id
    UPDATE public.invoices SET inventory_transaction_id = v_inventory_tx_id WHERE id = v_invoice_id;

    -- 18. Create Cheques & Initial History Records (Compliant with Migration 19/20 Schema)
    IF p_cheques IS NOT NULL AND jsonb_array_length(p_cheques) > 0 THEN
        FOR v_cheque IN SELECT * FROM jsonb_to_recordset(p_cheques) AS x(
            cheque_type TEXT,
            amount NUMERIC,
            check_number TEXT,
            due_date TEXT,
            bank_name TEXT,
            branch_name TEXT,
            account_number TEXT,
            sayadi_identifier TEXT,
            issue_date TEXT,
            description TEXT
        ) LOOP
            v_cheque_id := gen_random_uuid();
            INSERT INTO public.cheques (
                id,
                organization_id,
                branch_id,
                fiscal_year_id,
                cheque_type,
                current_state,
                person_id,
                invoice_id,
                check_number,
                sayadi_identifier,
                amount,
                bank_name,
                branch_name,
                account_number,
                issue_date,
                due_date,
                description,
                journal_voucher_id,
                created_by,
                operation_key,
                request_fingerprint,
                version,
                created_at,
                updated_at
            ) VALUES (
                v_cheque_id,
                p_organization_id,
                p_branch_id,
                p_fiscal_year_id,
                v_cheque.cheque_type,
                CASE WHEN v_cheque.cheque_type = 'received' THEN 'present_in_cashbox' ELSE 'issued' END,
                p_person_id,
                v_invoice_id,
                v_cheque.check_number,
                v_cheque.sayadi_identifier,
                v_cheque.amount,
                v_cheque.bank_name,
                v_cheque.branch_name,
                v_cheque.account_number,
                v_cheque.issue_date,
                v_cheque.due_date,
                v_cheque.description,
                v_voucher_id,
                p_user_id,
                p_operation_key || '_' || v_cheque.check_number,
                p_request_fingerprint,
                1,
                v_now,
                v_now
            );

            INSERT INTO public.cheque_state_history (
                id,
                organization_id,
                cheque_id,
                from_state,
                to_state,
                event_type,
                performed_by,
                operation_key,
                request_fingerprint,
                journal_voucher_id,
                metadata,
                created_at
            ) VALUES (
                gen_random_uuid(),
                p_organization_id,
                v_cheque_id,
                NULL,
                CASE WHEN v_cheque.cheque_type = 'received' THEN 'present_in_cashbox' ELSE 'issued' END,
                'CREATE',
                p_user_id,
                p_operation_key || '_' || v_cheque.check_number,
                p_request_fingerprint,
                v_voucher_id,
                jsonb_build_object('invoice_id', v_invoice_id, 'amount', v_cheque.amount, 'check_number', v_cheque.check_number),
                v_now
            );
        END LOOP;
    END IF;

    -- 19. Return Result Summary
    SELECT jsonb_build_object(
        'id', v_invoice_id,
        'organization_id', p_organization_id,
        'invoice_number', v_invoice_number,
        'final_amount', v_final_amount,
        'journal_voucher_id', v_voucher_id,
        'inventory_transaction_id', v_inventory_tx_id,
        'version', 1,
        'idempotent_replay', false
    ) INTO v_result;

    RETURN v_result;
END;
$$;

COMMIT;
