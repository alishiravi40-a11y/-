import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// SHA-256 reference fingerprints calculated before draft creation
const ORIGINAL_MIGRATION_FINGERPRINTS: Record<string, string> = {
  '01_credit_files.sql': '703fa68d48bf705d0617a06b5d6bdb822157fb5dd843746e874e26663fb0677d',
  '02_base_infrastructure_auth.sql': 'c1937933ee3f71ce2b6d93aa201e69d081bfd85aaa560782ddae8ded0693938b',
  '03_persons_foundation.sql': 'b9d3a2b38e5dc3be40c041266058812af96ad37f8b8c2133666068ddf060f81f',
  '04_chart_of_accounts.sql': '03ced0710cd4bef1f2db4c6005f0ffb239295858086c2489c0d784ad4111af83',
  '05_journal_vouchers.sql': '3173e228671a7adb0c08e45b08a6c32cb44e41d874b02e3bf1dd352e10aa94b4',
  '06_inventory_master_data.sql': '4c2215f47224a68fcada9333f58627555de291140d50046c103f70771807d624',
  '07_inventory_ledger_foundation.sql': '50baa3536bd5ee49fe1a226a35e755b821a3bfe70b686b924be6203a6bdd14eb',
  '08_inventory_negative_override_authorization.sql': '4112bdc97abc1d2f3bc751e6137bd3affd021f2e79e4248ad7c5834eed36ae4d',
  '09_journal_voucher_draft_atomic_creation.sql': 'a3b38d37a03eee049e4e021d2354540fcbe7c4943df871ea837800f38d690922',
  '10_admin_bootstrap_transactional_function.sql': 'd1737b1ac9f222c855b916797556859c687efceccdf7cc2b1506679bcef7bdf6',
  '11_app_state_store_rls.sql': 'ebdbf96a72f1ff15d04c6a52a32388f07d9912996c5be7fba157eb6a3eb6e326',
  '12_coa_backfill_conflict_hardening.sql': 'c9f3fb75b7b2736dbe17729312d6dc79faf6514e1fb10c488f23d4c962ef8a16',
  '13_coa_backfill_full_conflict_hardening.sql': '1ebab349717ea3f13cfc79d3e7c3babbada642959309a7b398267a91b6f51de2',
  '14_installment_foundation.sql': '4589c2cc066bbf6fcb48647d5e713ed391aa2bc75ea4b5852668e20de79cc760',
  '15_invoices_foundation.sql': '61b3492a8a30425f86404034c19f69b76a654b92dca145674ec95b11451611b9',
  '16_invoice_update_atomic_foundation.sql': '6f8430721677bc52952b4e3f96ebedee303b2d4f571a8ab7ede234805ea7fd16',
  '17_invoice_atomic_void_function.sql': '7cc31a82bd80d2fb866609287a1c69f06f8499396670a21bee5f753f3f360a53',
  '18_order_invoice_conversions.sql': '28902bada3afe30f10486c2c72805c858da59046f549a5ca4460e46ebb1b5f6f',
  '19_cheques_foundation.sql': 'd2c03f4bdf3bb8112ced0c58a97459908b0125917da13b6e7f8b62ab4aa213ea',
  '20_cheque_atomic_create.sql': '6520f7eb24da06ff8b85d1fb161a478385b6c0a0d490627aa06f6ab6ccb50c2d',
  '21_cheque_atomic_transition.sql': '0a25cf1e30ca72b559a9bbb50d91534051589b7e752140bbfdaca808b20fcad9',
  '22_cheque_edit_reversal_foundation.sql': '392e6a0b96462525e0c981371169c16b80712f96746925e593e2aa7cb8b8df04',
  '23_invoice_cheques_orchestration.sql': '0295c39f627cb96dd793ee66e17f9691dd818b83f259cd63bf22cba6a7f3e5c7'
};

