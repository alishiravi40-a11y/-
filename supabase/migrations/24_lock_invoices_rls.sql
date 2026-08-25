BEGIN;

-- ==============================================================================
-- Migration: 24_lock_invoices_rls.sql
-- Description: Enforces Strict Table Locking on Core Invoices & Invoice Items (GEMINI.md Invariant 4.1)
-- Direct client INSERT, UPDATE, DELETE are blocked with USING (false) / WITH CHECK (false).
-- Only server-authenticated service contexts invoking SECURITY DEFINER stored procedures can write.
-- Authenticated users are permitted SELECT for their organization.
-- ==============================================================================

-- 1. Lock public.invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_policy" ON public.invoices;
DROP POLICY IF EXISTS "invoices_select_policy" ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert_block" ON public.invoices;
DROP POLICY IF EXISTS "invoices_update_block" ON public.invoices;
DROP POLICY IF EXISTS "invoices_delete_block" ON public.invoices;

-- Read policy: Authenticated members can select their organization's invoices
CREATE POLICY "invoices_select_policy" ON public.invoices
    FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

-- Direct write block policies (Fail closed for client direct queries)
CREATE POLICY "invoices_insert_block" ON public.invoices
    FOR INSERT TO authenticated
    WITH CHECK (false);

CREATE POLICY "invoices_update_block" ON public.invoices
    FOR UPDATE TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY "invoices_delete_block" ON public.invoices
    FOR DELETE TO authenticated
    USING (false);

-- 2. Lock public.invoice_items
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_items_policy" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_select_policy" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_insert_block" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_update_block" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_delete_block" ON public.invoice_items;

-- Read policy: Authenticated members can select line items
CREATE POLICY "invoice_items_select_policy" ON public.invoice_items
    FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

-- Direct write block policies
CREATE POLICY "invoice_items_insert_block" ON public.invoice_items
    FOR INSERT TO authenticated
    WITH CHECK (false);

CREATE POLICY "invoice_items_update_block" ON public.invoice_items
    FOR UPDATE TO authenticated
    USING (false)
    WITH CHECK (false);

CREATE POLICY "invoice_items_delete_block" ON public.invoice_items
    FOR DELETE TO authenticated
    USING (false);

-- 3. Lock public.invoice_sequences
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_sequences_policy" ON public.invoice_sequences;
DROP POLICY IF EXISTS "invoice_sequences_select_policy" ON public.invoice_sequences;
DROP POLICY IF EXISTS "invoice_sequences_write_block" ON public.invoice_sequences;

CREATE POLICY "invoice_sequences_select_policy" ON public.invoice_sequences
    FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "invoice_sequences_write_block" ON public.invoice_sequences
    FOR ALL TO authenticated
    USING (false)
    WITH CHECK (false);

COMMIT;
