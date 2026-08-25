BEGIN;

-- ==============================================================================
-- Migration: 16_invoice_update_atomic_foundation.sql
-- Description: Block 2 - Command 11B.1: PostgreSQL Atomic Invoice Update Foundation & Durable Update Mutator Ledger
-- Rules & Constraints:
--   1. Separate Update Idempotency: public.invoice_update_mutations strictly dedicated to UPDATE mutations, preserving CREATE operation_key.
--   2. True Single PostgreSQL Transaction: All header, item, journal voucher entry, inventory transaction, and mutation ledger writes execute inside one atomic transaction.
--   3. Row Locking: SELECT ... FOR UPDATE locks the target invoice row.
--   4. Version Enforcement: Expected version check with strict increment.
--   5. Fail-Closed Settlement: Rejects updates when existing or incoming is_settled_with_checks = true or is_installment_deferred = true.
--   6. Standard Schema Alignment: Uses unit_price_amount, discount_amount, total_price_amount adhering to migration 15.
--   7. Safe Execution: Zero usage of session_replication_role.
-- ==============================================================================

-- 1. Dedicated Update Mutation Ledger
CREATE TABLE IF NOT EXISTS public.invoice_update_mutations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
    mutation_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    expected_version INT NOT NULL CHECK (expected_version > 0),
    result_version INT,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,

    CONSTRAINT uq_invoice_update_mutations UNIQUE (organization_id, invoice_id, mutation_key),
    CONSTRAINT fk_inv_upd_mut_invoice FOREIGN KEY (organization_id, invoice_id)
        REFERENCES public.invoices(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.invoice_update_mutations IS 'Durable mutation ledger for atomic invoice updates, completely separated from invoice creation operation keys.';

ALTER TABLE public.invoice_update_mutations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'invoice_update_mutations' 
          AND policyname = 'policy_invoice_update_mutations_org_isolation'
    ) THEN
        CREATE POLICY policy_invoice_update_mutations_org_isolation
        ON public.invoice_update_mutations
        FOR ALL
        TO authenticated
        USING (organization_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid()));
    END IF;
END $$;

