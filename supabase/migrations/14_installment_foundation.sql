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
