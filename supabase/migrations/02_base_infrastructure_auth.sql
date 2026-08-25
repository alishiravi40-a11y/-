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