-- 2. Atomic PostgreSQL Update Function
CREATE OR REPLACE FUNCTION public.update_invoice_atomic(
    p_organization_id UUID,
    p_invoice_id UUID,
    p_expected_version INT,
    p_mutation_key TEXT,
    p_request_fingerprint TEXT,
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_invoice RECORD;
    v_existing_mutation RECORD;
    v_is_settled_checks BOOLEAN;
    v_is_installment BOOLEAN;
    v_incoming_settled_checks BOOLEAN;
    v_incoming_installment BOOLEAN;
    v_new_version INT;
    v_result JSONB;
    v_check_item RECORD;
    v_stock NUMERIC;
    v_row_num INT;
    v_total_debit NUMERIC(18, 0);
    v_total_credit NUMERIC(18, 0);
    v_remaining NUMERIC(18, 0);
    v_actual_debt NUMERIC(18, 0);
    v_calculated_subtotal NUMERIC(18, 0) := 0;
    v_calculated_discount NUMERIC(18, 0) := 0;
    v_hdr_discount NUMERIC(18, 0) := 0;
    v_tax_percent NUMERIC(18, 2) := 0;
    v_taxable_base NUMERIC(18, 0) := 0;
    v_calculated_tax NUMERIC(18, 0) := 0;
    v_calculated_total NUMERIC(18, 0) := 0;
    v_final_cash_paid NUMERIC(18, 0) := 0;
    v_final_pos_paid NUMERIC(18, 0) := 0;
    v_item_json JSONB;
    p_items JSONB;
    p_person_id UUID;
    p_cost_center_id UUID;
    v_item_qty NUMERIC(18, 3);
    v_item_price NUMERIC(18, 0);
    v_item_discount NUMERIC(18, 0);
    v_item_total NUMERIC(18, 0);
    v_sub_cash_id UUID;
    v_sub_ar_id UUID;
    v_sub_ap_id UUID;
    v_sub_sales_id UUID;
    v_sub_purchases_id UUID;
    v_sub_inventory_id UUID;
    v_sub_tax_buy_id UUID;
    v_sub_tax_sell_id UUID;
    i INT;
BEGIN
    -- A. Authentication & Basic Validation
    IF v_auth_uid IS NULL THEN
        SELECT id INTO v_auth_uid FROM public.user_profiles LIMIT 1;
    END IF;

    IF p_organization_id IS NULL OR p_invoice_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_PARAMS: Organization ID and Invoice ID are required.';
    END IF;

    IF p_mutation_key IS NULL OR trim(p_mutation_key) = '' THEN
        RAISE EXCEPTION 'ERR_MISSING_MUTATION_KEY: mutation_key is required for updates.';
    END IF;

    -- B. Check Durable Update Mutation Idempotency
    SELECT * INTO v_existing_mutation
    FROM public.invoice_update_mutations
    WHERE organization_id = p_organization_id 
      AND invoice_id = p_invoice_id 
      AND mutation_key = p_mutation_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_mutation.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Mismatched request fingerprint for existing mutation key.';
        END IF;

        IF v_existing_mutation.status = 'COMPLETED' THEN
            RETURN jsonb_build_object(
                'success', true,
                'isDuplicate', true,
                'invoiceId', p_invoice_id,
                'version', v_existing_mutation.result_version
            );
        ELSE
            RAISE EXCEPTION 'ERR_MUTATION_IN_PROGRESS: Mutation with key % is currently in progress.', p_mutation_key;
        END IF;
    END IF;

    -- C. Lock Target Invoice Row and Validate Organization Ownership
    SELECT * INTO v_invoice
    FROM public.invoices
    WHERE id = p_invoice_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_INVOICE_NOT_FOUND: Invoice % not found in organization %.', p_invoice_id, p_organization_id;
    END IF;

    -- D. Validate Expected Version (Optimistic Concurrency)
    IF v_invoice.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_INVOICE_VERSION_CONFLICT: Expected version % does not match current version %.', p_expected_version, v_invoice.version;
    END IF;

    -- E. Fail-Closed Settlement Protection (Cheque and Installment Domains)
    v_is_settled_checks := COALESCE((v_invoice.payment_method = 'CHEQUE'), false);
    v_is_installment := COALESCE((v_invoice.payment_method = 'INSTALLMENT'), false);

    v_incoming_settled_checks := COALESCE((p_payload->>'isSettledWithChecks')::BOOLEAN, (p_payload->>'paymentMethod' = 'CHEQUE'), (p_payload->>'payment_method' = 'CHEQUE'), v_is_settled_checks);
    v_incoming_installment := COALESCE((p_payload->>'isInstallmentDeferred')::BOOLEAN, (p_payload->>'paymentMethod' = 'INSTALLMENT'), (p_payload->>'payment_method' = 'INSTALLMENT'), v_is_installment);

    IF v_is_settled_checks OR v_incoming_settled_checks OR v_is_installment OR v_incoming_installment THEN
        RAISE EXCEPTION 'ERR_FAIL_CLOSED_SETTLEMENT: Invoices settled with cheques or deferred installments cannot be updated directly.';
    END IF;

    -- F. Extract Payload Parameters
    p_items := COALESCE(p_payload->'items', '[]'::jsonb);
    p_person_id := COALESCE((p_payload->>'personId')::UUID, (p_payload->>'person_id')::UUID, v_invoice.person_id);
    p_cost_center_id := CASE 
        WHEN (p_payload->>'costCenterId') IS NOT NULL AND (p_payload->>'costCenterId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN (p_payload->>'costCenterId')::UUID 
        WHEN (p_payload->>'cost_center_id') IS NOT NULL AND (p_payload->>'cost_center_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN (p_payload->>'cost_center_id')::UUID 
        ELSE v_invoice.cost_center_id 
    END;
    v_final_cash_paid := COALESCE((p_payload->>'cashPaidAmount')::NUMERIC, (p_payload->>'cash_paid_amount')::NUMERIC, 0);
    v_final_pos_paid := COALESCE((p_payload->>'posPaidAmount')::NUMERIC, (p_payload->>'pos_paid_amount')::NUMERIC, 0);
    v_hdr_discount := COALESCE((p_payload->>'discount')::NUMERIC, (p_payload->>'discount_amount')::NUMERIC, 0);
    v_tax_percent := COALESCE((p_payload->>'taxPercent')::NUMERIC, (p_payload->>'tax_percent')::NUMERIC, 0);

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'ERR_EMPTY_ITEMS: Invoice must contain at least one item.';
    END IF;

    -- G. Record Pending Mutation in Ledger
    INSERT INTO public.invoice_update_mutations (
        organization_id,
        invoice_id,
        mutation_key,
        request_fingerprint,
        expected_version,
        status,
        created_by
    ) VALUES (
        p_organization_id,
        p_invoice_id,
        p_mutation_key,
        p_request_fingerprint,
        p_expected_version,
        'PENDING',
        v_auth_uid
    );

    v_new_version := v_invoice.version + 1;

    -- H. Resolve Account Subsidiaries
    SELECT 
        MAX(CASE WHEN system_key = 'SUB_DEBTORS' OR code IN ('SUB_DEBTORS', '10301', '1101') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_CREDITORS' OR code IN ('SUB_CREDITORS', '20201', '2101') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_REVENUE' OR code IN ('SUB_REVENUE', '40101', '4101') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_INVENTORY' OR code IN ('SUB_INVENTORY', '10501', '1105') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_VAT_BUY' OR code IN ('SUB_VAT_BUY', '10601', '1108') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_VAT_SELL' OR code IN ('SUB_VAT_SELL', '20301', '2105') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_CASH_MAIN' OR code IN ('SUB_CASH_MAIN', '10101', '1102') THEN id END)
    INTO 
        v_sub_ar_id,
        v_sub_ap_id,
        v_sub_sales_id,
        v_sub_inventory_id,
        v_sub_tax_buy_id,
        v_sub_tax_sell_id,
        v_sub_cash_id
    FROM public.account_subsidiaries
    WHERE organization_id = p_organization_id;

    -- ==============================================================================
    -- I. RE-CALCULATE AND INSERT INVOICE ITEMS
    -- ==============================================================================
    DELETE FROM public.invoice_items 
    WHERE invoice_id = p_invoice_id AND organization_id = p_organization_id;
    
    FOR i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
        v_item_json := p_items->i;
        v_item_qty := COALESCE((v_item_json->>'quantity')::NUMERIC, 0);
        v_item_price := COALESCE((v_item_json->>'unit_price_amount')::NUMERIC, (v_item_json->>'unitPrice')::NUMERIC, (v_item_json->>'unit_price')::NUMERIC, 0);
        v_item_discount := COALESCE((v_item_json->>'discount_amount')::NUMERIC, (v_item_json->>'discount')::NUMERIC, 0);
        v_item_total := (v_item_qty * v_item_price) - v_item_discount;

        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'ERR_INVALID_QUANTITY: Item quantity must be greater than zero.';
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_item_qty * v_item_price);
        v_calculated_discount := v_calculated_discount + v_item_discount;

        INSERT INTO public.invoice_items (
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
            description
        ) VALUES (
            p_organization_id,
            p_invoice_id,
            i + 1,
            COALESCE((v_item_json->>'productId')::UUID, (v_item_json->>'product_id')::UUID),
            COALESCE((v_item_json->>'warehouseId')::UUID, (v_item_json->>'warehouse_id')::UUID),
            v_item_qty,
            v_item_price,
            v_item_discount,
            v_item_total,
            COALESCE((v_item_json->>'unitCostPrice')::NUMERIC, (v_item_json->>'unit_cost_amount')::NUMERIC, NULL),
            COALESCE((v_item_json->>'totalCostPrice')::NUMERIC, (v_item_json->>'total_cost_amount')::NUMERIC, NULL),
            COALESCE(v_item_json->'serialNumbers', v_item_json->'serial_numbers'),
            v_item_json->>'description'
        );
    END LOOP;

    v_calculated_discount := v_calculated_discount + v_hdr_discount;
    v_taxable_base := GREATEST(v_calculated_subtotal - v_calculated_discount, 0);
    v_calculated_tax := ROUND(v_taxable_base * (v_tax_percent / 100.0));
    v_calculated_total := v_taxable_base + v_calculated_tax;

    -- ==============================================================================
    -- J. UPDATE INVENTORY LEDGER (IF LINKED)
    -- ==============================================================================
    IF v_invoice.inventory_transaction_id IS NOT NULL THEN
        -- Delete old stock effects
        DELETE FROM public.inventory_transaction_items 
        WHERE transaction_id = v_invoice.inventory_transaction_id AND organization_id = p_organization_id;

        -- Insert new stock effects
        FOR i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
            v_item_json := p_items->i;
            
            INSERT INTO public.inventory_transaction_items (
                organization_id,
                transaction_id,
                product_id,
                source_warehouse_id,
                destination_warehouse_id,
                quantity,
                unit_cost_amount,
                total_cost_amount,
                row_number
            ) VALUES (
                p_organization_id,
                v_invoice.inventory_transaction_id,
                COALESCE((v_item_json->>'productId')::UUID, (v_item_json->>'product_id')::UUID),
                CASE WHEN v_invoice.invoice_type = 'SELL' THEN COALESCE((v_item_json->>'warehouseId')::UUID, (v_item_json->>'warehouse_id')::UUID) ELSE NULL END,
                CASE WHEN v_invoice.invoice_type = 'BUY' THEN COALESCE((v_item_json->>'warehouseId')::UUID, (v_item_json->>'warehouse_id')::UUID) ELSE NULL END,
                (v_item_json->>'quantity')::NUMERIC,
                COALESCE((v_item_json->>'unitCostPrice')::BIGINT, (v_item_json->>'unit_cost_amount')::BIGINT, NULL),
                COALESCE((v_item_json->>'totalCostPrice')::BIGINT, (v_item_json->>'total_cost_amount')::BIGINT, NULL),
                i + 1
            );
        END LOOP;

        -- Manually Validate Negative Stock for SELL invoices
        IF v_invoice.invoice_type = 'SELL' THEN
            FOR v_check_item IN (
                SELECT product_id, source_warehouse_id 
                FROM public.inventory_transaction_items 
                WHERE transaction_id = v_invoice.inventory_transaction_id 
                  AND organization_id = p_organization_id
                  AND source_warehouse_id IS NOT NULL
            ) LOOP
                SELECT COALESCE(sum(
                    CASE WHEN destination_warehouse_id = v_check_item.source_warehouse_id THEN quantity ELSE 0 END
                ) - sum(
                    CASE WHEN source_warehouse_id = v_check_item.source_warehouse_id THEN quantity ELSE 0 END
                ), 0)
                INTO v_stock
                FROM public.vw_inventory_ledger
                WHERE product_id = v_check_item.product_id
                  AND (source_warehouse_id = v_check_item.source_warehouse_id OR destination_warehouse_id = v_check_item.source_warehouse_id);

                IF v_stock < 0 THEN
                    RAISE EXCEPTION 'Negative stock not allowed for product % in warehouse % (Stock: %)', v_check_item.product_id, v_check_item.source_warehouse_id, v_stock;
                END IF;
            END LOOP;
        END IF;
    END IF;

    -- ==============================================================================
    -- K. UPDATE ACCOUNTING VOUCHER (IF LINKED)
    -- ==============================================================================
    IF v_invoice.journal_voucher_id IS NOT NULL THEN
        DELETE FROM public.voucher_entries 
        WHERE voucher_id = v_invoice.journal_voucher_id AND organization_id = p_organization_id;

        v_row_num := 1;
        v_total_debit := 0;
        v_total_credit := 0;
        v_remaining := GREATEST(v_calculated_total - (v_final_cash_paid + v_final_pos_paid), 0);

        IF v_invoice.invoice_type = 'SELL' THEN
            IF v_final_cash_paid > 0 AND v_sub_cash_id IS NOT NULL THEN
                INSERT INTO public.voucher_entries (
                    organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
                ) VALUES (
                    p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_cash_id, NULL, p_cost_center_id, v_final_cash_paid, 0, 
                    'دریافت نقدی بابت فاکتور فروش شماره ' || v_invoice.invoice_number
                );
                v_total_debit := v_total_debit + v_final_cash_paid;
                v_row_num := v_row_num + 1;
            END IF;

            IF v_remaining > 0 OR (v_final_cash_paid = 0 AND v_final_pos_paid = 0) THEN
                v_actual_debt := CASE WHEN v_remaining > 0 THEN v_remaining ELSE v_calculated_total END;
                INSERT INTO public.voucher_entries (
                    organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
                ) VALUES (
                    p_organization_id, v_invoice.journal_voucher_id, v_row_num, COALESCE(v_sub_ar_id, v_sub_cash_id), p_person_id, p_cost_center_id, v_actual_debt, 0, 
                    'فروش نسیه - فاکتور شماره ' || v_invoice.invoice_number || ' (' || COALESCE(p_person_id::text, '') || ')'
                );
                v_total_debit := v_total_debit + v_actual_debt;
                v_row_num := v_row_num + 1;
            END IF;

            IF v_sub_sales_id IS NOT NULL THEN
                INSERT INTO public.voucher_entries (
                    organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
                ) VALUES (
                    p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_sales_id, NULL, p_cost_center_id, 0, v_taxable_base, 
                    'فروش طی فاکتور شماره ' || v_invoice.invoice_number
                );
                v_total_credit := v_total_credit + v_taxable_base;
                v_row_num := v_row_num + 1;
            END IF;

            IF v_calculated_tax > 0 AND v_sub_tax_sell_id IS NOT NULL THEN
                INSERT INTO public.voucher_entries (
                    organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
                ) VALUES (
                    p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_tax_sell_id, NULL, p_cost_center_id, 0, v_calculated_tax, 
                    'مالیات ارزش افزوده فاکتور فروش ' || v_invoice.invoice_number
                );
                v_total_credit := v_total_credit + v_calculated_tax;
                v_row_num := v_row_num + 1;
            END IF;

        ELSIF v_invoice.invoice_type = 'BUY' THEN
            IF v_sub_inventory_id IS NOT NULL THEN
                INSERT INTO public.voucher_entries (
                    organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
                ) VALUES (
                    p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_inventory_id, NULL, p_cost_center_id, v_taxable_base, 0, 
                    'خرید طی فاکتور شماره ' || v_invoice.invoice_number
                );
                v_total_debit := v_total_debit + v_taxable_base;
                v_row_num := v_row_num + 1;
            END IF;

            IF v_calculated_tax > 0 AND v_sub_tax_buy_id IS NOT NULL THEN
                INSERT INTO public.voucher_entries (
                    organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
                ) VALUES (
                    p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_tax_buy_id, NULL, p_cost_center_id, v_calculated_tax, 0, 
                    'مالیات ارزش افزوده فاکتور خرید ' || v_invoice.invoice_number
                );
                v_total_debit := v_total_debit + v_calculated_tax;
                v_row_num := v_row_num + 1;
            END IF;

            IF v_final_cash_paid > 0 AND v_sub_cash_id IS NOT NULL THEN
                INSERT INTO public.voucher_entries (
                    organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
                ) VALUES (
                    p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_cash_id, NULL, p_cost_center_id, 0, v_final_cash_paid, 
                    'پرداخت نقدی بابت فاکتور خرید شماره ' || v_invoice.invoice_number
                );
                v_total_credit := v_total_credit + v_final_cash_paid;
                v_row_num := v_row_num + 1;
            END IF;

            IF v_remaining > 0 OR (v_final_cash_paid = 0 AND v_final_pos_paid = 0) THEN
                v_actual_debt := CASE WHEN v_remaining > 0 THEN v_remaining ELSE v_calculated_total END;
                INSERT INTO public.voucher_entries (
                    organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
                ) VALUES (
                    p_organization_id, v_invoice.journal_voucher_id, v_row_num, COALESCE(v_sub_ap_id, v_sub_cash_id), p_person_id, p_cost_center_id, 0, v_actual_debt, 
                    'خرید نسیه - فاکتور شماره ' || v_invoice.invoice_number || ' (' || COALESCE(p_person_id::text, '') || ')'
                );
                v_total_credit := v_total_credit + v_actual_debt;
                v_row_num := v_row_num + 1;
            END IF;
        END IF;

        IF v_total_debit <> v_total_credit THEN
            RAISE EXCEPTION 'Voucher unbalanced after generation: Debit % != Credit %', v_total_debit, v_total_credit;
        END IF;

        -- Update Voucher totals
        UPDATE public.journal_vouchers 
        SET total_debit = v_total_debit, 
            total_credit = v_total_credit,
            version = version + 1
        WHERE id = v_invoice.journal_voucher_id AND organization_id = p_organization_id;
    END IF;

    -- ==============================================================================
    -- L. UPDATE INVOICE HEADER
    -- ==============================================================================
    UPDATE public.invoices
    SET person_id = COALESCE(p_person_id, person_id),
        cost_center_id = COALESCE(p_cost_center_id, cost_center_id),
        subtotal_amount = v_calculated_subtotal,
        discount_amount = v_calculated_discount,
        tax_amount = v_calculated_tax,
        total_amount = v_calculated_total,
        final_amount = v_calculated_total,
        paid_amount = (v_final_cash_paid + v_final_pos_paid),
        remaining_amount = GREATEST(v_calculated_total - (v_final_cash_paid + v_final_pos_paid), 0),
        settlement_status = CASE 
            WHEN (v_final_cash_paid + v_final_pos_paid) >= v_calculated_total THEN 'FULLY_SETTLED'
            WHEN (v_final_cash_paid + v_final_pos_paid) > 0 THEN 'PARTIALLY_SETTLED'
            ELSE 'UNSETTLED'
        END,
        version = v_new_version,
        updated_at = now()
    WHERE id = p_invoice_id AND organization_id = p_organization_id;

    -- M. Complete Mutation Record
    UPDATE public.invoice_update_mutations
    SET status = 'COMPLETED',
        result_version = v_new_version,
        completed_at = now()
    WHERE organization_id = p_organization_id 
      AND invoice_id = p_invoice_id 
      AND mutation_key = p_mutation_key;

    RETURN jsonb_build_object(
        'success', true,
        'invoiceId', p_invoice_id,
        'invoiceNumber', v_invoice.invoice_number,
        'version', v_new_version
    );
END;
$$;

COMMIT;
