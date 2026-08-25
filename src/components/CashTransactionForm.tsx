import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, ArrowDownRight, ArrowUpRight, DollarSign, RefreshCw, AlertTriangle } from 'lucide-react';
import { AppState, Person, AccountSubsidiary } from '../types';
import { parseNumericValue } from '../utils/accounting';
import PersonSelector from './PersonSelector';
import AccountSubsidiarySelector from './AccountSubsidiarySelector';
import { useCoaReadModel } from '../services/CoaReadService';
import { getDefaultAuthSessionService } from '../services/authSessionService';

export type TransactionPurpose = 'general' | 'installment';
export type TransactionStatus = 'idle' | 'submitting' | 'committed_refreshing' | 'committed_refresh_error' | 'mutation_error' | 'completed';

export interface CashTransactionFormProps {
  appState: AppState;
  onSave?: (newState: AppState) => void;
  onClose: () => void;
  defaultPerson?: Person;
  onFinancialMutationCommitted?: () => Promise<void>;
  onPostMutationHydration?: () => Promise<void>;
  transactionPurpose?: TransactionPurpose;
  installmentBookId?: string;
  selectedInstallmentId?: string;
  selectedInstallmentIds?: string[];
  explicitInstallmentAllocation?: boolean;
}

export const POST_MUTATION_HYDRATION_ERROR = 'عملیات در سرور ثبت شد، اما دریافت اطلاعات تازه ناموفق بود. برای جلوگیری از ثبت تکراری، عملیات را دوباره انجام ندهید و فقط دریافت اطلاعات را تکرار کنید.';
export const INSTALLMENT_RECEIVE_BLOCKED_MESSAGE = 'ثبت دریافت بابت اقساط تا تکمیل تخصیص اتمیک قسط در سرور موقتاً غیرفعال است. می‌توانید این وجه را فقط به‌عنوان دریافت عادی و بدون تخصیص به اقساط ثبت کنید.';

