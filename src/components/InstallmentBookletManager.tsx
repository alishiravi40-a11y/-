import React, { useState, useMemo, useEffect } from 'react';
import { 
  AppState, InstallmentBook, Installment, Person, Invoice, JournalVoucher, VoucherEntry 
} from '../types';
import { 
  Plus, Calendar, DollarSign, User, ArrowLeft, ArrowRight, 
  CheckCircle, Clock, AlertCircle, Calculator, Hash, List,
  TrendingUp, Save, Trash2, Printer, Users, Wallet, Sparkles, Landmark
} from 'lucide-react';
import { 
  saveAppState, calculateSmartInstallments, calculatePersonBalances,
  createInstallmentFeeVoucher, createReverseVoucher, resolveInvoiceVoucher
} from '../utils/accounting';
import { resolveEffectiveCalculatorSettings } from '../utils/creditCalculatorEngine';
import { getCurrentJalaliDate, addDaysToJalali, addMonthsToJalali, normalizeJalaliDate, validateJalaliDate } from '../utils/jalali';
import PersonSelector from './PersonSelector';
import { motion, AnimatePresence } from 'motion/react';
import CreditFileDocuments from './CreditFileDocuments';
import { InstallmentService } from '../services/installmentService';

interface InstallmentBookletManagerProps {
  appState: AppState;
  onSave: (newState: AppState) => void;
  onRefresh?: () => Promise<void>;
  initialInvoiceId?: string;
  initialPersonId?: string;
  onClose?: () => void;
}

export function checkBookletFinancialDependencies(appState: AppState, bookId: string): { hasDependency: boolean; reason?: string } {
  const book = (appState.installmentBooks || []).find(b => b.id === bookId);
  if (!book) return { hasDependency: false };

  // 1. Check for registered payments on any installment belonging to this booklet (i.bookId)
  const bookInstallments = (appState.installments || []).filter(i => i.bookId === bookId);
  const paidInstallment = bookInstallments.find(i => 
    (i.paidAmount && i.paidAmount > 0) || i.status === 'paid' || i.status === 'partially_paid'
  );
  if (paidInstallment) {
    return {
      hasDependency: true,
      reason: `دارای پرداخت ثبت‌شده در قسط شماره ${paidInstallment.installmentNumber}`
    };
  }

  // 2. Check for active accounting vouchers using foreign keys (v.sourceId)
  const activeVouchers = (appState.vouchers || []).filter(v => v.status !== 'voided');

  // Direct vouchers referencing booklet ID via sourceId
  const directVoucher = activeVouchers.find(v => 
    v.sourceId === bookId || (v.sourceType === 'installment_book' && v.sourceId === bookId)
  );
  if (directVoucher) {
    return {
      hasDependency: true,
      reason: `دارای سند حسابداری فعال به شماره ${directVoucher.voucherNumber}`
    };
  }

  // Vouchers linked via creditFileId foreign key
  if (book.creditFileId) {
    const fileVoucher = activeVouchers.find(v => v.sourceId === book.creditFileId);
    if (fileVoucher) {
      return {
        hasDependency: true,
        reason: `دارای سند حسابداری فعال پرونده اعتباری به شماره ${fileVoucher.voucherNumber}`
      };
    }
  }

  // Vouchers linked via invoiceId foreign key
  if (book.invoiceId) {
    const inv = (appState.invoices || []).find(i => i.id === book.invoiceId);
    if (inv) {
      const invVoucher = resolveInvoiceVoucher(inv, activeVouchers);
      if (invVoucher) {
        return {
          hasDependency: true,
          reason: `دارای سند حسابداری فعال فاکتور فروش به شماره ${invVoucher.voucherNumber}`
        };
      }
    }
  }

  // 3. Check for active checks strictly linked via voucher Foreign Keys (h.voucherId -> v.id)
  const bookletVoucherIds = new Set(
    activeVouchers
      .filter(v => 
        v.sourceId === bookId || 
        (book.creditFileId && v.sourceId === book.creditFileId) || 
        (book.invoiceId && v.sourceId === book.invoiceId)
      )
      .map(v => v.id)
  );

  const linkedCheck = (appState.checks || []).find(c => 
    c.isInstallment && 
    c.history?.some(h => h.voucherId && bookletVoucherIds.has(h.voucherId))
  );
  if (linkedCheck) {
    return {
      hasDependency: true,
      reason: `دارای چک صیادی/دریافتنی معتبر به شماره ${linkedCheck.checkNumber}`
    };
  }

  return { hasDependency: false };
}

