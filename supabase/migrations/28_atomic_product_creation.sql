BEGIN;

-- ==============================================================================
-- Migration: 28_atomic_product_creation.sql
-- Description: Server-Authoritative Atomic Product Creation & Code Sequence RPC
-- Invariants:
--   1. Atomic Sequence Allocation: product_code_sequences locked with FOR UPDATE within transaction.
--   2. Strict Idempotency: operation_key & request_fingerprint verification prevents duplicate creation.
--   3. Fingerprint Conflict Protection: Matching operation_key with differing payload raises ERR_IDEMPOTENCY_CONFLICT.
--   4. Rollback Integrity: Any insertion failure automatically rolls back sequence advancement.
--   5. Multi-Tenant Isolation: All actions bounded to organization_id.
-- ==============================================================================

-- 1. Add operation_key and request_fingerprint columns to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS operation_key TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

-- 2. Create unique index for idempotency on (organization_id, operation_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_org_operation_key
ON public.products(organization_id, operation_key)
WHERE operation_key IS NOT NULL;

-- 3. Atomic Function for Previewing / Querying Next Product Code
CREATE OR REPLACE FUNCTION public.get_next_product_code_atomic(
    p_organization_id UUID,
    p_user_id UUID DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_prefix TEXT;
    v_next BIGINT;
    v_code TEXT;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'Parameter p_organization_id is required.';
    END IF;

    -- Ensure sequence row exists
    INSERT INTO public.product_code_sequences (organization_id, prefix, next_number, updated_by)
    VALUES (p_organization_id, 'PRD-', 1, p_user_id)
    ON CONFLICT (organization_id) DO NOTHING;

    -- Lock sequence row for atomic read
    SELECT prefix, next_number INTO v_prefix, v_next
    FROM public.product_code_sequences
    WHERE organization_id = p_organization_id
    FOR UPDATE;

    v_code := COALESCE(v_prefix, 'PRD-') || lpad(COALESCE(v_next, 1)::text, 4, '0');
    RETURN v_code;
END;
$$;

-- 4. Atomic Product Creation Function
CREATE OR REPLACE FUNCTION public.create_product_atomic(
    p_organization_id UUID,
    p_code TEXT,
    p_name TEXT,
    p_category_id UUID,
    p_measurement_unit_id UUID,
    p_product_kind TEXT DEFAULT 'PRODUCT',
    p_is_serialized BOOLEAN DEFAULT false,
    p_reorder_point NUMERIC(18, 3) DEFAULT 0,
    p_default_sale_price_amount BIGINT DEFAULT 0,
    p_status TEXT DEFAULT 'ACTIVE',
    p_created_by UUID DEFAULT NULL,
    p_operation_key TEXT DEFAULT NULL,
    p_request_fingerprint TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_existing RECORD;
    v_cat RECORD;
    v_unit RECORD;
    v_assigned_code TEXT;
    v_seq_prefix TEXT;
    v_seq_next BIGINT;
    v_product_kind TEXT := COALESCE(p_product_kind, 'PRODUCT');
    v_is_serialized BOOLEAN := COALESCE(p_is_serialized, false);
    v_reorder_point NUMERIC(18, 3) := COALESCE(p_reorder_point, 0);
    v_status TEXT := COALESCE(p_status, 'ACTIVE');
    v_new_product RECORD;
    v_result JSONB;
BEGIN
    -- 1. Parameter Validation
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_ORGANIZATION: شناسه سازمان الزامی است.';
    END IF;

    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'ERR_INVALID_PRODUCT_NAME: نام کالا یا خدمت الزامی است.';
    END IF;

    IF p_category_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_CATEGORY: دسته‌بندی کالا الزامی است.';
    END IF;

    IF p_measurement_unit_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_UNIT: واحد سنجش کالا الزامی است.';
    END IF;

    IF v_product_kind NOT IN ('PRODUCT', 'SERVICE') THEN
        RAISE EXCEPTION 'ERR_INVALID_PRODUCT_KIND: نوع کالا باید PRODUCT یا SERVICE باشد.';
    END IF;

    IF v_status NOT IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'BLOCKED') THEN
        RAISE EXCEPTION 'ERR_INVALID_STATUS: وضعیت کالا نامعتبر است.';
    END IF;

    -- Enforce Service & Serialized constraints
    IF v_product_kind = 'SERVICE' THEN
        v_is_serialized := false;
        v_reorder_point := 0;
    ELSIF v_is_serialized THEN
        v_reorder_point := floor(v_reorder_point);
    END IF;

    -- 2. Verify Foreign Keys belong to the same Organization
    SELECT id, title, code INTO v_cat
    FROM public.product_categories
    WHERE id = p_category_id AND organization_id = p_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_CATEGORY_NOT_FOUND: دسته‌بندی مشخص‌شده در این سازمان یافت نشد.';
    END IF;

    SELECT id, title, code INTO v_unit
    FROM public.measurement_units
    WHERE id = p_measurement_unit_id AND organization_id = p_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_UNIT_NOT_FOUND: واحد سنجش مشخص‌شده در این سازمان یافت نشد.';
    END IF;

    -- 3. Idempotency Check via (organization_id, operation_key)
    IF p_operation_key IS NOT NULL AND trim(p_operation_key) <> '' THEN
        SELECT * INTO v_existing
        FROM public.products
        WHERE organization_id = p_organization_id AND operation_key = p_operation_key;

        IF FOUND THEN
            IF v_existing.request_fingerprint = p_request_fingerprint THEN
                -- Return existing product safely without side-effects
                SELECT jsonb_build_object(
                    'id', v_existing.id,
                    'organization_id', v_existing.organization_id,
                    'code', v_existing.code,
                    'name', v_existing.name,
                    'category_id', v_existing.category_id,
                    'measurement_unit_id', v_existing.measurement_unit_id,
                    'product_kind', v_existing.product_kind,
                    'is_serialized', v_existing.is_serialized,
                    'reorder_point', v_existing.reorder_point,
                    'default_sale_price_amount', v_existing.default_sale_price_amount,
                    'status', v_existing.status,
                    'version', v_existing.version,
                    'created_by', v_existing.created_by,
                    'created_at', v_existing.created_at,
                    'updated_at', v_existing.updated_at,
                    'operation_key', v_existing.operation_key,
                    'request_fingerprint', v_existing.request_fingerprint,
                    'category', jsonb_build_object('id', v_cat.id, 'title', v_cat.title, 'code', v_cat.code),
                    'measurement_unit', jsonb_build_object('id', v_unit.id, 'title', v_unit.title, 'code', v_unit.code),
                    'idempotent_replay', true
                ) INTO v_result;
                RETURN v_result;
            ELSE
                RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: Operation key % already exists with a different request fingerprint.', p_operation_key;
            END IF;
        END IF;
    END IF;

    -- 4. Atomic Code Sequence Generation & Row Locking
    IF p_code IS NULL OR trim(p_code) = '' THEN
        -- Ensure sequence row exists
        INSERT INTO public.product_code_sequences (organization_id, prefix, next_number, updated_by)
        VALUES (p_organization_id, 'PRD-', 1, p_created_by)
        ON CONFLICT (organization_id) DO NOTHING;

        -- Lock sequence row
        SELECT prefix, next_number INTO v_seq_prefix, v_seq_next
        FROM public.product_code_sequences
        WHERE organization_id = p_organization_id
        FOR UPDATE;

        v_assigned_code := COALESCE(v_seq_prefix, 'PRD-') || lpad(COALESCE(v_seq_next, 1)::text, 4, '0');

        -- Advance sequence
        UPDATE public.product_code_sequences
        SET next_number = COALESCE(v_seq_next, 1) + 1,
            updated_at = now(),
            updated_by = p_created_by
        WHERE organization_id = p_organization_id;
    ELSE
        v_assigned_code := trim(p_code);
    END IF;

    -- 5. Insert Product
    INSERT INTO public.products (
        organization_id,
        code,
        name,
        category_id,
        measurement_unit_id,
        product_kind,
        is_serialized,
        reorder_point,
        default_sale_price_amount,
        status,
        created_by,
        operation_key,
        request_fingerprint,
        version
    ) VALUES (
        p_organization_id,
        v_assigned_code,
        trim(p_name),
        p_category_id,
        p_measurement_unit_id,
        v_product_kind,
        v_is_serialized,
        v_reorder_point,
        COALESCE(p_default_sale_price_amount, 0),
        v_status,
        p_created_by,
        p_operation_key,
        p_request_fingerprint,
        1
    ) RETURNING * INTO v_new_product;

    -- 6. Construct and Return Result JSON
    SELECT jsonb_build_object(
        'id', v_new_product.id,
        'organization_id', v_new_product.organization_id,
        'code', v_new_product.code,
        'name', v_new_product.name,
        'category_id', v_new_product.category_id,
        'measurement_unit_id', v_new_product.measurement_unit_id,
        'product_kind', v_new_product.product_kind,
        'is_serialized', v_new_product.is_serialized,
        'reorder_point', v_new_product.reorder_point,
        'default_sale_price_amount', v_new_product.default_sale_price_amount,
        'status', v_new_product.status,
        'version', v_new_product.version,
        'created_by', v_new_product.created_by,
        'created_at', v_new_product.created_at,
        'updated_at', v_new_product.updated_at,
        'operation_key', v_new_product.operation_key,
        'request_fingerprint', v_new_product.request_fingerprint,
        'category', jsonb_build_object('id', v_cat.id, 'title', v_cat.title, 'code', v_cat.code),
        'measurement_unit', jsonb_build_object('id', v_unit.id, 'title', v_unit.title, 'code', v_unit.code),
        'idempotent_replay', false
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Revoke public execution and grant to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.get_next_product_code_atomic(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_next_product_code_atomic(UUID, UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.create_product_atomic(UUID, TEXT, TEXT, UUID, UUID, TEXT, BOOLEAN, NUMERIC, BIGINT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_product_atomic(UUID, TEXT, TEXT, UUID, UUID, TEXT, BOOLEAN, NUMERIC, BIGINT, TEXT, UUID, TEXT, TEXT) TO authenticated, service_role;

COMMIT;
