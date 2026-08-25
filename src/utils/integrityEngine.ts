import {
  Person,
  BusinessPartner,
  AgencyType,
  Invoice,
  JournalVoucher,
  Check,
  InstallmentBook,
  Installment,
  NesyehPurchaseOrder,
  NesyehPaymentDeclaration,
  NesyehOrderableItem,
  User
} from '../types';
import { resolvePartnerCreditRules } from './partnerProcess';
import { generateUniquePersonCode } from './codeGenerator';

/**
 * Interface representing the complete system state database snapshot.
 * Used as input/output for state transitions to ensure immutable state updates.
 */
export interface SystemState {
  persons: Person[];
  businessPartners: BusinessPartner[];
  invoices: Invoice[];
  vouchers: JournalVoucher[];
  checks: Check[];
  installmentBooks: InstallmentBook[];
  installments: Installment[];
  nesyehCatalog: NesyehOrderableItem[];
  nesyehPurchaseOrders: NesyehPurchaseOrder[];
  nesyehPaymentDeclarations: NesyehPaymentDeclaration[];
  users: User[];
}

/**
 * System Event Definition for Event Bus Communication
 */
export interface SystemEvent {
  id: string;
  timestamp: string;
  type: string;
  payload: any;
  traceId: string;
}

export type EventCallback = (event: SystemEvent) => void;

/**
 * Event Bus Implementation (Observer Pattern)
 */
export class EventBus {
  private static instance: EventBus;
  private listeners: Map<string, Set<EventCallback>> = new Map();

  private constructor() {}

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  public subscribe(eventType: string, callback: EventCallback): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);
    return () => {
      this.listeners.get(eventType)?.delete(callback);
    };
  }

  public publish(event: SystemEvent): void {
    const callbacks = this.listeners.get(event.type);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(event);
        } catch (err) {
          console.error(`Error in event listener for ${event.type}:`, err);
        }
      });
    }
    // Also support global listeners for trace/analytics
    const wildcardCallbacks = this.listeners.get('*');
    if (wildcardCallbacks) {
      wildcardCallbacks.forEach(cb => {
        try {
          cb(event);
        } catch (err) {
          console.error(`Error in wildcard event listener:`, err);
        }
      });
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}

/**
 * Trace Log step tracking inside a single transaction/operation
 */
export interface TraceLogStep {
  description: string;
  target: string;
  status: 'updated' | 'ignored' | 'failed';
  details?: string;
}

/**
 * Trace Log Entry representing the output log of an executed transaction
 */
export interface TraceLogEntry {
  id: string;
  timestamp: string;
  traceId: string;
  action: string;
  entityType: string;
  entityId: string;
  status: 'success' | 'failed';
  steps: TraceLogStep[];
  errorReason?: string;
}

/**
 * Trace Logger Service
 */
export class TraceLogger {
  private static instance: TraceLogger;
  private logs: TraceLogEntry[] = [];

  private constructor() {}

  public static getInstance(): TraceLogger {
    if (!TraceLogger.instance) {
      TraceLogger.instance = new TraceLogger();
    }
    return TraceLogger.instance;
  }

  public log(entry: TraceLogEntry): void {
    this.logs.unshift(entry);
    // Keep logs size bounded (e.g., last 1000 logs)
    if (this.logs.length > 1000) {
      this.logs.pop();
    }
  }

  public getLogs(): TraceLogEntry[] {
    return [...this.logs];
  }

  public getLogsForEntity(entityType: string, entityId: string): TraceLogEntry[] {
    return this.logs.filter(l => l.entityType === entityType && l.entityId === entityId);
  }

  public clear(): void {
    this.logs = [];
  }
}

/**
 * Impact Block constraint structure
 */
export interface ImpactBlock {
  reason: string;
  severity: 'critical' | 'warning';
}

/**
 * Affected Entity structure for Impact Analysis reporting
 */
export interface AffectedEntitySummary {
  entityType: string;
  count: number;
  ids: string[];
  cascadeAction: string;
}

/**
 * Detailed Impact Analysis Report
 */
export interface ImpactReport {
  isSafe: boolean;
  action: 'create' | 'update' | 'delete' | 'deactivate' | 'suspend' | 'archive' | 'restore';
  entityType: string;
  entityId: string;
  blocks: ImpactBlock[];
  affectedEntities: AffectedEntitySummary[];
}

/**
 * Impact Analyzer Service (Dependency Resolution Graph)
 */
