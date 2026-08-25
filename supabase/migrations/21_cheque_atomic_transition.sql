BEGIN;

-- ==============================================================================
-- Migration: 21_cheque_atomic_transition.sql
-- Description: Authoritative PL/pgSQL atomic cheque lifecycle transition function
--              with row locking, expected version validation, mutation idempotency,
--              double-entry voucher generation, state update, and state history append.
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
    v_now TIMESTAMPTZ := clock_timestamp();
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
BEGIN
    -- 0. Resolve User UUID and Account Subsidiaries
    IF p_user_id IS NOT NULL AND p_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        v_user_uuid := p_user_id::UUID;
    ELSE
        SELECT id INTO v_user_uuid FROM public.user_profiles LIMIT 1;
    END IF;

    SELECT 
        MAX(CASE WHEN system_key = 'SUB_DEBTORS' OR code IN ('SUB_DEBTORS', '10301', '1101') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_CREDITORS' OR code IN ('SUB_CREDITORS', '20201', '2101') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_CHECKS_REC' OR code IN ('SUB_CHECKS_REC', '10401') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_CHECKS_TRANSIT' OR code IN ('SUB_CHECKS_TRANSIT', '10402') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_CHECKS_PAY' OR code IN ('SUB_CHECKS_PAY', '20101') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_EXP_FIN_INTEREST' OR code IN ('SUB_EXP_FIN_INTEREST', '70301') THEN id END),
        MAX(CASE WHEN system_key = 'SUB_DEFERRED_FEE' OR code IN ('SUB_DEFERRED_FEE', '10603') THEN id END)
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
            SELECT jsonb_build_object(
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

    v_voucher_id := gen_random_uuid();
    v_history_id := gen_random_uuid();
    v_mutation_id := gen_random_uuid();
    v_today := CURRENT_DATE;

    -- Get next voucher number if FY is available
    IF v_fy_id IS NOT NULL THEN
        SELECT COALESCE(MAX(voucher_number), 0) + 1 INTO v_voucher_number
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
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_transit_id, v_amount, 0, 'واگذاری چک شماره ' || v_cheque.check_number || ' به بانک');

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_checks_rec_id, 0, v_amount, 'خروج چک شماره ' || v_cheque.check_number || ' از صندوق');

        ELSIF p_to_state = 'cleared' THEN
            DECLARE
                v_cred_sub UUID := CASE WHEN v_from_state = 'deposited_to_bank' THEN v_sub_checks_transit_id ELSE v_sub_checks_rec_id END;
            BEGIN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'وصول چک شماره ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_bank_id, v_amount, 0, 'وصول چک شماره ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_cred_sub, 0, v_amount, 'تسویه اسناد دریافتنی چک ' || v_cheque.check_number);
            END;

        ELSIF p_to_state = 'passed_to_others' THEN
            DECLARE
                v_target_person UUID := COALESCE(p_endorsed_person_id, v_person_id);
            BEGIN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'خرج چک ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_creditors_id, v_target_person, v_amount, 0, 'خرج چک ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_checks_rec_id, 0, v_amount, 'خروج چک ' || v_cheque.check_number || ' از صندوق');
            END;

        ELSIF v_from_state = 'passed_to_others' AND p_to_state = 'present_in_cashbox' THEN
            DECLARE
                v_target_person UUID := COALESCE(p_endorsed_person_id, v_person_id);
            BEGIN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'برگشت چک خرج‌شده ' || v_cheque.check_number || ' به صندوق'), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_rec_id, v_amount, 0, 'برگشت چک خرج‌شده ' || v_cheque.check_number || ' به صندوق');

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_creditors_id, v_target_person, 0, v_amount, 'بستانکار شدن مجدد تامین‌کننده بابت برگشت چک خرج‌شده');
            END;

        ELSIF p_to_state = 'bounced' THEN
            IF v_from_state = 'passed_to_others' THEN
                DECLARE
                    v_target_person UUID := COALESCE(p_endorsed_person_id, v_person_id);
                BEGIN
                    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                    VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'برگشت چک خرج‌شده ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                    VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_debtors_id, v_person_id, v_amount, 0, 'بدهکار شدن مجدد مشتری بابت برگشت چک خرج‌شده');

                    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                    VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_creditors_id, v_target_person, 0, v_amount, 'بستانکار شدن مجدد تامین‌کننده بابت برگشت چک خرج‌شده');
                END;
            ELSE
                DECLARE
                    v_cred_sub UUID := CASE WHEN v_from_state = 'deposited_to_bank' THEN v_sub_checks_transit_id ELSE v_sub_checks_rec_id END;
                BEGIN
                    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                    VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'برگشت چک ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                    VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_debtors_id, v_person_id, v_amount, 0, 'برگشت چک ' || v_cheque.check_number);

                    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                    VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_cred_sub, 0, v_amount, 'کسر از حساب اسناد دریافتنی/جریان وصول بابت برگشت چک');
                END;
            END IF;

        ELSIF v_from_state = 'bounced' AND p_to_state = 'cleared' THEN
            -- وصول چک برگشتی
            INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
            VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'وصول چک برگشتی شماره ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_bank_id, v_amount, 0, 'واریز به حساب بابت وصول چک برگشتی');

            INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
            VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_debtors_id, v_person_id, 0, v_amount, 'تسویه بدهی مشتری بابت وصول چک برگشتی');
        END IF;

    ELSIF v_cheque_type = 'paid' THEN
        IF p_to_state = 'cleared' THEN
            IF NOT v_is_investor THEN
                -- Dr SUB_CHECKS_PAY, Cr Bank
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'پاس شدن چک پرداختنی ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'پاس شدن چک ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_bank_id, 0, v_amount, 'کسر از بانک بابت پاس شدن چک ' || v_cheque.check_number);
            ELSE
                -- Investor commission check clearance: Two pairs (Total debit = 2 * amount, total credit = 2 * amount)
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'پاس شدن چک کارمزد سرمایه‌گذار ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                -- Pair 1: Settlement of Check Payable & Bank reduction
                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'تسویه اسناد پرداختنی بابت پاس شدن چک کارمزد ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_bank_id, 0, v_amount, 'کسر از بانک بابت پاس شدن چک کارمزد ' || v_cheque.check_number);

                -- Pair 2: Realization of financial expense & settlement of deferred fee
                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 3, v_sub_exp_fin_interest_id, v_amount, 0, 'تحقق واقعی هزینه کارمزد سرمایه‌گذاری بابت پاس شدن چک ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 4, v_sub_deferred_fee_id, 0, v_amount, 'تسویه کارمزد در انتظار تحقق بابت تحقق هزینه چک ' || v_cheque.check_number);
            END IF;

        ELSIF p_to_state = 'bounced' THEN
            IF NOT v_is_investor THEN
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'ابطال چک پرداختنی ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'ابطال تعهد اسناد پرداختنی چک ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_creditors_id, v_person_id, 0, v_amount, 'بستانکار شدن مجدد طرف حساب بابت برگشت چک ' || v_cheque.check_number);
            ELSE
                INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, version, created_by, posted_by, posted_at)
                VALUES (v_voucher_id, p_organization_id, v_cheque.branch_id, v_fy_id, v_voucher_number, v_today, COALESCE(p_description, 'ابطال چک کارمزد سرمایه‌گذار ' || v_cheque.check_number), 'POSTED', 'GENERAL', true, 'check_state_change', v_cheque.id, p_mutation_key, 1, v_user_uuid, v_user_uuid, v_now);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 1, v_sub_checks_pay_id, v_amount, 0, 'ابطال اسناد پرداختنی بابت برگشت چک کارمزد سرمایه‌گذار ' || v_cheque.check_number);

                INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, debit, credit, description)
                VALUES (gen_random_uuid(), p_organization_id, v_voucher_id, 2, v_sub_deferred_fee_id, 0, v_amount, 'برگشت کارمزد در انتظار تحقق بابت ابطال چک');
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
        UPPER(p_to_state),
        v_voucher_id,
        p_user_id,
        p_mutation_key,
        p_request_fingerprint,
        jsonb_build_object('amount', v_amount, 'check_number', v_cheque.check_number, 'voucher_number', v_voucher_number)
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
    SELECT jsonb_build_object(
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

COMMIT;
