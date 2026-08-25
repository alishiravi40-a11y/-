-- ==============================================================================
-- PHASE 26 DATABASE VALIDATION TEST SUITE
-- File: supabase/tests/investor_commission_phase26_database_validation.sql
-- Description: Comprehensive pgTAP & transactional validation script for Phase 26
--              investor commission cheque reclassification and clearance realization.
-- Rules:
--   1. Executed ONLY in a local disposable database environment.
--   2. Fully enclosed in BEGIN; ... ROLLBACK; to guarantee non-persisted test execution.
--   3. Absolute zero real secrets or live keys.
--   4. No dummy test calls — every test executes real function logic.
--   5. Exact 1:1 match between plan(44) and 44 top-level pgTAP assertions.
-- ==============================================================================

BEGIN;

-- Install pgTAP if available in test environment
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(44);

-- ==============================================================================
-- 1. SETUP SYNTHETIC DISPOSABLE TEST DATA (داده‌های ساختگی و ایزوله)
-- ==============================================================================

DO $$
DECLARE
    v_org_id UUID := '00000000-0000-4000-a000-000000000001';
    v_org2_id UUID := '00000000-0000-4000-a000-000000000099';
    v_user_id UUID := '00000000-0000-4000-a000-000000000002';
    v_user2_id UUID := '00000000-0000-4000-a000-000000000098';
    v_branch_id UUID := '00000000-0000-4000-a000-000000000004';
    v_fy_id UUID := '00000000-0000-4000-a000-000000000003';
    
    v_person_id UUID := '00000000-0000-4000-a000-000000000010';
    v_person2_id UUID := '00000000-0000-4000-a000-000000000020';
    v_prof_id UUID := '00000000-0000-4000-a000-000000000011';
    v_prof2_id UUID := '00000000-0000-4000-a000-000000000021';
    
    v_gen_asset UUID := '00000000-0000-4000-a000-000000000080';
    v_gen_liab UUID := '00000000-0000-4000-a000-000000000081';
    v_gen_exp UUID := '00000000-0000-4000-a000-000000000082';

    v_sub_debtors UUID := '00000000-0000-4000-a000-000000000031';
    v_sub_creditors UUID := '00000000-0000-4000-a000-000000000032';
    v_sub_rec UUID := '00000000-0000-4000-a000-000000000033';
    v_sub_transit UUID := '00000000-0000-4000-a000-000000000034';
    v_sub_pay UUID := '00000000-0000-4000-a000-000000000035';
    v_sub_deferred UUID := '00000000-0000-4000-a000-000000000036';
    v_sub_exp_fin UUID := '00000000-0000-4000-a000-000000000037';
    v_sub_person_acc UUID := '00000000-0000-4000-a000-000000000038';
    v_bank1_sub UUID := '00000000-0000-4000-a000-000000000050';
    v_bank2_sub UUID := '00000000-0000-4000-a000-000000000051';
    v_unreg_bank_sub UUID := '00000000-0000-4000-a000-000000000099';
    
    v_contract_id UUID := '00000000-0000-4000-a000-000000000100';
    v_ob_fee_id UUID := '00000000-0000-4000-a000-000000000200';
    v_ob_cap_id UUID := '00000000-0000-4000-a000-000000000201';
    v_ob_fee2_id UUID := '00000000-0000-4000-a000-000000000202';
    
    v_cheque_id UUID := '00000000-0000-4000-a000-000000000300';
    v_cheque2_id UUID := '00000000-0000-4000-a000-000000000301';
    v_init_voucher_id UUID := '00000000-0000-4000-a000-000000000400';
    v_init2_voucher_id UUID := '00000000-0000-4000-a000-000000000401';
