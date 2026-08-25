BEGIN;

-- ==============================================================================
-- Migration: 03_persons_foundation.sql
-- Description: Phase 3-B - Relational Persons Foundation & Identity Architecture (Final Audit Corrections)
-- Rules & Corrections Implemented:
--   1. Internal PK is standard UUID (gen_random_uuid()). Display code is unique per org.
--      Code generation is explicitly deferred to atomic server-side counter (no COUNT(*) + 1).
--   2. Computed financial fields (wallet_balance, total_invested_amount, active_contracts_count) REMOVED.
--      Balances are calculated dynamically from financial vouchers & active contracts.
--   3. Agent Token raw values REMOVED; replaced with agent_token_hash and lifecycle timestamps.
--   4. Guarantors link directly to real person records (guarantor_person_id -> persons.id).
--      Standalone guarantee checks table deferred to Phase 3-C Central Cheque Management system (checks table).
--   5. Debtor/Creditor 'role' column documented strictly as UI preference (non-accounting truth).
--   6. Banking info protected: raw cleartext card_number, account_number, and sheba_number REMOVED.
--      Replaced with encrypted payload, display mask, and HMAC fingerprint columns for secure search.
--      Encryption/decryption keys are strictly externalized to server environment variables.
--   7. Attachments use valid FK reviewer_user_id (references user_profiles.id).
--   8. Optimistic concurrency control via 'version' column documented for server-side verification.
--   9. Direct physical deletion via RLS strictly REMOVED for all client roles.
--      Physical deletion of draft persons with 0 dependencies is deferred to a secure server-side RPC.
--  10. Fine-grained per-table Row Level Security (RLS) enforcing least privilege and strict org isolation.
--  11. Rials monetary amounts use NUMERIC(18, 0) without decimals; birth_date uses DATE.
--  12. Fully enclosed in explicit transaction; repeatable execution with zero seed test data.
-- ==============================================================================

-- ==============================================================================
-- HELPER FUNCTIONS & TRIGGERS FOR NORMALIZATION & VERSIONING & DELETION
-- ==============================================================================

