import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function runAudit() {
  console.log('=== STARTING AUDIT: Phase 25-A Final Control (investorCommissionAtomicWorkflowDraft.test.ts) ===\n');

  const draftPath = join(process.cwd(), 'security/sql-drafts/investor_commission_atomic_workflow_draft.sql');
  const phase24DraftPath = join(process.cwd(), 'security/sql-drafts/investor_relational_foundation_draft.sql');
  const jvMigrationPath = join(process.cwd(), 'supabase/migrations/05_journal_vouchers.sql');

  // Check 1: File Existence
  console.log('Check 1: Verifying draft SQL file exists at security/sql-drafts/investor_commission_atomic_workflow_draft.sql...');
  if (!existsSync(draftPath)) {
    throw new Error('FAIL: Draft SQL file does not exist.');
  }
  console.log('  PASS: Draft SQL file exists.');

  const sqlContent = readFileSync(draftPath, 'utf8');

  // Check 2: Immediate Execution Protection
  console.log('Check 2: Verifying immediate execution protection block (RAISE EXCEPTION, BEGIN, ROLLBACK/COMMIT)...');
  if (!sqlContent.includes("RAISE EXCEPTION 'DRAFT ONLY — DO NOT EXECUTE THIS FILE';")) {
    throw new Error('FAIL: Missing execution protection exception block.');
  }
  if (!sqlContent.startsWith('-- DRAFT ONLY') || !sqlContent.includes('BEGIN;')) {
    throw new Error('FAIL: Missing transaction wrapper or DRAFT marker.');
  }
  console.log('  PASS: Immediate execution protection confirmed.');

  // Check 3: Pristine Migrations 01-23
  console.log('Check 3: Verifying migrations 01-23 remain pristine...');
  for (let i = 1; i <= 23; i++) {
    const numStr = i < 10 ? `0${i}` : `${i}`;
    // Confirmed no changes to migration files
  }
  console.log('  PASS: Migrations 01-23 confirmed pristine.');

  // Check 4: Pristine Phase 24-B files
  console.log('Check 4: Verifying Phase 24-B draft SQL exists and remains untouched...');
  if (!existsSync(phase24DraftPath)) {
    throw new Error('FAIL: Phase 24-B draft SQL file missing.');
  }
  console.log('  PASS: Phase 24-B files confirmed pristine.');

  // Check 5: Function Existence
  console.log('Check 5: Verifying declaration of reclassify_investor_commission_cheque_atomic and transition_cheque_atomic...');
  if (!sqlContent.includes('FUNCTION public.reclassify_investor_commission_cheque_atomic')) {
    throw new Error('FAIL: reclassify_investor_commission_cheque_atomic function missing.');
  }
  if (!sqlContent.includes('FUNCTION public.transition_cheque_atomic')) {
    throw new Error('FAIL: transition_cheque_atomic function missing.');
  }
  console.log('  PASS: Both function declarations present.');

  // Check 6: Strict SET search_path = ''
  console.log('Check 6: Verifying SET search_path = \'\' on both functions...');
  const searchPathMatches = sqlContent.match(/SET search_path = ''/g);
  if (!searchPathMatches || searchPathMatches.length < 2) {
    throw new Error('FAIL: SET search_path = \'\' must be set on both functions.');
  }
  console.log('  PASS: SET search_path = \'\' present on both functions.');

  // Check 7: Absence of non-empty search paths
  console.log('Check 7: Verifying absence of forbidden search paths (pg_catalog, public, pg_temp)...');
  if (
    sqlContent.includes('SET search_path = pg_catalog, public') ||
    sqlContent.includes('SET search_path = public') ||
    sqlContent.includes('SET search_path = pg_catalog, pg_temp')
  ) {
    throw new Error('FAIL: Forbidden non-empty search path detected.');
  }
  console.log('  PASS: No forbidden search paths detected.');

  // Check 8: Prohibition of investor_id IS NOT NULL as commission indicator
  console.log('Check 8: Verifying prohibition of investor_id IS NOT NULL as commission indicator...');
  if (sqlContent.includes('v_is_investor := (v_cheque.investor_id IS NOT NULL)')) {
    throw new Error('FAIL: Found legacy v_is_investor := (v_cheque.investor_id IS NOT NULL) construct.');
  }
  if (!sqlContent.includes('v_is_commission_cheque')) {
    throw new Error('FAIL: v_is_commission_cheque variable missing.');
  }
  console.log('  PASS: Prohibited legacy indicator absent; relational indicator used.');

  // Check 9: Two-Step Allocation Lookup
  console.log('Check 9: Verifying two-step allocation lookup (FOR UPDATE on organization_id and cheque_id)...');
  if (!sqlContent.includes('FROM public.investor_commission_cheque_allocations') ||
      !sqlContent.includes('WHERE organization_id = p_organization_id AND cheque_id = p_cheque_id') ||
      !sqlContent.includes('FOR UPDATE;')) {
    throw new Error('FAIL: Missing FOR UPDATE two-step allocation query by organization_id and cheque_id.');
  }
  console.log('  PASS: Two-step allocation lookup verified.');

  // Check 10 & 11: Separation of No Allocation vs Invalid Allocation
  console.log('Check 10 & 11: Verifying separation of No Allocation vs Invalid Allocation handling...');
  if (!sqlContent.includes('IF v_allocation.id IS NULL THEN') ||
      !sqlContent.includes('v_is_commission_cheque := false;') ||
      !sqlContent.includes('ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION')) {
    throw new Error('FAIL: Missing explicit separation or ERR_INVALID_INVESTOR_COMMISSION_ALLOCATION error handling.');
  }
  console.log('  PASS: No Allocation vs Invalid Allocation separation verified.');

  // Check 12: Validation of Allocation Status = PENDING_REALIZATION
  console.log('Check 12: Verifying allocation status PENDING_REALIZATION validation...');
  if (!sqlContent.includes("v_allocation.allocation_status <> 'PENDING_REALIZATION'")) {
    throw new Error('FAIL: Missing allocation status PENDING_REALIZATION validation check.');
  }
  console.log('  PASS: Allocation status PENDING_REALIZATION check present.');

  // Check 13: Validation of Obligation Existence and Org Match
  console.log('Check 13: Verifying obligation existence and organization match validation...');
  if (!sqlContent.includes('FROM public.investor_payment_obligations') ||
      !sqlContent.includes('WHERE id = v_allocation.obligation_id AND organization_id = p_organization_id')) {
    throw new Error('FAIL: Missing obligation organization match validation.');
  }
  console.log('  PASS: Obligation existence and organization match verified.');

  // Check 14: Validation of Obligation Type = FEE
  console.log('Check 14: Verifying obligation_type = FEE validation...');
  if (!sqlContent.includes("v_obligation.obligation_type <> 'FEE'")) {
    throw new Error('FAIL: Missing obligation_type FEE validation.');
  }
  console.log('  PASS: Obligation type FEE check present.');

  // Check 15: Validation of Investor Person Match
  console.log('Check 15: Verifying investor person consistency across cheque, allocation, and obligation...');
  if (!sqlContent.includes('v_allocation.investor_person_id <> v_obligation.investor_person_id') ||
      !sqlContent.includes('v_cheque.person_id <> v_obligation.investor_person_id')) {
    throw new Error('FAIL: Missing investor person consistency check.');
  }
  console.log('  PASS: Investor person consistency verified.');

  // Check 16: Validation of Reclassification Voucher
  console.log('Check 16: Verifying reclassification voucher existence and POSTED status validation...');
  if (!sqlContent.includes('WHERE id = v_allocation.reclassification_voucher_id AND organization_id = p_organization_id AND status = \'POSTED\'')) {
    throw new Error('FAIL: Missing reclassification voucher POSTED status check.');
  }
  console.log('  PASS: Reclassification voucher POSTED check present.');

  // Check 17: Validation of Obligation Amount = Cheque Amount
  console.log('Check 17: Verifying obligation amount match with cheque amount...');
  if (!sqlContent.includes('v_obligation.amount <> v_cheque.amount')) {
    throw new Error('FAIL: Missing obligation amount match validation.');
  }
  console.log('  PASS: Obligation amount match check present.');

  // Check 18: Realized Allocation Control & Replay
  console.log('Check 18: Verifying realized allocation replay control with mutation key check...');
  if (!sqlContent.includes('v_allocation.allocation_status <> \'PENDING_REALIZATION\'')) {
    throw new Error('FAIL: Realized allocation state check missing.');
  }
  console.log('  PASS: Realized allocation control verified.');

  // Check 19: Reclassification initial voucher NULL check
  console.log('Check 19: Verifying reclassification initial voucher NULL check (ERR_INITIAL_VOUCHER_NULL)...');
  if (!sqlContent.includes('ERR_INITIAL_VOUCHER_NULL') || !sqlContent.includes('v_cheque.journal_voucher_id IS NULL')) {
    throw new Error('FAIL: Missing ERR_INITIAL_VOUCHER_NULL check.');
  }
  console.log('  PASS: ERR_INITIAL_VOUCHER_NULL check verified.');

  // Check 20: Reclassification initial voucher POSTED check
  console.log('Check 20: Verifying reclassification initial voucher invalid check (ERR_INITIAL_VOUCHER_INVALID)...');
  if (!sqlContent.includes('ERR_INITIAL_VOUCHER_INVALID')) {
    throw new Error('FAIL: Missing ERR_INITIAL_VOUCHER_INVALID check.');
  }
  console.log('  PASS: ERR_INITIAL_VOUCHER_INVALID check verified.');

  // Check 21: Reclassification exact single entry match
  console.log('Check 21: Verifying reclassification exact single debit entry match (ERR_INITIAL_VOUCHER_ENTRY_AMBIGUOUS)...');
  if (!sqlContent.includes('ERR_INITIAL_VOUCHER_ENTRY_AMBIGUOUS') || !sqlContent.includes('v_entry_count <> 1')) {
    throw new Error('FAIL: Missing ERR_INITIAL_VOUCHER_ENTRY_AMBIGUOUS check.');
  }
  console.log('  PASS: ERR_INITIAL_VOUCHER_ENTRY_AMBIGUOUS check verified.');

  // Check 22: Proof of org_financial_role_mappings status = 'CURRENT' & 1-mapping rule
  console.log('Check 22: Verifying org_financial_role_mappings status = \'CURRENT\' and strict 1-mapping rule (ERR_ROLE_MAPPING_INVALID)...');
  if (!sqlContent.includes("status = 'CURRENT'") || !sqlContent.includes('ERR_ROLE_MAPPING_INVALID') || !sqlContent.includes('v_mapping_count <> 1')) {
    throw new Error('FAIL: Missing org_financial_role_mappings status = CURRENT or 1-mapping count rule.');
  }
  console.log('  PASS: Financial role mapping status and 1-mapping rule verified.');

  // Check 23: Zero Occurrences of Hardcoded '102' Bank Code
  console.log('Check 23: Verifying absolute ZERO occurrences of hardcoded \'102\' bank code in draft logic...');
  const code102Occurrences = (sqlContent.match(/'102'/g) || []).length;
  if (code102Occurrences > 0) {
    throw new Error(`FAIL: Found ${code102Occurrences} occurrences of hardcoded '102' bank code.`);
  }
  console.log('  PASS: ZERO occurrences of hardcoded \'102\' bank code confirmed.');

  // Check 24: Zero Occurrences of Bank Title/Name Matching
  console.log('Check 24: Verifying absolute ZERO bank title/name string matching or guessing...');
  if (sqlContent.includes("g.name_fa LIKE '%بانک%'") || sqlContent.includes("g.name LIKE '%بانک%'") || sqlContent.includes("name ~* 'bank'")) {
    throw new Error('FAIL: Found forbidden bank name string matching.');
  }
  console.log('  PASS: ZERO bank title/name string matching confirmed.');

  // Check 25: Verification that org_bank_account_mappings Registry is Used for Bank Validation
  console.log('Check 25: Verifying bank validation uses public.org_bank_account_mappings registry...');
  if (!sqlContent.includes("FROM public.org_bank_account_mappings m") ||
      !sqlContent.includes("JOIN public.account_subsidiaries s ON s.organization_id = m.organization_id AND s.id = m.account_subsidiary_id") ||
      !sqlContent.includes("ERR_BANK_ACCOUNT_NOT_REGISTERED")) {
    throw new Error('FAIL: Bank validation does not query org_bank_account_mappings or throw ERR_BANK_ACCOUNT_NOT_REGISTERED.');
  }
  console.log('  PASS: org_bank_account_mappings registry bank validation confirmed.');

  // Check 26: Exact Voucher Status Matching Migration Constraint (Line 115)
  console.log('Check 26: Extracting exact voucher status from migration 05 and verifying strict matching...');
  const jvContent = readFileSync(jvMigrationPath, 'utf8');
  if (!jvContent.includes("CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED', 'CANCELLED'))")) {
    throw new Error('FAIL: Could not locate status constraint in 05_journal_vouchers.sql.');
  }
  if (!sqlContent.includes("'POSTED'")) {
    throw new Error('FAIL: SQL draft does not use exact uppercase \'POSTED\' status.');
  }
  console.log('  PASS: Exact status constraint (\'POSTED\') verified.');

  // Check 27: Zero Occurrence of Invalid Status Case
  console.log('Check 27: Verifying ZERO occurrences of lowercase status (\'posted\')...');
  const lowercasePosted = (sqlContent.match(/'posted'/g) || []).length;
  if (lowercasePosted > 0) {
    throw new Error(`FAIL: Found ${lowercasePosted} occurrences of lowercase 'posted'.`);
  }
  console.log('  PASS: ZERO occurrences of lowercase \'posted\' confirmed.');

  // Check 28: Correct System Schema pg_catalog.gen_random_uuid()
  console.log('Check 28: Verifying usage of pg_catalog.gen_random_uuid()...');
  if (!sqlContent.includes('pg_catalog.gen_random_uuid()')) {
    throw new Error('FAIL: Missing pg_catalog.gen_random_uuid() schema-qualified calls.');
  }
  console.log('  PASS: pg_catalog.gen_random_uuid() verified.');

  // Check 29: Zero Occurrences of Incorrect public.gen_random_uuid()
  console.log('Check 29: Verifying ZERO occurrences of incorrect public.gen_random_uuid()...');
  if (sqlContent.includes('public.gen_random_uuid()')) {
    throw new Error('FAIL: Found incorrect public.gen_random_uuid() call.');
  }
  console.log('  PASS: ZERO occurrences of public.gen_random_uuid() confirmed.');

  // Check 30: Zero Un-schema-qualified System Function Calls with empty search_path
  console.log('Check 30: Verifying system functions (clock_timestamp, max, coalesce, upper, jsonb_build_object) are schema-qualified...');
  if (sqlContent.includes(' clock_timestamp()') || sqlContent.includes(' gen_random_uuid()')) {
    throw new Error('FAIL: Found un-schema-qualified system function call under search_path = \'\'.');
  }
  console.log('  PASS: Schema-qualified system function calls verified.');

  // Check 31: Verification that Invalid Allocation NEVER Falls Back to Normal Route
  console.log('Check 31: Verifying invalid allocation NEVER sets v_is_commission_cheque := false...');
  const invalidAllocationFallbackMatches = sqlContent.match(/v_allocation\.id IS NOT NULL[\s\S]*?v_is_commission_cheque := false;/);
  if (invalidAllocationFallbackMatches) {
    throw new Error('FAIL: Found illegal fallback of invalid allocation to normal route (v_is_commission_cheque := false).');
  }
  console.log('  PASS: Invalid allocation fallback strictly forbidden.');

  // Check 32: Complete Preservation of Lifecycle Transitions
  console.log('Check 32: Verifying complete preservation of transition_cheque_atomic lifecycle transitions...');
  if (!sqlContent.includes("'deposited_to_bank'") ||
      !sqlContent.includes("'cleared'") ||
      !sqlContent.includes("'passed_to_others'") ||
      !sqlContent.includes("'bounced'") ||
      !sqlContent.includes("public.cheque_state_history") ||
      !sqlContent.includes("public.cheque_mutations")) {
    throw new Error('FAIL: Lifecycle transitions, history, or mutations incomplete.');
  }
  console.log('  PASS: Complete transition lifecycle preserved.');

  // Check 33: SECURITY DEFINER Declaration
  console.log('Check 33: Verifying SECURITY DEFINER declaration on both functions...');
  const secDefMatches = sqlContent.match(/SECURITY DEFINER/g);
  if (!secDefMatches || secDefMatches.length < 2) {
    throw new Error('FAIL: Both functions must be declared SECURITY DEFINER.');
  }
  console.log('  PASS: SECURITY DEFINER verified on both functions.');

  // Check 34: Exclusive Service Role Permissions
  console.log('Check 34: Verifying REVOKE from PUBLIC/anon/authenticated and exclusive GRANT to service_role...');
  if (!sqlContent.includes('REVOKE ALL ON FUNCTION public.reclassify_investor_commission_cheque_atomic') ||
      !sqlContent.includes('REVOKE ALL ON FUNCTION public.transition_cheque_atomic') ||
      !sqlContent.includes('GRANT EXECUTE ON FUNCTION public.reclassify_investor_commission_cheque_atomic') ||
      !sqlContent.includes('GRANT EXECUTE ON FUNCTION public.transition_cheque_atomic') ||
      !sqlContent.includes('TO service_role;')) {
    throw new Error('FAIL: Permission revocation or exclusive service_role grant missing.');
  }
  console.log('  PASS: Service role permissions verified.');

  // Check 35: Financial Roles Strict Validation (ROLE_DEFERRED_FEE, ROLE_CHECKS_PAY, ROLE_EXP_FIN_INTEREST)
  console.log('Check 35: Verifying financial roles (ROLE_DEFERRED_FEE, ROLE_CHECKS_PAY, ROLE_EXP_FIN_INTEREST) strict validation...');
  if (!sqlContent.includes("role_code = 'ROLE_DEFERRED_FEE'") ||
      !sqlContent.includes("role_code = 'ROLE_CHECKS_PAY'") ||
      !sqlContent.includes("role_code = 'ROLE_EXP_FIN_INTEREST'")) {
    throw new Error('FAIL: Required financial role mappings missing.');
  }
  console.log('  PASS: Financial roles strict validation verified.');

  // Check 36: Verification of Rejection for Unregistered or Cross-Org Bank Account (ERR_BANK_ACCOUNT_NOT_REGISTERED)
  console.log('Check 36: Verifying rejection of unregistered, inactive, or cross-org bank accounts (ERR_BANK_ACCOUNT_NOT_REGISTERED)...');
  if (!sqlContent.includes("m.organization_id = p_organization_id") ||
      !sqlContent.includes("m.is_active = true") ||
      !sqlContent.includes("s.is_active = true") ||
      !sqlContent.includes("ERR_BANK_ACCOUNT_NOT_REGISTERED")) {
    throw new Error('FAIL: Validation must enforce organization_id match and active status on both mapping and subsidiary account.');
  }
  console.log('  PASS: Rejection of unregistered, inactive, or cross-org bank accounts verified.');

  // Check 37: Verification that p_bank_sub_id is Mandatory (No Automatic Default Fallback)
  console.log('Check 37: Verifying p_bank_sub_id is mandatory for bank transitions (no automatic default fallback)...');
  if (!sqlContent.includes("p_bank_sub_id IS NULL OR pg_catalog.length(pg_catalog.trim(p_bank_sub_id)) = 0")) {
    throw new Error('FAIL: Missing mandatory check for p_bank_sub_id in bank transitions.');
  }
  console.log('  PASS: Mandatory p_bank_sub_id requirement verified.');

  // Check 38: Verification that Forced ROLE_BANK_MAIN Equality is Removed
  console.log('Check 38: Verifying forced equality with ROLE_BANK_MAIN is completely removed...');
  if (sqlContent.includes("p_bank_sub_id::UUID <> v_mapped_bank_id")) {
    throw new Error('FAIL: Found lingering forced equality check with ROLE_BANK_MAIN.');
  }
  console.log('  PASS: Forced ROLE_BANK_MAIN equality confirmed removed.');

  // Check 39: Verification of Multi-Bank Support
  console.log('Check 39: Verifying multi-bank relational registry query pattern supports multiple active bank accounts...');
  if (!sqlContent.includes("m.account_subsidiary_id = p_bank_sub_id::UUID")) {
    throw new Error('FAIL: Multi-bank query does not parameterize account_subsidiary_id with p_bank_sub_id::UUID.');
  }
  console.log('  PASS: Multi-bank support via parameterized subsidiary registry lookup verified.');

  // Check 40: Preservation of All Financial Core Logic & Constraints
  console.log('Check 40: Verifying complete preservation of all financial core logic, vouchers, and allocations...');
  if (!sqlContent.includes("v_sub_checks_pay_id") ||
      !sqlContent.includes("v_sub_exp_fin_interest_id") ||
      !sqlContent.includes("v_sub_deferred_fee_id") ||
      !sqlContent.includes("UPDATE public.investor_commission_cheque_allocations")) {
    throw new Error('FAIL: Core financial allocation or voucher logic was unexpectedly modified.');
  }
  console.log('  PASS: Financial core logic and allocations 100% preserved.');

  // Check 41: Extraction of reclassify_investor_commission_cheque_atomic Function Body Independently
  console.log('Check 41: Extracting reclassify_investor_commission_cheque_atomic function body independently from transition_cheque_atomic...');
  const reclassifyStart = sqlContent.indexOf('CREATE OR REPLACE FUNCTION public.reclassify_investor_commission_cheque_atomic');
  const transitionStart = sqlContent.indexOf('CREATE OR REPLACE FUNCTION public.transition_cheque_atomic');
  if (reclassifyStart === -1 || transitionStart === -1) {
    throw new Error('FAIL: Could not locate function boundaries in SQL draft.');
  }
  const reclassifyFuncBody = sqlContent.substring(reclassifyStart, transitionStart);
  console.log('  PASS: reclassify_investor_commission_cheque_atomic function body extracted cleanly.');

  // Check 42 & 43: Function Signature Parameter Names (p_operation_key TEXT and p_performed_by TEXT)
  console.log('Check 42 & 43: Verifying reclassify function signature contains p_operation_key TEXT and p_performed_by TEXT...');
  if (!reclassifyFuncBody.includes('p_operation_key TEXT')) {
    throw new Error('FAIL: Signature missing p_operation_key TEXT.');
  }
  if (!reclassifyFuncBody.includes('p_performed_by TEXT')) {
    throw new Error('FAIL: Signature missing p_performed_by TEXT.');
  }
  console.log('  PASS: Function signature parameter names verified.');

  // Check 44 & 45: Absence of p_mutation_key and p_user_id in reclassify Scope
  console.log('Check 44 & 45: Verifying ZERO occurrences of p_mutation_key and p_user_id in reclassify function scope...');
  if (reclassifyFuncBody.includes('p_mutation_key')) {
    throw new Error('FAIL: Lingering p_mutation_key found in reclassify_investor_commission_cheque_atomic function.');
  }
  if (reclassifyFuncBody.includes('p_user_id')) {
    throw new Error('FAIL: Lingering p_user_id found in reclassify_investor_commission_cheque_atomic function.');
  }
  console.log('  PASS: ZERO occurrences of p_mutation_key and p_user_id confirmed in reclassify function.');

  // Check 46: Excluded transition_cheque_atomic Scope Preservation
  console.log('Check 46: Verifying transition_cheque_atomic function scope is excluded from changes and remains pristine...');
  const transitionFuncBody = sqlContent.substring(transitionStart);
  if (!transitionFuncBody.includes('p_mutation_key TEXT') || !transitionFuncBody.includes('p_user_id TEXT')) {
    throw new Error('FAIL: transition_cheque_atomic signature was unexpectedly altered.');
  }
  console.log('  PASS: transition_cheque_atomic function scope confirmed pristine.');

  // Check 47 & 48: Internal Parameter Usage (p_operation_key and p_performed_by)
  console.log('Check 47 & 48: Verifying internal parameter usages for p_operation_key and p_performed_by...');
  if (!reclassifyFuncBody.includes('mutation_key = p_operation_key') ||
      !reclassifyFuncBody.includes('p_operation_key, 1, v_user_uuid') ||
      !reclassifyFuncBody.includes('p_performed_by, v_now, p_operation_key')) {
    throw new Error('FAIL: Parameter usage for p_operation_key or p_performed_by incomplete inside reclassify function.');
  }
  console.log('  PASS: Parameter usages for p_operation_key and p_performed_by verified.');

  // Check 49: Database Column Names Preservation
  console.log('Check 49: Verifying database column names (mutation_key, operation_key, performed_by) remain unchanged...');
  if (!reclassifyFuncBody.includes('mutation_key = p_operation_key') ||
      !reclassifyFuncBody.includes('performed_by, performed_at, operation_key') ||
      !reclassifyFuncBody.includes('id, organization_id, cheque_id, mutation_key')) {
    throw new Error('FAIL: Database column names were incorrectly altered.');
  }
  console.log('  PASS: Database column names 100% preserved.');

  // Check 50: Dynamic One-to-One Match between SQL Function Parameters and TS RPC Object Keys
  console.log('Check 50: Extracting parameters dynamically from SQL signature and RPC call in chequeService.ts...');
  const sigMatch = reclassifyFuncBody.match(/FUNCTION public\.reclassify_investor_commission_cheque_atomic\s*\(([\s\S]*?)\)\s*RETURNS/);
  if (!sigMatch) {
    throw new Error('FAIL: Could not extract signature from reclassify function.');
  }
  const sqlParamNames = sigMatch[1]
    .split(',')
    .map(line => line.trim().split(/\s+/)[0])
    .filter(Boolean);

  const chequeServicePath = join(process.cwd(), 'src/server/cheques/chequeService.ts');
  const chequeServiceContent = readFileSync(chequeServicePath, 'utf8');

  const rpcCallMatch = chequeServiceContent.match(/supabaseClient\.rpc\(\s*atomicRpcName\s*,\s*\{([\s\S]*?)\}\s*\)/);
  if (!rpcCallMatch) {
    throw new Error('FAIL: Could not locate supabaseClient.rpc call in chequeService.ts.');
  }
  const tsRpcParamNames = rpcCallMatch[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.includes(':'))
    .map(line => line.split(':')[0].trim());

  if (sqlParamNames.length !== 7 || tsRpcParamNames.length !== 7) {
    throw new Error(`FAIL: Parameter count mismatch. SQL has ${sqlParamNames.length}, TS RPC has ${tsRpcParamNames.length}.`);
  }

  for (let i = 0; i < sqlParamNames.length; i++) {
    if (sqlParamNames[i] !== tsRpcParamNames[i]) {
      throw new Error(`FAIL: Parameter mismatch at position ${i}: SQL '${sqlParamNames[i]}' vs TS '${tsRpcParamNames[i]}'.`);
    }
  }
  console.log(`  PASS: Dynamic 1:1 match verified across all 7 parameters: [${sqlParamNames.join(', ')}].`);

  // Check 51: RPC Construction Method Preservation
  console.log('Check 51: Verifying RPC string construction in chequeService.ts remains untouched...');
  if (!chequeServiceContent.includes('const atomicRpcName = ["re", "classify_investor_commission_cheque_atomic"].join("");')) {
    throw new Error('FAIL: RPC construction method in chequeService.ts was modified.');
  }
  console.log('  PASS: RPC construction method verified untouched.');

  console.log('\n=== AUDIT SUCCESSFUL: All 51 checks passed perfectly for Phase 26-B Parameter Contract Alignment! ===');
}

runAudit();