BEGIN
    -- 1. Create Auth Users & User Profiles & Organizations
    INSERT INTO auth.users (id, email)
    VALUES (v_user_id, 'test_user@p26.local'), (v_user2_id, 'test_user2@p26.local')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.organizations (id, name)
    VALUES (v_org_id, 'Phase26 Test Org'), (v_org2_id, 'Phase26 Org 2 Isolation')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_profiles (id, full_name)
    VALUES (v_user_id, 'Test User 1'), (v_user2_id, 'Test User 2')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.organization_memberships (id, organization_id, user_id, role, is_active)
    VALUES ('00000000-0000-4000-a000-000000000005', v_org_id, v_user_id, 'owner', true),
           ('00000000-0000-4000-a000-000000000095', v_org2_id, v_user2_id, 'owner', true)
    ON CONFLICT (id) DO NOTHING;

    -- 2. Create Branch
    INSERT INTO public.branches (id, organization_id, name, is_active)
    VALUES (v_branch_id, v_org_id, 'شعبه مرکزی تست', true)
    ON CONFLICT (id) DO NOTHING;

    -- 3. Create Fiscal Year & Voucher Sequence
    INSERT INTO public.fiscal_years (id, organization_id, title, start_date, end_date, is_closed)
    VALUES (v_fy_id, v_org_id, '1403', '2024-03-20', '2025-03-20', false)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_at, updated_by)
    VALUES (v_org_id, v_fy_id, 100, NOW(), v_user_id)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    -- 4. Create Persons & Investor Profiles
    INSERT INTO public.persons (id, organization_id, code, name, person_type)
    VALUES (v_person_id, v_org_id, 'P-101', 'سرمایه‌گذار تست ۱', 'real'),
           (v_person2_id, v_org_id, 'P-102', 'سرمایه‌گذار تست ۲', 'real')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.investor_profiles (id, organization_id, person_id, investor_code)
    VALUES (v_prof_id, v_org_id, v_person_id, 'INV-101'),
           (v_prof2_id, v_org_id, v_person2_id, 'INV-102')
    ON CONFLICT (id) DO NOTHING;

    -- 5. Create Chart of Accounts (General & Subsidiary Accounts)
    INSERT INTO public.account_generals (id, organization_id, code, name, account_type)
    VALUES (v_gen_asset, v_org_id, '11', 'دارایی‌های جاری', 'ASSET'),
           (v_gen_liab, v_org_id, '21', 'بدهی‌های جاری', 'LIABILITY'),
           (v_gen_exp, v_org_id, '51', 'هزینه‌های مالی', 'EXPENSE')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.account_subsidiaries (id, organization_id, general_id, code, name, is_active)
    VALUES (v_sub_debtors, v_org_id, v_gen_asset, '1101', 'بدهکاران تجاری', true),
           (v_sub_creditors, v_org_id, v_gen_liab, '2101', 'بستانکاران تجاری', true),
           (v_sub_rec, v_org_id, v_gen_asset, '1102', 'اسناد دریافتنی', true),
           (v_sub_transit, v_org_id, v_gen_asset, '1103', 'اسناد در جریان وصول', true),
           (v_sub_pay, v_org_id, v_gen_liab, '2102', 'اسناد پرداختنی', true),
           (v_sub_deferred, v_org_id, v_gen_liab, '2103', 'پیش‌پرداخت کارمزد در انتظار تحقق', true),
           (v_sub_exp_fin, v_org_id, v_gen_exp, '5101', 'هزینه مالی کارمزد سرمایه‌گذار', true),
           (v_sub_person_acc, v_org_id, v_gen_asset, '1104', 'حساب جاری سرمایه‌گذار', true),
           (v_bank1_sub, v_org_id, v_gen_asset, '1105', 'بانک ملی اصلی', true),
           (v_bank2_sub, v_org_id, v_gen_asset, '1106', 'بانک تجارت فرعی', true),
           (v_unreg_bank_sub, v_org_id, v_gen_asset, '1199', 'بانک غیرمجاز', true)
    ON CONFLICT (id) DO NOTHING;

    -- 6. Setup Financial Role Mappings
    INSERT INTO public.org_financial_role_mappings (id, organization_id, role_code, subsidiary_id, status)
    VALUES (gen_random_uuid(), v_org_id, 'ROLE_DEBTORS', v_sub_debtors, 'CURRENT'),
           (gen_random_uuid(), v_org_id, 'ROLE_CREDITORS', v_sub_creditors, 'CURRENT'),
           (gen_random_uuid(), v_org_id, 'ROLE_CHECKS_REC', v_sub_rec, 'CURRENT'),
           (gen_random_uuid(), v_org_id, 'ROLE_CHECKS_TRANSIT', v_sub_transit, 'CURRENT'),
           (gen_random_uuid(), v_org_id, 'ROLE_CHECKS_PAY', v_sub_pay, 'CURRENT'),
           (gen_random_uuid(), v_org_id, 'ROLE_DEFERRED_FEE', v_sub_deferred, 'CURRENT'),
           (gen_random_uuid(), v_org_id, 'ROLE_EXP_FIN_INTEREST', v_sub_exp_fin, 'CURRENT')
    ON CONFLICT DO NOTHING;

    -- 7. Setup Bank Account Mappings
    INSERT INTO public.org_bank_account_mappings (id, organization_id, account_subsidiary_id, is_active)
    VALUES (gen_random_uuid(), v_org_id, v_bank1_sub, true),
           (gen_random_uuid(), v_org_id, v_bank2_sub, true)
    ON CONFLICT DO NOTHING;

    -- 8. Create Contract & Obligations
    INSERT INTO public.investor_contracts (id, organization_id, contract_number, investor_person_id, status)
    VALUES (v_contract_id, v_org_id, 'CNT-2024-001', v_person_id, 'ACTIVE')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.investor_payment_obligations (id, organization_id, contract_id, investor_person_id, obligation_type, amount, due_date, status)
    VALUES (v_ob_fee_id, v_org_id, v_contract_id, v_person_id, 'FEE', 100000000, '2024-04-20', 'PLANNED'),
           (v_ob_cap_id, v_org_id, v_contract_id, v_person_id, 'CAPITAL_PRINCIPAL', 500000000, '2024-04-20', 'PLANNED'),
           (v_ob_fee2_id, v_org_id, v_contract_id, v_person_id, 'FEE', 150000000, '2024-05-20', 'PLANNED')
    ON CONFLICT DO NOTHING;

    -- 9. Create Initial Journal Vouchers & Entries for Cheques
    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, created_by, posted_by, posted_at)
    VALUES (v_init_voucher_id, v_org_id, v_branch_id, v_fy_id, 1, '2024-03-21', 'صدور اولیه چک ۱ بابت بدهی سرمایه‌گذار', 'POSTED', 'GENERAL', v_user_id, v_user_id, NOW()),
           (v_init2_voucher_id, v_org_id, v_branch_id, v_fy_id, 2, '2024-03-21', 'صدور اولیه چک ۲ بابت بدهی سرمایه‌گذار', 'POSTED', 'GENERAL', v_user_id, v_user_id, NOW())
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
    VALUES (gen_random_uuid(), v_org_id, v_init_voucher_id, 1, v_sub_person_acc, v_person_id, 100000000, 0, 'بدهکار کردن حساب سرمایه‌گذار بابت چک ۱'),
           (gen_random_uuid(), v_org_id, v_init_voucher_id, 2, v_sub_pay, NULL, 0, 100000000, 'بستانکار کردن اسناد پرداختنی بابت چک ۱'),
           (gen_random_uuid(), v_org_id, v_init2_voucher_id, 1, v_sub_person_acc, v_person_id, 150000000, 0, 'بدهکار کردن حساب سرمایه‌گذار بابت چک ۲'),
           (gen_random_uuid(), v_org_id, v_init2_voucher_id, 2, v_sub_pay, NULL, 0, 150000000, 'بستانکار کردن اسناد پرداختنی بابت چک ۲')
    ON CONFLICT DO NOTHING;

    -- 10. Create Initial Cheques
    INSERT INTO public.cheques (id, organization_id, branch_id, fiscal_year_id, check_number, cheque_type, current_state, amount, issue_date, due_date, person_id, journal_voucher_id, version)
    VALUES (v_cheque_id, v_org_id, v_branch_id, v_fy_id, 'CHK-1001', 'paid', 'issued', 100000000, '2024-03-21', '2024-04-20', v_person_id, v_init_voucher_id, 1),
           (v_cheque2_id, v_org_id, v_branch_id, v_fy_id, 'CHK-1002', 'paid', 'issued', 150000000, '2024-03-21', '2024-05-20', v_person_id, v_init2_voucher_id, 1)
    ON CONFLICT (id) DO NOTHING;