const TARGET_FUNCTIONS = [
  { name: 'get_next_invoice_number', migration: '15_invoices_foundation.sql' },
  { name: 'create_cheque_atomic', migration: '20_cheque_atomic_create.sql' },
  { name: 'transition_cheque_atomic', migration: '21_cheque_atomic_transition.sql' },
  { name: 'edit_cheque_atomic', migration: '22_cheque_edit_reversal_foundation.sql' },
  { name: 'reverse_cheque_atomic', migration: '22_cheque_edit_reversal_foundation.sql' },
  { name: 'delete_cheque_atomic', migration: '22_cheque_edit_reversal_foundation.sql' },
  { name: 'create_invoice_with_cheques_atomic', migration: '23_invoice_cheques_orchestration.sql' }
];

const BANNED_PATTERNS = [
  'TODO', 'STUB', 'MOCK', 'PLACEHOLDER', 'OMITTED', 'NOT IMPLEMENTED',
  'implementation omitted', 'body omitted', 'same as original', 'rest of function',
  'کد حذف شد', 'بدنه حذف شد', 'ادامه تابع', 'مشابه نسخه اصلی'
];

interface Token {
  type: 'keyword' | 'identifier' | 'number' | 'string' | 'operator' | 'punctuation' | 'whitespace' | 'comment';
  value: string;
}

function crypto_sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// SQL Lexer
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const char = sql[i];

    // 1. Comments
    if (char === '-' && sql[i + 1] === '-') {
      let val = '--';
      i += 2;
      while (i < len && sql[i] !== '\n') {
        val += sql[i];
        i++;
      }
      tokens.push({ type: 'comment', value: val });
      continue;
    }
    if (char === '/' && sql[i + 1] === '*') {
      let val = '/*';
      i += 2;
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
        val += sql[i];
        i++;
      }
      if (i < len) {
        val += '*/';
        i += 2;
      }
      tokens.push({ type: 'comment', value: val });
      continue;
    }

    // 2. Whitespace
    if (/\s/.test(char)) {
      let val = '';
      while (i < len && /\s/.test(sql[i])) {
        val += sql[i];
        i++;
      }
      tokens.push({ type: 'whitespace', value: val });
      continue;
    }

    // 3. Strings: '...'
    if (char === "'") {
      let val = "'";
      i++;
      while (i < len) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          val += "''";
          i += 2;
        } else if (sql[i] === "'") {
          val += "'";
          i++;
          break;
        } else {
          val += sql[i];
          i++;
        }
      }
      tokens.push({ type: 'string', value: val });
      continue;
    }

    // 4. Numbers
    if (/[0-9]/.test(char)) {
      let val = '';
      while (i < len && /[0-9.]/.test(sql[i])) {
        val += sql[i];
        i++;
      }
      tokens.push({ type: 'number', value: val });
      continue;
    }

    // 5. Identifiers
    if (/[a-zA-Z_]/.test(char)) {
      let val = '';
      while (i < len && /[a-zA-Z0-9_]/.test(sql[i])) {
        val += sql[i];
        i++;
      }
      tokens.push({ type: 'identifier', value: val });
      continue;
    }

    // 6. Dot separator
    if (char === '.') {
      tokens.push({ type: 'punctuation', value: '.' });
      i++;
      continue;
    }

    // 7. Operators and punctuation
    if (char === '|' && sql[i + 1] === '|') {
      tokens.push({ type: 'operator', value: '||' });
      i += 2;
      continue;
    }
    if (char === '<' && sql[i + 1] === '>') {
      tokens.push({ type: 'operator', value: '<>' });
      i += 2;
      continue;
    }
    if (char === '<' && sql[i + 1] === '=') {
      tokens.push({ type: 'operator', value: '<=' });
      i += 2;
      continue;
    }
    if (char === '>' && sql[i + 1] === '=') {
      tokens.push({ type: 'operator', value: '>=' });
      i += 2;
      continue;
    }
    if (char === ':' && sql[i + 1] === '=') {
      tokens.push({ type: 'operator', value: ':=' });
      i += 2;
      continue;
    }

    if (/[+\-*/=<>!~;(),[\]{}:%]/.test(char)) {
      tokens.push({ type: 'punctuation', value: char });
      i++;
      continue;
    }

    tokens.push({ type: 'punctuation', value: char });
    i++;
  }

  return tokens;
}