export default function CashTransactionForm({
  appState,
  onClose,
  defaultPerson,
  onFinancialMutationCommitted,
  onPostMutationHydration,
  ...props
}: CashTransactionFormProps) {
  const { subsidiaries: activeSubsidiaries } = useCoaReadModel(appState.subsidiaries);
  const [type, setType] = useState<'receive' | 'pay'>('receive');
  const [personId, setPersonId] = useState(defaultPerson?.id || '');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState('');

  const [transactionPurpose, setTransactionPurpose] = useState<TransactionPurpose>(
    props.transactionPurpose ||
    (props.installmentBookId || props.selectedInstallmentId || (props.selectedInstallmentIds && props.selectedInstallmentIds.length > 0) || props.explicitInstallmentAllocation
      ? 'installment'
      : 'general')
  );
  const [installmentBookId, setInstallmentBookId] = useState<string>(props.installmentBookId || '');
  const [selectedInstallmentId, setSelectedInstallmentId] = useState<string>(props.selectedInstallmentId || '');
  const [selectedInstallmentIds, setSelectedInstallmentIds] = useState<string[]>(props.selectedInstallmentIds || []);
  const [explicitInstallmentAllocation, setExplicitInstallmentAllocation] = useState<boolean>(props.explicitInstallmentAllocation || false);

  const [status, setStatus] = useState<TransactionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [opKey, setOpKey] = useState<string>('');

  const refreshFn = onFinancialMutationCommitted || onPostMutationHydration;

  const banksAndCashboxes = activeSubsidiaries.filter(s => s.generalType === 'بانک‌ها' || s.generalType === 'صندوق‌ها');

  const selectedPersonInstallments = type === 'receive' && personId
    ? (appState.installments || []).filter(i => {
        const book = (appState.installmentBooks || []).find(b => b.id === i.bookId);
        return book && book.personId === personId && (i.status === 'upcoming' || i.status === 'partially_paid' || i.status === 'overdue');
      })
    : [];

  const isExplicitInstallmentReceive = type === 'receive' && (
    transactionPurpose === 'installment' ||
    Boolean(installmentBookId) ||
    Boolean(selectedInstallmentId) ||
    (selectedInstallmentIds && selectedInstallmentIds.length > 0) ||
    explicitInstallmentAllocation
  );

  const isFormLocked = status === 'submitting' || status === 'committed_refreshing' || status === 'committed_refresh_error' || status === 'completed';

  const switchToGeneralReceive = () => {
    if (isFormLocked) return;
    setTransactionPurpose('general');
    setInstallmentBookId('');
    setSelectedInstallmentId('');
    setSelectedInstallmentIds([]);
    setExplicitInstallmentAllocation(false);
  };

  const handleTypeChange = (newType: 'receive' | 'pay') => {
    if (isFormLocked) return;
    setType(newType);
    if (newType === 'pay') {
      switchToGeneralReceive();
    }
    setOpKey('');
  };

  const handlePersonSelect = (id: string) => {
    if (isFormLocked) return;
    setPersonId(id);
    setOpKey('');
  };

  const handleAccountSelect = (id: string) => {
    if (isFormLocked) return;
    setAccountId(id);
    setOpKey('');
  };

  const handleAmountChange = (val: number) => {
    if (isFormLocked) return;
    setAmount(val);
    setOpKey('');
  };

  const performRefresh = async () => {
    setStatus('committed_refreshing');
    setErrorMessage(null);
    if (refreshFn) {
      try {
        await refreshFn();
        setStatus('completed');
        onClose();
      } catch (refreshErr: any) {
        console.error('Post-mutation hydration failed:', refreshErr);
        setStatus('committed_refresh_error');
        setErrorMessage(POST_MUTATION_HYDRATION_ERROR);
      }
    } else {
      setStatus('completed');
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isFormLocked) return;

    if (type === 'receive' && isExplicitInstallmentReceive) {
      alert(INSTALLMENT_RECEIVE_BLOCKED_MESSAGE);
      return;
    }

    if (!personId || !accountId || amount <= 0) {
      alert('لطفاً اطلاعات را کامل وارد کنید.');
      return;
    }

    const person = appState.persons.find(p => p.id === personId);
    const account = activeSubsidiaries.find(s => s.id === accountId);
    if (!person || !account) return;

    const currentOpKey = opKey || `op_${type}_${person.id}_${amount}_${Date.now()}`;
    if (!opKey) {
      setOpKey(currentOpKey);
    }

    setStatus('submitting');
    setErrorMessage(null);

    const endpoint = type === 'pay' ? '/api/cash-transactions/pay' : '/api/cash-transactions/receive';

    try {
      const token = (await getDefaultAuthSessionService().getAccessToken()) || '';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          personId: person.id,
          personName: person.name,
          accountId: account.id,
          amount,
          date: new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
          description: description.trim(),
          operationKey: currentOpKey
        })
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || 'خطا در ثبت تراکنش در پایگاه داده');
      }

      await performRefresh();
    } catch (err: any) {
      setStatus('mutation_error');
      setErrorMessage(`خطا در ثبت ${type === 'pay' ? 'پرداخت' : 'دریافت'}: ${err.message || err}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
        dir="rtl"
      >
        <div className="bg-zinc-50 border-b border-zinc-100 p-4 flex justify-between items-center">
          <div className="flex items-center space-x-2 space-x-reverse">
            <DollarSign className="text-zinc-500" />
            <h3 className="font-sans font-bold text-zinc-800">سند دریافت / پرداخت نقدی</h3>
          </div>
          <button
            onClick={onClose}
            disabled={status === 'submitting' || status === 'committed_refreshing'}
            className="p-2 hover:bg-zinc-200 rounded-full transition disabled:opacity-50"
          >
            <X size={20} className="text-zinc-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="flex bg-zinc-100 p-1 rounded-xl">
            <button
              type="button"
              disabled={isFormLocked}
              onClick={() => handleTypeChange('receive')}
              className={`flex-1 py-2 font-sans text-sm font-semibold rounded-lg flex justify-center items-center space-x-1 space-x-reverse transition ${type === 'receive' ? 'bg-emerald-500 text-white shadow' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <ArrowDownRight size={16} />
              <span>دریافت وجه (واریز به حساب)</span>
            </button>
            <button
              type="button"
              disabled={isFormLocked}
              onClick={() => handleTypeChange('pay')}
              className={`flex-1 py-2 font-sans text-sm font-semibold rounded-lg flex justify-center items-center space-x-1 space-x-reverse transition ${type === 'pay' ? 'bg-rose-500 text-white shadow' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <ArrowUpRight size={16} />
              <span>پرداخت وجه (حواله/کارت)</span>
            </button>
          </div>

          <div>
            <PersonSelector
              persons={appState.persons}
              selectedPersonId={personId}
              onSelect={handlePersonSelect}
              vouchers={appState.vouchers}
              installmentBooks={appState.installmentBooks}
              label="طرف حساب (نماینده، مشتری یا بستانکار)"
              placeholder="جستجو و انتخاب طرف حساب..."
            />
          </div>

          <div>
            <AccountSubsidiarySelector
              subsidiaries={banksAndCashboxes}
              selectedSubId={accountId}
              onSelect={handleAccountSelect}
              label="حساب بانکی / صندوق"
              placeholder="انتخاب بانک یا صندوق..."
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 font-sans mb-1">مبلغ (ریال)</label>
            <input
              type="text"
              inputMode="numeric"
              disabled={isFormLocked}
              placeholder="مثلاً 1,000,000"
              value={amount > 0 ? amount.toLocaleString() : ''}
              onChange={e => handleAmountChange(parseNumericValue(e.target.value))}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 font-mono text-left text-lg outline-none focus:border-indigo-500 transition disabled:opacity-60"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 font-sans mb-1">شرح تراکنش (اختیاری)</label>
            <textarea
              disabled={isFormLocked}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={`بابت تسویه...`}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 font-sans text-sm outline-none focus:border-indigo-500 transition resize-none h-20 disabled:opacity-60"
            />
          </div>

          {type === 'receive' && selectedPersonInstallments.length > 0 && (
            <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-600 font-sans">
                <span>نوع دریافت وجه:</span>
                <span className="text-[10px] text-zinc-400">طرف حساب دارای {selectedPersonInstallments.length} قسط فعال است</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isFormLocked}
                  onClick={switchToGeneralReceive}
                  className={`flex-1 py-1.5 px-3 text-xs font-sans font-medium rounded-xl transition ${
                    transactionPurpose === 'general' && !isExplicitInstallmentReceive
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  دریافت عادی (بدون تخصیص قسط)
                </button>
                <button
                  type="button"
                  disabled={isFormLocked}
                  onClick={() => {
                    if (isFormLocked) return;
                    setTransactionPurpose('installment');
                    setExplicitInstallmentAllocation(true);
                  }}
                  className={`flex-1 py-1.5 px-3 text-xs font-sans font-medium rounded-xl transition ${
                    isExplicitInstallmentReceive
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  تخصیص بابت اقساط
                </button>
              </div>
            </div>
          )}

          {isExplicitInstallmentReceive && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-right text-xs text-amber-900 space-y-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={16} />
                <p className="leading-relaxed font-sans">{INSTALLMENT_RECEIVE_BLOCKED_MESSAGE}</p>
              </div>
              <button
                type="button"
                onClick={switchToGeneralReceive}
                className="w-full bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 font-sans font-semibold py-2 rounded-xl transition text-xs"
              >
                تغییر به دریافت عادی (بدون تخصیص قسط)
              </button>
            </div>
          )}

          {status === 'committed_refresh_error' && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-right text-xs text-amber-900 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
                <p className="leading-relaxed font-sans">{POST_MUTATION_HYDRATION_ERROR}</p>
              </div>
              <button
                type="button"
                onClick={performRefresh}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-sans font-bold py-2.5 rounded-xl transition flex justify-center items-center gap-2 text-sm"
              >
                <RefreshCw size={16} />
                <span>تلاش دوباره برای دریافت اطلاعات</span>
              </button>
            </div>
          )}

          {status === 'mutation_error' && errorMessage && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-right text-xs text-rose-800 font-sans">
              {errorMessage}
            </div>
          )}

          {status !== 'committed_refresh_error' && (
            <button
              type="submit"
              disabled={isFormLocked || isExplicitInstallmentReceive}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-sans font-bold py-3.5 rounded-xl transition flex justify-center items-center gap-2"
            >
              {(status === 'submitting' || status === 'committed_refreshing') && (
                <RefreshCw size={18} className="animate-spin" />
              )}
              <span>
                {status === 'submitting'
                  ? 'در حال ثبت در پایگاه داده...'
                  : status === 'committed_refreshing'
                  ? 'در حال تازه‌سازی اطلاعات مالی از سرور...'
                  : type === 'receive'
                  ? 'ثبت سند دریافت'
                  : 'ثبت سند پرداخت'}
              </span>
            </button>
          )}
        </form>
      </motion.div>
    </div>
  );
}