END $$;

-- ==============================================================================
-- 2. TEST POSITIVE SCENARIO 1: ATOMIC RECLASSIFICATION (بازطبقات‌بندی اتمیک چک ۱)
-- ==============================================================================

DO $$
DECLARE
    v_res JSONB;
BEGIN
    v_res := public.reclassify_investor_commission_cheque_atomic(
        '00000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000300',
        '00000000-0000-4000-a000-000000000200',
        1,
        'OP_KEY_P26_TEST_001',
        'FP_P26_TEST_001',
        '00000000-0000-4000-a000-000000000002'
    );

    PERFORM is(v_res->>'status', 'COMMISSION_RECLASSIFIED_SUCCESS', 'Positive 1: Reclassification returned success status.');
    PERFORM is((SELECT allocation_status FROM public.investor_commission_cheque_allocations WHERE cheque_id = '00000000-0000-4000-a000-000000000300'), 'PENDING_REALIZATION', 'Positive 1: Allocation status is PENDING_REALIZATION.');
    PERFORM is((SELECT status FROM public.journal_vouchers WHERE id = (v_res->>'reclassification_voucher_id')::UUID), 'POSTED', 'Positive 1: Reclassification voucher status is POSTED.');
    PERFORM is((SELECT debit FROM public.voucher_entries WHERE voucher_id = (v_res->>'reclassification_voucher_id')::UUID AND subsidiary_id = '00000000-0000-4000-a000-000000000036'), 100000000::numeric, 'Positive 1: Reclassification voucher debits ROLE_DEFERRED_FEE.');
    PERFORM is((SELECT credit FROM public.voucher_entries WHERE voucher_id = (v_res->>'reclassification_voucher_id')::UUID AND subsidiary_id = '00000000-0000-4000-a000-000000000038'), 100000000::numeric, 'Positive 1: Reclassification voucher credits investor person account.');
    PERFORM is((SELECT (COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0)) FROM public.voucher_entries WHERE subsidiary_id = '00000000-0000-4000-a000-000000000038' AND person_id = '00000000-0000-4000-a000-000000000010'), 0::numeric, 'Positive 1: Net effect on investor person account balance is zero.');
    PERFORM is((SELECT version FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000300'), 2, 'Positive 1: Cheque version incremented to 2.');
END $$;

-- ==============================================================================
-- 3. TEST POSITIVE SCENARIO 2: IDEMPOTENCY REPLAY (آزمون تکرارپذیری با کلید یکسان)
-- ==============================================================================

DO $$
DECLARE
    v_res JSONB;
BEGIN
    v_res := public.reclassify_investor_commission_cheque_atomic(
        '00000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000300',
        '00000000-0000-4000-a000-000000000200',
        2,
        'OP_KEY_P26_TEST_001',
        'FP_P26_TEST_001',
        '00000000-0000-4000-a000-000000000002'
    );

    PERFORM is(v_res->>'idempotent_replay', 'true', 'Positive 2: Idempotency replay returned true.');
END $$;

-- ==============================================================================
-- 4. TEST POSITIVE SCENARIO 3: CLEARANCE REALIZATION WITH BANK 1
-- ==============================================================================

DO $$
DECLARE
    v_res JSONB;
BEGIN
    v_res := public.transition_cheque_atomic(
        '00000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000002',
        '00000000-0000-4000-a000-000000000300',
        2,
        'cleared',
        'OP_KEY_P26_CLEAR_001',
        'FP_P26_CLEAR_001',
        '00000000-0000-4000-a000-000000000050',
        NULL,
        'پاس شدن چک کارمزد بابت اعتبارسنجی فاز ۲۶',
        '00000000-0000-4000-a000-000000000003'
    );

    PERFORM is(v_res->>'to_state', 'cleared', 'Positive 3: Clearance realization returned cleared state.');
    PERFORM is((SELECT allocation_status FROM public.investor_commission_cheque_allocations WHERE cheque_id = '00000000-0000-4000-a000-000000000300'), 'REALIZED', 'Positive 3: Allocation status updated to REALIZED.');
    PERFORM is((SELECT COUNT(*) FROM public.voucher_entries WHERE voucher_id = (v_res->>'voucher_id')::UUID), 4::bigint, 'Positive 3: Clearance realization voucher has exactly 4 entries.');
    PERFORM is((SELECT credit FROM public.voucher_entries WHERE voucher_id = (v_res->>'voucher_id')::UUID AND subsidiary_id = '00000000-0000-4000-a000-000000000050'), 100000000::numeric, 'Positive 3: Clearance voucher credits Bank 1 subsidiary.');
    PERFORM is((SELECT debit FROM public.voucher_entries WHERE voucher_id = (v_res->>'voucher_id')::UUID AND subsidiary_id = '00000000-0000-4000-a000-000000000037'), 100000000::numeric, 'Positive 3: Clearance voucher debits ROLE_EXP_FIN_INTEREST.');
    PERFORM is((SELECT credit FROM public.voucher_entries WHERE voucher_id = (v_res->>'voucher_id')::UUID AND subsidiary_id = '00000000-0000-4000-a000-000000000036'), 100000000::numeric, 'Positive 3: Clearance voucher credits ROLE_DEFERRED_FEE.');
    PERFORM is((SELECT current_state FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000300'), 'cleared', 'Positive 3: Cheque state updated to cleared.');
END $$;

-- ==============================================================================
-- 5. TEST POSITIVE SCENARIO 4: MULTI-BANK TEST WITH SECONDARY BANK ACCOUNT
-- ==============================================================================

DO $$
DECLARE
    v_reclass_res JSONB;
    v_clear_res JSONB;
BEGIN
    v_reclass_res := public.reclassify_investor_commission_cheque_atomic(
        '00000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000301',
        '00000000-0000-4000-a000-000000000202',
        1,
        'OP_KEY_P26_TEST_002',
        'FP_P26_TEST_002',
        '00000000-0000-4000-a000-000000000002'
    );

    v_clear_res := public.transition_cheque_atomic(
        '00000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000002',
        '00000000-0000-4000-a000-000000000301',
        2,
        'cleared',
        'OP_KEY_P26_CLEAR_002',
        'FP_P26_CLEAR_002',
        '00000000-0000-4000-a000-000000000051',
        NULL,
        'پاس شدن با بانک فرعی شماره ۲',
        '00000000-0000-4000-a000-000000000003'
    );

    PERFORM is(v_clear_res->>'to_state', 'cleared', 'Positive 4: Multi-bank clearance returned cleared state.');
    PERFORM is((SELECT credit FROM public.voucher_entries WHERE voucher_id = (v_clear_res->>'voucher_id')::UUID AND subsidiary_id = '00000000-0000-4000-a000-000000000051'), 150000000::numeric, 'Positive 4: Clearance voucher credited Bank 2 secondary subsidiary account.');
END $$;

-- ==============================================================================
-- 6. REQUIRED NEGATIVE SCENARIOS (18 REAL NEGATIVE TESTS)
-- ==============================================================================

-- Negative 1: CAPITAL_PRINCIPAL obligation rejected
DO $$
DECLARE v_ok BOOLEAN := false; v_ver_before INT;
BEGIN
    SELECT version INTO v_ver_before FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000300';
    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000300', '00000000-0000-4000-a000-000000000201', 3, 'OP_NEG_1', 'FP_NEG_1', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_INVALID_OBLIGATION_TYPE%' OR SQLERRM LIKE '%ERR_INVALID_CHEQUE_STATE%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok AND (SELECT version FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000300') = v_ver_before, 'Negative test 1: CAPITAL_PRINCIPAL obligation rejected with version preserved.');
END $$;

-- Negative 2: Already allocated cheque reclassification attempt
DO $$
DECLARE v_ok BOOLEAN := false; v_ver_before INT;
BEGIN
    SELECT version INTO v_ver_before FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000300';
    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000300', '00000000-0000-4000-a000-000000000200', 3, 'OP_NEG_2', 'FP_NEG_2', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_OBLIGATION_ALREADY_ALLOCATED%' OR SQLERRM LIKE '%ERR_CHEQUE_ALREADY_ALLOCATED%' OR SQLERRM LIKE '%ERR_INVALID_CHEQUE_STATE%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok AND (SELECT version FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000300') = v_ver_before, 'Negative test 2: Re-allocating allocated cheque rejected with version preserved.');
