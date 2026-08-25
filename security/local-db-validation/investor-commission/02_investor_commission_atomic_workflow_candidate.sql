-- فقط برای اعتبارسنجی در پایگاه‌داده محلی دورریختنی — اجرای عملیاتی ممنوع
-- LOCAL DISPOSABLE DATABASE VALIDATION ONLY — NEVER RUN AGAINST REMOTE OR PRODUCTION
-- ==============================================================================
-- Candidate Workflow: 02_investor_commission_atomic_workflow_candidate.sql
-- Description: Unexecuted candidate for atomic investor commission cheque reclassification
--              and corrected clearance realization workflow (Phase 25-A Final Control).
-- Dependencies:
--   - security/local-db-validation/investor-commission/01_investor_relational_foundation_candidate.sql
--   - supabase/migrations/04_chart_of_accounts.sql
--   - supabase/migrations/05_journal_vouchers.sql
--   - supabase/migrations/19_cheques_foundation.sql
--   - supabase/migrations/21_cheque_atomic_transition.sql
-- Rules:
--   1. LOCAL DISPOSABLE DATABASE VALIDATION ONLY — NEVER RUN AGAINST REMOTE OR PRODUCTION.
--   2. SET search_path = '' strictly enforced on both functions. All objects schema-qualified.
--   3. Absolute removal of hardcoded bank codes and bank title/name guessing.
--   4. Validation of p_bank_sub_id against public.org_bank_account_mappings.
--   5. Explicit status value 'POSTED' matching journal_vouchers schema constraint.
--   6. Correct system function schema pg_catalog.gen_random_uuid().
--   7. Strict 1-active-mapping rule (status = 'CURRENT') and active account check.
--   8. Invalid allocation halts with ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION; no fallback.
--   9. Realized allocation replay control with mutation key check.
--  10. Initial voucher exact single debit entry validation.
--  11. Functions configured with SECURITY DEFINER.
--  12. Execution REVOKED from PUBLIC, anon, authenticated; GRANTED exclusively to service_role.
-- ==============================================================================

