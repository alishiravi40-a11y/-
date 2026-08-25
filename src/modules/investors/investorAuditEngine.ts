/**
 * Investor Audit Engine
 * Maintained audit trail for all critical investor operations:
 * Tracks Who, When, What change, and Which contract.
 */

import { InvestorAuditLog } from './types';

export interface CreateAuditLogParams {
  contractId?: string;
  investorPersonId?: string;
  action: 'CAPITAL_CHANGE' | 'RATE_CHANGE' | 'STATUS_CHANGE' | 'REFERRAL_CHANGE' | 'PAYMENT_TERMS_CHANGE' | 'RETURN_REQUEST' | 'INSTITUTIONAL_REGISTER';
  performedBy: string;
  previousValue?: string;
  newValue?: string;
  description: string;
}

export class InvestorAuditEngine {
  /**
   * Log an operational event
   */
  public static logAction(params: CreateAuditLogParams): InvestorAuditLog {
    return {
      id: `AUD_INV_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      contractId: params.contractId,
      investorPersonId: params.investorPersonId,
      action: params.action,
      performedBy: params.performedBy,
      timestamp: new Date().toISOString(),
      previousValue: params.previousValue,
      newValue: params.newValue,
      description: params.description,
    };
  }

  /**
   * Filter audit logs by contract or person
   */
  public static getLogsForContract(
    logs: InvestorAuditLog[],
    contractId: string
  ): InvestorAuditLog[] {
    return logs.filter((log) => log.contractId === contractId);
  }
}