// SQL Normalizer
function normalizeTokens(tokens: Token[]): Token[] {
  // A. Filter comments and whitespace
  let filtered = tokens.filter(t => t.type !== 'comment' && t.type !== 'whitespace');

  // B. Normalize casing of identifiers (except string literals, numbers, punctuation)
  filtered = filtered.map(t => {
    if (t.type === 'identifier') {
      return { ...t, value: t.value.toLowerCase() };
    }
    return t;
  });

  // C. Strip prefixes "public." and "pg_catalog."
  const result: Token[] = [];
  let i = 0;
  while (i < filtered.length) {
    const t = filtered[i];
    if (
      t.type === 'identifier' &&
      (t.value === 'public' || t.value === 'pg_catalog') &&
      filtered[i + 1]?.type === 'punctuation' &&
      filtered[i + 1]?.value === '.' &&
      filtered[i + 2]?.type === 'identifier'
    ) {
      result.push(filtered[i + 2]);
      i += 3;
    } else {
      result.push(t);
      i++;
    }
  }

  // D. Strip trailing empty parenthesis "()" after "current_date"
  const finalResult: Token[] = [];
  let j = 0;
  while (j < result.length) {
    const t = result[j];
    if (
      t.type === 'identifier' &&
      t.value === 'current_date' &&
      result[j + 1]?.type === 'punctuation' &&
      result[j + 1]?.value === '(' &&
      result[j + 2]?.type === 'punctuation' &&
      result[j + 2]?.value === ')'
    ) {
      finalResult.push(t);
      j += 3;
    } else {
      finalResult.push(t);
      j++;
    }
  }

  return finalResult;
}