-- ==============================================================================
-- 1. ATOMIC RECLASSIFICATION FUNCTION (تابع بازطبقات‌بندی اتمیک چک کارمزد)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.reclassify_investor_commission_cheque_atomic(
    p_organization_id UUID,
    p_cheque_id UUID,
    p_obligation_id UUID,
    p_expected_version INT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT,
    p_performed_by TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing_mut RECORD;
    v_cheque RECORD;
    v_obligation RECORD;
    v_profile RECORD;
    v_initial_voucher RECORD;
    v_person_entry RECORD;
    v_user_uuid UUID;
    v_person_sub_id UUID;
    v_deferred_fee_sub_id UUID;
    v_reclass_voucher_id UUID;
    v_allocation_id UUID;
    v_history_id UUID;
    v_mutation_id UUID;
    v_voucher_number INT;
    v_fy_id UUID;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_today DATE := CURRENT_DATE;
    v_result JSONB;
    v_mapping_count INT;
    v_entry_count INT;
BEGIN
    -- 0. Resolve & Validate User UUID & Active Organization Membership
    IF p_performed_by IS NULL OR p_performed_by !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RAISE EXCEPTION 'ERR_USER_INVALID: Invalid UUID format for p_performed_by.';
    END IF;

    v_user_uuid := p_performed_by::UUID;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_organization_id AND user_id = v_user_uuid AND is_active = true
    ) THEN
        RAISE EXCEPTION 'ERR_USER_NOT_IN_ORG: User % is not an active member of organization %.', p_performed_by, p_organization_id;
    END IF;

    -- 1. Check Idempotency in cheque_mutations
    SELECT * INTO v_existing_mut
    FROM public.cheque_mutations
    WHERE organization_id = p_organization_id AND mutation_key = p_operation_key;

    IF FOUND THEN
        IF v_existing_mut.request_fingerprint = p_request_fingerprint THEN
            SELECT pg_catalog.jsonb_build_object(
                'cheque_id', cheque_id,
                'mutation_key', mutation_key,
                'version', version_after,
                'idempotent_replay', true
            ) INTO v_result
            FROM public.cheque_mutations
            WHERE id = v_existing_mut.id;
            RETURN v_result;
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Mutation key already exists with a different request fingerprint.';
        END IF;
    END IF;

    -- 2. Lock Cheque and Obligation Rows with FOR UPDATE in fixed order to prevent deadlocks
    IF p_cheque_id < p_obligation_id THEN
        SELECT * INTO v_cheque
        FROM public.cheques
        WHERE id = p_cheque_id AND organization_id = p_organization_id
        FOR UPDATE;

        SELECT * INTO v_obligation
        FROM public.investor_payment_obligations
        WHERE id = p_obligation_id AND organization_id = p_organization_id
        FOR UPDATE;
    ELSE
        SELECT * INTO v_obligation
        FROM public.investor_payment_obligations
        WHERE id = p_obligation_id AND organization_id = p_organization_id
        FOR UPDATE;

        SELECT * INTO v_cheque
        FROM public.cheques
        WHERE id = p_cheque_id AND organization_id = p_organization_id
        FOR UPDATE;
    END IF;

    -- 3. Validate Cheque Existence, State, and Branch
    IF v_cheque.id IS NULL THEN
        RAISE EXCEPTION 'ERR_CHEQUE_NOT_FOUND: Cheque not found or does not belong to organization.';
    END IF;

    IF v_cheque.branch_id IS NULL THEN
        RAISE EXCEPTION 'ERR_BRANCH_INVALID: Cheque % has NULL branch_id.', p_cheque_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE organization_id = p_organization_id AND id = v_cheque.branch_id AND is_active = true
    ) THEN
        RAISE EXCEPTION 'ERR_BRANCH_INVALID: Branch % is inactive or does not belong to organization %.', v_cheque.branch_id, p_organization_id;
    END IF;

    IF v_cheque.cheque_type <> 'paid' THEN
        RAISE EXCEPTION 'ERR_INVALID_CHEQUE_TYPE: Only paid cheques can be reclassified as commission cheques.';
    END IF;

    IF v_cheque.current_state <> 'issued' THEN
        RAISE EXCEPTION 'ERR_INVALID_CHEQUE_STATE: Cheque must be in issued state for commission reclassification.';
    END IF;

    IF v_cheque.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_STALE_VERSION: Cheque version mismatch. Expected %, got %.', p_expected_version, v_cheque.version;
    END IF;

    -- Check if cheque is already allocated
    IF EXISTS (
        SELECT 1 FROM public.investor_commission_cheque_allocations
        WHERE cheque_id = p_cheque_id
    ) THEN
        RAISE EXCEPTION 'ERR_CHEQUE_ALREADY_ALLOCATED: Cheque has already been allocated to a commission obligation.';
    END IF;

    -- 4. Validate Obligation
    IF v_obligation.id IS NULL THEN
        RAISE EXCEPTION 'ERR_OBLIGATION_NOT_FOUND: Obligation not found or does not belong to organization.';
    END IF;

    IF v_obligation.obligation_type <> 'FEE' THEN
        RAISE EXCEPTION 'ERR_INVALID_OBLIGATION_TYPE: Obligation type must be FEE for commission allocation.';
    END IF;

    IF v_obligation.status IN ('PAID', 'CANCELLED') THEN
        RAISE EXCEPTION 'ERR_OBLIGATION_INACTIVE: Obligation is already paid or cancelled.';
    END IF;

    -- Check if obligation is already allocated
    IF EXISTS (
        SELECT 1 FROM public.investor_commission_cheque_allocations
        WHERE obligation_id = p_obligation_id
    ) THEN
        RAISE EXCEPTION 'ERR_OBLIGATION_ALREADY_ALLOCATED: Obligation has already been allocated to another cheque.';
    END IF;

    -- Amount Exact Match Check
    IF v_obligation.amount <> v_cheque.amount THEN
        RAISE EXCEPTION 'ERR_AMOUNT_MISMATCH: Cheque amount (%) does not match obligation fee amount (%).', v_cheque.amount, v_obligation.amount;
    END IF;

    -- 5. Extract Investor Identity & Verify Profile Link
    SELECT * INTO v_profile
    FROM public.investor_profiles
    WHERE organization_id = p_organization_id AND person_id = v_obligation.investor_person_id;

    IF v_profile.id IS NULL THEN
        RAISE EXCEPTION 'ERR_NOT_AN_INVESTOR: Person % is not registered as an investor profile.', v_obligation.investor_person_id;
    END IF;

    -- 6. Full Validation of Initial Voucher on Cheque
    IF v_cheque.journal_voucher_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INITIAL_VOUCHER_NULL: Cannot reclassify cheque because journal_voucher_id is NULL.';
    END IF;

    SELECT * INTO v_initial_voucher
    FROM public.journal_vouchers
    WHERE id = v_cheque.journal_voucher_id AND organization_id = p_organization_id AND status = 'POSTED';

    IF v_initial_voucher.id IS NULL THEN
        RAISE EXCEPTION 'ERR_INITIAL_VOUCHER_INVALID: Initial posted journal voucher not found for cheque.';
    END IF;

    -- 7. Extract Exact Single Person Debit Entry from Initial Voucher (Strict Validation)
    SELECT pg_catalog.count(*) INTO v_entry_count
    FROM public.voucher_entries
    WHERE organization_id = p_organization_id
      AND voucher_id = v_initial_voucher.id
      AND person_id = v_obligation.investor_person_id
      AND debit = v_cheque.amount
      AND credit = 0;

    IF v_entry_count <> 1 THEN
        RAISE EXCEPTION 'ERR_INITIAL_VOUCHER_ENTRY_AMBIGUOUS: Expected exactly 1 matching debit entry for investor person % and amount % on voucher %, found %.',
            v_obligation.investor_person_id, v_cheque.amount, v_initial_voucher.id, v_entry_count;
    END IF;

    SELECT * INTO v_person_entry
    FROM public.voucher_entries
    WHERE organization_id = p_organization_id
      AND voucher_id = v_initial_voucher.id
      AND person_id = v_obligation.investor_person_id
      AND debit = v_cheque.amount
      AND credit = 0;

    v_person_sub_id := v_person_entry.subsidiary_id;

    -- 8. Extract ROLE_DEFERRED_FEE with Strict Single Active Mapping Rule (No fallback codes)
    SELECT pg_catalog.count(*) INTO v_mapping_count
    FROM public.org_financial_role_mappings
    WHERE organization_id = p_organization_id
      AND role_code = 'ROLE_DEFERRED_FEE'
      AND status = 'CURRENT';

    IF v_mapping_count <> 1 THEN
        RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Role ROLE_DEFERRED_FEE must have exactly 1 CURRENT status mapping in organization %, found %.',
            p_organization_id, v_mapping_count;
    END IF;

    SELECT subsidiary_id INTO v_deferred_fee_sub_id
    FROM public.org_financial_role_mappings
    WHERE organization_id = p_organization_id
      AND role_code = 'ROLE_DEFERRED_FEE'
      AND status = 'CURRENT';

    -- Verify active account in account_subsidiaries
    IF NOT EXISTS (
        SELECT 1 FROM public.account_subsidiaries
        WHERE id = v_deferred_fee_sub_id AND organization_id = p_organization_id AND is_active = true
    ) THEN
        RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Subsidiary mapped to ROLE_DEFERRED_FEE is inactive or does not belong to organization.';
    END IF;

    -- 9. Validate Fiscal Year & Allocate Atomic Voucher Number via public.voucher_sequences
    v_fy_id := v_cheque.fiscal_year_id;
    IF v_fy_id IS NULL THEN
        RAISE EXCEPTION 'ERR_FISCAL_YEAR_INVALID: Cheque % has NULL fiscal_year_id.', p_cheque_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.fiscal_years
        WHERE organization_id = p_organization_id AND id = v_fy_id AND is_closed = false
    ) THEN
        RAISE EXCEPTION 'ERR_FISCAL_YEAR_NOT_OPEN: Fiscal year % is closed or does not belong to organization %.', v_fy_id, p_organization_id;
    END IF;

    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_at, updated_by)
    VALUES (p_organization_id, v_fy_id, 1, v_now, v_user_uuid)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_voucher_number
    FROM public.voucher_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fy_id
    FOR UPDATE;

    IF v_voucher_number IS NULL THEN
        RAISE EXCEPTION 'ERR_VOUCHER_SEQUENCE_FAILED: Could not acquire sequence for fiscal year %.', v_fy_id;
    END IF;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_at = v_now,
        updated_by = v_user_uuid
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fy_id;

    v_reclass_voucher_id := pg_catalog.gen_random_uuid();
    v_allocation_id := pg_catalog.gen_random_uuid();
    v_history_id := pg_catalog.gen_random_uuid();
    v_mutation_id := pg_catalog.gen_random_uuid();

    -- 10. Generate Reclassification Double-Entry Voucher
    -- Dr: Deferred Fee (ROLE_DEFERRED_FEE)
    -- Cr: Person Account (Extracted from initial voucher)
    INSERT INTO public.journal_vouchers (
        id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date,
        description, status, voucher_kind, is_automatic, source_type, source_id,
        source_event_key, version, created_by, posted_by, posted_at
    ) VALUES (
        v_reclass_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today,
        'بازطبقات‌بندی چک شماره ' || v_cheque.check_number || ' به کارمزد در انتظار تحقق سرمایه‌گذار',
        'POSTED', 'GENERAL', true, 'investor_commission_reclassification', v_cheque.id,
        p_operation_key, 1, v_user_uuid, v_user_uuid, v_now
    );

    -- Debit Row: Deferred Fee
    INSERT INTO public.voucher_entries (
        id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description
    ) VALUES (
        pg_catalog.gen_random_uuid(), p_organization_id, v_reclass_voucher_id, 1, v_deferred_fee_sub_id, v_cheque.amount, 0,
        'ثبت کارمزد در انتظار تحقق بابت بازطبقات‌بندی چک ' || v_cheque.check_number
    );

    -- Credit Row: Investor Person Account
    INSERT INTO public.voucher_entries (
        id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description
    ) VALUES (
        pg_catalog.gen_random_uuid(), p_organization_id, v_reclass_voucher_id, 2, v_person_sub_id, v_obligation.investor_person_id, 0, v_cheque.amount,
        'تصفیه حساب شخصی بابت تخصیص چک ' || v_cheque.check_number || ' به کارمزد'
    );

    -- 11. Create Relational Allocation Record
    INSERT INTO public.investor_commission_cheque_allocations (
        id, organization_id, cheque_id, obligation_id, investor_person_id,
        reclassification_voucher_id, allocation_status, classified_at, classified_by
    ) VALUES (
        v_allocation_id, p_organization_id, p_cheque_id, p_obligation_id, v_obligation.investor_person_id,
        v_reclass_voucher_id, 'PENDING_REALIZATION', v_now, v_user_uuid
    );

    -- 12. Update Cheque Version (State remains 'issued')
    UPDATE public.cheques
    SET version = version + 1,
        updated_at = v_now
    WHERE id = p_cheque_id AND organization_id = p_organization_id;

    -- 13. Append State History
    INSERT INTO public.cheque_state_history (
        id, organization_id, cheque_id, from_state, to_state, event_type,
        performed_by, performed_at, operation_key, request_fingerprint,
        journal_voucher_id, metadata
    ) VALUES (
        v_history_id, p_organization_id, p_cheque_id, 'issued', 'issued', 'COMMISSION_RECLASSIFIED',
        p_performed_by, v_now, p_operation_key, p_request_fingerprint,
        v_reclass_voucher_id,
        pg_catalog.jsonb_build_object('allocation_id', v_allocation_id, 'obligation_id', p_obligation_id, 'reclass_voucher_id', v_reclass_voucher_id)
    );

    -- 14. Record Mutation
    INSERT INTO public.cheque_mutations (
        id, organization_id, cheque_id, mutation_key, request_fingerprint,
        resulting_state, from_state, to_state, voucher_id, version_before, version_after
    ) VALUES (
        v_mutation_id, p_organization_id, p_cheque_id, p_operation_key, p_request_fingerprint,
        'issued', 'issued', 'issued', v_reclass_voucher_id, p_expected_version, p_expected_version + 1
    );

    -- 15. Return Response
    SELECT pg_catalog.jsonb_build_object(
        'cheque_id', p_cheque_id,
        'allocation_id', v_allocation_id,
        'obligation_id', p_obligation_id,
        'reclassification_voucher_id', v_reclass_voucher_id,
        'version', p_expected_version + 1,
        'status', 'COMMISSION_RECLASSIFIED_SUCCESS'
    ) INTO v_result;

    RETURN v_result;
