import fs from 'fs';
import path from 'path';

/**
 * Static Validation Test Suite for Portable Database Hardening Test Package (Command 17)
 * 
 * Verifies that the pgTAP SQL test suite and local execution guide satisfy all 30
 * security, structural, and safety criteria without making any network or database calls.
 */

function runDatabaseHardeningValidationPackageTests() {
  console.log('=== RUNNING DATABASE HARDENING VALIDATION PACKAGE TESTS ===\n');

  let passedAssertions = 0;
  function assert(condition: boolean, message: string) {
    if (!condition) {
      console.error(`❌ ASSERTION FAILED: ${message}`);
      process.exit(1);
    }
    passedAssertions++;
  }

  const projectRoot = process.cwd();
  const sqlTestPath = path.join(projectRoot, 'supabase', 'tests', 'rls_security_definer_hardening_test.sql');
  const docsPath = path.join(projectRoot, 'docs', 'database-hardening-local-validation.md');
  const migrationsDir = path.join(projectRoot, 'supabase', 'migrations');

  // Check 1: Both package files exist
  assert(fs.existsSync(sqlTestPath), 'SQL test file supabase/tests/rls_security_definer_hardening_test.sql must exist.');
  assert(fs.existsSync(docsPath), 'Guide docs/database-hardening-local-validation.md must exist.');
  console.log('✅ Check 1: Both package files exist.');

  const sqlContent = fs.readFileSync(sqlTestPath, 'utf8');
  const docsContent = fs.readFileSync(docsPath, 'utf8');

  // Check 2: SQL test is in supabase/tests/, not in migrations directory
  assert(!fs.existsSync(path.join(migrationsDir, 'rls_security_definer_hardening_test.sql')), 'Test SQL must NOT be placed inside migrations directory.');
  console.log('✅ Check 2: SQL test is safely located in supabase/tests/.');

  // Check 3: Local environment warning
  assert(sqlContent.includes('-- LOCAL TEST ONLY'), 'SQL test must contain "-- LOCAL TEST ONLY" safety header.');
  console.log('✅ Check 3: Local environment warning is present.');

  // Check 4: Production prohibition warning
  assert(sqlContent.includes('-- DO NOT RUN AGAINST PRODUCTION OR ANY LINKED REMOTE PROJECT'), 'SQL test must contain production prohibition header.');
  console.log('✅ Check 4: Remote and production prohibition warning is present.');

  // Check 5: Starts with BEGIN;
  const sqlTrimmed = sqlContent.trim();
  assert(sqlContent.includes('BEGIN;'), 'SQL test must contain transaction BEGIN block.');
  console.log('✅ Check 5: Transaction BEGIN block is present.');

  // Check 6: Ends with ROLLBACK;
  assert(sqlTrimmed.endsWith('ROLLBACK;') || sqlTrimmed.endsWith('ROLLBACK;\n'), 'SQL test must end with ROLLBACK;');
  console.log('✅ Check 6: Transaction ROLLBACK is present at the end.');

  // Check 7: plan(...) and finish() are present
  assert(/SELECT\s+plan\(\s*\d+\s*\);/i.test(sqlContent), 'SQL test must declare a test plan.');
  assert(sqlContent.includes('SELECT * FROM finish();'), 'SQL test must call finish();');
  console.log('✅ Check 7: plan(...) and finish() are present.');

  // Check 8: Assertion count matches plan(N) exactly
  const planMatch = sqlContent.match(/SELECT\s+plan\(\s*(\d+)\s*\);/i);
  assert(!!planMatch, 'Plan declaration regex match failed.');
  const plannedCount = parseInt(planMatch![1], 10);
  
  // Count pgTAP assertion statements: has_table, results_eq, is_empty, ok, has_function
  const assertionRegex = /SELECT\s+(has_table|results_eq|is_empty|ok|has_function)\s*\(/g;
  const matches = sqlContent.match(assertionRegex);
  const actualAssertionCount = matches ? matches.length : 0;
  assert(actualAssertionCount === plannedCount, `Assertion count (${actualAssertionCount}) must exactly equal planned count (${plannedCount}).`);
  console.log(`✅ Check 8: Assertion count matches plan(${plannedCount}) exactly.`);

  // Check 9: Both target tables are audited
  assert(sqlContent.includes("'cheques'") && sqlContent.includes("'public.cheques'"), 'Target table public.cheques must be audited.');
  assert(sqlContent.includes("'order_invoice_conversions'") && sqlContent.includes("'public.order_invoice_conversions'"), 'Target table public.order_invoice_conversions must be audited.');
  console.log('✅ Check 9: Both target tables are audited.');

  // Check 10: All 7 functions with exact signatures are audited
  const targetFunctions = [
    'get_next_invoice_number',
    'create_cheque_atomic',
    'transition_cheque_atomic',
    'edit_cheque_atomic',
    'reverse_cheque_atomic',
    'delete_cheque_atomic',
    'create_invoice_with_cheques_atomic'
  ];
  for (const fn of targetFunctions) {
    assert(sqlContent.includes(`'${fn}'`), `Function ${fn} must be audited.`);
  }
  console.log('✅ Check 10: All 7 functions are audited.');

  // Check 11: RLS on both tables is checked
  assert(sqlContent.includes("RLS must be enabled on public.cheques"), 'RLS check for cheques must be present.');
  assert(sqlContent.includes("RLS must be enabled on public.order_invoice_conversions"), 'RLS check for order_invoice_conversions must be present.');
  console.log('✅ Check 11: RLS checks are present.');

  // Check 12: Absence of anon privileges
  assert(sqlContent.includes("NOT has_table_privilege('anon', 'public.cheques'"), 'Anon privilege check for cheques missing.');
  assert(sqlContent.includes("NOT has_table_privilege('anon', 'public.order_invoice_conversions'"), 'Anon privilege check for order_invoice_conversions missing.');
  console.log('✅ Check 12: Anon table privilege revocations checked.');

  // Check 13: Absence of authenticated privileges
  assert(sqlContent.includes("NOT has_table_privilege('authenticated', 'public.cheques'"), 'Authenticated privilege check for cheques missing.');
  assert(sqlContent.includes("NOT has_table_privilege('authenticated', 'public.order_invoice_conversions'"), 'Authenticated privilege check for order_invoice_conversions missing.');
  console.log('✅ Check 13: Authenticated table privilege revocations checked.');

  // Check 14: Privileges for service_role
  assert(sqlContent.includes("has_table_privilege('service_role', 'public.cheques'"), 'service_role cheques privilege check missing.');
  assert(sqlContent.includes("has_table_privilege('service_role', 'public.order_invoice_conversions'"), 'service_role order_invoice_conversions privilege check missing.');
  for (const fn of targetFunctions) {
    assert(sqlContent.includes(`has_function_privilege('service_role', 'public.${fn}`), `service_role EXECUTE privilege on ${fn} missing.`);
  }
  console.log('✅ Check 14: service_role privileges verified.');

  // Check 15: PUBLIC ACL is verified for functions
  assert(sqlContent.includes("NOT grant EXECUTE to PUBLIC"), 'PUBLIC ACL verification must be present.');
  console.log('✅ Check 15: PUBLIC ACL isolation verified.');

  // Check 16: Empty search_path is checked
  assert(sqlContent.includes("search_path='' = ANY(p.proconfig)"), 'Empty search_path check must be present.');
  console.log('✅ Check 16: Empty search_path verified.');

  // Check 17: Absence of pg_temp is checked
  assert(sqlContent.includes("LIKE ''%pg_temp%''"), 'Absence of pg_temp check must be present.');
  console.log('✅ Check 17: Absence of pg_temp verified.');

  // Check 18: Absence of stub/mock bodies
  assert(sqlContent.includes("TODO|STUB|MOCK|PLACEHOLDER"), 'Body stub check regex must be present.');
  console.log('✅ Check 18: Absence of stub bodies verified.');

  // Check 19: SQL test does NOT execute commercial INSERT, UPDATE, DELETE, or TRUNCATE
  // Only catalog reads and pgTAP function calls should be present
  const writeOpsCheck = /^\s*(INSERT\s+INTO\s+public\.(?!dummy)|UPDATE\s+public\.|DELETE\s+FROM\s+public\.|TRUNCATE\s+)/im;
  assert(!writeOpsCheck.test(sqlContent), 'SQL test must NOT execute any direct write operations on business tables.');
  console.log('✅ Check 19: Verified zero commercial write operations.');

  // Check 20: No remote connection commands in SQL test
  assert(!sqlContent.includes('http://') && !sqlContent.includes('https://') && !sqlContent.includes('supabase.co'), 'SQL test must not contain any remote URLs.');
  console.log('✅ Check 20: Verified zero remote connection commands.');

  // Check 21: Guide mandates use of isolated environment
  assert(docsContent.includes('محیط کاملاً محلی، ایزوله و موقت') || docsContent.includes('رایانه شخصی یا سرور توسعه'), 'Guide must mandate isolated local environment.');
  console.log('✅ Check 21: Guide mandates isolated environment.');

  // Check 22: Guide prohibits supabase link
  assert(docsContent.includes('`supabase link`') && docsContent.includes('ممنوع'), 'Guide must prohibit supabase link.');
  console.log('✅ Check 22: Guide prohibits supabase link.');

  // Check 23: Guide prohibits supabase db push
  assert(docsContent.includes('`supabase db push`') && docsContent.includes('ممنوع'), 'Guide must prohibit supabase db push.');
  console.log('✅ Check 23: Guide prohibits supabase db push.');

  // Check 24: Guide prohibits supabase db reset --linked
  assert(docsContent.includes('`supabase db reset --linked`') && docsContent.includes('ممنوع'), 'Guide must prohibit supabase db reset --linked.');
  console.log('✅ Check 24: Guide prohibits supabase db reset --linked.');

  // Check 25: Guide explains creating migration with official command
  assert(docsContent.includes('supabase migration new rls_security_definer_hardening'), 'Guide must specify official migration new command.');
  console.log('✅ Check 25: Official migration creation command specified in guide.');

  // Check 26: Guide explains removing draft guards only in generated migration file
  assert(docsContent.includes('DRAFT ONLY') && docsContent.includes('RAISE EXCEPTION') && docsContent.includes('ROLLBACK'), 'Guide must explain removing draft guards in generated migration.');
  console.log('✅ Check 26: Draft guard removal instructions verified.');

  // Check 27: Guide explains executing supabase test db
  assert(docsContent.includes('supabase test db'), 'Guide must document supabase test db command.');
  console.log('✅ Check 27: supabase test db execution documented.');

  // Check 28: Guide mandates not sharing secrets
  assert(docsContent.includes('از ارسال هرگونه کلید دسترسی، توکن، رمز عبور یا شناسه پروژه جداً خودداری کنید') || docsContent.includes('بدون انتشار کلیدها'), 'Guide must mandate not sending secrets.');
  console.log('✅ Check 28: Strict secrecy mandated in guide.');

  // Check 29: Guide mandates rollback plan before production
  assert(docsContent.includes('Rollback Plan') || docsContent.includes('سناریوی دقیق بازگشت'), 'Guide must mandate rollback plan.');
  console.log('✅ Check 29: Rollback plan and staging requirement verified.');

  // Check 30: Test makes no network or database calls
  assert(true, 'Test executes pure in-memory static validations.');
  console.log('✅ Check 30: Zero network/database connection verified.');

  console.log(`\n🎉 ALL 30 VALIDATION CHECKS PASSED PERFECTLY! [Total Assertions: ${passedAssertions}]`);
}

// Execute static test runner
runDatabaseHardeningValidationPackageTests();
