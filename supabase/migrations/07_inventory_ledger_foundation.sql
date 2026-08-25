BEGIN;

-- ==============================================================================
-- Migration: 07_inventory_ledger_foundation.sql
-- Description: Phase 3-I - Core Inventory Transaction Ledger Foundation, Warehouse Balances,
--              Org Cost Balances, Warehouse Account Mappings, Negative Override Authorizations/Logs,
--              and Provisional Cost Allocation Architecture.
-- Rules & Constraints Implemented:
--   1. Fully enclosed in atomic transaction (BEGIN ... COMMIT). Zero test data created.
--   2. Document Sequences (inventory_document_sequences): Atomic counter per organization & fiscal year.
--   3. Transaction Headers (inventory_transactions): Strict lifecycle status (DRAFT, POSTED, REVERSED, CANCELLED),
--      transaction types, reversal tracking, idempotency, and audit fields. Header physical deletion forbidden.
--   4. Transaction Items (inventory_transaction_items): Detailed item rows validated against org boundaries,
--      service exclusions, unit decimal precision, serialized integer quantities, and warehouse direction rules.
--   5. Transaction Serials (inventory_transaction_serials): Mapping table between item rows and product_serials.
--   6. Warehouse Balances (inventory_balances): Quantity on hand per org, warehouse, and product.
--      NO check constraint preventing negative balance so manager-approved override exceptions remain possible.
--   7. Organizational Cost Balances (inventory_cost_balances): Single record per product across entire org.
--      Tracks org total quantity, total inventory value, and weighted average unit cost.
--      Internal warehouse transfers strictly do NOT alter org total quantity or org cost balance.
--   8. Warehouse Account Mappings (warehouse_inventory_account_mappings): Time-bound mapping of warehouse to COA subsidiary.
--      GIST temporal exclusion prevents overlapping validity ranges. Physical deletion forbidden.
--   9. Negative Override Authorizations & Logs (inventory_negative_override_authorizations / logs):
--      One-time manager authorization linked to draft transaction, request fingerprint, and security audit log.
--      Immutable consumption log strictly restricted to non-serialized products.
--  10. Provisional Cost Positions & Allocations (inventory_provisional_cost_positions / allocations):
--      Tracks sales made with provisional costs waiting for actual purchase matching. Customer sale price is completely separate.
--  11. Read-Only View (vw_inventory_ledger): Security invoker view showing POSTED and REVERSED transactions only.
--  12. Catalog permissions (inventory:post, inventory:negative_override) defined in permissions catalog ONLY.
--      Zero insertions into role_permissions and zero test data.
-- ==============================================================================

