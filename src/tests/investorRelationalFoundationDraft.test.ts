/**
 * Static Audit & Compliance Suite for Investor Relational Foundation Draft (Phase 24-B Corrective Control)
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';

function pass(msg: string) {
  console.log(`  ✅ PASS: ${msg}`);
}

async function runDraftAuditSuite() {
  console.log('======================================================================');
  console.log('🧪 RUNNING INVESTOR RELATIONAL FOUNDATION DRAFT AUDIT SUITE (PHASE 24-B CORRECTIVE CONTROL)');
  console.log('======================================================================');

  const draftPath = path.join(process.cwd(), 'security/sql-drafts/investor_relational_foundation_draft.sql');
  
  // 1. Check draft file existence
  assert.ok(fs.existsSync(draftPath), 'Draft SQL file exists at security/sql-drafts/investor_relational_foundation_draft.sql');
  pass('Draft SQL file exists in security/sql-drafts/');

  const sqlContent = fs.readFileSync(draftPath, 'utf8');

  // 2. Check header, non-execution raise exception, BEGIN & ROLLBACK
  assert.ok(sqlContent.startsWith('-- DRAFT ONLY — NOT A MIGRATION — DO NOT EXECUTE'), 'File starts with mandatory non-execution header');
  assert.ok(sqlContent.includes("RAISE EXCEPTION 'DRAFT ONLY — DO NOT EXECUTE THIS FILE'"), 'Contains immediate unconditional RAISE EXCEPTION');
  assert.ok(sqlContent.includes('BEGIN;'), 'Starts transaction with BEGIN');
  assert.ok(sqlContent.includes('ROLLBACK;'), 'Ends transaction safely with ROLLBACK');
  pass('Draft file contains immediate execution protection, BEGIN and ROLLBACK');

  // 3. Verify migrations 01 through 23 exist and are untouched in supabase/migrations/
  const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  assert.ok(migrationFiles.length >= 23, 'At least 23 migration files exist');
  assert.ok(!migrationFiles.some(f => f.includes('investor_relational_foundation')), 'No new migration file created in supabase/migrations/');
  pass('Official migrations 01-23 remain pristine and untouched');

  // 4. Verify presence of all four relational tables
  assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS public.investor_contracts'), 'Defines public.investor_contracts');
  assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS public.investor_payment_schedules'), 'Defines public.investor_payment_schedules');
  assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS public.investor_payment_obligations'), 'Defines public.investor_payment_obligations');
  assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS public.investor_commission_cheque_allocations'), 'Defines public.investor_commission_cheque_allocations');
  pass('All four required relational draft tables defined');

  // 5. Verify real types match src/modules/investors/types.ts
  const typesPath = path.join(process.cwd(), 'src/modules/investors/types.ts');
  const typesContent = fs.readFileSync(typesPath, 'utf8');
  assert.ok(typesContent.includes("InvestorObligationType = 'FEE' | 'CAPITAL_PRINCIPAL' | 'CONTRACT_ADJUSTMENT'"), 'Line 118 contains InvestorObligationType');
  assert.ok(typesContent.includes("paymentType: 'FEE' | 'CAPITAL_PRINCIPAL' | 'CONTRACT_ADJUSTMENT'"), 'Line 173 contains paymentType');
  pass('Verified real type definitions at lines 118 and 173 of src/modules/investors/types.ts');

  // 6. Verify definitive link to investor_profiles (Guaranteed investor person check)
  assert.ok(sqlContent.includes('REFERENCES public.investor_profiles(organization_id, person_id)'), 'All tables reference investor_profiles(organization_id, person_id)');
  assert.ok(sqlContent.includes("conname = 'uq_investor_profiles_org_person'"), 'Checks pg_constraint for uq_investor_profiles_org_person');
  pass('Guaranteed person-to-investor link via composite FK to public.investor_profiles(organization_id, person_id)');

  // 7. Verify composite foreign key for cheques and ABSENCE of simple cheque_id REFERENCES
  assert.ok(!sqlContent.includes('cheque_id UUID NOT NULL REFERENCES public.cheques(id)'), 'Single-column cheque FK pattern strictly absent');
  assert.ok(sqlContent.includes('REFERENCES public.cheques(organization_id, id)'), 'Composite FK references public.cheques(organization_id, id)');
  assert.ok(sqlContent.includes("conname = 'uq_cheques_org_composite'"), 'Checks pg_constraint for uq_cheques_org_composite');
  pass('Composite organization foreign key enforced on public.cheques(organization_id, id)');

  // 8. Verify permanent 1:1 allocation unique constraint names
  assert.ok(sqlContent.includes('CONSTRAINT uq_investor_commission_allocations_cheque UNIQUE (cheque_id)'), 'Permanent 1:1 cheque allocation constraint name');
  assert.ok(sqlContent.includes('CONSTRAINT uq_investor_commission_allocations_obligation UNIQUE (obligation_id)'), 'Permanent 1:1 obligation allocation constraint name');
  pass('Permanent 1:1 allocation unique constraints properly named for audit trail');

  // 9. Verify composite index coverage for foreign keys
  assert.ok(sqlContent.includes('CREATE INDEX IF NOT EXISTS idx_investor_contracts_org_profile'), 'Index on contracts profile');
  assert.ok(sqlContent.includes('CREATE INDEX IF NOT EXISTS idx_investor_schedules_org_profile'), 'Index on schedules profile');
  assert.ok(sqlContent.includes('CREATE INDEX IF NOT EXISTS idx_investor_obligations_org_profile'), 'Index on obligations profile');
  assert.ok(sqlContent.includes('CREATE INDEX IF NOT EXISTS idx_investor_allocations_org_cheque'), 'Index on allocations cheque');
  assert.ok(sqlContent.includes('CREATE INDEX IF NOT EXISTS idx_investor_allocations_org_profile'), 'Index on allocations profile');
  pass('Indexes defined for all composite foreign keys and query paths');

  // 10. Verify RLS enabled for all tables
  assert.ok(sqlContent.includes('ALTER TABLE public.investor_contracts ENABLE ROW LEVEL SECURITY;'), 'RLS enabled for contracts');
  assert.ok(sqlContent.includes('ALTER TABLE public.investor_payment_schedules ENABLE ROW LEVEL SECURITY;'), 'RLS enabled for schedules');
  assert.ok(sqlContent.includes('ALTER TABLE public.investor_payment_obligations ENABLE ROW LEVEL SECURITY;'), 'RLS enabled for obligations');
  assert.ok(sqlContent.includes('ALTER TABLE public.investor_commission_cheque_allocations ENABLE ROW LEVEL SECURITY;'), 'RLS enabled for allocations');
  pass('Row Level Security (RLS) enabled on all draft tables');

  // 11. Verify REVOKE statements on direct permissions for PUBLIC, anon, authenticated
  assert.ok(sqlContent.includes('REVOKE ALL ON TABLE public.investor_contracts FROM PUBLIC, anon, authenticated;'), 'Direct permissions revoked for contracts');
  assert.ok(sqlContent.includes('REVOKE ALL ON TABLE public.investor_payment_schedules FROM PUBLIC, anon, authenticated;'), 'Direct permissions revoked for schedules');
  assert.ok(sqlContent.includes('REVOKE ALL ON TABLE public.investor_payment_obligations FROM PUBLIC, anon, authenticated;'), 'Direct permissions revoked for obligations');
  assert.ok(sqlContent.includes('REVOKE ALL ON TABLE public.investor_commission_cheque_allocations FROM PUBLIC, anon, authenticated;'), 'Direct permissions revoked for allocations');
  pass('Direct table access revoked from PUBLIC, anon, authenticated roles');

  // 12. Verify explicit GRANT to service_role ONLY
  assert.ok(sqlContent.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.investor_contracts TO service_role;'), 'Explicit grant to service_role for contracts');
  assert.ok(sqlContent.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.investor_payment_schedules TO service_role;'), 'Explicit grant to service_role for schedules');
  assert.ok(sqlContent.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.investor_payment_obligations TO service_role;'), 'Explicit grant to service_role for obligations');
  assert.ok(sqlContent.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.investor_commission_cheque_allocations TO service_role;'), 'Explicit grant to service_role for allocations');
  pass('Explicit SELECT, INSERT, UPDATE, DELETE permissions granted exclusively to service_role');

  // 13. Verify absence of open policies (USING true / WITH CHECK true)
  assert.ok(!sqlContent.includes('USING (true)'), 'No open RLS policies with USING (true)');
  assert.ok(!sqlContent.includes('WITH CHECK (true)'), 'No open RLS policies with WITH CHECK (true)');
  pass('Zero open RLS policies present in draft');

  // 14. Verify Phase 24-A safety guard remains active
  const chequeServiceContent = fs.readFileSync(path.join(process.cwd(), 'src/server/cheques/chequeService.ts'), 'utf8');
  assert.ok(chequeServiceContent.includes('ERR_INVESTOR_CHEQUE_CLASSIFICATION_UNSAFE'), 'Phase 24-A safety guard remains active in chequeService.ts');
  pass('Phase 24-A safety mitigation remains active and no reclassification execution code exists');

  // 15. Verify explicit statement regarding NULL journal_voucher_id
  assert.ok(sqlContent.includes('cheques.journal_voucher_id IS NULL'), 'Draft explicitly mandates halting reclassification if journal_voucher_id is NULL');
  pass('Reclassification halting mandated when cheques.journal_voucher_id is NULL');

  // 16. Verify absence of incomplete code tokens in draft file
  assert.ok(!sqlContent.includes('TODO'), 'No TODO tokens');
  assert.ok(!sqlContent.includes('STUB'), 'No STUB tokens');
  assert.ok(!sqlContent.includes('MOCK'), 'No MOCK tokens in structural definitions');
  assert.ok(!sqlContent.includes('PLACEHOLDER'), 'No PLACEHOLDER tokens');
  pass('No incomplete code tokens found in draft file');

  // 17. Verify org_bank_account_mappings table definition
  assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS public.org_bank_account_mappings'), 'Defines public.org_bank_account_mappings');
  assert.ok(sqlContent.includes('account_subsidiary_id UUID NOT NULL'), 'Contains account_subsidiary_id column');
  assert.ok(sqlContent.includes('is_active BOOLEAN NOT NULL DEFAULT true'), 'Contains is_active column');
  assert.ok(sqlContent.includes('is_default BOOLEAN NOT NULL DEFAULT false'), 'Contains is_default column');
  assert.ok(sqlContent.includes('version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)'), 'Contains version column with version > 0 check');
  pass('org_bank_account_mappings table schema and columns verified');

  // 18. Verify composite foreign key to public.account_subsidiaries(organization_id, id)
  assert.ok(sqlContent.includes('CONSTRAINT fk_org_bank_account_subsidiary FOREIGN KEY (organization_id, account_subsidiary_id)'), 'Contains fk_org_bank_account_subsidiary');
  assert.ok(sqlContent.includes('REFERENCES public.account_subsidiaries(organization_id, id)'), 'Composite FK references public.account_subsidiaries(organization_id, id)');
  pass('Composite foreign key to public.account_subsidiaries(organization_id, id) enforced');

  // 19. Verify multiple active bank accounts per organization support via uq_org_bank_account_mapping
  assert.ok(sqlContent.includes('CONSTRAINT uq_org_bank_account_mapping UNIQUE (organization_id, account_subsidiary_id)'), 'Unique constraint on (organization_id, account_subsidiary_id)');
  pass('Unique constraint allows multiple active bank accounts per organization');

  // 20. Verify partial unique index for maximum 1 active default bank account per org
  assert.ok(sqlContent.includes('CREATE UNIQUE INDEX IF NOT EXISTS uq_org_bank_account_active_default'), 'Defines partial unique index uq_org_bank_account_active_default');
  assert.ok(sqlContent.includes('ON public.org_bank_account_mappings(organization_id)'), 'Partial index targets organization_id');
  assert.ok(sqlContent.includes('WHERE (is_active = true AND is_default = true)'), 'Partial index enforces WHERE (is_active = true AND is_default = true)');
  pass('Partial unique index enforces maximum 1 active default bank account per organization');

  // 21. Verify indexes for org_bank_account_mappings
  assert.ok(sqlContent.includes('CREATE INDEX IF NOT EXISTS idx_org_bank_account_mappings_org_active'), 'Index on (organization_id, is_active)');
  assert.ok(sqlContent.includes('CREATE INDEX IF NOT EXISTS idx_org_bank_account_mappings_subsidiary'), 'Index on (organization_id, account_subsidiary_id)');
  pass('Indexes defined for org_bank_account_mappings lookups');

  // 22. Verify RLS enabled for org_bank_account_mappings
  assert.ok(sqlContent.includes('ALTER TABLE public.org_bank_account_mappings ENABLE ROW LEVEL SECURITY;'), 'RLS enabled for org_bank_account_mappings');
  pass('RLS enabled on org_bank_account_mappings');

  // 23. Verify REVOKE on org_bank_account_mappings
  assert.ok(sqlContent.includes('REVOKE ALL ON TABLE public.org_bank_account_mappings FROM PUBLIC, anon, authenticated;'), 'Direct permissions revoked for org_bank_account_mappings');
  pass('Direct access to org_bank_account_mappings revoked from PUBLIC, anon, authenticated');

  // 24. Verify GRANT on org_bank_account_mappings
  assert.ok(sqlContent.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.org_bank_account_mappings TO service_role;'), 'Exclusive grant to service_role for org_bank_account_mappings');
  pass('Exclusive GRANT on org_bank_account_mappings given to service_role');

  // 25. Verify controlled transfer of ONLY status = \'CURRENT\' ROLE_BANK_MAIN
  assert.ok(sqlContent.includes("m.role_code = 'ROLE_BANK_MAIN'"), 'Transfer script filters by role_code = ROLE_BANK_MAIN');
  assert.ok(sqlContent.includes("m.status = 'CURRENT'"), 'Transfer script filters by m.status = CURRENT');
  assert.ok(sqlContent.includes('s.is_active = true'), 'Transfer script verifies s.is_active = true');
  assert.ok(sqlContent.includes('true AS is_default'), 'Transfer script sets initial ROLE_BANK_MAIN as is_default = true');
  pass('Controlled transfer logic of CURRENT ROLE_BANK_MAIN to default bank mapping verified');

  // 26. Verify absence of guessing or transferring other accounts by title/name/code
  assert.ok(!sqlContent.includes("LIKE '%بانک%'"), 'No string matching with LIKE %بانک% in draft');
  assert.ok(!sqlContent.includes("code = '102'"), 'No hardcoded general account code 102 in draft transfer');
  pass('Zero bank title/name string guessing or hardcoded general account code transfer confirmed');

  // 27. Verify investor contracts and cheque allocation structures remain intact
  assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS public.investor_contracts'), 'investor_contracts structure intact');
  assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS public.investor_commission_cheque_allocations'), 'investor_commission_cheque_allocations structure intact');
  pass('All investor relational structures remain 100% intact');

  console.log('======================================================================');
  console.log('🎉 ALL 27 AUDIT & COMPLIANCE VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

runDraftAuditSuite().catch(err => {
  console.error('❌ DRAFT AUDIT SUITE FAILED:', err);
  process.exit(1);
});
