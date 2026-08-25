BEGIN;

-- ==============================================================================
-- Migration: 05_journal_vouchers.sql
-- Description: Phase 3-F - Double-Entry Journal Vouchers, Reversal Lifecycle & Atomic Sequencing Architecture
-- Key Architecture & Rules (Decision 26 & 27):
--   1. Strict Voucher Status Lifecycle:
--      - DRAFT: Draft voucher with zero financial effect. Has no legal voucher number and can be CANCELLED.
--      - POSTED: Finalized posted voucher with assigned sequential legal voucher_number.
--      - REVERSED: Original posted voucher that was voided. Remains permanently in ledger and calculations.
--      - CANCELLED: Pre-posting cancelled draft with zero financial effect and no sequence consumption.
--   2. Reversal Voucher Lifecycle & Kind (GENERAL vs REVERSAL):
--      - REVERSAL is a voucher_kind, NOT a separate status!
--      - Reversal voucher is created as DRAFT first, entries inserted with swapped debit/credit, balanced,
--        sequence locked, and then transitioned to POSTED.
--      - Original voucher transitions to REVERSED only after reversal voucher is finalized POSTED.
--      - Single direction reversal link via reversal_of_voucher_id pointing to original voucher.
--      - Reversal vouchers cannot be reversed directly (Decision 27).
--   3. Atomic Voucher Numbering:
--      - FOR UPDATE row lock on public.voucher_sequences (org + fiscal year).
--      - Sequence numbers assigned exclusively upon POSTED state transition.
--      - MAX(voucher_number)+1, client-side generation, and gap-filling are strictly forbidden.
--   4. Idempotency & Operation Locking:
--      - public.voucher_operation_keys tracks unique operation keys per organization to prevent duplicate submissions.
-- ==============================================================================

-- ==============================================================================
-- 1. COST CENTERS (جدول مراکز هزینه)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.cost_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT uq_cost_center_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_cost_center_org_composite UNIQUE (organization_id, id)
);

COMMENT ON TABLE public.cost_centers IS 'Cost centers for detailed financial cost distribution per organization.';

-- Trigger for cost_centers versioning
CREATE OR REPLACE FUNCTION public.trg_increment_cost_center_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cost_centers_version ON public.cost_centers;
CREATE TRIGGER trg_cost_centers_version
BEFORE UPDATE ON public.cost_centers
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_cost_center_version();

-- Prevent physical deletion of cost centers if referenced in financial entries
CREATE OR REPLACE FUNCTION public.prevent_cost_center_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.voucher_entries
        WHERE cost_center_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'Physical deletion of cost center % is forbidden because it has associated financial entries.', OLD.code;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_cost_center_deletion ON public.cost_centers;
CREATE TRIGGER trg_prevent_cost_center_deletion
BEFORE DELETE ON public.cost_centers
FOR EACH ROW EXECUTE FUNCTION public.prevent_cost_center_deletion();

