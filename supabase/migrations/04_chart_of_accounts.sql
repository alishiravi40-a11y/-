BEGIN;

-- ==============================================================================
-- Migration: 04_chart_of_accounts.sql
-- Description: Phase 3-D - Chart of Accounts (COA) Master Template & Financial Role Mappings (Final Lifecycle Revision)
-- Key Features & Fixes:
--   1. Strict Abstraction of System Roles: All SUB_* identifiers removed from role codes.
--      Roles use clean, stable ROLE_* abstract keys (24 system financial roles).
--   2. Master Chart of Accounts Template (کدینگ مجموعه):
--      Contains EXACTLY 51 accounts (49 existing + 2 approved new).
--      No dummy organization accounts generated automatically during migration.
--   3. Legacy Account Handling:
--      - SUB_REV_COMMISSION remains in 51 template accounts with is_active = FALSE
--        and label "[قدیمی - غیرقابل استفاده در ثبت جدید]". Not mapped to any active financial role.
--   4. Approved New Accounts:
--      - SUB_OTHER_REVENUE (Code: 60202, Title: "درآمد جریمه دیرکرد", Nature: Credit, Group: Revenues)
--      - SUB_INVESTOR_PAYABLES (Code: 20202, Title: "اصل سرمایه پرداختنی به سرمایه‌گذاران", Nature: Credit, Group: Liabilities)
--   5. Explicit Mapping Lifecycle & Permanent History Overlap Protection:
--      - Mapping status cycle defined: PLANNED (برنامه‌ریزی‌شده), CURRENT (جاری), EXPIRED (پایان‌یافته), CANCELLED (لغوشده پیش از شروع).
--      - Overlap exclusion constraint uses WHERE (status IN ('PLANNED', 'CURRENT', 'EXPIRED')), ensuring that
--        EXPIRED historical mappings remain permanently locked in the time-bound exclusion index.
--      - ONLY pre-start CANCELLED mappings (which had zero financial effect) are excluded from temporal checks.
--   6. Deletion Prohibition & Auditing:
--      Physical deletion of mapping records is strictly forbidden via trigger.
--   7. Secure Direct Client Mutation Lockdown:
--      Direct INSERT/UPDATE/DELETE on role mappings from browser clients is blocked in RLS,
--      reserving mutation exclusively for server-side trusted service operations.
-- ==============================================================================

-- Enable btree_gist extension for temporal exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ==============================================================================
-- HELPER FUNCTIONS & TRIGGERS
-- ==============================================================================

-- Trigger function to enforce versioning & updated_at on COA tables
CREATE OR REPLACE FUNCTION public.trg_increment_coa_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Trigger function to forbid deletion of system accounts
CREATE OR REPLACE FUNCTION public.prevent_system_account_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF OLD.is_system IS TRUE THEN
        RAISE EXCEPTION 'Physical deletion of system accounts is strictly forbidden.';
    END IF;
    RETURN OLD;
END;
$$;

-- Trigger function to forbid physical deletion of financial role mappings (Audit trail safety)
CREATE OR REPLACE FUNCTION public.prevent_role_mapping_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'Physical deletion of financial role mappings is strictly forbidden for audit preservation.';
    RETURN OLD;
END;
$$;

-- Trigger function to validate nature compatibility and organization ownership
CREATE OR REPLACE FUNCTION public.trg_validate_org_role_mapping_nature_and_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_role_nature TEXT;
    v_account_nature TEXT;
    v_account_org_id UUID;
