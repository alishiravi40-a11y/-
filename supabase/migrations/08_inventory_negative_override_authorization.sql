-- ==============================================================================
-- MIGRATION 08: INVENTORY NEGATIVE OVERRIDE AUTHORIZATION INFRASTRUCTURE
-- ==============================================================================
-- Description: Provides secure, atomic, time-bound (15-minute), and idempotent
-- infrastructure for issuing single-use negative inventory override authorizations
-- and domain item scope records without fake UI or mock credentials.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTEND TABLE: public.inventory_negative_override_authorizations
-- ------------------------------------------------------------------------------
-- Add operation_key column and security constraints.

ALTER TABLE public.inventory_negative_override_authorizations
    ADD COLUMN IF NOT EXISTS operation_key TEXT;

-- Backfill any legacy NULL operation keys deterministically before applying NOT NULL constraint
UPDATE public.inventory_negative_override_authorizations
SET operation_key = 'legacy_opkey_' || id::text
WHERE operation_key IS NULL;

ALTER TABLE public.inventory_negative_override_authorizations
    ALTER COLUMN operation_key SET NOT NULL;

-- Enforce UNIQUE operation_key per organization
ALTER TABLE public.inventory_negative_override_authorizations
    DROP CONSTRAINT IF EXISTS uq_neg_auth_org_opkey;

ALTER TABLE public.inventory_negative_override_authorizations
    ADD CONSTRAINT uq_neg_auth_org_opkey UNIQUE (organization_id, operation_key);

-- Enforce UNIQUE security_audit_log_id to prevent reusing security events
ALTER TABLE public.inventory_negative_override_authorizations
    DROP CONSTRAINT IF EXISTS uq_neg_auth_security_audit_log;

ALTER TABLE public.inventory_negative_override_authorizations
    ADD CONSTRAINT uq_neg_auth_security_audit_log UNIQUE (security_audit_log_id);


-- ------------------------------------------------------------------------------
-- 2. CREATE TABLE: public.inventory_negative_override_authorization_items
-- ------------------------------------------------------------------------------
-- Tracks exact domain items authorized to go negative with approved balances,
-- issue quantities, projected negative balances, and maximum allowed deficits.

