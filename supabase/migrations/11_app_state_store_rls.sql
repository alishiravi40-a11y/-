BEGIN;

-- ==============================================================================
-- Migration: 11_app_state_store_rls.sql (Strict Server-Only Enforcement)
-- Description: Complete lockdown of public.app_state_store for direct client access.
--              Only server-side requests using service_role (which bypasses RLS)
--              can read or write to this legacy global state table.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.app_state_store (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT
);

-- Enable Row Level Security
ALTER TABLE public.app_state_store ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to ensure a clean state
DROP POLICY IF EXISTS "Allow anon access to app_state_store" ON public.app_state_store;
DROP POLICY IF EXISTS "Allow authenticated full access to app_state_store" ON public.app_state_store;
DROP POLICY IF EXISTS "Active org members can view app_state_store" ON public.app_state_store;
DROP POLICY IF EXISTS "Active org admins can manage app_state_store" ON public.app_state_store;

-- STRICT LOCKDOWN: No client roles (anon or authenticated) have SELECT, INSERT, UPDATE, or DELETE access.
-- By having RLS enabled with NO policies for anon or authenticated roles, Supabase blocks all direct client requests.
-- Only server-side operations using the 'service_role' key (which bypasses RLS by design in Supabase) 
-- will be able to query and update public.app_state_store through protected Express API endpoints.

COMMIT;