BEGIN
    IF NEW.status = 'CANCELLED' THEN
        RETURN NEW;
    END IF;

    -- 1. Fetch role allowed nature
    SELECT allowed_nature INTO v_role_nature
    FROM public.system_financial_roles
    WHERE role_code = NEW.role_code;

    IF v_role_nature IS NULL THEN
        RAISE EXCEPTION 'Financial role % does not exist in system_financial_roles.', NEW.role_code;
    END IF;

    -- 2. Fetch account org ownership and group nature
    SELECT s.organization_id, g.nature INTO v_account_org_id, v_account_nature
    FROM public.account_subsidiaries s
    JOIN public.account_generals gen ON gen.id = s.general_id
    JOIN public.account_groups g ON g.id = gen.group_id
    WHERE s.id = NEW.subsidiary_id;

    IF v_account_org_id IS NULL THEN
        RAISE EXCEPTION 'Subsidiary account % does not exist.', NEW.subsidiary_id;
    END IF;

    -- 3. Validate org match
    IF v_account_org_id <> NEW.organization_id THEN
        RAISE EXCEPTION 'Cross-organization binding error: Account % (Org %) does not belong to mapping Org %.',
            NEW.subsidiary_id, v_account_org_id, NEW.organization_id;
    END IF;

    -- 4. Validate nature compatibility
    IF v_role_nature <> 'dual' AND v_account_nature <> 'dual' AND v_role_nature <> v_account_nature THEN
        RAISE EXCEPTION 'Nature mismatch: Role % requires % nature, but account has % nature.',
            NEW.role_code, v_role_nature, v_account_nature;
    END IF;

    RETURN NEW;
END;
$$;

-- ==============================================================================
-- 1. MASTER CHART OF ACCOUNTS TEMPLATE (الگوی کدینگ مجموعه)
-- ==============================================================================

