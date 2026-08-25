BEGIN;

-- ==============================================================================
-- Migration: 31_atomic_installment_book_creation.sql
-- Description: Command 6 - Authoritative Installment Book Creation RPC with Origin Type Distinction
-- Features:
--   1. Adds origin_type column to installment_books ('INVOICE', 'PARTNER_CREDIT', 'OPENING_BALANCE').
--   2. Updates create_installment_book_atomic RPC with strict financial invariants:
--      - 'INVOICE': Linked to invoice, preserves revenue & commission rules.
--      - 'PARTNER_CREDIT': Independent booklet with atomic fee voucher generation if interest > 0.
--      - 'OPENING_BALANCE': ZERO journal vouchers, ZERO entries, ZERO voucher numbers consumed, enforces valid person opening balance guard.
--   3. Idempotency & Operation Key conflict enforcement.
-- ==============================================================================

-- 1. ADD ORIGIN_TYPE COLUMN TO INSTALLMENT_BOOKS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'installment_books' 
          AND column_name = 'origin_type'
    ) THEN
        ALTER TABLE public.installment_books 
        ADD COLUMN origin_type TEXT NOT NULL DEFAULT 'INVOICE' 
        CHECK (origin_type IN ('INVOICE', 'PARTNER_CREDIT', 'OPENING_BALANCE'));
    END IF;
END $$;

COMMENT ON COLUMN public.installment_books.origin_type IS 'Explicit origin classifier: INVOICE, PARTNER_CREDIT, or OPENING_BALANCE.';

