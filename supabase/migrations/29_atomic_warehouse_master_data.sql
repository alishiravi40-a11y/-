BEGIN;

-- ==============================================================================
-- Migration: 29_atomic_warehouse_master_data.sql
-- Description: Server-Authoritative Atomic Warehouse Master Data & State Machine
-- Invariants:
--   1. Multi-Tenant Isolation: All warehouse records strictly bound to organization_id.
--   2. Branch Integrity: Branch validated per organization; auto-resolved if exactly 1 active branch exists, or ERR_BRANCH_REQUIRED if multiple.
--   3. Unique Warehouse Code: Warehouse code unique per organization.
--   4. Strict Idempotency: operation_key & request_fingerprint verification prevents duplicate creation.
--   5. Fingerprint Conflict Protection: Matching operation_key with differing payload raises ERR_IDEMPOTENCY_CONFLICT.
--   6. Single Active Default Warehouse: At most 1 active default warehouse per branch, managed atomically with row locking.
--   7. Optimistic Concurrency Control: Stale version during updates raises ERR_CONCURRENCY_CONFLICT.
--   8. Soft Deactivation: No physical deletion; default warehouse deactivation blocked unless replacement default is designated.
-- ==============================================================================

-- 1. Add operation_key and request_fingerprint columns to warehouses
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS operation_key TEXT;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

-- 2. Create unique index for idempotency on (organization_id, operation_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_org_operation_key
ON public.warehouses(organization_id, operation_key)
WHERE operation_key IS NOT NULL;

-- 3. Warehouse Code Sequences Table
CREATE TABLE IF NOT EXISTS public.warehouse_code_sequences (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
    prefix TEXT NOT NULL DEFAULT 'WH-',
    next_number BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT chk_warehouse_seq_next_number CHECK (next_number > 0)
);

ALTER TABLE public.warehouse_code_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow members to read warehouse code sequences"
ON public.warehouse_code_sequences FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.organization_memberships m
        WHERE m.organization_id = warehouse_code_sequences.organization_id
          AND m.user_id = auth.uid()
          AND m.is_active = true
    )
);