export class ImpactAnalyzer {
  public static analyze(
    action: 'create' | 'update' | 'delete' | 'deactivate' | 'suspend' | 'archive' | 'restore',
    entityType: 'Person' | 'BusinessPartner',
    entityId: string,
    state: SystemState
  ): ImpactReport {
    const blocks: ImpactBlock[] = [];
    const affectedEntities: AffectedEntitySummary[] = [];

    if (entityType === 'Person') {
      const person = state.persons.find(p => p.id === entityId);
      if (!person && action !== 'create') {
        blocks.push({ reason: `شخص با شناسه ${entityId} یافت نشد.`, severity: 'critical' });
        return { isSafe: false, action, entityType, entityId, blocks, affectedEntities };
      }

      if (action === 'delete') {
        // 1. Financial Invoices Check
        const relatedInvoices = state.invoices.filter(inv => inv.personId === entityId);
        if (relatedInvoices.length > 0) {
          blocks.push({
            reason: `امکان حذف شخص وجود ندارد؛ فاکتورهای مالی ثبت‌شده به تعداد ${relatedInvoices.length} فاکتور یافت شد. برای حفظ یکپارچگی مالی حسابداری، رکورد شخص نباید حذف فیزیکی شود.`,
            severity: 'critical'
          });
        }

        // 2. Journal Vouchers (Entries) Check
        const relatedVouchers = state.vouchers.filter(v =>
          v.entries.some(e => e.floatingDetailed?.type === 'person' && e.floatingDetailed.id === entityId)
        );
        if (relatedVouchers.length > 0) {
          blocks.push({
            reason: `امکان حذف شخص وجود ندارد؛ این شخص دارای اسناد حسابداری ثبت‌شده (به تعداد ${relatedVouchers.length}) در قالب حساب تفصیلی شناور است.`,
            severity: 'critical'
          });
        }

        // 3. Outstanding Cheques
        const relatedChecks = state.checks.filter(c => c.personId === entityId);
        const unpaidChecks = relatedChecks.filter(c => c.currentState !== 'cleared' && c.currentSubState !== 'returned_to_customer');
        if (unpaidChecks.length > 0) {
          blocks.push({
            reason: `امکان حذف شخص وجود ندارد؛ چکهای وصول‌نشده یا عودت‌داده‌نشده به تعداد ${unpaidChecks.length} فقره یافت شد.`,
            severity: 'critical'
          });
        }

        // 4. Installment Portfolios
        const relatedBooks = state.installmentBooks.filter(b => b.personId === entityId);
        const activeBooks = relatedBooks.filter(b => b.status === 'active');
        if (activeBooks.length > 0) {
          blocks.push({
            reason: `امکان حذف شخص وجود ندارد؛ پرونده‌های اقساطی فعال به تعداد ${activeBooks.length} پرونده یافت شد.`,
            severity: 'critical'
          });
        }

        // 5. Dependent Business Partners
        const relatedPartners = state.businessPartners.filter(bp => bp.personId === entityId);
        if (relatedPartners.length > 0) {
          affectedEntities.push({
            entityType: 'BusinessPartner',
            count: relatedPartners.length,
            ids: relatedPartners.map(rp => rp.id),
            cascadeAction: 'حذف متناظر یا ابطال نقش همکار تجاری'
          });
          blocks.push({
            reason: `شخص به عنوان همکار تجاری (نماینده/خریدار) در سیستم تعریف شده است. حذف شخص، همکار تجاری مربوطه را یتیم (Orphan) می‌کند.`,
            severity: 'warning'
          });
        }

        // 6. Linked Users
        const linkedUsers = state.users.filter(u => u.personId === entityId);
        if (linkedUsers.length > 0) {
          affectedEntities.push({
            entityType: 'User',
            count: linkedUsers.length,
            ids: linkedUsers.map(u => u.id),
            cascadeAction: 'غیرفعال‌سازی یا معلق‌سازی حساب کاربری'
          });
        }
      }

      if (action === 'deactivate' || action === 'suspend') {
        // Warn if they have active credit files or unpaid items
        const relatedBooks = state.installmentBooks.filter(b => b.personId === entityId && b.status === 'active');
        if (relatedBooks.length > 0) {
          blocks.push({
            reason: `تعلیق/غیرفعال‌سازی شخص دارای پرونده اقساطی فعال است. سیستم پروندههای در جریان را بررسی می‌کند؛ پرداختها کماکان باید دریافت شوند.`,
            severity: 'warning'
          });
        }

        const relatedPartners = state.businessPartners.filter(bp => bp.personId === entityId && bp.status === 'active');
        if (relatedPartners.length > 0) {
          affectedEntities.push({
            entityType: 'BusinessPartner',
            count: relatedPartners.length,
            ids: relatedPartners.map(bp => bp.id),
            cascadeAction: 'تعلیق خودکار نقش همکار تجاری و مسدود کردن خریدهای بعدی'
          });
        }

        const linkedUsers = state.users.filter(u => u.personId === entityId);
        if (linkedUsers.length > 0) {
          affectedEntities.push({
            entityType: 'User',
            count: linkedUsers.length,
            ids: linkedUsers.map(u => u.id),
            cascadeAction: 'غیرفعال‌سازی موقت دسترسی حساب کاربری به پنل نمایندگان'
          });
        }
      }
    }

    if (entityType === 'BusinessPartner') {
      const partner = state.businessPartners.find(bp => bp.id === entityId);
      if (!partner && action !== 'create') {
        blocks.push({ reason: `همکار تجاری با شناسه ${entityId} یافت نشد.`, severity: 'critical' });
        return { isSafe: false, action, entityType, entityId, blocks, affectedEntities };
      }

      if (partner) {
        const personId = partner.personId;

        // 1. Related Agent Invoices (Financial/Operational)
        const relatedInvoices = state.invoices.filter(
          inv => (inv as any).submittedByAgentId === entityId || 
                 (personId && (inv as any).submittedByAgentId === personId) ||
                 (inv as any).salesPartnerId === entityId ||
                 (inv as any).agentId === entityId ||
                 (personId && (inv as any).agentId === personId)
        );
        if (relatedInvoices.length > 0) {
          affectedEntities.push({
            entityType: 'Invoice',
            count: relatedInvoices.length,
            ids: relatedInvoices.map(i => i.id),
            cascadeAction: 'بدون تغییر (مسدود شده به علت وجود فاکتورهای ثبت‌شده توسط نماینده)'
          });
          if (action === 'delete') {
            blocks.push({
              reason: `امکان حذف نقش نماینده فروش وجود ندارد؛ فاکتورهای ثبت‌شده توسط این نماینده به تعداد ${relatedInvoices.length} فقره یافت شد.`,
              severity: 'critical'
            });
          }
        }

        // 2. Related Journal Vouchers / Partner Wallet Entries (Financial)
        const relatedVouchers = state.vouchers.filter(v =>
          v.entries.some(e => 
            e.floatingDetailed?.id === entityId || 
            (e.subsidiaryId === 'SUB_PARTNER_WALLET' && e.floatingDetailed?.id === entityId) ||
            (personId && e.subsidiaryId === 'SUB_PARTNER_WALLET' && e.floatingDetailed?.id === personId)
          )
        );
        if (relatedVouchers.length > 0) {
          affectedEntities.push({
            entityType: 'JournalVoucher',
            count: relatedVouchers.length,
            ids: relatedVouchers.map(v => v.id),
            cascadeAction: 'بدون تغییر (مسدود شده به علت وجود اسناد حسابداری/گردش کیف‌پول)'
          });
          if (action === 'delete') {
            blocks.push({
              reason: `امکان حذف نقش نماینده فروش وجود ندارد؛ اسناد حسابداری/کیف‌پول ثبت‌شده به تعداد ${relatedVouchers.length} سند یافت شد.`,
              severity: 'critical'
            });
          }
        }

        // 3. Related Agent Checks/Cheques (Financial)
        const relatedChecks = state.checks.filter(
          c => (c as any).submittedByAgentId === entityId || (personId && (c as any).submittedByAgentId === personId)
        );
        if (relatedChecks.length > 0) {
          affectedEntities.push({
            entityType: 'Check',
            count: relatedChecks.length,
            ids: relatedChecks.map(c => c.id),
            cascadeAction: 'بدون تغییر (مسدود شده به علت وجود چک‌های ثبت‌شده توسط نماینده)'
          });
          if (action === 'delete') {
            blocks.push({
              reason: `امکان حذف نقش نماینده فروش وجود ندارد؛ چک‌های ارسالی توسط این نماینده به تعداد ${relatedChecks.length} فقره یافت شد.`,
              severity: 'critical'
            });
          }
        }

        // 4. Related Credit Files Submitted by Agent (Operational)
        const relatedCreditFiles = (((state as any).creditFiles || []) as any[]).filter(
          f => f.submittedByAgentId === entityId || (personId && f.submittedByAgentId === personId)
        );
        if (relatedCreditFiles.length > 0) {
          affectedEntities.push({
            entityType: 'CreditFile',
            count: relatedCreditFiles.length,
            ids: relatedCreditFiles.map(f => f.id),
            cascadeAction: 'بدون تغییر (مسدود شده به علت وجود پرونده‌های اعتباری ارسالی)'
          });
          if (action === 'delete') {
            blocks.push({
              reason: `امکان حذف نقش نماینده فروش وجود ندارد؛ پرونده‌های اعتباری ارسالی توسط نماینده به تعداد ${relatedCreditFiles.length} فقره یافت شد.`,
              severity: 'critical'
            });
          }
        }

        // 5. Related Purchase Orders (Operational)
        const relatedOrders = (state.nesyehPurchaseOrders || []).filter(
          o => o.partnerId === entityId || (personId && o.partnerId === personId)
        );
        if (relatedOrders.length > 0) {
          affectedEntities.push({
            entityType: 'NesyehPurchaseOrder',
            count: relatedOrders.length,
            ids: relatedOrders.map(o => o.id),
            cascadeAction: action === 'delete' ? 'بدون تغییر (نیازمند لغو دستی سفارشها پیش از حذف)' : 'تعلیق خودکار فرآیند خریدهای معلق'
          });
          if (action === 'delete') {
            const activeOrders = relatedOrders.filter(o => o.status !== 'CANCELLED' && o.status !== 'REJECTED');
            if (activeOrders.length > 0) {
              blocks.push({
                reason: `امکان حذف همکار تجاری وجود ندارد؛ سفارش‌های خرید نسیه فعال به تعداد ${activeOrders.length} سفارش یافت شد.`,
                severity: 'critical'
              });
            }
          }
        }

        // 6. Related Payment Declarations (Operational)
        const relatedDeclarations = (state.nesyehPaymentDeclarations || []).filter(
          d => d.partnerId === entityId || (personId && d.partnerId === personId)
        );
        if (relatedDeclarations.length > 0) {
          affectedEntities.push({
            entityType: 'NesyehPaymentDeclaration',
            count: relatedDeclarations.length,
            ids: relatedDeclarations.map(d => d.id),
            cascadeAction: 'بدون تغییر (غیرقابل ویرایش خودکار)'
          });
          if (action === 'delete') {
            const pendingDeclarations = relatedDeclarations.filter(d => d.status === 'PENDING');
            if (pendingDeclarations.length > 0) {
              blocks.push({
                reason: `امکان حذف همکار تجاری وجود ندارد؛ اعلام‌های پرداخت در جریان/تایید نشده به تعداد ${pendingDeclarations.length} فقره یافت شد.`,
                severity: 'critical'
              });
            }
          }
        }

        // 7. Related Partner Settlements (Financial)
        const relatedSettlements = (((state as any).partnerSettlements || []) as any[]).filter(s => s.businessPartnerId === entityId);
        if (relatedSettlements.length > 0 && action === 'delete') {
          blocks.push({
            reason: `امکان حذف همکار تجاری وجود ندارد؛ تسویه‌حساب‌های ثبت‌شده به تعداد ${relatedSettlements.length} مورد یافت شد.`,
            severity: 'critical'
          });
        }

        // 8. Related Partner Credit Requests (Operational)
        const relatedCreditRequests = (((state as any).partnerCreditRequests || []) as any[]).filter(cr => cr.businessPartnerId === entityId);
        if (relatedCreditRequests.length > 0 && action === 'delete') {
          blocks.push({
            reason: `امکان حذف همکار تجاری وجود ندارد؛ درخواست‌های اعتبار ثبت‌شده به تعداد ${relatedCreditRequests.length} فقره یافت شد.`,
            severity: 'critical'
          });
        }
      }

      if (action === 'deactivate' || action === 'suspend') {
        const pendingOrders = (state.nesyehPurchaseOrders || []).filter(
          o => (o.partnerId === entityId || (partner?.personId && o.partnerId === partner.personId)) && ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(o.status)
        );
        if (pendingOrders.length > 0) {
          affectedEntities.push({
            entityType: 'NesyehPurchaseOrder',
            count: pendingOrders.length,
            ids: pendingOrders.map(o => o.id),
            cascadeAction: 'تعلیق خودکار یا مسدودسازی تا زمان فعال‌سازی مجدد'
          });
          blocks.push({
            reason: `نماینده دارای ${pendingOrders.length} سفارش خرید معلق در جریان است؛ غیرفعالسازی باعث مسدود شدن فرآیند این سفارشها خواهد شد.`,
            severity: 'warning'
          });
        }
      }
    }

    const hasCriticalBlock = blocks.some(b => b.severity === 'critical');
    return {
      isSafe: !hasCriticalBlock,
      action,
      entityType,
      entityId,
      blocks,
      affectedEntities
    };
  }
}

