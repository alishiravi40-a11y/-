import React, { useState, useEffect } from 'react';
import { 
  FileText, User, Store, Shield, Phone, MapPin, Calendar, CheckCircle2, 
  AlertTriangle, Upload, Save, X, Plus, Trash2, Link as LinkIcon, Lock, Award, History, Building2, Eye, FileCheck
} from 'lucide-react';
import { AppState, BusinessPartner, Person, AgencyType, PartnerRole, NesyehOnboardingProfile, NesyehGuarantee } from '../types';
import { getCurrentJalaliDate, addMonthsToJalali } from '../utils/jalali';
import { recordPartnerCreditRulesChange } from '../utils/partnerProcess';
import { PersonService } from '../services/personService';

interface NesyehPartnerOnboardingModalProps {
  state: AppState;
  partner?: BusinessPartner | null;
  person?: Person | null;
  activeUnit?: 'credit_agents' | 'sales_agents' | 'investors' | 'visitors' | 'contract_partners' | null;
  onClose: () => void;
  onSave: (updatedPartner: BusinessPartner, updatedPerson?: Person) => void;
}

export function NesyehPartnerOnboardingModal({
  state,
  partner,
  person,
  activeUnit,
  onClose,
  onSave
}: NesyehPartnerOnboardingModalProps) {
  const [activeTab, setActiveTab] = useState<'identity' | 'contract' | 'guarantee' | 'referrer' | 'status' | 'dossier' | 'access'>('identity');

  const [agencyTypeState, setAgencyTypeState] = useState<AgencyType>(
    partner?.agencyType || 
    (activeUnit === 'credit_agents' ? AgencyType.CREDIT_ONLY : AgencyType.INSTALLMENT_ONLY)
  );

  const initialPerson = person || (partner ? (state.persons || []).find(p => p.id === partner.personId) : null);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(initialPerson || null);
  const [personSearchQuery, setPersonSearchQuery] = useState('');
  const [isLoadingAgentDetails, setIsLoadingAgentDetails] = useState(false);

  // Form states
  const [formData, setFormData] = useState<{
    partnerName: string;
    storeName: string;
    storeAddress: string;
    code: string;
    mobile: string;
    landlinePhone: string;
    nationalId: string;
    address: string;
    province: string;
    city: string;
    creditLimit: number;
    paymentTermDays: number;
    lateFeePercentage: number;
    startDate: string;
    onboardingStatus: 'DRAFT' | 'COMPLETED_INFO' | 'MANAGER_APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
    confidentialNotes: string;
    referrerName: string;
    referrerMobile: string;
    referrerDescription: string;
    nationalCardAttachment: string;
    storeLicenseAttachment: string;
    contractAttachment: string;
    nesyehPartnerId: string;
    linkCreatedAt: string;
    lastLogin: string;
    isLinkActive: boolean;
  }>({
    partnerName: initialPerson?.name || partner?.profile?.partnerName || '',
    storeName: partner?.profile?.storeName || initialPerson?.agentDetails?.storeName || '',
    storeAddress: (partner?.profile as any)?.storeAddress || initialPerson?.agentDetails?.storeAddress || '',
    code: initialPerson?.code || partner?.id || `NS-${Math.floor(1000 + Math.random() * 9000)}`,
    mobile: initialPerson?.mobile || '',
    landlinePhone: partner?.nesyehOnboarding?.landlinePhone || initialPerson?.phone || '',
    nationalId: initialPerson?.nationalId || partner?.nesyehOnboarding?.nationalId || '',
    address: initialPerson?.address || partner?.nesyehOnboarding?.address || '',
    province: partner?.nesyehOnboarding?.province || '',
    city: partner?.nesyehOnboarding?.city || '',
    creditLimit: partner?.salesExtension?.nesyehSettings?.creditLimit || partner?.nesyehSettings?.creditLimit || partner?.profile?.creditLimit || 1,
    paymentTermDays: partner?.salesExtension?.nesyehSettings?.paymentTermDays || partner?.nesyehSettings?.paymentTermDays || 3,
    lateFeePercentage: partner?.salesExtension?.nesyehSettings?.lateFeePercentage !== undefined ? partner.salesExtension.nesyehSettings.lateFeePercentage : (partner?.nesyehSettings?.lateFeePercentage !== undefined ? partner.nesyehSettings.lateFeePercentage : 0.5),
    startDate: partner?.nesyehOnboarding?.startDate || new Intl.DateTimeFormat('fa-IR-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    onboardingStatus: partner?.nesyehOnboarding?.onboardingStatus || 'DRAFT',
    confidentialNotes: partner?.nesyehOnboarding?.confidentialNotes || '',
    referrerName: partner?.nesyehOnboarding?.referrer?.name || '',
    referrerMobile: partner?.nesyehOnboarding?.referrer?.mobile || '',
    referrerDescription: partner?.nesyehOnboarding?.referrer?.description || '',
    nationalCardAttachment: partner?.nesyehOnboarding?.nationalCardAttachment || 'national_card.jpg',
    storeLicenseAttachment: partner?.nesyehOnboarding?.storeLicenseAttachment || 'store_license.pdf',
    contractAttachment: partner?.nesyehOnboarding?.contractAttachment || 'contract.pdf',
    nesyehPartnerId: partner?.nesyehOnboarding?.nesyehPartnerId || `nesyeh_${Math.random().toString(36).substring(2, 10)}`,
    linkCreatedAt: partner?.nesyehOnboarding?.linkCreatedAt || new Date().toISOString().split('T')[0],
    lastLogin: partner?.nesyehOnboarding?.lastLogin || 'هنوز وارد نشده',
    isLinkActive: partner?.nesyehOnboarding?.isLinkActive !== undefined ? partner.nesyehOnboarding.isLinkActive : true
  });

  // Automatically hydrate store name and store address directly from database on modal load/change
  useEffect(() => {
    let isMounted = true;
    if (!selectedPerson?.id) return;

    const hydrateDetails = async () => {
      setIsLoadingAgentDetails(true);
      try {
        const details = await PersonService.getAgentDetails(selectedPerson.id);
        if (!isMounted) return;
        if (details) {
          const storeName = details.store_name || details.storeName || '';
          const storeAddress = details.store_address || details.storeAddress || '';
          setFormData(prev => ({
            ...prev,
            storeName: storeName || prev.storeName,
            storeAddress: storeAddress || prev.storeAddress,
            address: prev.address || storeAddress || '',
          }));
        }
      } catch (err) {
        console.error('Failed to hydrate agent details from database on modal load:', err);
      } finally {
        if (isMounted) {
          setIsLoadingAgentDetails(false);
        }
      }
    };

    hydrateDetails();

    return () => {
      isMounted = false;
    };
  }, [selectedPerson?.id]);

  // Guarantees state
  const [guarantees, setGuarantees] = useState<NesyehGuarantee[]>(partner?.nesyehOnboarding?.guarantees || []);
  const [newGuarantee, setNewGuarantee] = useState<Partial<NesyehGuarantee>>({
    type: 'CHECK',
    amount: 100000000,
    checkNumber: '',
    sayadId: '',
    bankName: 'بانک ملی ایران',
    issueDate: getCurrentJalaliDate(),
    dueDate: addMonthsToJalali(getCurrentJalaliDate(), 3),
    description: 'چک ضمانت حسن انجام تعهدات قرارداد نسیه',
    attachmentUrl: 'guarantee_check.jpg'
  });

  // Status History
  const [statusHistory, setStatusHistory] = useState(
    partner?.nesyehOnboarding?.statusHistory || [
      {
        status: partner?.nesyehOnboarding?.onboardingStatus || 'DRAFT',
        date: new Date().toLocaleDateString('fa-IR'),
        userName: 'مدیر سیستم',
        comment: 'ایجاد و افتتاح پرونده هوشمند ثبت‌نام'
      }
    ]
  );

  const [previewFile, setPreviewFile] = useState<string | null>(null);

  const handleAddGuarantee = () => {
    const item: NesyehGuarantee = {
      id: `G-${Date.now()}`,
      type: newGuarantee.type || 'CHECK',
      amount: Number(newGuarantee.amount) || 0,
      checkNumber: newGuarantee.checkNumber || '',
      sayadId: newGuarantee.sayadId || '',
      bankName: newGuarantee.bankName || '',
      issueDate: newGuarantee.issueDate || '',
      dueDate: newGuarantee.dueDate || '',
      description: newGuarantee.description || '',
      attachmentUrl: newGuarantee.attachmentUrl || 'guarantee_doc.pdf',
      createdAt: new Date().toISOString().split('T')[0]
    };
    setGuarantees([...guarantees, item]);
    setNewGuarantee({
      type: 'CHECK',
      amount: 100000000,
      checkNumber: '',
      sayadId: '',
      bankName: 'بانک ملی ایران',
      issueDate: getCurrentJalaliDate(),
      dueDate: addMonthsToJalali(getCurrentJalaliDate(), 3),
      description: 'چک ضمانت حسن انجام تعهدات قرارداد نسیه',
      attachmentUrl: 'guarantee_check.jpg'
    });
  };

  const handleRemoveGuarantee = (id: string) => {
    setGuarantees(guarantees.filter(g => g.id !== id));
  };

  const handleStatusChange = (newStatus: 'DRAFT' | 'COMPLETED_INFO' | 'MANAGER_APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED') => {
    setFormData({ ...formData, onboardingStatus: newStatus });
    setStatusHistory([
      {
        status: newStatus,
        date: new Date().toLocaleDateString('fa-IR'),
        userName: 'مدیر سیستم',
        comment: `تغییر وضعیت پرونده به حالت: ${newStatus}`
      },
      ...statusHistory
    ]);
  };

  const handleDocumentUpload = (docKey: 'nationalCardAttachment' | 'storeLicenseAttachment' | 'contractAttachment', fileName: string) => {
    setFormData({ ...formData, [docKey]: fileName });
  };

  const handleSaveAll = () => {
    if (!selectedPerson) {
      alert('لطفاً ابتدا شخص مورد نظر را از پرونده‌های سیستم انتخاب کنید.');
      setActiveTab('identity');
      return;
    }
    if (!formData.partnerName.trim()) {
      alert('نام و نام خانوادگی شخص الزامی است.');
      return;
    }

    const targetPersonId = selectedPerson.id;
    const existingBp = (state.businessPartners || []).find(bp => bp.personId === targetPersonId);
    const targetBp = partner || existingBp;
    const targetPartnerId = targetBp ? targetBp.id : `BP-NS-${Date.now()}`;

    // Single Source of Truth: Updated Person object
    const updatedPerson: Person = {
      ...selectedPerson,
      name: formData.partnerName.trim(),
      nationalId: formData.nationalId.trim(),
      mobile: formData.mobile.trim(),
      phone: formData.landlinePhone.trim(),
      address: formData.address.trim(),
      province: formData.province.trim(),
      city: formData.city.trim(),
      agentDetails: {
        storeName: formData.storeName.trim(),
        storeAddress: (formData.storeAddress || formData.address || '').trim(),
        guarantors: selectedPerson.agentDetails?.guarantors || [],
        guaranteeChecks: selectedPerson.agentDetails?.guaranteeChecks || [],
      },
      updatedAt: new Date().toISOString()
    };

    const onboardingProfile: NesyehOnboardingProfile = {
      onboardingStatus: formData.onboardingStatus,
      nesyehPartnerId: formData.nesyehPartnerId,
      linkCreatedAt: formData.linkCreatedAt,
      lastLogin: formData.lastLogin,
      isLinkActive: formData.isLinkActive,
      nationalId: updatedPerson.nationalId,
      landlinePhone: updatedPerson.phone,
      address: updatedPerson.address,
      province: updatedPerson.province,
      city: updatedPerson.city,
      nationalCardAttachment: formData.nationalCardAttachment,
      storeLicenseAttachment: formData.storeLicenseAttachment,
      contractAttachment: formData.contractAttachment,
      guarantees,
      referrer: {
        name: formData.referrerName,
        mobile: formData.referrerMobile,
        description: formData.referrerDescription
      },
      statusHistory,
      startDate: formData.startDate,
      confidentialNotes: formData.confidentialNotes
    };

    // Determine roles based on agencyTypeState
    let updatedRoles: any[] = targetBp ? [...(targetBp.roles || [])] : [];
    if (agencyTypeState === AgencyType.CREDIT_ONLY) {
      updatedRoles = updatedRoles.filter(r => r !== 'DEFERRED_AGENT' && r !== 'DEFERRED_PAYMENT');
      if (!updatedRoles.includes('CREDIT_AGENT')) updatedRoles.push('CREDIT_AGENT');
      if (!updatedRoles.includes(PartnerRole.CREDIT_SALES_AGENT)) updatedRoles.push(PartnerRole.CREDIT_SALES_AGENT);
    } else if (agencyTypeState === AgencyType.INSTALLMENT_ONLY) {
      updatedRoles = updatedRoles.filter(r => r !== 'CREDIT_AGENT' && r !== 'CREDIT_SALES_AGENT' && r !== PartnerRole.CREDIT_SALES_AGENT);
      if (!updatedRoles.includes('DEFERRED_AGENT')) updatedRoles.push('DEFERRED_AGENT');
    } else if (agencyTypeState === AgencyType.BOTH) {
      if (!updatedRoles.includes('DEFERRED_AGENT')) updatedRoles.push('DEFERRED_AGENT');
      if (!updatedRoles.includes('CREDIT_AGENT')) updatedRoles.push('CREDIT_AGENT');
      if (!updatedRoles.includes(PartnerRole.CREDIT_SALES_AGENT)) updatedRoles.push(PartnerRole.CREDIT_SALES_AGENT);
    }

    const updatedBp: BusinessPartner = targetBp ? {
      ...targetBp,
      personId: targetPersonId,
      agencyType: agencyTypeState,
      roles: Array.from(new Set(updatedRoles)),
      profile: {
        ...targetBp.profile,
        partnerName: updatedPerson.name,
        storeName: formData.storeName || targetBp.profile?.storeName || '',
        contractStatus: formData.onboardingStatus === 'ACTIVE' ? 'active' : (targetBp.profile?.contractStatus || 'suspended'),
        creditLimit: formData.creditLimit
      },
      nesyehSettings: {
        creditLimit: formData.creditLimit,
        paymentTermDays: formData.paymentTermDays,
        lateFeePercentage: formData.lateFeePercentage,
        isPurchaseAllowed: formData.onboardingStatus === 'ACTIVE',
        contractNotes: formData.confidentialNotes
      },
      creditExtension: recordPartnerCreditRulesChange(
        targetBp,
        {
          ...(targetBp.creditExtension?.creditRules || {}),
          maxCreditLimit: formData.creditLimit,
          defaultInstallmentDays: formData.paymentTermDays,
          penaltyRatePerMonth: formData.lateFeePercentage
        },
        { changeReason: 'به‌روزرسانی آنبوردینگ همکار نسیه' }
      ),
      salesExtension: {
        ...(targetBp.salesExtension || {}),
        nesyehSettings: {
          creditLimit: formData.creditLimit,
          paymentTermDays: formData.paymentTermDays,
          lateFeePercentage: formData.lateFeePercentage,
          isPurchaseAllowed: formData.onboardingStatus === 'ACTIVE',
          contractNotes: formData.confidentialNotes
        }
      },
      nesyehOnboarding: onboardingProfile
    } : {
      id: targetPartnerId,
      personId: targetPersonId,
      status: 'active',
      agencyType: agencyTypeState,
      roles: Array.from(new Set(updatedRoles)),
      profile: {
        partnerId: targetPartnerId,
        partnerName: updatedPerson.name,
        storeName: formData.storeName,
        contractStatus: 'active',
        creditLimit: formData.creditLimit
      },
      creditExtension: recordPartnerCreditRulesChange(
        { id: targetPartnerId },
        {
          maxCreditLimit: formData.creditLimit,
          defaultInstallmentDays: formData.paymentTermDays,
          penaltyRatePerMonth: formData.lateFeePercentage
        },
        { changeReason: 'ایجاد و آنبوردینگ همکار نسیه جدید' }
      ),
      branches: [],
      nesyehSettings: {
        creditLimit: formData.creditLimit,
        paymentTermDays: formData.paymentTermDays,
        lateFeePercentage: formData.lateFeePercentage,
        isPurchaseAllowed: true,
        contractNotes: formData.confidentialNotes
      },
      salesExtension: {
        nesyehSettings: {
          creditLimit: formData.creditLimit,
          paymentTermDays: formData.paymentTermDays,
          lateFeePercentage: formData.lateFeePercentage,
          isPurchaseAllowed: true,
          contractNotes: formData.confidentialNotes
        }
      },
      nesyehOnboarding: onboardingProfile,
      createdAt: new Date().toISOString(),
      createdBy: 'Admin'
    };

    onSave(updatedBp, updatedPerson);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white rounded-3xl max-w-4xl w-full p-6 shadow-2xl border border-teal-500/30 text-right space-y-6 max-h-[92vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-500/20 text-teal-700 border border-teal-500/40 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-zinc-900">پرونده قرارداد و تنظیمات اعتباری نماینده</h2>
              <p className="text-xs text-zinc-500">انتخاب شخص موجود از پرونده‌های مرکزی و تنظیم شرایط همکاری</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-500 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-zinc-100">
          <button
            onClick={() => setActiveTab('identity')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'identity' ? 'bg-teal-600 text-white shadow-md shadow-teal-500/20' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            ۱. انتخاب شخص و اطلاعات فروشگاه
          </button>
          <button
            onClick={() => setActiveTab('contract')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'contract' ? 'bg-teal-600 text-white shadow-md shadow-teal-500/20' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            ۲. اطلاعات قرارداد و سیاست‌ها
          </button>
          <button
            onClick={() => setActiveTab('guarantee')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'guarantee' ? 'bg-teal-600 text-white shadow-md shadow-teal-500/20' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            ۳. چک‌ها و ضمانت‌ها ({guarantees.length})
          </button>
          <button
            onClick={() => setActiveTab('referrer')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'referrer' ? 'bg-teal-600 text-white shadow-md shadow-teal-500/20' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            ۴. معرف نماینده
          </button>
          <button
            onClick={() => setActiveTab('status')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'status' ? 'bg-teal-600 text-white shadow-md shadow-teal-500/20' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            ۵. چرخه وضعیت پرونده
          </button>
          <button
            onClick={() => setActiveTab('dossier')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'dossier' ? 'bg-teal-600 text-white shadow-md shadow-teal-500/20' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            ۶. پرونده دیجیتال جامع
          </button>
          <button
            onClick={() => setActiveTab('access')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeTab === 'access' ? 'bg-teal-600 text-white shadow-md shadow-teal-500/20' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            <LinkIcon className="w-3.5 h-3.5" />
            ۷. دسترسی و لینک اختصاصی
          </button>
        </div>

        {/* Tab 1: Identity & Operational Documents */}
        {activeTab === 'identity' && (
          <div className="space-y-5 animate-fadeIn">
            {!selectedPerson ? (
              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl text-xs text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <User className="w-4 h-4 text-amber-700" />
                    مرحله اول: انتخاب شخص از پرونده‌های موجود سیستم (بدون ثبت‌نام جدید)
                  </div>
                  <div>لطفاً شخص مورد نظر را از لیست زیر انتخاب کنید. اطلاعات هویتی از پرونده اصلی استخراج خواهد شد.</div>
                </div>
                <div>
                  <input
                    type="text"
                    placeholder="جستجو بر اساس نام، کد شخص، کد ملی یا شماره موبایل..."
                    value={personSearchQuery}
                    onChange={e => setPersonSearchQuery(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 p-3 rounded-xl text-xs outline-none focus:border-teal-500 transition-all"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto space-y-2 border border-zinc-200 rounded-2xl p-3 bg-zinc-50">
                  {(state.persons || [])
                    .filter((p, index, self) => index === self.findIndex(t => t.id === p.id))
                    .filter(p => {
                      const q = personSearchQuery.trim();
                      if (!q) return true;
                      return (
                        p.name.includes(q) ||
                        p.code.includes(q) ||
                        (p.nationalId && p.nationalId.includes(q)) ||
                        (p.mobile && p.mobile.includes(q))
                      );
                    })
                    .map(p => {
                      const existingBp = (state.businessPartners || []).find(bp => bp.personId === p.id);
                      const isAlreadySalesPartner = Boolean(
                        existingBp && (
                          existingBp.agencyType === AgencyType.INSTALLMENT_ONLY ||
                          existingBp.agencyType === AgencyType.BOTH ||
                          (existingBp.roles || []).includes('DEFERRED_AGENT' as any)
                        )
                      );

                      const isAlreadyCreditPartner = Boolean(
                        existingBp && (
                          existingBp.agencyType === AgencyType.CREDIT_ONLY ||
                          existingBp.agencyType === AgencyType.BOTH ||
                          (existingBp.roles || []).includes(PartnerRole.CREDIT_SALES_AGENT) ||
                          (existingBp.roles || []).includes('CREDIT_AGENT' as any)
                        )
                      );

                      const isAlreadyTargetPartner = activeUnit === 'sales_agents' ? isAlreadySalesPartner : isAlreadyCreditPartner;

                      return (
                        <div
                          key={p.id}
                          className={`p-3.5 rounded-xl border flex justify-between items-center transition shadow-sm ${
                            isAlreadyTargetPartner 
                              ? 'bg-zinc-100 border-zinc-200 cursor-not-allowed opacity-70' 
                              : 'bg-white border-zinc-200 hover:border-teal-500 cursor-pointer'
                          }`}
                          onClick={() => {
                            if (isAlreadyTargetPartner) {
                              alert(activeUnit === 'sales_agents' 
                                ? 'این شخص قبلاً دارای پرونده نمایندگی فروش می‌باشد. ایجاد پرونده فروش تکراری برای یک شخص امکان‌پذیر نیست.'
                                : 'این شخص قبلاً دارای پرونده نمایندگی اعتباری می‌باشد. ایجاد پرونده اعتباری تکراری برای یک شخص امکان‌پذیر نیست.'
                              );
                              return;
                            }
                            setSelectedPerson(p);
                            
                            // Automatically determine the combined/single agency type when selecting person
                            if (activeUnit === 'sales_agents') {
                              setAgencyTypeState(isAlreadyCreditPartner ? AgencyType.BOTH : AgencyType.INSTALLMENT_ONLY);
                            } else {
                              setAgencyTypeState(isAlreadySalesPartner ? AgencyType.BOTH : AgencyType.CREDIT_ONLY);
                            }

                            setFormData(prev => ({
                              ...prev,
                              partnerName: p.name,
                              code: p.code,
                              mobile: p.mobile || '',
                              landlinePhone: p.phone || '',
                              nationalId: p.nationalId || '',
                              address: p.address || '',
                              province: p.province || '',
                              city: p.city || '',
                              storeName: existingBp?.profile?.storeName || p.agentDetails?.storeName || '',
                              storeAddress: (existingBp?.profile as any)?.storeAddress || p.agentDetails?.storeAddress || p.address || ''
                            }));
                          }}
                        >
                          <div>
                            <div className="font-bold text-zinc-900 text-xs flex items-center gap-2">
                              {p.name}
                              {isAlreadyTargetPartner && (
                                <span className="text-[10px] bg-red-100 text-red-800 border border-red-200 px-2 py-0.5 rounded font-bold">
                                  {activeUnit === 'sales_agents' ? 'پرونده فروش فعال دارد' : 'پرونده اعتباری فعال دارد'}
                                </span>
                              )}
                              {!isAlreadyTargetPartner && (activeUnit === 'sales_agents' ? isAlreadyCreditPartner : isAlreadySalesPartner) && (
                                <span className="text-[10px] bg-indigo-100 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded font-bold">
                                  {activeUnit === 'sales_agents' ? 'نماینده اعتباری (امکان افزودن نقش فروش)' : 'نماینده فروش (امکان افزودن نقش اعتباری)'}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-500 font-mono mt-1">
                              کد شخص: {p.code} | کد ملی: {p.nationalId || 'ثبت نشده'} | موبایل: {p.mobile || 'ثبت نشده'}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={isAlreadyTargetPartner}
                            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-sm ${
                              isAlreadyTargetPartner 
                                ? 'bg-zinc-200 text-zinc-500 cursor-not-allowed' 
                                : (activeUnit === 'sales_agents' ? isAlreadyCreditPartner : isAlreadySalesPartner)
                                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                  : 'bg-teal-600 hover:bg-teal-700 text-white'
                            }`}
                          >
                            {isAlreadyTargetPartner 
                              ? 'ثبت شده (تکراری)' 
                              : (activeUnit === 'sales_agents' ? isAlreadyCreditPartner : isAlreadySalesPartner) 
                                ? (activeUnit === 'sales_agents' ? 'انتخاب و افزودن نقش فروش' : 'انتخاب و افزودن نقش اعتباری') 
                                : 'انتخاب این شخص'
                            }
                          </button>
                        </div>
                      );
                    })}
                  {(state.persons || []).length === 0 && (
                    <div className="text-center py-10 text-zinc-400 text-xs">هیچ شخصی در سیستم ثبت نشده است.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200 space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      اطلاعات هویتی شخص مرجع (Single Source of Truth - قابل تکمیل و ویرایش):
                    </div>
                    {!partner && (
                      <button
                        type="button"
                        onClick={() => setSelectedPerson(null)}
                        className="text-xs text-indigo-600 font-bold hover:underline bg-white px-3 py-1 rounded-lg border border-indigo-200 shadow-sm cursor-pointer"
                      >
                        تغییر شخص
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1 bg-white/90 p-4 rounded-xl border border-emerald-100">
                    <div>
                      <label className="block text-zinc-600 mb-1 font-semibold">نام و نام خانوادگی: <span className="text-rose-500">*</span></label>
                      <input
                        type="text"
                        value={formData.partnerName}
                        onChange={e => setFormData({ ...formData, partnerName: e.target.value })}
                        className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-bold text-zinc-900 focus:outline-none focus:border-teal-500"
                        placeholder="نام کامل شخص"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-600 mb-1 font-semibold">کد ملی:</label>
                      <input
                        type="text"
                        value={formData.nationalId}
                        onChange={e => setFormData({ ...formData, nationalId: e.target.value })}
                        className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-mono text-zinc-900 focus:outline-none focus:border-teal-500"
                        placeholder="کد ملی ۱۰ رقمی"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-600 mb-1 font-semibold">شماره همراه:</label>
                      <input
                        type="tel"
                        value={formData.mobile}
                        onChange={e => setFormData({ ...formData, mobile: e.target.value })}
                        className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-mono text-zinc-900 focus:outline-none focus:border-teal-500"
                        placeholder="09123456789"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-white/90 p-4 rounded-xl border border-emerald-100">
                    <div>
                      <label className="block text-zinc-600 mb-1 font-semibold">تلفن ثابت / تماس:</label>
                      <input
                        type="tel"
                        value={formData.landlinePhone}
                        onChange={e => setFormData({ ...formData, landlinePhone: e.target.value })}
                        className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-mono text-zinc-900 focus:outline-none focus:border-teal-500"
                        placeholder="02188888888"
                      />
                    </div>
                    <div>
                      <label className="block text-zinc-600 mb-1 font-semibold">استان / شهر:</label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={formData.province}
                          onChange={e => setFormData({ ...formData, province: e.target.value })}
                          className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-medium focus:outline-none focus:border-teal-500"
                          placeholder="استان"
                        />
                        <input
                          type="text"
                          value={formData.city}
                          onChange={e => setFormData({ ...formData, city: e.target.value })}
                          className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-medium focus:outline-none focus:border-teal-500"
                          placeholder="شهر"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-zinc-600 mb-1 font-semibold">کد شخص در سیستم:</label>
                      <input
                        type="text"
                        disabled
                        value={selectedPerson.code}
                        className="w-full bg-zinc-100 border border-zinc-200 p-2.5 rounded-xl font-mono text-zinc-500 cursor-not-allowed"
                      />
                    </div>
                    <div className="col-span-1 md:col-span-3">
                      <label className="block text-zinc-600 mb-1 font-semibold">آدرس کامل:</label>
                      <input
                        type="text"
                        value={formData.address}
                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                        className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl text-zinc-900 focus:outline-none focus:border-teal-500"
                        placeholder="آدرس پستی کامل شخص..."
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block text-zinc-600 mb-1 font-semibold flex items-center justify-between">
                      <span>نام فروشگاه / شعبه: <span className="text-zinc-400 font-normal">(اختیاری)</span></span>
                      {isLoadingAgentDetails && (
                        <span className="text-[10px] text-teal-600 font-normal animate-pulse">در حال همگام‌سازی از سرور...</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={formData.storeName}
                      onChange={e => setFormData({ ...formData, storeName: e.target.value })}
                      className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-medium focus:outline-none focus:border-teal-500 text-zinc-900"
                      placeholder="مثال: فروشگاه مرکزی..."
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-600 mb-1 font-semibold">آدرس فروشگاه / محل کسب: <span className="text-zinc-400 font-normal">(اختیاری)</span></label>
                    <input
                      type="text"
                      value={formData.storeAddress}
                      onChange={e => setFormData({ ...formData, storeAddress: e.target.value })}
                      className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-medium focus:outline-none focus:border-teal-500 text-zinc-900"
                      placeholder="مثال: تهران، خیابان ولیعصر، پلاک ۱..."
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Operational Document Upload Section */}
            <div className="pt-4 border-t border-zinc-100 space-y-3">
              <h4 className="text-xs font-bold text-zinc-700 flex items-center gap-1.5">
                <FileCheck className="w-4 h-4 text-teal-600" />
                بارگذاری و مدیریت مدارک هویتی و صنفی (عملیاتی)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* National Card */}
                <div className="bg-zinc-50 border border-zinc-200 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-800">تصویر کارت ملی</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">بارگذاری شده</span>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-500 truncate">{formData.nationalCardAttachment}</div>
                  <div className="flex items-center gap-2">
                    <label className="flex-1 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 text-center py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors">
                      تغییر فایل
                      <input 
                        type="file" 
                        className="hidden" 
                        onChange={e => {
                          if (e.target.files && e.target.files[0]) {
                            handleDocumentUpload('nationalCardAttachment', e.target.files[0].name);
                          }
                        }} 
                      />
                    </label>
                    <button 
                      type="button"
                      onClick={() => setPreviewFile(formData.nationalCardAttachment)}
                      className="px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 rounded-lg text-xs font-bold cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Store License */}
                <div className="bg-zinc-50 border border-zinc-200 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-800">جواز کسب / مدارک صنفی</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">بارگذاری شده</span>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-500 truncate">{formData.storeLicenseAttachment}</div>
                  <div className="flex items-center gap-2">
                    <label className="flex-1 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 text-center py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors">
                      تغییر فایل
                      <input 
                        type="file" 
                        className="hidden" 
                        onChange={e => {
                          if (e.target.files && e.target.files[0]) {
                            handleDocumentUpload('storeLicenseAttachment', e.target.files[0].name);
                          }
                        }} 
                      />
                    </label>
                    <button 
                      type="button"
                      onClick={() => setPreviewFile(formData.storeLicenseAttachment)}
                      className="px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 rounded-lg text-xs font-bold cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Contract Document */}
                <div className="bg-zinc-50 border border-zinc-200 p-4 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-800">قرارداد امضا شده همکاری</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded">بارگذاری شده</span>
                  </div>
                  <div className="text-[11px] font-mono text-zinc-500 truncate">{formData.contractAttachment}</div>
                  <div className="flex items-center gap-2">
                    <label className="flex-1 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 text-center py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors">
                      تغییر فایل
                      <input 
                        type="file" 
                        className="hidden" 
                        onChange={e => {
                          if (e.target.files && e.target.files[0]) {
                            handleDocumentUpload('contractAttachment', e.target.files[0].name);
                          }
                        }} 
                      />
                    </label>
                    <button 
                      type="button"
                      onClick={() => setPreviewFile(formData.contractAttachment)}
                      className="px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 rounded-lg text-xs font-bold cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Contract Info & Numerical Policies with Decimal Late Fee */}
        {activeTab === 'contract' && (
          <div className="space-y-4 animate-fadeIn">
            <h3 className="text-xs font-bold text-zinc-700 flex items-center gap-2 border-b border-zinc-100 pb-2">
              <Award className="w-4 h-4 text-teal-600" />
              تنظیمات سیاست اعتباری و قرارداد نسیه (با اعداد اعشاری دقیق و ورودی عدد واقعی)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block text-zinc-600 mb-1 font-semibold">سقف خرید نسیه (ریال):</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formData.creditLimit !== undefined ? Number(formData.creditLimit).toLocaleString('en-US') : '0'}
                  onChange={e => {
                    const rawValue = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '');
                    const numValue = rawValue ? parseInt(rawValue, 10) : 0;
                    setFormData({ ...formData, creditLimit: numValue });
                  }}
                  className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-mono font-bold text-teal-700 focus:outline-none focus:border-teal-500 text-left"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-zinc-600 mb-1 font-semibold">مهلت تسویه مجاز:</label>
                <select
                  value={formData.paymentTermDays}
                  onChange={e => setFormData({ ...formData, paymentTermDays: Number(e.target.value) })}
                  className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-mono font-bold text-zinc-800 focus:outline-none focus:border-teal-500 cursor-pointer"
                >
                  {Array.from({ length: 30 }, (_, i) => i + 1).map(day => (
                    <option key={day} value={day}>{day} روزه</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-zinc-600 mb-1 font-semibold">درصد جریمه تاخیر ماهانه (٪):</label>
                <select
                  value={formData.lateFeePercentage}
                  onChange={e => setFormData({ ...formData, lateFeePercentage: parseFloat(e.target.value) || 0.5 })}
                  className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-mono font-bold text-amber-700 focus:outline-none focus:border-teal-500 cursor-pointer text-left"
                  dir="ltr"
                >
                  {Array.from({ length: 20 }, (_, i) => {
                    const val = parseFloat(((i + 1) * 0.1).toFixed(1));
                    return (
                      <option key={val} value={val}>
                        {val} %
                      </option>
                    );
                  })}
                </select>
                <span className="text-[10px] text-zinc-400 mt-1 block">انتخاب نرخ جریمه دیرکرد از ۰.۱٪ تا ۲.۰٪ (پیش‌فرض ۰.۵٪)</span>
              </div>
              <div>
                <label className="block text-zinc-600 mb-1 font-semibold">تاریخ شروع قرارداد:</label>
                <input
                  type="text"
                  value={formData.startDate}
                  onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                  className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-mono focus:outline-none focus:border-teal-500 text-left"
                  dir="ltr"
                  placeholder="۱۴۰۵/۰۱/۰۱"
                />
              </div>
              <div>
                <label className="block text-zinc-600 mb-1 font-semibold">نوع نقش نمایندگی:</label>
                <select
                  value={agencyTypeState}
                  onChange={e => setAgencyTypeState(e.target.value as AgencyType)}
                  className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-bold text-zinc-850 focus:outline-none focus:border-teal-500 cursor-pointer"
                >
                  <option value={AgencyType.INSTALLMENT_ONLY}>نماینده فروش (Sales Agent)</option>
                  <option value={AgencyType.CREDIT_ONLY}>نماینده اعتباری (Credit Agent)</option>
                  <option value={AgencyType.BOTH}>هر دو نقش (Sales & Credit Agent)</option>
                </select>
              </div>
              <div>
                <label className="block text-zinc-600 mb-1 font-semibold">وضعیت قرارداد:</label>
                <select
                  value={formData.onboardingStatus}
                  onChange={e => handleStatusChange(e.target.value as any)}
                  className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-bold text-zinc-800 focus:outline-none focus:border-teal-500 cursor-pointer"
                >
                  <option value="DRAFT">پیش‌نویس ثبت‌نام</option>
                  <option value="COMPLETED_INFO">تکمیل اطلاعات</option>
                  <option value="MANAGER_APPROVED">تایید مدیریت</option>
                  <option value="ACTIVE">فعال</option>
                  <option value="SUSPENDED">تعلیق شده</option>
                  <option value="TERMINATED">پایان همکاری</option>
                </select>
              </div>
              <div className="md:col-span-3">
                <label className="block text-zinc-600 mb-1 font-semibold flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-amber-600" />
                  یادداشت‌ها و شرایط محرمانه مدیریت:
                </label>
                <textarea
                  value={formData.confidentialNotes}
                  onChange={e => setFormData({ ...formData, confidentialNotes: e.target.value })}
                  rows={3}
                  className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-medium focus:outline-none focus:border-teal-500 text-xs"
                  placeholder="شرایط ویژه سقف اعتباری، تخفیفات پلکانی یا توافقات خاص..."
                ></textarea>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Guarantees & Checks */}
        {activeTab === 'guarantee' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl text-xs text-amber-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>توجه: ضمانت‌های ثبت شده در این بخش صرفاً «شناسنامه ضمانت قرارداد» بوده و وارد چرخه حسابداری اسناد دریافتی نمی‌شوند تا زمانی که مدیریت تصمیم دیگری اتخاذ کند.</span>
            </div>

            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-3">
              <h4 className="text-xs font-bold text-zinc-800">ثبت چک ضمانت جدید (با شناسه صیادی و سررسید)</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-zinc-600 mb-1">نوع ضمانت:</label>
                  <select
                    value={newGuarantee.type}
                    onChange={e => setNewGuarantee({ ...newGuarantee, type: e.target.value as any })}
                    className="w-full bg-white border border-zinc-200 p-2 rounded-xl"
                  >
                    <option value="CHECK">چک ضمانت</option>
                    <option value="PROMISSORY_NOTE">سفته</option>
                    <option value="OTHER">سایر اسناد ضمانتی</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1">مبلغ ضمانت (ریال):</label>
                  <input
                    type="number"
                    step="1000000"
                    inputMode="numeric"
                    value={newGuarantee.amount}
                    onChange={e => setNewGuarantee({ ...newGuarantee, amount: Number(e.target.value) })}
                    className="w-full bg-white border border-zinc-200 p-2 rounded-xl font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1">شماره چک:</label>
                  <input
                    type="text"
                    value={newGuarantee.checkNumber}
                    onChange={e => setNewGuarantee({ ...newGuarantee, checkNumber: e.target.value })}
                    className="w-full bg-white border border-zinc-200 p-2 rounded-xl font-mono"
                    placeholder="مثال: 458921"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1">شناسه صیادی (۱۶ رقمی):</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={newGuarantee.sayadId}
                    onChange={e => setNewGuarantee({ ...newGuarantee, sayadId: e.target.value })}
                    className="w-full bg-white border border-zinc-200 p-2 rounded-xl font-mono"
                    placeholder="1234567890123456"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1">بانک صادرکننده:</label>
                  <input
                    type="text"
                    value={newGuarantee.bankName}
                    onChange={e => setNewGuarantee({ ...newGuarantee, bankName: e.target.value })}
                    className="w-full bg-white border border-zinc-200 p-2 rounded-xl"
                    placeholder="بانک ملی، ملت..."
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 mb-1">تاریخ سررسید:</label>
                  <input
                    type="text"
                    value={newGuarantee.dueDate || ''}
                    onChange={e => setNewGuarantee({ ...newGuarantee, dueDate: e.target.value })}
                    className="w-full bg-white border border-zinc-200 p-2 rounded-xl font-mono text-left"
                    dir="ltr"
                    placeholder="۱۴۰۵/۰۱/۰۱"
                  />
                </div>
                <div className="md:col-span-3 flex items-center justify-between gap-3">
                  <input
                    type="text"
                    value={newGuarantee.description}
                    onChange={e => setNewGuarantee({ ...newGuarantee, description: e.target.value })}
                    placeholder="توضیحات ضمانت (مثلاً ضمانت تعهدات خرید نسیه دوره اول)..."
                    className="flex-1 bg-white border border-zinc-200 p-2 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={handleAddGuarantee}
                    className="bg-teal-600 hover:bg-teal-700 text-white font-bold px-6 py-2 rounded-xl transition-all flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Plus className="w-4 h-4" /> افزودن چک به پرونده
                  </button>
                </div>
              </div>
            </div>

            {/* List of guarantees with smart alert triggers */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-zinc-700">چک‌ها و اسناد ضمانت ثبت‌شده ({guarantees.length})</h4>
              {guarantees.length === 0 ? (
                <div className="text-center py-6 text-zinc-400 text-xs bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
                  هنوز هیچ ضمانتی در این پرونده ثبت نشده است.
                </div>
              ) : (
                <div className="space-y-2">
                  {guarantees.map(g => {
                    const daysLeft = Math.ceil((new Date(g.dueDate || '').getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                    const isUrgent = daysLeft <= 30 && daysLeft >= 0;
                    const isOverdue = daysLeft < 0;

                    return (
                      <div key={g.id} className={`p-3.5 rounded-xl border flex items-center justify-between text-xs ${
                        isOverdue ? 'bg-rose-50 border-rose-300' :
                        isUrgent ? 'bg-amber-50 border-amber-300' : 'bg-white border-zinc-200'
                      }`}>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-zinc-900">{g.type === 'CHECK' ? 'چک ضمانت' : 'سفته'}</span>
                            <span className="font-mono bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded text-[10px]">چک: {g.checkNumber || '---'}</span>
                            {g.sayadId && <span className="font-mono bg-teal-50 text-teal-800 border border-teal-200 px-2 py-0.5 rounded text-[10px]">صیادی: {g.sayadId}</span>}
                            <span className="text-teal-700 font-bold font-mono">{g.amount.toLocaleString('fa-IR')} ریال</span>
                          </div>
                          <div className="text-[11px] text-zinc-500">
                            بانک: <span className="font-bold text-zinc-700">{g.bankName}</span> | سررسید: <span className="font-mono font-bold text-zinc-800">{g.dueDate}</span> | {g.description}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 ${
                            isOverdue ? 'bg-rose-100 text-rose-800' :
                            isUrgent ? 'bg-amber-100 text-amber-800 animate-pulse' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            <AlertTriangle className="w-3 h-3" />
                            {isOverdue ? 'سررسید گذشته!' : isUrgent ? `${daysLeft} روز مانده (هشدار سررسید)` : `${daysLeft} روز مانده`}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveGuarantee(g.id)}
                            className="text-zinc-400 hover:text-rose-600 p-1 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Referrer */}
        {activeTab === 'referrer' && (
          <div className="space-y-4 animate-fadeIn">
            <h3 className="text-xs font-bold text-zinc-700 flex items-center gap-2 border-b border-zinc-100 pb-2">
              <Building2 className="w-4 h-4 text-teal-600" />
              ثبت مشخصات معرف نماینده (سابقه معرفی و ارتباطات)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-zinc-600 mb-1 font-semibold">نام و نام خانوادگی معرف:</label>
                <input
                  type="text"
                  value={formData.referrerName}
                  onChange={e => setFormData({ ...formData, referrerName: e.target.value })}
                  className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-medium focus:outline-none focus:border-teal-500"
                  placeholder="مثال: جناب آقای رضایی"
                />
              </div>
              <div>
                <label className="block text-zinc-600 mb-1 font-semibold">شماره موبایل معرف:</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={formData.referrerMobile}
                  onChange={e => setFormData({ ...formData, referrerMobile: e.target.value })}
                  className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-mono focus:outline-none focus:border-teal-500"
                  placeholder="0912..."
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-zinc-600 mb-1 font-semibold">توضیحات درباره نحوه معرفی و سوابق همکاری:</label>
                <textarea
                  value={formData.referrerDescription}
                  onChange={e => setFormData({ ...formData, referrerDescription: e.target.value })}
                  rows={3}
                  className="w-full bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl font-medium focus:outline-none focus:border-teal-500 text-xs"
                  placeholder="نحوه آشنایی، معرفی توسط همکاران قدیمی یا بازاریاب..."
                ></textarea>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Status & History */}
        {activeTab === 'status' && (
          <div className="space-y-4 animate-fadeIn">
            <h3 className="text-xs font-bold text-zinc-700 flex items-center gap-2 border-b border-zinc-100 pb-2">
              <History className="w-4 h-4 text-teal-600" />
              چرخه وضعیت پرونده و تاریخچه تغییرات مدیریت
            </h3>
            <div className="space-y-3">
              {statusHistory.map((h, idx) => (
                <div key={idx} className="bg-zinc-50 p-3 rounded-xl border border-zinc-200 flex items-center justify-between text-xs">
                  <div className="space-y-1">
                    <span className="font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-0.5 rounded-lg">
                      {h.status}
                    </span>
                    <span className="text-zinc-600 mr-2">{h.comment}</span>
                  </div>
                  <div className="text-zinc-400 font-mono text-[11px]">
                    {h.date} | کاربر: {h.userName}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 6: Digital Dossier Summary */}
        {activeTab === 'dossier' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="bg-teal-50 border border-teal-200 p-4 rounded-2xl flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-teal-900">پرونده دیجیتال جامع نماینده فروش</h4>
                <p className="text-xs text-teal-700 mt-0.5">شناسنامه کامل، اسناد پیوست، ضمانت‌ها و قوانین در سامانه مرکزی مدیریت</p>
              </div>
              <div className="bg-white border border-teal-300 px-3 py-1.5 rounded-xl font-mono text-xs text-teal-800 font-bold flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5" />
                dossier/nesyeh/{formData.code}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <span className="text-zinc-400 block text-[10px]">کد نمایندگی:</span>
                <span className="font-mono font-bold text-zinc-800">{formData.code}</span>
              </div>
              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <span className="text-zinc-400 block text-[10px]">سقف خرید نسیه:</span>
                <span className="font-mono font-bold text-teal-700">{formData.creditLimit.toLocaleString('fa-IR')} ریال</span>
              </div>
              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <span className="text-zinc-400 block text-[10px]">مهلت تسویه و جریمه:</span>
                <span className="font-mono font-bold text-zinc-800">{formData.paymentTermDays} روزه ({formData.lateFeePercentage}% ماهانه)</span>
              </div>
              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <span className="text-zinc-400 block text-[10px]">تعداد چک‌های ضمانت:</span>
                <span className="font-mono font-bold text-amber-600">{guarantees.length} فقره</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 7: Partner Access & Dedicated Link */}
        {activeTab === 'access' && (
          <div className="space-y-5 animate-fadeIn">
            <h3 className="text-xs font-bold text-zinc-700 flex items-center gap-2 border-b border-zinc-100 pb-2">
              <LinkIcon className="w-4 h-4 text-teal-600" />
              دسترسی نماینده و لینک اختصاصی ورود
            </h3>

            {(!formData.partnerName.trim() || !formData.storeName.trim()) ? (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-5 rounded-2xl flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-bold text-sm">عدم امکان صدور لینک اختصاصی</span>
                </div>
                <p className="text-amber-700 text-xs font-medium leading-relaxed md:mr-7">
                  لینک اختصاصی نماینده فروش فقط زمانی ساخته و نمایش داده می‌شود که «نام نماینده» و «نام فروشگاه» به طور کامل در بخش اطلاعات هویتی تکمیل شده باشند. لطفاً ابتدا این مقادیر را پر کنید.
                </p>
              </div>
            ) : (
              <div className="bg-teal-50/60 border border-teal-200 p-5 rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-teal-900">لینک اختصاصی پنل نسیه نماینده</h4>
                    <p className="text-xs text-teal-700 mt-0.5">این لینک به طور اختصاصی به این نماینده متصل است و دسترسی او را به پنل مخصوص خود محدود می‌کند.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-zinc-700">وضعیت دسترسی لینک:</label>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, isLinkActive: !formData.isLinkActive })}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        formData.isLinkActive ? 'bg-emerald-600 text-white shadow-sm' : 'bg-rose-600 text-white shadow-sm'
                      }`}
                    >
                      {formData.isLinkActive ? 'فعال' : 'غیرفعال (مسدود)'}
                    </button>
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-teal-300 flex items-center justify-between gap-3">
                  <input
                    type="text"
                    readOnly
                    value={`${import.meta.env.VITE_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')}/?agent_token=${formData.nesyehPartnerId}&agency_role=sales`}
                    className="w-full bg-zinc-50 border border-zinc-200 p-2 rounded-lg font-mono text-xs text-teal-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const baseUrl = import.meta.env.VITE_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
                      const url = `${baseUrl}/?agent_token=${formData.nesyehPartnerId}&agency_role=sales`;
                      navigator.clipboard.writeText(url);
                      alert('لینک اختصاصی نماینده با موفقیت کپی شد!');
                    }}
                    className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer shadow-sm"
                  >
                    کپی لینک
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-2">
                  <div className="bg-white p-3 rounded-xl border border-teal-200 flex items-center justify-between">
                    <span className="text-zinc-500">شناسه اختصاصی (Token):</span>
                    <span className="font-mono font-bold text-teal-800">{formData.nesyehPartnerId}</span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-teal-200 flex items-center justify-between">
                    <span className="text-zinc-500">تاریخ ایجاد لینک:</span>
                    <span className="font-mono font-bold text-zinc-800">{formData.linkCreatedAt}</span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-teal-200 flex items-center justify-between md:col-span-2">
                    <span className="text-zinc-500">آخرین ورود نماینده به سامانه:</span>
                    <span className="font-mono font-bold text-emerald-700">{formData.lastLogin}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* File Preview Modal if requested */}
        {previewFile && (
          <div className="fixed inset-0 bg-slate-950/80 z-60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full text-center space-y-4 shadow-2xl">
              <h4 className="text-sm font-bold text-zinc-800">پیش‌نمایش مدرک پیوست</h4>
              <div className="bg-zinc-100 p-8 rounded-xl border border-zinc-300 font-mono text-xs text-zinc-700">
                📄 {previewFile}
                <div className="text-[10px] text-emerald-600 mt-2 font-sans font-bold">✓ فایل معتبر و بارگذاری شده در پرونده</div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="w-full bg-teal-600 text-white font-bold py-2 rounded-xl text-xs cursor-pointer"
              >
                بستن پیش‌نمایش
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-100">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs cursor-pointer transition-all"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={handleSaveAll}
            className="px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-lg shadow-teal-500/20 cursor-pointer transition-all flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            ذخیره نهایی پرونده و قرارداد هوشمند
          </button>
        </div>

      </div>
    </div>
  );
}

export default NesyehPartnerOnboardingModal;
