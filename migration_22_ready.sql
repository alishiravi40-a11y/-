BEGIN;

-- ==============================================================================
-- Migration: 22_cheque_edit_reversal_foundation.sql
-- Description: Block 3 - PostgreSQL Cheque Edit, Financial Reversal & Zero-History Safe Delete Foundation
-- ==============================================================================

-- Add reversal and tracking columns to public.cheques if not present
ALTER TABLE public.cheques 
    ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reversal_voucher_id UUID NULL;

-- Allow mutation auditing to persist independently upon zero-history physical cheque deletion
ALTER TABLE public.cheque_mutations ALTER COLUMN cheque_id DROP NOT NULL;
ALTER TABLE public.cheque_mutations DROP CONSTRAINT IF EXISTS cheque_mutations_cheque_id_fkey;
ALTER TABLE public.cheque_mutations ADD CONSTRAINT cheque_mutations_cheque_id_fkey 
    FOREIGN KEY (cheque_id) REFERENCES public.cheques(id) ON DELETE SET NULL;

-- 1. edit_cheque_atomic
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
            SELECT jsonb_build_object(
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
        
        SELECT count(*) INTO v_history_count
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
        updated_at = now()
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
        jsonb_build_object('description', p_description)
    );

    SELECT jsonb_build_object(
        'success', true,
        'cheque', row_to_json(v_cheque)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 2. reverse_cheque_atomic
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
    v_now TIMESTAMPTZ := clock_timestamp();
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
            SELECT jsonb_build_object(
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
            SELECT count(*), max(id) INTO v_fy_count, v_rev_fy_id
            FROM public.fiscal_years
            WHERE organization_id = p_organization_id 
              AND is_closed = false 
              AND CURRENT_DATE BETWEEN start_date AND end_date;

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
    v_rev_voucher_id := gen_random_uuid();
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
        CURRENT_DATE,
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
            gen_random_uuid(),
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
        jsonb_build_object('reversal_voucher_id', v_rev_voucher_id, 'voucher_number', v_voucher_number)
    );

    SELECT jsonb_build_object(
        'success', true,
        'cheque', row_to_json(v_cheque),
        'reversal_voucher_id', v_rev_voucher_id,
        'voucher_number', v_voucher_number
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 3. delete_cheque_atomic (Zero-history safe delete)
CREATE OR REPLACE FUNCTION public.delete_cheque_atomic(
    p_organization_id UUID,
    p_cheque_id UUID,
    p_expected_version INTEGER,
    p_mutation_key TEXT,
    p_request_fingerprint TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
            SELECT jsonb_build_object('success', true, 'idempotent_replay', true) INTO v_result;
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

    SELECT count(*) INTO v_history_count
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

    SELECT jsonb_build_object('success', true, 'deleted', true) INTO v_result;
    RETURN v_result;
END;
$$;

COMMIT;
