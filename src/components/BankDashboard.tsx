/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Landmark, FileCheck, AlertTriangle, ArrowRight } from 'lucide-react';
import { AppState, Check, ReceivedCheckState, BouncedReceivedCheckSubState } from '../types';
import { useCoaReadModel } from '../services/CoaReadService';

interface BankDashboardProps {
  state: AppState;
  onUpdateCheckState: (
    checkId: string,
    newState: ReceivedCheckState,
    newSubState?: BouncedReceivedCheckSubState,
    note?: string,
    bankId?: string
  ) => void;
}

export default function BankDashboard({ state, onUpdateCheckState }: BankDashboardProps) {
  const { subsidiaries: activeSubsidiaries } = useCoaReadModel(state.subsidiaries);
  const bankSubsidiaries = activeSubsidiaries.filter(s => s.generalType === 'بانک‌ها');
  const [selectedBankId, setSelectedBankId] = useState<string>(bankSubsidiaries[0]?.id || '');
  const [bounceReason, setBounceReason] = useState<BouncedReceivedCheckSubState>('returned_to_customer');

  const bankChecks = state.checks.filter(
    c => c.type === 'received' && 
         c.currentState === 'deposited_to_bank' &&
         c.depositedBankId === selectedBankId
  );

  return (
    <div className="space-y-4 text-right">
      <div className="flex gap-2">
        {bankSubsidiaries.map(bank => (
          <button
            key={bank.id}
            onClick={() => setSelectedBankId(bank.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-150 ${
              selectedBankId === bank.id ? 'bg-amber-600 text-white shadow' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            {bank.name}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-zinc-150 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-zinc-100 border-b text-zinc-600">
                <th className="p-3 font-semibold">شماره چک</th>
                <th className="p-3 font-semibold">مبلغ (ریال)</th>
                <th className="p-3 font-semibold">تاریخ سررسید</th>
                <th className="p-3 font-semibold min-w-[200px]">ثبت وضعیت / تعیین اقدام</th>
              </tr>
            </thead>
            <tbody>
              {bankChecks.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-zinc-400 font-sans">
                    هیچ چک دریافتی در جریان وصولی در این بانک یافت نشد.
                  </td>
                </tr>
              ) : (
                bankChecks.map(check => (
                  <tr key={check.id} className="border-b hover:bg-zinc-50 transition-colors">
                    <td className="p-3 font-mono font-medium text-zinc-800">{check.checkNumber}</td>
                    <td className="p-3 font-mono font-semibold text-zinc-900">{(check.amount ?? 0).toLocaleString()}</td>
                    <td className="p-3 font-mono text-zinc-600">{check.dueDate}</td>
                    <td className="p-3">
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) return;
                          
                          if (val === 'cleared') {
                            onUpdateCheckState(
                              check.id, 
                              'cleared', 
                              undefined, 
                              `وصول چک ${check.checkNumber} - واریز به حساب ${bankSubsidiaries.find(b => b.id === selectedBankId)?.name || 'بانک'}`, 
                              selectedBankId
                            );
                          } else if (val.startsWith('bounced_')) {
                            const subState = val.replace('bounced_', '') as BouncedReceivedCheckSubState;
                            let iranSubStateName = 'برگشت خورده';
                            if (subState === 'returned_to_customer') iranSubStateName = 'تحویل به مشتری';
                            else if (subState === 'in_legal_process') iranSubStateName = 'پیگیری قانونی';
                            else if (subState === 'cleared_after_bounce') iranSubStateName = 'وصول شده پس از برگشت';
                            
                            onUpdateCheckState(
                              check.id, 
                              'bounced', 
                              subState, 
                              `برگشت چک ${check.checkNumber} از بانک (${iranSubStateName})`, 
                              selectedBankId
                            );
                          }
                          
                          // reset back to default
                          e.target.value = "";
                        }}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2 font-sans text-xs font-semibold text-zinc-700 outline-none focus:ring-2 focus:ring-amber-500 transition cursor-pointer"
                      >
                        <option value="">-- انتخاب اقدام نهایی برای چک --</option>
                        <option value="cleared">✓ وصول چک (واریز موفق به حساب بانک)</option>
                        <option value="bounced_returned_to_customer" className="text-rose-600 font-medium">✗ برگشت - عودت فیزیکی چک به مشتری</option>
                        <option value="bounced_in_legal_process" className="text-rose-600 font-medium">✗ برگشت - ارجاع به پیگیری قانونی</option>
                        <option value="bounced_cleared_after_bounce" className="text-rose-600 font-medium">✗ برگشت - وصول پس از برگشت</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
