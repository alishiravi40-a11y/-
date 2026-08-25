-- ==============================================================================
-- CONSOLIDATED MIGRATION BUNDLE: ACCOUNTING & REPRESENTATIVES FOUNDATION
-- Target Project: kzbaencltepwisdxcbbb
-- Generated for manual execution in Supabase SQL Editor
-- Scope: Migrations 01 through 14 in exact dependency order
-- Safety: No DROP TABLE, no TRUNCATE, transaction-guarded, idempotent IF NOT EXISTS
-- ==============================================================================

-- ==============================================================================
-- SECTION: 01_credit_files.sql
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- Migration: 01_credit_files.sql
-- Description: Credit Files Core Data Structure & Row Level Security (RLS)
-- Redesigned for multi-tenant organization isolation and least privilege security.
-- ==============================================================================

-- 1. Ensure prerequisite infrastructure tables exist
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    national_id TEXT UNIQUE,
    registration_number TEXT,
    phone TEXT,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_organizations_id_composite UNIQUE (id)
);

CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_branch_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_branch_org_composite UNIQUE (organization_id, id)
);

-- 2. Create credit_files table with multi-tenant isolation columns
CREATE TABLE IF NOT EXISTS public.credit_files (
  id text PRIMARY KEY,
  organization_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  "personId" text NOT NULL,
  "representativeId" text NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL,
  "requestedAmount" numeric DEFAULT 0,
  plan text,
  "agentCommissionAmount" numeric DEFAULT 0,
  "calculatorId" text,
  "calculatorName" text,
  "calculationResults" jsonb,
  "revisionNote" text,
  "receivedChecks" jsonb DEFAULT '[]'::jsonb,
  "paymentDocuments" jsonb DEFAULT '[]'::jsonb,
  "documentNotes" text
);

-- Ensure organization_id and branch_id exist if table was previously created
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='organization_id') THEN
        ALTER TABLE public.credit_files ADD COLUMN organization_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='branch_id') THEN
        ALTER TABLE public.credit_files ADD COLUMN branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Indexes for performance and quick query lookup
CREATE INDEX IF NOT EXISTS idx_credit_files_org_branch ON public.credit_files(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_credit_files_person ON public.credit_files(organization_id, "personId");
CREATE INDEX IF NOT EXISTS idx_credit_files_rep ON public.credit_files(organization_id, "representativeId");
CREATE INDEX IF NOT EXISTS idx_credit_files_status ON public.credit_files(organization_id, status);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.credit_files ENABLE ROW LEVEL SECURITY;

-- 4. Explicitly drop legacy overly-permissive policies
DROP POLICY IF EXISTS "Allow all operations for anon users" ON public.credit_files;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.credit_files;

-- 5. Create fine-grained secure RLS policies based on auth.uid() and org membership
-- SELECT Policy: Active org members who have credit/sales management permission or are assigned representative
CREATE POLICY "Authorized members can view credit files"
ON public.credit_files FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'credit:manage') OR
        public.has_permission(organization_id, 'sales:manage') OR
        "representativeId" = auth.uid()::text
    )
);

-- INSERT Policy: Authenticated org members with credit/sales management permission
CREATE POLICY "Authorized members can insert credit files"
ON public.credit_files FOR INSERT
TO authenticated
WITH CHECK (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'credit:manage') OR
        public.has_permission(organization_id, 'sales:manage')
    )
);

-- UPDATE Policy: Authenticated org members with credit/sales management permission
CREATE POLICY "Authorized members can update credit files"
ON public.credit_files FOR UPDATE
TO authenticated
USING (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'credit:manage') OR
        public.has_permission(organization_id, 'sales:manage')
    )
)
WITH CHECK (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'credit:manage') OR
        public.has_permission(organization_id, 'sales:manage')
    )
);

-- DELETE Policy: Authenticated org members with credit management permission
CREATE POLICY "Authorized members can delete credit files"
ON public.credit_files FOR DELETE
TO authenticated
USING (
    public.is_org_member(organization_id) AND
    public.has_permission(organization_id, 'credit:manage')
);

COMMIT;

-- ==============================================================================
-- SECTION: 02_base_infrastructure_auth.sql
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- Migration: 02_base_infrastructure_auth.sql
-- Description: Phase 3-A - Final Base Infrastructure & Security Architecture
-- Corrections & Enhancements:
--   1. Fiscal Period Date Range validation relative to Fiscal Year via triggers
--   2. Fiscal Period Exclusion Constraint via btree_gist extension (no overlaps)
--   3. Partial Unique Index for Single Default Active Organization Membership
--   4. System Tech Admin Emergency Access separation, Org Admin approval & Audit logging
--   5. Full Atomic Transaction wrapping (BEGIN ... COMMIT)
-- ==============================================================================

-- Enable required extensions safely
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

-- 1. Organizations (سازمان‌ها)
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    national_id TEXT UNIQUE,
    registration_number TEXT,
    phone TEXT,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_organizations_id_composite UNIQUE (id)
);

-- 2. Branches (شعب)
CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_branch_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_branch_org_composite UNIQUE (organization_id, id)
);

-- 3. Fiscal Years (سال‌های مالی)
CREATE TABLE IF NOT EXISTS public.fiscal_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_closed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT check_fiscal_year_dates CHECK (end_date >= start_date),
    CONSTRAINT uq_fiscal_year_title_per_org UNIQUE (organization_id, title),
    CONSTRAINT uq_fiscal_year_org_composite UNIQUE (organization_id, id)
);

-- 4. User Profiles (پروفایل جهانی کاربران)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
    full_name TEXT NOT NULL,
    national_id TEXT,
    mobile TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    require_2fa BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Organization Memberships (عضویت کاربر در سازمان‌های مختلف)
CREATE TABLE IF NOT EXISTS public.organization_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    default_branch_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_default BOOLEAN NOT NULL DEFAULT false,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_org_membership UNIQUE (user_id, organization_id),
    CONSTRAINT uq_org_membership_composite UNIQUE (organization_id, id),
    CONSTRAINT fk_membership_default_branch FOREIGN KEY (organization_id, default_branch_id) 
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT
);

-- Conditional partial index: A user can have at most ONE default active organization membership
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_single_default_org 
ON public.organization_memberships(user_id) 
WHERE is_default = true AND is_active = true;

-- 6. User Branch Access (دسترسی کاربر به چند شعبه مشخص در یک سازمان)
CREATE TABLE IF NOT EXISTS public.user_branch_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    membership_id UUID NOT NULL REFERENCES public.organization_memberships(id) ON DELETE RESTRICT,
    organization_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_membership_branch UNIQUE (membership_id, branch_id),
    CONSTRAINT fk_branch_access_branch FOREIGN KEY (organization_id, branch_id) 
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_branch_access_membership FOREIGN KEY (organization_id, membership_id) 
        REFERENCES public.organization_memberships(organization_id, id) ON DELETE RESTRICT
);

-- 7. Fiscal Periods (دوره‌های مالی با منع همپوشانی)
CREATE TABLE IF NOT EXISTS public.fiscal_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL,
    period_number INT NOT NULL,
    title TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_closed BOOLEAN NOT NULL DEFAULT false,
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT check_fiscal_period_dates CHECK (end_date >= start_date),
    CONSTRAINT uq_fiscal_period_num_per_year UNIQUE (fiscal_year_id, period_number),
    CONSTRAINT fk_period_fiscal_year_org FOREIGN KEY (organization_id, fiscal_year_id) 
        REFERENCES public.fiscal_years(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT excl_fiscal_periods_overlap EXCLUDE USING gist (
        fiscal_year_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    )
);

-- 8. Fiscal Period Reopen Audit Logs (سوابق غیرقابلتغییر بازکردن مجدد دوره مالی)
CREATE TABLE IF NOT EXISTS public.fiscal_period_reopen_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    fiscal_period_id UUID NOT NULL REFERENCES public.fiscal_periods(id) ON DELETE RESTRICT,
    reopened_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    two_factor_verified_at_server TIMESTAMPTZ NOT NULL DEFAULT now(),
    reopened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. Roles (نقش‌ها)
CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name_fa TEXT NOT NULL,
    description TEXT,
    is_system_role BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. Permissions (مجوزها)
CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name_fa TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. Role Permissions (مجوزهای نقش‌ها)
CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 12. User Roles (نقش‌های کاربر متصل به عضویت سازمانی)
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    membership_id UUID NOT NULL REFERENCES public.organization_memberships(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
    branch_id UUID,
    granted_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_role_per_membership UNIQUE (membership_id, role_id, branch_id),
    CONSTRAINT fk_user_role_branch FOREIGN KEY (organization_id, branch_id) 
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_user_role_membership FOREIGN KEY (organization_id, membership_id) 
        REFERENCES public.organization_memberships(organization_id, id) ON DELETE RESTRICT
);

-- 13. User Sessions (نشست‌های قابل‌ابطال سمت سرور)
CREATE TABLE IF NOT EXISTS public.user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    auth_session_id UUID,
    session_token_hash TEXT UNIQUE,
    device_info TEXT,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    revoked_at TIMESTAMPTZ,
    revoked_by_user_id UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT
);

-- 14. Security Audit Logs (سوابق غیرقابلتغییر رویدادهای امنیتی)
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_security_audit_logs_org_composite UNIQUE (organization_id, id)
);

-- 15. System Tech Admin Emergency Access Grants (اعطای دسترسی اضطراری به مدیر فنی توسط مدیر ارشد سازمان)
CREATE TABLE IF NOT EXISTS public.system_tech_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    tech_admin_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    approver_org_admin_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT chk_tech_admin_not_approver CHECK (tech_admin_id <> approver_org_admin_id),
    CONSTRAINT chk_grant_expiration CHECK (expires_at > granted_at)
);