// Extract Function Body from SQL between Dollar Quotes
function extractBody(sql: string, functionName: string): string {
  const regex = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${functionName}\\s*\\(`, 'i');
  const match = sql.match(regex);
  if (!match || match.index === undefined) {
    throw new Error(`Function ${functionName} not found in SQL.`);
  }

  const startIndex = match.index;
  const bodyStartRegex = /AS\s+(\$[a-zA-Z0-9_]*\$)/i;
  const bodyStartMatch = sql.slice(startIndex).match(bodyStartRegex);
  if (!bodyStartMatch || bodyStartMatch.index === undefined) {
    throw new Error(`Body start tag not found for ${functionName}.`);
  }

  const dollarTag = bodyStartMatch[1];
  const dollarTagIndex = startIndex + bodyStartMatch.index + bodyStartMatch[0].length - dollarTag.length;
  const actualBodyStartIndex = dollarTagIndex + dollarTag.length;

  const bodyEndIndex = sql.indexOf(dollarTag, actualBodyStartIndex);
  if (bodyEndIndex === -1) {
    throw new Error(`Body end tag ${dollarTag} not found for ${functionName}.`);
  }

  return sql.slice(actualBodyStartIndex, bodyEndIndex);
}

function test_runner() {
  console.log('=== RIGOROUS SECURITY DEFINER & RLS HARDENING STATIC TESTRunner ===');

  let assertionCount = 0;
  const assert = (condition: boolean, message: string) => {
    assertionCount++;
    if (!condition) {
      throw new Error(`[Assertion Failure #${assertionCount}] ${message}`);
    }
  };

  // 1. Verify original migrations hashes (23 distinct file checks)
  console.log('[Phase 1] Verifying migrations 01-23 integrity...');
  for (const [filename, expectedHash] of Object.entries(ORIGINAL_MIGRATION_FINGERPRINTS)) {
    const filePath = path.join('supabase/migrations', filename);
    assert(fs.existsSync(filePath), `Migration file missing: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');
    const hash = crypto_sha256(content);
    assert(hash === expectedHash, `INTEGRITY VIOLATION: Migration ${filename} has been modified! Expected ${expectedHash}, got ${hash}`);
  }
  console.log(`✅ [23 Assertions] Verified untouched integrity of migrations 01 to 23.`);

  // 2. Draft file path verification
  console.log('[Phase 2] Verifying draft SQL file...');
  const draftPath = 'security/sql-drafts/rls_security_definer_hardening_draft.sql';
  assert(fs.existsSync(draftPath), `Draft file not found at: ${draftPath}`);
  const draftContent = fs.readFileSync(draftPath, 'utf8');
  console.log('✅ Verified draft SQL existence.');

  // 3. Security guards, lock locks, and execution blocks (8 distinct assertions)
  console.log('[Phase 3] Checking anti-accidental execution block & locks...');
  assert(draftContent.includes('DRAFT ONLY — NOT A MIGRATION — DO NOT EXECUTE'), 'Missing "DRAFT ONLY" header declaration.');
  assert(draftContent.startsWith('-- DRAFT ONLY — NOT A MIGRATION — DO NOT EXECUTE\n\nBEGIN;'), 'SQL draft must start with BEGIN; immediately after comments.');
  assert(draftContent.includes("RAISE EXCEPTION 'DRAFT ONLY: this SQL file must not be executed or applied as a migration';"), 'Missing anti-execution exception block.');
  assert(draftContent.trim().endsWith('ROLLBACK;'), 'Draft SQL file must strictly end with ROLLBACK; for absolute database execution lock.');

  // Policy Drops and Revocations
  assert(draftContent.includes('DROP POLICY IF EXISTS "Enable all access for authenticated users on cheques" ON public.cheques;'), 'Missing cheques broad policy removal.');
  assert(draftContent.includes('DROP POLICY IF EXISTS "Enable all access for authenticated users on order_invoice_conversions" ON public.order_invoice_conversions;'), 'Missing order_invoice_conversions broad policy removal.');
  assert(draftContent.includes('REVOKE ALL ON public.cheques FROM public, anon, authenticated;'), 'Missing revoke on cheques from public, anon, authenticated.');
  assert(draftContent.includes('REVOKE ALL ON public.order_invoice_conversions FROM public, anon, authenticated;'), 'Missing revoke on order_invoice_conversions from public, anon, authenticated.');
  console.log('✅ Verified safety locks, policy removals, and basic client-write blockades.');

  // 4. Checking the 7 hardened functions for SECURITY DEFINER and search_path attributes (14 assertions)
  console.log('[Phase 4] Verifying SECURITY DEFINER and search_path hardening...');
  const securityDefinerCount = (draftContent.match(/SECURITY DEFINER/g) || []).length;
  assert(securityDefinerCount >= 7, `Expected at least 7 SECURITY DEFINER declarations, found ${securityDefinerCount}`);

  const searchPathCount = (draftContent.match(/SET search_path = ''/g) || []).length;
  assert(searchPathCount >= 7, `Expected at least 7 SET search_path = '' declarations, found ${searchPathCount}`);

  assert(!draftContent.includes('search_path = public'), 'Forbidden unsecure "search_path = public" detected.');
  assert(!draftContent.includes('pg_temp'), 'Forbidden unsecure schema "pg_temp" detected.');

  // Check built-in functions naked rules (COALESCE, NULLIF, CASE, GREATEST, LEAST, CAST)
  assert(!draftContent.includes('pg_catalog.coalesce'), 'pg_catalog.coalesce is prohibited; must use naked COALESCE.');
  assert(!draftContent.includes('pg_catalog.nullif'), 'pg_catalog.nullif is prohibited; must use naked NULLIF.');
  assert(!draftContent.includes('pg_catalog.case'), 'pg_catalog.case is prohibited; must use naked CASE.');
  assert(!draftContent.includes('pg_catalog.greatest'), 'pg_catalog.greatest is prohibited; must use naked GREATEST.');
  assert(!draftContent.includes('pg_catalog.least'), 'pg_catalog.least is prohibited; must use naked LEAST.');
  assert(!draftContent.includes('pg_catalog.cast'), 'pg_catalog.cast is prohibited; must use naked CAST.');
  console.log('✅ Verified SECURITY DEFINER attribute rules and namespace isolation settings.');

  // 5. Check role permissions and revocations for the 7 functions (21 assertions)
  console.log('[Phase 5] Checking role execution revocations & grants...');
  for (const fn of TARGET_FUNCTIONS) {
    assert(draftContent.includes(`REVOKE EXECUTE ON FUNCTION public.${fn.name}`), `Missing REVOKE EXECUTE for function public.${fn.name}`);
    assert(draftContent.includes(`GRANT EXECUTE ON FUNCTION public.${fn.name}`), `Missing GRANT EXECUTE for function public.${fn.name}`);
    assert(draftContent.includes(`TO service_role;`), `Execution grants must be restricted to service_role.`);
    
    // Check no incomplete signatures
    const fnRegex = new RegExp(`(REVOKE|GRANT)\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn.name}\\s*\\([^)]*\\.{3}`, 'i');
    assert(!fnRegex.test(draftContent), `Incomplete signature or ellipsis (...) found in permissions statements for ${fn.name}.`);
  }
  console.log('✅ Verified perfect role execution controls and function privilege revocations.');

  // 6. Token matching & deep functional structure validation of all 7 target functions (14 assertions)
  console.log('[Phase 6] Extracting, tokenizing, normalizing, and comparing function bodies...');
  for (const fn of TARGET_FUNCTIONS) {
    const migrationFile = path.join('supabase/migrations', fn.migration);
    const mContent = fs.readFileSync(migrationFile, 'utf8');

    const mBody = extractBody(mContent, fn.name);
    const dBody = extractBody(draftContent, fn.name);

    // Deep check for banned stubs
    for (const word of BANNED_PATTERNS) {
      assert(!dBody.includes(word), `Forbidden stub marker "${word}" found in drafted body of ${fn.name}!`);
    }

    // Tokenize
    const mTokens = tokenize(mBody);
    const dTokens = tokenize(dBody);

    // Normalize
    const mNormalized = normalizeTokens(mTokens);
    const dNormalized = normalizeTokens(dTokens);

    // Compute hashes
    const mNormalizedStr = mNormalized.map(t => t.value).join(' ');
    const dNormalizedStr = dNormalized.map(t => t.value).join(' ');

    const mHash = crypto_sha256(mNormalizedStr);
    const dHash = crypto_sha256(dNormalizedStr);

    console.log(`- Function: ${fn.name}`);
    console.log(`  Reference (Migration) Hash: ${mHash}`);
    console.log(`  Hardened (Draft) Hash:      ${dHash}`);

    // If hashes don't match, report first difference and its index
    if (mHash !== dHash) {
      console.log(`❌ Mismatch detected in function ${fn.name}! Finding the first differing token...`);
      const maxLen = Math.max(mNormalized.length, dNormalized.length);
      for (let index = 0; index < maxLen; index++) {
        const mTok = mNormalized[index];
        const dTok = dNormalized[index];
        if (!mTok || !dTok || mTok.value !== dTok.value) {
          console.log(`First mismatch at token index ${index}:`);
          console.log(`  Reference Token: ${mTok ? `'${mTok.value}' [type: ${mTok.type}]` : 'EOF'}`);
          console.log(`  Draft Token:     ${dTok ? `'${dTok.value}' [type: ${dTok.type}]` : 'EOF'}`);
          
          // Print surrounding context
          const contextStart = Math.max(0, index - 5);
          const contextEnd = Math.min(maxLen - 1, index + 5);
          console.log('\nSurrounding reference context:');
          console.log(mNormalized.slice(contextStart, contextEnd).map((t, idx) => `${contextStart + idx === index ? '👉' : '  '} [${t.value}]`).join('\n'));
          console.log('\nSurrounding draft context:');
          console.log(dNormalized.slice(contextStart, contextEnd).map((t, idx) => `${contextStart + idx === index ? '👉' : '  '} [${t.value}]`).join('\n'));
          break;
        }
      }
      assert(mHash === dHash, `Functional structural mismatch between Reference and Draft in ${fn.name}!`);
    }
    assert(mHash === dHash, `SHA-256 normalized tokens match failed for ${fn.name}`);
  }
  console.log('✅ Token comparisons matched perfectly across all 7 functions.');

  console.log(`\n🎉 RIGOROUS VERIFICATION PASSED PERFECTLY! [Total AssertionsChecked: ${assertionCount}]`);
}

try {
  test_runner();
} catch (error: any) {
  console.error('\n❌ RIGOROUS VERIFICATION FAILED:');
  console.error(error.message);
  process.exit(1);
}
