BEGIN;

-- ==============================================================================
-- Migration: 06_inventory_master_data.sql
-- Description: Phase 3-H - Core Master Data Infrastructure for Units, Categories, Products, Warehouses, User Warehouse Access, and Product Serials
-- Rules & Constraints Implemented:
--   1. Fully enclosed in atomic transaction (BEGIN ... COMMIT). Zero test data created.
--   2. Units of Measurement (measurement_units): decimal_places 0..3, if allows_fraction=false then decimal_places=0.
--   3. Product Categories (product_categories): Hierarchical categories with org-isolated parent FKs and cycle prevention trigger.
--   4. Products (products): Supports PRODUCT and SERVICE. SERVICES cannot be serialized and reorder_point must be 0.
--      Serialized products require integer reorder_point. NO opening stock or cost stored in products table.
--      Physical deletion restricted to DRAFT status only.
--   5. Product Code Sequences (product_code_sequences): Atomic counter table locked against direct client access.
--   6. Warehouses (warehouses): Org and branch isolated. At most ONE active default warehouse per branch.
--      Default warehouse MUST have status ACTIVE. Physical deletion restricted to DRAFT status only.
--   7. User Warehouse Access (user_warehouse_access): Org-isolated user access control. Validated for active membership,
--      active user profile, active warehouse, permitted branch, and default status alignment via trigger.
--   8. Product Serials (product_serials): Unique serial_number_normalized across the ENTIRE organization.
--      Immutable physical retention (physical deletion strictly forbidden). Raw serial saved for display, normalized string for uniqueness.
--      Status and location alignment strictly enforced via check constraint.
--   9. Immutable system fields (organization_id, id, created_by, created_at) guarded via trigger.
--  10. Strict Row Level Security (RLS) policies enforcing multi-tenant organization boundaries and SELECT-ONLY client access.
--      Direct client INSERT, UPDATE, and DELETE operations are strictly REVOKED.
-- ==============================================================================

-- ==============================================================================
-- 1. MEASUREMENT UNITS (واحدهای سنجش)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.measurement_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    allows_fraction BOOLEAN NOT NULL DEFAULT false,
    decimal_places INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_system BOOLEAN NOT NULL DEFAULT false,
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_unit_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_unit_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_unit_decimal_places CHECK (decimal_places >= 0 AND decimal_places <= 3),
    CONSTRAINT chk_unit_fraction_decimals CHECK (
        (allows_fraction = false AND decimal_places = 0) OR (allows_fraction = true)
    )
);

-- ==============================================================================
-- 2. PRODUCT CATEGORIES (دسته‌بندی کالاها و خدمات)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    parent_category_id UUID,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_category_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_category_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_category_parent_not_self CHECK (parent_category_id IS NULL OR parent_category_id <> id),
    CONSTRAINT fk_category_parent FOREIGN KEY (organization_id, parent_category_id)
        REFERENCES public.product_categories(organization_id, id) ON DELETE RESTRICT
);

-- ==============================================================================
-- 3. PRODUCTS & SERVICES (تعریف کالا و خدمت)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category_id UUID NOT NULL,
    measurement_unit_id UUID NOT NULL,
    product_kind TEXT NOT NULL DEFAULT 'PRODUCT',
    is_serialized BOOLEAN NOT NULL DEFAULT false,
    reorder_point NUMERIC(18, 3) NOT NULL DEFAULT 0,
    default_sale_price_amount BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_product_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_product_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_product_kind CHECK (product_kind IN ('PRODUCT', 'SERVICE')),
    CONSTRAINT chk_product_status CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'BLOCKED')),
    CONSTRAINT chk_product_reorder_point CHECK (reorder_point >= 0),
    CONSTRAINT chk_product_sale_price CHECK (default_sale_price_amount >= 0),
    CONSTRAINT chk_service_not_serialized CHECK (product_kind <> 'SERVICE' OR is_serialized = false),
    CONSTRAINT chk_service_no_reorder_point CHECK (product_kind <> 'SERVICE' OR reorder_point = 0),
    CONSTRAINT chk_serialized_integer_reorder CHECK (is_serialized = false OR reorder_point = floor(reorder_point)),
    CONSTRAINT fk_product_category FOREIGN KEY (organization_id, category_id)
        REFERENCES public.product_categories(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_product_unit FOREIGN KEY (organization_id, measurement_unit_id)
        REFERENCES public.measurement_units(organization_id, id) ON DELETE RESTRICT
);