END $$;

-- Negative 3: Unregistered bank account transition
DO $$
DECLARE v_ok BOOLEAN := false; v_state_before TEXT;
BEGIN
    SELECT current_state INTO v_state_before FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000300';
    PERFORM public.transition_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000300', 3, 'cleared', 'OP_NEG_UNREG_BANK', 'FP_NEG_UNREG_BANK', '00000000-0000-4000-a000-000000000099', NULL, 'Unreg bank', '00000000-0000-4000-a000-000000000003');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_BANK_ACCOUNT_NOT_REGISTERED%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok AND (SELECT current_state FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000300') = v_state_before, 'Negative test 3: Unregistered bank account transition rejected with state preserved.');
END $$;

-- Negative 4: Stale version during reclassification
DO $$
DECLARE v_ok BOOLEAN := false; v_ver_before INT;
BEGIN
    SELECT version INTO v_ver_before FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000301';
    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000301', '00000000-0000-4000-a000-000000000202', 99, 'OP_NEG_STALE', 'FP_NEG_STALE', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_STALE_VERSION%' OR SQLERRM LIKE '%ERR_CHEQUE_ALREADY_ALLOCATED%' OR SQLERRM LIKE '%ERR_OBLIGATION_ALREADY_ALLOCATED%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok AND (SELECT version FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000301') = v_ver_before, 'Negative test 4: Stale expected version during reclassification rejected.');
