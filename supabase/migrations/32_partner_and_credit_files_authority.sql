BEGIN;

-- ==============================================================================
-- Migration: 32_partner_and_credit_files_authority.sql
-- Description: Server & Database Authority for Business Partners, Partner Credit Requests,
--              Credit Files, and Credit Policies with Optimistic Concurrency & Multi-Tenant RLS.
-- ==============================================================================

-- 1. Business Partners Table
CREATE TABLE IF NOT EXISTS public.business_partners (
    id TEXT PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    person_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    agency_type TEXT,
    roles JSONB DEFAULT '[]'::jsonb,
    profile JSONB DEFAULT '{}'::jsonb,
    branches JSONB DEFAULT '[]'::jsonb,
    contract JSONB,
    nesyeh_settings JSONB,
    nesyeh_onboarding JSONB,
    users JSONB DEFAULT '[]'::jsonb,
    has_activity BOOLEAN DEFAULT false,
    allowed_sales_plan_ids JSONB DEFAULT '[]'::jsonb,
    allowed_calculator_ids JSONB DEFAULT '[]'::jsonb,
    calculator_overrides JSONB,
    sales_extension JSONB,
    credit_extension JSONB,
    feature_toggles JSONB,
    portal_links JSONB,
    version INTEGER NOT NULL DEFAULT 1,
    operation_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT,
    updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_business_partners_org_person ON public.business_partners(organization_id, person_id);
CREATE INDEX IF NOT EXISTS idx_business_partners_op_key ON public.business_partners(organization_id, operation_key) WHERE operation_key IS NOT NULL;

-- 2. Partner Credit Requests Table
CREATE TABLE IF NOT EXISTS public.partner_credit_requests (
    id TEXT PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    business_partner_id TEXT NOT NULL,
    customer_person_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    requested_amount NUMERIC NOT NULL DEFAULT 0,
    sale_plan_id TEXT,
    term_count INTEGER DEFAULT 0,
    payment_period INTEGER DEFAULT 0,
    documents JSONB DEFAULT '[]'::jsonb,
    submitted_checks JSONB DEFAULT '[]'::jsonb,
    approval_history JSONB DEFAULT '[]'::jsonb,
    validation_result JSONB,
    calculation_results JSONB,
    rejection_reason TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    operation_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT,
    updated_by TEXT,
    approved_at TIMESTAMPTZ,
    final_approved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_credit_reqs_org_bp ON public.partner_credit_requests(organization_id, business_partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_credit_reqs_op_key ON public.partner_credit_requests(organization_id, operation_key) WHERE operation_key IS NOT NULL;

-- 3. Credit Policies Table
CREATE TABLE IF NOT EXISTS public.credit_policies (
    id TEXT PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    min_amount NUMERIC DEFAULT 0,
    max_amount NUMERIC DEFAULT 0,
    needs_validation BOOLEAN DEFAULT false,
    needs_back_signature BOOLEAN DEFAULT false,
    needs_collateral BOOLEAN DEFAULT false,
    needs_guarantor_info BOOLEAN DEFAULT false,
    needs_guarantor_validation BOOLEAN DEFAULT false,
    needs_amani_check BOOLEAN DEFAULT false,
    amani_reminder_days INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    version INTEGER NOT NULL DEFAULT 1,
    operation_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT,
    updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_credit_policies_org ON public.credit_policies(organization_id);

-- 4. Enhance Credit Files Table Columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='version') THEN
        ALTER TABLE public.credit_files ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='operation_key') THEN
        ALTER TABLE public.credit_files ADD COLUMN operation_key TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='updated_at') THEN
        ALTER TABLE public.credit_files ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='created_by') THEN
        ALTER TABLE public.credit_files ADD COLUMN created_by TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='updated_by') THEN
        ALTER TABLE public.credit_files ADD COLUMN updated_by TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='agent_commission_rate') THEN
        ALTER TABLE public.credit_files ADD COLUMN agent_commission_rate NUMERIC;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='agent_bank_id') THEN
        ALTER TABLE public.credit_files ADD COLUMN agent_bank_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='agent_bank_name') THEN
        ALTER TABLE public.credit_files ADD COLUMN agent_bank_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='settlement_type') THEN
        ALTER TABLE public.credit_files ADD COLUMN settlement_type TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='policy_id') THEN
        ALTER TABLE public.credit_files ADD COLUMN policy_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='policy_snapshot') THEN
        ALTER TABLE public.credit_files ADD COLUMN policy_snapshot JSONB;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='guarantor_name') THEN
        ALTER TABLE public.credit_files ADD COLUMN guarantor_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='guarantor_national_id') THEN
        ALTER TABLE public.credit_files ADD COLUMN guarantor_national_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='guarantor_phone') THEN
        ALTER TABLE public.credit_files ADD COLUMN guarantor_phone TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='collateral_type') THEN
        ALTER TABLE public.credit_files ADD COLUMN collateral_type TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='collateral_description') THEN
        ALTER TABLE public.credit_files ADD COLUMN collateral_description TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='collateral_value') THEN
        ALTER TABLE public.credit_files ADD COLUMN collateral_value NUMERIC;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='amani_check_number') THEN
        ALTER TABLE public.credit_files ADD COLUMN amani_check_number TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='amani_check_bank_name') THEN
        ALTER TABLE public.credit_files ADD COLUMN amani_check_bank_name TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credit_files_op_key ON public.credit_files(organization_id, operation_key) WHERE operation_key IS NOT NULL;

-- 5. Row Level Security Policies for Multi-Tenant Isolation
ALTER TABLE public.business_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_credit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_files ENABLE ROW LEVEL SECURITY;

-- Business Partners Policies
DROP POLICY IF EXISTS "Org members select business_partners" ON public.business_partners;
CREATE POLICY "Org members select business_partners" ON public.business_partners
    FOR SELECT TO authenticated USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Org members write business_partners" ON public.business_partners;
CREATE POLICY "Org members write business_partners" ON public.business_partners
    FOR ALL TO authenticated USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));

-- Partner Credit Requests Policies
DROP POLICY IF EXISTS "Org members select partner_credit_requests" ON public.partner_credit_requests;
CREATE POLICY "Org members select partner_credit_requests" ON public.partner_credit_requests
    FOR SELECT TO authenticated USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Org members write partner_credit_requests" ON public.partner_credit_requests;
CREATE POLICY "Org members write partner_credit_requests" ON public.partner_credit_requests
    FOR ALL TO authenticated USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));

-- Credit Policies Policies
DROP POLICY IF EXISTS "Org members select credit_policies" ON public.credit_policies;
CREATE POLICY "Org members select credit_policies" ON public.credit_policies
    FOR SELECT TO authenticated USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Org members write credit_policies" ON public.credit_policies;
CREATE POLICY "Org members write credit_policies" ON public.credit_policies
    FOR ALL TO authenticated USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));

COMMIT;
