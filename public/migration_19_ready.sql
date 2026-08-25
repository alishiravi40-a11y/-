BEGIN;

-- ==============================================================================
-- Migration: 19_cheques_foundation.sql
-- Description: Block 3 - Cheque Domain Relational Schema, State History, & Mutation Idempotency
-- Rules:
--   1. Tenant Isolation: organization_id NOT NULL REFERENCES public.organizations(id).
--   2. Money Contract: amount NUMERIC(18,0) NOT NULL CHECK (amount > 0).
--   3. State Contract: Received (present_in_cashbox, deposited_to_bank, cleared, passed_to_others, bounced), Paid (issued, cleared, bounced).
--   4. Creation Idempotency: UNIQUE (organization_id, operation_key).
--   5. Transition Idempotency: UNIQUE (organization_id, mutation_key) on cheque_mutations.
--   6. Optimistic Concurrency: version INTEGER NOT NULL DEFAULT 1.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.cheques (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID NULL,
    fiscal_year_id UUID NULL,
    
    cheque_type TEXT NOT NULL CHECK (cheque_type IN ('received', 'paid')),
    current_state TEXT NOT NULL CHECK (
        (cheque_type = 'received' AND current_state IN ('present_in_cashbox', 'deposited_to_bank', 'cleared', 'passed_to_others', 'bounced'))
        OR
        (cheque_type = 'paid' AND current_state IN ('issued', 'cleared', 'bounced'))
    ),
    
    person_id UUID NULL,
    invoice_id UUID NULL,
    installment_book_id UUID NULL,
    investor_id UUID NULL,
    
    check_number TEXT NOT NULL,
    sayadi_identifier TEXT NULL,
    amount NUMERIC(18, 0) NOT NULL CHECK (amount > 0),
    
    bank_name TEXT NULL,
    branch_name TEXT NULL,
    account_number TEXT NULL,
    issue_date TEXT NULL,
    due_date TEXT NULL,
    received_date TEXT NULL,
    clearance_date TEXT NULL,
    return_date TEXT NULL,
    description TEXT NULL,
    
    journal_voucher_id UUID NULL,
    clearance_voucher_id UUID NULL,
    return_voucher_id UUID NULL,
    
    created_by TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    operation_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    legacy_id TEXT NULL,
    
    CONSTRAINT uq_cheques_org_operation_key UNIQUE (organization_id, operation_key),
    CONSTRAINT fk_cheques_person FOREIGN KEY (organization_id, person_id) REFERENCES public.persons(organization_id, id) ON DELETE SET NULL,
    CONSTRAINT fk_cheques_invoice FOREIGN KEY (organization_id, invoice_id) REFERENCES public.invoices(organization_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.cheque_state_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    cheque_id UUID NOT NULL REFERENCES public.cheques(id) ON DELETE CASCADE,
    from_state TEXT NULL,
    to_state TEXT NOT NULL,
    event_type TEXT NOT NULL,
    performed_by TEXT NULL,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    operation_key TEXT NULL,
    request_fingerprint TEXT NULL,
    journal_voucher_id UUID NULL,
    metadata JSONB NULL
);

CREATE TABLE IF NOT EXISTS public.cheque_mutations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    cheque_id UUID NOT NULL REFERENCES public.cheques(id) ON DELETE CASCADE,
    mutation_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    resulting_state TEXT NOT NULL,
    from_state TEXT NULL,
    to_state TEXT NULL,
    voucher_id UUID NULL,
    version_before INTEGER NULL,
    version_after INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_cheque_mutations_org_mutation_key UNIQUE (organization_id, mutation_key)
);

-- Indexes for performance and uniqueness
CREATE INDEX IF NOT EXISTS idx_cheques_org_person ON public.cheques(organization_id, person_id);
CREATE INDEX IF NOT EXISTS idx_cheques_org_invoice ON public.cheques(organization_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_cheques_org_state ON public.cheques(organization_id, current_state);
CREATE INDEX IF NOT EXISTS idx_cheques_org_due_date ON public.cheques(organization_id, due_date);
CREATE INDEX IF NOT EXISTS idx_cheques_org_number ON public.cheques(organization_id, check_number);
CREATE INDEX IF NOT EXISTS idx_cheque_history_cheque ON public.cheque_state_history(cheque_id);
CREATE INDEX IF NOT EXISTS idx_cheque_mutations_cheque ON public.cheque_mutations(cheque_id);

-- Enable RLS
ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheque_state_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheque_mutations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for authenticated users on cheques"
    ON public.cheques FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all access for authenticated users on cheque_state_history"
    ON public.cheque_state_history FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable all access for authenticated users on cheque_mutations"
    ON public.cheque_mutations FOR ALL USING (true) WITH CHECK (true);

COMMIT;