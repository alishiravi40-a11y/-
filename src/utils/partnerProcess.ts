import { 
  AppState, PartnerCreditRequest, PartnerCreditRequestStatus, 
  PartnerSalesPlan, SuggestedInstallment, Check, InstallmentBook, 
  JournalVoucher, VoucherEntry, AuditLog, PartnerSettlement,
  CreditFile, Installment, Person, BusinessPartner,
  CreditRuleHistoryEntry, CreditPartnerExtension, PartnerCreditRules,
  ResolvedPartnerCreditRules
 } from '../types';
import { calculatePersonBalances, createCheckStateVoucher, getNextVoucherNumber, createReverseVoucher } from './accounting';
import { resolveCalculatorType, calculateBeta, resolveEffectiveCalculatorSettings } from './creditCalculatorEngine';
import { gregorianToJalali, addMonthsToJalali, getCurrentJalaliYearMonth, getJalaliYearMonthFromISO } from './jalali';

/**
 * بررسی تکراری بودن چک در کل سیستم
 * چک‌های نهایی (state.checks) و چک‌های موقت در پرونده‌های باز را بررسی می‌کند.
 */
export function isCheckDuplicate(checkData: { checkNumber: string; bankName: string; amount: number; dueDate: string }, state: AppState, excludeRequestId?: string): { isDuplicate: boolean; reason?: string } {
  // ۱. بررسی در چک‌های صادر شده/دریافت شده نهایی سیستم
  const existsInFinalChecks = (state.checks || []).find(c => 
    c.checkNumber === checkData.checkNumber && 
    c.bankName === checkData.bankName && 
    c.amount === checkData.amount
  );
  if (existsInFinalChecks) return { isDuplicate: true, reason: 'این چک قبلاً در خزانه سیستم ثبت شده است.' };

  // ۲. بررسی در پرونده‌های اعتباری باز (تمامی نمایندگان)
  const openRequests = (state.partnerCreditRequests || []).filter(r => r.id !== excludeRequestId && r.status !== PartnerCreditRequestStatus.REJECTED);
  for (const req of openRequests) {
    const duplicateInTemp = (req.submittedChecks || []).find(c => 
      c.checkNumber === checkData.checkNumber && 
      c.bankName === checkData.bankName && 
      c.amount === checkData.amount
    );
    if (duplicateInTemp) return { isDuplicate: true, reason: `این چک در پرونده جاری ${req.id} در حال بررسی است.` };
  }

  return { isDuplicate: false };
}

/**
 * ابطال اتمیک پرونده اعتبار تایید شده
 * شامل معکوس کردن سند، لغو چک‌ها و اقساط
 */
export function reversePartnerCreditRequest(requestId: string, state: AppState, userId: string): Partial<AppState> {
  const request = (state.partnerCreditRequests || []).find(r => r.id === requestId);
  if (!request || request.status !== PartnerCreditRequestStatus.FINAL_APPROVED) {
    throw new Error('فقط پرونده‌های تایید نهایی شده قابل ابطال هستند.');
  }

  // ۱. یافتن سند حسابداری اصلی
  const originalVoucher = (state.vouchers || []).find(v => v.description?.includes(request.id));
  if (!originalVoucher) {
    throw new Error('سند حسابداری مربوط به این پرونده یافت نشد.');
  }

  // ۲. مدیریت چک‌ها
  const relatedChecks = (state.checks || []).filter(c => 
    c.representativeId === request.businessPartnerId && 
    c.history.some(h => h.note?.includes(request.id))
  );

  const nonReversibleCheck = relatedChecks.find(c => c.currentState !== 'present_in_cashbox' && c.currentState !== 'CANCELLED' as any);
  if (nonReversibleCheck) {
    throw new Error(`ابطال مقدور نیست: چک شماره ${nonReversibleCheck.checkNumber} در وضعیت ${nonReversibleCheck.currentState} قرار دارد.`);
  }

  // ۲.۵ کنترل تسویه حساب (Settlement Guard)
  // بررسی اینکه آیا ابطال این پرونده باعث منفی شدن مانده نماینده می‌شود (یعنی قبلاً پول را گرفته است)
  const financial = calculatePartnerFinancialStatement(request.businessPartnerId, state);
  const partnerRow = originalVoucher.entries.find(r => r.floatingDetailed?.id === state.businessPartners?.find(bp => bp.id === request.businessPartnerId)?.personId);
  const reversalAmount = partnerRow?.credit || 0; // مبلغی که باید از حساب نماینده کسر شود

  if (financial && financial.currentBalance < reversalAmount) {
    const hasSettlements = (state.partnerSettlements || []).some(s => s.businessPartnerId === request.businessPartnerId);
    if (hasSettlements) {
      throw new Error('این پرونده قبلاً با نماینده تسویه شده است. ابطال باعث ایجاد بدهکاری غیرمجاز برای نماینده خواهد شد. ابتدا سند تسویه را بررسی کنید.');
    }
  }

  // ۳. ایجاد سند معکوس
  const reverseVoucher: JournalVoucher = {
    id: `REV_${Date.now()}`,
    voucherNumber: (state.vouchers?.length || 0) + 1,
    date: new Date().toISOString().split('T')[0].replace(/-/g, '/'),
    gregorianDate: new Date().toISOString(),
    description: `سند معکوس پرونده اعتبار ${request.id} - ابطال سیستمی`,
    isAutomatic: true,
    entries: originalVoucher.entries.map(row => ({
      ...row,
      debit: row.credit, // جابجایی بدهکار و بستانکار
      credit: row.debit,
      description: `برگشت: ${row.description}`
    }))
  };

  // ۴. آماده‌سازی تغییرات استیت
  const updatedRequests = (state.partnerCreditRequests || []).map(r => 
    r.id === requestId ? { ...r, status: PartnerCreditRequestStatus.CANCELLED } : r
  );

  const updatedChecks = (state.checks || []).map(check => {
    const isRelated = relatedChecks.some(rc => rc.id === check.id);
    return isRelated ? { ...check, currentState: 'CANCELLED' as any } : check;
  });

  const auditLog: AuditLog = {
    id: `LOG_${Date.now()}`,
    timestamp: new Date().toISOString(),
    userId,
    userName: state.users.find(u => u.id === userId)?.name || 'Admin',
    action: 'UPDATE',
    entityType: 'APP_STATE',
    entityId: requestId,
    details: `ابطال اتمیک پرونده ${requestId} انجام شد. سند معکوس: ${reverseVoucher.id}`
  };

  return {
    partnerCreditRequests: updatedRequests,
    vouchers: [...(state.vouchers || []), reverseVoucher],
    checks: updatedChecks,
    auditLogs: [...(state.auditLogs || []), auditLog]
  };
}

/**
 * تبدیل پرونده اعتبار تایید شده به اسناد مالی واقعی
 */
