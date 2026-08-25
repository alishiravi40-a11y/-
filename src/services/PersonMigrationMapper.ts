import { PersonRecord } from './PersonRepository';

// Legacy Person interface based on app state
export interface LegacyPerson {
  id: string; // business code or legacy ID
  code?: string;
  name: string;
  type?: 'real' | 'legal';
  nationalId?: string;
  national_id?: string;
  mobile?: string;
  phone?: string;
  status?: string;
  role?: string;
  [key: string]: any;
}

export interface PersonMappingResult {
  mapped: PersonRecord | null;
  errors: string[];
  warnings: string[];
}

export interface DryRunSummary {
  totalChecked: number;
  transferableCount: number;
  validationErrorCount: number;
  duplicateCodeCount: number;
  duplicateNationalIdCount: number;
  duplicateMobileWarningCount: number;
  manualInterventionRequiredCount: number;
  errors: string[];
}

/**
   * Pure function Mapper: Legacy Person -> Relational Person Record
   */
export function mapLegacyPersonToRelational(
  legacy: LegacyPerson,
  organizationId: string,
  userId: string = 'system_dry_run'
): PersonMappingResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const businessCode = legacy.code || legacy.id;
  if (!businessCode) {
    errors.push('شناسه یا کد کسب‌وکاری شخص موجود نیست.');
  }

  const name = legacy.name;
  if (!name || name.trim() === '') {
    errors.push('نام شخص خالی است.');
  }

  const personType = (legacy.type === 'legal' || legacy.person_type === 'legal') ? 'legal' : 'real';
  const nationalId = legacy.nationalId || legacy.national_id || null;
  const mobile = legacy.mobile || legacy.phone || null;

  // Validation rules
  if (nationalId) {
    const cleanNationalId = nationalId.trim();
    if (cleanNationalId.length !== 10 && cleanNationalId.length !== 11) {
      warnings.push(`کد ملی / شناسه ملی '${cleanNationalId}' طول غیرمعمول دارد.`);
    }
  }

  if (mobile) {
    const cleanMobile = mobile.trim();
    if (!cleanMobile.startsWith('09') && cleanMobile.length !== 11) {
      warnings.push(`شماره موبایل '${cleanMobile}' فرمت استاندارد موبایل ایران را ندارد.`);
    }
  }

  const statusVal = legacy.status === 'inactive' || legacy.status === 'blocked' ? legacy.status : 'active';
  const roleVal = legacy.role === 'debtor' || legacy.role === 'creditor' ? legacy.role : 'both';

  if (errors.length > 0) {
    return {
      mapped: null,
      errors,
      warnings,
    };
  }

  const relationalRecord: PersonRecord = {
    id: 'pers_' + Math.random().toString(36).substring(2, 11), // internal relational placeholder ID
    organization_id: organizationId,
    code: String(businessCode),
    name: name.trim(),
    person_type: personType,
    national_id: nationalId ? String(nationalId).trim() : null,
    mobile: mobile ? String(mobile).trim() : null,
    status: statusVal as any,
    role: roleVal as any,
    created_by: userId,
    version: 1,
  };

  return {
    mapped: relationalRecord,
    errors: [],
    warnings,
  };
}

/**
   * Read-only Dry Run analyzer for legacy persons list
   */
export function performPersonsDryRun(legacyPersons: LegacyPerson[], organizationId: string): DryRunSummary {
  const errors: string[] = [];
  let transferableCount = 0;
  let validationErrorCount = 0;
  let duplicateCodeCount = 0;
  let duplicateNationalIdCount = 0;
  let duplicateMobileWarningCount = 0;
  let manualInterventionRequiredCount = 0;

  const seenCodes = new Set<string>();
  const seenNationalIds = new Set<string>();
  const seenMobiles = new Set<string>();

  for (const p of legacyPersons) {
    const code = p.code || p.id;
    if (code) {
      if (seenCodes.has(String(code))) {
        duplicateCodeCount++;
        manualInterventionRequiredCount++;
      } else {
        seenCodes.add(String(code));
      }
    }

    const natId = p.nationalId || p.national_id;
    if (natId) {
      const cleanNatId = String(natId).trim();
      if (seenNationalIds.has(cleanNatId)) {
        duplicateNationalIdCount++;
      } else {
        seenNationalIds.add(cleanNatId);
      }
    }

    const mob = p.mobile || p.phone;
    if (mob) {
      const cleanMob = String(mob).trim();
      if (seenMobiles.has(cleanMob)) {
        duplicateMobileWarningCount++;
      } else {
        seenMobiles.add(cleanMob);
      }
    }

    const res = mapLegacyPersonToRelational(p, organizationId);
    if (res.errors.length > 0) {
      validationErrorCount++;
      manualInterventionRequiredCount++;
    } else {
      transferableCount++;
    }
  }

  return {
    totalChecked: legacyPersons.length,
    transferableCount,
    validationErrorCount,
    duplicateCodeCount,
    duplicateNationalIdCount,
    duplicateMobileWarningCount,
    manualInterventionRequiredCount,
    errors,
  };
}