-- 4. Atomic Function for Previewing / Generating Next Warehouse Code
CREATE OR REPLACE FUNCTION public.get_next_warehouse_code_atomic(
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
    INSERT INTO public.warehouse_code_sequences (organization_id, prefix, next_number, updated_by)
    VALUES (p_organization_id, 'WH-', 1, p_user_id)
    ON CONFLICT (organization_id) DO NOTHING;

    -- Lock sequence row for atomic read
    SELECT prefix, next_number INTO v_prefix, v_next
    FROM public.warehouse_code_sequences
    WHERE organization_id = p_organization_id
    FOR UPDATE;

    v_code := COALESCE(v_prefix, 'WH-') || lpad(COALESCE(v_next, 1)::text, 3, '0');
    RETURN v_code;
END;
$$;

-- 5. Atomic Warehouse Creation Function
CREATE OR REPLACE FUNCTION public.create_warehouse_atomic(
    p_organization_id UUID,
    p_name TEXT,
    p_code TEXT DEFAULT NULL,
    p_branch_id UUID DEFAULT NULL,
    p_location TEXT DEFAULT NULL,
    p_is_default BOOLEAN DEFAULT false,
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
    v_branch RECORD;
    v_branch_id UUID := p_branch_id;
    v_active_branches_count INT;
    v_assigned_code TEXT;
    v_seq_prefix TEXT;
    v_seq_next BIGINT;
    v_is_default BOOLEAN := COALESCE(p_is_default, false);
    v_status TEXT := COALESCE(p_status, 'ACTIVE');
    v_active_warehouses_in_branch INT;
    v_new_wh RECORD;
    v_result JSONB;
BEGIN
    -- 1. Parameter Validation
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_ORGANIZATION: شناسه سازمان الزامی است.';
    END IF;

    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'ERR_INVALID_WAREHOUSE_NAME: نام انبار الزامی است.';
    END IF;

    IF v_status NOT IN ('DRAFT', 'ACTIVE', 'INACTIVE') THEN
        RAISE EXCEPTION 'ERR_INVALID_STATUS: وضعیت انبار نامعتبر است.';
    END IF;

    -- 2. Branch Resolution
    IF v_branch_id IS NOT NULL THEN
        SELECT id, name, code INTO v_branch
        FROM public.branches
        WHERE id = v_branch_id AND organization_id = p_organization_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_BRANCH_NOT_FOUND: شعبه مشخص‌شده در این سازمان یافت نشد یا غیرفعال است.';
        END IF;
    ELSE
        -- Auto-resolve branch if exactly 1 active branch exists
        SELECT count(*), max(id) INTO v_active_branches_count, v_branch_id
        FROM public.branches
        WHERE organization_id = p_organization_id AND is_active = true;

        IF v_active_branches_count = 1 THEN
            SELECT id, name, code INTO v_branch
            FROM public.branches
            WHERE id = v_branch_id AND organization_id = p_organization_id;
        ELSIF v_active_branches_count > 1 THEN
            RAISE EXCEPTION 'ERR_BRANCH_REQUIRED: انتخاب شعبه برای ایجاد انبار الزامی است زیرا بیش از یک شعبه فعال وجود دارد.';
        ELSE
            -- Fallback check for any branch in organization
            SELECT id, name, code INTO v_branch
            FROM public.branches
            WHERE organization_id = p_organization_id
            LIMIT 1;

            IF FOUND THEN
                v_branch_id := v_branch.id;
            ELSE
                RAISE EXCEPTION 'ERR_BRANCH_NOT_FOUND: هیچ شعبه‌ای برای این سازمان یافت نشد.';
            END IF;
        END IF;
    END IF;

    -- 3. Idempotency Check via (organization_id, operation_key)
    IF p_operation_key IS NOT NULL AND trim(p_operation_key) <> '' THEN
        SELECT w.*, b.name AS branch_name, b.code AS branch_code 
        INTO v_existing
        FROM public.warehouses w
        LEFT JOIN public.branches b ON b.id = w.branch_id
        WHERE w.organization_id = p_organization_id AND w.operation_key = p_operation_key;

        IF FOUND THEN
            IF v_existing.request_fingerprint = p_request_fingerprint THEN
                -- Return existing warehouse safely without side-effects
                SELECT jsonb_build_object(
                    'id', v_existing.id,
                    'organizationId', v_existing.organization_id,
                    'branchId', v_existing.branch_id,
                    'branchName', v_existing.branch_name,
                    'branchCode', v_existing.branch_code,
                    'code', v_existing.code,
                    'name', v_existing.name,
                    'location', v_existing.location,
                    'isDefault', v_existing.is_default,
                    'status', v_existing.status,
                    'version', v_existing.version,
                    'createdAt', v_existing.created_at,
                    'updatedAt', v_existing.updated_at,
                    'createdBy', v_existing.created_by,
                    'operationKey', v_existing.operation_key,
                    'isReplay', true
                ) INTO v_result;
                RETURN v_result;
            ELSE
                RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: کلید عملیات با اثرانگشت متفاوت قبلاً ثبت شده است.';
            END IF;
        END IF;
    END IF;

    -- 4. Code Generation / Validation
    IF p_code IS NOT NULL AND trim(p_code) <> '' THEN
        v_assigned_code := trim(p_code);
        IF EXISTS (
            SELECT 1 FROM public.warehouses
            WHERE organization_id = p_organization_id AND code = v_assigned_code
        ) THEN
            RAISE EXCEPTION 'ERR_DUPLICATE_WAREHOUSE_CODE: کد انبار "%" قبلاً در این سازمان ثبت شده است.', v_assigned_code;
        END IF;
    ELSE
        -- Ensure sequence row exists
        INSERT INTO public.warehouse_code_sequences (organization_id, prefix, next_number, updated_by)
        VALUES (p_organization_id, 'WH-', 1, p_created_by)
        ON CONFLICT (organization_id) DO NOTHING;

        -- Lock sequence row for atomic advancement
        SELECT prefix, next_number INTO v_seq_prefix, v_seq_next
        FROM public.warehouse_code_sequences
        WHERE organization_id = p_organization_id
        FOR UPDATE;

        LOOP
            v_assigned_code := COALESCE(v_seq_prefix, 'WH-') || lpad(COALESCE(v_seq_next, 1)::text, 3, '0');
            IF NOT EXISTS (
                SELECT 1 FROM public.warehouses
                WHERE organization_id = p_organization_id AND code = v_assigned_code
            ) THEN
                EXIT;
            END IF;
            v_seq_next := v_seq_next + 1;
        END LOOP;

        UPDATE public.warehouse_code_sequences
        SET next_number = v_seq_next + 1,
            updated_at = now(),
            updated_by = p_created_by
        WHERE organization_id = p_organization_id;
    END IF;

    -- 5. Default Warehouse Handling per Branch
    -- Check how many active warehouses exist in this branch
    SELECT count(*) INTO v_active_warehouses_in_branch
    FROM public.warehouses
    WHERE organization_id = p_organization_id AND branch_id = v_branch_id AND status = 'ACTIVE';

    -- If this is the first active warehouse in the branch, make it default automatically
    IF v_active_warehouses_in_branch = 0 AND v_status = 'ACTIVE' THEN
        v_is_default := true;
    END IF;

    IF v_is_default = true AND v_status = 'ACTIVE' THEN
        -- Lock existing warehouses in branch to avoid race conditions
        PERFORM id FROM public.warehouses
        WHERE organization_id = p_organization_id AND branch_id = v_branch_id
        FOR UPDATE;

        -- Atomically clear previous default warehouse in the branch
        UPDATE public.warehouses
        SET is_default = false,
            updated_at = now()
        WHERE organization_id = p_organization_id
          AND branch_id = v_branch_id
          AND is_default = true;
    END IF;

    -- 6. Insert Warehouse Record
    INSERT INTO public.warehouses (
        organization_id,
        branch_id,
        code,
        name,
        location,
        is_default,
        status,
        version,
        created_by,
        operation_key,
        request_fingerprint,
        created_at,
        updated_at
    ) VALUES (
        p_organization_id,
        v_branch_id,
        v_assigned_code,
        trim(p_name),
        p_location,
        v_is_default,
        v_status,
        1,
        p_created_by,
        p_operation_key,
        p_request_fingerprint,
        now(),
        now()
    )
    RETURNING * INTO v_new_wh;

    -- 7. Build Output JSON
    SELECT jsonb_build_object(
        'id', v_new_wh.id,
        'organizationId', v_new_wh.organization_id,
        'branchId', v_new_wh.branch_id,
        'branchName', v_branch.name,
        'branchCode', v_branch.code,
        'code', v_new_wh.code,
        'name', v_new_wh.name,
        'location', v_new_wh.location,
        'isDefault', v_new_wh.is_default,
        'status', v_new_wh.status,
        'version', v_new_wh.version,
        'createdAt', v_new_wh.created_at,
        'updatedAt', v_new_wh.updated_at,
        'createdBy', v_new_wh.created_by,
        'operationKey', v_new_wh.operation_key,
        'isReplay', false
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 6. Atomic Warehouse Update Function with Optimistic Concurrency
CREATE OR REPLACE FUNCTION public.update_warehouse_atomic(
    p_organization_id UUID,
    p_warehouse_id UUID,
    p_name TEXT,
    p_location TEXT DEFAULT NULL,
    p_code TEXT DEFAULT NULL,
    p_branch_id UUID DEFAULT NULL,
    p_expected_version INT DEFAULT NULL,
    p_updated_by UUID DEFAULT NULL,
    p_operation_key TEXT DEFAULT NULL,
    p_request_fingerprint TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_existing RECORD;
    v_branch RECORD;
    v_branch_id UUID;
    v_assigned_code TEXT;
    v_updated RECORD;
    v_result JSONB;
BEGIN
    -- 1. Parameter Validation
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_ORGANIZATION: شناسه سازمان الزامی است.';
    END IF;

    IF p_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_WAREHOUSE_ID: شناسه انبار الزامی است.';
    END IF;

    IF p_name IS NULL OR trim(p_name) = '' THEN
        RAISE EXCEPTION 'ERR_INVALID_WAREHOUSE_NAME: نام انبار نمی‌تواند خالی باشد.';
    END IF;

    -- 2. Lock Warehouse Row FOR UPDATE
    SELECT * INTO v_existing
    FROM public.warehouses
    WHERE id = p_warehouse_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_WAREHOUSE_NOT_FOUND: انبار مورد نظر یافت نشد.';
    END IF;

    -- 3. Idempotency Check
    IF p_operation_key IS NOT NULL AND trim(p_operation_key) <> '' THEN
        IF v_existing.operation_key = p_operation_key THEN
            IF v_existing.request_fingerprint = p_request_fingerprint THEN
                SELECT w.*, b.name AS branch_name, b.code AS branch_code
                INTO v_existing
                FROM public.warehouses w
                LEFT JOIN public.branches b ON b.id = w.branch_id
                WHERE w.id = p_warehouse_id;

                SELECT jsonb_build_object(
                    'id', v_existing.id,
                    'organizationId', v_existing.organization_id,
                    'branchId', v_existing.branch_id,
                    'branchName', v_existing.branch_name,
                    'branchCode', v_existing.branch_code,
                    'code', v_existing.code,
                    'name', v_existing.name,
                    'location', v_existing.location,
                    'isDefault', v_existing.is_default,
                    'status', v_existing.status,
                    'version', v_existing.version,
                    'createdAt', v_existing.created_at,
                    'updatedAt', v_existing.updated_at,
                    'createdBy', v_existing.created_by,
                    'operationKey', v_existing.operation_key,
                    'isReplay', true
                ) INTO v_result;
                RETURN v_result;
            ELSE
                RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: کلید عملیات با اثرانگشت متفاوت قبلاً ثبت شده است.';
            END IF;
        END IF;
    END IF;

    -- 4. Optimistic Concurrency Check
    IF p_expected_version IS NOT NULL AND v_existing.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_CONCURRENCY_CONFLICT: نسخه اطلاعات انبار قدیمی است (نسخه کنونی: %, نسخه ارسالی: %). لطفاً صفحه را تازه‌سازی کنید.', v_existing.version, p_expected_version;
    END IF;

    -- 5. Validate Code Uniqueness if Changed
    v_assigned_code := v_existing.code;
    IF p_code IS NOT NULL AND trim(p_code) <> '' AND trim(p_code) <> v_existing.code THEN
        v_assigned_code := trim(p_code);
        IF EXISTS (
            SELECT 1 FROM public.warehouses
            WHERE organization_id = p_organization_id AND code = v_assigned_code AND id <> p_warehouse_id
        ) THEN
            RAISE EXCEPTION 'ERR_DUPLICATE_WAREHOUSE_CODE: کد انبار "%" قبلاً در این سازمان ثبت شده است.', v_assigned_code;
        END IF;
    END IF;

    -- 6. Validate Branch if Changed
    v_branch_id := v_existing.branch_id;
    IF p_branch_id IS NOT NULL AND p_branch_id <> v_existing.branch_id THEN
        SELECT id, name, code INTO v_branch
        FROM public.branches
        WHERE id = p_branch_id AND organization_id = p_organization_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ERR_BRANCH_NOT_FOUND: شعبه جدید مشخص‌شده یافت نشد یا غیرفعال است.';
        END IF;
        v_branch_id := p_branch_id;
    ELSE
        SELECT id, name, code INTO v_branch
        FROM public.branches
        WHERE id = v_branch_id AND organization_id = p_organization_id;
    END IF;

    -- 7. Perform Update
    UPDATE public.warehouses
    SET name = trim(p_name),
        location = p_location,
        code = v_assigned_code,
        branch_id = v_branch_id,
        version = version + 1,
        operation_key = COALESCE(p_operation_key, operation_key),
        request_fingerprint = COALESCE(p_request_fingerprint, request_fingerprint),
        updated_at = now()
    WHERE id = p_warehouse_id AND organization_id = p_organization_id
    RETURNING * INTO v_updated;

    -- 8. Return JSON
    SELECT jsonb_build_object(
        'id', v_updated.id,
        'organizationId', v_updated.organization_id,
        'branchId', v_updated.branch_id,
        'branchName', v_branch.name,
        'branchCode', v_branch.code,
        'code', v_updated.code,
        'name', v_updated.name,
        'location', v_updated.location,
        'isDefault', v_updated.is_default,
        'status', v_updated.status,
        'version', v_updated.version,
        'createdAt', v_updated.created_at,
        'updatedAt', v_updated.updated_at,
        'createdBy', v_updated.created_by,
        'operationKey', v_updated.operation_key,
        'isReplay', false
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 7. Atomic Set Default Warehouse Function
CREATE OR REPLACE FUNCTION public.set_default_warehouse_atomic(
    p_organization_id UUID,
    p_warehouse_id UUID,
    p_updated_by UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_target RECORD;
    v_branch RECORD;
    v_updated RECORD;
    v_result JSONB;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_ORGANIZATION: شناسه سازمان الزامی است.';
    END IF;

    IF p_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_WAREHOUSE_ID: شناسه انبار الزامی است.';
    END IF;

    -- Lock target warehouse
    SELECT * INTO v_target
    FROM public.warehouses
    WHERE id = p_warehouse_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_WAREHOUSE_NOT_FOUND: انبار مورد نظر یافت نشد.';
    END IF;

    IF v_target.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'ERR_CANNOT_SET_INACTIVE_DEFAULT: انبار غیرفعال نمی‌تواند به عنوان انبار پیش‌فرض تعیین شود.';
    END IF;

    IF v_target.is_default = true THEN
        -- Already default, nothing to change
        SELECT id, name, code INTO v_branch FROM public.branches WHERE id = v_target.branch_id;
        SELECT jsonb_build_object(
            'id', v_target.id,
            'organizationId', v_target.organization_id,
            'branchId', v_target.branch_id,
            'branchName', v_branch.name,
            'code', v_target.code,
            'name', v_target.name,
            'location', v_target.location,
            'isDefault', v_target.is_default,
            'status', v_target.status,
            'version', v_target.version,
            'createdAt', v_target.created_at,
            'updatedAt', v_target.updated_at
        ) INTO v_result;
        RETURN v_result;
    END IF;

    -- Lock all warehouses in this branch to ensure atomic transition
    PERFORM id FROM public.warehouses
    WHERE organization_id = p_organization_id AND branch_id = v_target.branch_id
    FOR UPDATE;

    -- Unset previous default in this branch
    UPDATE public.warehouses
    SET is_default = false,
        updated_at = now()
    WHERE organization_id = p_organization_id
      AND branch_id = v_target.branch_id
      AND is_default = true;

    -- Set new default
    UPDATE public.warehouses
    SET is_default = true,
        version = version + 1,
        updated_at = now()
    WHERE id = p_warehouse_id AND organization_id = p_organization_id
    RETURNING * INTO v_updated;

    SELECT id, name, code INTO v_branch FROM public.branches WHERE id = v_updated.branch_id;

    SELECT jsonb_build_object(
        'id', v_updated.id,
        'organizationId', v_updated.organization_id,
        'branchId', v_updated.branch_id,
        'branchName', v_branch.name,
        'code', v_updated.code,
        'name', v_updated.name,
        'location', v_updated.location,
        'isDefault', v_updated.is_default,
        'status', v_updated.status,
        'version', v_updated.version,
        'createdAt', v_updated.created_at,
        'updatedAt', v_updated.updated_at
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 8. Atomic Warehouse Deactivation Function (Soft-Deactivation)
CREATE OR REPLACE FUNCTION public.deactivate_warehouse_atomic(
    p_organization_id UUID,
    p_warehouse_id UUID,
    p_replacement_default_warehouse_id UUID DEFAULT NULL,
    p_updated_by UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_target RECORD;
    v_replacement RECORD;
    v_other_active_count INT;
    v_updated RECORD;
    v_branch RECORD;
    v_result JSONB;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_ORGANIZATION: شناسه سازمان الزامی است.';
    END IF;

    IF p_warehouse_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_WAREHOUSE_ID: شناسه انبار الزامی است.';
    END IF;

    -- Lock target warehouse
    SELECT * INTO v_target
    FROM public.warehouses
    WHERE id = p_warehouse_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_WAREHOUSE_NOT_FOUND: انبار مورد نظر یافت نشد.';
    END IF;

    -- If warehouse is currently the default warehouse
    IF v_target.is_default = true THEN
        -- Check if replacement default warehouse is provided
        IF p_replacement_default_warehouse_id IS NOT NULL THEN
            IF p_replacement_default_warehouse_id = p_warehouse_id THEN
                RAISE EXCEPTION 'ERR_INVALID_REPLACEMENT_DEFAULT: انبار جایگزین نمی‌تواند همان انبار در حال غیرفعال‌سازی باشد.';
            END IF;

            SELECT * INTO v_replacement
            FROM public.warehouses
            WHERE id = p_replacement_default_warehouse_id
              AND organization_id = p_organization_id
              AND branch_id = v_target.branch_id
              AND status = 'ACTIVE'
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'ERR_INVALID_REPLACEMENT_DEFAULT: انبار جایگزین پیش‌فرض در این شعبه یافت نشد یا غیرفعال است.';
            END IF;

            -- Set replacement as default
            UPDATE public.warehouses
            SET is_default = true,
                version = version + 1,
                updated_at = now()
            WHERE id = p_replacement_default_warehouse_id;
        ELSE
            -- Check if any other active warehouse exists in this branch
            SELECT count(*) INTO v_other_active_count
            FROM public.warehouses
            WHERE organization_id = p_organization_id
              AND branch_id = v_target.branch_id
              AND id <> p_warehouse_id
              AND status = 'ACTIVE';

            IF v_other_active_count > 0 THEN
                RAISE EXCEPTION 'ERR_CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE: غیرفعال‌سازی انبار پیش‌فرض تا زمانی که انبار پیش‌فرض جایگزین تعیین نشده است مسدود می‌باشد.';
            END IF;
        END IF;
    END IF;

    -- Deactivate target warehouse
    UPDATE public.warehouses
    SET status = 'INACTIVE',
        is_default = false,
        version = version + 1,
        updated_at = now()
    WHERE id = p_warehouse_id AND organization_id = p_organization_id
    RETURNING * INTO v_updated;

    SELECT id, name, code INTO v_branch FROM public.branches WHERE id = v_updated.branch_id;

    SELECT jsonb_build_object(
        'id', v_updated.id,
        'organizationId', v_updated.organization_id,
        'branchId', v_updated.branch_id,
        'branchName', v_branch.name,
        'code', v_updated.code,
        'name', v_updated.name,
        'location', v_updated.location,
        'isDefault', v_updated.is_default,
        'status', v_updated.status,
        'version', v_updated.version,
        'createdAt', v_updated.created_at,
        'updatedAt', v_updated.updated_at,
        'deactivated', true
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 9. Grants
GRANT EXECUTE ON FUNCTION public.get_next_warehouse_code_atomic(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_warehouse_atomic(UUID, TEXT, TEXT, UUID, TEXT, BOOLEAN, TEXT, UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_warehouse_atomic(UUID, UUID, TEXT, TEXT, TEXT, UUID, INT, UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_default_warehouse_atomic(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_warehouse_atomic(UUID, UUID, UUID, UUID) TO authenticated, service_role;

COMMIT;
