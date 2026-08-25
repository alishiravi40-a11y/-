import React, { useState, useMemo } from 'react';
import { 
  Users, UserCheck, UserPlus, Search, Filter, ShieldCheck, 
  Trash2, Edit2, FileText, CheckCircle2, Building2, Phone, 
  MapPin, CreditCard, X, Info, Layers, DollarSign, Tag, ShieldAlert
} from 'lucide-react';
import { AppState, Person, AgencyType, PartnerRole } from '../types';
import { calculatePersonBalances } from '../utils/accounting';

interface CentralPersonDirectoryProps {
  appState: AppState;
  onSelectPersonForLedger: (person: Person) => void;
  onSelectPersonForCritical: (person: Person) => void;
  onEditPerson: (person: Person) => void;
  onDeletePerson: (personId: string) => void;
  onAddPerson: () => void;
  onCashTransaction: () => void;
}

export function CentralPersonDirectory({
  appState,
  onSelectPersonForLedger,
  onSelectPersonForCritical,
  onEditPerson,
  onDeletePerson,
  onAddPerson,
  onCashTransaction,
}: CentralPersonDirectoryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'normal' | 'debtor' | 'creditor' | 'sales_agent' | 'credit_agent' | 'multi_role'>('all');
  const [selectedAuditPerson, setSelectedAuditPerson] = useState<{ person: Person; reasons: string[] } | null>(null);

  // Financial balances calculations
  const personBalances = useMemo(() => {
    return calculatePersonBalances(appState.vouchers || []);
  }, [appState.vouchers]);

  const normalDebtorBalances = useMemo(() => {
    const ordinaryVouchers = (appState.vouchers || []).filter(v => (v as any).voucherType !== 'INSTALLMENT_ACCRUAL');
    return calculatePersonBalances(ordinaryVouchers);
  }, [appState.vouchers]);

  const installmentDebtorBalances = useMemo(() => {
    const instVouchers = (appState.vouchers || []).filter(v => (v as any).voucherType === 'INSTALLMENT_ACCRUAL');
    return calculatePersonBalances(instVouchers);
  }, [appState.vouchers]);

  // Dependency audit per person
  const getPersonDeletionAudit = (personId: string) => {
    const bp = appState.businessPartners?.find(b => b.personId === personId);
    const bpId = bp?.id;
    const reasons: string[] = [];

    if (appState.invoices?.some(inv => inv.personId === personId || (inv as any).customerId === personId)) {
      reasons.push('فاکتور خرید یا فروش ثبت‌شده در سیستم');
    }
    if (appState.checks?.some(c => c.personId === personId)) {
      reasons.push('برگه چک صیادی یا امانی متصل');
    }
    if (appState.installmentBooks?.some(b => b.personId === personId)) {
      reasons.push('دفترچه اقساط فعال در بخش اقساطی');
    }
    if ((appState.openingBalances as any[])?.some(ob => ob.personId === personId)) {
      reasons.push('سند مانده اول دوره (افتتاحیه)');
    }
    if (appState.vouchers?.some(v => v.entries?.some(ent => 
      (ent.floatingDetailed?.type === 'person' && ent.floatingDetailed.id === personId) ||
      (bpId && ent.floatingDetailed?.id === bpId)
    ))) {
      reasons.push('سند حسابداری صادر شده به نام شخص');
    }
    if (appState.creditFiles?.some(cf => cf.personId === personId || cf.representativeId === personId)) {
      reasons.push('پرونده اعتباری یا درخواست تسهیلات');
    }
    if ((appState.nesyehPurchaseOrders as any[])?.some(o => o.partnerId === personId || (bpId && o.partnerId === bpId))) {
      reasons.push('سفارش خرید نسیه در جریان یا ثبت‌شده');
    }
    if ((appState.nesyehPaymentDeclarations as any[])?.some(d => d.partnerId === personId || (bpId && d.partnerId === bpId))) {
      reasons.push('اعلام پرداخت نسیه ثبت‌شده');
    }

    return {
      isDeletable: reasons.length === 0,
      reasons
    };
  };

  // Map persons with calculated roles
  const personsWithRoles = useMemo(() => {
    const uniquePersons = (appState.persons || []).filter(
      (p, index, self) => index === self.findIndex(t => t.id === p.id)
    );

    return uniquePersons.map(person => {
      const bp = (appState.businessPartners || []).find(b => b.personId === person.id);

      // Check Sales Agent role
      // Check Sales Agent role
      const isSalesAgent = Boolean(
        (bp && (
          bp.agencyType === AgencyType.INSTALLMENT_ONLY ||
          bp.agencyType === AgencyType.BOTH ||
          (bp.agencyType as string) === 'INSTALLMENT_ONLY' ||
          (bp.agencyType as string) === 'BOTH' ||
          (bp.roles || []).includes('DEFERRED_AGENT' as any)
        )) ||
        (!bp && person.isAgent && (person.role === 'debtor' || person.role === 'both'))
      );

      // Check Credit Agent role
      const isCreditAgent = Boolean(
        (bp && (
          bp.agencyType === AgencyType.CREDIT_ONLY ||
          bp.agencyType === AgencyType.BOTH ||
          (bp.agencyType as string) === 'CREDIT_ONLY' ||
          (bp.agencyType as string) === 'BOTH' ||
          (bp.roles || []).includes('CREDIT_AGENT' as any) ||
          (bp.roles || []).includes(PartnerRole.CREDIT_SALES_AGENT) ||
          (bp.roles || []).includes('CREDIT_SALES_AGENT' as any)
        )) ||
        (!bp && person.isAgent && (person.role === 'creditor' || person.role === 'both'))
      );

      // Check Debtor role
      const normBal = normalDebtorBalances[person.id]?.net || 0;
      const instBal = installmentDebtorBalances[person.id]?.net || 0;
      const isDebtor = normBal > 0 || instBal > 0 || person.role === 'debtor';

      // Check Creditor role
      const credBal = personBalances[person.id]?.net || 0;
      const isCreditor = (personBalances[person.id]?.nature === 'بستانکار' && credBal > 0) || person.role === 'creditor';

      // Role tag list
      const roleBadges: { title: string; colorClass: string; type: string }[] = [];

      if (isSalesAgent && isCreditAgent) {
        roleBadges.push({ title: 'فروش | اعتباری', colorClass: 'bg-emerald-50 text-emerald-800 border-emerald-200', type: 'multi_role' });
      } else {
        if (isSalesAgent) {
          roleBadges.push({ title: 'فروش', colorClass: 'bg-purple-50 text-purple-800 border-purple-200', type: 'sales_agent' });
        }
        if (isCreditAgent) {
          roleBadges.push({ title: 'اعتباری', colorClass: 'bg-amber-50 text-amber-800 border-amber-200', type: 'credit_agent' });
        }
      }
      if (isDebtor) {
        roleBadges.push({ title: 'بدهکار', colorClass: 'bg-rose-50 text-rose-700 border-rose-200', type: 'debtor' });
      }
      if (isCreditor) {
        roleBadges.push({ title: 'بستانکار', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', type: 'creditor' });
      }

      const isNormal = roleBadges.length === 0;
      if (isNormal) {
        roleBadges.push({ title: 'شخص عادی', colorClass: 'bg-zinc-100 text-zinc-700 border-zinc-200', type: 'normal' });
      }

      const activeRolesCount = roleBadges.filter(r => r.type !== 'normal').length;
      const isMultiRole = activeRolesCount >= 2;

      const deletionAudit = getPersonDeletionAudit(person.id);

      return {
        person,
        bp,
        isSalesAgent,
        isCreditAgent,
        isDebtor,
        isCreditor,
        isNormal,
        isMultiRole,
        roleBadges,
        activeRolesCount,
        normBal,
        instBal,
        netBalance: personBalances[person.id] || { net: 0, nature: 'بی‌حساب' },
        deletionAudit
      };
    });
  }, [appState.persons, appState.businessPartners, normalDebtorBalances, installmentDebtorBalances, personBalances, appState.vouchers, appState.invoices, appState.checks, appState.installmentBooks, appState.openingBalances, appState.creditFiles]);

  // Filtered persons based on search query & selected role tab
  const filteredList = useMemo(() => {
    return personsWithRoles.filter(item => {
      // Role filter
      if (roleFilter === 'normal' && !item.isNormal) return false;
      if (roleFilter === 'debtor' && !item.isDebtor) return false;
      if (roleFilter === 'creditor' && !item.isCreditor) return false;
      if (roleFilter === 'sales_agent' && !item.isSalesAgent) return false;
      if (roleFilter === 'credit_agent' && !item.isCreditAgent) return false;
      if (roleFilter === 'multi_role' && !item.isMultiRole) return false;

      // Text search filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const p = item.person;

      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.nationalId && p.nationalId.includes(q)) ||
        (p.mobile && p.mobile.includes(q)) ||
        (p.phone && p.phone.includes(q)) ||
        (p.companyName && p.companyName.toLowerCase().includes(q)) ||
        (p.address && p.address.toLowerCase().includes(q))
      );
    });
  }, [personsWithRoles, roleFilter, searchQuery]);

  // Statistics counters
  const stats = useMemo(() => {
    const total = personsWithRoles.length;
    const normal = personsWithRoles.filter(p => p.isNormal).length;
    const debtors = personsWithRoles.filter(p => p.isDebtor).length;
    const creditors = personsWithRoles.filter(p => p.isCreditor).length;
    const salesAgents = personsWithRoles.filter(p => p.isSalesAgent).length;
    const creditAgents = personsWithRoles.filter(p => p.isCreditAgent).length;
    const multiRole = personsWithRoles.filter(p => p.isMultiRole).length;

    return { total, normal, debtors, creditors, salesAgents, creditAgents, multiRole };
  }, [personsWithRoles]);

  return (
    <div className="space-y-4 font-sans text-right">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 text-white p-5 rounded-3xl shadow-md border border-zinc-700/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="text-teal-400" size={22} />
            <h2 className="text-base font-bold text-white">بانک مرکزی اشخاص (Person Master Directory)</h2>
            <span className="bg-teal-500/20 text-teal-300 text-[10px] px-2.5 py-0.5 rounded-full border border-teal-500/30 font-mono">
              {stats.total} شخص ثبت‌شده
            </span>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">
            مرجع یکتای تمام اشخاص حقیقی و حقوقی سیستم. ثبت اطلاعات هویتی و مدیریت تمام نقش‌ها (بدهکار، بستانکار، نماینده فروش و اعتباری) مستقیماً روی همین پرونده‌ها انجام می‌شود.
          </p>
        </div>

        <div className="flex items-center gap-2 self-end md:self-center shrink-0">
          <button
            type="button"
            onClick={onCashTransaction}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2.5 rounded-xl shadow transition"
          >
            <DollarSign size={15} />
            <span>دریافت / پرداخت</span>
          </button>
          <button
            type="button"
            onClick={onAddPerson}
            className="flex items-center gap-1.5 bg-teal-500 hover:bg-teal-600 text-zinc-950 text-xs font-bold px-4 py-2.5 rounded-xl shadow transition"
          >
            <UserPlus size={16} />
            <span>ثبت شخص جدید</span>
          </button>
        </div>
      </div>

      {/* Quick Filter Bar */}
      <div className="bg-white p-2.5 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-2 overflow-x-auto">
        <span className="text-xs font-bold text-zinc-500 shrink-0 px-2 flex items-center gap-1">
          <Filter size={14} />
          فیلتر نقش:
        </span>

        <button
          type="button"
          onClick={() => setRoleFilter('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 flex items-center gap-1 ${
            roleFilter === 'all'
              ? 'bg-zinc-900 text-white shadow'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
          }`}
        >
          همه اشخاص ({stats.total})
        </button>

        <button
          type="button"
          onClick={() => setRoleFilter('normal')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 flex items-center gap-1 ${
            roleFilter === 'normal'
              ? 'bg-zinc-900 text-white shadow'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
          }`}
        >
          شخص عادی ({stats.normal})
        </button>

        <button
          type="button"
          onClick={() => setRoleFilter('debtor')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 flex items-center gap-1 ${
            roleFilter === 'debtor'
              ? 'bg-rose-600 text-white shadow'
              : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
          }`}
        >
          بدهکاران ({stats.debtors})
        </button>

        <button
          type="button"
          onClick={() => setRoleFilter('creditor')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 flex items-center gap-1 ${
            roleFilter === 'creditor'
              ? 'bg-emerald-600 text-white shadow'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
          }`}
        >
          بستانکاران ({stats.creditors})
        </button>

        <button
          type="button"
          onClick={() => setRoleFilter('sales_agent')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 flex items-center gap-1 ${
            roleFilter === 'sales_agent'
              ? 'bg-teal-700 text-white shadow'
              : 'bg-teal-50 text-teal-800 hover:bg-teal-100 border border-teal-200'
          }`}
        >
          نمایندگان فروش ({stats.salesAgents})
        </button>

        <button
          type="button"
          onClick={() => setRoleFilter('credit_agent')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 flex items-center gap-1 ${
            roleFilter === 'credit_agent'
              ? 'bg-indigo-700 text-white shadow'
              : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100 border border-indigo-200'
          }`}
        >
          نمایندگان اعتباری ({stats.creditAgents})
        </button>

        <button
          type="button"
          onClick={() => setRoleFilter('multi_role')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shrink-0 flex items-center gap-1 ${
            roleFilter === 'multi_role'
              ? 'bg-purple-700 text-white shadow'
              : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200'
          }`}
        >
          چندنقشی‌ها ({stats.multiRole})
        </button>
      </div>

      {/* Search Input */}
      <div className="bg-white p-2.5 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-2">
        <Search size={18} className="text-zinc-400 shrink-0" />
        <input
          type="text"
          placeholder="جستجو در تمام اشخاص بر اساس نام، کد شخص، کد ملی، شماره موبایل، تلفن، آدرس یا نام شرکت..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-transparent text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none"
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery('')} className="text-zinc-400 hover:text-zinc-600">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Persons List Grid */}
      <div className="space-y-2">
        <div className="flex justify-between items-center text-xs text-zinc-500 px-1 font-bold">
          <span>نمایش {filteredList.length} از {stats.total} شخص</span>
          {roleFilter !== 'all' && (
            <span className="text-teal-700">فیلتر فعال: {roleFilter}</span>
          )}
        </div>

        {filteredList.length === 0 ? (
          <div className="bg-white p-12 rounded-3xl border border-zinc-200 text-center text-zinc-400 text-xs">
            {searchQuery ? 'هیچ شخصی با مشخصات وارد شده یافت نشد.' : 'هیچ شخصی در سیستم ثبت نشده است.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredList.map(item => {
              const p = item.person;
              const isDeletable = item.deletionAudit.isDeletable;

              return (
                <div
                  key={p.id}
                  onClick={() => onSelectPersonForLedger(p)}
                  className="bg-white p-4 rounded-2xl border border-zinc-200 hover:border-teal-500/50 hover:shadow-md transition cursor-pointer flex flex-col justify-between gap-3 text-xs"
                >
                  {/* Top row: Name & Role Badges */}
                  <div className="flex justify-between items-start gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <strong className="text-zinc-900 text-sm font-bold">{p.name}</strong>
                        {p.companyName && (
                          <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                            <Building2 size={12} />
                            {p.companyName}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono flex items-center gap-3">
                        <span>کد شخص: <strong>{p.code}</strong></span>
                        <span>کد ملی: {p.nationalId || 'ثبت نشده'}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onSelectPersonForCritical(p)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500 hover:text-rose-700 transition"
                        title="وضعیت بحرانی و امانات"
                      >
                        <ShieldCheck size={15} />
                      </button>

                      <button
                        type="button"
                        onClick={() => onEditPerson(p)}
                        className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800 transition"
                        title="ویرایش مشخصات هویتی"
                      >
                        <Edit2 size={15} />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (isDeletable) {
                            onDeletePerson(p.id);
                          } else {
                            setSelectedAuditPerson({ person: p, reasons: item.deletionAudit.reasons });
                          }
                        }}
                        className={`p-1.5 rounded-lg transition ${
                          isDeletable
                            ? 'hover:bg-red-50 text-red-500 hover:text-red-700'
                            : 'text-zinc-300 hover:bg-amber-50 hover:text-amber-600'
                        }`}
                        title={isDeletable ? 'حذف شخص' : 'مشاهده علت غیرفعال بودن حذف'}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Middle row: Role Badges */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.roleBadges.map((badge, idx) => (
                      <span
                        key={idx}
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${badge.colorClass}`}
                      >
                        {badge.title}
                      </span>
                    ))}

                    {item.isMultiRole && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 border border-purple-300 flex items-center gap-1">
                        <Layers size={10} />
                        چندنقشی
                      </span>
                    )}
                  </div>

                  {/* Bottom row: Contact info & Balance Summary */}
                  <div className="pt-2 border-t border-zinc-100 flex justify-between items-center text-[11px] text-zinc-600">
                    <div className="flex items-center gap-3 font-mono">
                      {p.mobile ? (
                        <span className="flex items-center gap-1">
                          <Phone size={12} className="text-zinc-400" />
                          {p.mobile}
                        </span>
                      ) : (
                        <span className="text-zinc-400">موبایل ندارد</span>
                      )}
                    </div>

                    <div className="font-mono font-bold">
                      {item.netBalance.net > 0 ? (
                        <span className={item.netBalance.nature === 'بدهکار' ? 'text-red-600' : 'text-emerald-600'}>
                          مانده: {item.netBalance.net.toLocaleString()} ریال ({item.netBalance.nature})
                        </span>
                      ) : (
                        <span className="text-zinc-400">تراز تسویه (بی‌حساب)</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dependency Audit Modal for blocked deletion */}
      {selectedAuditPerson && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-3xl p-6 shadow-xl border border-zinc-200 text-right space-y-4">
            <div className="flex items-center gap-3 text-amber-600 border-b border-zinc-150 pb-3">
              <ShieldAlert size={24} />
              <div>
                <h3 className="font-bold text-sm text-zinc-900">عدم امکان حذف شخص (حفاظت از داده‌ها)</h3>
                <p className="text-[11px] text-zinc-500">{selectedAuditPerson.person.name} ({selectedAuditPerson.person.code})</p>
              </div>
            </div>

            <p className="text-xs text-zinc-700 leading-relaxed">
              جهت حفظ یکپارچگی حسابداری و سوابق مالی، حذف اشخاصی که دارای وابستگی و سابقه تراکنش در سیستم هستند غیرفعال است.
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 space-y-2">
              <span className="text-xs font-bold text-amber-900 block">وابستگی‌های فعال در سیستم:</span>
              <ul className="text-xs text-amber-800 space-y-1 pr-4 list-disc">
                {selectedAuditPerson.reasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedAuditPerson(null)}
                className="bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition"
              >
                متوجه شدم
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CentralPersonDirectory;