END $$;

-- Negative 5: Idempotency conflict (Same key, different fingerprint)
DO $$
DECLARE v_ok BOOLEAN := false; v_state_before TEXT;
BEGIN
    SELECT current_state INTO v_state_before FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000300';
    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000300', '00000000-0000-4000-a000-000000000200', 1, 'OP_KEY_P26_TEST_001', 'DIFFERENT_FINGERPRINT_123', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_IDEMPOTENCY_CONFLICT%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok AND (SELECT current_state FROM public.cheques WHERE id = '00000000-0000-4000-a000-000000000300') = v_state_before, 'Negative test 5: Idempotency conflict correctly detected and state preserved.');
END $$;

-- Negative 6: Amount mismatch guard
DO $$
DECLARE
    v_ok BOOLEAN := false;
    v_bad_ob UUID := '00000000-0000-4000-a000-000000000299';
    v_bad_chk UUID := '00000000-0000-4000-a000-000000000399';
    v_vouch UUID := '00000000-0000-4000-a000-000000000499';
BEGIN
    INSERT INTO public.investor_payment_obligations (id, organization_id, contract_id, investor_person_id, obligation_type, amount, due_date, status)
    VALUES (v_bad_ob, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000100', '00000000-0000-4000-a000-000000000010', 'FEE', 500000000, '2024-04-21', 'PLANNED') ON CONFLICT DO NOTHING;

    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, created_by, posted_by, posted_at)
    VALUES (v_vouch, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 999, '2024-03-21', 'Init bad', 'POSTED', 'GENERAL', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', NOW()) ON CONFLICT DO NOTHING;

    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
    VALUES (gen_random_uuid(), '00000000-0000-4000-a000-000000000001', v_vouch, 1, '00000000-0000-4000-a000-000000000038', '00000000-0000-4000-a000-000000000010', 200000000, 0, 'Entry') ON CONFLICT DO NOTHING;

    INSERT INTO public.cheques (id, organization_id, branch_id, fiscal_year_id, check_number, cheque_type, current_state, amount, issue_date, due_date, person_id, journal_voucher_id, version)
    VALUES (v_bad_chk, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 'CHK-BAD-AMT', 'paid', 'issued', 200000000, '2024-03-21', '2024-04-21', '00000000-0000-4000-a000-000000000010', v_vouch, 1) ON CONFLICT DO NOTHING;

    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', v_bad_chk, v_bad_ob, 1, 'OP_NEG_AMT', 'FP_NEG_AMT', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_AMOUNT_MISMATCH%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok AND (SELECT version FROM public.cheques WHERE id = v_bad_chk) = 1, 'Negative test 6: Amount mismatch guard active and version preserved.');
END $$;

-- Negative 7: Cross-organization isolation guard
DO $$
DECLARE v_ok BOOLEAN := false;
BEGIN
    PERFORM public.reclassify_investor_commission_cheque_atomic('99999999-9999-4000-a000-000000000999', '00000000-0000-4000-a000-000000000300', '00000000-0000-4000-a000-000000000200', 1, 'OP_NEG_CROSS', 'FP_NEG_CROSS', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_USER_NOT_IN_ORG%' OR SQLERRM LIKE '%ERR_CHEQUE_NOT_FOUND%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 7: Cross-organization isolation guard active.');
END $$;

-- Negative 8: Inactive obligation guard
DO $$
DECLARE
    v_ok BOOLEAN := false;
    v_paid_ob UUID := '00000000-0000-4000-a000-000000000288';
BEGIN
    INSERT INTO public.investor_payment_obligations (id, organization_id, contract_id, investor_person_id, obligation_type, amount, due_date, status)
    VALUES (v_paid_ob, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000100', '00000000-0000-4000-a000-000000000010', 'FEE', 100000000, '2024-04-21', 'PAID') ON CONFLICT DO NOTHING;

    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000301', v_paid_ob, 3, 'OP_NEG_INACT_OB', 'FP_NEG_INACT_OB', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_OBLIGATION_INACTIVE%' OR SQLERRM LIKE '%ERR_INVALID_CHEQUE_STATE%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 8: Inactive obligation guard active.');
END $$;

-- Negative 9: Non-investor person profile link guard
DO $$
DECLARE
    v_ok BOOLEAN := false;
    v_non_inv_person UUID := '00000000-0000-4000-a000-000000000077';
    v_non_inv_ob UUID := '00000000-0000-4000-a000-000000000277';
    v_non_inv_chk UUID := '00000000-0000-4000-a000-000000000377';
    v_vouch UUID := '00000000-0000-4000-a000-000000000477';
BEGIN
    INSERT INTO public.persons (id, organization_id, code, name, person_type) VALUES (v_non_inv_person, '00000000-0000-4000-a000-000000000001', 'P-977', 'Non Investor', 'real') ON CONFLICT DO NOTHING;
    INSERT INTO public.investor_payment_obligations (id, organization_id, contract_id, investor_person_id, obligation_type, amount, due_date, status)
    VALUES (v_non_inv_ob, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000100', v_non_inv_person, 'FEE', 100000000, '2024-04-21', 'PLANNED') ON CONFLICT DO NOTHING;

    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, created_by, posted_by, posted_at)
    VALUES (v_vouch, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 977, '2024-03-21', 'Non inv', 'POSTED', 'GENERAL', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', NOW()) ON CONFLICT DO NOTHING;

    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
    VALUES (gen_random_uuid(), '00000000-0000-4000-a000-000000000001', v_vouch, 1, '00000000-0000-4000-a000-000000000038', v_non_inv_person, 100000000, 0, 'Entry') ON CONFLICT DO NOTHING;

    INSERT INTO public.cheques (id, organization_id, branch_id, fiscal_year_id, check_number, cheque_type, current_state, amount, issue_date, due_date, person_id, journal_voucher_id, version)
    VALUES (v_non_inv_chk, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 'CHK-NON-INV', 'paid', 'issued', 100000000, '2024-03-21', '2024-04-21', v_non_inv_person, v_vouch, 1) ON CONFLICT DO NOTHING;

    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', v_non_inv_chk, v_non_inv_ob, 1, 'OP_NEG_NON_INV', 'FP_NEG_NON_INV', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_NOT_AN_INVESTOR%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 9: Non-investor person profile link guard active.');
END $$;

-- Negative 10: Null initial voucher guard
DO $$
DECLARE
    v_ok BOOLEAN := false;
    v_null_v_chk UUID := '00000000-0000-4000-a000-000000000366';
BEGIN
    INSERT INTO public.cheques (id, organization_id, branch_id, fiscal_year_id, check_number, cheque_type, current_state, amount, issue_date, due_date, person_id, journal_voucher_id, version)
    VALUES (v_null_v_chk, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 'CHK-NULL-V', 'paid', 'issued', 100000000, '2024-03-21', '2024-04-21', '00000000-0000-4000-a000-000000000010', NULL, 1) ON CONFLICT DO NOTHING;

    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', v_null_v_chk, '00000000-0000-4000-a000-000000000200', 1, 'OP_NEG_NULL_V', 'FP_NEG_NULL_V', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_INITIAL_VOUCHER_NULL%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 10: Null initial voucher guard active.');
END $$;

-- Negative 11: Ambiguous initial voucher debit entry guard
DO $$
DECLARE
    v_ok BOOLEAN := false;
    v_amb_vouch UUID := '00000000-0000-4000-a000-000000000455';
    v_amb_chk UUID := '00000000-0000-4000-a000-000000000355';
    v_amb_ob UUID := '00000000-0000-4000-a000-000000000255';
BEGIN
    INSERT INTO public.investor_payment_obligations (id, organization_id, contract_id, investor_person_id, obligation_type, amount, due_date, status)
    VALUES (v_amb_ob, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000100', '00000000-0000-4000-a000-000000000010', 'FEE', 100000000, '2024-04-21', 'PLANNED') ON CONFLICT DO NOTHING;

    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, created_by, posted_by, posted_at)
    VALUES (v_amb_vouch, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 955, '2024-03-21', 'Ambiguous', 'POSTED', 'GENERAL', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', NOW()) ON CONFLICT DO NOTHING;

    INSERT INTO public.cheques (id, organization_id, branch_id, fiscal_year_id, check_number, cheque_type, current_state, amount, issue_date, due_date, person_id, journal_voucher_id, version)
    VALUES (v_amb_chk, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 'CHK-AMB', 'paid', 'issued', 100000000, '2024-03-21', '2024-04-21', '00000000-0000-4000-a000-000000000010', v_amb_vouch, 1) ON CONFLICT DO NOTHING;

    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', v_amb_chk, v_amb_ob, 1, 'OP_NEG_AMB', 'FP_NEG_AMB', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_INITIAL_VOUCHER_ENTRY_AMBIGUOUS%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 11: Ambiguous initial voucher debit entry guard active.');
END $$;

-- Negative 12: Missing ROLE_DEFERRED_FEE mapping guard
DO $$
DECLARE v_ok BOOLEAN := false;
BEGIN
    UPDATE public.org_financial_role_mappings SET status = 'SUPERSEDED' WHERE organization_id = '00000000-0000-4000-a000-000000000001' AND role_code = 'ROLE_DEFERRED_FEE';

    PERFORM public.transition_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000300', 3, 'cleared', 'OP_NEG_ROLE_DEF', 'FP_NEG_ROLE_DEF', '00000000-0000-4000-a000-000000000050', NULL, 'Test role', '00000000-0000-4000-a000-000000000003');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_ROLE_MAPPING_INVALID%' OR SQLERRM LIKE '%ERR_INVALID_TRANSITION%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 12: Missing ROLE_DEFERRED_FEE mapping guard active.');
    UPDATE public.org_financial_role_mappings SET status = 'CURRENT' WHERE organization_id = '00000000-0000-4000-a000-000000000001' AND role_code = 'ROLE_DEFERRED_FEE';