-- 2. CREATE / REPLACE create_installment_book_atomic RPC
CREATE OR REPLACE FUNCTION public.create_installment_book_atomic(
    p_org_id UUID,
    p_branch_id UUID,
    p_person_id UUID,
    p_user_id UUID,
    p_origin_type TEXT DEFAULT 'INVOICE',
    p_invoice_id TEXT DEFAULT NULL,
    p_credit_file_id TEXT DEFAULT NULL,
    p_calculator_id TEXT DEFAULT NULL,
    p_total_principal NUMERIC(18, 0) DEFAULT 0,
    p_total_interest NUMERIC(18, 0) DEFAULT 0,
    p_total_amount NUMERIC(18, 0) DEFAULT 0,
    p_installment_count INT DEFAULT 1,
    p_start_date TEXT DEFAULT NULL,
    p_interval_days INT DEFAULT 30,
    p_installments JSONB DEFAULT '[]'::jsonb,
    p_op_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_book_id UUID;
    v_branch_id UUID := p_branch_id;
    v_fiscal_year_id UUID;
    v_inst JSONB;
    v_inst_num INT := 0;
    v_count INT := 0;
    v_origin TEXT := UPPER(COALESCE(trim(p_origin_type), 'INVOICE'));
    v_existing_book RECORD;
    v_existing_op RECORD;
    v_has_opening_balance BOOLEAN := false;
    v_fee_voucher_id UUID;
    v_fee_voucher_num BIGINT;
    v_sub_debtors_inst_id UUID;
    v_sub_commission_rev_id UUID;
    v_vouchers_count_before INT := 0;
    v_voucher_entries_count_before INT := 0;
    v_locked_person_id UUID;
    v_debtor_sub_ids UUID[];
    v_ob_debit_sum NUMERIC(18, 0) := 0;
    v_ob_credit_sum NUMERIC(18, 0) := 0;
    v_net_opening_balance NUMERIC(18, 0) := 0;
    v_previously_allocated NUMERIC(18, 0) := 0;
    v_available_opening_balance NUMERIC(18, 0) := 0;
BEGIN
    -- 1. Parameter Validation
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
    IF v_origin NOT IN ('INVOICE', 'PARTNER_CREDIT', 'OPENING_BALANCE') THEN
        RAISE EXCEPTION 'ERR_INVALID_ORIGIN_TYPE: منشأ دفترچه اقساط نامعتبر است.';
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

    -- 4. Idempotency Check & Fingerprint Guard
    IF p_op_key IS NOT NULL AND trim(p_op_key) <> '' THEN
        SELECT * INTO v_existing_op
        FROM public.voucher_operation_keys
        WHERE organization_id = p_org_id AND operation_key = p_op_key;

        IF FOUND THEN
            -- Check if same request
            SELECT id, status INTO v_existing_book
            FROM public.installment_books
            WHERE organization_id = p_org_id AND id = v_existing_op.target_voucher_id;

            IF NOT FOUND THEN
                SELECT id, status INTO v_existing_book
                FROM public.installment_books
                WHERE organization_id = p_org_id 
                  AND person_id = p_person_id
                  AND total_amount = p_total_amount
                  AND installment_count = p_installment_count
                ORDER BY created_at DESC
                LIMIT 1;
            END IF;

            IF FOUND THEN
                RETURN jsonb_build_object(
                    'success', true,
                    'book_id', v_existing_book.id,
                    'status', v_existing_book.status,
                    'idempotent_replay', true,
                    'message', 'دفترچه اقساط قبلاً با این کلید عملیاتی ایجاد شده است.'
                );
            ELSE
                RAISE EXCEPTION 'ERR_OPERATION_KEY_CONFLICT: کلید عملیات تکراری با داده‌های متفاوت ارسال شده است.';
            END IF;
        END IF;
    END IF;

    -- 5. SPECIFIC ORIGIN TYPE VALIDATION & FINANCIAL RULES
    IF v_origin = 'OPENING_BALANCE' THEN
        -- Step 1: Concurrency Lock - Lock person row to prevent simultaneous allocation of same opening balance
        SELECT id INTO v_locked_person_id
        FROM public.persons
        WHERE organization_id = p_org_id AND id = p_person_id
        FOR UPDATE;

        IF v_locked_person_id IS NULL THEN
            RAISE EXCEPTION 'ERR_PERSON_INVALID: شخص انتخاب شده در سازمان یافت نشد.';
        END IF;

        -- Step 2: Resolve the exact Installment Receivables Subsidiary Account (SUB_DEBTORS_INSTALLMENT / code 1106)
        -- Must use the exact same account resolution mechanism as settle_installment_atomic.
        SELECT array_agg(id) INTO v_debtor_sub_ids
        FROM public.account_subsidiaries
        WHERE organization_id = p_org_id 
          AND is_active = true
          AND (code = '1106' OR system_key = 'SUB_DEBTORS_INSTALLMENT');

        IF v_debtor_sub_ids IS NULL OR array_length(v_debtor_sub_ids, 1) = 0 THEN
            IF EXISTS (
                SELECT 1 FROM public.account_subsidiaries
                WHERE organization_id = p_org_id
                  AND is_active = false
                  AND (code = '1106' OR system_key = 'SUB_DEBTORS_INSTALLMENT')
            ) THEN
                RAISE EXCEPTION 'ERR_ACCOUNT_INACTIVE: حساب معین بدهکاران اقساطی غیرفعال است.';
            ELSE
                RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND: حساب معین بدهکاران اقساطی فعال برای سازمان یافت نشد.';
            END IF;
        END IF;

        IF array_length(v_debtor_sub_ids, 1) > 1 THEN
            RAISE EXCEPTION 'ERR_AMBIGUOUS_ACCOUNT_MAPPING: بیش از یک حساب معین بدهکاران اقساطی فعال برای سازمان یافت شد.';
        END IF;

        v_sub_debtors_inst_id := v_debtor_sub_ids[1];

        -- Step 3: Calculate Net Opening Balance strictly on this exact installment receivables subsidiary account
        SELECT 
            COALESCE(SUM(ve.debit), 0),
            COALESCE(SUM(ve.credit), 0)
        INTO v_ob_debit_sum, v_ob_credit_sum
        FROM public.voucher_entries ve
        JOIN public.journal_vouchers jv ON ve.voucher_id = jv.id AND ve.organization_id = jv.organization_id
        WHERE ve.organization_id = p_org_id 
          AND ve.person_id = p_person_id
          AND jv.status = 'POSTED'
          AND jv.source_type = 'OPENING_BALANCE'
          AND ve.subsidiary_id = v_sub_debtors_inst_id;

        v_net_opening_balance := v_ob_debit_sum - v_ob_credit_sum;

        -- Step 4: Validate positive opening balance exists on the exact installment receivables subsidiary account
        IF v_ob_debit_sum <= 0 OR v_net_opening_balance <= 0 THEN
            RAISE EXCEPTION 'ERR_NO_VALID_OPENING_BALANCE: شخص انتخاب شده فاقد مانده افتتاحیه معتبر در حساب بدهکاران اقساطی است.';
        END IF;

        -- Step 5: Deduct Previously Allocated Total Amounts of Active Opening Balance Booklets
        SELECT COALESCE(SUM(total_amount), 0)
        INTO v_previously_allocated
        FROM public.installment_books
        WHERE organization_id = p_org_id
          AND person_id = p_person_id
          AND origin_type = 'OPENING_BALANCE'
          AND status <> 'canceled';

        v_available_opening_balance := v_net_opening_balance - v_previously_allocated;

        -- Step 6: Check Available Opening Balance against requested p_total_amount
        IF v_available_opening_balance < p_total_amount THEN
            RAISE EXCEPTION 'ERR_OPENING_BALANCE_INSUFFICIENT: مانده افتتاحیه مطالبات شخص کمتر از مبلغ کل دفترچه اقساط درخواستی است.';
        END IF;

        -- STRICT INVARIANT: OPENING_BALANCE creates ZERO journal vouchers, ZERO voucher entries, ZERO sequence consumption.
    END IF;

    -- 6. Insert Installment Book Header
    v_book_id := gen_random_uuid();

    INSERT INTO public.installment_books (
        id,
        organization_id,
        branch_id,
        person_id,
        origin_type,
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
        v_origin,
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

    -- 7. Insert Installment Line Items
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

    -- 8. Financial Voucher Generation for PARTNER_CREDIT (Independent Fee Voucher)
    IF v_origin = 'PARTNER_CREDIT' AND COALESCE(p_total_interest, 0) > 0 THEN
        -- Resolve Fiscal Year
        SELECT id INTO v_fiscal_year_id
        FROM public.fiscal_years
        WHERE organization_id = p_org_id AND is_closed = false
        ORDER BY end_date DESC
        LIMIT 1;

        IF v_fiscal_year_id IS NOT NULL THEN
            -- Debit: SUB_DEBTORS_INSTALLMENT
            SELECT id INTO v_sub_debtors_inst_id
            FROM public.account_subsidiaries
            WHERE organization_id = p_org_id AND (code = '1106' OR system_key = 'SUB_DEBTORS_INSTALLMENT' OR system_key = 'SUB_DEBTORS')
            LIMIT 1;

            -- Credit: SUB_COMMISSION_REV
            SELECT id INTO v_sub_commission_rev_id
            FROM public.account_subsidiaries
            WHERE organization_id = p_org_id AND (code = '4102' OR system_key = 'SUB_COMMISSION_REV')
            LIMIT 1;

            IF v_sub_debtors_inst_id IS NOT NULL AND v_sub_commission_rev_id IS NOT NULL THEN
                -- Reserve sequence number
                INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
                VALUES (p_org_id, v_fiscal_year_id, 1, p_user_id)
                ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

                SELECT next_number INTO v_fee_voucher_num
                FROM public.voucher_sequences
                WHERE organization_id = p_org_id AND fiscal_year_id = v_fiscal_year_id
                FOR UPDATE;

                UPDATE public.voucher_sequences
                SET next_number = next_number + 1, updated_by = p_user_id, updated_at = now()
                WHERE organization_id = p_org_id AND fiscal_year_id = v_fiscal_year_id;

                v_fee_voucher_id := gen_random_uuid();

                -- Voucher Header
                INSERT INTO public.journal_vouchers (
                    id, organization_id, branch_id, fiscal_year_id, voucher_number,
                    voucher_date, description, status, voucher_kind, is_automatic,
                    source_type, source_id, source_event_key, created_by, posted_by,
                    posted_at, created_at, updated_at
                ) VALUES (
                    v_fee_voucher_id, p_org_id, v_branch_id, v_fiscal_year_id, v_fee_voucher_num,
                    CURRENT_DATE, 'سند کارمزد دفترچه اقساط نماینده اعتباری', 'POSTED', 'GENERAL', true,
                    'INSTALLMENT_FEE', v_book_id::text, p_op_key, p_user_id, p_user_id,
                    now(), now(), now()
                );

                -- Entry 1: Debit Debtors Installments
                INSERT INTO public.voucher_entries (
                    organization_id, voucher_id, row_number, subsidiary_id, person_id,
                    debit, credit, description
                ) VALUES (
                    p_org_id, v_fee_voucher_id, 1, v_sub_debtors_inst_id, p_person_id,
                    p_total_interest, 0, 'درآمد حاصل از کارمزد اقساط اعتباری'
                );

                -- Entry 2: Credit Commission Revenue
                INSERT INTO public.voucher_entries (
                    organization_id, voucher_id, row_number, subsidiary_id, person_id,
                    debit, credit, description
                ) VALUES (
                    p_org_id, v_fee_voucher_id, 2, v_sub_commission_rev_id, NULL,
                    0, p_total_interest, 'درآمد کارمزد تسهیلات اعتباری'
                );
            END IF;
        END IF;
    END IF;

    -- 9. Register Operation Key
    IF p_op_key IS NOT NULL AND trim(p_op_key) <> '' THEN
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
            'CREATE_INSTALLMENT_BOOK',
            p_op_key,
            v_book_id,
            COALESCE(v_fee_voucher_id, v_book_id),
            p_user_id,
            now()
        ) ON CONFLICT (organization_id, operation_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'book_id', v_book_id,
        'origin_type', v_origin,
        'installment_count', v_count,
        'total_amount', p_total_amount,
        'fee_voucher_id', v_fee_voucher_id,
        'message', 'دفترچه اقساط با موفقیت ثبت شد.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_installment_book_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INT, TEXT, INT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_installment_book_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INT, TEXT, INT, JSONB, TEXT) TO authenticated, service_role;

COMMIT;
