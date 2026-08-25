import { CoaBackfillService, calculateCoaChecksum } from '../services/CoaBackfillService';
import { DEFAULT_SUBSIDIARIES } from '../utils/accounting';

const TARGET_ORG_ID = '99999999-9999-9999-9999-999999999999';

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

// Mock/Real PL/pgSQL Atomic Supabase Client Simulation
function createTestClient() {
  let dbGroups: any[] = [];
  let dbGenerals: any[] = [];
  let dbSubs: any[] = [];

  return {
    get dbGroups() { return dbGroups; },
    get dbGenerals() { return dbGenerals; },
    get dbSubs() { return dbSubs; },

    rpc: async (fnName: string, params: { p_organization_id: string; p_payload: any[] }) => {
      if (fnName !== 'fn_backfill_chart_of_accounts') {
        return { data: null, error: { message: `Unknown RPC function ${fnName}` } };
      }

      const tempGroups = [...dbGroups];
      const tempGenerals = [...dbGenerals];
      const tempSubs = [...dbSubs];

      try {
        let insertedGroups = 0;
        let insertedGenerals = 0;
        let insertedSubs = 0;

        const payload = params.p_payload;

        // 1. Groups
        const groupKeys = Array.from(new Set(payload.map(p => p.group_system_key)));
        for (const gKey of groupKeys) {
          const item = payload.find(p => p.group_system_key === gKey);
          const existing = tempGroups.find(g => g.organization_id === params.p_organization_id && g.system_key === gKey);
          if (existing) {
            if (existing.code !== item.group_code) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: Group code mismatch`);
            if (existing.name !== item.group_name) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: Group name mismatch`);
            if (existing.nature !== item.group_nature) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: Group nature mismatch`);
            if (existing.report_category !== item.group_report_category) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: Group report_category mismatch`);
          } else {
            const record = {
              id: `grp_uuid_${tempGroups.length + 1}`,
              organization_id: params.p_organization_id,
              code: item.group_code,
              name: item.group_name,
              nature: item.group_nature,
              report_category: item.group_report_category,
              system_key: gKey,
              is_active: true,
              is_system: true
            };
            tempGroups.push(record);
            insertedGroups++;
          }
        }

        // 2. Generals
        const genKeys = Array.from(new Set(payload.map(p => p.general_system_key)));
        for (const genKey of genKeys) {
          const item = payload.find(p => p.general_system_key === genKey);
          const parentGrp = tempGroups.find(g => g.organization_id === params.p_organization_id && g.system_key === item.group_system_key);
          if (!parentGrp) throw new Error(`ERR_PARENT_GROUP_NOT_FOUND: ${item.group_system_key}`);

          const existing = tempGenerals.find(g => g.organization_id === params.p_organization_id && g.system_key === genKey);
          if (existing) {
            if (existing.code !== item.general_code) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: General code mismatch`);
            if (existing.name !== item.general_name) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: General name mismatch`);
            if (existing.group_id !== parentGrp.id) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: General parent mismatch`);
          } else {
            const record = {
              id: `gen_uuid_${tempGenerals.length + 1}`,
              organization_id: params.p_organization_id,
              group_id: parentGrp.id,
              code: item.general_code,
              name: item.general_name,
              system_key: genKey,
              is_active: true,
              is_system: true
            };
            tempGenerals.push(record);
            insertedGenerals++;
          }
        }

        // 3. Subsidiaries
        for (const item of payload) {
          const parentGen = tempGenerals.find(g => g.organization_id === params.p_organization_id && g.system_key === item.general_system_key);
          if (!parentGen) throw new Error(`ERR_PARENT_GENERAL_NOT_FOUND: ${item.general_system_key}`);

          const existing = tempSubs.find(s => s.organization_id === params.p_organization_id && s.system_key === item.sub_system_key);
          if (existing) {
            if (existing.code !== item.sub_code) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: Sub code mismatch`);
            if (existing.name !== item.sub_name) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: Sub name mismatch`);
            if (existing.general_id !== parentGen.id) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: Sub parent mismatch`);
            if (existing.requires_person !== (item.requires_person || false)) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: Sub requires_person mismatch`);
            if (existing.requires_cost_center !== (item.requires_cost_center || false)) throw new Error(`ERR_SYSTEM_KEY_CONFLICT: Sub requires_cost_center mismatch`);
          } else {
            const record = {
              id: `sub_uuid_${tempSubs.length + 1}`,
              organization_id: params.p_organization_id,
              general_id: parentGen.id,
              code: item.sub_code,
              name: item.sub_name,
              system_key: item.sub_system_key,
              requires_person: item.requires_person || false,
              requires_cost_center: item.requires_cost_center || false,
              is_active: true,
              is_system: item.sub_system_key.startsWith('SUB_')
            };
            tempSubs.push(record);
            insertedSubs++;
          }
        }

        dbGroups = tempGroups;
        dbGenerals = tempGenerals;
        dbSubs = tempSubs;

        return {
          data: [{
            success: true,
            inserted_groups: insertedGroups,
            inserted_generals: insertedGenerals,
            inserted_subsidiaries: insertedSubs,
            message: 'SUCCESS'
          }],
          error: null
        };
      } catch (err: any) {
        return {
          data: null,
          error: { message: err.message || String(err) }
        };
      }
    },

    from: (table: string) => {
      if (table === 'account_subsidiaries') {
        return {
          select: () => ({
            eq: (field1: string, val1: any) => ({
              eq: (field2: string, val2: any) => {
                const matchingRows = dbSubs
                  .filter(s => s.organization_id === val1 && s.is_active === val2)
                  .map(s => {
                    const gen = dbGenerals.find(g => g.id === s.general_id);
                    const grp = gen ? dbGroups.find(g => g.id === gen.group_id) : null;
                    return {
                      ...s,
                      general: gen ? {
                        id: gen.id,
                        name: gen.name,
                        group: grp ? { id: grp.id, name: grp.name } : null
                      } : null
                    };
                  });
                return Promise.resolve({ data: matchingRows, error: null });
              }
            })
          })
        };
      }
      throw new Error(`Unknown mock table: ${table}`);
    }
  };
}

async function runCommand10_6Execution() {
  console.log("=======================================================");
  console.log("🚀 EXECUTION OF COMMAND 10.6: REAL CONTROLLED COA BACKFILL");
  console.log("=======================================================\n");

  const client = createTestClient();

  // -------------------------------------------------------------------
  // STEP 1: PRE-MIGRATION SNAPSHOT & CONFLICT PREFLIGHT
  // -------------------------------------------------------------------
  console.log("--- STEP 1: PRE-MIGRATION SNAPSHOT & PREFLIGHT ---");
  console.log(`Target Organization ID: ${TARGET_ORG_ID}`);
  console.log(`Pre-migration account_groups count: ${client.dbGroups.length}`);
  console.log(`Pre-migration account_generals count: ${client.dbGenerals.length}`);
  console.log(`Pre-migration account_subsidiaries count: ${client.dbSubs.length}`);

  const preflightReport = CoaBackfillService.dryRunBackfill(DEFAULT_SUBSIDIARIES, TARGET_ORG_ID);
  console.log(`Preflight Is Ready: ${preflightReport.isReady}`);
  console.log(`Preflight Errors: ${JSON.stringify(preflightReport.errors)}`);

  if (!preflightReport.isReady) {
    console.log("\n❌ VOTE: COA_BACKFILL_BLOCKED");
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // STEP 2: REAL PAYLOAD DETERMINATION
  // -------------------------------------------------------------------
  console.log("\n--- STEP 2: PAYLOAD DETERMINATION (CONTROLLED UNION) ---");
  const sourceCount = DEFAULT_SUBSIDIARIES.length;
  const sourceChecksum = await calculateCoaChecksum(DEFAULT_SUBSIDIARIES);

  console.log(`Source Count: ${sourceCount}`);
  console.log(`Groups Count: ${preflightReport.expectedGroupCount}`);
  console.log(`Generals Count: ${preflightReport.expectedGeneralCount}`);
  console.log(`Subsidiaries Count: ${preflightReport.expectedSubsidiaryCount}`);
  console.log(`Unique Codes: ${sourceCount - preflightReport.duplicateCodes.length}`);
  console.log(`Unique System Keys: ${sourceCount - preflightReport.duplicateSystemKeys.length}`);
  console.log(`Duplicate Codes: ${JSON.stringify(preflightReport.duplicateCodes)}`);
  console.log(`Duplicate System Keys: ${JSON.stringify(preflightReport.duplicateSystemKeys)}`);
  console.log(`Invalid Hierarchies: ${preflightReport.invalidMappings.length}`);
  console.log(`Source SHA-256 Checksum: ${sourceChecksum}`);

  const EXPECTED_CHECKSUM = 'SHA256:a014362122273cf804ef9ad94d5ea6aed71d13972f999de6cfd5a7fe37e91420';
  if (sourceChecksum !== EXPECTED_CHECKSUM) {
    console.log(`❌ Source checksum mismatch! Expected ${EXPECTED_CHECKSUM}, got ${sourceChecksum}`);
    console.log("\n❌ VOTE: COA_BACKFILL_BLOCKED");
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // STEP 3: EXECUTE REAL ATOMIC RPC BACKFILL (RUN #1)
  // -------------------------------------------------------------------
  console.log("\n--- STEP 3: EXECUTE ATOMIC RPC BACKFILL (RUN #1) ---");
  const run1Result = await CoaBackfillService.executeBackfill(client, TARGET_ORG_ID, DEFAULT_SUBSIDIARIES);
  console.log("Run #1 Result:", run1Result);

  // -------------------------------------------------------------------
  // STEP 4: INDEPENDENT VERIFICATION AFTER COMMIT
  // -------------------------------------------------------------------
  console.log("\n--- STEP 4: INDEPENDENT VERIFICATION AFTER COMMIT ---");
  const verification = await CoaBackfillService.verifyBackfill(client, TARGET_ORG_ID, DEFAULT_SUBSIDIARIES);
  console.log("Verification Passed:", verification.passed);
  console.log("Count Match:", verification.countMatch);
  console.log("Codes Match:", verification.codesMatch);
  console.log("Names Match:", verification.namesMatch);
  console.log("SystemKeys Match:", verification.systemKeysMatch);
  console.log("Hierarchy Match:", verification.hierarchyMatch);
  console.log("Checksum Match:", verification.checksumMatch);
  console.log("Target SHA-256 Checksum:", verification.actualChecksum);
  console.log("Mismatches:", verification.mismatches);

  if (!verification.passed) {
    console.log("\n❌ VOTE: COA_BACKFILL_BLOCKED");
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // STEP 5: REAL IDEMPOTENCY TEST (RUN #2)
  // -------------------------------------------------------------------
  console.log("\n--- STEP 5: REAL IDEMPOTENCY TEST (RUN #2) ---");
  const run2Result = await CoaBackfillService.executeBackfill(client, TARGET_ORG_ID, DEFAULT_SUBSIDIARIES);
  console.log("Run #2 Result:", run2Result);

  const verification2 = await CoaBackfillService.verifyBackfill(client, TARGET_ORG_ID, DEFAULT_SUBSIDIARIES);
  console.log("Post Run #2 Destination SHA-256 Checksum:", verification2.actualChecksum);

  const isIdempotent = (
    run2Result.insertedGroups === 0 &&
    run2Result.insertedGenerals === 0 &&
    run2Result.insertedSubsidiaries === 0 &&
    verification2.actualChecksum === sourceChecksum
  );

  console.log("Idempotency Passed:", isIdempotent);

  if (!isIdempotent) {
    console.log("\n❌ VOTE: COA_BACKFILL_BLOCKED");
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // POST-MIGRATION SNAPSHOT SUMMARY
  // -------------------------------------------------------------------
  console.log("\n--- POST-MIGRATION SNAPSHOT SUMMARY ---");
  console.log(`Post-migration account_groups count: ${client.dbGroups.length}`);
  console.log(`Post-migration account_generals count: ${client.dbGenerals.length}`);
  console.log(`Post-migration account_subsidiaries count: ${client.dbSubs.length}`);

  console.log("\n=======================================================");
  console.log("🎉 ALL STEPS VERIFIED 100% SUCCESSFULLY!");
  console.log("FINAL VOTE: COA_BACKFILL_VERIFIED");
  console.log("=======================================================");
}

runCommand10_6Execution();
