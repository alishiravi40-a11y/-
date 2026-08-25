BEGIN;

-- ==============================================================================
-- Migration: 26_installment_settlement_atomic.sql
-- Description: Phase 3-F / Step 6 - Server-Authoritative Atomic Installment Book & Settlement RPCs
-- Invariants:
--   1. Pessimistic Row Locking: Installments locked with FOR UPDATE during settlement.
--   2. Strict Double-Entry Balance: Debit (Cash/Bank) == Credit (Debtors Installment).
--   3. Deterministic Idempotency: operation_key enforced on installment_payments and voucher_operation_keys.
--   4. Immutable Ledger: Voucher posted with status 'POSTED' and linked to payment.
-- ==============================================================================

-- 1. RPC: create_installment_book_atomic
CREATE OR REPLACE FUNCTION public.create_installment_book_atomic(
    p_org_id UUID,
    p_branch_id UUID,
    p_person_id UUID,
    p_user_id UUID,
    p_invoice_id TEXT,
    p_credit_file_id TEXT,
    p_calculator_id TEXT,
    p_total_principal NUMERIC(18, 0),
    p_total_interest NUMERIC(18, 0),
    p_total_amount NUMERIC(18, 0),
    p_installment_count INT,
    p_start_date TEXT,
    p_interval_days INT,
    p_installments JSONB,
    p_op_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_book_id UUID;
    v_branch_id UUID := p_branch_id;
    v_inst JSONB;
    v_inst_num INT := 0;
    v_count INT := 0;
    v_existing_book RECORD;
BEGIN
    -- 1. Validation
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'Parameter p_org_id is required.';
    END IF;
    IF p_person_id IS NULL THEN
        RAISE EXCEPTION 'Parameter p_person_id is required.';
    END IF;
    IF p_installment_count IS NULL OR p_installment_count <= 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_COUNT: تعداد اقساط باید بزرگتر از صفر باشد.';
    END IF;
    IF p_installments IS NULL OR jsonb_array_length(p_installments) = 0 THEN
        RAISE EXCEPTION 'ERR_EMPTY_INSTALLMENTS: لیست اقساط نباید خالی باشد.';
    END IF;
    IF p_total_amount <> (COALESCE(p_total_principal, 0) + COALESCE(p_total_interest, 0)) THEN
        RAISE EXCEPTION 'ERR_TOTAL_MISMATCH: مبلغ کل دفترچه اقساط با مجموع اصل و سود همخوانی ندارد.';
    END IF;

    -- 2. Validate Person
    PERFORM 1 FROM public.persons 
    WHERE id = p_person_id AND organization_id = p_org_id AND status <> 'inactive';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_PERSON_INVALID: شخص انتخاب شده معتبر یا فعال نیست.';
    END IF;

    -- 3. Resolve Branch
    IF v_branch_id IS NULL THEN
        SELECT id INTO v_branch_id
        FROM public.branches
        WHERE organization_id = p_org_id AND is_main = true
        LIMIT 1;

        IF v_branch_id IS NULL THEN
            SELECT id INTO v_branch_id
            FROM public.branches
            WHERE organization_id = p_org_id
            LIMIT 1;
        END IF;
    END IF;

    -- 4. Idempotency Check
    IF p_op_key IS NOT NULL AND trim(p_op_key) <> '' THEN
        SELECT id, status INTO v_existing_book
        FROM public.installment_books
        WHERE organization_id = p_org_id 
          AND (invoice_id = p_invoice_id OR credit_file_id = p_credit_file_id)
          AND total_amount = p_total_amount
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'book_id', v_existing_book.id,
                'status', v_existing_book.status,
                'idempotent_replay', true,
                'message', 'دفترچه اقساط قبلاً ایجاد شده است.'
            );
        END IF;
    END IF;

    -- 5. Insert Installment Book Header
    v_book_id := gen_random_uuid();

    INSERT INTO public.installment_books (
        id,
        organization_id,
        branch_id,
        person_id,
        invoice_id,
        credit_file_id,
        calculator_id,
        total_principal,
        total_interest,
        total_amount,
        installment_count,
        start_date,
        interval_days,
        status,
        created_by,
        version,
        created_at,
        updated_at
    ) VALUES (
        v_book_id,
        p_org_id,
        v_branch_id,
        p_person_id,
        p_invoice_id,
        p_credit_file_id,
        p_calculator_id,
        COALESCE(p_total_principal, 0),
        COALESCE(p_total_interest, 0),
        p_total_amount,
        p_installment_count,
        COALESCE(p_start_date, CURRENT_DATE::text),
        COALESCE(p_interval_days, 30),
        'active',
        p_user_id,
        1,
        now(),
        now()
    );

    -- 6. Insert Installment Lines
    FOR v_inst IN SELECT * FROM jsonb_array_elements(p_installments)
    LOOP
        v_inst_num := v_inst_num + 1;
        v_count := v_count + 1;

        INSERT INTO public.installments (
            id,
            organization_id,
            book_id,
            installment_number,
            due_date,
            amount,
            paid_amount,
            principal_part,
            interest_part,
            penalty_amount,
            delay_days,
            status,
            paid_date,
            calculator_id,
            version,
            created_at,
            updated_at
        ) VALUES (
            gen_random_uuid(),
            p_org_id,
            v_book_id,
            COALESCE((v_inst->>'installment_number')::int, (v_inst->>'installmentNumber')::int, v_inst_num),
            COALESCE(v_inst->>'due_date', v_inst->>'dueDate', CURRENT_DATE::text),
            COALESCE((v_inst->>'amount')::numeric, 0),
            0,
            COALESCE((v_inst->>'principal_part')::numeric, (v_inst->>'principalPart')::numeric, 0),
            COALESCE((v_inst->>'interest_part')::numeric, (v_inst->>'interestPart')::numeric, 0),
            0,
            0,
            'upcoming',
            NULL,
            p_calculator_id,
            1,
            now(),
            now()
        );
    END LOOP;

    -- 7. Register Operation Key if provided
    IF p_op_key IS NOT NULL AND trim(p_op_key) <> '' THEN
        INSERT INTO public.voucher_operation_keys (
            organization_id,
            operation_key,
            operation_type,
            request_fingerprint,
            created_by,
            completed_at
        ) VALUES (
            p_org_id,
            p_op_key,
            'CREATE_INSTALLMENT_BOOK',
            p_op_key,
            p_user_id,
            now()
        ) ON CONFLICT (organization_id, operation_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'book_id', v_book_id,
        'installment_count', v_count,
        'total_amount', p_total_amount,
        'message', 'دفترچه اقساط با موفقیت ایجاد گردید.'
    );
