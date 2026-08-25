BEGIN;

-- ==============================================================================
-- Migration: 27_agent_attributes_foundation.sql
-- Description: Agent / Representative attributes and fast lookup index on public.persons
-- ==============================================================================

ALTER TABLE public.persons 
  ADD COLUMN IF NOT EXISTS agency_role TEXT CHECK (agency_role IN ('credit', 'sales', 'both')),
  ADD COLUMN IF NOT EXISTS agency_status TEXT DEFAULT 'pending' CHECK (agency_status IN ('pending', 'active', 'suspended', 'rejected')),
  ADD COLUMN IF NOT EXISTS agency_credit_limit NUMERIC(18, 0) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agency_code TEXT;

CREATE INDEX IF NOT EXISTS idx_persons_agency_lookup 
  ON public.persons (organization_id, is_agent, agency_role, agency_status) 
  WHERE is_agent = true;

COMMIT;