/**
 * Integrity Guard (Validations and Consistency Checks)
 */
export class IntegrityGuard {
  /**
   * Evaluates if a new person object violates any uniqueness/structural constraints
   */
  public static validatePerson(person: Partial<Person>, state: SystemState, isUpdate = false): string[] {
    const errors: string[] = [];

    if (!isUpdate) {
      if (!person.name || person.name.trim() === '') {
        errors.push('نام و نام خانوادگی شخص الزامی است.');
      }
      if (!person.code || person.code.trim() === '') {
        errors.push('کد شخص الزامی است.');
      }
    }

    // Uniqueness of code
    if (person.code) {
      const duplicateCode = state.persons.find(
        p => p.code === person.code && (!isUpdate || p.id.trim().toLowerCase() !== person.id?.trim().toLowerCase())
      );
      if (duplicateCode) {
        errors.push(`کد شخص تکراری است؛ مقدار ${person.code} قبلاً توسط شخص دیگری استفاده شده است.`);
      }
    }

    // Uniqueness of National ID (if provided)
    if (person.nationalId && person.nationalId.trim() !== '') {
      const cleanNationalId = person.nationalId.trim();
      const duplicateNationalId = state.persons.find(
        p => p.nationalId === cleanNationalId && (!isUpdate || p.id.trim().toLowerCase() !== person.id?.trim().toLowerCase())
      );
      if (duplicateNationalId) {
        errors.push(`کد ملی تکراری است؛ مقدار ${cleanNationalId} متعلق به شخص دیگری در سیستم است.`);
      }
    }

    return errors;
  }

  /**
   * Evaluates if a business partner object violates any consistency/structural constraints
   */
  public static validateBusinessPartner(partner: Partial<BusinessPartner>, state: SystemState, isUpdate = false): string[] {
    const errors: string[] = [];

    if (!isUpdate) {
      if (!partner.id || partner.id.trim() === '') {
        errors.push('شناسه همکار تجاری الزامی است.');
      }
      if (!partner.personId || partner.personId.trim() === '') {
        errors.push('شناسه شخص مرجع برای همکار تجاری الزامی است.');
      }
    }

    if (partner.personId) {
      const personExists = state.persons.some(p => p.id === partner.personId);
      if (!personExists) {
        errors.push(`شخص مرجع با شناسه ${partner.personId} در سیستم یافت نشد.`);
      }

      const duplicatePartner = state.businessPartners.find(
        bp => bp.personId === partner.personId && (!isUpdate || bp.id !== partner.id)
      );
      if (duplicatePartner) {
        errors.push(`این شخص قبلاً دارای یک پرونده همکار تجاری با شناسه ${duplicatePartner.id} بوده است.`);
      }
    }

    if (partner.nesyehSettings) {
      if (partner.nesyehSettings.creditLimit !== undefined && partner.nesyehSettings.creditLimit < 0) {
        errors.push('سقف اعتبار خرید نسیه نمی‌تواند منفی باشد.');
      }
      if (partner.nesyehSettings.paymentTermDays !== undefined && partner.nesyehSettings.paymentTermDays < 0) {
        errors.push('مهلت تسویه نمی‌تواند منفی باشد.');
      }
      if (partner.nesyehSettings.lateFeePercentage !== undefined && partner.nesyehSettings.lateFeePercentage < 0) {
        errors.push('درصد جریمه تاخیر نمی‌تواند منفی باشد.');
      }
    }

    return errors;
  }