-- ==============================================================================
-- A. INVENTORY DOCUMENT SEQUENCES (شمارنده اسناد انبار)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_document_sequences (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL,
    next_number BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    PRIMARY KEY (organization_id, fiscal_year_id),
    CONSTRAINT fk_inv_seq_fiscal_year FOREIGN KEY (organization_id, fiscal_year_id)
        REFERENCES public.fiscal_years(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_inv_seq_next_number CHECK (next_number > 0)
);

COMMENT ON TABLE public.inventory_document_sequences IS 'Atomic sequence counter for finalized inventory document numbers per organization and fiscal year.';

-- ==============================================================================
-- B. INVENTORY TRANSACTIONS HEADER (سربرگ دفتر گردش انبار)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    fiscal_year_id UUID NOT NULL,
    initiating_branch_id UUID NOT NULL,
    document_number BIGINT,
    transaction_date DATE NOT NULL,
    transaction_type TEXT NOT NULL,
    transaction_kind TEXT NOT NULL DEFAULT 'GENERAL',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    description TEXT NOT NULL,
    source_event_key TEXT,
    idempotency_key TEXT,
    request_fingerprint TEXT,
    reversal_of_transaction_id UUID,
    journal_voucher_id UUID,
    cost_state TEXT NOT NULL DEFAULT 'PENDING',
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
    CONSTRAINT uq_inv_trans_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_inv_trans_type CHECK (
        transaction_type IN (
            'OPENING', 'PURCHASE_RECEIPT', 'SALE_ISSUE', 'TRANSFER',
            'SALES_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'COST_ADJUSTMENT'
        )
    ),
    CONSTRAINT chk_inv_trans_kind CHECK (transaction_kind IN ('GENERAL', 'REVERSAL')),
    CONSTRAINT chk_inv_trans_status CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED', 'CANCELLED')),
    CONSTRAINT chk_inv_trans_cost_state CHECK (cost_state IN ('PENDING', 'PROVISIONAL', 'FINAL', 'MIXED')),
    CONSTRAINT fk_inv_trans_branch FOREIGN KEY (organization_id, initiating_branch_id)
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_trans_fiscal_year FOREIGN KEY (organization_id, fiscal_year_id)
        REFERENCES public.fiscal_years(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_trans_reversal_of FOREIGN KEY (organization_id, reversal_of_transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_trans_jv FOREIGN KEY (organization_id, journal_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_inv_trans_no_self_reversal CHECK (reversal_of_transaction_id IS NULL OR reversal_of_transaction_id <> id),
    CONSTRAINT chk_inv_trans_reversal_kind_ref CHECK (
        (transaction_kind = 'REVERSAL' AND reversal_of_transaction_id IS NOT NULL)
        OR
        (transaction_kind = 'GENERAL' AND reversal_of_transaction_id IS NULL)
    ),
    CONSTRAINT chk_inv_trans_status_fields CHECK (
        (status = 'DRAFT' AND document_number IS NULL AND posted_at IS NULL AND posted_by IS NULL AND reversed_at IS NULL AND reversed_by IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR
        (status = 'CANCELLED' AND document_number IS NULL AND posted_at IS NULL AND posted_by IS NULL AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0) OR
        (status = 'POSTED' AND document_number IS NOT NULL AND document_number > 0 AND posted_at IS NOT NULL AND posted_by IS NOT NULL AND reversed_at IS NULL AND reversed_by IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR
        (status = 'REVERSED' AND document_number IS NOT NULL AND document_number > 0 AND posted_at IS NOT NULL AND posted_by IS NOT NULL AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL AND length(trim(reversal_reason)) > 0)
    )
);

COMMENT ON TABLE public.inventory_transactions IS 'Header table for double-entry inventory ledger transactions with strict lifecycle status and auditing.';

-- Unique Partial Indexes for Inventory Transactions
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_trans_doc_num_per_org_fy
ON public.inventory_transactions(organization_id, fiscal_year_id, document_number)
WHERE document_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_trans_source_event_key_per_org
ON public.inventory_transactions(organization_id, source_event_key)
WHERE source_event_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_trans_idempotency_key_per_org
ON public.inventory_transactions(organization_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_trans_one_reversal_per_tx
ON public.inventory_transactions(organization_id, reversal_of_transaction_id)
WHERE reversal_of_transaction_id IS NOT NULL;

-- ==============================================================================
-- C. INVENTORY TRANSACTION ITEMS (اقلام گردش انبار)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_transaction_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL,
    row_number INT NOT NULL,
    product_id UUID NOT NULL,
    source_warehouse_id UUID,
    destination_warehouse_id UUID,
    quantity NUMERIC(18, 3) NOT NULL,
    unit_cost_amount BIGINT,
    total_cost_amount BIGINT,
    cost_adjustment_amount BIGINT,
    cost_state TEXT NOT NULL DEFAULT 'PENDING',
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inv_item_org_composite UNIQUE (organization_id, id),
    CONSTRAINT uq_inv_item_row_per_tx UNIQUE (transaction_id, row_number),
    CONSTRAINT chk_inv_item_cost_state CHECK (cost_state IN ('PENDING', 'PROVISIONAL', 'FINAL', 'MIXED')),
    CONSTRAINT chk_inv_item_quantity_non_negative CHECK (quantity >= 0),
    CONSTRAINT chk_inv_item_costs_non_negative CHECK (
        (unit_cost_amount IS NULL OR unit_cost_amount >= 0)
        AND
        (total_cost_amount IS NULL OR total_cost_amount >= 0)
    ),
    CONSTRAINT chk_inv_item_cost_state_amounts CHECK (
        (cost_state = 'PENDING') OR
        (cost_state IN ('PROVISIONAL', 'FINAL', 'MIXED') AND unit_cost_amount IS NOT NULL AND unit_cost_amount >= 0 AND total_cost_amount IS NOT NULL AND total_cost_amount >= 0)
    ),
    CONSTRAINT fk_inv_item_tx FOREIGN KEY (organization_id, transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_inv_item_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_item_src_wh FOREIGN KEY (organization_id, source_warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_item_dst_wh FOREIGN KEY (organization_id, destination_warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_transaction_items IS 'Line items for inventory transactions detailing product movements, quantities, and cost amounts.';

-- ==============================================================================
-- D. INVENTORY TRANSACTION SERIALS (رابط اقلام گردش و سریال‌های کالا)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_transaction_serials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    transaction_item_id UUID NOT NULL,
    product_serial_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inv_tx_serial_item_pserial UNIQUE (transaction_item_id, product_serial_id),
    CONSTRAINT fk_inv_tx_serial_item FOREIGN KEY (organization_id, transaction_item_id)
        REFERENCES public.inventory_transaction_items(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_inv_tx_serial_pserial FOREIGN KEY (organization_id, product_serial_id)
        REFERENCES public.product_serials(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_transaction_serials IS 'Junction table linking inventory transaction line items to individual physical product serial numbers.';
COMMENT ON COLUMN public.inventory_transaction_serials.product_serial_id IS 'Exact product_serial_id link. Validation that total count equals item quantity during posting is deferred to future posting function.';

-- ==============================================================================
-- E. INVENTORY BALANCES (مانده تعدادی انبار به تفکیک کالا)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_balances (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL,
    product_id UUID NOT NULL,
    quantity_on_hand NUMERIC(18, 3) NOT NULL DEFAULT 0,
    last_transaction_id UUID,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, warehouse_id, product_id),
    CONSTRAINT fk_inv_bal_warehouse FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_bal_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_bal_last_tx FOREIGN KEY (organization_id, last_transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_balances IS 'Physical quantity on hand per warehouse and product. Derived state updated strictly by trusted transaction posting. NO CHECK(quantity_on_hand>=0) to permit manager-approved negative balance exceptions.';

-- ==============================================================================
-- F. INVENTORY COST BALANCES (مانده بهای سازمانی و میانگین موزون)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_cost_balances (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL,
    organization_quantity_on_hand NUMERIC(18, 3) NOT NULL DEFAULT 0,
    inventory_value_amount BIGINT NOT NULL DEFAULT 0,
    weighted_average_cost_amount BIGINT NOT NULL DEFAULT 0,
    last_transaction_id UUID,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, product_id),
    CONSTRAINT fk_inv_cost_bal_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_inv_cost_bal_last_tx FOREIGN KEY (organization_id, last_transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_cost_balances IS 'Organizational total quantity, total inventory value, and moving weighted average unit cost per product. Internal warehouse transfers strictly do NOT alter these values.';

-- ==============================================================================
-- G. WAREHOUSE INVENTORY ACCOUNT MAPPINGS (نگاشت انبار به حساب معین موجودی)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.warehouse_inventory_account_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL,
    subsidiary_id UUID NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'CURRENT',
    validity_range tstzrange GENERATED ALWAYS AS (tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)')) STORED,
    change_reason TEXT,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_wh_acct_map_status CHECK (status IN ('PLANNED', 'CURRENT', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT chk_wh_acct_map_dates CHECK (effective_to IS NULL OR effective_to > effective_from),
    CONSTRAINT fk_wh_acct_map_wh FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_wh_acct_map_sub FOREIGN KEY (organization_id, subsidiary_id)
        REFERENCES public.account_subsidiaries(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT ex_wh_acct_map_no_overlap EXCLUDE USING gist (
        organization_id WITH =,
        warehouse_id WITH =,
        validity_range WITH &&
    ) WHERE (status IN ('PLANNED', 'CURRENT', 'EXPIRED'))
);

COMMENT ON TABLE public.warehouse_inventory_account_mappings IS 'Time-bound mapping of warehouse to COA inventory subsidiary account with temporal overlap protection.';

-- ==============================================================================
-- H. INVENTORY NEGATIVE OVERRIDE AUTHORIZATIONS (مجوز یکبارمصرف موجودی منفی)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_negative_override_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL,
    request_fingerprint TEXT NOT NULL,
    reason TEXT NOT NULL,
    requested_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    approved_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    security_audit_log_id UUID NOT NULL,
    authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'ISSUED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_neg_auth_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_neg_auth_status CHECK (status IN ('ISSUED', 'CONSUMED', 'EXPIRED', 'REVOKED')),
    CONSTRAINT chk_neg_auth_reason CHECK (length(trim(reason)) >= 10),
    CONSTRAINT chk_neg_auth_expiry CHECK (expires_at > authorized_at),
    CONSTRAINT chk_neg_auth_consumed_at CHECK (
        (status IN ('ISSUED', 'EXPIRED', 'REVOKED') AND consumed_at IS NULL) OR
        (status = 'CONSUMED' AND consumed_at IS NOT NULL)
    ),
    CONSTRAINT fk_neg_auth_tx FOREIGN KEY (organization_id, transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_neg_auth_audit_log FOREIGN KEY (organization_id, security_audit_log_id)
        REFERENCES public.security_audit_logs(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_negative_override_authorizations IS 'One-time manager authorization token for permitting negative inventory override on a specific draft transaction.';

-- Unique partial index for active negative override authorizations
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_auth_active_per_tx_fingerprint
ON public.inventory_negative_override_authorizations(organization_id, transaction_id, request_fingerprint)
WHERE status = 'ISSUED';

-- ==============================================================================
-- I. INVENTORY NEGATIVE OVERRIDE LOGS (سابقه غیرقابل‌تغییر مصرف مجوز منفی)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_negative_override_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    authorization_id UUID NOT NULL,
    transaction_id UUID NOT NULL,
    transaction_item_id UUID NOT NULL,
    product_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    quantity_before NUMERIC(18, 3) NOT NULL,
    requested_quantity NUMERIC(18, 3) NOT NULL,
    shortage_quantity NUMERIC(18, 3) NOT NULL,
    quantity_after NUMERIC(18, 3) NOT NULL,
    reason_snapshot TEXT NOT NULL,
    approved_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    posted_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_neg_log_auth_item UNIQUE (authorization_id, transaction_item_id),
    CONSTRAINT chk_neg_log_requested_pos CHECK (requested_quantity > 0),
    CONSTRAINT chk_neg_log_qty_after_neg CHECK (quantity_after < 0),
    CONSTRAINT chk_neg_log_shortage_positive CHECK (shortage_quantity > 0),
    CONSTRAINT chk_neg_log_qty_math CHECK (quantity_after = quantity_before - requested_quantity),
    CONSTRAINT chk_neg_log_shortage_calc CHECK (shortage_quantity = (requested_quantity - GREATEST(quantity_before, 0))),
    CONSTRAINT fk_neg_log_auth FOREIGN KEY (organization_id, authorization_id)
        REFERENCES public.inventory_negative_override_authorizations(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_neg_log_tx FOREIGN KEY (organization_id, transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_neg_log_item FOREIGN KEY (organization_id, transaction_item_id)
        REFERENCES public.inventory_transaction_items(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_neg_log_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_neg_log_warehouse FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_negative_override_logs IS 'Immutable audit log of negative inventory override consumption per transaction line item.';

-- ==============================================================================
-- J. INVENTORY PROVISIONAL COST POSITIONS (فروش‌های دارای بهای موقت)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_provisional_cost_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    issue_transaction_item_id UUID NOT NULL,
    product_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    shortage_quantity NUMERIC(18, 3) NOT NULL,
    remaining_quantity NUMERIC(18, 3) NOT NULL,
    provisional_unit_cost_amount BIGINT NOT NULL,
    provisional_total_cost_amount BIGINT NOT NULL,
    settled_actual_cost_amount BIGINT NOT NULL DEFAULT 0,
    total_adjustment_amount BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN',
    reversal_transaction_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    CONSTRAINT uq_prov_pos_issue_item UNIQUE (issue_transaction_item_id),
    CONSTRAINT chk_prov_pos_status CHECK (status IN ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'REVERSED')),
    CONSTRAINT chk_prov_pos_status_rules CHECK (
        (status = 'OPEN' AND remaining_quantity = shortage_quantity AND settled_at IS NULL AND reversal_transaction_id IS NULL) OR
        (status = 'PARTIALLY_SETTLED' AND remaining_quantity > 0 AND remaining_quantity < shortage_quantity AND settled_at IS NULL AND reversal_transaction_id IS NULL) OR
        (status = 'SETTLED' AND remaining_quantity = 0 AND settled_at IS NOT NULL AND reversal_transaction_id IS NULL) OR
        (status = 'REVERSED' AND remaining_quantity = 0 AND settled_at IS NULL AND reversal_transaction_id IS NOT NULL)
    ),
    CONSTRAINT chk_prov_pos_shortage CHECK (shortage_quantity > 0),
    CONSTRAINT chk_prov_pos_remaining CHECK (remaining_quantity >= 0 AND remaining_quantity <= shortage_quantity),
    CONSTRAINT chk_prov_pos_costs_non_neg CHECK (
        provisional_unit_cost_amount >= 0 AND provisional_total_cost_amount >= 0 AND settled_actual_cost_amount >= 0
    ),
    CONSTRAINT fk_prov_pos_item FOREIGN KEY (organization_id, issue_transaction_item_id)
        REFERENCES public.inventory_transaction_items(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_prov_pos_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_prov_pos_warehouse FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_prov_pos_reversal_tx FOREIGN KEY (organization_id, reversal_transaction_id)
        REFERENCES public.inventory_transactions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_prov_pos_org_composite UNIQUE (organization_id, id)
);

COMMENT ON TABLE public.inventory_provisional_cost_positions IS 'Open sales positions recorded with provisional costs awaiting match with subsequent purchase receipts. Customer sale price is completely separate and unaffected.';

-- ==============================================================================
-- K. INVENTORY PROVISIONAL COST ALLOCATIONS (تخصیص خریدهای بعدی به بهای موقت)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_provisional_cost_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    provisional_position_id UUID NOT NULL,
    receipt_transaction_item_id UUID NOT NULL,
    allocated_quantity NUMERIC(18, 3) NOT NULL,
    provisional_unit_cost_amount BIGINT NOT NULL,
    actual_unit_cost_amount BIGINT NOT NULL,
    adjustment_amount BIGINT NOT NULL,
    adjustment_journal_voucher_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_prov_alloc_qty_pos CHECK (allocated_quantity > 0),
    CONSTRAINT chk_prov_alloc_unit_costs CHECK (provisional_unit_cost_amount >= 0 AND actual_unit_cost_amount >= 0),
    CONSTRAINT fk_prov_alloc_position FOREIGN KEY (organization_id, provisional_position_id)
        REFERENCES public.inventory_provisional_cost_positions(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_prov_alloc_receipt_item FOREIGN KEY (organization_id, receipt_transaction_item_id)
        REFERENCES public.inventory_transaction_items(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_prov_alloc_jv FOREIGN KEY (organization_id, adjustment_journal_voucher_id)
        REFERENCES public.journal_vouchers(organization_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.inventory_provisional_cost_allocations IS 'Immutable allocation record linking a purchase receipt line item to a provisional cost sale position. Adjusts internal inventory cost accounting without affecting customer sale price.';

-- ==============================================================================
-- INDEXES FOR PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_inv_seq_org ON public.inventory_document_sequences(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_org ON public.inventory_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_branch ON public.inventory_transactions(organization_id, initiating_branch_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_fiscal ON public.inventory_transactions(organization_id, fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_inv_trans_date ON public.inventory_transactions(organization_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_inv_trans_status ON public.inventory_transactions(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_inv_items_org ON public.inventory_transaction_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_tx ON public.inventory_transaction_items(organization_id, transaction_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_product ON public.inventory_transaction_items(organization_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_src_wh ON public.inventory_transaction_items(organization_id, source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_dst_wh ON public.inventory_transaction_items(organization_id, destination_warehouse_id);

CREATE INDEX IF NOT EXISTS idx_inv_serials_tx_item ON public.inventory_transaction_serials(organization_id, transaction_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_serials_pserial ON public.inventory_transaction_serials(organization_id, product_serial_id);

CREATE INDEX IF NOT EXISTS idx_inv_bal_org ON public.inventory_balances(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_bal_wh ON public.inventory_balances(organization_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_bal_prod ON public.inventory_balances(organization_id, product_id);

CREATE INDEX IF NOT EXISTS idx_inv_cost_bal_org ON public.inventory_cost_balances(organization_id);
CREATE INDEX IF NOT EXISTS idx_inv_cost_bal_prod ON public.inventory_cost_balances(organization_id, product_id);

CREATE INDEX IF NOT EXISTS idx_wh_acct_map_wh ON public.warehouse_inventory_account_mappings(organization_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_wh_acct_map_sub ON public.warehouse_inventory_account_mappings(organization_id, subsidiary_id);

CREATE INDEX IF NOT EXISTS idx_neg_auth_tx ON public.inventory_negative_override_authorizations(organization_id, transaction_id);
CREATE INDEX IF NOT EXISTS idx_neg_log_tx ON public.inventory_negative_override_logs(organization_id, transaction_id);
CREATE INDEX IF NOT EXISTS idx_prov_pos_prod ON public.inventory_provisional_cost_positions(organization_id, product_id);
CREATE INDEX IF NOT EXISTS idx_prov_pos_reversal_tx ON public.inventory_provisional_cost_positions(organization_id, reversal_transaction_id) WHERE reversal_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prov_alloc_pos ON public.inventory_provisional_cost_allocations(organization_id, provisional_position_id);
CREATE INDEX IF NOT EXISTS idx_prov_alloc_receipt_item ON public.inventory_provisional_cost_allocations(organization_id, receipt_transaction_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_product_tx ON public.inventory_transaction_items(organization_id, product_id, transaction_id);

-- ==============================================================================
-- HELPER & TRIGGER FUNCTIONS (SECURITY INVOKER)
-- ==============================================================================

-- 1. Increment Version and Updated Timestamp
CREATE OR REPLACE FUNCTION public.trg_increment_inventory_ledger_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_trans_version ON public.inventory_transactions;
CREATE TRIGGER trg_inv_trans_version
BEFORE UPDATE ON public.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_ledger_version();

DROP TRIGGER IF EXISTS trg_inv_bal_version ON public.inventory_balances;
CREATE TRIGGER trg_inv_bal_version
BEFORE UPDATE ON public.inventory_balances
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_ledger_version();

DROP TRIGGER IF EXISTS trg_inv_cost_bal_version ON public.inventory_cost_balances;
CREATE TRIGGER trg_inv_cost_bal_version
BEFORE UPDATE ON public.inventory_cost_balances
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_ledger_version();

DROP TRIGGER IF EXISTS trg_wh_acct_map_version ON public.warehouse_inventory_account_mappings;
CREATE TRIGGER trg_wh_acct_map_version
BEFORE UPDATE ON public.warehouse_inventory_account_mappings
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_ledger_version();

DROP TRIGGER IF EXISTS trg_prov_pos_version ON public.inventory_provisional_cost_positions;
CREATE TRIGGER trg_prov_pos_version
BEFORE UPDATE ON public.inventory_provisional_cost_positions
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_ledger_version();

-- 2. Immutability Protection for Core Identifiers
CREATE OR REPLACE FUNCTION public.prevent_inventory_ledger_immutable_fields_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'Modification of organization_id is strictly forbidden.';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Modification of record id is strictly forbidden.';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Modification of created_at timestamp is strictly forbidden.';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'Modification of created_by user reference is strictly forbidden.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_trans_immutability ON public.inventory_transactions;
CREATE TRIGGER trg_inv_trans_immutability
BEFORE UPDATE ON public.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_wh_acct_map_immutability ON public.warehouse_inventory_account_mappings;
CREATE TRIGGER trg_wh_acct_map_immutability
BEFORE UPDATE ON public.warehouse_inventory_account_mappings
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_fields_update();

-- 3. Prevent Physical Deletion & Header Status Modifications
CREATE OR REPLACE FUNCTION public.prevent_inventory_transaction_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Physical deletion of inventory transactions is strictly forbidden.';
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'DRAFT' THEN
            IF NEW.status NOT IN ('DRAFT', 'POSTED', 'CANCELLED') THEN
                RAISE EXCEPTION 'Invalid status transition from DRAFT to %.', NEW.status;
            END IF;
        ELSIF OLD.status = 'POSTED' THEN
            IF NEW.status <> 'REVERSED' THEN
                RAISE EXCEPTION 'POSTED inventory transaction can only transition to REVERSED status.';
            END IF;
            IF OLD.transaction_kind = 'REVERSAL' THEN
                RAISE EXCEPTION 'A REVERSAL transaction cannot be reversed.';
            END IF;
            IF NEW.id IS DISTINCT FROM OLD.id OR
               NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
               NEW.fiscal_year_id IS DISTINCT FROM OLD.fiscal_year_id OR
               NEW.initiating_branch_id IS DISTINCT FROM OLD.initiating_branch_id OR
               NEW.document_number IS DISTINCT FROM OLD.document_number OR
               NEW.transaction_date IS DISTINCT FROM OLD.transaction_date OR
               NEW.transaction_type IS DISTINCT FROM OLD.transaction_type OR
               NEW.transaction_kind IS DISTINCT FROM OLD.transaction_kind OR
               NEW.description IS DISTINCT FROM OLD.description OR
               NEW.source_event_key IS DISTINCT FROM OLD.source_event_key OR
               NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR
               NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint OR
               NEW.reversal_of_transaction_id IS DISTINCT FROM OLD.reversal_of_transaction_id OR
               NEW.journal_voucher_id IS DISTINCT FROM OLD.journal_voucher_id OR
               NEW.cost_state IS DISTINCT FROM OLD.cost_state OR
               NEW.created_by IS DISTINCT FROM OLD.created_by OR
               NEW.created_at IS DISTINCT FROM OLD.created_at OR
               NEW.posted_by IS DISTINCT FROM OLD.posted_by OR
               NEW.posted_at IS DISTINCT FROM OLD.posted_at OR
               NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by OR
               NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR
               NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason THEN
                RAISE EXCEPTION 'Modification of core transaction header fields during reversal is strictly forbidden.';
            END IF;
        ELSIF OLD.status IN ('REVERSED', 'CANCELLED') THEN
            RAISE EXCEPTION 'Inventory transactions in % status are immutable and cannot be modified.', OLD.status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_inv_trans_deletion ON public.inventory_transactions;
DROP TRIGGER IF EXISTS trg_prevent_inv_trans_mod ON public.inventory_transactions;
CREATE TRIGGER trg_prevent_inv_trans_mod
BEFORE UPDATE OR DELETE ON public.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_transaction_modification();

-- Prevent modification of items and serials unless transaction is in DRAFT
CREATE OR REPLACE FUNCTION public.prevent_inventory_item_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_tx_id UUID;
    v_org_id UUID;
    v_tx_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_tx_id := OLD.transaction_id;
        v_org_id := OLD.organization_id;
    ELSE
        v_tx_id := NEW.transaction_id;
        v_org_id := NEW.organization_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.transaction_id IS DISTINCT FROM OLD.transaction_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
            RAISE EXCEPTION 'Moving transaction items across transactions or organizations is strictly forbidden.';
        END IF;
    END IF;

    SELECT it.status INTO v_tx_status
    FROM public.inventory_transactions it
    WHERE it.id = v_tx_id AND it.organization_id = v_org_id
    FOR UPDATE;

    IF v_tx_status IS NULL THEN
        RAISE EXCEPTION 'Parent transaction does not exist in the specified organization.';
    END IF;

    IF v_tx_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Transaction line items can only be modified when parent transaction is in DRAFT status. Current status: %', v_tx_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_inv_item_mod ON public.inventory_transaction_items;
CREATE TRIGGER trg_prevent_inv_item_mod
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transaction_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_item_modification();

CREATE OR REPLACE FUNCTION public.prevent_inventory_serial_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_item_id UUID;
    v_org_id UUID;
    v_tx_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_item_id := OLD.transaction_item_id;
        v_org_id := OLD.organization_id;
    ELSE
        v_item_id := NEW.transaction_item_id;
        v_org_id := NEW.organization_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.transaction_item_id IS DISTINCT FROM OLD.transaction_item_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
            RAISE EXCEPTION 'Moving serial records across items or organizations is strictly forbidden.';
        END IF;
    END IF;

    SELECT it.status INTO v_tx_status
    FROM public.inventory_transaction_items iti
    JOIN public.inventory_transactions it ON it.id = iti.transaction_id AND it.organization_id = iti.organization_id
    WHERE iti.id = v_item_id AND iti.organization_id = v_org_id
    FOR UPDATE OF it;

    IF v_tx_status IS NULL THEN
        RAISE EXCEPTION 'Parent transaction line item does not exist in the specified organization.';
    END IF;

    IF v_tx_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Transaction serials can only be modified when parent transaction is in DRAFT status. Current status: %', v_tx_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_inv_serial_mod ON public.inventory_transaction_serials;
CREATE TRIGGER trg_prevent_inv_serial_mod
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transaction_serials
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_serial_modification();

CREATE OR REPLACE FUNCTION public.prevent_inventory_ledger_immutable_records_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Physical deletion of this record is strictly forbidden for audit preservation.';
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_wh_acct_map_deletion ON public.warehouse_inventory_account_mappings;
CREATE TRIGGER trg_prevent_wh_acct_map_deletion
BEFORE DELETE ON public.warehouse_inventory_account_mappings
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_deletion();

DROP TRIGGER IF EXISTS trg_prevent_neg_log_deletion ON public.inventory_negative_override_logs;
CREATE TRIGGER trg_prevent_neg_log_deletion
BEFORE DELETE ON public.inventory_negative_override_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_deletion();

DROP TRIGGER IF EXISTS trg_prevent_prov_pos_deletion ON public.inventory_provisional_cost_positions;
CREATE TRIGGER trg_prevent_prov_pos_deletion
BEFORE DELETE ON public.inventory_provisional_cost_positions
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_deletion();

DROP TRIGGER IF EXISTS trg_prevent_prov_alloc_deletion ON public.inventory_provisional_cost_allocations;
CREATE TRIGGER trg_prevent_prov_alloc_deletion
BEFORE DELETE ON public.inventory_provisional_cost_allocations
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_deletion();

-- 4. Prevent Update on Immutable Logs and Allocations
CREATE OR REPLACE FUNCTION public.prevent_inventory_ledger_immutable_records_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Updates to immutable log/allocation records are strictly forbidden.';
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_neg_log_update ON public.inventory_negative_override_logs;
CREATE TRIGGER trg_prevent_neg_log_update
BEFORE UPDATE ON public.inventory_negative_override_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_update();

DROP TRIGGER IF EXISTS trg_prevent_prov_alloc_update ON public.inventory_provisional_cost_allocations;
CREATE TRIGGER trg_prevent_prov_alloc_update
BEFORE UPDATE ON public.inventory_provisional_cost_allocations
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_ledger_immutable_records_update();

-- 5. Trigger Function: Validate Transaction Line Items
CREATE OR REPLACE FUNCTION public.trg_validate_inventory_transaction_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_tx_type TEXT;
    v_tx_org UUID;
    v_product_kind TEXT;
    v_is_serialized BOOLEAN;
    v_unit_id UUID;
    v_allows_fraction BOOLEAN;
    v_decimal_places INT;
    v_src_org UUID;
    v_dst_org UUID;
    v_prod_org UUID;
BEGIN
    -- 1. Fetch parent transaction details
    SELECT it.transaction_type, it.organization_id INTO v_tx_type, v_tx_org
    FROM public.inventory_transactions it
    WHERE it.id = NEW.transaction_id AND it.organization_id = NEW.organization_id;

    IF v_tx_type IS NULL THEN
        RAISE EXCEPTION 'Parent inventory transaction does not exist in the specified organization.';
    END IF;

    -- COST_ADJUSTMENT vs Non-COST_ADJUSTMENT quantity & cost_adjustment_amount rules
    IF v_tx_type = 'COST_ADJUSTMENT' THEN
        IF NEW.quantity <> 0 THEN
            RAISE EXCEPTION 'COST_ADJUSTMENT transaction line items must have quantity equal to zero.';
        END IF;
        IF NEW.source_warehouse_id IS NOT NULL OR NEW.destination_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'COST_ADJUSTMENT transaction line items must have null source and destination warehouses.';
        END IF;
        IF NEW.cost_adjustment_amount IS NULL OR NEW.cost_adjustment_amount = 0 THEN
            RAISE EXCEPTION 'COST_ADJUSTMENT transaction line items require a non-null and non-zero cost_adjustment_amount.';
        END IF;
    ELSE
        IF NEW.quantity <= 0 THEN
            RAISE EXCEPTION 'Non COST_ADJUSTMENT transaction line items must have quantity strictly greater than zero.';
        END IF;
        IF NEW.cost_adjustment_amount IS NOT NULL THEN
            RAISE EXCEPTION 'cost_adjustment_amount must be NULL for non COST_ADJUSTMENT transactions.';
        END IF;
    END IF;

    -- 2. Verify product organizational alignment, kind, and serialization
    SELECT p.organization_id, p.product_kind, p.is_serialized, p.measurement_unit_id
    INTO v_prod_org, v_product_kind, v_is_serialized, v_unit_id
    FROM public.products p
    WHERE p.id = NEW.product_id AND p.organization_id = NEW.organization_id;

    IF v_prod_org IS NULL THEN
        RAISE EXCEPTION 'Product does not exist in the specified organization.';
    END IF;

    IF v_product_kind = 'SERVICE' THEN
        RAISE EXCEPTION 'Services cannot be included in inventory transaction line items.';
    END IF;

    -- 3. Verify quantity precision
    IF v_is_serialized IS TRUE THEN
        IF NEW.quantity <> floor(NEW.quantity) THEN
            RAISE EXCEPTION 'Serialized products only accept integer quantities.';
        END IF;
    ELSE
        SELECT mu.allows_fraction, mu.decimal_places INTO v_allows_fraction, v_decimal_places
        FROM public.measurement_units mu
        WHERE mu.id = v_unit_id AND mu.organization_id = NEW.organization_id;

        IF v_allows_fraction IS FALSE AND NEW.quantity <> floor(NEW.quantity) THEN
            RAISE EXCEPTION 'Product measurement unit does not allow fractional quantities.';
        END IF;

        IF v_allows_fraction IS TRUE AND v_decimal_places IS NOT NULL THEN
            IF round(NEW.quantity, v_decimal_places) <> NEW.quantity THEN
                RAISE EXCEPTION 'Quantity decimal precision exceeds allowed limit (% decimal places) for product measurement unit.', v_decimal_places;
            END IF;
        END IF;
    END IF;

    -- 4. Verify warehouse directions based on transaction_type
    IF NEW.source_warehouse_id IS NOT NULL THEN
        SELECT w.organization_id INTO v_src_org
        FROM public.warehouses w
        WHERE w.id = NEW.source_warehouse_id AND w.organization_id = NEW.organization_id;

        IF v_src_org IS NULL THEN
            RAISE EXCEPTION 'Source warehouse does not exist in the specified organization.';
        END IF;
    END IF;

    IF NEW.destination_warehouse_id IS NOT NULL THEN
        SELECT w.organization_id INTO v_dst_org
        FROM public.warehouses w
        WHERE w.id = NEW.destination_warehouse_id AND w.organization_id = NEW.organization_id;

        IF v_dst_org IS NULL THEN
            RAISE EXCEPTION 'Destination warehouse does not exist in the specified organization.';
        END IF;
    END IF;

    IF v_tx_type IN ('OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN', 'SALES_RETURN') THEN
        IF NEW.destination_warehouse_id IS NULL OR NEW.source_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'Inbound transaction type % requires destination_warehouse_id and no source_warehouse_id.', v_tx_type;
        END IF;
    ELSIF v_tx_type IN ('SALE_ISSUE', 'ADJUSTMENT_OUT', 'PURCHASE_RETURN') THEN
        IF NEW.source_warehouse_id IS NULL OR NEW.destination_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'Outbound transaction type % requires source_warehouse_id and no destination_warehouse_id.', v_tx_type;
        END IF;
    ELSIF v_tx_type = 'TRANSFER' THEN
        IF NEW.source_warehouse_id IS NULL OR NEW.destination_warehouse_id IS NULL THEN
            RAISE EXCEPTION 'Transfer transaction requires both source_warehouse_id and destination_warehouse_id.';
        END IF;
        IF NEW.source_warehouse_id = NEW.destination_warehouse_id THEN
            RAISE EXCEPTION 'Transfer transaction source and destination warehouses cannot be identical.';
        END IF;
    ELSIF v_tx_type = 'COST_ADJUSTMENT' THEN
        IF NEW.source_warehouse_id IS NOT NULL OR NEW.destination_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'COST_ADJUSTMENT transaction requires source and destination warehouses to be NULL.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_inv_item ON public.inventory_transaction_items;
CREATE TRIGGER trg_validate_inv_item
BEFORE INSERT OR UPDATE ON public.inventory_transaction_items
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_inventory_transaction_items();

-- 6. Trigger Function: Validate Transaction Serials Alignment
CREATE OR REPLACE FUNCTION public.trg_validate_inventory_transaction_serials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_item_prod UUID;
    v_item_org UUID;
    v_serial_prod UUID;
    v_serial_org UUID;
BEGIN
    SELECT iti.product_id, iti.organization_id INTO v_item_prod, v_item_org
    FROM public.inventory_transaction_items iti
    WHERE iti.id = NEW.transaction_item_id AND iti.organization_id = NEW.organization_id;

    IF v_item_prod IS NULL THEN
        RAISE EXCEPTION 'Referenced transaction item does not exist in the specified organization.';
    END IF;

    SELECT ps.product_id, ps.organization_id INTO v_serial_prod, v_serial_org
    FROM public.product_serials ps
    WHERE ps.id = NEW.product_serial_id AND ps.organization_id = NEW.organization_id;

    IF v_serial_prod IS NULL THEN
        RAISE EXCEPTION 'Referenced product serial does not exist in the specified organization.';
    END IF;

    IF v_item_prod <> v_serial_prod THEN
        RAISE EXCEPTION 'Product serial product_id does not match transaction item product_id.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_inv_tx_serial ON public.inventory_transaction_serials;
CREATE TRIGGER trg_validate_inv_tx_serial
BEFORE INSERT OR UPDATE ON public.inventory_transaction_serials
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_inventory_transaction_serials();

-- 7. Trigger Function: Validate Negative Override Log Alignment
CREATE OR REPLACE FUNCTION public.trg_validate_negative_override_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_auth_org UUID;
    v_auth_tx UUID;
    v_auth_appr UUID;
    v_auth_reason TEXT;
    v_item_org UUID;
    v_item_tx UUID;
    v_item_prod UUID;
    v_item_src_wh UUID;
    v_is_serialized BOOLEAN;
BEGIN
    -- 1. Check authorization alignment
    SELECT auth.organization_id, auth.transaction_id, auth.approved_by, auth.reason
    INTO v_auth_org, v_auth_tx, v_auth_appr, v_auth_reason
    FROM public.inventory_negative_override_authorizations auth
    WHERE auth.id = NEW.authorization_id AND auth.organization_id = NEW.organization_id;

    IF v_auth_org IS NULL THEN
        RAISE EXCEPTION 'Referenced override authorization does not exist in the specified organization.';
    END IF;

    IF v_auth_tx <> NEW.transaction_id THEN
        RAISE EXCEPTION 'Log transaction_id does not match authorization transaction_id.';
    END IF;

    IF v_auth_appr <> NEW.approved_by THEN
        RAISE EXCEPTION 'Log approved_by does not match authorization approved_by user.';
    END IF;

    IF v_auth_reason <> NEW.reason_snapshot THEN
        RAISE EXCEPTION 'Log reason_snapshot does not match authorization reason.';
    END IF;

    -- 2. Check transaction item alignment
    SELECT iti.organization_id, iti.transaction_id, iti.product_id, iti.source_warehouse_id
    INTO v_item_org, v_item_tx, v_item_prod, v_item_src_wh
    FROM public.inventory_transaction_items iti
    WHERE iti.id = NEW.transaction_item_id AND iti.organization_id = NEW.organization_id;

    IF v_item_org IS NULL THEN
        RAISE EXCEPTION 'Referenced transaction line item does not exist in the specified organization.';
    END IF;

    IF v_item_tx <> NEW.transaction_id THEN
        RAISE EXCEPTION 'Line item transaction_id does not match log transaction_id.';
    END IF;

    IF v_item_prod <> NEW.product_id THEN
        RAISE EXCEPTION 'Line item product_id does not match log product_id.';
    END IF;

    IF v_item_src_wh IS NULL THEN
        RAISE EXCEPTION 'Line item must be an outbound item with a valid source_warehouse_id.';
    END IF;

    IF v_item_src_wh <> NEW.warehouse_id THEN
        RAISE EXCEPTION 'Line item source_warehouse_id does not match log warehouse_id.';
    END IF;

    -- 3. Check product serialization
    SELECT p.is_serialized INTO v_is_serialized
    FROM public.products p
    WHERE p.id = NEW.product_id AND p.organization_id = NEW.organization_id;

    IF v_is_serialized IS TRUE THEN
        RAISE EXCEPTION 'Serialized products are strictly forbidden from negative inventory overrides.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_neg_log ON public.inventory_negative_override_logs;
CREATE TRIGGER trg_validate_neg_log
BEFORE INSERT OR UPDATE ON public.inventory_negative_override_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_negative_override_log();

-- 8. Trigger Function: Validate Provisional Cost Position Eligibility & Lifecycle
CREATE OR REPLACE FUNCTION public.trg_validate_provisional_cost_position()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_item_org UUID;
    v_item_prod UUID;
    v_item_src_wh UUID;
    v_item_qty NUMERIC(18,3);
    v_tx_type TEXT;
    v_tx_status TEXT;
    v_is_serialized BOOLEAN;
    v_issue_tx_id UUID;
    v_rev_tx_kind TEXT;
    v_rev_tx_status TEXT;
    v_rev_of_tx UUID;
BEGIN
    -- Immutability check for REVERSED status
    IF TG_OP = 'INSERT' AND NEW.status = 'REVERSED' THEN
        RAISE EXCEPTION 'Direct insertion of provisional cost position in REVERSED status is forbidden.';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'REVERSED' THEN
        RAISE EXCEPTION 'Provisional cost position in REVERSED status is final and cannot be modified.';
    END IF;

    -- Reversal validation rules
    IF NEW.status = 'REVERSED' THEN
        IF TG_OP = 'UPDATE' AND OLD.status <> 'OPEN' THEN
            RAISE EXCEPTION 'Transition to REVERSED status is only permitted from OPEN status.';
        END IF;

        IF NEW.reversal_transaction_id IS NULL THEN
            RAISE EXCEPTION 'reversal_transaction_id is required when status is REVERSED.';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.inventory_provisional_cost_allocations
            WHERE provisional_position_id = NEW.id AND organization_id = NEW.organization_id
        ) THEN
            RAISE EXCEPTION 'Cannot reverse a provisional cost position that has existing allocations.';
        END IF;

        -- Validate reversal transaction header
        SELECT it.transaction_kind, it.status, it.reversal_of_transaction_id
        INTO v_rev_tx_kind, v_rev_tx_status, v_rev_of_tx
        FROM public.inventory_transactions it
        WHERE it.id = NEW.reversal_transaction_id AND it.organization_id = NEW.organization_id;

        IF v_rev_tx_kind IS NULL THEN
            RAISE EXCEPTION 'Reversal transaction does not exist in the specified organization.';
        END IF;

        IF v_rev_tx_kind <> 'REVERSAL' THEN
            RAISE EXCEPTION 'Referenced reversal transaction must have transaction_kind = REVERSAL.';
        END IF;

        IF v_rev_tx_status <> 'POSTED' THEN
            RAISE EXCEPTION 'Referenced reversal transaction must have status = POSTED.';
        END IF;

        -- Validate that reversal transaction reverses the exact SALE_ISSUE transaction of this position
        SELECT iti.transaction_id INTO v_issue_tx_id
        FROM public.inventory_transaction_items iti
        WHERE iti.id = NEW.issue_transaction_item_id AND iti.organization_id = NEW.organization_id;

        IF v_rev_of_tx IS DISTINCT FROM v_issue_tx_id THEN
            RAISE EXCEPTION 'Reversal transaction reversal_of_transaction_id does not match position sale issue transaction.';
        END IF;
    ELSE
        IF NEW.reversal_transaction_id IS NOT NULL THEN
            RAISE EXCEPTION 'reversal_transaction_id must be NULL when status is not REVERSED.';
        END IF;
    END IF;

    SELECT iti.organization_id, iti.product_id, iti.source_warehouse_id, iti.quantity, it.transaction_type, it.status
    INTO v_item_org, v_item_prod, v_item_src_wh, v_item_qty, v_tx_type, v_tx_status
    FROM public.inventory_transaction_items iti
    JOIN public.inventory_transactions it ON it.id = iti.transaction_id AND it.organization_id = iti.organization_id
    WHERE iti.id = NEW.issue_transaction_item_id AND iti.organization_id = NEW.organization_id;

    IF v_item_org IS NULL THEN
        RAISE EXCEPTION 'Referenced sale issue transaction line item does not exist in the specified organization.';
    END IF;

    IF v_tx_type <> 'SALE_ISSUE' THEN
        RAISE EXCEPTION 'Provisional cost positions can only be created for SALE_ISSUE transaction items.';
    END IF;

    IF v_tx_status <> 'POSTED' THEN
        RAISE EXCEPTION 'Provisional cost position creation requires sale transaction to be in POSTED status.';
    END IF;

    IF v_item_prod <> NEW.product_id THEN
        RAISE EXCEPTION 'Position product_id does not match sale item product_id.';
    END IF;

    IF v_item_src_wh IS NULL OR v_item_src_wh <> NEW.warehouse_id THEN
        RAISE EXCEPTION 'Position warehouse_id does not match sale item source_warehouse_id.';
    END IF;

    IF NEW.shortage_quantity > v_item_qty THEN
        RAISE EXCEPTION 'Provisional shortage_quantity (%) cannot exceed sale item quantity (%).', NEW.shortage_quantity, v_item_qty;
    END IF;

    SELECT p.is_serialized INTO v_is_serialized
    FROM public.products p
    WHERE p.id = NEW.product_id AND p.organization_id = NEW.organization_id;

    IF v_is_serialized IS TRUE THEN
        RAISE EXCEPTION 'Serialized products cannot be recorded as provisional cost positions.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prov_pos ON public.inventory_provisional_cost_positions;
CREATE TRIGGER trg_validate_prov_pos
BEFORE INSERT OR UPDATE ON public.inventory_provisional_cost_positions
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_provisional_cost_position();

-- 9. Trigger Function: Validate Provisional Cost Allocation Eligibility
CREATE OR REPLACE FUNCTION public.trg_validate_provisional_cost_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_pos_org UUID;
    v_pos_prod UUID;
    v_pos_rem_qty NUMERIC(18,3);
    v_pos_prov_cost BIGINT;
    v_r_org UUID;
    v_r_prod UUID;
    v_tx_type TEXT;
    v_tx_status TEXT;
BEGIN
    SELECT pos.organization_id, pos.product_id, pos.remaining_quantity, pos.provisional_unit_cost_amount
    INTO v_pos_org, v_pos_prod, v_pos_rem_qty, v_pos_prov_cost
    FROM public.inventory_provisional_cost_positions pos
    WHERE pos.id = NEW.provisional_position_id AND pos.organization_id = NEW.organization_id;

    IF v_pos_org IS NULL THEN
        RAISE EXCEPTION 'Referenced provisional cost position does not exist in the specified organization.';
    END IF;

    SELECT iti.organization_id, iti.product_id, it.transaction_type, it.status
    INTO v_r_org, v_r_prod, v_tx_type, v_tx_status
    FROM public.inventory_transaction_items iti
    JOIN public.inventory_transactions it ON it.id = iti.transaction_id AND it.organization_id = iti.organization_id
    WHERE iti.id = NEW.receipt_transaction_item_id AND iti.organization_id = NEW.organization_id;

    IF v_r_org IS NULL THEN
        RAISE EXCEPTION 'Referenced receipt transaction line item does not exist in the specified organization.';
    END IF;

    IF v_tx_type <> 'PURCHASE_RECEIPT' THEN
        RAISE EXCEPTION 'Provisional cost allocations can only be made against PURCHASE_RECEIPT transaction items.';
    END IF;

    IF v_tx_status <> 'POSTED' THEN
        RAISE EXCEPTION 'Purchase receipt transaction must be in POSTED status for provisional cost allocation.';
    END IF;

    IF v_pos_prod <> v_r_prod THEN
        RAISE EXCEPTION 'Receipt item product_id does not match provisional cost position product_id.';
    END IF;

    IF NEW.allocated_quantity > v_pos_rem_qty THEN
        RAISE EXCEPTION 'Allocated quantity (%) exceeds position remaining quantity (%).', NEW.allocated_quantity, v_pos_rem_qty;
    END IF;

    IF NEW.provisional_unit_cost_amount <> v_pos_prov_cost THEN
        RAISE EXCEPTION 'Allocation provisional_unit_cost_amount (%) does not match position provisional_unit_cost_amount (%).', NEW.provisional_unit_cost_amount, v_pos_prov_cost;
    END IF;

    IF NEW.adjustment_amount <> round((NEW.actual_unit_cost_amount - NEW.provisional_unit_cost_amount) * NEW.allocated_quantity) THEN
        RAISE EXCEPTION 'Allocation adjustment_amount (%) does not match calculated difference.', NEW.adjustment_amount;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prov_alloc ON public.inventory_provisional_cost_allocations;
CREATE TRIGGER trg_validate_prov_alloc
BEFORE INSERT ON public.inventory_provisional_cost_allocations
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_provisional_cost_allocation();

-- Revoke default public execution rights on trigger helper functions
REVOKE EXECUTE ON FUNCTION public.trg_increment_inventory_ledger_version() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_ledger_immutable_fields_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_transaction_modification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_item_modification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_serial_modification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_ledger_immutable_records_deletion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_ledger_immutable_records_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_inventory_transaction_items() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_inventory_transaction_serials() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_negative_override_log() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_provisional_cost_position() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_provisional_cost_allocation() FROM PUBLIC;

-- ==============================================================================
-- L. READ-ONLY VIEW (vw_inventory_ledger)
-- ==============================================================================
CREATE OR REPLACE VIEW public.vw_inventory_ledger WITH (security_invoker = true) AS
SELECT
    it.organization_id,
    it.id AS transaction_id,
    it.fiscal_year_id,
    it.initiating_branch_id,
    it.document_number,
    it.transaction_date,
    it.transaction_type,
    it.transaction_kind,
    it.status,
    iti.id AS transaction_item_id,
    iti.row_number,
    iti.product_id,
    iti.source_warehouse_id,
    iti.destination_warehouse_id,
    iti.quantity,
    iti.unit_cost_amount,
    iti.total_cost_amount,
    iti.cost_adjustment_amount,
    iti.cost_state,
    iti.description AS item_description,
    it.description AS header_description,
    it.posted_at,
    it.posted_by,
    it.reversal_of_transaction_id,
    it.journal_voucher_id
FROM public.inventory_transactions it
JOIN public.inventory_transaction_items iti ON iti.transaction_id = it.id AND iti.organization_id = it.organization_id
WHERE it.status IN ('POSTED', 'REVERSED');

COMMENT ON VIEW public.vw_inventory_ledger IS 'Read-only inventory ledger view showing POSTED and REVERSED transaction line items. Drafts and cancelled documents are excluded.';

-- ==============================================================================
-- M. CATALOG PERMISSIONS DEFINITIONS (KATALOG ONLY - NO ROLE MAPPINGS)
-- ==============================================================================
-- Approved Reversal Policies Summary:
-- 1. Reversal of non-serialized entry transactions and COST_ADJUSTMENT is blocked if subsequent active posted transaction for the same product exists.
-- 2. In future checks, only transactions with status = 'POSTED', transaction_kind = 'GENERAL', posted after original document act as blockers.
-- 3. REVERSED documents and documents with transaction_kind = 'REVERSAL' alone do not permanently block older documents.
-- 4. Reversal transactions must not cause negative inventory balances.
-- 5. Documents with non-null journal_voucher_id are blocked from reversal until atomic accounting-inventory integration is implemented.
-- 6. Sales or receipts with provisional cost allocations are blocked from reversal until provisional allocation reversal infrastructure is completed.

INSERT INTO public.permissions (code, name_fa, category, description) VALUES
('inventory:post', 'قطعی‌سازی اسناد انبار', 'انبارداری', 'امکان قطعی‌سازی اسناد انبار و تغییر دفتر موجودی'),
('inventory:negative_override', 'صدور مجوز موجودی منفی', 'انبارداری', 'امکان صدور مجوز خروج با موجودی منفی'),
('inventory:reverse', 'معکوس‌سازی اسناد قطعی انبار', 'inventory', 'امکان معکوس‌سازی اسناد قطعی انبار')
ON CONFLICT (code) DO NOTHING;

-- ==============================================================================
-- N. ROW LEVEL SECURITY (RLS) POLICIES & PRIVILEGE REVOCATIONS
-- ==============================================================================
ALTER TABLE public.inventory_document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transaction_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cost_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_inventory_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_negative_override_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_negative_override_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_provisional_cost_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_provisional_cost_allocations ENABLE ROW LEVEL SECURITY;

-- 1. Inventory Transactions Header RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view inventory transactions"
ON public.inventory_transactions FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 2. Inventory Transaction Items RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view inventory transaction items"
ON public.inventory_transaction_items FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 3. Inventory Transaction Serials RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view inventory transaction serials"
ON public.inventory_transaction_serials FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 4. Inventory Balances RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view inventory balances"
ON public.inventory_balances FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 5. Inventory Cost Balances RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view inventory cost balances"
ON public.inventory_cost_balances FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 6. Warehouse Account Mappings RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view warehouse account mappings"
ON public.warehouse_inventory_account_mappings FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 7. Negative Override Authorizations RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view negative override authorizations"
ON public.inventory_negative_override_authorizations FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'inventory:negative_override')
        OR public.has_permission(organization_id, 'finance:approve')
    )
);

-- 8. Negative Override Logs RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view negative override logs"
ON public.inventory_negative_override_logs FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'inventory:negative_override')
        OR public.has_permission(organization_id, 'finance:approve')
    )
);

-- 9. Provisional Cost Positions RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view provisional cost positions"
ON public.inventory_provisional_cost_positions FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- 10. Provisional Cost Allocations RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view provisional cost allocations"
ON public.inventory_provisional_cost_allocations FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- Revoke all privileges on document sequence counter
REVOKE ALL ON public.inventory_document_sequences FROM PUBLIC, anon, authenticated;

-- Revoke direct mutation privileges from PUBLIC, anon, authenticated on all 10 tables
REVOKE INSERT, UPDATE, DELETE ON public.inventory_transactions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_transaction_items FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_transaction_serials FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_balances FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_cost_balances FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.warehouse_inventory_account_mappings FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_negative_override_authorizations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_negative_override_logs FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_provisional_cost_positions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_provisional_cost_allocations FROM PUBLIC, anon, authenticated;

-- Explicitly revoke SELECT from PUBLIC and anon on all tables
REVOKE SELECT ON public.inventory_document_sequences FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_transactions FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_transaction_items FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_transaction_serials FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_balances FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_cost_balances FROM PUBLIC, anon;
REVOKE SELECT ON public.warehouse_inventory_account_mappings FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_negative_override_authorizations FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_negative_override_logs FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_provisional_cost_positions FROM PUBLIC, anon;
REVOKE SELECT ON public.inventory_provisional_cost_allocations FROM PUBLIC, anon;
REVOKE SELECT ON public.vw_inventory_ledger FROM PUBLIC, anon;

-- Grant SELECT to authenticated on tables and view
GRANT SELECT ON public.inventory_transactions TO authenticated;
GRANT SELECT ON public.inventory_transaction_items TO authenticated;
GRANT SELECT ON public.inventory_transaction_serials TO authenticated;
GRANT SELECT ON public.inventory_balances TO authenticated;
GRANT SELECT ON public.inventory_cost_balances TO authenticated;
GRANT SELECT ON public.warehouse_inventory_account_mappings TO authenticated;
GRANT SELECT ON public.inventory_negative_override_authorizations TO authenticated;
GRANT SELECT ON public.inventory_negative_override_logs TO authenticated;
GRANT SELECT ON public.inventory_provisional_cost_positions TO authenticated;
GRANT SELECT ON public.inventory_provisional_cost_allocations TO authenticated;
GRANT SELECT ON public.vw_inventory_ledger TO authenticated;

-- ==============================================================================
-- ATOMIC POSTING FUNCTION (public.post_inventory_transaction)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.post_inventory_transaction(
    p_organization_id UUID,
    p_transaction_id UUID,
    p_expected_version INT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT,
    p_negative_override_authorization_id UUID DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_membership_id UUID;
    v_appr_membership_id UUID;
    v_tx RECORD;
    v_item RECORD;
    v_serial RECORD;
    v_auth RECORD;
    v_audit RECORD;
    v_fy_closed BOOLEAN;
    v_fp_closed BOOLEAN;
    v_doc_number BIGINT;
    v_item_count INT;
    v_serial_count INT;
    v_any_warehouse_negative BOOLEAN := false;
    v_header_cost_state TEXT;
    v_has_provisional BOOLEAN := false;
    v_has_final BOOLEAN := false;
    v_has_mixed BOOLEAN := false;
    v_curr_wh_qty NUMERIC(18, 3);
    v_new_wh_qty NUMERIC(18, 3);
    v_curr_org_qty NUMERIC(18, 3);
    v_curr_org_val BIGINT;
    v_curr_wac BIGINT;
    v_new_org_qty NUMERIC(18, 3);
    v_new_org_val BIGINT;
    v_new_wac BIGINT;
    v_serial_sum_cost BIGINT;
    v_item_unit_cost BIGINT;
    v_item_total_cost BIGINT;
    v_item_cost_state TEXT;
    v_final_portion_qty NUMERIC(18, 3);
    v_prov_portion_qty NUMERIC(18, 3);
    v_final_portion_cost BIGINT;
    v_prov_portion_cost BIGINT;
    v_qty_before NUMERIC(18, 3);
    v_qty_after NUMERIC(18, 3);
    v_shortage NUMERIC(18, 3);
    v_req_qty NUMERIC(18, 3);
    v_wh_id UUID;
BEGIN
    -- --------------------------------------------------------------------------
    -- Step 0: Input Validation & Staging Setup
    -- --------------------------------------------------------------------------
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'p_expected_version is required.';
    END IF;

    IF p_operation_key IS NULL OR length(trim(p_operation_key)) = 0 OR p_request_fingerprint IS NULL OR length(trim(p_request_fingerprint)) = 0 THEN
        RAISE EXCEPTION 'p_operation_key and p_request_fingerprint are required.';
    END IF;

    -- Create temporary table for staging provisional cost positions
    CREATE TEMP TABLE IF NOT EXISTS tmp_staged_provisional_positions (
        issue_transaction_item_id UUID PRIMARY KEY,
        product_id UUID NOT NULL,
        warehouse_id UUID NOT NULL,
        shortage_quantity NUMERIC(18, 3) NOT NULL,
        provisional_unit_cost_amount BIGINT NOT NULL
    ) ON COMMIT DROP;
    TRUNCATE TABLE tmp_staged_provisional_positions;

    -- --------------------------------------------------------------------------
    -- Step 1: Authentication & Active Membership Checks
    -- --------------------------------------------------------------------------
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT om.id INTO v_membership_id
    FROM public.organization_memberships om
    JOIN public.user_profiles up ON up.id = om.user_id
    WHERE om.user_id = v_user_id
      AND om.organization_id = p_organization_id
      AND om.is_active = true
      AND up.is_active = true;

    IF v_membership_id IS NULL THEN
        RAISE EXCEPTION 'User profile or organization membership is inactive or missing for organization %.', p_organization_id;
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 2: Lock Transaction Header & Check Initiating Branch Permission & Idempotency
    -- --------------------------------------------------------------------------
    SELECT * INTO v_tx
    FROM public.inventory_transactions
    WHERE id = p_transaction_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF v_tx.id IS NULL THEN
        RAISE EXCEPTION 'Inventory transaction % not found in organization %.', p_transaction_id, p_organization_id;
    END IF;

    -- Initiating branch permission check MUST occur BEFORE idempotency check
    IF NOT public.has_branch_permission(p_organization_id, v_tx.initiating_branch_id, 'inventory:post') THEN
        RAISE EXCEPTION 'User lacks inventory:post permission for initiating branch %.', v_tx.initiating_branch_id;
    END IF;

    -- Idempotency check AFTER permissions
    IF v_tx.status = 'POSTED' THEN
        IF v_tx.idempotency_key = p_operation_key AND v_tx.request_fingerprint = p_request_fingerprint THEN
            RETURN v_tx.document_number;
        ELSIF v_tx.idempotency_key = p_operation_key AND v_tx.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Idempotency conflict: operation_key already used with a different request fingerprint.';
        ELSE
            RAISE EXCEPTION 'Inventory transaction is already POSTED under a different operation key.';
        END IF;
    END IF;

    -- Header Validations
    IF v_tx.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only DRAFT transactions can be posted. Current status: %', v_tx.status;
    END IF;

    IF v_tx.transaction_kind <> 'GENERAL' THEN
        RAISE EXCEPTION 'Direct posting of REVERSAL transactions is strictly forbidden.';
    END IF;

    IF v_tx.transaction_type IN ('SALES_RETURN', 'PURCHASE_RETURN') THEN
        RAISE EXCEPTION 'Posting transaction type % is deferred pending source_transaction_item_id implementation.', v_tx.transaction_type;
    END IF;

    IF v_tx.transaction_type NOT IN (
        'OPENING', 'PURCHASE_RECEIPT', 'SALE_ISSUE', 'TRANSFER',
        'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'COST_ADJUSTMENT'
    ) THEN
        RAISE EXCEPTION 'Unsupported transaction type for posting: %', v_tx.transaction_type;
    END IF;

    IF v_tx.version <> p_expected_version THEN
        RAISE EXCEPTION 'Concurrency error: transaction version mismatch. Expected %, found %.', p_expected_version, v_tx.version;
    END IF;

    IF v_tx.description IS NULL OR length(trim(v_tx.description)) = 0 THEN
        RAISE EXCEPTION 'Transaction description cannot be empty.';
    END IF;

    IF v_tx.journal_voucher_id IS NOT NULL THEN
        RAISE EXCEPTION 'Transaction journal_voucher_id must be NULL before posting.';
    END IF;

    -- Fiscal year and period validation
    SELECT fy.is_closed INTO v_fy_closed
    FROM public.fiscal_years fy
    WHERE fy.id = v_tx.fiscal_year_id AND fy.organization_id = p_organization_id
      AND v_tx.transaction_date >= fy.start_date AND v_tx.transaction_date <= fy.end_date;

    IF v_fy_closed IS NULL THEN
        RAISE EXCEPTION 'Transaction date % does not fall into fiscal year %.', v_tx.transaction_date, v_tx.fiscal_year_id;
    END IF;

    IF v_fy_closed = true THEN
        RAISE EXCEPTION 'Fiscal year % is closed.', v_tx.fiscal_year_id;
    END IF;

    SELECT fp.is_closed INTO v_fp_closed
    FROM public.fiscal_periods fp
    WHERE fp.organization_id = p_organization_id
      AND fp.fiscal_year_id = v_tx.fiscal_year_id
      AND v_tx.transaction_date >= fp.start_date
      AND v_tx.transaction_date <= fp.end_date;

    IF v_fp_closed IS NULL THEN
        RAISE EXCEPTION 'Transaction date % does not fall into any fiscal period in fiscal year %.', v_tx.transaction_date, v_tx.fiscal_year_id;
    END IF;

    IF v_fp_closed = true THEN
        RAISE EXCEPTION 'Fiscal period for transaction date % is closed.', v_tx.transaction_date;
    END IF;

    -- Ensure transaction has line items
    SELECT count(*) INTO v_item_count
    FROM public.inventory_transaction_items
    WHERE transaction_id = p_transaction_id AND organization_id = p_organization_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Transaction % has no line items.', p_transaction_id;
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 3: Validate Involved Warehouses & Products Permissions
    -- --------------------------------------------------------------------------
    FOR v_wh_id IN
        SELECT DISTINCT w_id FROM (
            SELECT source_warehouse_id AS w_id FROM public.inventory_transaction_items WHERE transaction_id = p_transaction_id AND organization_id = p_organization_id AND source_warehouse_id IS NOT NULL
            UNION
            SELECT destination_warehouse_id AS w_id FROM public.inventory_transaction_items WHERE transaction_id = p_transaction_id AND organization_id = p_organization_id AND destination_warehouse_id IS NOT NULL
        ) sub
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.warehouses w
            WHERE w.id = v_wh_id AND w.organization_id = p_organization_id AND w.status = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION 'Warehouse % does not exist, is inactive, or belongs to another organization.', v_wh_id;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.warehouses w
            WHERE w.id = v_wh_id AND w.organization_id = p_organization_id AND w.branch_id IS NOT NULL
              AND NOT public.has_branch_permission(p_organization_id, w.branch_id, 'inventory:post')
        ) THEN
            RAISE EXCEPTION 'User lacks inventory:post permission for branch assigned to warehouse %.', v_wh_id;
        END IF;

        IF NOT (
            public.has_permission(p_organization_id, 'inventory:manage')
            OR
            EXISTS (
                SELECT 1 FROM public.user_warehouse_access uwa
                WHERE uwa.organization_id = p_organization_id
                  AND uwa.membership_id = v_membership_id
                  AND uwa.warehouse_id = v_wh_id
                  AND uwa.is_active = true
            )
        ) THEN
            RAISE EXCEPTION 'User lacks access to warehouse %.', v_wh_id;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM public.inventory_transaction_items iti
        LEFT JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
        WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
          AND (p.id IS NULL OR p.status <> 'ACTIVE')
    ) THEN
        RAISE EXCEPTION 'Transaction contains products that are inactive, missing, or belong to another organization.';
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 4: Lock Balances and Serials in Strict Order
    -- --------------------------------------------------------------------------
    -- 4a. Lock inventory_balances (Ordered by warehouse_id, product_id)
    INSERT INTO public.inventory_balances (organization_id, warehouse_id, product_id, quantity_on_hand)
    SELECT DISTINCT p_organization_id, w_id, iti.product_id, 0
    FROM public.inventory_transaction_items iti
    CROSS JOIN LATERAL (
        SELECT iti.source_warehouse_id AS w_id WHERE iti.source_warehouse_id IS NOT NULL
        UNION ALL
        SELECT iti.destination_warehouse_id AS w_id WHERE iti.destination_warehouse_id IS NOT NULL
    ) w
    WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
    ON CONFLICT (organization_id, warehouse_id, product_id) DO NOTHING;

    PERFORM 1
    FROM public.inventory_balances ib
    JOIN (
        SELECT DISTINCT w_id, iti.product_id
        FROM public.inventory_transaction_items iti
        CROSS JOIN LATERAL (
            SELECT iti.source_warehouse_id AS w_id WHERE iti.source_warehouse_id IS NOT NULL
            UNION ALL
            SELECT iti.destination_warehouse_id AS w_id WHERE iti.destination_warehouse_id IS NOT NULL
        ) w
        WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
    ) req ON req.w_id = ib.warehouse_id AND req.product_id = ib.product_id
    WHERE ib.organization_id = p_organization_id
    ORDER BY ib.organization_id, ib.warehouse_id, ib.product_id
    FOR UPDATE;

    -- 4b. Lock inventory_cost_balances (Ordered by product_id)
    INSERT INTO public.inventory_cost_balances (organization_id, product_id, organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount)
    SELECT DISTINCT p_organization_id, iti.product_id, 0, 0, 0
    FROM public.inventory_transaction_items iti
    WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
    ON CONFLICT (organization_id, product_id) DO NOTHING;

    PERFORM 1
    FROM public.inventory_cost_balances icb
    WHERE icb.organization_id = p_organization_id
      AND icb.product_id IN (
          SELECT DISTINCT iti.product_id
          FROM public.inventory_transaction_items iti
          WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
      )
    ORDER BY icb.product_id
    FOR UPDATE;

    -- 4c. Lock Serials & Validate Duplicate Serials within transaction
    IF EXISTS (
        SELECT 1
        FROM public.inventory_transaction_serials its1
        JOIN public.inventory_transaction_serials its2 ON its1.product_serial_id = its2.product_serial_id AND its1.id <> its2.id
        JOIN public.inventory_transaction_items iti1 ON iti1.id = its1.transaction_item_id
        JOIN public.inventory_transaction_items iti2 ON iti2.id = its2.transaction_item_id
        WHERE iti1.transaction_id = p_transaction_id AND iti2.transaction_id = p_transaction_id
          AND iti1.organization_id = p_organization_id AND iti2.organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'Duplicate serial numbers within the same transaction are strictly forbidden.';
    END IF;

    PERFORM 1
    FROM public.inventory_transaction_serials its
    JOIN public.product_serials ps ON ps.id = its.product_serial_id AND ps.organization_id = its.organization_id
    WHERE its.organization_id = p_organization_id
      AND its.transaction_item_id IN (
          SELECT iti.id
          FROM public.inventory_transaction_items iti
          WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
      )
    ORDER BY ps.id
    FOR UPDATE OF ps;

    -- 4d. Lock & Validate Negative Override Authorization if provided
    IF p_negative_override_authorization_id IS NOT NULL THEN
        SELECT * INTO v_auth
        FROM public.inventory_negative_override_authorizations
        WHERE id = p_negative_override_authorization_id AND organization_id = p_organization_id
        FOR UPDATE;

        IF v_auth.id IS NULL THEN
            RAISE EXCEPTION 'Negative override authorization % not found in organization %.', p_negative_override_authorization_id, p_organization_id;
        END IF;

        IF v_auth.transaction_id <> p_transaction_id THEN
            RAISE EXCEPTION 'Negative override authorization transaction_id mismatch.';
        END IF;

        IF v_auth.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Negative override authorization request_fingerprint mismatch.';
        END IF;

        IF v_auth.status <> 'ISSUED' OR v_auth.consumed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Negative override authorization is not in ISSUED status or has already been consumed.';
        END IF;

        IF v_auth.expires_at <= now() THEN
            RAISE EXCEPTION 'Negative override authorization has expired.';
        END IF;

        -- Validate security audit log
        SELECT * INTO v_audit
        FROM public.security_audit_logs
        WHERE id = v_auth.security_audit_log_id AND organization_id = p_organization_id;

        IF v_audit.id IS NULL THEN
            RAISE EXCEPTION 'Referenced security audit log not found for negative override authorization.';
        END IF;

        IF v_audit.user_id <> v_auth.approved_by THEN
            RAISE EXCEPTION 'Security audit log user_id does not match authorization approved_by user.';
        END IF;

        IF v_audit.event_type <> 'INVENTORY_NEGATIVE_OVERRIDE_REAUTH_SUCCESS' THEN
            RAISE EXCEPTION 'Security audit log event_type % is invalid for negative override.', v_audit.event_type;
        END IF;

        IF COALESCE((v_audit.details->>'password_reauthenticated')::boolean, false) <> true OR
           COALESCE((v_audit.details->>'two_factor_verified')::boolean, false) <> true THEN
            RAISE EXCEPTION 'Security audit log must confirm password re-authentication and 2FA verification.';
        END IF;

        IF (v_audit.details->>'transaction_id')::uuid <> p_transaction_id OR
           (v_audit.details->>'request_fingerprint')::text <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Security audit log details transaction_id or request_fingerprint mismatch.';
        END IF;

        IF v_audit.created_at > v_auth.authorized_at OR v_audit.created_at < (v_auth.authorized_at - interval '5 minutes') THEN
            RAISE EXCEPTION 'Security audit log timestamp is not aligned with authorization authorized_at time.';
        END IF;

        -- Validate Approver active status & negative override permission
        SELECT om.id INTO v_appr_membership_id
        FROM public.organization_memberships om
        JOIN public.user_profiles up ON up.id = om.user_id
        WHERE om.user_id = v_auth.approved_by
          AND om.organization_id = p_organization_id
          AND om.is_active = true
          AND up.is_active = true;

        IF v_appr_membership_id IS NULL THEN
            RAISE EXCEPTION 'Approver user profile or organization membership is inactive or missing for organization %.', p_organization_id;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            JOIN public.user_profiles up ON up.id = om.user_id
            JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
            JOIN public.role_permissions rp ON rp.role_id = ur.role_id
            JOIN public.permissions p ON p.id = rp.permission_id
            WHERE om.user_id = v_auth.approved_by
              AND om.organization_id = p_organization_id
              AND om.is_active = true
              AND up.is_active = true
              AND p.code = 'inventory:negative_override'
              AND (
                  ur.branch_id IS NULL
                  OR ur.branch_id = v_tx.initiating_branch_id
              )
        ) THEN
            RAISE EXCEPTION 'Approver user lacks inventory:negative_override permission.';
        END IF;
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 5 & 6 & 7: Process Line Items
    -- --------------------------------------------------------------------------
    FOR v_item IN
        SELECT iti.*, p.is_serialized
        FROM public.inventory_transaction_items iti
        JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
        WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
        ORDER BY iti.row_number ASC
    LOOP
        -- ----------------------------------------------------------------------
        -- A. Serialized Items
        -- ----------------------------------------------------------------------
        IF v_item.is_serialized = true THEN
            IF v_item.quantity <> trunc(v_item.quantity) OR v_item.quantity <= 0 THEN
                RAISE EXCEPTION 'Serialized product % item quantity must be a positive integer.', v_item.product_id;
            END IF;

            SELECT count(*) INTO v_serial_count
            FROM public.inventory_transaction_serials
            WHERE transaction_item_id = v_item.id AND organization_id = p_organization_id;

            IF v_serial_count <> v_item.quantity THEN
                RAISE EXCEPTION 'Serial count mismatch for product %: expected %, found %.', v_item.product_id, v_item.quantity, v_serial_count;
            END IF;

            IF v_tx.transaction_type = 'COST_ADJUSTMENT' THEN
                RAISE EXCEPTION 'COST_ADJUSTMENT for serialized product % is strictly forbidden in this phase.', v_item.product_id;
            END IF;

            v_serial_sum_cost := 0;
            FOR v_serial IN
                SELECT ps.*, its.id AS trans_serial_id
                FROM public.inventory_transaction_serials its
                JOIN public.product_serials ps ON ps.id = its.product_serial_id AND ps.organization_id = its.organization_id
                WHERE its.transaction_item_id = v_item.id AND its.organization_id = p_organization_id
                ORDER BY ps.id ASC
            LOOP
                IF v_serial.organization_id <> p_organization_id OR v_serial.product_id <> v_item.product_id THEN
                    RAISE EXCEPTION 'Serial % does not belong to organization or product %.', v_serial.id, v_item.product_id;
                END IF;

                CASE v_tx.transaction_type
                    WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                        IF EXISTS (
                            SELECT 1
                            FROM public.inventory_transaction_serials its2
                            JOIN public.inventory_transaction_items iti2 ON iti2.id = its2.transaction_item_id
                            JOIN public.inventory_transactions it2 ON it2.id = iti2.transaction_id
                            WHERE its2.product_serial_id = v_serial.id
                              AND it2.status IN ('POSTED', 'REVERSED')
                        ) THEN
                            RAISE EXCEPTION 'Serial % has already been posted in a prior transaction and cannot be re-entered.', v_serial.serial_number_normalized;
                        END IF;

                        IF v_serial.status NOT IN ('AVAILABLE', 'RESERVED') THEN
                            RAISE EXCEPTION 'Serial % status % cannot be re-entered.', v_serial.serial_number_normalized, v_serial.status;
                        END IF;

                        IF v_item.destination_warehouse_id IS NULL THEN
                            RAISE EXCEPTION 'Destination warehouse is required for %.', v_tx.transaction_type;
                        END IF;

                        UPDATE public.product_serials
                        SET current_warehouse_id = v_item.destination_warehouse_id,
                            status = 'AVAILABLE'
                        WHERE id = v_serial.id AND organization_id = p_organization_id;

                    WHEN 'SALE_ISSUE' THEN
                        IF v_serial.current_warehouse_id IS DISTINCT FROM v_item.source_warehouse_id THEN
                            RAISE EXCEPTION 'Serial % is not in source warehouse %.', v_serial.serial_number_normalized, v_item.source_warehouse_id;
                        END IF;

                        IF v_serial.status NOT IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN
                            RAISE EXCEPTION 'Serial % status % is not available for sale.', v_serial.serial_number_normalized, v_serial.status;
                        END IF;

                        UPDATE public.product_serials
                        SET current_warehouse_id = NULL,
                            status = 'SOLD'
                        WHERE id = v_serial.id AND organization_id = p_organization_id;

                    WHEN 'TRANSFER' THEN
                        IF v_serial.current_warehouse_id IS DISTINCT FROM v_item.source_warehouse_id THEN
                            RAISE EXCEPTION 'Serial % is not in source warehouse %.', v_serial.serial_number_normalized, v_item.source_warehouse_id;
                        END IF;

                        IF v_serial.status NOT IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN
                            RAISE EXCEPTION 'Serial % status % is not available for transfer.', v_serial.serial_number_normalized, v_serial.status;
                        END IF;

                        UPDATE public.product_serials
                        SET current_warehouse_id = v_item.destination_warehouse_id
                        WHERE id = v_serial.id AND organization_id = p_organization_id;

                    WHEN 'ADJUSTMENT_OUT' THEN
                        IF v_serial.current_warehouse_id IS DISTINCT FROM v_item.source_warehouse_id THEN
                            RAISE EXCEPTION 'Serial % is not in source warehouse %.', v_serial.serial_number_normalized, v_item.source_warehouse_id;
                        END IF;

                        IF v_serial.status NOT IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN
                            RAISE EXCEPTION 'Serial % status % is not available for adjustment out.', v_serial.serial_number_normalized, v_serial.status;
                        END IF;

                        UPDATE public.product_serials
                        SET current_warehouse_id = NULL,
                            status = 'SCRAPPED'
                        WHERE id = v_serial.id AND organization_id = p_organization_id;

                    ELSE
                        RAISE EXCEPTION 'Unsupported transaction type % for serialized products.', v_tx.transaction_type;
                END CASE;

                v_serial_sum_cost := v_serial_sum_cost + v_serial.acquisition_cost_amount;
            END LOOP;

            v_item_total_cost := v_serial_sum_cost;
            v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
            v_item_cost_state := 'FINAL';

            -- MUST set cost_adjustment_amount to NULL for non-COST_ADJUSTMENT items!
            UPDATE public.inventory_transaction_items
            SET unit_cost_amount = v_item_unit_cost,
                total_cost_amount = v_item_total_cost,
                cost_adjustment_amount = NULL,
                cost_state = v_item_cost_state
            WHERE id = v_item.id AND organization_id = p_organization_id;

            -- Update Cost Balance incrementally for serialized item
            SELECT organization_quantity_on_hand, inventory_value_amount
            INTO v_curr_org_qty, v_curr_org_val
            FROM public.inventory_cost_balances
            WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            CASE v_tx.transaction_type
                WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                    v_new_org_qty := v_curr_org_qty + v_item.quantity;
                    v_new_org_val := v_curr_org_val + v_item_total_cost;
                WHEN 'SALE_ISSUE', 'ADJUSTMENT_OUT' THEN
                    v_new_org_qty := v_curr_org_qty - v_item.quantity;
                    v_new_org_val := v_curr_org_val - v_item_total_cost;
                    IF v_new_org_qty < 0 OR v_new_org_val < 0 THEN
                        RAISE EXCEPTION 'Serialized inventory balance cannot be negative.';
                    END IF;
                WHEN 'TRANSFER' THEN
                    v_new_org_qty := v_curr_org_qty;
                    v_new_org_val := v_curr_org_val;
            END CASE;

            v_new_wac := CASE WHEN v_new_org_qty > 0 THEN round(v_new_org_val::numeric / v_new_org_qty) ELSE 0 END;

            UPDATE public.inventory_cost_balances
            SET organization_quantity_on_hand = v_new_org_qty,
                inventory_value_amount = v_new_org_val,
                weighted_average_cost_amount = v_new_wac,
                last_transaction_id = p_transaction_id
            WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            -- Update Warehouse Balances for serialized item
            CASE v_tx.transaction_type
                WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.destination_warehouse_id
                      AND product_id = v_item.product_id;

                WHEN 'SALE_ISSUE', 'ADJUSTMENT_OUT' THEN
                    SELECT quantity_on_hand INTO v_curr_wh_qty
                    FROM public.inventory_balances
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    IF v_curr_wh_qty < v_item.quantity THEN
                        RAISE EXCEPTION 'Insufficient warehouse inventory balance for serialized product % in warehouse %.', v_item.product_id, v_item.source_warehouse_id;
                    END IF;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                WHEN 'TRANSFER' THEN
                    SELECT quantity_on_hand INTO v_curr_wh_qty
                    FROM public.inventory_balances
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    IF v_curr_wh_qty < v_item.quantity THEN
                        RAISE EXCEPTION 'Insufficient warehouse inventory balance for serialized transfer of product % in warehouse %.', v_item.product_id, v_item.source_warehouse_id;
                    END IF;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.destination_warehouse_id
                      AND product_id = v_item.product_id;
            END CASE;

        -- ----------------------------------------------------------------------
        -- B. Non-Serialized Items
        -- ----------------------------------------------------------------------
        ELSE
            IF EXISTS (
                SELECT 1 FROM public.inventory_transaction_serials
                WHERE transaction_item_id = v_item.id AND organization_id = p_organization_id
            ) THEN
                RAISE EXCEPTION 'Non-serialized product % line item cannot have serial records.', v_item.product_id;
            END IF;

            -- Warehouse Quantity Updates
            CASE v_tx.transaction_type
                WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                    IF v_item.destination_warehouse_id IS NULL OR v_item.source_warehouse_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Inbound transaction item requires destination_warehouse_id and NULL source_warehouse_id.';
                    END IF;
                    IF v_item.quantity <= 0 THEN
                        RAISE EXCEPTION 'Inbound quantity must be positive.';
                    END IF;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.destination_warehouse_id
                      AND product_id = v_item.product_id;

                WHEN 'SALE_ISSUE', 'ADJUSTMENT_OUT' THEN
                    IF v_item.source_warehouse_id IS NULL OR v_item.destination_warehouse_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Outbound transaction item requires source_warehouse_id and NULL destination_warehouse_id.';
                    END IF;
                    IF v_item.quantity <= 0 THEN
                        RAISE EXCEPTION 'Outbound quantity must be positive.';
                    END IF;

                    SELECT quantity_on_hand INTO v_curr_wh_qty
                    FROM public.inventory_balances
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    v_new_wh_qty := v_curr_wh_qty - v_item.quantity;

                    IF v_new_wh_qty < 0 THEN
                        v_any_warehouse_negative := true;
                        IF v_tx.transaction_type <> 'SALE_ISSUE' THEN
                            RAISE EXCEPTION 'Insufficient warehouse inventory balance for product % in warehouse %.', v_item.product_id, v_item.source_warehouse_id;
                        END IF;

                        IF p_negative_override_authorization_id IS NULL OR v_auth.id IS NULL THEN
                            RAISE EXCEPTION 'Negative inventory override authorization is required because one or more warehouse balances became negative.';
                        END IF;

                        v_qty_before := v_curr_wh_qty;
                        v_qty_after := v_new_wh_qty;
                        v_req_qty := v_item.quantity;
                        v_shortage := v_req_qty - GREATEST(v_qty_before, 0);

                        INSERT INTO public.inventory_negative_override_logs (
                            organization_id, authorization_id, transaction_id, transaction_item_id,
                            product_id, warehouse_id, quantity_before, requested_quantity,
                            quantity_after, shortage_quantity, reason_snapshot, approved_by, posted_by
                        ) VALUES (
                            p_organization_id, v_auth.id, p_transaction_id, v_item.id,
                            v_item.product_id, v_item.source_warehouse_id, v_qty_before, v_req_qty,
                            v_qty_after, v_shortage, v_auth.reason, v_auth.approved_by, v_user_id
                        );
                    END IF;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                WHEN 'TRANSFER' THEN
                    IF v_item.source_warehouse_id IS NULL OR v_item.destination_warehouse_id IS NULL OR v_item.source_warehouse_id = v_item.destination_warehouse_id THEN
                        RAISE EXCEPTION 'Transfer requires distinct source and destination warehouses.';
                    END IF;
                    IF v_item.quantity <= 0 THEN
                        RAISE EXCEPTION 'Transfer quantity must be positive.';
                    END IF;

                    SELECT quantity_on_hand INTO v_curr_wh_qty
                    FROM public.inventory_balances
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    IF v_curr_wh_qty < v_item.quantity THEN
                        RAISE EXCEPTION 'Insufficient warehouse inventory for transfer of product % in warehouse %.', v_item.product_id, v_item.source_warehouse_id;
                    END IF;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.source_warehouse_id
                      AND product_id = v_item.product_id;

                    UPDATE public.inventory_balances
                    SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                        last_transaction_id = p_transaction_id
                    WHERE organization_id = p_organization_id
                      AND warehouse_id = v_item.destination_warehouse_id
                      AND product_id = v_item.product_id;

                WHEN 'COST_ADJUSTMENT' THEN
                    IF v_item.quantity <> 0 THEN
                        RAISE EXCEPTION 'COST_ADJUSTMENT quantity must be exactly zero.';
                    END IF;
                    IF v_item.cost_adjustment_amount IS NULL OR v_item.cost_adjustment_amount = 0 THEN
                        RAISE EXCEPTION 'COST_ADJUSTMENT cost_adjustment_amount must be non-zero.';
                    END IF;
            END CASE;

            -- Cost Balances & Item Pricing Calculation
            SELECT organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount
            INTO v_curr_org_qty, v_curr_org_val, v_curr_wac
            FROM public.inventory_cost_balances
            WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            CASE v_tx.transaction_type
                WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                    IF v_item.unit_cost_amount IS NULL OR v_item.unit_cost_amount < 0 THEN
                        RAISE EXCEPTION 'Inbound unit cost amount is required and non-negative.';
                    END IF;

                    v_item_total_cost := round(v_item.quantity * v_item.unit_cost_amount);
                    v_item_unit_cost := v_item.unit_cost_amount;
                    v_item_cost_state := 'FINAL';

                    v_new_org_qty := v_curr_org_qty + v_item.quantity;
                    v_new_org_val := v_curr_org_val + v_item_total_cost;
                    v_new_wac := CASE WHEN v_new_org_qty > 0 THEN round(v_new_org_val::numeric / v_new_org_qty) ELSE 0 END;

                    UPDATE public.inventory_transaction_items
                    SET unit_cost_amount = v_item_unit_cost,
                        total_cost_amount = v_item_total_cost,
                        cost_adjustment_amount = NULL,
                        cost_state = v_item_cost_state
                    WHERE id = v_item.id AND organization_id = p_organization_id;

                WHEN 'SALE_ISSUE' THEN
                    IF v_curr_org_qty >= v_item.quantity THEN
                        IF v_curr_org_qty = v_item.quantity THEN
                            -- Full organizational exit: consume EXACT inventory_value_amount to avoid rounding remainders
                            v_item_total_cost := v_curr_org_val;
                            v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
                        ELSE
                            -- Partial exit: calculate via exact ratio (inventory_value_amount / organization_quantity_on_hand)
                            v_item_total_cost := round(v_item.quantity * (v_curr_org_val::numeric / v_curr_org_qty));
                            v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
                        END IF;
                        v_item_cost_state := 'FINAL';

                        v_new_org_qty := v_curr_org_qty - v_item.quantity;
                        v_new_org_val := v_curr_org_val - v_item_total_cost;
                        v_new_wac := CASE WHEN v_new_org_qty > 0 THEN round(v_new_org_val::numeric / v_new_org_qty) ELSE 0 END;

                        UPDATE public.inventory_transaction_items
                        SET unit_cost_amount = v_item_unit_cost,
                            total_cost_amount = v_item_total_cost,
                            cost_adjustment_amount = NULL,
                            cost_state = v_item_cost_state
                        WHERE id = v_item.id AND organization_id = p_organization_id;

                    ELSIF v_curr_org_qty <= 0 THEN
                        IF v_item.unit_cost_amount IS NULL OR v_item.unit_cost_amount <= 0 THEN
                            RAISE EXCEPTION 'Provisional unit cost amount must be provided and greater than zero for organizational shortage.';
                        END IF;

                        v_item_unit_cost := v_item.unit_cost_amount;
                        v_item_total_cost := round(v_item.quantity * v_item.unit_cost_amount);
                        v_item_cost_state := 'PROVISIONAL';

                        -- Stage provisional cost position to insert AFTER header POSTED update
                        INSERT INTO tmp_staged_provisional_positions (
                            issue_transaction_item_id, product_id, warehouse_id, shortage_quantity, provisional_unit_cost_amount
                        ) VALUES (
                            v_item.id, v_item.product_id, v_item.source_warehouse_id, v_item.quantity, v_item.unit_cost_amount
                        );

                        v_new_org_qty := v_curr_org_qty - v_item.quantity;
                        v_new_org_val := v_curr_org_val - v_item_total_cost;
                        v_new_wac := v_curr_wac;

                        UPDATE public.inventory_transaction_items
                        SET unit_cost_amount = v_item_unit_cost,
                            total_cost_amount = v_item_total_cost,
                            cost_adjustment_amount = NULL,
                            cost_state = v_item_cost_state
                        WHERE id = v_item.id AND organization_id = p_organization_id;

                    ELSE
                        IF v_item.unit_cost_amount IS NULL OR v_item.unit_cost_amount <= 0 THEN
                            RAISE EXCEPTION 'Provisional unit cost amount must be provided and greater than zero for partial organizational shortage.';
                        END IF;

                        v_final_portion_qty := v_curr_org_qty;
                        v_prov_portion_qty := v_item.quantity - v_curr_org_qty;

                        -- Final portion consumes entire remaining inventory_value_amount exactly
                        v_final_portion_cost := v_curr_org_val;
                        v_prov_portion_cost := round(v_prov_portion_qty * v_item.unit_cost_amount);
                        v_item_total_cost := v_final_portion_cost + v_prov_portion_cost;
                        v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
                        v_item_cost_state := 'MIXED';

                        -- Stage provisional cost position for the shortage portion
                        INSERT INTO tmp_staged_provisional_positions (
                            issue_transaction_item_id, product_id, warehouse_id, shortage_quantity, provisional_unit_cost_amount
                        ) VALUES (
                            v_item.id, v_item.product_id, v_item.source_warehouse_id, v_prov_portion_qty, v_item.unit_cost_amount
                        );

                        v_new_org_qty := v_curr_org_qty - v_item.quantity;
                        v_new_org_val := v_curr_org_val - v_item_total_cost;
                        v_new_wac := v_curr_wac;

                        UPDATE public.inventory_transaction_items
                        SET unit_cost_amount = v_item_unit_cost,
                            total_cost_amount = v_item_total_cost,
                            cost_adjustment_amount = NULL,
                            cost_state = v_item_cost_state
                        WHERE id = v_item.id AND organization_id = p_organization_id;
                    END IF;

                WHEN 'TRANSFER' THEN
                    v_item_unit_cost := v_curr_wac;
                    v_item_total_cost := round(v_item.quantity * v_curr_wac);
                    v_item_cost_state := 'FINAL';

                    v_new_org_qty := v_curr_org_qty;
                    v_new_org_val := v_curr_org_val;
                    v_new_wac := v_curr_wac;

                    UPDATE public.inventory_transaction_items
                    SET unit_cost_amount = v_item_unit_cost,
                        total_cost_amount = v_item_total_cost,
                        cost_adjustment_amount = NULL,
                        cost_state = v_item_cost_state
                    WHERE id = v_item.id AND organization_id = p_organization_id;

                WHEN 'ADJUSTMENT_OUT' THEN
                    IF v_curr_org_qty < v_item.quantity THEN
                        RAISE EXCEPTION 'Insufficient organizational inventory balance for ADJUSTMENT_OUT of product %.', v_item.product_id;
                    END IF;

                    IF v_curr_org_qty = v_item.quantity THEN
                        v_item_total_cost := v_curr_org_val;
                        v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
                        v_new_org_qty := 0;
                        v_new_org_val := 0;
                        v_new_wac := 0;
                    ELSE
                        v_item_total_cost := round(v_item.quantity * (v_curr_org_val::numeric / v_curr_org_qty));
                        v_item_unit_cost := round(v_item_total_cost::numeric / v_item.quantity);
                        v_new_org_qty := v_curr_org_qty - v_item.quantity;
                        v_new_org_val := v_curr_org_val - v_item_total_cost;
                        v_new_wac := CASE WHEN v_new_org_qty > 0 THEN round(v_new_org_val::numeric / v_new_org_qty) ELSE 0 END;
                    END IF;

                    v_item_cost_state := 'FINAL';

                    UPDATE public.inventory_transaction_items
                    SET unit_cost_amount = v_item_unit_cost,
                        total_cost_amount = v_item_total_cost,
                        cost_adjustment_amount = NULL,
                        cost_state = v_item_cost_state
                    WHERE id = v_item.id AND organization_id = p_organization_id;

                WHEN 'COST_ADJUSTMENT' THEN
                    IF v_curr_org_qty = 0 THEN
                        RAISE EXCEPTION 'Cannot apply COST_ADJUSTMENT when organizational quantity is zero.';
                    END IF;

                    v_item_unit_cost := 0;
                    v_item_total_cost := 0;
                    v_item_cost_state := 'FINAL';

                    v_new_org_qty := v_curr_org_qty;
                    v_new_org_val := v_curr_org_val + v_item.cost_adjustment_amount;

                    IF (v_new_org_qty > 0 AND v_new_org_val < 0) OR (v_new_org_qty < 0 AND v_new_org_val > 0) THEN
                        RAISE EXCEPTION 'COST_ADJUSTMENT results in inconsistent inventory value sign (%) for quantity (%).', v_new_org_val, v_new_org_qty;
                    END IF;

                    v_new_wac := round(abs(v_new_org_val)::numeric / abs(v_new_org_qty));

                    UPDATE public.inventory_transaction_items
                    SET unit_cost_amount = 0,
                        total_cost_amount = 0,
                        cost_state = v_item_cost_state
                    WHERE id = v_item.id AND organization_id = p_organization_id;

            END CASE;

            IF v_new_org_qty = 0 THEN
                IF v_new_org_val <> 0 THEN
                    IF NOT EXISTS (
                        SELECT 1 FROM public.inventory_provisional_cost_positions
                        WHERE product_id = v_item.product_id AND organization_id = p_organization_id
                          AND status IN ('OPEN', 'PARTIALLY_SETTLED')
                    ) THEN
                        RAISE EXCEPTION 'Non-zero inventory value (%) remaining when quantity is zero for product %.', v_new_org_val, v_item.product_id;
                    END IF;
                END IF;
                v_new_wac := 0;
            END IF;

            UPDATE public.inventory_cost_balances
            SET organization_quantity_on_hand = v_new_org_qty,
                inventory_value_amount = v_new_org_val,
                weighted_average_cost_amount = v_new_wac,
                last_transaction_id = p_transaction_id
            WHERE organization_id = p_organization_id AND product_id = v_item.product_id;
        END IF;

        IF v_item_cost_state = 'FINAL' THEN v_has_final := true; END IF;
        IF v_item_cost_state = 'PROVISIONAL' THEN v_has_provisional := true; END IF;
        IF v_item_cost_state = 'MIXED' THEN v_has_mixed := true; END IF;

    END LOOP;

    -- --------------------------------------------------------------------------
    -- Step 8: Negative Inventory Override Consumption
    -- --------------------------------------------------------------------------
    IF v_any_warehouse_negative = true THEN
        UPDATE public.inventory_negative_override_authorizations
        SET status = 'CONSUMED',
            consumed_at = now()
        WHERE id = v_auth.id AND organization_id = p_organization_id;

    ELSE
        IF p_negative_override_authorization_id IS NOT NULL THEN
            RAISE EXCEPTION 'Unnecessary negative override authorization provided.';
        END IF;
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 9: Determine Header Cost State
    -- --------------------------------------------------------------------------
    IF v_has_mixed OR (v_has_final AND v_has_provisional) THEN
        v_header_cost_state := 'MIXED';
    ELSIF v_has_provisional THEN
        v_header_cost_state := 'PROVISIONAL';
    ELSE
        v_header_cost_state := 'FINAL';
    END IF;

    -- --------------------------------------------------------------------------
    -- Step 10: Document Sequence Generation
    -- --------------------------------------------------------------------------
    INSERT INTO public.inventory_document_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_tx.fiscal_year_id, 1, v_user_id)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_doc_number
    FROM public.inventory_document_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_tx.fiscal_year_id
    FOR UPDATE;

    UPDATE public.inventory_document_sequences
    SET next_number = next_number + 1,
        updated_by = v_user_id,
        updated_at = now()
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_tx.fiscal_year_id;

    -- --------------------------------------------------------------------------
    -- Step 11: Update Header to POSTED
    -- --------------------------------------------------------------------------
    UPDATE public.inventory_transactions
    SET document_number = v_doc_number,
        status = 'POSTED',
        cost_state = v_header_cost_state,
        idempotency_key = p_operation_key,
        request_fingerprint = p_request_fingerprint,
        posted_by = v_user_id,
        posted_at = now()
    WHERE id = p_transaction_id AND organization_id = p_organization_id;

    -- --------------------------------------------------------------------------
    -- Step 12: Insert Staged Provisional Cost Positions (Header is now POSTED)
    -- --------------------------------------------------------------------------
    INSERT INTO public.inventory_provisional_cost_positions (
        organization_id, issue_transaction_item_id, product_id, warehouse_id,
        shortage_quantity, remaining_quantity, provisional_unit_cost_amount, provisional_total_cost_amount, status
    )
    SELECT
        p_organization_id,
        stage.issue_transaction_item_id,
        stage.product_id,
        stage.warehouse_id,
        stage.shortage_quantity,
        stage.shortage_quantity,
        stage.provisional_unit_cost_amount,
        round(stage.shortage_quantity * stage.provisional_unit_cost_amount),
        'OPEN'
    FROM tmp_staged_provisional_positions stage;

    RETURN v_doc_number;
END;
$$;

-- Security Hardening: Revoke execution from PUBLIC, anon, and authenticated
REVOKE EXECUTE ON FUNCTION public.post_inventory_transaction(UUID, UUID, INT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ==============================================================================
-- N. ATOMIC INVENTORY TRANSACTION REVERSAL FUNCTION
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.reverse_inventory_transaction(
    p_organization_id UUID,
    p_original_transaction_id UUID,
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
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_membership_id UUID;
    v_original RECORD;
    v_reversal_id UUID;
    v_reversal_type TEXT;
    v_existing_reversal RECORD;
    v_conflicting_tx RECORD;
    v_fiscal_year RECORD;
    v_open_period_count INT;
    v_doc_number BIGINT;
    v_seq_next BIGINT;
    v_item RECORD;
    v_header_cost_state TEXT;
    v_desc TEXT;
    v_serial RECORD;
    v_serial_count INT;
    v_subsequent_tx_count INT;
    v_curr_wh_qty NUMERIC(18,3);
    v_curr_org_qty NUMERIC(18,3);
    v_curr_org_val BIGINT;
    v_curr_wac BIGINT;
    v_new_wh_qty NUMERIC(18,3);
    v_new_org_qty NUMERIC(18,3);
    v_new_org_val BIGINT;
    v_new_wac BIGINT;
    v_curr_dest_wh_qty NUMERIC(18,3);
    v_has_final BOOLEAN := false;
    v_has_provisional BOOLEAN := false;
    v_has_mixed BOOLEAN := false;
    v_wh RECORD;
    v_wh_branch_id UUID;
BEGIN
    -- 1. Authentication & Active User Profile Check
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT om.id INTO v_membership_id
    FROM public.organization_memberships om
    JOIN public.user_profiles up ON up.id = om.user_id
    WHERE om.organization_id = p_organization_id
      AND om.user_id = v_user_id
      AND om.is_active = true
      AND up.is_active = true;

    IF v_membership_id IS NULL THEN
        RAISE EXCEPTION 'User profile or organization membership is inactive or missing for organization %.', p_organization_id;
    END IF;

    -- 2. Input Parameter Validations
    IF p_original_transaction_id IS NULL THEN
        RAISE EXCEPTION 'p_original_transaction_id is required.';
    END IF;

    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'p_expected_version is required.';
    END IF;

    IF p_reversal_fiscal_year_id IS NULL THEN
        RAISE EXCEPTION 'p_reversal_fiscal_year_id is required.';
    END IF;

    IF p_reversal_date IS NULL THEN
        RAISE EXCEPTION 'p_reversal_date is required.';
    END IF;

    IF p_reversal_reason IS NULL OR trim(p_reversal_reason) = '' THEN
        RAISE EXCEPTION 'p_reversal_reason must not be empty.';
    END IF;

    IF p_operation_key IS NULL OR trim(p_operation_key) = '' THEN
        RAISE EXCEPTION 'p_operation_key must not be empty.';
    END IF;

    IF p_request_fingerprint IS NULL OR trim(p_request_fingerprint) = '' THEN
        RAISE EXCEPTION 'p_request_fingerprint must not be empty.';
    END IF;

    -- 3. Lock Original Transaction Header FOR UPDATE
    SELECT * INTO v_original
    FROM public.inventory_transactions
    WHERE id = p_original_transaction_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF v_original.id IS NULL THEN
        RAISE EXCEPTION 'Original inventory transaction not found in the specified organization.';
    END IF;

    -- 4. Branch Permission Check
    IF NOT public.has_branch_permission(p_organization_id, v_original.initiating_branch_id, 'inventory:reverse') THEN
        RAISE EXCEPTION 'User lacks inventory:reverse permission for initiating branch %.', v_original.initiating_branch_id;
    END IF;

    -- 4b. Involved Warehouses Permission Check (Ordered by warehouse_id)
    FOR v_wh IN
        SELECT DISTINCT w_id
        FROM (
            SELECT source_warehouse_id AS w_id
            FROM public.inventory_transaction_items
            WHERE transaction_id = v_original.id AND organization_id = p_organization_id AND source_warehouse_id IS NOT NULL
            UNION
            SELECT destination_warehouse_id AS w_id
            FROM public.inventory_transaction_items
            WHERE transaction_id = v_original.id AND organization_id = p_organization_id AND destination_warehouse_id IS NOT NULL
        ) sub
        ORDER BY w_id
    LOOP
        SELECT branch_id INTO v_wh_branch_id
        FROM public.warehouses
        WHERE id = v_wh.w_id AND organization_id = p_organization_id;

        IF v_wh_branch_id IS NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.warehouses
                WHERE id = v_wh.w_id AND organization_id = p_organization_id
            ) THEN
                RAISE EXCEPTION 'Warehouse % does not exist or belongs to another organization.', v_wh.w_id;
            ELSE
                RAISE EXCEPTION 'Warehouse % is not connected to a branch.', v_wh.w_id;
            END IF;
        END IF;

        IF NOT public.has_branch_permission(p_organization_id, v_wh_branch_id, 'inventory:reverse') THEN
            RAISE EXCEPTION 'User lacks inventory:reverse permission for branch % assigned to warehouse %.', v_wh_branch_id, v_wh.w_id;
        END IF;

        IF NOT (
            public.has_permission(p_organization_id, 'inventory:manage')
            OR
            EXISTS (
                SELECT 1 FROM public.user_warehouse_access uwa
                WHERE uwa.organization_id = p_organization_id
                  AND uwa.membership_id = v_membership_id
                  AND uwa.warehouse_id = v_wh.w_id
                  AND uwa.is_active = true
            )
        ) THEN
            RAISE EXCEPTION 'User lacks access to warehouse %.', v_wh.w_id;
        END IF;
    END LOOP;

    -- 5. Idempotency & Conflict Check
    SELECT * INTO v_existing_reversal
    FROM public.inventory_transactions
    WHERE organization_id = p_organization_id
      AND reversal_of_transaction_id = v_original.id;

    IF v_existing_reversal.id IS NOT NULL THEN
        IF v_existing_reversal.idempotency_key = p_operation_key
           AND v_existing_reversal.request_fingerprint = p_request_fingerprint THEN
            RETURN v_existing_reversal.id;
        ELSE
            RAISE EXCEPTION 'Transaction % has already been reversed.', p_original_transaction_id;
        END IF;
    END IF;

    SELECT * INTO v_conflicting_tx
    FROM public.inventory_transactions
    WHERE organization_id = p_organization_id
      AND idempotency_key = p_operation_key;

    IF v_conflicting_tx.id IS NOT NULL THEN
        IF v_conflicting_tx.reversal_of_transaction_id IS DISTINCT FROM v_original.id OR v_conflicting_tx.request_fingerprint <> p_request_fingerprint THEN
            RAISE EXCEPTION 'Idempotency key % has already been used with a different request or transaction.', p_operation_key;
        END IF;
    END IF;

    -- 6. Original Transaction State & Eligibility Checks
    IF v_original.version <> p_expected_version THEN
        RAISE EXCEPTION 'Version mismatch. Expected %, but document version is %.', p_expected_version, v_original.version;
    END IF;

    IF v_original.status <> 'POSTED' THEN
        RAISE EXCEPTION 'Only POSTED transactions can be reversed. Current status is %.', v_original.status;
    END IF;

    IF v_original.transaction_kind <> 'GENERAL' THEN
        RAISE EXCEPTION 'Only GENERAL transactions can be reversed. Current transaction_kind is %.', v_original.transaction_kind;
    END IF;

    IF v_original.journal_voucher_id IS NOT NULL THEN
        RAISE EXCEPTION 'Transaction linked to accounting journal voucher % cannot be reversed until accounting-inventory atomic integration is implemented.', v_original.journal_voucher_id;
    END IF;

    IF p_reversal_date < v_original.transaction_date THEN
        RAISE EXCEPTION 'Reversal date (%) cannot be earlier than original transaction date (%).', p_reversal_date, v_original.transaction_date;
    END IF;

    -- 7. Fiscal Year & Open Period Validation
    SELECT * INTO v_fiscal_year
    FROM public.fiscal_years
    WHERE id = p_reversal_fiscal_year_id
      AND organization_id = p_organization_id;

    IF v_fiscal_year.id IS NULL THEN
        RAISE EXCEPTION 'Reversal fiscal year not found in the specified organization.';
    END IF;

    IF v_fiscal_year.is_closed THEN
        RAISE EXCEPTION 'Reversal fiscal year % is closed.', v_fiscal_year.title;
    END IF;

    IF p_reversal_date < v_fiscal_year.start_date OR p_reversal_date > v_fiscal_year.end_date THEN
        RAISE EXCEPTION 'Reversal date % is outside reversal fiscal year % range (% to %).',
            p_reversal_date, v_fiscal_year.title, v_fiscal_year.start_date, v_fiscal_year.end_date;
    END IF;

    SELECT COUNT(*) INTO v_open_period_count
    FROM public.fiscal_periods
    WHERE organization_id = p_organization_id
      AND fiscal_year_id = p_reversal_fiscal_year_id
      AND start_date <= p_reversal_date
      AND end_date >= p_reversal_date
      AND is_closed = false;

    IF v_open_period_count <> 1 THEN
        RAISE EXCEPTION 'Exactly one open fiscal period must cover reversal date %. Found % open periods.', p_reversal_date, v_open_period_count;
    END IF;

    -- 8. Supported Types & Type Mapping
    IF v_original.transaction_type IN ('SALES_RETURN', 'PURCHASE_RETURN') THEN
        RAISE EXCEPTION 'Reversal of % is currently unsupported as return lifecycle logic is not fully integrated.', v_original.transaction_type;
    END IF;

    CASE v_original.transaction_type
        WHEN 'OPENING' THEN v_reversal_type := 'ADJUSTMENT_OUT';
        WHEN 'PURCHASE_RECEIPT' THEN v_reversal_type := 'PURCHASE_RETURN';
        WHEN 'SALE_ISSUE' THEN v_reversal_type := 'SALES_RETURN';
        WHEN 'TRANSFER' THEN v_reversal_type := 'TRANSFER';
        WHEN 'ADJUSTMENT_IN' THEN v_reversal_type := 'ADJUSTMENT_OUT';
        WHEN 'ADJUSTMENT_OUT' THEN v_reversal_type := 'ADJUSTMENT_IN';
        WHEN 'COST_ADJUSTMENT' THEN v_reversal_type := 'COST_ADJUSTMENT';
        ELSE
            RAISE EXCEPTION 'Unsupported original transaction type: %', v_original.transaction_type;
    END CASE;

    -- 9. Create Draft Reversal Transaction Header
    v_reversal_id := gen_random_uuid();
    v_desc := 'معکوس‌سازی سند شماره ' || COALESCE(v_original.document_number::TEXT, v_original.id::TEXT) || ' - ' || trim(p_reversal_reason);

    INSERT INTO public.inventory_transactions (
        id,
        organization_id,
        fiscal_year_id,
        initiating_branch_id,
        transaction_date,
        transaction_type,
        transaction_kind,
        status,
        document_number,
        reversal_of_transaction_id,
        source_event_key,
        idempotency_key,
        request_fingerprint,
        journal_voucher_id,
        created_by,
        description,
        cost_state
    ) VALUES (
        v_reversal_id,
        p_organization_id,
        p_reversal_fiscal_year_id,
        v_original.initiating_branch_id,
        p_reversal_date,
        v_reversal_type,
        'REVERSAL',
        'DRAFT',
        NULL,
        v_original.id,
        NULL,
        p_operation_key,
        p_request_fingerprint,
        NULL,
        v_user_id,
        v_desc,
        'PENDING'
    );

    -- 10. Create Reversal Transaction Items & Copy Serial Associations
    FOR v_item IN
        SELECT * FROM public.inventory_transaction_items
        WHERE transaction_id = v_original.id AND organization_id = p_organization_id
        ORDER BY row_number, id
    LOOP
        DECLARE
            v_reversal_item_id UUID := gen_random_uuid();
            v_rev_src_wh UUID;
            v_rev_dest_wh UUID;
            v_adj_cost BIGINT;
        BEGIN
            IF v_original.transaction_type IN ('OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN') THEN
                v_rev_src_wh := v_item.destination_warehouse_id;
                v_rev_dest_wh := NULL;
                v_adj_cost := NULL;
            ELSIF v_original.transaction_type IN ('SALE_ISSUE', 'ADJUSTMENT_OUT') THEN
                v_rev_src_wh := NULL;
                v_rev_dest_wh := v_item.source_warehouse_id;
                v_adj_cost := NULL;
            ELSIF v_original.transaction_type = 'TRANSFER' THEN
                v_rev_src_wh := v_item.destination_warehouse_id;
                v_rev_dest_wh := v_item.source_warehouse_id;
                v_adj_cost := NULL;
            ELSIF v_original.transaction_type = 'COST_ADJUSTMENT' THEN
                v_rev_src_wh := NULL;
                v_rev_dest_wh := NULL;
                v_adj_cost := - v_item.cost_adjustment_amount;
            END IF;

            INSERT INTO public.inventory_transaction_items (
                id,
                organization_id,
                transaction_id,
                row_number,
                product_id,
                source_warehouse_id,
                destination_warehouse_id,
                quantity,
                unit_cost_amount,
                total_cost_amount,
                cost_adjustment_amount,
                cost_state,
                description
            ) VALUES (
                v_reversal_item_id,
                p_organization_id,
                v_reversal_id,
                v_item.row_number,
                v_item.product_id,
                v_rev_src_wh,
                v_rev_dest_wh,
                CASE WHEN v_original.transaction_type = 'COST_ADJUSTMENT' THEN 0 ELSE v_item.quantity END,
                v_item.unit_cost_amount,
                v_item.total_cost_amount,
                v_adj_cost,
                v_item.cost_state,
                'معکوس ردیف ' || v_item.row_number || ' سند اصلی'
            );

            INSERT INTO public.inventory_transaction_serials (
                organization_id,
                transaction_item_id,
                product_serial_id
            )
            SELECT
                p_organization_id,
                v_reversal_item_id,
                product_serial_id
            FROM public.inventory_transaction_serials
            WHERE organization_id = p_organization_id
              AND transaction_item_id = v_item.id;
        END;
    END LOOP;

    -- 11. Strict Lock Ordering
    -- Step A: Insert zero balances rows if missing (deterministic order)
    INSERT INTO public.inventory_balances (organization_id, warehouse_id, product_id, quantity_on_hand)
    SELECT DISTINCT p_organization_id, wh.wh_id, item.product_id, 0
    FROM public.inventory_transaction_items item
    CROSS JOIN LATERAL (
        VALUES (item.source_warehouse_id), (item.destination_warehouse_id)
    ) AS wh(wh_id)
    WHERE item.transaction_id = v_original.id
      AND item.organization_id = p_organization_id
      AND wh.wh_id IS NOT NULL
    ORDER BY wh.wh_id, item.product_id
    ON CONFLICT (organization_id, warehouse_id, product_id) DO NOTHING;

    INSERT INTO public.inventory_cost_balances (organization_id, product_id, organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount)
    SELECT DISTINCT p_organization_id, item.product_id, 0, 0, 0
    FROM public.inventory_transaction_items item
    WHERE item.transaction_id = v_original.id
      AND item.organization_id = p_organization_id
    ORDER BY item.product_id
    ON CONFLICT (organization_id, product_id) DO NOTHING;

    -- Step B: Lock inventory_balances (deterministic order by warehouse_id, product_id)
    PERFORM 1
    FROM public.inventory_balances
    WHERE organization_id = p_organization_id
      AND (warehouse_id, product_id) IN (
          SELECT DISTINCT wh.wh_id, item.product_id
          FROM public.inventory_transaction_items item
          CROSS JOIN LATERAL (VALUES (item.source_warehouse_id), (item.destination_warehouse_id)) AS wh(wh_id)
          WHERE item.transaction_id = v_original.id AND item.organization_id = p_organization_id AND wh.wh_id IS NOT NULL
      )
    ORDER BY warehouse_id, product_id
    FOR UPDATE;

    -- Step C: Lock inventory_cost_balances (deterministic order by product_id)
    PERFORM 1
    FROM public.inventory_cost_balances
    WHERE organization_id = p_organization_id
      AND product_id IN (
          SELECT DISTINCT item.product_id
          FROM public.inventory_transaction_items item
          WHERE item.transaction_id = v_original.id AND item.organization_id = p_organization_id
      )
    ORDER BY product_id
    FOR UPDATE;

    -- Step D: Lock product_serials (deterministic order by id)
    PERFORM 1
    FROM public.product_serials
    WHERE organization_id = p_organization_id
      AND id IN (
          SELECT DISTINCT its.product_serial_id
          FROM public.inventory_transaction_items item
          JOIN public.inventory_transaction_serials its ON its.transaction_item_id = item.id AND its.organization_id = item.organization_id
          WHERE item.transaction_id = v_original.id AND item.organization_id = p_organization_id
      )
    ORDER BY id
    FOR UPDATE;

    -- Step E: Lock relevant provisional cost positions
    IF v_original.transaction_type = 'SALE_ISSUE' THEN
        PERFORM 1
        FROM public.inventory_provisional_cost_positions
        WHERE organization_id = p_organization_id
          AND issue_transaction_item_id IN (
              SELECT id FROM public.inventory_transaction_items
              WHERE transaction_id = v_original.id AND organization_id = p_organization_id
          )
        ORDER BY id
        FOR UPDATE;
    END IF;

    -- 12. Provisional Cost Positions & Allocations Eligibility Checks
    IF v_original.transaction_type = 'SALE_ISSUE' THEN
        IF EXISTS (
            SELECT 1 FROM public.inventory_provisional_cost_positions
            WHERE organization_id = p_organization_id
              AND issue_transaction_item_id IN (
                  SELECT id FROM public.inventory_transaction_items
                  WHERE transaction_id = v_original.id AND organization_id = p_organization_id
              )
              AND status IN ('PARTIALLY_SETTLED', 'SETTLED')
        ) THEN
            RAISE EXCEPTION 'Cannot reverse SALE_ISSUE that has PARTIALLY_SETTLED or SETTLED provisional cost positions.';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.inventory_provisional_cost_allocations alloc
            JOIN public.inventory_provisional_cost_positions pos ON pos.id = alloc.provisional_position_id AND pos.organization_id = alloc.organization_id
            WHERE pos.organization_id = p_organization_id
              AND pos.issue_transaction_item_id IN (
                  SELECT id FROM public.inventory_transaction_items
                  WHERE transaction_id = v_original.id AND organization_id = p_organization_id
              )
        ) THEN
            RAISE EXCEPTION 'Cannot reverse SALE_ISSUE with existing provisional cost allocations.';
        END IF;
    ELSIF v_original.transaction_type = 'PURCHASE_RECEIPT' THEN
        IF EXISTS (
            SELECT 1
            FROM public.inventory_provisional_cost_allocations alloc
            JOIN public.inventory_transaction_items item ON item.id = alloc.receipt_transaction_item_id AND item.organization_id = alloc.organization_id
            WHERE item.transaction_id = v_original.id AND item.organization_id = p_organization_id
        ) THEN
            RAISE EXCEPTION 'Cannot reverse PURCHASE_RECEIPT that has been used in provisional cost allocations.';
        END IF;
    END IF;

    -- 13. Subsequent Transactions Check for Non-Serialized Entries
    IF v_original.transaction_type IN ('OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN', 'COST_ADJUSTMENT') THEN
        FOR v_item IN
            SELECT iti.*, p.is_serialized
            FROM public.inventory_transaction_items iti
            JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
            WHERE iti.transaction_id = v_original.id AND iti.organization_id = p_organization_id
        LOOP
            IF NOT v_item.is_serialized THEN
                SELECT COUNT(*) INTO v_subsequent_tx_count
                FROM public.inventory_transaction_items sub_item
                JOIN public.inventory_transactions sub_tx ON sub_tx.id = sub_item.transaction_id AND sub_tx.organization_id = sub_item.organization_id
                WHERE sub_item.organization_id = p_organization_id
                  AND sub_item.product_id = v_item.product_id
                  AND sub_tx.status = 'POSTED'
                  AND sub_tx.transaction_kind = 'GENERAL'
                  AND sub_tx.id <> v_original.id
                  AND (
                      sub_tx.posted_at > v_original.posted_at
                      OR (sub_tx.posted_at = v_original.posted_at AND sub_tx.id <> v_original.id)
                  );

                IF v_subsequent_tx_count > 0 THEN
                    RAISE EXCEPTION 'Cannot reverse entry or cost adjustment transaction for product % because subsequent active posted transactions exist.', v_item.product_id;
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 14. Serialized Goods Lifecycle Validation & Status Updates
    FOR v_item IN
        SELECT iti.*, p.is_serialized
        FROM public.inventory_transaction_items iti
        JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
        WHERE iti.transaction_id = v_original.id AND iti.organization_id = p_organization_id
    LOOP
        IF v_item.is_serialized THEN
            SELECT COUNT(*) INTO v_serial_count
            FROM public.inventory_transaction_serials
            WHERE transaction_item_id = v_item.id AND organization_id = p_organization_id;

            IF v_serial_count <> v_item.quantity THEN
                RAISE EXCEPTION 'Serial count (%) does not match item quantity (%) for product %.', v_serial_count, v_item.quantity, v_item.product_id;
            END IF;

            FOR v_serial IN
                SELECT ps.*
                FROM public.product_serials ps
                JOIN public.inventory_transaction_serials its ON its.product_serial_id = ps.id AND its.organization_id = ps.organization_id
                WHERE its.transaction_item_id = v_item.id AND its.organization_id = p_organization_id
            LOOP
                IF v_original.transaction_type IN ('OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN') THEN
                    IF v_serial.status <> 'AVAILABLE' THEN
                        RAISE EXCEPTION 'Serial % cannot be reversed because its status is % (expected AVAILABLE).', v_serial.serial_number_normalized, v_serial.status;
                    END IF;
                    IF v_serial.current_warehouse_id IS DISTINCT FROM v_item.destination_warehouse_id THEN
                        RAISE EXCEPTION 'Serial % is not currently in original destination warehouse.', v_serial.serial_number_normalized;
                    END IF;

                    UPDATE public.product_serials
                    SET status = 'REVERSED',
                        current_warehouse_id = NULL
                    WHERE id = v_serial.id AND organization_id = p_organization_id;

                ELSIF v_original.transaction_type = 'SALE_ISSUE' THEN
                    IF v_serial.status <> 'SOLD' THEN
                        RAISE EXCEPTION 'Serial % cannot be reversed because its status is % (expected SOLD).', v_serial.serial_number_normalized, v_serial.status;
                    END IF;
                    IF v_serial.current_warehouse_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Serial % currently sold must have NULL warehouse.', v_serial.serial_number_normalized;
                    END IF;

                    UPDATE public.product_serials
                    SET status = 'AVAILABLE',
                        current_warehouse_id = v_item.source_warehouse_id
                    WHERE id = v_serial.id AND organization_id = p_organization_id;

                ELSIF v_original.transaction_type = 'ADJUSTMENT_OUT' THEN
                    IF v_serial.status <> 'SCRAPPED' THEN
                        RAISE EXCEPTION 'Serial % cannot be reversed because its status is % (expected SCRAPPED).', v_serial.serial_number_normalized, v_serial.status;
                    END IF;
                    IF v_serial.current_warehouse_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Serial % currently scrapped must have NULL warehouse.', v_serial.serial_number_normalized;
                    END IF;

                    UPDATE public.product_serials
                    SET status = 'AVAILABLE',
                        current_warehouse_id = v_item.source_warehouse_id
                    WHERE id = v_serial.id AND organization_id = p_organization_id;

                ELSIF v_original.transaction_type = 'TRANSFER' THEN
                    IF v_serial.status NOT IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN
                        RAISE EXCEPTION 'Serial % status % invalid for transfer reversal.', v_serial.serial_number_normalized, v_serial.status;
                    END IF;
                    IF v_serial.current_warehouse_id IS DISTINCT FROM v_item.destination_warehouse_id THEN
                        RAISE EXCEPTION 'Serial % is not currently in transfer destination warehouse.', v_serial.serial_number_normalized;
                    END IF;

                    UPDATE public.product_serials
                    SET current_warehouse_id = v_item.source_warehouse_id
                    WHERE id = v_serial.id AND organization_id = p_organization_id;
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    -- 15. Apply Quantity & Cost Balances Impact with Sufficiency Safeguards
    FOR v_item IN
        SELECT * FROM public.inventory_transaction_items
        WHERE transaction_id = v_original.id AND organization_id = p_organization_id
        ORDER BY row_number, id
    LOOP
        CASE v_original.transaction_type
            WHEN 'OPENING', 'PURCHASE_RECEIPT', 'ADJUSTMENT_IN' THEN
                -- Decrease destination warehouse balance
                SELECT quantity_on_hand INTO v_curr_wh_qty
                FROM public.inventory_balances
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.destination_warehouse_id
                  AND product_id = v_item.product_id;

                IF v_curr_wh_qty < v_item.quantity THEN
                    RAISE EXCEPTION 'Insufficient warehouse inventory to reverse entry for product % in warehouse %.', v_item.product_id, v_item.destination_warehouse_id;
                END IF;

                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.destination_warehouse_id
                  AND product_id = v_item.product_id;

                -- Decrease org cost balance
                SELECT organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount
                INTO v_curr_org_qty, v_curr_org_val, v_curr_wac
                FROM public.inventory_cost_balances
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

                v_new_org_qty := v_curr_org_qty - v_item.quantity;
                v_new_org_val := v_curr_org_val - v_item.total_cost_amount;

                IF v_new_org_qty < 0 OR v_new_org_val < 0 THEN
                    RAISE EXCEPTION 'Reversal causes negative organization inventory quantity or value for product %.', v_item.product_id;
                END IF;

                IF v_new_org_qty = 0 AND v_new_org_val <> 0 THEN
                    RAISE EXCEPTION 'Inventory value (%) must be zero when quantity becomes zero for product %.', v_new_org_val, v_item.product_id;
                END IF;

                v_new_wac := CASE WHEN v_new_org_qty > 0 THEN round(v_new_org_val::numeric / v_new_org_qty) ELSE 0 END;

                UPDATE public.inventory_cost_balances
                SET organization_quantity_on_hand = v_new_org_qty,
                    inventory_value_amount = v_new_org_val,
                    weighted_average_cost_amount = v_new_wac,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            WHEN 'SALE_ISSUE', 'ADJUSTMENT_OUT' THEN
                -- Increase source warehouse balance
                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.source_warehouse_id
                  AND product_id = v_item.product_id;

                -- Increase org cost balance
                SELECT organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount
                INTO v_curr_org_qty, v_curr_org_val, v_curr_wac
                FROM public.inventory_cost_balances
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

                v_new_org_qty := v_curr_org_qty + v_item.quantity;
                v_new_org_val := v_curr_org_val + v_item.total_cost_amount;

                IF (v_new_org_qty > 0 AND v_new_org_val < 0) OR (v_new_org_qty < 0 AND v_new_org_val > 0) THEN
                    RAISE EXCEPTION 'Inconsistent quantity (%) and value (%) signs after reversal of product %.', v_new_org_qty, v_new_org_val, v_item.product_id;
                END IF;

                IF v_new_org_qty = 0 AND v_new_org_val <> 0 THEN
                    RAISE EXCEPTION 'Inventory value (%) must be zero when quantity is zero for product %.', v_new_org_val, v_item.product_id;
                END IF;

                IF v_new_org_qty <> 0 THEN
                    v_new_wac := round(abs(v_new_org_val)::numeric / abs(v_new_org_qty));
                ELSE
                    v_new_wac := 0;
                END IF;

                UPDATE public.inventory_cost_balances
                SET organization_quantity_on_hand = v_new_org_qty,
                    inventory_value_amount = v_new_org_val,
                    weighted_average_cost_amount = v_new_wac,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            WHEN 'TRANSFER' THEN
                -- Decrease destination warehouse balance
                SELECT quantity_on_hand INTO v_curr_dest_wh_qty
                FROM public.inventory_balances
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.destination_warehouse_id
                  AND product_id = v_item.product_id;

                IF v_curr_dest_wh_qty < v_item.quantity THEN
                    RAISE EXCEPTION 'Insufficient destination warehouse inventory to reverse transfer for product % in warehouse %.', v_item.product_id, v_item.destination_warehouse_id;
                END IF;

                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand - v_item.quantity,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.destination_warehouse_id
                  AND product_id = v_item.product_id;

                -- Increase source warehouse balance
                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand + v_item.quantity,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id
                  AND warehouse_id = v_item.source_warehouse_id
                  AND product_id = v_item.product_id;

                UPDATE public.inventory_cost_balances
                SET last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

            WHEN 'COST_ADJUSTMENT' THEN
                SELECT organization_quantity_on_hand, inventory_value_amount, weighted_average_cost_amount
                INTO v_curr_org_qty, v_curr_org_val, v_curr_wac
                FROM public.inventory_cost_balances
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;

                v_new_org_qty := v_curr_org_qty;
                v_new_org_val := v_curr_org_val - v_item.cost_adjustment_amount;

                IF (v_new_org_qty > 0 AND v_new_org_val < 0) OR (v_new_org_qty < 0 AND v_new_org_val > 0) THEN
                    RAISE EXCEPTION 'Cost adjustment reversal results in inconsistent inventory value sign (%) for quantity (%) for product %.', v_new_org_val, v_new_org_qty, v_item.product_id;
                END IF;

                IF v_new_org_qty = 0 AND v_new_org_val <> 0 THEN
                    RAISE EXCEPTION 'Inventory value (%) must be zero when quantity is zero for product %.', v_new_org_val, v_item.product_id;
                END IF;

                IF v_new_org_qty <> 0 THEN
                    v_new_wac := round(abs(v_new_org_val)::numeric / abs(v_new_org_qty));
                ELSE
                    v_new_wac := 0;
                END IF;

                UPDATE public.inventory_cost_balances
                SET organization_quantity_on_hand = v_new_org_qty,
                    inventory_value_amount = v_new_org_val,
                    weighted_average_cost_amount = v_new_wac,
                    last_transaction_id = v_reversal_id
                WHERE organization_id = p_organization_id AND product_id = v_item.product_id;
        END CASE;
    END LOOP;

    -- 16. Document Number Sequence Allocation & Final Transitions
    INSERT INTO public.inventory_document_sequences (
        organization_id, fiscal_year_id, next_number, updated_by, updated_at
    ) VALUES (
        p_organization_id, p_reversal_fiscal_year_id, 1, v_user_id, now()
    )
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_seq_next
    FROM public.inventory_document_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = p_reversal_fiscal_year_id
    FOR UPDATE;

    v_doc_number := v_seq_next;

    UPDATE public.inventory_document_sequences
    SET next_number = next_number + 1,
        updated_by = v_user_id,
        updated_at = now()
    WHERE organization_id = p_organization_id AND fiscal_year_id = p_reversal_fiscal_year_id;

    SELECT
        EXISTS(SELECT 1 FROM public.inventory_transaction_items WHERE transaction_id = v_reversal_id AND organization_id = p_organization_id AND cost_state = 'FINAL'),
        EXISTS(SELECT 1 FROM public.inventory_transaction_items WHERE transaction_id = v_reversal_id AND organization_id = p_organization_id AND cost_state = 'PROVISIONAL'),
        EXISTS(SELECT 1 FROM public.inventory_transaction_items WHERE transaction_id = v_reversal_id AND organization_id = p_organization_id AND cost_state = 'MIXED')
    INTO v_has_final, v_has_provisional, v_has_mixed;

    IF v_has_mixed OR (v_has_final AND v_has_provisional) THEN
        v_header_cost_state := 'MIXED';
    ELSIF v_has_provisional THEN
        v_header_cost_state := 'PROVISIONAL';
    ELSE
        v_header_cost_state := 'FINAL';
    END IF;

    UPDATE public.inventory_transactions
    SET document_number = v_doc_number,
        status = 'POSTED',
        cost_state = v_header_cost_state,
        posted_by = v_user_id,
        posted_at = now()
    WHERE id = v_reversal_id AND organization_id = p_organization_id;

    IF v_original.transaction_type = 'SALE_ISSUE' THEN
        UPDATE public.inventory_provisional_cost_positions
        SET status = 'REVERSED',
            remaining_quantity = 0,
            reversal_transaction_id = v_reversal_id,
            settled_at = NULL
        WHERE organization_id = p_organization_id
          AND status = 'OPEN'
          AND issue_transaction_item_id IN (
              SELECT id FROM public.inventory_transaction_items
              WHERE transaction_id = v_original.id AND organization_id = p_organization_id
          );
    END IF;

    UPDATE public.inventory_transactions
    SET status = 'REVERSED',
        reversed_by = v_user_id,
        reversed_at = now(),
        reversal_reason = trim(p_reversal_reason)
    WHERE id = v_original.id AND organization_id = p_organization_id;

    RETURN v_reversal_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reverse_inventory_transaction(
    UUID, UUID, UUID, DATE, TEXT, INT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

COMMIT;
