BEGIN;

-- ==============================================================================
-- Migration: 25_opening_balance_atomic.sql
-- Description: Phase 3-F / Step 5 - Server-Authoritative Atomic Opening Balance RPC
-- Invariants:
--   1. Strict Double-Entry Balance: SUM(debit) === SUM(credit).
--   2. Atomic Sequence Consumption: Sequences locked via FOR UPDATE on voucher_sequences.
--   3. Idempotency Guard: p_op_key verified in journal_vouchers and voucher_operation_keys.
--   4. Immutable Ledger: Header inserted with status = 'POSTED', source_type = 'OPENING_BALANCE'.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.create_opening_balance_atomic(
    p_org_id UUID,
    p_branch_id UUID,
    p_fiscal_year_id UUID,
    p_user_id UUID,
    p_op_key TEXT,
    p_date DATE,
    p_description TEXT,
    p_entries JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_existing_jv RECORD;
    v_branch_id UUID := p_branch_id;
    v_fiscal_year_id UUID := p_fiscal_year_id;
    v_date DATE := COALESCE(p_date, CURRENT_DATE);
    v_desc TEXT := COALESCE(p_description, 'ثبت سند تراز افتتاحیه اول دوره');
    v_next_num BIGINT;
    v_voucher_id UUID;
    v_entry JSONB;
    v_row_num INT := 0;
    v_total_debit NUMERIC(18, 0) := 0;
    v_total_credit NUMERIC(18, 0) := 0;
    v_entry_debit NUMERIC(18, 0);
    v_entry_credit NUMERIC(18, 0);
    v_sub_ref TEXT;
    v_sub_id UUID;
    v_person_ref TEXT;
    v_person_id UUID;
    v_cost_center_ref TEXT;
    v_cost_center_id UUID;
    v_entry_desc TEXT;
    v_contract_type TEXT;
BEGIN
    -- 1. Parameter Validation
    IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'Parameter p_org_id is required.';
    END IF;

    IF p_op_key IS NULL OR trim(p_op_key) = '' THEN
        RAISE EXCEPTION 'Parameter p_op_key is required.';
    END IF;

    IF p_entries IS NULL OR jsonb_array_length(p_entries) < 2 THEN
        RAISE EXCEPTION 'ERR_VOUCHER_TOO_FEW_ENTRIES: سند افتتاحیه باید حداقل دارای ۲ آرتیکل حسابداری باشد.';
    END IF;

    -- 2. Idempotency Check
    SELECT id, voucher_number, status INTO v_existing_jv
    FROM public.journal_vouchers
    WHERE organization_id = p_org_id AND source_event_key = p_op_key;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'voucher_id', v_existing_jv.id,
            'voucher_number', v_existing_jv.voucher_number,
            'status', v_existing_jv.status,
            'idempotent_replay', true,
            'message', 'سند افتتاحیه قبلاً با این کلید عملیاتی ثبت شده است.'
        );
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

        IF v_branch_id IS NULL THEN
            RAISE EXCEPTION 'ERR_NO_BRANCH: شعبه‌ای برای سازمان یافت نشد.';
        END IF;
    END IF;

    -- 4. Resolve Fiscal Year
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

    -- 5. Mathematical Double-Entry Invariant Validation
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
        v_entry_debit := COALESCE((v_entry->>'debit')::numeric, 0);
        v_entry_credit := COALESCE((v_entry->>'credit')::numeric, 0);

        IF v_entry_debit < 0 OR v_entry_credit < 0 THEN
            RAISE EXCEPTION 'ERR_NEGATIVE_AMOUNT: مبالغ بدهکار و بستانکار نمی‌توانند منفی باشند.';
        END IF;

        IF v_entry_debit > 0 AND v_entry_credit > 0 THEN
            RAISE EXCEPTION 'ERR_DUAL_SIDE_ENTRY: یک ردیف سند نمی‌تواند همزمان بدهکار و بستانکار باشد.';
        END IF;

        v_total_debit := v_total_debit + v_entry_debit;
        v_total_credit := v_total_credit + v_entry_credit;
    END LOOP;

    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'ERR_VOUCHER_UNBALANCED: سند حسابداری افتتاحیه تراز نیست (مجموع بدهکار: %, مجموع بستانکار: %)', v_total_debit, v_total_credit;
    END IF;

    IF v_total_debit <= 0 THEN
        RAISE EXCEPTION 'ERR_INVALID_AMOUNT: مجموع مبالغ سند افتتاحیه باید بزرگتر از صفر باشد.';
    END IF;

    -- 6. Atomic Sequence Allocation
    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_org_id, v_fiscal_year_id, 1, p_user_id)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_next_num
    FROM public.voucher_sequences
    WHERE organization_id = p_org_id AND fiscal_year_id = v_fiscal_year_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_by = p_user_id,
        updated_at = now()
    WHERE organization_id = p_org_id AND fiscal_year_id = v_fiscal_year_id;

    -- 7. Insert Journal Voucher Header
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
        v_next_num,
        v_date,
        v_desc,
        'POSTED',
        'GENERAL',
        true,
        'OPENING_BALANCE',
        v_voucher_id,
        p_op_key,
        p_user_id,
        p_user_id,
        now(),
        now(),
        now()
    );

    -- 8. Insert Voucher Entries
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
        v_row_num := v_row_num + 1;
        v_entry_debit := COALESCE((v_entry->>'debit')::numeric, 0);
        v_entry_credit := COALESCE((v_entry->>'credit')::numeric, 0);

        -- Resolve subsidiary account ID
        v_sub_ref := v_entry->>'subsidiary_id';
        IF v_sub_ref IS NULL THEN
            v_sub_ref := v_entry->>'subsidiaryId';
        END IF;

        SELECT id INTO v_sub_id
        FROM public.account_subsidiaries
        WHERE organization_id = p_org_id
          AND (
            id::text = v_sub_ref
            OR system_key = v_sub_ref
            OR code = v_sub_ref
          )
        LIMIT 1;

        IF v_sub_id IS NULL THEN
            RAISE EXCEPTION 'ERR_ACCOUNT_NOT_FOUND: حساب معین % در این سازمان یافت نشد.', v_sub_ref;
        END IF;

        -- Resolve person ID if floating detailed
        v_person_ref := v_entry->>'person_id';
        IF v_person_ref IS NULL THEN
            v_person_ref := v_entry->>'personId';
        END IF;
        IF v_person_ref IS NULL AND v_entry->'floatingDetailed' IS NOT NULL THEN
            v_person_ref := v_entry->'floatingDetailed'->>'id';
        END IF;

        IF v_person_ref IS NOT NULL AND v_person_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            v_person_id := v_person_ref::uuid;
        ELSE
            v_person_id := NULL;
        END IF;

        -- Resolve cost center ID
        v_cost_center_ref := v_entry->>'cost_center_id';
        IF v_cost_center_ref IS NULL THEN
            v_cost_center_ref := v_entry->>'costCenterId';
        END IF;

        IF v_cost_center_ref IS NOT NULL AND v_cost_center_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            v_cost_center_id := v_cost_center_ref::uuid;
        ELSE
            v_cost_center_id := NULL;
        END IF;

        v_entry_desc := COALESCE(v_entry->>'description', v_desc);
        v_contract_type := COALESCE(v_entry->>'contract_type', v_entry->>'contractType');

        INSERT INTO public.voucher_entries (
            organization_id,
            voucher_id,
            row_number,
            subsidiary_id,
            person_id,
            cost_center_id,
            debit,
            credit,
            description,
            contract_type
        ) VALUES (
            p_org_id,
            v_voucher_id,
            v_row_num,
            v_sub_id,
            v_person_id,
            v_cost_center_id,
            v_entry_debit,
            v_entry_credit,
            v_entry_desc,
            v_contract_type
        );
    END LOOP;

    -- 9. Register in Operation Keys
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
        'POST_VOUCHER',
        p_op_key,
        v_voucher_id,
        v_voucher_id,
        p_user_id,
        now()
    ) ON CONFLICT (organization_id, operation_key) DO NOTHING;

    -- 10. Return Structured Result
    RETURN jsonb_build_object(
        'success', true,
        'voucher_id', v_voucher_id,
        'voucher_number', v_next_num,
        'status', 'POSTED',
        'total_debit', v_total_debit,
        'total_credit', v_total_credit,
        'entries_count', v_row_num,
        'message', 'سند تراز افتتاحیه با موفقیت در دفاتر رسمی ثبت و قطعی شد.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_opening_balance_atomic(UUID, UUID, UUID, UUID, TEXT, DATE, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_opening_balance_atomic(UUID, UUID, UUID, UUID, TEXT, DATE, TEXT, JSONB) TO authenticated, service_role;

COMMIT;