export function finalizePartnerCreditRequest(requestId: string, state: AppState): Partial<AppState> {
  const request = (state.partnerCreditRequests || []).find(r => r.id === requestId);
  if (!request) {
    throw new Error('پرونده یافت نشد.');
  }

  // بررسی وضعیت: فقط پرونده‌های FINAL_APPROVED قابل نهایی‌سازی هستند
  if (request.status !== PartnerCreditRequestStatus.FINAL_APPROVED) {
    throw new Error('پرونده در وضعیت تایید نهایی نیست.');
  }

  // جلوگیری از ثبت تکراری: بررسی اینکه آیا اسناد مالی برای این پرونده قبلا ثبت شده است یا خیر
  const hasExistingVoucher = (state.vouchers || []).some(v => v.description?.includes(request.id));
  const hasExistingChecks = (state.checks || []).some(c => c.representativeId === request.businessPartnerId && c.history.some(h => h.note?.includes(request.id)));
  
  if (hasExistingVoucher || hasExistingChecks) {
    console.warn(`عملیات نهایی‌سازی قبلاً برای پرونده ${request.id} انجام شده است.`);
    return {}; 
  }

  // === [قفل متقابل کنترل تعهدات اعتباری موازی و دفترچه‌های اقساط تسویه‌نشده] ===
  // ۱. بررسی صلاحیت اعتباری و تسویه کامل مشتری (گیت مرکزی تسویه)
  const customerPersonForReq = (state.persons || []).find(p => p.id === request.customerPersonId);
  if (customerPersonForReq) {
    const eligibility = checkCustomerCreditEligibility(customerPersonForReq.nationalId, state, { excludeRequestId: request.id });
    if (!eligibility.isEligible) {
      throw new Error(`امکان نهایی‌سازی وجود ندارد: ${eligibility.reasons.join(' | ')}`);
    }
  }

  // ۲. بررسی وجود دفترچه اقساط فعال و تسویه‌نشده برای این مشتری
  const activeBookletForCustomer = (state.installmentBooks || []).find(b => b.personId === request.customerPersonId && b.status === 'active');
  if (activeBookletForCustomer) {
    throw new Error(`امکان نهایی‌سازی وجود ندارد: مشتری دارای دفترچه اقساط فعال و تسویه‌نشده (شناسه: ${activeBookletForCustomer.id}) در سیستم می‌باشد.`);
  }

  // ۳. بررسی وجود پرونده اعتباری در جریان از مسیر مرکز (CreditFile) برای این مشتری
  const activeCenterCreditFile = (state.creditFiles || []).find(f => 
    f.personId === request.customerPersonId && 
    !['canceled', 'approved'].includes(f.status)
  );
  if (activeCenterCreditFile) {
    throw new Error(`امکان نهایی‌سازی وجود ندارد: مشتری دارای پرونده اعتباری در جریان در مدیریت مرکزی (شناسه: ${activeCenterCreditFile.id}) می‌باشد.`);
  }

  const results = request.calculationResults;
  if (!results) throw new Error('محاسبات پرونده یافت نشد.');

  const totalPayment = results.totalPayment || 0;
  const totalInterest = results.totalInterest || 0;
  const approvedAmount = Math.max(0, totalPayment - totalInterest);

  // === [قفل کنترل ظرفیت اعتباری نماینده] ===
  const rules = resolvePartnerCreditRules(request.businessPartnerId, state.businessPartners);
  const totalLimit = rules.maxCreditLimit || 0;
  const currentJalaliYM = getCurrentJalaliYearMonth();

  if (rules.renewalType === 'MANUAL' && rules.activePeriodJalali !== currentJalaliYM) {
    throw new Error(`امکان نهایی‌سازی وجود ندارد: ظرفیت اعتباری ماه جاری (${currentJalaliYM}) هنوز توسط مدیر فعال نشده است.`);
  }

  const activeJalaliYM = rules.renewalType === 'MANUAL' ? rules.activePeriodJalali : currentJalaliYM;

  const usedAmountByOthers = (state.partnerCreditRequests || [])
    .filter(r => {
      if (r.id === request.id) return false;
      if (r.businessPartnerId !== request.businessPartnerId) return false;
      if ([PartnerCreditRequestStatus.REJECTED, PartnerCreditRequestStatus.CANCELLED].includes(r.status)) return false;
      return getJalaliYearMonthFromISO(r.createdAt) === activeJalaliYM;
    })
    .reduce((sum, r) => sum + r.requestedAmount, 0);

  const remainingBeforeRequest = Math.max(0, totalLimit - usedAmountByOthers);
  if (request.requestedAmount > remainingBeforeRequest) {
    throw new Error(`امکان نهایی‌سازی وجود ندارد: مبلغ درخواست (${request.requestedAmount.toLocaleString()} ریال) از ظرفیت اعتباری باقی‌مانده نماینده (${remainingBeforeRequest.toLocaleString()} ریال) بیشتر است.`);
  }

  // کنترل ایمنی نهایی: اطمینان از عدم تکراری بودن چک‌ها قبل از ثبت نهایی
  for (const check of (request.submittedChecks || [])) {
    const duplicateStatus = isCheckDuplicate(check, state, request.id);
    if (duplicateStatus.isDuplicate) {
      throw new Error(`خطای سیستمی: چک شماره ${check.checkNumber} تکراری است. ${duplicateStatus.reason}`);
    }
  }

  // === [قفل کنترل چک‌های دریافتی] ===
  // تمامی چک‌های ارسالی نماینده باید تایید شده (APPROVED) باشند.
  if (request.submittedChecks && request.submittedChecks.length > 0) {
    const unapprovedChecks = request.submittedChecks.filter(chk => chk.status !== 'APPROVED');
    if (unapprovedChecks.length > 0) {
      throw new Error(`امکان نهایی‌سازی وجود ندارد: تعداد ${unapprovedChecks.length} چک هنوز تایید نهایی نشده‌اند. ابتدا وضعیت تمامی چک‌ها را به "تایید شده" تغییر دهید.`);
    }
  }

  const customer = state.persons.find(p => p.id === request.customerPersonId);
  const now = new Date().toISOString();
  const jalaliNow = now.split('T')[0].replace(/-/g, '/'); // Simple mock conversion

  const newChecks: Check[] = (request.submittedChecks || []).map(sc => ({
    id: `CHK_${Date.now()}_${sc.checkNumber}`,
    type: 'received',
    checkNumber: sc.checkNumber,
    bankName: sc.bankName,
    dueDate: sc.dueDate,
    amount: sc.amount,
    personId: request.customerPersonId,
    nationalId: sc.drawerNationalId,
    currentState: 'present_in_cashbox',
    isInstallment: true,
    isAmani: false,
    history: [{
      state: 'present_in_cashbox',
      date: sc.dueDate,
      note: 'ثبت خودکار از پرونده اعتبار نماینده'
    }],
    createdAt: now,
    createdBy: request.finalApprovedBy || 'system',
    representativeId: request.businessPartnerId,
    status: 'active'
  }));

  const count = results.suggestedInstallments?.length || 12;

  const installmentBook: InstallmentBook = {
    id: `IB_${Date.now()}`,
    personId: request.customerPersonId,
    creditFileId: request.id,
    totalPrincipal: approvedAmount,
    totalInterest: results.totalInterest || 0,
    totalAmount: results.totalPayment || approvedAmount,
    installmentCount: count,
    startDate: jalaliNow,
    intervalDays: request.paymentPeriod || 30,
    status: 'active',
    createdAt: now,
    createdBy: request.finalApprovedBy || 'system',
  };

  const partnerInstallments: Installment[] = [];
  if (results.suggestedInstallments && results.suggestedInstallments.length > 0) {
    results.suggestedInstallments.forEach((si, idx) => {
      partnerInstallments.push({
        id: `inst_${installmentBook.id}_${idx + 1}`,
        bookId: installmentBook.id,
        installmentNumber: idx + 1,
        dueDate: si.dueDate,
        amount: si.amount,
        paidAmount: 0,
        interestPart: (si as any).interest || 0,
        principalPart: (si as any).principal || si.amount,
        penaltyAmount: 0,
        delayDays: 0,
        status: 'upcoming'
      });
    });
  } else {
    const singleAmount = Math.round((results.totalPayment || approvedAmount) / count);
    const singleInterest = Math.round((results.totalInterest || 0) / count);
    for (let idx = 0; idx < count; idx++) {
      const amt = idx === count - 1 
        ? (results.totalPayment || approvedAmount) - (singleAmount * (count - 1)) 
        : singleAmount;
      const interestPart = idx === count - 1 
        ? (results.totalInterest || 0) - (singleInterest * (count - 1)) 
        : singleInterest;
      const principalPart = amt - interestPart;

      partnerInstallments.push({
        id: `inst_${installmentBook.id}_${idx + 1}`,
        bookId: installmentBook.id,
        installmentNumber: idx + 1,
        dueDate: addMonthsToJalali(jalaliNow, idx + 1),
        amount: amt,
        paidAmount: 0,
        interestPart,
        principalPart,
        penaltyAmount: 0,
        delayDays: 0,
        status: 'upcoming'
      });
    }
  }

  const existingBooks = (state.installmentBooks || []).filter(b => b.creditFileId !== request.id);
  const finalBooks = [...existingBooks, installmentBook];

  console.log('====================================================');
  console.log('=== [TRACE: finalizePartnerCreditRequest] ===');
  console.log('1. Request/File ID (شناسه پرونده):', request.id);
  console.log('2. Customer ID (شناسه مشتری):', request.customerPersonId);
  console.log('3. Created Booklet ID (شناسه دفترچه):', installmentBook.id);
  console.log('4. Installments Count (تعداد اقساط):', partnerInstallments.length);
  console.log('5. Present in final installmentBooks array?:', finalBooks.some(b => b.id === installmentBook.id));
  console.log('6. installmentBook.personId === customerId?:', installmentBook.personId === request.customerPersonId);
  console.log('7. installmentBook.creditFileId === requestId?:', installmentBook.creditFileId === request.id);
  console.log('====================================================');

  const partnerPerson = state.persons.find(p => p.id === request.businessPartnerId) ||
    (() => {
      const partner = state.businessPartners?.find(p => p.id === request.businessPartnerId || p.personId === request.businessPartnerId);
      return partner ? state.persons.find(p => p.id === partner.personId) : undefined;
    })() ||
    (() => {
      const u = state.users?.find(u => u.id === request.businessPartnerId);
      return u?.personId ? state.persons.find(p => p.id === u.personId) : undefined;
    })();

  const partnerObj = state.businessPartners?.find(p => p.id === request.businessPartnerId || p.personId === request.businessPartnerId);
  const resolvedPartnerName = partnerPerson?.name || 'نماینده';
  const resolvedPartnerPersonId = partnerPerson?.id || partnerObj?.personId || request.businessPartnerId;

  const nextVoucherNumber = getNextVoucherNumber(state.vouchers || []);
  const partnerCommission = results.partnerCommission || 0;
  const companyCommission = (results.totalInterest || 0) - partnerCommission;

  // ایجاد سند اول: ثبت اعتبار مشتری
  const voucher: JournalVoucher = {
    id: `JV_PARTNER_${Date.now()}`,
    voucherNumber: nextVoucherNumber,
    date: jalaliNow,
    gregorianDate: now,
    isAutomatic: true,
    description: `سند اعتبار پرونده نماینده ${request.id} - مشتری ${customer?.name || 'ناشناس'}`,
    contractType: 'credit',
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
        floatingDetailed: { type: 'person', id: request.customerPersonId, name: customer?.name || 'ناشناس' },
        debit: Math.max(0, totalPayment - partnerCommission),
        credit: 0,
        description: 'بدهکاری مشتری بابت خرید اقساطی از نماینده',
        contractType: 'credit'
      },
      {
        subsidiaryId: 'SUB_CREDITORS',
        floatingDetailed: { type: 'person', id: resolvedPartnerPersonId, name: resolvedPartnerName },
        debit: 0,
        credit: approvedAmount,
        description: `بستانکاری نماینده بابت فروش کالا به مشتری (تامین اعتبار)`,
        contractType: 'credit'
      },
      {
        subsidiaryId: 'SUB_INTEREST_INCOME',
        debit: 0,
        credit: companyCommission,
        description: 'سود اقساط پرونده اعتباری (سهم شرکت)',
        contractType: 'credit'
      }
    ],
    createdBy: request.finalApprovedBy || 'system',
    status: 'active'
  };

  // ============================================================================
  // ⚠️ BUSINESS CRITICAL - VOUCHER GENERATION LOGIC
  // Any changes to the accounting entries below must pass regression tests.
  // Do NOT modify this automatically without explicit authorization.
  // ============================================================================
  
  // ایجاد سند دوم: ثبت حق کمیسیون نماینده (بستانکار: نماینده مربوطه)
  const commissionVoucher: JournalVoucher | null = (partnerCommission > 0) ? {
    id: `JV_PARTNER_COMM_${Date.now()}`,
    voucherNumber: nextVoucherNumber + 1,
    date: jalaliNow,
    gregorianDate: now,
    isAutomatic: true,
    description: `سند ثبت حق کمیسیون نماینده ${resolvedPartnerName} بابت پرونده ${request.id}`,
    contractType: 'credit',
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
        floatingDetailed: { type: 'person', id: request.customerPersonId, name: customer?.name || 'ناشناس' },
        debit: partnerCommission,
        credit: 0,
        description: `بدهکاری مشتری بابت حق کمیسیون نماینده پرونده ${request.id}`,
        contractType: 'credit'
      },
      {
        subsidiaryId: 'SUB_CREDITORS',
        floatingDetailed: { type: 'person', id: resolvedPartnerPersonId, name: resolvedPartnerName },
        debit: 0,
        credit: partnerCommission,
        description: `حق کمیسیون نماینده بابت پرونده ${request.id}`,
        contractType: 'credit'
      }
    ],
    createdBy: request.finalApprovedBy || 'system',
    status: 'active'
  } : null;

  // صدور اسناد حسابداری استاندارد چک‌های دریافتی با استفاده از تابع سیستم حسابداری (createCheckStateVoucher)
  const startCheckVoucherNo = nextVoucherNumber + (commissionVoucher ? 2 : 1);
  const checkVouchers: JournalVoucher[] = [];
  newChecks.forEach((chk, idx) => {
    const chkVoucherNo = startCheckVoucherNo + idx;
    const chkVoucher = createCheckStateVoucher(
      chk,
      customer?.name || 'ناشناس',
      '', // وضعیت قبلی خالی
      'present_in_cashbox', // وضعیت جدید: موجود در صندوق
      chkVoucherNo
    );
    checkVouchers.push(chkVoucher);
  });

  const finalVouchers = [...state.vouchers, voucher];
  if (commissionVoucher) {
    finalVouchers.push(commissionVoucher);
  }
  finalVouchers.push(...checkVouchers);

  return {
    checks: [...state.checks, ...newChecks],
    installmentBooks: finalBooks,
    installments: [...(state.installments || []), ...partnerInstallments],
    vouchers: finalVouchers,
    auditLogs: [
      ...(state.auditLogs || []),
      {
        id: `LOG_${Date.now()}`,
        timestamp: now,
        userId: request.finalApprovedBy || 'system',
        userName: request.finalApprovedBy || 'Admin',
        action: 'CREATE',
        entityType: 'VOUCHER',
        entityId: voucher.id,
        details: `پرونده ${request.id} نهایی و اسناد مالی ایجاد شد.`
      }
    ]
  };
}

