-- فقط برای اعتبارسنجی در پایگاه‌داده محلی دورریختنی — اجرای عملیاتی ممنوع
-- LOCAL DISPOSABLE DATABASE VALIDATION ONLY — NEVER RUN AGAINST REMOTE OR PRODUCTION
-- ==============================================================================
-- Candidate Schema: 01_investor_relational_foundation_candidate.sql
-- Description: Disposable local validation candidate for investor contracts,
--              payment schedules, obligations, and explicit commission cheque allocations.
-- Rules:
--   1. LOCAL DISPOSABLE DATABASE VALIDATION ONLY — NEVER RUN AGAINST REMOTE OR PRODUCTION.
--   2. Relational isolation: FEE and CAPITAL_PRINCIPAL are explicitly segregated.
--   3. Explicit cheque allocation table links cheque to obligation (investor_id is NOT a commission marker).
--   4. Strict organization multi-tenant isolation via composite foreign keys.
--   5. Persons guaranteed to be investors via composite FK to public.investor_profiles(organization_id, person_id).
--   6. Composite FK on cheques (organization_id, cheque_id) -> public.cheques(organization_id, id).
--   7. Permanent 1:1 allocation constraints uq_investor_commission_allocations_cheque and uq_investor_commission_allocations_obligation.
--   8. RLS enabled on all tables; direct permissions revoked; explicit GRANT to service_role.
-- ==============================================================================

-- ==============================================================================
-- PRE-REQUISITE COMPOSITE UNIQUE CONSTRAINTS (CHECKED SAFELY VIA PG_CONSTRAINT)
-- ==============================================================================

-- 1. Ensure composite unique constraint on public.investor_profiles(organization_id, person_id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_investor_profiles_org_person'
    ) THEN
        ALTER TABLE public.investor_profiles ADD CONSTRAINT uq_investor_profiles_org_person UNIQUE (organization_id, person_id);
    END IF;
END $$;

-- 2. Ensure composite unique constraint on public.cheques(organization_id, id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_cheques_org_composite'
    ) THEN
        ALTER TABLE public.cheques ADD CONSTRAINT uq_cheques_org_composite UNIQUE (organization_id, id);
    END IF;
END $$;