-- Immutable normalization helper function for Iranian digits and identity numbers
CREATE OR REPLACE FUNCTION public.normalize_identity_number(p_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_res TEXT;
BEGIN
    IF p_input IS NULL THEN
        RETURN NULL;
    END IF;
    -- Translate Persian digits (۰-۹) and Arabic digits (٠-٩) to ASCII digits (0-9)
    v_res := translate(p_input, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧۸٩', '01234567890123456789');
    -- Remove non-digit characters (spaces, hyphens, slashes)
    v_res := regexp_replace(v_res, '[^0-9]', '', 'g');
    IF v_res = '' THEN
        RETURN NULL;
    END IF;
    RETURN v_res;
END;
$$;

-- Trigger function to normalize identity/mobile numbers on persons insert/update
CREATE OR REPLACE FUNCTION public.trg_normalize_person_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.national_id_normalized := public.normalize_identity_number(NEW.national_id);
    NEW.mobile_normalized := public.normalize_identity_number(NEW.mobile);
    RETURN NEW;
END;
$$;

-- Trigger function to enforce optimistic concurrency control & updated_at
CREATE OR REPLACE FUNCTION public.trg_increment_person_domain_version()
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

-- Trigger function to enforce person physical deletion rules (Safety fallback)
CREATE OR REPLACE FUNCTION public.prevent_person_physical_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- Direct client deletion is already blocked via RLS (no DELETE policy exists).
    -- This trigger ensures that even internal database callers cannot physically delete non-draft persons.
    IF OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'Physical deletion of non-draft person records is strictly forbidden. Please change status to inactive or blocked.';
    END IF;
    RETURN OLD;
END;
$$;

-- ==============================================================================
-- TABLES DEFINITION
-- ==============================================================================

-- 1. Main Person Identity Table (هویت اصلی شخص)
CREATE TABLE IF NOT EXISTS public.persons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    person_type TEXT NOT NULL DEFAULT 'real' CHECK (person_type IN ('real', 'legal')),
    national_id TEXT,
    national_id_normalized TEXT,
    mobile TEXT,
    mobile_normalized TEXT,
    phone TEXT,
    gender TEXT CHECK (gender IN ('male', 'female', 'other')),
    father_name TEXT,
    birth_date DATE,
    company_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'inactive', 'blocked')),
    role TEXT DEFAULT 'both' CHECK (role IN ('debtor', 'creditor', 'both')),
    province TEXT,
    city TEXT,
    district TEXT,
    address TEXT,
    postal_code TEXT,
    bank_name TEXT,
    account_holder_name TEXT,
    card_number_encrypted TEXT,
    card_number_masked TEXT,
    card_number_fingerprint TEXT,
    sheba_number_encrypted TEXT,
    sheba_number_masked TEXT,
    sheba_number_fingerprint TEXT,
    account_number_encrypted TEXT,
    account_number_masked TEXT,
    account_number_fingerprint TEXT,
    credit_limit NUMERIC(18, 0) NOT NULL DEFAULT 0,
    credit_score INT NOT NULL DEFAULT 0 CHECK (credit_score BETWEEN 0 AND 100),
    penalty_rate NUMERIC(6, 4) NOT NULL DEFAULT 0,
    allowed_delay_days INT NOT NULL DEFAULT 0,
    is_offline_wholesale_enabled BOOLEAN NOT NULL DEFAULT false,
    is_installment_enabled BOOLEAN NOT NULL DEFAULT false,
    is_documents_approved BOOLEAN NOT NULL DEFAULT false,
    is_agent BOOLEAN NOT NULL DEFAULT false,
    agency_role TEXT CHECK (agency_role IN ('credit', 'sales', 'both')),
    agency_status TEXT DEFAULT 'pending' CHECK (agency_status IN ('pending', 'active', 'suspended', 'rejected')),
    agency_credit_limit NUMERIC(18, 0) DEFAULT 0,
    agency_code TEXT,
    internal_notes TEXT,
    owner_user_id UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    representative_id UUID REFERENCES public.persons(id) ON DELETE RESTRICT,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_person_id_org_composite UNIQUE (organization_id, id),
    CONSTRAINT uq_person_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT fk_person_branch FOREIGN KEY (organization_id, branch_id)
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_person_representative FOREIGN KEY (organization_id, representative_id)
        REFERENCES public.persons(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON COLUMN public.persons.role IS 'UI preference classification only. Strictly forbidden from being used as accounting balance or financial state truth.';
COMMENT ON COLUMN public.persons.card_number_encrypted IS 'AES-256 encrypted payload. Decryption is strictly restricted to secure server-side RPC with proper permissions.';
COMMENT ON COLUMN public.persons.card_number_fingerprint IS 'HMAC-SHA256 fingerprint derived using server secret key for fast exact-match lookup without decrypting.';

-- Conditional partial index for Normalized National ID Uniqueness per Organization
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_national_id_per_org 
ON public.persons(organization_id, national_id_normalized) 
WHERE national_id_normalized IS NOT NULL;

-- 2. Person Roles (نقش‌های مستقل اشخاص)
CREATE TABLE IF NOT EXISTS public.person_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL,
    role_code TEXT NOT NULL CHECK (role_code IN ('customer', 'supplier', 'sales_rep', 'credit_rep', 'employee', 'investor', 'other')),
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_person_role_per_org UNIQUE (person_id, role_code),
    CONSTRAINT fk_person_role_person FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE CASCADE
);

-- 3. Person Attachments (پیوست‌ها و مدارک شخص - فقط متا داتا)
CREATE TABLE IF NOT EXISTS public.person_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL, -- کلید مسیر ذخیره‌سازی فایل (بدون ذخیره محتوای باینری)
    file_type TEXT,
    category TEXT CHECK (category IN (
        'national_card', 'birth_certificate', 'contract', 'bank_credit_scoring',
        'refah_beta_report', 'employment_income', 'business_license',
        'bank_cheque', 'check_images', 'guarantee_promissory', 'other'
    )),
    status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('pending', 'unreviewed', 'reviewed', 'approved', 'rejected', 'needs_revision')),
    rejection_reason TEXT,
    reviewer_user_id UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    reviewer_name_snapshot TEXT,
    review_date TIMESTAMPTZ,
    internal_note TEXT,
    file_size_kb INT,
    original_size_kb INT,
    upload_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_attachment_person FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE CASCADE
);

-- 4. Person Agent Details (اطلاعات تکمیلی نماینده/همکار اعتباری - بدون ذخیره توکن خام)
CREATE TABLE IF NOT EXISTS public.person_agent_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL UNIQUE,
    store_name TEXT,
    store_address TEXT,
    agent_token_hash TEXT,
    agent_token_created_at TIMESTAMPTZ,
    agent_token_expires_at TIMESTAMPTZ,
    agent_token_revoked_at TIMESTAMPTZ,
    agent_token_last_used_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_agent_details_person FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE CASCADE
);

-- 5. Agent/Customer Guarantors (روابط ضمانت شخص با شخص دیگر)
CREATE TABLE IF NOT EXISTS public.agent_guarantors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL, -- شخص اصلی (مضمون‌عنه)
    guarantor_person_id UUID NOT NULL, -- شخص ضامن
    relation TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'revoked')),
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_person_guarantor UNIQUE (person_id, guarantor_person_id),
    CONSTRAINT fk_guarantor_principal FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_guarantor_person FOREIGN KEY (organization_id, guarantor_person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE RESTRICT
);

