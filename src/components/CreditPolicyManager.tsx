import React, { useState } from 'react';
import { CreditPolicy } from '../types';
import { ShieldCheck, Plus, Edit2, Trash2, CheckCircle2, XCircle, Sliders, AlertCircle, FileText, Lock } from 'lucide-react';

interface CreditPolicyManagerProps {
  policies: CreditPolicy[];
  onUpdatePolicies: (policies: CreditPolicy[]) => void;
}

export const CreditPolicyManager: React.FC<CreditPolicyManagerProps> = ({ policies, onUpdatePolicies }) => {
  const [editingPolicy, setEditingPolicy] = useState<Partial<CreditPolicy> | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenAdd = () => {
    setEditingPolicy({
      id: 'pol_' + Date.now(),
      title: '',
      minAmount: 0,
      maxAmount: 50000000,
      needsValidation: true,
      needsBackSignature: false,
      needsCollateral: false,
      needsGuarantorInfo: false,
      needsGuarantorValidation: false,
      needsAmaniCheck: false,
      amaniReminderDays: 10,
      isActive: true,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (policy: CreditPolicy) => {
    setEditingPolicy({ ...policy });
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!editingPolicy || !editingPolicy.title) {
      alert('لطفاً عنوان سیاست اعتباری را وارد کنید.');
      return;
    }

    const exists = policies.some(p => p.id === editingPolicy.id);
    let updated: CreditPolicy[];
    if (exists) {
      updated = policies.map(p => p.id === editingPolicy.id ? (editingPolicy as CreditPolicy) : p);
    } else {
      updated = [...policies, editingPolicy as CreditPolicy];
    }

    onUpdatePolicies(updated);
    setIsModalOpen(false);
    setEditingPolicy(null);
  };

  const handleDelete = (id: string) => {
    if (confirm('آیا از حذف این سیاست اعتباری اطمینان دارید؟')) {
      onUpdatePolicies(policies.filter(p => p.id !== id));
    }
  };

  const handleToggleActive = (id: string) => {
    onUpdatePolicies(
      policies.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p)
    );
  };

  return (
    <div className="space-y-6 font-sans dir-rtl text-right">
      <div className="flex justify-between items-center bg-white p-6 rounded-3xl shadow-xs border border-zinc-200">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-inner">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h2 className="text-lg font-black text-zinc-800">موتور سیاست‌های اعتباری و ضمانت (Credit Policy Engine)</h2>
            <p className="text-xs text-zinc-500 mt-0.5">مدیریت مرکزی سقف‌های اعتباری، نیازمندی‌های ضامن، اعتبارسنجی و چک‌های امانی بدون دخالت در محاسبات مالی</p>
          </div>
        </div>
        <button
          onClick={handleOpenAdd}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-2xl text-xs font-bold shadow-md transition-all flex items-center gap-2 cursor-pointer"
        >
          <Plus size={16} />
          تعریف سیاست اعتباری جدید
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {policies.map(policy => (
          <div
            key={policy.id}
            className={`bg-white rounded-3xl p-6 shadow-xs border transition-all relative overflow-hidden flex flex-col justify-between ${
              policy.isActive ? 'border-zinc-200 hover:border-emerald-300' : 'border-zinc-200 opacity-60 bg-zinc-50/50'
            }`}
          >
            <div className="space-y-4">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-600">
                    شناسه: {policy.id}
                  </span>
                  <h3 className="text-base font-bold text-zinc-800 mt-2">{policy.title}</h3>
                </div>
                <button
                  onClick={() => handleToggleActive(policy.id)}
                  className={`px-3 py-1 rounded-xl text-[11px] font-bold cursor-pointer transition-colors ${
                    policy.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-200 text-zinc-600'
                  }`}
                >
                  {policy.isActive ? 'فعال' : 'غیرفعال'}
                </button>
              </div>

              <div className="bg-zinc-50 p-3.5 rounded-2xl border border-zinc-100 space-y-1.5 text-xs">
                <div className="flex justify-between text-zinc-600">
                  <span>بازه مبلغ اعتباری:</span>
                  <span className="font-bold text-zinc-800 dir-ltr">
                    {policy.minAmount.toLocaleString()} الی {policy.maxAmount.toLocaleString()} تومان
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-1 text-xs text-zinc-600">
                <div className="flex items-center justify-between py-1 border-b border-zinc-100">
                  <span>نیاز به اعتبارسنجی بانکی:</span>
                  <span className={policy.needsValidation ? 'text-emerald-600 font-bold' : 'text-zinc-400'}>
                    {policy.needsValidation ? 'الزامی' : 'خیر'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-100">
                  <span>ضامن پشت‌امضا:</span>
                  <span className={policy.needsBackSignature ? 'text-emerald-600 font-bold' : 'text-zinc-400'}>
                    {policy.needsBackSignature ? 'الزامی' : 'خیر'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-100">
                  <span>چک ضمانت / وثیقه:</span>
                  <span className={policy.needsCollateral ? 'text-emerald-600 font-bold' : 'text-zinc-400'}>
                    {policy.needsCollateral ? 'الزامی' : 'خیر'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-100">
                  <span>ثبت اطلاعات ضامن:</span>
                  <span className={policy.needsGuarantorInfo ? 'text-emerald-600 font-bold' : 'text-zinc-400'}>
                    {policy.needsGuarantorInfo ? 'الزامی' : 'خیر'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-zinc-100">
                  <span>اعتبارسنجی ضامن:</span>
                  <span className={policy.needsGuarantorValidation ? 'text-emerald-600 font-bold' : 'text-zinc-400'}>
                    {policy.needsGuarantorValidation ? 'الزامی' : 'خیر'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span>چک امانی (بدون اثر مالی):</span>
                  <span className={policy.needsAmaniCheck ? 'text-emerald-600 font-bold' : 'text-zinc-400'}>
                    {policy.needsAmaniCheck ? `الزامی (${policy.amaniReminderDays} روز هشدار)` : 'خیر'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-4 mt-4 border-t border-zinc-100">
              <button
                onClick={() => handleOpenEdit(policy)}
                className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Edit2 size={14} />
                ویرایش سیاست
              </button>
              <button
                onClick={() => handleDelete(policy.id)}
                className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl transition-all cursor-pointer"
                title="حذف سیاست"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && editingPolicy && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden space-y-5 p-6 text-right font-sans dir-rtl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <Sliders size={20} className="text-emerald-600" />
                <h3 className="font-bold text-zinc-800 text-sm">
                  {editingPolicy.id ? 'تنظیمات سیاست اعتباری' : 'تعریف سیاست اعتباری جدید'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-zinc-600 rounded-full cursor-pointer"
              >
                <XCircle size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-700 font-medium mb-1">عنوان سیاست اعتباری</label>
                <input
                  type="text"
                  value={editingPolicy.title || ''}
                  onChange={(e) => setEditingPolicy({ ...editingPolicy, title: e.target.value })}
                  placeholder="مثال: اعتبار خرد بدون ضامن"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:border-emerald-500 font-sans text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-700 font-medium mb-1">حداقل مبلغ (تومان)</label>
                  <input
                    type="number"
                    value={editingPolicy.minAmount ?? 0}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, minAmount: Number(e.target.value) })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:border-emerald-500 font-sans text-xs dir-ltr text-right"
                  />
                </div>
                <div>
                  <label className="block text-zinc-700 font-medium mb-1">حداکثر مبلغ (تومان)</label>
                  <input
                    type="number"
                    value={editingPolicy.maxAmount ?? 0}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, maxAmount: Number(e.target.value) })}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:border-emerald-500 font-sans text-xs dir-ltr text-right"
                  />
                </div>
              </div>

              <div className="space-y-3 bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                <span className="font-bold text-zinc-700 block text-xs mb-2">شرایط و نیازمندی‌های پرونده اعتباری:</span>
                
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPolicy.needsValidation ?? false}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, needsValidation: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-zinc-700">نیاز به اعتبارسنجی بانکی مشتری</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPolicy.needsBackSignature ?? false}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, needsBackSignature: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-zinc-700">نیاز به ضامن پشت‌امضا</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPolicy.needsCollateral ?? false}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, needsCollateral: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-zinc-700">نیاز به چک ضمانت / وثیقه</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPolicy.needsGuarantorInfo ?? false}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, needsGuarantorInfo: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-zinc-700">نیاز به ثبت کامل مشخصات ضامن</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPolicy.needsGuarantorValidation ?? false}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, needsGuarantorValidation: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-zinc-700">نیاز به اعتبارسنجی ضامن</span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPolicy.needsAmaniCheck ?? false}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, needsAmaniCheck: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-zinc-700">نیاز به دریافت چک امانی (بدون اثر مالی در دفاتر)</span>
                </label>

                {editingPolicy.needsAmaniCheck && (
                  <div className="pt-2 pr-6">
                    <label className="block text-zinc-600 text-[11px] mb-1">تعداد روز هشدار قبل از سررسید چک امانی:</label>
                    <input
                      type="number"
                      value={editingPolicy.amaniReminderDays ?? 10}
                      onChange={(e) => setEditingPolicy({ ...editingPolicy, amaniReminderDays: Number(e.target.value) })}
                      className="w-32 bg-white border border-zinc-200 rounded-xl px-3 py-1.5 text-zinc-800 focus:outline-none focus:border-emerald-500 text-xs dir-ltr text-right"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <input
                  type="checkbox"
                  id="isActivePolicy"
                  checked={editingPolicy.isActive ?? true}
                  onChange={(e) => setEditingPolicy({ ...editingPolicy, isActive: e.target.checked })}
                  className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="isActivePolicy" className="text-zinc-700 font-medium cursor-pointer">
                  سیاست اعتباری فعال باشد
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-100">
              <button
                onClick={() => setIsModalOpen(false)}
                className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 px-4 py-2 rounded-xl text-xs font-medium cursor-pointer"
              >
                انصراف
              </button>
              <button
                onClick={handleSave}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-xl text-xs font-bold cursor-pointer shadow-md"
              >
                ذخیره سیاست اعتباری
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