/**
 * محاسبه صورت‌وضعیت مالی کامل نماینده
 */
export function calculatePartnerFinancialStatement(partnerId: string, state: AppState) {
  const partner = state.businessPartners?.find(p => p.id === partnerId);
  if (!partner) return null;

  const balances = calculatePersonBalances(state.vouchers, partner.personId, 'SUB_CREDITORS');
  const balance = balances[partner.personId] || { debit: 0, credit: 0, net: 0, nature: 'بی‌حساب' };

  const partnerRequests = (state.partnerCreditRequests || []).filter(r => r.businessPartnerId === partnerId);
  const approvedRequests = partnerRequests.filter(r => r.status === PartnerCreditRequestStatus.FINAL_APPROVED);
  
  const totalApprovedCredit = approvedRequests.reduce((sum, r) => sum + r.requestedAmount, 0);
  const totalCommission = approvedRequests.reduce((sum, r) => {
    const rate = partner.contract?.commissionRate || 0;
    return sum + (r.requestedAmount * rate / 100);
  }, 0);

  return {
    openingBalance: 0, // در این مدل فرضی فعلا صفر
    totalApprovedCredit,
    totalCommission,
    totalPayments: balance.debit, // بدهکاری نماینده یعنی پرداختی ما به او
    currentBalance: balance.net,
    balanceNature: balance.nature
  };
}

/**
 * تحلیل ریسک نماینده و مشتریان مرتبط
 */
export function calculatePartnerRiskProfile(partnerId: string, state: AppState) {
  const requests = (state.partnerCreditRequests || []).filter(r => r.businessPartnerId === partnerId);
  const approvedRequests = requests.filter(r => r.status === PartnerCreditRequestStatus.FINAL_APPROVED);
  
  const customerIds = Array.from(new Set(approvedRequests.map(r => r.customerPersonId)));
  const customerChecks = state.checks.filter(c => c.representativeId === partnerId);
  
  const bouncedChecks = customerChecks.filter(c => c.currentState === 'bounced');
  const pendingChecks = customerChecks.filter(c => c.currentState === 'present_in_cashbox' || (c.currentState as string) === 'deposited_to_bank');

  return {
    activeCustomerCount: customerIds.length,
    totalCommitment: approvedRequests.reduce((sum, r) => sum + (r.calculationResults?.totalPayment || 0), 0),
    pendingChecksCount: pendingChecks.length,
    pendingChecksAmount: pendingChecks.reduce((sum, c) => sum + c.amount, 0),
    bouncedChecksCount: bouncedChecks.length,
    bouncedChecksAmount: bouncedChecks.reduce((sum, c) => sum + c.amount, 0),
    rejectionRate: requests.length > 0 ? (requests.filter(r => r.status === PartnerCreditRequestStatus.REJECTED).length / requests.length) * 100 : 0
  };
}

/**
 * اجرای عملیات تسویه حساب نماینده
 * شامل اعتبارسنجی مانده و ثبت سند مالی
 */
export function executePartnerSettlement(
  partnerId: string, 
  amount: number, 
  paymentMethod: string, 
  sourceSubsidiaryId: string,
  state: AppState, 
  userId: string
): Partial<AppState> {
  const partner = state.businessPartners?.find(p => p.id === partnerId);
  if (!partner) throw new Error('نماینده یافت نشد.');

  const financial = calculatePartnerFinancialStatement(partnerId, state);
  
  // فقط اگر مانده بستانکار باشد (ما به او بدهکار باشیم) اجازه تسویه داریم
  if (financial.balanceNature !== 'بستانکار') {
    throw new Error('نماینده مانده بستانکاری برای تسویه ندارد.');
  }

  if (amount > financial.currentBalance) {
    throw new Error(`مبلغ تسویه (${amount.toLocaleString()}) نمی‌تواند بیشتر از مانده بستانکاری (${financial.currentBalance.toLocaleString()}) باشد.`);
  }

  const person = state.persons.find(p => p.id === partner.personId);
  if (!person) throw new Error('شخص مرتبط با نماینده یافت نشد.');

  // ۱. ایجاد سند حسابداری پرداخت
  // بدهکار: بستانکاران تجاری (نماینده)
  // بستانکار: بانک یا صندوق (منبع پرداخت)
  
  const voucher: JournalVoucher = {
    id: `PAY_${Date.now()}`,
    voucherNumber: (state.vouchers?.length || 0) + 1,
    date: new Date().toISOString().split('T')[0].replace(/-/g, '/'),
    gregorianDate: new Date().toISOString(),
    description: `تسویه حساب نماینده: ${person.name} - ${paymentMethod}`,
    isAutomatic: true,
    entries: [
      {
        subsidiaryId: 'SUB_CREDITORS', // بستانکاران تجاری
        floatingDetailed: { type: 'person', id: person.id, name: person.name },
        debit: amount,
        credit: 0,
        description: `تسویه حساب نماینده - ${paymentMethod}`
      },
      {
        subsidiaryId: sourceSubsidiaryId, // بانک یا صندوق انتخاب شده
        debit: 0,
        credit: amount,
        description: `پرداخت به نماینده: ${person.name}`
      }
    ],
    status: 'active',
    createdBy: userId
  };

  // ۲. ایجاد رکورد تسویه
  const settlement: PartnerSettlement = {
    id: `SET_${Date.now()}`,
    businessPartnerId: partnerId,
    amount,
    date: voucher.date,
    paymentMethod,
    voucherId: voucher.id,
    createdBy: userId,
    status: 'completed',
    createdAt: new Date().toISOString()
  };

  const auditLog: AuditLog = {
    id: `LOG_${Date.now()}`,
    timestamp: new Date().toISOString(),
    userId,
    userName: state.users.find(u => u.id === userId)?.name || 'Admin',
    action: 'CREATE',
    entityType: 'APP_STATE',
    entityId: settlement.id,
    details: `تسویه حساب به مبلغ ${amount.toLocaleString()} برای نماینده ${person.name} ثبت شد.`
  };

  return {
    vouchers: [...(state.vouchers || []), voucher],
    partnerSettlements: [...(state.partnerSettlements || []), settlement],
    auditLogs: [...(state.auditLogs || []), auditLog]
  };
}

/**
 * استخراج ریز گردش حساب (Statement) نماینده
 */
export function getPartnerStatement(partnerId: string, state: AppState) {
  const partner = state.businessPartners?.find(p => p.id === partnerId);
  if (!partner) return [];

  const partnerVouchers = (state.vouchers || []).filter(v => 
    v.entries.some(r => r.floatingDetailed?.id === partner.personId)
  );

  let runningBalance = 0;
  
  return partnerVouchers
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(v => {
      const row = v.entries.find(r => r.floatingDetailed?.id === partner.personId);
      const debit = row?.debit || 0;
      const credit = row?.credit || 0;
      runningBalance += (credit - debit);

      return {
        id: v.id,
        date: v.date,
        description: v.description,
        debit,
        credit,
        balance: runningBalance,
        status: v.status
      };
    });
}

/**
 * سرویس مرکزی استعلام وضعیت مشتری بر اساس کد ملی
 * این سرویس بررسی می‌کند که آیا شخص صلاحیت دریافت اعتبار جدید را دارد یا خیر.
 */
