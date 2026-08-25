import React, { useState, useMemo } from 'react';
import { 
  Users, UserPlus, Link, Copy, Check, Search, Filter, ShieldCheck, 
  Percent, DollarSign, ExternalLink, RefreshCw, AlertCircle, Edit3, Trash2, 
  UserCheck, Building2, UserX, Share2, Info, ArrowRight, Award, Plus, Layers,
  Calculator, CheckCircle2, XCircle, FileText, TrendingUp, Clock, AlertTriangle
} from 'lucide-react';
import { 
  AppState, VisitorProfile, ReferrerNode, BusinessPartner, Person, 
  VisitorCommissionStatement, VisitorCommissionDetail, JournalVoucher 
} from '../types';
import { getCurrentJalaliDate } from '../utils/jalali';
import { toEnglishDigits, saveAppState, getNextVoucherNumber } from '../utils/accounting';

interface VisitorNetworkManagerProps {
  state: AppState;
  onUpdateState: (newState: AppState) => void;
}

export function VisitorNetworkManager({ state, onUpdateState }: VisitorNetworkManagerProps) {
  const [activeTab, setActiveTab] = useState<'visitors' | 'assignments' | 'links' | 'settlement'>('visitors');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'>('ALL');
  
  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingVisitor, setEditingVisitor] = useState<VisitorProfile | null>(null);
  
  // Add/Edit Form State
  const [fullName, setFullName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [mobile, setMobile] = useState('');
  const [commissionType, setCommissionType] = useState<'PERCENTAGE' | 'FLAT_AMOUNT'>('PERCENTAGE');
  const [commissionValue, setCommissionValue] = useState<number>(2.5);
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'SUSPENDED'>('ACTIVE');
  const [notes, setNotes] = useState('');
  
  // Assignment Modal
  const [assigningVisitor, setAssigningVisitor] = useState<VisitorProfile | null>(null);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[]>([]);
  const [partnerSearch, setPartnerSearch] = useState('');

  // Copy Feedback state
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Settlement Engine State
  const [selectedVisitorForCalc, setSelectedVisitorForCalc] = useState<string>('');
  const [calcPeriodTitle, setCalcPeriodTitle] = useState<string>(`پورسانت دوره ${getCurrentJalaliDate()}`);
  const [activeStatement, setActiveStatement] = useState<VisitorCommissionStatement | null>(null);
  const [customManualSales, setCustomManualSales] = useState<string>('');

  // Initializing state collections safely
  const visitors = useMemo(() => state.visitorProfiles || [], [state.visitorProfiles]);
  const referrerNodes = useMemo(() => state.referrerNodes || [], [state.referrerNodes]);
  const partners = useMemo(() => state.businessPartners || [], [state.businessPartners]);
  const persons = useMemo(() => state.persons || [], [state.persons]);
  const invoices = useMemo(() => state.invoices || [], [state.invoices]);
  const visitorCommissions = useMemo(() => state.visitorCommissions || [], [state.visitorCommissions]);

  // Summary statistics
  const totalVisitors = visitors.length;
  const activeVisitors = visitors.filter(v => v.status === 'ACTIVE').length;
  const totalAssignedPartners = useMemo(() => {
    const set = new Set<string>();
    visitors.forEach(v => (v.assignedPartnerIds || []).forEach(id => set.add(id)));
    return set.size;
  }, [visitors]);

  // Open Add Modal
  const handleOpenAddModal = () => {
    setEditingVisitor(null);
    setFullName('');
    setNationalId('');
    setMobile('');
    setCommissionType('PERCENTAGE');
    setCommissionValue(2.5);
    setStatus('ACTIVE');
    setNotes('');
    setShowAddModal(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (visitor: VisitorProfile) => {
    setEditingVisitor(visitor);
    setFullName(visitor.fullName);
    setNationalId(visitor.nationalId || '');
    setMobile(visitor.mobile);
    setCommissionType(visitor.commissionType);
    setCommissionValue(visitor.commissionValue);
    setStatus(visitor.status);
    setNotes(visitor.notes || '');
    setShowAddModal(true);
  };

  // Generate Referral Code
  const generateReferralCode = () => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `REF-VIS-${randomNum}`;
  };

  // Save Visitor (Create or Edit)
  const handleSaveVisitor = (e: React.FormEvent) => {
    e.preventDefault();

    const cleanName = fullName.trim();
    const cleanMobile = toEnglishDigits(mobile.trim());
    if (!cleanName) {
      alert('لطفاً نام و نام خانوادگی ویزیتور را وارد کنید.');
      return;
    }
    if (!cleanMobile) {
      alert('لطفاً شماره همراه معتبر وارد کنید.');
      return;
    }

    const baseUrl = window.location.origin || 'https://app.accounting.ir';
    const refCode = editingVisitor ? editingVisitor.referralCode : generateReferralCode();
    const refLink = `${baseUrl}/?ref=${refCode}&agentToken=${refCode}`;

    if (editingVisitor) {
      // Update existing
      const updatedVisitors = visitors.map(v => {
        if (v.id === editingVisitor.id) {
          return {
            ...v,
            fullName: cleanName,
            nationalId: nationalId.trim() || undefined,
            mobile: cleanMobile,
            commissionType,
            commissionValue: Number(commissionValue) || 0,
            status,
            notes: notes.trim() || undefined,
            updatedAt: getCurrentJalaliDate(),
          };
        }
        return v;
      });

      onUpdateState({
        ...state,
        visitorProfiles: updatedVisitors,
      });
      alert('✅ اطلاعات ویزیتور با موفقیت به‌روزرسانی شد.');
    } else {
      // Create new
      const newVisitor: VisitorProfile = {
        id: `VIS-${Date.now().toString().slice(-6)}`,
        fullName: cleanName,
        nationalId: nationalId.trim() || undefined,
        mobile: cleanMobile,
        status,
        referralCode: refCode,
        referralLink: refLink,
        commissionType,
        commissionValue: Number(commissionValue) || 0,
        assignedPartnerIds: [],
        notes: notes.trim() || undefined,
        createdAt: getCurrentJalaliDate(),
        updatedAt: getCurrentJalaliDate(),
      };

      onUpdateState({
        ...state,
        visitorProfiles: [newVisitor, ...visitors],
      });
      alert('✅ ویزیتور جدید با موفقیت ثبت شد.');
    }

    setShowAddModal(false);
  };

  // Toggle Visitor Status
  const handleToggleStatus = (visitorId: string) => {
    const updatedVisitors = visitors.map(v => {
      if (v.id === visitorId) {
        const nextStatus = v.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
        return { ...v, status: nextStatus, updatedAt: getCurrentJalaliDate() };
      }
      return v;
    });

    onUpdateState({
      ...state,
      visitorProfiles: updatedVisitors,
    });
  };

  // Copy Referral Link
  const handleCopyLink = (textToCopy: string, code: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  // Open Partner Allocation Modal
  const handleOpenAssignModal = (visitor: VisitorProfile) => {
    setAssigningVisitor(visitor);
    setSelectedPartnerIds(visitor.assignedPartnerIds || []);
    setPartnerSearch('');
  };

  // Save Partner Assignment
  const handleSaveAssignments = () => {
    if (!assigningVisitor) return;

    const visitorId = assigningVisitor.id;
    const nowJalali = getCurrentJalaliDate();

    // Update visitor assignedPartnerIds
    const updatedVisitors = visitors.map(v => {
      if (v.id === visitorId) {
        return {
          ...v,
          assignedPartnerIds: selectedPartnerIds,
          updatedAt: nowJalali,
        };
      }
      return v;
    });

    // Rebuild ReferrerNodes
    const otherNodes = referrerNodes.filter(rn => rn.visitorId !== visitorId);
    const newNodes: ReferrerNode[] = selectedPartnerIds.map(partnerId => {
      const bp = partners.find(p => p.id === partnerId);
      const person = persons.find(p => p.id === partnerId || (bp && p.id === bp.personId));
      const partnerName = bp?.profile?.partnerName || person?.name || 'نماینده فروش';
      const storeName = bp?.profile?.storeName || person?.agentDetails?.storeName;

      return {
        id: `RN-${visitorId}-${partnerId}`,
        visitorId: visitorId,
        visitorName: assigningVisitor.fullName,
        partnerId: partnerId,
        partnerName: partnerName,
        partnerStoreName: storeName,
        assignedAt: nowJalali,
        status: 'ACTIVE',
      };
    });

    onUpdateState({
      ...state,
      visitorProfiles: updatedVisitors,
      referrerNodes: [...otherNodes, ...newNodes],
    });

    alert(`✅ نمایندگان منتخب با موفقیت به ویزیتور ${assigningVisitor.fullName} تخصیص یافتند.`);
    setAssigningVisitor(null);
  };

  // --- SETTLEMENT & COMMISSION ENGINE FUNCTIONS ---

  // Ensure visitor has a Person record in central directory
  const ensureVisitorPersonId = (visitor: VisitorProfile, currentState: AppState): { personId: string; updatedPersons: Person[] } => {
    let updatedPersons = [...(currentState.persons || [])];
    
    if (visitor.personId) {
      const existing = updatedPersons.find(p => p.id === visitor.personId);
      if (existing) return { personId: existing.id, updatedPersons };
    }

    const cleanMob = toEnglishDigits(visitor.mobile).replace(/\D/g, '');
    const cleanNat = visitor.nationalId ? toEnglishDigits(visitor.nationalId).replace(/\D/g, '') : '';

    const match = updatedPersons.find(p => 
      (p.mobile && toEnglishDigits(p.mobile).replace(/\D/g, '') === cleanMob) ||
      (cleanNat && p.nationalId && toEnglishDigits(p.nationalId).replace(/\D/g, '') === cleanNat) ||
      p.name.trim() === visitor.fullName.trim()
    );

    if (match) {
      return { personId: match.id, updatedPersons };
    }

    const newPersonId = `P-VIS-${Date.now()}`;
    const newPerson: Person = {
      id: newPersonId,
      code: `VIS-${Math.floor(1000 + Math.random() * 9000)}`,
      name: visitor.fullName,
      mobile: visitor.mobile,
      nationalId: visitor.nationalId,
      roles: ['sales_rep'],
      status: 'active',
      role: 'creditor',
      createdAt: new Date().toISOString(),
    };

    updatedPersons.push(newPerson);
    return { personId: newPersonId, updatedPersons };
  };

  // Live Commission Preview Generation
  const handleGenerateCommissionPreview = (visitorIdOverride?: string) => {
    const targetVisitorId = visitorIdOverride || selectedVisitorForCalc;
    const targetVisitor = visitors.find(v => v.id === targetVisitorId);

    if (!targetVisitor) {
      alert('لطفاً ابتدا یک ویزیتور انتخاب کنید.');
      return;
    }

    const assignedPartnerIds = targetVisitor.assignedPartnerIds || [];
    const assignedPartners = partners.filter(bp => assignedPartnerIds.includes(bp.id));

    // Person IDs of assigned partners
    const targetPersonIds = new Set<string>();
    assignedPartners.forEach(bp => {
      if (bp.personId) targetPersonIds.add(bp.personId);
      targetPersonIds.add(bp.id);
    });

    // Eligible sales invoices
    const eligibleInvoices = invoices.filter(inv => 
      inv.type === 'sell' && 
      !inv.isProInvoice && 
      (targetPersonIds.has(inv.personId) || (inv.representativeId && targetPersonIds.has(inv.representativeId)))
    );

    let totalSales = 0;
    let totalComm = 0;

    const details: VisitorCommissionDetail[] = eligibleInvoices.map(inv => {
      const invAmt = inv.totalAmount || 0;
      totalSales += invAmt;

      let cAmt = 0;
      if (targetVisitor.commissionType === 'PERCENTAGE') {
        cAmt = Math.round(invAmt * (targetVisitor.commissionValue / 100));
      } else {
        cAmt = targetVisitor.commissionValue;
      }
      totalComm += cAmt;

      const bp = assignedPartners.find(p => p.personId === inv.personId || p.id === inv.personId || p.id === inv.representativeId);
      const pPerson = persons.find(p => p.id === bp?.personId || p.id === inv.personId);

      return {
        partnerId: bp?.id || inv.personId,
        partnerName: pPerson?.name || bp?.profile?.partnerName || 'نماینده فروش',
        storeName: bp?.profile?.storeName || pPerson?.agentDetails?.storeName || '',
        invoiceId: inv.id,
        invoiceNumber: String(inv.invoiceNumber),
        invoiceDate: inv.date,
        invoiceAmount: invAmt,
        commissionAmount: cAmt,
      };
    });

    // Manual simulation if no live invoices exist
    const manualSalesNum = customManualSales ? parseInt(toEnglishDigits(customManualSales)) : 0;
    if (details.length === 0 && manualSalesNum > 0) {
      totalSales = manualSalesNum;
      if (targetVisitor.commissionType === 'PERCENTAGE') {
        totalComm = Math.round(manualSalesNum * (targetVisitor.commissionValue / 100));
      } else {
        totalComm = targetVisitor.commissionValue;
      }
    }

    const stmt: VisitorCommissionStatement = {
      id: `COMM-STMT-${Date.now()}`,
      visitorId: targetVisitor.id,
      visitorName: targetVisitor.fullName,
      visitorMobile: targetVisitor.mobile,
      periodTitle: calcPeriodTitle.trim() || `پورسانت دوره ${getCurrentJalaliDate()}`,
      calculatedAt: getCurrentJalaliDate(),
      totalSalesAmount: totalSales,
      totalCommissionAmount: totalComm,
      commissionType: targetVisitor.commissionType,
      commissionValue: targetVisitor.commissionValue,
      status: 'PREVIEW',
      details,
    };

    setActiveStatement(stmt);
  };

  // Approve & Issue Double-Entry Accounting Voucher
  const handleApproveCommissionStatement = (stmt: VisitorCommissionStatement) => {
    const visitor = visitors.find(v => v.id === stmt.visitorId);
    if (!visitor) {
      alert('اطلاعات ویزیتور یافت نشد.');
      return;
    }

    if (stmt.totalCommissionAmount <= 0) {
      alert('مبلغ پورسانت محاسبه شده صفر است. امکان صدور سند حسابداری بدون مبلغ وجود ندارد.');
      return;
    }

    // 1. Resolve or create personId for visitor
    const { personId, updatedPersons } = ensureVisitorPersonId(visitor, state);

    // 2. Generate standard double-entry voucher
    const currentVouchers = state.vouchers || [];
    const nextVoucherNo = getNextVoucherNumber(currentVouchers);
    const nowJalali = getCurrentJalaliDate();

    const newVoucher: JournalVoucher = {
      id: `VOUCHER-VIS-COMM-${Date.now()}`,
      voucherNumber: nextVoucherNo,
      date: nowJalali,
      gregorianDate: new Date().toISOString(),
      description: `صدور سند پورسانت ویزیتور: ${visitor.fullName} بابت ${stmt.periodTitle}`,
      isAutomatic: true,
      entries: [
        {
          subsidiaryId: 'SUB_EXP_MISC',
          debit: stmt.totalCommissionAmount,
          credit: 0,
          description: `هزینه پورسانت و بازاریابی فروش - ویزیتور: ${visitor.fullName}`,
        },
        {
          subsidiaryId: 'SUB_CREDITORS',
          floatingDetailed: {
            type: 'person',
            id: personId,
            name: visitor.fullName,
          },
          debit: 0,
          credit: stmt.totalCommissionAmount,
          description: `بستانکاری بابت پورسانت فروش ویزیتور ${visitor.fullName} (${stmt.periodTitle})`,
        }
      ]
    };

    // 3. Update statement status
    const approvedStmt: VisitorCommissionStatement = {
      ...stmt,
      status: 'APPROVED',
      voucherId: newVoucher.id,
      voucherNumber: nextVoucherNo,
      approvedAt: nowJalali,
      approvedBy: 'مدیریت مالی',
    };

    // 4. Update state collections
    const updatedVisitors = visitors.map(v => 
      v.id === visitor.id ? { ...v, personId } : v
    );

    const updatedCommissions = [
      approvedStmt,
      ...(state.visitorCommissions || []).filter(c => c.id !== stmt.id)
    ];

    const newState: AppState = {
      ...state,
      persons: updatedPersons,
      visitorProfiles: updatedVisitors,
      vouchers: [newVoucher, ...currentVouchers],
      visitorCommissions: updatedCommissions,
    };

    onUpdateState(newState);
    saveAppState(newState);
    setActiveStatement(approvedStmt);
    alert(`✅ سند پورسانت حسابداری شماره ${nextVoucherNo} با موفقیت صادر و صادر شد.`);
  };

  // Reject Report
  const handleRejectCommissionStatement = (stmt: VisitorCommissionStatement) => {
    const rejectedStmt: VisitorCommissionStatement = {
      ...stmt,
      status: 'REJECTED',
      notes: 'گزارش توسط مدیریت رد شد.',
    };

    const updatedCommissions = [
      rejectedStmt,
      ...(state.visitorCommissions || []).filter(c => c.id !== stmt.id)
    ];

    const newState: AppState = {
      ...state,
      visitorCommissions: updatedCommissions,
    };

    onUpdateState(newState);
    saveAppState(newState);
    setActiveStatement(rejectedStmt);
    alert('❌ گزارش پورسانت رد و بایگانی شد.');
  };

  // Filtered Visitors list
  const filteredVisitors = useMemo(() => {
    return visitors.filter(v => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = 
        v.fullName.toLowerCase().includes(q) ||
        v.mobile.includes(q) ||
        v.referralCode.toLowerCase().includes(q);

      const matchesStatus = statusFilter === 'ALL' || v.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [visitors, searchQuery, statusFilter]);

  // Combined Partner List for Allocation
  const availablePartners = useMemo(() => {
    return partners.map(bp => {
      const agentPerson = persons.find(p => p.id === bp.personId);
      const partnerName = bp.profile?.partnerName || agentPerson?.name || 'نماینده فروش';
      const storeName = bp.profile?.storeName || agentPerson?.agentDetails?.storeName || 'فروشگاه طرف قرارداد';
      const code = agentPerson?.code || bp.id;

      // Find current assigned visitor if any
      const currentVisitor = visitors.find(v => (v.assignedPartnerIds || []).includes(bp.id));

      return {
        id: bp.id,
        partnerName,
        storeName,
        code,
        currentVisitorName: currentVisitor ? currentVisitor.fullName : null,
        currentVisitorId: currentVisitor ? currentVisitor.id : null,
      };
    });
  }, [partners, persons, visitors]);

  // Filtered available partners for selection modal
  const filteredAvailablePartners = useMemo(() => {
    return availablePartners.filter(p => {
      const q = partnerSearch.toLowerCase();
      return (
        p.partnerName.toLowerCase().includes(q) ||
        p.storeName.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q)
      );
    });
  }, [availablePartners, partnerSearch]);

  return (
    <div className="space-y-6 font-sans text-zinc-800" dir="rtl">
      
      {/* Top Banner & Security Guarantee */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 rounded-2xl border border-indigo-500/30 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 flex items-center justify-center shrink-0 shadow-lg">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black">شبکه ویزیتورها و جذب‌کنندگان (Referrer Network)</h2>
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>۱۰۰٪ ایزوله از حسابداری</span>
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              مدیریت بازاریابان میدانی، تولید لینک‌های اختصاصی ثبت‌نام و تخصیص نمایندگان بدون ایجاد هرگونه سند مالی یا دستکاری در مانده حساب‌ها.
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer border border-emerald-400/30 shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          <span>تعریف ویزیتور جدید</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-zinc-200 p-4 rounded-2xl shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-zinc-500 block mb-1">کل ویزیتورها و بازاریابان</span>
            <span className="text-2xl font-black text-zinc-800">{totalVisitors.toLocaleString('fa-IR')}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-zinc-200 p-4 rounded-2xl shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-zinc-500 block mb-1">ویزیتورهای فعال</span>
            <span className="text-2xl font-black text-emerald-600">{activeVisitors.toLocaleString('fa-IR')}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <UserCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-zinc-200 p-4 rounded-2xl shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-zinc-500 block mb-1">نمایندگان تخصیص‌یافته</span>
            <span className="text-2xl font-black text-indigo-600">{totalAssignedPartners.toLocaleString('fa-IR')}</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <Building2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Tab Controls */}
      <div className="bg-white border border-zinc-200 p-1.5 rounded-2xl shadow-sm flex flex-col sm:flex-row gap-2">
        <button
          onClick={() => setActiveTab('visitors')}
          className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'visitors'
              ? 'bg-zinc-900 text-white shadow-md'
              : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>لیست و مدیریت ویزیتورها</span>
        </button>

        <button
          onClick={() => setActiveTab('assignments')}
          className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'assignments'
              ? 'bg-indigo-700 text-white shadow-md'
              : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>جدول تخصیص نمایندگان به ویزیتور</span>
        </button>

        <button
          onClick={() => setActiveTab('links')}
          className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'links'
              ? 'bg-teal-700 text-white shadow-md'
              : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          <Link className="w-4 h-4" />
          <span>لینک‌های اختصاصی جذب</span>
        </button>

        <button
          onClick={() => setActiveTab('settlement')}
          className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeTab === 'settlement'
              ? 'bg-purple-800 text-white shadow-md'
              : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          <Calculator className="w-4 h-4" />
          <span>موتور و کارتابل تسویه پورسانت</span>
        </button>
      </div>

      {/* TAB 1: VISITORS LIST */}
      {activeTab === 'visitors' && (
        <div className="space-y-4">
          
          {/* Search and Filters */}
          <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute right-3 top-3 text-zinc-400" />
              <input
                type="text"
                placeholder="جستجو با نام، شماره همراه، یا کد ویزیتور..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pr-9 pl-3 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-sans"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Filter className="w-4 h-4 text-zinc-400 shrink-0" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as any)}
                className="py-2 px-3 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold font-sans cursor-pointer"
              >
                <option value="ALL">همه وضعیت‌ها</option>
                <option value="ACTIVE">فقط فعال</option>
                <option value="INACTIVE">غیرفعال</option>
                <option value="SUSPENDED">معلق</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-zinc-100/80 text-zinc-600 font-bold border-b border-zinc-200">
                  <tr>
                    <th className="p-3.5">کد و شناسه</th>
                    <th className="p-3.5">نام و نام خانوادگی</th>
                    <th className="p-3.5">شماره همراه</th>
                    <th className="p-3.5">مدل پورسانت</th>
                    <th className="p-3.5">نمایندگان تحت پوشش</th>
                    <th className="p-3.5">وضعیت</th>
                    <th className="p-3.5 text-center">لینک اختصاصی</th>
                    <th className="p-3.5 text-center">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 font-sans">
                  {filteredVisitors.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-zinc-400 font-bold">
                        هیچ ویزیتوری یافت نشد. می‌توانید با کلیک بر روی «تعریف ویزیتور جدید» اولین بازاریاب را اضافه کنید.
                      </td>
                    </tr>
                  ) : (
                    filteredVisitors.map(visitor => {
                      const assignedCount = (visitor.assignedPartnerIds || []).length;
                      return (
                        <tr key={visitor.id} className="hover:bg-zinc-50/80 transition-all">
                          <td className="p-3.5 font-bold font-mono text-indigo-700">{visitor.referralCode}</td>
                          <td className="p-3.5 font-black text-zinc-900">{visitor.fullName}</td>
                          <td className="p-3.5 font-mono text-zinc-600">{visitor.mobile}</td>
                          <td className="p-3.5">
                            <span className="inline-flex items-center gap-1 font-bold bg-zinc-100 text-zinc-700 px-2 py-1 rounded-lg border border-zinc-200">
                              {visitor.commissionType === 'PERCENTAGE' ? (
                                <>
                                  <Percent className="w-3 h-3 text-indigo-600" />
                                  <span>{visitor.commissionValue.toLocaleString('fa-IR')}٪</span>
                                </>
                              ) : (
                                <>
                                  <DollarSign className="w-3 h-3 text-emerald-600" />
                                  <span>{visitor.commissionValue.toLocaleString('fa-IR')} ریال</span>
                                </>
                              )}
                            </span>
                          </td>
                          <td className="p-3.5">
                            <button
                              onClick={() => handleOpenAssignModal(visitor)}
                              className="font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/60 px-2.5 py-1 rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                            >
                              <Building2 className="w-3.5 h-3.5" />
                              <span>{assignedCount.toLocaleString('fa-IR')} نماینده</span>
                            </button>
                          </td>
                          <td className="p-3.5">
                            {visitor.status === 'ACTIVE' && (
                              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold px-2 py-0.5 rounded-full">
                                فعال
                              </span>
                            )}
                            {visitor.status === 'INACTIVE' && (
                              <span className="bg-zinc-100 text-zinc-600 border border-zinc-200 text-[11px] font-bold px-2 py-0.5 rounded-full">
                                غیرفعال
                              </span>
                            )}
                            {visitor.status === 'SUSPENDED' && (
                              <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold px-2 py-0.5 rounded-full">
                                معلق
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 text-center">
                            <button
                              onClick={() => handleCopyLink(visitor.referralLink, visitor.referralCode)}
                              className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold px-2.5 py-1 rounded-lg border border-zinc-200 transition-all text-[11px] inline-flex items-center gap-1 cursor-pointer"
                            >
                              {copiedCode === visitor.referralCode ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  <span className="text-emerald-600 font-bold">کپی شد</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-zinc-500" />
                                  <span>کپی لینک</span>
                                </>
                              )}
                            </button>
                          </td>
                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleOpenEditModal(visitor)}
                                className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition cursor-pointer"
                                title="ویرایش اطلاعات"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleToggleStatus(visitor.id)}
                                className={`p-1.5 rounded-lg transition cursor-pointer ${
                                  visitor.status === 'ACTIVE'
                                    ? 'hover:bg-rose-50 text-rose-600'
                                    : 'hover:bg-emerald-50 text-emerald-600'
                                }`}
                                title={visitor.status === 'ACTIVE' ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                              >
                                {visitor.status === 'ACTIVE' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PARTNER ALLOCATION TABLE */}
      {activeTab === 'assignments' && (
        <div className="space-y-4">
          <div className="bg-indigo-50/60 border border-indigo-200/80 p-4 rounded-2xl flex items-start gap-3">
            <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <div className="text-xs text-indigo-900 leading-relaxed">
              <span className="font-bold">راهنمای تخصیص نمایندگان به شبکه ویزیتورها:</span> با تخصیص یک نماینده فروش نسیه به ویزیتور، ثبت‌نام‌ها و خریدهای اعتباری نماینده جهت محاسبه پورسانت بازاریاب رهگیری می‌شود. این تخصیص صرفاً کاربرد مدیریتی داشته و هیچ‌گونه تغییر ناخواسته یا ثبتی در دفاتر حسابداری ایجاد نمی‌کند.
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-zinc-200 font-bold text-xs text-zinc-700 flex items-center justify-between">
              <span>فهرست کامل نمایندگان نسیه و وضعیت تخصیص بازاریاب</span>
              <span className="text-zinc-500 font-normal">تعداد کل: {partners.length.toLocaleString('fa-IR')} نماینده</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-zinc-100/80 text-zinc-600 font-bold border-b border-zinc-200">
                  <tr>
                    <th className="p-3.5">کد نماینده</th>
                    <th className="p-3.5">نام نماینده / فروشگاه</th>
                    <th className="p-3.5">ویزیتور تخصیص‌یافته</th>
                    <th className="p-3.5">پورسانت ویزیتور</th>
                    <th className="p-3.5 text-center">عملیات تخصیص</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 font-sans">
                  {availablePartners.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-zinc-400 font-bold">
                        هنوز نماینده فروشی در سیستم ثبت نشده است.
                      </td>
                    </tr>
                  ) : (
                    availablePartners.map(p => {
                      const currentVis = visitors.find(v => v.id === p.currentVisitorId);
                      return (
                        <tr key={p.id} className="hover:bg-zinc-50/80 transition-all">
                          <td className="p-3.5 font-mono text-zinc-600 font-bold">{p.code}</td>
                          <td className="p-3.5">
                            <div className="font-black text-zinc-900">{p.partnerName}</div>
                            <div className="text-[11px] text-zinc-500">{p.storeName}</div>
                          </td>
                          <td className="p-3.5">
                            {currentVis ? (
                              <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-800 border border-indigo-200/80 px-2.5 py-1 rounded-xl font-bold">
                                <Users className="w-3.5 h-3.5 text-indigo-600" />
                                <span>{currentVis.fullName}</span>
                                <span className="text-[10px] text-indigo-500 font-mono">({currentVis.referralCode})</span>
                              </span>
                            ) : (
                              <span className="text-zinc-400 text-[11px]">بدون ویزیتور (مستقیم)</span>
                            )}
                          </td>
                          <td className="p-3.5">
                            {currentVis ? (
                              <span className="font-bold text-zinc-700">
                                {currentVis.commissionType === 'PERCENTAGE' 
                                  ? `${currentVis.commissionValue}٪`
                                  : `${currentVis.commissionValue.toLocaleString('fa-IR')} ریال`}
                              </span>
                            ) : (
                              <span className="text-zinc-400">-</span>
                            )}
                          </td>
                          <td className="p-3.5 text-center">
                            {currentVis ? (
                              <button
                                onClick={() => handleOpenAssignModal(currentVis)}
                                className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold px-3 py-1 rounded-lg border border-zinc-300 text-xs transition cursor-pointer"
                              >
                                تغییر ویزیتور
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  if (visitors.length === 0) {
                                    alert('ابتدا باید حداقل یک ویزیتور در تب «لیست و مدیریت ویزیتورها» تعریف کنید.');
                                    return;
                                  }
                                  handleOpenAssignModal(visitors[0]);
                                }}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1 rounded-lg text-xs transition shadow-sm cursor-pointer"
                              >
                                تخصیص ویزیتور
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: REFERRAL LINKS HUB */}
      {activeTab === 'links' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visitors.length === 0 ? (
              <div className="col-span-2 bg-white p-8 rounded-2xl border border-zinc-200 text-center text-zinc-400 font-bold">
                هیچ ویزیتوری ثبت نشده است. برای تولید لینک اختصاصی، ابتدا یک ویزیتور جدید ایجاد کنید.
              </div>
            ) : (
              visitors.map(v => (
                <div key={v.id} className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold">
                        <Users className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-black text-sm text-zinc-900">{v.fullName}</div>
                        <div className="text-[11px] text-zinc-500 font-mono">کد معرفی: {v.referralCode}</div>
                      </div>
                    </div>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                      v.status === 'ACTIVE' 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                        : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                    }`}>
                      {v.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}
                    </span>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-zinc-500 block mb-1">لینک اختصاصی جذب و ثبت‌نام نماینده:</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={v.referralLink}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono text-zinc-700 dir-ltr select-all focus:outline-none"
                      />
                      <button
                        onClick={() => handleCopyLink(v.referralLink, v.referralCode)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-2 rounded-xl text-xs shadow transition shrink-0 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedCode === v.referralCode ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>کپی شد</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>کپی</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
                    <span>نمایندگان متصل: {(v.assignedPartnerIds || []).length.toLocaleString('fa-IR')} مورد</span>
                    <span className="font-bold text-indigo-600">
                      پورسانت: {v.commissionType === 'PERCENTAGE' ? `${v.commissionValue}٪` : `${v.commissionValue.toLocaleString('fa-IR')} ریال`}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: COMMISSION SETTLEMENT ENGINE */}
      {activeTab === 'settlement' && (
        <div className="space-y-6">
          
          {/* Header Banner */}
          <div className="bg-gradient-to-br from-purple-900 via-indigo-900 to-slate-900 p-5 rounded-2xl border border-purple-500/30 text-white shadow-lg space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center justify-center shrink-0">
                  <Calculator className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base">کارتابل محاسبه و تسویه پورسانت ویزیتورها</h3>
                  <p className="text-xs text-purple-200 mt-0.5">
                    محاسبه زنده پورسانت بر اساس فاکتورهای تاییدشده نمایندگان تحت پوشش با امکان پیش‌نمایش آماری و صدور سند دوبل حسابداری
                  </p>
                </div>
              </div>

              <div className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-2 self-start sm:self-auto">
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                <span>محاسبه اولیه ۰٪ اثر مالی دارد (فقط پیش‌نمایش)</span>
              </div>
            </div>
          </div>

          {/* Calculator Control Box */}
          <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
            <h4 className="font-black text-sm text-zinc-900 flex items-center gap-2 border-b border-zinc-100 pb-3">
              <RefreshCw className="w-4 h-4 text-purple-600" />
              <span>تنظیمات محاسبه و صدور پیش‌نمایش پورسانت</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">انتخاب ویزیتور / بازاریاب:</label>
                <select
                  value={selectedVisitorForCalc}
                  onChange={e => {
                    setSelectedVisitorForCalc(e.target.value);
                    setActiveStatement(null);
                  }}
                  className="w-full py-2.5 px-3 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-bold font-sans cursor-pointer"
                >
                  <option value="">-- انتخاب کنید --</option>
                  {visitors.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.fullName} (کد: {v.referralCode} - {(v.assignedPartnerIds || []).length} نماینده)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">عنوان / دوره محاسباتی:</label>
                <input
                  type="text"
                  value={calcPeriodTitle}
                  onChange={e => setCalcPeriodTitle(e.target.value)}
                  placeholder="مثلاً: پورسانت دوره شهریور ۱۴۰۳"
                  className="w-full py-2 px-3 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">شبیه‌سازی مبلغ فروش دستی (اختیاری):</label>
                <input
                  type="text"
                  value={customManualSales}
                  onChange={e => setCustomManualSales(e.target.value)}
                  placeholder="مبلغ به ریال (در صورت عدم فاکتور در سیستم)"
                  className="w-full py-2 px-3 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 font-sans"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => handleGenerateCommissionPreview()}
                disabled={!selectedVisitorForCalc}
                className="bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white font-bold py-2.5 px-5 rounded-xl text-xs shadow-md transition flex items-center gap-2 cursor-pointer"
              >
                <Calculator className="w-4 h-4" />
                <span>محاسبه و تولید پیش‌نمایش پورسانت</span>
              </button>
            </div>
          </div>

          {/* ACTIVE STATEMENT PREVIEW CARD */}
          {activeStatement && (
            <div className="bg-white rounded-2xl border-2 border-purple-200 shadow-md overflow-hidden space-y-4 p-5">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-base text-zinc-900">پیش‌نمایش صورت‌حساب پورسانت: {activeStatement.visitorName}</h3>
                    {activeStatement.status === 'PREVIEW' && (
                      <span className="bg-amber-100 text-amber-800 border border-amber-300 text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-600" />
                        <span>پیش‌نمایش آماری (بدون اثر در حسابداری)</span>
                      </span>
                    )}
                    {activeStatement.status === 'APPROVED' && (
                      <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>تأییدشده - سند شماره {activeStatement.voucherNumber}</span>
                      </span>
                    )}
                    {activeStatement.status === 'REJECTED' && (
                      <span className="bg-rose-100 text-rose-800 border border-rose-300 text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <XCircle className="w-3 h-3 text-rose-600" />
                        <span>رد شده / بایگانی</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    دوره: {activeStatement.periodTitle} | تاریخ محاسبه: {activeStatement.calculatedAt} | شماره همراه: {activeStatement.visitorMobile}
                  </p>
                </div>

                <div className="text-left font-mono">
                  <div className="text-xs text-zinc-500">شناسه گزارش</div>
                  <div className="text-xs font-bold text-zinc-800">{activeStatement.id}</div>
                </div>
              </div>

              {/* Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200">
                  <span className="text-xs font-bold text-zinc-500 block mb-1">حجم کل فروش نمایندگان</span>
                  <span className="text-lg font-black text-zinc-900 font-mono">
                    {activeStatement.totalSalesAmount.toLocaleString('fa-IR')} <span className="text-xs text-zinc-500 font-sans">ریال</span>
                  </span>
                </div>

                <div className="bg-purple-50/50 p-4 rounded-xl border border-purple-200">
                  <span className="text-xs font-bold text-purple-700 block mb-1">نرخ / فرمول پورسانت</span>
                  <span className="text-lg font-black text-purple-900">
                    {activeStatement.commissionType === 'PERCENTAGE' 
                      ? `${activeStatement.commissionValue}٪ (درصدی)` 
                      : `${activeStatement.commissionValue.toLocaleString('fa-IR')} ریال (مبلغ ثابت)`}
                  </span>
                </div>

                <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200">
                  <span className="text-xs font-bold text-emerald-700 block mb-1">مبلغ پورسانت محاسبه شده</span>
                  <span className="text-xl font-black text-emerald-700 font-mono">
                    {activeStatement.totalCommissionAmount.toLocaleString('fa-IR')} <span className="text-xs text-emerald-600 font-sans">ریال</span>
                  </span>
                </div>
              </div>

              {/* Details Table */}
              <div className="space-y-2">
                <h4 className="font-bold text-xs text-zinc-800 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-zinc-500" />
                  <span>ریز فاکتورهای فروش نمایندگان مرتبط ({activeStatement.details.length.toLocaleString('fa-IR')} مورد)</span>
                </h4>

                {activeStatement.details.length === 0 ? (
                  <div className="bg-zinc-50 p-6 rounded-xl border border-zinc-200 text-center text-xs text-zinc-500">
                    {activeStatement.totalSalesAmount > 0 
                      ? `این محاسبه بر اساس شبیه‌سازی دستی فروش ${activeStatement.totalSalesAmount.toLocaleString('fa-IR')} ریال انجام شد.`
                      : 'هیچ فاکتور فروشی برای نمایندگان تحت پوشش این ویزیتور در سیستم یافت نشد.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-zinc-200 rounded-xl">
                    <table className="w-full text-xs text-right dir-rtl">
                      <thead className="bg-zinc-100 text-zinc-700 font-bold border-b border-zinc-200">
                        <tr>
                          <th className="p-2.5">شماره فاکتور</th>
                          <th className="p-2.5">تاریخ</th>
                          <th className="p-2.5">نماینده خریدار</th>
                          <th className="p-2.5 text-left">مبلغ فاکتور (ریال)</th>
                          <th className="p-2.5 text-left">پورسانت فاکتور (ریال)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200">
                        {activeStatement.details.map((d, i) => (
                          <tr key={i} className="hover:bg-zinc-50">
                            <td className="p-2.5 font-mono font-bold text-indigo-700">{d.invoiceNumber}</td>
                            <td className="p-2.5 text-zinc-600">{d.invoiceDate}</td>
                            <td className="p-2.5">
                              <div className="font-bold text-zinc-900">{d.partnerName}</div>
                              {d.storeName && <div className="text-[10px] text-zinc-500">{d.storeName}</div>}
                            </td>
                            <td className="p-2.5 text-left font-mono font-bold text-zinc-800">{d.invoiceAmount.toLocaleString('fa-IR')}</td>
                            <td className="p-2.5 text-left font-mono font-bold text-emerald-700">{d.commissionAmount.toLocaleString('fa-IR')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Action Buttons for PREVIEW */}
              {activeStatement.status === 'PREVIEW' && (
                <div className="bg-purple-50/60 p-4 rounded-xl border border-purple-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-xs text-purple-900 font-bold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-purple-700 shrink-0" />
                    <span>پس از بررسی واحد مالی، جهت تایید و صدور سند حسابداری بستانکاری روی دکمه مقابل کلیک کنید.</span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleRejectCommissionStatement(activeStatement)}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-100 hover:bg-rose-200 text-rose-800 transition cursor-pointer flex items-center gap-1.5"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>رد گزارش پورسانت</span>
                    </button>

                    <button
                      onClick={() => handleApproveCommissionStatement(activeStatement)}
                      className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition cursor-pointer flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>تأیید و صدور سند حسابداری</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Status Note for APPROVED */}
              {activeStatement.status === 'APPROVED' && (
                <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-200 text-xs text-emerald-900 font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    این گزارش پورسانت با موفقیت تایید شده است. سند حسابداری شماره {activeStatement.voucherNumber} با ثبت بدهکار: هزینه پورسانت و بستانکار: حساب تفصیلی ویزیتور صادر گردید.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* HISTORICAL COMMISSION STATEMENTS */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 space-y-3">
            <h4 className="font-black text-sm text-zinc-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600" />
              <span>تاریخچه گزارش‌های پورسانت صادرشده ({visitorCommissions.length.toLocaleString('fa-IR')} مورد)</span>
            </h4>

            {visitorCommissions.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-400 font-bold bg-zinc-50 rounded-xl border border-zinc-200">
                هیچ گزارش پورسانت قبلی در سیستم ثبت نشده است.
              </div>
            ) : (
              <div className="overflow-x-auto border border-zinc-200 rounded-xl">
                <table className="w-full text-xs text-right dir-rtl">
                  <thead className="bg-zinc-100 text-zinc-700 font-bold border-b border-zinc-200">
                    <tr>
                      <th className="p-3">تاریخ</th>
                      <th className="p-3">نام ویزیتور</th>
                      <th className="p-3">عنوان دوره</th>
                      <th className="p-3 text-left">مبلغ فروش کل</th>
                      <th className="p-3 text-left">مبلغ پورسانت</th>
                      <th className="p-3 text-center">وضعیت</th>
                      <th className="p-3 text-center">شماره سند</th>
                      <th className="p-3 text-center">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {visitorCommissions.map(c => (
                      <tr key={c.id} className="hover:bg-zinc-50">
                        <td className="p-3 font-mono text-zinc-600">{c.calculatedAt}</td>
                        <td className="p-3 font-bold text-zinc-900">{c.visitorName}</td>
                        <td className="p-3 text-zinc-700">{c.periodTitle}</td>
                        <td className="p-3 text-left font-mono font-bold text-zinc-800">{c.totalSalesAmount.toLocaleString('fa-IR')}</td>
                        <td className="p-3 text-left font-mono font-bold text-emerald-700">{c.totalCommissionAmount.toLocaleString('fa-IR')}</td>
                        <td className="p-3 text-center">
                          {c.status === 'APPROVED' && (
                            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full text-[10px] font-bold">تأییدشده</span>
                          )}
                          {c.status === 'PREVIEW' && (
                            <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full text-[10px] font-bold">پیش‌نمایش</span>
                          )}
                          {c.status === 'REJECTED' && (
                            <span className="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full text-[10px] font-bold">رد شده</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-purple-700">
                          {c.voucherNumber ? `#${c.voucherNumber}` : '-'}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => setActiveStatement(c)}
                            className="px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-lg text-[11px] font-bold transition cursor-pointer"
                          >
                            مشاهده جزئیات
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ADD / EDIT VISITOR MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden font-sans dir-rtl">
            <div className="bg-zinc-900 text-white p-4 flex items-center justify-between">
              <h3 className="font-black text-sm flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <span>{editingVisitor ? 'ویرایش اطلاعات ویزیتور' : 'تعریف ویزیتور / بازاریاب جدید'}</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-zinc-400 hover:text-white transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveVisitor} className="p-5 space-y-4">
              <div>
                <label className="text-xs font-bold text-zinc-700 block mb-1">نام و نام خانوادگی بازاریاب *</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: علی احمدی"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-zinc-700 block mb-1">کد ملی (اختیاری)</label>
                  <input
                    type="text"
                    placeholder="10 رقمی"
                    value={nationalId}
                    onChange={e => setNationalId(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-zinc-700 block mb-1">شماره همراه *</label>
                  <input
                    type="text"
                    required
                    placeholder="0912..."
                    value={mobile}
                    onChange={e => setMobile(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-zinc-700 block mb-1">مدل پورسانت</label>
                  <select
                    value={commissionType}
                    onChange={e => setCommissionType(e.target.value as any)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-bold font-sans cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="PERCENTAGE">درصدی (٪ از خرید)</option>
                    <option value="FLAT_AMOUNT">مبلغ ثابت ریالی</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-zinc-700 block mb-1">
                    {commissionType === 'PERCENTAGE' ? 'درصد پورسانت (٪)' : 'مبلغ ثابت (ریال)'}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    required
                    value={commissionValue}
                    onChange={e => setCommissionValue(Number(e.target.value))}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700 block mb-1">وضعیت حساب ویزیتور</label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value as any)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-bold font-sans cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="ACTIVE">فعال</option>
                  <option value="INACTIVE">غیرفعال</option>
                  <option value="SUSPENDED">معلق</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-zinc-700 block mb-1">توضیحات و یادداشت (اختیاری)</label>
                <textarea
                  rows={2}
                  placeholder="یادداشت‌های مدیریتی یا حوزه فعالیت ویزیتور..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-xs font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow transition cursor-pointer"
                >
                  حفظ و ذخیره
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PARTNER ASSIGNMENT SELECTION MODAL */}
      {assigningVisitor && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden font-sans dir-rtl">
            <div className="bg-indigo-950 text-white p-4 flex items-center justify-between">
              <div>
                <h3 className="font-black text-sm flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-indigo-400" />
                  <span>تخصیص نمایندگان به ویزیتور: {assigningVisitor.fullName}</span>
                </h3>
                <p className="text-[11px] text-indigo-300 mt-0.5">کد معرفی: {assigningVisitor.referralCode}</p>
              </div>
              <button
                onClick={() => setAssigningVisitor(null)}
                className="text-indigo-300 hover:text-white transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute right-3 top-3 text-zinc-400" />
                <input
                  type="text"
                  placeholder="جستجو در لیست نمایندگان..."
                  value={partnerSearch}
                  onChange={e => setPartnerSearch(e.target.value)}
                  className="w-full pr-9 pl-3 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="max-h-80 overflow-y-auto border border-zinc-200 rounded-xl divide-y divide-zinc-200">
                {filteredAvailablePartners.length === 0 ? (
                  <div className="p-6 text-center text-xs text-zinc-400 font-bold">
                    هیچ نماینده‌ای یافت نشد.
                  </div>
                ) : (
                  filteredAvailablePartners.map(bp => {
                    const isChecked = selectedPartnerIds.includes(bp.id);
                    return (
                      <label
                        key={bp.id}
                        className={`p-3 flex items-center justify-between hover:bg-indigo-50/50 transition cursor-pointer ${
                          isChecked ? 'bg-indigo-50/80' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e => {
                              if (e.target.checked) {
                                setSelectedPartnerIds(prev => [...prev, bp.id]);
                              } else {
                                setSelectedPartnerIds(prev => prev.filter(id => id !== bp.id));
                              }
                            }}
                            className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer"
                          />
                          <div>
                            <div className="font-black text-xs text-zinc-900">{bp.partnerName}</div>
                            <div className="text-[11px] text-zinc-500">{bp.storeName} (کد: {bp.code})</div>
                          </div>
                        </div>

                        {bp.currentVisitorName && bp.currentVisitorId !== assigningVisitor.id && (
                          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-bold">
                            الان تحت پوشش {bp.currentVisitorName}
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="p-4 bg-zinc-50 border-t border-zinc-200 flex items-center justify-between">
              <span className="text-xs text-zinc-600 font-bold">
                {selectedPartnerIds.length.toLocaleString('fa-IR')} نماینده انتخاب شده است
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAssigningVisitor(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-zinc-200 hover:bg-zinc-300 text-zinc-700 transition cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  onClick={handleSaveAssignments}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow transition cursor-pointer"
                >
                  تایید و تخصیص
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default VisitorNetworkManager;