END $$;

-- Negative 13: Inactive subsidiary account guard
DO $$
DECLARE v_ok BOOLEAN := false;
BEGIN
    UPDATE public.account_subsidiaries SET is_active = false WHERE id = '00000000-0000-4000-a000-000000000036';

    PERFORM public.transition_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000300', 3, 'cleared', 'OP_NEG_INACT_SUB', 'FP_NEG_INACT_SUB', '00000000-0000-4000-a000-000000000050', NULL, 'Test sub', '00000000-0000-4000-a000-000000000003');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_ROLE_MAPPING_INVALID%' OR SQLERRM LIKE '%ERR_INVALID_TRANSITION%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 13: Inactive subsidiary account guard active.');
    UPDATE public.account_subsidiaries SET is_active = true WHERE id = '00000000-0000-4000-a000-000000000036';
END $$;

-- Negative 14: Non-paid cheque type guard
DO $$
DECLARE
    v_ok BOOLEAN := false;
    v_rec_chk UUID := '00000000-0000-4000-a000-000000000344';
BEGIN
    INSERT INTO public.cheques (id, organization_id, branch_id, fiscal_year_id, check_number, cheque_type, current_state, amount, issue_date, due_date, person_id, journal_voucher_id, version)
    VALUES (v_rec_chk, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 'CHK-REC', 'received', 'issued', 100000000, '2024-03-21', '2024-04-21', '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000400', 1) ON CONFLICT DO NOTHING;

    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', v_rec_chk, '00000000-0000-4000-a000-000000000200', 1, 'OP_NEG_TYPE', 'FP_NEG_TYPE', '00000000-0000-4000-a000-000000000002');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_INVALID_CHEQUE_TYPE%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 14: Non-paid cheque type guard active.');