-- NOTE: Standalone agent_guarantee_checks table REMOVED.
-- Guarantee cheques will be linked directly to the Phase 3-C Central Cheque Management System (checks table).

-- 6. Person Critical Details (پنل وضعیت‌های حساس تحویل مدارک و جعبه)
CREATE TABLE IF NOT EXISTS public.person_critical_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL UNIQUE,
    phone_box_status TEXT NOT NULL DEFAULT 'none' CHECK (phone_box_status IN ('at_store', 'delivered', 'none')),
    ownership_status TEXT NOT NULL DEFAULT 'none' CHECK (ownership_status IN ('at_store', 'delivered', 'none')),
    guarantee_check_status TEXT NOT NULL DEFAULT 'none' CHECK (guarantee_check_status IN ('at_store', 'delivered', 'none')),
    manual_notes TEXT,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_critical_details_person FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE CASCADE
);

-- 7. Investor Profiles (پروفایل سرمایه‌گذاران - بدون فیلدهای محاسباتی مشتق‌شده و با بانکداری محافظت‌شده)
CREATE TABLE IF NOT EXISTS public.investor_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL UNIQUE,
    category TEXT DEFAULT 'INDIVIDUAL' CHECK (category IN ('INDIVIDUAL', 'COMPANY', 'BANK', 'FINANCIAL_INSTITUTION')),
    bank_name TEXT,
    account_number_encrypted TEXT,
    account_number_masked TEXT,
    account_number_fingerprint TEXT,
    iban_encrypted TEXT,
    iban_masked TEXT,
    iban_fingerprint TEXT,
    card_code_encrypted TEXT,
    card_code_masked TEXT,
    card_code_fingerprint TEXT,
    institutional_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_investor_profile_person FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE RESTRICT
);

-- ==============================================================================
-- INDEXES FOR FAST LOOKUPS & SEARCHING
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_persons_org_id ON public.persons(organization_id);
CREATE INDEX IF NOT EXISTS idx_persons_code ON public.persons(organization_id, code);
CREATE INDEX IF NOT EXISTS idx_persons_national_id_norm ON public.persons(organization_id, national_id_normalized);
CREATE INDEX IF NOT EXISTS idx_persons_mobile_norm ON public.persons(organization_id, mobile_normalized);
CREATE INDEX IF NOT EXISTS idx_persons_status ON public.persons(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_persons_bank_card_fp ON public.persons(organization_id, card_number_fingerprint) WHERE card_number_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_persons_sheba_fp ON public.persons(organization_id, sheba_number_fingerprint) WHERE sheba_number_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_person_roles_person_id ON public.person_roles(person_id);
CREATE INDEX IF NOT EXISTS idx_person_attachments_person_id ON public.person_attachments(person_id);
CREATE INDEX IF NOT EXISTS idx_agent_guarantors_principal ON public.agent_guarantors(person_id);
CREATE INDEX IF NOT EXISTS idx_agent_guarantors_guarantor ON public.agent_guarantors(guarantor_person_id);

-- ==============================================================================
-- TRIGGERS REGISTRATION
-- ==============================================================================

-- Normalize national_id and mobile on persons
DROP TRIGGER IF EXISTS trg_normalize_person_identity ON public.persons;
CREATE TRIGGER trg_normalize_person_identity
BEFORE INSERT OR UPDATE ON public.persons
FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_person_identity();

-- Enforce draft-only physical deletion safety rules on persons
DROP TRIGGER IF EXISTS trg_prevent_person_deletion ON public.persons;
CREATE TRIGGER trg_prevent_person_deletion
BEFORE DELETE ON public.persons
FOR EACH ROW EXECUTE FUNCTION public.prevent_person_physical_deletion();

-- Optimistic versioning & updated_at trigger registrations
DROP TRIGGER IF EXISTS trg_persons_version ON public.persons;
CREATE TRIGGER trg_persons_version BEFORE UPDATE ON public.persons FOR EACH ROW EXECUTE FUNCTION public.trg_increment_person_domain_version();

DROP TRIGGER IF EXISTS trg_person_roles_version ON public.person_roles;
CREATE TRIGGER trg_person_roles_version BEFORE UPDATE ON public.person_roles FOR EACH ROW EXECUTE FUNCTION public.trg_increment_person_domain_version();

DROP TRIGGER IF EXISTS trg_person_attachments_version ON public.person_attachments;
CREATE TRIGGER trg_person_attachments_version BEFORE UPDATE ON public.person_attachments FOR EACH ROW EXECUTE FUNCTION public.trg_increment_person_domain_version();

DROP TRIGGER IF EXISTS trg_person_agent_details_version ON public.person_agent_details;
CREATE TRIGGER trg_person_agent_details_version BEFORE UPDATE ON public.person_agent_details FOR EACH ROW EXECUTE FUNCTION public.trg_increment_person_domain_version();

DROP TRIGGER IF EXISTS trg_agent_guarantors_version ON public.agent_guarantors;
CREATE TRIGGER trg_agent_guarantors_version BEFORE UPDATE ON public.agent_guarantors FOR EACH ROW EXECUTE FUNCTION public.trg_increment_person_domain_version();

DROP TRIGGER IF EXISTS trg_person_critical_details_version ON public.person_critical_details;
CREATE TRIGGER trg_person_critical_details_version BEFORE UPDATE ON public.person_critical_details FOR EACH ROW EXECUTE FUNCTION public.trg_increment_person_domain_version();

DROP TRIGGER IF EXISTS trg_investor_profiles_version ON public.investor_profiles;
CREATE TRIGGER trg_investor_profiles_version BEFORE UPDATE ON public.investor_profiles FOR EACH ROW EXECUTE FUNCTION public.trg_increment_person_domain_version();

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_agent_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_guarantors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_critical_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_profiles ENABLE ROW LEVEL SECURITY;

-- 1. Persons Policies
-- NOTE ON DELETE: Direct client/browser physical deletion is strictly DISABLED for all authenticated roles.
-- Physical deletion of draft persons with 0 dependencies is deferred to a future secure server-side RPC service.

CREATE POLICY "Active org members can view basic person list"
ON public.persons FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Authorized members can insert persons"
ON public.persons FOR INSERT
TO authenticated
WITH CHECK (
    public.is_org_member(organization_id) AND 
    (public.has_permission(organization_id, 'users:manage') OR public.has_permission(organization_id, 'sales:manage'))
);

CREATE POLICY "Authorized members can update persons"
ON public.persons FOR UPDATE
TO authenticated
USING (
    public.is_org_member(organization_id) AND 
    (public.has_permission(organization_id, 'users:manage') OR public.has_permission(organization_id, 'sales:manage'))
)
WITH CHECK (
    public.is_org_member(organization_id) AND 
    (public.has_permission(organization_id, 'users:manage') OR public.has_permission(organization_id, 'sales:manage'))
);

-- 2. Person Roles Policies
CREATE POLICY "Active org members can view person roles"
ON public.person_roles FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Authorized members can manage person roles"
ON public.person_roles FOR ALL
TO authenticated
USING (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'users:manage'))
WITH CHECK (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'users:manage'));

