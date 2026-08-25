import { JournalVoucher } from '../types';
import { CreateDraftVoucherParams } from './JournalVoucherRpcService';
import { jalaliToGregorian, validateJalaliDate, parseSafeJalali } from '../utils/jalali';

export interface MigrationMapperContext {
  organizationId: string;
  branchId: string;
  fiscalYearId: string;
  operationKey: string;
  requestFingerprint: string;
  subsidiaryMap: Map<string, string>; // legacy code/id -> UUID
  personMap: Map<string, string>; // legacy code/id -> UUID
}

/**
 * Pure, isolated migration mapper that transforms a legacy JournalVoucher
 * into the exact payload required by create_draft_journal_voucher RPC.
 * 
 * - Performs strict lookups (fails explicitly if subsidiary or person UUID is missing).
 * - Enforces strict amount validations (Number.isFinite, Number.isInteger, Number.isSafeInteger, >= 0, no simultaneous debit & credit).
 * - Enforces date parsing & conversion (Gregorian / Jalali -> YYYY-MM-DD).
 * - Rejects unsupported floatingDetailed types ('product', 'other') with explicit error.
 * - Enforces mandatory valid Context.
 */
export class JournalVoucherMigrationMapper {
  private static validateContext(context: MigrationMapperContext): void {
    if (!context) {
      throw new Error('MigrationMapper Error: Context is missing.');
    }
    const requiredFields: (keyof MigrationMapperContext)[] = [
      'organizationId',
      'branchId',
      'fiscalYearId',
      'operationKey',
      'requestFingerprint',
    ];
    for (const field of requiredFields) {
      const val = context[field];
      if (!val || typeof val !== 'string' || val.trim() === '') {
        throw new Error(`MigrationMapper Error: Context field "${field}" is missing, empty, or invalid.`);
      }
    }
  }

  private static parseAndFormatDate(voucher: JournalVoucher): string {
    const rawDate = voucher.gregorianDate || voucher.date;
    if (!rawDate || typeof rawDate !== 'string' || rawDate.trim() === '') {
      throw new Error(`MigrationMapper Error: Voucher ${voucher.id} is missing a valid date.`);
    }

    const cleanDate = rawDate.trim();

    // Check if Gregorian ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss...)
    if (/^\d{4}-\d{2}-\d{2}/.test(cleanDate)) {
      return cleanDate.split('T')[0];
    }

    // Check if Jalali format (YYYY/MM/DD or with hyphens/dots)
    const normalizedJalali = cleanDate.replace(/[-.\s\\]/g, '/');
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(normalizedJalali)) {
      if (!validateJalaliDate(normalizedJalali)) {
        throw new Error(`MigrationMapper Error: Invalid Jalali date format or value: "${rawDate}" in voucher ${voucher.id}.`);
      }
      const parsed = parseSafeJalali(normalizedJalali);
      if (!parsed) {
        throw new Error(`MigrationMapper Error: Failed to parse Jalali date: "${rawDate}" in voucher ${voucher.id}.`);
      }
      const gDate = jalaliToGregorian(parsed.jy, parsed.jm, parsed.jd);
      if (isNaN(gDate.getTime())) {
        throw new Error(`MigrationMapper Error: Jalali to Gregorian conversion failed for: "${rawDate}" in voucher ${voucher.id}.`);
      }
      const gy = gDate.getFullYear();
      const gm = String(gDate.getMonth() + 1).padStart(2, '0');
      const gd = String(gDate.getDate()).padStart(2, '0');
      return `${gy}-${gm}-${gd}`;
    }

