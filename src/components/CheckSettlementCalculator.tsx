/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Calculator, Calendar, Landmark, Plus, Trash2, X, CheckCircle, Sparkles, AlertCircle, Building2 } from 'lucide-react';
import { Person, Check, AppState, BusinessPartner, AgentCalculatorOverride } from '../types';
import { getCurrentJalaliDate, addMonthsToJalali } from '../utils/jalali';
import { parseNumericValue, toEnglishDigits } from '../utils/accounting';
import PersonSelector from './PersonSelector';
import { 
  calculateCredit, 
  resolveCalculatorType, 
  resolveEffectiveCalculatorSettings,
  getAgentCalculatorOverride,
  CalculatorEngineSettings 
} from '../utils/creditCalculatorEngine';

interface CheckSettlementCalculatorProps {
  remainingAmount: number;
  personId: string;
  persons: Person[];
  calculatorId?: string;
  state?: AppState;
  agentId?: string;
  partner?: BusinessPartner;
  onConfirm: (
    cheques: Omit<Check, 'id' | 'currentState' | 'history' | 'createdAt'>[], 
    commissionAmount: number, 
    agentCommissionAmount?: number, 
    agentCommissionRate?: number,
    installmentCount?: number,
    installmentAmount?: number,
    totalRepayment?: number
  ) => void;
  onAmountChange?: (amount: number) => void;
  onCancel: () => void;
  isInline?: boolean;
}

