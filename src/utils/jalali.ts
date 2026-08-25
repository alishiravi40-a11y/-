/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 335];
  let jy = (gy <= 1600) ? 0 : 979;
  gy -= (gy <= 1600) ? 621 : 1600;
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return [jy, jm, jd];
}

export function getCurrentJalaliDate(): string {
  const now = new Date();
  const [jy, jm, jd] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return formatJalali(jy, jm, jd);
}

export function getCurrentJalaliYearMonth(): string {
  const now = new Date();
  const [jy, jm] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return `${jy}/${jm.toString().padStart(2, '0')}`;
}

export function getJalaliYearMonthFromISO(isoString?: string): string {
  if (!isoString) return getCurrentJalaliYearMonth();
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return getCurrentJalaliYearMonth();
  const [jy, jm] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${jy}/${jm.toString().padStart(2, '0')}`;
}

export function formatJalali(jy: number, jm: number, jd: number): string {
  const mm = jm.toString().padStart(2, '0');
  const dd = jd.toString().padStart(2, '0');
  return `${jy}/${mm}/${dd}`;
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): Date {
  let jyAdjusted = jy - 979;
  let days = (365 * jyAdjusted) + Math.floor(jyAdjusted / 33) * 8 + Math.floor(((jyAdjusted % 33) + 3) / 4) + 78 + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
  let gy = 1600 + 400 * Math.floor(days / 146097);
  days %= 146097;
  let leap = 1;
  if (days >= 36525) {
    days--;
    gy += 100 * Math.floor(days / 36524);
    days %= 36524;
    if (days >= 365) {
      days++;
    } else {
      leap = 0;
    }
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days >= 366) {
    leap = 0;
    days--;
    gy += Math.floor(days / 365);
    days %= 365;
  }
  let i = 0;
  const sal_g = [0, 31, 28 + leap, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  while (days >= sal_g[i]) {
    days -= sal_g[i];
    i++;
  }
  const gm = i;
  const gd = days + 1;
  return new Date(gy, gm - 1, gd, 12, 0, 0);
}

export function parseJalali(dateStr: string): { jy: number; jm: number; jd: number } | null {
  if (!dateStr) return null;
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  let cleanStr = dateStr.toString();
  for (let i = 0; i < 10; i++) {
    cleanStr = cleanStr.replace(new RegExp(persianDigits[i], 'g'), i.toString());
    cleanStr = cleanStr.replace(new RegExp(arabicDigits[i], 'g'), i.toString());
  }

  const parts = cleanStr.split('/');
  if (parts.length !== 3) return null;
  const jy = parseInt(parts[0], 10);
  const jm = parseInt(parts[1], 10);
  const jd = parseInt(parts[2], 10);
  if (isNaN(jy) || isNaN(jm) || isNaN(jd)) return null;
  return { jy, jm, jd };
}

export function getMonthName(jm: number): string {
  const months = [
    'فروردین', 'اردیبهشت', 'خرداد',
    'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر',
    'دی', 'بهمن', 'اسفند'
  ];
  return months[jm - 1] || '';
}

export function compareJalali(d1: string, d2: string): number {
  return d1.localeCompare(d2);
}

export function addDaysToJalali(dateStr: string, daysToAdd: number): string {
  const parsed = parseJalali(dateStr);
  if (!parsed) return dateStr;
  const gregorian = jalaliToGregorian(parsed.jy, parsed.jm, parsed.jd);
  gregorian.setDate(gregorian.getDate() + daysToAdd);
  const [jy, jm, jd] = gregorianToJalali(gregorian.getFullYear(), gregorian.getMonth() + 1, gregorian.getDate());
  return formatJalali(jy, jm, jd);
}

export function addMonthsToJalali(dateStr: string, monthsToAdd: number): string {
  const parsed = parseJalali(dateStr);
  if (!parsed) return dateStr;
  let { jy, jm, jd } = parsed;
  
  for (let i = 0; i < monthsToAdd; i++) {
    jm += 1;
    if (jm > 12) {
      jm = 1;
      jy += 1;
    }
  }
  
  // Standard Jalali month limits: 1-6 are 31 days, 7-11 are 30 days, 12 is 29 or 30 days
  if (jm >= 7 && jm <= 11 && jd > 30) {
    jd = 30;
  } else if (jm === 12 && jd > 29) {
    jd = 29;
  }
  return formatJalali(jy, jm, jd);
}

export function getJalaliDiffDays(d1: string, d2: string): number {
  const p1 = parseJalali(d1);
  const p2 = parseJalali(d2);
  if (!p1 || !p2) return 0;
  const g1 = jalaliToGregorian(p1.jy, p1.jm, p1.jd);
  const g2 = jalaliToGregorian(p2.jy, p2.jm, p2.jd);
  return Math.round((g1.getTime() - g2.getTime()) / (1000 * 60 * 60 * 24));
}

export function isLeapJalali(jy: number): boolean {
  const leaps = [1, 5, 9, 13, 17, 22, 26, 30];
  const r = ((jy - 474) % 2820) % 33;
  return leaps.includes(r);
}

export function normalizeJalaliDate(dateStr: string): string {
  if (!dateStr) return "";
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  let cleanStr = dateStr.toString().trim();
  for (let i = 0; i < 10; i++) {
    cleanStr = cleanStr.replace(new RegExp(persianDigits[i], 'g'), i.toString());
    cleanStr = cleanStr.replace(new RegExp(arabicDigits[i], 'g'), i.toString());
  }

  // Replace separators (hyphens, dots, spaces, backslashes) with forward slash
  cleanStr = cleanStr.replace(/[-.\s\\]/g, '/');

  const parts = cleanStr.split('/');
  if (parts.length !== 3) {
    return cleanStr;
  }

  let year = parts[0].trim();
  let month = parts[1].trim();
  let day = parts[2].trim();

  if (year.length === 2) {
    year = `14${year}`;
  }

  month = month.padStart(2, '0');
  day = day.padStart(2, '0');

  return `${year}/${month}/${day}`;
}

export function validateJalaliDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const normalized = normalizeJalaliDate(dateStr);
  const regex = /^\d{4}\/\d{2}\/\d{2}$/;
  if (!regex.test(normalized)) return false;

  const parts = normalized.split('/');
  const jy = parseInt(parts[0], 10);
  const jm = parseInt(parts[1], 10);
  const jd = parseInt(parts[2], 10);

  if (isNaN(jy) || isNaN(jm) || isNaN(jd)) return false;
  if (jy < 1000 || jy > 1600) return false;
  if (jm < 1 || jm > 12) return false;

  if (jm >= 1 && jm <= 6) {
    return jd >= 1 && jd <= 31;
  } else if (jm >= 7 && jm <= 11) {
    return jd >= 1 && jd <= 30;
  } else if (jm === 12) {
    const leap = isLeapJalali(jy);
    const maxDays = leap ? 30 : 29;
    return jd >= 1 && jd <= maxDays;
  }
  return false;
}

export function safeCompareJalali(d1: string, d2: string): number {
  const norm1 = normalizeJalaliDate(d1);
  const norm2 = normalizeJalaliDate(d2);
  return norm1.localeCompare(norm2);
}

export function parseSafeJalali(dateStr: string): { jy: number; jm: number; jd: number } | null {
  if (!validateJalaliDate(dateStr)) return null;
  const normalized = normalizeJalaliDate(dateStr);
  const parts = normalized.split('/');
  const jy = parseInt(parts[0], 10);
  const jm = parseInt(parts[1], 10);
  const jd = parseInt(parts[2], 10);
  return { jy, jm, jd };
}