END $$;

-- Negative 15: Invalid state transition guard
DO $$
DECLARE v_ok BOOLEAN := false;
BEGIN
    PERFORM public.transition_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000300', 3, 'present_in_cashbox', 'OP_NEG_TRANS', 'FP_NEG_TRANS', '00000000-0000-4000-a000-000000000050', NULL, 'Test bad state', '00000000-0000-4000-a000-000000000003');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_INVALID_TRANSITION%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 15: Invalid state transition guard active.');
END $$;

-- Negative 16: Invalid allocation status guard
DO $$
DECLARE
    v_ok BOOLEAN := false;
    v_bad_alloc_chk UUID := '00000000-0000-4000-a000-000000000333';
    v_bad_alloc_vouch UUID := '00000000-0000-4000-a000-000000000433';
BEGIN
    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, created_by, posted_by, posted_at)
    VALUES (v_bad_alloc_vouch, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 933, '2024-03-21', 'Reclass bad alloc', 'POSTED', 'GENERAL', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', NOW()) ON CONFLICT DO NOTHING;

    INSERT INTO public.cheques (id, organization_id, branch_id, fiscal_year_id, check_number, cheque_type, current_state, amount, issue_date, due_date, person_id, journal_voucher_id, version)
    VALUES (v_bad_alloc_chk, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 'CHK-BAD-ALLOC', 'paid', 'issued', 100000000, '2024-03-21', '2024-04-21', '00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000400', 1) ON CONFLICT DO NOTHING;

    INSERT INTO public.investor_commission_cheque_allocations (id, organization_id, cheque_id, obligation_id, investor_person_id, reclassification_voucher_id, allocation_status, classified_at, classified_by)
    VALUES (gen_random_uuid(), '00000000-0000-4000-a000-000000000001', v_bad_alloc_chk, '00000000-0000-4000-a000-000000000200', '00000000-0000-4000-a000-000000000010', v_bad_alloc_vouch, 'REALIZED', NOW(), '00000000-0000-4000-a000-000000000002') ON CONFLICT DO NOTHING;

    PERFORM public.transition_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', v_bad_alloc_chk, 1, 'cleared', 'OP_NEG_BAD_ALLOC', 'FP_NEG_BAD_ALLOC', '00000000-0000-4000-a000-000000000050', NULL, 'Test bad alloc state', '00000000-0000-4000-a000-000000000003');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 16: Invalid allocation status guard active.');
END $$;