    throw new Error(`MigrationMapper Error: Unrecognized or invalid date format: "${rawDate}" in voucher ${voucher.id}.`);
  }

  public static mapToDraftParams(
    voucher: JournalVoucher,
    context: MigrationMapperContext
  ): CreateDraftVoucherParams {
    if (!voucher) {
      throw new Error('MigrationMapper Error: Voucher input is null or undefined.');
    }

    JournalVoucherMigrationMapper.validateContext(context);

    if (!voucher.entries || voucher.entries.length === 0) {
      throw new Error(`MigrationMapper Error: Voucher ${voucher.id} contains no entries.`);
    }

    // 1. Map and validate date
    const voucherDate = JournalVoucherMigrationMapper.parseAndFormatDate(voucher);

    // 2. Map entries with strict validations and lookups
    const mappedEntries = voucher.entries.map((entry, index) => {
      const rowNumber = index + 1;

      // Subsidiary lookup
      const legacySubId = entry.subsidiaryId;
      if (!legacySubId) {
        throw new Error(`MigrationMapper Error: Entry row ${rowNumber} in voucher ${voucher.id} is missing subsidiaryId.`);
      }

      const dbSubsidiaryId = context.subsidiaryMap.get(legacySubId);
      if (!dbSubsidiaryId) {
        throw new Error(
          `MigrationMapper Error: Subsidiary lookup failed for legacy identifier "${legacySubId}" in entry row ${rowNumber} of voucher ${voucher.id}.`
        );
      }

      // Floating Detailed & Person lookup
      let dbPersonId: string | null = null;
      if (entry.floatingDetailed) {
        const fType = entry.floatingDetailed.type;
        if (fType === 'product' || fType === 'other') {
          throw new Error(
            `MigrationMapper Error [UNSUPPORTED_FLOATING_DETAILED_TYPE]: Floating detailed type "${fType}" is not supported in entry row ${rowNumber} of voucher ${voucher.id}.`
          );
        }
        if (fType === 'person') {
          const legacyPersonId = entry.floatingDetailed.id;
          if (!legacyPersonId) {
            throw new Error(`MigrationMapper Error: Floating detailed person entry row ${rowNumber} in voucher ${voucher.id} is missing person id.`);
          }
          const resolvedPersonId = context.personMap.get(legacyPersonId);
          if (!resolvedPersonId) {
            throw new Error(
              `MigrationMapper Error: Person lookup failed for legacy identifier "${legacyPersonId}" in entry row ${rowNumber} of voucher ${voucher.id}.`
            );
          }
          dbPersonId = resolvedPersonId;
        }
      }

      // Strict amount validation (No rounding, no truncate, explicit fail on unsafe/float/negative/both positive)
      const debit = entry.debit;
      const credit = entry.credit;

      const amounts = [debit, credit];
      for (const amt of amounts) {
        if (typeof amt !== 'number' || !Number.isFinite(amt) || !Number.isInteger(amt) || !Number.isSafeInteger(amt)) {
          throw new Error(`MigrationMapper Error: Invalid amount type or precision (must be safe integer). Got ${amt} in entry row ${rowNumber} of voucher ${voucher.id}.`);
        }
        if (amt < 0) {
          throw new Error(`MigrationMapper Error: Negative amount detected (${amt}) in entry row ${rowNumber} of voucher ${voucher.id}.`);
        }
      }

      if (debit > 0 && credit > 0) {
        throw new Error(`MigrationMapper Error: Simultaneous positive debit (${debit}) and credit (${credit}) in entry row ${rowNumber} of voucher ${voucher.id}.`);
      }

      if (debit === 0 && credit === 0) {
        // Warning or allowed depending on policy, but both 0 is generally fine or can be checked. Allowed here.
      }

      return {
        rowNumber,
        subsidiaryId: dbSubsidiaryId,
        personId: dbPersonId,
        costCenterId: null,
        debit,
        credit,
        description: entry.description || voucher.description || null,
        financialRoleCode: null,
        contractType: entry.contractType || voucher.contractType || null,
      };
    });

    // 3. Construct payload
    const payload: CreateDraftVoucherParams = {
      organizationId: context.organizationId,
      branchId: context.branchId,
      fiscalYearId: context.fiscalYearId,
      voucherDate,
      description: voucher.description || `سند شماره ${voucher.voucherNumber}`,
      entries: mappedEntries,
      operationKey: context.operationKey,
      requestFingerprint: context.requestFingerprint,
      sourceType: voucher.sourceType || 'manual',
      sourceId: voucher.sourceId || voucher.id,
      sourceEventKey: `legacy_vouch_${voucher.id}`,
    };

    return payload;
  }
}