-- Template Groups
CREATE TABLE IF NOT EXISTS public.master_account_groups_template (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name_fa TEXT NOT NULL,
    nature TEXT NOT NULL CHECK (nature IN ('debit', 'credit', 'dual')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Template Generals
CREATE TABLE IF NOT EXISTS public.master_account_generals_template (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_code TEXT NOT NULL REFERENCES public.master_account_groups_template(code) ON DELETE RESTRICT,
    code TEXT UNIQUE NOT NULL,
    name_fa TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Template Subsidiaries (EXACTLY 51 Accounts: 49 Existing + 2 Approved New)
CREATE TABLE IF NOT EXISTS public.master_account_subsidiaries_template (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    general_code TEXT NOT NULL REFERENCES public.master_account_generals_template(code) ON DELETE RESTRICT,
    system_key TEXT UNIQUE NOT NULL,
    code TEXT UNIQUE NOT NULL,
    name_fa TEXT NOT NULL,
    requires_person BOOLEAN NOT NULL DEFAULT false,
    requires_cost_center BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Master Template Groups
INSERT INTO public.master_account_groups_template (code, name_fa, nature) VALUES
('10', 'دارایی‌های جاری', 'debit'),
('20', 'بدهی‌های جاری', 'credit'),
('25', 'بدهی‌های غیرجاری', 'credit'),
('50', 'حقوق صاحبان سهام', 'credit'),
('60', 'درآمدها', 'credit'),
('70', 'هزینه‌ها', 'debit'),
('99', 'حساب‌های رابط و ترازها', 'dual')
ON CONFLICT (code) DO UPDATE SET name_fa = EXCLUDED.name_fa, nature = EXCLUDED.nature;

-- Seed Master Template Generals
INSERT INTO public.master_account_generals_template (group_code, code, name_fa) VALUES
('10', '101', 'موجودی نقد و صندوق'),
('10', '102', 'بانک‌ها و وجوه در راه'),
('10', '103', 'حساب‌ها و بدهکاران تجاری'),
('10', '104', 'اسناد دریافتنی و در جریان وصول'),
('10', '105', 'موجودی کالا و انبار'),
('10', '106', 'پیش‌پرداخت‌ها و دارایی‌های جاری'),
('20', '201', 'اسناد پرداختنی'),
('20', '202', 'حساب‌های پرداختنی و بستانکاران'),
('20', '203', 'پیش‌دریافت‌ها و مالیات فروش'),
('25', '204', 'تسهیلات و استقراض‌های دریافتی'),
('50', '501', 'سرمایه و حقوق صاحبان سهام'),
('60', '601', 'درآمد حاصل از فروش و خدمات'),
('60', '602', 'سایر درآمدهای عملیاتی و غیرعملیاتی'),
('70', '701', 'بهای تمام شده کالای فروش رفته'),
('70', '702', 'هزینه‌های عمومی و اداری'),
('70', '703', 'هزینه‌های مالی و بهره'),
('99', '999', 'تراز افتتاحیه و اختتامیه')
ON CONFLICT (code) DO UPDATE SET group_code = EXCLUDED.group_code, name_fa = EXCLUDED.name_fa;

-- Seed Master Template Subsidiaries (51 Total: 49 Existing + 2 Approved New)
INSERT INTO public.master_account_subsidiaries_template (general_code, system_key, code, name_fa, requires_person, requires_cost_center, is_active) VALUES
-- Cash & Banks (14)
('101', 'SUB_CASH_MAIN', '10101', 'صندوق اصلی ریالی', false, false, true),
('101', 'SUB_CASH_SHOP', '10102', 'صندوق فروشگاه', false, false, true),
('102', 'SUB_BANK_MELI', '10201', 'بانک ملی - حساب اصلی', false, false, true),
('102', 'SUB_BANK_MELI_INT', '10202', 'بانک ملی - واسط کارتخوان', false, false, true),
('102', 'SUB_BANK_MELLAT', '10203', 'بانک ملت - حساب اصلی', false, false, true),
('102', 'SUB_BANK_MELLAT_INT', '10204', 'بانک ملت - واسط کارتخوان', false, false, true),
('102', 'SUB_BANK_SADERAT', '10205', 'بانک صادرات - حساب اصلی', false, false, true),
('102', 'SUB_BANK_SADERAT_INT', '10206', 'بانک صادرات - واسط کارتخوان', false, false, true),
('102', 'SUB_BANK_PARSIAN', '10207', 'بانک پارسیان - حساب اصلی', false, false, true),
('102', 'SUB_BANK_PARSIAN_INT', '10208', 'بانک پارسیان - واسط کارتخوان', false, false, true),
('102', 'SUB_BANK_REFAH', '10209', 'بانک رفاه - حساب اصلی', false, false, true),
('102', 'SUB_BANK_REFAH_INT', '10210', 'بانک رفاه - واسط کارتخوان', false, false, true),
('102', 'SUB_BANK_IRANZAMIN', '10211', 'بانک ایران زمین - حساب اصلی', false, false, true),
('102', 'SUB_BANK_IRANZAMIN_INT', '10212', 'بانک ایران زمین - واسط کارتخوان', false, false, true),
-- Receivables (9)
('103', 'SUB_DEBTORS', '10301', 'حساب‌های دریافتنی (بدهکاران تجاری)', true, false, true),
('103', 'SUB_DEBTORS_INSTALLMENT', '10302', 'بدهکاران اقساطی', true, false, true),
('103', 'SUB_PARTNER_WALLET', '10303', 'کیف پول و حساب واسط همکاران', true, false, true),
('103', 'SUB_DEBTORS_AGENTS', '10304', 'حساب‌های دریافتنی (نمایندگان فروش)', true, false, true),
('103', 'SUB_BETA_SYSTEM', '10305', 'حساب واسط عمومی سامانه بتا (بانک رفاه)', true, false, true),
('103', 'SUB_BETA_MEHDI', '10306', 'حساب واسط سامانه بتا (قرارداد مهدی)', true, false, true),
('103', 'SUB_BETA_MANSOURI', '10307', 'حساب واسط سامانه بتا (قرارداد منصوری)', true, false, true),
('103', 'SUB_BETA_HAMID', '10308', 'حساب واسط سامانه بتا (قرارداد حمید)', true, false, true),
('103', 'SUB_BETA_JAFARI', '10309', 'حساب واسط سامانه بتا (قرارداد جعفری)', true, false, true),
-- Cheques & Inventory & Prepayments (6)
('104', 'SUB_CHECKS_REC', '10401', 'اسناد دریافتنی (چک‌های صندوق)', false, false, true),
('104', 'SUB_CHECKS_TRANSIT', '10402', 'اسناد در جریان وصول (واگذار شده)', false, false, true),
('105', 'SUB_INVENTORY', '10501', 'موجودی کالا (انبار)', false, false, true),
('106', 'SUB_PRE_PAY', '10601', 'پیش‌پرداخت‌ها', false, false, true),
('106', 'SUB_VAT_BUY', '10602', 'مالیات بر ارزش افزوده خرید', false, false, true),
('106', 'SUB_DEFERRED_FEE', '10603', 'کارمزد در انتظار تحقق', false, false, true),
-- Liabilities & Payables (5 Existing + 1 New Approved)
('201', 'SUB_CHECKS_PAY', '20101', 'اسناد پرداختنی (چک‌های صادرشده)', false, false, true),
('202', 'SUB_CREDITORS', '20201', 'حساب‌های پرداختنی (بستانکاران)', true, false, true),
('202', 'SUB_INVESTOR_PAYABLES', '20202', 'اصل سرمایه پرداختنی به سرمایه‌گذاران', true, false, true), -- NEW APPROVED #1
('203', 'SUB_PRE_REC', '20301', 'پیش‌دریافت‌ها', true, false, true),
('203', 'SUB_VAT_SELL', '20302', 'مالیات بر ارزش افزوده فروش', false, false, true),
('204', 'SUB_LIAB_LOANS', '20401', 'تسهیلات و استقراض‌های دریافتی', false, false, true),
-- Equity (2)
('501', 'SUB_EQUITY', '50101', 'سرمایه اولیه', false, false, true),
('501', 'SUB_INVESTORS', '50102', 'جاری شرکا و سرمایه‌گذاران', true, false, true),
-- Revenues (3 Active Existing + 1 Legacy Inactive + 1 New Approved)
('601', 'SUB_REVENUE', '60101', 'فروش کالا و خدمات', false, false, true),
('601', 'SUB_COMMISSION_REV', '60102', 'درآمد کارمزد فروش اقساطی', false, false, true),
('601', 'SUB_INTEREST_INCOME', '60103', 'درآمد حاصل از سود اقساط', false, false, true),
('602', 'SUB_REV_COMMISSION', '60201', 'درآمد کارمزد فروش چکی و نسیه [قدیمی - غیرقابل استفاده در ثبت جدید]', false, false, false), -- LEGACY INACTIVE
('602', 'SUB_OTHER_REVENUE', '60202', 'درآمد جریمه دیرکرد', false, false, true), -- NEW APPROVED #2
-- Expenses (8)
('701', 'SUB_COGS', '70101', 'بهای تمام شده کالای فروش رفته', false, false, true),
('702', 'SUB_EXP_SALARY', '70201', 'هزینه حقوق و دستمزد', false, true, true),
('702', 'SUB_EXP_BILLS', '70202', 'هزینه قبوض (آب و برق و تلفن)', false, true, true),
('702', 'SUB_EXP_RENT', '70203', 'هزینه اجاره غرفه/فروشگاه', false, true, true),
('702', 'SUB_EXP_MISC', '70204', 'سایر هزینه‌های عمومی و اداری', false, true, true),
('702', 'SUB_EXP_CATERING', '70205', 'هزینه چای، پذیرایی و آبدارخانه', false, true, true),
('702', 'SUB_EXP_TRANSPORT', '70206', 'هزینه باربری و حمل و نقل', false, true, true),
('703', 'SUB_EXP_FIN_INTEREST', '70301', 'هزینه مالی و بهره پرداختی (سود پول)', false, false, true),
-- Opening Balance (1)
('999', 'SUB_OPENING_BAL', '99901', 'تراز افتتاحیه اول دوره', false, false, true)
ON CONFLICT (system_key) DO UPDATE SET
    general_code = EXCLUDED.general_code,
    code = EXCLUDED.code,
    name_fa = EXCLUDED.name_fa,
    requires_person = EXCLUDED.requires_person,
    requires_cost_center = EXCLUDED.requires_cost_center,
    is_active = EXCLUDED.is_active;

-- ==============================================================================
-- 2. STATIC SYSTEM FINANCIAL ROLES CATALOG (نقش‌های مالی ثابت - کلیدهای انتزاعی ROLE_*)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.system_financial_roles (
    role_code TEXT PRIMARY KEY, -- Abstract key format (ROLE_*)
    role_name_fa TEXT NOT NULL,
    allowed_nature TEXT NOT NULL CHECK (allowed_nature IN ('debit', 'credit', 'dual')),
    requires_person BOOLEAN NOT NULL DEFAULT false,
    requires_cost_center BOOLEAN NOT NULL DEFAULT false,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.system_financial_roles IS 'Global immutable catalog of 24 abstract system financial roles referenced by automated engines.';

-- Seed static system financial role definitions (24 Abstract Financial Roles)
INSERT INTO public.system_financial_roles (role_code, role_name_fa, allowed_nature, requires_person, requires_cost_center, description) VALUES
('ROLE_CASH_MAIN', 'صندوق پیش‌فرض سازمان', 'debit', false, false, 'حساب اصلی صندوق برای دریافت‌ها و پرداخت‌های نقد'),
('ROLE_BANK_MAIN', 'بانک پیش‌فرض سازمان', 'debit', false, false, 'حساب اصلی بانکی برای تراکنش‌های واریز و برداشت و فیش'),
('ROLE_DEBTORS', 'دریافتنی تجاری (بدهکاران)', 'debit', true, false, 'مطالبات تجاری ناشی از فروش نسیه و عمومی خریداران'),
('ROLE_DEBTORS_INSTALLMENT', 'دریافتنی اقساطی', 'debit', true, false, 'مطالبات تجاری پرونده‌های اعتباری و اقساط مشتریان'),
('ROLE_DEBTORS_AGENTS', 'دریافتنی نماینده / عاملیت‌ها', 'debit', true, false, 'مطالبات و تسویه‌حساب‌های نمایندگان فروش و جریمه‌های دیرکرد'),
('ROLE_PARTNER_WALLET', 'کیف پول و حساب واسط همکار', 'dual', true, false, 'حساب کیف پول همکاران و تسویه‌حساب‌های شارژ درونی'),
('ROLE_CHECKS_REC', 'اسناد و چک‌های دریافتنی', 'debit', false, false, 'چک‌های دریافتنی تجاری موجود در صندوق'),
('ROLE_CHECKS_TRANSIT', 'اسناد در جریان وصول', 'debit', false, false, 'چک‌های واگذار شده به بانک در انتظار وصول'),
('ROLE_INVENTORY', 'موجودی کالا (انبار)', 'debit', false, false, 'موجودی کالای خریده‌شده و آماده فروش'),
('ROLE_PRE_PAY', 'پیش‌پرداخت‌ها', 'debit', false, false, 'پیش‌پرداخت خرید کالا و خدمات'),
('ROLE_VAT_BUY', 'مالیات بر ارزش افزوده خرید', 'debit', false, false, 'مالیات و عوارض خرید قابلاسترداد'),
('ROLE_DEFERRED_FEE', 'کارمزد در انتظار تحقق', 'debit', false, false, 'پیش‌پرداخت کارمزد و سود سال‌های آتی پرونده‌ها و سرمایه‌گذاران'),
('ROLE_CHECKS_PAY', 'اسناد و چک‌های پرداختنی', 'credit', false, false, 'چک‌های عهده سازمان صادرشده نزد اشخاص و سرمایه‌گذاران'),
('ROLE_CREDITORS', 'بستانکاران تجاری (حساب‌های پرداختنی)', 'credit', true, false, 'بدهی‌های تجاری به تامین‌کنندگان و بستانکاران متفرقه'),
('ROLE_PRE_REC', 'پیش‌دریافت‌ها', 'credit', true, false, 'پیش‌دریافت‌های نقدی قبل از تحویل کالا'),
('ROLE_VAT_SELL', 'مالیات بر ارزش افزوده فروش', 'credit', false, false, 'مالیات و عوارض فروش وصولی جهت پرداخت به سازمان امور مالیاتی'),
('ROLE_REVENUE', 'درآمد فروش کالا و خدمات', 'credit', false, false, 'درآمد حاصل از فروش کالا و ارائه خدمات اصلی'),
('ROLE_COMMISSION_REV', 'درآمد کارمزد فروش اقساطی', 'credit', false, false, 'درآمد کارمزد پرونده‌های اقساطی'),
('ROLE_LATE_PENALTY_REV', 'درآمد جریمه دیرکرد', 'credit', false, false, 'درآمد حاصل از جریمه‌های دیرکرد پرداختی پس از تأیید مدیریت'),
('ROLE_COGS', 'بهای تمام‌شده کالای فروش‌رفته', 'debit', false, false, 'بهای تمام‌شده کالاها در زمان خروج از انبار و ثبت فروش'),
('ROLE_EXP_FIN_INTEREST', 'هزینه مالی و بهره پرداختی', 'debit', false, false, 'هزینه بهره، سود پرداختی به سرمایه‌گذاران و کارمزدهای مالی'),
('ROLE_INTEREST_INCOME', 'درآمد حاصل از سود اقساط', 'credit', false, false, 'درآمد حاصل از سود اقساط دریافتی از مشتریان'),
('ROLE_INVESTOR_PAYABLES', 'اصل سرمایه پرداختنی به سرمایه‌گذاران', 'credit', true, false, 'بدهی بدهکار بابت اصل سرمایه دریافتی از سرمایه‌گذاران'),
('ROLE_OPENING_BAL', 'تراز افتتاحیه اول دوره', 'dual', false, false, 'حساب واسط ثبت مانده‌های اول دوره')
ON CONFLICT (role_code) DO UPDATE SET
    role_name_fa = EXCLUDED.role_name_fa,
    allowed_nature = EXCLUDED.allowed_nature,
    requires_person = EXCLUDED.requires_person,
    requires_cost_center = EXCLUDED.requires_cost_center,
    description = EXCLUDED.description;

-- ==============================================================================
-- 3. ORGANIZATION COA TABLES (جدول‌های کدینگ حساب‌های واقعی سازمان)
-- ==============================================================================

-- Account Groups per Org
CREATE TABLE IF NOT EXISTS public.account_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    nature TEXT NOT NULL CHECK (nature IN ('debit', 'credit', 'dual')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_system BOOLEAN NOT NULL DEFAULT false,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_account_group_org_composite UNIQUE (organization_id, id),
    CONSTRAINT uq_account_group_code_per_org UNIQUE (organization_id, code)
);

-- Account Generals per Org
CREATE TABLE IF NOT EXISTS public.account_generals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    group_id UUID NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_system BOOLEAN NOT NULL DEFAULT false,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_account_general_org_composite UNIQUE (organization_id, id),
    CONSTRAINT uq_account_general_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT fk_account_general_group FOREIGN KEY (organization_id, group_id)
        REFERENCES public.account_groups(organization_id, id) ON DELETE RESTRICT
);

-- Account Subsidiaries per Org
CREATE TABLE IF NOT EXISTS public.account_subsidiaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    general_id UUID NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    system_key TEXT, -- Optional system key copied from template
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_system BOOLEAN NOT NULL DEFAULT false,
    requires_person BOOLEAN NOT NULL DEFAULT false,
    requires_cost_center BOOLEAN NOT NULL DEFAULT false,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_account_subsidiary_org_composite UNIQUE (organization_id, id),
    CONSTRAINT uq_account_subsidiary_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT fk_account_subsidiary_general FOREIGN KEY (organization_id, general_id)
        REFERENCES public.account_generals(organization_id, id) ON DELETE RESTRICT
);

-- Partial unique index for system_key per organization
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_subsidiary_system_key_per_org
ON public.account_subsidiaries(organization_id, system_key)
WHERE system_key IS NOT NULL;

-- ==============================================================================
-- 4. ORGANIZATION FINANCIAL ROLE MAPPINGS (اتصال زمان‌دار نقش‌های مالی به حساب‌های واقعی)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.org_financial_role_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    role_code TEXT NOT NULL REFERENCES public.system_financial_roles(role_code) ON DELETE RESTRICT,
    subsidiary_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('PLANNED', 'CURRENT', 'EXPIRED', 'CANCELLED')),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to TIMESTAMPTZ,
    validity_range tstzrange GENERATED ALWAYS AS (tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)')) STORED,
    change_reason TEXT,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_role_mapping_subsidiary FOREIGN KEY (organization_id, subsidiary_id)
        REFERENCES public.account_subsidiaries(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT ex_org_role_mapping_no_overlap EXCLUDE USING gist (
        organization_id WITH =,
        role_code WITH =,
        validity_range WITH &&
    ) WHERE (status IN ('PLANNED', 'CURRENT', 'EXPIRED'))
);

COMMENT ON TABLE public.org_financial_role_mappings IS 'Time-bound mappings connecting abstract system financial roles (ROLE_*) to organization real subsidiary accounts with lifecycle states and GIST concurrency exclusion.';

-- Register nature, org validation and deletion triggers
DROP TRIGGER IF EXISTS trg_validate_org_role_mapping_nature_and_org ON public.org_financial_role_mappings;
CREATE TRIGGER trg_validate_org_role_mapping_nature_and_org
BEFORE INSERT OR UPDATE ON public.org_financial_role_mappings
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_org_role_mapping_nature_and_org();

DROP TRIGGER IF EXISTS trg_prevent_role_mapping_deletion ON public.org_financial_role_mappings;
CREATE TRIGGER trg_prevent_role_mapping_deletion
BEFORE DELETE ON public.org_financial_role_mappings
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_mapping_deletion();

-- ==============================================================================
-- INDEXES FOR PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_account_groups_org ON public.account_groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_generals_org ON public.account_generals(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_generals_group ON public.account_generals(group_id);
CREATE INDEX IF NOT EXISTS idx_account_subsidiaries_org ON public.account_subsidiaries(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_subsidiaries_general ON public.account_subsidiaries(general_id);
CREATE INDEX IF NOT EXISTS idx_org_role_mappings_org_role ON public.org_financial_role_mappings(organization_id, role_code);

-- ==============================================================================
-- TRIGGERS REGISTRATION FOR VERSIONING & DELETION SAFETY
-- ==============================================================================
DROP TRIGGER IF EXISTS trg_account_groups_version ON public.account_groups;
CREATE TRIGGER trg_account_groups_version BEFORE UPDATE ON public.account_groups FOR EACH ROW EXECUTE FUNCTION public.trg_increment_coa_version();

DROP TRIGGER IF EXISTS trg_account_generals_version ON public.account_generals;
CREATE TRIGGER trg_account_generals_version BEFORE UPDATE ON public.account_generals FOR EACH ROW EXECUTE FUNCTION public.trg_increment_coa_version();

DROP TRIGGER IF EXISTS trg_account_subsidiaries_version ON public.account_subsidiaries;
CREATE TRIGGER trg_account_subsidiaries_version BEFORE UPDATE ON public.account_subsidiaries FOR EACH ROW EXECUTE FUNCTION public.trg_increment_coa_version();

DROP TRIGGER IF EXISTS trg_org_role_mappings_version ON public.org_financial_role_mappings;
CREATE TRIGGER trg_org_role_mappings_version BEFORE UPDATE ON public.org_financial_role_mappings FOR EACH ROW EXECUTE FUNCTION public.trg_increment_coa_version();

-- Prevent deletion triggers for system accounts
DROP TRIGGER IF EXISTS trg_prevent_group_deletion ON public.account_groups;
CREATE TRIGGER trg_prevent_group_deletion BEFORE DELETE ON public.account_groups FOR EACH ROW EXECUTE FUNCTION public.prevent_system_account_deletion();

DROP TRIGGER IF EXISTS trg_prevent_general_deletion ON public.account_generals;
CREATE TRIGGER trg_prevent_general_deletion BEFORE DELETE ON public.prevent_system_account_deletion();

DROP TRIGGER IF EXISTS trg_prevent_subsidiary_deletion ON public.account_subsidiaries;
CREATE TRIGGER trg_prevent_subsidiary_deletion BEFORE DELETE ON public.account_subsidiaries FOR EACH ROW EXECUTE FUNCTION public.prevent_system_account_deletion();

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.master_account_groups_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_account_generals_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_account_subsidiaries_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_financial_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_generals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_subsidiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_financial_role_mappings ENABLE ROW LEVEL SECURITY;

-- Master Template Read Policies
CREATE POLICY "Authenticated users can view master template groups"
ON public.master_account_groups_template FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can view master template generals"
ON public.master_account_generals_template FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can view master template subsidiaries"
ON public.master_account_subsidiaries_template FOR SELECT TO authenticated USING (true);

-- System Financial Roles (Global Catalog Read)
CREATE POLICY "Authenticated users can view system financial roles"
ON public.system_financial_roles FOR SELECT TO authenticated USING (true);

-- Account Groups Policies
CREATE POLICY "Active org members can view account groups"
ON public.account_groups FOR SELECT TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Authorized members can manage account groups"
ON public.account_groups FOR ALL TO authenticated
USING (public.is_org_member(organization_id) AND (public.has_permission(organization_id, 'users:manage') OR public.has_permission(organization_id, 'accounting:manage')))
WITH CHECK (public.is_org_member(organization_id) AND (public.has_permission(organization_id, 'users:manage') OR public.has_permission(organization_id, 'accounting:manage')));

-- Account Generals Policies
CREATE POLICY "Active org members can view account generals"
ON public.account_generals FOR SELECT TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Authorized members can manage account generals"
ON public.account_generals FOR ALL TO authenticated
USING (public.is_org_member(organization_id) AND (public.has_permission(organization_id, 'users:manage') OR public.has_permission(organization_id, 'accounting:manage')))
WITH CHECK (public.is_org_member(organization_id) AND (public.has_permission(organization_id, 'users:manage') OR public.has_permission(organization_id, 'accounting:manage')));

-- Account Subsidiaries Policies
CREATE POLICY "Active org members can view account subsidiaries"
ON public.account_subsidiaries FOR SELECT TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Authorized members can manage account subsidiaries"
ON public.account_subsidiaries FOR ALL TO authenticated
USING (public.is_org_member(organization_id) AND (public.has_permission(organization_id, 'users:manage') OR public.has_permission(organization_id, 'accounting:manage')))
WITH CHECK (public.is_org_member(organization_id) AND (public.has_permission(organization_id, 'users:manage') OR public.has_permission(organization_id, 'accounting:manage')));

-- Org Financial Role Mappings Policies (Client Direct Mutation Locked Down)
CREATE POLICY "Active org members can view role mappings"
ON public.org_financial_role_mappings FOR SELECT TO authenticated
USING (public.is_org_member(organization_id));

-- Direct INSERT/UPDATE/DELETE from browser client is blocked.
-- Role mapping state transitions must be conducted strictly via upcoming secure server-side services.
CREATE POLICY "Direct client mutation of role mappings is strictly forbidden"
ON public.org_financial_role_mappings FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY "Direct client update of role mappings is strictly forbidden"
ON public.org_financial_role_mappings FOR UPDATE TO authenticated
USING (false);

CREATE POLICY "Direct client deletion of role mappings is strictly forbidden"
ON public.org_financial_role_mappings FOR DELETE TO authenticated
USING (false);

COMMIT;
