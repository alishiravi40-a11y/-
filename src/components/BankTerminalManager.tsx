import React, { useState } from 'react';
import { AppState, BankTerminal, JournalVoucher } from '../types';
import { Plus, X, Server, Clock, CreditCard, Trash2, CheckCircle, Edit2 } from 'lucide-react';
import { getCurrentJalaliDate } from '../utils/jalali';
import { useCoaReadModel } from '../services/CoaReadService';

interface BankTerminalManagerProps {
  state: AppState;
  onUpdateTerminals: (terminals: BankTerminal[]) => void;
  onAddSubsidiary: (sub: any) => void;
  onAddManualVoucher: (voucherData: Omit<JournalVoucher, 'id' | 'voucherNumber' | 'gregorianDate' | 'isAutomatic'>) => void;
}

export default function BankTerminalManager({ state, onUpdateTerminals, onAddSubsidiary, onAddManualVoucher }: BankTerminalManagerProps) {
  const { subsidiaries: activeSubsidiaries } = useCoaReadModel(state.subsidiaries);
  const [isAdding, setIsAdding] = useState(false);
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [intermediateAccountId, setIntermediateAccountId] = useState('');
  const [delayDays, setDelayDays] = useState(1);
  const [transferTime, setTransferTime] = useState('10:00');
  
  const bankSubsidiaries = activeSubsidiaries.filter(s => s.generalType === 'بانک‌ها');
  const transitSubsidiaries = activeSubsidiaries.filter(s => s.generalType === 'اسناد در جریان وصول');

  const openForm = (terminal?: BankTerminal) => {
    if (terminal) {
      setEditingTerminalId(terminal.id);
      setName(terminal.name);
      setBankAccountId(terminal.bankAccountId);
      setIntermediateAccountId(terminal.intermediateAccountId);
      setDelayDays(terminal.delayDays);
      setTransferTime(terminal.transferTime);
      setIsAdding(true);
    } else {
      setEditingTerminalId(null);
      setName('');
      setBankAccountId('');
      setIntermediateAccountId('');
      setDelayDays(1);
      setTransferTime('10:00');
      setIsAdding(true);
    }
  };

  const handleSave = () => {
    if (!name.trim() || !bankAccountId) return;

    if (editingTerminalId) {
      // Update existing
      const updatedTerminals = (state.bankTerminals || []).map(t => 
        t.id === editingTerminalId ? { ...t, name, bankAccountId, intermediateAccountId, delayDays, transferTime } : t
      );
      onUpdateTerminals(updatedTerminals);
    } else {
      // Create new
      const terminalId = `pos_${Date.now()}`;
      const finalIntermediateAccountId = intermediateAccountId || `SUB_TRANSIT_${terminalId}`;
      
      if (!intermediateAccountId) {
        onAddSubsidiary({
          id: finalIntermediateAccountId,
          generalType: 'اسناد در جریان وصول',
          groupType: 'دارایی‌های جاری',
          name: `حساب واسط در جریان وصول - ${name}`,
          code: `1010${Math.floor(1000 + Math.random() * 9000)}` 
        });
      }

      const newTerminal: BankTerminal = {
        id: terminalId,
        name: name.trim(),
        bankAccountId,
        intermediateAccountId: finalIntermediateAccountId,
        delayDays,
        transferTime,
        isActive: true
      };

      onUpdateTerminals([...(state.bankTerminals || []), newTerminal]);
    }
    
    setIsAdding(false);
    setEditingTerminalId(null);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('آیا از حذف این پایانه فروشگاهی اطمینان دارید؟')) {
      const updated = (state.bankTerminals || []).filter(t => t.id !== id);
      onUpdateTerminals(updated);
    }
  };

  const handleAutoTransfer = () => {
    let transferCount = 0;
    
    // For each terminal, calculate the balance of its intermediate account
    terminals.forEach(terminal => {
      let balance = 0;
      
      // Calculate balance (debit - credit since it's an asset)
      state.vouchers.forEach(v => {
        v.entries.forEach(e => {
          if (e.subsidiaryId === terminal.intermediateAccountId) {
            balance += (e.debit - e.credit);
          }
        });
      });
      
      if (balance > 0) {
        // Create a manual voucher to transfer from intermediate to main bank
        onAddManualVoucher({
          date: getCurrentJalaliDate(),
          description: `انتقال خودکار وجه از حساب واسط پایانه ${terminal.name} به حساب بانکی متصل`,
          entries: [
            {
              subsidiaryId: terminal.bankAccountId,
              debit: balance,
              credit: 0,
              description: `واریز وجه از پایانه کارتخوان ${terminal.name}`
            },
            {
              subsidiaryId: terminal.intermediateAccountId,
              debit: 0,
              credit: balance,
              description: `انتقال موجودی در جریان وصول به حساب اصلی`
            }
          ]
        });
        transferCount++;
      }
    });
    
    if (transferCount > 0) {
      alert(`با موفقیت تعداد ${transferCount} تراکنش تسویه و انتقال انجام شد.`);
    } else {
      alert('موجودی قابل انتقالی در هیچ یک از حساب‌های واسط یافت نشد.');
    }
  };

  const terminals = state.bankTerminals || [];

  return (
    <div className="space-y-4 text-right">
      <div className="flex justify-between items-center bg-zinc-50 p-4 rounded-2xl border border-zinc-200">
        <div>
          <h2 className="text-sm font-bold text-zinc-800">مدیریت پایانه‌های فروشگاهی (POS)</h2>
          <p className="text-xs text-zinc-500 mt-1">
            تعریف دستگاه‌های کارتخوان، اتصال به حساب‌های بانکی و تنظیم زمانبندی انتقال خودکار موجودی از حساب واسط.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleAutoTransfer}
            className="flex items-center space-x-1.5 space-x-reverse bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-bold px-4 py-2 rounded-xl shadow transition"
          >
            <CheckCircle size={16} />
            <span>تسویه خودکار درگاه‌ها</span>
          </button>
          {!isAdding && (
            <button
              onClick={() => openForm()}
              className="flex items-center space-x-1.5 space-x-reverse bg-amber-600 hover:bg-amber-700 text-white font-sans text-xs font-bold px-4 py-2 rounded-xl shadow transition"
            >
              <Plus size={16} />
              <span>افزودن دستگاه POS</span>
            </button>
          )}
        </div>
      </div>

      {isAdding && (
        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
            <h3 className="text-xs font-bold text-zinc-800">{editingTerminalId ? 'ویرایش دستگاه کارتخوان' : 'افزودن دستگاه کارتخوان جدید'}</h3>
            <button onClick={() => setIsAdding(false)} className="text-zinc-400 hover:text-zinc-600">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-zinc-500 mb-1">نام دستگاه / محل قرارگیری</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: کارتخوان فروشگاه مرکزی - ملت"
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none text-right"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 mb-1">حساب بانکی متصل (مقصد نهایی)</label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none text-right"
              >
                <option value="">انتخاب حساب بانکی...</option>
                {bankSubsidiaries.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 mb-1">حساب واسط در جریان وصول</label>
              <select
                value={intermediateAccountId}
                onChange={(e) => setIntermediateAccountId(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none text-right"
              >
                <option value="">ایجاد خودکار حساب واسط جدید</option>
                {transitSubsidiaries.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 mb-1">تأخیر واریز (روز)</label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={delayDays}
                onChange={(e) => setDelayDays(parseInt(e.target.value) || 0)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none text-right font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 mb-1">ساعت دقیق انتقال</label>
              <input
                type="time"
                value={transferTime}
                onChange={(e) => setTransferTime(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:border-amber-500 focus:outline-none text-right font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              disabled={!name.trim() || !bankAccountId}
              className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold px-6 py-2 rounded-xl transition"
            >
              ذخیره تغییرات پایانه
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {terminals.map(terminal => {
          const bank = bankSubsidiaries.find(s => s.id === terminal.bankAccountId);
          return (
            <div key={terminal.id} className="bg-white rounded-2xl border border-zinc-200 p-4 shadow-sm relative group overflow-hidden">
              <div className="absolute top-0 right-0 w-1 h-full bg-amber-500"></div>
              <div className="absolute left-3 top-3 flex items-center space-x-2 space-x-reverse text-zinc-300 transition">
                <button onClick={() => openForm(terminal)} className="flex items-center space-x-1 space-x-reverse hover:text-amber-500 text-xs font-bold">
                  <Edit2 size={16} />
                  <span>ویرایش</span>
                </button>
                <button onClick={() => handleDelete(terminal.id)} className="hover:text-rose-500">
                  <Trash2 size={16} />
                </button>
              </div>
              
              <div className="flex items-start space-x-3 space-x-reverse mb-4">
                <div className="bg-emerald-50 text-emerald-600 p-2.5 rounded-xl">
                  <CreditCard size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-zinc-800 text-sm">{terminal.name}</h3>
                  <div className="flex items-center text-[10px] text-emerald-600 font-bold mt-0.5 space-x-1 space-x-reverse">
                    <CheckCircle size={10} />
                    <span>فعال</span>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center bg-zinc-50 p-2 rounded-lg">
                  <span className="text-zinc-500">حساب متصل:</span>
                  <span className="font-bold text-zinc-800">{bank?.name || 'نامشخص'}</span>
                </div>
                <div className="flex justify-between items-center bg-zinc-50 p-2 rounded-lg">
                  <span className="text-zinc-500 flex items-center space-x-1 space-x-reverse"><Server size={12} /><span>حساب واسط:</span></span>
                  <span className="text-amber-700 font-mono text-[10px] break-all">{terminal.intermediateAccountId.replace('SUB_TRANSIT_', '')}</span>
                </div>
                <div className="flex justify-between items-center bg-zinc-50 p-2 rounded-lg">
                  <span className="text-zinc-500 flex items-center space-x-1 space-x-reverse"><Clock size={12} /><span>زمانبندی انتقال:</span></span>
                  <span className="text-zinc-700 font-mono">پس از {terminal.delayDays} روز - ساعت {terminal.transferTime}</span>
                </div>
              </div>
            </div>
          );
        })}
        {terminals.length === 0 && !isAdding && (
          <div className="col-span-full py-12 text-center text-zinc-400 text-xs bg-white rounded-2xl border border-zinc-150 border-dashed">
            هیچ دستگاه کارتخوانی ثبت نشده است.
          </div>
        )}
      </div>
    </div>
  );
}