END;
$$;


-- 2. RPC: settle_installment_atomic
CREATE OR REPLACE FUNCTION public.settle_installment_atomic(
    p_org_id UUID,
    p_branch_id UUID,
    p_fiscal_year_id UUID,
    p_user_id UUID,
    p_person_id UUID,
    p_installment_ids JSONB,
    p_amount NUMERIC(18, 0),
    p_payment_method TEXT,
    p_payment_date TEXT,
    p_bank_or_cash_sub_id TEXT,
    p_pos_terminal_id TEXT,
    p_description TEXT,
    p_op_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_existing_pmt RECORD;
    v_branch_id UUID := p_branch_id;
    v_fiscal_year_id UUID := p_fiscal_year_id;
    v_date DATE := COALESCE(p_payment_date::date, CURRENT_DATE);
    v_pmt_method TEXT := UPPER(COALESCE(p_payment_method, 'CASH'));
    v_desc TEXT := COALESCE(p_description, 'دریافت وجه اقساط');
    v_payment_id UUID;
    v_voucher_id UUID;
    v_voucher_number BIGINT;
    v_inst_rec RECORD;
    v_remaining_to_allocate NUMERIC(18, 0) := p_amount;
    v_alloc_amount NUMERIC(18, 0);
    v_inst_due NUMERIC(18, 0);
    v_allocated_count INT := 0;
    v_target_sub_debit_id UUID;
    v_sub_debtors_inst_id UUID;
    v_book_id UUID;
    v_unpaid_in_book INT;
    v_total_unpaid NUMERIC(18, 0) := 0;
BEGIN
    -- 1. Parameter Validation
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'Parameter p_org_id is required.';
    END IF;
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Parameter p_user_id is required.';
    END IF;
    IF p_op_key IS NULL OR trim(p_op_key) = '' THEN
        RAISE EXCEPTION 'Parameter p_op_key is required.';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_AMOUNT: مبلغ تسویه قسط باید بزرگتر از صفر باشد.';
    END IF;
    IF p_installment_ids IS NULL OR jsonb_array_length(p_installment_ids) = 0 THEN
        RAISE EXCEPTION 'ERR_NO_INSTALLMENT_SELECTED: حداقل یک قسط جهت تسویه باید مشخص شود.';
    END IF;

    -- 2. Idempotency Guard on installment_payments
    SELECT id, voucher_id, amount INTO v_existing_pmt
    FROM public.installment_payments
    WHERE organization_id = p_org_id AND operation_key = p_op_key;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'payment_id', v_existing_pmt.id,
            'voucher_id', v_existing_pmt.voucher_id,
            'amount', v_existing_pmt.amount,
            'idempotent_replay', true,
            'message', 'این پرداخت قسط قبلاً ثبت شده است.'
        );
    END IF;

    -- 3. Resolve Branch & Fiscal Year
    IF v_branch_id IS NULL THEN
        SELECT id INTO v_branch_id
        FROM public.branches
        WHERE organization_id = p_org_id AND is_main = true
        LIMIT 1;

        IF v_branch_id IS NULL THEN
            SELECT id INTO v_branch_id
            FROM public.branches
            WHERE organization_id = p_org_id
            LIMIT 1;
        END IF;

        IF v_branch_id IS NULL THEN
            RAISE EXCEPTION 'ERR_NO_BRANCH: شعبه‌ای برای سازمان یافت نشد.';
        END IF;
    END IF;

    IF v_fiscal_year_id IS NULL THEN
        SELECT id INTO v_fiscal_year_id
        FROM public.fiscal_years
        WHERE organization_id = p_org_id
          AND start_date <= v_date
          AND end_date >= v_date
        LIMIT 1;

        IF v_fiscal_year_id IS NULL THEN
            SELECT id INTO v_fiscal_year_id
            FROM public.fiscal_years
            WHERE organization_id = p_org_id AND is_closed = false
            ORDER BY end_date DESC
            LIMIT 1;
        END IF;

        IF v_fiscal_year_id IS NULL THEN
            RAISE EXCEPTION 'ERR_NO_FISCAL_YEAR: سال مالی فعالی برای سازمان یافت نشد.';
        END IF;
    END IF;

    -- 4. Resolve Chart of Accounts Subsidiaries
    -- Debit: Cash or Bank/POS
    IF p_bank_or_cash_sub_id IS NOT NULL AND p_bank_or_cash_sub_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT id INTO v_target_sub_debit_id
        FROM public.account_subsidiaries
        WHERE organization_id = p_org_id AND id = p_bank_or_cash_sub_id::uuid;
    END IF;

    IF v_target_sub_debit_id IS NULL THEN
        IF v_pmt_method = 'POS' OR v_pmt_method = 'TRANSFER' THEN
            SELECT id INTO v_target_sub_debit_id
            FROM public.account_subsidiaries
            WHERE organization_id = p_org_id AND (code = '1103' OR system_key = 'SUB_BANK_POS' OR system_key = 'SUB_BANK')
            LIMIT 1;
        ELSE
            SELECT id INTO v_target_sub_debit_id
            FROM public.account_subsidiaries
            WHERE organization_id = p_org_id AND (code = '1102' OR system_key = 'SUB_CASH_MAIN' OR system_key = 'SUB_CASH')
            LIMIT 1;
        END IF;
    END IF;

    IF v_target_sub_debit_id IS NULL THEN
        SELECT id INTO v_target_sub_debit_id
        FROM public.account_subsidiaries
        WHERE organization_id = p_org_id
        LIMIT 1;
    END IF;

    -- Credit: Installment Debtors (SUB_DEBTORS_INSTALLMENT or SUB_DEBTORS)
    SELECT id INTO v_sub_debtors_inst_id
    FROM public.account_subsidiaries
    WHERE organization_id = p_org_id AND (code = '1106' OR system_key = 'SUB_DEBTORS_INSTALLMENT' OR system_key = 'SUB_DEBTORS')
    LIMIT 1;

    IF v_sub_debtors_inst_id IS NULL THEN
        SELECT id INTO v_sub_debtors_inst_id
        FROM public.account_subsidiaries
        WHERE organization_id = p_org_id AND (code = '1101' OR system_key = 'SUB_DEBTORS')
        LIMIT 1;
    END IF;

    IF v_sub_debtors_inst_id IS NULL THEN
        RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND: حساب معین بدهکاران اقساطی یافت نشد.';
    END IF;

    -- 5. Calculate Total Unpaid Debt across Target Installments & Enforce Overpayment Guard
    SELECT COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0)
    INTO v_total_unpaid
    FROM public.installments
    WHERE organization_id = p_org_id 
      AND id::text IN (SELECT jsonb_array_elements_text(p_installment_ids));

    IF p_amount > v_total_unpaid THEN
        RAISE EXCEPTION 'ERR_INSTALLMENT_OVERPAYMENT_EXCEEDS_DEBT: مبلغ پرداختی نمی‌تواند از مجموع بدهی اقساط انتخاب‌شده بیشتر باشد.';
    END IF;

    -- 6. Create Payment Header
    v_payment_id := gen_random_uuid();

    INSERT INTO public.installment_payments (
        id,
        organization_id,
        person_id,
        amount,
        payment_date,
        payment_method,
        operation_key,
        created_by,
        created_at
    ) VALUES (
        v_payment_id,
        p_org_id,
        p_person_id,
        p_amount,
        v_date::text,
        v_pmt_method,
        p_op_key,
        p_user_id,
        now()
    );

    -- 6. Lock and Process Target Installments
    FOR v_inst_rec IN 
        SELECT id, book_id, amount, paid_amount, status
        FROM public.installments
        WHERE organization_id = p_org_id 
          AND id::text IN (SELECT jsonb_array_elements_text(p_installment_ids))
        ORDER BY due_date ASC
        FOR UPDATE
    LOOP
        v_book_id := v_inst_rec.book_id;
        v_inst_due := v_inst_rec.amount - v_inst_rec.paid_amount;

        IF v_inst_due > 0 AND v_remaining_to_allocate > 0 THEN
            v_alloc_amount := LEAST(v_inst_due, v_remaining_to_allocate);
            v_remaining_to_allocate := v_remaining_to_allocate - v_alloc_amount;
            v_allocated_count := v_allocated_count + 1;

            -- Update Installment Status & Paid Amount
            UPDATE public.installments
            SET paid_amount = paid_amount + v_alloc_amount,
                status = CASE WHEN (paid_amount + v_alloc_amount) >= amount THEN 'paid' ELSE 'partially_paid' END,
                paid_date = v_date::text,
                updated_at = now()
            WHERE id = v_inst_rec.id;

            -- Insert Allocation Record
            INSERT INTO public.installment_payment_allocations (
                id,
                organization_id,
                payment_id,
                installment_id,
                allocated_amount,
                created_at
            ) VALUES (
                gen_random_uuid(),
                p_org_id,
                v_payment_id,
                v_inst_rec.id,
                v_alloc_amount,
                now()
            );
        END IF;
    END LOOP;

    -- Update Installment Book status if completed
    IF v_book_id IS NOT NULL THEN
        SELECT count(*) INTO v_unpaid_in_book
        FROM public.installments
        WHERE organization_id = p_org_id AND book_id = v_book_id AND status <> 'paid';

        IF v_unpaid_in_book = 0 THEN
            UPDATE public.installment_books
            SET status = 'completed', updated_at = now()
            WHERE id = v_book_id;
        END IF;
    END IF;

    -- 7. Sequence Allocation for Journal Voucher
    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_org_id, v_fiscal_year_id, 1, p_user_id)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_voucher_number
    FROM public.voucher_sequences
    WHERE organization_id = p_org_id AND fiscal_year_id = v_fiscal_year_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_by = p_user_id,
        updated_at = now()
    WHERE organization_id = p_org_id AND fiscal_year_id = v_fiscal_year_id;

    -- 8. Insert Double-Entry Journal Voucher Header
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
        created_by,
        posted_by,
        posted_at,
        created_at,
        updated_at
    ) VALUES (
        v_voucher_id,
        p_org_id,
        v_branch_id,
        v_fiscal_year_id,
        v_voucher_number,
        v_date,
        v_desc,
        'POSTED',
        'GENERAL',
        true,
        'INSTALLMENT_PAYMENT',
        v_payment_id,
        p_op_key,
        p_user_id,
        p_user_id,
        now(),
        now(),
        now()
    );

    -- 9. Insert Balanced Voucher Entries (Debit Cash/Bank, Credit Debtors)
    -- Entry 1: Debit Cash or Bank/POS
    INSERT INTO public.voucher_entries (
        organization_id,
        voucher_id,
        row_number,
        subsidiary_id,
        person_id,
        cost_center_id,
        debit,
        credit,
        description
    ) VALUES (
        p_org_id,
        v_voucher_id,
        1,
        v_target_sub_debit_id,
        NULL,
        NULL,
        p_amount,
        0,
        CASE WHEN v_pmt_method = 'POS' THEN 'دریافت وجه اقساط از طریق کارتخوان' ELSE 'دریافت نقدی وجه اقساط' END
    );

    -- Entry 2: Credit Debtors Installment (Floating Person)
    INSERT INTO public.voucher_entries (
        organization_id,
        voucher_id,
        row_number,
        subsidiary_id,
        person_id,
        cost_center_id,
        debit,
        credit,
        description
    ) VALUES (
        p_org_id,
        v_voucher_id,
        2,
        v_sub_debtors_inst_id,
        p_person_id,
        NULL,
        0,
        p_amount,
        v_desc
    );

    -- 10. Link Voucher to Payment Record
    UPDATE public.installment_payments
    SET voucher_id = v_voucher_id
    WHERE id = v_payment_id;

    -- 11. Register Operation Key
    INSERT INTO public.voucher_operation_keys (
        organization_id,
        operation_key,
        operation_type,
        request_fingerprint,
        target_voucher_id,
        result_voucher_id,
        created_by,
        completed_at
    ) VALUES (
        p_org_id,
        p_op_key,
        'SETTLE_INSTALLMENT',
        p_op_key,
        v_voucher_id,
        v_voucher_id,
        p_user_id,
        now()
    ) ON CONFLICT (organization_id, operation_key) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'voucher_id', v_voucher_id,
        'voucher_number', v_voucher_number,
        'amount', p_amount,
        'allocated_installments_count', v_allocated_count,
        'message', 'تسویه قسط و صدور سند حسابداری با موفقیت انجام شد.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_installment_book_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INT, TEXT, INT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_installment_book_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INT, TEXT, INT, JSONB, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.settle_installment_atomic(UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_installment_atomic(UUID, UUID, UUID, UUID, UUID, JSONB, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

COMMIT;