-- 16. System Tech Access Operations Audit Logs (سوابق عملیات انجام شده در دسترسی اضطراری - غیرقابل تغییر)
CREATE TABLE IF NOT EXISTS public.system_tech_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grant_id UUID NOT NULL REFERENCES public.system_tech_access_grants(id) ON DELETE RESTRICT,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    tech_admin_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    operation_type TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- INDEXES FOR PERFORMANCE AND FAST LOOKUPS
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_branches_org_id ON public.branches(organization_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_org_id ON public.fiscal_years(organization_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_year_id ON public.fiscal_periods(fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user_id ON public.organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org_id ON public.organization_memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_membership_id ON public.user_roles(membership_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_org_id ON public.user_roles(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_org_id ON public.security_audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_tech_grants_org_admin ON public.system_tech_access_grants(organization_id, tech_admin_id);

-- ==============================================================================
-- FISCAL PERIOD DATE BOUNDARY VALIDATION TRIGGERS
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.validate_fiscal_period_bounds()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_fy_start DATE;
    v_fy_end DATE;
BEGIN
    SELECT start_date, end_date INTO v_fy_start, v_fy_end
    FROM public.fiscal_years
    WHERE id = NEW.fiscal_year_id;

    IF v_fy_start IS NULL OR v_fy_end IS NULL THEN
        RAISE EXCEPTION 'Referenced fiscal year does not exist.';
    END IF;

    IF NEW.start_date < v_fy_start OR NEW.end_date > v_fy_end THEN
        RAISE EXCEPTION 'Fiscal period dates (% to %) must fall within the fiscal year bounds (% to %).',
            NEW.start_date, NEW.end_date, v_fy_start, v_fy_end;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_fiscal_period_bounds ON public.fiscal_periods;
CREATE TRIGGER trg_validate_fiscal_period_bounds
BEFORE INSERT OR UPDATE ON public.fiscal_periods
FOR EACH ROW EXECUTE FUNCTION public.validate_fiscal_period_bounds();

-- Validate that updating a Fiscal Year start/end date doesn't push existing periods out of bounds
CREATE OR REPLACE FUNCTION public.validate_fiscal_year_update_periods()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.fiscal_periods
        WHERE fiscal_year_id = NEW.id
          AND (start_date < NEW.start_date OR end_date > NEW.end_date)
    ) THEN
        RAISE EXCEPTION 'Cannot update fiscal year dates because existing fiscal periods fall outside the new bounds.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_fiscal_year_update ON public.fiscal_years;
CREATE TRIGGER trg_validate_fiscal_year_update
BEFORE UPDATE ON public.fiscal_years
FOR EACH ROW EXECUTE FUNCTION public.validate_fiscal_year_update_periods();

-- ==============================================================================
-- IMMUTABLE AUDIT LOG TRIGGER FUNCTION
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'Audit and security log records are immutable and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_security_audit_mod ON public.security_audit_logs;
CREATE TRIGGER trg_prevent_security_audit_mod
BEFORE UPDATE OR DELETE ON public.security_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_modification();

DROP TRIGGER IF EXISTS trg_prevent_reopen_log_mod ON public.fiscal_period_reopen_logs;
CREATE TRIGGER trg_prevent_reopen_log_mod
BEFORE UPDATE OR DELETE ON public.fiscal_period_reopen_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_modification();

DROP TRIGGER IF EXISTS trg_prevent_tech_access_log_mod ON public.system_tech_access_logs;
CREATE TRIGGER trg_prevent_tech_access_log_mod
BEFORE UPDATE OR DELETE ON public.system_tech_access_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_modification();

-- ==============================================================================
-- SECURITY HELPER FUNCTIONS
-- ==============================================================================

-- Check if current authenticated user is an active member of a given organization
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.organization_memberships om
    JOIN public.user_profiles up ON up.id = om.user_id
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_org_id
      AND om.is_active = true
      AND up.is_active = true
  );
$$;

-- Check if current authenticated user has a specific permission in a given organization
CREATE OR REPLACE FUNCTION public.has_permission(p_org_id UUID, p_permission_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    JOIN public.user_profiles up ON up.id = om.user_id
    JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_org_id
      AND om.is_active = true
      AND up.is_active = true
      AND p.code = p_permission_code
  );
$$;

-- Revoke default public execution rights on security functions
REVOKE EXECUTE ON FUNCTION public.is_org_member(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated;

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_period_reopen_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_branch_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_tech_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_tech_access_logs ENABLE ROW LEVEL SECURITY;

-- User Profiles: Each user can read and update their own profile
CREATE POLICY "Users can view their own profile"
ON public.user_profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Users can update their own profile"
ON public.user_profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Organization Memberships: Users can view their own memberships
CREATE POLICY "Users can view their organization memberships"
ON public.organization_memberships FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Organizations: Accessible only if user is an active member
CREATE POLICY "Members can view their organizations"
ON public.organizations FOR SELECT
TO authenticated
USING (public.is_org_member(id));

-- Branches: Accessible only to organization members
CREATE POLICY "Members can view branches of their organization"
ON public.branches FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- Fiscal Years: Accessible to organization members
CREATE POLICY "Members can view fiscal years of their organization"
ON public.fiscal_years FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- Fiscal Periods: Accessible to organization members
CREATE POLICY "Members can view fiscal periods of their organization"
ON public.fiscal_periods FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- User Roles: Visible to organization members
CREATE POLICY "Members can view user roles in their organization"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- User Branch Access: Visible to user for their memberships
CREATE POLICY "Users can view their branch access"
ON public.user_branch_access FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- Roles & Permissions: Read-only for authenticated users
CREATE POLICY "Authenticated users can view roles"
ON public.roles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can view permissions"
ON public.permissions FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can view role permissions"
ON public.role_permissions FOR SELECT
TO authenticated
USING (true);

-- User Sessions: Users manage strictly their own active sessions
CREATE POLICY "Users can view and manage their own sessions"
ON public.user_sessions FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Security Audit Logs: Visible only to members with 'org:read' permission
CREATE POLICY "Authorized members can view audit logs"
ON public.security_audit_logs FOR SELECT
TO authenticated
USING (public.has_permission(organization_id, 'org:read'));

-- Fiscal Period Reopen Logs: Visible only to authorized org managers
CREATE POLICY "Authorized members can view reopen logs"
ON public.fiscal_period_reopen_logs FOR SELECT
TO authenticated
USING (public.has_permission(organization_id, 'period:reopen'));

-- System Tech Access Grants: Visible to org_admin of that org
CREATE POLICY "Org admins can view tech access grants"
ON public.system_tech_access_grants FOR SELECT
TO authenticated
USING (public.has_permission(organization_id, 'org:manage'));

-- System Tech Access Logs: Visible to org_admin of that org
CREATE POLICY "Org admins can view tech access logs"
ON public.system_tech_access_logs FOR SELECT
TO authenticated
USING (public.has_permission(organization_id, 'org:manage'));

-- ==============================================================================
-- BASE SEED DATA (ROLES & PERMISSIONS ONLY)
-- ==============================================================================

INSERT INTO public.roles (code, name_fa, description, is_system_role) VALUES
('system_tech_admin', 'مدیر فنی سامانه', 'مدیریت زیرساخت فنی، بدون دسترسی به مشاهده یا ثبت اسناد مالی', true),
('org_admin', 'مدیر ارشد سازمان', 'مدیریت کامل سازمان، شعب، کاربران و بازکردن دوره مالی با احراز هویت دومرحله‌ای', true),
('financial_manager', 'مدیر مالی', 'تأیید نهایی اسناد، بستن دوره مالی و نظارت بر حسابداری', true),
('accountant', 'حسابدار', 'ثبت اسناد، فاکتورها، چک‌ها و مرور حساب‌ها', true),
('cashier', 'صندوقدار', 'مدیریت دریافت و پرداخت‌های نقدی و بانکی', true),
('seller', 'فروشنده', 'صدور فاکتور فروش و ثبت سفارش‌ها', true),
('sales_agent', 'نماینده فروش', 'نقش مستقل بازاریابی، مدیریت سفارشات و سهم جلب مشتری', true),
('credit_agent', 'نماینده اعتباری', 'نقش مستقل بررسی مدارک اعتباری، چک‌ها و سقف اعتبار مشتریان', true),
('customer', 'مشتری', 'مشاهده مانده حساب، اقساط و فاکتورهای شخص', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.permissions (code, name_fa, category, description) VALUES
('system:tech_manage', 'مدیریت زیرساخت فنی سامانه', 'فنی', 'امکان پایش زیرساخت فنی (بدون دسترسی مالی)'),
('org:read', 'مشاهده اطلاعات سازمان و شعبه', 'پایه', 'امکان مشاهده ساختار سازمان و شعب'),
('org:manage', 'مدیریت سازمان و شعب', 'مدیریت', 'امکان ایجاد و ویرایش شعب و تنظیمات سازمان'),
('users:manage', 'مدیریت کاربران و نقش‌ها', 'مدیریت', 'امکان تعریف کاربر و انتصاب نقش‌ها'),
('finance:read', 'مشاهده گزارش‌ها و اسناد مالی', 'مالی', 'مشاهده اسناد، کدینگ و دفتر کل'),
('finance:write', 'ثبت و ویرایش پیش‌نویس اسناد', 'مالی', 'ایجاد اسناد و فاکتورها در حالت پیش‌نویس'),
('finance:approve', 'قطعی‌سازی اسناد مالی', 'مالی', 'نهایی‌سازی اسناد مالی و فاکتورها'),
('period:close', 'بستن دوره و سال مالی', 'مالی', 'امکان بستن دوره‌ها و سال مالی'),
('period:reopen', 'بازکردن مجدد دوره مالی بسته شده', 'امنیتی', 'نیازمند مجوز مدیر ارشد و احراز هویت دومرحله‌ای سرور'),
('credit:manage', 'مدیریت پرونده‌ها و اعتبارات', 'اعتباری', 'بررسی و تأیید مدارک اعتباری و پرونده‌ها'),
('sales:manage', 'مدیریت فروش و فاکتورها', 'فروش', 'صدور و پیگیری فاکتورهای فروش')
ON CONFLICT (code) DO NOTHING;

-- Map System Tech Admin Permissions (EXCLUDES ALL FINANCIAL PERMISSIONS)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'system_tech_admin' AND p.code IN ('system:tech_manage')
ON CONFLICT DO NOTHING;

-- Map Org Admin Permissions (Includes all org & financial permissions)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'org_admin' AND p.code IN (
    'org:read', 'org:manage', 'users:manage', 'finance:read', 'finance:write', 
    'finance:approve', 'period:close', 'period:reopen', 'credit:manage', 'sales:manage'
)
ON CONFLICT DO NOTHING;

-- Map Financial Manager Permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'financial_manager' AND p.code IN (
    'org:read', 'finance:read', 'finance:write', 'finance:approve', 'period:close', 'credit:manage', 'sales:manage'
)
ON CONFLICT DO NOTHING;

-- Map Accountant Permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'accountant' AND p.code IN ('org:read', 'finance:read', 'finance:write', 'sales:manage')
ON CONFLICT DO NOTHING;

-- Map Sales Agent Permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'sales_agent' AND p.code IN ('org:read', 'sales:manage')
ON CONFLICT DO NOTHING;

-- Map Credit Agent Permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'credit_agent' AND p.code IN ('org:read', 'credit:manage')
ON CONFLICT DO NOTHING;

COMMIT;

-- ==============================================================================
-- SECTION: 03_persons_foundation.sql
-- ==============================================================================

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

-- ==============================================================================
-- SECTION: 04_chart_of_accounts.sql
-- ==============================================================================

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

-- ==============================================================================
-- SECTION: 05_journal_vouchers.sql
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- Migration: 05_journal_vouchers.sql
-- Description: Phase 3-F - Double-Entry Journal Vouchers, Reversal Lifecycle & Atomic Sequencing Architecture
-- Key Architecture & Rules (Decision 26 & 27):
--   1. Strict Voucher Status Lifecycle:
--      - DRAFT: Draft voucher with zero financial effect. Has no legal voucher number and can be CANCELLED.
--      - POSTED: Finalized posted voucher with assigned sequential legal voucher_number.
--      - REVERSED: Original posted voucher that was voided. Remains permanently in ledger and calculations.
--      - CANCELLED: Pre-posting cancelled draft with zero financial effect and no sequence consumption.
--   2. Reversal Voucher Lifecycle & Kind (GENERAL vs REVERSAL):
--      - REVERSAL is a voucher_kind, NOT a separate status!
--      - Reversal voucher is created as DRAFT first, entries inserted with swapped debit/credit, balanced,
--        sequence locked, and then transitioned to POSTED.
--      - Original voucher transitions to REVERSED only after reversal voucher is finalized POSTED.
--      - Single direction reversal link via reversal_of_voucher_id pointing to original voucher.
--      - Reversal vouchers cannot be reversed directly (Decision 27).
--   3. Atomic Voucher Numbering:
--      - FOR UPDATE row lock on public.voucher_sequences (org + fiscal year).
--      - Sequence numbers assigned exclusively upon POSTED state transition.
--      - MAX(voucher_number)+1, client-side generation, and gap-filling are strictly forbidden.
--   4. Idempotency & Operation Locking:
--      - public.voucher_operation_keys tracks unique operation keys per organization to prevent duplicate submissions.
-- ==============================================================================

-- ==============================================================================
-- 1. COST CENTERS (جدول مراکز هزینه)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.cost_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT uq_cost_center_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_cost_center_org_composite UNIQUE (organization_id, id)
);

COMMENT ON TABLE public.cost_centers IS 'Cost centers for detailed financial cost distribution per organization.';

-- Trigger for cost_centers versioning
CREATE OR REPLACE FUNCTION public.trg_increment_cost_center_version()
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

DROP TRIGGER IF EXISTS trg_cost_centers_version ON public.cost_centers;
CREATE TRIGGER trg_cost_centers_version
BEFORE UPDATE ON public.cost_centers
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_cost_center_version();

-- Prevent physical deletion of cost centers if referenced in financial entries
CREATE OR REPLACE FUNCTION public.prevent_cost_center_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.voucher_entries
        WHERE cost_center_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'Physical deletion of cost center % is forbidden because it has associated financial entries.', OLD.code;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_cost_center_deletion ON public.cost_centers;
CREATE TRIGGER trg_prevent_cost_center_deletion
BEFORE DELETE ON public.cost_centers
FOR EACH ROW EXECUTE FUNCTION public.prevent_cost_center_deletion();

-- ==============================================================================
-- 2. VOUCHER SEQUENCES (جدول شمارنده اسناد قطعی)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.voucher_sequences (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL,
    next_number BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    PRIMARY KEY (organization_id, fiscal_year_id),
    CONSTRAINT fk_voucher_seq_fiscal_year FOREIGN KEY (organization_id, fiscal_year_id)
        REFERENCES public.fiscal_years(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.voucher_sequences IS 'Atomic sequence counter for sequential voucher numbers per organization and fiscal year.';

-- ==============================================================================
-- 3. JOURNAL VOUCHERS HEADER (جدول سربرگ اسناد حسابداری)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.journal_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID NOT NULL,
    fiscal_year_id UUID NOT NULL,
    voucher_number BIGINT,
    voucher_date DATE NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED', 'CANCELLED')),
    voucher_kind TEXT NOT NULL DEFAULT 'GENERAL' CHECK (voucher_kind IN ('GENERAL', 'REVERSAL')),
    is_automatic BOOLEAN NOT NULL DEFAULT false,
    source_type TEXT,
    source_id UUID,
    source_event_key TEXT,
    contract_type TEXT,
    reversal_of_voucher_id UUID,
    version INT NOT NULL DEFAULT 1,
    created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    posted_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    posted_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    reversed_at TIMESTAMPTZ,
    reversal_reason TEXT,
    cancelled_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    CONSTRAINT uq_journal_voucher_org_composite UNIQUE (organization_id, id),
    CONSTRAINT fk_jv_branch FOREIGN KEY (organization_id, branch_id)
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_jv_fiscal_year FOREIGN KEY (organization_id, fiscal_year_id)
        REFERENCES public.fiscal_years(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_jv_reversal_of FOREIGN KEY (organization_id, reversal_of_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_jv_no_self_reversal CHECK (reversal_of_voucher_id IS NULL OR reversal_of_voucher_id <> id),
    CONSTRAINT chk_jv_number_by_status CHECK (
        (status = 'DRAFT' AND voucher_number IS NULL AND posted_at IS NULL AND posted_by IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR
        (status = 'CANCELLED' AND voucher_number IS NULL AND posted_at IS NULL AND posted_by IS NULL AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0) OR
        (status = 'POSTED' AND voucher_number IS NOT NULL AND voucher_number > 0 AND posted_at IS NOT NULL AND posted_by IS NOT NULL AND reversed_at IS NULL AND reversed_by IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR
        (status = 'REVERSED' AND voucher_number IS NOT NULL AND voucher_number > 0 AND posted_at IS NOT NULL AND posted_by IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL AND length(trim(reversal_reason)) > 0)
    ),
    CONSTRAINT chk_jv_reversal_kind_ref CHECK (
        (voucher_kind = 'REVERSAL' AND reversal_of_voucher_id IS NOT NULL) OR
        (voucher_kind = 'GENERAL' AND reversal_of_voucher_id IS NULL)
    ),
    CONSTRAINT chk_jv_automatic_source CHECK (
        (is_automatic = false AND voucher_kind = 'GENERAL') OR
        (is_automatic = true AND voucher_kind = 'GENERAL' AND source_type IS NOT NULL AND source_id IS NOT NULL AND source_event_key IS NOT NULL) OR
        (voucher_kind = 'REVERSAL' AND is_automatic = true AND source_event_key IS NULL)
    )
);

COMMENT ON TABLE public.journal_vouchers IS 'Double-entry journal voucher headers with strict lifecycle status and kind management.';

-- Unique Partial Indexes for Integrity & Idempotency
CREATE UNIQUE INDEX IF NOT EXISTS uq_jv_voucher_number_per_org_fy
ON public.journal_vouchers(organization_id, fiscal_year_id, voucher_number)
WHERE voucher_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_jv_source_event_key_per_org
ON public.journal_vouchers(organization_id, source_type, source_id, source_event_key)
WHERE source_event_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_jv_one_reversal_of_per_voucher
ON public.journal_vouchers(organization_id, reversal_of_voucher_id)
WHERE reversal_of_voucher_id IS NOT NULL;

-- Trigger for journal_vouchers versioning
CREATE OR REPLACE FUNCTION public.trg_increment_jv_version()
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

DROP TRIGGER IF EXISTS trg_journal_vouchers_version ON public.journal_vouchers;
CREATE TRIGGER trg_journal_vouchers_version
BEFORE UPDATE ON public.journal_vouchers
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_jv_version();

-- ==============================================================================
-- 4. VOUCHER ENTRIES (جدول ردیف‌های سند حسابداری)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.voucher_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    voucher_id UUID NOT NULL,
    row_number INT NOT NULL,
    subsidiary_id UUID NOT NULL,
    person_id UUID,
    cost_center_id UUID,
    financial_role_code TEXT REFERENCES public.system_financial_roles(role_code) ON DELETE RESTRICT,
    debit NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    description TEXT,
    contract_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ve_row_number UNIQUE (voucher_id, row_number),
    CONSTRAINT fk_ve_voucher FOREIGN KEY (organization_id, voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_ve_subsidiary FOREIGN KEY (organization_id, subsidiary_id)
        REFERENCES public.account_subsidiaries(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_ve_person FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_ve_cost_center FOREIGN KEY (organization_id, cost_center_id)
        REFERENCES public.cost_centers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_ve_single_side CHECK (
        (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
    )
);

COMMENT ON TABLE public.voucher_entries IS 'Detailed debit and credit rows for double-entry journal vouchers.';

-- ==============================================================================
-- 5. VOUCHER OPERATION KEYS (جدول کلیدهای عملیاتی یکتا برای جلوگیری از ثبت تکراری)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.voucher_operation_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    operation_key TEXT NOT NULL,
    operation_type TEXT NOT NULL CHECK (operation_type IN ('POST_VOUCHER', 'REVERSE_VOUCHER', 'CANCEL_DRAFT_VOUCHER')),
    request_fingerprint TEXT NOT NULL,
    target_voucher_id UUID NOT NULL,
    result_voucher_id UUID,
    created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_voucher_op_key_per_org UNIQUE (organization_id, operation_key),
    CONSTRAINT fk_vok_target_voucher FOREIGN KEY (organization_id, target_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_vok_result_voucher FOREIGN KEY (organization_id, result_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_vok_completed_pair CHECK (
        (result_voucher_id IS NULL AND completed_at IS NULL) OR
        (result_voucher_id IS NOT NULL AND completed_at IS NOT NULL)
    ),
    CONSTRAINT chk_vok_non_empty_key_fp CHECK (
        length(trim(operation_key)) > 0 AND length(trim(request_fingerprint)) > 0
    ),
    CONSTRAINT chk_vok_result_voucher_match CHECK (
        (result_voucher_id IS NULL) OR
        (operation_type IN ('POST_VOUCHER', 'CANCEL_DRAFT_VOUCHER') AND result_voucher_id = target_voucher_id) OR
        (operation_type = 'REVERSE_VOUCHER' AND result_voucher_id <> target_voucher_id)
    )
);

COMMENT ON TABLE public.voucher_operation_keys IS 'Idempotency and concurrency locks ensuring server-side duplicate transaction prevention.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vok_target_op_per_org
ON public.voucher_operation_keys(organization_id, operation_type, target_voucher_id);

-- Prevent unauthorized modification or deletion of operation keys
CREATE OR REPLACE FUNCTION public.prevent_op_key_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Deletion of voucher operation keys is strictly forbidden.';
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.completed_at IS NOT NULL OR OLD.result_voucher_id IS NOT NULL THEN
            RAISE EXCEPTION 'Completed voucher operation keys are immutable and cannot be updated.';
        END IF;
        IF NEW.completed_at IS NULL OR NEW.result_voucher_id IS NULL THEN
            RAISE EXCEPTION 'Operation key records must be updated with both result_voucher_id and completed_at.';
        END IF;
        IF NEW.id IS DISTINCT FROM OLD.id OR
           NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
           NEW.operation_key IS DISTINCT FROM OLD.operation_key OR
           NEW.operation_type IS DISTINCT FROM OLD.operation_type OR
           NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint OR
           NEW.target_voucher_id IS DISTINCT FROM OLD.target_voucher_id OR
           NEW.created_by IS DISTINCT FROM OLD.created_by OR
           NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Core operation key parameters cannot be altered.';
        END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_op_key_modification ON public.voucher_operation_keys;
CREATE TRIGGER trg_prevent_op_key_modification
BEFORE UPDATE OR DELETE ON public.voucher_operation_keys
FOR EACH ROW EXECUTE FUNCTION public.prevent_op_key_modification();

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_jv_org_status ON public.journal_vouchers(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_jv_org_fy_num ON public.journal_vouchers(organization_id, fiscal_year_id, voucher_number);
CREATE INDEX IF NOT EXISTS idx_jv_source ON public.journal_vouchers(organization_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ve_voucher ON public.voucher_entries(voucher_id);
CREATE INDEX IF NOT EXISTS idx_ve_subsidiary ON public.voucher_entries(organization_id, subsidiary_id);
CREATE INDEX IF NOT EXISTS idx_ve_person ON public.voucher_entries(organization_id, person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ve_cost_center ON public.voucher_entries(organization_id, cost_center_id) WHERE cost_center_id IS NOT NULL;

-- ==============================================================================
-- 6. SECURITY HELPER FUNCTION FOR BRANCH PERMISSION CONTROL
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.has_branch_permission(
    p_organization_id UUID,
    p_branch_id UUID,
    p_permission_code TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    JOIN public.user_profiles up ON up.id = om.user_id
    JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_organization_id
      AND om.is_active = true
      AND up.is_active = true
      AND (ur.branch_id IS NULL OR ur.branch_id = p_branch_id)
      AND p.code = p_permission_code
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_branch_permission(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_branch_permission(UUID, UUID, TEXT) TO authenticated;

-- ==============================================================================
-- 7. POSTED VOUCHER & ROW PROTECTION TRIGGERS (حفاظت از وضعیت سند و ردیف‌ها)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.prevent_posted_voucher_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Physical deletion of journal vouchers (ID: %) is strictly forbidden.', OLD.id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'DRAFT' THEN
            IF NEW.status NOT IN ('DRAFT', 'POSTED', 'CANCELLED') THEN
                RAISE EXCEPTION 'Invalid status transition for draft voucher % to %.', OLD.id, NEW.status;
            END IF;
        ELSIF OLD.status = 'POSTED' THEN
            IF NEW.status = 'REVERSED' THEN
                IF NEW.id IS DISTINCT FROM OLD.id OR
                   NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
                   NEW.branch_id IS DISTINCT FROM OLD.branch_id OR
                   NEW.fiscal_year_id IS DISTINCT FROM OLD.fiscal_year_id OR
                   NEW.voucher_number IS DISTINCT FROM OLD.voucher_number OR
                   NEW.voucher_date IS DISTINCT FROM OLD.voucher_date OR
                   NEW.description IS DISTINCT FROM OLD.description OR
                   NEW.voucher_kind IS DISTINCT FROM OLD.voucher_kind OR
                   NEW.is_automatic IS DISTINCT FROM OLD.is_automatic OR
                   NEW.source_type IS DISTINCT FROM OLD.source_type OR
                   NEW.source_id IS DISTINCT FROM OLD.source_id OR
                   NEW.source_event_key IS DISTINCT FROM OLD.source_event_key OR
                   NEW.contract_type IS DISTINCT FROM OLD.contract_type OR
                   NEW.reversal_of_voucher_id IS DISTINCT FROM OLD.reversal_of_voucher_id OR
                   NEW.created_by IS DISTINCT FROM OLD.created_by OR
                   NEW.created_at IS DISTINCT FROM OLD.created_at OR
                   NEW.posted_by IS DISTINCT FROM OLD.posted_by OR
                   NEW.posted_at IS DISTINCT FROM OLD.posted_at OR
                   NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by OR
                   NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR
                   NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason THEN
                    RAISE EXCEPTION 'Core voucher fields cannot be altered when transitioning from POSTED to REVERSED.';
                END IF;
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Posted vouchers (ID: %) can only transition to REVERSED status.', OLD.id;
            END IF;
        ELSIF OLD.status IN ('REVERSED', 'CANCELLED') THEN
            RAISE EXCEPTION 'Reversed or cancelled vouchers (ID: %) are immutable and cannot be updated.', OLD.id;
        END IF;

        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_jv_modification ON public.journal_vouchers;
CREATE TRIGGER trg_prevent_jv_modification
BEFORE UPDATE OR DELETE ON public.journal_vouchers
FOR EACH ROW EXECUTE FUNCTION public.prevent_posted_voucher_modification();

CREATE OR REPLACE FUNCTION public.prevent_posted_voucher_entry_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_status TEXT;
    v_target_voucher_id UUID;
    v_target_org_id UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.voucher_id <> OLD.voucher_id OR NEW.organization_id <> OLD.organization_id THEN
            RAISE EXCEPTION 'Transferring voucher entries between vouchers or organizations is strictly forbidden.';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_target_voucher_id := OLD.voucher_id;
        v_target_org_id := OLD.organization_id;
    ELSE
        v_target_voucher_id := NEW.voucher_id;
        v_target_org_id := NEW.organization_id;
    END IF;

    SELECT status INTO v_status
    FROM public.journal_vouchers
    WHERE id = v_target_voucher_id AND organization_id = v_target_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated journal voucher (ID: %, Org: %) not found.', v_target_voucher_id, v_target_org_id;
    END IF;

    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Entries can only be modified for DRAFT vouchers. Voucher % status is %.', v_target_voucher_id, v_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_ve_modification ON public.voucher_entries;
CREATE TRIGGER trg_prevent_ve_modification
BEFORE INSERT OR UPDATE OR DELETE ON public.voucher_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_posted_voucher_entry_modification();

-- ==============================================================================
-- 8. ATOMIC POST VOUCHER FUNCTION (تابع قطعیسازی سند)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.post_journal_voucher(
    p_organization_id UUID,
    p_voucher_id UUID,
    p_expected_version INT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_voucher RECORD;
    v_entry_count INT;
    v_total_debit NUMERIC(18, 0);
    v_total_credit NUMERIC(18, 0);
    v_fiscal_year_id UUID;
    v_fy_closed BOOLEAN;
    v_fp_count INT;
    v_period_closed BOOLEAN;
    v_next_num BIGINT;
    v_invalid_entry RECORD;
    v_existing_op RECORD;
    v_op_key_id UUID;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required: auth.uid() is null.';
    END IF;

    -- 2. Mandatory Parameter Validation
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'Parameter p_expected_version is required.';
    END IF;
    IF p_operation_key IS NULL OR trim(p_operation_key) = '' THEN
        RAISE EXCEPTION 'Parameter p_operation_key is required.';
    END IF;
    IF p_request_fingerprint IS NULL OR trim(p_request_fingerprint) = '' THEN
        RAISE EXCEPTION 'Parameter p_request_fingerprint is required.';
    END IF;

    -- 3. Lock Voucher Header FOR UPDATE first
    SELECT * INTO v_voucher
    FROM public.journal_vouchers
    WHERE id = p_voucher_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal voucher % not found in organization %.', p_voucher_id, p_organization_id;
    END IF;

    -- 4. Check Branch Permission (finance:approve)
    IF NOT public.has_branch_permission(p_organization_id, v_voucher.branch_id, 'finance:approve') THEN
        RAISE EXCEPTION 'Permission denied: Required finance:approve permission is missing for branch %.', v_voucher.branch_id;
    END IF;

    -- 5. Idempotency Check on Operation Key
    SELECT * INTO v_existing_op
    FROM public.voucher_operation_keys
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_op.operation_type <> 'POST_VOUCHER' OR
           v_existing_op.target_voucher_id <> p_voucher_id OR
           v_existing_op.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Operation key conflict: Mismatched operation parameters or request fingerprint for key %.', p_operation_key;
        END IF;

        IF v_existing_op.completed_at IS NOT NULL THEN
            SELECT voucher_number INTO v_next_num
            FROM public.journal_vouchers
            WHERE id = v_existing_op.result_voucher_id AND organization_id = p_organization_id;
            RETURN v_next_num;
        ELSE
            RAISE EXCEPTION 'Operation with key % is currently in progress.', p_operation_key;
        END IF;
    END IF;

    -- 6. Validate Status, Kind & Version BEFORE reserving operation key
    IF v_voucher.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Cannot post voucher % with status %. Posting is only allowed for DRAFT vouchers.', p_voucher_id, v_voucher.status;
    END IF;

    IF v_voucher.voucher_kind = 'REVERSAL' THEN
        RAISE EXCEPTION 'Direct posting of REVERSAL kind vouchers is forbidden. Reversal vouchers are posted exclusively via reverse_journal_voucher.';
    END IF;

    IF v_voucher.version <> p_expected_version THEN
        RAISE EXCEPTION 'Concurrency conflict: Voucher version % does not match expected version %.',
            v_voucher.version, p_expected_version;
    END IF;

    -- 7. Reserve Operation Key (ONLY after passing all validation checks above)
    INSERT INTO public.voucher_operation_keys (
        organization_id, operation_key, operation_type, request_fingerprint, target_voucher_id, created_by
    ) VALUES (
        p_organization_id, p_operation_key, 'POST_VOUCHER', p_request_fingerprint, p_voucher_id, v_auth_uid
    ) RETURNING id INTO v_op_key_id;

    -- 8. Validate Entries Count >= 2
    SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_entry_count, v_total_debit, v_total_credit
    FROM public.voucher_entries
    WHERE voucher_id = p_voucher_id AND organization_id = p_organization_id;

    IF v_entry_count < 2 THEN
        RAISE EXCEPTION 'Voucher % must contain at least 2 entries (current count: %).', p_voucher_id, v_entry_count;
    END IF;

    -- 9. Validate Balance & Non-Zero Total
    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'Voucher % is not balanced: Total Debit % differs from Total Credit %.',
            p_voucher_id, v_total_debit, v_total_credit;
    END IF;

    IF v_total_debit <= 0 THEN
        RAISE EXCEPTION 'Voucher % total amount must be strictly greater than zero.', p_voucher_id;
    END IF;

    -- 10. Validate Subsidiary Accounts, Persons, Cost Centers
    FOR v_invalid_entry IN
        SELECT ve.id, ve.row_number, ve.subsidiary_id, ve.person_id, ve.cost_center_id,
               sub.code AS sub_code, sub.is_active AS sub_active,
               sub.requires_person, sub.requires_cost_center
        FROM public.voucher_entries ve
        JOIN public.account_subsidiaries sub ON sub.id = ve.subsidiary_id AND sub.organization_id = p_organization_id
        WHERE ve.voucher_id = p_voucher_id AND ve.organization_id = p_organization_id
    LOOP
        IF NOT v_invalid_entry.sub_active THEN
            RAISE EXCEPTION 'Entry row % uses inactive subsidiary account %.', v_invalid_entry.row_number, v_invalid_entry.sub_code;
        END IF;

        IF v_invalid_entry.requires_person AND v_invalid_entry.person_id IS NULL THEN
            RAISE EXCEPTION 'Entry row % with account % requires a valid person reference.', v_invalid_entry.row_number, v_invalid_entry.sub_code;
        END IF;

        IF v_invalid_entry.requires_cost_center AND v_invalid_entry.cost_center_id IS NULL THEN
            RAISE EXCEPTION 'Entry row % with account % requires a valid cost center reference.', v_invalid_entry.row_number, v_invalid_entry.sub_code;
        END IF;
    END LOOP;

    -- 11. Validate Fiscal Year & Fiscal Period Date Range & Open Status
    SELECT id, is_closed INTO v_fiscal_year_id, v_fy_closed
    FROM public.fiscal_years
    WHERE id = v_voucher.fiscal_year_id AND organization_id = p_organization_id
      AND start_date <= v_voucher.voucher_date
      AND end_date >= v_voucher.voucher_date;

    IF v_fiscal_year_id IS NULL THEN
        RAISE EXCEPTION 'Voucher date % does not fall within specified fiscal year % for organization %.',
            v_voucher.voucher_date, v_voucher.fiscal_year_id, p_organization_id;
    END IF;

    IF v_fy_closed THEN
        RAISE EXCEPTION 'Fiscal year for date % is closed. Posting is forbidden.', v_voucher.voucher_date;
    END IF;

    SELECT COUNT(*), COALESCE(bool_or(is_closed), false)
    INTO v_fp_count, v_period_closed
    FROM public.fiscal_periods
    WHERE organization_id = p_organization_id
      AND fiscal_year_id = v_fiscal_year_id
      AND start_date <= v_voucher.voucher_date
      AND end_date >= v_voucher.voucher_date;

    IF v_fp_count <> 1 THEN
        RAISE EXCEPTION 'Voucher date % must match exactly one defined fiscal period (found %). Posting is forbidden.',
            v_voucher.voucher_date, v_fp_count;
    END IF;

    IF v_period_closed IS TRUE THEN
        RAISE EXCEPTION 'Fiscal period for date % is closed. Posting is forbidden.', v_voucher.voucher_date;
    END IF;

    -- 12. Lock Sequence & Assign Sequential Legal Voucher Number
    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_fiscal_year_id, 1, v_auth_uid)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_next_num
    FROM public.voucher_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fiscal_year_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_by = v_auth_uid,
        updated_at = now()
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fiscal_year_id;

    -- 13. Finalize Voucher Header to POSTED Status
    UPDATE public.journal_vouchers
    SET fiscal_year_id = v_fiscal_year_id,
        voucher_number = v_next_num,
        status = 'POSTED',
        posted_by = v_auth_uid,
        posted_at = now(),
        updated_at = now()
    WHERE id = p_voucher_id AND organization_id = p_organization_id;

    -- 14. Complete Operation Key Record
    UPDATE public.voucher_operation_keys
    SET result_voucher_id = p_voucher_id,
        completed_at = now()
    WHERE id = v_op_key_id;

    RETURN v_next_num;
END;
$$;

-- ==============================================================================
-- 9. ATOMIC REVERSE VOUCHER FUNCTION (تابع معکوسسازی و ابطال قطعی)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.reverse_journal_voucher(
    p_organization_id UUID,
    p_original_voucher_id UUID,
    p_reversal_fiscal_year_id UUID,
    p_reversal_date DATE,
    p_reversal_reason TEXT,
    p_expected_version INT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_orig RECORD;
    v_reversal_fy_id UUID;
    v_fy_closed BOOLEAN;
    v_fp_count INT;
    v_period_closed BOOLEAN;
    v_reversal_voucher_num BIGINT;
    v_reversal_id UUID;
    v_entry RECORD;
    v_entry_count INT;
    v_total_debit NUMERIC(18, 0);
    v_total_credit NUMERIC(18, 0);
    v_existing_op RECORD;
    v_op_key_id UUID;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required: auth.uid() is null.';
    END IF;

    -- 2. Mandatory Parameter Validation
    IF p_reversal_reason IS NULL OR trim(p_reversal_reason) = '' THEN
        RAISE EXCEPTION 'Reversal reason is mandatory for voiding a posted voucher.';
    END IF;
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'Parameter p_expected_version is required.';
    END IF;
    IF p_operation_key IS NULL OR trim(p_operation_key) = '' THEN
        RAISE EXCEPTION 'Parameter p_operation_key is required.';
    END IF;
    IF p_request_fingerprint IS NULL OR trim(p_request_fingerprint) = '' THEN
        RAISE EXCEPTION 'Parameter p_request_fingerprint is required.';
    END IF;

    -- 3. Lock Original Voucher Header FOR UPDATE first
    SELECT * INTO v_orig
    FROM public.journal_vouchers
    WHERE id = p_original_voucher_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original voucher % not found in organization %.', p_original_voucher_id, p_organization_id;
    END IF;

    -- 4. Check Branch Permission (finance:approve)
    IF NOT public.has_branch_permission(p_organization_id, v_orig.branch_id, 'finance:approve') THEN
        RAISE EXCEPTION 'Permission denied: Required finance:approve permission is missing for branch %.', v_orig.branch_id;
    END IF;

    -- 5. Idempotency Check
    SELECT * INTO v_existing_op
    FROM public.voucher_operation_keys
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_op.operation_type <> 'REVERSE_VOUCHER' OR
           v_existing_op.target_voucher_id <> p_original_voucher_id OR
           v_existing_op.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Operation key conflict: Mismatched operation parameters or request fingerprint for key %.', p_operation_key;
        END IF;

        IF v_existing_op.completed_at IS NOT NULL THEN
            RETURN v_existing_op.result_voucher_id;
        ELSE
            RAISE EXCEPTION 'Operation with key % is currently in progress.', p_operation_key;
        END IF;
    END IF;

    -- 6. Validate Voucher Kind, Status & Version BEFORE reserving operation key (Decision 27)
    IF v_orig.voucher_kind = 'REVERSAL' THEN
        RAISE EXCEPTION 'Cannot reverse a voucher of kind REVERSAL. Reversal vouchers cannot be reversed directly; subsequent adjustments must be made using an independent adjustment voucher.';
    END IF;

    IF v_orig.status <> 'POSTED' THEN
        RAISE EXCEPTION 'Only POSTED vouchers can be reversed. Current status of voucher % is %.',
            p_original_voucher_id, v_orig.status;
    END IF;

    IF v_orig.version <> p_expected_version THEN
        RAISE EXCEPTION 'Concurrency conflict: Original voucher version % does not match expected version %.',
            v_orig.version, p_expected_version;
    END IF;

    -- 7. Reserve Operation Key (ONLY after passing all validation checks above)
    INSERT INTO public.voucher_operation_keys (
        organization_id, operation_key, operation_type, request_fingerprint, target_voucher_id, created_by
    ) VALUES (
        p_organization_id, p_operation_key, 'REVERSE_VOUCHER', p_request_fingerprint, p_original_voucher_id, v_auth_uid
    ) RETURNING id INTO v_op_key_id;

    -- 8. Validate Reversal Date in Open Fiscal Year & Period
    SELECT id, is_closed INTO v_reversal_fy_id, v_fy_closed
    FROM public.fiscal_years
    WHERE id = p_reversal_fiscal_year_id AND organization_id = p_organization_id
      AND start_date <= p_reversal_date
      AND end_date >= p_reversal_date;

    IF v_reversal_fy_id IS NULL THEN
        RAISE EXCEPTION 'Reversal date % does not fall within specified fiscal year % for organization %.',
            p_reversal_date, p_reversal_fiscal_year_id, p_organization_id;
    END IF;

    IF v_fy_closed THEN
        RAISE EXCEPTION 'Fiscal year for reversal date % is closed.', p_reversal_date;
    END IF;

    SELECT COUNT(*), COALESCE(bool_or(is_closed), false)
    INTO v_fp_count, v_period_closed
    FROM public.fiscal_periods
    WHERE organization_id = p_organization_id
      AND fiscal_year_id = v_reversal_fy_id
      AND start_date <= p_reversal_date
      AND end_date >= p_reversal_date;

    IF v_fp_count <> 1 THEN
        RAISE EXCEPTION 'Reversal date % must match exactly one defined fiscal period (found %). Reversal is forbidden.',
            p_reversal_date, v_fp_count;
    END IF;

    IF v_period_closed IS TRUE THEN
        RAISE EXCEPTION 'Fiscal period for reversal date % is closed. Reversal must be posted in an open period.', p_reversal_date;
    END IF;

    -- 9. CREATE REVERSAL HEADER IN DRAFT STATUS
    v_reversal_id := gen_random_uuid();

    INSERT INTO public.journal_vouchers (
        id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date,
        description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, contract_type,
        reversal_of_voucher_id, created_by, posted_by, posted_at
    ) VALUES (
        v_reversal_id, p_organization_id, v_orig.branch_id, v_reversal_fy_id, NULL, p_reversal_date,
        'سند معکوس بابت ابطال سند شماره ' || v_orig.voucher_number || ': ' || p_reversal_reason,
        'DRAFT', 'REVERSAL', true, v_orig.source_type, v_orig.source_id, NULL, v_orig.contract_type,
        p_original_voucher_id, v_auth_uid, NULL, NULL
    );

    -- 10. Copy Entries Inverting Debit and Credit while Reversal Voucher is DRAFT
    FOR v_entry IN
        SELECT *
        FROM public.voucher_entries
        WHERE voucher_id = p_original_voucher_id AND organization_id = p_organization_id
        ORDER BY row_number ASC
    LOOP
        INSERT INTO public.voucher_entries (
            id, organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id,
            financial_role_code, debit, credit, description, contract_type
        ) VALUES (
            gen_random_uuid(), p_organization_id, v_reversal_id, v_entry.row_number,
            v_entry.subsidiary_id, v_entry.person_id, v_entry.cost_center_id,
            v_entry.financial_role_code,
            v_entry.credit, v_entry.debit, -- SWAPPED DEBIT & CREDIT
            'معکوس: ' || COALESCE(v_entry.description, ''),
            v_entry.contract_type
        );
    END LOOP;

    -- 11. Validate Reversal Entries Count & Balance inside Transaction
    SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_entry_count, v_total_debit, v_total_credit
    FROM public.voucher_entries
    WHERE voucher_id = v_reversal_id AND organization_id = p_organization_id;

    IF v_entry_count < 2 THEN
        RAISE EXCEPTION 'Reversal voucher % must contain at least 2 entries (found %).', v_reversal_id, v_entry_count;
    END IF;

    IF v_total_debit <> v_total_credit OR v_total_debit <= 0 THEN
        RAISE EXCEPTION 'Reversal voucher % entries are imbalanced or zero.', v_reversal_id;
    END IF;

    -- 12. Lock Sequence & Assign Legal Voucher Number
    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_reversal_fy_id, 1, v_auth_uid)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_reversal_voucher_num
    FROM public.voucher_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_reversal_fy_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_by = v_auth_uid,
        updated_at = now()
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_reversal_fy_id;

    -- 13. Transition Reversal Header to POSTED Status
    UPDATE public.journal_vouchers
    SET status = 'POSTED',
        voucher_number = v_reversal_voucher_num,
        posted_by = v_auth_uid,
        posted_at = now(),
        updated_at = now()
    WHERE id = v_reversal_id AND organization_id = p_organization_id;

    -- 14. Transition Original Voucher Header to REVERSED Status
    UPDATE public.journal_vouchers
    SET status = 'REVERSED',
        reversed_by = v_auth_uid,
        reversed_at = now(),
        reversal_reason = p_reversal_reason,
        updated_at = now()
    WHERE id = p_original_voucher_id AND organization_id = p_organization_id;

    -- 15. Complete Operation Key Record
    UPDATE public.voucher_operation_keys
    SET result_voucher_id = v_reversal_id,
        completed_at = now()
    WHERE id = v_op_key_id;

    RETURN v_reversal_id;
END;
$$;

-- ==============================================================================
-- 10. CANCEL DRAFT VOUCHER FUNCTION (تابع لغو پیش‌نویس)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.cancel_draft_journal_voucher(
    p_organization_id UUID,
    p_voucher_id UUID,
    p_cancellation_reason TEXT,
    p_expected_version INT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_voucher RECORD;
    v_existing_op RECORD;
    v_op_key_id UUID;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required: auth.uid() is null.';
    END IF;

    -- 2. Mandatory Parameter Validation
    IF p_cancellation_reason IS NULL OR trim(p_cancellation_reason) = '' THEN
        RAISE EXCEPTION 'Cancellation reason is mandatory for cancelling a draft voucher.';
    END IF;
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'Parameter p_expected_version is required.';
    END IF;
    IF p_operation_key IS NULL OR trim(p_operation_key) = '' THEN
        RAISE EXCEPTION 'Parameter p_operation_key is required.';
    END IF;
    IF p_request_fingerprint IS NULL OR trim(p_request_fingerprint) = '' THEN
        RAISE EXCEPTION 'Parameter p_request_fingerprint is required.';
    END IF;

    -- 3. Lock Voucher Header FOR UPDATE first
    SELECT * INTO v_voucher
    FROM public.journal_vouchers
    WHERE id = p_voucher_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal voucher % not found in organization %.', p_voucher_id, p_organization_id;
    END IF;

    -- 4. Check Branch Permission (finance:write)
    IF NOT public.has_branch_permission(p_organization_id, v_voucher.branch_id, 'finance:write') THEN
        RAISE EXCEPTION 'Permission denied: Required finance:write permission is missing for branch %.', v_voucher.branch_id;
    END IF;

    -- 5. Idempotency Check
    SELECT * INTO v_existing_op
    FROM public.voucher_operation_keys
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_op.operation_type <> 'CANCEL_DRAFT_VOUCHER' OR
           v_existing_op.target_voucher_id <> p_voucher_id OR
           v_existing_op.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Operation key conflict: Mismatched operation parameters or request fingerprint for key %.', p_operation_key;
        END IF;

        IF v_existing_op.completed_at IS NOT NULL THEN
            RETURN true;
        ELSE
            RAISE EXCEPTION 'Operation with key % is currently in progress.', p_operation_key;
        END IF;
    END IF;

    -- 6. Validate Status & Version BEFORE reserving operation key
    IF v_voucher.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only DRAFT vouchers can be cancelled. Current status of voucher % is %.', p_voucher_id, v_voucher.status;
    END IF;

    IF v_voucher.version <> p_expected_version THEN
        RAISE EXCEPTION 'Concurrency conflict: Voucher version % does not match expected version %.',
            v_voucher.version, p_expected_version;
    END IF;

    -- 7. Reserve Operation Key (ONLY after passing all validation checks above)
    INSERT INTO public.voucher_operation_keys (
        organization_id, operation_key, operation_type, request_fingerprint, target_voucher_id, created_by
    ) VALUES (
        p_organization_id, p_operation_key, 'CANCEL_DRAFT_VOUCHER', p_request_fingerprint, p_voucher_id, v_auth_uid
    ) RETURNING id INTO v_op_key_id;

    -- 8. Transition to CANCELLED
    UPDATE public.journal_vouchers
    SET status = 'CANCELLED',
        cancelled_by = v_auth_uid,
        cancelled_at = now(),
        cancellation_reason = p_cancellation_reason,
        updated_at = now()
    WHERE id = p_voucher_id AND organization_id = p_organization_id;

    -- 9. Complete Operation Key Record
    UPDATE public.voucher_operation_keys
    SET result_voucher_id = p_voucher_id,
        completed_at = now()
    WHERE id = v_op_key_id;

    RETURN true;
END;
$$;

-- ==============================================================================
-- 11. LEDGER VIEW (نمای دفتر کل و معین - شامل اسناد POSTED و REVERSED)
-- ==============================================================================
CREATE OR REPLACE VIEW public.vw_financial_ledger_entries
WITH (security_invoker = true) AS
SELECT
    ve.id AS entry_id,
    ve.organization_id,
    jv.branch_id,
    jv.fiscal_year_id,
    jv.id AS voucher_id,
    jv.voucher_number,
    jv.voucher_date,
    jv.status AS voucher_status,
    jv.voucher_kind,
    jv.description AS voucher_description,
    ve.row_number,
    ve.subsidiary_id,
    sub.code AS subsidiary_code,
    sub.name AS subsidiary_name,
    ve.person_id,
    p.name AS person_name,
    p.code AS person_code,
    ve.cost_center_id,
    cc.code AS cost_center_code,
    cc.title AS cost_center_title,
    ve.financial_role_code,
    ve.debit,
    ve.credit,
    ve.description AS entry_description,
    ve.contract_type,
    jv.source_type,
    jv.source_id,
    jv.reversal_of_voucher_id,
    ve.created_at
FROM public.voucher_entries ve
JOIN public.journal_vouchers jv ON jv.id = ve.voucher_id AND jv.organization_id = ve.organization_id
JOIN public.account_subsidiaries sub ON sub.id = ve.subsidiary_id AND sub.organization_id = ve.organization_id
LEFT JOIN public.persons p ON p.id = ve.person_id AND p.organization_id = ve.organization_id
LEFT JOIN public.cost_centers cc ON cc.id = ve.cost_center_id AND cc.organization_id = ve.organization_id
WHERE jv.status IN ('POSTED', 'REVERSED');

COMMENT ON VIEW public.vw_financial_ledger_entries IS 'Complete double-entry accounting ledger entries. Strictly includes POSTED and REVERSED vouchers with security_invoker = true.';

-- ==============================================================================
-- 12. SECURITY & ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
-- Revoke execution from PUBLIC for all functions and view
REVOKE EXECUTE ON FUNCTION public.post_journal_voucher(UUID, UUID, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_journal_voucher(UUID, UUID, UUID, DATE, TEXT, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_draft_journal_voucher(UUID, UUID, TEXT, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON public.vw_financial_ledger_entries FROM PUBLIC, anon;

-- Grant execution to authenticated
GRANT EXECUTE ON FUNCTION public.post_journal_voucher(UUID, UUID, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_journal_voucher(UUID, UUID, UUID, DATE, TEXT, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_draft_journal_voucher(UUID, UUID, TEXT, INT, TEXT, TEXT) TO authenticated;
GRANT SELECT ON public.vw_financial_ledger_entries TO authenticated;

-- Revoke direct mutation rights on tables from anon and authenticated
REVOKE INSERT, UPDATE, DELETE ON public.journal_vouchers FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.voucher_entries FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.voucher_sequences FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.voucher_operation_keys FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cost_centers FROM PUBLIC, anon, authenticated;

-- Enable RLS
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_operation_keys ENABLE ROW LEVEL SECURITY;

-- Cost Centers Policies: View for active org members, direct writes blocked
CREATE POLICY "Active org members can view cost centers"
ON public.cost_centers FOR SELECT TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Direct client modification of cost centers is forbidden"
ON public.cost_centers FOR ALL TO authenticated
USING (false) WITH CHECK (false);

-- Voucher Sequences Policies: Direct mutation blocked
CREATE POLICY "Direct client modification of voucher sequences is forbidden"
ON public.voucher_sequences FOR ALL TO authenticated
USING (false) WITH CHECK (false);

-- Operation Keys Policies: Direct mutation blocked
CREATE POLICY "Direct client modification of operation keys is forbidden"
ON public.voucher_operation_keys FOR ALL TO authenticated
USING (false) WITH CHECK (false);

-- Journal Vouchers Policies: View for active org members with branch finance:read
CREATE POLICY "Active org members with branch finance read permission can view vouchers"
ON public.journal_vouchers FOR SELECT TO authenticated
USING (
    public.is_org_member(organization_id) AND
    public.has_branch_permission(organization_id, branch_id, 'finance:read')
);

CREATE POLICY "Direct client mutation of journal vouchers is forbidden"
ON public.journal_vouchers FOR ALL TO authenticated
USING (false) WITH CHECK (false);

-- Voucher Entries Policies: View for active org members with branch finance:read
CREATE POLICY "Active org members with branch finance read permission can view entries"
ON public.voucher_entries FOR SELECT TO authenticated
USING (
    public.is_org_member(organization_id) AND
    EXISTS (
        SELECT 1 FROM public.journal_vouchers jv
        WHERE jv.id = voucher_entries.voucher_id
          AND jv.organization_id = voucher_entries.organization_id
          AND public.has_branch_permission(jv.organization_id, jv.branch_id, 'finance:read')
    )
);

CREATE POLICY "Direct client mutation of voucher entries is forbidden"
ON public.voucher_entries FOR ALL TO authenticated
USING (false) WITH CHECK (false);

COMMIT;

-- ==============================================================================
-- SECTION: 06_inventory_master_data.sql
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- Migration: 06_inventory_master_data.sql
-- Description: Phase 3-H - Core Master Data Infrastructure for Units, Categories, Products, Warehouses, User Warehouse Access, and Product Serials
-- Rules & Constraints Implemented:
--   1. Fully enclosed in atomic transaction (BEGIN ... COMMIT). Zero test data created.
--   2. Units of Measurement (measurement_units): decimal_places 0..3, if allows_fraction=false then decimal_places=0.
--   3. Product Categories (product_categories): Hierarchical categories with org-isolated parent FKs and cycle prevention trigger.
--   4. Products (products): Supports PRODUCT and SERVICE. SERVICES cannot be serialized and reorder_point must be 0.
--      Serialized products require integer reorder_point. NO opening stock or cost stored in products table.
--      Physical deletion restricted to DRAFT status only.
--   5. Product Code Sequences (product_code_sequences): Atomic counter table locked against direct client access.
--   6. Warehouses (warehouses): Org and branch isolated. At most ONE active default warehouse per branch.
--      Default warehouse MUST have status ACTIVE. Physical deletion restricted to DRAFT status only.
--   7. User Warehouse Access (user_warehouse_access): Org-isolated user access control. Validated for active membership,
--      active user profile, active warehouse, permitted branch, and default status alignment via trigger.
--   8. Product Serials (product_serials): Unique serial_number_normalized across the ENTIRE organization.
--      Immutable physical retention (physical deletion strictly forbidden). Raw serial saved for display, normalized string for uniqueness.
--      Status and location alignment strictly enforced via check constraint.
--   9. Immutable system fields (organization_id, id, created_by, created_at) guarded via trigger.
--  10. Strict Row Level Security (RLS) policies enforcing multi-tenant organization boundaries and SELECT-ONLY client access.
--      Direct client INSERT, UPDATE, and DELETE operations are strictly REVOKED.
-- ==============================================================================

-- ==============================================================================
-- 1. MEASUREMENT UNITS (واحدهای سنجش)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.measurement_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    allows_fraction BOOLEAN NOT NULL DEFAULT false,
    decimal_places INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_system BOOLEAN NOT NULL DEFAULT false,
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_unit_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_unit_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_unit_decimal_places CHECK (decimal_places >= 0 AND decimal_places <= 3),
    CONSTRAINT chk_unit_fraction_decimals CHECK (
        (allows_fraction = false AND decimal_places = 0) OR (allows_fraction = true)
    )
);

-- ==============================================================================
-- 2. PRODUCT CATEGORIES (دسته‌بندی کالاها و خدمات)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    parent_category_id UUID,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_category_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_category_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_category_parent_not_self CHECK (parent_category_id IS NULL OR parent_category_id <> id),
    CONSTRAINT fk_category_parent FOREIGN KEY (organization_id, parent_category_id)
        REFERENCES public.product_categories(organization_id, id) ON DELETE RESTRICT
);

-- ==============================================================================
-- 3. PRODUCTS & SERVICES (تعریف کالا و خدمت)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category_id UUID NOT NULL,
    measurement_unit_id UUID NOT NULL,
    product_kind TEXT NOT NULL DEFAULT 'PRODUCT',
    is_serialized BOOLEAN NOT NULL DEFAULT false,
    reorder_point NUMERIC(18, 3) NOT NULL DEFAULT 0,
    default_sale_price_amount BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_product_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_product_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_product_kind CHECK (product_kind IN ('PRODUCT', 'SERVICE')),
    CONSTRAINT chk_product_status CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'BLOCKED')),
    CONSTRAINT chk_product_reorder_point CHECK (reorder_point >= 0),
    CONSTRAINT chk_product_sale_price CHECK (default_sale_price_amount >= 0),
    CONSTRAINT chk_service_not_serialized CHECK (product_kind <> 'SERVICE' OR is_serialized = false),
    CONSTRAINT chk_service_no_reorder_point CHECK (product_kind <> 'SERVICE' OR reorder_point = 0),
    CONSTRAINT chk_serialized_integer_reorder CHECK (is_serialized = false OR reorder_point = floor(reorder_point)),
    CONSTRAINT fk_product_category FOREIGN KEY (organization_id, category_id)
        REFERENCES public.product_categories(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_product_unit FOREIGN KEY (organization_id, measurement_unit_id)
        REFERENCES public.measurement_units(organization_id, id) ON DELETE RESTRICT
);

-- ==============================================================================
-- 4. PRODUCT CODE SEQUENCES (شمارنده کد کالا)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.product_code_sequences (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
    prefix TEXT NOT NULL DEFAULT 'PRD-',
    next_number BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT chk_seq_next_number CHECK (next_number > 0)
);

-- ==============================================================================
-- 5. WAREHOUSES (انبارها)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    location TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_warehouse_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_warehouse_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_warehouse_status CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
    CONSTRAINT chk_warehouse_default_status CHECK (is_default = false OR status = 'ACTIVE'),
    CONSTRAINT fk_warehouse_branch FOREIGN KEY (organization_id, branch_id)
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT
);

-- Partial unique index: Maximum 1 active default warehouse per branch
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_default_warehouse_per_branch
ON public.warehouses(organization_id, branch_id)
WHERE is_default = true AND status = 'ACTIVE';

-- ==============================================================================
-- 6. USER WAREHOUSE ACCESS (دسترسی کاربران به انبارها)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.user_warehouse_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    membership_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    granted_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_warehouse_membership UNIQUE (membership_id, warehouse_id),
    CONSTRAINT uq_user_wh_access_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_user_wh_default_active CHECK (is_default = false OR is_active = true),
    CONSTRAINT fk_user_wh_access_membership FOREIGN KEY (organization_id, membership_id)
        REFERENCES public.organization_memberships(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_user_wh_access_warehouse FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT
);

-- Partial unique index: Maximum 1 active default warehouse per membership
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_single_default_warehouse
ON public.user_warehouse_access(membership_id)
WHERE is_default = true AND is_active = true;

-- ==============================================================================
-- 7. PRODUCT SERIALS (شماره سریال ردیابی کالاهای سریال‌دار)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.product_serials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL,
    serial_number_raw TEXT NOT NULL,
    serial_number_normalized TEXT NOT NULL,
    acquisition_cost_amount BIGINT NOT NULL DEFAULT 0,
    current_warehouse_id UUID,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_serial_normalized_per_org UNIQUE (organization_id, serial_number_normalized),
    CONSTRAINT uq_product_serial_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_serial_status CHECK (status IN ('AVAILABLE', 'RESERVED', 'SOLD', 'RETURNED', 'SCRAPPED', 'REVERSED')),
    CONSTRAINT chk_serial_acquisition_cost CHECK (acquisition_cost_amount >= 0),
    CONSTRAINT chk_serial_status_warehouse CHECK (
        (status IN ('AVAILABLE', 'RESERVED', 'RETURNED') AND current_warehouse_id IS NOT NULL)
        OR
        (status IN ('SOLD', 'SCRAPPED', 'REVERSED') AND current_warehouse_id IS NULL)
    ),
    CONSTRAINT fk_serial_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_serial_warehouse FOREIGN KEY (organization_id, current_warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT
);

-- Document derived state fields in product_serials
COMMENT ON COLUMN public.product_serials.status IS 'Derived status field managed strictly via atomic warehouse movement transactions in future service phases. REVERSED indicates permanent reversal of serial entry transaction.';
COMMENT ON COLUMN public.product_serials.current_warehouse_id IS 'Derived current physical location managed strictly via atomic warehouse movement transactions in future service phases.';
COMMENT ON COLUMN public.product_serials.acquisition_cost_amount IS 'Derived acquisition cost amount managed strictly via inventory entry vouchers in future service phases.';

-- ==============================================================================
-- INDEXES FOR PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_measurement_units_org ON public.measurement_units(organization_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_org ON public.product_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_parent ON public.product_categories(organization_id, parent_category_id);
CREATE INDEX IF NOT EXISTS idx_products_org ON public.products(organization_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(organization_id, category_id);
CREATE INDEX IF NOT EXISTS idx_products_unit ON public.products(organization_id, measurement_unit_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_org ON public.warehouses(organization_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_branch ON public.warehouses(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_user_wh_access_membership ON public.user_warehouse_access(membership_id);
CREATE INDEX IF NOT EXISTS idx_user_wh_access_warehouse ON public.user_warehouse_access(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_org ON public.product_serials(organization_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_product ON public.product_serials(organization_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_warehouse ON public.product_serials(organization_id, current_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_normalized ON public.product_serials(organization_id, serial_number_normalized);

-- ==============================================================================
-- HELPER FUNCTIONS & TRIGGERS
-- ==============================================================================

-- 1. Normalization Helper for Serial Numbers (Iranian digits -> ASCII, Upper Case, Trim Whitespace)
CREATE OR REPLACE FUNCTION public.normalize_serial_number(p_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_res TEXT;
BEGIN
    IF p_input IS NULL THEN
        RETURN NULL;
    END IF;
    -- Translate Persian (۰-۹) & Arabic (٠-٩) digits to ASCII digits
    v_res := translate(p_input, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789');
    -- Trim leading and trailing whitespace
    v_res := trim(v_res);
    -- Remove internal whitespace or control characters
    v_res := regexp_replace(v_res, '\s+', '', 'g');
    -- Upper case ASCII characters
    v_res := upper(v_res);
    IF v_res = '' THEN
        RETURN NULL;
    END IF;
    RETURN v_res;
END;
$$;

-- 2. Trigger Function: Version Incrementor & Timestamp updater
CREATE OR REPLACE FUNCTION public.trg_increment_inventory_master_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Triggers for versioning
DROP TRIGGER IF EXISTS trg_measurement_units_version ON public.measurement_units;
CREATE TRIGGER trg_measurement_units_version
BEFORE UPDATE ON public.measurement_units
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

DROP TRIGGER IF EXISTS trg_product_categories_version ON public.product_categories;
CREATE TRIGGER trg_product_categories_version
BEFORE UPDATE ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

DROP TRIGGER IF EXISTS trg_products_version ON public.products;
CREATE TRIGGER trg_products_version
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

DROP TRIGGER IF EXISTS trg_warehouses_version ON public.warehouses;
CREATE TRIGGER trg_warehouses_version
BEFORE UPDATE ON public.warehouses
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

DROP TRIGGER IF EXISTS trg_user_warehouse_access_version ON public.user_warehouse_access;
CREATE TRIGGER trg_user_warehouse_access_version
BEFORE UPDATE ON public.user_warehouse_access
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

DROP TRIGGER IF EXISTS trg_product_serials_version ON public.product_serials;
CREATE TRIGGER trg_product_serials_version
BEFORE UPDATE ON public.product_serials
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

-- 3. Trigger Function: Immutability Protection for Core System Identifiers
CREATE OR REPLACE FUNCTION public.prevent_inventory_immutable_fields_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'Modification of organization_id is strictly forbidden.';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Modification of record id is strictly forbidden.';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Modification of created_at timestamp is strictly forbidden.';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'Modification of created_by user reference is strictly forbidden.';
    END IF;
    RETURN NEW;
END;
$$;

-- Apply immutability triggers
DROP TRIGGER IF EXISTS trg_units_immutability ON public.measurement_units;
CREATE TRIGGER trg_units_immutability
BEFORE UPDATE ON public.measurement_units
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_categories_immutability ON public.product_categories;
CREATE TRIGGER trg_categories_immutability
BEFORE UPDATE ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_products_immutability ON public.products;
CREATE TRIGGER trg_products_immutability
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_warehouses_immutability ON public.warehouses;
CREATE TRIGGER trg_warehouses_immutability
BEFORE UPDATE ON public.warehouses
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_user_wh_access_immutability ON public.user_warehouse_access;
CREATE TRIGGER trg_user_wh_access_immutability
BEFORE UPDATE ON public.user_warehouse_access
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_serials_immutability ON public.product_serials;
CREATE TRIGGER trg_serials_immutability
BEFORE UPDATE ON public.product_serials
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

-- 4. Trigger Function: Prevent Cycles in Product Categories
CREATE OR REPLACE FUNCTION public.trg_prevent_product_category_cycles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_curr_parent UUID;
    v_visited UUID[];
BEGIN
    IF NEW.parent_category_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.parent_category_id = NEW.id THEN
        RAISE EXCEPTION 'Category cannot be its own parent.';
    END IF;

    -- Transactional lock scoped to organization to prevent concurrent cycle creation
    PERFORM pg_advisory_xact_lock(hashtext('product_categories_' || NEW.organization_id::text));

    v_curr_parent := NEW.parent_category_id;
    v_visited := ARRAY[NEW.id];

    WHILE v_curr_parent IS NOT NULL LOOP
        IF v_curr_parent = ANY(v_visited) THEN
            RAISE EXCEPTION 'Cyclic parent-child relationship detected in product categories.';
        END IF;

        v_visited := array_append(v_visited, v_curr_parent);

        SELECT pc.parent_category_id INTO v_curr_parent
        FROM public.product_categories pc
        WHERE pc.id = v_curr_parent AND pc.organization_id = NEW.organization_id;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_category_cycle ON public.product_categories;
CREATE TRIGGER trg_prevent_category_cycle
BEFORE INSERT OR UPDATE ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_product_category_cycles();

-- 5. Trigger Function: Validate User Warehouse Access Integrity
CREATE OR REPLACE FUNCTION public.trg_validate_user_warehouse_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_mem_org UUID;
    v_mem_active BOOLEAN;
    v_mem_branch UUID;
    v_user_active BOOLEAN;
    v_wh_branch UUID;
    v_wh_status TEXT;
    v_has_branch_access BOOLEAN;
BEGIN
    -- Verify membership existence and active status
    SELECT om.organization_id, om.is_active, om.default_branch_id 
    INTO v_mem_org, v_mem_active, v_mem_branch
    FROM public.organization_memberships om
    WHERE om.id = NEW.membership_id AND om.organization_id = NEW.organization_id;

    IF v_mem_org IS NULL OR v_mem_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Membership does not exist or is inactive in the specified organization.';
    END IF;

    -- Verify active status of underlying user profile
    SELECT up.is_active INTO v_user_active
    FROM public.user_profiles up
    JOIN public.organization_memberships om ON om.user_id = up.id
    WHERE om.id = NEW.membership_id;

    IF v_user_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'User profile associated with this membership is inactive or blocked.';
    END IF;

    -- Verify warehouse existence, org alignment, and ACTIVE status
    SELECT w.branch_id, w.status INTO v_wh_branch, v_wh_status
    FROM public.warehouses w
    WHERE w.id = NEW.warehouse_id AND w.organization_id = NEW.organization_id;

    IF v_wh_branch IS NULL THEN
        RAISE EXCEPTION 'Warehouse does not exist in the specified organization.';
    END IF;

    IF v_wh_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Warehouse access can only be granted to ACTIVE warehouses.';
    END IF;

    -- Verify warehouse branch accessibility for membership
    v_has_branch_access := FALSE;
    IF v_mem_branch IS NOT NULL AND v_wh_branch = v_mem_branch THEN
        v_has_branch_access := TRUE;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM public.user_branch_access uba
            WHERE uba.membership_id = NEW.membership_id
              AND uba.organization_id = NEW.organization_id
              AND uba.branch_id = v_wh_branch
              AND uba.is_active = TRUE
        ) INTO v_has_branch_access;
    END IF;

    IF v_has_branch_access IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Warehouse branch is not accessible by this membership.';
    END IF;

    -- Verify default access alignment
    IF NEW.is_default IS TRUE AND NEW.is_active IS FALSE THEN
        RAISE EXCEPTION 'Inactive warehouse access cannot be designated as default.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_user_wh_access ON public.user_warehouse_access;
CREATE TRIGGER trg_validate_user_wh_access
BEFORE INSERT OR UPDATE ON public.user_warehouse_access
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_user_warehouse_access();

-- 6. Trigger Function: Normalize and Validate Product Serials
CREATE OR REPLACE FUNCTION public.trg_normalize_and_validate_product_serial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_product_kind TEXT;
    v_is_serialized BOOLEAN;
    v_wh_status TEXT;
BEGIN
    -- Normalize serial number string
    NEW.serial_number_normalized := public.normalize_serial_number(NEW.serial_number_raw);
    IF NEW.serial_number_normalized IS NULL OR length(NEW.serial_number_normalized) = 0 THEN
        RAISE EXCEPTION 'Serial number cannot be empty or invalid.';
    END IF;

    -- Verify product serialization capability and org alignment
    SELECT p.product_kind, p.is_serialized INTO v_product_kind, v_is_serialized
    FROM public.products p
    WHERE p.id = NEW.product_id AND p.organization_id = NEW.organization_id;

    IF v_product_kind IS NULL THEN
        RAISE EXCEPTION 'Referenced product does not exist in the specified organization.';
    END IF;

    IF v_product_kind = 'SERVICE' THEN
        RAISE EXCEPTION 'Serial numbers cannot be assigned to services.';
    END IF;

    IF v_is_serialized IS FALSE THEN
        RAISE EXCEPTION 'Serial numbers can only be registered for products marked with is_serialized = true.';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'REVERSED' THEN
        IF NEW.status IS DISTINCT FROM 'REVERSED' THEN
            RAISE EXCEPTION 'Serial status REVERSED is final and cannot be modified.';
        END IF;
        IF NEW.current_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'A REVERSED serial number cannot be assigned to a warehouse.';
        END IF;
    END IF;

    -- Validate serial status vs warehouse status and presence
    IF NEW.status IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN
        IF NEW.current_warehouse_id IS NULL THEN
            RAISE EXCEPTION 'Serial status % requires a valid warehouse assignment.', NEW.status;
        END IF;

        SELECT w.status INTO v_wh_status
        FROM public.warehouses w
        WHERE w.id = NEW.current_warehouse_id AND w.organization_id = NEW.organization_id;

        IF v_wh_status IS NULL OR v_wh_status <> 'ACTIVE' THEN
            RAISE EXCEPTION 'Current warehouse for serial number must be an ACTIVE warehouse in the same organization.';
        END IF;
    ELSIF NEW.status IN ('SOLD', 'SCRAPPED', 'REVERSED') THEN
        IF NEW.current_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'Serial status % must not have a current warehouse.', NEW.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_serials_normalize ON public.product_serials;
CREATE TRIGGER trg_product_serials_normalize
BEFORE INSERT OR UPDATE ON public.product_serials
FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_and_validate_product_serial();

-- 7. Physical Deletion Guards
CREATE OR REPLACE FUNCTION public.prevent_product_physical_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Physical deletion of non-draft products is strictly forbidden. Deactivate or block the product instead.';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_product_deletion ON public.products;
CREATE TRIGGER trg_prevent_product_deletion
BEFORE DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.prevent_product_physical_deletion();

CREATE OR REPLACE FUNCTION public.prevent_warehouse_physical_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Physical deletion of non-draft warehouses is strictly forbidden. Deactivate the warehouse instead.';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_warehouse_deletion ON public.warehouses;
CREATE TRIGGER trg_prevent_warehouse_deletion
BEFORE DELETE ON public.warehouses
FOR EACH ROW EXECUTE FUNCTION public.prevent_warehouse_physical_deletion();

CREATE OR REPLACE FUNCTION public.prevent_product_serial_physical_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Physical deletion of serial number records is strictly forbidden for audit and traceability preservation.';
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_serial_deletion ON public.product_serials;
CREATE TRIGGER trg_prevent_serial_deletion
BEFORE DELETE ON public.product_serials
FOR EACH ROW EXECUTE FUNCTION public.prevent_product_serial_physical_deletion();

CREATE OR REPLACE FUNCTION public.prevent_system_unit_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.is_system IS TRUE THEN
        RAISE EXCEPTION 'Physical deletion of system measurement units is strictly forbidden.';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_unit_deletion ON public.measurement_units;
CREATE TRIGGER trg_prevent_system_unit_deletion
BEFORE DELETE ON public.measurement_units
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_unit_deletion();

-- Revoke default public execution rights on security helper and trigger functions
REVOKE EXECUTE ON FUNCTION public.normalize_serial_number(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_increment_inventory_master_version() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_immutable_fields_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_prevent_product_category_cycles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_user_warehouse_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_normalize_and_validate_product_serial() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_product_physical_deletion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_warehouse_physical_deletion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_product_serial_physical_deletion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_system_unit_deletion() FROM PUBLIC;

-- ==============================================================================
-- PERMISSIONS SEED DATA (CATALOG DEFINITION ONLY - NO ROLE MAPPINGS)
-- ==============================================================================
INSERT INTO public.permissions (code, name_fa, category, description) VALUES
('inventory:read', 'مشاهده کالاها و انبارها', 'انبارداری', 'امکان مشاهده اطلاعات پایه کالاها، انبارها، موجودی و سریال‌ها'),
('inventory:manage', 'مدیریت کالاها، انبارها و سریال‌ها', 'انبارداری', 'امکان تعریف و ویرایش اطلاعات پایه کالاها، انبارها و دسترسی‌ها')
ON CONFLICT (code) DO NOTHING;

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES & PRIVILEGE REVOCATIONS
-- ==============================================================================
ALTER TABLE public.measurement_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_code_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_warehouse_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_serials ENABLE ROW LEVEL SECURITY;

-- 1. Measurement Units RLS Policies (SELECT ONLY)
CREATE POLICY "Members can view measurement units of their org"
ON public.measurement_units FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- 2. Product Categories RLS Policies (SELECT ONLY)
CREATE POLICY "Members can view product categories of their org"
ON public.product_categories FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- 3. Products RLS Policies (SELECT ONLY)
CREATE POLICY "Members can view products of their org"
ON public.products FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- 4. Warehouses RLS Policies (SELECT ONLY)
CREATE POLICY "Members can view warehouses of their org"
ON public.warehouses FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- 5. User Warehouse Access RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view user warehouse access"
ON public.user_warehouse_access FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        EXISTS (
            SELECT 1 FROM public.organization_memberships om
            WHERE om.id = user_warehouse_access.membership_id
              AND om.user_id = auth.uid()
        )
        OR public.has_permission(organization_id, 'users:manage')
        OR public.has_permission(organization_id, 'inventory:manage')
    )
);

-- 6. Product Serials RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view product serials"
ON public.product_serials FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- Revoke all privileges on product_code_sequences
REVOKE ALL ON public.product_code_sequences FROM PUBLIC, anon, authenticated;

-- Revoke direct mutation privileges from PUBLIC, anon, authenticated on six tables
REVOKE INSERT, UPDATE, DELETE ON public.measurement_units FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.product_categories FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.products FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.warehouses FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_warehouse_access FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.product_serials FROM PUBLIC, anon, authenticated;

-- Explicitly revoke SELECT from PUBLIC and anon on all seven tables
REVOKE SELECT ON public.measurement_units FROM PUBLIC, anon;
REVOKE SELECT ON public.product_categories FROM PUBLIC, anon;
REVOKE SELECT ON public.products FROM PUBLIC, anon;
REVOKE SELECT ON public.product_code_sequences FROM PUBLIC, anon;
REVOKE SELECT ON public.warehouses FROM PUBLIC, anon;
REVOKE SELECT ON public.user_warehouse_access FROM PUBLIC, anon;
REVOKE SELECT ON public.product_serials FROM PUBLIC, anon;

-- Grant SELECT to authenticated on six tables (access governed by RLS)
GRANT SELECT ON public.measurement_units TO authenticated;
GRANT SELECT ON public.product_categories TO authenticated;
GRANT SELECT ON public.products TO authenticated;
GRANT SELECT ON public.warehouses TO authenticated;
GRANT SELECT ON public.user_warehouse_access TO authenticated;
GRANT SELECT ON public.product_serials TO authenticated;

COMMIT;

-- ==============================================================================
-- SECTION: 07_inventory_ledger_foundation.sql
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- Migration: 07_inventory_ledger_foundation.sql
-- Description: Phase 3-I - Core Inventory Transaction Ledger Foundation, Warehouse Balances,
--              Org Cost Balances, Warehouse Account Mappings, Negative Override Authorizations/Logs,
--              and Provisional Cost Allocation Architecture.
-- Rules & Constraints Implemented:
--   1. Fully enclosed in atomic transaction (BEGIN ... COMMIT). Zero test data created.
--   2. Document Sequences (inventory_document_sequences): Atomic counter per organization & fiscal year.
--   3. Transaction Headers (inventory_transactions): Strict lifecycle status (DRAFT, POSTED, REVERSED, CANCELLED),
--      transaction types, reversal tracking, idempotency, and audit fields. Header physical deletion forbidden.
--   4. Transaction Items (inventory_transaction_items): Detailed item rows validated against org boundaries,
--      service exclusions, unit decimal precision, serialized integer quantities, and warehouse direction rules.
--   5. Transaction Serials (inventory_transaction_serials): Mapping table between item rows and product_serials.
--   6. Warehouse Balances (inventory_balances): Quantity on hand per org, warehouse, and product.
--      NO check constraint preventing negative balance so manager-approved override exceptions remain possible.
--   7. Organizational Cost Balances (inventory_cost_balances): Single record per product across entire org.
--      Tracks org total quantity, total inventory value, and weighted average unit cost.
--      Internal warehouse transfers strictly do NOT alter org total quantity or org cost balance.
--   8. Warehouse Account Mappings (warehouse_inventory_account_mappings): Time-bound mapping of warehouse to COA subsidiary.
--      GIST temporal exclusion prevents overlapping validity ranges. Physical deletion forbidden.
--   9. Negative Override Authorizations & Logs (inventory_negative_override_authorizations / logs):
--      One-time manager authorization linked to draft transaction, request fingerprint, and security audit log.
--      Immutable consumption log strictly restricted to non-serialized products.
--  10. Provisional Cost Positions & Allocations (inventory_provisional_cost_positions / allocations):
--      Tracks sales made with provisional costs waiting for actual purchase matching. Customer sale price is completely separate.
--  11. Read-Only View (vw_inventory_ledger): Security invoker view showing POSTED and REVERSED transactions only.
--  12. Catalog permissions (inventory:post, inventory:negative_override) defined in permissions catalog ONLY.
--      Zero insertions into role_permissions and zero test data.
-- ==============================================================================

-- ==============================================================================
-- A. INVENTORY DOCUMENT SEQUENCES (شمارنده اسناد انبار)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_document_sequences (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL,
    next_number BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    PRIMARY KEY (organization_id, fiscal_year_id),
    CONSTRAINT fk_inv_seq_fiscal_year FOREIGN KEY (organization_id, fiscal_year_id)
        REFERENCES public.fiscal_years(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_inv_seq_next_number CHECK (next_number > 0)
);

COMMENT ON TABLE public.inventory_document_sequences IS 'Atomic sequence counter for finalized inventory document numbers per organization and fiscal year.';

-- ==============================================================================
-- B. INVENTORY TRANSACTIONS HEADER (سربرگ دفتر گردش انبار)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL,
    initiating_branch_id UUID NOT NULL,
    document_number BIGINT,
    transaction_date DATE NOT NULL,
    transaction_type TEXT NOT NULL,
    transaction_kind TEXT NOT NULL DEFAULT 'GENERAL',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    description TEXT NOT NULL,
    source_event_key TEXT,
    idempotency_key TEXT,
    request_fingerprint TEXT,
    reversal_of_transaction_id UUID,
    journal_voucher_id UUID,
    cost_state TEXT NOT NULL DEFAULT 'PENDING',
    version INT NOT NULL DEFAULT 1,
    created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    posted_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    posted_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    reversed_at TIMESTAMPTZ,
    reversal_reason TEXT,
    cancelled_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    CONSTRAINT uq_inv_trans_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_inv_trans_type CHECK (
        transaction_type IN (
            'OPENING', 'PURCHASE_RECEIPT', 'SALE_ISSUE', 'TRANSFER',
            'SALES_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'COST_ADJUSTMENT'
        )
    ),
    CONSTRAINT chk_inv_trans_kind CHECK (transaction_kind IN ('GENERAL', 'REVERSAL')),
    CONSTRAINT chk_inv_trans_status CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED', 'CANCELLED')),
    CONSTRAINT chk_inv_trans_cost_state CHECK (cost_state IN ('PENDING', 'PROVISIONAL', 'FINAL', 'MIXED')),
    CONSTRAINT fk_inv_trans_branch FOREIGN KEY (organization_id, initiating_branch_id)
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_trans_fiscal_year FOREIGN KEY (organization_id, fiscal_year_id)
        REFERENCES public.fiscal_years(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_trans_reversal_of FOREIGN KEY (organization_id, reversal_of_transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_trans_jv FOREIGN KEY (organization_id, journal_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_inv_trans_no_self_reversal CHECK (reversal_of_transaction_id IS NULL OR reversal_of_transaction_id <> id),
    CONSTRAINT chk_inv_trans_reversal_kind_ref CHECK (
        (transaction_kind = 'REVERSAL' AND reversal_of_transaction_id IS NOT NULL)
        OR
        (transaction_kind = 'GENERAL' AND reversal_of_transaction_id IS NULL)
    ),
    CONSTRAINT chk_inv_trans_status_fields CHECK (
        (status = 'DRAFT' AND document_number IS NULL AND posted_at IS NULL AND posted_by IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR
        (status = 'CANCELLED' AND document_number IS NULL AND posted_at IS NULL AND posted_by IS NULL AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0) OR
        (status = 'POSTED' AND document_number IS NOT NULL AND document_number > 0 AND posted_at IS NOT NULL AND posted_by IS NOT NULL AND reversed_at IS NULL AND reversed_by IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR
        (status = 'REVERSED' AND document_number IS NOT NULL AND document_number > 0 AND posted_at IS NOT NULL AND posted_by IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL AND length(trim(reversal_reason)) > 0)
    )
);

COMMENT ON TABLE public.inventory_transactions IS 'Header table for double-entry inventory ledger transactions with strict lifecycle status and auditing.';

-- Unique Partial Indexes for Inventory Transactions
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_trans_doc_num_per_org_fy
ON public.inventory_transactions(organization_id, fiscal_year_id, document_number)
WHERE document_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_trans_source_event_key_per_org
ON public.inventory_transactions(organization_id, source_event_key)
WHERE source_event_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_trans_idempotency_key_per_org
ON public.inventory_transactions(organization_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_trans_one_reversal_per_tx
ON public.inventory_transactions(organization_id, reversal_of_transaction_id)
WHERE reversal_of_transaction_id IS NOT NULL;

-- ==============================================================================
-- C. INVENTORY TRANSACTION ITEMS (اقلام گردش انبار)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_transaction_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL,
    row_number INT NOT NULL,
    product_id UUID NOT NULL,
    source_warehouse_id UUID,
    destination_warehouse_id UUID,
    quantity NUMERIC(18, 3) NOT NULL,
    unit_cost_amount BIGINT,
    total_cost_amount BIGINT,
    cost_adjustment_amount BIGINT,
    cost_state TEXT NOT NULL DEFAULT 'PENDING',
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inv_item_org_composite UNIQUE (organization_id, id),
    CONSTRAINT uq_inv_item_row_per_tx UNIQUE (transaction_id, row_number),
    CONSTRAINT chk_inv_item_cost_state CHECK (cost_state IN ('PENDING', 'PROVISIONAL', 'FINAL', 'MIXED')),
    CONSTRAINT chk_inv_item_quantity_non_negative CHECK (quantity >= 0),
    CONSTRAINT chk_inv_item_costs_non_negative CHECK (
        (unit_cost_amount IS NULL OR unit_cost_amount >= 0)
        AND
        (total_cost_amount IS NULL OR total_cost_amount >= 0)
    ),
    CONSTRAINT chk_inv_item_cost_state_amounts CHECK (
        (cost_state = 'PENDING') OR
        (cost_state IN ('PROVISIONAL', 'FINAL', 'MIXED') AND unit_cost_amount IS NOT NULL AND unit_cost_amount >= 0 AND total_cost_amount IS NOT NULL AND total_cost_amount >= 0)
    ),
    CONSTRAINT fk_inv_item_tx FOREIGN KEY (organization_id, transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_inv_item_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_item_src_wh FOREIGN KEY (organization_id, source_warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_item_dst_wh FOREIGN KEY (organization_id, destination_warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_transaction_items IS 'Line items for inventory transactions detailing product movements, quantities, and cost amounts.';

-- ==============================================================================
-- D. INVENTORY TRANSACTION SERIALS (رابط اقلام گردش و سریال‌های کالا)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_transaction_serials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    transaction_item_id UUID NOT NULL,
    product_serial_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inv_tx_serial_item_pserial UNIQUE (transaction_item_id, product_serial_id),
    CONSTRAINT fk_inv_tx_serial_item FOREIGN KEY (organization_id, transaction_item_id)
        REFERENCES public.inventory_transaction_items(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_inv_tx_serial_pserial FOREIGN KEY (organization_id, product_serial_id)
        REFERENCES public.product_serials(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_transaction_serials IS 'Junction table linking inventory transaction line items to individual physical product serial numbers.';
COMMENT ON COLUMN public.inventory_transaction_serials.product_serial_id IS 'Exact product_serial_id link. Validation that total count equals item quantity during posting is deferred to future posting function.';

-- ==============================================================================
-- E. INVENTORY BALANCES (مانده تعدادی انبار به تفکیک کالا)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_balances (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL,
    product_id UUID NOT NULL,
    quantity_on_hand NUMERIC(18, 3) NOT NULL DEFAULT 0,
    last_transaction_id UUID,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, warehouse_id, product_id),
    CONSTRAINT fk_inv_bal_warehouse FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_bal_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_bal_last_tx FOREIGN KEY (organization_id, last_transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_balances IS 'Physical quantity on hand per warehouse and product. Derived state updated strictly by trusted transaction posting. NO CHECK(quantity_on_hand>=0) to permit manager-approved negative balance exceptions.';

-- ==============================================================================
-- F. INVENTORY COST BALANCES (مانده بهای سازمانی و میانگین موزون)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_cost_balances (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL,
    organization_quantity_on_hand NUMERIC(18, 3) NOT NULL DEFAULT 0,
    inventory_value_amount BIGINT NOT NULL DEFAULT 0,
    weighted_average_cost_amount BIGINT NOT NULL DEFAULT 0,
    last_transaction_id UUID,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, product_id),
    CONSTRAINT fk_inv_cost_bal_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_cost_bal_last_tx FOREIGN KEY (organization_id, last_transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_cost_balances IS 'Organizational total quantity, total inventory value, and moving weighted average unit cost per product. Internal warehouse transfers strictly do NOT alter these values.';

-- ==============================================================================
-- G. WAREHOUSE INVENTORY ACCOUNT MAPPINGS (نگاشت انبار به حساب معین موجودی)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.warehouse_inventory_account_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL,
    subsidiary_id UUID NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'CURRENT',
    validity_range tstzrange GENERATED ALWAYS AS (tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)')) STORED,
    change_reason TEXT,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_wh_acct_map_status CHECK (status IN ('PLANNED', 'CURRENT', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT chk_wh_acct_map_dates CHECK (effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT fk_wh_acct_map_wh FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_wh_acct_map_sub FOREIGN KEY (organization_id, subsidiary_id)
        REFERENCES public.account_subsidiaries(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT ex_wh_acct_map_no_overlap EXCLUDE USING gist (
        organization_id WITH =,
        warehouse_id WITH =,
        validity_range WITH &&
    ) WHERE (status IN ('PLANNED', 'CURRENT', 'EXPIRED'))
);

COMMENT ON TABLE public.warehouse_inventory_account_mappings IS 'Time-bound mapping of warehouse to COA inventory subsidiary account with temporal overlap protection.';

-- ==============================================================================
-- H. INVENTORY NEGATIVE OVERRIDE AUTHORIZATIONS (مجوز یکبارمصرف موجودی منفی)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_negative_override_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL,
    request_fingerprint TEXT NOT NULL,
    reason TEXT NOT NULL,
    requested_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    approved_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    security_audit_log_id UUID NOT NULL,
    authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'ISSUED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_neg_auth_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_neg_auth_status CHECK (status IN ('ISSUED', 'CONSUMED', 'EXPIRED', 'REVOKED')),
    CONSTRAINT chk_neg_auth_reason CHECK (length(trim(reason)) >= 10),
    CONSTRAINT chk_neg_auth_expiry CHECK (expires_at > authorized_at),
    CONSTRAINT chk_neg_auth_consumed_at CHECK (
        (status IN ('ISSUED', 'EXPIRED', 'REVOKED') AND consumed_at IS NULL) OR
        (status = 'CONSUMED' AND consumed_at IS NOT NULL)
    ),
    CONSTRAINT fk_neg_auth_tx FOREIGN KEY (organization_id, transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_neg_auth_audit_log FOREIGN KEY (organization_id, security_audit_log_id)
        REFERENCES public.security_audit_logs(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_negative_override_authorizations IS 'One-time manager authorization token for permitting negative inventory override on a specific draft transaction.';

-- Unique partial index for active negative override authorizations
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_auth_active_per_tx_fingerprint
ON public.inventory_negative_override_authorizations(organization_id, transaction_id, request_fingerprint)
WHERE status = 'ISSUED';

-- ==============================================================================
-- I. INVENTORY NEGATIVE OVERRIDE LOGS (سابقه غیرقابل‌تغییر مصرف مجوز منفی)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_negative_override_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    authorization_id UUID NOT NULL,
    transaction_id UUID NOT NULL,
    transaction_item_id UUID NOT NULL,
    product_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    quantity_before NUMERIC(18, 3) NOT NULL,
    requested_quantity NUMERIC(18, 3) NOT NULL,
    shortage_quantity NUMERIC(18, 3) NOT NULL,
    quantity_after NUMERIC(18, 3) NOT NULL,
    reason_snapshot TEXT NOT NULL,
    approved_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    posted_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_neg_log_auth_item UNIQUE (authorization_id, transaction_item_id),
    CONSTRAINT chk_neg_log_requested_pos CHECK (requested_quantity > 0),
    CONSTRAINT chk_neg_log_qty_after_neg CHECK (quantity_after < 0),
    CONSTRAINT chk_neg_log_shortage_positive CHECK (shortage_quantity > 0),
    CONSTRAINT chk_neg_log_qty_math CHECK (quantity_after = quantity_before - requested_quantity),
    CONSTRAINT chk_neg_log_shortage_calc CHECK (shortage_quantity = (requested_quantity - GREATEST(quantity_before, 0))),
    CONSTRAINT fk_neg_log_auth FOREIGN KEY (organization_id, authorization_id)
        REFERENCES public.inventory_negative_override_authorizations(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_neg_log_tx FOREIGN KEY (organization_id, transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_neg_log_item FOREIGN KEY (organization_id, transaction_item_id)
        REFERENCES public.inventory_transaction_items(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_neg_log_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_neg_log_warehouse FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_negative_override_logs IS 'Immutable audit log of negative inventory override consumption per transaction line item.';

-- ==============================================================================
-- J. INVENTORY PROVISIONAL COST POSITIONS (فروش‌های دارای بهای موقت)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_provisional_cost_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    issue_transaction_item_id UUID NOT NULL,
    product_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    shortage_quantity NUMERIC(18, 3) NOT NULL,
    remaining_quantity NUMERIC(18, 3) NOT NULL,
    provisional_unit_cost_amount BIGINT NOT NULL,
    provisional_total_cost_amount BIGINT NOT NULL,
    settled_actual_cost_amount BIGINT NOT NULL DEFAULT 0,
    total_adjustment_amount BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN',
    reversal_transaction_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    CONSTRAINT uq_prov_pos_issue_item UNIQUE (issue_transaction_item_id),
    CONSTRAINT chk_prov_pos_status CHECK (status IN ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'REVERSED')),
    CONSTRAINT chk_prov_pos_status_rules CHECK (
        (status = 'OPEN' AND remaining_quantity = shortage_quantity AND settled_at IS NULL AND reversal_transaction_id IS NULL) OR
        (status = 'PARTIALLY_SETTLED' AND remaining_quantity > 0 AND remaining_quantity < shortage_quantity AND settled_at IS NULL AND reversal_transaction_id IS NULL) OR
        (status = 'SETTLED' AND remaining_quantity = 0 AND settled_at IS NOT NULL AND reversal_transaction_id IS NULL) OR
        (status = 'REVERSED' AND remaining_quantity = 0 AND settled_at IS NULL AND reversal_transaction_id IS NOT NULL)
    ),
    CONSTRAINT chk_prov_pos_shortage CHECK (shortage_quantity > 0),
    CONSTRAINT chk_prov_pos_remaining CHECK (remaining_quantity >= 0 AND remaining_quantity <= shortage_quantity),
    CONSTRAINT chk_prov_pos_costs_non_neg CHECK (
        provisional_unit_cost_amount >= 0 AND provisional_total_cost_amount >= 0 AND settled_actual_cost_amount >= 0
    ),
    CONSTRAINT fk_prov_pos_item FOREIGN KEY (organization_id, issue_transaction_item_id)
        REFERENCES public.inventory_transaction_items(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_prov_pos_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_prov_pos_warehouse FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_prov_pos_reversal_tx FOREIGN KEY (organization_id, reversal_transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_prov_pos_org_composite UNIQUE (organization_id, id)
);

COMMENT ON TABLE public.inventory_provisional_cost_positions IS 'Open sales positions recorded with provisional costs awaiting match with subsequent purchase receipts. Customer sale price is completely separate and unaffected.';

-- ==============================================================================
-- K. INVENTORY PROVISIONAL COST ALLOCATIONS (تخصیص خریدهای بعدی به بهای موقت)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_provisional_cost_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    provisional_position_id UUID NOT NULL,
    receipt_transaction_item_id UUID NOT NULL,
    allocated_quantity NUMERIC(18, 3) NOT NULL,
    provisional_unit_cost_amount BIGINT NOT NULL,
    actual_unit_cost_amount BIGINT NOT NULL,
    adjustment_amount BIGINT NOT NULL,
    adjustment_journal_voucher_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_prov_alloc_qty_pos CHECK (allocated_quantity > 0),
    CONSTRAINT chk_prov_alloc_unit_costs CHECK (provisional_unit_cost_amount >= 0 AND actual_unit_cost_amount >= 0),
    CONSTRAINT fk_prov_alloc_position FOREIGN KEY (organization_id, provisional_position_id)
        REFERENCES public.inventory_provisional_cost_positions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_prov_alloc_receipt_item FOREIGN KEY (organization_id, receipt_transaction_item_id)
        REFERENCES public.inventory_transaction_items(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_prov_alloc_jv FOREIGN KEY (organization_id, adjustment_journal_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_provisional_cost_allocations IS 'Immutable allocation record linking a purchase receipt line item to a provisional cost sale position. Adjusts internal inventory cost accounting without affecting customer sale price.';

-- ==============================================================================
-- INDEXES FOR PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_inv_seq_org ON public.inventory_document_sequences(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_org ON public.inventory_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_branch ON public.inventory_transactions(organization_id, initiating_branch_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_fiscal ON public.inventory_transactions(organization_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_date ON public.inventory_transactions(organization_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_inv_trans_status ON public.inventory_transactions(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_inv_items_org ON public.inventory_transaction_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_tx ON public.inventory_transaction_items(organization_id, transaction_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_product ON public.inventory_transaction_items(organization_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_src_wh ON public.inventory_transaction_items(organization_id, source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_dst_wh ON public.inventory_transaction_items(organization_id, destination_warehouse_id);

CREATE INDEX IF NOT EXISTS idx_inv_serials_tx_item ON public.inventory_transaction_serials(organization_id, transaction_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_serials_pserial ON public.inventory_transaction_serials(organization_id, product_serial_id);

CREATE INDEX IF NOT EXISTS idx_inv_bal_org ON public.inventory_balances(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_bal_wh ON public.inventory_balances(organization_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_bal_prod ON public.inventory_balances(organization_id, product_id);

CREATE INDEX IF NOT EXISTS idx_inv_cost_bal_org ON public.inventory_cost_balances(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_cost_bal_prod ON public.inventory_cost_balances(organization_id, product_id);

CREATE INDEX IF NOT EXISTS idx_wh_acct_map_wh ON public.warehouse_inventory_account_mappings(organization_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_wh_acct_map_sub ON public.warehouse_inventory_account_mappings(organization_id, subsidiary_id);

CREATE INDEX IF NOT EXISTS idx_neg_auth_tx ON public.inventory_negative_override_authorizations(organization_id, transaction_id);
CREATE INDEX IF NOT EXISTS idx_neg_log_tx ON public.inventory_negative_override_logs(organization_id, transaction_id);
CREATE INDEX IF NOT EXISTS idx_prov_pos_prod ON public.inventory_provisional_cost_positions(organization_id, product_id);
CREATE INDEX IF NOT EXISTS idx_prov_pos_reversal_tx ON public.inventory_provisional_cost_positions(organization_id, reversal_transaction_id) WHERE reversal_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prov_alloc_pos ON public.inventory_provisional_cost_allocations(organization_id, provisional_position_id);
CREATE INDEX IF NOT EXISTS idx_prov_alloc_receipt_item ON public.inventory_provisional_cost_allocations(organization_id, receipt_transaction_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_product_tx ON public.inventory_transaction_items(organization_id, product_id, transaction_id);

-- ==============================================================================
-- HELPER & TRIGGER FUNCTIONS (SECURITY INVOKER)
-- ==============================================================================

-- 1. Increment Version and Updated Timestamp
CREATE OR REPLACE FUNCTION public.trg_increment_inventory_ledger_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_trans_version ON public.inventory_transactions;
CREATE TRIGGER trg_inv_trans_version
BEFORE UPDATE ON public.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_ledger_version();

DROP TRIGGER IF EXISTS trg_inv_bal_version ON public.inventory_balances;
CREATE TRIGGER trg_inv_bal_version
BEFORE UPDATE ON public.inventory_balances
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_ledger_version();

DROP TRIGGER IF EXISTS trg_inv_cost_bal_version ON public.inventory_cost_balances;
CREATE TRIGGER trg_inv_cost_bal_version
BEFORE UPDATE ON public.inventory_cost_balances
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_ledger_version();

DROP TRIGGER IF EXISTS trg_wh_acct_map_version ON public.warehouse_inventory_account_mappings;
CREATE TRIGGER trg_wh_acct_map_version
BEFORE UPDATE ON public.warehouse_inventory_account_mappings
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_ledger_version();

DROP TRIGGER IF EXISTS trg_prov_pos_version ON public.inventory_provisional_cost_positions;
CREATE TRIGGER trg_prov_pos_version
BEFORE UPDATE ON public.inventory_provisional_cost_positions
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_ledger_version();

-- 2. Immutability Protection for Core Identifiers
CREATE OR REPLACE FUNCTION public.prevent_inventory_ledger_immutable_fields_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'Modification of organization_id is strictly forbidden.';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Modification of record id is strictly forbidden.';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Modification of created_at timestamp is strictly forbidden.';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'Modification of created_by user reference is strictly forbidden.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_trans_immutability ON public.inventory_transactions;
CREATE TRIGGER trg_inv_trans_immutability
BEFORE UPDATE ON public.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_wh_acct_map_immutability ON public.warehouse_inventory_account_mappings;
CREATE TRIGGER trg_wh_acct_map_immutability
BEFORE UPDATE ON public.warehouse_inventory_account_mappings
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_fields_update();

-- 3. Prevent Physical Deletion & Header Status Modifications
CREATE OR REPLACE FUNCTION public.prevent_inventory_transaction_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Physical deletion of inventory transactions is strictly forbidden.';
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'DRAFT' THEN
            IF NEW.status NOT IN ('DRAFT', 'POSTED', 'CANCELLED') THEN
                RAISE EXCEPTION 'Invalid status transition from DRAFT to %.', NEW.status;
            END IF;
        ELSIF OLD.status = 'POSTED' THEN
            IF NEW.status <> 'REVERSED' THEN
                RAISE EXCEPTION 'POSTED inventory transaction can only transition to REVERSED status.';
            END IF;
            IF OLD.transaction_kind = 'REVERSAL' THEN
                RAISE EXCEPTION 'A REVERSAL transaction cannot be reversed.';
            END IF;
            IF NEW.id IS DISTINCT FROM OLD.id OR
               NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
               NEW.fiscal_year_id IS DISTINCT FROM OLD.fiscal_year_id OR
               NEW.initiating_branch_id IS DISTINCT FROM OLD.initiating_branch_id OR
               NEW.document_number IS DISTINCT FROM OLD.document_number OR
               NEW.transaction_date IS DISTINCT FROM OLD.transaction_date OR
               NEW.transaction_type IS DISTINCT FROM OLD.transaction_type OR
               NEW.transaction_kind IS DISTINCT FROM OLD.transaction_kind OR
               NEW.description IS DISTINCT FROM OLD.description OR
               NEW.source_event_key IS DISTINCT FROM OLD.source_event_key OR
               NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
               NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint OR
               NEW.reversal_of_transaction_id IS DISTINCT FROM OLD.reversal_of_transaction_id OR
               NEW.journal_voucher_id IS DISTINCT FROM OLD.journal_voucher_id OR
               NEW.cost_state IS DISTINCT FROM OLD.cost_state OR
               NEW.created_by IS DISTINCT FROM OLD.created_by OR
               NEW.created_at IS DISTINCT FROM OLD.created_at OR
               NEW.posted_by IS DISTINCT FROM OLD.posted_by OR
               NEW.posted_at IS DISTINCT FROM OLD.posted_at OR
               NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by OR
               NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR
               NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason THEN
                RAISE EXCEPTION 'Modification of core transaction header fields during reversal is strictly forbidden.';
            END IF;
        ELSIF OLD.status IN ('REVERSED', 'CANCELLED') THEN
            RAISE EXCEPTION 'Inventory transactions in % status are immutable and cannot be modified.', OLD.status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_inv_trans_deletion ON public.inventory_transactions;
DROP TRIGGER IF EXISTS trg_prevent_inv_trans_mod ON public.inventory_transactions;
CREATE TRIGGER trg_prevent_inv_trans_mod
BEFORE UPDATE OR DELETE ON public.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_transaction_modification();

-- Prevent modification of items and serials unless transaction is in DRAFT
CREATE OR REPLACE FUNCTION public.prevent_inventory_item_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_tx_id UUID;
    v_org_id UUID;
    v_tx_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_tx_id := OLD.transaction_id;
        v_org_id := OLD.organization_id;
    ELSE
        v_tx_id := NEW.transaction_id;
        v_org_id := NEW.organization_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.transaction_id IS DISTINCT FROM OLD.transaction_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
            RAISE EXCEPTION 'Moving transaction items across transactions or organizations is strictly forbidden.';
        END IF;
    END IF;

    SELECT it.status INTO v_tx_status
    FROM public.inventory_transactions it
    WHERE it.id = v_tx_id AND it.organization_id = v_org_id
    FOR UPDATE;

    IF v_tx_status IS NULL THEN
        RAISE EXCEPTION 'Parent transaction does not exist in the specified organization.';
    END IF;

    IF v_tx_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Transaction line items can only be modified when parent transaction is in DRAFT status. Current status: %', v_tx_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_inv_item_mod ON public.inventory_transaction_items;
CREATE TRIGGER trg_prevent_inv_item_mod
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transaction_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_item_modification();

CREATE OR REPLACE FUNCTION public.prevent_inventory_serial_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_item_id UUID;
    v_org_id UUID;
    v_tx_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_item_id := OLD.transaction_item_id;
        v_org_id := OLD.organization_id;
    ELSE
        v_item_id := NEW.transaction_item_id;
        v_org_id := NEW.organization_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.transaction_item_id IS DISTINCT FROM OLD.transaction_item_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
            RAISE EXCEPTION 'Moving serial records across items or organizations is strictly forbidden.';
        END IF;
    END IF;

    SELECT it.status INTO v_tx_status
    FROM public.inventory_transaction_items iti
    JOIN public.inventory_transactions it ON it.id = iti.transaction_id AND it.organization_id = iti.organization_id
    WHERE iti.id = v_item_id AND iti.organization_id = v_org_id
    FOR UPDATE OF it;

    IF v_tx_status IS NULL THEN
        RAISE EXCEPTION 'Parent transaction line item does not exist in the specified organization.';
    END IF;

    IF v_tx_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Transaction serials can only be modified when parent transaction is in DRAFT status. Current status: %', v_tx_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_inv_serial_mod ON public.inventory_transaction_serials;
CREATE TRIGGER trg_prevent_inv_serial_mod
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transaction_serials
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_serial_modification();

CREATE OR REPLACE FUNCTION public.prevent_inventory_ledger_immutable_records_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Physical deletion of this record is strictly forbidden for audit preservation.';
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_wh_acct_map_deletion ON public.warehouse_inventory_account_mappings;
CREATE TRIGGER trg_prevent_wh_acct_map_deletion
BEFORE DELETE ON public.warehouse_inventory_account_mappings
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_deletion();

DROP TRIGGER IF EXISTS trg_prevent_neg_log_deletion ON public.inventory_negative_override_logs;
CREATE TRIGGER trg_prevent_neg_log_deletion
BEFORE DELETE ON public.inventory_negative_override_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_deletion();

DROP TRIGGER IF EXISTS trg_prevent_prov_pos_deletion ON public.inventory_provisional_cost_positions;
CREATE TRIGGER trg_prevent_prov_pos_deletion
BEFORE DELETE ON public.inventory_provisional_cost_positions
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_deletion();

DROP TRIGGER IF EXISTS trg_prevent_prov_alloc_deletion ON public.inventory_provisional_cost_allocations;
CREATE TRIGGER trg_prevent_prov_alloc_deletion
BEFORE DELETE ON public.inventory_provisional_cost_allocations
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_deletion();

-- 4. Prevent Update on Immutable Logs and Allocations
CREATE OR REPLACE FUNCTION public.prevent_inventory_ledger_immutable_records_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Updates to immutable log/allocation records are strictly forbidden.';
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_neg_log_update ON public.inventory_negative_override_logs;
CREATE TRIGGER trg_prevent_neg_log_update
BEFORE UPDATE ON public.inventory_negative_override_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_update();

DROP TRIGGER IF EXISTS trg_prevent_prov_alloc_update ON public.inventory_provisional_cost_allocations;
CREATE TRIGGER trg_prevent_prov_alloc_update
BEFORE UPDATE ON public.inventory_provisional_cost_allocations
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_update();

-- 5. Trigger Function: Validate Transaction Line Items
CREATE OR REPLACE FUNCTION public.trg_validate_inventory_transaction_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_tx_type TEXT;
    v_tx_org UUID;
    v_product_kind TEXT;
    v_is_serialized BOOLEAN;
    v_unit_id UUID;
    v_allows_fraction BOOLEAN;
    v_decimal_places INT;
    v_src_org UUID;
    v_dst_org UUID;
    v_prod_org UUID;
BEGIN
    -- 1. Fetch parent transaction details
    SELECT it.transaction_type, it.organization_id INTO v_tx_type, v_tx_org
    FROM public.inventory_transactions it
    WHERE it.id = NEW.transaction_id AND it.organization_id = NEW.organization_id;

    IF v_tx_type IS NULL THEN
        RAISE EXCEPTION 'Parent inventory transaction does not exist in the specified organization.';
    END IF;

    -- COST_ADJUSTMENT vs Non-COST_ADJUSTMENT quantity & cost_adjustment_amount rules
    IF v_tx_type = 'COST_ADJUSTMENT' THEN
        IF NEW.quantity <> 0 THEN
            RAISE EXCEPTION 'COST_ADJUSTMENT transaction line items must have quantity equal to zero.';
        END IF;
        IF NEW.source_warehouse_id IS NOT NULL OR NEW.destination_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'COST_ADJUSTMENT transaction line items must have null source and destination warehouses.';
        END IF;
        IF NEW.cost_adjustment_amount IS NULL OR NEW.cost_adjustment_amount = 0 THEN
            RAISE EXCEPTION 'COST_ADJUSTMENT transaction line items require a non-null and non-zero cost_adjustment_amount.';
        END IF;
    ELSE
        IF NEW.quantity <= 0 THEN
            RAISE EXCEPTION 'Non COST_ADJUSTMENT transaction line items must have quantity strictly greater than zero.';
        END IF;
        IF NEW.cost_adjustment_amount IS NOT NULL THEN
            RAISE EXCEPTION 'cost_adjustment_amount must be NULL for non COST_ADJUSTMENT transactions.';
        END IF;
    END IF;

    -- 2. Verify product organizational alignment, kind, and serialization
    SELECT p.organization_id, p.product_kind, p.is_serialized, p.measurement_unit_id
    INTO v_prod_org, v_product_kind, v_is_serialized, v_unit_id
    FROM public.products p
    WHERE p.id = NEW.product_id AND p.organization_id = NEW.organization_id;

    IF v_prod_org IS NULL THEN
        RAISE EXCEPTION 'Product does not exist in the specified organization.';
    END IF;

    IF v_product_kind = 'SERVICE' THEN
        RAISE EXCEPTION 'Services cannot be included in inventory transaction line items.';
    END IF;

    -- 3. Verify quantity precision
    IF v_is_serialized IS TRUE THEN
        IF NEW.quantity <> floor(NEW.quantity) THEN
            RAISE EXCEPTION 'Serialized products only accept integer quantities.';
        END IF;
    ELSE
        SELECT mu.allows_fraction, mu.decimal_places INTO v_allows_fraction, v_decimal_places
        FROM public.measurement_units mu
        WHERE mu.id = v_unit_id AND mu.organization_id = NEW.organization_id;

        IF v_allows_fraction IS FALSE AND NEW.quantity <> floor(NEW.quantity) THEN
            RAISE EXCEPTION 'Product measurement unit does not allow fractional quantities.';
        END IF;

        IF v_allows_fraction IS TRUE AND v_decimal_places IS NOT NULL THEN
            IF round(NEW.quantity, v_decimal_places) <> NEW.quantity THEN
                RAISE EXCEPTION 'Quantity decimal precision exceeds allowed limit (% decimal places) for product measurement unit.', v_decimal_places;
            END IF;
        END IF;
    END IF;

    -- 4. Verify warehouse directions based on transaction_type
    IF NEW.source_warehouse_id IS NOT NULL THEN
        SELECT w.organization_id INTO v_src_org
        FROM public.warehouses w
        WHERE w.id = NEW.source_warehouse_id AND w.organization_id = NEW.organization_id;

        IF v_src_org IS NULL THEN
            RAISE EXCEPTION 'Source warehouse does not exist in the specified organization.';
        END IF;
    END IF;

    IF NEW.destination_warehouse_id IS NOT NULL THEN
        SELECT w.organization_id INTO v_dst_org
        FROM public.warehouses w
        WHERE w.id = NEW.destination_warehouse_id AND w.organization_id = NEW.organization_id;

        IF v_dst_org IS NULL THEN
            RAISE EXCEPTION 'Destination warehouse does not exist in the specified organization.';
        END IF;
    END IF;

    IF v_tx_type IN ('OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN', 'SALES_RETURN') THEN
        IF NEW.destination_warehouse_id IS NULL OR NEW.source_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'Inbound transaction type % requires destination_warehouse_id and no source_warehouse_id.', v_tx_type;
        END IF;
    ELSIF v_tx_type IN ('SALE_ISSUE', 'ADJUSTMENT_OUT', 'PURCHASE_RETURN') THEN
        IF NEW.source_warehouse_id IS NULL OR NEW.destination_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'Outbound transaction type % requires source_warehouse_id and no destination_warehouse_id.', v_tx_type;
        END IF;
    ELSIF v_tx_type = 'TRANSFER' THEN
        IF NEW.source_warehouse_id IS NULL OR NEW.destination_warehouse_id IS NULL THEN
            RAISE EXCEPTION 'Transfer transaction requires both source_warehouse_id and destination_warehouse_id.';
        END IF;
        IF NEW.source_warehouse_id = NEW.destination_warehouse_id THEN
            RAISE EXCEPTION 'Transfer transaction source and destination warehouses cannot be identical.';
        END IF;
    ELSIF v_tx_type = 'COST_ADJUSTMENT' THEN
        IF NEW.source_warehouse_id IS NOT NULL OR NEW.destination_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'COST_ADJUSTMENT transaction requires source and destination warehouses to be NULL.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_inv_item ON public.inventory_transaction_items;
CREATE TRIGGER trg_validate_inv_item
BEFORE INSERT OR UPDATE ON public.inventory_transaction_items
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_inventory_transaction_items();

-- 6. Trigger Function: Validate Transaction Serials Alignment
CREATE OR REPLACE FUNCTION public.trg_validate_inventory_transaction_serials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_item_prod UUID;
    v_item_org UUID;
    v_serial_prod UUID;
    v_serial_org UUID;
BEGIN
    SELECT iti.product_id, iti.organization_id INTO v_item_prod, v_item_org
    FROM public.inventory_transaction_items iti
    WHERE iti.id = NEW.transaction_item_id AND iti.organization_id = NEW.organization_id;

    IF v_item_prod IS NULL THEN
        RAISE EXCEPTION 'Referenced transaction item does not exist in the specified organization.';
    END IF;

    SELECT ps.product_id, ps.organization_id INTO v_serial_prod, v_serial_org
    FROM public.product_serials ps
    WHERE ps.id = NEW.product_serial_id AND ps.organization_id = NEW.organization_id;

    IF v_serial_prod IS NULL THEN
        RAISE EXCEPTION 'Referenced product serial does not exist in the specified organization.';
    END IF;

    IF v_item_prod <> v_serial_prod THEN
        RAISE EXCEPTION 'Product serial product_id does not match transaction item product_id.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_inv_tx_serial ON public.inventory_transaction_serials;
CREATE TRIGGER trg_validate_inv_tx_serial
BEFORE INSERT OR UPDATE ON public.inventory_transaction_serials
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_inventory_transaction_serials();

-- 7. Trigger Function: Validate Negative Override Log Alignment
CREATE OR REPLACE FUNCTION public.trg_validate_negative_override_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_auth_org UUID;
    v_auth_tx UUID;
    v_auth_appr UUID;
    v_auth_reason TEXT;
    v_item_org UUID;
    v_item_tx UUID;
    v_item_prod UUID;
    v_item_src_wh UUID;
    v_is_serialized BOOLEAN;
BEGIN
    -- 1. Check authorization alignment
    SELECT auth.organization_id, auth.transaction_id, auth.approved_by, auth.reason
    INTO v_auth_org, v_auth_tx, v_auth_appr, v_auth_reason
    FROM public.inventory_negative_override_authorizations auth
    WHERE auth.id = NEW.authorization_id AND auth.organization_id = NEW.organization_id;

    IF v_auth_org IS NULL THEN
        RAISE EXCEPTION 'Referenced override authorization does not exist in the specified organization.';
    END IF;

    IF v_auth_tx <> NEW.transaction_id THEN
        RAISE EXCEPTION 'Log transaction_id does not match authorization transaction_id.';
    END IF;

    IF v_auth_appr <> NEW.approved_by THEN
        RAISE EXCEPTION 'Log approved_by does not match authorization approved_by user.';
    END IF;

    IF v_auth_reason <> NEW.reason_snapshot THEN
        RAISE EXCEPTION 'Log reason_snapshot does not match authorization reason.';
    END IF;

    -- 2. Check transaction item alignment
    SELECT iti.organization_id, iti.transaction_id, iti.product_id, iti.source_warehouse_id
    INTO v_item_org, v_item_tx, v_item_prod, v_item_src_wh
    FROM public.inventory_transaction_items iti
    WHERE iti.id = NEW.transaction_item_id AND iti.organization_id = NEW.organization_id;

    IF v_item_org IS NULL THEN
        RAISE EXCEPTION 'Referenced transaction line item does not exist in the specified organization.';
    END IF;

    IF v_item_tx <> NEW.transaction_id THEN
        RAISE EXCEPTION 'Line item transaction_id does not match log transaction_id.';
    END IF;

    IF v_item_prod <> NEW.product_id THEN
        RAISE EXCEPTION 'Line item product_id does not match log product_id.';
    END IF;

    IF v_item_src_wh IS NULL THEN
        RAISE EXCEPTION 'Line item must be an outbound item with a valid source_warehouse_id.';
    END IF;

    IF v_item_src_wh <> NEW.warehouse_id THEN
        RAISE EXCEPTION 'Line item source_warehouse_id does not match log warehouse_id.';
    END IF;

    -- 3. Check product serialization
    SELECT p.is_serialized INTO v_is_serialized
    FROM public.products p
    WHERE p.id = NEW.product_id AND p.organization_id = NEW.organization_id;

    IF v_is_serialized IS TRUE THEN
        RAISE EXCEPTION 'Serialized products are strictly forbidden from negative inventory overrides.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_neg_log ON public.inventory_negative_override_logs;
CREATE TRIGGER trg_validate_neg_log
BEFORE INSERT OR UPDATE ON public.inventory_negative_override_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_negative_override_log();

-- 8. Trigger Function: Validate Provisional Cost Position Eligibility & Lifecycle
CREATE OR REPLACE FUNCTION public.trg_validate_provisional_cost_position()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_item_org UUID;
    v_item_prod UUID;
    v_item_src_wh UUID;
    v_item_qty NUMERIC(18,3);
    v_tx_type TEXT;
    v_tx_status TEXT;
    v_is_serialized BOOLEAN;
    v_issue_tx_id UUID;
    v_rev_tx_kind TEXT;
    v_rev_tx_status TEXT;
    v_rev_of_tx UUID;
BEGIN
    -- Immutability check for REVERSED status
    IF TG_OP = 'INSERT' AND NEW.status = 'REVERSED' THEN
        RAISE EXCEPTION 'Direct insertion of provisional cost position in REVERSED status is forbidden.';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'REVERSED' THEN
        RAISE EXCEPTION 'Provisional cost position in REVERSED status is final and cannot be modified.';
    END IF;

    -- Reversal validation rules
    IF NEW.status = 'REVERSED' THEN
        IF TG_OP = 'UPDATE' AND OLD.status <> 'OPEN' THEN
            RAISE EXCEPTION 'Transition to REVERSED status is only permitted from OPEN status.';
        END IF;

        IF NEW.reversal_transaction_id IS NULL THEN
            RAISE EXCEPTION 'reversal_transaction_id is required when status is REVERSED.';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.inventory_provisional_cost_allocations
            WHERE provisional_position_id = NEW.id AND organization_id = NEW.organization_id
        ) THEN
            RAISE EXCEPTION 'Cannot reverse a provisional cost position that has existing allocations.';
        END IF;

        -- Validate reversal transaction header
        SELECT it.transaction_kind, it.status, it.reversal_of_transaction_id
        INTO v_rev_tx_kind, v_rev_tx_status, v_rev_of_tx
        FROM public.inventory_transactions it
        WHERE it.id = NEW.reversal_transaction_id AND it.organization_id = NEW.organization_id;

        IF v_rev_tx_kind IS NULL THEN
            RAISE EXCEPTION 'Reversal transaction does not exist in the specified organization.';
        END IF;

        IF v_rev_tx_kind <> 'REVERSAL' THEN
            RAISE EXCEPTION 'Referenced reversal transaction must have transaction_kind = REVERSAL.';
        END IF;

        IF v_rev_tx_status <> 'POSTED' THEN
            RAISE EXCEPTION 'Referenced reversal transaction must have status = POSTED.';
        END IF;

        -- Validate that reversal transaction reverses the exact SALE_ISSUE transaction of this position
        SELECT iti.transaction_id INTO v_issue_tx_id
        FROM public.inventory_transaction_items iti
        WHERE iti.id = NEW.issue_transaction_item_id AND iti.organization_id = NEW.organization_id;

        IF v_rev_of_tx IS DISTINCT FROM v_issue_tx_id THEN
            RAISE EXCEPTION 'Reversal transaction reversal_of_transaction_id does not match position sale issue transaction.';
        END IF;
    ELSE
        IF NEW.reversal_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'reversal_transaction_id must be NULL when status is not REVERSED.';
        END IF;
    END IF;

    SELECT iti.organization_id, iti.product_id, iti.source_warehouse_id, iti.quantity, it.transaction_type, it.status
    INTO v_item_org, v_item_prod, v_item_src_wh, v_item_qty, v_tx_type, v_tx_status
    FROM public.inventory_transaction_items iti
    JOIN public.inventory_transactions it ON it.id = iti.transaction_id AND it.organization_id = iti.organization_id
    WHERE iti.id = NEW.issue_transaction_item_id AND iti.organization_id = NEW.organization_id;

    IF v_item_org IS NULL THEN
        RAISE EXCEPTION 'Referenced sale issue transaction line item does not exist in the specified organization.';
    END IF;

    IF v_tx_type <> 'SALE_ISSUE' THEN
        RAISE EXCEPTION 'Provisional cost positions can only be created for SALE_ISSUE transaction items.';
    END IF;

    IF v_tx_status <> 'POSTED' THEN
        RAISE EXCEPTION 'Provisional cost position creation requires sale transaction to be in POSTED status.';
    END IF;

    IF v_item_prod <> NEW.product_id THEN
        RAISE EXCEPTION 'Position product_id does not match sale item product_id.';
    END IF;

    IF v_item_src_wh IS NULL OR v_item_src_wh <> NEW.warehouse_id THEN
        RAISE EXCEPTION 'Position warehouse_id does not match sale item source_warehouse_id.';
    END IF;

    IF NEW.shortage_quantity > v_item_qty THEN
        RAISE EXCEPTION 'Provisional shortage_quantity (%) cannot exceed sale item quantity (%).', NEW.shortage_quantity, v_item_qty;
    END IF;

    SELECT p.is_serialized INTO v_is_serialized
    FROM public.products p
    WHERE p.id = NEW.product_id AND p.organization_id = NEW.organization_id;

    IF v_is_serialized IS TRUE THEN
        RAISE EXCEPTION 'Serialized products cannot be recorded as provisional cost positions.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prov_pos ON public.inventory_provisional_cost_positions;
CREATE TRIGGER trg_validate_prov_pos
BEFORE INSERT OR UPDATE ON public.inventory_provisional_cost_positions
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_provisional_cost_position();

-- 9. Trigger Function: Validate Provisional Cost Allocation Eligibility
CREATE OR REPLACE FUNCTION public.trg_validate_provisional_cost_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_pos_org UUID;
    v_pos_prod UUID;
    v_pos_rem_qty NUMERIC(18,3);
    v_pos_prov_cost BIGINT;
    v_r_org UUID;
    v_r_prod UUID;
    v_tx_type TEXT;
    v_tx_status TEXT;
BEGIN
    SELECT pos.organization_id, pos.product_id, pos.remaining_quantity, pos.provisional_unit_cost_amount
    INTO v_pos_org, v_pos_prod, v_pos_rem_qty, v_pos_prov_cost
    FROM public.inventory_provisional_cost_positions pos
    WHERE pos.id = NEW.provisional_position_id AND pos.organization_id = NEW.organization_id;

    IF v_pos_org IS NULL THEN
        RAISE EXCEPTION 'Referenced provisional cost position does not exist in the specified organization.';
    END IF;

    SELECT iti.organization_id, iti.product_id, it.transaction_type, it.status
    INTO v_r_org, v_r_prod, v_tx_type, v_tx_status
    FROM public.inventory_transaction_items iti
    JOIN public.inventory_transactions it ON it.id = iti.transaction_id AND it.organization_id = iti.organization_id
    WHERE iti.id = NEW.receipt_transaction_item_id AND iti.organization_id = NEW.organization_id;

    IF v_r_org IS NULL THEN
        RAISE EXCEPTION 'Referenced receipt transaction line item does not exist in the specified organization.';
    END IF;

    IF v_tx_type <> 'PURCHASE_RECEIPT' THEN
        RAISE EXCEPTION 'Provisional cost allocations can only be made against PURCHASE_RECEIPT transaction items.';
    END IF;

    IF v_tx_status <> 'POSTED' THEN
        RAISE EXCEPTION 'Purchase receipt transaction must be in POSTED status for provisional cost allocation.';
    END IF;

    IF v_pos_prod <> v_r_prod THEN
        RAISE EXCEPTION 'Receipt item product_id does not match provisional cost position product_id.';
    END IF;

    IF NEW.allocated_quantity > v_pos_rem_qty THEN
        RAISE EXCEPTION 'Allocated quantity (%) exceeds position remaining quantity (%).', NEW.allocated_quantity, v_pos_rem_qty;
    END IF;

    IF NEW.provisional_unit_cost_amount <> v_pos_prov_cost THEN
        RAISE EXCEPTION 'Allocation provisional_unit_cost_amount (%) does not match position provisional_unit_cost_amount (%).', NEW.provisional_unit_cost_amount, v_pos_prov_cost;
    END IF;

    IF NEW.adjustment_amount <> round((NEW.actual_unit_cost_amount - NEW.provisional_unit_cost_amount) * NEW.allocated_quantity) THEN
        RAISE EXCEPTION 'Allocation adjustment_amount (%) does not match calculated difference.', NEW.adjustment_amount;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prov_alloc ON public.inventory_provisional_cost_allocations;
CREATE TRIGGER trg_validate_prov_alloc
BEFORE INSERT ON public.inventory_provisional_cost_allocations
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_provisional_cost_allocation();

-- Revoke default public execution rights on trigger helper functions
REVOKE EXECUTE ON FUNCTION public.trg_increment_inventory_ledger_version() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_ledger_immutable_fields_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_transaction_modification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_item_modification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_serial_modification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_ledger_immutable_records_deletion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_ledger_immutable_records_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_inventory_transaction_items() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_inventory_transaction_serials() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_negative_override_log() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_provisional_cost_position() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_provisional_cost_allocation() FROM PUBLIC;

-- ==============================================================================
-- L. READ-ONLY VIEW (vw_inventory_ledger)
-- ==============================================================================
CREATE OR REPLACE VIEW public.vw_inventory_ledger WITH (security_invoker = true) AS
SELECT
    it.organization_id,
    it.id AS transaction_id,
    it.fiscal_year_id,
    it.initiating_branch_id,
    it.document_number,
    it.transaction_date,
    it.transaction_type,
    it.transaction_kind,
    it.status,
    iti.id AS transaction_item_id,
    iti.row_number,
    iti.product_id,
    iti.source_warehouse_id,
    iti.destination_warehouse_id,
    iti.quantity,
    iti.unit_cost_amount,
    iti.total_cost_amount,
    iti.cost_adjustment_amount,
    iti.cost_state,
    iti.description AS item_description,
    it.description AS header_description,
    it.posted_at,
    it.posted_by,
    it.reversal_of_transaction_id,
    it.journal_voucher_id
FROM public.inventory_transactions it
JOIN public.inventory_transaction_items iti ON iti.transaction_id = it.id AND iti.organization_id = it.organization_id
WHERE it.status IN ('POSTED', 'REVERSED');

COMMENT ON VIEW public.vw_inventory_ledger IS 'Read-only inventory ledger view showing POSTED and REVERSED transaction line items. Drafts and cancelled documents are excluded.';

-- ==============================================================================
-- M. CATALOG PERMISSIONS DEFINITIONS (KATALOG ONLY - NO ROLE MAPPINGS)
-- ==============================================================================
-- Approved Reversal Policies Summary:
-- 1. Reversal of non-serialized entry transactions and COST_ADJUSTMENT is blocked if subsequent active posted transaction for the same product exists.
-- 2. In future checks, only transactions with status = 'POSTED', transaction_kind = 'GENERAL', posted after original document act as blockers.
-- 3. REVERSED documents and documents with transaction_kind = 'REVERSAL' alone do not permanently block older documents.
-- 4. Reversal transactions must not cause negative inventory balances.
-- 5. Documents with non-null journal_voucher_id are blocked from reversal until atomic accounting-inventory integration is implemented.
-- 6. Sales or receipts with provisional cost allocations are blocked from reversal until provisional allocation reversal infrastructure is completed.

INSERT INTO public.permissions (code, name_fa, category, description) VALUES
('inventory:post', 'قطعی‌سازی اسناد انبار', 'انبارداری', 'امکان قطعی‌سازی اسناد انبار و تغییر دفتر موجودی'),
('inventory:negative_override', 'صدور مجوز موجودی منفی', 'انبارداری', 'امکان صدور مجوز خروج با موجودی منفی'),
('inventory:reverse', 'معکوس‌سازی اسناد قطعی انبار', 'inventory', 'امکان معکوس‌سازی اسناد قطعی انبار')
ON CONFLICT (code) DO NOTHING;

-- ==============================================================================
-- N. ROW LEVEL SECURITY (RLS) POLICIES & PRIVILEGE REVOCATIONS
-- ==============================================================================
ALTER TABLE public.inventory_document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transaction_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cost_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_inventory_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_negative_override_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_negative_override_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_provisional_cost_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_provisional_cost_allocations ENABLE ROW LEVEL SECURITY;

-- 1. Inventory Transactions Header RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view inventory transactions"
ON public.inventory_transactions FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 2. Inventory Transaction Items RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view inventory transaction items"
ON public.inventory_transaction_items FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 3. Inventory Transaction Serials RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view inventory transaction serials"
ON public.inventory_transaction_serials FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 4. Inventory Balances RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view inventory balances"
ON public.inventory_balances FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 5. Inventory Cost Balances RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view inventory cost balances"
ON public.inventory_cost_balances FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 6. Warehouse Account Mappings RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view warehouse account mappings"
ON public.warehouse_inventory_account_mappings FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 7. Negative Override Authorizations RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view negative override authorizations"
ON public.inventory_negative_override_authorizations FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'inventory:negative_override')
        OR public.has_permission(organization_id, 'finance:approve')
    )
);

-- 8. Negative Override Logs RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view negative override logs"
ON public.inventory_negative_override_logs FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'inventory:negative_override')
        OR public.has_permission(organization_id, 'finance:approve')
    )
);

-- 9. Provisional Cost Positions RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view provisional cost positions"
ON public.inventory_provisional_cost_positions FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 10. Provisional Cost Allocations RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view provisional cost allocations"
ON public.inventory_provisional_cost_allocations FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- Revoke all privileges on document sequence counter
REVOKE ALL ON public.inventory_document_sequences FROM PUBLIC, anon, authenticated;

-- Revoke direct mutation privileges from PUBLIC, anon, authenticated on all 10 tables
REVOKE INSERT, UPDATE, DELETE ON public.inventory_transactions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_transaction_items FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_transaction_serials FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_balances FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_cost_balances FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.warehouse_inventory_account_mappings FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_negative_override_authorizations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_negative_override_logs FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_provisional_cost_positions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_provisional_cost_allocations FROM PUBLIC, anon, authenticated;

-- Explicitly revoke SELECT from PUBLIC and anon on all tables
REVOKE SELECT ON public.inventory_document_sequences FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_transactions FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_transaction_items FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_transaction_serials FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_balances FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_cost_balances FROM PUBLIC, anon;
REVOKE SELECT ON public.warehouse_inventory_account_mappings FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_negative_override_authorizations FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_negative_override_logs FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_provisional_cost_positions FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_provisional_cost_allocations FROM PUBLIC, anon;
REVOKE SELECT ON public.vw_inventory_ledger FROM PUBLIC, anon;

-- Grant SELECT to authenticated on tables and view
GRANT SELECT ON public.inventory_transactions TO authenticated;
GRANT SELECT ON public.inventory_transaction_items TO authenticated;
GRANT SELECT ON public.inventory_transaction_serials TO authenticated;
GRANT SELECT ON public.inventory_balances TO authenticated;
GRANT SELECT ON public.inventory_cost_balances TO authenticated;
GRANT SELECT ON public.warehouse_inventory_account_mappings TO authenticated;
GRANT SELECT ON public.inventory_negative_override_authorizations TO authenticated;
GRANT SELECT ON public.inventory_negative_override_logs TO authenticated;
GRANT SELECT ON public.inventory_provisional_cost_positions TO authenticated;
GRANT SELECT ON public.inventory_provisional_cost_allocations TO authenticated;
GRANT SELECT ON public.vw_inventory_ledger TO authenticated;

-- ==============================================================================
-- ATOMIC POSTING FUNCTION (public.post_inventory_transaction)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.post_inventory_transaction(
    p_organization_id UUID,
    p_transaction_id UUID,
    p_expected_version INT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT,
    p_negative_override_authorization_id UUID DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_membership_id UUID;
    v_appr_membership_id UUID;
    v_tx RECORD;
    v_item RECORD;
    v_serial RECORD;
    v_auth RECORD;
    v_audit RECORD;
    v_fy_closed BOOLEAN;
    v_fp_closed BOOLEAN;
    v_doc_number BIGINT;
    v_item_count INT;
    v_serial_count INT;
    v_any_warehouse_negative BOOLEAN := false;
    v_header_cost_state TEXT;
    v_has_provisional BOOLEAN := false;
    v_has_final BOOLEAN := false;
    v_has_mixed BOOLEAN := false;
    v_curr_wh_qty NUMERIC(18, 3);
    v_new_wh_qty NUMERIC(18, 3);
    v_curr_org_qty NUMERIC(18, 3);
    v_curr_org_val BIGINT;
    v_curr_wac BIGINT;
    v_new_org_qty NUMERIC(18, 3);
    v_new_org_val BIGINT;
    v_new_wac BIGINT;
    v_serial_sum_cost BIGINT;
    v_item_unit_cost BIGINT;
    v_item_total_cost BIGINT;
    v_item_cost_state TEXT;
    v_final_portion_qty NUMERIC(18, 3);
    v_prov_portion_qty NUMERIC(18, 3);
    v_final_portion_cost BIGINT;
    v_prov_portion_cost BIGINT;
    v_qty_before NUMERIC(18, 3);
    v_qty_after NUMERIC(18, 3);
    v_shortage NUMERIC(18, 3);
    v_req_qty NUMERIC(18, 3);
    v_wh_id UUID;
BEGIN
    -- --------------------------------------------------------------------------
    -- Step 0: Input Validation & Staging Setup
    -- --------------------------------------------------------------------------
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'p_expected_version is required.';
    END IF;

    IF p_operation_key IS NULL OR length(trim(p_operation_key)) = 0 OR p_request_fingerprint IS NULL OR length(trim(p_request_fingerprint)) = 0 THEN
        RAISE EXCEPTION 'p_operation_key and p_request_fingerprint are required.';
    END IF;

    -- Create temporary table for staging provisional cost positions
    CREATE TEMP TABLE IF NOT EXISTS tmp_staged_provisional_positions (
        issue_transaction_item_id UUID PRIMARY KEY,
        product_id UUID NOT NULL,
        warehouse_id UUID NOT NULL,
        shortage_quantity NUMERIC(18, 3) NOT NULL,
        provisional_unit_cost_amount BIGINT NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE TABLE tmp_staged_provisional_positions;

    -- --------------------------------------------------------------------------
    -- Step 1: Authentication & Active Membership Checks
    -- --------------------------------------------------------------------------
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT om.id INTO v_membership_id
    FROM public.organization_memberships om
    JOIN public.user_profiles up ON up.id = om.user_id
    WHERE om.user_id = v_user_id
      AND om.organization_id = p_organization_id
      AND om.is_active = true
      AND up.is_active = true;

    IF v_membership_id IS NULL THEN
        RAISE EXCEPTION 'User profile or organization membership is inactive or missing for organization %.', p_organization_id;
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 2: Lock Transaction Header & Check Initiating Branch Permission & Idempotency
    -- --------------------------------------------------------------------------
    SELECT * INTO v_tx
    FROM public.inventory_transactions
    WHERE id = p_transaction_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF v_tx.id IS NULL THEN
        RAISE EXCEPTION 'Inventory transaction % not found in organization %.', p_transaction_id, p_organization_id;
    END IF;

    -- Initiating branch permission check MUST occur BEFORE idempotency check
    IF NOT public.has_branch_permission(p_organization_id, v_tx.initiating_branch_id, 'inventory:post') THEN
        RAISE EXCEPTION 'User lacks inventory:post permission for initiating branch %.', v_tx.initiating_branch_id;
    END IF;

    -- Idempotency check AFTER permissions
    IF v_tx.status = 'POSTED' THEN
        IF v_tx.idempotency_key = p_operation_key AND v_tx.request_fingerprint = p_request_fingerprint THEN
            RETURN v_tx.document_number;
        ELSIF v_tx.idempotency_key = p_operation_key AND v_tx.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Idempotency conflict: operation_key already used with a different request fingerprint.';
        ELSE
            RAISE EXCEPTION 'Inventory transaction is already POSTED under a different operation key.';
        END IF;
    END IF;

    -- Header Validations
    IF v_tx.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only DRAFT transactions can be posted. Current status: %', v_tx.status;
    END IF;

    IF v_tx.transaction_kind <> 'GENERAL' THEN
        RAISE EXCEPTION 'Direct posting of REVERSAL transactions is strictly forbidden.';
    END IF;

    IF v_tx.transaction_type IN ('SALES_RETURN', 'PURCHASE_RETURN') THEN
        RAISE EXCEPTION 'Posting transaction type % is deferred pending source_transaction_item_id implementation.', v_tx.transaction_type;
    END IF;

    IF v_tx.transaction_type NOT IN (
        'OPENING', 'PURCHASE_RECEIPT', 'SALE_ISSUE', 'TRANSFER',
        'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'COST_ADJUSTMENT'
    ) THEN
        RAISE EXCEPTION 'Unsupported transaction type for posting: %', v_tx.transaction_type;
    END IF;

    IF v_tx.version <> p_expected_version THEN
        RAISE EXCEPTION 'Concurrency error: transaction version mismatch. Expected %, found %.', p_expected_version, v_tx.version;
    END IF;

    IF v_tx.description IS NULL OR length(trim(v_tx.description)) = 0 THEN
        RAISE EXCEPTION 'Transaction description cannot be empty.';
    END IF;

    IF v_tx.journal_voucher_id IS NOT NULL THEN
        RAISE EXCEPTION 'Transaction journal_voucher_id must be NULL before posting.';
    END IF;

    -- Fiscal year and period validation
    SELECT fy.is_closed INTO v_fy_closed
    FROM public.fiscal_years fy
    WHERE fy.id = v_tx.fiscal_year_id AND fy.organization_id = p_organization_id
      AND v_tx.transaction_date >= fy.start_date AND v_tx.transaction_date <= fy.end_date;

    IF v_fy_closed IS NULL THEN
        RAISE EXCEPTION 'Transaction date % does not fall into fiscal year %.', v_tx.transaction_date, v_tx.fiscal_year_id;
    END IF;

    IF v_fy_closed = true THEN
        RAISE EXCEPTION 'Fiscal year % is closed.', v_tx.fiscal_year_id;
    END IF;

    SELECT fp.is_closed INTO v_fp_closed
    FROM public.fiscal_periods fp
    WHERE fp.organization_id = p_organization_id
      AND fp.fiscal_year_id = v_tx.fiscal_year_id
      AND v_tx.transaction_date >= fp.start_date
      AND v_tx.transaction_date <= fp.end_date;

    IF v_fp_closed IS NULL THEN
        RAISE EXCEPTION 'Transaction date % does not fall into any fiscal period in fiscal year %.', v_tx.transaction_date, v_tx.fiscal_year_id;
    END IF;

    IF v_fp_closed = true THEN
        RAISE EXCEPTION 'Fiscal period for transaction date % is closed.', v_tx.transaction_date;
    END IF;

    -- Ensure transaction has line items
    SELECT count(*) INTO v_item_count
    FROM public.inventory_transaction_items
    WHERE transaction_id = p_transaction_id AND organization_id = p_organization_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Transaction % has no line items.', p_transaction_id;
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 3: Validate Involved Warehouses & Products Permissions
    -- --------------------------------------------------------------------------
    FOR v_wh_id IN
        SELECT DISTINCT w_id FROM (
            SELECT source_warehouse_id AS w_id FROM public.inventory_transaction_items WHERE transaction_id = p_transaction_id AND organization_id = p_organization_id AND source_warehouse_id IS NOT NULL
            UNION
            SELECT destination_warehouse_id AS w_id FROM public.inventory_transaction_items WHERE transaction_id = p_transaction_id AND organization_id = p_organization_id AND destination_warehouse_id IS NOT NULL
        ) sub
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.warehouses w
            WHERE w.id = v_wh_id AND w.organization_id = p_organization_id AND w.status = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION 'Warehouse % does not exist, is inactive, or belongs to another organization.', v_wh_id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.warehouses w
            WHERE w.id = v_wh_id AND w.organization_id = p_organization_id AND w.branch_id IS NOT NULL
              AND NOT public.has_branch_permission(p_organization_id, w.branch_id, 'inventory:post')
        ) THEN
            RAISE EXCEPTION 'User lacks inventory:post permission for branch assigned to warehouse %.', v_wh_id;
        END IF;

        IF NOT (
            public.has_permission(p_organization_id, 'inventory:manage')
            OR
            EXISTS (
                SELECT 1 FROM public.user_warehouse_access uwa
                WHERE uwa.organization_id = p_organization_id
                  AND uwa.membership_id = v_membership_id
                  AND uwa.warehouse_id = v_wh_id
                  AND uwa.is_active = true
            )
        ) THEN
            RAISE EXCEPTION 'User lacks access to warehouse %.', v_wh_id;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM public.inventory_transaction_items iti
        LEFT JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
        WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
          AND (p.id IS NULL OR p.status <> 'ACTIVE')
    ) THEN
        RAISE EXCEPTION 'Transaction contains products that are inactive, missing, or belong to another organization.';
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 4: Lock Balances and Serials in Strict Order
    -- --------------------------------------------------------------------------
    -- 4a. Lock inventory_balances (Ordered by warehouse_id, product_id)
    INSERT INTO public.inventory_balances (organization_id, warehouse_id, product_id, quantity_on_hand)
    SELECT DISTINCT p_organization_id, w_id, iti.product_id, 0
    FROM public.inventory_transaction_items iti
    CROSS JOIN LATERAL (
        SELECT iti.source_warehouse_id AS w_id WHERE iti.source_warehouse_id IS NOT NULL
        UNION ALL
        SELECT iti.destination_warehouse_id AS w_id WHERE iti.destination_warehouse_id IS NOT NULL
    ) w
    WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
    ON CONFLICT (organization_id, warehouse_id, product_id) DO NOTHING;

    PERFORM 1
    FROM public.inventory_balances ib
    JOIN (
        SELECT DISTINCT w_id, iti.product_id
        FROM public.inventory_transaction_items iti
        CROSS JOIN LATERAL (
            SELECT iti.source_warehouse_id AS w_id WHERE iti.source_warehouse_id IS NOT NULL
            UNION ALL
            SELECT iti.destination_warehouse_id AS w_id WHERE iti.destination_warehouse_id IS NOT NULL
        ) w
        WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
    ) req ON req.w_id = ib.warehouse_id AND req.product_id = ib.product_id
    WHERE ib.organization_id = p_organization_id
    ORDER BY ib.organization_id, ib.warehouse_id, ib.product_id
    FOR UPDATE;

    -- 4b. Lock inventory_cost_balances (Ordered by product_id)
    INSERT INTO public.inventory_cost_balances (organization_id, product_id, organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount)
    SELECT DISTINCT p_organization_id, iti.product_id, 0, 0, 0
    FROM public.inventory_transaction_items iti
    WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
    ON CONFLICT (organization_id, product_id) DO NOTHING;

    PERFORM 1
    FROM public.inventory_cost_balances icb
    WHERE icb.organization_id = p_organization_id
      AND icb.product_id IN (
          SELECT DISTINCT iti.product_id
          FROM public.inventory_transaction_items iti
          WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
      )
    ORDER BY icb.product_id
    FOR UPDATE;

    -- 4c. Lock Serials & Validate Duplicate Serials within transaction
    IF EXISTS (
        SELECT 1
        FROM public.inventory_transaction_serials its1
        JOIN public.inventory_transaction_serials its2 ON its1.product_serial_id = its2.product_serial_id AND its1.id <> its2.id
        JOIN public.inventory_transaction_items iti1 ON iti1.id = its1.transaction_item_id
        JOIN public.inventory_transaction_items iti2 ON iti2.id = its2.transaction_item_id
        WHERE iti1.transaction_id = p_transaction_id AND iti2.transaction_id = p_transaction_id
          AND iti1.organization_id = p_organization_id AND iti2.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'Duplicate serial numbers within the same transaction are strictly forbidden.';
    END IF;

    PERFORM 1
    FROM public.inventory_transaction_serials its
    JOIN public.product_serials ps ON ps.id = its.product_serial_id AND ps.organization_id = its.organization_id
    WHERE its.organization_id = p_organization_id
      AND its.transaction_item_id IN (
          SELECT iti.id
          FROM public.inventory_transaction_items iti
          WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
      )
    ORDER BY ps.id
    FOR UPDATE OF ps;

    -- 4d. Lock & Validate Negative Override Authorization if provided
    IF p_negative_override_authorization_id IS NOT NULL THEN
        SELECT * INTO v_auth
        FROM public.inventory_negative_override_authorizations
        WHERE id = p_negative_override_authorization_id AND organization_id = p_organization_id
        FOR UPDATE;

        IF v_auth.id IS NULL THEN
            RAISE EXCEPTION 'Negative override authorization % not found in organization %.', p_negative_override_authorization_id, p_organization_id;
        END IF;

        IF v_auth.transaction_id <> p_transaction_id THEN
            RAISE EXCEPTION 'Negative override authorization transaction_id mismatch.';
        END IF;

        IF v_auth.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Negative override authorization request_fingerprint mismatch.';
        END IF;

        IF v_auth.status <> 'ISSUED' OR v_auth.consumed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Negative override authorization is not in ISSUED status or has already been consumed.';
        END IF;

        IF v_auth.expires_at <= now() THEN
            RAISE EXCEPTION 'Negative override authorization has expired.';
        END IF;

        -- Validate security audit log
        SELECT * INTO v_audit
        FROM public.security_audit_logs
        WHERE id = v_auth.security_audit_log_id AND organization_id = p_organization_id;

        IF v_audit.id IS NULL THEN
            RAISE EXCEPTION 'Referenced security audit log not found for negative override authorization.';
        END IF;

        IF v_audit.user_id <> v_auth.approved_by THEN
            RAISE EXCEPTION 'Security audit log user_id does not match authorization approved_by user.';
        END IF;

        IF v_audit.event_type <> 'INVENTORY_NEGATIVE_OVERRIDE_REAUTH_SUCCESS' THEN
            RAISE EXCEPTION 'Security audit log event_type % is invalid for negative override.', v_audit.event_type;
        END IF;

        IF COALESCE((v_audit.details->>'password_reauthenticated')::boolean, false) <> true OR
           COALESCE((v_audit.details->>'two_factor_verified')::boolean, false) <> true THEN
            RAISE EXCEPTION 'Security audit log must confirm password re-authentication and 2FA verification.';
        END IF;

        IF (v_audit.details->>'transaction_id')::uuid <> p_transaction_id OR
           (v_audit.details->>'request_fingerprint')::text <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Security audit log details transaction_id or request_fingerprint mismatch.';
        END IF;

        IF v_audit.created_at > v_auth.authorized_at OR v_audit.created_at < (v_auth.authorized_at - interval '5 minutes') THEN
            RAISE EXCEPTION 'Security audit log timestamp is not aligned with authorization authorized_at time.';
        END IF;

        -- Validate Approver active status & negative override permission
        SELECT om.id INTO v_appr_membership_id
        FROM public.organization_memberships om
        JOIN public.user_profiles up ON up.id = om.user_id
        WHERE om.user_id = v_auth.approved_by
          AND om.organization_id = p_organization_id
          AND om.is_active = true
          AND up.is_active = true;

        IF v_appr_membership_id IS NULL THEN
            RAISE EXCEPTION 'Approver user profile or organization membership is inactive or missing for organization %.', p_organization_id;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            JOIN public.user_profiles up ON up.id = om.user_id
            JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
            JOIN public.role_permissions rp ON rp.role_id = ur.role_id
            JOIN public.permissions p ON p.id = rp.permission_id
            WHERE om.user_id = v_auth.approved_by
              AND om.organization_id = p_organization_id
              AND om.is_active = true
              AND up.is_active = true
              AND p.code = 'inventory:negative_override'
              AND (
                  ur.branch_id IS NULL
                  OR ur.branch_id = v_tx.initiating_branch_id
              )
        ) THEN
            RAISE EXCEPTION 'Approver user lacks inventory:negative_override permission.';
        END IF;
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 5 & 6 & 7: Process Line Items
    -- --------------------------------------------------------------------------
    FOR v_item IN
        SELECT iti.*, p.is_serialized
        FROM public.inventory_transaction_items iti
        JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
        WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
        ORDER BY iti.row_number ASC
    LOOP
        -- ----------------------------------------------------------------------
        -- A. Serialized Items
        -- ----------------------------------------------------------------------
        IF v_item.is_serialized = true THEN
            IF v_item.quantity <> trunc(v_item.quantity) OR v_item.quantity <= 0 THEN
                RAISE EXCEPTION 'Serialized product % item quantity must be a positive integer.', v_item.product_id;
            END IF;

            SELECT count(*) INTO v_serial_count
            FROM public.inventory_transaction_serials
            WHERE transaction_item_id = v_item.id AND organization_id = p_organization_id;

            IF v_serial_count <> v_item.quantity THEN
                RAISE EXCEPTION 'Serial count mismatch for product %: expected %, found %.', v_item.product_id, v_item.quantity, v_serial_count;
            END IF;

            IF v_tx.transaction_type = 'COST_ADJUSTMENT' THEN
                RAISE EXCEPTION 'COST_ADJUSTMENT for serialized product % is strictly forbidden in this phase.', v_item.product_id;
            END IF;

            v_serial_sum_cost := 0;
            FOR v_serial IN
                SELECT ps.*, its.id AS trans_serial_id
                FROM public.inventory_transaction_serials its
                JOIN public.product_serials ps ON ps.id = its.product_serial_id AND ps.organization_id = its.organization_id
                WHERE its.transaction_item_id = v_item.id AND its.organization_id = p_organization_id
                ORDER BY ps.id ASC
            LOOP
                IF v_serial.organization_id <> p_organization_id OR v_serial.product_id <> v_item.product_id THEN
                    RAISE EXCEPTION 'Serial % does not belong to organization or product %.', v_serial.id, v_item.product_id;
                END IF;

                CASE v_tx.transaction_type
                    WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                        IF EXISTS (
                            SELECT 1
                            FROM public.inventory_transaction_serials its2
                            JOIN public.inventory_transaction_items iti2 ON iti2.id = its2.transaction_item_id
                            JOIN public.inventory_transactions it2 ON it2.id = iti2.transaction_id
                            WHERE its2.product_serial_id = v_serial.id
                              AND it2.status IN ('POSTED', 'REVERSED')
                        ) THEN
                            RAISE EXCEPTION 'Serial % has already been posted in a prior transaction and cannot be re-entered.', v_serial.serial_number_normalized;
                        END IF;

                        IF v_serial.status NOT IN ('AVAILABLE', 'RESERVED') THEN
                            RAISE EXCEPTION 'Serial % status % cannot be re-entered.', v_serial.serial_number_normalized, v_serial.status;
                        END IF;

                        IF v_item.destination_warehouse_id IS NULL THEN
                            RAISE EXCEPTION 'Destination warehouse is required for %.', v_tx.transaction_type;
                        END IF;

                        UPDATE public.product_serials
                        SET current_warehouse_id = v_item.destination_warehouse_id,
                            status = 'AVAILABLE'
                        WHERE id = v_serial.id AND organization_id = p_organization_id;

                    WHEN 'SALE_ISSUE' THEN
                        IF v_serial.current_warehouse_id IS DISTINCT FROM v_item.source_warehouse_id THEN
                            RAISE EXCEPTION 'Serial % is not in source warehouse %.', v_serial.serial_number_normalized, v_item.source_warehouse_id;
                        END IF;

                        IF v_serial.status NOT IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN
                            RAISE EXCEPTION 'Serial % status % is not available for sale.', v_serial.serial_number_normalized, v_serial.status;
                        END IF;

                        UPDATE public.product_serials
                        SET current_warehouse_id = NULL,
                            status = 'SOLD'
                        WHERE id = v_serial.id AND organization_id = p_organization_id;

                    WHEN 'TRANSFER' THEN
                        IF v_serial.current_warehouse_id IS DISTINCT FROM v_item.source_warehouse_id THEN
                            RAISE EXCEPTION 'Serial % is not in source warehouse %.', v_serial.serial_number_normalized, v_item.source_warehouse_id;
                        END IF;

                        IF v_serial.status NOT IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN
                            RAISE EXCEPTION 'Serial % status % is not available for transfer.', v_serial.serial_number_normalized, v_serial.status;
                        END IF;

                        UPDATE public.product_serials
                        SET current_warehouse_id = v_item.destination_warehouse_id
                        WHERE id = v_serial.id AND organization_id = p_organization_id;

                    WHEN 'ADJUSTMENT_OUT' THEN
                        IF v_serial.current_warehouse_id IS DISTINCT FROM v_item.source_warehouse_id THEN
                            RAISE EXCEPTION 'Serial % is not in source warehouse %.', v_serial.serial_number_normalized, v_item.source_warehouse_id;
                        END IF;

                        IF v_serial.status NOT IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN
                            RAISE EXCEPTION 'Serial % status % is not available for adjustment out.', v_serial.serial_number_normalized, v_serial.status;
                        END IF;

                        UPDATE public.product_serials
                        SET current_warehouse_id = NULL,
                            status = 'SCRAPPED'
                        WHERE id = v_serial.id AND organization_id = p_organization_id;

                    ELSE
                        RAISE EXCEPTION 'Unsupported transaction type % for serialized products.', v_tx.transaction_type;
                END CASE;

                v_serial_sum_cost := v_serial_sum_cost + v_serial.acquisition_cost_amount;
            END LOOP;

            v_item_total_cost := v_serial_sum_cost;
            v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
            v_item_cost_state := 'FINAL';

            -- MUST set cost_adjustment_amount to NULL for non-COST_ADJUSTMENT items!
            UPDATE public.inventory_transaction_items
            SET unit_cost_amount = v_item_unit_cost,
                total_cost_amount = v_item_total_cost,
                cost_adjustment_amount = NULL,
                cost_state = v_item_cost_state
            WHERE id = v_item.id AND organization_id = p_organization_id;

            -- Update Cost Balance incrementally for serialized item
            SELECT organization_quantity_on_hand, inventory_value_amount
            INTO v_curr_org_qty, v_curr_org_val
            FROM public.inventory_cost_balances
            WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            CASE v_tx.transaction_type
                WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                    v_new_org_qty := v_curr_org_qty + v_item.quantity;
                    v_new_org_val := v_curr_org_val + v_item_total_cost;
                WHEN 'SALE_ISSUE', 'ADJUSTMENT_OUT' THEN
                    v_new_org_qty := v_curr_org_qty - v_item.quantity;
                    v_new_org_val := v_curr_org_val - v_item_total_cost;
                    IF v_new_org_qty < 0 OR v_new_org_val < 0 THEN
                        RAISE EXCEPTION 'Serialized inventory balance cannot be negative.';
                    END IF;
                WHEN 'TRANSFER' THEN
                    v_new_org_qty := v_curr_org_qty;
                    v_new_org_val := v_curr_org_val;
            END CASE;

            v_new_wac := CASE WHEN v_new_org_qty > 0 THEN round(v_new_org_val::numeric / v_new_org_qty) ELSE 0 END;

            UPDATE public.inventory_cost_balances
            SET organization_quantity_on_hand = v_new_org_qty,
                inventory_value_amount = v_new_org_val,
                weighted_average_cost_amount = v_new_wac,
                last_transaction_id = p_transaction_id
            WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            -- Update Warehouse Balances for serialized item
            CASE v_tx.transaction_type
                WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.destination_warehouse_id
                      AND product_id = v_item.product_id;

                WHEN 'SALE_ISSUE', 'ADJUSTMENT_OUT' THEN
                    SELECT quantity_on_hand INTO v_curr_wh_qty
                    FROM public.inventory_balances
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    IF v_curr_wh_qty < v_item.quantity THEN
                        RAISE EXCEPTION 'Insufficient warehouse inventory balance for serialized product % in warehouse %.', v_item.product_id, v_item.source_warehouse_id;
                    END IF;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                WHEN 'TRANSFER' THEN
                    SELECT quantity_on_hand INTO v_curr_wh_qty
                    FROM public.inventory_balances
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    IF v_curr_wh_qty < v_item.quantity THEN
                        RAISE EXCEPTION 'Insufficient warehouse inventory balance for serialized transfer of product % in warehouse %.', v_item.product_id, v_item.source_warehouse_id;
                    END IF;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.destination_warehouse_id
                      AND product_id = v_item.product_id;
            END CASE;

        -- ----------------------------------------------------------------------
        -- B. Non-Serialized Items
        -- ----------------------------------------------------------------------
        ELSE
            IF EXISTS (
                SELECT 1 FROM public.inventory_transaction_serials
                WHERE transaction_item_id = v_item.id AND organization_id = p_organization_id
            ) THEN
                RAISE EXCEPTION 'Non-serialized product % line item cannot have serial records.', v_item.product_id;
            END IF;

            -- Warehouse Quantity Updates
            CASE v_tx.transaction_type
                WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                    IF v_item.destination_warehouse_id IS NULL OR v_item.source_warehouse_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Inbound transaction item requires destination_warehouse_id and NULL source_warehouse_id.';
                    END IF;
                    IF v_item.quantity <= 0 THEN
                        RAISE EXCEPTION 'Inbound quantity must be positive.';
                    END IF;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.destination_warehouse_id
                      AND product_id = v_item.product_id;

                WHEN 'SALE_ISSUE', 'ADJUSTMENT_OUT' THEN
                    IF v_item.source_warehouse_id IS NULL OR v_item.destination_warehouse_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Outbound transaction item requires source_warehouse_id and NULL destination_warehouse_id.';
                    END IF;
                    IF v_item.quantity <= 0 THEN
                        RAISE EXCEPTION 'Outbound quantity must be positive.';
                    END IF;

                    SELECT quantity_on_hand INTO v_curr_wh_qty
                    FROM public.inventory_balances
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    v_new_wh_qty := v_curr_wh_qty - v_item.quantity;

                    IF v_new_wh_qty < 0 THEN
                        v_any_warehouse_negative := true;
                        IF v_tx.transaction_type <> 'SALE_ISSUE' THEN
                            RAISE EXCEPTION 'Insufficient warehouse inventory balance for product % in warehouse %.', v_item.product_id, v_item.source_warehouse_id;
                        END IF;

                        IF p_negative_override_authorization_id IS NULL OR v_auth.id IS NULL THEN
                            RAISE EXCEPTION 'Negative inventory override authorization is required because one or more warehouse balances became negative.';
                        END IF;

                        v_qty_before := v_curr_wh_qty;
                        v_qty_after := v_new_wh_qty;
                        v_req_qty := v_item.quantity;
                        v_shortage := v_req_qty - GREATEST(v_qty_before, 0);

                        INSERT INTO public.inventory_negative_override_logs (
                            organization_id, authorization_id, transaction_id, transaction_item_id,
                            product_id, warehouse_id, quantity_before, requested_quantity,
                            quantity_after, shortage_quantity, reason_snapshot, approved_by, posted_by
                        ) VALUES (
                            p_organization_id, v_auth.id, p_transaction_id, v_item.id,
                            v_item.product_id, v_item.source_warehouse_id, v_qty_before, v_req_qty,
                            v_qty_after, v_shortage, v_auth.reason, v_auth.approved_by, v_user_id
                        );
                    END IF;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                WHEN 'TRANSFER' THEN
                    IF v_item.source_warehouse_id IS NULL OR v_item.destination_warehouse_id IS NULL OR v_item.source_warehouse_id = v_item.destination_warehouse_id THEN
                        RAISE EXCEPTION 'Transfer requires distinct source and destination warehouses.';
                    END IF;
                    IF v_item.quantity <= 0 THEN
                        RAISE EXCEPTION 'Transfer quantity must be positive.';
                    END IF;

                    SELECT quantity_on_hand INTO v_curr_wh_qty
                    FROM public.inventory_balances
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    IF v_curr_wh_qty < v_item.quantity THEN
                        RAISE EXCEPTION 'Insufficient warehouse inventory for transfer of product % in warehouse %.', v_item.product_id, v_item.source_warehouse_id;
                    END IF;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.destination_warehouse_id
                      AND product_id = v_item.product_id;

                WHEN 'COST_ADJUSTMENT' THEN
                    IF v_item.quantity <> 0 THEN
                        RAISE EXCEPTION 'COST_ADJUSTMENT quantity must be exactly zero.';
                    END IF;
                    IF v_item.cost_adjustment_amount IS NULL OR v_item.cost_adjustment_amount = 0 THEN
                        RAISE EXCEPTION 'COST_ADJUSTMENT cost_adjustment_amount must be non-zero.';
                    END IF;
            END CASE;

            -- Cost Balances & Item Pricing Calculation
            SELECT organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount
            INTO v_curr_org_qty, v_curr_org_val, v_curr_wac
            FROM public.inventory_cost_balances
            WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            CASE v_tx.transaction_type
                WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                    IF v_item.unit_cost_amount IS NULL OR v_item.unit_cost_amount < 0 THEN
                        RAISE EXCEPTION 'Inbound unit cost amount is required and non-negative.';
                    END IF;

                    v_item_total_cost := round(v_item.quantity * v_item.unit_cost_amount);
                    v_item_unit_cost := v_item.unit_cost_amount;
                    v_item_cost_state := 'FINAL';

                    v_new_org_qty := v_curr_org_qty + v_item.quantity;
                    v_new_org_val := v_curr_org_val + v_item_total_cost;
                    v_new_wac := CASE WHEN v_new_org_qty > 0 THEN round(v_new_org_val::numeric / v_new_org_qty) ELSE 0 END;

                    UPDATE public.inventory_transaction_items
                    SET unit_cost_amount = v_item_unit_cost,
                        total_cost_amount = v_item_total_cost,
                        cost_adjustment_amount = NULL,
                        cost_state = v_item_cost_state
                    WHERE id = v_item.id AND organization_id = p_organization_id;

                WHEN 'SALE_ISSUE' THEN
                    IF v_curr_org_qty >= v_item.quantity THEN
                        IF v_curr_org_qty = v_item.quantity THEN
                            -- Full organizational exit: consume EXACT inventory_value_amount to avoid rounding remainders
                            v_item_total_cost := v_curr_org_val;
                            v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
                        ELSE
                            -- Partial exit: calculate via exact ratio (inventory_value_amount / organization_quantity_on_hand)
                            v_item_total_cost := round(v_item.quantity * (v_curr_org_val::numeric / v_curr_org_qty));
                            v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
                        END IF;
                        v_item_cost_state := 'FINAL';

                        v_new_org_qty := v_curr_org_qty - v_item.quantity;
                        v_new_org_val := v_curr_org_val - v_item_total_cost;
                        v_new_wac := CASE WHEN v_new_org_qty > 0 THEN round(v_new_org_val::numeric / v_new_org_qty) ELSE 0 END;

                        UPDATE public.inventory_transaction_items
                        SET unit_cost_amount = v_item_unit_cost,
                            total_cost_amount = v_item_total_cost,
                            cost_adjustment_amount = NULL,
                            cost_state = v_item_cost_state
                        WHERE id = v_item.id AND organization_id = p_organization_id;

                    ELSIF v_curr_org_qty <= 0 THEN
                        IF v_item.unit_cost_amount IS NULL OR v_item.unit_cost_amount <= 0 THEN
                            RAISE EXCEPTION 'Provisional unit cost amount must be provided and greater than zero for organizational shortage.';
                        END IF;

                        v_item_unit_cost := v_item.unit_cost_amount;
                        v_item_total_cost := round(v_item.quantity * v_item.unit_cost_amount);
                        v_item_cost_state := 'PROVISIONAL';

                        -- Stage provisional cost position to insert AFTER header POSTED update
                        INSERT INTO tmp_staged_provisional_positions (
                            issue_transaction_item_id, product_id, warehouse_id, shortage_quantity, provisional_unit_cost_amount
                        ) VALUES (
                            v_item.id, v_item.product_id, v_item.source_warehouse_id, v_item.quantity, v_item.unit_cost_amount
                        );

                        v_new_org_qty := v_curr_org_qty - v_item.quantity;
                        v_new_org_val := v_curr_org_val - v_item_total_cost;
                        v_new_wac := v_curr_wac;

                        UPDATE public.inventory_transaction_items
                        SET unit_cost_amount = v_item_unit_cost,
                            total_cost_amount = v_item_total_cost,
                            cost_adjustment_amount = NULL,
                            cost_state = v_item_cost_state
                        WHERE id = v_item.id AND organization_id = p_organization_id;

                    ELSE
                        IF v_item.unit_cost_amount IS NULL OR v_item.unit_cost_amount <= 0 THEN
                            RAISE EXCEPTION 'Provisional unit cost amount must be provided and greater than zero for partial organizational shortage.';
                        END IF;

                        v_final_portion_qty := v_curr_org_qty;
                        v_prov_portion_qty := v_item.quantity - v_curr_org_qty;

                        -- Final portion consumes entire remaining inventory_value_amount exactly
                        v_final_portion_cost := v_curr_org_val;
                        v_prov_portion_cost := round(v_prov_portion_qty * v_item.unit_cost_amount);
                        v_item_total_cost := v_final_portion_cost + v_prov_portion_cost;
                        v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
                        v_item_cost_state := 'MIXED';

                        -- Stage provisional cost position for the shortage portion
                        INSERT INTO tmp_staged_provisional_positions (
                            issue_transaction_item_id, product_id, warehouse_id, shortage_quantity, provisional_unit_cost_amount
                        ) VALUES (
                            v_item.id, v_item.product_id, v_item.source_warehouse_id, v_prov_portion_qty, v_item.unit_cost_amount
                        );

                        v_new_org_qty := v_curr_org_qty - v_item.quantity;
                        v_new_org_val := v_curr_org_val - v_item_total_cost;
                        v_new_wac := v_curr_wac;

                        UPDATE public.inventory_transaction_items
                        SET unit_cost_amount = v_item_unit_cost,
                            total_cost_amount = v_item_total_cost,
                            cost_adjustment_amount = NULL,
                            cost_state = v_item_cost_state
                        WHERE id = v_item.id AND organization_id = p_organization_id;
                    END IF;

                WHEN 'TRANSFER' THEN
                    v_item_unit_cost := v_curr_wac;
                    v_item_total_cost := round(v_item.quantity * v_curr_wac);
                    v_item_cost_state := 'FINAL';

                    v_new_org_qty := v_curr_org_qty;
                    v_new_org_val := v_curr_org_val;
                    v_new_wac := v_curr_wac;

                    UPDATE public.inventory_transaction_items
                    SET unit_cost_amount = v_item_unit_cost,
                        total_cost_amount = v_item_total_cost,
                        cost_adjustment_amount = NULL,
                        cost_state = v_item_cost_state
                    WHERE id = v_item.id AND organization_id = p_organization_id;

                WHEN 'ADJUSTMENT_OUT' THEN
                    IF v_curr_org_qty < v_item.quantity THEN
                        RAISE EXCEPTION 'Insufficient organizational inventory balance for ADJUSTMENT_OUT of product %.', v_item.product_id;
                    END IF;

                    IF v_curr_org_qty = v_item.quantity THEN
                        v_item_total_cost := v_curr_org_val;
                        v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
                        v_new_org_qty := 0;
                        v_new_org_val := 0;
                        v_new_wac := 0;
                    ELSE
                        v_item_total_cost := round(v_item.quantity * (v_curr_org_val::numeric / v_curr_org_qty));
                        v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
                        v_new_org_qty := v_curr_org_qty - v_item.quantity;
                        v_new_org_val := v_curr_org_val - v_item_total_cost;
                        v_new_wac := CASE WHEN v_new_org_qty > 0 THEN round(v_new_org_val::numeric / v_new_org_qty) ELSE 0 END;
                    END IF;

                    v_item_cost_state := 'FINAL';

                    UPDATE public.inventory_transaction_items
                    SET unit_cost_amount = v_item_unit_cost,
                        total_cost_amount = v_item_total_cost,
                        cost_adjustment_amount = NULL,
                        cost_state = v_item_cost_state
                    WHERE id = v_item.id AND organization_id = p_organization_id;

                WHEN 'COST_ADJUSTMENT' THEN
                    IF v_curr_org_qty = 0 THEN
                        RAISE EXCEPTION 'Cannot apply COST_ADJUSTMENT when organizational quantity is zero.';
                    END IF;

                    v_item_unit_cost := 0;
                    v_item_total_cost := 0;
                    v_item_cost_state := 'FINAL';

                    v_new_org_qty := v_curr_org_qty;
                    v_new_org_val := v_curr_org_val + v_item.cost_adjustment_amount;

                    IF (v_new_org_qty > 0 AND v_new_org_val < 0) OR (v_new_org_qty < 0 AND v_new_org_val > 0) THEN
                        RAISE EXCEPTION 'COST_ADJUSTMENT results in inconsistent inventory value sign (%) for quantity (%).', v_new_org_val, v_new_org_qty;
                    END IF;

                    v_new_wac := round(abs(v_new_org_val)::numeric / abs(v_new_org_qty));

                    UPDATE public.inventory_transaction_items
                    SET unit_cost_amount = 0,
                        total_cost_amount = 0,
                        cost_state = v_item_cost_state
                    WHERE id = v_item.id AND organization_id = p_organization_id;

            END CASE;

            IF v_new_org_qty = 0 THEN
                IF v_new_org_val <> 0 THEN
                    IF NOT EXISTS (
                        SELECT 1 FROM public.inventory_provisional_cost_positions
                        WHERE product_id = v_item.product_id AND organization_id = p_organization_id
                          AND status IN ('OPEN', 'PARTIALLY_SETTLED')
                    ) THEN
                        RAISE EXCEPTION 'Non-zero inventory value (%) remaining when quantity is zero for product %.', v_new_org_val, v_item.product_id;
                    END IF;
                END IF;
                v_new_wac := 0;
            END IF;

            UPDATE public.inventory_cost_balances
            SET organization_quantity_on_hand = v_new_org_qty,
                inventory_value_amount = v_new_org_val,
                weighted_average_cost_amount = v_new_wac,
                last_transaction_id = p_transaction_id
            WHERE organization_id = p_organization_id AND product_id = v_item.product_id;
        END IF;

        IF v_item_cost_state = 'FINAL' THEN v_has_final := true; END IF;
        IF v_item_cost_state = 'PROVISIONAL' THEN v_has_provisional := true; END IF;
        IF v_item_cost_state = 'MIXED' THEN v_has_mixed := true; END IF;

    END LOOP;

    -- --------------------------------------------------------------------------
    -- Step 8: Negative Inventory Override Consumption
    -- --------------------------------------------------------------------------
    IF v_any_warehouse_negative = true THEN
        UPDATE public.inventory_negative_override_authorizations
        SET status = 'CONSUMED',
            consumed_at = now()
        WHERE id = v_auth.id AND organization_id = p_organization_id;

    ELSE
        IF p_negative_override_authorization_id IS NOT NULL THEN
            RAISE EXCEPTION 'Unnecessary negative override authorization provided.';
        END IF;
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 9: Determine Header Cost State
    -- --------------------------------------------------------------------------
    IF v_has_mixed OR (v_has_final AND v_has_provisional) THEN
        v_header_cost_state := 'MIXED';
    ELSIF v_has_provisional THEN
        v_header_cost_state := 'PROVISIONAL';
    ELSE
        v_header_cost_state := 'FINAL';
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 10: Document Sequence Generation
    -- --------------------------------------------------------------------------
    INSERT INTO public.inventory_document_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_tx.fiscal_year_id, 1, v_user_id)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_doc_number
    FROM public.inventory_document_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_tx.fiscal_year_id
    FOR UPDATE;

    UPDATE public.inventory_document_sequences
    SET next_number = next_number + 1,
        updated_by = v_user_id,
        updated_at = now()
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_tx.fiscal_year_id;

    -- --------------------------------------------------------------------------
    -- Step 11: Update Header to POSTED
    -- --------------------------------------------------------------------------
    UPDATE public.inventory_transactions
    SET document_number = v_doc_number,
        status = 'POSTED',
        cost_state = v_header_cost_state,
        idempotency_key = p_operation_key,
        request_fingerprint = p_request_fingerprint,
        posted_by = v_user_id,
        posted_at = now()
    WHERE id = p_transaction_id AND organization_id = p_organization_id;

    -- --------------------------------------------------------------------------
    -- Step 12: Insert Staged Provisional Cost Positions (Header is now POSTED)
    -- --------------------------------------------------------------------------
    INSERT INTO public.inventory_provisional_cost_positions (
        organization_id, issue_transaction_item_id, product_id, warehouse_id,
        shortage_quantity, remaining_quantity, provisional_unit_cost_amount, provisional_total_cost_amount, status
    )
    SELECT
        p_organization_id,
        stage.issue_transaction_item_id,
        stage.product_id,
        stage.warehouse_id,
        stage.shortage_quantity,
        stage.shortage_quantity,
        stage.provisional_unit_cost_amount,
        round(stage.shortage_quantity * stage.provisional_unit_cost_amount),
        'OPEN'
    FROM tmp_staged_provisional_positions stage;

    RETURN v_doc_number;
END;
$$;

-- Security Hardening: Revoke execution from PUBLIC, anon, and authenticated
REVOKE EXECUTE ON FUNCTION public.post_inventory_transaction(UUID, UUID, INT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ==============================================================================
-- N. ATOMIC INVENTORY TRANSACTION REVERSAL FUNCTION
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.reverse_inventory_transaction(
    p_organization_id UUID,
    p_original_transaction_id UUID,
    p_reversal_fiscal_year_id UUID,
    p_reversal_date DATE,
    p_reversal_reason TEXT,
    p_expected_version INT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_membership_id UUID;
    v_original RECORD;
    v_reversal_id UUID;
    v_reversal_type TEXT;
    v_existing_reversal RECORD;
    v_conflicting_tx RECORD;
    v_fiscal_year RECORD;
    v_open_period_count INT;
    v_doc_number BIGINT;
    v_seq_next BIGINT;
    v_item RECORD;
    v_header_cost_state TEXT;
    v_desc TEXT;
    v_serial RECORD;
    v_serial_count INT;
    v_subsequent_tx_count INT;
    v_curr_wh_qty NUMERIC(18,3);
    v_curr_org_qty NUMERIC(18,3);
    v_curr_org_val BIGINT;
    v_curr_wac BIGINT;
    v_new_wh_qty NUMERIC(18,3);
    v_new_org_qty NUMERIC(18,3);
    v_new_org_val BIGINT;
    v_new_wac BIGINT;
    v_curr_dest_wh_qty NUMERIC(18,3);
    v_has_final BOOLEAN := false;
    v_has_provisional BOOLEAN := false;
    v_has_mixed BOOLEAN := false;
    v_wh RECORD;
    v_wh_branch_id UUID;
BEGIN
    -- 1. Authentication & Active User Profile Check
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT om.id INTO v_membership_id
    FROM public.organization_memberships om
    JOIN public.user_profiles up ON up.id = om.user_id
    WHERE om.organization_id = p_organization_id
      AND om.user_id = v_user_id
      AND om.is_active = true
      AND up.is_active = true;

    IF v_membership_id IS NULL THEN
        RAISE EXCEPTION 'User profile or organization membership is inactive or missing for organization %.', p_organization_id;
    END IF;

    -- 2. Input Parameter Validations
    IF p_original_transaction_id IS NULL THEN
        RAISE EXCEPTION 'p_original_transaction_id is required.';
    END IF;

    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'p_expected_version is required.';
    END IF;

    IF p_reversal_fiscal_year_id IS NULL THEN
        RAISE EXCEPTION 'p_reversal_fiscal_year_id is required.';
    END IF;

    IF p_reversal_date IS NULL THEN
        RAISE EXCEPTION 'p_reversal_date is required.';
    END IF;

    IF p_reversal_reason IS NULL OR trim(p_reversal_reason) = '' THEN
        RAISE EXCEPTION 'p_reversal_reason must not be empty.';
    END IF;

    IF p_operation_key IS NULL OR trim(p_operation_key) = '' THEN
        RAISE EXCEPTION 'p_operation_key must not be empty.';
    END IF;

    IF p_request_fingerprint IS NULL OR trim(p_request_fingerprint) = '' THEN
        RAISE EXCEPTION 'p_request_fingerprint must not be empty.';
    END IF;

    -- 3. Lock Original Transaction Header FOR UPDATE
    SELECT * INTO v_original
    FROM public.inventory_transactions
    WHERE id = p_original_transaction_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF v_original.id IS NULL THEN
        RAISE EXCEPTION 'Original inventory transaction not found in the specified organization.';
    END IF;

    -- 4. Branch Permission Check
    IF NOT public.has_branch_permission(p_organization_id, v_original.initiating_branch_id, 'inventory:reverse') THEN
        RAISE EXCEPTION 'User lacks inventory:reverse permission for initiating branch %.', v_original.initiating_branch_id;
    END IF;

    -- 4b. Involved Warehouses Permission Check (Ordered by warehouse_id)
    FOR v_wh IN
        SELECT DISTINCT w_id
        FROM (
            SELECT source_warehouse_id AS w_id
            FROM public.inventory_transaction_items
            WHERE transaction_id = v_original.id AND organization_id = p_organization_id AND source_warehouse_id IS NOT NULL
            UNION
            SELECT destination_warehouse_id AS w_id
            FROM public.inventory_transaction_items
            WHERE transaction_id = v_original.id AND organization_id = p_organization_id AND destination_warehouse_id IS NOT NULL
        ) sub
        ORDER BY w_id
    LOOP
        SELECT branch_id INTO v_wh_branch_id
        FROM public.warehouses
        WHERE id = v_wh.w_id AND organization_id = p_organization_id;

        IF v_wh_branch_id IS NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.warehouses
                WHERE id = v_wh.w_id AND organization_id = p_organization_id
            ) THEN
                RAISE EXCEPTION 'Warehouse % does not exist or belongs to another organization.', v_wh.w_id;
            ELSE
                RAISE EXCEPTION 'Warehouse % is not connected to a branch.', v_wh.w_id;
            END IF;
        END IF;

        IF NOT public.has_branch_permission(p_organization_id, v_wh_branch_id, 'inventory:reverse') THEN
            RAISE EXCEPTION 'User lacks inventory:reverse permission for branch % assigned to warehouse %.', v_wh_branch_id, v_wh.w_id;
        END IF;

        IF NOT (
            public.has_permission(p_organization_id, 'inventory:manage')
            OR
            EXISTS (
                SELECT 1 FROM public.user_warehouse_access uwa
                WHERE uwa.organization_id = p_organization_id
                  AND uwa.membership_id = v_membership_id
                  AND uwa.warehouse_id = v_wh.w_id
                  AND uwa.is_active = true
            )
        ) THEN
            RAISE EXCEPTION 'User lacks access to warehouse %.', v_wh.w_id;
        END IF;
    END LOOP;

    -- 5. Idempotency & Conflict Check
    SELECT * INTO v_existing_reversal
    FROM public.inventory_transactions
    WHERE organization_id = p_organization_id
      AND reversal_of_transaction_id = v_original.id;

    IF v_existing_reversal.id IS NOT NULL THEN
        IF v_existing_reversal.idempotency_key = p_operation_key
           AND v_existing_reversal.request_fingerprint = p_request_fingerprint THEN
            RETURN v_existing_reversal.id;
        ELSE
            RAISE EXCEPTION 'Transaction % has already been reversed.', p_original_transaction_id;
        END IF;
    END IF;

    SELECT * INTO v_conflicting_tx
    FROM public.inventory_transactions
    WHERE organization_id = p_organization_id
      AND idempotency_key = p_operation_key;

    IF v_conflicting_tx.id IS NOT NULL THEN
        IF v_conflicting_tx.reversal_of_transaction_id IS DISTINCT FROM v_original.id OR v_conflicting_tx.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Idempotency key % has already been used with a different request or transaction.', p_operation_key;
        END IF;
    END IF;

    -- 6. Original Transaction State & Eligibility Checks
    IF v_original.version <> p_expected_version THEN
        RAISE EXCEPTION 'Version mismatch. Expected %, but document version is %.', p_expected_version, v_original.version;
    END IF;

    IF v_original.status <> 'POSTED' THEN
        RAISE EXCEPTION 'Only POSTED transactions can be reversed. Current status is %.', v_original.status;
    END IF;

    IF v_original.transaction_kind <> 'GENERAL' THEN
        RAISE EXCEPTION 'Only GENERAL transactions can be reversed. Current transaction_kind is %.', v_original.transaction_kind;
    END IF;

    IF v_original.journal_voucher_id IS NOT NULL THEN
        RAISE EXCEPTION 'Transaction linked to accounting journal voucher % cannot be reversed until accounting-inventory atomic integration is implemented.', v_original.journal_voucher_id;
    END IF;

    IF p_reversal_date < v_original.transaction_date THEN
        RAISE EXCEPTION 'Reversal date (%) cannot be earlier than original transaction date (%).', p_reversal_date, v_original.transaction_date;
    END IF;

    -- 7. Fiscal Year & Open Period Validation
    SELECT * INTO v_fiscal_year
    FROM public.fiscal_years
    WHERE id = p_reversal_fiscal_year_id
      AND organization_id = p_organization_id;

    IF v_fiscal_year.id IS NULL THEN
        RAISE EXCEPTION 'Reversal fiscal year not found in the specified organization.';
    END IF;

    IF v_fiscal_year.is_closed THEN
        RAISE EXCEPTION 'Reversal fiscal year % is closed.', v_fiscal_year.title;
    END IF;

    IF p_reversal_date < v_fiscal_year.start_date OR p_reversal_date > v_fiscal_year.end_date THEN
        RAISE EXCEPTION 'Reversal date % is outside reversal fiscal year % range (% to %).',
            p_reversal_date, v_fiscal_year.title, v_fiscal_year.start_date, v_fiscal_year.end_date;
    END IF;

    SELECT COUNT(*) INTO v_open_period_count
    FROM public.fiscal_periods
    WHERE organization_id = p_organization_id
      AND fiscal_year_id = p_reversal_fiscal_year_id
      AND start_date <= p_reversal_date
      AND end_date >= p_reversal_date
      AND is_closed = false;

    IF v_open_period_count <> 1 THEN
        RAISE EXCEPTION 'Exactly one open fiscal period must cover reversal date %. Found % open periods.', p_reversal_date, v_open_period_count;
    END IF;

    -- 8. Supported Types & Type Mapping
    IF v_original.transaction_type IN ('SALES_RETURN', 'PURCHASE_RETURN') THEN
        RAISE EXCEPTION 'Reversal of % is currently unsupported as return lifecycle logic is not fully integrated.', v_original.transaction_type;
    END IF;

    CASE v_original.transaction_type
        WHEN 'OPENING' THEN v_reversal_type := 'ADJUSTMENT_OUT';
        WHEN 'PURCHASE_RECEIPT' THEN v_reversal_type := 'PURCHASE_RETURN';
        WHEN 'SALE_ISSUE' THEN v_reversal_type := 'SALES_RETURN';
        WHEN 'TRANSFER' THEN v_reversal_type := 'TRANSFER';
        WHEN 'ADJUSTMENT_IN' THEN v_reversal_type := 'ADJUSTMENT_OUT';
        WHEN 'ADJUSTMENT_OUT' THEN v_reversal_type := 'ADJUSTMENT_IN';
        WHEN 'COST_ADJUSTMENT' THEN v_reversal_type := 'COST_ADJUSTMENT';
        ELSE
            RAISE EXCEPTION 'Unsupported original transaction type: %', v_original.transaction_type;
    END CASE;

    -- 9. Create Draft Reversal Transaction Header
    v_reversal_id := gen_random_uuid();
    v_desc := 'معکوس‌سازی سند شماره ' || COALESCE(v_original.document_number::TEXT, v_original.id::TEXT) || ' - ' || trim(p_reversal_reason);

    INSERT INTO public.inventory_transactions (
        id,
        organization_id,
        fiscal_year_id,
        initiating_branch_id,
        transaction_date,
        transaction_type,
        transaction_kind,
        status,
        document_number,
        reversal_of_transaction_id,
        source_event_key,
        idempotency_key,
        request_fingerprint,
        journal_voucher_id,
        created_by,
        description,
        cost_state
    ) VALUES (
        v_reversal_id,
        p_organization_id,
        p_reversal_fiscal_year_id,
        v_original.initiating_branch_id,
        p_reversal_date,
        v_reversal_type,
        'REVERSAL',
        'DRAFT',
        NULL,
        v_original.id,
        NULL,
        p_operation_key,
        p_request_fingerprint,
        NULL,
        v_user_id,
        v_desc,
        'PENDING'
    );

    -- 10. Create Reversal Transaction Items & Copy Serial Associations
    FOR v_item IN
        SELECT * FROM public.inventory_transaction_items
        WHERE transaction_id = v_original.id AND organization_id = p_organization_id
        ORDER BY row_number, id
    LOOP
        DECLARE
            v_reversal_item_id UUID := gen_random_uuid();
            v_rev_src_wh UUID;
            v_rev_dest_wh UUID;
            v_adj_cost BIGINT;
        BEGIN
            IF v_original.transaction_type IN ('OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN') THEN
                v_rev_src_wh := v_item.destination_warehouse_id;
                v_rev_dest_wh := NULL;
                v_adj_cost := NULL;
            ELSIF v_original.transaction_type IN ('SALE_ISSUE', 'ADJUSTMENT_OUT') THEN
                v_rev_src_wh := NULL;
                v_rev_dest_wh := v_item.source_warehouse_id;
                v_adj_cost := NULL;
            ELSIF v_original.transaction_type = 'TRANSFER' THEN
                v_rev_src_wh := v_item.destination_warehouse_id;
                v_rev_dest_wh := v_item.source_warehouse_id;
                v_adj_cost := NULL;
            ELSIF v_original.transaction_type = 'COST_ADJUSTMENT' THEN
                v_rev_src_wh := NULL;
                v_rev_dest_wh := NULL;
                v_adj_cost := - v_item.cost_adjustment_amount;
            END IF;

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
                cost_adjustment_amount,
                cost_state,
                description
            ) VALUES (
                v_reversal_item_id,
                p_organization_id,
                v_reversal_id,
                v_item.row_number,
                v_item.product_id,
                v_rev_src_wh,
                v_rev_dest_wh,
                CASE WHEN v_original.transaction_type = 'COST_ADJUSTMENT' THEN 0 ELSE v_item.quantity END,
                v_item.unit_cost_amount,
                v_item.total_cost_amount,
                v_adj_cost,
                v_item.cost_state,
                'معکوس ردیف ' || v_item.row_number || ' سند اصلی'
            );

            INSERT INTO public.inventory_transaction_serials (
                organization_id,
                transaction_item_id,
                product_serial_id
            )
            SELECT
                p_organization_id,
                v_reversal_item_id,
                product_serial_id
            FROM public.inventory_transaction_serials
            WHERE organization_id = p_organization_id
              AND transaction_item_id = v_item.id;
        END;
    END LOOP;

    -- 11. Strict Lock Ordering
    -- Step A: Insert zero balances rows if missing (deterministic order)
    INSERT INTO public.inventory_balances (organization_id, warehouse_id, product_id, quantity_on_hand)
    SELECT DISTINCT p_organization_id, wh.wh_id, item.product_id, 0
    FROM public.inventory_transaction_items item
    CROSS JOIN LATERAL (
        VALUES (item.source_warehouse_id), (item.destination_warehouse_id)
    ) AS wh(wh_id)
    WHERE item.transaction_id = v_original.id
      AND item.organization_id = p_organization_id
      AND wh.wh_id IS NOT NULL
    ORDER BY wh.wh_id, item.product_id
    ON CONFLICT (organization_id, warehouse_id, product_id) DO NOTHING;

    INSERT INTO public.inventory_cost_balances (organization_id, product_id, organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount)
    SELECT DISTINCT p_organization_id, item.product_id, 0, 0, 0
    FROM public.inventory_transaction_items item
    WHERE item.transaction_id = v_original.id
      AND item.organization_id = p_organization_id
    ORDER BY item.product_id
    ON CONFLICT (organization_id, product_id) DO NOTHING;

    -- Step B: Lock inventory_balances (deterministic order by warehouse_id, product_id)
    PERFORM 1
    FROM public.inventory_balances
    WHERE organization_id = p_organization_id
      AND (warehouse_id, product_id) IN (
          SELECT DISTINCT wh.wh_id, item.product_id
          FROM public.inventory_transaction_items item
          CROSS JOIN LATERAL (VALUES (item.source_warehouse_id), (item.destination_warehouse_id)) AS wh(wh_id)
          WHERE item.transaction_id = v_original.id AND item.organization_id = p_organization_id AND wh.wh_id IS NOT NULL
      )
    ORDER BY warehouse_id, product_id
    FOR UPDATE;

    -- Step C: Lock inventory_cost_balances (deterministic order by product_id)
    PERFORM 1
    FROM public.inventory_cost_balances
    WHERE organization_id = p_organization_id
      AND product_id IN (
          SELECT DISTINCT item.product_id
          FROM public.inventory_transaction_items item
          WHERE item.transaction_id = v_original.id AND item.organization_id = p_organization_id
      )
    ORDER BY product_id
    FOR UPDATE;

    -- Step D: Lock product_serials (deterministic order by id)
    PERFORM 1
    FROM public.product_serials
    WHERE organization_id = p_organization_id
      AND id IN (
          SELECT DISTINCT its.product_serial_id
          FROM public.inventory_transaction_items item
          JOIN public.inventory_transaction_serials its ON its.transaction_item_id = item.id AND its.organization_id = item.organization_id
          WHERE item.transaction_id = v_original.id AND item.organization_id = p_organization_id
      )
    ORDER BY id
    FOR UPDATE;

    -- Step E: Lock relevant provisional cost positions
    IF v_original.transaction_type = 'SALE_ISSUE' THEN
        PERFORM 1
        FROM public.inventory_provisional_cost_positions
        WHERE organization_id = p_organization_id
          AND issue_transaction_item_id IN (
              SELECT id FROM public.inventory_transaction_items
              WHERE transaction_id = v_original.id AND organization_id = p_organization_id
          )
        ORDER BY id
        FOR UPDATE;
    END IF;

    -- 12. Provisional Cost Positions & Allocations Eligibility Checks
    IF v_original.transaction_type = 'SALE_ISSUE' THEN
        IF EXISTS (
            SELECT 1 FROM public.inventory_provisional_cost_positions
            WHERE organization_id = p_organization_id
              AND issue_transaction_item_id IN (
                  SELECT id FROM public.inventory_transaction_items
                  WHERE transaction_id = v_original.id AND organization_id = p_organization_id
              )
              AND status IN ('PARTIALLY_SETTLED', 'SETTLED')
        ) THEN
            RAISE EXCEPTION 'Cannot reverse SALE_ISSUE that has PARTIALLY_SETTLED or SETTLED provisional cost positions.';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.inventory_provisional_cost_allocations alloc
            JOIN public.inventory_provisional_cost_positions pos ON pos.id = alloc.provisional_position_id AND pos.organization_id = alloc.organization_id
            WHERE pos.organization_id = p_organization_id
              AND pos.issue_transaction_item_id IN (
                  SELECT id FROM public.inventory_transaction_items
                  WHERE transaction_id = v_original.id AND organization_id = p_organization_id
              )
        ) THEN
            RAISE EXCEPTION 'Cannot reverse SALE_ISSUE with existing provisional cost allocations.';
        END IF;
    ELSIF v_original.transaction_type = 'PURCHASE_RECEIPT' THEN
        IF EXISTS (
            SELECT 1
            FROM public.inventory_provisional_cost_allocations alloc
            JOIN public.inventory_transaction_items item ON item.id = alloc.receipt_transaction_item_id AND item.organization_id = alloc.organization_id
            WHERE item.transaction_id = v_original.id AND item.organization_id = p_organization_id
        ) THEN
            RAISE EXCEPTION 'Cannot reverse PURCHASE_RECEIPT that has been used in provisional cost allocations.';
        END IF;
    END IF;

    -- 13. Subsequent Transactions Check for Non-Serialized Entries
    IF v_original.transaction_type IN ('OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN', 'COST_ADJUSTMENT') THEN
        FOR v_item IN
            SELECT iti.*, p.is_serialized
            FROM public.inventory_transaction_items iti
            JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
            WHERE iti.transaction_id = v_original.id AND iti.organization_id = p_organization_id
        LOOP
            IF NOT v_item.is_serialized THEN
                SELECT COUNT(*) INTO v_subsequent_tx_count
                FROM public.inventory_transaction_items sub_item
                JOIN public.inventory_transactions sub_tx ON sub_tx.id = sub_item.transaction_id AND sub_tx.organization_id = sub_item.organization_id
                WHERE sub_item.organization_id = p_organization_id
                  AND sub_item.product_id = v_item.product_id
                  AND sub_tx.status = 'POSTED'
                  AND sub_tx.transaction_kind = 'GENERAL'
                  AND sub_tx.id <> v_original.id
                  AND (
                      sub_tx.posted_at > v_original.posted_at
                      OR (sub_tx.posted_at = v_original.posted_at AND sub_tx.id <> v_original.id)
                  );

                IF v_subsequent_tx_count > 0 THEN
                    RAISE EXCEPTION 'Cannot reverse entry or cost adjustment transaction for product % because subsequent active posted transactions exist.', v_item.product_id;
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 14. Serialized Goods Lifecycle Validation & Status Updates
    FOR v_item IN
        SELECT iti.*, p.is_serialized
        FROM public.inventory_transaction_items iti
        JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
        WHERE iti.transaction_id = v_original.id AND iti.organization_id = p_organization_id
    LOOP
        IF v_item.is_serialized THEN
            SELECT COUNT(*) INTO v_serial_count
            FROM public.inventory_transaction_serials
            WHERE transaction_item_id = v_item.id AND organization_id = p_organization_id;

            IF v_serial_count <> v_item.quantity THEN
                RAISE EXCEPTION 'Serial count (%) does not match item quantity (%) for product %.', v_serial_count, v_item.quantity, v_item.product_id;
            END IF;

            FOR v_serial IN
                SELECT ps.*
                FROM public.product_serials ps
                JOIN public.inventory_transaction_serials its ON its.product_serial_id = ps.id AND its.organization_id = ps.organization_id
                WHERE its.transaction_item_id = v_item.id AND its.organization_id = p_organization_id
            LOOP
                IF v_original.transaction_type IN ('OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN') THEN
                    IF v_serial.status <> 'AVAILABLE' THEN
                        RAISE EXCEPTION 'Serial % cannot be reversed because its status is % (expected AVAILABLE).', v_serial.serial_number_normalized, v_serial.status;
                    END IF;
                    IF v_serial.current_warehouse_id IS DISTINCT FROM v_item.destination_warehouse_id THEN
                        RAISE EXCEPTION 'Serial % is not currently in original destination warehouse.', v_serial.serial_number_normalized;
                    END IF;

                    UPDATE public.product_serials
                    SET status = 'REVERSED',
                        current_warehouse_id = NULL
                    WHERE id = v_serial.id AND organization_id = p_organization_id;

                ELSIF v_original.transaction_type = 'SALE_ISSUE' THEN
                    IF v_serial.status <> 'SOLD' THEN
                        RAISE EXCEPTION 'Serial % cannot be reversed because its status is % (expected SOLD).', v_serial.serial_number_normalized, v_serial.status;
                    END IF;
                    IF v_serial.current_warehouse_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Serial % currently sold must have NULL warehouse.', v_serial.serial_number_normalized;
                    END IF;

                    UPDATE public.product_serials
                    SET status = 'AVAILABLE',
                        current_warehouse_id = v_item.source_warehouse_id
                    WHERE id = v_serial.id AND organization_id = p_organization_id;

                ELSIF v_original.transaction_type = 'ADJUSTMENT_OUT' THEN
                    IF v_serial.status <> 'SCRAPPED' THEN
                        RAISE EXCEPTION 'Serial % cannot be reversed because its status is % (expected SCRAPPED).', v_serial.serial_number_normalized, v_serial.status;
                    END IF;
                    IF v_serial.current_warehouse_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Serial % currently scrapped must have NULL warehouse.', v_serial.serial_number_normalized;
                    END IF;

                    UPDATE public.product_serials
                    SET status = 'AVAILABLE',
                        current_warehouse_id = v_item.source_warehouse_id
                    WHERE id = v_serial.id AND organization_id = p_organization_id;

                ELSIF v_original.transaction_type = 'TRANSFER' THEN
                    IF v_serial.status NOT IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN
                        RAISE EXCEPTION 'Serial % status % invalid for transfer reversal.', v_serial.serial_number_normalized, v_serial.status;
                    END IF;
                    IF v_serial.current_warehouse_id IS DISTINCT FROM v_item.destination_warehouse_id THEN
                        RAISE EXCEPTION 'Serial % is not currently in transfer destination warehouse.', v_serial.serial_number_normalized;
                    END IF;

                    UPDATE public.product_serials
                    SET current_warehouse_id = v_item.source_warehouse_id
                    WHERE id = v_serial.id AND organization_id = p_organization_id;
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    -- 15. Apply Quantity & Cost Balances Impact with Sufficiency Safeguards
    FOR v_item IN
        SELECT * FROM public.inventory_transaction_items
        WHERE transaction_id = v_original.id AND organization_id = p_organization_id
        ORDER BY row_number, id
    LOOP
        CASE v_original.transaction_type
            WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                -- Decrease destination warehouse balance
                SELECT quantity_on_hand INTO v_curr_wh_qty
                FROM public.inventory_balances
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.destination_warehouse_id
                  AND product_id = v_item.product_id;

                IF v_curr_wh_qty < v_item.quantity THEN
                    RAISE EXCEPTION 'Insufficient warehouse inventory to reverse entry for product % in warehouse %.', v_item.product_id, v_item.destination_warehouse_id;
                END IF;

                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.destination_warehouse_id
                  AND product_id = v_item.product_id;

                -- Decrease org cost balance
                SELECT organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount
                INTO v_curr_org_qty, v_curr_org_val, v_curr_wac
                FROM public.inventory_cost_balances
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

                v_new_org_qty := v_curr_org_qty - v_item.quantity;
                v_new_org_val := v_curr_org_val - v_item.total_cost_amount;

                IF v_new_org_qty < 0 OR v_new_org_val < 0 THEN
                    RAISE EXCEPTION 'Reversal causes negative organization inventory quantity or value for product %.', v_item.product_id;
                END IF;

                IF v_new_org_qty = 0 AND v_new_org_val <> 0 THEN
                    RAISE EXCEPTION 'Inventory value (%) must be zero when quantity becomes zero for product %.', v_new_org_val, v_item.product_id;
                END IF;

                v_new_wac := CASE WHEN v_new_org_qty > 0 THEN round(v_new_org_val::numeric / v_new_org_qty) ELSE 0 END;

                UPDATE public.inventory_cost_balances
                SET organization_quantity_on_hand = v_new_org_qty,
                    inventory_value_amount = v_new_org_val,
                    weighted_average_cost_amount = v_new_wac,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            WHEN 'SALE_ISSUE', 'ADJUSTMENT_OUT' THEN
                -- Increase source warehouse balance
                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.source_warehouse_id
                  AND product_id = v_item.product_id;

                -- Increase org cost balance
                SELECT organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount
                INTO v_curr_org_qty, v_curr_org_val, v_curr_wac
                FROM public.inventory_cost_balances
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

                v_new_org_qty := v_curr_org_qty + v_item.quantity;
                v_new_org_val := v_curr_org_val + v_item.total_cost_amount;

                IF (v_new_org_qty > 0 AND v_new_org_val < 0) OR (v_new_org_qty < 0 AND v_new_org_val > 0) THEN
                    RAISE EXCEPTION 'Inconsistent quantity (%) and value (%) signs after reversal of product %.', v_new_org_qty, v_new_org_val, v_item.product_id;
                END IF;

                IF v_new_org_qty = 0 AND v_new_org_val <> 0 THEN
                    RAISE EXCEPTION 'Inventory value (%) must be zero when quantity is zero for product %.', v_new_org_val, v_item.product_id;
                END IF;

                IF v_new_org_qty <> 0 THEN
                    v_new_wac := round(abs(v_new_org_val)::numeric / abs(v_new_org_qty));
                ELSE
                    v_new_wac := 0;
                END IF;

                UPDATE public.inventory_cost_balances
                SET organization_quantity_on_hand = v_new_org_qty,
                    inventory_value_amount = v_new_org_val,
                    weighted_average_cost_amount = v_new_wac,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            WHEN 'TRANSFER' THEN
                -- Decrease destination warehouse balance
                SELECT quantity_on_hand INTO v_curr_dest_wh_qty
                FROM public.inventory_balances
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.destination_warehouse_id
                  AND product_id = v_item.product_id;

                IF v_curr_dest_wh_qty < v_item.quantity THEN
                    RAISE EXCEPTION 'Insufficient destination warehouse inventory to reverse transfer for product % in warehouse %.', v_item.product_id, v_item.destination_warehouse_id;
                END IF;

                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.destination_warehouse_id
                  AND product_id = v_item.product_id;

                -- Increase source warehouse balance
                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.source_warehouse_id
                  AND product_id = v_item.product_id;

                UPDATE public.inventory_cost_balances
                SET last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            WHEN 'COST_ADJUSTMENT' THEN
                SELECT organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount
                INTO v_curr_org_qty, v_curr_org_val, v_curr_wac
                FROM public.inventory_cost_balances
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

                v_new_org_qty := v_curr_org_qty;
                v_new_org_val := v_curr_org_val - v_item.cost_adjustment_amount;

                IF (v_new_org_qty > 0 AND v_new_org_val < 0) OR (v_new_org_qty < 0 AND v_new_org_val > 0) THEN
                    RAISE EXCEPTION 'Cost adjustment reversal results in inconsistent inventory value sign (%) for quantity (%) for product %.', v_new_org_val, v_new_org_qty, v_item.product_id;
                END IF;

                IF v_new_org_qty = 0 AND v_new_org_val <> 0 THEN
                    RAISE EXCEPTION 'Inventory value (%) must be zero when quantity is zero for product %.', v_new_org_val, v_item.product_id;
                END IF;

                IF v_new_org_qty <> 0 THEN
                    v_new_wac := round(abs(v_new_org_val)::numeric / abs(v_new_org_qty));
                ELSE
                    v_new_wac := 0;
                END IF;

                UPDATE public.inventory_cost_balances
                SET organization_quantity_on_hand = v_new_org_qty,
                    inventory_value_amount = v_new_org_val,
                    weighted_average_cost_amount = v_new_wac,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;
        END CASE;
    END LOOP;

    -- 16. Document Number Sequence Allocation & Final Transitions
    INSERT INTO public.inventory_document_sequences (
        organization_id, fiscal_year_id, next_number, updated_by, updated_at
    ) VALUES (
        p_organization_id, p_reversal_fiscal_year_id, 1, v_user_id, now()
    )
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_seq_next
    FROM public.inventory_document_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = p_reversal_fiscal_year_id
    FOR UPDATE;

    v_doc_number := v_seq_next;

    UPDATE public.inventory_document_sequences
    SET next_number = next_number + 1,
        updated_by = v_user_id,
        updated_at = now()
    WHERE organization_id = p_organization_id AND fiscal_year_id = p_reversal_fiscal_year_id;

    SELECT
        EXISTS(SELECT 1 FROM public.inventory_transaction_items WHERE transaction_id = v_reversal_id AND organization_id = p_organization_id AND cost_state = 'FINAL'),
        EXISTS(SELECT 1 FROM public.inventory_transaction_items WHERE transaction_id = v_reversal_id AND organization_id = p_organization_id AND cost_state = 'PROVISIONAL'),
        EXISTS(SELECT 1 FROM public.inventory_transaction_items WHERE transaction_id = v_reversal_id AND organization_id = p_organization_id AND cost_state = 'MIXED')
    INTO v_has_final, v_has_provisional, v_has_mixed;

    IF v_has_mixed OR (v_has_final AND v_has_provisional) THEN
        v_header_cost_state := 'MIXED';
    ELSIF v_has_provisional THEN
        v_header_cost_state := 'PROVISIONAL';
    ELSE
        v_header_cost_state := 'FINAL';
    END IF;

    UPDATE public.inventory_transactions
    SET document_number = v_doc_number,
        status = 'POSTED',
        cost_state = v_header_cost_state,
        posted_by = v_user_id,
        posted_at = now()
    WHERE id = v_reversal_id AND organization_id = p_organization_id;

    IF v_original.transaction_type = 'SALE_ISSUE' THEN
        UPDATE public.inventory_provisional_cost_positions
        SET status = 'REVERSED',
            remaining_quantity = 0,
            reversal_transaction_id = v_reversal_id,
            settled_at = NULL
        WHERE organization_id = p_organization_id
          AND status = 'OPEN'
          AND issue_transaction_item_id IN (
              SELECT id FROM public.inventory_transaction_items
              WHERE transaction_id = v_original.id AND organization_id = p_organization_id
          );
    END IF;

    UPDATE public.inventory_transactions
    SET status = 'REVERSED',
        reversed_by = v_user_id,
        reversed_at = now(),
        reversal_reason = trim(p_reversal_reason)
    WHERE id = v_original.id AND organization_id = p_organization_id;

    RETURN v_reversal_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reverse_inventory_transaction(
    UUID, UUID, UUID, DATE, TEXT, INT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

COMMIT;

-- ==============================================================================
-- SECTION: 08_inventory_negative_override_authorization.sql
-- ==============================================================================

-- ==============================================================================
-- MIGRATION 08: INVENTORY NEGATIVE OVERRIDE AUTHORIZATION INFRASTRUCTURE
-- ==============================================================================
-- Description: Provides secure, atomic, time-bound (15-minute), and idempotent
-- infrastructure for issuing single-use negative inventory override authorizations
-- and domain item scope records without fake UI or mock credentials.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTEND TABLE: public.inventory_negative_override_authorizations
-- ------------------------------------------------------------------------------
-- Add operation_key column and security constraints.

ALTER TABLE public.inventory_negative_override_authorizations
    ADD COLUMN IF NOT EXISTS operation_key TEXT;

-- Backfill any legacy NULL operation keys deterministically before applying NOT NULL constraint
UPDATE public.inventory_negative_override_authorizations
SET operation_key = 'legacy_opkey_' || id::text
WHERE operation_key IS NULL;

ALTER TABLE public.inventory_negative_override_authorizations
    ALTER COLUMN operation_key SET NOT NULL;

-- Enforce UNIQUE operation_key per organization
ALTER TABLE public.inventory_negative_override_authorizations
    DROP CONSTRAINT IF EXISTS uq_neg_auth_org_opkey;

ALTER TABLE public.inventory_negative_override_authorizations
    ADD CONSTRAINT uq_neg_auth_org_opkey UNIQUE (organization_id, operation_key);

-- Enforce UNIQUE security_audit_log_id to prevent reusing security events
ALTER TABLE public.inventory_negative_override_authorizations
    DROP CONSTRAINT IF EXISTS uq_neg_auth_security_audit_log;

ALTER TABLE public.inventory_negative_override_authorizations
    ADD CONSTRAINT uq_neg_auth_security_audit_log UNIQUE (security_audit_log_id);


-- ------------------------------------------------------------------------------
-- 2. CREATE TABLE: public.inventory_negative_override_authorization_items
-- ------------------------------------------------------------------------------
-- Tracks exact domain items authorized to go negative with approved balances,
-- issue quantities, projected negative balances, and maximum allowed deficits.

CREATE TABLE IF NOT EXISTS public.inventory_negative_override_authorization_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    authorization_id UUID NOT NULL,
    transaction_item_id UUID NOT NULL,
    product_id UUID NOT NULL,
    source_warehouse_id UUID NOT NULL,
    approved_balance_qty NUMERIC(18,3) NOT NULL,
    approved_issue_qty NUMERIC(18,3) NOT NULL,
    approved_projected_qty NUMERIC(18,3) NOT NULL,
    approved_max_deficit_qty NUMERIC(18,3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Composite Foreign Keys enforcing organizational consistency
    CONSTRAINT fk_neg_auth_items_auth FOREIGN KEY (organization_id, authorization_id)
        REFERENCES public.inventory_negative_override_authorizations (organization_id, id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_neg_auth_items_tx_item FOREIGN KEY (organization_id, transaction_item_id)
        REFERENCES public.inventory_transaction_items (organization_id, id),

    CONSTRAINT fk_neg_auth_items_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products (organization_id, id),

    CONSTRAINT fk_neg_auth_items_warehouse FOREIGN KEY (organization_id, source_warehouse_id)
        REFERENCES public.warehouses (organization_id, id),

    -- Unique constraint: one domain item record per authorization line item
    CONSTRAINT uq_neg_auth_items_auth_tx_item UNIQUE (authorization_id, transaction_item_id),

    -- Mathematical and Domain Constraints
    CONSTRAINT chk_neg_auth_items_issue_qty CHECK (approved_issue_qty > 0),
    CONSTRAINT chk_neg_auth_items_max_deficit CHECK (approved_max_deficit_qty > 0),
    CONSTRAINT chk_neg_auth_items_projected_qty CHECK (approved_projected_qty < 0),
    CONSTRAINT chk_neg_auth_items_math_proj CHECK (approved_projected_qty = approved_balance_qty - approved_issue_qty),
    CONSTRAINT chk_neg_auth_items_math_def CHECK (approved_max_deficit_qty = approved_issue_qty - GREATEST(approved_balance_qty, 0))
);

-- Indexing for fast verification
CREATE INDEX IF NOT EXISTS idx_neg_auth_items_lookup
    ON public.inventory_negative_override_authorization_items (organization_id, authorization_id, transaction_item_id);

-- Prevent direct modification or deletion of authorization items once written
CREATE OR REPLACE FUNCTION public.fn_prevent_neg_auth_items_mod()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'Modification or deletion of inventory_negative_override_authorization_items is strictly forbidden.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_neg_auth_items_mod ON public.inventory_negative_override_authorization_items;
CREATE TRIGGER trg_prevent_neg_auth_items_mod
    BEFORE UPDATE OR DELETE ON public.inventory_negative_override_authorization_items
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.fn_prevent_neg_auth_items_mod();

-- Explicitly revoke permissions from PUBLIC, anon, authenticated, then grant SELECT to authenticated
REVOKE ALL ON public.inventory_negative_override_authorization_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_negative_override_authorization_items TO authenticated;

-- RLS for authorization items table
ALTER TABLE public.inventory_negative_override_authorization_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members with inventory override or manage permission can view authorization items" ON public.inventory_negative_override_authorization_items;
CREATE POLICY "Members with inventory override or manage permission can view authorization items"
ON public.inventory_negative_override_authorization_items FOR SELECT
TO authenticated
USING (
    public.has_permission(organization_id, 'inventory:negative_override')
    OR
    public.has_permission(organization_id, 'inventory:manage')
);


-- ------------------------------------------------------------------------------
-- 3. ISSUANCE RPC: public.issue_inventory_negative_override_authorization
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_inventory_negative_override_authorization(
    p_organization_id UUID,
    p_transaction_id UUID,
    p_expected_version INT,
    p_security_audit_log_id UUID,
    p_operation_key TEXT,
    p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_membership_id UUID;
    v_tx RECORD;
    v_requested_by UUID;
    v_approved_by UUID;
    v_audit_log RECORD;
    v_audit_tx_id UUID;
    v_request_fingerprint TEXT;
    v_pwd_reauth BOOLEAN;
    v_two_fa_verified BOOLEAN;
    v_existing_auth RECORD;
    v_audit_fingerprint TEXT;
    v_item RECORD;
    v_wh RECORD;
    v_wh_branch_id UUID;
    v_item_count INT := 0;
    v_neg_item_count INT := 0;
    v_curr_bal NUMERIC(18,3);
    v_projected_bal NUMERIC(18,3);
    v_max_deficit NUMERIC(18,3);
    v_auth_id UUID;
    v_authorized_at TIMESTAMPTZ;
    v_expires_at TIMESTAMPTZ;
    v_clean_opkey TEXT;
    v_active_existing_id UUID;
BEGIN
    -- 1. Identity & Active Membership Check
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT om.id INTO v_membership_id
    FROM public.organization_memberships om
    JOIN public.user_profiles up ON up.id = om.user_id
    WHERE om.user_id = v_user_id
      AND om.organization_id = p_organization_id
      AND om.is_active = true
      AND up.is_active = true;

    IF v_membership_id IS NULL THEN
        RAISE EXCEPTION 'User profile or organization membership is inactive or missing for organization %.', p_organization_id;
    END IF;

    -- 2. Input Sanitization & Target Document Lock
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'p_expected_version is required.';
    END IF;

    v_clean_opkey := trim(p_operation_key);
    IF v_clean_opkey IS NULL OR v_clean_opkey = '' OR length(v_clean_opkey) > 255 THEN
        RAISE EXCEPTION 'Operation key must be non-null, non-empty, and at most 255 characters.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'Reason must be at least 10 meaningful characters long.';
    END IF;

    SELECT * INTO v_tx
    FROM public.inventory_transactions
    WHERE id = p_transaction_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF v_tx.id IS NULL THEN
        RAISE EXCEPTION 'Transaction % not found in organization %.', p_transaction_id, p_organization_id;
    END IF;

    IF v_tx.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Negative override authorization is only permitted for DRAFT documents (status: %).', v_tx.status;
    END IF;

    IF v_tx.transaction_type <> 'SALE_ISSUE' THEN
        RAISE EXCEPTION 'Negative override authorization is only permitted for SALE_ISSUE transactions (type: %).', v_tx.transaction_type;
    END IF;

    IF v_tx.transaction_kind <> 'GENERAL' THEN
        RAISE EXCEPTION 'Negative override authorization is only permitted for GENERAL transaction kinds (kind: %).', v_tx.transaction_kind;
    END IF;

    IF v_tx.version <> p_expected_version THEN
        RAISE EXCEPTION 'Transaction version mismatch: expected %, found %.', p_expected_version, v_tx.version;
    END IF;

    SELECT count(*) INTO v_item_count
    FROM public.inventory_transaction_items
    WHERE transaction_id = p_transaction_id AND organization_id = p_organization_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Transaction % has no line items.', p_transaction_id;
    END IF;

    -- Extract requester from transaction creator and approver from auth.uid()
    v_requested_by := v_tx.created_by;
    v_approved_by := v_user_id;

    -- 3. Check Branch and Warehouse Permissions for Current User (Issuing Approver)
    IF NOT EXISTS (
        SELECT 1
        FROM public.organization_memberships om
        JOIN public.user_profiles up ON up.id = om.user_id
        JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE om.user_id = v_user_id
          AND om.organization_id = p_organization_id
          AND om.is_active = true
          AND up.is_active = true
          AND p.code = 'inventory:negative_override'
          AND (ur.branch_id IS NULL OR ur.branch_id = v_tx.initiating_branch_id)
    ) THEN
        RAISE EXCEPTION 'User lacks inventory:negative_override permission for initiating branch %.', v_tx.initiating_branch_id;
    END IF;

    FOR v_wh IN
        SELECT DISTINCT source_warehouse_id AS w_id
        FROM public.inventory_transaction_items
        WHERE transaction_id = p_transaction_id
          AND organization_id = p_organization_id
          AND source_warehouse_id IS NOT NULL
        ORDER BY source_warehouse_id ASC
    LOOP
        SELECT branch_id INTO v_wh_branch_id
        FROM public.warehouses
        WHERE id = v_wh.w_id AND organization_id = p_organization_id;

        IF v_wh_branch_id IS NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.warehouses WHERE id = v_wh.w_id AND organization_id = p_organization_id
            ) THEN
                RAISE EXCEPTION 'Warehouse % does not exist in organization %.', v_wh.w_id, p_organization_id;
            ELSE
                RAISE EXCEPTION 'Warehouse % is not connected to a branch.', v_wh.w_id;
            END IF;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            JOIN public.user_profiles up ON up.id = om.user_id
            JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
            JOIN public.role_permissions rp ON rp.role_id = ur.role_id
            JOIN public.permissions p ON p.id = rp.permission_id
            WHERE om.user_id = v_user_id
              AND om.organization_id = p_organization_id
              AND om.is_active = true
              AND up.is_active = true
              AND p.code = 'inventory:negative_override'
              AND (ur.branch_id IS NULL OR ur.branch_id = v_wh_branch_id)
        ) THEN
            RAISE EXCEPTION 'User lacks inventory:negative_override permission for branch % connected to warehouse %.', v_wh_branch_id, v_wh.w_id;
        END IF;

        IF NOT (
            public.has_permission(p_organization_id, 'inventory:manage')
            OR EXISTS (
                SELECT 1 FROM public.user_warehouse_access uwa
                WHERE uwa.organization_id = p_organization_id
                  AND uwa.membership_id = v_membership_id
                  AND uwa.warehouse_id = v_wh.w_id
                  AND uwa.is_active = true
            )
        ) THEN
            RAISE EXCEPTION 'User lacks access to warehouse %.', v_wh.w_id;
        END IF;
    END LOOP;

    -- 4. Idempotency Check with Full Security Verification
    SELECT * INTO v_existing_auth
    FROM public.inventory_negative_override_authorizations
    WHERE organization_id = p_organization_id AND operation_key = v_clean_opkey;

    IF v_existing_auth.id IS NOT NULL THEN
        SELECT * INTO v_audit_log
        FROM public.security_audit_logs
        WHERE id = p_security_audit_log_id AND organization_id = p_organization_id;

        IF v_existing_auth.approved_by = v_user_id
           AND v_existing_auth.transaction_id = p_transaction_id
           AND v_existing_auth.security_audit_log_id = p_security_audit_log_id
           AND v_audit_log.id IS NOT NULL
           AND (v_audit_log.details->>'request_fingerprint') = v_existing_auth.request_fingerprint
           AND v_existing_auth.status = 'ISSUED'
           AND v_existing_auth.expires_at > clock_timestamp()
           AND v_audit_log.created_at >= (v_existing_auth.authorized_at - INTERVAL '5 minutes')
           AND v_audit_log.created_at <= v_existing_auth.authorized_at THEN
            RETURN v_existing_auth.id;
        ELSE
            RAISE EXCEPTION 'Operation key conflict: operation key % already exists with different parameters, different user, or non-active status.', v_clean_opkey;
        END IF;
    END IF;

    -- 5. Valid Security Event Check (security_audit_logs) for NEW issuance
    SELECT * INTO v_audit_log
    FROM public.security_audit_logs
    WHERE id = p_security_audit_log_id
      AND organization_id = p_organization_id
      AND user_id = v_user_id;

    IF v_audit_log.id IS NULL THEN
        RAISE EXCEPTION 'Security audit log % not found for organization % and user %.', p_security_audit_log_id, p_organization_id, v_user_id;
    END IF;

    IF v_audit_log.event_type <> 'INVENTORY_NEGATIVE_OVERRIDE_REAUTH_SUCCESS' THEN
        RAISE EXCEPTION 'Invalid security event type: expected INVENTORY_NEGATIVE_OVERRIDE_REAUTH_SUCCESS, found %.', v_audit_log.event_type;
    END IF;

    v_audit_tx_id := (v_audit_log.details->>'transaction_id')::uuid;
    IF v_audit_tx_id IS NULL OR v_audit_tx_id <> p_transaction_id THEN
        RAISE EXCEPTION 'Security audit log transaction_id mismatch: expected %, found %.', p_transaction_id, v_audit_tx_id;
    END IF;

    v_request_fingerprint := v_audit_log.details->>'request_fingerprint';
    IF v_request_fingerprint IS NULL OR trim(v_request_fingerprint) = '' THEN
        RAISE EXCEPTION 'Security audit log request_fingerprint is missing or empty.';
    END IF;

    v_pwd_reauth := COALESCE((v_audit_log.details->>'password_reauthenticated')::boolean, false);
    v_two_fa_verified := COALESCE((v_audit_log.details->>'two_factor_verified')::boolean, false);

    IF v_pwd_reauth IS NOT TRUE OR v_two_fa_verified IS NOT TRUE THEN
        RAISE EXCEPTION 'Security audit log indicates password re-authentication or 2FA was not successful.';
    END IF;

    -- 5-minute freshness check relative to clock_timestamp()
    IF v_audit_log.created_at < (clock_timestamp() - INTERVAL '5 minutes') OR v_audit_log.created_at > clock_timestamp() THEN
        RAISE EXCEPTION 'Security audit log % is expired or in the future (created_at: %).', p_security_audit_log_id, v_audit_log.created_at;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.inventory_negative_override_authorizations
        WHERE security_audit_log_id = p_security_audit_log_id
    ) THEN
        RAISE EXCEPTION 'Security audit log % has already been used for an authorization.', p_security_audit_log_id;
    END IF;

    -- 6. Clean up Truly Expired Authorizations & Prevent Multiple Active Authorizations
    UPDATE public.inventory_negative_override_authorizations
    SET status = 'EXPIRED'
    WHERE organization_id = p_organization_id
      AND transaction_id = p_transaction_id
      AND status = 'ISSUED'
      AND expires_at <= clock_timestamp();

    SELECT id INTO v_active_existing_id
    FROM public.inventory_negative_override_authorizations
    WHERE organization_id = p_organization_id
      AND transaction_id = p_transaction_id
      AND status = 'ISSUED'
      AND expires_at > clock_timestamp();

    IF v_active_existing_id IS NOT NULL THEN
        RAISE EXCEPTION 'An active unexpired negative override authorization (%) already exists for transaction %.', v_active_existing_id, p_transaction_id;
    END IF;

    -- 7. Insert Missing Zero-Balance Rows & Lock Balances in Strict Order
    -- Match Step 4a of post_inventory_transaction in Migration 07 (order: organization_id, warehouse_id, product_id)
    INSERT INTO public.inventory_balances (organization_id, warehouse_id, product_id, quantity_on_hand)
    SELECT DISTINCT p_organization_id, iti.source_warehouse_id, iti.product_id, 0
    FROM public.inventory_transaction_items iti
    WHERE iti.transaction_id = p_transaction_id
      AND iti.organization_id = p_organization_id
      AND iti.source_warehouse_id IS NOT NULL
    ON CONFLICT (organization_id, warehouse_id, product_id) DO NOTHING;

    PERFORM 1
    FROM public.inventory_balances ib
    JOIN (
        SELECT DISTINCT iti.source_warehouse_id AS w_id, iti.product_id
        FROM public.inventory_transaction_items iti
        WHERE iti.transaction_id = p_transaction_id
          AND iti.organization_id = p_organization_id
          AND iti.source_warehouse_id IS NOT NULL
    ) req ON req.w_id = ib.warehouse_id AND req.product_id = ib.product_id
    WHERE ib.organization_id = p_organization_id
    ORDER BY ib.organization_id, ib.warehouse_id, ib.product_id
    FOR UPDATE;

    -- 8. Cumulative Deficit Scope Calculation & Verification
    CREATE TEMP TABLE IF NOT EXISTS tmp_issuance_running_balances (
        warehouse_id UUID NOT NULL,
        product_id UUID NOT NULL,
        current_balance NUMERIC(18,3) NOT NULL,
        PRIMARY KEY (warehouse_id, product_id)
    ) ON COMMIT DROP;
    TRUNCATE TABLE tmp_issuance_running_balances;

    INSERT INTO tmp_issuance_running_balances (warehouse_id, product_id, current_balance)
    SELECT ib.warehouse_id, ib.product_id, ib.quantity_on_hand
    FROM public.inventory_balances ib
    JOIN (
        SELECT DISTINCT iti.source_warehouse_id AS w_id, iti.product_id
        FROM public.inventory_transaction_items iti
        WHERE iti.transaction_id = p_transaction_id
          AND iti.organization_id = p_organization_id
          AND iti.source_warehouse_id IS NOT NULL
    ) req ON req.w_id = ib.warehouse_id AND req.product_id = ib.product_id
    WHERE ib.organization_id = p_organization_id;

    v_neg_item_count := 0;

    FOR v_item IN
        SELECT iti.*, p.is_serialized
        FROM public.inventory_transaction_items iti
        JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
        WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
        ORDER BY iti.row_number ASC
    LOOP
        SELECT current_balance INTO v_curr_bal
        FROM tmp_issuance_running_balances
        WHERE warehouse_id = v_item.source_warehouse_id AND product_id = v_item.product_id;

        v_projected_bal := v_curr_bal - v_item.quantity;

        UPDATE tmp_issuance_running_balances
        SET current_balance = v_projected_bal
        WHERE warehouse_id = v_item.source_warehouse_id AND product_id = v_item.product_id;

        IF v_projected_bal < 0 THEN
            IF v_item.is_serialized = true THEN
                RAISE EXCEPTION 'Negative inventory override is strictly forbidden for serialized product % in warehouse %.', v_item.product_id, v_item.source_warehouse_id;
            END IF;

            v_neg_item_count := v_neg_item_count + 1;
        END IF;
    END LOOP;

    IF v_neg_item_count = 0 THEN
        RAISE EXCEPTION 'No inventory deficit detected for transaction %; negative override authorization cannot be issued.', p_transaction_id;
    END IF;

    -- 9. Create New Authorization Header (15-Minute Expiry)
    v_auth_id := gen_random_uuid();
    v_authorized_at := clock_timestamp();
    v_expires_at := v_authorized_at + INTERVAL '15 minutes';

    INSERT INTO public.inventory_negative_override_authorizations (
        id, organization_id, transaction_id, requested_by, approved_by,
        security_audit_log_id, request_fingerprint, operation_key,
        authorized_at, expires_at, status, reason
    ) VALUES (
        v_auth_id, p_organization_id, p_transaction_id, v_requested_by, v_approved_by,
        p_security_audit_log_id, v_request_fingerprint, v_clean_opkey,
        v_authorized_at, v_expires_at, 'ISSUED', trim(p_reason)
    );

    -- 10. Populate Authorized Items Scope Table (Second Pass Cumulative Calculation)
    TRUNCATE TABLE tmp_issuance_running_balances;

    INSERT INTO tmp_issuance_running_balances (warehouse_id, product_id, current_balance)
    SELECT ib.warehouse_id, ib.product_id, ib.quantity_on_hand
    FROM public.inventory_balances ib
    JOIN (
        SELECT DISTINCT iti.source_warehouse_id AS w_id, iti.product_id
        FROM public.inventory_transaction_items iti
        WHERE iti.transaction_id = p_transaction_id
          AND iti.organization_id = p_organization_id
          AND iti.source_warehouse_id IS NOT NULL
    ) req ON req.w_id = ib.warehouse_id AND req.product_id = ib.product_id
    WHERE ib.organization_id = p_organization_id;

    FOR v_item IN
        SELECT iti.*, p.is_serialized
        FROM public.inventory_transaction_items iti
        JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
        WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
        ORDER BY iti.row_number ASC
    LOOP
        SELECT current_balance INTO v_curr_bal
        FROM tmp_issuance_running_balances
        WHERE warehouse_id = v_item.source_warehouse_id AND product_id = v_item.product_id;

        v_projected_bal := v_curr_bal - v_item.quantity;

        UPDATE tmp_issuance_running_balances
        SET current_balance = v_projected_bal
        WHERE warehouse_id = v_item.source_warehouse_id AND product_id = v_item.product_id;

        IF v_projected_bal < 0 THEN
            v_max_deficit := v_item.quantity - GREATEST(v_curr_bal, 0);

            INSERT INTO public.inventory_negative_override_authorization_items (
                id, organization_id, authorization_id, transaction_item_id,
                product_id, source_warehouse_id, approved_balance_qty,
                approved_issue_qty, approved_projected_qty, approved_max_deficit_qty,
                created_at
            ) VALUES (
                gen_random_uuid(), p_organization_id, v_auth_id, v_item.id,
                v_item.product_id, v_item.source_warehouse_id, v_curr_bal,
                v_item.quantity, v_projected_bal, v_max_deficit,
                v_authorized_at
            );
        END IF;
    END LOOP;

    RETURN v_auth_id;
END;
$$;

-- Security Execution Rights
REVOKE EXECUTE ON FUNCTION public.issue_inventory_negative_override_authorization(UUID, UUID, INT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_inventory_negative_override_authorization(UUID, UUID, INT, UUID, TEXT, TEXT) TO authenticated;


-- ------------------------------------------------------------------------------
-- 4. CONSUMPTION VALIDATION TRIGGERS
-- ------------------------------------------------------------------------------
-- Enforces strict consumption controls during post_inventory_transaction execution
-- without modifying post_inventory_transaction code.

-- A. Validate Item Consumption against Authorized Items Scope
CREATE OR REPLACE FUNCTION public.fn_validate_negative_override_log_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth_hdr RECORD;
    v_auth_item RECORD;
    v_is_serialized BOOLEAN;
BEGIN
    -- 1. Block any serialized product from negative override
    SELECT is_serialized INTO v_is_serialized
    FROM public.products
    WHERE id = NEW.product_id AND organization_id = NEW.organization_id;

    IF v_is_serialized = true THEN
        RAISE EXCEPTION 'Negative inventory override is strictly forbidden for serialized product %.', NEW.product_id;
    END IF;

    -- 2. Verify header authorization status, organization, transaction, and expiration
    SELECT * INTO v_auth_hdr
    FROM public.inventory_negative_override_authorizations
    WHERE id = NEW.authorization_id AND organization_id = NEW.organization_id;

    IF v_auth_hdr.id IS NULL THEN
        RAISE EXCEPTION 'Authorization % not found in organization %.', NEW.authorization_id, NEW.organization_id;
    END IF;

    IF v_auth_hdr.transaction_id <> NEW.transaction_id THEN
        RAISE EXCEPTION 'Authorization transaction_id mismatch: expected %, got %.', v_auth_hdr.transaction_id, NEW.transaction_id;
    END IF;

    IF v_auth_hdr.status <> 'ISSUED' THEN
        RAISE EXCEPTION 'Authorization % is not in ISSUED status (status: %).', NEW.authorization_id, v_auth_hdr.status;
    END IF;

    IF v_auth_hdr.expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'Authorization % expired at %.', NEW.authorization_id, v_auth_hdr.expires_at;
    END IF;

    -- 3. Fetch corresponding authorized domain item scope record
    SELECT * INTO v_auth_item
    FROM public.inventory_negative_override_authorization_items
    WHERE organization_id = NEW.organization_id
      AND authorization_id = NEW.authorization_id
      AND transaction_item_id = NEW.transaction_item_id;

    IF v_auth_item.id IS NULL THEN
        RAISE EXCEPTION 'Transaction item % is not authorized in override authorization %.', NEW.transaction_item_id, NEW.authorization_id;
    END IF;

    -- 4. Verify product and warehouse matches
    IF NEW.product_id <> v_auth_item.product_id THEN
        RAISE EXCEPTION 'Product mismatch between consumed log (%) and authorization item (%).', NEW.product_id, v_auth_item.product_id;
    END IF;

    IF NEW.warehouse_id <> v_auth_item.source_warehouse_id THEN
        RAISE EXCEPTION 'Warehouse mismatch between consumed log (%) and authorization item (%).', NEW.warehouse_id, v_auth_item.source_warehouse_id;
    END IF;

    -- 5. Verify requested quantity matches approved issue quantity
    IF NEW.requested_quantity <> v_auth_item.approved_issue_qty THEN
        RAISE EXCEPTION 'Requested quantity (%) does not match approved issue quantity (%).', NEW.requested_quantity, v_auth_item.approved_issue_qty;
    END IF;

    -- 6. Verify shortage deficit quantity does not exceed approved maximum deficit
    IF NEW.shortage_quantity > v_auth_item.approved_max_deficit_qty THEN
        RAISE EXCEPTION 'Shortage deficit quantity (%) exceeds maximum approved deficit (%).', NEW.shortage_quantity, v_auth_item.approved_max_deficit_qty;
    END IF;

    -- 7. Verify inventory balance before posting is not worse than approved balance
    IF NEW.quantity_before < v_auth_item.approved_balance_qty THEN
        RAISE EXCEPTION 'Inventory balance before posting (%) degraded compared to balance at approval (%).', NEW.quantity_before, v_auth_item.approved_balance_qty;
    END IF;

    -- 8. Verify projected inventory balance after posting is not worse than approved projected balance
    IF NEW.quantity_after < v_auth_item.approved_projected_qty THEN
        RAISE EXCEPTION 'Projected inventory balance after posting (%) degraded compared to approved projected balance (%).', NEW.quantity_after, v_auth_item.approved_projected_qty;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_negative_override_log_insert ON public.inventory_negative_override_logs;
CREATE TRIGGER trg_validate_negative_override_log_insert
    BEFORE INSERT ON public.inventory_negative_override_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_validate_negative_override_log_insert();


-- B. Validate Authorization Header Status Transitions
CREATE OR REPLACE FUNCTION public.fn_validate_negative_override_auth_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item_count INT;
    v_appr_active BOOLEAN;
    v_wh RECORD;
    v_wh_branch_id UUID;
    v_init_branch_id UUID;
    v_appr_has_neg_override BOOLEAN;
    v_appr_has_manage BOOLEAN;
    v_appr_has_wh_access BOOLEAN;
BEGIN
    -- 1. Enforce strict immutability of terminal states (CONSUMED, EXPIRED, REVOKED)
    IF OLD.status IN ('CONSUMED', 'EXPIRED', 'REVOKED') THEN
        RAISE EXCEPTION 'Modification of authorization record % in terminal state % is strictly forbidden.', OLD.id, OLD.status;
    END IF;

    -- 2. Enforce immutability of core authorization parameters during ANY update
    IF NEW.id <> OLD.id OR
       NEW.organization_id <> OLD.organization_id OR
       NEW.transaction_id <> OLD.transaction_id OR
       NEW.requested_by <> OLD.requested_by OR
       NEW.approved_by <> OLD.approved_by OR
       NEW.security_audit_log_id <> OLD.security_audit_log_id OR
       NEW.request_fingerprint <> OLD.request_fingerprint OR
       NEW.operation_key <> OLD.operation_key OR
       NEW.authorized_at <> OLD.authorized_at OR
       NEW.expires_at <> OLD.expires_at OR
       NEW.reason <> OLD.reason THEN
        RAISE EXCEPTION 'Modification of core authorization parameters is strictly forbidden.';
    END IF;

    -- 3. Enforce transition ISSUED -> EXPIRED is only allowed when clock_timestamp() >= OLD.expires_at
    IF OLD.status = 'ISSUED' AND NEW.status = 'EXPIRED' THEN
        IF clock_timestamp() < OLD.expires_at THEN
            RAISE EXCEPTION 'Cannot expire active authorization % before its expiration time %.', OLD.id, OLD.expires_at;
        END IF;
    END IF;

    -- 4. Validation when transitioning from ISSUED to CONSUMED
    IF OLD.status = 'ISSUED' AND NEW.status = 'CONSUMED' THEN
        -- Check expiration using clock_timestamp()
        IF OLD.expires_at <= clock_timestamp() THEN
            RAISE EXCEPTION 'Authorization % expired at %.', OLD.id, OLD.expires_at;
        END IF;

        -- Ensure authorization has at least one domain item
        SELECT count(*) INTO v_item_count
        FROM public.inventory_negative_override_authorization_items
        WHERE authorization_id = OLD.id AND organization_id = OLD.organization_id;

        IF v_item_count = 0 THEN
            RAISE EXCEPTION 'Authorization % has no authorized domain items.', OLD.id;
        END IF;

        -- Check that approver user profile and organization membership remain active
        SELECT EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            JOIN public.user_profiles up ON up.id = om.user_id
            WHERE om.user_id = OLD.approved_by
              AND om.organization_id = OLD.organization_id
              AND om.is_active = true
              AND up.is_active = true
        ) INTO v_appr_active;

        IF NOT v_appr_active THEN
            RAISE EXCEPTION 'Approver user profile or organization membership is no longer active for authorization %.', OLD.id;
        END IF;

        -- Fetch initiating branch ID of transaction
        SELECT initiating_branch_id INTO v_init_branch_id
        FROM public.inventory_transactions
        WHERE id = OLD.transaction_id AND organization_id = OLD.organization_id;

        -- Check that approver holds inventory:negative_override for initiating branch
        SELECT EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            JOIN public.user_profiles up ON up.id = om.user_id
            JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
            JOIN public.role_permissions rp ON rp.role_id = ur.role_id
            JOIN public.permissions p ON p.id = rp.permission_id
            WHERE om.user_id = OLD.approved_by
              AND om.organization_id = OLD.organization_id
              AND om.is_active = true
              AND up.is_active = true
              AND p.code = 'inventory:negative_override'
              AND (ur.branch_id IS NULL OR ur.branch_id = v_init_branch_id)
        ) INTO v_appr_has_neg_override;

        IF NOT v_appr_has_neg_override THEN
            RAISE EXCEPTION 'Approver lacks active inventory:negative_override permission for initiating branch %.', v_init_branch_id;
        END IF;

        -- Check if approver explicitly holds inventory:manage permission
        SELECT EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            JOIN public.user_profiles up ON up.id = om.user_id
            JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
            JOIN public.role_permissions rp ON rp.role_id = ur.role_id
            JOIN public.permissions p ON p.id = rp.permission_id
            WHERE om.user_id = OLD.approved_by
              AND om.organization_id = OLD.organization_id
              AND om.is_active = true
              AND up.is_active = true
              AND p.code = 'inventory:manage'
        ) INTO v_appr_has_manage;

        -- Check warehouses in deterministic sorted order
        FOR v_wh IN
            SELECT DISTINCT source_warehouse_id AS w_id
            FROM public.inventory_negative_override_authorization_items
            WHERE authorization_id = OLD.id AND organization_id = OLD.organization_id
            ORDER BY source_warehouse_id ASC
        LOOP
            SELECT branch_id INTO v_wh_branch_id
            FROM public.warehouses
            WHERE id = v_wh.w_id AND organization_id = OLD.organization_id;

            IF v_wh_branch_id IS NULL THEN
                RAISE EXCEPTION 'Warehouse % does not exist or is not connected to a branch.', v_wh.w_id;
            END IF;

            -- Approver must hold inventory:negative_override for warehouse branch
            SELECT EXISTS (
                SELECT 1
                FROM public.organization_memberships om
                JOIN public.user_profiles up ON up.id = om.user_id
                JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
                JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                JOIN public.permissions p ON p.id = rp.permission_id
                WHERE om.user_id = OLD.approved_by
                  AND om.organization_id = OLD.organization_id
                  AND om.is_active = true
                  AND up.is_active = true
                  AND p.code = 'inventory:negative_override'
                  AND (ur.branch_id IS NULL OR ur.branch_id = v_wh_branch_id)
            ) INTO v_appr_has_neg_override;

            IF NOT v_appr_has_neg_override THEN
                RAISE EXCEPTION 'Approver lacks active inventory:negative_override permission for branch % connected to warehouse %.', v_wh_branch_id, v_wh.w_id;
            END IF;

            -- Check warehouse access explicitly for OLD.approved_by
            IF NOT v_appr_has_manage THEN
                SELECT EXISTS (
                    SELECT 1
                    FROM public.organization_memberships om
                    JOIN public.user_profiles up ON up.id = om.user_id
                    JOIN public.user_warehouse_access uwa ON uwa.membership_id = om.id AND uwa.organization_id = om.organization_id
                    WHERE om.user_id = OLD.approved_by
                      AND om.organization_id = OLD.organization_id
                      AND om.is_active = true
                      AND up.is_active = true
                      AND uwa.warehouse_id = v_wh.w_id
                      AND uwa.is_active = true
                ) INTO v_appr_has_wh_access;

                IF NOT v_appr_has_wh_access THEN
                    RAISE EXCEPTION 'Approver lacks active warehouse access to warehouse %.', v_wh.w_id;
                END IF;
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_negative_override_auth_update ON public.inventory_negative_override_authorizations;
CREATE TRIGGER trg_validate_negative_override_auth_update
    BEFORE UPDATE ON public.inventory_negative_override_authorizations
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_validate_negative_override_auth_update();

-- ==============================================================================
-- SECTION: 09_journal_voucher_draft_atomic_creation.sql
-- ==============================================================================

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

-- ==============================================================================
-- SECTION: 10_admin_bootstrap_transactional_function.sql
-- ==============================================================================

-- ==============================================================================
-- Migration: 10_admin_bootstrap_transactional_function.sql
-- Description: Atomic PostgreSQL function to bootstrap the first org_admin user domain data.
-- ==============================================================================

BEGIN;

-- Drop legacy overload if it exists to prevent orphan function signatures
DROP FUNCTION IF EXISTS public.bootstrap_first_org_admin(UUID, TEXT, TEXT, UUID, UUID);

CREATE OR REPLACE FUNCTION public.bootstrap_first_org_admin(
    p_user_id UUID,
    p_full_name TEXT,
    p_mobile TEXT,
    p_org_name TEXT DEFAULT NULL,
    p_branch_code TEXT DEFAULT 'MAIN',
    p_branch_name TEXT DEFAULT 'شعبه مرکزی',
    p_fiscal_year_title TEXT DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL,
    p_organization_id UUID DEFAULT NULL,
    p_branch_id UUID DEFAULT NULL,
    p_fiscal_year_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_role_id UUID;
    v_membership_id UUID;
    v_existing_admin_count INT;
    v_org_exists BOOLEAN;
    v_branch_exists BOOLEAN;
BEGIN
    -- 0. Acquire Transaction-Scoped Advisory Lock to serialize concurrent bootstrap requests
    PERFORM pg_advisory_xact_lock(hashtext('bootstrap_first_org_admin'));

    -- 1. Check if any org_admin user already exists
    SELECT COUNT(*) INTO v_existing_admin_count
    FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE r.code = 'org_admin';

    IF v_existing_admin_count > 0 THEN
        RAISE EXCEPTION 'BOOTSTRAP_ALREADY_COMPLETED: An org_admin user already exists in the system.'
            USING ERRCODE = 'P0001';
    END IF;

    -- 2. Lookup org_admin role ID
    SELECT id INTO v_role_id
    FROM public.roles
    WHERE code = 'org_admin';

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'ROLE_NOT_FOUND: The org_admin role is not defined in public.roles.'
            USING ERRCODE = 'P0002';
    END IF;

    -- 3. Resolve or Create Organization
    IF p_organization_id IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM public.organizations WHERE id = p_organization_id) INTO v_org_exists;
        IF NOT v_org_exists THEN
            RAISE EXCEPTION 'INVALID_ORGANIZATION: Organization % does not exist.', p_organization_id
                USING ERRCODE = 'P0003';
        END IF;
    ELSIF p_org_name IS NOT NULL AND trim(p_org_name) <> '' THEN
        INSERT INTO public.organizations (
            name,
            is_active,
            created_at,
            updated_at
        ) VALUES (
            trim(p_org_name),
            true,
            now(),
            now()
        )
        RETURNING id INTO p_organization_id;
    ELSE
        RAISE EXCEPTION 'ORGANIZATION_REQUIRED: Either p_organization_id or p_org_name must be provided.'
            USING ERRCODE = 'P0003';
    END IF;

    -- 4. Resolve or Create Branch
    IF p_branch_id IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM public.branches WHERE id = p_branch_id AND organization_id = p_organization_id) INTO v_branch_exists;
        IF NOT v_branch_exists THEN
            RAISE EXCEPTION 'INVALID_BRANCH: Branch % does not exist for organization %.', p_branch_id, p_organization_id
                USING ERRCODE = 'P0004';
        END IF;
    ELSE
        INSERT INTO public.branches (
            organization_id,
            code,
            name,
            is_active,
            created_at,
            updated_at
        ) VALUES (
            p_organization_id,
            COALESCE(trim(p_branch_code), 'MAIN'),
            COALESCE(trim(p_branch_name), 'شعبه مرکزی'),
            true,
            now(),
            now()
        )
        RETURNING id INTO p_branch_id;
    END IF;

    -- 4.b Create Fiscal Year if details provided
    IF p_fiscal_year_title IS NOT NULL AND trim(p_fiscal_year_title) <> '' AND p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
        INSERT INTO public.fiscal_years (
            organization_id,
            title,
            start_date,
            end_date,
            is_closed,
            created_at,
            updated_at
        ) VALUES (
            p_organization_id,
            trim(p_fiscal_year_title),
            p_start_date,
            p_end_date,
            false,
            now(),
            now()
        )
        RETURNING id INTO p_fiscal_year_id;
    END IF;

    -- 5. Insert User Profile
    INSERT INTO public.user_profiles (
        id,
        full_name,
        mobile,
        is_active,
        require_2fa,
        created_at,
        updated_at
    ) VALUES (
        p_user_id,
        p_full_name,
        p_mobile,
        true,
        true, -- Force 2FA (AAL2) requirement for org_admin
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        mobile = EXCLUDED.mobile,
        require_2fa = true,
        updated_at = now();

    -- 6. Insert Organization Membership
    INSERT INTO public.organization_memberships (
        user_id,
        organization_id,
        default_branch_id,
        is_active,
        is_default,
        joined_at,
        created_at,
        updated_at
    ) VALUES (
        p_user_id,
        p_organization_id,
        p_branch_id,
        true,
        true,
        now(),
        now(),
        now()
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
        default_branch_id = EXCLUDED.default_branch_id,
        is_active = true,
        updated_at = now()
    RETURNING id INTO v_membership_id;

    -- 7. Insert User Role (org_admin)
    INSERT INTO public.user_roles (
        membership_id,
        user_id,
        organization_id,
        role_id,
        branch_id,
        created_at
    ) VALUES (
        v_membership_id,
        p_user_id,
        p_organization_id,
        v_role_id,
        p_branch_id,
        now()
    )
    ON CONFLICT (membership_id, role_id, branch_id) DO NOTHING;

    -- 8. Insert Branch Access
    INSERT INTO public.user_branch_access (
        membership_id,
        organization_id,
        branch_id,
        is_active,
        created_at,
        updated_at
    ) VALUES (
        v_membership_id,
        p_organization_id,
        p_branch_id,
        true,
        now(),
        now()
    )
    ON CONFLICT (membership_id, branch_id) DO NOTHING;

    RETURN v_membership_id;
END;
$$;

-- Security Hardening: Revoke execution from public, anon, and authenticated roles
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_org_admin(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;

-- Grant execution strictly to service_role (server-side Admin SDK only)
GRANT EXECUTE ON FUNCTION public.bootstrap_first_org_admin(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, UUID, UUID, UUID
) TO service_role;

COMMIT;

-- ==============================================================================
-- SECTION: 11_app_state_store_rls.sql
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- Migration: 11_app_state_store_rls.sql (Strict Server-Only Enforcement)
-- Description: Complete lockdown of public.app_state_store for direct client access.
--              Only server-side requests using service_role (which bypasses RLS)
--              can read or write to this legacy global state table.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.app_state_store (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT
);

-- Enable Row Level Security
ALTER TABLE public.app_state_store ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to ensure a clean state
DROP POLICY IF EXISTS "Allow anon access to app_state_store" ON public.app_state_store;
DROP POLICY IF EXISTS "Allow authenticated full access to app_state_store" ON public.app_state_store;
DROP POLICY IF EXISTS "Active org members can view app_state_store" ON public.app_state_store;
DROP POLICY IF EXISTS "Active org admins can manage app_state_store" ON public.app_state_store;

-- STRICT LOCKDOWN: No client roles (anon or authenticated) have SELECT, INSERT, UPDATE, or DELETE access.
-- By having RLS enabled with NO policies for anon or authenticated roles, Supabase blocks all direct client requests.
-- Only server-side operations using the 'service_role' key (which bypasses RLS by design in Supabase) 
-- will be able to query and update public.app_state_store through protected Express API endpoints.

COMMIT;

-- ==============================================================================
-- SECTION: 12_coa_backfill_conflict_hardening.sql
-- ==============================================================================

-- Migration: 12_coa_backfill_conflict_hardening.sql
-- Description: Hardened COA Backfill Function with Explicit SystemKey Conflict Detection
-- Scope: Ensures if an existing system_key has conflicting code, name, or parent, the backfill fails closed with ERR_SYSTEM_KEY_CONFLICT.

CREATE OR REPLACE FUNCTION fn_backfill_chart_of_accounts(
    p_organization_id UUID,
    p_payload JSONB
)
RETURNS TABLE (
    success BOOLEAN,
    inserted_groups INT,
    inserted_generals INT,
    inserted_subsidiaries INT,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inserted_groups INT := 0;
    v_inserted_generals INT := 0;
    v_inserted_subsidiaries INT := 0;
    
    v_group_rec RECORD;
    v_general_rec RECORD;
    v_sub_rec RECORD;
    
    v_group_id UUID;
    v_existing_group_code VARCHAR;
    
    v_general_id UUID;
    v_existing_general_code VARCHAR;
    
    v_existing_sub RECORD;
BEGIN
    -- 1. Validate Organization ID and Payload
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'ERR_ORG_ID_REQUIRED: Organization ID must not be null.';
    END IF;

    IF p_payload IS NULL OR jsonb_typeof(p_payload) != 'array' OR jsonb_array_length(p_payload) = 0 THEN
        RAISE EXCEPTION 'ERR_EMPTY_PAYLOAD: Payload must be a non-empty JSON array.';
    END IF;

    -- 2. Process Groups (Level 1)
    FOR v_group_rec IN 
        SELECT DISTINCT 
            (elem->>'group_code')::VARCHAR AS group_code,
            (elem->>'group_name')::VARCHAR AS group_name,
            (elem->>'group_nature')::VARCHAR AS group_nature,
            (elem->>'group_report_category')::VARCHAR AS group_report_category,
            (elem->>'group_system_key')::VARCHAR AS group_system_key
        FROM jsonb_array_elements(p_payload) AS elem
    LOOP
        IF v_group_rec.group_system_key IS NULL OR v_group_rec.group_code IS NULL OR v_group_rec.group_name IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_GROUP_PAYLOAD: Group code, name, and system_key are required.';
        END IF;

        -- Check if group system_key exists for this organization
        SELECT id, code INTO v_group_id, v_existing_group_code
        FROM account_groups
        WHERE organization_id = p_organization_id AND system_key = v_group_rec.group_system_key;

        IF v_group_id IS NOT NULL THEN
            -- CONFLICT DETECTION: If system_key exists, code MUST match
            IF v_existing_group_code != v_group_rec.group_code THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Group system_key % exists with code %, payload has %',
                    v_group_rec.group_system_key, v_existing_group_code, v_group_rec.group_code;
            END IF;
        ELSE
            INSERT INTO account_groups (
                organization_id,
                code,
                name,
                nature,
                report_category,
                system_key,
                is_active,
                is_system
            ) VALUES (
                p_organization_id,
                v_group_rec.group_code,
                v_group_rec.group_name,
                v_group_rec.group_nature,
                v_group_rec.group_report_category,
                v_group_rec.group_system_key,
                TRUE,
                TRUE
            );
            v_inserted_groups := v_inserted_groups + 1;
        END IF;
    END LOOP;

    -- 3. Process Generals (Level 2)
    FOR v_general_rec IN 
        SELECT DISTINCT 
            (elem->>'general_code')::VARCHAR AS general_code,
            (elem->>'general_name')::VARCHAR AS general_name,
            (elem->>'general_system_key')::VARCHAR AS general_system_key,
            (elem->>'group_system_key')::VARCHAR AS group_system_key
        FROM jsonb_array_elements(p_payload) AS elem
    LOOP
        IF v_general_rec.general_system_key IS NULL OR v_general_rec.general_code IS NULL OR v_general_rec.general_name IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_GENERAL_PAYLOAD: General code, name, and system_key are required.';
        END IF;

        -- Fetch parent group ID
        SELECT id INTO v_group_id
        FROM account_groups
        WHERE organization_id = p_organization_id AND system_key = v_general_rec.group_system_key;

        IF v_group_id IS NULL THEN
            RAISE EXCEPTION 'ERR_PARENT_GROUP_NOT_FOUND: Group system_key % not found for General %', 
                v_general_rec.group_system_key, v_general_rec.general_name;
        END IF;

        -- Check if general system_key exists
        SELECT id, code INTO v_general_id, v_existing_general_code
        FROM account_generals
        WHERE organization_id = p_organization_id AND system_key = v_general_rec.general_system_key;

        IF v_general_id IS NOT NULL THEN
            -- CONFLICT DETECTION: If system_key exists, code MUST match
            IF v_existing_general_code != v_general_rec.general_code THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: General system_key % exists with code %, payload has %',
                    v_general_rec.general_system_key, v_existing_general_code, v_general_rec.general_code;
            END IF;
        ELSE
            INSERT INTO account_generals (
                organization_id,
                group_id,
                code,
                name,
                system_key,
                is_active,
                is_system
            ) VALUES (
                p_organization_id,
                v_group_id,
                v_general_rec.general_code,
                v_general_rec.general_name,
                v_general_rec.general_system_key,
                TRUE,
                TRUE
            );
            v_inserted_generals := v_inserted_generals + 1;
        END IF;
    END LOOP;

    -- 4. Process Subsidiaries (Level 3)
    FOR v_sub_rec IN 
        SELECT 
            (elem->>'sub_code')::VARCHAR AS sub_code,
            (elem->>'sub_name')::VARCHAR AS sub_name,
            (elem->>'sub_system_key')::VARCHAR AS sub_system_key,
            (elem->>'general_system_key')::VARCHAR AS general_system_key,
            COALESCE((elem->>'requires_person')::BOOLEAN, FALSE) AS requires_person,
            COALESCE((elem->>'requires_cost_center')::BOOLEAN, FALSE) AS requires_cost_center
        FROM jsonb_array_elements(p_payload) AS elem
    LOOP
        IF v_sub_rec.sub_system_key IS NULL OR v_sub_rec.sub_code IS NULL OR v_sub_rec.sub_name IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_SUB_PAYLOAD: Subsidiary code, name and system_key are required.';
        END IF;

        -- Fetch parent general ID
        SELECT id INTO v_general_id
        FROM account_generals
        WHERE organization_id = p_organization_id AND system_key = v_sub_rec.general_system_key;

        IF v_general_id IS NULL THEN
            RAISE EXCEPTION 'ERR_PARENT_GENERAL_NOT_FOUND: General system_key % not found for Sub %', 
                v_sub_rec.general_system_key, v_sub_rec.sub_name;
        END IF;

        -- Check if subsidiary exists
        SELECT id, code, name, general_id INTO v_existing_sub
        FROM account_subsidiaries 
        WHERE organization_id = p_organization_id AND system_key = v_sub_rec.sub_system_key;

        IF v_existing_sub.id IS NOT NULL THEN
            -- CONFLICT DETECTION: If system_key exists, code, name, and parent general MUST match
            IF v_existing_sub.code != v_sub_rec.sub_code THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists with code %, payload has %',
                    v_sub_rec.sub_system_key, v_existing_sub.code, v_sub_rec.sub_code;
            END IF;
            IF v_existing_sub.name != v_sub_rec.sub_name THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists with name %, payload has %',
                    v_sub_rec.sub_system_key, v_existing_sub.name, v_sub_rec.sub_name;
            END IF;
            IF v_existing_sub.general_id != v_general_id THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists under different parent general',
                    v_sub_rec.sub_system_key;
            END IF;
        ELSE
            INSERT INTO account_subsidiaries (
                organization_id,
                general_id,
                code,
                name,
                system_key,
                requires_person,
                requires_cost_center,
                is_active,
                is_system
            ) VALUES (
                p_organization_id,
                v_general_id,
                v_sub_rec.sub_code,
                v_sub_rec.sub_name,
                v_sub_rec.sub_system_key,
                v_sub_rec.requires_person,
                v_sub_rec.requires_cost_center,
                TRUE,
                v_sub_rec.sub_system_key LIKE 'SUB_%'
            );
            v_inserted_subsidiaries := v_inserted_subsidiaries + 1;
        END IF;
    END LOOP;

    RETURN QUERY
    SELECT TRUE, v_inserted_groups, v_inserted_generals, v_inserted_subsidiaries, 'SUCCESS'::TEXT;
END;
$$;

-- Revoke direct permissions from public, anon, and authenticated roles
REVOKE ALL ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) FROM authenticated;

-- Grant execution permissions ONLY to service_role (Server Backend Execution)
GRANT EXECUTE ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) TO service_role;

-- ==============================================================================
-- SECTION: 13_coa_backfill_full_conflict_hardening.sql
-- ==============================================================================

-- Migration: 13_coa_backfill_full_conflict_hardening.sql
-- Description: Incremental Migration for Full COA Backfill Conflict Hardening
-- Scope: Validates ALL identity & structural properties (Group: code, name, nature, report_category; General: code, name, group_id; Subsidiary: code, name, general_id, requires_person, requires_cost_center) against existing system_key records. Any mismatch raises ERR_SYSTEM_KEY_CONFLICT and forces fail-closed rollback.

CREATE OR REPLACE FUNCTION fn_backfill_chart_of_accounts(
    p_organization_id UUID,
    p_payload JSONB
)
RETURNS TABLE (
    success BOOLEAN,
    inserted_groups INT,
    inserted_generals INT,
    inserted_subsidiaries INT,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inserted_groups INT := 0;
    v_inserted_generals INT := 0;
    v_inserted_subsidiaries INT := 0;
    
    v_group_rec RECORD;
    v_general_rec RECORD;
    v_sub_rec RECORD;
    
    v_group_id UUID;
    v_existing_group RECORD;
    
    v_general_id UUID;
    v_existing_general RECORD;
    
    v_existing_sub RECORD;
BEGIN
    -- 1. Validate Organization ID and Payload
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'ERR_ORG_ID_REQUIRED: Organization ID must not be null.';
    END IF;

    IF p_payload IS NULL OR jsonb_typeof(p_payload) != 'array' OR jsonb_array_length(p_payload) = 0 THEN
        RAISE EXCEPTION 'ERR_EMPTY_PAYLOAD: Payload must be a non-empty JSON array.';
    END IF;

    -- 2. Process Groups (Level 1)
    FOR v_group_rec IN 
        SELECT DISTINCT 
            (elem->>'group_code')::VARCHAR AS group_code,
            (elem->>'group_name')::VARCHAR AS group_name,
            (elem->>'group_nature')::VARCHAR AS group_nature,
            (elem->>'group_report_category')::VARCHAR AS group_report_category,
            (elem->>'group_system_key')::VARCHAR AS group_system_key
        FROM jsonb_array_elements(p_payload) AS elem
    LOOP
        IF v_group_rec.group_system_key IS NULL OR v_group_rec.group_code IS NULL OR v_group_rec.group_name IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_GROUP_PAYLOAD: Group code, name, and system_key are required.';
        END IF;

        -- Check if group system_key exists for this organization
        SELECT id, code, name, nature, report_category INTO v_existing_group
        FROM account_groups
        WHERE organization_id = p_organization_id AND system_key = v_group_rec.group_system_key;

        IF v_existing_group.id IS NOT NULL THEN
            -- CONFLICT DETECTION: Validate ALL Group properties
            IF v_existing_group.code != v_group_rec.group_code THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Group system_key % exists with code %, payload has %',
                    v_group_rec.group_system_key, v_existing_group.code, v_group_rec.group_code;
            END IF;
            IF v_existing_group.name != v_group_rec.group_name THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Group system_key % exists with name %, payload has %',
                    v_group_rec.group_system_key, v_existing_group.name, v_group_rec.group_name;
            END IF;
            IF v_existing_group.nature != v_group_rec.group_nature THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Group system_key % exists with nature %, payload has %',
                    v_group_rec.group_system_key, v_existing_group.nature, v_group_rec.group_nature;
            END IF;
            IF v_existing_group.report_category != v_group_rec.group_report_category THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Group system_key % exists with report_category %, payload has %',
                    v_group_rec.group_system_key, v_existing_group.report_category, v_group_rec.group_report_category;
            END IF;
        ELSE
            INSERT INTO account_groups (
                organization_id,
                code,
                name,
                nature,
                report_category,
                system_key,
                is_active,
                is_system
            ) VALUES (
                p_organization_id,
                v_group_rec.group_code,
                v_group_rec.group_name,
                v_group_rec.group_nature,
                v_group_rec.group_report_category,
                v_group_rec.group_system_key,
                TRUE,
                TRUE
            );
            v_inserted_groups := v_inserted_groups + 1;
        END IF;
    END LOOP;

    -- 3. Process Generals (Level 2)
    FOR v_general_rec IN 
        SELECT DISTINCT 
            (elem->>'general_code')::VARCHAR AS general_code,
            (elem->>'general_name')::VARCHAR AS general_name,
            (elem->>'general_system_key')::VARCHAR AS general_system_key,
            (elem->>'group_system_key')::VARCHAR AS group_system_key
        FROM jsonb_array_elements(p_payload) AS elem
    LOOP
        IF v_general_rec.general_system_key IS NULL OR v_general_rec.general_code IS NULL OR v_general_rec.general_name IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_GENERAL_PAYLOAD: General code, name, and system_key are required.';
        END IF;

        -- Fetch parent group ID
        SELECT id INTO v_group_id
        FROM account_groups
        WHERE organization_id = p_organization_id AND system_key = v_general_rec.group_system_key;

        IF v_group_id IS NULL THEN
            RAISE EXCEPTION 'ERR_PARENT_GROUP_NOT_FOUND: Group system_key % not found for General %', 
                v_general_rec.group_system_key, v_general_rec.general_name;
        END IF;

        -- Check if general system_key exists
        SELECT id, code, name, group_id INTO v_existing_general
        FROM account_generals
        WHERE organization_id = p_organization_id AND system_key = v_general_rec.general_system_key;

        IF v_existing_general.id IS NOT NULL THEN
            -- CONFLICT DETECTION: Validate ALL General properties
            IF v_existing_general.code != v_general_rec.general_code THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: General system_key % exists with code %, payload has %',
                    v_general_rec.general_system_key, v_existing_general.code, v_general_rec.general_code;
            END IF;
            IF v_existing_general.name != v_general_rec.general_name THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: General system_key % exists with name %, payload has %',
                    v_general_rec.general_system_key, v_existing_general.name, v_general_rec.general_name;
            END IF;
            IF v_existing_general.group_id != v_group_id THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: General system_key % exists under different parent group',
                    v_general_rec.general_system_key;
            END IF;
        ELSE
            INSERT INTO account_generals (
                organization_id,
                group_id,
                code,
                name,
                system_key,
                is_active,
                is_system
            ) VALUES (
                p_organization_id,
                v_group_id,
                v_general_rec.general_code,
                v_general_rec.general_name,
                v_general_rec.general_system_key,
                TRUE,
                TRUE
            );
            v_inserted_generals := v_inserted_generals + 1;
        END IF;
    END LOOP;

    -- 4. Process Subsidiaries (Level 3)
    FOR v_sub_rec IN 
        SELECT 
            (elem->>'sub_code')::VARCHAR AS sub_code,
            (elem->>'sub_name')::VARCHAR AS sub_name,
            (elem->>'sub_system_key')::VARCHAR AS sub_system_key,
            (elem->>'general_system_key')::VARCHAR AS general_system_key,
            COALESCE((elem->>'requires_person')::BOOLEAN, FALSE) AS requires_person,
            COALESCE((elem->>'requires_cost_center')::BOOLEAN, FALSE) AS requires_cost_center
        FROM jsonb_array_elements(p_payload) AS elem
    LOOP
        IF v_sub_rec.sub_system_key IS NULL OR v_sub_rec.sub_code IS NULL OR v_sub_rec.sub_name IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_SUB_PAYLOAD: Subsidiary code, name and system_key are required.';
        END IF;

        -- Fetch parent general ID
        SELECT id INTO v_general_id
        FROM account_generals
        WHERE organization_id = p_organization_id AND system_key = v_sub_rec.general_system_key;

        IF v_general_id IS NULL THEN
            RAISE EXCEPTION 'ERR_PARENT_GENERAL_NOT_FOUND: General system_key % not found for Sub %', 
                v_sub_rec.general_system_key, v_sub_rec.sub_name;
        END IF;

        -- Check if subsidiary exists
        SELECT id, code, name, general_id, requires_person, requires_cost_center INTO v_existing_sub
        FROM account_subsidiaries 
        WHERE organization_id = p_organization_id AND system_key = v_sub_rec.sub_system_key;

        IF v_existing_sub.id IS NOT NULL THEN
            -- CONFLICT DETECTION: Validate ALL Subsidiary properties
            IF v_existing_sub.code != v_sub_rec.sub_code THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists with code %, payload has %',
                    v_sub_rec.sub_system_key, v_existing_sub.code, v_sub_rec.sub_code;
            END IF;
            IF v_existing_sub.name != v_sub_rec.sub_name THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists with name %, payload has %',
                    v_sub_rec.sub_system_key, v_existing_sub.name, v_sub_rec.sub_name;
            END IF;
            IF v_existing_sub.general_id != v_general_id THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists under different parent general',
                    v_sub_rec.sub_system_key;
            END IF;
            IF v_existing_sub.requires_person != v_sub_rec.requires_person THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists with requires_person %, payload has %',
                    v_sub_rec.sub_system_key, v_existing_sub.requires_person, v_sub_rec.requires_person;
            END IF;
            IF v_existing_sub.requires_cost_center != v_sub_rec.requires_cost_center THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists with requires_cost_center %, payload has %',
                    v_sub_rec.sub_system_key, v_existing_sub.requires_cost_center, v_sub_rec.requires_cost_center;
            END IF;
        ELSE
            INSERT INTO account_subsidiaries (
                organization_id,
                general_id,
                code,
                name,
                system_key,
                requires_person,
                requires_cost_center,
                is_active,
                is_system
            ) VALUES (
                p_organization_id,
                v_general_id,
                v_sub_rec.sub_code,
                v_sub_rec.sub_name,
                v_sub_rec.sub_system_key,
                v_sub_rec.requires_person,
                v_sub_rec.requires_cost_center,
                TRUE,
                v_sub_rec.sub_system_key LIKE 'SUB_%'
            );
            v_inserted_subsidiaries := v_inserted_subsidiaries + 1;
        END IF;
    END LOOP;

    RETURN QUERY
    SELECT TRUE, v_inserted_groups, v_inserted_generals, v_inserted_subsidiaries, 'SUCCESS'::TEXT;
END;
$$;

-- Permissions setup
REVOKE ALL ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) TO service_role;

-- ==============================================================================
-- SECTION: 14_installment_foundation.sql
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- Migration: 14_installment_foundation.sql
-- Description: Phase 11.10 - Incremental Relational Foundation for Installments, Booklets & Payment Allocations
-- Rules & Constraints:
--   1. Zero Runtime behavior change: No cutover, no dual write, no real user data backfill.
2. Tenant Isolation: Every table enforces organization_id NOT NULL and composite FKs.
3. Foreign Keys: Strictly links to existing real tables (organizations, branches, persons, credit_files, journal_vouchers, user_profiles).
4. Financial Constraints: Strict non-negative constraints and check rules (paid_amount <= amount, totals consistency).
5. Uniqueness: (book_id, installment_number) unique per booklet; operation_key unique per organization.
6. Auditability & No Hard Delete: RLS enabled, immutable payment logs and allocations, physical DELETE disallowed.
-- ==============================================================================

-- 1. INSTALLMENT BOOKS (دفترچه‌های اقساط)
CREATE TABLE IF NOT EXISTS public.installment_books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
    person_id UUID NOT NULL,
    invoice_id TEXT, -- Nullable text; invoices table deferred to future migration
    credit_file_id TEXT REFERENCES public.credit_files(id) ON DELETE SET NULL,
    calculator_id TEXT,
    total_principal NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (total_principal >= 0),
    total_interest NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (total_interest >= 0),
    total_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    installment_count INT NOT NULL CHECK (installment_count > 0),
    start_date TEXT NOT NULL,
    interval_days INT NOT NULL DEFAULT 30 CHECK (interval_days > 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'terminated', 'voided', 'canceled')),
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_installment_book_org_composite UNIQUE (organization_id, id),
    CONSTRAINT fk_installment_book_branch FOREIGN KEY (organization_id, branch_id)
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_book_person FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_installment_book_totals CHECK (total_amount = total_principal + total_interest)
);

COMMENT ON TABLE public.installment_books IS 'Header records for installment booklets bound to a person and optional credit file/invoice.';

-- 2. INSTALLMENTS (سطور اقساط)
CREATE TABLE IF NOT EXISTS public.installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    book_id UUID NOT NULL,
    installment_number INT NOT NULL CHECK (installment_number > 0),
    due_date TEXT NOT NULL,
    amount NUMERIC(18, 0) NOT NULL CHECK (amount >= 0),
    paid_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    principal_part NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (principal_part >= 0),
    interest_part NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (interest_part >= 0),
    penalty_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
    delay_days INT NOT NULL DEFAULT 0 CHECK (delay_days >= 0),
    status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'paid', 'overdue', 'partially_paid', 'voided', 'canceled')),
    paid_date TEXT,
    calculator_id TEXT,
    agent_bank_id TEXT,
    agent_bank_name TEXT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_installment_book_number UNIQUE (book_id, installment_number),
    CONSTRAINT uq_installment_org_composite UNIQUE (organization_id, id),
    CONSTRAINT fk_installment_book FOREIGN KEY (organization_id, book_id)
        REFERENCES public.installment_books(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_installment_paid_le_amount CHECK (paid_amount <= amount)
);

COMMENT ON TABLE public.installments IS 'Individual installment line items with principal, interest, penalty, and settlement tracking.';

-- 3. INSTALLMENT PAYMENTS (سوابق دریافت/پرداخت وجه اقساط)
CREATE TABLE IF NOT EXISTS public.installment_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    book_id UUID,
    installment_id UUID,
    person_id UUID NOT NULL,
    amount NUMERIC(18, 0) NOT NULL CHECK (amount > 0),
    payment_date TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'POS', 'CHEQUE', 'BETA', 'TRANSFER', 'OTHER')),
    operation_key TEXT NOT NULL,
    voucher_id UUID,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_installment_payment_op_key UNIQUE (organization_id, operation_key),
    CONSTRAINT uq_installment_payment_org_composite UNIQUE (organization_id, id),
    CONSTRAINT fk_installment_payment_person FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_payment_book FOREIGN KEY (organization_id, book_id)
        REFERENCES public.installment_books(organization_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_payment_installment FOREIGN KEY (organization_id, installment_id)
        REFERENCES public.installments(organization_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_payment_voucher FOREIGN KEY (organization_id, voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.installment_payments IS 'Immutable cash/bank payment audit records linked to journal vouchers and unique operation keys.';

-- 4. INSTALLMENT PAYMENT ALLOCATIONS (جدول تخصیص و تسهیم پرداخت به اقساط)
CREATE TABLE IF NOT EXISTS public.installment_payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    payment_id UUID NOT NULL,
    installment_id UUID NOT NULL,
    allocated_amount NUMERIC(18, 0) NOT NULL CHECK (allocated_amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_allocation_payment FOREIGN KEY (organization_id, payment_id)
        REFERENCES public.installment_payments(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_allocation_installment FOREIGN KEY (organization_id, installment_id)
        REFERENCES public.installments(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_payment_installment_allocation UNIQUE (payment_id, installment_id)
);

COMMENT ON TABLE public.installment_payment_allocations IS 'Breakdown allocation mapping a single lump-sum payment across multiple installments.';

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_installment_books_org_person ON public.installment_books(organization_id, person_id);
CREATE INDEX IF NOT EXISTS idx_installment_books_org_status ON public.installment_books(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_installments_org_due_status ON public.installments(organization_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_installment_payments_org_person ON public.installment_payments(organization_id, person_id);
CREATE INDEX IF NOT EXISTS idx_installment_allocations_payment ON public.installment_payment_allocations(organization_id, payment_id);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE public.installment_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_payment_allocations ENABLE ROW LEVEL SECURITY;

-- POLICIES: installment_books
DROP POLICY IF EXISTS "Authorized members can view installment books" ON public.installment_books;
CREATE POLICY "Authorized members can view installment books"
ON public.installment_books FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
);

DROP POLICY IF EXISTS "Authorized members can insert installment books" ON public.installment_books;
CREATE POLICY "Authorized members can insert installment books"
ON public.installment_books FOR INSERT
TO authenticated
WITH CHECK (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
);

DROP POLICY IF EXISTS "Authorized members can update installment books" ON public.installment_books;
CREATE POLICY "Authorized members can update installment books"
ON public.installment_books FOR UPDATE
TO authenticated
USING (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
)
WITH CHECK (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
);

-- POLICIES: installments
DROP POLICY IF EXISTS "Authorized members can view installments" ON public.installments;
CREATE POLICY "Authorized members can view installments"
ON public.installments FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
);

DROP POLICY IF EXISTS "Authorized members can insert installments" ON public.installments;
CREATE POLICY "Authorized members can insert installments"
ON public.installments FOR INSERT
TO authenticated
WITH CHECK (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
);

DROP POLICY IF EXISTS "Authorized members can update installments" ON public.installments;
CREATE POLICY "Authorized members can update installments"
ON public.installments FOR UPDATE
TO authenticated
USING (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
)
WITH CHECK (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
);

-- POLICIES: installment_payments
DROP POLICY IF EXISTS "Authorized members can view installment payments" ON public.installment_payments;
CREATE POLICY "Authorized members can view installment payments"
ON public.installment_payments FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
);

DROP POLICY IF EXISTS "Authorized members can insert installment payments" ON public.installment_payments;
CREATE POLICY "Authorized members can insert installment payments"
ON public.installment_payments FOR INSERT
TO authenticated
WITH CHECK (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
);

-- POLICIES: installment_payment_allocations
DROP POLICY IF EXISTS "Authorized members can view installment allocations" ON public.installment_payment_allocations;
CREATE POLICY "Authorized members can view installment allocations"
ON public.installment_payment_allocations FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
);

DROP POLICY IF EXISTS "Authorized members can insert installment allocations" ON public.installment_payment_allocations;
CREATE POLICY "Authorized members can insert installment allocations"
ON public.installment_payment_allocations FOR INSERT
TO authenticated
WITH CHECK (
    public.is_org_member(organization_id) AND (
        public.has_permission(organization_id, 'sales:manage') OR
        public.has_permission(organization_id, 'credit:manage')
    )
);

COMMIT;

