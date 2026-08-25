import React, { useState, useMemo } from 'react';
import { 
  FileCheck, Upload, Search, User, ShieldCheck, 
  FileText, AlertTriangle, CheckCircle2, Clock, 
  Trash2, Eye, Download, RefreshCw, Cpu, Plus, 
  Landmark, CreditCard, ChevronRight, MessageSquare,
  FileSpreadsheet, Shield
} from 'lucide-react';
import { 
  AppState, Person, CreditFile, PersonAttachment, 
  DocumentCategoryType, Check as CheckType, BusinessPartner 
} from '../types';
import { getCurrentJalaliDate } from '../utils/jalali';
import { compressImage } from '../utils/imageCompressor';
import { DOCUMENT_CATEGORIES } from './CreditFileDocuments';
import CreditFileDocuments from './CreditFileDocuments';
import { CreditPartnerService } from '../services/creditPartnerService';
import { getMatchingCreditPolicy } from '../utils/creditPolicyHelper';

interface PartnerCustomerDocumentsProps {
  state: AppState;
  currentPartner: BusinessPartner | null;
  currentUserId: string;
  onUpdateState: (newState: AppState) => void;
  onSelectCreditFileForDocs?: (file: CreditFile) => void;
  currentAgentId?: string;
}

export default function PartnerCustomerDocuments({
  state,
  currentPartner,
  currentUserId,
  onUpdateState,
  currentAgentId
}: PartnerCustomerDocumentsProps) {
  // Get all customers assigned to or created by this partner/agent
  const partnerCustomers = useMemo(() => {
    if (!currentPartner) return [];

    // 1. Get customer IDs from partner requests
    const partnerRequests = (state.partnerCreditRequests || []).filter(
      r => r.businessPartnerId === currentPartner.id
    );
    const customerIdsFromRequests = partnerRequests.map(r => r.customerPersonId);

    // 2. Get customer IDs from credit files registered by this agent
    const repIds = [
      currentAgentId,
      currentPartner.id,
      currentPartner.personId,
      currentUserId
    ].filter(Boolean) as string[];

    const customerIdsFromCreditFiles = (state.creditFiles || [])
      .filter(f => f.representativeId && repIds.includes(f.representativeId))
      .map(f => f.personId);

    // Combine all allowed criteria
    return state.persons.filter(p => 
      customerIdsFromRequests.includes(p.id) || 
      customerIdsFromCreditFiles.includes(p.id) ||
      p.createdBy === currentUserId ||
      (p.representativeId && repIds.includes(p.representativeId))
    );
  }, [state.persons, state.partnerCreditRequests, state.creditFiles, currentPartner, currentAgentId, currentUserId]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    partnerCustomers[0]?.id || ''
  );
  const [selectedCategory, setSelectedCategory] = useState<DocumentCategoryType>('national_card');
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionNotice, setCompressionNotice] = useState<string | null>(null);

  // Inspector Preview Modal State
  const [previewDoc, setPreviewDoc] = useState<PersonAttachment | null>(null);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [activeWizardFile, setActiveWizardFile] = useState<CreditFile | null>(null);

  // Filtered customers list
  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return partnerCustomers;
    const q = searchQuery.toLowerCase();
    return partnerCustomers.filter(p => 
      p.name.toLowerCase().includes(q) ||
      (p.nationalId && p.nationalId.includes(q)) ||
      (p.mobile && p.mobile.includes(q))
    );
  }, [partnerCustomers, searchQuery]);

  const activeCustomer = useMemo(() => {
    return partnerCustomers.find(p => p.id === selectedCustomerId) || partnerCustomers[0] || null;
  }, [selectedCustomerId, partnerCustomers]);

  // Find or derive active CreditFile for this customer
  const customerCreditFiles = useMemo(() => {
    if (!activeCustomer) return [];
    return (state.creditFiles || []).filter(f => f.personId === activeCustomer.id);
  }, [state.creditFiles, activeCustomer]);

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  // Get active credit file or default to first / auto-created
  const activeCreditFile = useMemo(() => {
    if (selectedFileId) {
      const found = customerCreditFiles.find(f => f.id === selectedFileId);
      if (found) return found;
    }
    return customerCreditFiles[0] || null;
  }, [customerCreditFiles, selectedFileId]);

  // Handle creating a new Credit File container for customer if none exists
  const handleEnsureCreditFile = (): CreditFile => {
    if (activeCreditFile) return activeCreditFile;

    const matchedPolicy = getMatchingCreditPolicy(0, state.creditPolicies || []);

    const newFile: CreditFile = {
      id: 'CF_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      personId: activeCustomer?.id || '',
      representativeId: currentPartner?.id || currentUserId,
      requestedAmount: 0,
      calculatorId: 'default',
      calculatorName: 'پرونده مدارک مشتری',
      status: 'draft',
      createdAt: getCurrentJalaliDate(),
      paymentDocuments: [],
      receivedChecks: [],
      plan: 'default',
      agentCommissionAmount: 0,
      policyId: matchedPolicy.id,
      policySnapshot: matchedPolicy
    };

    const updatedFiles = [...(state.creditFiles || []), newFile];
    onUpdateState({ ...state, creditFiles: updatedFiles });
    setSelectedFileId(newFile.id);
    return newFile;
  };

  // Upload Document Handler with Compression & Excel Support
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeCustomer) return;

    const currentFile = handleEnsureCreditFile();

    setIsCompressing(true);
    setCompressionNotice('در حال آنالیز، فشرده‌سازی و پردازش سند...');

    try {
      const catInfo = DOCUMENT_CATEGORIES.find(c => c.id === selectedCategory);
      
      // Handle Images with Smart Client-Side Compression
      if (file.type.startsWith('image/')) {
        const result = await compressImage(file, {
          maxDimension: 1400,
          quality: 0.78,
          mimeType: 'image/jpeg'
        });

        const fetchRes = await fetch(result.compressedDataUrl);
        const imageBlob = await fetchRes.blob();

        const serverDoc = await CreditPartnerService.uploadCreditFileDocument(currentFile.id, {
          documentType: selectedCategory,
          originalName: file.name.replace(/\.[^/.]+$/, "") + ".jpg",
          mimeType: 'image/jpeg',
          sizeBytes: imageBlob.size,
          file: imageBlob
        });

        const newDoc: PersonAttachment = {
          id: serverDoc.id || ('DOC_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
          name: `${catInfo?.label || 'مدرک'} - ${file.name}`,
          url: serverDoc.downloadUrl || `/api/credit-files/${currentFile.id}/documents/${serverDoc.id}/download`,
          type: 'image/jpeg',
          uploadDate: getCurrentJalaliDate(),
          category: selectedCategory,
          status: 'pending',
          fileSizeKb: result.compressedSizeKb,
          originalSizeKb: result.originalSizeKb
        };

        const updatedDocs = [...(currentFile.paymentDocuments || []), newDoc];
        const updatedFile: CreditFile = { ...currentFile, paymentDocuments: updatedDocs };
        
        const updatedFiles = (state.creditFiles || []).map(f => f.id === updatedFile.id ? updatedFile : f);
        onUpdateState({ ...state, creditFiles: updatedFiles });

        CreditPartnerService.updateCreditFile(updatedFile.id, { paymentDocuments: updatedDocs })
          .catch(err => console.error('Error updating documents via service:', err));

        setCompressionNotice(
          `تصویر با موفقیت فشرده گردید: کاهش حجم از ${result.originalSizeKb} KB به ${result.compressedSizeKb} KB (${result.compressionRatioPercent}٪ بهینه‌سازی)`
        );
      } 
      // Handle Excel (.xlsx, .xls, .csv) and PDF files
      else {
        const originalKb = +(file.size / 1024).toFixed(1);
        const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv');
        const docType = file.type || (isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');

        const serverDoc = await CreditPartnerService.uploadCreditFileDocument(currentFile.id, {
          documentType: selectedCategory,
          originalName: file.name,
          mimeType: docType,
          sizeBytes: file.size,
          file: file
        });

        const newDoc: PersonAttachment = {
          id: serverDoc.id || ('DOC_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
          name: `${catInfo?.label || (isExcel ? 'فایل اکسل' : 'مدرک')} - ${file.name}`,
          url: serverDoc.downloadUrl || `/api/credit-files/${currentFile.id}/documents/${serverDoc.id}/download`,
          type: docType,
          uploadDate: getCurrentJalaliDate(),
          category: selectedCategory,
          status: 'pending',
          fileSizeKb: originalKb,
          originalSizeKb: originalKb
        };

        const updatedDocs = [...(currentFile.paymentDocuments || []), newDoc];
        const updatedFile: CreditFile = { ...currentFile, paymentDocuments: updatedDocs };

        const updatedFiles = (state.creditFiles || []).map(f => f.id === updatedFile.id ? updatedFile : f);
        onUpdateState({ ...state, creditFiles: updatedFiles });

        setCompressionNotice(`سند (${file.name}) با موفقیت در جدول مدارک ثبت و پیوست گردید.`);
      }
    } catch (err) {
      alert('خطا در بارگذاری فایل: ' + (err as Error).message);
    } finally {
      setIsCompressing(false);
      setTimeout(() => setCompressionNotice(null), 6000);
      e.target.value = '';
    }
  };

  // Delete document
  const handleDeleteDoc = (docId: string) => {
    if (!activeCreditFile) return;
    if (confirm('آیا از حذف این مدرک اطمینان دارید؟')) {
      const updatedDocs = (activeCreditFile.paymentDocuments || []).filter(d => d.id !== docId);
      const updatedFile = { ...activeCreditFile, paymentDocuments: updatedDocs };
      const updatedFiles = (state.creditFiles || []).map(f => f.id === updatedFile.id ? updatedFile : f);
      onUpdateState({ ...state, creditFiles: updatedFiles });

      CreditPartnerService.updateCreditFile(updatedFile.id, { paymentDocuments: updatedDocs })
        .catch(err => console.error('Error updating documents via service:', err));
    }
  };

  return (
    <div className="space-y-6 font-sans text-right" dir="rtl">
      
      {/* Top Banner Header */}
      <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-emerald-800 text-white p-6 rounded-3xl shadow-lg flex justify-between items-center flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-black flex items-center gap-2">
            <FileCheck size={24} />
            مرکز ارسال و بارگذاری اسناد مشتریان
          </h2>
          <p className="text-xs text-emerald-100 mt-1 max-w-2xl leading-relaxed">
            محیط اختصاصی بارگذاری کارت ملی، شناسنامه، فایل‌های اکسل اعتبارسنجی بانک، گزارش طرح بتا (بانک رفاه) و تصاویر چک‌های دریافتی جهت بررسی مدیریت
          </p>
        </div>

        <div className="bg-white/10 border border-white/20 p-3 rounded-2xl backdrop-blur-sm flex items-center gap-3 text-xs">
          <Cpu className="text-emerald-300 animate-pulse" size={20} />
          <div>
            <span className="font-bold block text-emerald-200">فشرده‌سازی هوشمند فعال</span>
            <span className="text-[10px] text-emerald-100">کاهش ۸۵٪ تا ۹۵٪ حجم تصاویر با حفظ کیفیت متن</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Layout: Sidebar Customer Picker + Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column (Customer List Selector) */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-zinc-200 p-4 space-y-4 shadow-xs">
          <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
            <h3 className="font-bold text-xs text-zinc-800 flex items-center gap-1.5">
              <User size={16} className="text-emerald-600" />
              <span>انتخاب مشتری ({partnerCustomers.length})</span>
            </h3>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute right-3 top-2.5 text-zinc-400" size={15} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="جستجوی نام، کدملی یا تلفن..."
              className="w-full pr-9 pl-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs outline-none focus:border-emerald-500 font-sans"
            />
          </div>

          {/* Customer Cards List */}
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {filteredCustomers.length === 0 ? (
              <div className="p-6 text-center text-zinc-400 text-xs bg-zinc-50 rounded-2xl border border-dashed">
                مشتری یافت نشد.
              </div>
            ) : (
              filteredCustomers.map(cust => {
                const isSelected = cust.id === activeCustomer?.id;
                const custFiles = (state.creditFiles || []).filter(f => f.personId === cust.id);
                const docsCount = custFiles.reduce((sum, f) => sum + (f.paymentDocuments?.length || 0), 0);

                return (
                  <div
                    key={cust.id}
                    onClick={() => {
                      setSelectedCustomerId(cust.id);
                      setSelectedFileId(custFiles[0]?.id || null);
                    }}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition space-y-2 ${
                      isSelected
                        ? 'bg-emerald-50/80 border-emerald-500 shadow-sm'
                        : 'bg-white border-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-xs text-zinc-800">{cust.name}</span>
                      <span className="text-[10px] font-mono text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded-md">
                        {cust.nationalId || 'بدون کدملی'}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-[10px] text-zinc-500">
                      <span>تلفن: {cust.mobile || '-'}</span>
                      <span className={`px-2 py-0.5 rounded-full font-bold ${
                        docsCount > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-50 text-amber-700'
                      }`}>
                        📂 {docsCount} مدرک ثبت‌شده
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Customer Document Upload Workspace */}
        <div className="lg:col-span-8 space-y-6">
          {activeCustomer ? (
            <>
              {/* Selected Customer Header Banner */}
              <div className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-xs flex justify-between items-center flex-wrap gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-zinc-900">{activeCustomer.name}</h3>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full font-bold">
                      مشتری فعال
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 flex items-center gap-3">
                    <span>کد ملی: <strong className="font-mono text-zinc-700">{activeCustomer.nationalId || '-'}</strong></span>
                    <span>•</span>
                    <span>شماره همراه: <strong className="font-mono text-zinc-700">{activeCustomer.mobile || '-'}</strong></span>
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-zinc-500">
                    پرونده اعتباری مرتبط:
                  </span>
                  <select
                    value={activeCreditFile?.id || ''}
                    onChange={e => setSelectedFileId(e.target.value)}
                    className="bg-zinc-50 border border-zinc-300 text-xs font-bold rounded-xl px-3 py-1.5 outline-none focus:border-emerald-500"
                  >
                    {customerCreditFiles.map((f, idx) => (
                      <option key={f.id} value={f.id}>
                        پرونده #{idx + 1} - {f.calculatorName || 'اعتباری'} ({Number(f.requestedAmount || 0).toLocaleString()} ریال)
                      </option>
                    ))}
                    <option value="">+ ایجاد پرونده مدارک جدید</option>
                  </select>

                  <button
                    onClick={() => {
                      const fileToOpen = handleEnsureCreditFile();
                      setActiveWizardFile(fileToOpen);
                    }}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1.5 shadow-sm"
                  >
                    <ShieldCheck size={16} />
                    <span>ورود به چرخه کامل تشکیل پرونده (Workflow)</span>
                  </button>
                </div>
              </div>

              {/* Upload Notification Banner */}
              {compressionNotice && (
                <div className="bg-emerald-900 text-white text-xs font-bold px-5 py-3 rounded-2xl flex items-center justify-between border border-emerald-800 shadow-md animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <Cpu size={18} className="text-emerald-400 animate-pulse" />
                    <span>{compressionNotice}</span>
                  </div>
                  <button onClick={() => setCompressionNotice(null)} className="text-emerald-300 hover:text-white text-xs">
                    بستن
                  </button>
                </div>
              )}

              {/* Upload Box */}
              <div className="bg-white rounded-3xl border border-zinc-200 p-6 space-y-5 shadow-xs">
                <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                  <div>
                    <h4 className="font-bold text-xs text-zinc-800 flex items-center gap-2">
                      <Upload size={18} className="text-emerald-600" />
                      بارگذاری مدارک و فایل‌های مشتری
                    </h4>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      انتخاب دسته‌بندی و آپلود تصاویر، فایل اکسل اعتبارسنجی یا گزارش طرح بتا بانک رفاه
                    </p>
                  </div>
                </div>

                {/* Categories Selection */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-700 block">
                    ۱. نوع سند یا مدرک دریافتی از مشتری را انتخاب کنید:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {DOCUMENT_CATEGORIES.map(cat => {
                      const isSelected = cat.id === selectedCategory;
                      return (
                        <div
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`p-3 rounded-2xl border cursor-pointer transition flex items-start gap-2.5 ${
                            isSelected
                              ? 'bg-emerald-50/90 border-emerald-500 shadow-xs'
                              : 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100'
                          }`}
                        >
                          <span className="text-lg">{cat.icon}</span>
                          <div className="space-y-0.5">
                            <span className="text-xs font-bold text-zinc-800 block">{cat.label}</span>
                            <span className="text-[10px] text-zinc-500 block leading-tight">{cat.desc}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Upload Trigger Area */}
                <div className="pt-2">
                  <label className="text-xs font-bold text-zinc-700 block mb-2">
                    ۲. فایل مورد نظر (عکس، PDF یا Excel) را بارگذاری کنید:
                  </label>
                  <label className={`w-full py-5 px-6 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition ${
                    isCompressing
                      ? 'bg-zinc-100 border-zinc-300 cursor-not-allowed text-zinc-400'
                      : 'bg-emerald-50/40 border-emerald-300 hover:bg-emerald-50/80 text-emerald-800'
                  }`}>
                    {isCompressing ? (
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
                        <RefreshCw size={20} className="animate-spin text-emerald-600" />
                        <span>در حال فشرده‌سازی و پردازش سند...</span>
                      </div>
                    ) : (
                      <>
                        <Upload size={32} className="text-emerald-600 mb-1" />
                        <span className="text-xs font-bold">
                          برای انتخاب فایل تصویر (کارت ملی، چک، بتا)، PDF یا اکسل اعتبارسنجی اینجا کلیک کنید
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          فرمت‌های مجاز: JPG, PNG, WEBP, PDF, XLSX, XLS, CSV (حداکثر حجم پیشنهادی ۵۰ مگابایت)
                        </span>
                        <input
                          type="file"
                          accept="image/*,.pdf,.xlsx,.xls,.csv"
                          disabled={isCompressing}
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </>
                    )}
                  </label>
                </div>
              </div>

              {/* Uploaded Documents Grid */}
              <div className="bg-white rounded-3xl border border-zinc-200 p-6 space-y-4 shadow-xs">
                <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                  <h4 className="font-bold text-xs text-zinc-800 flex items-center gap-2">
                    <ShieldCheck size={18} className="text-emerald-600" />
                    اسناد و مدارک بارگذاری‌شده برای این مشتری ({(activeCreditFile?.paymentDocuments || []).length})
                  </h4>
                </div>

                {(activeCreditFile?.paymentDocuments || []).length === 0 ? (
                  <div className="py-12 bg-zinc-50 rounded-2xl border border-dashed border-zinc-300 text-center space-y-2 text-zinc-400">
                    <FileText size={40} className="mx-auto text-zinc-300" />
                    <p className="text-xs font-bold text-zinc-600">هنوز هیچ مدرکی برای این مشتری آپلود نشده است.</p>
                    <p className="text-[11px] text-zinc-400">
                      از بخش بالا مدارک هویتی، فایل اعتبارسنجی بانک یا طرح بتا را اضافه نمایید.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {(activeCreditFile?.paymentDocuments || []).map(doc => {
                      const catInfo = DOCUMENT_CATEGORIES.find(c => c.id === doc.category) || DOCUMENT_CATEGORIES[6];
                      const status = doc.status || 'pending';
                      const isExcel = doc.name.endsWith('.xlsx') || doc.name.endsWith('.xls') || doc.name.endsWith('.csv') || doc.type.includes('excel') || doc.type.includes('spreadsheet');

                      return (
                        <div
                          key={doc.id}
                          className={`bg-white border rounded-2xl p-3.5 flex flex-col justify-between space-y-3 transition shadow-xs hover:shadow-md ${
                            status === 'approved'
                              ? 'border-emerald-300 bg-emerald-50/20'
                              : status === 'rejected'
                              ? 'border-rose-300 bg-rose-50/20'
                              : 'border-zinc-200'
                          }`}
                        >
                          <div>
                            {/* Card Header Status */}
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-bold text-zinc-800 flex items-center gap-1">
                                <span>{catInfo.icon}</span>
                                <span>{catInfo.label}</span>
                              </span>

                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                status === 'approved'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : status === 'rejected'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {status === 'approved' && '✓ تایید شده'}
                                {status === 'rejected' && '⚠ دارای نقص'}
                                {status === 'pending' && '⏳ در انتظار تایید'}
                              </span>
                            </div>

                            {/* Media Preview Box */}
                            <div
                              onClick={() => {
                                setPreviewDoc(doc);
                                setPreviewRotation(0);
                              }}
                              className="relative h-36 bg-zinc-100 rounded-xl overflow-hidden border border-zinc-200 cursor-pointer group flex items-center justify-center"
                            >
                              {isExcel ? (
                                <div className="flex flex-col items-center justify-center p-3 text-center space-y-1 text-emerald-700">
                                  <FileSpreadsheet size={36} className="text-emerald-600" />
                                  <span className="text-xs font-bold">فایل اکسل اعتبارسنجی / بتا</span>
                                  <span className="text-[10px] text-zinc-500 font-mono">{doc.fileSizeKb} KB</span>
                                </div>
                              ) : doc.type.startsWith('image/') ? (
                                <img src={doc.url} alt={doc.name} className="w-full h-full object-cover transition transform group-hover:scale-105" />
                              ) : (
                                <div className="flex flex-col items-center justify-center text-zinc-500 space-y-1">
                                  <FileText size={32} />
                                  <span className="text-[10px] font-mono">PDF / فایل متنی</span>
                                </div>
                              )}

                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white gap-1 text-xs font-bold">
                                <Eye size={16} />
                                <span>مشاهده / دانلود</span>
                              </div>
                            </div>

                            {/* Doc Info Footer */}
                            <div className="mt-2 space-y-1">
                              <div className="text-[11px] font-bold text-zinc-800 truncate" title={doc.name}>
                                {doc.name}
                              </div>
                              <div className="flex justify-between items-center text-[10px] text-zinc-500 font-mono">
                                <span>تاریخ: {doc.uploadDate}</span>
                                {doc.fileSizeKb && (
                                  <span className="bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-600">
                                    {doc.fileSizeKb} KB
                                  </span>
                                )}
                              </div>

                              {doc.rejectionReason && (
                                <div className="text-[10px] bg-rose-50 text-rose-700 p-2 rounded-lg border border-rose-100 mt-1">
                                  <strong>علت نقص:</strong> {doc.rejectionReason}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Delete Action */}
                          <div className="pt-2 border-t border-zinc-100 flex justify-between items-center">
                            <a
                              href={doc.url}
                              download={doc.name}
                              className="text-[10px] text-emerald-700 font-bold hover:underline flex items-center gap-1"
                            >
                              <Download size={12} />
                              <span>دانلود فایل اصلی</span>
                            </a>

                            <button
                              type="button"
                              onClick={() => handleDeleteDoc(doc.id)}
                              className="text-[10px] text-rose-600 hover:text-rose-800 font-bold flex items-center gap-0.5"
                            >
                              <Trash2 size={12} />
                              <span>حذف</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-white rounded-3xl border border-zinc-200 p-12 text-center text-zinc-400 space-y-3">
              <User size={48} className="mx-auto text-zinc-300" />
              <h3 className="text-sm font-bold text-zinc-600">هیچ مشتری انتخاب نشده است.</h3>
              <p className="text-xs text-zinc-400">
                لطفاً از لیست سمت راست یک مشتری را انتخاب نمایید یا مشتری جدیدی در سیستم ثبت فرمایید.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Full Document Inspector Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-4 font-sans text-right" dir="rtl">
          <div className="w-full flex justify-between items-center text-white pb-3 border-b border-zinc-800">
            <span className="text-xs font-bold">{previewDoc.name}</span>
            <div className="flex items-center gap-2">
              <a
                href={previewDoc.url}
                download={previewDoc.name}
                className="p-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white flex items-center gap-1 text-xs font-bold"
              >
                <Download size={16} />
                <span>دانلود فایل اصلی</span>
              </a>
              <button
                onClick={() => setPreviewDoc(null)}
                className="p-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold"
              >
                بستن
              </button>
            </div>
          </div>

          <div className="flex-1 w-full flex items-center justify-center p-4 overflow-auto">
            {previewDoc.name.endsWith('.xlsx') || previewDoc.name.endsWith('.xls') || previewDoc.name.endsWith('.csv') || previewDoc.type.includes('excel') || previewDoc.type.includes('spreadsheet') ? (
              <div className="bg-zinc-800 border border-zinc-700 p-8 rounded-3xl text-center space-y-4 max-w-md">
                <FileSpreadsheet size={64} className="mx-auto text-emerald-400" />
                <h3 className="text-white font-bold text-sm">{previewDoc.name}</h3>
                <p className="text-zinc-400 text-xs">این فایل حاوی اکسل اعتبارسنجی بانکی یا گزارش طرح بتا است.</p>
                <a
                  href={previewDoc.url}
                  download={previewDoc.name}
                  className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-3 rounded-xl text-xs transition"
                >
                  <Download size={18} />
                  <span>دانلود و بازکردن در Microsoft Excel</span>
                </a>
              </div>
            ) : previewDoc.type.startsWith('image/') ? (
              <img
                src={previewDoc.url}
                alt={previewDoc.name}
                className="max-h-[82vh] max-w-full object-contain rounded-lg shadow-2xl"
              />
            ) : (
              <iframe src={previewDoc.url} title={previewDoc.name} className="w-full h-full bg-white rounded-xl" />
            )}
          </div>
        </div>
      )}

      {activeWizardFile && (
        <CreditFileDocuments 
          creditFile={activeWizardFile}
          state={state}
          readOnly={false}
          onUpdateFile={(updatedFile) => {
            const updatedFiles = (state.creditFiles || []).map(f => f.id === updatedFile.id ? updatedFile : f);
            onUpdateState({ ...state, creditFiles: updatedFiles });
            setActiveWizardFile(updatedFile);
          }}
          onClose={() => setActiveWizardFile(null)}
        />
      )}

    </div>
  );
}