export function checkCustomerCreditEligibility(
  nationalId: string, 
  state: AppState,
  options?: { excludeFileId?: string; excludeRequestId?: string }
): { 
  isEligible: boolean; 
  reasons: string[];
} {
  const reasons: string[] = [];
  const person = (state.persons || []).find(p => p.nationalId === nationalId || p.id === nationalId);

  if (!person) {
    return { isEligible: true, reasons: [] };
  }

  // ۱. بررسی مانده بدهی اعتباری تسویه‌نشده در دفتر کل (مخصوص نقش مشتری، بدون تهاتر با بستانکاری نمایندگی)
  const debtorBalances = calculatePersonBalances(state.vouchers || [], person.id, ['SUB_DEBTORS_INSTALLMENT', 'SUB_DEBTORS']);
  const customerBalance = debtorBalances[person.id];
  if (customerBalance && customerBalance.nature === 'بدهکار' && customerBalance.net > 0) {
    reasons.push(`شخص دارای مانده بدهی تسویه‌نشده اعتباری/اقساطی به مبلغ ${customerBalance.net.toLocaleString()} ریال در دفتر کل می‌باشد.`);
  }

  // ۲. بررسی اقساط تسویه‌نشده (بدون اتکا به فیلد status دفترچه)
  const personBookIds = new Set((state.installmentBooks || []).filter(b => b.personId === person.id && b.status !== 'canceled' && b.status !== 'voided').map(b => b.id));
  const unpaidInstallments = (state.installments || []).filter(i => 
    personBookIds.has(i.bookId) &&
    i.status !== 'paid' && i.status !== 'canceled' && i.status !== 'voided'
  );
  if (unpaidInstallments.length > 0) {
    reasons.push(`شخص دارای ${unpaidInstallments.length} قسط تسویه‌نشده در سیستم می‌باشد.`);
  }

  // ۳. بررسی چک‌های در جریان، وصول‌نشده یا برگشتی مرتبط با مشتری
  const activeChecks = (state.checks || []).filter(c => 
    c.personId === person.id && 
    ['present_in_cashbox', 'deposited_to_bank', 'bounced', 'passed_to_third_party'].includes(c.currentState as string)
  );
  if (activeChecks.length > 0) {
    reasons.push(`شخص دارای ${activeChecks.length} فقره چک در جریان یا برگشتی است.`);
  }

  // ۴. بررسی دفترچه‌های اقساط فعال
  const activeInstallments = (state.installmentBooks || []).filter(b => 
    b.personId === person.id && b.status === 'active'
  );
  if (activeInstallments.length > 0) {
    reasons.push(`شخص دارای ${activeInstallments.length} دفترچه اقساط فعال است.`);
  }

  // ۵. بررسی درخواست‌های اعتبار از سایر نمایندگان (به جز درخواست جاری)
  const otherRequests = (state.partnerCreditRequests || []).filter(r => 
    r.customerPersonId === person.id && 
    r.id !== options?.excludeRequestId &&
    ![PartnerCreditRequestStatus.REJECTED, PartnerCreditRequestStatus.CANCELLED, PartnerCreditRequestStatus.FINAL_APPROVED].includes(r.status)
  );
  if (otherRequests.length > 0) {
    reasons.push(`شخص دارای پرونده اعتباری در جریان در سایر نمایندگی‌ها / پورتال همکاران می‌باشد.`);
  }

  // ۶. بررسی پرونده‌های اعتباری در جریان در مدیریت مرکزی (به جز پرونده جاری)
  const inProgressCreditFiles = (state.creditFiles || []).filter(f => 
    f.personId === person.id && 
    f.id !== options?.excludeFileId &&
    !['canceled', 'approved'].includes(f.status)
  );
  if (inProgressCreditFiles.length > 0) {
    reasons.push(`شخص دارای ${inProgressCreditFiles.length} پرونده اعتباری در جریان در مدیریت مرکزی می‌باشد.`);
  }

  return {
    isEligible: reasons.length === 0,
    reasons
  };
}

/**
 * محاسبه سقف اعتبار باقی‌مانده نماینده
 * ظرفیت نماینده منهای مجموع مبالغ پرونده‌های تایید شده یا در جریان
 */
export function calculatePartnerRemainingLimit(partnerId: string, state: AppState): number {
  const partner = (state.businessPartners || []).find(p => p.id === partnerId);
  if (!partner) return 0;

  const rules = resolvePartnerCreditRules(partner.personId || partner.id, state.businessPartners);
  const totalLimit = rules.maxCreditLimit || 0;
  
  const currentJalaliYM = getCurrentJalaliYearMonth();
  const renewalType = rules.renewalType || 'AUTO';

  // در حالت تجدید دستی، اگر ماه جاری توسط مدیر فعال نشده باشد، ظرفیت دوره صفر است
  if (renewalType === 'MANUAL' && rules.activePeriodJalali !== currentJalaliYM) {
    return 0;
  }

  const activeJalaliYM = renewalType === 'MANUAL' ? rules.activePeriodJalali : currentJalaliYM;

  // مجموع مبالغ پرونده‌های فعال ثبت‌شده در همان ماه شمسی (فقط اصل مبلغ درخواستی)
  const usedAmount = (state.partnerCreditRequests || [])
    .filter(r => {
      if (r.businessPartnerId !== partnerId) return false;
      if ([PartnerCreditRequestStatus.REJECTED, PartnerCreditRequestStatus.CANCELLED].includes(r.status)) return false;
      const requestJalaliYM = getJalaliYearMonthFromISO(r.createdAt);
      return requestJalaliYM === activeJalaliYM;
    })
    .reduce((sum, r) => sum + r.requestedAmount, 0);

  return Math.max(0, totalLimit - usedAmount);
}

/**
 * محاسبه جزئیات اعتباری بر اساس طرح انتخابی
 */
export function calculatePartnerCreditDetails(
  amount: number,
  plan: PartnerSalesPlan,
  termCount: number,
  paymentPeriod: number
): {
  totalPayment: number;
  totalInterest: number;
  partnerCommission: number;
  installmentAmount: number;
  suggestedInstallments: SuggestedInstallment[];
} {
  // فرمول ساده محاسبه سود (PMT)
  // برای سادگی در این مرحله از فرمول سود ساده استفاده می‌کنیم
  // در فازهای بعدی می‌توان از فرمول بانکی دقیق‌تر استفاده کرد
  const totalInterest = Math.round(amount * (plan.interestRate / 100) * (termCount / 12));
  const totalPayment = amount + totalInterest;
  const partnerCommission = Math.round(totalInterest * (plan.commissionRate / 100));
  
  // تعداد چک‌ها یا پرداخت‌ها بر اساس دوره پرداخت
  // اگر اقساط ۱۲ ماهه باشد و دوره پرداخت ۳۰ روزه -> ۱۲ قسط
  // اگر دوره ۶۰ روزه -> ۶ قسط
  const installmentCount = Math.ceil((termCount * 30) / paymentPeriod);
  const installmentAmount = Math.round(totalPayment / installmentCount);

  const suggestedInstallments: SuggestedInstallment[] = [];
  const now = new Date();

  for (let i = 1; i <= installmentCount; i++) {
    const dueDate = new Date(now);
    dueDate.setDate(now.getDate() + (i * paymentPeriod));
    
    suggestedInstallments.push({
      dueDate: dueDate.toISOString().split('T')[0],
      amount: i === installmentCount ? (totalPayment - (installmentAmount * (installmentCount - 1))) : installmentAmount,
      description: `قسط شماره ${i} - پرونده اعتبار نماینده`
    });
  }

  return {
    totalPayment,
    totalInterest,
    partnerCommission,
    installmentAmount,
    suggestedInstallments
  };
}

/**
 * قانون تعیین خودکار اولین سررسید و سررسید اقساط بعدی در سامانه بتا:
 * - اگر تاریخ ثبت پرونده بین روز 1 تا 15 ماه خورشیدی باشد: اولین قسط در تاریخ 30 همان ماه سررسید می‌شود.
 * - اگر تاریخ ثبت پرونده بین روز 16 تا پایان ماه خورشیدی باشد: اولین قسط در تاریخ 30 ماه بعد سررسید می‌شود.
 * - اقساط بعدی تماماً به صورت ماهانه در روز 30 ماه‌های خورشیدی بعد ایجاد می‌شوند.
 */
export function calculateBetaInstallmentDates(createdAtIso: string, count: number): { firstDueDate: string; dueDates: string[] } {
  const fileDate = new Date(createdAtIso);
  const [jy, jm, jd] = gregorianToJalali(
    fileDate.getFullYear(),
    fileDate.getMonth() + 1,
    fileDate.getDate()
  );

  let firstJm = jm;
  let firstJy = jy;

  if (jd >= 1 && jd <= 15) {
    firstJm = jm;
  } else {
    firstJm = jm + 1;
    if (firstJm > 12) {
      firstJm = 1;
      firstJy += 1;
    }
  }

  const dueDates: string[] = [];
  for (let idx = 0; idx < count; idx++) {
    let currentJm = firstJm + idx;
    let currentJy = firstJy;

    while (currentJm > 12) {
      currentJm -= 12;
      currentJy += 1;
    }

    const dueDate = `${currentJy}/${String(currentJm).padStart(2, '0')}/30`;
    dueDates.push(dueDate);
  }

  return {
    firstDueDate: dueDates[0] || `${firstJy}/${String(firstJm).padStart(2, '0')}/30`,
    dueDates
  };
}

/**
 * تبدیل پرونده اعتبار نماینده (CreditFile) به اسناد مالی واقعی و ایجاد خودکار دفترچه اقساط پس از تایید نهایی مدیر
 */