CREATE TABLE IF NOT EXISTS public.inventory_negative_override_authorization_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    authorization_id UUID NOT NULL,
    transaction_item_id UUID NOT NULL,
    product_id UUID NOT NULL,
    source_warehouse_id UUID NOT NULL,
    approved_balance_qty NUMERIC(18,3) NOT NULL,
    approved_issue_qty NUMERIC(18,3) NOT NULL,
    approved_projected_qty NUMERIC(18,3) NOT NULL,
    approved_max_deficit_qty NUMERIC(18,3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Composite Foreign Keys enforcing organizational consistency
    CONSTRAINT fk_neg_auth_items_auth FOREIGN KEY (organization_id, authorization_id)
        REFERENCES public.inventory_negative_override_authorizations (organization_id, id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_neg_auth_items_tx_item FOREIGN KEY (organization_id, transaction_item_id)
        REFERENCES public.inventory_transaction_items (organization_id, id),

    CONSTRAINT fk_neg_auth_items_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products (organization_id, id),

    CONSTRAINT fk_neg_auth_items_warehouse FOREIGN KEY (organization_id, source_warehouse_id)
        REFERENCES public.warehouses (organization_id, id),

    -- Unique constraint: one domain item record per authorization line item
    CONSTRAINT uq_neg_auth_items_auth_tx_item UNIQUE (authorization_id, transaction_item_id),

    -- Mathematical and Domain Constraints
    CONSTRAINT chk_neg_auth_items_issue_qty CHECK (approved_issue_qty > 0),
    CONSTRAINT chk_neg_auth_items_max_deficit CHECK (approved_max_deficit_qty > 0),
    CONSTRAINT chk_neg_auth_items_projected_qty CHECK (approved_projected_qty < 0),
    CONSTRAINT chk_neg_auth_items_math_proj CHECK (approved_projected_qty = approved_balance_qty - approved_issue_qty),
    CONSTRAINT chk_neg_auth_items_math_def CHECK (approved_max_deficit_qty = approved_issue_qty - GREATEST(approved_balance_qty, 0))
);

-- Indexing for fast verification
CREATE INDEX IF NOT EXISTS idx_neg_auth_items_lookup
    ON public.inventory_negative_override_authorization_items (organization_id, authorization_id, transaction_item_id);

-- Prevent direct modification or deletion of authorization items once written
CREATE OR REPLACE FUNCTION public.fn_prevent_neg_auth_items_mod()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'Modification or deletion of inventory_negative_override_authorization_items is strictly forbidden.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_neg_auth_items_mod ON public.inventory_negative_override_authorization_items;
CREATE TRIGGER trg_prevent_neg_auth_items_mod
    BEFORE UPDATE OR DELETE ON public.inventory_negative_override_authorization_items
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.fn_prevent_neg_auth_items_mod();

-- Explicitly revoke permissions from PUBLIC, anon, authenticated, then grant SELECT to authenticated
REVOKE ALL ON public.inventory_negative_override_authorization_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_negative_override_authorization_items TO authenticated;

-- RLS for authorization items table
ALTER TABLE public.inventory_negative_override_authorization_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members with inventory override or manage permission can view authorization items" ON public.inventory_negative_override_authorization_items;
CREATE POLICY "Members with inventory override or manage permission can view authorization items"
ON public.inventory_negative_override_authorization_items FOR SELECT
TO authenticated
USING (
    public.has_permission(organization_id, 'inventory:negative_override')
    OR
    public.has_permission(organization_id, 'inventory:manage')
);


-- ------------------------------------------------------------------------------
-- 3. ISSUANCE RPC: public.issue_inventory_negative_override_authorization
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_inventory_negative_override_authorization(
    p_organization_id UUID,
    p_transaction_id UUID,
    p_expected_version INT,
    p_security_audit_log_id UUID,
    p_operation_key TEXT,
    p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_membership_id UUID;
    v_tx RECORD;
    v_requested_by UUID;
    v_approved_by UUID;
    v_audit_log RECORD;
    v_audit_tx_id UUID;
    v_request_fingerprint TEXT;
    v_pwd_reauth BOOLEAN;
    v_two_fa_verified BOOLEAN;
    v_existing_auth RECORD;
    v_audit_fingerprint TEXT;
    v_item RECORD;
    v_wh RECORD;
    v_wh_branch_id UUID;
    v_item_count INT := 0;
    v_neg_item_count INT := 0;
    v_curr_bal NUMERIC(18,3);
    v_projected_bal NUMERIC(18,3);
    v_max_deficit NUMERIC(18,3);
    v_auth_id UUID;
    v_authorized_at TIMESTAMPTZ;
    v_expires_at TIMESTAMPTZ;
    v_clean_opkey TEXT;
    v_active_existing_id UUID;
BEGIN
    -- 1. Identity & Active Membership Check
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

    -- 2. Input Sanitization & Target Document Lock
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'p_expected_version is required.';
    END IF;

    v_clean_opkey := trim(p_operation_key);
    IF v_clean_opkey IS NULL OR v_clean_opkey = '' OR length(v_clean_opkey) > 255 THEN
        RAISE EXCEPTION 'Operation key must be non-null, non-empty, and at most 255 characters.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
        RAISE EXCEPTION 'Reason must be at least 10 meaningful characters long.';
    END IF;

    SELECT * INTO v_tx
    FROM public.inventory_transactions
    WHERE id = p_transaction_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF v_tx.id IS NULL THEN
        RAISE EXCEPTION 'Transaction % not found in organization %.', p_transaction_id, p_organization_id;
    END IF;

    IF v_tx.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Negative override authorization is only permitted for DRAFT documents (status: %).', v_tx.status;
    END IF;

    IF v_tx.transaction_type <> 'SALE_ISSUE' THEN
        RAISE EXCEPTION 'Negative override authorization is only permitted for SALE_ISSUE transactions (type: %).', v_tx.transaction_type;
    END IF;

    IF v_tx.transaction_kind <> 'GENERAL' THEN
        RAISE EXCEPTION 'Negative override authorization is only permitted for GENERAL transaction kinds (kind: %).', v_tx.transaction_kind;
    END IF;

    IF v_tx.version <> p_expected_version THEN
        RAISE EXCEPTION 'Transaction version mismatch: expected %, found %.', p_expected_version, v_tx.version;
    END IF;

    SELECT count(*) INTO v_item_count
    FROM public.inventory_transaction_items
    WHERE transaction_id = p_transaction_id AND organization_id = p_organization_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Transaction % has no line items.', p_transaction_id;
    END IF;

    -- Extract requester from transaction creator and approver from auth.uid()
    v_requested_by := v_tx.created_by;
    v_approved_by := v_user_id;

    -- 3. Check Branch and Warehouse Permissions for Current User (Issuing Approver)
    IF NOT EXISTS (
        SELECT 1
        FROM public.organization_memberships om
        JOIN public.user_profiles up ON up.id = om.user_id
        JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE om.user_id = v_user_id
          AND om.organization_id = p_organization_id
          AND om.is_active = true
          AND up.is_active = true
          AND p.code = 'inventory:negative_override'
          AND (ur.branch_id IS NULL OR ur.branch_id = v_tx.initiating_branch_id)
    ) THEN
        RAISE EXCEPTION 'User lacks inventory:negative_override permission for initiating branch %.', v_tx.initiating_branch_id;
    END IF;

    FOR v_wh IN
        SELECT DISTINCT source_warehouse_id AS w_id
        FROM public.inventory_transaction_items
        WHERE transaction_id = p_transaction_id
          AND organization_id = p_organization_id
          AND source_warehouse_id IS NOT NULL
        ORDER BY source_warehouse_id ASC
    LOOP
        SELECT branch_id INTO v_wh_branch_id
        FROM public.warehouses
        WHERE id = v_wh.w_id AND organization_id = p_organization_id;

        IF v_wh_branch_id IS NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.warehouses WHERE id = v_wh.w_id AND organization_id = p_organization_id
            ) THEN
                RAISE EXCEPTION 'Warehouse % does not exist in organization %.', v_wh.w_id, p_organization_id;
            ELSE
                RAISE EXCEPTION 'Warehouse % is not connected to a branch.', v_wh.w_id;
            END IF;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            JOIN public.user_profiles up ON up.id = om.user_id
            JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
            JOIN public.role_permissions rp ON rp.role_id = ur.role_id
            JOIN public.permissions p ON p.id = rp.permission_id
            WHERE om.user_id = v_user_id
              AND om.organization_id = p_organization_id
              AND om.is_active = true
              AND up.is_active = true
              AND p.code = 'inventory:negative_override'
              AND (ur.branch_id IS NULL OR ur.branch_id = v_wh_branch_id)
        ) THEN
            RAISE EXCEPTION 'User lacks inventory:negative_override permission for branch % connected to warehouse %.', v_wh_branch_id, v_wh.w_id;
        END IF;

        IF NOT (
            public.has_permission(p_organization_id, 'inventory:manage')
            OR EXISTS (
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

    -- 4. Idempotency Check with Full Security Verification
    SELECT * INTO v_existing_auth
    FROM public.inventory_negative_override_authorizations
    WHERE organization_id = p_organization_id AND operation_key = v_clean_opkey;

    IF v_existing_auth.id IS NOT NULL THEN
        SELECT * INTO v_audit_log
        FROM public.security_audit_logs
        WHERE id = p_security_audit_log_id AND organization_id = p_organization_id;

        IF v_existing_auth.approved_by = v_user_id
           AND v_existing_auth.transaction_id = p_transaction_id
           AND v_existing_auth.security_audit_log_id = p_security_audit_log_id
           AND v_audit_log.id IS NOT NULL
           AND (v_audit_log.details->>'request_fingerprint') = v_existing_auth.request_fingerprint
           AND v_existing_auth.status = 'ISSUED'
           AND v_existing_auth.expires_at > clock_timestamp()
           AND v_audit_log.created_at >= (v_existing_auth.authorized_at - INTERVAL '5 minutes')
           AND v_audit_log.created_at <= v_existing_auth.authorized_at THEN
            RETURN v_existing_auth.id;
        ELSE
            RAISE EXCEPTION 'Operation key conflict: operation key % already exists with different parameters, different user, or non-active status.', v_clean_opkey;
        END IF;
    END IF;

    -- 5. Valid Security Event Check (security_audit_logs) for NEW issuance
    SELECT * INTO v_audit_log
    FROM public.security_audit_logs
    WHERE id = p_security_audit_log_id
      AND organization_id = p_organization_id
      AND user_id = v_user_id;

    IF v_audit_log.id IS NULL THEN
        RAISE EXCEPTION 'Security audit log % not found for organization % and user %.', p_security_audit_log_id, p_organization_id, v_user_id;
    END IF;

    IF v_audit_log.event_type <> 'INVENTORY_NEGATIVE_OVERRIDE_REAUTH_SUCCESS' THEN
        RAISE EXCEPTION 'Invalid security event type: expected INVENTORY_NEGATIVE_OVERRIDE_REAUTH_SUCCESS, found %.', v_audit_log.event_type;
    END IF;

    v_audit_tx_id := (v_audit_log.details->>'transaction_id')::uuid;
    IF v_audit_tx_id IS NULL OR v_audit_tx_id <> p_transaction_id THEN
        RAISE EXCEPTION 'Security audit log transaction_id mismatch: expected %, found %.', p_transaction_id, v_audit_tx_id;
    END IF;

    v_request_fingerprint := v_audit_log.details->>'request_fingerprint';
    IF v_request_fingerprint IS NULL OR trim(v_request_fingerprint) = '' THEN
        RAISE EXCEPTION 'Security audit log request_fingerprint is missing or empty.';
    END IF;

    v_pwd_reauth := COALESCE((v_audit_log.details->>'password_reauthenticated')::boolean, false);
    v_two_fa_verified := COALESCE((v_audit_log.details->>'two_factor_verified')::boolean, false);

    IF v_pwd_reauth IS NOT TRUE OR v_two_fa_verified IS NOT TRUE THEN
        RAISE EXCEPTION 'Security audit log indicates password re-authentication or 2FA was not successful.';
    END IF;

    -- 5-minute freshness check relative to clock_timestamp()
    IF v_audit_log.created_at < (clock_timestamp() - INTERVAL '5 minutes') OR v_audit_log.created_at > clock_timestamp() THEN
        RAISE EXCEPTION 'Security audit log % is expired or in the future (created_at: %).', p_security_audit_log_id, v_audit_log.created_at;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.inventory_negative_override_authorizations
        WHERE security_audit_log_id = p_security_audit_log_id
    ) THEN
        RAISE EXCEPTION 'Security audit log % has already been used for an authorization.', p_security_audit_log_id;
    END IF;

    -- 6. Clean up Truly Expired Authorizations & Prevent Multiple Active Authorizations
    UPDATE public.inventory_negative_override_authorizations
    SET status = 'EXPIRED'
    WHERE organization_id = p_organization_id
      AND transaction_id = p_transaction_id
      AND status = 'ISSUED'
      AND expires_at <= clock_timestamp();

    SELECT id INTO v_active_existing_id
    FROM public.inventory_negative_override_authorizations
    WHERE organization_id = p_organization_id
      AND transaction_id = p_transaction_id
      AND status = 'ISSUED'
      AND expires_at > clock_timestamp();

    IF v_active_existing_id IS NOT NULL THEN
        RAISE EXCEPTION 'An active unexpired negative override authorization (%) already exists for transaction %.', v_active_existing_id, p_transaction_id;
    END IF;

    -- 7. Insert Missing Zero-Balance Rows & Lock Balances in Strict Order
    -- Match Step 4a of post_inventory_transaction in Migration 07 (order: organization_id, warehouse_id, product_id)
    INSERT INTO public.inventory_balances (organization_id, warehouse_id, product_id, quantity_on_hand)
    SELECT DISTINCT p_organization_id, iti.source_warehouse_id, iti.product_id, 0
    FROM public.inventory_transaction_items iti
    WHERE iti.transaction_id = p_transaction_id
      AND iti.organization_id = p_organization_id
      AND iti.source_warehouse_id IS NOT NULL
    ON CONFLICT (organization_id, warehouse_id, product_id) DO NOTHING;

    PERFORM 1
    FROM public.inventory_balances ib
    JOIN (
        SELECT DISTINCT iti.source_warehouse_id AS w_id, iti.product_id
        FROM public.inventory_transaction_items iti
        WHERE iti.transaction_id = p_transaction_id
          AND iti.organization_id = p_organization_id
          AND iti.source_warehouse_id IS NOT NULL
    ) req ON req.w_id = ib.warehouse_id AND req.product_id = ib.product_id
    WHERE ib.organization_id = p_organization_id
    ORDER BY ib.organization_id, ib.warehouse_id, ib.product_id
    FOR UPDATE;

    -- 8. Cumulative Deficit Scope Calculation & Verification
    CREATE TEMP TABLE IF NOT EXISTS tmp_issuance_running_balances (
        warehouse_id UUID NOT NULL,
        product_id UUID NOT NULL,
        current_balance NUMERIC(18,3) NOT NULL,
        PRIMARY KEY (warehouse_id, product_id)
    ) ON COMMIT DROP;
    TRUNCATE TABLE tmp_issuance_running_balances;

    INSERT INTO tmp_issuance_running_balances (warehouse_id, product_id, current_balance)
    SELECT ib.warehouse_id, ib.product_id, ib.quantity_on_hand
    FROM public.inventory_balances ib
    JOIN (
        SELECT DISTINCT iti.source_warehouse_id AS w_id, iti.product_id
        FROM public.inventory_transaction_items iti
        WHERE iti.transaction_id = p_transaction_id
          AND iti.organization_id = p_organization_id
          AND iti.source_warehouse_id IS NOT NULL
    ) req ON req.w_id = ib.warehouse_id AND req.product_id = ib.product_id
    WHERE ib.organization_id = p_organization_id;

    v_neg_item_count := 0;

    FOR v_item IN
        SELECT iti.*, p.is_serialized
        FROM public.inventory_transaction_items iti
        JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
        WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
        ORDER BY iti.row_number ASC
    LOOP
        SELECT current_balance INTO v_curr_bal
        FROM tmp_issuance_running_balances
        WHERE warehouse_id = v_item.source_warehouse_id AND product_id = v_item.product_id;

        v_projected_bal := v_curr_bal - v_item.quantity;

        UPDATE tmp_issuance_running_balances
        SET current_balance = v_projected_bal
        WHERE warehouse_id = v_item.source_warehouse_id AND product_id = v_item.product_id;

        IF v_projected_bal < 0 THEN
            IF v_item.is_serialized = true THEN
                RAISE EXCEPTION 'Negative inventory override is strictly forbidden for serialized product % in warehouse %.', v_item.product_id, v_item.source_warehouse_id;
            END IF;

            v_neg_item_count := v_neg_item_count + 1;
        END IF;
    END LOOP;

    IF v_neg_item_count = 0 THEN
        RAISE EXCEPTION 'No inventory deficit detected for transaction %; negative override authorization cannot be issued.', p_transaction_id;
    END IF;

    -- 9. Create New Authorization Header (15-Minute Expiry)
    v_auth_id := gen_random_uuid();
    v_authorized_at := clock_timestamp();
    v_expires_at := v_authorized_at + INTERVAL '15 minutes';

    INSERT INTO public.inventory_negative_override_authorizations (
        id, organization_id, transaction_id, requested_by, approved_by,
        security_audit_log_id, request_fingerprint, operation_key,
        authorized_at, expires_at, status, reason
    ) VALUES (
        v_auth_id, p_organization_id, p_transaction_id, v_requested_by, v_approved_by,
        p_security_audit_log_id, v_request_fingerprint, v_clean_opkey,
        v_authorized_at, v_expires_at, 'ISSUED', trim(p_reason)
    );

    -- 10. Populate Authorized Items Scope Table (Second Pass Cumulative Calculation)
    TRUNCATE TABLE tmp_issuance_running_balances;

    INSERT INTO tmp_issuance_running_balances (warehouse_id, product_id, current_balance)
    SELECT ib.warehouse_id, ib.product_id, ib.quantity_on_hand
    FROM public.inventory_balances ib
    JOIN (
        SELECT DISTINCT iti.source_warehouse_id AS w_id, iti.product_id
        FROM public.inventory_transaction_items iti
        WHERE iti.transaction_id = p_transaction_id
          AND iti.organization_id = p_organization_id
          AND iti.source_warehouse_id IS NOT NULL
    ) req ON req.w_id = ib.warehouse_id AND req.product_id = ib.product_id
    WHERE ib.organization_id = p_organization_id;

    FOR v_item IN
        SELECT iti.*, p.is_serialized
        FROM public.inventory_transaction_items iti
        JOIN public.products p ON p.id = iti.product_id AND p.organization_id = iti.organization_id
        WHERE iti.transaction_id = p_transaction_id AND iti.organization_id = p_organization_id
        ORDER BY iti.row_number ASC
    LOOP
        SELECT current_balance INTO v_curr_bal
        FROM tmp_issuance_running_balances
        WHERE warehouse_id = v_item.source_warehouse_id AND product_id = v_item.product_id;

        v_projected_bal := v_curr_bal - v_item.quantity;

        UPDATE tmp_issuance_running_balances
        SET current_balance = v_projected_bal
        WHERE warehouse_id = v_item.source_warehouse_id AND product_id = v_item.product_id;

        IF v_projected_bal < 0 THEN
            v_max_deficit := v_item.quantity - GREATEST(v_curr_bal, 0);

            INSERT INTO public.inventory_negative_override_authorization_items (
                id, organization_id, authorization_id, transaction_item_id,
                product_id, source_warehouse_id, approved_balance_qty,
                approved_issue_qty, approved_projected_qty, approved_max_deficit_qty,
                created_at
            ) VALUES (
                gen_random_uuid(), p_organization_id, v_auth_id, v_item.id,
                v_item.product_id, v_item.source_warehouse_id, v_curr_bal,
                v_item.quantity, v_projected_bal, v_max_deficit,
                v_authorized_at
            );
        END IF;
    END LOOP;

    RETURN v_auth_id;
END;
$$;

-- Security Execution Rights
REVOKE EXECUTE ON FUNCTION public.issue_inventory_negative_override_authorization(UUID, UUID, INT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_inventory_negative_override_authorization(UUID, UUID, INT, UUID, TEXT, TEXT) TO authenticated;


-- ------------------------------------------------------------------------------
-- 4. CONSUMPTION VALIDATION TRIGGERS
-- ------------------------------------------------------------------------------
-- Enforces strict consumption controls during post_inventory_transaction execution
-- without modifying post_inventory_transaction code.

-- A. Validate Item Consumption against Authorized Items Scope
CREATE OR REPLACE FUNCTION public.fn_validate_negative_override_log_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth_hdr RECORD;
    v_auth_item RECORD;
    v_is_serialized BOOLEAN;
BEGIN
    -- 1. Block any serialized product from negative override
    SELECT is_serialized INTO v_is_serialized
    FROM public.products
    WHERE id = NEW.product_id AND organization_id = NEW.organization_id;

    IF v_is_serialized = true THEN
        RAISE EXCEPTION 'Negative inventory override is strictly forbidden for serialized product %.', NEW.product_id;
    END IF;

    -- 2. Verify header authorization status, organization, transaction, and expiration
    SELECT * INTO v_auth_hdr
    FROM public.inventory_negative_override_authorizations
    WHERE id = NEW.authorization_id AND organization_id = NEW.organization_id;

    IF v_auth_hdr.id IS NULL THEN
        RAISE EXCEPTION 'Authorization % not found in organization %.', NEW.authorization_id, NEW.organization_id;
    END IF;

    IF v_auth_hdr.transaction_id <> NEW.transaction_id THEN
        RAISE EXCEPTION 'Authorization transaction_id mismatch: expected %, got %.', v_auth_hdr.transaction_id, NEW.transaction_id;
    END IF;

    IF v_auth_hdr.status <> 'ISSUED' THEN
        RAISE EXCEPTION 'Authorization % is not in ISSUED status (status: %).', NEW.authorization_id, v_auth_hdr.status;
    END IF;

    IF v_auth_hdr.expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'Authorization % expired at %.', NEW.authorization_id, v_auth_hdr.expires_at;
    END IF;

    -- 3. Fetch corresponding authorized domain item scope record
    SELECT * INTO v_auth_item
    FROM public.inventory_negative_override_authorization_items
    WHERE organization_id = NEW.organization_id
      AND authorization_id = NEW.authorization_id
      AND transaction_item_id = NEW.transaction_item_id;

    IF v_auth_item.id IS NULL THEN
        RAISE EXCEPTION 'Transaction item % is not authorized in override authorization %.', NEW.transaction_item_id, NEW.authorization_id;
    END IF;

    -- 4. Verify product and warehouse matches
    IF NEW.product_id <> v_auth_item.product_id THEN
        RAISE EXCEPTION 'Product mismatch between consumed log (%) and authorization item (%).', NEW.product_id, v_auth_item.product_id;
    END IF;

    IF NEW.warehouse_id <> v_auth_item.source_warehouse_id THEN
        RAISE EXCEPTION 'Warehouse mismatch between consumed log (%) and authorization item (%).', NEW.warehouse_id, v_auth_item.source_warehouse_id;
    END IF;

    -- 5. Verify requested quantity matches approved issue quantity
    IF NEW.requested_quantity <> v_auth_item.approved_issue_qty THEN
        RAISE EXCEPTION 'Requested quantity (%) does not match approved issue quantity (%).', NEW.requested_quantity, v_auth_item.approved_issue_qty;
    END IF;

    -- 6. Verify shortage deficit quantity does not exceed approved maximum deficit
    IF NEW.shortage_quantity > v_auth_item.approved_max_deficit_qty THEN
        RAISE EXCEPTION 'Shortage deficit quantity (%) exceeds maximum approved deficit (%).', NEW.shortage_quantity, v_auth_item.approved_max_deficit_qty;
    END IF;

    -- 7. Verify inventory balance before posting is not worse than approved balance
    IF NEW.quantity_before < v_auth_item.approved_balance_qty THEN
        RAISE EXCEPTION 'Inventory balance before posting (%) degraded compared to balance at approval (%).', NEW.quantity_before, v_auth_item.approved_balance_qty;
    END IF;

    -- 8. Verify projected inventory balance after posting is not worse than approved projected balance
    IF NEW.quantity_after < v_auth_item.approved_projected_qty THEN
        RAISE EXCEPTION 'Projected inventory balance after posting (%) degraded compared to approved projected balance (%).', NEW.quantity_after, v_auth_item.approved_projected_qty;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_negative_override_log_insert ON public.inventory_negative_override_logs;
CREATE TRIGGER trg_validate_negative_override_log_insert
    BEFORE INSERT ON public.inventory_negative_override_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_validate_negative_override_log_insert();


-- B. Validate Authorization Header Status Transitions
CREATE OR REPLACE FUNCTION public.fn_validate_negative_override_auth_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item_count INT;
    v_appr_active BOOLEAN;
    v_wh RECORD;
    v_wh_branch_id UUID;
    v_init_branch_id UUID;
    v_appr_has_neg_override BOOLEAN;
    v_appr_has_manage BOOLEAN;
    v_appr_has_wh_access BOOLEAN;
BEGIN
    -- 1. Enforce strict immutability of terminal states (CONSUMED, EXPIRED, REVOKED)
    IF OLD.status IN ('CONSUMED', 'EXPIRED', 'REVOKED') THEN
        RAISE EXCEPTION 'Modification of authorization record % in terminal state % is strictly forbidden.', OLD.id, OLD.status;
    END IF;

    -- 2. Enforce immutability of core authorization parameters during ANY update
    IF NEW.id <> OLD.id OR
       NEW.organization_id <> OLD.organization_id OR
       NEW.transaction_id <> OLD.transaction_id OR
       NEW.requested_by <> OLD.requested_by OR
       NEW.approved_by <> OLD.approved_by OR
       NEW.security_audit_log_id <> OLD.security_audit_log_id OR
       NEW.request_fingerprint <> OLD.request_fingerprint OR
       NEW.operation_key <> OLD.operation_key OR
       NEW.authorized_at <> OLD.authorized_at OR
       NEW.expires_at <> OLD.expires_at OR
       NEW.reason <> OLD.reason THEN
        RAISE EXCEPTION 'Modification of core authorization parameters is strictly forbidden.';
    END IF;

    -- 3. Enforce transition ISSUED -> EXPIRED is only allowed when clock_timestamp() >= OLD.expires_at
    IF OLD.status = 'ISSUED' AND NEW.status = 'EXPIRED' THEN
        IF clock_timestamp() < OLD.expires_at THEN
            RAISE EXCEPTION 'Cannot expire active authorization % before its expiration time %.', OLD.id, OLD.expires_at;
        END IF;
    END IF;

    -- 4. Validation when transitioning from ISSUED to CONSUMED
    IF OLD.status = 'ISSUED' AND NEW.status = 'CONSUMED' THEN
        -- Check expiration using clock_timestamp()
        IF OLD.expires_at <= clock_timestamp() THEN
            RAISE EXCEPTION 'Authorization % expired at %.', OLD.id, OLD.expires_at;
        END IF;

        -- Ensure authorization has at least one domain item
        SELECT count(*) INTO v_item_count
        FROM public.inventory_negative_override_authorization_items
        WHERE authorization_id = OLD.id AND organization_id = OLD.organization_id;

        IF v_item_count = 0 THEN
            RAISE EXCEPTION 'Authorization % has no authorized domain items.', OLD.id;
        END IF;

        -- Check that approver user profile and organization membership remain active
        SELECT EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            JOIN public.user_profiles up ON up.id = om.user_id
            WHERE om.user_id = OLD.approved_by
              AND om.organization_id = OLD.organization_id
              AND om.is_active = true
              AND up.is_active = true
        ) INTO v_appr_active;

        IF NOT v_appr_active THEN
            RAISE EXCEPTION 'Approver user profile or organization membership is no longer active for authorization %.', OLD.id;
        END IF;

        -- Fetch initiating branch ID of transaction
        SELECT initiating_branch_id INTO v_init_branch_id
        FROM public.inventory_transactions
        WHERE id = OLD.transaction_id AND organization_id = OLD.organization_id;

        -- Check that approver holds inventory:negative_override for initiating branch
        SELECT EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            JOIN public.user_profiles up ON up.id = om.user_id
            JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
            JOIN public.role_permissions rp ON rp.role_id = ur.role_id
            JOIN public.permissions p ON p.id = rp.permission_id
            WHERE om.user_id = OLD.approved_by
              AND om.organization_id = OLD.organization_id
              AND om.is_active = true
              AND up.is_active = true
              AND p.code = 'inventory:negative_override'
              AND (ur.branch_id IS NULL OR ur.branch_id = v_init_branch_id)
        ) INTO v_appr_has_neg_override;

        IF NOT v_appr_has_neg_override THEN
            RAISE EXCEPTION 'Approver lacks active inventory:negative_override permission for initiating branch %.', v_init_branch_id;
        END IF;

        -- Check if approver explicitly holds inventory:manage permission
        SELECT EXISTS (
            SELECT 1
            FROM public.organization_memberships om
            JOIN public.user_profiles up ON up.id = om.user_id
            JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
            JOIN public.role_permissions rp ON rp.role_id = ur.role_id
            JOIN public.permissions p ON p.id = rp.permission_id
            WHERE om.user_id = OLD.approved_by
              AND om.organization_id = OLD.organization_id
              AND om.is_active = true
              AND up.is_active = true
              AND p.code = 'inventory:manage'
        ) INTO v_appr_has_manage;

        -- Check warehouses in deterministic sorted order
        FOR v_wh IN
            SELECT DISTINCT source_warehouse_id AS w_id
            FROM public.inventory_negative_override_authorization_items
            WHERE authorization_id = OLD.id AND organization_id = OLD.organization_id
            ORDER BY source_warehouse_id ASC
        LOOP
            SELECT branch_id INTO v_wh_branch_id
            FROM public.warehouses
            WHERE id = v_wh.w_id AND organization_id = OLD.organization_id;

            IF v_wh_branch_id IS NULL THEN
                RAISE EXCEPTION 'Warehouse % does not exist or is not connected to a branch.', v_wh.w_id;
            END IF;

            -- Approver must hold inventory:negative_override for warehouse branch
            SELECT EXISTS (
                SELECT 1
                FROM public.organization_memberships om
                JOIN public.user_profiles up ON up.id = om.user_id
                JOIN public.user_roles ur ON ur.membership_id = om.id AND ur.organization_id = om.organization_id AND ur.user_id = om.user_id
                JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                JOIN public.permissions p ON p.id = rp.permission_id
                WHERE om.user_id = OLD.approved_by
                  AND om.organization_id = OLD.organization_id
                  AND om.is_active = true
                  AND up.is_active = true
                  AND p.code = 'inventory:negative_override'
                  AND (ur.branch_id IS NULL OR ur.branch_id = v_wh_branch_id)
            ) INTO v_appr_has_neg_override;

            IF NOT v_appr_has_neg_override THEN
                RAISE EXCEPTION 'Approver lacks active inventory:negative_override permission for branch % connected to warehouse %.', v_wh_branch_id, v_wh.w_id;
            END IF;

            -- Check warehouse access explicitly for OLD.approved_by
            IF NOT v_appr_has_manage THEN
                SELECT EXISTS (
                    SELECT 1
                    FROM public.organization_memberships om
                    JOIN public.user_profiles up ON up.id = om.user_id
                    JOIN public.user_warehouse_access uwa ON uwa.membership_id = om.id AND uwa.organization_id = om.organization_id
                    WHERE om.user_id = OLD.approved_by
                      AND om.organization_id = OLD.organization_id
                      AND om.is_active = true
                      AND up.is_active = true
                      AND uwa.warehouse_id = v_wh.w_id
                      AND uwa.is_active = true
                ) INTO v_appr_has_wh_access;

                IF NOT v_appr_has_wh_access THEN
                    RAISE EXCEPTION 'Approver lacks active warehouse access to warehouse %.', v_wh.w_id;
                END IF;
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_negative_override_auth_update ON public.inventory_negative_override_authorizations;
CREATE TRIGGER trg_validate_negative_override_auth_update
    BEFORE UPDATE ON public.inventory_negative_override_authorizations
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_validate_negative_override_auth_update();
