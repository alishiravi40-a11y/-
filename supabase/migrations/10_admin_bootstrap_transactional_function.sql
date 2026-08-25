-- ==============================================================================
-- Migration: 10_admin_bootstrap_transactional_function.sql
-- Description: Atomic PostgreSQL function to bootstrap the first org_admin user domain data.
-- ==============================================================================

BEGIN;

-- Drop legacy overload if it exists to prevent orphan function signatures
DROP FUNCTION IF EXISTS public.bootstrap_first_org_admin(UUID, TEXT, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.bootstrap_first_org_admin(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.bootstrap_first_org_admin(
    p_user_id UUID,
    p_full_name TEXT,
    p_mobile TEXT,
    p_org_name TEXT DEFAULT NULL,
    p_branch_code TEXT DEFAULT 'MAIN',
    p_branch_name TEXT DEFAULT 'شعبه مرکزی',
    p_fiscal_year_title TEXT DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL,
    p_organization_id UUID DEFAULT NULL,
    p_branch_id UUID DEFAULT NULL,
    p_fiscal_year_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $function$
DECLARE
    v_role_id UUID;
    v_membership_id UUID;
    v_existing_admin_count INT;
    v_org_exists BOOLEAN;
    v_branch_exists BOOLEAN;
BEGIN
    -- 0. Acquire Transaction-Scoped Advisory Lock to serialize concurrent bootstrap requests
    PERFORM pg_advisory_xact_lock(hashtext('bootstrap_first_org_admin'));

    -- 1. Check if any org_admin user already exists in user_roles
    SELECT COUNT(*) INTO v_existing_admin_count
    FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE r.code = 'org_admin';

    IF v_existing_admin_count > 0 THEN
        RAISE EXCEPTION 'BOOTSTRAP_ALREADY_COMPLETED: An org_admin user already exists in the system.'
            USING ERRCODE = 'P0001';
    END IF;

    -- 2. Lookup org_admin role ID
    SELECT id INTO v_role_id
    FROM public.roles
    WHERE code = 'org_admin';

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'ROLE_NOT_FOUND: The org_admin role is not defined in public.roles.'
            USING ERRCODE = 'P0002';
    END IF;

    -- 3. Resolve or Create Organization
    IF p_organization_id IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM public.organizations WHERE id = p_organization_id) INTO v_org_exists;
        IF NOT v_org_exists THEN
            RAISE EXCEPTION 'INVALID_ORGANIZATION: Organization % does not exist.', p_organization_id
                USING ERRCODE = 'P0003';
        END IF;
    ELSIF p_org_name IS NOT NULL AND trim(p_org_name) <> '' THEN
        INSERT INTO public.organizations (
            name,
            is_active,
            created_at,
            updated_at
        ) VALUES (
            trim(p_org_name),
            true,
            now(),
            now()
        )
        RETURNING id INTO p_organization_id;
    ELSE
        RAISE EXCEPTION 'ORGANIZATION_REQUIRED: Either p_organization_id or p_org_name must be provided.'
            USING ERRCODE = 'P0003';
    END IF;

    -- 4. Resolve or Create Branch
    IF p_branch_id IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM public.branches WHERE id = p_branch_id AND organization_id = p_organization_id) INTO v_branch_exists;
        IF NOT v_branch_exists THEN
            RAISE EXCEPTION 'INVALID_BRANCH: Branch % does not exist for organization %.', p_branch_id, p_organization_id
                USING ERRCODE = 'P0004';
        END IF;
    ELSE
        INSERT INTO public.branches (
            organization_id,
            code,
            name,
            is_active,
            created_at,
            updated_at
        ) VALUES (
            p_organization_id,
            COALESCE(NULLIF(trim(p_branch_code), ''), 'MAIN'),
            COALESCE(NULLIF(trim(p_branch_name), ''), 'شعبه مرکزی'),
            true,
            now(),
            now()
        )
        ON CONFLICT (organization_id, code) DO UPDATE SET
            name = EXCLUDED.name,
            is_active = true,
            updated_at = now()
        RETURNING id INTO p_branch_id;
    END IF;

    -- 5. Upsert User Profile
    INSERT INTO public.user_profiles (
        id,
        full_name,
        mobile,
        is_active,
        require_2fa,
        created_at,
        updated_at
    ) VALUES (
        p_user_id,
        trim(p_full_name),
        trim(p_mobile),
        true,
        true, -- Force 2FA (AAL2) requirement for org_admin
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        mobile = EXCLUDED.mobile,
        require_2fa = true,
        updated_at = now();

    -- 6. Insert Organization Membership
    INSERT INTO public.organization_memberships (
        user_id,
        organization_id,
        default_branch_id,
        is_active,
        is_default,
        joined_at,
        created_at,
        updated_at
    ) VALUES (
        p_user_id,
        p_organization_id,
        p_branch_id,
        true,
        true,
        now(),
        now(),
        now()
    )
    ON CONFLICT (user_id, organization_id) DO UPDATE SET
        default_branch_id = EXCLUDED.default_branch_id,
        is_active = true,
        is_default = true,
        updated_at = now()
    RETURNING id INTO v_membership_id;

    -- 7. Insert Branch Access (Uses membership_id, organization_id, branch_id)
    INSERT INTO public.user_branch_access (
        membership_id,
        organization_id,
        branch_id,
        is_active,
        created_at,
        updated_at
    ) VALUES (
        v_membership_id,
        p_organization_id,
        p_branch_id,
        true,
        now(),
        now()
    )
    ON CONFLICT (membership_id, branch_id) DO UPDATE SET
        is_active = true,
        updated_at = now();

    -- 8. Insert User Role (org_admin with membership_id, granted_by, branch_id)
    INSERT INTO public.user_roles (
        membership_id,
        user_id,
        organization_id,
        role_id,
        branch_id,
        granted_by,
        created_at
    ) VALUES (
        v_membership_id,
        p_user_id,
        p_organization_id,
        v_role_id,
        p_branch_id,
        p_user_id,
        now()
    )
    ON CONFLICT (membership_id, role_id, branch_id) DO NOTHING;

    -- 9. Insert Security Audit Log
    INSERT INTO public.security_audit_logs (
        organization_id,
        user_id,
        event_type,
        details,
        created_at
    ) VALUES (
        p_organization_id,
        p_user_id,
        'SYSTEM_BOOTSTRAP_ADMIN',
        jsonb_build_object(
            'full_name', p_full_name,
            'mobile', p_mobile,
            'organization_id', p_organization_id,
            'branch_id', p_branch_id,
            'membership_id', v_membership_id,
            'role', 'org_admin'
        ),
        now()
    );

    RETURN v_membership_id;
END;
$function$;

-- Security Hardening: Revoke execution from public, anon, and authenticated roles
REVOKE ALL ON FUNCTION public.bootstrap_first_org_admin(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;

-- Grant execution strictly to service_role (server-side Admin SDK only)
GRANT EXECUTE ON FUNCTION public.bootstrap_first_org_admin(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, UUID, UUID, UUID
) TO service_role;

COMMENT ON FUNCTION public.bootstrap_first_org_admin IS 'Atomically initializes the initial organization, root branch, user profile, organization membership, user-branch access, and grants org_admin role. Callable once via service_role only.';

COMMIT;
