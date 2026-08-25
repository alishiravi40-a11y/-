-- DRAFT ONLY — NOT A MIGRATION — DO NOT EXECUTE

BEGIN;

DO $draft_execution_guard$
BEGIN
  RAISE EXCEPTION 'DRAFT ONLY: this SQL file must not be executed or applied as a migration';
END
$draft_execution_guard$;

-- ==============================================================================
-- SECTION 1: REMOVE UNSECURE RLS POLICIES
-- ==============================================================================

DROP POLICY IF EXISTS "Enable all access for authenticated users on cheques" ON public.cheques;
DROP POLICY IF EXISTS "Enable all access for authenticated users on order_invoice_conversions" ON public.order_invoice_conversions;

-- ==============================================================================
-- SECTION 2: REVOKE UNSECURE PUBLIC AND DIRECT CLIENT ACCESS
-- ==============================================================================

REVOKE ALL ON public.cheques FROM public, anon, authenticated;
REVOKE ALL ON public.order_invoice_conversions FROM public, anon, authenticated;

-- ==============================================================================
-- SECTION 3: HARDEN THE SEVEN SECURITY DEFINER FUNCTIONS
-- ==============================================================================

-- 1. get_next_invoice_number
CREATE OR REPLACE FUNCTION public.get_next_invoice_number(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_next_val INT;
BEGIN
    INSERT INTO public.invoice_sequences (organization_id, next_invoice_number, updated_at)
    VALUES (p_org_id, 1, pg_catalog.now())
    ON CONFLICT (organization_id) DO UPDATE
    SET next_invoice_number = public.invoice_sequences.next_invoice_number + 1,
        updated_at = pg_catalog.now()
    RETURNING next_invoice_number INTO v_next_val;

    PERFORM 1 FROM public.invoice_sequences WHERE organization_id = p_org_id FOR UPDATE;

    RETURN v_next_val;
END;
$$;

-- 2. create_cheque_atomic
CREATE OR REPLACE FUNCTION public.create_cheque_atomic(
    p_organization_id UUID,
    p_branch_id UUID,
    p_fiscal_year_id UUID,
    p_cheque_type TEXT,
    p_current_state TEXT,
    p_person_id UUID,
    p_invoice_id UUID,
    p_installment_book_id UUID,
    p_investor_id UUID,
    p_check_number TEXT,
    p_sayadi_identifier TEXT,
    p_amount NUMERIC(18, 0),
    p_bank_name TEXT,
    p_branch_name TEXT,
    p_account_number TEXT,
    p_issue_date TEXT,
    p_due_date TEXT,
    p_received_date TEXT,
    p_clearance_date TEXT,
    p_return_date TEXT,
    p_description TEXT,
    p_created_by TEXT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT,
    p_legacy_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing RECORD;
    v_new_cheque RECORD;
    v_history_id UUID;
    v_result JSONB;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_AMOUNT: Cheque amount must be greater than zero.';
    END IF;

    IF p_cheque_type = 'received' AND p_current_state <> 'present_in_cashbox' THEN
        RAISE EXCEPTION 'ERR_INVALID_INITIAL_STATE: Received cheque initial state must be present_in_cashbox.';
    ELSIF p_cheque_type = 'paid' AND p_current_state <> 'issued' THEN
        RAISE EXCEPTION 'ERR_INVALID_INITIAL_STATE: Paid cheque initial state must be issued.';
    ELSIF p_cheque_type NOT IN ('received', 'paid') THEN
        RAISE EXCEPTION 'ERR_INVALID_CHEQUE_TYPE: Cheque type must be received or paid.';
    END IF;

    SELECT * INTO v_existing
    FROM public.cheques
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key;

    IF FOUND THEN
        IF v_existing.request_fingerprint = p_request_fingerprint THEN
            SELECT pg_catalog.jsonb_build_object(
                'id', v_existing.id,
                'organization_id', v_existing.organization_id,
                'cheque_type', v_existing.cheque_type,
                'current_state', v_existing.current_state,
                'check_number', v_existing.check_number,
                'amount', v_existing.amount,
                'operation_key', v_existing.operation_key,
                'version', v_existing.version,
                'idempotent_replay', true
            ) INTO v_result;
            RETURN v_result;
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Operation key already exists with a different request fingerprint.';
        END IF;
    END IF;

    IF p_person_id IS NOT NULL THEN
        PERFORM 1 FROM public.persons WHERE id = p_person_id AND organization_id = p_organization_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_INVALID_PERSON: Person does not belong to organization.';
        END IF;
    END IF;

    IF p_invoice_id IS NOT NULL THEN
        PERFORM 1 FROM public.invoices WHERE id = p_invoice_id AND organization_id = p_organization_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_INVALID_INVOICE: Invoice does not belong to organization.';
        END IF;
    END IF;

    INSERT INTO public.cheques (
        organization_id,
        branch_id,
        fiscal_year_id,
        cheque_type,
        current_state,
        person_id,
        invoice_id,
        installment_book_id,
        investor_id,
        check_number,
        sayadi_identifier,
        amount,
        bank_name,
        branch_name,
        account_number,
        issue_date,
        due_date,
        received_date,
        clearance_date,
        return_date,
        description,
        created_by,
        operation_key,
        request_fingerprint,
        legacy_id,
        version
    ) VALUES (
        p_organization_id,
        p_branch_id,
        p_fiscal_year_id,
        p_cheque_type,
        p_current_state,
        p_person_id,
        p_invoice_id,
        p_installment_book_id,
        p_investor_id,
        p_check_number,
        p_sayadi_identifier,
        p_amount,
        p_bank_name,
        p_branch_name,
        p_account_number,
        p_issue_date,
        p_due_date,
        p_received_date,
        p_clearance_date,
        p_return_date,
        p_description,
        p_created_by,
        p_operation_key,
        p_request_fingerprint,
        p_legacy_id,
        1
    ) RETURNING * INTO v_new_cheque;

    INSERT INTO public.cheque_state_history (
        organization_id,
        cheque_id,
        from_state,
        to_state,
        event_type,
        performed_by,
        operation_key,
        request_fingerprint,
        metadata
    ) VALUES (
        p_organization_id,
        v_new_cheque.id,
        NULL,
        p_current_state,
        'CREATE',
        p_created_by,
        p_operation_key,
        p_request_fingerprint,
        pg_catalog.jsonb_build_object('amount', p_amount, 'check_number', p_check_number, 'cheque_type', p_cheque_type)
    ) RETURNING id INTO v_history_id;

    SELECT pg_catalog.jsonb_build_object(
        'id', v_new_cheque.id,
        'organization_id', v_new_cheque.organization_id,
        'branch_id', v_new_cheque.branch_id,
        'fiscal_year_id', v_new_cheque.fiscal_year_id,
        'cheque_type', v_new_cheque.cheque_type,
        'current_state', v_new_cheque.current_state,
        'person_id', v_new_cheque.person_id,
        'invoice_id', v_new_cheque.invoice_id,
        'installment_book_id', v_new_cheque.installment_book_id,
        'investor_id', v_new_cheque.investor_id,
        'check_number', v_new_cheque.check_number,
        'sayadi_identifier', v_new_cheque.sayadi_identifier,
        'amount', v_new_cheque.amount,
        'bank_name', v_new_cheque.bank_name,
        'branch_name', v_new_cheque.branch_name,
        'account_number', v_new_cheque.account_number,
        'issue_date', v_new_cheque.issue_date,
        'due_date', v_new_cheque.due_date,
        'received_date', v_new_cheque.received_date,
        'clearance_date', v_new_cheque.clearance_date,
        'return_date', v_new_cheque.return_date,
        'description', v_new_cheque.description,
        'created_by', v_new_cheque.created_by,
        'created_at', v_new_cheque.created_at,
        'updated_at', v_new_cheque.updated_at,
        'version', v_new_cheque.version,
        'operation_key', v_new_cheque.operation_key,
        'request_fingerprint', v_new_cheque.request_fingerprint,
        'legacy_id', v_new_cheque.legacy_id,
        'history_id', v_history_id,
        'idempotent_replay', false
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 3. transition_cheque_atomic
CREATE OR REPLACE FUNCTION public.transition_cheque_atomic(
    p_organization_id UUID,
    p_user_id TEXT,
    p_cheque_id UUID,
    p_expected_version INT,
    p_to_state TEXT,
    p_mutation_key TEXT,
    p_request_fingerprint TEXT,
    p_bank_sub_id TEXT,
    p_endorsed_person_id UUID,
    p_description TEXT,
    p_fiscal_year_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cheque RECORD;
    v_existing_mut RECORD;
    v_from_state TEXT;
    v_cheque_type TEXT;
    v_is_valid BOOLEAN := false;
    v_voucher_id UUID;
    v_voucher_number INT;
    v_fy_id UUID;
    v_history_id UUID;
    v_mutation_id UUID;
    v_result JSONB;
    v_is_investor BOOLEAN := false;
    v_person_id UUID;
    v_amount NUMERIC(18,0);
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_today DATE := pg_catalog.current_date();
    v_user_uuid UUID;
    v_sub_bank_id UUID;
    v_sub_debtors_id UUID;
    v_sub_creditors_id UUID;
    v_sub_checks_rec_id UUID;
    v_sub_checks_transit_id UUID;
    v_sub_checks_pay_id UUID;
    v_sub_exp_fin_interest_id UUID;
    v_sub_deferred_fee_id UUID;
BEGIN
    -- 0. Resolve User UUID and Account Subsidiaries
    IF p_user_id IS NOT NULL AND p_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        v_user_uuid := p_user_id::UUID;
    ELSE
        SELECT id INTO v_user_uuid FROM public.user_profiles LIMIT 1;
    END IF;

    SELECT 
        pg_catalog.max(CASE WHEN system_key = 'SUB_DEBTORS' OR code IN ('SUB_DEBTORS', '10301', '1101') THEN id END),
        pg_catalog.max(CASE WHEN system_key = 'SUB_CREDITORS' OR code IN ('SUB_CREDITORS', '20201', '2101') THEN id END),
        pg_catalog.max(CASE WHEN system_key = 'SUB_CHECKS_REC' OR code IN ('SUB_CHECKS_REC', '10401') THEN id END),
        pg_catalog.max(CASE WHEN system_key = 'SUB_CHECKS_TRANSIT' OR code IN ('SUB_CHECKS_TRANSIT', '10402') THEN id END),
        pg_catalog.max(CASE WHEN system_key = 'SUB_CHECKS_PAY' OR code IN ('SUB_CHECKS_PAY', '20101') THEN id END),
        pg_catalog.max(CASE WHEN system_key = 'SUB_EXP_FIN_INTEREST' OR code IN ('SUB_EXP_FIN_INTEREST', '70301') THEN id END),
        pg_catalog.max(CASE WHEN system_key = 'SUB_DEFERRED_FEE' OR code IN ('SUB_DEFERRED_FEE', '10603') THEN id END)
    INTO 
        v_sub_debtors_id,
        v_sub_creditors_id,
        v_sub_checks_rec_id,
        v_sub_checks_transit_id,
        v_sub_checks_pay_id,
        v_sub_exp_fin_interest_id,
        v_sub_deferred_fee_id
    FROM public.account_subsidiaries
    WHERE organization_id = p_organization_id;

    IF p_bank_sub_id IS NOT NULL AND p_bank_sub_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        v_sub_bank_id := p_bank_sub_id::UUID;
    ELSE
        SELECT id INTO v_sub_bank_id 
        FROM public.account_subsidiaries 
        WHERE organization_id = p_organization_id 
          AND (system_key = 'SUB_BANK_MELI' OR code IN ('SUB_BANK_MELI', '10201', '10202', '10203')) 
        LIMIT 1;
    END IF;

    -- 1. Check Idempotency via (organization_id, mutation_key)
    SELECT * INTO v_existing_mut
    FROM public.cheque_mutations
    WHERE organization_id = p_organization_id AND mutation_key = p_mutation_key;

    IF FOUND THEN
        IF v_existing_mut.request_fingerprint = p_request_fingerprint THEN
            -- Idempotent retry: return existing result
            SELECT pg_catalog.jsonb_build_object(
                'id', id,
                'organization_id', organization_id,
                'cheque_id', cheque_id,
                'from_state', from_state,
                'to_state', to_state,
                'version', version,
                'mutation_key', mutation_key,
                'idempotent_replay', true
            ) INTO v_result
            FROM public.cheque_mutations
            WHERE id = v_existing_mut.id;
            RETURN v_result;
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Mutation key already exists with a different request fingerprint.';
        END IF;
    END IF;

    -- 2. Lock Cheque Row with FOR UPDATE
    SELECT * INTO v_cheque
    FROM public.cheques
    WHERE id = p_cheque_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_CHEQUE_NOT_FOUND: Cheque not found or does not belong to organization.';
    END IF;

    -- 3. Verify Expected Version (Optimistic Concurrency)
    IF v_cheque.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_STALE_VERSION: Cheque version mismatch. Expected %, got %.', p_expected_version, v_cheque.version;
    END IF;

    v_from_state := v_cheque.current_state;
    v_cheque_type := v_cheque.cheque_type;
    v_person_id := v_cheque.person_id;
    v_amount := v_cheque.amount;
    v_is_investor := (v_cheque.investor_id IS NOT NULL);

    -- 4. Validate Allowed Transitions
    IF v_cheque_type = 'received' THEN
        IF v_from_state = 'present_in_cashbox' AND p_to_state IN ('deposited_to_bank', 'cleared', 'passed_to_others', 'bounced') THEN
            v_is_valid := true;
        ELSIF v_from_state = 'deposited_to_bank' AND p_to_state IN ('cleared', 'bounced') THEN
            v_is_valid := true;
        ELSIF v_from_state = 'passed_to_others' AND p_to_state IN ('present_in_cashbox', 'bounced') THEN
            v_is_valid := true;
        ELSIF v_from_state = 'bounced' AND p_to_state = 'cleared' THEN
            v_is_valid := true;
        END IF;
    ELSIF v_cheque_type = 'paid' THEN
        IF v_from_state = 'issued' AND p_to_state IN ('cleared', 'bounced') THEN
            v_is_valid := true;
        END IF;
    END IF;

    IF NOT v_is_valid THEN
        RAISE EXCEPTION 'ERR_INVALID_TRANSITION: Transition from % to % for % cheque is not allowed.', v_from_state, p_to_state, v_cheque_type;
    END IF;

    -- 5. Determine Fiscal Year & Voucher Number if financial voucher required
    v_fy_id := COALESCE(p_fiscal_year_id, v_cheque.fiscal_year_id);
    IF v_fy_id IS NULL THEN
        SELECT id INTO v_fy_id FROM public.fiscal_years WHERE organization_id = p_organization_id AND is_active = true LIMIT 1;
        IF v_fy_id IS NULL THEN
            SELECT id INTO v_fy_id FROM public.fiscal_years WHERE organization_id = p_organization_id LIMIT 1;
        END IF;
    END IF;

    v_voucher_id := pg_catalog.gen_random_uuid();
    v_history_id := pg_catalog.gen_random_uuid();
    v_mutation_id := pg_catalog.gen_random_uuid();
    v_today := pg_catalog.current_date();

    -- Get next voucher number if FY is available
    IF v_fy_id IS NOT NULL THEN
        SELECT COALESCE(pg_catalog.max(voucher_number), 0) + 1 INTO v_voucher_number
        FROM public.journal_vouchers
        WHERE organization_id = p_organization_id AND fiscal_year_id = v_fy_id;
    ELSE
        v_voucher_number := 1;
    END IF;

    -- 6. Generate Journal Voucher & Entries based on exact contract
    IF v_cheque_type = 'received' THEN
        IF p_to_state = 'deposited_to_bank' THEN
            -- Dr SUB_CHECKS_TRANSIT, Cr SUB_CHECKS_REC
            INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
            VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'واگذاری چک شماره ' || v_cheque.check_number || ' به بانک'), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_transit_id, v_amount, 0, 'واگذاری چک شماره ' || v_cheque.check_number || ' به بانک');

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_checks_rec_id, 0, v_amount, 'خروج چک شماره ' || v_cheque.check_number || ' از صندوق');

        ELSIF p_to_state = 'cleared' THEN
            DECLARE
                v_cred_sub UUID := CASE WHEN v_from_state = 'deposited_to_bank' THEN v_sub_checks_transit_id ELSE v_sub_checks_rec_id END;
            BEGIN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'وصول چک شماره ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_bank_id, v_amount, 0, 'وصول چک شماره ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_cred_sub, 0, v_amount, 'تسویه اسناد دریافتنی چک ' || v_cheque.check_number);
            END;

        ELSIF p_to_state = 'passed_to_others' THEN
            DECLARE
                v_target_person UUID := COALESCE(p_endorsed_person_id, v_person_id);
            BEGIN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'خرج چک ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_creditors_id, v_target_person, v_amount, 0, 'خرج چک ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_checks_rec_id, 0, v_amount, 'خروج چک ' || v_cheque.check_number || ' از صندوق');
            END;

        ELSIF v_from_state = 'passed_to_others' AND p_to_state = 'present_in_cashbox' THEN
            DECLARE
                v_target_person UUID := COALESCE(p_endorsed_person_id, v_person_id);
            BEGIN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'برگشت چک خرج‌شده ' || v_cheque.check_number || ' به صندوق'), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_rec_id, v_amount, 0, 'برگشت چک خرج‌شده ' || v_cheque.check_number || ' به صندوق');

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_creditors_id, v_target_person, 0, v_amount, 'بستانکار شدن مجدد تامین‌کننده بابت برگشت چک خرج‌شده');
            END;

        ELSIF p_to_state = 'bounced' THEN
            IF v_from_state = 'passed_to_others' THEN
                DECLARE
                    v_target_person UUID := COALESCE(p_endorsed_person_id, v_person_id);
                BEGIN
                    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                    VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'برگشت چک خرج‌شده ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                    VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_debtors_id, v_person_id, v_amount, 0, 'بدهکار شدن مجدد مشتری بابت برگشت چک خرج‌شده');

                    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                    VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_creditors_id, v_target_person, 0, v_amount, 'بستانکار شدن مجدد تامین‌کننده بابت برگشت چک خرج‌شده');
                END;
            ELSE
                DECLARE
                    v_cred_sub UUID := CASE WHEN v_from_state = 'deposited_to_bank' THEN v_sub_checks_transit_id ELSE v_sub_checks_rec_id END;
                BEGIN
                    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                    VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'برگشت چک ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                    VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_debtors_id, v_person_id, v_amount, 0, 'برگشت چک ' || v_cheque.check_number);

                    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                    VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_cred_sub, 0, v_amount, 'کسر از حساب اسناد دریافتنی/جریان وصول بابت برگشت چک');
                END;
            END IF;

        ELSIF v_from_state = 'bounced' AND p_to_state = 'cleared' THEN
            -- وصول چک برگشتی
            INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
            VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'وصول چک برگشتی شماره ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_bank_id, v_amount, 0, 'واریز به حساب بابت وصول چک برگشتی');

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_debtors_id, v_person_id, 0, v_amount, 'تسویه بدهی مشتری بابت وصول چک برگشتی');
        END IF;

    ELSIF v_cheque_type = 'paid' THEN
        IF p_to_state = 'cleared' THEN
            IF NOT v_is_investor THEN
                -- Dr SUB_CHECKS_PAY, Cr Bank
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'پاس شدن چک پرداختنی ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'پاس شدن چک ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_bank_id, 0, v_amount, 'کسر از بانک بابت پاس شدن چک ' || v_cheque.check_number);
            ELSE
                -- Investor commission check clearance: Two pairs (Total debit = 2 * amount, total credit = 2 * amount)
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'پاس شدن چک کارمزد سرمایه‌گذار ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                -- Pair 1: Settlement of Check Payable & Bank reduction
                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'تسویه اسناد پرداختنی بابت پاس شدن چک کارمزد ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_bank_id, 0, v_amount, 'کسر از بانک بابت پاس شدن چک کارمزد ' || v_cheque.check_number);

                -- Pair 2: Realization of financial expense & settlement of deferred fee
                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 3, v_sub_exp_fin_interest_id, v_amount, 0, 'تحقق واقعی هزینه کارمزد سرمایه‌گذاری بابت پاس شدن چک ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 4, v_sub_deferred_fee_id, 0, v_amount, 'تسویه کارمزد در انتظار تحقق بابت تحقق هزینه چک ' || v_cheque.check_number);
            END IF;

        ELSIF p_to_state = 'bounced' THEN
            IF NOT v_is_investor THEN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'ابطال چک پرداختنی ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'ابطال تعهد اسناد پرداختنی چک ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_creditors_id, v_person_id, 0, v_amount, 'بستانکار شدن مجدد طرف حساب بابت برگشت چک ' || v_cheque.check_number);
            ELSE
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'ابطال چک کارمزد سرمایه‌گذار ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'ابطال اسناد پرداختنی بابت برگشت چک کارمزد سرمایه‌گذار ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_deferred_fee_id, 0, v_amount, 'برگشت کارمزد در انتظار تحقق بابت ابطال چک');
            END IF;
        END IF;
    END IF;

    -- 7. Update Cheque State and Version
    UPDATE public.cheques
    SET current_state = p_to_state,
        version = version + 1,
        updated_at = v_now
    WHERE id = p_cheque_id AND organization_id = p_organization_id;

    -- 8. Append to State History
    INSERT INTO public.cheque_state_history (
        id,
        organization_id,
        cheque_id,
        from_state,
        to_state,
        event_type,
        journal_voucher_id,
        performed_by,
        operation_key,
        request_fingerprint,
        metadata
    ) VALUES (
        v_history_id,
        p_organization_id,
        p_cheque_id,
        v_from_state,
        p_to_state,
        pg_catalog.upper(p_to_state),
        v_voucher_id,
        p_user_id,
        p_mutation_key,
        p_request_fingerprint,
        pg_catalog.jsonb_build_object('amount', v_amount, 'check_number', v_cheque.check_number, 'voucher_number', v_voucher_number)
    );

    -- 9. Persist Mutation in cheque_mutations Ledger
    INSERT INTO public.cheque_mutations (
        id,
        organization_id,
        cheque_id,
        mutation_key,
        request_fingerprint,
        from_state,
        to_state,
        voucher_id,
        version_before,
        version_after
    ) VALUES (
        v_mutation_id,
        p_organization_id,
        p_cheque_id,
        p_mutation_key,
        p_request_fingerprint,
        v_from_state,
        p_to_state,
        v_voucher_id,
        p_expected_version,
        p_expected_version + 1
    );

    -- 10. Build Response JSON
    SELECT pg_catalog.jsonb_build_object(
        'id', p_cheque_id,
        'organization_id', p_organization_id,
        'from_state', v_from_state,
        'to_state', p_to_state,
        'version', p_expected_version + 1,
        'voucher_id', v_voucher_id,
        'voucher_number', v_voucher_number,
        'history_id', v_history_id,
        'mutation_id', v_mutation_id,
        'idempotent_replay', false
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 4. edit_cheque_atomic
CREATE OR REPLACE FUNCTION public.edit_cheque_atomic(
    p_organization_id UUID,
    p_user_id TEXT,
    p_cheque_id UUID,
    p_expected_version INTEGER,
    p_mutation_key TEXT,
    p_request_fingerprint TEXT,
    p_check_number TEXT,
    p_due_date TEXT,
    p_bank_name TEXT,
    p_person_id UUID,
    p_sayadi_identifier TEXT,
    p_branch_name TEXT,
    p_account_number TEXT,
    p_issue_date TEXT,
    p_description TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing_mutation RECORD;
    v_cheque RECORD;
    v_history_count INTEGER;
    v_user_uuid UUID;
    v_result JSONB;
BEGIN
    -- 1. Validate User
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

    -- 2. Check idempotency via (organization_id, mutation_key)
    SELECT * INTO v_existing_mutation
    FROM public.cheque_mutations
    WHERE organization_id = p_organization_id AND mutation_key = p_mutation_key;

    IF FOUND THEN
        IF v_existing_mutation.request_fingerprint = p_request_fingerprint THEN
            SELECT pg_catalog.jsonb_build_object(
                'success', true,
                'id', p_cheque_id,
                'idempotent_replay', true
            ) INTO v_result;
            RETURN v_result;
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Mutation key already exists with a different request fingerprint.';
        END IF;
    END IF;

    -- 3. Lock cheque row FOR UPDATE
    SELECT * INTO v_cheque
    FROM public.cheques
    WHERE id = p_cheque_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_CHEQUE_NOT_FOUND: Cheque not found or cross-organization access denied.';
    END IF;

    -- 4. Optimistic concurrency check
    IF v_cheque.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_STALE_VERSION: Cheque version mismatch. Expected %, got %.', p_expected_version, v_cheque.version;
    END IF;

    -- 5. Check if pre-financial fields are being changed and whether financial history exists
    IF (p_check_number IS DISTINCT FROM v_cheque.check_number) OR
       (p_due_date IS DISTINCT FROM v_cheque.due_date) OR
       (p_bank_name IS DISTINCT FROM v_cheque.bank_name) OR
       (p_person_id IS DISTINCT FROM v_cheque.person_id) THEN
        
        SELECT pg_catalog.count(*) INTO v_history_count
        FROM public.cheque_state_history
        WHERE cheque_id = p_cheque_id AND (from_state IS NOT NULL OR journal_voucher_id IS NOT NULL);

        IF v_history_count > 0 OR v_cheque.journal_voucher_id IS NOT NULL OR v_cheque.clearance_voucher_id IS NOT NULL THEN
            RAISE EXCEPTION 'ERR_FINANCIAL_HISTORY_EXISTS: Cannot modify pre-financial fields after cheque has entered financial lifecycle.';
        END IF;
    END IF;

    -- 6. Validate person_id if changed
    IF p_person_id IS NOT NULL AND p_person_id IS DISTINCT FROM v_cheque.person_id THEN
        PERFORM 1 FROM public.persons WHERE id = p_person_id AND organization_id = p_organization_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_INVALID_PERSON: Person does not belong to organization.';
        END IF;
    END IF;

    -- 7. Perform update
    UPDATE public.cheques
    SET check_number = COALESCE(p_check_number, check_number),
        due_date = COALESCE(p_due_date, due_date),
        bank_name = COALESCE(p_bank_name, bank_name),
        person_id = COALESCE(p_person_id, person_id),
        sayadi_identifier = COALESCE(p_sayadi_identifier, sayadi_identifier),
        branch_name = COALESCE(p_branch_name, branch_name),
        account_number = COALESCE(p_account_number, account_number),
        issue_date = COALESCE(p_issue_date, issue_date),
        description = COALESCE(p_description, description),
        version = version + 1,
        updated_at = pg_catalog.now()
    WHERE id = p_cheque_id
    RETURNING * INTO v_cheque;

    -- 8. Record mutation
    INSERT INTO public.cheque_mutations (
        organization_id,
        cheque_id,
        mutation_key,
        request_fingerprint,
        resulting_state,
        from_state,
        to_state,
        version_before,
        version_after
    ) VALUES (
        p_organization_id,
        p_cheque_id,
        p_mutation_key,
        p_request_fingerprint,
        v_cheque.current_state,
        v_cheque.current_state,
        v_cheque.current_state,
        v_cheque.version - 1,
        v_cheque.version
    );

    -- 9. Record state history audit
    INSERT INTO public.cheque_state_history (
        organization_id,
        cheque_id,
        from_state,
        to_state,
        event_type,
        performed_by,
        operation_key,
        request_fingerprint,
        metadata
    ) VALUES (
        p_organization_id,
        p_cheque_id,
        v_cheque.current_state,
        v_cheque.current_state,
        'EDIT',
        p_user_id,
        p_mutation_key,
        p_request_fingerprint,
        pg_catalog.jsonb_build_object('description', p_description)
    );

    SELECT pg_catalog.jsonb_build_object(
        'success', true,
        'cheque', pg_catalog.row_to_json(v_cheque)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 5. reverse_cheque_atomic
CREATE OR REPLACE FUNCTION public.reverse_cheque_atomic(
    p_organization_id UUID,
    p_user_id TEXT,
    p_cheque_id UUID,
    p_expected_version INTEGER,
    p_mutation_key TEXT,
    p_request_fingerprint TEXT,
    p_description TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing_mutation RECORD;
    v_cheque RECORD;
    v_orig_voucher RECORD;
    v_rev_voucher_id UUID;
    v_rev_fy_id UUID;
    v_voucher_number BIGINT;
    v_entry RECORD;
    v_user_uuid UUID;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_result JSONB;
BEGIN
    -- 1. Validate and resolve User ID (Fail-Closed)
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

    -- 2. Check idempotency
    SELECT * INTO v_existing_mutation
    FROM public.cheque_mutations
    WHERE organization_id = p_organization_id AND mutation_key = p_mutation_key;

    IF FOUND THEN
        IF v_existing_mutation.request_fingerprint = p_request_fingerprint THEN
            SELECT pg_catalog.jsonb_build_object(
                'success', true,
                'id', p_cheque_id,
                'idempotent_replay', true
            ) INTO v_result;
            RETURN v_result;
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Reversal mutation key already exists with different fingerprint.';
        END IF;
    END IF;

    -- 3. Lock cheque row FOR UPDATE
    SELECT * INTO v_cheque
    FROM public.cheques
    WHERE id = p_cheque_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_CHEQUE_NOT_FOUND: Cheque not found.';
    END IF;

    IF v_cheque.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_STALE_VERSION: Version mismatch. Expected %, got %.', p_expected_version, v_cheque.version;
    END IF;

    IF v_cheque.is_reversed THEN
        RAISE EXCEPTION 'ERR_ALREADY_REVERSED: Cheque is already reversed.';
    END IF;

    IF v_cheque.journal_voucher_id IS NULL AND v_cheque.clearance_voucher_id IS NULL THEN
        RAISE EXCEPTION 'ERR_NO_FINANCIAL_HISTORY: Cannot reverse a cheque with no financial transaction history.';
    END IF;

    -- 4. Find original authoritative voucher
    SELECT * INTO v_orig_voucher
    FROM public.journal_vouchers
    WHERE id = COALESCE(v_cheque.clearance_voucher_id, v_cheque.journal_voucher_id) AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_VOUCHER_NOT_FOUND: Original financial voucher not found.';
    END IF;

    -- 5. Determine and validate open Fiscal Year (Fail-Closed)
    v_rev_fy_id := v_orig_voucher.fiscal_year_id;
    IF v_rev_fy_id IS NULL THEN
        v_rev_fy_id := v_cheque.fiscal_year_id;
    END IF;

    IF v_rev_fy_id IS NOT NULL THEN
        PERFORM 1 FROM public.fiscal_years WHERE id = v_rev_fy_id AND organization_id = p_organization_id AND is_closed = false;
        IF NOT FOUND THEN
            v_rev_fy_id := NULL;
        END IF;
    END IF;

    IF v_rev_fy_id IS NULL THEN
        DECLARE
            v_fy_count INT;
        BEGIN
            SELECT pg_catalog.count(*), pg_catalog.max(id) INTO v_fy_count, v_rev_fy_id
            FROM public.fiscal_years
            WHERE organization_id = p_organization_id 
              AND is_closed = false 
              AND pg_catalog.current_date() BETWEEN start_date AND end_date;

            IF v_fy_count <> 1 OR v_rev_fy_id IS NULL THEN
                RAISE EXCEPTION 'ERR_AMBIGUOUS_OR_MISSING_FISCAL_YEAR: Cannot uniquely determine active open fiscal year for organization %.', p_organization_id;
            END IF;
        END;
    END IF;

    -- 6. Allocate sequential legal voucher number using atomic voucher_sequences
    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_rev_fy_id, 1, v_user_uuid)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_voucher_number
    FROM public.voucher_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_rev_fy_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_by = v_user_uuid,
        updated_at = v_now
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_rev_fy_id;

    -- 7. Create Reversal Journal Voucher
    v_rev_voucher_id := pg_catalog.gen_random_uuid();
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
        reversal_of_voucher_id,
        version,
        created_by,
        posted_by,
        posted_at
    ) VALUES (
        v_rev_voucher_id,
        p_organization_id,
        v_orig_voucher.branch_id,
        v_rev_fy_id,
        v_voucher_number,
        pg_catalog.current_date(),
        COALESCE(p_description, 'إبطال و اصلاح سند چک شماره ' || v_cheque.check_number),
        'POSTED',
        'REVERSAL',
        true,
        'check_reversal',
        p_cheque_id,
        v_orig_voucher.id,
        1,
        v_user_uuid,
        v_user_uuid,
        v_now
    );

    -- 8. Create Reversal Voucher Entries (swap debit and credit)
    FOR v_entry IN 
        SELECT * FROM public.voucher_entries WHERE voucher_id = v_orig_voucher.id ORDER BY row_number
    LOOP
        INSERT INTO public.voucher_entries (
            id,
            organization_id,
            voucher_id,
            row_number,
            subsidiary_id,
            person_id,
            cost_center_id,
            financial_role_code,
            debit,
            credit,
            description,
            contract_type
        ) VALUES (
            pg_catalog.gen_random_uuid(),
            p_organization_id,
            v_rev_voucher_id,
            v_entry.row_number,
            v_entry.subsidiary_id,
            v_entry.person_id,
            v_entry.cost_center_id,
            v_entry.financial_role_code,
            v_entry.credit, -- swapped
            v_entry.debit,  -- swapped
            COALESCE(p_description, 'اصلاح سند: ' || COALESCE(v_entry.description, '')),
            v_entry.contract_type
        );
    END LOOP;

    -- 9. Update Original Voucher to REVERSED status
    UPDATE public.journal_vouchers
    SET status = 'REVERSED',
        reversed_by = v_user_uuid,
        reversed_at = v_now,
        reversal_reason = COALESCE(p_description, 'ابطال سند با برگشت چک ' || v_cheque.check_number),
        updated_at = v_now
    WHERE id = v_orig_voucher.id AND organization_id = p_organization_id;

    -- 10. Update Cheque as reversed
    UPDATE public.cheques
    SET is_reversed = true,
        reversal_voucher_id = v_rev_voucher_id,
        version = version + 1,
        updated_at = v_now
    WHERE id = p_cheque_id
    RETURNING * INTO v_cheque;

    -- 11. Record mutation
    INSERT INTO public.cheque_mutations (
        organization_id,
        cheque_id,
        mutation_key,
        request_fingerprint,
        resulting_state,
        from_state,
        to_state,
        voucher_id,
        version_before,
        version_after
    ) VALUES (
        p_organization_id,
        p_cheque_id,
        p_mutation_key,
        p_request_fingerprint,
        v_cheque.current_state,
        v_cheque.current_state,
        v_cheque.current_state,
        v_rev_voucher_id,
        v_cheque.version - 1,
        v_cheque.version
    );

    -- 12. Record state history audit
    INSERT INTO public.cheque_state_history (
        organization_id,
        cheque_id,
        from_state,
        to_state,
        event_type,
        performed_by,
        operation_key,
        request_fingerprint,
        journal_voucher_id,
        metadata
    ) VALUES (
        p_organization_id,
        p_cheque_id,
        v_cheque.current_state,
        v_cheque.current_state,
        'REVERSAL',
        p_user_id,
        p_mutation_key,
        p_request_fingerprint,
        v_rev_voucher_id,
        pg_catalog.jsonb_build_object('reversal_voucher_id', v_rev_voucher_id, 'voucher_number', v_voucher_number)
    );

    SELECT pg_catalog.jsonb_build_object(
        'success', true,
        'cheque', pg_catalog.row_to_json(v_cheque),
        'reversal_voucher_id', v_rev_voucher_id,
        'voucher_number', v_voucher_number
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 6. delete_cheque_atomic
CREATE OR REPLACE FUNCTION public.delete_cheque_atomic(
    p_organization_id UUID,
    p_cheque_id UUID,
    p_expected_version INTEGER,
    p_mutation_key TEXT,
    p_request_fingerprint TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cheque RECORD;
    v_history_count INTEGER;
    v_existing_mutation RECORD;
    v_result JSONB;
BEGIN
    -- 1. Idempotency check
    SELECT * INTO v_existing_mutation
    FROM public.cheque_mutations
    WHERE organization_id = p_organization_id AND mutation_key = p_mutation_key;

    IF FOUND THEN
        IF v_existing_mutation.request_fingerprint = p_request_fingerprint THEN
            SELECT pg_catalog.jsonb_build_object('success', true, 'idempotent_replay', true) INTO v_result;
            RETURN v_result;
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Delete mutation key conflict.';
        END IF;
    END IF;

    -- 2. Lock cheque row FOR UPDATE
    SELECT * INTO v_cheque
    FROM public.cheques
    WHERE id = p_cheque_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_CHEQUE_NOT_FOUND: Cheque not found.';
    END IF;

    IF v_cheque.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_STALE_VERSION: Version mismatch. Expected %, got %.', p_expected_version, v_cheque.version;
    END IF;

    -- 3. Verify zero financial history and no cross-domain relations
    IF v_cheque.journal_voucher_id IS NOT NULL OR
       v_cheque.clearance_voucher_id IS NOT NULL OR
       v_cheque.return_voucher_id IS NOT NULL OR
       v_cheque.invoice_id IS NOT NULL OR
       v_cheque.installment_book_id IS NOT NULL OR
       v_cheque.investor_id IS NOT NULL OR
       v_cheque.is_reversed THEN
        RAISE EXCEPTION 'ERR_FINANCIAL_CHEQUE_DELETE_BLOCKED: Cannot physically delete a financially consequential or related cheque.';
    END IF;

    SELECT pg_catalog.count(*) INTO v_history_count
    FROM public.cheque_state_history
    WHERE cheque_id = p_cheque_id AND (from_state IS NOT NULL OR journal_voucher_id IS NOT NULL);

    IF v_history_count > 0 THEN
        RAISE EXCEPTION 'ERR_FINANCIAL_CHEQUE_DELETE_BLOCKED: Cheque has transition history.';
    END IF;

    -- 4. Record mutation before deletion (cheque_id will become NULL via ON DELETE SET NULL constraint)
    INSERT INTO public.cheque_mutations (
        organization_id,
        cheque_id,
        mutation_key,
        request_fingerprint,
        resulting_state,
        from_state,
        to_state,
        version_before
    ) VALUES (
        p_organization_id,
        p_cheque_id,
        p_mutation_key,
        p_request_fingerprint,
        'DELETED',
        v_cheque.current_state,
        'DELETED',
        v_cheque.version
    );

    -- 5. Perform physical delete
    DELETE FROM public.cheques WHERE id = p_cheque_id AND organization_id = p_organization_id;

    SELECT pg_catalog.jsonb_build_object('success', true, 'deleted', true) INTO v_result;
    RETURN v_result;
END;
$$;

-- 7. create_invoice_with_cheques_atomic
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
SET search_path = ''
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
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
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
    IF p_items IS NULL OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'ERR_EMPTY_ITEMS: Invoice must contain at least one item.';
    END IF;

    -- 3. Check Idempotency via (organization_id, operation_key)
    SELECT * INTO v_existing_inv
    FROM public.invoices
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key;

    IF FOUND THEN
        SELECT pg_catalog.jsonb_build_object(
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
    FOR v_item IN SELECT * FROM pg_catalog.jsonb_to_recordset(p_items) AS x(
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

        v_subtotal := v_subtotal + pg_catalog.round(v_item.quantity * COALESCE(v_item.unit_price_amount, v_item.unit_price, 0));
        v_line_discounts := v_line_discounts + pg_catalog.round(COALESCE(v_item.discount_amount, v_item.discount, 0));
    END LOOP;

    v_total_discount := v_line_discounts + v_general_discount;
    v_taxable_base := GREATEST(0, v_subtotal - v_total_discount);
    v_tax_amount := pg_catalog.round(v_taxable_base * (COALESCE(p_tax_percent, 0) / 100.0));
    v_final_amount := v_taxable_base + v_tax_amount;
    v_total_paid := v_cash_paid + v_pos_paid;

    -- 6. Calculate Cheques Total & Validate Cheques
    IF p_cheques IS NOT NULL AND pg_catalog.jsonb_array_length(p_cheques) > 0 THEN
        FOR v_cheque IN SELECT * FROM pg_catalog.jsonb_to_recordset(p_cheques) AS x(
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
        v_invoice_date := COALESCE(p_date::DATE, pg_catalog.current_date());
    EXCEPTION WHEN OTHERS THEN
        v_invoice_date := pg_catalog.current_date();
    END;

    -- 7. Allocate Sequential Invoice Number
    SELECT public.get_next_invoice_number(p_organization_id) INTO v_invoice_number;

    -- 8. Insert Invoice Header (Compliant with Migration 15 Schema)
    v_invoice_id := pg_catalog.gen_random_uuid();
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
    FOR v_item IN SELECT * FROM pg_catalog.jsonb_to_recordset(p_items) AS x(
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
            pg_catalog.gen_random_uuid(),
            p_organization_id,
            v_invoice_id,
            v_inv_item_row,
            v_item.product_id,
            v_item.warehouse_id,
            v_item.quantity,
            COALESCE(v_item.unit_price_amount, v_item.unit_price, 0),
            COALESCE(v_item.discount_amount, v_item.discount, 0),
            pg_catalog.round(v_item.quantity * COALESCE(v_item.unit_price_amount, v_item.unit_price, 0) - COALESCE(v_item.discount_amount, v_item.discount, 0)),
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
        SELECT pg_catalog.jsonb_build_object(
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
    v_voucher_id := pg_catalog.gen_random_uuid();
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
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_cash_id, v_cash_paid, 0, 'دریافت نقدی بابت فاکتور فروش شماره ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- POS Debit (mapped to cash subsidiary)
        IF v_pos_paid > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_cash_id, v_pos_paid, 0, 'دریافت پوز بابت فاکتور فروش شماره ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- Received Cheques Debit
        IF v_cheques_total > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_checks_rec_id, v_cheques_total, 0, 'دریافت اسناد (چک‌های صندوق) بابت فاکتور فروش شماره ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- Remaining AR Debit
        IF v_remaining_amount > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description, created_at)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_ar_id, p_person_id, v_remaining_amount, 0, 'فروش نسیه - فاکتور شماره ' || v_invoice_number || ' (' || COALESCE(v_person.name, '') || ')', v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- Revenue Credit
        INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
        VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_sales_id, 0, v_taxable_base, 'فروش طی فاکتور شماره ' || v_invoice_number, v_now);
        v_row_num := v_row_num + 1;

        -- VAT Sell Credit
        IF v_tax_amount > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_vat_sell_id, 0, v_tax_amount, 'مالیات ارزش افزوده فاکتور فروش ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

    ELSE
        -- BUY Invoice
        -- Inventory Debit
        INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
        VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_inventory_id, v_taxable_base, 0, 'خرید طی فاکتور شماره ' || v_invoice_number, v_now);
        v_row_num := v_row_num + 1;

        -- VAT Buy Debit
        IF v_tax_amount > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_vat_buy_id, v_tax_amount, 0, 'مالیات ارزش افزوده خرید فاکتور ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- Paid Cheques Credit
        IF v_cheques_total > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description, created_at)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_checks_pay_id, 0, v_cheques_total, 'صدور اسناد (چک‌های پرداختنی) بابت فاکتور خرید شماره ' || v_invoice_number, v_now);
            v_row_num := v_row_num + 1;
        END IF;

        -- Remaining AP Credit
        IF (v_final_amount - v_cheques_total) > 0 THEN
            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description, created_at)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, v_row_num, v_sub_ap_id, p_person_id, 0, (v_final_amount - v_cheques_total), 'خرید نسیه - فاکتور شماره ' || v_invoice_number || ' (' || COALESCE(v_person.name, '') || ')', v_now);
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
    v_inventory_tx_id := pg_catalog.gen_random_uuid();
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
    FOR v_item IN SELECT * FROM pg_catalog.jsonb_to_recordset(p_items) AS x(
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
            pg_catalog.gen_random_uuid(),
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
            pg_catalog.round(v_item.quantity * COALESCE(v_item.unit_price_amount, v_item.unit_price, 0)),
            v_now
        );
        v_row_num := v_row_num + 1;
    END LOOP;

    -- Update invoice with inventory_transaction_id
    UPDATE public.invoices SET inventory_transaction_id = v_inventory_tx_id WHERE id = v_invoice_id;

    -- 18. Create Cheques & Initial History Records (Compliant with Migration 19/20 Schema)
    IF p_cheques IS NOT NULL AND pg_catalog.jsonb_array_length(p_cheques) > 0 THEN
        FOR v_cheque IN SELECT * FROM pg_catalog.jsonb_to_recordset(p_cheques) AS x(
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
            v_cheque_id := pg_catalog.gen_random_uuid();
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
                pg_catalog.gen_random_uuid(),
                p_organization_id,
                v_cheque_id,
                NULL,
                CASE WHEN v_cheque.cheque_type = 'received' THEN 'present_in_cashbox' ELSE 'issued' END,
                'CREATE',
                p_user_id,
                p_operation_key || '_' || v_cheque.check_number,
                p_request_fingerprint,
                v_voucher_id,
                pg_catalog.jsonb_build_object('invoice_id', v_invoice_id, 'amount', v_cheque.amount, 'check_number', v_cheque.check_number),
                v_now
            );
        END LOOP;
    END IF;

    -- 19. Return Result Summary
    SELECT pg_catalog.jsonb_build_object(
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

-- ==============================================================================
-- SECTION 4: REVOKE PUBLIC PRIVILEGES & SPECIFY ROLES
-- ==============================================================================

REVOKE EXECUTE ON FUNCTION public.get_next_invoice_number(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_next_invoice_number(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_next_invoice_number(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_invoice_number(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_cheque_atomic(UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_cheque_atomic(UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_cheque_atomic(UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_cheque_atomic(UUID, UUID, UUID, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.transition_cheque_atomic(UUID, TEXT, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_cheque_atomic(UUID, TEXT, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transition_cheque_atomic(UUID, TEXT, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transition_cheque_atomic(UUID, TEXT, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.edit_cheque_atomic(UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.edit_cheque_atomic(UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.edit_cheque_atomic(UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.edit_cheque_atomic(UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reverse_cheque_atomic(UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_cheque_atomic(UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reverse_cheque_atomic(UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_cheque_atomic(UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.delete_cheque_atomic(UUID, UUID, INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_cheque_atomic(UUID, UUID, INTEGER, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_cheque_atomic(UUID, UUID, INTEGER, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cheque_atomic(UUID, UUID, INTEGER, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_invoice_with_cheques_atomic(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, UUID, JSONB, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_invoice_with_cheques_atomic(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, UUID, JSONB, JSONB, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_invoice_with_cheques_atomic(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, UUID, JSONB, JSONB, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_with_cheques_atomic(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, UUID, JSONB, JSONB, TEXT, TEXT) TO service_role;

ROLLBACK;