export default function InstallmentBookletManager({ appState, onSave, onRefresh, initialInvoiceId, initialPersonId, onClose }: InstallmentBookletManagerProps) {
  const [activeTab, setActiveTab] = useState<'list' | 'create' | 'reports'>('list');
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [viewingDocsPersonId, setViewingDocsPersonId] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<{ installment: Installment, amount: number } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'pos' | 'bank'>('cash');
  const [paymentTerminalId, setPaymentTerminalId] = useState<string>(appState.bankTerminals.length > 0 ? appState.bankTerminals[0].id : '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRegisterPayment = async () => {
    if (!paymentModal || isSubmitting) return;
    const { installment, amount } = paymentModal;
    
    // Find book directly from installment
    const book = appState.installmentBooks.find(b => b.id === installment.bookId);
    if (!book) {
      alert('دفترچه اقساط یافت نشد.');
      return;
    }
    
    const person = appState.persons.find(p => p.id === book.personId);
    if (!person) {
      alert('مشتری یافت نشد.');
      return;
    }

    setIsSubmitting(true);
    try {
      const targetCalc = appState.calculators?.find(c => c.id === book.calculatorId || c.id === installment.calculatorId);
      const isBetaInstallment = !!(book.agentBankName || installment.agentBankName ||
                                targetCalc?.type === 'beta' ||
                                (targetCalc?.name || '').includes('بتا') ||
                                (book.id || '').includes('BETA'));

      const betaBankName = installment.agentBankName || book.agentBankName || targetCalc?.bankName || 'بانک رفاه';

      let assetSubsidiaryId = 'SUB_CASH_MAIN';
      let payDesc = `دریافت قسط شماره ${installment.installmentNumber} - دفترچه ${book.id} - مشتری: ${person.name} - روش: ${paymentMethod}`;

      if (isBetaInstallment) {
          const defaultBetaCalc = appState.calculators?.find(c => c.type === 'beta' || (c.name || '').includes('بتا'));
          assetSubsidiaryId = installment.agentBankId || book.agentBankId || targetCalc?.agentBankId || defaultBetaCalc?.agentBankId || '';
          payDesc = `دریافت قسط سامانه بتا (شماره ${installment.installmentNumber}) - دفترچه ${book.id} - مشتری: ${person.name} - بانک عامل: ${betaBankName}`;
      } else if (paymentMethod === 'pos') {
          const terminal = appState.bankTerminals.find(t => t.id === paymentTerminalId);
          assetSubsidiaryId = terminal ? terminal.intermediateAccountId : 'SUB_BANK_MELI_INT';
      } else if (paymentMethod === 'bank') {
          assetSubsidiaryId = 'SUB_BANK_MELI';
      }

      const methodEnum = paymentMethod === 'cash' ? 'CASH' : (paymentMethod === 'pos' ? 'POS' : 'TRANSFER');

      await InstallmentService.settleInstallment({
        personId: person.id,
        installmentIds: [installment.id],
        amount,
        paymentMethod: methodEnum,
        paymentDate: getCurrentJalaliDate(),
        bankOrCashSubId: assetSubsidiaryId,
        description: payDesc
      });

      if (onRefresh) {
        await onRefresh();
      }

      setPaymentModal(null);
      alert('✅ تسویه قسط با موفقیت در دیتابیس قطعی ثبت شد.');
    } catch (err: any) {
      alert(`❌ خطا در تسویه قسط: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Creation Form State
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(
    initialPersonId 
      ? (appState.persons.find(p => p.id === initialPersonId) || null)
      : initialInvoiceId 
        ? (appState.persons.find(p => p.id === appState.invoices.find(i => i.id === initialInvoiceId)?.personId) || null) 
        : null
  );

  // Helper to handle person selection and auto-fill balance from 10302
  const handlePersonSelect = (personId: string) => {
    const person = appState.persons.find(p => p.id === personId) || null;
    setSelectedPerson(person);
    
    if (person) {
      // Calculate balance in account 10302 (Installment Debtors)
      const balances = calculatePersonBalances(appState.vouchers, person.id, 'SUB_DEBTORS_INSTALLMENT');
      const personBalance = balances[person.id];
      const ledgerBal = (personBalance && personBalance.nature === 'بدهکار') ? personBalance.net : 0;
      
      const activeBooksPrincipal = appState.installmentBooks
        .filter(b => b.personId === person.id && b.status === 'active')
        .reduce((sum, b) => sum + b.totalPrincipal, 0);
        
      const unassigned = Math.max(0, ledgerBal - activeBooksPrincipal);
      
      if (unassigned > 0) {
        setPrincipal(unassigned);
      } else {
        // If no unassigned balance in 10302, maybe check if there's an invoice principal
        if (!initialInvoiceId) {
           setPrincipal(0);
        }
      }
    }
  };

  const [principal, setPrincipal] = useState<number>(
    initialInvoiceId ? (
      (appState.invoices.find(i => i.id === initialInvoiceId)?.totalAmount || 0) - 
      ((appState.invoices.find(i => i.id === initialInvoiceId)?.cashPaidAmount || 0) + (appState.invoices.find(i => i.id === initialInvoiceId)?.posPaidAmount || 0))
    ) : 0
  );
  const [installmentCount, setInstallmentCount] = useState<number>(12);
  const [interestRate, setInterestRate] = useState<number>(2); // Monthly %
  const [intervalDays, setIntervalDays] = useState(30);
  const [startDate, setStartDate] = useState(
    intervalDays === 60 
      ? addMonthsToJalali(getCurrentJalaliDate(), 2)
      : addMonthsToJalali(getCurrentJalaliDate(), 1)
  );

  // Update startDate when intervalDays changes
  const handleIntervalChange = (days: number) => {
    setIntervalDays(days);
    setStartDate(days === 60 
      ? addMonthsToJalali(getCurrentJalaliDate(), 2)
      : addMonthsToJalali(getCurrentJalaliDate(), 1)
    );
  };

  const [isVariable, setIsVariable] = useState(false);
  const [variableDates, setVariableDates] = useState<string[]>([]);

  const targetPersonId = selectedPerson?.id || initialPersonId;
  const selectedBp = (appState.businessPartners || []).find(bp => bp.personId === targetPersonId || bp.id === targetPersonId);

  const resolvedBetaConfig = resolveEffectiveCalculatorSettings(
    'beta',
    selectedBp,
    appState.calculators,
    appState.settings
  );

  // Beta Plan States
  const [isBetaPlan, setIsBetaPlan] = useState(false);
  const [betaSurcharge, setBetaSurcharge] = useState<number>(() => resolvedBetaConfig.betaBankFeeRate ?? 5);
  const [representativeCommission, setRepresentativeCommission] = useState<number>(0);

  useEffect(() => {
    if (resolvedBetaConfig.betaBankFeeRate !== undefined) {
      setBetaSurcharge(resolvedBetaConfig.betaBankFeeRate);
    }
  }, [resolvedBetaConfig.betaBankFeeRate]);

  const maxCommission = Math.max(10, selectedBp?.contract?.commissionRate ?? 10);
  const commissionOptions = Array.from({ length: maxCommission + 1 }, (_, i) => i);

  useEffect(() => {
    if (representativeCommission > maxCommission) {
      setRepresentativeCommission(maxCommission);
    }
  }, [maxCommission]);

  // Smart pre-fill or tab selection when initialized with a specific person ID
  useEffect(() => {
    if (initialPersonId) {
      const person = appState.persons.find(p => p.id === initialPersonId);
      if (person) {
        const activeBooks = appState.installmentBooks.filter(b => b.personId === person.id && b.status === 'active');
        
        // Calculate balance in account 10302 (Installment Debtors)
        const balances = calculatePersonBalances(appState.vouchers, person.id, 'SUB_DEBTORS_INSTALLMENT');
        const personBalance = balances[person.id];
        const ledgerBal = (personBalance && personBalance.nature === 'بدهکار') ? personBalance.net : 0;
        
        const activeBooksPrincipal = activeBooks.reduce((sum, b) => sum + b.totalPrincipal, 0);
        const unassigned = Math.max(0, ledgerBal - activeBooksPrincipal);
        
        if (activeBooks.length > 0) {
          // If active booklets already exist for this customer, display list tab
          setActiveTab('list');
        } else if (unassigned > 0) {
          // If no active booklets exist and there is unassigned balance, open creation tab
          setActiveTab('create');
          setPrincipal(unassigned);
        } else {
          setActiveTab('list');
        }
      }
    }
  }, [initialPersonId, appState.persons, appState.vouchers, appState.installmentBooks]);

  const calcResults = useMemo(() => {
    if (principal <= 0) return null;
    
    const base = calculateSmartInstallments(
      principal,
      installmentCount,
      intervalDays === 60 ? 'bi-monthly' : 'monthly',
      isBetaPlan ? 'beta' : 'normal',
      betaSurcharge,
      startDate
    );
    
    const finalTotal = Math.round(base.totalPayable * (1 + representativeCommission / 100));
    const totalInterest = finalTotal - principal;
    const commissionDifference = finalTotal - base.totalPayable;
    const representativeCommissionAmount = Math.round(base.totalPayable * (representativeCommission / 100));
    
    // Adjust installments to include the new commission
    const installments = base.installments.map((inst, index) => {
      if (index === base.installments.length - 1) {
         return { 
             ...inst, 
             amount: inst.amount + commissionDifference, 
             interestPart: inst.interestPart + commissionDifference 
         };
      }
      return inst;
    });

    return {
      ...base,
      totalInterest,
      totalPayable: finalTotal,
      representativeCommissionAmount,
      installments
    };
  }, [principal, installmentCount, startDate, intervalDays, isBetaPlan, betaSurcharge, representativeCommission]);

  // Calculate effective monthly interest percentage to display
  const effectiveMonthlyInterest = useMemo(() => {
    if (!calcResults || !principal || principal <= 0 || !installmentCount || installmentCount <= 0 || isNaN(installmentCount)) return 0;
    // Interest % = (Total Interest / Principal) * 100 / Count
    const calculatedValue = Math.round(((calcResults.totalInterest / principal) * 100 / installmentCount) * 10) / 10;
    return isNaN(calculatedValue) || !isFinite(calculatedValue) ? 0 : calculatedValue;
  }, [calcResults, principal, installmentCount]);

  // Synchronize state and tab when initialInvoiceId is provided or changes
  React.useEffect(() => {
    if (initialInvoiceId) {
      setActiveTab('create');
      const invoice = appState.invoices.find(i => i.id === initialInvoiceId);
      if (invoice) {
        const person = appState.persons.find(p => p.id === invoice.personId) || null;
        setSelectedPerson(person);
        const remainingAmt = invoice.totalAmount - ((invoice.cashPaidAmount || 0) + (invoice.posPaidAmount || 0));
        setPrincipal(remainingAmt);
      }
    }
  }, [initialInvoiceId, appState.invoices, appState.persons]);

  // Sync interestRate with calculated effective rate
  React.useEffect(() => {
    if (effectiveMonthlyInterest > 0) {
      setInterestRate(effectiveMonthlyInterest);
    }
  }, [effectiveMonthlyInterest]);

  const selectedPersonDebtBalance = useMemo(() => {
    if (!selectedPerson) return 0;
    const balances = calculatePersonBalances(appState.vouchers, selectedPerson.id, 'SUB_DEBTORS_INSTALLMENT');
    const personBalance = balances[selectedPerson.id];
    if (personBalance && personBalance.nature === 'بدهکار') {
      return personBalance.net;
    }
    return 0;
  }, [selectedPerson, appState.vouchers]);

  const selectedPersonActiveBooksPrincipal = useMemo(() => {
    if (!selectedPerson) return 0;
    return appState.installmentBooks
      .filter(b => b.personId === selectedPerson.id && b.status === 'active')
      .reduce((sum, b) => sum + b.totalPrincipal, 0);
  }, [selectedPerson, appState.installmentBooks]);

  const selectedPersonUnassignedBalance = useMemo(() => {
    return Math.max(0, selectedPersonDebtBalance - selectedPersonActiveBooksPrincipal);
  }, [selectedPersonDebtBalance, selectedPersonActiveBooksPrincipal]);

  const isSelectedPersonInvalid = useMemo(() => {
    if (!selectedPerson) return false;
    if (initialInvoiceId) return false; // Always allow if created from an invoice
    return selectedPersonUnassignedBalance <= 0;
  }, [selectedPerson, initialInvoiceId, selectedPersonUnassignedBalance]);

  const isPrincipalExceeded = useMemo(() => {
    if (!selectedPerson || initialInvoiceId) return false;
    return principal > selectedPersonUnassignedBalance;
  }, [selectedPerson, initialInvoiceId, principal, selectedPersonUnassignedBalance]);

  const handleCreateBooklet = async () => {
    if (!selectedPerson || !calcResults || isSubmitting) return;

    if (isSelectedPersonInvalid && !initialInvoiceId) {
      alert('❌ خطا: امکان ثبت دفترچه اقساط برای این شخص وجود ندارد زیرا در حال حاضر هیچ‌گونه بدهکاری بلاتکلیفی در سیستم ندارد.');
      return;
    }

    if (isPrincipalExceeded) {
      alert(`❌ خطا: مبلغ اصل بدهی وارد شده (${principal.toLocaleString()} ریال) بیشتر از مانده بدهکاری بلاتکلیف این شخص (${selectedPersonUnassignedBalance.toLocaleString()} ریال) است.`);
      return;
    }

    const normalizedStartDate = normalizeJalaliDate(startDate);
    if (!validateJalaliDate(normalizedStartDate)) {
      alert(`تاریخ شروع وارد شده (${startDate}) نامعتبر است. لطفاً تاریخ صحیح شمسی را به صورت YYYY/MM/DD وارد کنید.`);
      return;
    }
    setStartDate(normalizedStartDate);

    const resolvedOriginType: "INVOICE" | "PARTNER_CREDIT" | "OPENING_BALANCE" = 
      initialInvoiceId ? "INVOICE" : (selectedPersonUnassignedBalance > 0 ? "OPENING_BALANCE" : "PARTNER_CREDIT");

    setIsSubmitting(true);
    try {
      const createdData = await InstallmentService.createInstallmentBook({
        personId: selectedPerson.id,
        originType: resolvedOriginType,
        invoiceId: initialInvoiceId,
        totalPrincipal: principal,
        totalInterest: calcResults.totalInterest,
        totalAmount: calcResults.totalPayable,
        installmentCount,
        startDate: normalizedStartDate,
        intervalDays,
        installments: calcResults.installments.map(inst => ({
          installmentNumber: inst.installmentNumber,
          dueDate: normalizeJalaliDate(inst.dueDate),
          amount: inst.amount,
          principalPart: inst.principalPart,
          interestPart: inst.interestPart
        }))
      });

      if (onRefresh) {
        await onRefresh();
      }

      alert('✅ دفترچه اقساط با موفقیت در دیتابیس سرور ثبت گردید.');
      setActiveTab('list');
      if (createdData && createdData.book_id) {
        setSelectedBookId(createdData.book_id);
      }
      if (onClose) onClose();
    } catch (err: any) {
      alert(`❌ خطا در ایجاد دفترچه اقساط: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteBooklet = (bookId: string) => {
    // 1. Verify and check real financial dependencies
    const book = (appState.installmentBooks || []).find(b => b.id === bookId);
    if (!book) return;

    const depCheck = checkBookletFinancialDependencies(appState, bookId);

    if (depCheck.hasDependency) {
      alert(`❌ امکان ابطال و حذف دفترچه اقساط وجود ندارد!\n\nدلیل: ${depCheck.reason}\n\nتوضیح: بر اساس قوانین و اصول حسابداری، تا زمانی که اسناد مالی، تراکنش‌ها یا پرداخت‌های وابسته در سیستم وجود دارند، حذف دفترچه ممنوع است. ابتدا باید اسناد و تراکنش‌های مربوطه تعیین تکلیف و ابطال گردند.`);
      return;
    }

    // 2. Unbacked Record / No Financial Dependencies: Atomic Cascade Deletion
    // When no active accounting vouchers, payments or financial transactions exist for this booklet:
    // Completely remove the booklet, all its installments, and matching requests to avoid orphan records.
    const updatedBooks = (appState.installmentBooks || []).filter(b => b.id !== bookId);
    const updatedInstallments = (appState.installments || []).filter(i => i.bookId !== bookId);
    const updatedRequests = (appState.installmentRequests || []).filter(r => r.id !== bookId);

    const newState: AppState = {
      ...appState,
      installmentBooks: updatedBooks,
      installments: updatedInstallments,
      installmentRequests: updatedRequests
    };

    onSave(newState);
    saveAppState(newState);
    setSelectedBookId(null);
    alert('✅ دفترچه اقساط و تمامی اقساط وابسته به دلیل عدم وجود اسناد و تراکنش‌های مالی، با موفقیت و به صورت کامل از سیستم حذف گردیدند.');
  };

  const handleToggleInstallmentStatus = (installmentId: string) => {
    const updatedInstallments = (appState.installments || []).map(inst => {
      if (inst.id === installmentId) {
        const isCurrentlyPaid = inst.status === 'paid';
        return {
          ...inst,
          status: isCurrentlyPaid ? 'upcoming' : 'paid',
          paidAmount: isCurrentlyPaid ? 0 : inst.amount,
          paidDate: isCurrentlyPaid ? undefined : getCurrentJalaliDate()
        } as Installment;
      }
      return inst;
    });

    const newState = {
      ...appState,
      installments: updatedInstallments
    };
    onSave(newState);
    saveAppState(newState);
  };

  const selectedBook = useMemo(() => 
    appState.installmentBooks.find(b => b.id === selectedBookId)
  , [selectedBookId, appState.installmentBooks]);

  const bookInstallments = useMemo(() => 
    appState.installments.filter(i => i.bookId === selectedBookId).sort((a, b) => a.installmentNumber - b.installmentNumber)
  , [selectedBookId, appState.installments]);

  const today = getCurrentJalaliDate();

  const upcomingInstallments = useMemo(() => {
    const next7Days = addDaysToJalali(today, 7);
    return appState.installments.filter(i => 
      i.status === 'upcoming' && i.dueDate <= next7Days
    ).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [appState.installments, today]);

  const overdueInstallments = useMemo(() => {
    return appState.installments.filter(i => 
      (i.status === 'upcoming' || i.status === 'partially_paid') && i.dueDate < today
    ).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [appState.installments, today]);

  const installmentDebtors = useMemo(() => {
    const debtorsMap = new Map<string, { person: Person; totalRemaining: number; booksCount: number }>();
    
    appState.installmentBooks.forEach(book => {
      if (book.status !== 'active') return;
      const person = appState.persons.find(p => p.id === book.personId);
      if (!person) return;
      
      const installments = appState.installments.filter(i => i.bookId === book.id);
      const remaining = installments.reduce((sum, inst) => 
        sum + (inst.status !== 'paid' ? (inst.amount - inst.paidAmount) : 0), 0
      );
      
      if (remaining <= 0) return;

      const existing = debtorsMap.get(person.id);
      if (existing) {
        existing.totalRemaining += remaining;
        existing.booksCount += 1;
      } else {
        debtorsMap.set(person.id, { person, totalRemaining: remaining, booksCount: 1 });
      }
    });

    return Array.from(debtorsMap.values()).sort((a, b) => b.totalRemaining - a.totalRemaining);
  }, [appState.installmentBooks, appState.installments, appState.persons]);

  return (
    <div className="h-full flex flex-col font-sans bg-zinc-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 px-4 py-4 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          {onClose && (
            <button 
              onClick={onClose}
              className="p-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 hover:text-zinc-950 rounded-xl transition-all"
            >
              <ArrowRight size={16} />
            </button>
          )}
          <div className="bg-indigo-600 p-2 rounded-xl text-white">
            <Calculator size={18} />
          </div>
          <h2 className="text-sm font-bold text-zinc-800">مدیریت دفترچه اقساط هوشمند</h2>
        </div>
        <div className="flex gap-1.5">
          <button 
            onClick={() => setActiveTab('list')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${activeTab === 'list' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}
          >
            دفترچه‌ها
          </button>
          <button 
            onClick={() => setActiveTab('reports')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${activeTab === 'reports' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}
          >
            گزارشات
          </button>
          <button 
            onClick={() => setActiveTab('create')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${activeTab === 'create' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-600'}`}
          >
            صدور دفترچه
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'list' && (
          <div className="space-y-3">
            {!selectedBookId ? (
              appState.installmentBooks.length === 0 ? (
                <div className="bg-white rounded-3xl border border-zinc-150 p-10 text-center space-y-4">
                  <div className="bg-zinc-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-zinc-300">
                    <List size={32} />
                  </div>
                  <p className="text-xs text-zinc-400">هیچ دفترچه اقساطی صادر نشده است</p>
                  <button 
                    onClick={() => setActiveTab('create')}
                    className="bg-zinc-900 text-white px-6 py-2.5 rounded-xl text-xs font-bold"
                  >
                    صدور اولین دفترچه
                  </button>
                </div>
              ) : (
                appState.installmentBooks.map(book => {
                  const person = appState.persons.find(p => p.id === book.personId);
                  const isCanceled = book.status === 'canceled';
                  return (
                    <button 
                      key={book.id}
                      onClick={() => setSelectedBookId(book.id)}
                      className={`w-full bg-white p-4 rounded-2xl border text-right flex justify-between items-center group transition ${isCanceled ? 'border-rose-200 bg-rose-50/30' : 'border-zinc-200 hover:border-zinc-400'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isCanceled ? 'bg-rose-100 text-rose-600' : 'bg-zinc-100 text-zinc-500'}`}>
                          <User size={20} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-zinc-800">{person?.name}</span>
                            {isCanceled && (
                              <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full text-[9px] font-bold">
                                ابطال شده
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">
                            {book.installmentCount} قسط | {(book.totalAmount ?? 0).toLocaleString()} ریال
                          </div>
                        </div>
                      </div>
                      <ArrowLeft size={16} className="text-zinc-300 group-hover:text-zinc-600 transition" />
                    </button>
                  );
                })
              )
            ) : (
              <div className="space-y-4">
                <button 
                  onClick={() => setSelectedBookId(null)}
                  className="flex items-center gap-2 text-zinc-500 text-[10px] font-bold"
                >
                  <ArrowRight size={14} /> بازگشت به لیست
                </button>

                {selectedBook && (
                  <div className="space-y-4">
                    {/* Book Header Card */}
                    <div className={`${selectedBook.status === 'canceled' ? 'bg-zinc-800' : 'bg-indigo-600'} rounded-3xl p-5 text-white space-y-4 shadow-lg ${selectedBook.status === 'canceled' ? 'shadow-zinc-200' : 'shadow-indigo-200'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-[10px] opacity-70">نام صاحب دفترچه</div>
                          <div className="text-sm font-bold flex items-center gap-2">
                            {appState.persons.find(p => p.id === selectedBook.personId)?.name}
                            {selectedBook.status === 'canceled' && (
                              <span className="bg-rose-500 text-white px-2 py-0.5 rounded-full text-[9px] font-bold">
                                ابطال شده
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-left">
                          <div className="text-[10px] opacity-70">تاریخ صدور</div>
                          <div className="text-xs font-mono">{selectedBook.startDate}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-white/10 rounded-xl p-2 text-center">
                          <div className="text-[8px] opacity-70">اصل بدهی</div>
                          <div className="text-[10px] font-bold">{(selectedBook.totalPrincipal ?? 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-white/10 rounded-xl p-2 text-center">
                          <div className="text-[8px] opacity-70">کارمزد کل</div>
                          <div className="text-[10px] font-bold">{(selectedBook.totalInterest ?? 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-white/10 rounded-xl p-2 text-center">
                          <div className="text-[8px] opacity-70">جمع اقساط</div>
                          <div className="text-[10px] font-bold">{(selectedBook.totalAmount ?? 0).toLocaleString()}</div>
                        </div>
                      </div>
                    </div>

                    {/* Installments Table (Vertical Mobile Optimized) */}
                    <div className="space-y-2">
                      {bookInstallments.map((inst, index) => {
                        const isCanceled = inst.status === 'canceled' || selectedBook.status === 'canceled';
                        return (
                          <div key={inst.id} className={`bg-white rounded-2xl border p-3 flex justify-between items-center shadow-sm ${isCanceled ? 'border-zinc-200 bg-zinc-50' : 'border-zinc-200'}`}>
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-lg bg-zinc-50 border border-zinc-100 flex items-center justify-center text-[10px] font-bold text-zinc-400">
                                {inst.installmentNumber}
                              </div>
                              <div>
                                <div className="text-[11px] font-bold text-zinc-800">{(inst.amount ?? 0).toLocaleString()} ریال</div>
                                <div className="text-[9px] text-zinc-400 mt-0.5 font-mono">{inst.dueDate}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isCanceled ? (
                                <span className="bg-zinc-200 text-zinc-600 px-3 py-1 rounded-full text-[9px] font-bold">
                                  ابطال شده
                                </span>
                              ) : inst.status === 'paid' ? (
                                <button 
                                  onClick={() => handleToggleInstallmentStatus(inst.id)}
                                  title="تغییر وضعیت به پرداخت نشده"
                                  className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-2.5 py-1 rounded-full text-[9px] font-bold transition-all"
                                >
                                  <CheckCircle size={10} /> پرداخت شده
                                </button>
                              ) : (
                                <div className="flex items-center gap-1">
                                  {inst.dueDate < today && (
                                    <span className="flex items-center gap-1 bg-red-50 text-red-600 px-2 py-1 rounded-full text-[9px] font-bold animate-pulse">
                                      <AlertCircle size={10} /> معوقه
                                    </span>
                                  )}
                                  <button 
                                  onClick={() => setPaymentModal({ installment: inst, amount: inst.amount })}
                                  className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-full text-[9px] font-bold transition-all shadow-sm"
                                >
                                  <Wallet size={10} /> ثبت پرداخت
                                </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex gap-2">
                      <button 
                        onClick={() => window.print()}
                        className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 py-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
                      >
                        <Printer size={16} /> چاپ دفترچه
                      </button>
                      {selectedBook.status !== 'canceled' && (
                        <button 
                          onClick={() => setShowDeleteConfirm(true)}
                          className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 py-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
                        >
                          <Trash2 size={16} /> ابطال دفترچه
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'create' && (
          <div className="space-y-6 pb-20">
            {/* Step 0: Beta Plan Toggle */}
            <div className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setIsBetaPlan(false)}
                  className={`p-3 rounded-2xl border transition-all text-right ${!isBetaPlan ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-zinc-150'}`}
                >
                  <div className={`text-xs font-bold ${!isBetaPlan ? 'text-indigo-700' : 'text-zinc-600'}`}>طرح پله‌ای معمولی</div>
                  <div className="text-[9px] text-zinc-400 mt-1">نرخ پایه بر اساس مدت خواب پول</div>
                </button>
                <button
                  onClick={() => setIsBetaPlan(true)}
                  className={`p-3 rounded-2xl border transition-all text-right ${isBetaPlan ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-zinc-150'}`}
                >
                  <div className={`text-xs font-bold ${isBetaPlan ? 'text-indigo-700' : 'text-zinc-600'}`}>طرح فروش بتا</div>
                  <div className="text-[9px] text-zinc-400 mt-1">طرح پله‌ای + ۵٪ مازاد</div>
                </button>
              </div>

              {isBetaPlan && (
                <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-indigo-700 font-bold">درصد مازاد طرح بتا:</span>
                    <div className="flex items-center gap-2">
                      <input 
                        type="text" inputMode="numeric" pattern="[0-9]*"

                        dir="ltr"
                        value={isNaN(betaSurcharge) ? '' : betaSurcharge}
                        onChange={e => setBetaSurcharge(Number(e.target.value))}
                        onFocus={e => e.target.select()}
                        className="w-16 bg-white border border-indigo-200 rounded-lg px-2 py-1 text-xs font-mono text-center outline-none"
                      />
                      <span className="text-[10px] text-indigo-500">%</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-zinc-800">
                <User size={16} className="text-indigo-600" />
                <span className="text-xs font-bold">اطلاعات پایه قسط</span>
              </div>
              
              <PersonSelector 
                persons={appState.persons}
                vouchers={appState.vouchers}
                selectedPersonId={selectedPerson?.id || ''}
                onSelect={handlePersonSelect}
                placeholder="انتخاب مشتری..."
                showInstallmentOnly={true}
                installmentBooks={appState.installmentBooks}
              />

              {isSelectedPersonInvalid && (
                <div className="bg-rose-50 border border-rose-100 text-rose-800 text-[11px] p-3.5 rounded-2xl flex items-start gap-2.5 text-right font-sans leading-relaxed shadow-sm animate-fade-in">
                  <AlertCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <strong className="text-rose-900 block font-bold">⚠️ خطا: این طرف حساب بدهی بلاتکلیف ندارد!</strong>
                    <span className="text-[10px] text-rose-700 block leading-relaxed">
                      این شخص در حال حاضر هیچ‌گونه بدهکاری بلاتکلیفی (مانده بدهکار ۱۰۳۰۲ منهای کل دفترچه‌های فعال) در سیستم ندارد. امکان صدور دفترچه جدید وجود ندارد.
                    </span>
                  </div>
                </div>
              )}

              {!isSelectedPersonInvalid && isPrincipalExceeded && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-[11px] p-3.5 rounded-2xl flex items-start gap-2.5 text-right font-sans leading-relaxed shadow-sm animate-fade-in">
                  <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <strong className="text-amber-900 block font-bold">⚠️ هشدار: مبلغ بیش از سقف بدهی بلاتکلیف!</strong>
                    <span className="text-[10px] text-amber-700 block leading-relaxed">
                      حداکثر سقف مجاز برای قسط‌بندی این شخص (مانده بلاتکلیف معین ۱۰۳۰۲) مبلغ <span className="font-mono font-bold">{selectedPersonUnassignedBalance.toLocaleString()}</span> ریال می‌باشد. لطفا مبلغ اصل بدهی را کاهش دهید.
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-zinc-500 pr-1">مبلغ اصل بدهی</label>
                  <input 
                    type="text" inputMode="numeric" pattern="[0-9]*"

                    dir="ltr"
                    value={isNaN(principal) ? '' : principal}
                    onChange={e => setPrincipal(Number(e.target.value))}
                    onFocus={(e) => e.target.select()}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-zinc-500 pr-1">تاریخ شروع (سررسید اول)</label>
                  <input 
                    type="text"

                    dir="ltr"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-indigo-500 text-center"
                  />
                </div>
              </div>
            </div>

            {/* Step 2: Intervals & Plan */}
            <div className="bg-white rounded-3xl border border-zinc-200 p-5 space-y-4">
              <div className="flex items-center gap-2 text-zinc-800">
                <Calendar size={16} className="text-indigo-600" />
                <span className="text-xs font-bold">تنظیمات زمانی و کارمزد</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-zinc-500 pr-1">تعداد اقساط</label>
                  <input 
                    type="text" inputMode="numeric" pattern="[0-9]*"

                    dir="ltr"
                    value={isNaN(installmentCount) ? '' : installmentCount}
                    onChange={e => setInstallmentCount(Number(e.target.value))}
                    onFocus={(e) => e.target.select()}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] text-zinc-500 pr-1">کارمزد ماهانه (%)</label>
                  <input 
                    type="text"
                    disabled={true}
                    value={effectiveMonthlyInterest}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-zinc-500 pr-1">کمیسیون نماینده (سقف مجاز: {maxCommission}٪)</label>
                <select
                  value={representativeCommission}
                  onChange={(e) => setRepresentativeCommission(Number(e.target.value))}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-xs font-mono outline-none focus:border-indigo-500 text-center"
                >
                  {commissionOptions.map(rate => (
                    <option key={rate} value={rate}>{rate}٪</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="text-xs font-bold text-zinc-700">فواصل زمانی متغیر؟</label>
                <button 
                  onClick={() => setIsVariable(!isVariable)}
                  className={`w-12 h-6 rounded-full transition-colors relative ${isVariable ? 'bg-indigo-600' : 'bg-zinc-200'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isVariable ? 'right-7' : 'right-1'}`} />
                </button>
              </div>

              {!isVariable ? (
                <div className="grid grid-cols-4 gap-1.5">
                  {[1, 7, 30, 60].map(val => (
                    <button 
                      key={val}
                      onClick={() => handleIntervalChange(val)}
                      className={`py-2 rounded-xl text-[9px] font-bold border transition ${intervalDays === val ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-zinc-100 text-zinc-500'}`}
                    >
                      {val === 1 ? 'روزانه' : val === 7 ? 'هفتگی' : val === 30 ? 'ماهانه' : 'دو ماهه'}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100">
                  <p className="text-[9px] text-amber-700 leading-relaxed">
                    در حالت متغیر، کارمزد هر قسط بر اساس فاصله زمانی آن قسط از تاریخ شروع محاسبه می‌شود (نرخ ریسک شناور).
                  </p>
                </div>
              )}
            </div>

            {/* Preview & Calculate */}
            {calcResults && (
              <div className="bg-zinc-900 rounded-3xl p-5 text-white space-y-4">
                <div className="flex justify-between items-center border-b border-white/10 pb-3">
                  <span className="text-xs font-bold">خلاصه محاسبات (نرخ واقعی: {effectiveMonthlyInterest}%)</span>
                  <TrendingUp size={16} className="text-emerald-400" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] opacity-60">کل سود کارمزد</div>
                    <div className="text-sm font-bold font-mono">{calcResults.totalInterest.toLocaleString()}</div>
                  </div>
                  <div className="text-left">
                    <div className="text-[10px] opacity-60">کل بازپرداخت</div>
                    <div className="text-sm font-bold font-mono">{calcResults.totalPayable.toLocaleString()}</div>
                  </div>
                </div>
                <button 
                  onClick={handleCreateBooklet}
                  disabled={isSelectedPersonInvalid || isPrincipalExceeded}
                  className={`w-full font-bold py-3.5 rounded-2xl text-xs transition flex items-center justify-center gap-2 ${
                    (isSelectedPersonInvalid || isPrincipalExceeded)
                      ? 'bg-zinc-700/60 text-zinc-400 cursor-not-allowed border border-white/5'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-white'
                  }`}
                >
                  <Save size={18} /> تایید و صدور نهایی دفترچه
                </button>
              </div>
            )}

            {/* List of Installment Debtors (Requested) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-600 px-1">
                <Users size={16} />
                <span className="text-xs font-bold">بدهکاران اقساطی فعال ({installmentDebtors.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {installmentDebtors.map(debtor => {
                  const hasCreditFile = appState.creditFiles?.some(f => f.personId === debtor.person.id);
                  return (
                  <div
                    key={debtor.person.id}
                    className="bg-white border border-zinc-200 rounded-2xl p-3 text-right hover:border-indigo-400 transition flex justify-between items-center"
                  >
                    <button 
                      onClick={() => setSelectedPerson(debtor.person)}
                      className="flex items-center gap-3 text-right flex-1"
                    >
                      <div className="w-8 h-8 rounded-full bg-zinc-50 flex items-center justify-center text-zinc-400">
                        <User size={16} />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-zinc-800">{debtor.person.name}</div>
                        <div className="text-[9px] text-zinc-400 mt-0.5">{debtor.booksCount} دفترچه فعال</div>
                      </div>
                    </button>
                    <div className="text-left flex flex-col items-end gap-2">
                      <div>
                        <div className="text-[10px] font-bold text-indigo-600">{(debtor.totalRemaining ?? 0).toLocaleString()} ریال</div>
                        <div className="text-[8px] text-zinc-400">مانده بدهی اقساط</div>
                      </div>
                      {hasCreditFile && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingDocsPersonId(debtor.person.id);
                          }}
                          className="px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-[9px] font-bold transition-colors"
                        >
                          پرونده مدارک
                        </button>
                      )}
                    </div>
                  </div>
                )})}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="space-y-6 pb-20">
            {/* Installment Debtors List (Detailed) */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-800 px-1">
                <Users size={16} className="text-indigo-600" />
                <span className="text-xs font-bold">لیست کل بدهکاران اقساطی</span>
              </div>
              {installmentDebtors.length === 0 ? (
                <div className="bg-white border border-dashed border-zinc-200 rounded-2xl p-6 text-center text-[10px] text-zinc-400">
                  هیچ بدهکار اقساطی فعال یافت نشد
                </div>
              ) : (
                <div className="bg-white rounded-3xl border border-zinc-200 overflow-hidden shadow-sm">
                  <table className="w-full text-right text-[10px] border-collapse">
                    <thead className="bg-zinc-50 text-zinc-500 border-b border-zinc-200">
                      <tr>
                        <th className="p-3 font-bold">نام مشتری</th>
                        <th className="p-3 font-bold">تعداد دفترچه</th>
                        <th className="p-3 font-bold">مانده کل اقساط</th>
                        <th className="p-3 font-bold">مدارک پرونده</th>
                      </tr>
                    </thead>
                    <tbody>
                      {installmentDebtors.map(debtor => {
                        const hasCreditFile = appState.creditFiles?.some(f => f.personId === debtor.person.id);
                        return (
                        <tr key={debtor.person.id} className="border-b border-zinc-100 last:border-none hover:bg-zinc-50 transition">
                          <td className="p-3">
                            <div className="font-bold text-zinc-800">{debtor.person.name}</div>
                            <div className="text-[8px] text-zinc-400 font-mono mt-0.5">{debtor.person.code}</div>
                          </td>
                          <td className="p-3 text-center">{debtor.booksCount}</td>
                          <td className="p-3 text-left font-mono font-bold text-indigo-600">{(debtor.totalRemaining ?? 0).toLocaleString()}</td>
                          <td className="p-3 text-center">
                            {hasCreditFile ? (
                              <button 
                                onClick={() => setViewingDocsPersonId(debtor.person.id)}
                                className="px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-[9px] font-bold transition-colors"
                              >
                                پرونده مدارک
                              </button>
                            ) : (
                              <span className="text-[9px] text-zinc-400">ندارد</span>
                            )}
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Overdue Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-red-600 px-1">
                <AlertCircle size={16} />
                <span className="text-xs font-bold">اقساط معوقه ({overdueInstallments.length})</span>
              </div>
              {overdueInstallments.length === 0 ? (
                <div className="bg-white border border-dashed border-zinc-200 rounded-2xl p-6 text-center text-[10px] text-zinc-400">
                  هیچ قسط معوقه‌ای یافت نشد
                </div>
              ) : (
                overdueInstallments.map(inst => (
                  <div key={inst.id} className="bg-red-50 border border-red-100 rounded-2xl p-3 flex justify-between items-center shadow-sm">
                    <div>
                      <div className="text-[10px] font-bold text-red-800">{appState.persons.find(p => p.id === appState.installmentBooks.find(b => b.id === inst.bookId)?.personId)?.name}</div>
                      <div className="text-[9px] text-red-600 mt-1 font-mono">سررسید: {inst.dueDate} | مبلغ: {(inst.amount ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="text-[10px] font-bold text-red-700 bg-red-100 px-2 py-1 rounded-lg">
                      معوقه
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Upcoming Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-indigo-600 px-1">
                <Clock size={16} />
                <span className="text-xs font-bold">سررسیدهای پیش‌رو (۷ روز آینده)</span>
              </div>
              {upcomingInstallments.length === 0 ? (
                <div className="bg-white border border-dashed border-zinc-200 rounded-2xl p-6 text-center text-[10px] text-zinc-400">
                  سررسیدی در ۷ روز آینده وجود ندارد
                </div>
              ) : (
                upcomingInstallments.map(inst => (
                  <div key={inst.id} className="bg-white border border-zinc-200 rounded-2xl p-3 flex justify-between items-center shadow-sm">
                    <div>
                      <div className="text-[10px] font-bold text-zinc-800">{appState.persons.find(p => p.id === appState.installmentBooks.find(b => b.id === inst.bookId)?.personId)?.name}</div>
                      <div className="text-[9px] text-zinc-500 mt-1 font-mono">تاریخ: {inst.dueDate} | مبلغ: {(inst.amount ?? 0).toLocaleString()}</div>
                    </div>
                    <button className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg shadow-sm">
                      اطلاع‌رسانی
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-zinc-950/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" dir="rtl">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full border border-zinc-150 shadow-xl space-y-4 text-center font-sans"
            >
              <div className="mx-auto w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center">
                <Trash2 size={24} />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-zinc-900">ابطال و حذف دفترچه قسط</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  آیا از ابطال و حذف کامل این دفترچه قسط و تمامی اقساط آن اطمینان دارید؟ با این کار اسناد حسابداری مرتبط با آن نیز حذف خواهند شد.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 py-2.5 rounded-2xl text-xs font-bold transition-all"
                >
                  انصراف
                </button>
                <button
                  onClick={() => {
                    if (selectedBook) {
                      handleDeleteBooklet(selectedBook.id);
                    }
                    setShowDeleteConfirm(false);
                  }}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-2xl text-xs font-bold transition-all shadow-sm"
                >
                  بله، ابطال شود
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
        
        {/* Payment Modal */}
        {paymentModal && (() => {
          const targetBook = appState.installmentBooks.find(b => b.id === paymentModal.installment.bookId);
          const targetCalc = appState.calculators?.find(c => c.id === targetBook?.calculatorId || c.id === paymentModal.installment.calculatorId);
          const isBetaInst = !!(targetBook?.agentBankName || paymentModal.installment.agentBankName ||
                               targetCalc?.type === 'beta' ||
                               (targetCalc?.name || '').includes('بتا'));
          const betaBankName = paymentModal.installment.agentBankName || targetBook?.agentBankName || targetCalc?.bankName || 'بانک رفاه';

          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
                <h3 className="text-sm font-bold text-zinc-900">ثبت پرداخت قسط شماره {paymentModal.installment.installmentNumber}</h3>
                <div className="space-y-3">
                  <div className="text-[10px] text-zinc-500">مبلغ: <span className="font-mono font-bold text-zinc-800">{paymentModal.amount.toLocaleString()} ریال</span></div>
                  
                  {isBetaInst ? (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-right space-y-1">
                      <div className="text-[10px] font-bold text-emerald-800 flex items-center gap-1">
                        <Landmark size={12} /> بانک عامل پرداخت‌کننده (خودکار)
                      </div>
                      <div className="text-[11px] font-black text-emerald-950">{betaBankName}</div>
                      <div className="text-[9px] text-emerald-700 leading-tight">
                        بر اساس ماشین‌حساب پرونده، این پرداخت مستقیماً از طریق بانک عامل اختصاص‌یافته تسویه می‌شود.
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => setPaymentMethod('cash')} className={`p-2 rounded-xl border text-xs font-bold ${paymentMethod === 'cash' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-zinc-50 border-zinc-100 text-zinc-500'}`}>نقدی</button>
                        <button onClick={() => setPaymentMethod('pos')} className={`p-2 rounded-xl border text-xs font-bold ${paymentMethod === 'pos' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-zinc-50 border-zinc-100 text-zinc-500'}`}>کارتخوان</button>
                        <button onClick={() => setPaymentMethod('bank')} className={`p-2 rounded-xl border text-xs font-bold ${paymentMethod === 'bank' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-zinc-50 border-zinc-100 text-zinc-500'}`}>بانکی</button>
                      </div>
                      
                      {paymentMethod === 'pos' && (
                        <select className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-xs" value={paymentTerminalId} onChange={e => setPaymentTerminalId(e.target.value)}>
                          {appState.bankTerminals.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      )}
                    </>
                  )}
                </div>
                <div className="flex gap-2 pt-4">
                  <button onClick={() => setPaymentModal(null)} className="flex-1 bg-zinc-100 hover:bg-zinc-200 py-3 rounded-xl text-xs font-bold text-zinc-600">انصراف</button>
                  <button onClick={handleRegisterPayment} className="flex-1 bg-indigo-600 hover:bg-indigo-700 py-3 rounded-xl text-xs font-bold text-white">ثبت نهایی</button>
                </div>
              </div>
            </div>
          );
        })()}
        
      {/* View Credit Documents Modal */}
      {viewingDocsPersonId && (() => {
        const creditFile = appState.creditFiles?.find(f => f.personId === viewingDocsPersonId);
        if (!creditFile) return null;
        
        return (
          <CreditFileDocuments 
            creditFile={creditFile}
            state={appState}
            onUpdateFile={(updatedFile) => {
              const updatedFiles = (appState.creditFiles || []).map(f => 
                f.id === updatedFile.id ? updatedFile : f
              );
              onSave({ ...appState, creditFiles: updatedFiles });
            }}
            onClose={() => setViewingDocsPersonId(null)}
            readOnly={false}
          />
        );
      })()}

      </div>
  );
}
