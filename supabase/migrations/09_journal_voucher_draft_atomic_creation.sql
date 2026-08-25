-- ==============================================================================
-- Migration 09: Atomic Creation of Draft Journal Vouchers and Entries
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_draft_journal_voucher(
    p_organization_id UUID,
    p_branch_id UUID,
    p_fiscal_year_id UUID,
    p_voucher_date DATE,
    p_description TEXT,
    p_entries JSONB,
    p_operation_key TEXT,
    p_request_fingerprint TEXT,
    p_source_type TEXT DEFAULT NULL,
    p_source_id TEXT DEFAULT NULL,
    p_source_event_key TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_fiscal_year RECORD;
    v_fp_count INT;
    v_period_closed BOOLEAN;
    v_existing_op RECORD;
    v_op_key_id UUID;
    v_voucher_id UUID;
    v_entry JSONB;
    v_row_num INT;
    v_sub_id UUID;
    v_sub RECORD;
    v_person_id UUID;
    v_cost_center_id UUID;
    v_debit NUMERIC(18, 0);
    v_credit NUMERIC(18, 0);
    v_entry_desc TEXT;
    v_financial_role_code TEXT;
    v_contract_type TEXT;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required: auth.uid() is null.';
    END IF;

    -- 2. Mandatory Parameter Validation
    IF p_organization_id IS NULL THEN RAISE EXCEPTION 'Parameter p_organization_id is required.'; END IF;
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'Parameter p_branch_id is required.'; END IF;
    IF p_fiscal_year_id IS NULL THEN RAISE EXCEPTION 'Parameter p_fiscal_year_id is required.'; END IF;
    IF p_voucher_date IS NULL THEN RAISE EXCEPTION 'Parameter p_voucher_date is required.'; END IF;
    IF p_operation_key IS NULL OR trim(p_operation_key) = '' THEN RAISE EXCEPTION 'Parameter p_operation_key is required.'; END IF;
    IF p_request_fingerprint IS NULL OR trim(p_request_fingerprint) = '' THEN RAISE EXCEPTION 'Parameter p_request_fingerprint is required.'; END IF;
    IF p_entries IS NULL OR jsonb_array_length(p_entries) = 0 THEN RAISE EXCEPTION 'Voucher must contain at least one entry.'; END IF;

    -- 3. Check Branch Permission (finance:write)
    IF NOT public.has_branch_permission(p_organization_id, p_branch_id, 'finance:write') THEN
        RAISE EXCEPTION 'Permission denied: Required finance:write permission is missing for branch %.', p_branch_id;
    END IF;

    -- 4. Idempotency Check on Operation Key
    SELECT * INTO v_existing_op
    FROM public.voucher_operation_keys
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_op.operation_type <> 'CREATE_DRAFT_VOUCHER' OR
           v_existing_op.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Operation key conflict: Mismatched operation parameters or request fingerprint for key %.', p_operation_key;
        END IF;

        IF v_existing_op.completed_at IS NOT NULL THEN
            RETURN v_existing_op.result_voucher_id;
        ELSE
            RAISE EXCEPTION 'Operation with key % is currently in progress.', p_operation_key;
        END IF;
    END IF;

    -- 5. Validate Fiscal Year & Date Range & Open Status
    SELECT * INTO v_fiscal_year
    FROM public.fiscal_years
    WHERE id = p_fiscal_year_id AND organization_id = p_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fiscal year % not found in organization %.', p_fiscal_year_id, p_organization_id;
    END IF;

    IF v_fiscal_year.is_closed THEN
        RAISE EXCEPTION 'Fiscal year is closed for date %. Draft creation is forbidden.', p_voucher_date;
    END IF;

    IF p_voucher_date < v_fiscal_year.start_date OR p_voucher_date > v_fiscal_year.end_date THEN
        RAISE EXCEPTION 'Voucher date % does not fall within fiscal year range (% to %).',
            p_voucher_date, v_fiscal_year.start_date, v_fiscal_year.end_date;
    END IF;

    -- Validate Fiscal Period
    SELECT COUNT(*), COALESCE(bool_or(is_closed), false)
    INTO v_fp_count, v_period_closed
    FROM public.fiscal_periods
    WHERE organization_id = p_organization_id
      AND fiscal_year_id = p_fiscal_year_id
      AND start_date <= p_voucher_date
      AND end_date >= p_voucher_date;

    IF v_fp_count <> 1 THEN
        RAISE EXCEPTION 'Voucher date % must match exactly one defined fiscal period (found %).', p_voucher_date, v_fp_count;
    END IF;

    IF v_period_closed IS TRUE THEN
        RAISE EXCEPTION 'Fiscal period for date % is closed. Draft creation is forbidden.', p_voucher_date;
    END IF;

    -- 6. Validate Entries Before Insertion
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
        v_row_num := (v_entry->>'row_number')::INT;
        v_sub_id := (v_entry->>'subsidiary_id')::UUID;
        v_debit := COALESCE((v_entry->>'debit')::NUMERIC(18, 0), 0);
        v_credit := COALESCE((v_entry->>'credit')::NUMERIC(18, 0), 0);

        IF v_sub_id IS NULL THEN
            RAISE EXCEPTION 'Entry row % is missing subsidiary_id.', v_row_num;
        END IF;

        IF v_debit < 0 OR v_credit < 0 THEN
            RAISE EXCEPTION 'Entry row % contains negative debit or credit amounts.', v_row_num;
        END IF;

        IF v_debit > 0 AND v_credit > 0 THEN
            RAISE EXCEPTION 'Entry row % cannot have both debit and credit greater than zero.', v_row_num;
        END IF;

        -- Check subsidiary account
        SELECT * INTO v_sub
        FROM public.account_subsidiaries
        WHERE id = v_sub_id AND organization_id = p_organization_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Subsidiary account % in entry row % not found in organization %.', v_sub_id, v_row_num, p_organization_id;
        END IF;

        IF NOT v_sub.is_active THEN
            RAISE EXCEPTION 'Subsidiary account % (%) in entry row % is inactive.', v_sub.code, v_sub.name, v_row_num;
        END IF;

        -- Check requires_person
        v_person_id := NULL;
        IF v_entry->>'person_id' IS NOT NULL AND trim(v_entry->>'person_id') <> '' THEN
            v_person_id := (v_entry->>'person_id')::UUID;
            IF NOT EXISTS (SELECT 1 FROM public.persons WHERE id = v_person_id AND organization_id = p_organization_id) THEN
                RAISE EXCEPTION 'Person reference % in entry row % not found in organization %.', v_person_id, v_row_num, p_organization_id;
            END IF;
        END IF;

        IF v_sub.requires_person AND v_person_id IS NULL THEN
            RAISE EXCEPTION 'Subsidiary account % (%) in entry row % requires a valid person reference.', v_sub.code, v_sub.name, v_row_num;
        END IF;

        -- Check requires_cost_center
        v_cost_center_id := NULL;
        IF v_entry->>'cost_center_id' IS NOT NULL AND trim(v_entry->>'cost_center_id') <> '' THEN
            v_cost_center_id := (v_entry->>'cost_center_id')::UUID;
            IF NOT EXISTS (SELECT 1 FROM public.cost_centers WHERE id = v_cost_center_id AND organization_id = p_organization_id) THEN
                RAISE EXCEPTION 'Cost center reference % in entry row % not found in organization %.', v_cost_center_id, v_row_num, p_organization_id;
            END IF;
        END IF;

        IF v_sub.requires_cost_center AND v_cost_center_id IS NULL THEN
            RAISE EXCEPTION 'Subsidiary account % (%) in entry row % requires a valid cost center reference.', v_sub.code, v_sub.name, v_row_num;
        END IF;
    END LOOP;

    -- 7. Reserve Operation Key
    INSERT INTO public.voucher_operation_keys (
        organization_id, operation_key, operation_type, request_fingerprint, created_by
    ) VALUES (
        p_organization_id, p_operation_key, 'CREATE_DRAFT_VOUCHER', p_request_fingerprint, v_auth_uid
    ) RETURNING id INTO v_op_key_id;

    -- 8. Insert Voucher Header (Status = DRAFT, voucher_number = NULL)
    INSERT INTO public.journal_vouchers (
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
        created_by
    ) VALUES (
        p_organization_id,
        p_branch_id,
        p_fiscal_year_id,
        NULL,
        p_voucher_date,
        p_description,
        'DRAFT',
        'GENERAL',
        false,
        p_source_type,
        p_source_id,
        p_source_event_key,
        v_auth_uid
    )
    RETURNING id INTO v_voucher_id;

    -- 9. Insert Voucher Entries
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
        v_row_num := (v_entry->>'row_number')::INT;
        v_sub_id := (v_entry->>'subsidiary_id')::UUID;
        v_person_id := CASE WHEN v_entry->>'person_id' IS NOT NULL AND trim(v_entry->>'person_id') <> '' THEN (v_entry->>'person_id')::UUID ELSE NULL END;
        v_cost_center_id := CASE WHEN v_entry->>'cost_center_id' IS NOT NULL AND trim(v_entry->>'cost_center_id') <> '' THEN (v_entry->>'cost_center_id')::UUID ELSE NULL END;
        v_debit := COALESCE((v_entry->>'debit')::NUMERIC(18, 0), 0);
        v_credit := COALESCE((v_entry->>'credit')::NUMERIC(18, 0), 0);
        v_entry_desc := v_entry->>'description';
        v_financial_role_code := v_entry->>'financial_role_code';
        v_contract_type := v_entry->>'contract_type';

        INSERT INTO public.voucher_entries (
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
            p_organization_id,
            v_voucher_id,
            v_row_num,
            v_sub_id,
            v_person_id,
            v_cost_center_id,
            v_financial_role_code,
            v_debit,
            v_credit,
            v_entry_desc,
            v_contract_type
        );
    END LOOP;

    -- 10. Complete Operation Key Record
    UPDATE public.voucher_operation_keys
    SET result_voucher_id = v_voucher_id,
        completed_at = now()
    WHERE id = v_op_key_id;

    RETURN v_voucher_id;
END;
$$;

-- Security Grants & Revocations
REVOKE EXECUTE ON FUNCTION public.create_draft_journal_voucher(UUID, UUID, UUID, DATE, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_draft_journal_voucher(UUID, UUID, UUID, DATE, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