  /**
   * Verifies if a journal voucher adheres to double-entry balance requirements
   */
  public static verifyVoucherBalance(voucher: JournalVoucher): boolean {
    if (!voucher.entries || voucher.entries.length === 0) return false;
    const totalDebit = voucher.entries.reduce((sum, e) => sum + (e.debit || 0), 0);
    const totalCredit = voucher.entries.reduce((sum, e) => sum + (e.credit || 0), 0);
    return Math.abs(totalDebit - totalCredit) < 0.01; // Support tiny decimal tolerances
  }
}

/**
 * Lifecycle State Machine and Rules Manager
 */
export class LifecycleManager {
  // Define transitions for Onboarding Profile Statuses
  private static readonly ONBOARDING_TRANSITIONS: Record<string, string[]> = {
    'DRAFT': ['COMPLETED_INFO'],
    'COMPLETED_INFO': ['MANAGER_APPROVED', 'REJECTED'],
    'MANAGER_APPROVED': ['ACTIVE', 'REJECTED'],
    'ACTIVE': ['SUSPENDED', 'TERMINATED'],
    'SUSPENDED': ['ACTIVE', 'TERMINATED'],
    'TERMINATED': ['ACTIVE'] // Can restore if needed
  };

  /**
   * Validates if onboarding state transition is permitted
   */
  public static canTransitionOnboarding(fromStatus: string, toStatus: string): boolean {
    const allowed = this.ONBOARDING_TRANSITIONS[fromStatus] || [];
    return allowed.includes(toStatus);
  }

  /**
   * Enforces transition rules for Onboarding Status and returns a transition summary or error
   */
  public static validateOnboardingTransition(
    partner: BusinessPartner,
    targetStatus: 'DRAFT' | 'COMPLETED_INFO' | 'MANAGER_APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED'
  ): { allowed: boolean; error?: string } {
    const currentStatus = partner.nesyehOnboarding?.onboardingStatus || 'DRAFT';
    
    if (currentStatus === targetStatus) {
      return { allowed: true };
    }

    const isAllowed = this.canTransitionOnboarding(currentStatus, targetStatus);
    if (!isAllowed) {
      return {
        allowed: false,
        error: `تغییر وضعیت غیرمجاز است: امکان انتقال مستقیم از وضعیت ${currentStatus} به وضعیت ${targetStatus} وجود ندارد.`
      };
    }

    // Additional validations per state
    if (targetStatus === 'ACTIVE') {
      // Must have guarantees and approved status
      const hasGuarantees = partner.nesyehOnboarding?.guarantees && partner.nesyehOnboarding.guarantees.length > 0;
      if (!hasGuarantees) {
        return {
          allowed: false,
          error: `امکان فعال‌سازی همکار تجاری وجود ندارد؛ حداقل یک مدرک ضمانت‌نامه معتبر باید ثبت شده باشد.`
        };
      }
    }

    return { allowed: true };
  }
}

/**
 * Result returned by the central integrity engine operations
 */
export interface ExecutionResult {
  success: boolean;
  updatedState: SystemState;
  traceLog: TraceLogEntry;
  impactReport?: ImpactReport;
  errors?: string[];
}

/**
 * Central Data Integrity and Entity Lifecycle Engine
 */
export class DataIntegrityEngine {
  private static instance: DataIntegrityEngine | null = null;

  public static getInstance(): DataIntegrityEngine {
    if (!this.instance) {
      this.instance = new DataIntegrityEngine();
    }
    return this.instance;
  }

  private eventBus = EventBus.getInstance();
  private logger = TraceLogger.getInstance();