-- ==============================================================================
-- 4. PRODUCT CODE SEQUENCES (شمارنده کد کالا)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.product_code_sequences (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
    prefix TEXT NOT NULL DEFAULT 'PRD-',
    next_number BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT chk_seq_next_number CHECK (next_number > 0)
);

-- ==============================================================================
-- 5. WAREHOUSES (انبارها)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branch_id UUID NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    location TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_warehouse_code_per_org UNIQUE (organization_id, code),
    CONSTRAINT uq_warehouse_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_warehouse_status CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
    CONSTRAINT chk_warehouse_default_status CHECK (is_default = false OR status = 'ACTIVE'),
    CONSTRAINT fk_warehouse_branch FOREIGN KEY (organization_id, branch_id)
        REFERENCES public.branches(organization_id, id) ON DELETE RESTRICT
);

-- Partial unique index: Maximum 1 active default warehouse per branch
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_default_warehouse_per_branch
ON public.warehouses(organization_id, branch_id)
WHERE is_default = true AND status = 'ACTIVE';

-- ==============================================================================
-- 6. USER WAREHOUSE ACCESS (دسترسی کاربران به انبارها)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.user_warehouse_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    membership_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    granted_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_warehouse_membership UNIQUE (membership_id, warehouse_id),
    CONSTRAINT uq_user_wh_access_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_user_wh_default_active CHECK (is_default = false OR is_active = true),
    CONSTRAINT fk_user_wh_access_membership FOREIGN KEY (organization_id, membership_id)
        REFERENCES public.organization_memberships(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_user_wh_access_warehouse FOREIGN KEY (organization_id, warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT
);

-- Partial unique index: Maximum 1 active default warehouse per membership
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_single_default_warehouse
ON public.user_warehouse_access(membership_id)
WHERE is_default = true AND is_active = true;

-- ==============================================================================
-- 7. PRODUCT SERIALS (شماره سریال ردیابی کالاهای سریال‌دار)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.product_serials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL,
    serial_number_raw TEXT NOT NULL,
    serial_number_normalized TEXT NOT NULL,
    acquisition_cost_amount BIGINT NOT NULL DEFAULT 0,
    current_warehouse_id UUID,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_serial_normalized_per_org UNIQUE (organization_id, serial_number_normalized),
    CONSTRAINT uq_product_serial_org_composite UNIQUE (organization_id, id),
    CONSTRAINT chk_serial_status CHECK (status IN ('AVAILABLE', 'RESERVED', 'SOLD', 'RETURNED', 'SCRAPPED', 'REVERSED')),
    CONSTRAINT chk_serial_acquisition_cost CHECK (acquisition_cost_amount >= 0),
    CONSTRAINT chk_serial_status_warehouse CHECK (
        (status IN ('AVAILABLE', 'RESERVED', 'RETURNED') AND current_warehouse_id IS NOT NULL)
        OR
        (status IN ('SOLD', 'SCRAPPED', 'REVERSED') AND current_warehouse_id IS NULL)
    ),
    CONSTRAINT fk_serial_product FOREIGN KEY (organization_id, product_id)
        REFERENCES public.products(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_serial_warehouse FOREIGN KEY (organization_id, current_warehouse_id)
        REFERENCES public.warehouses(organization_id, id) ON DELETE RESTRICT
);

-- Document derived state fields in product_serials
COMMENT ON COLUMN public.product_serials.status IS 'Derived status field managed strictly via atomic warehouse movement transactions in future service phases. REVERSED indicates permanent reversal of serial entry transaction.';
COMMENT ON COLUMN public.product_serials.current_warehouse_id IS 'Derived current physical location managed strictly via atomic warehouse movement transactions in future service phases.';
COMMENT ON COLUMN public.product_serials.acquisition_cost_amount IS 'Derived acquisition cost amount managed strictly via inventory entry vouchers in future service phases.';

-- ==============================================================================
-- INDEXES FOR PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_measurement_units_org ON public.measurement_units(organization_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_org ON public.product_categories(organization_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_parent ON public.product_categories(organization_id, parent_category_id);
CREATE INDEX IF NOT EXISTS idx_products_org ON public.products(organization_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(organization_id, category_id);
CREATE INDEX IF NOT EXISTS idx_products_unit ON public.products(organization_id, measurement_unit_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_org ON public.warehouses(organization_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_branch ON public.warehouses(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_user_wh_access_membership ON public.user_warehouse_access(membership_id);
CREATE INDEX IF NOT EXISTS idx_user_wh_access_warehouse ON public.user_warehouse_access(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_org ON public.product_serials(organization_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_product ON public.product_serials(organization_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_warehouse ON public.product_serials(organization_id, current_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_product_serials_normalized ON public.product_serials(organization_id, serial_number_normalized);

-- ==============================================================================
-- HELPER FUNCTIONS & TRIGGERS
-- ==============================================================================

-- 1. Normalization Helper for Serial Numbers (Iranian digits -> ASCII, Upper Case, Trim Whitespace)
CREATE OR REPLACE FUNCTION public.normalize_serial_number(p_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_res TEXT;
BEGIN
    IF p_input IS NULL THEN
        RETURN NULL;
    END IF;
    -- Translate Persian (۰-۹) & Arabic (٠-٩) digits to ASCII digits
    v_res := translate(p_input, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789');
    -- Trim leading and trailing whitespace
    v_res := trim(v_res);
    -- Remove internal whitespace or control characters
    v_res := regexp_replace(v_res, '\s+', '', 'g');
    -- Upper case ASCII characters
    v_res := upper(v_res);
    IF v_res = '' THEN
        RETURN NULL;
    END IF;
    RETURN v_res;
END;
$$;

-- 2. Trigger Function: Version Incrementor & Timestamp updater
CREATE OR REPLACE FUNCTION public.trg_increment_inventory_master_version()
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

-- Triggers for versioning
DROP TRIGGER IF EXISTS trg_measurement_units_version ON public.measurement_units;
CREATE TRIGGER trg_measurement_units_version
BEFORE UPDATE ON public.measurement_units
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

DROP TRIGGER IF EXISTS trg_product_categories_version ON public.product_categories;
CREATE TRIGGER trg_product_categories_version
BEFORE UPDATE ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

DROP TRIGGER IF EXISTS trg_products_version ON public.products;
CREATE TRIGGER trg_products_version
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

DROP TRIGGER IF EXISTS trg_warehouses_version ON public.warehouses;
CREATE TRIGGER trg_warehouses_version
BEFORE UPDATE ON public.warehouses
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

DROP TRIGGER IF EXISTS trg_user_warehouse_access_version ON public.user_warehouse_access;
CREATE TRIGGER trg_user_warehouse_access_version
BEFORE UPDATE ON public.user_warehouse_access
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

DROP TRIGGER IF EXISTS trg_product_serials_version ON public.product_serials;
CREATE TRIGGER trg_product_serials_version
BEFORE UPDATE ON public.product_serials
FOR EACH ROW EXECUTE FUNCTION public.trg_increment_inventory_master_version();

-- 3. Trigger Function: Immutability Protection for Core System Identifiers
CREATE OR REPLACE FUNCTION public.prevent_inventory_immutable_fields_update()
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

-- Apply immutability triggers
DROP TRIGGER IF EXISTS trg_units_immutability ON public.measurement_units;
CREATE TRIGGER trg_units_immutability
BEFORE UPDATE ON public.measurement_units
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_categories_immutability ON public.product_categories;
CREATE TRIGGER trg_categories_immutability
BEFORE UPDATE ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_products_immutability ON public.products;
CREATE TRIGGER trg_products_immutability
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_warehouses_immutability ON public.warehouses;
CREATE TRIGGER trg_warehouses_immutability
BEFORE UPDATE ON public.warehouses
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_user_wh_access_immutability ON public.user_warehouse_access;
CREATE TRIGGER trg_user_wh_access_immutability
BEFORE UPDATE ON public.user_warehouse_access
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

DROP TRIGGER IF EXISTS trg_serials_immutability ON public.product_serials;
CREATE TRIGGER trg_serials_immutability
BEFORE UPDATE ON public.product_serials
FOR EACH ROW EXECUTE FUNCTION public.prevent_inventory_immutable_fields_update();

-- 4. Trigger Function: Prevent Cycles in Product Categories
CREATE OR REPLACE FUNCTION public.trg_prevent_product_category_cycles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_curr_parent UUID;
    v_visited UUID[];
BEGIN
    IF NEW.parent_category_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.parent_category_id = NEW.id THEN
        RAISE EXCEPTION 'Category cannot be its own parent.';
    END IF;

    -- Transactional lock scoped to organization to prevent concurrent cycle creation
    PERFORM pg_advisory_xact_lock(hashtext('product_categories_' || NEW.organization_id::text));

    v_curr_parent := NEW.parent_category_id;
    v_visited := ARRAY[NEW.id];

    WHILE v_curr_parent IS NOT NULL LOOP
        IF v_curr_parent = ANY(v_visited) THEN
            RAISE EXCEPTION 'Cyclic parent-child relationship detected in product categories.';
        END IF;

        v_visited := array_append(v_visited, v_curr_parent);

        SELECT pc.parent_category_id INTO v_curr_parent
        FROM public.product_categories pc
        WHERE pc.id = v_curr_parent AND pc.organization_id = NEW.organization_id;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_category_cycle ON public.product_categories;
CREATE TRIGGER trg_prevent_category_cycle
BEFORE INSERT OR UPDATE ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.trg_prevent_product_category_cycles();

-- 5. Trigger Function: Validate User Warehouse Access Integrity
CREATE OR REPLACE FUNCTION public.trg_validate_user_warehouse_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_mem_org UUID;
    v_mem_active BOOLEAN;
    v_mem_branch UUID;
    v_user_active BOOLEAN;
    v_wh_branch UUID;
    v_wh_status TEXT;
    v_has_branch_access BOOLEAN;
BEGIN
    -- Verify membership existence and active status
    SELECT om.organization_id, om.is_active, om.default_branch_id 
    INTO v_mem_org, v_mem_active, v_mem_branch
    FROM public.organization_memberships om
    WHERE om.id = NEW.membership_id AND om.organization_id = NEW.organization_id;

    IF v_mem_org IS NULL OR v_mem_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Membership does not exist or is inactive in the specified organization.';
    END IF;

    -- Verify active status of underlying user profile
    SELECT up.is_active INTO v_user_active
    FROM public.user_profiles up
    JOIN public.organization_memberships om ON om.user_id = up.id
    WHERE om.id = NEW.membership_id;

    IF v_user_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'User profile associated with this membership is inactive or blocked.';
    END IF;

    -- Verify warehouse existence, org alignment, and ACTIVE status
    SELECT w.branch_id, w.status INTO v_wh_branch, v_wh_status
    FROM public.warehouses w
    WHERE w.id = NEW.warehouse_id AND w.organization_id = NEW.organization_id;

    IF v_wh_branch IS NULL THEN
        RAISE EXCEPTION 'Warehouse does not exist in the specified organization.';
    END IF;

    IF v_wh_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Warehouse access can only be granted to ACTIVE warehouses.';
    END IF;

    -- Verify warehouse branch accessibility for membership
    v_has_branch_access := FALSE;
    IF v_mem_branch IS NOT NULL AND v_wh_branch = v_mem_branch THEN
        v_has_branch_access := TRUE;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM public.user_branch_access uba
            WHERE uba.membership_id = NEW.membership_id
              AND uba.organization_id = NEW.organization_id
              AND uba.branch_id = v_wh_branch
              AND uba.is_active = TRUE
        ) INTO v_has_branch_access;
    END IF;

    IF v_has_branch_access IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Warehouse branch is not accessible by this membership.';
    END IF;

    -- Verify default access alignment
    IF NEW.is_default IS TRUE AND NEW.is_active IS FALSE THEN
        RAISE EXCEPTION 'Inactive warehouse access cannot be designated as default.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_user_wh_access ON public.user_warehouse_access;
CREATE TRIGGER trg_validate_user_wh_access
BEFORE INSERT OR UPDATE ON public.user_warehouse_access
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_user_warehouse_access();

-- 6. Trigger Function: Normalize and Validate Product Serials
CREATE OR REPLACE FUNCTION public.trg_normalize_and_validate_product_serial()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_product_kind TEXT;
    v_is_serialized BOOLEAN;
    v_wh_status TEXT;
BEGIN
    -- Normalize serial number string
    NEW.serial_number_normalized := public.normalize_serial_number(NEW.serial_number_raw);
    IF NEW.serial_number_normalized IS NULL OR length(NEW.serial_number_normalized) = 0 THEN
        RAISE EXCEPTION 'Serial number cannot be empty or invalid.';
    END IF;

    -- Verify product serialization capability and org alignment
    SELECT p.product_kind, p.is_serialized INTO v_product_kind, v_is_serialized
    FROM public.products p
    WHERE p.id = NEW.product_id AND p.organization_id = NEW.organization_id;

    IF v_product_kind IS NULL THEN
        RAISE EXCEPTION 'Referenced product does not exist in the specified organization.';
    END IF;

    IF v_product_kind = 'SERVICE' THEN
        RAISE EXCEPTION 'Serial numbers cannot be assigned to services.';
    END IF;

    IF v_is_serialized IS FALSE THEN
        RAISE EXCEPTION 'Serial numbers can only be registered for products marked with is_serialized = true.';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'REVERSED' THEN
        IF NEW.status IS DISTINCT FROM 'REVERSED' THEN
            RAISE EXCEPTION 'Serial status REVERSED is final and cannot be modified.';
        END IF;
        IF NEW.current_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'A REVERSED serial number cannot be assigned to a warehouse.';
        END IF;
    END IF;

    -- Validate serial status vs warehouse status and presence
    IF NEW.status IN ('AVAILABLE', 'RESERVED', 'RETURNED') THEN
        IF NEW.current_warehouse_id IS NULL THEN
            RAISE EXCEPTION 'Serial status % requires a valid warehouse assignment.', NEW.status;
        END IF;

        SELECT w.status INTO v_wh_status
        FROM public.warehouses w
        WHERE w.id = NEW.current_warehouse_id AND w.organization_id = NEW.organization_id;

        IF v_wh_status IS NULL OR v_wh_status <> 'ACTIVE' THEN
            RAISE EXCEPTION 'Current warehouse for serial number must be an ACTIVE warehouse in the same organization.';
        END IF;
    ELSIF NEW.status IN ('SOLD', 'SCRAPPED', 'REVERSED') THEN
        IF NEW.current_warehouse_id IS NOT NULL THEN
            RAISE EXCEPTION 'Serial status % must not have a current warehouse.', NEW.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_serials_normalize ON public.product_serials;
CREATE TRIGGER trg_product_serials_normalize
BEFORE INSERT OR UPDATE ON public.product_serials
FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_and_validate_product_serial();

-- 7. Physical Deletion Guards
CREATE OR REPLACE FUNCTION public.prevent_product_physical_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Physical deletion of non-draft products is strictly forbidden. Deactivate or block the product instead.';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_product_deletion ON public.products;
CREATE TRIGGER trg_prevent_product_deletion
BEFORE DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.prevent_product_physical_deletion();

CREATE OR REPLACE FUNCTION public.prevent_warehouse_physical_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Physical deletion of non-draft warehouses is strictly forbidden. Deactivate the warehouse instead.';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_warehouse_deletion ON public.warehouses;
CREATE TRIGGER trg_prevent_warehouse_deletion
BEFORE DELETE ON public.warehouses
FOR EACH ROW EXECUTE FUNCTION public.prevent_warehouse_physical_deletion();

CREATE OR REPLACE FUNCTION public.prevent_product_serial_physical_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'Physical deletion of serial number records is strictly forbidden for audit and traceability preservation.';
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_serial_deletion ON public.product_serials;
CREATE TRIGGER trg_prevent_serial_deletion
BEFORE DELETE ON public.product_serials
FOR EACH ROW EXECUTE FUNCTION public.prevent_product_serial_physical_deletion();

CREATE OR REPLACE FUNCTION public.prevent_system_unit_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF OLD.is_system IS TRUE THEN
        RAISE EXCEPTION 'Physical deletion of system measurement units is strictly forbidden.';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_unit_deletion ON public.measurement_units;
CREATE TRIGGER trg_prevent_system_unit_deletion
BEFORE DELETE ON public.measurement_units
FOR EACH ROW EXECUTE FUNCTION public.prevent_system_unit_deletion();

-- Revoke default public execution rights on security helper and trigger functions
REVOKE EXECUTE ON FUNCTION public.normalize_serial_number(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_increment_inventory_master_version() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_inventory_immutable_fields_update() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_prevent_product_category_cycles() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_validate_user_warehouse_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_normalize_and_validate_product_serial() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_product_physical_deletion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_warehouse_physical_deletion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_product_serial_physical_deletion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_system_unit_deletion() FROM PUBLIC;

-- ==============================================================================
-- PERMISSIONS SEED DATA (CATALOG DEFINITION ONLY - NO ROLE MAPPINGS)
-- ==============================================================================
INSERT INTO public.permissions (code, name_fa, category, description) VALUES
('inventory:read', 'مشاهده کالاها و انبارها', 'انبارداری', 'امکان مشاهده اطلاعات پایه کالاها، انبارها، موجودی و سریال‌ها'),
('inventory:manage', 'مدیریت کالاها، انبارها و سریال‌ها', 'انبارداری', 'امکان تعریف و ویرایش اطلاعات پایه کالاها، انبارها و دسترسی‌ها')
ON CONFLICT (code) DO NOTHING;

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES & PRIVILEGE REVOCATIONS
-- ==============================================================================
ALTER TABLE public.measurement_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_code_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_warehouse_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_serials ENABLE ROW LEVEL SECURITY;

-- 1. Measurement Units RLS Policies (SELECT ONLY)
CREATE POLICY "Members can view measurement units of their org"
ON public.measurement_units FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- 2. Product Categories RLS Policies (SELECT ONLY)
CREATE POLICY "Members can view product categories of their org"
ON public.product_categories FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- 3. Products RLS Policies (SELECT ONLY)
CREATE POLICY "Members can view products of their org"
ON public.products FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- 4. Warehouses RLS Policies (SELECT ONLY)
CREATE POLICY "Members can view warehouses of their org"
ON public.warehouses FOR SELECT
TO authenticated
USING (public.is_org_member(organization_id));

-- 5. User Warehouse Access RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view user warehouse access"
ON public.user_warehouse_access FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        EXISTS (
            SELECT 1 FROM public.organization_memberships om
            WHERE om.id = user_warehouse_access.membership_id
              AND om.user_id = auth.uid()
        )
        OR public.has_permission(organization_id, 'users:manage')
        OR public.has_permission(organization_id, 'inventory:manage')
    )
);

-- 6. Product Serials RLS Policies (SELECT ONLY)
CREATE POLICY "Authorized members can view product serials"
ON public.product_serials FOR SELECT
TO authenticated
USING (
    public.is_org_member(organization_id)
    AND (
        public.has_permission(organization_id, 'inventory:read')
        OR public.has_permission(organization_id, 'inventory:manage')
        OR public.has_permission(organization_id, 'finance:read')
    )
);

-- Revoke all privileges on product_code_sequences
REVOKE ALL ON public.product_code_sequences FROM PUBLIC, anon, authenticated;

-- Revoke direct mutation privileges from PUBLIC, anon, authenticated on six tables
REVOKE INSERT, UPDATE, DELETE ON public.measurement_units FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.product_categories FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.products FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.warehouses FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_warehouse_access FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.product_serials FROM PUBLIC, anon, authenticated;

-- Explicitly revoke SELECT from PUBLIC and anon on all seven tables
REVOKE SELECT ON public.measurement_units FROM PUBLIC, anon;
REVOKE SELECT ON public.product_categories FROM PUBLIC, anon;
REVOKE SELECT ON public.products FROM PUBLIC, anon;
REVOKE SELECT ON public.product_code_sequences FROM PUBLIC, anon;
REVOKE SELECT ON public.warehouses FROM PUBLIC, anon;
REVOKE SELECT ON public.user_warehouse_access FROM PUBLIC, anon;
REVOKE SELECT ON public.product_serials FROM PUBLIC, anon;

-- Grant SELECT to authenticated on six tables (access governed by RLS)
GRANT SELECT ON public.measurement_units TO authenticated;
GRANT SELECT ON public.product_categories TO authenticated;
GRANT SELECT ON public.products TO authenticated;
GRANT SELECT ON public.warehouses TO authenticated;
GRANT SELECT ON public.user_warehouse_access TO authenticated;
GRANT SELECT ON public.product_serials TO authenticated;

COMMIT;
