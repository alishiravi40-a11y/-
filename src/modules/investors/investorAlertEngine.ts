/**
 * Investor Smart Alert Engine
 * Scans investor contracts, obligations, return requests, and profiles
 * to produce actionable smart alerts for executive management.
 */

import {
  InvestorContract,
  InvestorPaymentObligation,
  InvestorProfile,
  InvestorReturnRequest,
  InvestorAlert,
} from './types';

export class InvestorAlertEngine {
  /**
   * Generate all smart alerts for Manager Alert Center
   */
  public static generateAlerts(
    contracts: InvestorContract[],
    obligations: InvestorPaymentObligation[],
    returnRequests: InvestorReturnRequest[] = [],
    profiles: InvestorProfile[] = [],
    currentDate: string = '1403/01/01'
  ): InvestorAlert[] {
    const alerts: InvestorAlert[] = [];

    // 1. Upcoming Payments (پرداخت‌های نزدیک) - Obligations due in next 15 days
    obligations.forEach((obl) => {
      if (obl.status === 'PLANNED' || obl.status === 'DUE') {
        if (obl.dueDate >= currentDate && obl.dueDate <= '1403/12/29') {
          alerts.push({
            id: `ALT_PAY_${obl.id}`,
            type: 'UPCOMING_PAYMENT',
            severity: obl.status === 'DUE' ? 'warning' : 'info',
            title: 'سررسید پرداخت کارمزد سرمایه‌گذار',
            description: `تعهد پرداخت به مبلغ ${obl.amount.toLocaleString('fa-IR')} ریال در تاریخ ${obl.dueDate} سررسید می‌شود.`,
            contractId: obl.contractId,
            investorPersonId: obl.investorPersonId,
            dueDate: obl.dueDate,
            createdAt: new Date().toISOString(),
          });
        }
      }
    });

    // 2. Contracts Near Expiration (قراردادهای نزدیک به پایان)
    contracts.forEach((ctr) => {
      if (ctr.status === 'active' && ctr.endDate) {
        if (ctr.endDate >= currentDate) {
          alerts.push({
            id: `ALT_EXP_${ctr.id}`,
            type: 'EXPIRING_CONTRACT',
            severity: 'warning',
            title: 'نزدیک شدن به تاریخ پایان قرارداد',
            description: `قرارداد شماره ${ctr.contractNumber} با سرمایه ${ctr.currentCapital.toLocaleString('fa-IR')} ریال در تاریخ ${ctr.endDate} خاتمه می‌یابد.`,
            contractId: ctr.id,
            investorPersonId: ctr.investorPersonId,
            dueDate: ctr.endDate,
            createdAt: new Date().toISOString(),
          });
        }
      }
    });

    // 3. Investors with Recent Changes (تغییرات اخیر)
    contracts.forEach((ctr) => {
      if (ctr.changeLogs && ctr.changeLogs.length > 0) {
        const latestChange = ctr.changeLogs[ctr.changeLogs.length - 1];
        alerts.push({
          id: `ALT_CHG_${ctr.id}_${latestChange.id}`,
          type: 'RECENT_CHANGE',
          severity: 'info',
          title: `تغییر جدید در قرارداد (${latestChange.changeType})`,
          description: `قرارداد ${ctr.contractNumber}: ${latestChange.description}`,
          contractId: ctr.id,
          investorPersonId: ctr.investorPersonId,
          createdAt: latestChange.changedAt,
        });
      }
    });

    // 4. Investment Return Requests (درخواست‌های برگشت سرمایه)
    returnRequests.forEach((req) => {
      if (req.status === 'PENDING') {
        alerts.push({
          id: `ALT_RET_${req.id}`,
          type: 'RETURN_REQUEST',
          severity: 'critical',
          title: 'درخواست بازگشت اصل سرمایه',
          description: `سرمایه‌گذار درخواست بازگشت مبلغ ${req.requestedAmount.toLocaleString('fa-IR')} ریال را ثبت کرده است. علت: ${req.reason || 'بدون توضیح'}`,
          contractId: req.contractId,
          investorPersonId: req.investorPersonId,
          createdAt: req.createdAt,
        });
      }
    });

    // 5. Potential Data Warnings (خطاهای احتمالی اطلاعات)
    profiles.forEach((p) => {
      if (!p.bankAccountDetails || !p.bankAccountDetails.iban) {
        alerts.push({
          id: `ALT_WARN_BANK_${p.id}`,
          type: 'DATA_WARNING',
          severity: 'info',
          title: 'اطلاعات بانکی ناقص',
          description: `شماره شبا یا حساب برای پرونده سرمایه‌گذار ثبت نشده است.`,
          investorPersonId: p.personId,
          createdAt: new Date().toISOString(),
        });
      }
    });

    return alerts;
  }
}
