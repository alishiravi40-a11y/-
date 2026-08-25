import { CreditFile, CreditPolicy } from '../types';

/**
 * Finds the most appropriate active CreditPolicy for a given credit amount.
 */
export function getMatchingCreditPolicy(amount: number, policies: CreditPolicy[]): CreditPolicy {
  const activePolicies = (policies || []).filter(p => p.isActive);
  
  if (activePolicies.length === 0) {
    // Fallback default policy if none exists in state
    return {
      id: 'pol_default',
      title: 'سیاست پیش‌فرض سیستم',
      minAmount: 0,
      maxAmount: 10000000000,
      needsValidation: true,
      needsBackSignature: false,
      needsCollateral: false,
      needsGuarantorInfo: false,
      needsGuarantorValidation: false,
      needsAmaniCheck: false,
      amaniReminderDays: 10,
      isActive: true
    };
  }

  // Find policy where amount falls in [minAmount, maxAmount]
  let matched = activePolicies.find(p => amount >= p.minAmount && amount <= p.maxAmount);

  // If no match is found (e.g., amount exceeds all ranges), return the policy with the highest maxAmount
  if (!matched) {
    const sorted = [...activePolicies].sort((a, b) => b.maxAmount - a.maxAmount);
    if (amount > sorted[0].maxAmount) {
      matched = sorted[0];
    } else {
      matched = sorted[sorted.length - 1]; // fallback to lowest if amount is below minimum
    }
  }

  return matched;
}

/**
 * Validates a CreditFile against its policy requirements.
 * Returns an object indicating validity and a list of specific missing items/errors.
 */
export function validateCreditFileWithPolicy(file: CreditFile, policy: CreditPolicy): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  const isBeta = !!(
    file.plan?.toLowerCase().includes('beta') || 
    file.plan?.includes('بتا') || 
    (file as any).calculatorId?.toLowerCase().includes('beta') || 
    (file as any).calculatorId?.includes('بتا') ||
    (file as any).calculatorName?.toLowerCase().includes('beta') || 
    (file as any).calculatorName?.includes('بتا')
  );

  // 1. Core National Card is always required for all files (KYC)
  const hasNationalCard = (file.paymentDocuments || []).some(
    doc => doc.category === 'national_card' && doc.status !== 'rejected'
  );
  if (!hasNationalCard) {
    errors.push('تصویر کارت ملی مشتری بارگذاری نشده است (بخش هویت).');
  }

  if (isBeta) {
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // 2. Base Validation Document (needsValidation)
  if (policy.needsValidation) {
    const hasScoringDoc = (file.paymentDocuments || []).some(
      doc => (doc.category === 'bank_credit_scoring' || doc.category === 'refah_beta_report') && doc.status !== 'rejected'
    );
    if (!hasScoringDoc) {
      errors.push('مدرک اعتبارسنجی بانکی یا گزارش طرح بتا بارگذاری نشده است (بخش اعتبارسنجی).');
    }
  }

  // 3. Guarantor Info (needsGuarantorInfo)
  if (policy.needsGuarantorInfo) {
    if (!file.guarantorName || !file.guarantorName.trim()) {
      errors.push('نام و نام خانوادگی ضامن وارد نشده است.');
    }
    if (!file.guarantorNationalId || file.guarantorNationalId.trim().length !== 10) {
      errors.push('کد ملی ۱۰ رقمی ضامن به درستی وارد نشده است.');
    }
    if (!file.guarantorPhone || file.guarantorPhone.trim().length < 10) {
      errors.push('شماره همراه ضامن وارد نشده یا نامعتبر است.');
    }

    // Require guarantor-related document (e.g. other doc with 'ضامن' or card of guarantor)
    const hasGuarantorDoc = (file.paymentDocuments || []).some(
      doc => (doc.category === 'other' || doc.category === 'national_card') && 
             (doc.name.includes('ضامن') || (doc as any).customTitle?.includes('ضامن'))
    );
    if (!hasGuarantorDoc) {
      errors.push('تصویر کارت ملی ضامن یا مدارک ضامن بارگذاری نشده است (می‌توانید در بخش مدارک سفارشی با برچسب ضامن آپلود کنید).');
    }
  }

  // 4. Guarantor Credit Validation (needsGuarantorValidation)
  if (policy.needsGuarantorValidation) {
    const hasGuarantorScoring = (file.paymentDocuments || []).some(
      doc => (doc.category === 'bank_credit_scoring' || doc.category === 'employment_income') && 
             (doc.name.includes('ضامن') || (doc as any).customTitle?.includes('ضامن'))
    );
    if (!hasGuarantorScoring) {
      errors.push('مدرک اعتبارسنجی بانکی یا فیش حقوقی ضامن بارگذاری نشده است.');
    }
  }

  // 5. Collateral / Guarantee (needsCollateral)
  if (policy.needsCollateral) {
    if (!file.collateralType) {
      errors.push('نوع وثیقه/ضمانت انتخاب نشده است.');
    }
    if (!file.collateralDescription || !file.collateralDescription.trim()) {
      errors.push('شرح وثیقه/ضمانت وارد نشده است.');
    }
    if (!file.collateralValue || file.collateralValue <= 0) {
      errors.push('ارزش وثیقه/ضمانت باید بیشتر از صفر باشد.');
    }

    const hasCollateralDoc = (file.paymentDocuments || []).some(
      doc => doc.category === 'guarantee_promissory' && doc.status !== 'rejected'
    );
    if (!hasCollateralDoc) {
      errors.push('تصویر سفته الکترونیک یا ضمانت‌نامه/وثیقه بارگذاری نشده است.');
    }
  }

  // 6. Amani / Trust Check (needsAmaniCheck)
  if (policy.needsAmaniCheck) {
    if (!file.amaniCheckNumber || !file.amaniCheckNumber.trim()) {
      errors.push('شماره چک امانی وارد نشده است.');
    }
    if (!file.amaniCheckBankName || !file.amaniCheckBankName.trim()) {
      errors.push('نام بانک صادرکننده چک امانی وارد نشده است.');
    }
    if (!file.amaniCheckAmount || file.amaniCheckAmount <= 0) {
      errors.push('مبلغ چک امانی وارد نشده یا نامعتبر است.');
    }
    if (!file.amaniCheckDueDate) {
      errors.push('تاریخ سررسید چک امانی مشخص نشده است.');
    }
    if (!file.amaniCheckSayadiNumber || file.amaniCheckSayadiNumber.trim().length !== 16) {
      errors.push('شناسه صیادی ۱۶ رقمی چک امانی به درستی وارد نشده است.');
    }

    const hasAmaniDoc = (file.paymentDocuments || []).some(
      doc => doc.category === 'check_images' && (doc.name.includes('امانی') || (doc as any).customTitle?.includes('امانی'))
    );
    if (!hasAmaniDoc) {
      errors.push('تصویر چک امانی بارگذاری نشده است (می‌توانید در بخش تصاویر چک با برچسب امانی آپلود کنید).');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