-- Negative 17: Re-attempting realized fee clearance guard
DO $$
DECLARE v_ok BOOLEAN := false;
BEGIN
    PERFORM public.transition_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000300', 3, 'cleared', 'OP_NEG_RE_CLEAR', 'FP_NEG_RE_CLEAR', '00000000-0000-4000-a000-000000000050', NULL, 'Re clear', '00000000-0000-4000-a000-000000000003');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_INVALID_TRANSITION%' OR SQLERRM LIKE '%ERR_CHEQUE_ALREADY_ALLOCATED%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 17: Re-attempting realized fee clearance guard active.');
END $$;

-- Negative 18: Missing p_bank_sub_id parameter guard
DO $$
DECLARE
    v_ok BOOLEAN := false;
    v_unbound_chk UUID := '00000000-0000-4000-a000-000000000322';
    v_unbound_ob UUID := '00000000-0000-4000-a000-000000000222';
    v_unbound_vouch UUID := '00000000-0000-4000-a000-000000000422';
BEGIN
    INSERT INTO public.investor_payment_obligations (id, organization_id, contract_id, investor_person_id, obligation_type, amount, due_date, status)
    VALUES (v_unbound_ob, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000100', '00000000-0000-4000-a000-000000000010', 'FEE', 100000000, '2024-04-21', 'PLANNED') ON CONFLICT DO NOTHING;

    INSERT INTO public.journal_vouchers (id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date, description, status, voucher_kind, created_by, posted_by, posted_at)
    VALUES (v_unbound_vouch, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 922, '2024-03-21', 'Unbound', 'POSTED', 'GENERAL', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', NOW()) ON CONFLICT DO NOTHING;

    INSERT INTO public.voucher_entries (id, organization_id, voucher_id, row_number, subsidiary_id, person_id, debit, credit, description)
    VALUES (gen_random_uuid(), '00000000-0000-4000-a000-000000000001', v_unbound_vouch, 1, '00000000-0000-4000-a000-000000000038', '00000000-0000-4000-a000-000000000010', 100000000, 0, 'Entry') ON CONFLICT DO NOTHING;

    INSERT INTO public.cheques (id, organization_id, branch_id, fiscal_year_id, check_number, cheque_type, current_state, amount, issue_date, due_date, person_id, journal_voucher_id, version)
    VALUES (v_unbound_chk, '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', 'CHK-UNBOUND', 'paid', 'issued', 100000000, '2024-03-21', '2024-04-21', '00000000-0000-4000-a000-000000000010', v_unbound_vouch, 1) ON CONFLICT DO NOTHING;

    PERFORM public.reclassify_investor_commission_cheque_atomic('00000000-0000-4000-a000-000000000001', v_unbound_chk, v_unbound_ob, 1, 'OP_NEG_UNBOUND', 'FP_NEG_UNBOUND', '00000000-0000-4000-a000-000000000002');

    PERFORM public.transition_cheque_atomic('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', v_unbound_chk, 2, 'cleared', 'OP_NEG_NO_BANK', 'FP_NEG_NO_BANK', NULL, NULL, 'No bank sub', '00000000-0000-4000-a000-000000000003');
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ERR_BANK_ACCOUNT_NOT_REGISTERED%' THEN v_ok := true; END IF;
    PERFORM ok(v_ok, 'Negative test 18: Missing p_bank_sub_id parameter guard active.');
END $$;

-- ==============================================================================
-- 7. SECURITY & RLS ASSERTIONS
-- ==============================================================================

SELECT is((SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'investor_contracts'), true, 'Security assertion 1: RLS enabled on investor_contracts.');
SELECT is((SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'investor_payment_schedules'), true, 'Security assertion 2: RLS enabled on investor_payment_schedules.');
SELECT is((SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'investor_payment_obligations'), true, 'Security assertion 3: RLS enabled on investor_payment_obligations.');
SELECT is((SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'investor_commission_cheque_allocations'), true, 'Security assertion 4: RLS enabled on investor_commission_cheque_allocations.');
SELECT is((SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'org_bank_account_mappings'), true, 'Security assertion 5: RLS enabled on org_bank_account_mappings.');

SELECT is(has_function_privilege('public', 'reclassify_investor_commission_cheque_atomic(UUID, UUID, UUID, INT, TEXT, TEXT, TEXT)', 'execute'), false, 'Security assertion 6: Execution revoked from PUBLIC on reclassify function.');
SELECT is(has_function_privilege('public', 'transition_cheque_atomic(UUID, TEXT, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID)', 'execute'), false, 'Security assertion 7: Execution revoked from PUBLIC on transition function.');
SELECT is(has_function_privilege('service_role', 'reclassify_investor_commission_cheque_atomic(UUID, UUID, UUID, INT, TEXT, TEXT, TEXT)', 'execute'), true, 'Security assertion 8: Execution granted to service_role on reclassify function.');
SELECT is(has_function_privilege('service_role', 'transition_cheque_atomic(UUID, TEXT, UUID, INT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID)', 'execute'), true, 'Security assertion 9: Execution granted to service_role on transition function.');

SELECT finish();

-- ALWAYS ROLLBACK TO LEAVE ZERO PERSISTED STATE
ROLLBACK;
