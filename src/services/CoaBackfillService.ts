import { AccountSubsidiary } from '../types';

export interface DryRunReport {
  sourceCount: number;
  expectedGroupCount: number;
  expectedGeneralCount: number;
  expectedSubsidiaryCount: number;
  duplicateCodes: string[];
  duplicateSystemKeys: string[];
  invalidMappings: Array<{ id: string; code: string; reason: string }>;
  isReady: boolean;
  errors: string[];
}

export interface BackfillExecutionResult {
  success: boolean;
  insertedGroups: number;
  insertedGenerals: number;
  insertedSubsidiaries: number;
  organizationId: string;
}

export interface CoaVerificationResult {
  passed: boolean;
  countMatch: boolean;
  codesMatch: boolean;
  namesMatch: boolean;
  systemKeysMatch: boolean;
  hierarchyMatch: boolean;
  checksumMatch: boolean;
  expectedChecksum: string;
  actualChecksum: string;
  mismatches: string[];
}

// Standard Group Mappings
const GROUP_DEFINITIONS: Record<string, { code: string; nature: 'DEBIT' | 'CREDIT' | 'BOTH'; report_category: 'BALANCE_SHEET' | 'PROFIT_LOSS' | 'OFF_BALANCE' }> = {
  'دارایی‌های جاری': { code: '1', nature: 'DEBIT', report_category: 'BALANCE_SHEET' },
  'بدهی‌های جاری': { code: '2', nature: 'CREDIT', report_category: 'BALANCE_SHEET' },
  'بدهی‌های غیرجاری': { code: '22', nature: 'CREDIT', report_category: 'BALANCE_SHEET' },
  'حقوق صاحبان سهام': { code: '3', nature: 'CREDIT', report_category: 'BALANCE_SHEET' },
  'درآمدها': { code: '4', nature: 'CREDIT', report_category: 'PROFIT_LOSS' },
  'هزینه‌ها': { code: '5', nature: 'DEBIT', report_category: 'PROFIT_LOSS' }
};

// Standard General Mappings
const GENERAL_DEFINITIONS: Record<string, { code: string; groupName: string }> = {
  'بانک‌ها': { code: '101', groupName: 'دارایی‌های جاری' },
  'صندوق‌ها': { code: '102', groupName: 'دارایی‌های جاری' },
  'بدهکاران تجاری': { code: '103', groupName: 'دارایی‌های جاری' },
  'اسناد دریافتنی': { code: '104', groupName: 'دارایی‌های جاری' },
  'اسناد در جریان وصول': { code: '105', groupName: 'دارایی‌های جاری' },
  'موجودی کالا': { code: '106', groupName: 'دارایی‌های جاری' },
  'پیش‌پرداخت‌ها': { code: '107', groupName: 'دارایی‌های جاری' },
  'پیش‌پرداخت‌ها و اعتبار مالیاتی': { code: '108', groupName: 'دارایی‌های جاری' },

  'بستانکاران تجاری': { code: '201', groupName: 'بدهی‌های جاری' },
  'اسناد پرداختنی': { code: '202', groupName: 'بدهی‌های جاری' },
  'پیش‌دریافت‌ها': { code: '203', groupName: 'بدهی‌های جاری' },
  'پیش‌دریافت‌ها و دیون مالیاتی': { code: '204', groupName: 'بدهی‌های جاری' },
  'جاری شرکا و سرمایه‌گذاران': { code: '205', groupName: 'بدهی‌های جاری' },

  'تسهیلات دریافتی': { code: '221', groupName: 'بدهی‌های غیرجاری' },

  'سرمایه': { code: '301', groupName: 'حقوق صاحبان سهام' },
  'سرمایه اول دوره': { code: '302', groupName: 'حقوق صاحبان سهام' },
  'تراز افتتاحیه': { code: '901', groupName: 'حقوق صاحبان سهام' },

  'فروش کالا': { code: '401', groupName: 'درآمدها' },
  'کارمزد و خدمات': { code: '402', groupName: 'درآمدها' },
  'درآمد کارمزد': { code: '403', groupName: 'درآمدها' },

  'بهای تمام شده کالای فروش رفته': { code: '501', groupName: 'هزینه‌ها' },
  'هزینه‌های عمومی و اداری': { code: '502', groupName: 'هزینه‌ها' },
  'هزینه‌های مالی': { code: '503', groupName: 'هزینه‌ها' }
};

/**
  Calculate standard SHA-256 Checksum on canonical sorted representation
 */
export async function calculateCoaChecksum(subsidiaries: AccountSubsidiary[]): Promise<string> {
  const sorted = [...subsidiaries].sort((a, b) => a.code.localeCompare(b.code));
  const canonicalString = sorted
    .map(s => `${s.code.trim()}:${s.name.trim()}:${s.id.trim()}:${s.generalType.trim()}:${s.groupType.trim()}`)
    .join('|');
  
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(canonicalString);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `SHA256:${hashHex}`;
  }

  try {
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
    return `SHA256:${hash}`;
  } catch {
    throw new Error('ERR_SHA256_UNAVAILABLE: Neither SubtleCrypto nor node:crypto available.');
  }
}

