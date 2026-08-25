
/**
 * Normalizes Persian and Arabic digits to English digits
 * @param str Input string containing digits
 * @returns Normalized digits string
 */
export function normalizeDigits(str: string): string {
  if (!str) return '';
  const persianDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicDigits = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  let normalized = str.trim();
  for (let i = 0; i < 10; i++) {
    normalized = normalized.replace(persianDigits[i], i.toString()).replace(arabicDigits[i], i.toString());
  }
  return normalized.replace(/\D/g, '');
}

/**
 * Validates Iranian National ID (10 digits) using official checksum algorithm
 * @param nationalId 10-digit string
 * @returns boolean
 */
export function isValidNationalId(nationalId: string): boolean {
  const cleanId = normalizeDigits(nationalId);
  
  // Must be exactly 10 numeric digits
  if (!/^\d{10}$/.test(cleanId)) {
    return false;
  }

  // Reject identical repeating digits (e.g. 0000000000, 1111111111, ..., 9999999999)
  if (/^(\d)\1{9}$/.test(cleanId)) {
    return false;
  }

  // Multiply first 9 digits by weights 10 down to 2 and calculate sum
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleanId[i], 10) * (10 - i);
  }

  const remainder = sum % 11;
  const checkDigit = parseInt(cleanId[9], 10);

  if (remainder < 2) {
    return checkDigit === remainder;
  } else {
    return checkDigit === 11 - remainder;
  }
}

/**
 * Checks if a National ID is unique across a list of persons
 * @param nationalId National ID to check
 * @param persons List of persons
 * @param excludeId ID to exclude from check (for editing)
 * @returns boolean true if unique
 */
export function isUniqueNationalId(nationalId: string, persons: any[], excludeId?: string): boolean {
  const cleanId = normalizeDigits(nationalId);
  if (!cleanId) return true;
  return !persons.some(p => {
    const pClean = normalizeDigits(p.nationalId || '');
    return pClean === cleanId && p.id !== excludeId;
  });
}

