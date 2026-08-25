BEGIN;

-- ==============================================================================
-- Migration: 34_credit_documents_storage_bucket.sql
-- Description: Creates private Supabase Storage bucket 'credit-documents' with
--              strict size limits and allowed MIME types. No direct public or
--              authenticated client access policies are granted (server-only).
-- ==============================================================================

-- 1. Create Private Storage Bucket 'credit-documents'
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'credit-documents',
    'credit-documents',
    false,
    15728640, -- 15 MB in bytes
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 15728640,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[];

-- Note: No SELECT/INSERT/UPDATE/DELETE RLS policies are created for 'anon' or 'authenticated' roles
-- to enforce strict server-side authority via Service Role or authenticated proxy routes.

COMMIT;