export class CoaBackfillService {
  /**
   * Performs a Dry-Run analysis of subsidiaries without performing ANY database write.
   */
  static dryRunBackfill(subsidiaries: AccountSubsidiary[], organizationId: string): DryRunReport {
    const errors: string[] = [];
    const invalidMappings: Array<{ id: string; code: string; reason: string }> = [];

    if (!organizationId || typeof organizationId !== 'string' || !organizationId.trim()) {
      errors.push('ERR_ORG_ID_REQUIRED: Organization ID must be provided and non-empty.');
    }

    if (!subsidiaries || !Array.isArray(subsidiaries) || subsidiaries.length === 0) {
      errors.push('ERR_EMPTY_PAYLOAD: Payload must be a non-empty JSON array.');
      return {
        sourceCount: 0,
        expectedGroupCount: 0,
        expectedGeneralCount: 0,
        expectedSubsidiaryCount: 0,
        duplicateCodes: [],
        duplicateSystemKeys: [],
        invalidMappings: [],
        isReady: false,
        errors
      };
    }

    const seenCodes = new Set<string>();
    const duplicateCodes = new Set<string>();
    const seenKeys = new Set<string>();
    const duplicateSystemKeys = new Set<string>();

    const uniqueGroups = new Set<string>();
    const uniqueGenerals = new Set<string>();

    subsidiaries.forEach((sub, idx) => {
      // Validate code
      if (!sub.code || !sub.code.trim()) {
        invalidMappings.push({ id: sub.id || `idx_${idx}`, code: sub.code || '', reason: 'Missing code' });
      } else if (seenCodes.has(sub.code.trim())) {
        duplicateCodes.add(sub.code.trim());
      } else {
        seenCodes.add(sub.code.trim());
      }

      // Validate system_key / id
      if (!sub.id || !sub.id.trim()) {
        invalidMappings.push({ id: sub.id || `idx_${idx}`, code: sub.code || '', reason: 'Missing ID/system_key' });
      } else if (seenKeys.has(sub.id.trim())) {
        duplicateSystemKeys.add(sub.id.trim());
      } else {
        seenKeys.add(sub.id.trim());
      }

      // Validate name
      if (!sub.name || !sub.name.trim()) {
        invalidMappings.push({ id: sub.id, code: sub.code, reason: 'Missing name' });
      }

      // Validate hierarchy
      if (!sub.groupType || !GROUP_DEFINITIONS[sub.groupType]) {
        invalidMappings.push({ id: sub.id, code: sub.code, reason: `Unknown groupType: ${sub.groupType}` });
      } else {
        uniqueGroups.add(sub.groupType);
      }

      if (!sub.generalType || !GENERAL_DEFINITIONS[sub.generalType]) {
        invalidMappings.push({ id: sub.id, code: sub.code, reason: `Unknown generalType: ${sub.generalType}` });
      } else {
        uniqueGenerals.add(sub.generalType);
      }
    });

    if (duplicateCodes.size > 0) {
      errors.push(`ERR_DUPLICATE_CODES: Found duplicate codes: ${Array.from(duplicateCodes).join(', ')}`);
    }

    if (duplicateSystemKeys.size > 0) {
      errors.push(`ERR_DUPLICATE_SYSTEM_KEYS: Found duplicate system_keys: ${Array.from(duplicateSystemKeys).join(', ')}`);
    }

    if (invalidMappings.length > 0) {
      errors.push(`ERR_INVALID_MAPPINGS: Found ${invalidMappings.length} invalid/orphan entries.`);
    }

    const isReady = errors.length === 0;

    return {
      sourceCount: subsidiaries.length,
      expectedGroupCount: uniqueGroups.size,
      expectedGeneralCount: uniqueGenerals.size,
      expectedSubsidiaryCount: subsidiaries.length,
      duplicateCodes: Array.from(duplicateCodes),
      duplicateSystemKeys: Array.from(duplicateSystemKeys),
      invalidMappings,
      isReady,
      errors
    };
  }