-- ==============================================================================
-- 2. VOUCHER SEQUENCES (جدول شمارنده اسناد قطعی)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.voucher_sequences (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL,
    next_number BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    PRIMARY KEY (organization_id, fiscal_year_id),
    CONSTRAINT fk_voucher_seq_fiscal_year FOREIGN KEY (organization_id, fiscal_year_id)
        REFERENCES public.fiscal_years(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.voucher_sequences IS 'Atomic sequence counter for sequential voucher numbers per organization and fiscal year.';

-- ==============================================================================
-- 3. JOURNAL VOUCHERS HEADER (جدول سربرگ اسناد حسابداری)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.journal_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID NOT NULL,
    fiscal_year_id UUID NOT NULL,
    voucher_number BIGINT,
    voucher_date DATE NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED', 'CANCELLED')),
    voucher_kind TEXT NOT NULL DEFAULT 'GENERAL' CHECK (voucher_kind IN ('GENERAL', 'REVERSAL')),
    is_automatic BOOLEAN NOT NULL DEFAULT false,
    source_type TEXT,
    source_id UUID,
    source_event_key TEXT,
    contract_type TEXT,
    reversal_of_voucher_id UUID,
    version INT NOT NULL DEFAULT 1,
    created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    posted_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    posted_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    reversed_at TIMESTAMPTZ,
    reversal_reason TEXT,
    cancelled_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    CONSTRAINT uq_journal_voucher_org_composite UNIQUE (organization_id, id),
    CONSTRAINT fk_jv_branch FOREIGN KEY (organization_id, branch_id)
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_jv_fiscal_year FOREIGN KEY (organization_id, fiscal_year_id)
        REFERENCES public.fiscal_years(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_jv_reversal_of FOREIGN KEY (organization_id, reversal_of_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_jv_no_self_reversal CHECK (reversal_of_voucher_id IS NULL OR reversal_of_voucher_id <> id),
    CONSTRAINT chk_jv_number_by_status CHECK (
        (status = 'DRAFT' AND voucher_number IS NULL AND posted_at IS NULL AND posted_by IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR
        (status = 'CANCELLED' AND voucher_number IS NULL AND posted_at IS NULL AND posted_by IS NULL AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0) OR
        (status = 'POSTED' AND voucher_number IS NOT NULL AND voucher_number > 0 AND posted_at IS NOT NULL AND posted_by IS NOT NULL AND reversed_at IS NULL AND reversed_by IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR
        (status = 'REVERSED' AND voucher_number IS NOT NULL AND voucher_number > 0 AND posted_at IS NOT NULL AND posted_by IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL AND length(trim(reversal_reason)) > 0)
    ),
    CONSTRAINT chk_jv_reversal_kind_ref CHECK (
        (voucher_kind = 'REVERSAL' AND reversal_of_voucher_id IS NOT NULL) OR
        (voucher_kind = 'GENERAL' AND reversal_of_voucher_id IS NULL)
    ),
    CONSTRAINT chk_jv_automatic_source CHECK (
        (is_automatic = false AND voucher_kind = 'GENERAL') OR
        (is_automatic = true AND voucher_kind = 'GENERAL' AND source_type IS NOT NULL AND source_id IS NOT NULL AND source_event_key IS NOT NULL) OR
        (voucher_kind = 'REVERSAL' AND is_automatic = true AND source_event_key IS NULL)
    )
);

COMMENT ON TABLE public.journal_vouchers IS 'Double-entry journal voucher headers with strict lifecycle status and kind management.';

-- Unique Partial Indexes for Integrity & Idempotency
CREATE UNIQUE INDEX IF NOT EXISTS uq_jv_voucher_number_per_org_fy
ON public.journal_vouchers(organization_id, fiscal_year_id, voucher_number)
WHERE voucher_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_jv_source_event_key_per_org
ON public.journal_vouchers(organization_id, source_type, source_id, source_event_key)
WHERE source_event_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_jv_one_reversal_of_per_voucher
ON public.journal_vouchers(organization_id, reversal_of_voucher_id)
WHERE reversal_of_voucher_id IS NOT NULL;

-- Trigger for journal_vouchers versioning
CREATE OR REPLACE FUNCTION public.trg_increment_jv_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_vouchers_version ON public.journal_vouchers;
CREATE TRIGGER trg_journal_vouchers_version
BEFORE UPDATE ON public.journal_vouchers
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_jv_version();

-- ==============================================================================
-- 4. VOUCHER ENTRIES (جدول ردیف‌های سند حسابداری)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.voucher_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    voucher_id UUID NOT NULL,
    row_number INT NOT NULL,
    subsidiary_id UUID NOT NULL,
    person_id UUID,
    cost_center_id UUID,
    financial_role_code TEXT REFERENCES public.system_financial_roles(role_code) ON DELETE RESTRICT,
    debit NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    description TEXT,
    contract_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ve_row_number UNIQUE (voucher_id, row_number),
    CONSTRAINT fk_ve_voucher FOREIGN KEY (organization_id, voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_ve_subsidiary FOREIGN KEY (organization_id, subsidiary_id)
        REFERENCES public.account_subsidiaries(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_ve_person FOREIGN KEY (organization_id, person_id)
        REFERENCES public.persons(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_ve_cost_center FOREIGN KEY (organization_id, cost_center_id)
        REFERENCES public.cost_centers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_ve_single_side CHECK (
        (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
    )
);

COMMENT ON TABLE public.voucher_entries IS 'Detailed debit and credit rows for double-entry journal vouchers.';

-- ==============================================================================
-- 5. VOUCHER OPERATION KEYS (جدول کلیدهای عملیاتی یکتا برای جلوگیری از ثبت تکراری)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.voucher_operation_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    operation_key TEXT NOT NULL,
    operation_type TEXT NOT NULL CHECK (operation_type IN ('POST_VOUCHER', 'REVERSE_VOUCHER', 'CANCEL_DRAFT_VOUCHER')),
    request_fingerprint TEXT NOT NULL,
    target_voucher_id UUID NOT NULL,
    result_voucher_id UUID,
    created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_voucher_op_key_per_org UNIQUE (organization_id, operation_key),
    CONSTRAINT fk_vok_target_voucher FOREIGN KEY (organization_id, target_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_vok_result_voucher FOREIGN KEY (organization_id, result_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_vok_completed_pair CHECK (
        (result_voucher_id IS NULL AND completed_at IS NULL) OR
        (result_voucher_id IS NOT NULL AND completed_at IS NOT NULL)
    ),
    CONSTRAINT chk_vok_non_empty_key_fp CHECK (
        length(trim(operation_key)) > 0 AND length(trim(request_fingerprint)) > 0
    ),
    CONSTRAINT chk_vok_result_voucher_match CHECK (
        (result_voucher_id IS NULL) OR
        (operation_type IN ('POST_VOUCHER', 'CANCEL_DRAFT_VOUCHER') AND result_voucher_id = target_voucher_id) OR
        (operation_type = 'REVERSE_VOUCHER' AND result_voucher_id <> target_voucher_id)
    )
);

COMMENT ON TABLE public.voucher_operation_keys IS 'Idempotency and concurrency locks ensuring server-side duplicate transaction prevention.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vok_target_op_per_org
ON public.voucher_operation_keys(organization_id, operation_type, target_voucher_id);

-- Prevent unauthorized modification or deletion of operation keys
CREATE OR REPLACE FUNCTION public.prevent_op_key_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Deletion of voucher operation keys is strictly forbidden.';
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.completed_at IS NOT NULL OR OLD.result_voucher_id IS NOT NULL THEN
            RAISE EXCEPTION 'Completed voucher operation keys are immutable and cannot be updated.';
        END IF;
        IF NEW.completed_at IS NULL OR NEW.result_voucher_id IS NULL THEN
            RAISE EXCEPTION 'Operation key records must be updated with both result_voucher_id and completed_at.';
        END IF;
        IF NEW.id IS DISTINCT FROM OLD.id OR
           NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
           NEW.operation_key IS DISTINCT FROM OLD.operation_key OR
           NEW.operation_type IS DISTINCT FROM OLD.operation_type OR
           NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint OR
           NEW.target_voucher_id IS DISTINCT FROM OLD.target_voucher_id OR
           NEW.created_by IS DISTINCT FROM OLD.created_by OR
           NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'Core operation key parameters cannot be altered.';
        END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_op_key_modification ON public.voucher_operation_keys;
CREATE TRIGGER trg_prevent_op_key_modification
BEFORE UPDATE OR DELETE ON public.voucher_operation_keys
FOR EACH ROW EXECUTE FUNCTION public.prevent_op_key_modification();

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_jv_org_status ON public.journal_vouchers(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_jv_org_fy_num ON public.journal_vouchers(organization_id, fiscal_year_id, voucher_number);
CREATE INDEX IF NOT EXISTS idx_jv_source ON public.journal_vouchers(organization_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ve_voucher ON public.voucher_entries(voucher_id);
CREATE INDEX IF NOT EXISTS idx_ve_subsidiary ON public.voucher_entries(organization_id, subsidiary_id);
CREATE INDEX IF NOT EXISTS idx_ve_person ON public.voucher_entries(organization_id, person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ve_cost_center ON public.voucher_entries(organization_id, cost_center_id) WHERE cost_center_id IS NOT NULL;

-- ==============================================================================
-- 6. SECURITY HELPER FUNCTION FOR BRANCH PERMISSION CONTROL
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.has_branch_permission(
    p_organization_id UUID,
    p_branch_id UUID,
    p_permission_code TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    JOIN public.user_profiles up ON up.id = om.user_id
    JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_organization_id
      AND om.is_active = true
      AND up.is_active = true
      AND (ur.branch_id IS NULL OR ur.branch_id = p_branch_id)
      AND p.code = p_permission_code
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_branch_permission(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_branch_permission(UUID, UUID, TEXT) TO authenticated;

-- ==============================================================================
-- 7. POSTED VOUCHER & ROW PROTECTION TRIGGERS (حفاظت از وضعیت سند و ردیف‌ها)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.prevent_posted_voucher_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Physical deletion of journal vouchers (ID: %) is strictly forbidden.', OLD.id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'DRAFT' THEN
            IF NEW.status NOT IN ('DRAFT', 'POSTED', 'CANCELLED') THEN
                RAISE EXCEPTION 'Invalid status transition for draft voucher % to %.', OLD.id, NEW.status;
            END IF;
        ELSIF OLD.status = 'POSTED' THEN
            IF NEW.status = 'REVERSED' THEN
                IF NEW.id IS DISTINCT FROM OLD.id OR
                   NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
                   NEW.branch_id IS DISTINCT FROM OLD.branch_id OR
                   NEW.fiscal_year_id IS DISTINCT FROM OLD.fiscal_year_id OR
                   NEW.voucher_number IS DISTINCT FROM OLD.voucher_number OR
                   NEW.voucher_date IS DISTINCT FROM OLD.voucher_date OR
                   NEW.description IS DISTINCT FROM OLD.description OR
                   NEW.voucher_kind IS DISTINCT FROM OLD.voucher_kind OR
                   NEW.is_automatic IS DISTINCT FROM OLD.is_automatic OR
                   NEW.source_type IS DISTINCT FROM OLD.source_type OR
                   NEW.source_id IS DISTINCT FROM OLD.source_id OR
                   NEW.source_event_key IS DISTINCT FROM OLD.source_event_key OR
                   NEW.contract_type IS DISTINCT FROM OLD.contract_type OR
                   NEW.reversal_of_voucher_id IS DISTINCT FROM OLD.reversal_of_voucher_id OR
                   NEW.created_by IS DISTINCT FROM OLD.created_by OR
                   NEW.created_at IS DISTINCT FROM OLD.created_at OR
                   NEW.posted_by IS DISTINCT FROM OLD.posted_by OR
                   NEW.posted_at IS DISTINCT FROM OLD.posted_at OR
                   NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by OR
                   NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR
                   NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason THEN
                    RAISE EXCEPTION 'Core voucher fields cannot be altered when transitioning from POSTED to REVERSED.';
                END IF;
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Posted vouchers (ID: %) can only transition to REVERSED status.', OLD.id;
            END IF;
        ELSIF OLD.status IN ('REVERSED', 'CANCELLED') THEN
            RAISE EXCEPTION 'Reversed or cancelled vouchers (ID: %) are immutable and cannot be updated.', OLD.id;
        END IF;

        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_jv_modification ON public.journal_vouchers;
CREATE TRIGGER trg_prevent_jv_modification
BEFORE UPDATE OR DELETE ON public.journal_vouchers
FOR EACH ROW EXECUTE FUNCTION public.prevent_posted_voucher_modification();

CREATE OR REPLACE FUNCTION public.prevent_posted_voucher_entry_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_status TEXT;
    v_target_voucher_id UUID;
    v_target_org_id UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.voucher_id <> OLD.voucher_id OR NEW.organization_id <> OLD.organization_id THEN
            RAISE EXCEPTION 'Transferring voucher entries between vouchers or organizations is strictly forbidden.';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_target_voucher_id := OLD.voucher_id;
        v_target_org_id := OLD.organization_id;
    ELSE
        v_target_voucher_id := NEW.voucher_id;
        v_target_org_id := NEW.organization_id;
    END IF;

    SELECT status INTO v_status
    FROM public.journal_vouchers
    WHERE id = v_target_voucher_id AND organization_id = v_target_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated journal voucher (ID: %, Org: %) not found.', v_target_voucher_id, v_target_org_id;
    END IF;

    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Entries can only be modified for DRAFT vouchers. Voucher % status is %.', v_target_voucher_id, v_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_ve_modification ON public.voucher_entries;
CREATE TRIGGER trg_prevent_ve_modification
BEFORE INSERT OR UPDATE OR DELETE ON public.voucher_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_posted_voucher_entry_modification();

-- ==============================================================================
-- 8. ATOMIC POST VOUCHER FUNCTION (تابع قطعیسازی سند)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.post_journal_voucher(
    p_organization_id UUID,
    p_voucher_id UUID,
    p_expected_version INT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_voucher RECORD;
    v_entry_count INT;
    v_total_debit NUMERIC(18, 0);
    v_total_credit NUMERIC(18, 0);
    v_fiscal_year_id UUID;
    v_fy_closed BOOLEAN;
    v_fp_count INT;
    v_period_closed BOOLEAN;
    v_next_num BIGINT;
    v_invalid_entry RECORD;
    v_existing_op RECORD;
    v_op_key_id UUID;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required: auth.uid() is null.';
    END IF;

    -- 2. Mandatory Parameter Validation
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'Parameter p_expected_version is required.';
    END IF;
    IF p_operation_key IS NULL OR trim(p_operation_key) = '' THEN
        RAISE EXCEPTION 'Parameter p_operation_key is required.';
    END IF;
    IF p_request_fingerprint IS NULL OR trim(p_request_fingerprint) = '' THEN
        RAISE EXCEPTION 'Parameter p_request_fingerprint is required.';
    END IF;

    -- 3. Lock Voucher Header FOR UPDATE first
    SELECT * INTO v_voucher
    FROM public.journal_vouchers
    WHERE id = p_voucher_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal voucher % not found in organization %.', p_voucher_id, p_organization_id;
    END IF;

    -- 4. Check Branch Permission (finance:approve)
    IF NOT public.has_branch_permission(p_organization_id, v_voucher.branch_id, 'finance:approve') THEN
        RAISE EXCEPTION 'Permission denied: Required finance:approve permission is missing for branch %.', v_voucher.branch_id;
    END IF;

    -- 5. Idempotency Check on Operation Key
    SELECT * INTO v_existing_op
    FROM public.voucher_operation_keys
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_op.operation_type <> 'POST_VOUCHER' OR
           v_existing_op.target_voucher_id <> p_voucher_id OR
           v_existing_op.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Operation key conflict: Mismatched operation parameters or request fingerprint for key %.', p_operation_key;
        END IF;

        IF v_existing_op.completed_at IS NOT NULL THEN
            SELECT voucher_number INTO v_next_num
            FROM public.journal_vouchers
            WHERE id = v_existing_op.result_voucher_id AND organization_id = p_organization_id;
            RETURN v_next_num;
        ELSE
            RAISE EXCEPTION 'Operation with key % is currently in progress.', p_operation_key;
        END IF;
    END IF;

    -- 6. Validate Status, Kind & Version BEFORE reserving operation key
    IF v_voucher.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Cannot post voucher % with status %. Posting is only allowed for DRAFT vouchers.', p_voucher_id, v_voucher.status;
    END IF;

    IF v_voucher.voucher_kind = 'REVERSAL' THEN
        RAISE EXCEPTION 'Direct posting of REVERSAL kind vouchers is forbidden. Reversal vouchers are posted exclusively via reverse_journal_voucher.';
    END IF;

    IF v_voucher.version <> p_expected_version THEN
        RAISE EXCEPTION 'Concurrency conflict: Voucher version % does not match expected version %.',
            v_voucher.version, p_expected_version;
    END IF;

    -- 7. Reserve Operation Key (ONLY after passing all validation checks above)
    INSERT INTO public.voucher_operation_keys (
        organization_id, operation_key, operation_type, request_fingerprint, target_voucher_id, created_by
    ) VALUES (
        p_organization_id, p_operation_key, 'POST_VOUCHER', p_request_fingerprint, p_voucher_id, v_auth_uid
    ) RETURNING id INTO v_op_key_id;

    -- 8. Validate Entries Count >= 2
    SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_entry_count, v_total_debit, v_total_credit
    FROM public.voucher_entries
    WHERE voucher_id = p_voucher_id AND organization_id = p_organization_id;

    IF v_entry_count < 2 THEN
        RAISE EXCEPTION 'Voucher % must contain at least 2 entries (current count: %).', p_voucher_id, v_entry_count;
    END IF;

    -- 9. Validate Balance & Non-Zero Total
    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'Voucher % is not balanced: Total Debit % differs from Total Credit %.',
            p_voucher_id, v_total_debit, v_total_credit;
    END IF;

    IF v_total_debit <= 0 THEN
        RAISE EXCEPTION 'Voucher % total amount must be strictly greater than zero.', p_voucher_id;
    END IF;

    -- 10. Validate Subsidiary Accounts, Persons, Cost Centers
    FOR v_invalid_entry IN
        SELECT ve.id, ve.row_number, ve.subsidiary_id, ve.person_id, ve.cost_center_id,
               sub.code AS sub_code, sub.is_active AS sub_active,
               sub.requires_person, sub.requires_cost_center
        FROM public.voucher_entries ve
        JOIN public.account_subsidiaries sub ON sub.id = ve.subsidiary_id AND sub.organization_id = p_organization_id
        WHERE ve.voucher_id = p_voucher_id AND ve.organization_id = p_organization_id
    LOOP
        IF NOT v_invalid_entry.sub_active THEN
            RAISE EXCEPTION 'Entry row % uses inactive subsidiary account %.', v_invalid_entry.row_number, v_invalid_entry.sub_code;
        END IF;

        IF v_invalid_entry.requires_person AND v_invalid_entry.person_id IS NULL THEN
            RAISE EXCEPTION 'Entry row % with account % requires a valid person reference.', v_invalid_entry.row_number, v_invalid_entry.sub_code;
        END IF;

        IF v_invalid_entry.requires_cost_center AND v_invalid_entry.cost_center_id IS NULL THEN
            RAISE EXCEPTION 'Entry row % with account % requires a valid cost center reference.', v_invalid_entry.row_number, v_invalid_entry.sub_code;
        END IF;
    END LOOP;

    -- 11. Validate Fiscal Year & Fiscal Period Date Range & Open Status
    SELECT id, is_closed INTO v_fiscal_year_id, v_fy_closed
    FROM public.fiscal_years
    WHERE id = v_voucher.fiscal_year_id AND organization_id = p_organization_id
      AND start_date <= v_voucher.voucher_date
      AND end_date >= v_voucher.voucher_date;

    IF v_fiscal_year_id IS NULL THEN
        RAISE EXCEPTION 'Voucher date % does not fall within specified fiscal year % for organization %.',
            v_voucher.voucher_date, v_voucher.fiscal_year_id, p_organization_id;
    END IF;

    IF v_fy_closed THEN
        RAISE EXCEPTION 'Fiscal year for date % is closed. Posting is forbidden.', v_voucher.voucher_date;
    END IF;

    SELECT COUNT(*), COALESCE(bool_or(is_closed), false)
    INTO v_fp_count, v_period_closed
    FROM public.fiscal_periods
    WHERE organization_id = p_organization_id
      AND fiscal_year_id = v_fiscal_year_id
      AND start_date <= v_voucher.voucher_date
      AND end_date >= v_voucher.voucher_date;

    IF v_fp_count <> 1 THEN
        RAISE EXCEPTION 'Voucher date % must match exactly one defined fiscal period (found %). Posting is forbidden.',
            v_voucher.voucher_date, v_fp_count;
    END IF;

    IF v_period_closed IS TRUE THEN
        RAISE EXCEPTION 'Fiscal period for date % is closed. Posting is forbidden.', v_voucher.voucher_date;
    END IF;

    -- 12. Lock Sequence & Assign Sequential Legal Voucher Number
    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_fiscal_year_id, 1, v_auth_uid)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_next_num
    FROM public.voucher_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fiscal_year_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_by = v_auth_uid,
        updated_at = now()
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fiscal_year_id;

    -- 13. Finalize Voucher Header to POSTED Status
    UPDATE public.journal_vouchers
    SET fiscal_year_id = v_fiscal_year_id,
        voucher_number = v_next_num,
        status = 'POSTED',
        posted_by = v_auth_uid,
        posted_at = now(),
        updated_at = now()
    WHERE id = p_voucher_id AND organization_id = p_organization_id;

    -- 14. Complete Operation Key Record
    UPDATE public.voucher_operation_keys
    SET result_voucher_id = p_voucher_id,
        completed_at = now()
    WHERE id = v_op_key_id;

    RETURN v_next_num;
END;
$$;

-- ==============================================================================
-- 9. ATOMIC REVERSE VOUCHER FUNCTION (تابع معکوسسازی و ابطال قطعی)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.reverse_journal_voucher(
    p_organization_id UUID,
    p_original_voucher_id UUID,
    p_reversal_fiscal_year_id UUID,
    p_reversal_date DATE,
    p_reversal_reason TEXT,
    p_expected_version INT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_orig RECORD;
    v_reversal_fy_id UUID;
    v_fy_closed BOOLEAN;
    v_fp_count INT;
    v_period_closed BOOLEAN;
    v_reversal_voucher_num BIGINT;
    v_reversal_id UUID;
    v_entry RECORD;
    v_entry_count INT;
    v_total_debit NUMERIC(18, 0);
    v_total_credit NUMERIC(18, 0);
    v_existing_op RECORD;
    v_op_key_id UUID;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required: auth.uid() is null.';
    END IF;

    -- 2. Mandatory Parameter Validation
    IF p_reversal_reason IS NULL OR trim(p_reversal_reason) = '' THEN
        RAISE EXCEPTION 'Reversal reason is mandatory for voiding a posted voucher.';
    END IF;
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'Parameter p_expected_version is required.';
    END IF;
    IF p_operation_key IS NULL OR trim(p_operation_key) = '' THEN
        RAISE EXCEPTION 'Parameter p_operation_key is required.';
    END IF;
    IF p_request_fingerprint IS NULL OR trim(p_request_fingerprint) = '' THEN
        RAISE EXCEPTION 'Parameter p_request_fingerprint is required.';
    END IF;

    -- 3. Lock Original Voucher Header FOR UPDATE first
    SELECT * INTO v_orig
    FROM public.journal_vouchers
    WHERE id = p_original_voucher_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original voucher % not found in organization %.', p_original_voucher_id, p_organization_id;
    END IF;

    -- 4. Check Branch Permission (finance:approve)
    IF NOT public.has_branch_permission(p_organization_id, v_orig.branch_id, 'finance:approve') THEN
        RAISE EXCEPTION 'Permission denied: Required finance:approve permission is missing for branch %.', v_orig.branch_id;
    END IF;

    -- 5. Idempotency Check
    SELECT * INTO v_existing_op
    FROM public.voucher_operation_keys
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_op.operation_type <> 'REVERSE_VOUCHER' OR
           v_existing_op.target_voucher_id <> p_original_voucher_id OR
           v_existing_op.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Operation key conflict: Mismatched operation parameters or request fingerprint for key %.', p_operation_key;
        END IF;

        IF v_existing_op.completed_at IS NOT NULL THEN
            RETURN v_existing_op.result_voucher_id;
        ELSE
            RAISE EXCEPTION 'Operation with key % is currently in progress.', p_operation_key;
        END IF;
    END IF;

    -- 6. Validate Voucher Kind, Status & Version BEFORE reserving operation key (Decision 27)
    IF v_orig.voucher_kind = 'REVERSAL' THEN
        RAISE EXCEPTION 'Cannot reverse a voucher of kind REVERSAL. Reversal vouchers cannot be reversed directly; subsequent adjustments must be made using an independent adjustment voucher.';
    END IF;

    IF v_orig.status <> 'POSTED' THEN
        RAISE EXCEPTION 'Only POSTED vouchers can be reversed. Current status of voucher % is %.',
            p_original_voucher_id, v_orig.status;
    END IF;

    IF v_orig.version <> p_expected_version THEN
        RAISE EXCEPTION 'Concurrency conflict: Original voucher version % does not match expected version %.',
            v_orig.version, p_expected_version;
    END IF;

    -- 7. Reserve Operation Key (ONLY after passing all validation checks above)
    INSERT INTO public.voucher_operation_keys (
        organization_id, operation_key, operation_type, request_fingerprint, target_voucher_id, created_by
    ) VALUES (
        p_organization_id, p_operation_key, 'REVERSE_VOUCHER', p_request_fingerprint, p_original_voucher_id, v_auth_uid
    ) RETURNING id INTO v_op_key_id;

    -- 8. Validate Reversal Date in Open Fiscal Year & Period
    SELECT id, is_closed INTO v_reversal_fy_id, v_fy_closed
    FROM public.fiscal_years
    WHERE id = p_reversal_fiscal_year_id AND organization_id = p_organization_id
      AND start_date <= p_reversal_date
      AND end_date >= p_reversal_date;

    IF v_reversal_fy_id IS NULL THEN
        RAISE EXCEPTION 'Reversal date % does not fall within specified fiscal year % for organization %.',
            p_reversal_date, p_reversal_fiscal_year_id, p_organization_id;
    END IF;

    IF v_fy_closed THEN
        RAISE EXCEPTION 'Fiscal year for reversal date % is closed.', p_reversal_date;
    END IF;

    SELECT COUNT(*), COALESCE(bool_or(is_closed), false)
    INTO v_fp_count, v_period_closed
    FROM public.fiscal_periods
    WHERE organization_id = p_organization_id
      AND fiscal_year_id = v_reversal_fy_id
      AND start_date <= p_reversal_date
      AND end_date >= p_reversal_date;

    IF v_fp_count <> 1 THEN
        RAISE EXCEPTION 'Reversal date % must match exactly one defined fiscal period (found %). Reversal is forbidden.',
            p_reversal_date, v_fp_count;
    END IF;

    IF v_period_closed IS TRUE THEN
        RAISE EXCEPTION 'Fiscal period for reversal date % is closed. Reversal must be posted in an open period.', p_reversal_date;
    END IF;

    -- 9. CREATE REVERSAL HEADER IN DRAFT STATUS
    v_reversal_id := gen_random_uuid();

    INSERT INTO public.journal_vouchers (
        id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date,
        description, status, voucher_kind, is_automatic, source_type, source_id, source_event_key, contract_type,
        reversal_of_voucher_id, created_by, posted_by, posted_at
    ) VALUES (
        v_reversal_id, p_organization_id, v_orig.branch_id, v_reversal_fy_id, NULL, p_reversal_date,
        'سند معکوس بابت ابطال سند شماره ' || v_orig.voucher_number || ': ' || p_reversal_reason,
        'DRAFT', 'REVERSAL', true, v_orig.source_type, v_orig.source_id, NULL, v_orig.contract_type,
        p_original_voucher_id, v_auth_uid, NULL, NULL
    );

    -- 10. Copy Entries Inverting Debit and Credit while Reversal Voucher is DRAFT
    FOR v_entry IN
        SELECT *
        FROM public.voucher_entries
        WHERE voucher_id = p_original_voucher_id AND organization_id = p_organization_id
        ORDER BY row_number ASC
    LOOP
        INSERT INTO public.voucher_entries (
            id, organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id,
            financial_role_code, debit, credit, description, contract_type
        ) VALUES (
            gen_random_uuid(), p_organization_id, v_reversal_id, v_entry.row_number,
            v_entry.subsidiary_id, v_entry.person_id, v_entry.cost_center_id,
            v_entry.financial_role_code,
            v_entry.credit, v_entry.debit, -- SWAPPED DEBIT & CREDIT
            'معکوس: ' || COALESCE(v_entry.description, ''),
            v_entry.contract_type
        );
    END LOOP;

    -- 11. Validate Reversal Entries Count & Balance inside Transaction
    SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_entry_count, v_total_debit, v_total_credit
    FROM public.voucher_entries
    WHERE voucher_id = v_reversal_id AND organization_id = p_organization_id;

    IF v_entry_count < 2 THEN
        RAISE EXCEPTION 'Reversal voucher % must contain at least 2 entries (found %).', v_reversal_id, v_entry_count;
    END IF;

    IF v_total_debit <> v_total_credit OR v_total_debit <= 0 THEN
        RAISE EXCEPTION 'Reversal voucher % entries are imbalanced or zero.', v_reversal_id;
    END IF;

    -- 12. Lock Sequence & Assign Legal Voucher Number
    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_reversal_fy_id, 1, v_auth_uid)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_reversal_voucher_num
    FROM public.voucher_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_reversal_fy_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_by = v_auth_uid,
        updated_at = now()
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_reversal_fy_id;

    -- 13. Transition Reversal Header to POSTED Status
    UPDATE public.journal_vouchers
    SET status = 'POSTED',
        voucher_number = v_reversal_voucher_num,
        posted_by = v_auth_uid,
        posted_at = now(),
        updated_at = now()
    WHERE id = v_reversal_id AND organization_id = p_organization_id;

    -- 14. Transition Original Voucher Header to REVERSED Status
    UPDATE public.journal_vouchers
    SET status = 'REVERSED',
        reversed_by = v_auth_uid,
        reversed_at = now(),
        reversal_reason = p_reversal_reason,
        updated_at = now()
    WHERE id = p_original_voucher_id AND organization_id = p_organization_id;

    -- 15. Complete Operation Key Record
    UPDATE public.voucher_operation_keys
    SET result_voucher_id = v_reversal_id,
        completed_at = now()
    WHERE id = v_op_key_id;

    RETURN v_reversal_id;
END;
$$;

-- ==============================================================================
-- 10. CANCEL DRAFT VOUCHER FUNCTION (تابع لغو پیش‌نویس)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.cancel_draft_journal_voucher(
    p_organization_id UUID,
    p_voucher_id UUID,
    p_cancellation_reason TEXT,
    p_expected_version INT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_voucher RECORD;
    v_existing_op RECORD;
    v_op_key_id UUID;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required: auth.uid() is null.';
    END IF;

    -- 2. Mandatory Parameter Validation
    IF p_cancellation_reason IS NULL OR trim(p_cancellation_reason) = '' THEN
        RAISE EXCEPTION 'Cancellation reason is mandatory for cancelling a draft voucher.';
    END IF;
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'Parameter p_expected_version is required.';
    END IF;
    IF p_operation_key IS NULL OR trim(p_operation_key) = '' THEN
        RAISE EXCEPTION 'Parameter p_operation_key is required.';
    END IF;
    IF p_request_fingerprint IS NULL OR trim(p_request_fingerprint) = '' THEN
        RAISE EXCEPTION 'Parameter p_request_fingerprint is required.';
    END IF;

    -- 3. Lock Voucher Header FOR UPDATE first
    SELECT * INTO v_voucher
    FROM public.journal_vouchers
    WHERE id = p_voucher_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal voucher % not found in organization %.', p_voucher_id, p_organization_id;
    END IF;

    -- 4. Check Branch Permission (finance:write)
    IF NOT public.has_branch_permission(p_organization_id, v_voucher.branch_id, 'finance:write') THEN
        RAISE EXCEPTION 'Permission denied: Required finance:write permission is missing for branch %.', v_voucher.branch_id;
    END IF;

    -- 5. Idempotency Check
    SELECT * INTO v_existing_op
    FROM public.voucher_operation_keys
    WHERE organization_id = p_organization_id AND operation_key = p_operation_key
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_op.operation_type <> 'CANCEL_DRAFT_VOUCHER' OR
           v_existing_op.target_voucher_id <> p_voucher_id OR
           v_existing_op.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Operation key conflict: Mismatched operation parameters or request fingerprint for key %.', p_operation_key;
        END IF;

        IF v_existing_op.completed_at IS NOT NULL THEN
            RETURN true;
        ELSE
            RAISE EXCEPTION 'Operation with key % is currently in progress.', p_operation_key;
        END IF;
    END IF;

    -- 6. Validate Status & Version BEFORE reserving operation key
    IF v_voucher.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only DRAFT vouchers can be cancelled. Current status of voucher % is %.', p_voucher_id, v_voucher.status;
    END IF;

    IF v_voucher.version <> p_expected_version THEN
        RAISE EXCEPTION 'Concurrency conflict: Voucher version % does not match expected version %.',
            v_voucher.version, p_expected_version;
    END IF;

    -- 7. Reserve Operation Key (ONLY after passing all validation checks above)
    INSERT INTO public.voucher_operation_keys (
        organization_id, operation_key, operation_type, request_fingerprint, target_voucher_id, created_by
    ) VALUES (
        p_organization_id, p_operation_key, 'CANCEL_DRAFT_VOUCHER', p_request_fingerprint, p_voucher_id, v_auth_uid
    ) RETURNING id INTO v_op_key_id;

    -- 8. Transition to CANCELLED
    UPDATE public.journal_vouchers
    SET status = 'CANCELLED',
        cancelled_by = v_auth_uid,
        cancelled_at = now(),
        cancellation_reason = p_cancellation_reason,
        updated_at = now()
    WHERE id = p_voucher_id AND organization_id = p_organization_id;

    -- 9. Complete Operation Key Record
    UPDATE public.voucher_operation_keys
    SET result_voucher_id = p_voucher_id,
        completed_at = now()
    WHERE id = v_op_key_id;

    RETURN true;
END;
$$;

-- ==============================================================================
-- 11. LEDGER VIEW (نمای دفتر کل و معین - شامل اسناد POSTED و REVERSED)
-- ==============================================================================
CREATE OR REPLACE VIEW public.vw_financial_ledger_entries
WITH (security_invoker = true) AS
SELECT
    ve.id AS entry_id,
    ve.organization_id,
    jv.branch_id,
    jv.fiscal_year_id,
    jv.id AS voucher_id,
    jv.voucher_number,
    jv.voucher_date,
    jv.status AS voucher_status,
    jv.voucher_kind,
    jv.description AS voucher_description,
    ve.row_number,
    ve.subsidiary_id,
    sub.code AS subsidiary_code,
    sub.name AS subsidiary_name,
    ve.person_id,
    p.name AS person_name,
    p.code AS person_code,
    ve.cost_center_id,
    cc.code AS cost_center_code,
    cc.title AS cost_center_title,
    ve.financial_role_code,
    ve.debit,
    ve.credit,
    ve.description AS entry_description,
    ve.contract_type,
    jv.source_type,
    jv.source_id,
    jv.reversal_of_voucher_id,
    ve.created_at
FROM public.voucher_entries ve
JOIN public.journal_vouchers jv ON jv.id = ve.voucher_id AND jv.organization_id = ve.organization_id
JOIN public.account_subsidiaries sub ON sub.id = ve.subsidiary_id AND sub.organization_id = ve.organization_id
LEFT JOIN public.persons p ON p.id = ve.person_id AND p.organization_id = ve.organization_id
LEFT JOIN public.cost_centers cc ON cc.id = ve.cost_center_id AND cc.organization_id = ve.organization_id
WHERE jv.status IN ('POSTED', 'REVERSED');

COMMENT ON VIEW public.vw_financial_ledger_entries IS 'Complete double-entry accounting ledger entries. Strictly includes POSTED and REVERSED vouchers with security_invoker = true.';

-- ==============================================================================
-- 12. SECURITY & ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
-- Revoke execution from PUBLIC for all functions and view
REVOKE EXECUTE ON FUNCTION public.post_journal_voucher(UUID, UUID, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_journal_voucher(UUID, UUID, UUID, DATE, TEXT, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_draft_journal_voucher(UUID, UUID, TEXT, INT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON public.vw_financial_ledger_entries FROM PUBLIC, anon;

-- Grant execution to authenticated
GRANT EXECUTE ON FUNCTION public.post_journal_voucher(UUID, UUID, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_journal_voucher(UUID, UUID, UUID, DATE, TEXT, INT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_draft_journal_voucher(UUID, UUID, TEXT, INT, TEXT, TEXT) TO authenticated;
GRANT SELECT ON public.vw_financial_ledger_entries TO authenticated;

-- Revoke direct mutation rights on tables from anon and authenticated
REVOKE INSERT, UPDATE, DELETE ON public.journal_vouchers FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.voucher_entries FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.voucher_sequences FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.voucher_operation_keys FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.cost_centers FROM PUBLIC, anon, authenticated;

-- Enable RLS
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_operation_keys ENABLE ROW LEVEL SECURITY;

-- Cost Centers Policies: View for active org members, direct writes blocked
CREATE POLICY "Active org members can view cost centers"
ON public.cost_centers FOR SELECT TO authenticated
USING (public.is_org_member(organization_id));

CREATE POLICY "Direct client modification of cost centers is forbidden"
ON public.cost_centers FOR ALL TO authenticated
USING (false) WITH CHECK (false);

-- Voucher Sequences Policies: Direct mutation blocked
CREATE POLICY "Direct client modification of voucher sequences is forbidden"
ON public.voucher_sequences FOR ALL TO authenticated
USING (false) WITH CHECK (false);

-- Operation Keys Policies: Direct mutation blocked
CREATE POLICY "Direct client modification of operation keys is forbidden"
ON public.voucher_operation_keys FOR ALL TO authenticated
USING (false) WITH CHECK (false);

-- Journal Vouchers Policies: View for active org members with branch finance:read
CREATE POLICY "Active org members with branch finance read permission can view vouchers"
ON public.journal_vouchers FOR SELECT TO authenticated
USING (
    public.is_org_member(organization_id) AND
    public.has_branch_permission(organization_id, branch_id, 'finance:read')
);

CREATE POLICY "Direct client mutation of journal vouchers is forbidden"
ON public.journal_vouchers FOR ALL TO authenticated
USING (false) WITH CHECK (false);

-- Voucher Entries Policies: View for active org members with branch finance:read
CREATE POLICY "Active org members with branch finance read permission can view entries"
ON public.voucher_entries FOR SELECT TO authenticated
USING (
    public.is_org_member(organization_id) AND
    EXISTS (
        SELECT 1 FROM public.journal_vouchers jv
        WHERE jv.id = voucher_entries.voucher_id
          AND jv.organization_id = voucher_entries.organization_id
          AND public.has_branch_permission(jv.organization_id, jv.branch_id, 'finance:read')
    )
);

CREATE POLICY "Direct client mutation of voucher entries is forbidden"
ON public.voucher_entries FOR ALL TO authenticated
USING (false) WITH CHECK (false);

COMMIT;