export function finalizeCreditFile(fileId: string, state: AppState): Partial<AppState> {
  const file = (state.creditFiles || []).find(f => f.id === fileId);
  if (!file) {
    throw new Error('پرونده یافت نشد.');
  }

  // Validation Guard: check if the calculator is allowed for this partner
  if (file.calculatorId && file.calculatorId !== 'default' && !isCalculatorAllowedForPartner(file.representativeId, file.calculatorId, state)) {
    throw new Error('ماشین‌حساب انتخاب شده برای این نماینده مجاز نمی‌باشد.');
  }

  // بررسی تکرار نهایی‌سازی: اگر اسناد یا دفترچه قبلاً برای این پرونده ثبت شده باشند
  const hasExistingVoucher = (state.vouchers || []).some(
    v => (v as any).creditFileId === file.id || (v.description && v.description.includes(file.id))
  );
  const hasExistingBooklet = (state.installmentBooks || []).some(b => b.creditFileId === file.id);
  if (hasExistingVoucher || hasExistingBooklet) {
    console.warn(`[STRICT IDEMPOTENCY GUARD] عملیات نهایی‌سازی قبلاً برای پرونده ${file.id} انجام شده است. سیستم جلوی صدور سند تکراری را گرفت.`);
    return {}; 
  }

  // === [قفل متقابل کنترل تعهدات اعتباری موازی و دفترچه‌های اقساط تسویه‌نشده] ===
  // ۱. بررسی صلاحیت اعتباری و تسویه کامل مشتری (گیت مرکزی تسویه)
  const customerPersonForFile = (state.persons || []).find(p => p.id === file.personId);
  if (customerPersonForFile) {
    const eligibility = checkCustomerCreditEligibility(customerPersonForFile.nationalId, state, { excludeFileId: file.id });
    if (!eligibility.isEligible) {
      throw new Error(`امکان نهایی‌سازی پرونده وجود ندارد: ${eligibility.reasons.join(' | ')}`);
    }
  }

  // ۲. بررسی وجود دفترچه اقساط فعال و تسویه‌نشده برای این مشتری
  const activeBookletForCustomer = (state.installmentBooks || []).find(b => b.personId === file.personId && b.status === 'active');
  if (activeBookletForCustomer) {
    throw new Error(`امکان نهایی‌سازی پرونده وجود ندارد: مشتری دارای دفترچه اقساط فعال و تسویه‌نشده (شناسه: ${activeBookletForCustomer.id}) در سیستم می‌باشد.`);
  }

  // ۳. بررسی وجود درخواست اعتباری در جریان از مسیر همکار (PartnerCreditRequest) برای این مشتری
  const activePartnerRequest = (state.partnerCreditRequests || []).find(r => 
    r.customerPersonId === file.personId && 
    ![PartnerCreditRequestStatus.REJECTED, PartnerCreditRequestStatus.CANCELLED].includes(r.status)
  );
  if (activePartnerRequest) {
    throw new Error(`امکان نهایی‌سازی پرونده وجود ندارد: مشتری دارای پرونده اعتباری در جریان در پورتال همکاران (شناسه: ${activePartnerRequest.id}) می‌باشد.`);
  }

  const isBeta = resolveCalculatorType(`${file.calculatorId || ''} ${file.plan || ''}`, file.calculatorName) === 'beta' ||
                 (file.plan || '').toLowerCase().includes('beta') ||
                 (file.plan || '').includes('بتا') ||
                 (file.calculatorName || '').toLowerCase().includes('beta') ||
                 (file.calculatorName || '').includes('بتا') ||
                 (file.calculatorId || '').toLowerCase().includes('beta');

  let results = file.calculationResults;

  // اگر محاسبات پرونده وجود نداشته باشد، برای سامانه بتا از موتور مرکزی محاسبه اقساط (calculateBeta) محاسبه می‌شود
  if (!results) {
    if (isBeta) {
      const cleanRepId = (file.representativeId || '').replace('BP_', '').replace('p_', '');
      const partnerBp = (state.businessPartners || []).find(p => {
        if (!file.representativeId) return false;
        if (p.id === file.representativeId || p.personId === file.representativeId) return true;
        const cleanPId = (p.id || '').replace('BP_', '').replace('p_', '');
        const cleanPersonId = (p.personId || '').replace('BP_', '').replace('p_', '');
        if (cleanPId && cleanPId === cleanRepId) return true;
        if (cleanPersonId && cleanPersonId === cleanRepId) return true;
        if (p.profile?.partnerId === file.representativeId || p.profile?.partnerId === cleanRepId) return true;
        if (p.users && p.users.includes(file.representativeId)) return true;
        const userMatch = state.users?.find(u => u.id === file.representativeId);
        if (userMatch && userMatch.personId && (userMatch.personId === p.personId || userMatch.personId === p.id)) return true;
        return false;
      });
      const resolvedConfig = resolveEffectiveCalculatorSettings(
        file.calculatorId || 'beta',
        partnerBp,
        state.calculators,
        state.settings
      );
      const calcEngineRes = calculateBeta(
        file.requestedAmount,
        12, // تعداد اقساط پیش‌فرض بتا
        1,  // اقساط فقط ماهانه
        file.agentCommissionAmount || 0,
        resolvedConfig
      );
      results = {
        creditAmount: file.requestedAmount,
        installmentCount: calcEngineRes.installmentCount,
        installmentAmount: Math.round(calcEngineRes.finalTotal / calcEngineRes.installmentCount),
        totalCommission: calcEngineRes.finalTotal - file.requestedAmount,
        totalRepayment: calcEngineRes.finalTotal,
        agentCommissionAmount: calcEngineRes.representativeCommissionAmount,
        agentCommissionRate: calcEngineRes.representativeCommissionPercent
      };
    } else {
      throw new Error('محاسبات پرونده یافت نشد.');
    }
  }

  const customer = state.persons.find(p => p.id === file.personId);
  if (!customer) {
    throw new Error('اطلاعات مشتری مربوط به پرونده در سیستم یافت نشد.');
  }

  // === [قفل کنترل چک‌های دریافتی] ===
  // تمامی چک‌های پرونده باید تایید شده (APPROVED) باشند.
  if (!isBeta && file.receivedChecks && file.receivedChecks.length > 0) {
    const unapprovedChecks = file.receivedChecks.filter(chk => chk.reviewStatus !== 'APPROVED');
    if (unapprovedChecks.length > 0) {
      throw new Error(`امکان نهایی‌سازی وجود ندارد: تعداد ${unapprovedChecks.length} چک هنوز تایید نهایی نشده‌اند. ابتدا وضعیت تمامی چک‌ها را به "تایید شده" تغییر دهید.`);
    }
  }

  const now = new Date().toISOString();
  const jalaliNow = now.split('T')[0].replace(/-/g, '/');

  // چک‌ها برای بتا کلاً خالی است
  const newChecks: Check[] = isBeta ? [] : (file.receivedChecks || []).map(sc => ({
    id: sc.id || `CHK_${Date.now()}_${sc.checkNumber}`,
    type: 'received',
    checkNumber: sc.checkNumber,
    bankName: sc.bankName,
    dueDate: sc.dueDate,
    amount: sc.amount,
    personId: file.personId,
    nationalId: sc.nationalId || customer?.nationalId || '',
    currentState: sc.currentState || 'present_in_cashbox',
    isInstallment: true,
    isAmani: false,
    history: sc.history || [{
      state: 'present_in_cashbox',
      date: sc.dueDate,
      note: 'ثبت خودکار از پرونده اعتبار نماینده'
    }],
    createdAt: sc.createdAt || now,
    createdBy: sc.createdBy || 'system',
    representativeId: file.representativeId,
    status: 'active'
  }));

  const settlementType = isBeta ? 'installment_book' : (file.settlementType || (newChecks.length > 0 ? 'checks' : 'installment_book'));
  const shouldCreateBooklet = isBeta || settlementType === 'installment_book';

  let installmentBook: InstallmentBook | undefined;
  const installments: Installment[] = [];

  const matchedCalc = (state.calculators || []).find(c => c.id === file.calculatorId || c.id === file.plan);
  const defaultBetaCalc = (state.calculators || []).find(c => c.type === 'beta' || (c.name || '').includes('بتا'));
  const inheritedBankId = file.agentBankId || matchedCalc?.agentBankId || (isBeta ? defaultBetaCalc?.agentBankId : undefined);
  const inheritedBankName = file.agentBankName || matchedCalc?.bankName || (isBeta ? defaultBetaCalc?.bankName : undefined);

  if (shouldCreateBooklet) {
    const count = results.installmentCount || 1;
    const betaDatesInfo = isBeta ? calculateBetaInstallmentDates(file.createdAt || now, count) : null;

    installmentBook = {
      id: `IB_${Date.now()}`,
      personId: file.personId,
      creditFileId: file.id,
      calculatorId: file.calculatorId || matchedCalc?.id,
      agentBankId: inheritedBankId,
      agentBankName: inheritedBankName,
      totalPrincipal: file.requestedAmount,
      totalInterest: results.totalCommission,
      totalAmount: results.totalRepayment,
      installmentCount: count,
      startDate: betaDatesInfo ? betaDatesInfo.firstDueDate : jalaliNow,
      intervalDays: 30,
      status: 'active',
      createdAt: now,
      createdBy: 'system',
    };

    if (count > 0) {
      const singleAmount = Math.round(results.totalRepayment / count);
      const singleInterest = Math.round(results.totalCommission / count);

      if (isBeta && betaDatesInfo) {
        for (let idx = 0; idx < count; idx++) {
          const amt = idx === count - 1 
            ? results.totalRepayment - (singleAmount * (count - 1)) 
            : singleAmount;
          const interestPart = idx === count - 1 
            ? results.totalCommission - (singleInterest * (count - 1)) 
            : singleInterest;
          const principalPart = amt - interestPart;

          installments.push({
            id: `inst_${installmentBook.id}_${idx + 1}`,
            bookId: installmentBook.id,
            installmentNumber: idx + 1,
            dueDate: betaDatesInfo.dueDates[idx],
            amount: amt,
            paidAmount: 0,
            calculatorId: file.calculatorId || matchedCalc?.id,
            agentBankId: inheritedBankId,
            agentBankName: inheritedBankName,
            interestPart,
            principalPart,
            penaltyAmount: 0,
            delayDays: 0,
            status: 'upcoming'
          });
        }
      } else if (newChecks.length > 0) {
        const checkCount = newChecks.length;
        const checkSingleInterest = Math.round(results.totalCommission / checkCount);
        newChecks.forEach((chk, idx) => {
          const interestPart = idx === checkCount - 1 
            ? results.totalCommission - (checkSingleInterest * (checkCount - 1)) 
            : checkSingleInterest;
          const principalPart = chk.amount - interestPart;
          installments.push({
            id: `inst_${installmentBook.id}_${idx + 1}`,
            bookId: installmentBook.id,
            installmentNumber: idx + 1,
            dueDate: chk.dueDate,
            amount: chk.amount,
            paidAmount: 0,
            interestPart,
            principalPart,
            penaltyAmount: 0,
            delayDays: 0,
            status: 'upcoming'
          });
        });
      } else {
        let currentJalali = jalaliNow;
        for (let idx = 0; idx < count; idx++) {
          const amt = idx === count - 1 
            ? results.totalRepayment - (singleAmount * (count - 1)) 
            : singleAmount;
          const interestPart = idx === count - 1 
            ? results.totalCommission - (singleInterest * (count - 1)) 
            : singleInterest;
          const principalPart = amt - interestPart;

          const parts = currentJalali.split('/');
          let y = parseInt(parts[0], 10);
          let m = parseInt(parts[1], 10) + 1;
          let d = parseInt(parts[2], 10);
          if (m > 12) {
            m = 1;
            y += 1;
          }
          const nextDate = `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
          currentJalali = nextDate;

          installments.push({
            id: `inst_${installmentBook.id}_${idx + 1}`,
            bookId: installmentBook.id,
            installmentNumber: idx + 1,
            dueDate: nextDate,
            amount: amt,
            paidAmount: 0,
            interestPart,
            principalPart,
            penaltyAmount: 0,
            delayDays: 0,
            status: 'upcoming'
          });
        }
      }
    }

    // کنترل صحت ایجاد دفترچه اقساط (تضمین الگوی Atomic و جلوگیری از ثبت داده ناقص)
    if (!installmentBook || installments.length === 0) {
      throw new Error('خطای سیستمی: ایجاد دفترچه اقساط با موفقیت انجام نشد.');
    }
  }

  // پیدا کردن نماینده به عنوان شخص در جدول اشخاص
  const partnerPerson = state.persons.find(p => p.id === file.representativeId) ||
    (() => {
      const partner = state.businessPartners?.find(p => p.id === file.representativeId || p.personId === file.representativeId);
      return partner ? state.persons.find(p => p.id === partner.personId) : undefined;
    })() ||
    (() => {
      const u = state.users?.find(u => u.id === file.representativeId);
      return u?.personId ? state.persons.find(p => p.id === u.personId) : undefined;
    })();

  const partnerObj = state.businessPartners?.find(p => p.id === file.representativeId || p.personId === file.representativeId);
  const resolvedPartnerName = partnerPerson?.name || 'نماینده';
  const resolvedPartnerPersonId = partnerPerson?.id || partnerObj?.personId || file.representativeId;

  const nextVoucherNumber = getNextVoucherNumber(state.vouchers || []);
  const agentCommission = file.agentCommissionAmount || 0;
  const companyCommission = results.totalCommission - agentCommission;
  const actualPrincipal = results.totalRepayment - results.totalCommission;

  // ایجاد سند اول: ثبت اعتبار مشتری
  const voucher: JournalVoucher = {
    id: `JV_PARTNER_${Date.now()}`,
    voucherNumber: nextVoucherNumber,
    date: jalaliNow,
    gregorianDate: now,
    isAutomatic: true,
    description: `سند اعتبار پرونده نماینده ${file.id} - مشتری ${customer?.name || 'ناشناس'}`,
    contractType: 'credit',
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
        floatingDetailed: { type: 'person', id: file.personId, name: customer?.name || 'ناشناس' },
        debit: actualPrincipal + companyCommission,
        credit: 0,
        description: 'بدهکاری مشتری بابت خرید اقساطی از نماینده',
        contractType: 'credit'
      },
      {
        subsidiaryId: 'SUB_CREDITORS',
        floatingDetailed: { type: 'person', id: resolvedPartnerPersonId, name: resolvedPartnerName },
        debit: 0,
        credit: actualPrincipal,
        description: `بستانکاری نماینده بابت فروش کالا به مشتری (تامین اعتبار)`,
        contractType: 'credit'
      },
      {
        subsidiaryId: 'SUB_INTEREST_INCOME',
        debit: 0,
        credit: companyCommission,
        description: 'درآمد کارمزد فروش اقساطی پرونده اعتباری (سهم شرکت)',
        contractType: 'credit'
      }
    ],
    createdBy: 'system',
    status: 'active',
    creditFileId: file.id
  } as any;

  // ============================================================================
  // ⚠️ BUSINESS CRITICAL - VOUCHER GENERATION LOGIC
  // Any changes to the accounting entries below must pass regression tests.
  // Do NOT modify this automatically without explicit authorization.
  // ============================================================================
  
  // ایجاد سند دوم: ثبت حق کمیسیون نماینده (بستانکار: نماینده مربوطه)
  const commissionVoucher: JournalVoucher | null = (agentCommission > 0) ? {
    id: `JV_PARTNER_COMM_${Date.now()}`,
    voucherNumber: nextVoucherNumber + 1,
    date: jalaliNow,
    gregorianDate: now,
    isAutomatic: true,
    description: `سند ثبت حق کمیسیون نماینده ${resolvedPartnerName} بابت پرونده ${file.id}`,
    contractType: 'credit',
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
        floatingDetailed: { type: 'person', id: file.personId, name: customer?.name || 'ناشناس' },
        debit: agentCommission,
        credit: 0,
        description: `بدهکاری مشتری بابت حق کمیسیون نماینده پرونده ${file.id}`,
        contractType: 'credit'
      },
      {
        subsidiaryId: 'SUB_CREDITORS',
        floatingDetailed: { type: 'person', id: resolvedPartnerPersonId, name: resolvedPartnerName },
        debit: 0,
        credit: agentCommission,
        description: `حق کمیسیون نماینده بابت پرونده ${file.id}`,
        contractType: 'credit'
      }
    ],
    createdBy: 'system',
    status: 'active',
    creditFileId: file.id
  } as any : null;

  const checkVouchers: JournalVoucher[] = [];
  const startCheckVoucherNo = nextVoucherNumber + (commissionVoucher ? 2 : 1);
  newChecks.forEach((chk, idx) => {
    const chkVoucherNo = startCheckVoucherNo + idx;
    const chkVoucher = createCheckStateVoucher(
      chk,
      customer?.name || 'ناشناس',
      '',
      'present_in_cashbox',
      chkVoucherNo
    );
    (chkVoucher as any).creditFileId = file.id;
    if (chk.history && chk.history.length > 0) {
      chk.history[0].voucherId = chkVoucher.id;
    }
    checkVouchers.push(chkVoucher);
  });

  const finalVouchers = [...(state.vouchers || []), voucher];
  if (commissionVoucher) {
    finalVouchers.push(commissionVoucher);
  }
  finalVouchers.push(...checkVouchers);

  // بروزرسانی خودکار وضعیت پرونده به approved در خروجی
  const updatedCreditFiles = (state.creditFiles || []).map(f =>
    f.id === fileId ? { ...f, status: 'approved' as const, calculationResults: results } : f
  );

  const existingBooks = (state.installmentBooks || []).filter(b => b.creditFileId !== file.id);
  const finalBooks = (shouldCreateBooklet && installmentBook) ? [...existingBooks, installmentBook] : (state.installmentBooks || []);

  const existingBookIds = new Set(existingBooks.map(b => b.id));
  const existingInstallments = (state.installments || []).filter(i => existingBookIds.has(i.bookId) || (installmentBook && i.bookId !== installmentBook.id));
  const finalInstallments = shouldCreateBooklet ? [...existingInstallments, ...installments] : (state.installments || []);

  console.log('====================================================');
  console.log('=== [BETA / CREDIT FILE APPROVAL EXECUTION TRACE] ===');
  console.log('1. File ID (شناسه پرونده):', file.id);
  console.log('2. Customer ID (شناسه مشتری):', file.personId);
  console.log('3. Created Booklet ID (شناسه دفترچه ایجاد شده):', installmentBook?.id || 'NO_BOOKLET');
  console.log('4. Number of Installments Created (تعداد اقساط ایجاد شده):', installments.length);
  console.log('5. Booklet present in final installmentBooks array?:', finalBooks.some(b => b.id === installmentBook?.id));
  console.log('6. installmentBook.personId === customerId?:', installmentBook?.personId === file.personId);
  console.log('7. installmentBook.creditFileId === file.id?:', installmentBook?.creditFileId === file.id);
  console.log('====================================================');

  const existingCheckIds = new Set((state.checks || []).map(c => c.id));
  const existingCheckNumbers = new Set((state.checks || []).map(c => `${c.checkNumber}_${c.personId}`));
  const filteredNewChecks = newChecks.filter(c => !existingCheckIds.has(c.id) && !existingCheckNumbers.has(`${c.checkNumber}_${c.personId}`));

  return {
    creditFiles: updatedCreditFiles,
    checks: [...(state.checks || []), ...filteredNewChecks],
    installmentBooks: finalBooks,
    installments: finalInstallments,
    vouchers: finalVouchers,
    auditLogs: [
      ...(state.auditLogs || []),
      {
        id: `LOG_${Date.now()}`,
        timestamp: now,
        userId: 'system',
        userName: 'Admin',
        action: 'CREATE',
        entityType: 'VOUCHER',
        entityId: voucher.id,
        details: `پرونده اعتباری ${file.id} نهایی و دفترچه اقساط و اسناد مربوطه صادر شد.`
      }
    ]
  };
}

export interface ContractAccountSummary {
  contractType: 'credit' | 'deferred_sales' | string;
  contractTitle: string;
  debit: number;
  credit: number;
  net: number;
  nature: 'بدهکار' | 'بستانکار' | 'بی‌حساب';
  vouchersCount: number;
}

export function isVoucherMatchingContractType(
  voucher: JournalVoucher,
  entry: VoucherEntry,
  contractType: string
): boolean {
  if (entry.contractType) {
    return entry.contractType === contractType;
  }
  if (voucher.contractType) {
    return voucher.contractType === contractType;
  }
  
  const sourceType = voucher.sourceType || '';
  const isInvoice = sourceType === 'sell_invoice' || sourceType === 'buy_invoice';

  if (contractType === 'deferred_sales') {
    if (isInvoice) return true;
    const text = (voucher.description || '') + ' ' + (entry.description || '');
    return text.includes('فاکتور') || text.includes('فروش نسیه') || text.includes('خرید نسیه') || text.includes('عمده');
  }

  if (contractType === 'credit') {
    // If it's a sales/buy invoice, it belongs to deferred_sales, not credit
    if (isInvoice) return false;

    const text = (voucher.description || '') + ' ' + (entry.description || '');
    if (
      text.includes('اعتبار') ||
      text.includes('پرونده') ||
      text.includes('کمیسیون') ||
      text.includes('تامین') ||
      text.includes('پرداخت') ||
      text.includes('تسویه') ||
      text.includes('دریافت') ||
      text.includes('نماینده') ||
      text.includes('پورسانت') ||
      text.includes('حق‌الزحمه') ||
      text.includes('واریز') ||
      text.includes('حواله') ||
      text.includes('چک') ||
      text.includes('بانک') ||
      text.includes('صندوق') ||
      voucher.id?.includes('JV_PARTNER') ||
      sourceType === 'installment_book' ||
      sourceType === 'cash_transaction' ||
      sourceType === 'manual'
    ) {
      return true;
    }
    // Default fallback for any non-invoice voucher attached to the person
    return true;
  }

  return false;
}

export function getPartnerContractAccountSummary(
  vouchers: JournalVoucher[],
  personId: string,
  contractType: 'credit' | 'deferred_sales' | string
): ContractAccountSummary {
  let totalDebit = 0;
  let totalCredit = 0;
  let count = 0;

  (vouchers || []).forEach(v => {
    if (v.status === 'voided') return;
    (v.entries || []).forEach(e => {
      if (e.floatingDetailed && e.floatingDetailed.type === 'person' && e.floatingDetailed.id === personId) {
        if (isVoucherMatchingContractType(v, e, contractType)) {
          totalDebit += e.debit || 0;
          totalCredit += e.credit || 0;
          count++;
        }
      }
    });
  });

  const diff = totalDebit - totalCredit;
  const net = Math.abs(diff);
  const nature: 'بدهکار' | 'بستانکار' | 'بی‌حساب' = diff > 0 ? 'بدهکار' : diff < 0 ? 'بستانکار' : 'بی‌حساب';

  const contractTitle = contractType === 'credit' 
    ? 'قرارداد اعتباری' 
    : contractType === 'deferred_sales' 
    ? 'قرارداد فروش نسیه' 
    : `قرارداد ${contractType}`;

  return {
    contractType,
    contractTitle,
    debit: totalDebit,
    credit: totalCredit,
    net,
    nature,
    vouchersCount: count
  };
}

export function getPartnerContractVouchers(
  vouchers: JournalVoucher[],
  personId: string,
  contractType: 'credit' | 'deferred_sales' | string
): JournalVoucher[] {
  return (vouchers || []).filter(v => {
    if (v.status === 'voided') return false;
    return (v.entries || []).some(e => 
      e.floatingDetailed && 
      e.floatingDetailed.type === 'person' && 
      e.floatingDetailed.id === personId && 
      isVoucherMatchingContractType(v, e, contractType)
    );
  });
}

/**
 * Single Source of Truth (SSOT) Resolver for BusinessPartner Credit Rules.
 * Official Source: BusinessPartner -> creditExtension -> creditRules
 * Fallbacks safely to legacy fields if creditRules is not initialized yet.
 */
export function resolvePartnerCreditRules(
  personOrId: Person | string | undefined | null,
  businessPartners: BusinessPartner[] = []
): ResolvedPartnerCreditRules {
  if (!personOrId) {
    return {
      maxCreditLimit: 500000000,
      defaultInstallmentDays: 30,
      penaltyRatePerMonth: 0.1,
      allowedCalculators: [],
      isCreditEnabled: true
    };
  }

  const personId = typeof personOrId === 'string' ? personOrId : personOrId.id;
  const person = typeof personOrId === 'object' ? personOrId : undefined;

  const bp = (businessPartners || []).find(
    p => p.personId === personId || p.id === personId
  );

  if (bp) {
    const rules = bp.creditExtension?.creditRules;
    const maxCreditLimit =
      rules?.maxCreditLimit ??
      bp.profile?.creditLimit ??
      bp.nesyehSettings?.creditLimit ??
      bp.contract?.creditLimit ??
      person?.creditLimit ??
      500000000;

    const defaultInstallmentDays =
      rules?.defaultInstallmentDays ??
      bp.nesyehSettings?.paymentTermDays ??
      person?.allowedDelayDays ??
      30;

    const penaltyRatePerMonth =
      rules?.penaltyRatePerMonth ??
      bp.nesyehSettings?.lateFeePercentage ??
      person?.penaltyRate ??
      0.1;

    const allowedCalculators =
      bp.creditExtension?.allowedCalculators ??
      bp.allowedCalculatorIds ??
      [];

    const isCreditEnabled = person?.isInstallmentEnabled !== false;

    return {
      maxCreditLimit,
      maxPerDossierLimit: rules?.maxPerDossierLimit,
      defaultInstallmentDays,
      penaltyRatePerMonth,
      allowedCalculators,
      isCreditEnabled,
      renewalType: rules?.renewalType || 'AUTO',
      activePeriodJalali: rules?.activePeriodJalali
    };
  }

  // Fallback if no BusinessPartner record found yet
  return {
    maxCreditLimit: person?.creditLimit ?? 500000000,
    defaultInstallmentDays: person?.allowedDelayDays ?? 30,
    penaltyRatePerMonth: person?.penaltyRate ?? 0.1,
    allowedCalculators: [],
    isCreditEnabled: person?.isInstallmentEnabled !== false
  };
}

export interface CreditRulesMigrationReport {
  totalChecked: number;
  migratedCount: number;
  alreadyValidCount: number;
  errorCount: number;
  mismatches: Array<{ partnerId: string; personId: string; reason: string }>;
  updatedState: AppState;
}

/**
 * Safe Migration Helper: Ensures all BusinessPartner records have populated
 * BusinessPartner.creditExtension.creditRules matching SSOT standards.
 */
export function ensurePartnerCreditRulesInSync(state: AppState): CreditRulesMigrationReport {
  const businessPartners = state.businessPartners || [];
  const persons = state.persons || [];
  let migratedCount = 0;
  let alreadyValidCount = 0;
  let errorCount = 0;
  const mismatches: Array<{ partnerId: string; personId: string; reason: string }> = [];

  const updatedBPs = businessPartners.map(bp => {
    try {
      const person = persons.find(p => p.id === bp.personId);
      const rules = bp.creditExtension?.creditRules;

      const resolved = resolvePartnerCreditRules(person || bp.personId, businessPartners);

      // Check for mismatch between Person legacy fields and BusinessPartner SSOT rules
      if (person && person.creditLimit !== undefined && rules?.maxCreditLimit !== undefined && person.creditLimit !== rules.maxCreditLimit) {
        mismatches.push({
          partnerId: bp.id,
          personId: person.id,
          reason: `مغایرت سقف اعتبار: Person (${person.creditLimit.toLocaleString()}) vs BusinessPartner (${rules.maxCreditLimit.toLocaleString()})`
        });
      }

      if (!rules || rules.maxCreditLimit === undefined) {
        migratedCount++;
        return {
          ...bp,
          creditExtension: {
            ...(bp.creditExtension || {}),
            allowedCalculators: bp.creditExtension?.allowedCalculators || bp.allowedCalculatorIds || [],
            creditRules: {
              ...(bp.creditExtension?.creditRules || {}),
              maxCreditLimit: resolved.maxCreditLimit,
              defaultInstallmentDays: resolved.defaultInstallmentDays,
              penaltyRatePerMonth: resolved.penaltyRatePerMonth
            }
          }
        };
      } else {
        alreadyValidCount++;
      }

      return bp;
    } catch (err: any) {
      errorCount++;
      mismatches.push({
        partnerId: bp.id,
        personId: bp.personId || 'UNKNOWN',
        reason: `خطا در پردازش مهاجرت: ${err?.message || String(err)}`
      });
      return bp;
    }
  });

  return {
    totalChecked: businessPartners.length,
    migratedCount,
    alreadyValidCount,
    errorCount,
    mismatches,
    updatedState: {
      ...state,
      businessPartners: updatedBPs
    }
  };
}

/**
 * Helper to record Credit Rules Audit History for a BusinessPartner.
 * Checks if there is an actual change between old rules and new rules.
 * Returns updated creditExtension object with new rules and audit history entry (if rules changed).
 */
export function recordPartnerCreditRulesChange(
  bp: Partial<BusinessPartner>,
  newRules: Partial<PartnerCreditRules>,
  options?: { changedByUserId?: string; changedByUserName?: string; changeReason?: string }
): CreditPartnerExtension {
  const currentExt = bp.creditExtension || {};
  const oldRules = currentExt.creditRules;
  const existingHistory = currentExt.history || [];

  const hasChange = !oldRules ||
    oldRules.maxCreditLimit !== newRules.maxCreditLimit ||
    oldRules.defaultInstallmentDays !== newRules.defaultInstallmentDays ||
    oldRules.penaltyRatePerMonth !== newRules.penaltyRatePerMonth;

  if (!hasChange) {
    return {
      ...currentExt,
      creditRules: {
        ...(oldRules || {}),
        ...newRules
      }
    };
  }

  const historyEntry: CreditRuleHistoryEntry = {
    id: `CRH_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    partnerId: bp.id || 'UNKNOWN',
    changedAt: new Date().toISOString(),
    changedByUserId: options?.changedByUserId,
    changedByUserName: options?.changedByUserName || 'سیستم',
    changeReason: options?.changeReason,
    previousRules: oldRules ? {
      maxCreditLimit: oldRules.maxCreditLimit,
      defaultInstallmentDays: oldRules.defaultInstallmentDays,
      penaltyRatePerMonth: oldRules.penaltyRatePerMonth
    } : undefined,
    newRules: {
      maxCreditLimit: newRules.maxCreditLimit,
      defaultInstallmentDays: newRules.defaultInstallmentDays,
      penaltyRatePerMonth: newRules.penaltyRatePerMonth
    }
  };

  return {
    ...currentExt,
    creditRules: {
      ...(oldRules || {}),
      ...newRules
    },
    history: [historyEntry, ...existingHistory]
  };
}

/**
 * ابطال اتمیک پرونده اعتباری (Atomic Credit Cancellation)
 * - بررسی عدم وجود پرداخت روی اقساط
 * - صدور سند معکوس با استفاده از createReverseVoucher
 * - تغییر وضعیت دفترچه اقساط و اقساط پرداخت‌نشده به canceled
 * - آزادسازی وثایق/چک‌های مرتبط
 * - تغییر وضعیت پرونده اعتباری به canceled
 * - ثبت Audit Log
 */
export function cancelCreditFileAtomic(fileId: string, state: AppState, voidReason?: string): { success: boolean; message: string; newState?: AppState } {
  const file = (state.creditFiles || []).find(f => f.id === fileId);
  if (!file) {
    return { success: false, message: 'پرونده اعتباری مورد نظر در سیستم یافت نشد.' };
  }

  if (file.status === 'canceled') {
    return { success: false, message: 'این پرونده اعتباری قبلاً ابطال شده است.' };
  }

  // پیدا کردن دفترچه‌های اقساط مرتبط
  const books = (state.installmentBooks || []).filter(b => b.creditFileId === fileId || b.id === fileId);
  const bookIds = new Set(books.map(b => b.id));
  
  // پیدا کردن اقساط مرتبط
  const installments = (state.installments || []).filter(i => bookIds.has(i.bookId));

  // بررسی وجود قسط پرداخت‌شده
  const paidInstallment = installments.find(i => 
    (i.paidAmount && i.paidAmount > 0) || i.status === 'paid' || i.status === 'partially_paid'
  );

  if (paidInstallment) {
    return {
      success: false,
      message: `❌ امکان ابطال پرونده اعتباری وجود ندارد!\n\nدلیل: پرونده دارای حداقل یک قسط پرداخت‌شده (قسط شماره ${paidInstallment.installmentNumber}) است.\n\nبر اساس قوانین حسابداری، ابطال پرونده‌های دارای پرداختی ممنوع است.`
    };
  }

  const jalaliNow = new Date().toISOString().split('T')[0].replace(/-/g, '/');

  // ۱. صدور سند معکوس با استفاده از createReverseVoucher برای اسناد فعال مرتبط
  const activeVouchers = (state.vouchers || []).filter(v => 
    v.status !== 'voided' && (
      v.sourceId === fileId || 
      bookIds.has(v.sourceId || '') || 
      v.description?.includes(fileId) ||
      Array.from(bookIds).some(bId => v.description?.includes(bId))
    )
  );

  let nextVoucherNo = getNextVoucherNumber(state.vouchers || []);
  let nextVouchers = [...(state.vouchers || [])];

  activeVouchers.forEach(origV => {
    const idx = nextVouchers.findIndex(v => v.id === origV.id);
    if (idx !== -1) {
      nextVouchers[idx] = { ...origV, status: 'voided' as const };
      const revV = createReverseVoucher(origV, jalaliNow, voidReason || `ابطال پرونده اعتباری ${fileId}`, nextVoucherNo);
      nextVouchers.push(revV);
      nextVoucherNo++;
    }
  });

  // ۲. تغییر وضعیت دفترچه اقساط به canceled
  const nextBooks = (state.installmentBooks || []).map(b => {
    if (bookIds.has(b.id)) {
      return {
        ...b,
        status: 'canceled' as const,
        voidedAt: jalaliNow,
        voidReason: voidReason || `ابطال پرونده اعتباری ${fileId}`
      };
    }
    return b;
  });

  // ۳. تغییر وضعیت تمام اقساط پرداخت‌نشده به canceled
  const nextInstallments = (state.installments || []).map(inst => {
    if (bookIds.has(inst.bookId)) {
      if (inst.status !== 'paid' && inst.status !== 'partially_paid') {
        return {
          ...inst,
          status: 'canceled' as const
        };
      }
    }
    return inst;
  });

  // ۴. آزادسازی وثایق و چک‌های مرتبط (در صورت وجود)
  const checkIdsToRelease = new Set<string>();
  if (file.receivedChecks) {
    file.receivedChecks.forEach(rc => checkIdsToRelease.add(rc.id));
  }
  const nextChecks = (state.checks || []).map(chk => {
    if (checkIdsToRelease.has(chk.id) || (chk.isInstallment && chk.representativeId === file.representativeId && chk.personId === file.personId)) {
      return {
        ...chk,
        currentState: 'CANCELLED' as any
      };
    }
    return chk;
  });

  // ۵. تغییر وضعیت پرونده اعتباری به canceled
  const nextCreditFiles = (state.creditFiles || []).map(f => {
    if (f.id === fileId) {
      return {
        ...f,
        status: 'canceled' as const
      };
    }
    return f;
  });

  // ۶. ثبت Audit Log
  const now = new Date().toISOString();
  const auditLog = {
    id: `LOG_CANCEL_${Date.now()}`,
    timestamp: now,
    userId: 'system',
    userName: 'Admin',
    action: 'UPDATE' as const,
    entityType: 'VOUCHER' as const,
    entityId: fileId,
    details: `ابطال اتمیک پرونده اعتباری ${fileId}، صدور اسناد معکوس و تغییر وضعیت دفترچه اقساط و وثایق.`
  };

  const newState: AppState = {
    ...state,
    creditFiles: nextCreditFiles,
    installmentBooks: nextBooks,
    installments: nextInstallments,
    checks: nextChecks,
    vouchers: nextVouchers,
    auditLogs: [...(state.auditLogs || []), auditLog]
  };

  return {
    success: true,
    message: 'پرونده اعتباری با موفقیت و به صورت اتمیک ابطال گردید.',
    newState
  };
}

/**
 * Security Guard: Checks if a calculator is allowed for a business partner / representative.
 * Single Source of Truth: BusinessPartner -> creditExtension -> allowedCalculators OR allowedCalculatorIds
 */
export function isCalculatorAllowedForPartner(
  representativeId: string | undefined | null,
  calculatorId: string | undefined | null,
  state: AppState
): boolean {
  if (!calculatorId) return false;
  if (!representativeId) return false;

  // 'default' is a special non-calculator placeholder used in PartnerCustomerDocuments, which is allowed
  if (calculatorId === 'default') return true;

  // Let's resolve the business partner associated with this representativeId or representativeId as userId
  const cleanId = representativeId.replace('BP_', '');
  let partner = (state.businessPartners || []).find(p => 
    p.personId === representativeId || 
    p.personId === cleanId || 
    p.id === representativeId || 
    p.id === `BP_${cleanId}` ||
    p.profile?.partnerId === representativeId ||
    (p.users || []).includes(representativeId)
  );

  if (!partner) {
    // Check if the representativeId is a user ID, and find their partner
    const user = state.users?.find(u => u.id === representativeId);
    if (user) {
      partner = (state.businessPartners || []).find(p => 
        p.id === user.id || 
        p.personId === user.personId || 
        (p.users || []).includes(user.id)
      );
    }
  }

  // If no partner record is found, they are not allowed to submit dossiers with calculators
  if (!partner) {
    return false;
  }

  const extCalcs = partner.creditExtension?.allowedCalculators;
  const bpCalcs = partner.allowedCalculatorIds;
  const allowedIds = (extCalcs && extCalcs.length > 0)
    ? extCalcs
    : (bpCalcs && bpCalcs.length > 0)
      ? bpCalcs
      : [];

  if (allowedIds.length === 0) return true;
  return allowedIds.includes(calculatorId);
}

/**
 * Auto-Correction Engine: Clean up duplicate credit file vouchers, checks, and booklets
 * that might have been created due to race conditions or duplicate approval triggers.
 */
export function deduplicateCreditFileVouchers(state: AppState): AppState {
  if (!state.vouchers || state.vouchers.length === 0) return state;

  const creditFiles = state.creditFiles || [];
  if (creditFiles.length === 0) return state;

  let hasChanges = false;

  const seenVoucherSignatures = new Set<string>();
  const cleanedVouchers: any[] = [];

  for (const v of state.vouchers) {
    let associatedFileId: string | undefined = (v as any).creditFileId;
    if (!associatedFileId && v.description) {
      const match = creditFiles.find(f => v.description?.includes(f.id));
      if (match) associatedFileId = match.id;
    }

    if (associatedFileId) {
      const isCommission = v.description?.includes('حق کمیسیون') || v.description?.includes('COMM');
      const isCheck = v.description?.includes('چک') || (v as any).checkId;
      const firstEntry = v.entries?.[0];
      const entryDesc = firstEntry?.description || '';
      const entryDebit = firstEntry?.debit || 0;
      const entryCredit = firstEntry?.credit || 0;

      const voucherTypeKey = isCommission ? 'comm' : isCheck ? `chk_${entryDesc}` : 'main';
      const sigKey = `CF_${associatedFileId}_${voucherTypeKey}_${entryDebit}_${entryCredit}`;

      if (seenVoucherSignatures.has(sigKey)) {
        console.warn(`[DEDUPLICATION ENGINE] Removing duplicate voucher ${v.id} for credit file ${associatedFileId}`);
        hasChanges = true;
        continue;
      }
      seenVoucherSignatures.add(sigKey);
    }
    cleanedVouchers.push(v);
  }

  const seenCheckKeys = new Set<string>();
  const cleanedChecks: any[] = [];
  for (const chk of (state.checks || [])) {
    const key = `${chk.personId}_${chk.checkNumber}_${chk.amount}`;
    if (seenCheckKeys.has(key)) {
      console.warn(`[DEDUPLICATION ENGINE] Removing duplicate check ${chk.id} (${chk.checkNumber})`);
      hasChanges = true;
      continue;
    }
    seenCheckKeys.add(key);
    cleanedChecks.push(chk);
  }

  const seenBookletFiles = new Set<string>();
  const cleanedBooks: any[] = [];
  for (const book of (state.installmentBooks || [])) {
    if (book.creditFileId) {
      if (seenBookletFiles.has(book.creditFileId)) {
        console.warn(`[DEDUPLICATION ENGINE] Removing duplicate booklet ${book.id} for file ${book.creditFileId}`);
        hasChanges = true;
        continue;
      }
      seenBookletFiles.add(book.creditFileId);
    }
    cleanedBooks.push(book);
  }

  if (!hasChanges) return state;

  return {
    ...state,
    vouchers: cleanedVouchers,
    checks: cleanedChecks,
    installmentBooks: cleanedBooks
  };
}


