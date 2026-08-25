BEGIN;

-- ==============================================================================
-- Migration: 20_cheque_atomic_function.sql
-- Description: Creates atomic PL/pgSQL function public.create_cheque_atomic with idempotency,
--              request fingerprint validation, and initial state history insertion.
-- ==============================================================================

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
AS $$
DECLARE
    v_existing RECORD;
    v_new_cheque RECORD;
    v_history_id UUID;
    v_result JSONB;
BEGIN
    -- 1. Validate Amount
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_AMOUNT: Cheque amount must be greater than zero.';
    END IF;

    -- 2. Validate Type & Initial State
    IF p_cheque_type = 'received' AND p_current_state <> 'present_in_cashbox' THEN
        RAISE EXCEPTION 'ERR_INVALID_INITIAL_STATE: Received cheque initial state must be present_in_cashbox.';
    ELSIF p_cheque_type = 'paid' AND p_current_state <> 'issued' THEN
        RAISE EXCEPTION 'ERR_INVALID_INITIAL_STATE: Paid cheque initial state must be issued.';
    ELSIF p_cheque_type NOT IN ('received', 'paid') THEN
        RAISE EXCEPTION 'ERR_INVALID_CHEQUE_TYPE: Cheque type must be received or paid.';
    END IF;

    -- 3. Check Idempotency via (organization_id, operation_key)
    SELECT * INTO v_existing
    FROM public.cheques
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key;

    IF FOUND THEN
        IF v_existing.request_fingerprint = p_request_fingerprint THEN
            -- Idempotent retry: return existing record
            SELECT jsonb_build_object(
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

    -- 4. Validate FK references belong to organization if provided
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

    -- 5. Insert Cheque
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

    -- 6. Insert Initial History Record
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
        jsonb_build_object('amount', p_amount, 'check_number', p_check_number, 'cheque_type', p_cheque_type)
    ) RETURNING id INTO v_history_id;

    -- 7. Build Response JSON
    SELECT jsonb_build_object(
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

COMMIT;