export default function CheckSettlementCalculator({
  remainingAmount,
  personId: initialPersonId,
  persons,
  calculatorId,
  state,
  agentId,
  partner,
  onConfirm,
  onCancel,
  onAmountChange,
  isInline = false
}: CheckSettlementCalculatorProps) {
  const calculator = state?.calculators?.find(c => c.id === calculatorId);
  const calcType = resolveCalculatorType(calculatorId || calculator?.type || calculator?.id, calculator?.name);
  const [personId, setPersonId] = useState(initialPersonId);
  const [installmentCount, setInstallmentCount] = useState<number>(1);
  const [intervalMonths, setIntervalMonths] = useState<number>(1);
  const [representativeCommission, setRepresentativeCommission] = useState<number>(0);
  const [cheques, setCheques] = useState<any[]>([]);

  const partnerBp = useMemo(() => {
    if (partner) return partner;
    if (!state?.businessPartners) return undefined;

    const lookupId = agentId || personId;
    if (!lookupId) return undefined;

    const cleanLookupId = lookupId.replace('BP_', '').replace('p_', '');
    return state.businessPartners.find(p => {
      if (p.id === lookupId || p.personId === lookupId) return true;
      const cleanPId = (p.id || '').replace('BP_', '').replace('p_', '');
      const cleanPersonId = (p.personId || '').replace('BP_', '').replace('p_', '');
      if (cleanPId && cleanPId === cleanLookupId) return true;
      if (cleanPersonId && cleanPersonId === cleanLookupId) return true;
      if (p.profile?.partnerId === lookupId || p.profile?.partnerId === cleanLookupId) return true;
      if (p.users && p.users.includes(lookupId)) return true;
      const userMatch = state.users?.find(u => u.id === lookupId);
      if (userMatch && userMatch.personId && (userMatch.personId === p.personId || userMatch.personId === p.id)) return true;
      return false;
    });
  }, [partner, agentId, personId, state?.businessPartners, state?.users]);

  const IRANIAN_BANKS = [
    'ملی', 'ملت', 'صادرات', 'سپه', 'تجارت', 'کشاورزی', 'مسکن', 'رفاه',
    'پاسارگاد', 'پارسیان', 'سامان', 'اقتصاد نوین', 'رسالت', 'مهر ایران',
    'گردشگری', 'آینده', 'شهر', 'دی', 'سرمایه', 'سینا', 'کارآفرین', 'پست بانک'
  ];
  const [suggestedBanks] = useState(['ملی', 'ملت', 'صادرات', 'تجارت', 'سپه', 'پاسارگاد', 'سامان']);

  const [amount, setAmount] = useState<number | string>(() => {
    const val = Number(remainingAmount);
    return isNaN(val) ? 0 : val;
  });

  useEffect(() => {
    const val = Number(remainingAmount);
    if (!isNaN(val)) {
      setAmount(val);
    }
  }, [remainingAmount]);

  useEffect(() => {
    if (onAmountChange) {
      const val = Number(amount);
      if (!isNaN(val)) {
        onAmountChange(val);
      }
    }
  }, [amount, onAmountChange]);

  useEffect(() => {
    setPersonId(initialPersonId);
  }, [initialPersonId]);
  
  // Custom calculator settings resolved via hierarchy (Agent Override -> Calculator Config -> Global Settings)
  const resolvedConfig = resolveEffectiveCalculatorSettings(
    calculatorId,
    partnerBp,
    state?.calculators,
    state?.settings
  );
  const customSettings: Partial<CalculatorEngineSettings> = resolvedConfig;

  // Check if calculator is active for this agent via override or calculator config
  let agentOverrideObj = getAgentCalculatorOverride(partnerBp?.calculatorOverrides, calculatorId, calculator);
  const isCalculatorActive = (calculator?.isActive !== false) && (agentOverrideObj?.isActive !== false);

  console.log('[DEBUG CALCULATOR SELECTED/RENDERED]', {
    calculatorId,
    calculator,
    calcType,
    partnerBp,
    calculatorOverrides: partnerBp?.calculatorOverrides,
    agentOverrideObj,
    resolvedConfig
  });

  const minInstallmentCount = resolvedConfig.minInstallmentCount && resolvedConfig.minInstallmentCount > 0 ? resolvedConfig.minInstallmentCount : 1;
  const maxInstallmentCount = resolvedConfig.maxInstallmentCount && resolvedConfig.maxInstallmentCount > 0 ? resolvedConfig.maxInstallmentCount : 60;

  useEffect(() => {
    if (minInstallmentCount > 0 && installmentCount < minInstallmentCount) {
      setInstallmentCount(minInstallmentCount);
    } else if (maxInstallmentCount > 0 && installmentCount > maxInstallmentCount) {
      setInstallmentCount(maxInstallmentCount);
    }
  }, [minInstallmentCount, maxInstallmentCount]);

  const maxCommission = resolvedConfig.maxCommissionPercent !== undefined
    ? resolvedConfig.maxCommissionPercent
    : Math.max(10, partnerBp?.contract?.commissionRate ?? 10);

  const commissionOptions = Array.from({ length: maxCommission + 1 }, (_, i) => i);

  useEffect(() => {
    if (representativeCommission > maxCommission) {
      setRepresentativeCommission(maxCommission);
    }
  }, [maxCommission]);

  const partnerAllowedTenors = partnerBp?.creditExtension?.creditRules?.allowedTenors;
  const dropdownUpperLimit = Math.min(maxInstallmentCount, 36);
  const dropdownOptions = (partnerAllowedTenors && partnerAllowedTenors.length > 0)
    ? partnerAllowedTenors.filter(t => t >= minInstallmentCount && t <= maxInstallmentCount)
    : Array.from(
        { length: Math.max(0, dropdownUpperLimit - minInstallmentCount + 1) },
        (_, i) => minInstallmentCount + i
      );

  const numericAmount = Number(amount) || 0;
  
  // Execute pure calculation from credit calculator engine
  const calcResult = calculateCredit(
    calcType,
    numericAmount,
    installmentCount,
    intervalMonths,
    representativeCommission,
    customSettings
  );

  const baseTotal = calcResult.subtotalAfterBank; // Amount before representative commission
  const finalTotal = calcResult.finalTotal;
  const totalCommissionAmount = calcResult.finalTotal - numericAmount;
  const totalRate = numericAmount > 0 ? (totalCommissionAmount / numericAmount) * 100 : 0;

  // Validation: Duration (installmentCount) must be a multiple of intervalMonths
  const isDivisible = installmentCount > 0 && installmentCount % intervalMonths === 0;
  const effectiveInstallmentCount = isDivisible ? (installmentCount / intervalMonths) : 0;
  
  // Rounding installments to the nearest 100,000 Rials
  const actualChequesCount = effectiveInstallmentCount > 0 ? effectiveInstallmentCount : 1;
  
  const effectiveSlopePercent = agentOverrideObj?.decliningSlopePercentage !== undefined 
    ? agentOverrideObj.decliningSlopePercentage 
    : (calculator?.decliningSlopePercentage || 0);
  const slope = effectiveSlopePercent / 100;
  const installmentAmounts = useMemo(() => {
    const amounts: number[] = Array(actualChequesCount).fill(0);
    if (actualChequesCount <= 0) return amounts;

    if (actualChequesCount === 1) {
      amounts[0] = finalTotal;
      return amounts;
    }

    if (slope > 0) {
      // Arithmetic progression: A_n = A_1 * (1 - slope)
      // Sum = n/2 * (A_1 + A_n) = finalTotal
      const A1 = (2 * finalTotal) / (actualChequesCount * (2 - slope));
      const An = A1 * (1 - slope);
      const d = (A1 - An) / (actualChequesCount - 1);
      
      let sumRest = 0;
      for (let i = 1; i < actualChequesCount; i++) {
        const rawVal = A1 - i * d;
        const rounded = Math.round(rawVal / 1000) * 1000;
        amounts[i] = rounded;
        sumRest += rounded;
      }
      amounts[0] = finalTotal - sumRest;
    } else {
      const baseRaw = finalTotal / actualChequesCount;
      const roundedBase = Math.round(baseRaw / 1000) * 1000;
      let sumRest = 0;
      for (let i = 1; i < actualChequesCount; i++) {
        amounts[i] = roundedBase;
        sumRest += roundedBase;
      }
      amounts[0] = finalTotal - sumRest;
    }
    return amounts;
  }, [slope, finalTotal, actualChequesCount]);

  const perInstallmentAmount = installmentAmounts[0] || 0;

  useEffect(() => {
    if (!isDivisible || effectiveInstallmentCount <= 0) {
      setCheques([]);
      return;
    }
    // Generate initial cheques based on effectiveInstallmentCount and intervals
    const newCheques = [];
    let currentDueDate = getCurrentJalaliDate();
    
    for (let i = 0; i < actualChequesCount; i++) {
      currentDueDate = addMonthsToJalali(currentDueDate, intervalMonths);
      
      newCheques.push({
        checkNumber: '',
        sayadiNumber: '',
        bankName: '',
        dueDate: currentDueDate,
        amount: installmentAmounts[i],
        nationalId: (persons || []).find(p => p.id === personId)?.nationalId || '',
      });
    }
    setCheques(newCheques);
  }, [effectiveInstallmentCount, isDivisible, intervalMonths, finalTotal, installmentAmounts, personId, amount]);

  const handleChequeChange = (index: number, field: string, value: any) => {
    const updated = [...cheques];
    updated[index] = { ...updated[index], [field]: value };
    
    // Auto-propagation logic from first check
    if (index === 0) {
      for (let i = 1; i < updated.length; i++) {
        // Propagate Bank Name
        if (field === 'bankName') {
          updated[i].bankName = value;
        }
        
        // Propagate National ID
        if (field === 'nationalId') {
          updated[i].nationalId = value;
        }

        // Propagate Check Number (Increment)
        if (field === 'checkNumber') {
          const num = parseInt(value);
          if (!isNaN(num)) {
            updated[i].checkNumber = (num + i).toString();
          }
        }

        // Propagate Sayadi Number Algorithm
        if (field === 'sayadiNumber' && value.length === 16) {
          const midPart = value.substring(4, 12);
          const lastPart = parseInt(value.substring(12, 16));
          if (!isNaN(lastPart)) {
            const nextLastPart = (lastPart + i).toString().slice(-4).padStart(4, '0');
            // User requested first 4 digits to be empty/variable
            updated[i].sayadiNumber = `    ${midPart}${nextLastPart}`;
          }
        }
      }
    }
    
    setCheques(updated);
  };

  const handleConfirm = () => {
    if (!isCalculatorActive) {
      alert("این ماشین‌حساب فعال نمی‌باشد.");
      return;
    }

    if (resolvedConfig.maxCreditLimit && resolvedConfig.maxCreditLimit > 0 && numericAmount > resolvedConfig.maxCreditLimit) {
      alert(`مبلغ درخواستی (${numericAmount.toLocaleString()} ریال) از سقف اعتبار مجاز این ماشین‌حساب (${resolvedConfig.maxCreditLimit.toLocaleString()} ریال) بیشتر است.`);
      return;
    }

    if (installmentCount < minInstallmentCount || installmentCount > maxInstallmentCount) {
      alert(`تعداد اقساط باید بین ${minInstallmentCount} تا ${maxInstallmentCount} ماه باشد.`);
      return;
    }

    if (!isDivisible || installmentCount <= 0) {
      alert("مدت بازپرداخت باید مضربی از فاصله اقساط باشد.");
      return;
    }

    if (calcType === 'beta') {
      const _agentCommissionAmount = finalTotal - baseTotal;
      const _agentCommissionRate = representativeCommission;
      onConfirm([], totalCommissionAmount, _agentCommissionAmount, _agentCommissionRate, installmentCount, perInstallmentAmount, finalTotal);
      return;
    }

    // Validate
    const invalid = cheques.some(c => !c.checkNumber || !c.bankName || c.amount <= 0);
    if (invalid) {
      alert("لطفاً اطلاعات تمامی چک‌ها (شماره چک، نام بانک و مبلغ) را به طور کامل وارد کنید.");
      return;
    }

    const formattedCheques: Omit<Check, 'id' | 'currentState' | 'history' | 'createdAt'>[] = cheques.map(c => ({
      type: 'received',
      checkNumber: c.checkNumber,
      sayadiNumber: c.sayadiNumber || undefined,
      bankName: c.bankName,
      dueDate: c.dueDate,
      amount: c.amount,
      personId: personId,
      nationalId: c.nationalId || undefined,
      isApproved: true
    }));

    const _agentCommissionAmount = calcResult.representativeCommissionAmount;
    const _agentCommissionRate = representativeCommission;

    onConfirm(formattedCheques, totalCommissionAmount, _agentCommissionAmount, _agentCommissionRate, installmentCount, perInstallmentAmount, finalTotal);
  };

  const mainContent = (
    <div className={isInline ? "bg-zinc-50/50 p-3 sm:p-5 rounded-3xl border border-zinc-150 space-y-6 w-full animate-in zoom-in-95 duration-200" : "bg-white w-full max-w-2xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-zinc-200 animate-in zoom-in-95 duration-200"}>
      {/* Header */}
      {!isInline && (
        <div className="p-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
          <button type="button" onClick={onCancel} className="text-zinc-400 hover:text-zinc-600 p-1">
            <X size={20} />
          </button>
          <div className="text-right">
            <h3 className="font-sans text-sm font-bold text-zinc-800 flex items-center justify-end gap-2">
              {calculator ? calculator.name : 'ماشین حساب محاسبه اقساط'}
              <Calculator size={18} className="text-emerald-600" />
            </h3>
            <p className="text-[10px] text-zinc-400 font-sans mt-0.5">
              {calculator ? calculator.description : 'محاسبه اقساط و چک‌های دریافتی'}
            </p>
          </div>
        </div>
      )}

      <div className={isInline ? "space-y-6" : "p-4 overflow-y-auto flex-1 space-y-6"}>
          {resolvedConfig.source === 'agent_override' && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-center justify-between text-xs text-amber-900 font-bold shadow-sm animate-in fade-in">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-amber-600 animate-pulse shrink-0" />
                <span>تنظیمات و نرخ‌های اختصاصی این نماینده روی محاسبات اعمال شده است.</span>
              </div>
              <span className="text-[10px] bg-amber-200/80 text-amber-800 px-2 py-0.5 rounded-md font-mono">
                {calcType === 'beta' 
                  ? `پایه: ${resolvedConfig.sadiBazaarBaseRate}٪ | بانک: ${resolvedConfig.betaBankFeeRate}٪`
                  : calcType === 'pelkani'
                  ? `پله ۱: ${resolvedConfig.pelkaniTier1BaseRate}٪ | پله ۲: ${resolvedConfig.pelkaniTier2BaseRate}٪ | پله ۳: ${resolvedConfig.pelkaniTier3BaseRate}٪`
                  : `پایه: ${resolvedConfig.sadiBazaarBaseRate}٪`}
              </span>
            </div>
          )}

          {/* Inputs Section */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-4">
              <PersonSelector
                persons={persons}
                selectedPersonId={personId}
                onSelect={setPersonId}
                label="صادرکننده چک"
              />
            </div>

            <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-100 space-y-2">
              <label className="block text-[10px] text-zinc-500 text-right">مبلغ اصل (ریال)</label>
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                className="w-full font-mono text-sm font-bold text-zinc-800 text-center bg-transparent border-none focus:ring-0"
                value={amount !== '' ? Number(amount).toLocaleString() : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setAmount(val === '' ? '' : parseNumericValue(val));
                }}
              />
            </div>

            <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-100 space-y-2">
              <label className="block text-[10px] text-zinc-500 text-right font-bold">مدت بازپرداخت (ماه)</label>
              <div className="flex gap-1">
                <select
                  value={installmentCount <= dropdownUpperLimit && installmentCount >= minInstallmentCount ? installmentCount : ""}
                  onChange={(e) => e.target.value && setInstallmentCount(parseInt(e.target.value))}
                  className="w-1/2 bg-white border border-zinc-200 rounded-xl px-1 py-1 font-sans text-[10px] text-zinc-800 focus:outline-none focus:border-emerald-500 font-bold"
                >
                  {dropdownOptions.map(num => (
                    <option key={num} value={num}>{num} ماه</option>
                  ))}
                  <option value="">سایر...</option>
                </select>
                <input
                  type="text"
                  inputMode="numeric"
                  value={installmentCount || ''}
                  onChange={(e) => {
                    const val = toEnglishDigits(e.target.value);
                    if (val === '') setInstallmentCount(0);
                    else {
                      const num = parseInt(val);
                      if (!isNaN(num)) {
                        setInstallmentCount(Math.min(maxInstallmentCount, num));
                      }
                    }
                  }}
                  placeholder="ماه"
                  className="w-1/2 bg-white border border-zinc-200 rounded-xl px-2 py-1 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500 font-bold"
                />
              </div>
            </div>

            <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-100 space-y-2">
              <label className="block text-[10px] text-zinc-500 text-right font-bold">فاصله اقساط</label>
              <div className="flex bg-white rounded-xl border border-zinc-200 p-0.5">
                <button
                  type="button"
                  onClick={() => setIntervalMonths(1)}
                  className={`flex-1 py-1 text-[10px] font-sans rounded-lg transition-all ${intervalMonths === 1 ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50'}`}
                >
                  ماهانه
                </button>
                <button
                  type="button"
                  onClick={() => setIntervalMonths(2)}
                  className={`flex-1 py-1 text-[10px] font-sans rounded-lg transition-all ${intervalMonths === 2 ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50'}`}
                >
                  دو‌ماهه
                </button>
              </div>
              {intervalMonths > 2 && (
                <div className="text-center font-mono text-[10px] text-emerald-600 font-bold">{intervalMonths} ماهه</div>
              )}
            </div>

            <div className="bg-emerald-50/50 p-3 rounded-2xl border border-emerald-100 space-y-1.5 text-center flex flex-col justify-center">
              <span className="block text-[10px] text-emerald-700 text-right font-bold">
                {calcType === 'pelkani' ? 'نرخ کارمزد اقساط' : calcType === 'beta' ? 'کارمزد پایه اقساط' : 'نرخ پایه (صدی)'}
              </span>
              <div className="font-mono text-sm font-bold text-emerald-800">
                ٪ {calcResult.installmentFeePercent.toLocaleString()}
              </div>
              <div className="text-[9px] font-mono text-emerald-600 font-bold">
                (پایه {calcResult.baseRatePercent}٪ + گام {calcResult.stepPercent}٪)
              </div>
            </div>

            {calcType === 'beta' && (
              <div className="bg-indigo-50/60 p-3 rounded-2xl border border-indigo-100 space-y-1 text-center flex flex-col justify-center">
                <span className="block text-[10px] text-indigo-800 text-right font-bold flex items-center gap-1">
                  <Building2 size={12} className="text-indigo-600" />
                  حق کارمزد بانک
                </span>
                <div className="font-mono text-sm font-bold text-indigo-900">
                  ٪ {calcResult.bankFeePercent}
                </div>
                <div className="text-[9px] font-mono font-bold text-indigo-700">
                  +{(calcResult.bankFeeAmount).toLocaleString()} ریال
                </div>
              </div>
            )}

            <div className="bg-amber-50/60 p-3 rounded-2xl border border-amber-100 space-y-1.5">
              <label className="block text-[10px] text-amber-800 text-right font-bold">کمیسیون نماینده (سقف مجاز: {maxCommission}٪)</label>
              <select
                value={representativeCommission}
                onChange={(e) => setRepresentativeCommission(Number(e.target.value))}
                className="w-full bg-white border border-amber-200 rounded-xl px-2 py-1 font-sans text-xs font-bold text-amber-900 text-center focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all cursor-pointer"
              >
                {commissionOptions.map(rate => (
                  <option key={rate} value={rate}>{rate}٪ کمیسیون</option>
                ))}
              </select>
              <div className="text-[9px] font-mono font-bold text-amber-700 text-center">
                {representativeCommission > 0 
                  ? `+${calcResult.representativeCommissionAmount.toLocaleString()} ریال سهم نماینده (سند مجزا)`
                  : 'بدون کمیسیون (۰٪)'}
              </div>
            </div>
          </div>

          {/* Active Status Warning */}
          {!isCalculatorActive && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3.5 rounded-2xl text-xs font-bold text-center flex items-center justify-center gap-2">
              <AlertCircle size={16} className="shrink-0 text-rose-600" />
              این ماشین‌حساب توسط مدیریت یا در تنظیمات نماینده غیرفعال شده است.
            </div>
          )}

          {/* Credit Limit Exceeded Warning */}
          {resolvedConfig.maxCreditLimit && resolvedConfig.maxCreditLimit > 0 && numericAmount > resolvedConfig.maxCreditLimit && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0 text-rose-600" />
              <span>
                مبلغ درخواستی ({numericAmount.toLocaleString()} ریال) از سقف اعتبار مجاز این ماشین‌حساب ({resolvedConfig.maxCreditLimit.toLocaleString()} ریال) بیشتر است.
              </span>
            </div>
          )}

          {/* Installment Bounds Warning */}
          {(installmentCount < minInstallmentCount || installmentCount > maxInstallmentCount) && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0 text-amber-600" />
              <span>
                تعداد اقساط مجاز برای این ماشین‌حساب بین {minInstallmentCount} تا {maxInstallmentCount} ماه است.
              </span>
            </div>
          )}

          {/* Source Indicator Badge */}
          {resolvedConfig.source === 'agent_override' && (
            <div className="bg-indigo-50/80 border border-indigo-100 text-indigo-900 p-3 rounded-2xl text-xs font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-indigo-600" />
                <span>تنظیمات و نرخ‌های اختصاصی نماینده فعال است.</span>
              </div>
              {resolvedConfig.maxCreditLimit && (
                <span className="bg-indigo-100 px-2.5 py-0.5 rounded-lg font-mono text-[11px] text-indigo-800">
                  سقف: {resolvedConfig.maxCreditLimit.toLocaleString()} ریال
                </span>
              )}
            </div>
          )}

          {!isDivisible && (
            <div className="bg-rose-50 border border-rose-150 text-rose-700 p-4 rounded-2xl text-xs font-bold text-center flex items-center justify-center gap-2">
              <AlertCircle size={16} className="shrink-0 text-rose-600" />
              مدت بازپرداخت باید مضربی از فاصله اقساط باشد.
            </div>
          )}

          {/* Totals Banner */}
          <div className="bg-emerald-600 p-4 sm:p-5 rounded-2xl text-white flex flex-col gap-3 shadow-lg shadow-emerald-600/20">
            <div className="flex justify-between items-center">
              <div className="text-left">
                <span className="text-[10px] opacity-80 block font-sans">نرخ نهایی معامله</span>
                <span className="font-mono text-lg sm:text-xl font-bold">٪ {totalRate.toFixed(1)}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] opacity-80 block font-sans">مبلغ کل نهایی</span>
                <span className="font-mono text-lg sm:text-xl font-bold">{finalTotal.toLocaleString()} <small className="text-[10px]">ریال</small></span>
              </div>
            </div>
            
            <div className="h-px bg-white/20 w-full" />
            
            <div className="flex justify-between items-center">
              <div className="text-left">
                <span className="text-[10px] opacity-80 block font-sans">سود کل (کارمزد)</span>
                <span className="font-mono text-base font-bold">{totalCommissionAmount.toLocaleString()}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] opacity-80 block font-sans">
                  {calcType === 'beta' ? 'مبلغ هر قسط' : 'مبلغ هر چک'}
                </span>
                <span className="font-mono text-base sm:text-lg font-bold text-yellow-300">{perInstallmentAmount.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {calcType === 'beta' ? (
            <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 p-5 rounded-2xl text-sm font-bold text-center flex flex-col items-center justify-center gap-3">
              <Sparkles size={32} className="text-indigo-600 mb-2" />
              <p>طبق قوانین سیستم، دریافت چک برای ماشین حساب بتا غیرفعال است.</p>
              <p className="text-xs text-indigo-600 font-normal mt-1">تسویه این محاسبه مستقیماً و به صورت خودکار به صدور دفترچه اقساط متصل خواهد شد.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <h4 className="font-sans text-xs sm:text-sm font-bold text-zinc-800 text-right pr-1 flex items-center justify-end gap-2">
                ورود اطلاعات و دریافت چک‌های اقساط
                <Landmark size={16} className="text-emerald-600" />
              </h4>
              
              <div className="space-y-4">
                <datalist id="banks-list">
                  {IRANIAN_BANKS.map(bank => (
                    <option key={bank} value={bank} />
                  ))}
                </datalist>
                {cheques.map((cheque, index) => (
                  <div key={index} className="bg-white p-4 sm:p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-4 relative w-full">
                    <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 bg-emerald-600 text-white text-xs font-black rounded-lg flex items-center justify-center font-mono">
                          {index + 1}
                        </span>
                        <span className="text-xs font-black text-zinc-800">چک شماره {index + 1}</span>
                      </div>
                      <span className="text-[11px] font-black text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100/80 font-mono">
                        مبلغ: {(cheque.amount ?? 0).toLocaleString()} ریال
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-600 text-right mb-1">نام بانک صادرکننده</label>
                        <input
                          type="text"
                          dir="rtl"
                          list="banks-list"
                          value={cheque.bankName}
                          onChange={(e) => handleChequeChange(index, 'bankName', e.target.value)}
                          placeholder="مانند: ملی"
                          className="w-full bg-zinc-50/80 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold"
                        />
                        <div className="flex gap-1 overflow-x-auto mt-1.5 pb-1 no-scrollbar" dir="rtl">
                          {suggestedBanks.map(bank => (
                            <button
                              key={bank}
                              type="button"
                              onClick={() => handleChequeChange(index, 'bankName', bank)}
                              className={`flex-shrink-0 px-2 py-0.5 rounded-md border text-[9px] font-sans transition-all ${cheque.bankName === bank ? 'bg-emerald-600 text-white border-emerald-600 font-bold' : 'bg-white text-zinc-500 border-zinc-200 hover:border-emerald-300'}`}
                            >
                              {bank}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-zinc-600 text-right mb-1">شماره برگه چک</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          dir="ltr"
                          placeholder="شماره برگه چک..."
                          value={cheque.checkNumber}
                          onChange={(e) => handleChequeChange(index, 'checkNumber', toEnglishDigits(e.target.value))}
                          className="w-full bg-zinc-50/80 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs font-bold text-zinc-800 text-center focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-zinc-600 text-right mb-1">تاریخ سررسید (شمسی)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          dir="ltr"
                          placeholder="مثال: ۱۴۰۳/۰۵/۱۵"
                          value={cheque.dueDate}
                          onChange={(e) => handleChequeChange(index, 'dueDate', toEnglishDigits(e.target.value))}
                          className="w-full bg-zinc-50/80 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs font-bold text-zinc-800 text-center focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-zinc-600 text-right mb-1">مبلغ چک (ریال)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          dir="ltr"
                          value={(cheque.amount ?? 0).toLocaleString()}
                          onChange={(e) => handleChequeChange(index, 'amount', parseNumericValue(e.target.value))}
                          className="w-full bg-zinc-50/80 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs font-bold text-emerald-700 text-center focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Full Width Sayadi Number Field */}
                    <div className="space-y-1.5 bg-emerald-50/50 p-3.5 rounded-2xl border border-emerald-100">
                      <div className="flex items-center justify-between">
                        <label className="block text-[11px] font-bold text-emerald-950 text-right">
                          شناسه ۱۶ رقمی صیادی (بنفش)
                        </label>
                        <span className="text-[10px] text-emerald-700 font-mono font-bold">
                          {cheque.sayadiNumber ? `${toEnglishDigits(cheque.sayadiNumber).replace(/\D/g, '').length} / ۱۶ رقم` : 'اختیاری'}
                        </span>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        dir="ltr"
                        maxLength={16}
                        placeholder="مثال: ۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶"
                        value={cheque.sayadiNumber}
                        onChange={(e) => handleChequeChange(index, 'sayadiNumber', toEnglishDigits(e.target.value))}
                        className="w-full bg-white border border-emerald-200 rounded-xl px-4 py-2.5 font-mono text-sm tracking-widest text-zinc-900 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold shadow-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-zinc-600 text-right mb-1">کد ملی صادرکننده</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        dir="ltr"
                        placeholder="کد ملی ۱۰ رقمی..."
                        value={cheque.nationalId}
                        onChange={(e) => handleChequeChange(index, 'nationalId', toEnglishDigits(e.target.value))}
                        className="w-full bg-zinc-50/80 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs font-bold text-zinc-800 text-center focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex gap-3 rounded-b-3xl mt-4">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={
              !isCalculatorActive ||
              !isDivisible ||
              installmentCount < minInstallmentCount ||
              installmentCount > maxInstallmentCount ||
              (resolvedConfig.maxCreditLimit ? numericAmount > resolvedConfig.maxCreditLimit : false)
            }
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed disabled:shadow-none text-white font-sans text-xs font-bold py-3 rounded-xl shadow-lg shadow-emerald-600/20 transition flex items-center justify-center gap-2"
          >
            <CheckCircle size={16} />
            تأیید محاسبات و انتقال به پرونده
          </button>
          {!isInline && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-sans text-xs font-bold py-3 rounded-xl transition"
            >
              انصراف
            </button>
          )}
        </div>

        <datalist id="banks-list">
          {suggestedBanks.map(b => <option key={b} value={b} />)}
        </datalist>
      </div>
  );

  if (isInline) {
    return mainContent;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      {mainContent}
    </div>
  );
}