  /**
   * Helper to generate unique trace IDs
   */
  private generateTraceId(): string {
    return `TRC_${Date.now()}_${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }

  /**
   * 1. Create a Person with full integrity guards
   */
  public createPerson(person: Person, state: SystemState): ExecutionResult {
    const traceId = this.generateTraceId();
    const steps: TraceLogStep[] = [];

    // Guard Checks
    const validationErrors = IntegrityGuard.validatePerson(person, state, false);
    if (validationErrors.length > 0) {
      const failLog: TraceLogEntry = {
        id: `LOG_${Date.now()}`,
        timestamp: new Date().toISOString(),
        traceId,
        action: 'CREATE_PERSON',
        entityType: 'Person',
        entityId: person.id,
        status: 'failed',
        steps: [{ description: 'اعتبارسنجی ورودی‌های شخص', target: 'Person', status: 'failed', details: validationErrors.join(' | ') }],
        errorReason: 'عدم تطابق با قوانین گارد یکپارچگی داده'
      };
      this.logger.log(failLog);
      return { success: false, updatedState: state, traceLog: failLog, errors: validationErrors };
    }

    steps.push({
      description: 'گارد اعتبارسنجی با موفقیت عبور کرد؛ کد ملی و کد شخصی یکتا هستند.',
      target: 'Person',
      status: 'updated'
    });

    // Immutable update
    const updatedPersons = [...state.persons, person];
    const newState: SystemState = {
      ...state,
      persons: updatedPersons
    };

    // Trace logging
    const successLog: TraceLogEntry = {
      id: `LOG_${Date.now()}`,
      timestamp: new Date().toISOString(),
      traceId,
      action: 'CREATE_PERSON',
      entityType: 'Person',
      entityId: person.id,
      status: 'success',
      steps
    };
    this.logger.log(successLog);

    // Event Publishing
    this.eventBus.publish({
      id: `EVT_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'PERSON_CREATED',
      payload: person,
      traceId
    });

    return { success: true, updatedState: newState, traceLog: successLog };
  }

  /**
   * 2. Update a Person and cascade status/details appropriately
   */
  public updatePerson(personId: string, updates: Partial<Person>, state: SystemState): ExecutionResult {
    const traceId = this.generateTraceId();
    const steps: TraceLogStep[] = [];

    const personIndex = state.persons.findIndex(p => p.id === personId);
    if (personIndex === -1) {
      const failLog = this.createFailLog(traceId, 'UPDATE_PERSON', 'Person', personId, `شخص با شناسه ${personId} یافت نشد.`);
      return { success: false, updatedState: state, traceLog: failLog, errors: [`شخص با شناسه ${personId} یافت نشد.`] };
    }

    const currentPerson = state.persons[personIndex];
    const proposedPerson = { ...currentPerson, ...updates };

    // Guard Checks
    const validationErrors = IntegrityGuard.validatePerson(proposedPerson, state, true);
    if (validationErrors.length > 0) {
      const failLog = this.createFailLog(traceId, 'UPDATE_PERSON', 'Person', personId, validationErrors.join(' | '));
      return { success: false, updatedState: state, traceLog: failLog, errors: validationErrors };
    }

    steps.push({
      description: 'اعتبارسنجی ویرایش با موفقیت انجام شد.',
      target: 'Person',
      status: 'updated'
    });

    let updatedState = { ...state };

    // Handle cascading changes if status/role updated
    if (updates.role && updates.role !== currentPerson.role) {
      steps.push({
        description: `تغییر نقش تفصیلی از ${currentPerson.role} به ${updates.role}`,
        target: 'Person',
        status: 'updated'
      });
    }

    // Implement Person State Update
    const updatedPersons = [...state.persons];
    updatedPersons[personIndex] = proposedPerson;
    updatedState.persons = updatedPersons;

    const successLog: TraceLogEntry = {
      id: `LOG_${Date.now()}`,
      timestamp: new Date().toISOString(),
      traceId,
      action: 'UPDATE_PERSON',
      entityType: 'Person',
      entityId: personId,
      status: 'success',
      steps
    };
    this.logger.log(successLog);

    // Event Publishing
    this.eventBus.publish({
      id: `EVT_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'PERSON_UPDATED',
      payload: proposedPerson,
      traceId
    });

    return { success: true, updatedState, traceLog: successLog };
  }

  /**
   * 3. Change Person Status with Cascading Integrity Rules
   */
  public changePersonStatus(personId: string, isApproved: boolean, state: SystemState): ExecutionResult {
    const traceId = this.generateTraceId();
    const steps: TraceLogStep[] = [];

    const personIndex = state.persons.findIndex(p => p.id === personId);
    if (personIndex === -1) {
      const failLog = this.createFailLog(traceId, 'CHANGE_PERSON_STATUS', 'Person', personId, `شخص با شناسه ${personId} یافت نشد.`);
      return { success: false, updatedState: state, traceLog: failLog, errors: [`شخص با شناسه ${personId} یافت نشد.`] };
    }

    const currentPerson = state.persons[personIndex];
    
    // Impact Analysis before changing status
    const impactReport = ImpactAnalyzer.analyze(isApproved ? 'restore' : 'deactivate', 'Person', personId, state);
    
    steps.push({
      description: `تحلیل اثر تغییر وضعیت شخص انجام شد. سطح سلامت عملیات: ${impactReport.isSafe ? 'ایمن' : 'بلاک‌شده'}`,
      target: 'Person',
      status: 'updated',
      details: `تعداد موارد تحت تاثیر: ${impactReport.affectedEntities.length}`
    });

    if (!impactReport.isSafe) {
      const errors = impactReport.blocks.map(b => b.reason);
      const failLog = this.createFailLog(traceId, 'CHANGE_PERSON_STATUS', 'Person', personId, errors.join(' | '));
      return { success: false, updatedState: state, traceLog: failLog, errors, impactReport };
    }

    let updatedState = { ...state };

    // Cascade: If deactivating/suspending, handle related entities
    if (!isApproved) {
      // 1. Cascade: Deactivate related Business Partners
      const updatedPartners = updatedState.businessPartners.map(bp => {
        if (bp.personId === personId && bp.status === 'active') {
          steps.push({
            description: `تعلیق خودکار نقش همکار تجاری نماینده به دلیل تعلیق شخص مرجع`,
            target: `BusinessPartner (${bp.id})`,
            status: 'updated'
          });
          return { ...bp, status: 'inactive' as any };
        }
        return bp;
      });
      updatedState.businessPartners = updatedPartners;

      // 2. Cascade: Suspend associated Users
      const updatedUsers = updatedState.users.map(u => {
        if (u.personId === personId) {
          steps.push({
            description: `مسدودسازی خودکار دسترسی حساب کاربری به پنل به دلیل تعلیق شخص مرجع`,
            target: `User (${u.id})`,
            status: 'updated'
          });
          // For safety, let's keep user roles or states updated
          return { ...u, allowedWarehouseIds: [] }; // Clear access permissions in this demo step safely
        }
        return u;
      });
      updatedState.users = updatedUsers;
    }

    // Apply main update
    const updatedPersons = [...updatedState.persons];
    updatedPersons[personIndex] = {
      ...currentPerson,
      isDocumentsApproved: isApproved
    };
    updatedState.persons = updatedPersons;

    // Sync corresponding BusinessPartner status
    if (updatedState.businessPartners) {
      const bpIndex = updatedState.businessPartners.findIndex(bp => bp.personId === personId || bp.id === personId);
      if (bpIndex !== -1) {
        const bp = updatedState.businessPartners[bpIndex];
        const updatedBpList = [...updatedState.businessPartners];
        updatedBpList[bpIndex] = {
          ...bp,
          status: isApproved ? 'active' : 'inactive',
          profile: {
            ...bp.profile,
            contractStatus: isApproved ? 'فعال' : 'غیرفعال'
          }
        };
        updatedState.businessPartners = updatedBpList;
      }
    }

    steps.push({
      description: `وضعیت مدارک شخص با موفقیت به ${isApproved ? 'تایید شده' : 'معلق'} تغییر یافت.`,
      target: 'Person',
      status: 'updated'
    });

    const successLog: TraceLogEntry = {
      id: `LOG_${Date.now()}`,
      timestamp: new Date().toISOString(),
      traceId,
      action: 'CHANGE_PERSON_STATUS',
      entityType: 'Person',
      entityId: personId,
      status: 'success',
      steps
    };
    this.logger.log(successLog);

    // Event Publishing
    this.eventBus.publish({
      id: `EVT_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'PERSON_STATUS_CHANGED',
      payload: { personId, isApproved },
      traceId
    });

    return { success: true, updatedState, traceLog: successLog, impactReport };
  }

  /**
   * 4. Soft-delete / Remove a Person safely with strict blocks on financial traces
   */
  public deletePerson(personId: string, state: SystemState): ExecutionResult {
    const traceId = this.generateTraceId();
    const steps: TraceLogStep[] = [];

    const personIndex = state.persons.findIndex(p => p.id === personId);
    if (personIndex === -1) {
      const failLog = this.createFailLog(traceId, 'DELETE_PERSON', 'Person', personId, `شخص با شناسه ${personId} یافت نشد.`);
      return { success: false, updatedState: state, traceLog: failLog, errors: [`شخص با شناسه ${personId} یافت نشد.`] };
    }

    // Analyze impact
    const impactReport = ImpactAnalyzer.analyze('delete', 'Person', personId, state);
    steps.push({
      description: `تحلیل اثر برای حذف فیزیکی شخص انجام شد. وضعیت امنیت عملیات: ${impactReport.isSafe ? 'ایمن' : 'بلاک‌شده'}`,
      target: 'Person',
      status: 'updated'
    });

    if (!impactReport.isSafe) {
      const errors = impactReport.blocks.map(b => b.reason);
      const failLog = this.createFailLog(traceId, 'DELETE_PERSON', 'Person', personId, errors.join(' | '));
      return { success: false, updatedState: state, traceLog: failLog, errors, impactReport };
    }

    let updatedState = { ...state };

    // Cascades: Deleting person cascades to deleting related Business Partners & Users safely (since no financial dependencies exist)
    const updatedPartners = updatedState.businessPartners.filter(bp => {
      if (bp.personId === personId) {
        steps.push({
          description: `حذف متناظر همکار تجاری به دلیل حذف شخص مرجع`,
          target: `BusinessPartner (${bp.id})`,
          status: 'updated'
        });
        return false;
      }
      return true;
    });
    updatedState.businessPartners = updatedPartners;

    const updatedUsers = updatedState.users.filter(u => {
      if (u.personId === personId) {
        steps.push({
          description: `حذف حساب کاربری متصل به شخص مرجع`,
          target: `User (${u.id})`,
          status: 'updated'
        });
        return false;
      }
      return true;
    });
    updatedState.users = updatedUsers;

    // Delete Main Record
    updatedState.persons = updatedState.persons.filter(p => p.id !== personId);
    steps.push({
      description: `شخص ${personId} با موفقیت حذف شد.`,
      target: 'Person',
      status: 'updated'
    });

    const successLog: TraceLogEntry = {
      id: `LOG_${Date.now()}`,
      timestamp: new Date().toISOString(),
      traceId,
      action: 'DELETE_PERSON',
      entityType: 'Person',
      entityId: personId,
      status: 'success',
      steps
    };
    this.logger.log(successLog);

    // Event Publishing
    this.eventBus.publish({
      id: `EVT_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'PERSON_DELETED',
      payload: { personId },
      traceId
    });

    return { success: true, updatedState, traceLog: successLog, impactReport };
  }

  /**
   * 5. Create a BusinessPartner ensuring strict validations and pre-operation impact analysis
   */
  public createBusinessPartner(partner: BusinessPartner, state: SystemState): ExecutionResult {
    const traceId = this.generateTraceId();
    const steps: TraceLogStep[] = [];

    // Run Impact Analysis first
    const impactReport = ImpactAnalyzer.analyze('create', 'BusinessPartner', partner.id, state);
    steps.push({
      description: `تحلیل اثر برای ایجاد همکار تجاری انجام شد. سطح سلامت عملیات: ${impactReport.isSafe ? 'ایمن' : 'بلاک‌شده'}`,
      target: 'BusinessPartner',
      status: 'updated'
    });

    if (!impactReport.isSafe) {
      const errors = impactReport.blocks.map(b => b.reason);
      const failLog = this.createFailLog(traceId, 'CREATE_BUSINESS_PARTNER', 'BusinessPartner', partner.id, errors.join(' | '));
      return { success: false, updatedState: state, traceLog: failLog, errors, impactReport };
    }

    // Ensure corresponding Person exists or is created automatically
    let updatedPersons = [...state.persons];
    const personExists = state.persons.some(p => p.id === partner.personId);
    if (!personExists) {
      const generatedCode = generateUniquePersonCode(state.persons);

      const newPerson: Person = {
        id: partner.personId,
        name: partner.profile?.partnerName || 'نماینده فروش',
        code: generatedCode,
        nationalId: partner.nesyehOnboarding?.nationalId,
        mobile: partner.nesyehOnboarding?.landlinePhone,
        isDocumentsApproved: partner.nesyehOnboarding ? partner.nesyehOnboarding.onboardingStatus === 'ACTIVE' : (partner.status === 'active'),
        agentDetails: {
          storeName: partner.profile?.storeName,
          storeAddress: partner.nesyehOnboarding?.address
        },
        createdAt: new Date().toISOString()
      };
      updatedPersons.push(newPerson);
      steps.push({
        description: `ایجاد خودکار پرونده شخص مرجع همکار تجاری با شناسه ${partner.personId}`,
        target: 'Person',
        status: 'updated'
      });
    }

    const validationState = { ...state, persons: updatedPersons };

    // Validation: Uniqueness and reference integrity using IntegrityGuard
    const validationErrors = IntegrityGuard.validateBusinessPartner(partner, validationState, false);
    if (validationErrors.length > 0) {
      const failLog = this.createFailLog(traceId, 'CREATE_BUSINESS_PARTNER', 'BusinessPartner', partner.id, validationErrors.join(' | '));
      return { success: false, updatedState: state, traceLog: failLog, errors: validationErrors, impactReport };
    }

    steps.push({
      description: 'تایید هویت شخص مرجع و اعتبارسنجی یکتایی پرونده با موفقیت انجام شد.',
      target: 'BusinessPartner',
      status: 'updated'
    });

    const updatedPartners = [...state.businessPartners, partner];
    const newState: SystemState = {
      ...state,
      persons: updatedPersons,
      businessPartners: updatedPartners
    };

    const successLog: TraceLogEntry = {
      id: `LOG_${Date.now()}`,
      timestamp: new Date().toISOString(),
      traceId,
      action: 'CREATE_BUSINESS_PARTNER',
      entityType: 'BusinessPartner',
      entityId: partner.id,
      status: 'success',
      steps
    };
    this.logger.log(successLog);

    // Event Publishing
    this.eventBus.publish({
      id: `EVT_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'PARTNER_CREATED',
      payload: partner,
      traceId
    });

    return { success: true, updatedState: newState, traceLog: successLog, impactReport };
  }

  /**
   * 6. Update BusinessPartner safely with validations and pre-operation impact analysis
   */
  public updateBusinessPartner(partnerId: string, updates: Partial<BusinessPartner>, state: SystemState): ExecutionResult {
    const traceId = this.generateTraceId();
    const steps: TraceLogStep[] = [];

    const partnerIndex = state.businessPartners.findIndex(bp => bp.id === partnerId);
    if (partnerIndex === -1) {
      const failLog = this.createFailLog(traceId, 'UPDATE_BUSINESS_PARTNER', 'BusinessPartner', partnerId, `همکار تجاری با شناسه ${partnerId} یافت نشد.`);
      return { success: false, updatedState: state, traceLog: failLog, errors: [`همکار تجاری با شناسه ${partnerId} یافت نشد.`] };
    }

    const currentPartner = state.businessPartners[partnerIndex];
    const proposedPartner = { ...currentPartner, ...updates };

    // Run Impact Analysis first
    const impactReport = ImpactAnalyzer.analyze('update', 'BusinessPartner', partnerId, state);
    steps.push({
      description: `تحلیل اثر برای ویرایش همکار تجاری انجام شد. سطح سلامت عملیات: ${impactReport.isSafe ? 'ایمن' : 'بلاک‌شده'}`,
      target: 'BusinessPartner',
      status: 'updated'
    });

    if (!impactReport.isSafe) {
      const errors = impactReport.blocks.map(b => b.reason);
      const failLog = this.createFailLog(traceId, 'UPDATE_BUSINESS_PARTNER', 'BusinessPartner', partnerId, errors.join(' | '));
      return { success: false, updatedState: state, traceLog: failLog, errors, impactReport };
    }

    // Ensure corresponding Person exists or is updated in sync
    let updatedPersons = [...state.persons];
    const personIndex = updatedPersons.findIndex(p => p.id === proposedPartner.personId);
    if (personIndex !== -1) {
      updatedPersons[personIndex] = {
        ...updatedPersons[personIndex],
        name: proposedPartner.profile?.partnerName || updatedPersons[personIndex].name,
        nationalId: proposedPartner.nesyehOnboarding?.nationalId || updatedPersons[personIndex].nationalId,
        isDocumentsApproved: proposedPartner.nesyehOnboarding 
          ? proposedPartner.nesyehOnboarding.onboardingStatus === 'ACTIVE' 
          : (proposedPartner.status === 'active' || proposedPartner.profile?.contractStatus === 'فعال' || proposedPartner.profile?.contractStatus === 'تایید شده و فعال' || updatedPersons[personIndex].isDocumentsApproved || false),
        agentDetails: {
          ...updatedPersons[personIndex].agentDetails,
          storeName: proposedPartner.profile?.storeName || updatedPersons[personIndex].agentDetails?.storeName,
          storeAddress: proposedPartner.nesyehOnboarding?.address || updatedPersons[personIndex].agentDetails?.storeAddress
        }
      };
      steps.push({
        description: `به‌روزرسانی همزمان فیلدهای هویتی شخص مرجع با موفقیت انجام شد.`,
        target: 'Person',
        status: 'updated'
      });
    } else {
      steps.push({
        description: `تذکر: شخص مرجع با شناسه ${proposedPartner.personId} یافت نشد و طبق قوانین در ویرایش همکار هیچ پرونده شخص جدیدی ایجاد نگردید.`,
        target: 'Person',
        status: 'updated'
      });
    }

    const validationState = { ...state, persons: updatedPersons };

    // Validation
    const validationErrors = IntegrityGuard.validateBusinessPartner(proposedPartner, validationState, true);
    if (validationErrors.length > 0) {
      const failLog = this.createFailLog(traceId, 'UPDATE_BUSINESS_PARTNER', 'BusinessPartner', partnerId, validationErrors.join(' | '));
      return { success: false, updatedState: state, traceLog: failLog, errors: validationErrors, impactReport };
    }

    steps.push({
      description: 'اعتبارسنجی قوانین ویرایش با موفقیت انجام شد.',
      target: 'BusinessPartner',
      status: 'updated'
    });

    // Trace credit limit changes if any
    if (updates.nesyehSettings?.creditLimit !== undefined && updates.nesyehSettings.creditLimit !== currentPartner.nesyehSettings?.creditLimit) {
      steps.push({
        description: `تغییر سقف خرید نسیه از ${currentPartner.nesyehSettings?.creditLimit || 0} به ${updates.nesyehSettings.creditLimit}`,
        target: 'BusinessPartner',
        status: 'updated'
      });
    }

    const updatedPartners = [...state.businessPartners];
    updatedPartners[partnerIndex] = proposedPartner;

    const newState: SystemState = {
      ...state,
      persons: updatedPersons,
      businessPartners: updatedPartners
    };

    const successLog: TraceLogEntry = {
      id: `LOG_${Date.now()}`,
      timestamp: new Date().toISOString(),
      traceId,
      action: 'UPDATE_BUSINESS_PARTNER',
      entityType: 'BusinessPartner',
      entityId: partnerId,
      status: 'success',
      steps
    };
    this.logger.log(successLog);

    // Event Publishing
    this.eventBus.publish({
      id: `EVT_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'PARTNER_UPDATED',
      payload: proposedPartner,
      traceId
    });

    return { success: true, updatedState: newState, traceLog: successLog, impactReport };
  }

  /**
   * 7. Delete BusinessPartner safely with dependency checking and pre-operation impact analysis
   */
  public deleteBusinessPartner(partnerId: string, state: SystemState): ExecutionResult {
    const traceId = this.generateTraceId();
    const steps: TraceLogStep[] = [];

    const partnerIndex = state.businessPartners.findIndex(bp => bp.id === partnerId);
    if (partnerIndex === -1) {
      const failLog = this.createFailLog(traceId, 'DELETE_BUSINESS_PARTNER', 'BusinessPartner', partnerId, `همکار تجاری با شناسه ${partnerId} یافت نشد.`);
      return { success: false, updatedState: state, traceLog: failLog, errors: [`همکار تجاری با شناسه ${partnerId} یافت نشد.`] };
    }

    // Run Impact Analysis first
    const impactReport = ImpactAnalyzer.analyze('delete', 'BusinessPartner', partnerId, state);
    steps.push({
      description: `تحلیل اثر برای حذف همکار تجاری انجام شد. وضعیت امنیت عملیات: ${impactReport.isSafe ? 'ایمن' : 'بلاک‌شده'}`,
      target: 'BusinessPartner',
      status: 'updated'
    });

    if (!impactReport.isSafe) {
      const errors = impactReport.blocks.map(b => b.reason);
      const failLog = this.createFailLog(traceId, 'DELETE_BUSINESS_PARTNER', 'BusinessPartner', partnerId, errors.join(' | '));
      return { success: false, updatedState: state, traceLog: failLog, errors, impactReport };
    }

    // Process role unassignment / deletion
    const partnerToDelete = state.businessPartners[partnerIndex];
    const personId = partnerToDelete.personId;
    const agencyType = partnerToDelete.agencyType;
    const isDualRole = agencyType === AgencyType.BOTH || (agencyType as string) === 'BOTH';

    let updatedPartners = [...state.businessPartners];
    let updatedPersons = [...state.persons];

    if (isDualRole) {
      // Dual role partner (Sales + Credit agent):
      // Unassign the Sales Agent role while keeping Credit Agent role active
      updatedPartners = updatedPartners.map((bp, idx) => {
        if (idx !== partnerIndex) return bp;
        const newRoles = (bp.roles || []).filter(
          r => (r as string) !== 'DEFERRED_AGENT' && (r as string) !== 'INSTALLMENT_ONLY'
        );
        const { salesExtension, nesyehSettings, nesyehOnboarding, ...rest } = bp;
        return {
          ...rest,
          agencyType: AgencyType.CREDIT_ONLY,
          roles: newRoles,
          contract: bp.contract ? { ...bp.contract, type: 'CREDIT_AGENCY' as any } : undefined
        };
      });
      steps.push({
        description: `نقش نمایندگی فروش با موفقیت از همکار تجاری لغو شد و نقش نمایندگی اعتباری فعال باقی ماند.`,
        target: 'BusinessPartner',
        status: 'updated'
      });
    } else {
      // Pure Sales Agent (or single agency role):
      // Remove the BusinessPartner entry from businessPartners array
      updatedPartners = updatedPartners.filter(bp => bp.id !== partnerId);
      steps.push({
        description: `عضویت همکار تجاری در لیست نمایندگان فروش با موفقیت لغو گردید.`,
        target: 'BusinessPartner',
        status: 'updated'
      });
    }

    // MANDATE: PRESERVE THE PERSON RECORD AT ALL COSTS!
    // The Person record and user account are never deleted on agent role unassignment.
    if (personId) {
      updatedPersons = updatedPersons.map(p => {
        if (p.id !== personId) return p;
        const remainingPartners = updatedPartners.filter(bp => bp.personId === personId);
        const hasOtherAgencyRoles = remainingPartners.some(bp => 
          bp.agencyType === AgencyType.CREDIT_ONLY || 
          bp.agencyType === AgencyType.BOTH || 
          bp.agencyType === AgencyType.INSTALLMENT_ONLY
        );
        return {
          ...p,
          isAgent: hasOtherAgencyRoles
        };
      });
      steps.push({
        description: `پرونده شخص مرجع (${personId}) و تمام اطلاعات هویتی و سایر نقش‌های آن بدون تغییر در سیستم حفظ گردید.`,
        target: 'Person',
        status: 'updated'
      });
    }

    const newState: SystemState = {
      ...state,
      businessPartners: updatedPartners,
      persons: updatedPersons,
      users: state.users
    };

    const successLog: TraceLogEntry = {
      id: `LOG_${Date.now()}`,
      timestamp: new Date().toISOString(),
      traceId,
      action: 'DELETE_BUSINESS_PARTNER',
      entityType: 'BusinessPartner',
      entityId: partnerId,
      status: 'success',
      steps
    };
    this.logger.log(successLog);

    // Event Publishing
    this.eventBus.publish({
      id: `EVT_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'PARTNER_DELETED',
      payload: { partnerId },
      traceId
    });

    return { success: true, updatedState: newState, traceLog: successLog, impactReport };
  }

  /**
   * 8. Transition Onboarding / Agent Status with lifecycle engine and pre-operation impact analysis
   */
  public changePartnerStatus(
    partnerId: string,
    targetStatus: 'DRAFT' | 'COMPLETED_INFO' | 'MANAGER_APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED',
    state: SystemState
  ): ExecutionResult {
    const traceId = this.generateTraceId();
    const steps: TraceLogStep[] = [];

    const partnerIndex = state.businessPartners.findIndex(bp => bp.id === partnerId);
    if (partnerIndex === -1) {
      const failLog = this.createFailLog(traceId, 'CHANGE_PARTNER_STATUS', 'BusinessPartner', partnerId, `همکار تجاری با شناسه ${partnerId} یافت نشد.`);
      return { success: false, updatedState: state, traceLog: failLog, errors: [`همکار تجاری با شناسه ${partnerId} یافت نشد.`] };
    }

    const partner = state.businessPartners[partnerIndex];
    const currentOnboardingStatus = partner.nesyehOnboarding?.onboardingStatus || 'DRAFT';

    // Validate Transition rules using LifecycleManager
    const validation = LifecycleManager.validateOnboardingTransition(partner, targetStatus);
    if (!validation.allowed) {
      const failLog = this.createFailLog(traceId, 'CHANGE_PARTNER_STATUS', 'BusinessPartner', partnerId, validation.error || '');
      return { success: false, updatedState: state, traceLog: failLog, errors: [validation.error || 'تغییر وضعیت غیرمجاز است'] };
    }

    steps.push({
      description: `تغییر وضعیت چرخه عمر همکار تجاری از ${currentOnboardingStatus} به ${targetStatus} تایید شد.`,
      target: 'BusinessPartner',
      status: 'updated'
    });

    // Run Impact Analysis first
    const impactReport = ImpactAnalyzer.analyze(
      ['ACTIVE'].includes(targetStatus) ? 'restore' : 'deactivate',
      'BusinessPartner',
      partnerId,
      state
    );
    steps.push({
      description: `تحلیل اثر برای تغییر وضعیت همکار تجاری انجام شد. سطح سلامت عملیات: ${impactReport.isSafe ? 'ایمن' : 'بلاک‌شده'}`,
      target: 'BusinessPartner',
      status: 'updated'
    });

    if (!impactReport.isSafe) {
      const errors = impactReport.blocks.map(b => b.reason);
      const failLog = this.createFailLog(traceId, 'CHANGE_PARTNER_STATUS', 'BusinessPartner', partnerId, errors.join(' | '));
      return { success: false, updatedState: state, traceLog: failLog, errors, impactReport };
    }

    let updatedState = { ...state };

    // If deactivating, apply cascades to active orders (operational only)
    if (['SUSPENDED', 'TERMINATED'].includes(targetStatus)) {
      const updatedOrders = (updatedState.nesyehPurchaseOrders || []).map(o => {
        if (o.partnerId === partnerId && ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(o.status)) {
          steps.push({
            description: `تعلیق خودکار سفارش خرید شماره ${o.orderNumber} به دلیل تعلیق نماینده`,
            target: `NesyehPurchaseOrder (${o.id})`,
            status: 'updated'
          });
          return { ...o, status: 'CANCELLED' as any, adminNotes: 'تعلیق خودکار فرآیند خرید به دلیل تعلیق حساب نماینده' };
        }
        return o;
      });
      updatedState.nesyehPurchaseOrders = updatedOrders;
    }

    // Apply Main Status Transition
    const updatedPartners = [...updatedState.businessPartners];
    updatedPartners[partnerIndex] = {
      ...partner,
      status: targetStatus === 'ACTIVE' ? 'active' : 'inactive',
      nesyehOnboarding: {
        ...(partner.nesyehOnboarding || { guarantees: [], statusHistory: [] }),
        onboardingStatus: targetStatus,
        statusHistory: [
          ...(partner.nesyehOnboarding?.statusHistory || []),
          {
            status: targetStatus,
            date: new Date().toISOString(),
            userName: 'سیستم یکپارچگی داده',
            comment: `انتقال وضعیت خودکار سیستمی به ${targetStatus}`
          }
        ]
      }
    };
    updatedState.businessPartners = updatedPartners;

    const successLog: TraceLogEntry = {
      id: `LOG_${Date.now()}`,
      timestamp: new Date().toISOString(),
      traceId,
      action: 'CHANGE_PARTNER_STATUS',
      entityType: 'BusinessPartner',
      entityId: partnerId,
      status: 'success',
      steps
    };
    this.logger.log(successLog);

    // Event Publishing
    this.eventBus.publish({
      id: `EVT_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'PARTNER_STATUS_CHANGED',
      payload: { partnerId, fromStatus: currentOnboardingStatus, toStatus: targetStatus },
      traceId
    });

    return { success: true, updatedState, traceLog: successLog, impactReport };
  }

  /**
   * Helper function to build a clean fail trace log
   */
  private createFailLog(traceId: string, action: string, entityType: string, entityId: string, reason: string): TraceLogEntry {
    const entry: TraceLogEntry = {
      id: `LOG_${Date.now()}`,
      timestamp: new Date().toISOString(),
      traceId,
      action,
      entityType,
      entityId,
      status: 'failed',
      steps: [{ description: 'اجرای گارد محافظتی و تحلیل اثر', target: entityType, status: 'failed', details: reason }],
      errorReason: reason
    };
    this.logger.log(entry);
    return entry;
  }
}
