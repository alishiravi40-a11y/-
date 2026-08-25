-- Migration: 13_coa_backfill_full_conflict_hardening.sql
-- Description: Incremental Migration for Full COA Backfill Conflict Hardening
-- Scope: Validates ALL identity & structural properties (Group: code, name, nature, report_category; General: code, name, group_id; Subsidiary: code, name, general_id, requires_person, requires_cost_center) against existing system_key records. Any mismatch raises ERR_SYSTEM_KEY_CONFLICT and forces fail-closed rollback.

CREATE OR REPLACE FUNCTION fn_backfill_chart_of_accounts(
    p_organization_id UUID,
    p_payload JSONB
)
RETURNS TABLE (
    success BOOLEAN,
    inserted_groups INT,
    inserted_generals INT,
    inserted_subsidiaries INT,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inserted_groups INT := 0;
    v_inserted_generals INT := 0;
    v_inserted_subsidiaries INT := 0;
    
    v_group_rec RECORD;
    v_general_rec RECORD;
    v_sub_rec RECORD;
    
    v_group_id UUID;
    v_existing_group RECORD;
    
    v_general_id UUID;
    v_existing_general RECORD;
    
    v_existing_sub RECORD;
BEGIN
    -- 1. Validate Organization ID and Payload
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'ERR_ORG_ID_REQUIRED: Organization ID must not be null.';
    END IF;

    IF p_payload IS NULL OR jsonb_typeof(p_payload) != 'array' OR jsonb_array_length(p_payload) = 0 THEN
        RAISE EXCEPTION 'ERR_EMPTY_PAYLOAD: Payload must be a non-empty JSON array.';
    END IF;

    -- 2. Process Groups (Level 1)
    FOR v_group_rec IN 
        SELECT DISTINCT 
            (elem->>'group_code')::VARCHAR AS group_code,
            (elem->>'group_name')::VARCHAR AS group_name,
            (elem->>'group_nature')::VARCHAR AS group_nature,
            (elem->>'group_report_category')::VARCHAR AS group_report_category,
            (elem->>'group_system_key')::VARCHAR AS group_system_key
        FROM jsonb_array_elements(p_payload) AS elem
    LOOP
        IF v_group_rec.group_system_key IS NULL OR v_group_rec.group_code IS NULL OR v_group_rec.group_name IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_GROUP_PAYLOAD: Group code, name, and system_key are required.';
        END IF;

        -- Check if group system_key exists for this organization
        SELECT id, code, name, nature, report_category INTO v_existing_group
        FROM account_groups
        WHERE organization_id = p_organization_id AND system_key = v_group_rec.group_system_key;

        IF v_existing_group.id IS NOT NULL THEN
            -- CONFLICT DETECTION: Validate ALL Group properties
            IF v_existing_group.code != v_group_rec.group_code THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Group system_key % exists with code %, payload has %',
                    v_group_rec.group_system_key, v_existing_group.code, v_group_rec.group_code;
            END IF;
            IF v_existing_group.name != v_group_rec.group_name THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Group system_key % exists with name %, payload has %',
                    v_group_rec.group_system_key, v_existing_group.name, v_group_rec.group_name;
            END IF;
            IF v_existing_group.nature != v_group_rec.group_nature THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Group system_key % exists with nature %, payload has %',
                    v_group_rec.group_system_key, v_existing_group.nature, v_group_rec.group_nature;
            END IF;
            IF v_existing_group.report_category != v_group_rec.group_report_category THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Group system_key % exists with report_category %, payload has %',
                    v_group_rec.group_system_key, v_existing_group.report_category, v_group_rec.group_report_category;
            END IF;
        ELSE
            INSERT INTO account_groups (
                organization_id,
                code,
                name,
                nature,
                report_category,
                system_key,
                is_active,
                is_system
            ) VALUES (
                p_organization_id,
                v_group_rec.group_code,
                v_group_rec.group_name,
                v_group_rec.group_nature,
                v_group_rec.group_report_category,
                v_group_rec.group_system_key,
                TRUE,
                TRUE
            );
            v_inserted_groups := v_inserted_groups + 1;
        END IF;
    END LOOP;

    -- 3. Process Generals (Level 2)
    FOR v_general_rec IN 
        SELECT DISTINCT 
            (elem->>'general_code')::VARCHAR AS general_code,
            (elem->>'general_name')::VARCHAR AS general_name,
            (elem->>'general_system_key')::VARCHAR AS general_system_key,
            (elem->>'group_system_key')::VARCHAR AS group_system_key
        FROM jsonb_array_elements(p_payload) AS elem
    LOOP
        IF v_general_rec.general_system_key IS NULL OR v_general_rec.general_code IS NULL OR v_general_rec.general_name IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_GENERAL_PAYLOAD: General code, name, and system_key are required.';
        END IF;

        -- Fetch parent group ID
        SELECT id INTO v_group_id
        FROM account_groups
        WHERE organization_id = p_organization_id AND system_key = v_general_rec.group_system_key;

        IF v_group_id IS NULL THEN
            RAISE EXCEPTION 'ERR_PARENT_GROUP_NOT_FOUND: Group system_key % not found for General %', 
                v_general_rec.group_system_key, v_general_rec.general_name;
        END IF;

        -- Check if general system_key exists
        SELECT id, code, name, group_id INTO v_existing_general
        FROM account_generals
        WHERE organization_id = p_organization_id AND system_key = v_general_rec.general_system_key;

        IF v_existing_general.id IS NOT NULL THEN
            -- CONFLICT DETECTION: Validate ALL General properties
            IF v_existing_general.code != v_general_rec.general_code THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: General system_key % exists with code %, payload has %',
                    v_general_rec.general_system_key, v_existing_general.code, v_general_rec.general_code;
            END IF;
            IF v_existing_general.name != v_general_rec.general_name THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: General system_key % exists with name %, payload has %',
                    v_general_rec.general_system_key, v_existing_general.name, v_general_rec.general_name;
            END IF;
            IF v_existing_general.group_id != v_group_id THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: General system_key % exists under different parent group',
                    v_general_rec.general_system_key;
            END IF;
        ELSE
            INSERT INTO account_generals (
                organization_id,
                group_id,
                code,
                name,
                system_key,
                is_active,
                is_system
            ) VALUES (
                p_organization_id,
                v_group_id,
                v_general_rec.general_code,
                v_general_rec.general_name,
                v_general_rec.general_system_key,
                TRUE,
                TRUE
            );
            v_inserted_generals := v_inserted_generals + 1;
        END IF;
    END LOOP;

    -- 4. Process Subsidiaries (Level 3)
    FOR v_sub_rec IN 
        SELECT 
            (elem->>'sub_code')::VARCHAR AS sub_code,
            (elem->>'sub_name')::VARCHAR AS sub_name,
            (elem->>'sub_system_key')::VARCHAR AS sub_system_key,
            (elem->>'general_system_key')::VARCHAR AS general_system_key,
            COALESCE((elem->>'requires_person')::BOOLEAN, FALSE) AS requires_person,
            COALESCE((elem->>'requires_cost_center')::BOOLEAN, FALSE) AS requires_cost_center
        FROM jsonb_array_elements(p_payload) AS elem
    LOOP
        IF v_sub_rec.sub_system_key IS NULL OR v_sub_rec.sub_code IS NULL OR v_sub_rec.sub_name IS NULL THEN
            RAISE EXCEPTION 'ERR_INVALID_SUB_PAYLOAD: Subsidiary code, name and system_key are required.';
        END IF;

        -- Fetch parent general ID
        SELECT id INTO v_general_id
        FROM account_generals
        WHERE organization_id = p_organization_id AND system_key = v_sub_rec.general_system_key;

        IF v_general_id IS NULL THEN
            RAISE EXCEPTION 'ERR_PARENT_GENERAL_NOT_FOUND: General system_key % not found for Sub %', 
                v_sub_rec.general_system_key, v_sub_rec.sub_name;
        END IF;

        -- Check if subsidiary exists
        SELECT id, code, name, general_id, requires_person, requires_cost_center INTO v_existing_sub
        FROM account_subsidiaries 
        WHERE organization_id = p_organization_id AND system_key = v_sub_rec.sub_system_key;

        IF v_existing_sub.id IS NOT NULL THEN
            -- CONFLICT DETECTION: Validate ALL Subsidiary properties
            IF v_existing_sub.code != v_sub_rec.sub_code THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists with code %, payload has %',
                    v_sub_rec.sub_system_key, v_existing_sub.code, v_sub_rec.sub_code;
            END IF;
            IF v_existing_sub.name != v_sub_rec.sub_name THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists with name %, payload has %',
                    v_sub_rec.sub_system_key, v_existing_sub.name, v_sub_rec.sub_name;
            END IF;
            IF v_existing_sub.general_id != v_general_id THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists under different parent general',
                    v_sub_rec.sub_system_key;
            END IF;
            IF v_existing_sub.requires_person != v_sub_rec.requires_person THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists with requires_person %, payload has %',
                    v_sub_rec.sub_system_key, v_existing_sub.requires_person, v_sub_rec.requires_person;
            END IF;
            IF v_existing_sub.requires_cost_center != v_sub_rec.requires_cost_center THEN
                RAISE EXCEPTION 'ERR_SYSTEM_KEY_CONFLICT: Subsidiary system_key % exists with requires_cost_center %, payload has %',
                    v_sub_rec.sub_system_key, v_existing_sub.requires_cost_center, v_sub_rec.requires_cost_center;
            END IF;
        ELSE
            INSERT INTO account_subsidiaries (
                organization_id,
                general_id,
                code,
                name,
                system_key,
                requires_person,
                requires_cost_center,
                is_active,
                is_system
            ) VALUES (
                p_organization_id,
                v_general_id,
                v_sub_rec.sub_code,
                v_sub_rec.sub_name,
                v_sub_rec.sub_system_key,
                v_sub_rec.requires_person,
                v_sub_rec.requires_cost_center,
                TRUE,
                v_sub_rec.sub_system_key LIKE 'SUB_%'
            );
            v_inserted_subsidiaries := v_inserted_subsidiaries + 1;
        END IF;
    END LOOP;

    RETURN QUERY
    SELECT TRUE, v_inserted_groups, v_inserted_generals, v_inserted_subsidiaries, 'SUCCESS'::TEXT;
END;
$$;

-- Permissions setup
REVOKE ALL ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION fn_backfill_chart_of_accounts(UUID, JSONB) TO service_role;
