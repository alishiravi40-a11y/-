BEGIN;

-- ==============================================================================
-- Migration: 15_invoices_foundation.sql
-- Description: Block 2 - Relational Foundation for Invoices, Invoice Items & Atomic Numbering
-- ==============================================================================

-- 1. INVOICE SEQUENCES & ATOMIC NUMBERING FUNCTION
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
    next_invoice_number INT NOT NULL DEFAULT 1 CHECK (next_invoice_number > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.invoice_sequences IS 'Tracks sequential invoice numbering per organization for atomic allocation.';

CREATE OR REPLACE FUNCTION public.get_next_invoice_number(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_next_val INT;
BEGIN
    INSERT INTO public.invoice_sequences (organization_id, next_invoice_number, updated_at)
    VALUES (p_org_id, 1, now())
    ON CONFLICT (organization_id) DO UPDATE
    SET next_invoice_number = public.invoice_sequences.next_invoice_number + 1,
        updated_at = now()
    RETURNING next_invoice_number INTO v_next_val;

    PERFORM 1 FROM public.invoice_sequences WHERE organization_id = p_org_id FOR UPDATE;

    RETURN v_next_val;
END;
$$;

COMMENT ON FUNCTION public.get_next_invoice_number(UUID) IS 'Atomically increments and returns the next sequential invoice number for an organization.';

-- 2. INVOICES (سربرگ فاکتورهای خرید و فروش)
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID,
    fiscal_year_id UUID,
    
    invoice_number INT NOT NULL CHECK (invoice_number > 0),
    invoice_type TEXT NOT NULL CHECK (invoice_type IN ('SELL', 'BUY', 'SELL_RETURN', 'BUY_RETURN')),
    invoice_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED', 'VOIDED')),
    
    person_id UUID NOT NULL,
    person_name TEXT,
    
    subtotal_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
    total_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    discount_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    final_amount NUMERIC(18, 0) NOT NULL CHECK (final_amount >= 0),
    
    payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK', 'CHEQUE', 'CREDIT', 'DEFERRED', 'COMBINED', 'INSTALLMENT')),
    
    journal_voucher_id UUID,
    inventory_transaction_id UUID,
    
    settlement_status TEXT NOT NULL DEFAULT 'UNSETTLED' CHECK (settlement_status IN ('UNSETTLED', 'PARTIALLY_SETTLED', 'FULLY_SETTLED')),
    paid_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_amount NUMERIC(18, 0) NOT NULL CHECK (remaining_amount >= 0),
    
    is_voided BOOLEAN NOT NULL DEFAULT false,
    voided_at TIMESTAMPTZ,
    voided_by TEXT,
    void_reason TEXT,
    reversal_voucher_id UUID,
    reversal_inventory_transaction_id UUID,
    
    version INT NOT NULL DEFAULT 1 CHECK (version > 0),
    operation_key TEXT NOT NULL,
    created_by TEXT,
    cost_center_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT uq_invoices_org_composite UNIQUE (organization_id, id),
    CONSTRAINT uq_invoices_org_number UNIQUE (organization_id, invoice_number),
    CONSTRAINT uq_invoices_operation_key UNIQUE (organization_id, operation_key),
    CONSTRAINT fk_invoices_branch FOREIGN KEY (organization_id, branch_id)
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_invoices_fy FOREIGN KEY (organization_id, fiscal_year_id)
        REFERENCES public.fiscal_years(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_invoices_person FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_invoices_voucher FOREIGN KEY (organization_id, journal_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_invoices_inventory_tx FOREIGN KEY (organization_id, inventory_transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_invoices_reversal_voucher FOREIGN KEY (organization_id, reversal_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_invoices_reversal_inventory_tx FOREIGN KEY (organization_id, reversal_inventory_transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_invoices_cost_center FOREIGN KEY (organization_id, cost_center_id)
        REFERENCES public.cost_centers(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.invoices IS 'Header records for sales and purchase invoices, linking financial vouchers, inventory movements, and persons.';

-- 3. INVOICE ITEMS (ردیف‌های فاکتور)
CREATE TABLE IF NOT EXISTS public.invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL,
    row_number INT NOT NULL CHECK (row_number > 0),
    product_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    quantity NUMERIC(18, 3) NOT NULL CHECK (quantity > 0),
    unit_price_amount NUMERIC(18, 0) NOT NULL CHECK (unit_price_amount >= 0),
    discount_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_price_amount NUMERIC(18, 0) NOT NULL CHECK (total_price_amount >= 0),
    unit_cost_amount NUMERIC(18, 0),
    total_cost_amount NUMERIC(18, 0),
    serial_numbers JSONB,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT uq_invoice_items_org_composite UNIQUE (organization_id, id),
    CONSTRAINT uq_invoice_items_row UNIQUE (invoice_id, row_number),
    CONSTRAINT fk_inv_item_invoice FOREIGN KEY (organization_id, invoice_id)
        REFERENCES public.invoices(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_item_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_item_warehouse FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.invoice_items IS 'Line items for invoices including product, warehouse, quantity, pricing, and costing details.';

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_invoices_org_person ON public.invoices (organization_id, person_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_date ON public.invoices (organization_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_org_voucher ON public.invoices (organization_id, journal_voucher_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_inventory_tx ON public.invoices (organization_id, inventory_transaction_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON public.invoice_items (organization_id, product_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_warehouse ON public.invoice_items (organization_id, warehouse_id);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_sequences_policy" ON public.invoice_sequences;
CREATE POLICY "invoice_sequences_policy" ON public.invoice_sequences FOR ALL TO authenticated
USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "invoices_policy" ON public.invoices;
CREATE POLICY "invoices_policy" ON public.invoices FOR ALL TO authenticated
USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "invoice_items_policy" ON public.invoice_items;
CREATE POLICY "invoice_items_policy" ON public.invoice_items FOR ALL TO authenticated
USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));

COMMIT;
