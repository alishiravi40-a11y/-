BEGIN;

-- ==============================================================================
-- Migration: 18_order_invoice_conversions.sql
-- Description: Block 2 - Durable Order-to-Invoice Conversion Guard
-- Rules & Constraints:
--   1. Tenant Isolation: organization_id NOT NULL REFERENCES public.organizations(id).
--   2. Unique Invariant: UNIQUE (organization_id, source_order_id) prevents duplicate conversion.
--   3. Invoice Linkage: Composite FK to public.invoices(organization_id, id).
--   4. Status Tracking: Explicit and minimal statuses (PROCESSING, COMPLETED).
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.order_invoice_conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    source_order_id TEXT NOT NULL,
    invoice_id UUID NULL,
    request_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_order_invoice_conversions_org_order UNIQUE (organization_id, source_order_id),
    CONSTRAINT fk_order_invoice_conversions_invoice FOREIGN KEY (organization_id, invoice_id) REFERENCES public.invoices(organization_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.order_invoice_conversions IS 'Durable guard enforcing 1:1 order-to-invoice conversion per organization.';

ALTER TABLE public.order_invoice_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for authenticated users on order_invoice_conversions"
    ON public.order_invoice_conversions FOR ALL
    USING (true)
    WITH CHECK (true);

COMMIT;