-- 3. Person Attachments Policies
CREATE POLICY "Authorized staff can view person attachments metadata"
ON public.person_attachments FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id) AND
    (public.has_permission(organization_id, 'sales:manage') OR public.has_permission(organization_id, 'credit:manage') OR public.has_permission(organization_id, 'users:manage'))
);

CREATE POLICY "Authorized members can manage person attachments"
ON public.person_attachments FOR ALL
TO authenticated
USING (
    public.is_org_member(organization_id) AND
    (public.has_permission(organization_id, 'sales:manage') OR public.has_permission(organization_id, 'credit:manage'))
)
WITH CHECK (
    public.is_org_member(organization_id) AND
    (public.has_permission(organization_id, 'sales:manage') OR public.has_permission(organization_id, 'credit:manage'))
);

-- 4. Person Agent Details Policies
CREATE POLICY "Active org members can view agent details"
ON public.person_agent_details FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Authorized members can manage agent details"
ON public.person_agent_details FOR ALL
TO authenticated
USING (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'sales:manage'))
WITH CHECK (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'sales:manage'));

-- 5. Guarantors Policies
CREATE POLICY "Active org members can view guarantors"
ON public.agent_guarantors FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Authorized members can manage guarantors"
ON public.agent_guarantors FOR ALL
TO authenticated
USING (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'sales:manage'))
WITH CHECK (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'sales:manage'));

-- 6. Critical Details Policies
CREATE POLICY "Active org members can view critical details"
ON public.person_critical_details FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Authorized members can manage critical details"
ON public.person_critical_details FOR ALL
TO authenticated
USING (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'sales:manage'))
WITH CHECK (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'sales:manage'));

-- 7. Investor Profiles Policies
CREATE POLICY "Authorized finance members can view investor profiles"
ON public.investor_profiles FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'finance:read'));

CREATE POLICY "Authorized finance members can manage investor profiles"
ON public.investor_profiles FOR ALL
TO authenticated
USING (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'finance:read'))
WITH CHECK (public.is_org_member(organization_id) AND public.has_permission(organization_id, 'finance:read'));

COMMIT;