END;
$$;


-- ==============================================================================
-- 2. REFACTORED ATOMIC CHEQUE TRANSITION FUNCTION (تابع اصلاح‌شده انتقال اتمیک چک)
-- ==============================================================================

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
    v_amount NUMERIC(18,0);
    v_person_id UUID;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_today DATE := CURRENT_DATE;
    v_user_uuid UUID;
    v_sub_bank_id UUID;
    v_sub_debtors_id UUID;
    v_sub_creditors_id UUID;
    v_sub_checks_rec_id UUID;
    v_sub_checks_transit_id UUID;
    v_sub_checks_pay_id UUID;
    v_sub_exp_fin_interest_id UUID;
    v_sub_deferred_fee_id UUID;
    
    -- Commission Allocation and Related Records
    v_allocation RECORD;
    v_obligation RECORD;
    v_reclass_voucher RECORD;
    v_is_commission_cheque BOOLEAN := false;
    v_mapping_count INT;
    v_bank_mapping_count INT;
    v_mapped_bank_id UUID;
BEGIN
    -- 0. Resolve & Validate User UUID & Active Organization Membership
    IF p_user_id IS NULL OR p_user_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RAISE EXCEPTION 'ERR_USER_INVALID: Invalid UUID format for p_user_id.';
    END IF;

    v_user_uuid := p_user_id::UUID;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_memberships
        WHERE organization_id = p_organization_id AND user_id = v_user_uuid AND is_active = true
    ) THEN
        RAISE EXCEPTION 'ERR_USER_NOT_IN_ORG: User % is not an active member of organization %.', p_user_id, p_organization_id;
    END IF;

    -- 1. Check Idempotency via (organization_id, mutation_key) FIRST before locking
    SELECT * INTO v_existing_mut
    FROM public.cheque_mutations
    WHERE organization_id = p_organization_id AND mutation_key = p_mutation_key;

    IF FOUND THEN
        IF v_existing_mut.request_fingerprint = p_request_fingerprint THEN
            SELECT pg_catalog.jsonb_build_object(
                'id', id,
                'organization_id', organization_id,
                'cheque_id', cheque_id,
                'from_state', from_state,
                'to_state', to_state,
                'version', version_after,
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

    -- 2. Lock Cheque Row with FOR UPDATE and Validate Branch
    SELECT * INTO v_cheque
    FROM public.cheques
    WHERE id = p_cheque_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF v_cheque.id IS NULL THEN
        RAISE EXCEPTION 'ERR_CHEQUE_NOT_FOUND: Cheque not found or does not belong to organization.';
    END IF;

    IF v_cheque.branch_id IS NULL THEN
        RAISE EXCEPTION 'ERR_BRANCH_INVALID: Cheque % has NULL branch_id.', p_cheque_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE organization_id = p_organization_id AND id = v_cheque.branch_id AND is_active = true
    ) THEN
        RAISE EXCEPTION 'ERR_BRANCH_INVALID: Branch % is inactive or does not belong to organization %.', v_cheque.branch_id, p_organization_id;
    END IF;

    -- 3. Verify Expected Version (Optimistic Concurrency)
    IF v_cheque.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_STALE_VERSION: Cheque version mismatch. Expected %, got %.', p_expected_version, v_cheque.version;
    END IF;

    v_from_state := v_cheque.current_state;
    v_cheque_type := v_cheque.cheque_type;
    v_person_id := v_cheque.person_id;
    v_amount := v_cheque.amount;

    -- 4. TWO-STEP Allocation Lookup and Strict Validation
    -- Step 1: Read allocation record ONLY by (organization_id, cheque_id) and lock FOR UPDATE
    SELECT * INTO v_allocation
    FROM public.investor_commission_cheque_allocations
    WHERE organization_id = p_organization_id AND cheque_id = p_cheque_id
    FOR UPDATE;

    -- Step 2: Evaluate Allocation Existence vs Validity
    IF v_allocation.id IS NULL THEN
        -- Case A: NO ALLOCATION EXISTS
        -- Cheque is NOT a commission cheque. Route through normal paid cheque transition.
        v_is_commission_cheque := false;
    ELSE
        -- Case B: ALLOCATION RECORD EXISTS
        -- Must validate EVERY condition separately. Any failure MUST raise ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION and HALT.

        -- Condition 1: Check allocation status
        IF v_allocation.allocation_status <> 'PENDING_REALIZATION' THEN
            RAISE EXCEPTION 'ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION: Allocation exists but status is % instead of PENDING_REALIZATION.', v_allocation.allocation_status;
        END IF;

        -- Condition 2: Obligation existence and organization match
        SELECT * INTO v_obligation
        FROM public.investor_payment_obligations
        WHERE id = v_allocation.obligation_id AND organization_id = p_organization_id;

        IF v_obligation.id IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION: Allocated obligation not found or does not belong to organization.';
        END IF;

        -- Condition 3: Obligation type must be FEE
        IF v_obligation.obligation_type <> 'FEE' THEN
            RAISE EXCEPTION 'ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION: Obligation type % is not FEE.', v_obligation.obligation_type;
        END IF;

        -- Condition 4: Investor person consistency across cheque, allocation, and obligation
        IF v_allocation.investor_person_id <> v_obligation.investor_person_id OR v_cheque.person_id <> v_obligation.investor_person_id THEN
            RAISE EXCEPTION 'ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION: Investor person mismatch across cheque, allocation, and obligation.';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.investor_profiles
            WHERE organization_id = p_organization_id AND person_id = v_obligation.investor_person_id
        ) THEN
            RAISE EXCEPTION 'ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION: Investor profile not found for person.';
        END IF;

        -- Condition 5 & 6 & 7: Reclassification voucher existence, org match, and POSTED status
        IF v_allocation.reclassification_voucher_id IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION: Reclassification voucher ID is NULL on allocation.';
        END IF;

        SELECT * INTO v_reclass_voucher
        FROM public.journal_vouchers
        WHERE id = v_allocation.reclassification_voucher_id AND organization_id = p_organization_id AND status = 'POSTED';

        IF v_reclass_voucher.id IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION: Reclassification voucher not found or not POSTED.';
        END IF;

        -- Condition 8: Amount exact match
        IF v_obligation.amount <> v_cheque.amount THEN
            RAISE EXCEPTION 'ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION: Obligation fee amount (%) does not match cheque amount (%).', v_obligation.amount, v_cheque.amount;
        END IF;

        -- All conditions passed: Valid Commission Cheque
        v_is_commission_cheque := true;
    END IF;

    -- 5. Fetch Standard Role Mappings with Strict 1-Active-Mapping Rule & Active Account Validation
    -- Debtors (ROLE_DEBTORS)
    SELECT pg_catalog.count(*) INTO v_mapping_count FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_DEBTORS' AND status = 'CURRENT';
    IF v_mapping_count <> 1 THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Role ROLE_DEBTORS must have exactly 1 CURRENT status mapping, found %.', v_mapping_count; END IF;
    SELECT subsidiary_id INTO v_sub_debtors_id FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_DEBTORS' AND status = 'CURRENT';
    IF NOT EXISTS (SELECT 1 FROM public.account_subsidiaries WHERE id = v_sub_debtors_id AND organization_id = p_organization_id AND is_active = true) THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Subsidiary mapped to ROLE_DEBTORS is inactive or invalid.'; END IF;

    -- Creditors (ROLE_CREDITORS)
    SELECT pg_catalog.count(*) INTO v_mapping_count FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_CREDITORS' AND status = 'CURRENT';
    IF v_mapping_count <> 1 THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Role ROLE_CREDITORS must have exactly 1 CURRENT status mapping, found %.', v_mapping_count; END IF;
    SELECT subsidiary_id INTO v_sub_creditors_id FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_CREDITORS' AND status = 'CURRENT';
    IF NOT EXISTS (SELECT 1 FROM public.account_subsidiaries WHERE id = v_sub_creditors_id AND organization_id = p_organization_id AND is_active = true) THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Subsidiary mapped to ROLE_CREDITORS is inactive or invalid.'; END IF;

    -- Cheques Received (ROLE_CHECKS_REC)
    SELECT pg_catalog.count(*) INTO v_mapping_count FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_CHECKS_REC' AND status = 'CURRENT';
    IF v_mapping_count <> 1 THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Role ROLE_CHECKS_REC must have exactly 1 CURRENT status mapping, found %.', v_mapping_count; END IF;
    SELECT subsidiary_id INTO v_sub_checks_rec_id FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_CHECKS_REC' AND status = 'CURRENT';
    IF NOT EXISTS (SELECT 1 FROM public.account_subsidiaries WHERE id = v_sub_checks_rec_id AND organization_id = p_organization_id AND is_active = true) THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Subsidiary mapped to ROLE_CHECKS_REC is inactive or invalid.'; END IF;

    -- Cheques in Transit (ROLE_CHECKS_TRANSIT)
    SELECT pg_catalog.count(*) INTO v_mapping_count FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_CHECKS_TRANSIT' AND status = 'CURRENT';
    IF v_mapping_count <> 1 THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Role ROLE_CHECKS_TRANSIT must have exactly 1 CURRENT status mapping, found %.', v_mapping_count; END IF;
    SELECT subsidiary_id INTO v_sub_checks_transit_id FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_CHECKS_TRANSIT' AND status = 'CURRENT';
    IF NOT EXISTS (SELECT 1 FROM public.account_subsidiaries WHERE id = v_sub_checks_transit_id AND organization_id = p_organization_id AND is_active = true) THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Subsidiary mapped to ROLE_CHECKS_TRANSIT is inactive or invalid.'; END IF;

    -- Cheques Payable (ROLE_CHECKS_PAY)
    SELECT pg_catalog.count(*) INTO v_mapping_count FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_CHECKS_PAY' AND status = 'CURRENT';
    IF v_mapping_count <> 1 THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Role ROLE_CHECKS_PAY must have exactly 1 CURRENT status mapping, found %.', v_mapping_count; END IF;
    SELECT subsidiary_id INTO v_sub_checks_pay_id FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_CHECKS_PAY' AND status = 'CURRENT';
    IF NOT EXISTS (SELECT 1 FROM public.account_subsidiaries WHERE id = v_sub_checks_pay_id AND organization_id = p_organization_id AND is_active = true) THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Subsidiary mapped to ROLE_CHECKS_PAY is inactive or invalid.'; END IF;

    -- Deferred Fee (ROLE_DEFERRED_FEE)
    SELECT pg_catalog.count(*) INTO v_mapping_count FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_DEFERRED_FEE' AND status = 'CURRENT';
    IF v_mapping_count <> 1 THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Role ROLE_DEFERRED_FEE must have exactly 1 CURRENT status mapping, found %.', v_mapping_count; END IF;
    SELECT subsidiary_id INTO v_sub_deferred_fee_id FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_DEFERRED_FEE' AND status = 'CURRENT';
    IF NOT EXISTS (SELECT 1 FROM public.account_subsidiaries WHERE id = v_sub_deferred_fee_id AND organization_id = p_organization_id AND is_active = true) THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Subsidiary mapped to ROLE_DEFERRED_FEE is inactive or invalid.'; END IF;

    -- Financial Expense (ROLE_EXP_FIN_INTEREST)
    SELECT pg_catalog.count(*) INTO v_mapping_count FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_EXP_FIN_INTEREST' AND status = 'CURRENT';
    IF v_mapping_count <> 1 THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Role ROLE_EXP_FIN_INTEREST must have exactly 1 CURRENT status mapping, found %.', v_mapping_count; END IF;
    SELECT subsidiary_id INTO v_sub_exp_fin_interest_id FROM public.org_financial_role_mappings WHERE organization_id = p_organization_id AND role_code = 'ROLE_EXP_FIN_INTEREST' AND status = 'CURRENT';
    IF NOT EXISTS (SELECT 1 FROM public.account_subsidiaries WHERE id = v_sub_exp_fin_interest_id AND organization_id = p_organization_id AND is_active = true) THEN RAISE EXCEPTION 'ERR_ROLE_MAPPING_INVALID: Subsidiary mapped to ROLE_EXP_FIN_INTEREST is inactive or invalid.'; END IF;

    -- 6. Validate Bank Account via Relational Registry (public.org_bank_account_mappings)
    -- Multi-bank supported without hardcoded codes, bank title guessing, or mandatory ROLE_BANK_MAIN equality.
    IF p_to_state IN ('cleared', 'deposited_to_bank') THEN
        -- Requirement 1 & 5: p_bank_sub_id is mandatory for bank transitions (no automatic fallback to default bank)
        IF p_bank_sub_id IS NULL OR pg_catalog.length(pg_catalog.trim(p_bank_sub_id)) = 0 THEN
            RAISE EXCEPTION 'ERR_BANK_ACCOUNT_NOT_REGISTERED: Bank subsidiary parameter p_bank_sub_id is required for % transition.', p_to_state;
        END IF;

        IF NOT (p_bank_sub_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
            RAISE EXCEPTION 'ERR_BANK_ACCOUNT_INVALID: Invalid UUID format for p_bank_sub_id.';
        END IF;

        -- Requirement 2, 3, 4: Validate against public.org_bank_account_mappings & public.account_subsidiaries
        SELECT m.account_subsidiary_id INTO v_sub_bank_id
        FROM public.org_bank_account_mappings m
        JOIN public.account_subsidiaries s ON s.organization_id = m.organization_id AND s.id = m.account_subsidiary_id
        WHERE m.organization_id = p_organization_id
          AND m.account_subsidiary_id = p_bank_sub_id::UUID
          AND m.is_active = true
          AND s.is_active = true;

        IF v_sub_bank_id IS NULL THEN
            RAISE EXCEPTION 'ERR_BANK_ACCOUNT_NOT_REGISTERED: Specified bank subsidiary % is not registered or active as an authorized bank account for organization %.', p_bank_sub_id, p_organization_id;
        END IF;
    END IF;

    -- 7. Validate Allowed Transitions
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

    -- 8. Validate Fiscal Year & Allocate Atomic Voucher Number via public.voucher_sequences
    v_fy_id := pg_catalog.coalesce(p_fiscal_year_id, v_cheque.fiscal_year_id);
    IF v_fy_id IS NULL THEN
        RAISE EXCEPTION 'ERR_FISCAL_YEAR_INVALID: Fiscal year is not specified or NULL on cheque.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.fiscal_years
        WHERE organization_id = p_organization_id AND id = v_fy_id AND is_closed = false
    ) THEN
        RAISE EXCEPTION 'ERR_FISCAL_YEAR_NOT_OPEN: Fiscal year % is closed or does not belong to organization %.', v_fy_id, p_organization_id;
    END IF;

    v_voucher_id := pg_catalog.gen_random_uuid();
    v_history_id := pg_catalog.gen_random_uuid();
    v_mutation_id := pg_catalog.gen_random_uuid();

    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_at, updated_by)
    VALUES (p_organization_id, v_fy_id, 1, v_now, v_user_uuid)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_voucher_number
    FROM public.voucher_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fy_id
    FOR UPDATE;

    IF v_voucher_number IS NULL THEN
        RAISE EXCEPTION 'ERR_VOUCHER_SEQUENCE_FAILED: Could not acquire sequence for fiscal year %.', v_fy_id;
    END IF;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_at = v_now,
        updated_by = v_user_uuid
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fy_id;

    -- 9. Process Transition & Double-Entry Journal Vouchers
    IF v_cheque_type = 'received' THEN
        IF p_to_state = 'deposited_to_bank' THEN
            INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
            VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, pg_catalog.coalesce(p_description, 'واگذاری چک شماره ' || v_cheque.check_number || ' به بانک'), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_transit_id, v_amount, 0, 'واگذاری چک شماره ' || v_cheque.check_number || ' به بانک');

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_checks_rec_id, 0, v_amount, 'خروج چک شماره ' || v_cheque.check_number || ' از صندوق');

        ELSIF p_to_state = 'cleared' THEN
            DECLARE
                v_cred_sub UUID := CASE WHEN v_from_state = 'deposited_to_bank' THEN v_sub_checks_transit_id ELSE v_sub_checks_rec_id END;
            BEGIN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, pg_catalog.coalesce(p_description, 'وصول چک شماره ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_bank_id, v_amount, 0, 'وصول چک شماره ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_cred_sub, 0, v_amount, 'تسویه اسناد دریافتنی چک ' || v_cheque.check_number);
            END;

        ELSIF p_to_state = 'passed_to_others' THEN
            DECLARE
                v_target_person UUID := pg_catalog.coalesce(p_endorsed_person_id, v_person_id);
            BEGIN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, pg_catalog.coalesce(p_description, 'خرج چک ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_creditors_id, v_target_person, v_amount, 0, 'خرج چک ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_checks_rec_id, 0, v_amount, 'خروج چک ' || v_cheque.check_number || ' از صندوق');
            END;

        ELSIF v_from_state = 'passed_to_others' AND p_to_state = 'present_in_cashbox' THEN
            DECLARE
                v_target_person UUID := pg_catalog.coalesce(p_endorsed_person_id, v_person_id);
            BEGIN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, pg_catalog.coalesce(p_description, 'برگشت چک خرج‌شده ' || v_cheque.check_number || ' به صندوق'), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_rec_id, v_amount, 0, 'برگشت چک خرج‌شده ' || v_cheque.check_number || ' به صندوق');

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_creditors_id, v_target_person, 0, v_amount, 'بستانکار شدن مجدد تامین‌کننده بابت برگشت چک خرج‌شده');
            END;

        ELSIF p_to_state = 'bounced' THEN
            IF v_from_state = 'passed_to_others' THEN
                DECLARE
                    v_target_person UUID := pg_catalog.coalesce(p_endorsed_person_id, v_person_id);
                BEGIN
                    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                    VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, pg_catalog.coalesce(p_description, 'برگشت چک خرج‌شده ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

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
                    VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, pg_catalog.coalesce(p_description, 'برگشت چک ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                    VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_debtors_id, v_person_id, v_amount, 0, 'برگشت چک ' || v_cheque.check_number);

                    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                    VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_cred_sub, 0, v_amount, 'کسر از حساب اسناد دریافتنی/جریان وصول بابت برگشت چک');
                END;
            END IF;

        ELSIF v_from_state = 'bounced' AND p_to_state = 'cleared' THEN
            INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
            VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, pg_catalog.coalesce(p_description, 'وصول چک برگشتی شماره ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_bank_id, v_amount, 0, 'واریز به حساب بابت وصول چک برگشتی');

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_debtors_id, v_person_id, 0, v_amount, 'تسویه بدهی مشتری بابت وصول چک برگشتی');
        END IF;

    ELSIF v_cheque_type = 'paid' THEN
        IF p_to_state = 'cleared' THEN
            IF NOT v_is_commission_cheque THEN
                -- Standard Paid Cheque Clearance (Non-commission cheque)
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, pg_catalog.coalesce(p_description, 'پاس شدن چک پرداختنی ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'پاس شدن چک ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_bank_id, 0, v_amount, 'کسر از بانک بابت پاس شدن چک ' || v_cheque.check_number);

            ELSE
                -- Verified Investor Commission Cheque Clearance (Realization of Fee)
                -- Balanced 4-row journal voucher for fee realization & clearance
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, pg_catalog.coalesce(p_description, 'پاس شدن چک کارمزد سرمایه‌گذار و تحقق واقعی هزینه ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                -- Row 1: Dr ROLE_CHECKS_PAY
                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'تسویه اسناد پرداختنی بابت پاس شدن چک کارمزد ' || v_cheque.check_number);

                -- Row 2: Cr Bank
                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_bank_id, 0, v_amount, 'کسر از بانک بابت پاس شدن چک کارمزد ' || v_cheque.check_number);

                -- Row 3: Dr ROLE_EXP_FIN_INTEREST (Realized Financial Expense)
                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 3, v_sub_exp_fin_interest_id, v_amount, 0, 'تحقق واقعی هزینه کارمزد سرمایه‌گذاری بابت پاس شدن چک ' || v_cheque.check_number);

                -- Row 4: Cr ROLE_DEFERRED_FEE (Settlement of Deferred Fee)
                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 4, v_sub_deferred_fee_id, 0, v_amount, 'تسویه کارمزد در انتظار تحقق بابت تحقق هزینه چک ' || v_cheque.check_number);

                -- Update Allocation Status to REALIZED
                UPDATE public.investor_commission_cheque_allocations
                SET allocation_status = 'REALIZED',
                    realized_at = v_now,
                    realized_by = v_user_uuid,
                    realization_voucher_id = v_voucher_id,
                    updated_at = v_now
                WHERE id = v_allocation.id AND organization_id = p_organization_id;

                -- Update Obligation Status to PAID ONLY after successful voucher and clearance
                UPDATE public.investor_payment_obligations
                SET status = 'PAID',
                    updated_at = v_now
                WHERE id = v_allocation.obligation_id AND organization_id = p_organization_id;

            END IF;

        ELSIF p_to_state = 'bounced' THEN
            -- Unchanged bounce behavior
            INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
            VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, pg_catalog.coalesce(p_description, 'ابطال چک پرداختنی ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'ابطال تعهد اسناد پرداختنی چک ' || v_cheque.check_number);

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
            VALUES (pg_catalog.gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_creditors_id, v_person_id, 0, v_amount, 'بستانکار شدن مجدد طرف حساب بابت برگشت چک ' || v_cheque.check_number);
        END IF;
    END IF;

    -- 10. Update Cheque State and Version
    UPDATE public.cheques
    SET current_state = p_to_state,
        version = version + 1,
        updated_at = v_now
    WHERE id = p_cheque_id AND organization_id = p_organization_id;

    -- 11. Append to State History
    INSERT INTO public.cheque_state_history (
        id, organization_id, cheque_id, from_state, to_state, event_type,
        journal_voucher_id, performed_by, operation_key, request_fingerprint, metadata
    ) VALUES (
        v_history_id, p_organization_id, p_cheque_id, v_from_state, p_to_state, pg_catalog.upper(p_to_state),
        v_voucher_id, p_user_id, p_mutation_key, p_request_fingerprint,
        pg_catalog.jsonb_build_object('amount', v_amount, 'check_number', v_cheque.check_number, 'voucher_number', v_voucher_number)
    );

    -- 12. Persist Mutation
    INSERT INTO public.cheque_mutations (
        id, organization_id, cheque_id, mutation_key, request_fingerprint,
        from_state, to_state, voucher_id, version_before, version_after
    ) VALUES (
        v_mutation_id, p_organization_id, p_cheque_id, p_mutation_key, p_request_fingerprint,
        v_from_state, p_to_state, v_voucher_id, p_expected_version, p_expected_version + 1
    );

    -- 13. Build Response JSON
    SELECT pg_catalog.jsonb_build_object(
        'id', p_cheque_id,
        'organization_id', p_organization_id,
        'from_state', v_from_state,
        'to_state', p_to_state,
        'version', p_expected_version + 1,
        'voucher_id', v_voucher_id,
        'voucher_number', v_voucher_number,
        'mutation_key', p_mutation_key
    ) INTO v_result;

    RETURN v_result;
END;
$$;


-- ==============================================================================
-- 3. PERMISSIONS AND GRANTS (دسترس‌پذیری و اختیارات امنیتی)
-- ==============================================================================

REVOKE ALL ON FUNCTION public.reclassify_investor_commission_cheque_atomic(UUID, UUID, UUID, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclassify_investor_commission_cheque_atomic(UUID, UUID, UUID, INT, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.transition_cheque_atomic(UUID, TEXT, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_cheque_atomic(UUID, TEXT, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO service_role;