-- ==============================================================================
-- 1. INVESTOR CONTRACTS TABLE (جدول قراردادهای سرمایه‌گذاری)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.investor_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    investor_person_id UUID NOT NULL,
    contract_number TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    initial_capital NUMERIC(18, 0) NOT NULL CHECK (initial_capital >= 0),
    current_capital NUMERIC(18, 0) NOT NULL CHECK (current_capital >= 0),
    monthly_fee_rate NUMERIC(8, 4) NOT NULL CHECK (monthly_fee_rate >= 0),
    payment_frequency TEXT NOT NULL CHECK (payment_frequency IN ('monthly', 'bimonthly', 'quarterly', 'semi_annual', 'annual')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'renewed', 'terminated', 'paused')),
    notes TEXT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_investor_contracts_org_num UNIQUE (organization_id, contract_number),
    CONSTRAINT uq_investor_contracts_org_composite UNIQUE (organization_id, id),
    CONSTRAINT fk_investor_contracts_profile FOREIGN KEY (organization_id, investor_person_id)
        REFERENCES public.investor_profiles(organization_id, person_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.investor_contracts IS 'LOCAL CANDIDATE — Authoritative relational storage for investor contracts per organization.';

-- ==============================================================================
-- 2. INVESTOR PAYMENT SCHEDULES TABLE (جدول برنامه پرداخت کارمزد/اصل سرمایه)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.investor_payment_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    contract_id UUID NOT NULL,
    investor_person_id UUID NOT NULL,
    due_date DATE NOT NULL,
    expected_amount NUMERIC(18, 0) NOT NULL CHECK (expected_amount > 0),
    payment_type TEXT NOT NULL CHECK (payment_type IN ('FEE', 'CAPITAL_PRINCIPAL', 'CONTRACT_ADJUSTMENT')),
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'DUE', 'PAID', 'CANCELLED')),
    voucher_id UUID NULL,
    notes TEXT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_investor_payment_schedules_org_composite UNIQUE (organization_id, id),
    CONSTRAINT fk_investor_schedules_contract FOREIGN KEY (organization_id, contract_id)
        REFERENCES public.investor_contracts(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_investor_schedules_profile FOREIGN KEY (organization_id, investor_person_id)
        REFERENCES public.investor_profiles(organization_id, person_id) ON DELETE RESTRICT,
    CONSTRAINT fk_investor_schedules_voucher FOREIGN KEY (organization_id, voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.investor_payment_schedules IS 'LOCAL CANDIDATE — Planned payment schedules for investor fee and principal repayments.';

-- ==============================================================================
-- 3. INVESTOR PAYMENT OBLIGATIONS TABLE (جدول تعهدات پرداخت سرمایه‌گذار)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.investor_payment_obligations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    contract_id UUID NOT NULL,
    investor_person_id UUID NOT NULL,
    obligation_type TEXT NOT NULL CHECK (obligation_type IN ('FEE', 'CAPITAL_PRINCIPAL', 'CONTRACT_ADJUSTMENT')),
    amount NUMERIC(18, 0) NOT NULL CHECK (amount > 0),
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'DUE', 'PAID', 'CANCELLED', 'ADJUSTED')),
    payment_method TEXT NOT NULL DEFAULT 'UNSPECIFIED' CHECK (payment_method IN ('BANK_TRANSFER', 'CHECK', 'CASH', 'UNSPECIFIED')),
    notes TEXT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_investor_payment_obligations_org_composite UNIQUE (organization_id, id),
    CONSTRAINT fk_investor_obligations_contract FOREIGN KEY (organization_id, contract_id)
        REFERENCES public.investor_contracts(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_investor_obligations_profile FOREIGN KEY (organization_id, investor_person_id)
        REFERENCES public.investor_profiles(organization_id, person_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.investor_payment_obligations IS 'LOCAL CANDIDATE — Explicit investor payment obligations distinguishing FEE from CAPITAL_PRINCIPAL.';

-- ==============================================================================
-- 4. EXPLICIT COMMISSION CHEQUE ALLOCATION TABLE (جدول تخصیص صریح چک کارمزد)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.investor_commission_cheque_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    cheque_id UUID NOT NULL,
    obligation_id UUID NOT NULL,
    investor_person_id UUID NOT NULL,
    reclassification_voucher_id UUID NOT NULL,
    allocation_status TEXT NOT NULL DEFAULT 'PENDING_REALIZATION' CHECK (allocation_status IN ('PENDING_REALIZATION', 'REALIZED', 'REVERSED')),
    classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    classified_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    realized_at TIMESTAMPTZ NULL,
    realized_by UUID NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    realization_voucher_id UUID NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_investor_allocations_org_composite UNIQUE (organization_id, id),
    CONSTRAINT uq_investor_commission_allocations_cheque UNIQUE (cheque_id),
    CONSTRAINT uq_investor_commission_allocations_obligation UNIQUE (obligation_id),
    CONSTRAINT fk_allocations_cheque FOREIGN KEY (organization_id, cheque_id)
        REFERENCES public.cheques(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_allocations_obligation FOREIGN KEY (organization_id, obligation_id)
        REFERENCES public.investor_payment_obligations(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_allocations_profile FOREIGN KEY (organization_id, investor_person_id)
        REFERENCES public.investor_profiles(organization_id, person_id) ON DELETE RESTRICT,
    CONSTRAINT fk_allocations_reclass_voucher FOREIGN KEY (organization_id, reclassification_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_allocations_realize_voucher FOREIGN KEY (organization_id, realization_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.investor_commission_cheque_allocations IS 'LOCAL CANDIDATE — Explicit allocation table linking a cheque to a fee obligation. investor_id on cheques is NOT a commission marker.';

-- ==============================================================================
-- 5. AUTHORIZED BANK ACCOUNTS REGISTRY TABLE (جدول ثبت حساب‌های بانکی مجاز سازمان)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.org_bank_account_mappings (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    account_subsidiary_id UUID NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_default BOOLEAN NOT NULL DEFAULT false,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    CONSTRAINT uq_org_bank_account_mapping UNIQUE (organization_id, account_subsidiary_id),
    CONSTRAINT fk_org_bank_account_subsidiary FOREIGN KEY (organization_id, account_subsidiary_id)
        REFERENCES public.account_subsidiaries(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.org_bank_account_mappings IS 'LOCAL CANDIDATE — Authoritative registry of authorized bank subsidiary accounts per organization.';

-- Partial unique index for maximum 1 active default bank account per organization
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_bank_account_active_default
ON public.org_bank_account_mappings(organization_id)
WHERE (is_active = true AND is_default = true);

-- Controlled draft transfer of existing CURRENT ROLE_BANK_MAIN mappings to org_bank_account_mappings
DO $$
DECLARE
    r RECORD;
    v_mapping_count INT;
BEGIN
    FOR r IN SELECT DISTINCT organization_id FROM public.org_financial_role_mappings WHERE role_code = 'ROLE_BANK_MAIN' AND status = 'CURRENT' LOOP
        SELECT pg_catalog.count(*) INTO v_mapping_count
        FROM public.org_financial_role_mappings
        WHERE organization_id = r.organization_id AND role_code = 'ROLE_BANK_MAIN' AND status = 'CURRENT';

        IF v_mapping_count > 1 THEN
            RAISE EXCEPTION 'ERR_PRECONDITION_FAILED: Organization % has % CURRENT ROLE_BANK_MAIN mappings. Controlled migration requires exactly 1 or 0.', r.organization_id, v_mapping_count;
        END IF;
    END LOOP;

    INSERT INTO public.org_bank_account_mappings (
        organization_id, account_subsidiary_id, is_active, is_default, version, created_at, updated_at
    )
    SELECT 
        m.organization_id,
        m.subsidiary_id,
        true AS is_active,
        true AS is_default,
        1 AS version,
        pg_catalog.clock_timestamp(),
        pg_catalog.clock_timestamp()
    FROM public.org_financial_role_mappings m
    JOIN public.account_subsidiaries s ON s.organization_id = m.organization_id AND s.id = m.subsidiary_id
    WHERE m.role_code = 'ROLE_BANK_MAIN'
      AND m.status = 'CURRENT'
      AND s.is_active = true
    ON CONFLICT (organization_id, account_subsidiary_id) DO UPDATE SET
        is_active = true,
        is_default = true,
        updated_at = pg_catalog.clock_timestamp();
END $$;

-- ==============================================================================
-- INDEXES FOR FAST LOOKUPS & SEARCHES (COMPOSITE FOREIGN KEY INDEXES)
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_investor_contracts_org_profile ON public.investor_contracts(organization_id, investor_person_id);
CREATE INDEX IF NOT EXISTS idx_investor_contracts_org_status ON public.investor_contracts(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_investor_schedules_org_contract ON public.investor_payment_schedules(organization_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_investor_schedules_org_profile ON public.investor_payment_schedules(organization_id, investor_person_id);
CREATE INDEX IF NOT EXISTS idx_investor_schedules_org_due ON public.investor_payment_schedules(organization_id, due_date);
CREATE INDEX IF NOT EXISTS idx_investor_obligations_org_contract ON public.investor_payment_obligations(organization_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_investor_obligations_org_profile ON public.investor_payment_obligations(organization_id, investor_person_id);
CREATE INDEX IF NOT EXISTS idx_investor_obligations_org_type ON public.investor_payment_obligations(organization_id, obligation_type);
CREATE INDEX IF NOT EXISTS idx_investor_allocations_org_cheque ON public.investor_commission_cheque_allocations(organization_id, cheque_id);
CREATE INDEX IF NOT EXISTS idx_investor_allocations_org_obligation ON public.investor_commission_cheque_allocations(organization_id, obligation_id);
CREATE INDEX IF NOT EXISTS idx_investor_allocations_org_profile ON public.investor_commission_cheque_allocations(organization_id, investor_person_id);
CREATE INDEX IF NOT EXISTS idx_org_bank_account_mappings_org_active ON public.org_bank_account_mappings(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_org_bank_account_mappings_subsidiary ON public.org_bank_account_mappings(organization_id, account_subsidiary_id);

-- ==============================================================================
-- ROW LEVEL SECURITY, REVOKE, AND SERVICE_ROLE EXCLUSIVE PERMISSIONS
-- ==============================================================================
ALTER TABLE public.investor_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_payment_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investor_commission_cheque_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_bank_account_mappings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.investor_contracts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.investor_payment_schedules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.investor_payment_obligations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.investor_commission_cheque_allocations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.org_bank_account_mappings FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.investor_contracts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.investor_payment_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.investor_payment_obligations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.investor_commission_cheque_allocations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_bank_account_mappings TO service_role;
