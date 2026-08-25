BEGIN;

-- ==============================================================================
-- Migration: 33_credit_files_soft_delete_and_documents.sql
-- Description: Adds soft delete audit columns to credit_files and introduces
--              a dedicated relational table credit_file_documents for document metadata.
-- ==============================================================================

-- 1. Soft Delete Columns for Credit Files
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='deleted_at') THEN
        ALTER TABLE public.credit_files ADD COLUMN deleted_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='deleted_by') THEN
        ALTER TABLE public.credit_files ADD COLUMN deleted_by TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_files' AND column_name='deletion_reason') THEN
        ALTER TABLE public.credit_files ADD COLUMN deletion_reason TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credit_files_deleted_at ON public.credit_files(organization_id, deleted_at);

-- 2. Credit File Documents Table
CREATE TABLE IF NOT EXISTS public.credit_file_documents (
    id TEXT PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    credit_file_id TEXT NOT NULL REFERENCES public.credit_files(id) ON DELETE RESTRICT,
    document_type TEXT NOT NULL,
    original_name TEXT NOT NULL,
    storage_provider TEXT NOT NULL DEFAULT 'supabase_storage',
    storage_key TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    checksum TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    version INTEGER NOT NULL DEFAULT 1,
    operation_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT,
    removed_at TIMESTAMPTZ,
    removed_by TEXT,
    removal_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_credit_file_docs_file ON public.credit_file_documents(organization_id, credit_file_id);
CREATE INDEX IF NOT EXISTS idx_credit_file_docs_op_key ON public.credit_file_documents(organization_id, operation_key) WHERE operation_key IS NOT NULL;

-- 3. Row Level Security Policies
ALTER TABLE public.credit_file_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members select credit_file_documents" ON public.credit_file_documents;
CREATE POLICY "Org members select credit_file_documents" ON public.credit_file_documents
    FOR SELECT TO authenticated USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Org members write credit_file_documents" ON public.credit_file_documents;
CREATE POLICY "Org members write credit_file_documents" ON public.credit_file_documents
    FOR ALL TO authenticated USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));

COMMIT;
