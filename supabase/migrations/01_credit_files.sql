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

