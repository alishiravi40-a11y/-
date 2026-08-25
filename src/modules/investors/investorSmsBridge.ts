/**
 * Investor SMS Event Bridge
 * Integrates investor domain notifications with SmsEventBus without coupling accounting or financial core.
 */

import { SmsEventBus } from '../sms/eventBus';

export interface InvestorRegisteredPayload {
  investorPersonId: string;
  investorName: string;
  mobile?: string;
  category?: string;
  timestamp?: string;
}

export interface InvestmentReceivedPayload {
  contractNumber: string;
  investorName: string;
  mobile?: string;
  amount: number;
  startDate: string;
  monthlyFeeRate: number;
}

export interface CommissionPaymentDuePayload {
  contractNumber: string;
  investorName: string;
  mobile?: string;
  dueDate: string;
  amount: number;
}

export interface CommissionPaidPayload {
  contractNumber: string;
  investorName: string;
  mobile?: string;
  amountPaid: number;
  paymentDate: string;
  voucherId?: string;
}

export interface InvestorContractExpiringPayload {
  contractNumber: string;
  investorName: string;
  mobile?: string;
  endDate: string;
  remainingDays: number;
}

export interface InvestmentReturnRequestedPayload {
  contractNumber: string;
  investorName: string;
  mobile?: string;
  requestedAmount: number;
  requestDate: string;
}

export interface ContractChangedPayload {
  contractNumber: string;
  investorName: string;
  mobile?: string;
  changeType: 'CAPITAL_INCREASE' | 'CAPITAL_DECREASE' | 'RATE_CHANGE' | 'RENEWAL';
  effectiveDate: string;
  details: string;
}

export class InvestorSmsBridge {
  /**
   * Dispatch INVESTOR_REGISTERED event
   */
  public static notifyInvestorRegistered(payload: InvestorRegisteredPayload): void {
    SmsEventBus.publish('INVESTOR_REGISTERED', {
      ...payload,
      timestamp: payload.timestamp || new Date().toISOString(),
    });
  }

  /**
   * Dispatch INVESTMENT_RECEIVED event
   */
  public static notifyInvestmentReceived(payload: InvestmentReceivedPayload): void {
    SmsEventBus.publish('INVESTMENT_RECEIVED', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Dispatch COMMISSION_PAYMENT_DUE event
   */
  public static notifyCommissionPaymentDue(payload: CommissionPaymentDuePayload): void {
    SmsEventBus.publish('COMMISSION_PAYMENT_DUE', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Dispatch COMMISSION_PAID event
   */
  public static notifyCommissionPaid(payload: CommissionPaidPayload): void {
    SmsEventBus.publish('COMMISSION_PAID', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Dispatch INVESTOR_CONTRACT_EXPIRING event
   */
  public static notifyContractExpiring(payload: InvestorContractExpiringPayload): void {
    SmsEventBus.publish('INVESTOR_CONTRACT_EXPIRING', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Dispatch INVESTMENT_RETURN_REQUESTED event
   */
  public static notifyInvestmentReturnRequested(payload: InvestmentReturnRequestedPayload): void {
    SmsEventBus.publish('INVESTMENT_RETURN_REQUESTED', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Dispatch contract changes event (Capital change, rate change, extension)
   */
  public static notifyContractChanged(payload: ContractChangedPayload): void {
    SmsEventBus.publish('INVESTOR_CONTRACT_CHANGED', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }
}
