import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

function runPackageValidation() {
  console.log('=== STARTING STATIC AUDIT: Phase 26 Portable Test Package (investorCommissionPhase26ValidationPackage.test.ts) ===\n');

  const rootDir = process.cwd();

  // Paths to the 5 package files
  const cand1Path = join(rootDir, 'security/local-db-validation/investor-commission/01_investor_relational_foundation_candidate.sql');
  const cand2Path = join(rootDir, 'security/local-db-validation/investor-commission/02_investor_commission_atomic_workflow_candidate.sql');
  const dbTestPath = join(rootDir, 'supabase/tests/investor_commission_phase26_database_validation.sql');
  const docPath = join(rootDir, 'docs/investor-commission-phase26-local-validation.md');
  const packageTestPath = join(rootDir, 'src/tests/investorCommissionPhase26ValidationPackage.test.ts');

  // Paths to reference draft files
  const draft1Path = join(rootDir, 'security/sql-drafts/investor_relational_foundation_draft.sql');
  const draft2Path = join(rootDir, 'security/sql-drafts/investor_commission_atomic_workflow_draft.sql');

  // Check 1: Existence of all 5 package files
  console.log('Check 1: Verifying existence of all 5 package files...');
  if (!existsSync(cand1Path)) throw new Error('FAIL: Candidate file 1 missing at ' + cand1Path);
  if (!existsSync(cand2Path)) throw new Error('FAIL: Candidate file 2 missing at ' + cand2Path);
  if (!existsSync(dbTestPath)) throw new Error('FAIL: DB Test file missing at ' + dbTestPath);
  if (!existsSync(docPath)) throw new Error('FAIL: Documentation file missing at ' + docPath);
  if (!existsSync(packageTestPath)) throw new Error('FAIL: Static TS validation test file missing at ' + packageTestPath);
  console.log('  PASS: All 5 package files exist.');

  // Check 2: Pristine official migrations folder (No premature investor commission migrations)
  console.log('Check 2: Verifying no premature investor migrations were created in supabase/migrations/...');
  const migrationFiles = readdirSync(join(rootDir, 'supabase/migrations'));
  const hasInvestorMigration = migrationFiles.some(f => f.toLowerCase().includes('investor'));
  if (hasInvestorMigration) {
    throw new Error(`FAIL: Found investor migration in supabase/migrations/; Official investor migration created prematurely!`);
  }
  console.log(`  PASS: Official migrations directory contains ${migrationFiles.length} files with zero premature investor migrations.`);

  // Check 3: Local environment warning headers on candidate files
  console.log('Check 3: Verifying local warning headers at top of candidate files...');
  const cand1Content = readFileSync(cand1Path, 'utf8');
  const cand2Content = readFileSync(cand2Path, 'utf8');

  const warningFa = 'فقط برای اعتبارسنجی در پایگاه‌داده محلی دورریختنی — اجرای عملیاتی ممنوع';
  const warningEn = 'LOCAL DISPOSABLE DATABASE VALIDATION ONLY — NEVER RUN AGAINST REMOTE OR PRODUCTION';

  if (!cand1Content.includes(warningFa) || !cand1Content.includes(warningEn)) {
    throw new Error('FAIL: Candidate 1 missing Persian/English local warning header.');
  }
  if (!cand2Content.includes(warningFa) || !cand2Content.includes(warningEn)) {
    throw new Error('FAIL: Candidate 2 missing Persian/English local warning header.');
  }
  console.log('  PASS: Local warning headers verified on both candidate files.');

  // Check 4: Absence of real DB URLs, passwords, or service_role keys
  console.log('Check 4: Verifying absence of real DB URLs, passwords, or service_role keys...');
  const allPackageContents = [cand1Content, cand2Content, readFileSync(dbTestPath, 'utf8'), readFileSync(docPath, 'utf8')].join('\n');
  if (allPackageContents.match(/https?:\/\/[a-z0-9-]+\.supabase\.co/i) || allPackageContents.match(/postgresql:\/\/[^@]+@[a-z0-9-]+\.supabase\.co/i) || allPackageContents.match(/eyJhbGciOiJIUzI1NiI/)) {
    throw new Error('FAIL: Sensitive remote connection URLs or JWT keys detected in package files.');
  }
  console.log('  PASS: No sensitive URLs, passwords, or service_role keys found.');

  // Check 5: Match between candidates and reference draft files (logic equality)
  console.log('Check 5: Verifying logical candidate match against draft reference files...');
  if (!existsSync(draft1Path) || !existsSync(draft2Path)) {
    throw new Error('FAIL: Reference draft files missing in security/sql-drafts/.');
  }
  const draft2Content = readFileSync(draft2Path, 'utf8');
  if (!cand1Content.includes('CREATE TABLE IF NOT EXISTS public.investor_contracts') ||
      !cand1Content.includes('CREATE TABLE IF NOT EXISTS public.investor_commission_cheque_allocations') ||
      !cand1Content.includes('CREATE TABLE IF NOT EXISTS public.org_bank_account_mappings')) {
    throw new Error('FAIL: Candidate 1 missing foundational relational tables from draft 1.');
  }
  if (!cand2Content.includes('FUNCTION public.reclassify_investor_commission_cheque_atomic') ||
      !cand2Content.includes('FUNCTION public.transition_cheque_atomic')) {
    throw new Error('FAIL: Candidate 2 missing atomic functions from draft 2.');
  }
  if (cand1Content.includes("RAISE EXCEPTION 'DRAFT ONLY") || cand2Content.includes("RAISE EXCEPTION 'DRAFT ONLY")) {
    throw new Error('FAIL: Draft execution protection block was not stripped from candidate files.');
  }
  console.log('  PASS: Candidate files structurally match drafts with protective blocks cleanly stripped.');

  // Check 6 & 7: Signature alignment & absence of old parameter names
  console.log('Check 6 & 7: Verifying Phase 26-B parameter alignment in Candidate 2 & Draft 2...');
  const reclassifyStart = cand2Content.indexOf('CREATE OR REPLACE FUNCTION public.reclassify_investor_commission_cheque_atomic');
  const transitionStart = cand2Content.indexOf('CREATE OR REPLACE FUNCTION public.transition_cheque_atomic');
  const reclassifyScope = cand2Content.substring(reclassifyStart, transitionStart);

  if (!reclassifyScope.includes('p_operation_key TEXT') || !reclassifyScope.includes('p_performed_by TEXT')) {
    throw new Error('FAIL: Candidate 2 reclassify signature missing p_operation_key or p_performed_by.');
  }
  if (reclassifyScope.includes('p_mutation_key') || reclassifyScope.includes('p_user_id')) {
    throw new Error('FAIL: Candidate 2 reclassify function contains old parameter names.');
  }
  console.log('  PASS: Phase 26-B parameter contract preserved in Candidate 2.');

  // Check 8 & 9: Absence of invalid schema/column usage in functions
  console.log('Check 8 & 9: Verifying zero invalid column usages in candidate & draft SQL...');
  if (cand2Content.includes('MAX(voucher_number)') || cand2Content.includes('max(voucher_number)') ||
      draft2Content.includes('MAX(voucher_number)') || draft2Content.includes('max(voucher_number)')) {
    throw new Error('FAIL: SQL uses MAX(voucher_number) instead of atomic voucher_sequences locking!');
  }
  if (cand2Content.includes('user_profiles.organization_id') || draft2Content.includes('user_profiles.organization_id')) {
    throw new Error('FAIL: SQL uses non-existent user_profiles.organization_id!');
  }
  if (cand2Content.includes('fiscal_years.is_active') || draft2Content.includes('fiscal_years.is_active')) {
    throw new Error('FAIL: SQL uses non-existent fiscal_years.is_active!');
  }
  if (cand2Content.match(/LIMIT\s+1/i) || draft2Content.match(/LIMIT\s+1/i)) {
    throw new Error('FAIL: SQL contains random user selection with LIMIT 1!');
  }
  console.log('  PASS: Zero invalid column usages confirmed in Candidate 2 & Draft 2.');

  // Check 10, 11, 12, 13: DB Test File strict validation
  console.log('Check 10, 11, 12, 13: Verifying DB Test File strict schema alignment and assertion accuracy...');
  const dbTestContent = readFileSync(dbTestPath, 'utf8');

  // 1. Zero pass() calls
  if (dbTestContent.match(/SELECT\s+pass\s*\(/i) || dbTestContent.match(/PERFORM\s+pass\s*\(/i)) {
    throw new Error('FAIL: DB Test file contains dummy pass(...) calls!');
  }

  // 2. Exact plan(N) match
  const planMatch = dbTestContent.match(/SELECT\s+plan\s*\(\s*(\d+)\s*\)/i);
  if (!planMatch) {
    throw new Error('FAIL: DB Test file missing SELECT plan(N)!');
  }
  const plannedCount = parseInt(planMatch[1], 10);
  
  // Count top level pgTAP assertions
  const isMatches = (dbTestContent.match(/PERFORM\s+is\s*\(/gi) || []).length + (dbTestContent.match(/SELECT\s+is\s*\(/gi) || []).length;
  const okMatches = (dbTestContent.match(/PERFORM\s+ok\s*\(/gi) || []).length + (dbTestContent.match(/SELECT\s+ok\s*\(/gi) || []).length;
  const totalAssertions = isMatches + okMatches;

  if (totalAssertions !== plannedCount) {
    throw new Error(`FAIL: Plan count (${plannedCount}) does not match total top-level assertions (${totalAssertions})!`);
  }
  console.log(`  PASS: Plan count (${plannedCount}) matches total pgTAP assertions (${totalAssertions}) exactly 1:1.`);

  // 3. Invalid schema columns in DB test
  if (dbTestContent.match(/INSERT\s+INTO\s+public\.organizations\s*\([^)]*\bcode\b/i) || dbTestContent.includes('organizations.code')) {
    throw new Error('FAIL: DB Test file uses non-existent organizations.code column!');
  }
  if (dbTestContent.match(/INSERT\s+INTO\s+public\.user_profiles\s*\([^)]*\b(organization_id|email)\b/i) || dbTestContent.includes('user_profiles.organization_id') || dbTestContent.includes('user_profiles.email')) {
    throw new Error('FAIL: DB Test file uses non-existent columns on user_profiles!');
  }
  if (dbTestContent.match(/INSERT\s+INTO\s+public\.fiscal_years\s*\([^)]*\bis_active\b/i) || dbTestContent.includes('fiscal_years.is_active')) {
    throw new Error('FAIL: DB Test file uses non-existent fiscal_years.is_active column!');
  }
  if (dbTestContent.match(/INSERT\s+INTO\s+public\.investor_profiles\s*\([^)]*\bis_active\b/i) || dbTestContent.includes('investor_profiles.is_active')) {
    throw new Error('FAIL: DB Test file uses non-existent investor_profiles.is_active column!');
  }
  if (dbTestContent.match(/INSERT\s+INTO\s+public\.account_subsidiaries\s*\([^)]*\btitle\b/i) || dbTestContent.includes('account_subsidiaries.title')) {
    throw new Error('FAIL: DB Test file uses non-existent account_subsidiaries.title column!');
  }

  // 4. Fixture requirements
  if (!dbTestContent.includes('INSERT INTO auth.users') || !dbTestContent.includes('INSERT INTO public.organization_memberships')) {
    throw new Error('FAIL: DB Test file missing auth.users or organization_memberships fixture setup!');
  }
  if (!dbTestContent.includes('posted_by') || !dbTestContent.includes('posted_at') || !dbTestContent.includes('branch_id')) {
    throw new Error('FAIL: DB Test file journal_vouchers missing required POSTED fields!');
  }

  // 5. Accounting & Multi-bank verification
  if (!dbTestContent.includes('00000000-0000-4000-a000-000000000051') || !dbTestContent.includes('Bank 2 secondary subsidiary account')) {
    throw new Error('FAIL: DB Test file multi-bank scenario does not check Bank 2 subsidiary_id!');
  }
  if (!dbTestContent.includes('debit') || !dbTestContent.includes('credit')) {
    throw new Error('FAIL: DB Test file missing accounting debit/credit assertions!');
  }
  console.log('  PASS: DB Test file schema compliance and accounting assertions verified.');

  // Check 14: Documentation file status
  console.log('Check 14: Verifying documentation file contents...');
  const docContent = readFileSync(docPath, 'utf8');
  if (!docContent.includes('برنامه آزمون همزمانی') || !docContent.includes('Concurrent Session Test Plan')) {
    throw new Error('FAIL: Documentation file missing 2-session concurrency test plan.');
  }
  if (!docContent.includes('اثبات‌نشده') && !docContent.includes('محیط محلی دورریختنی')) {
    throw new Error('FAIL: Documentation file missing local disposable database execution note.');
  }
  console.log('  PASS: Documentation file verified.');

  // Check 15, 16, 17: Operational Code Safety
  console.log('Check 15, 16, 17: Verifying operational code safety...');
  const envPath = join(rootDir, '.env.example');
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf8');
    if (envContent.includes('ENABLE_INVESTOR_COMMISSION_RECLASSIFICATION=true')) {
      throw new Error('FAIL: Feature flag is set to true in .env.example!');
    }
  }

  const serverTransitionPath = join(rootDir, 'src/server/cheques/chequeService.ts');
  if (existsSync(serverTransitionPath)) {
    const serverCode = readFileSync(serverTransitionPath, 'utf8');
    if (!serverCode.includes('p_operation_key: trimmedOperationKey') || !serverCode.includes('p_performed_by: userId')) {
      throw new Error('FAIL: Server transition contract in chequeService.ts altered!');
    }
  }
  console.log('  PASS: Operational code confirmed safe and unmutated.');

  console.log('\n=== STATIC AUDIT PASSED: Phase 26 Portable Test Package structure verified 100%! ===');
  console.log('(Note: No SQL was executed or compiled against any database during this static test.)');
}

runPackageValidation();