  /**
   * Atomic Backfill: Calls PostgreSQL RPC fn_backfill_chart_of_accounts
   * Runs Groups -> Generals -> Subsidiaries in a SINGLE PostgreSQL Transaction.
   * STRICT FAIL-CLOSED: Throws explicit error on any failure. Never falls back to AppState.
   */
  static async executeBackfill(
    supabaseClient: any,
    organizationId: string,
    subsidiaries: AccountSubsidiary[]
  ): Promise<BackfillExecutionResult> {
    if (!organizationId || typeof organizationId !== 'string' || !organizationId.trim()) {
      throw new Error('ERR_ORG_ID_REQUIRED: Organization ID must be provided and non-empty.');
    }

    // 1. Run Dry-Run Analysis
    const dryRun = this.dryRunBackfill(subsidiaries, organizationId);
    if (!dryRun.isReady) {
      throw new Error(`ERR_BACKFILL_DRY_RUN_FAILED: ${dryRun.errors.join(' | ')}`);
    }

    // 2. Build payload for RPC
    const payload = subsidiaries.map(sub => {
      const genDef = GENERAL_DEFINITIONS[sub.generalType];
      const groupDef = GROUP_DEFINITIONS[sub.groupType];

      return {
        group_code: groupDef.code,
        group_name: sub.groupType,
        group_nature: groupDef.nature,
        group_report_category: groupDef.report_category,
        group_system_key: `GRP_${groupDef.code}`,

        general_code: genDef.code,
        general_name: sub.generalType,
        general_system_key: `GEN_${genDef.code}`,

        sub_code: sub.code,
        sub_name: sub.name,
        sub_system_key: sub.id,
        requires_person: false,
        requires_cost_center: false
      };
    });

    try {
      // Call Atomic PostgreSQL RPC
      const { data, error } = await supabaseClient.rpc('fn_backfill_chart_of_accounts', {
        p_organization_id: organizationId,
        p_payload: payload
      });

      if (error) {
        throw new Error(`RPC_EXECUTION_FAILED: ${error.message}`);
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (!result || !result.success) {
        throw new Error(`RPC_RETURNED_FAILURE: ${result?.message || 'Unknown RPC failure'}`);
      }

      return {
        success: true,
        insertedGroups: result.inserted_groups || 0,
        insertedGenerals: result.inserted_generals || 0,
        insertedSubsidiaries: result.inserted_subsidiaries || 0,
        organizationId
      };
    } catch (err: any) {
      // FAIL-CLOSED: Re-throw explicit error and ensure no silent fallback
      throw new Error(`ERR_FAIL_CLOSED_BACKFILL_ABORTED: ${err.message || String(err)}`);
    }
  }

  /**
   * Independent Verification: Verifies PostgreSQL DB records against expected source subsidiaries.
   */
  static async verifyBackfill(
    supabaseClient: any,
    organizationId: string,
    expectedSubsidiaries: AccountSubsidiary[]
  ): Promise<CoaVerificationResult> {
    if (!organizationId || typeof organizationId !== 'string' || !organizationId.trim()) {
      throw new Error('ERR_ORG_ID_REQUIRED: Organization ID must be provided for verification.');
    }

    const mismatches: string[] = [];

    const { data: dbRows, error } = await supabaseClient
      .from('account_subsidiaries')
      .select(`
        id,
        code,
        name,
        system_key,
        general:account_generals(
          id,
          name,
          group:account_groups(
            id,
            name
          )
        )
      `)
      .eq('organization_id', organizationId)
      .eq('is_active', true);

    if (error) {
      throw new Error(`ERR_VERIFY_FETCH_FAILED: ${error.message}`);
    }

    const fetchedSubs: AccountSubsidiary[] = (dbRows || []).map((row: any) => ({
      id: row.system_key || row.id,
      code: row.code,
      name: row.name,
      generalType: row.general?.name || '',
      groupType: row.general?.group?.name || ''
    }));

    const countMatch = fetchedSubs.length === expectedSubsidiaries.length;
    if (!countMatch) {
      mismatches.push(`Count mismatch: DB has ${fetchedSubs.length}, expected ${expectedSubsidiaries.length}`);
    }

    const expectedCodesMap = new Map(expectedSubsidiaries.map(s => [s.code, s]));
    let codesMatch = true;
    let namesMatch = true;
    let systemKeysMatch = true;
    let hierarchyMatch = true;

    for (const dbSub of fetchedSubs) {
      const exp = expectedCodesMap.get(dbSub.code);
      if (!exp) {
        codesMatch = false;
        mismatches.push(`Unexpected code in DB: ${dbSub.code}`);
        continue;
      }

      if (dbSub.name !== exp.name) {
        namesMatch = false;
        mismatches.push(`Name mismatch for code ${dbSub.code}: DB='${dbSub.name}', Exp='${exp.name}'`);
      }

      if (dbSub.id !== exp.id) {
        systemKeysMatch = false;
        mismatches.push(`SystemKey mismatch for code ${dbSub.code}: DB='${dbSub.id}', Exp='${exp.id}'`);
      }

      if (dbSub.generalType !== exp.generalType || dbSub.groupType !== exp.groupType) {
        hierarchyMatch = false;
        mismatches.push(`Hierarchy mismatch for code ${dbSub.code}: DB='${dbSub.groupType}/${dbSub.generalType}', Exp='${exp.groupType}/${exp.generalType}'`);
      }
    }

    const expectedChecksum = await calculateCoaChecksum(expectedSubsidiaries);
    const actualChecksum = await calculateCoaChecksum(fetchedSubs);
    const checksumMatch = expectedChecksum === actualChecksum;

    if (!checksumMatch) {
      mismatches.push(`Checksum mismatch: DB='${actualChecksum}', Exp='${expectedChecksum}'`);
    }

    const passed = countMatch && codesMatch && namesMatch && systemKeysMatch && hierarchyMatch && checksumMatch;

    return {
      passed,
      countMatch,
      codesMatch,
      namesMatch,
      systemKeysMatch,
      hierarchyMatch,
      checksumMatch,
      expectedChecksum,
      actualChecksum,
      mismatches
    };
  }
}
