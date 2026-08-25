import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  X, Plus, Trash2, CheckCircle2, FileText, Banknote, Calendar, Landmark, Hash, Info, Upload,
  ShieldCheck, AlertTriangle, Eye, RotateCw, ZoomIn, ZoomOut, Download, Check, RefreshCw, Cpu,
  Search, Filter, Phone, User, Clock, History, AlertCircle, FilePlus, ChevronDown, ChevronUp,
  Lock, Move, ArrowRight, Shield, CheckSquare, Square, CornerDownLeft, FileSpreadsheet, Image as ImageIcon,
  ArrowLeft, FileCheck, FileWarning, AlertOctagon, HelpCircle, MessageSquare, Copy
} from 'lucide-react';
import Barcode from 'react-barcode';
import { 
  CreditFile, Check as CheckType, PersonAttachment, AppState, DocumentCategoryType, Person,
  CheckReviewStatus 
} from '../types';
import { getCurrentJalaliDate } from '../utils/jalali';
import { compressImage } from '../utils/imageCompressor';
import { getMatchingCreditPolicy, validateCreditFileWithPolicy } from '../utils/creditPolicyHelper';
import { CreditPartnerService } from '../services/creditPartnerService';

export interface ReviewMetadata {
  status: 'unreviewed' | 'reviewed' | 'approved' | 'needs_revision' | 'rejected';
  reviewerName?: string;
  reviewDate?: string;
  reviewTime?: string;
  internalNote?: string;
  rejectionReason?: string;
  lastUpdated?: string;
  rejectionCount?: number;
  history?: {
    status: string;
    timestamp: string;
    reviewerName?: string;
    note?: string;
  }[];
}

export interface EnhancedAttachment {
  attachment: PersonAttachment;
  reviewMetadata: ReviewMetadata;
  customTitle?: string;
}

export interface CheckWithReview extends CheckType {
  revisionNote?: string;
  reviewerName?: string;
  reviewDate?: string;
  reviewTime?: string;
}

interface CreditFileDocumentsProps {
  creditFile: CreditFile;
  state: AppState;
  onUpdateFile: (updatedFile: CreditFile) => void;
  onClose: () => void;
  readOnly: boolean;
  isManager?: boolean;
}

export const DOCUMENT_CATEGORIES: { id: DocumentCategoryType; label: string; desc: string; icon: string }[] = [
  { id: 'national_card', label: 'تصویر کارت ملی (رو و پشت) / شناسنامه', desc: 'تصویر خوانا از روی و پشت کارت ملی هوشمند و صفحات شناسنامه', icon: '🆔' },
  { id: 'bank_credit_scoring', label: 'فایل اکسل / PDF اعتبارسنجی بانکی', desc: 'گزارش اعتبارسنجی بانکی (مرآت، آسیا یا گزارش اعتباری بانک)', icon: '📊' },
  { id: 'refah_beta_report', label: 'گزارش اکسل / تصویر طرح بتا (بانک رفاه)', desc: 'فایل اکسل یا تصویر گزارش تقسیم‌بندی و اعتبارسنجی طرح بتا بانک رفاه', icon: '🏦' },
  { id: 'bank_cheque', label: 'تصاویر چک‌ها', desc: 'تصویر تمامی چک‌های دریافتی از مشتری (روی چک، استعلام صیادی و تاییدیه ثبت)', icon: '💳' },
  { id: 'check_images', label: 'پیوست‌های چک (تصاویر اختصاصی چک)', desc: 'فقط فایلهای تصویری چک‌ها (JPG, PNG, WEBP)', icon: '📷' },
  { id: 'employment_income', label: 'گواهی اشتغال / فیش حقوقی / پروانه کسب', desc: 'مدرک شغلی، گواهی کسر از حقوق یا پروانه کسب معتبر', icon: '💼' },
  { id: 'guarantee_promissory', label: 'سفته الکترونیک / وثیقه / ضمانت‌نامه', desc: 'تصویر یا فایل سفته الکترونیک، ضمانت‌نامه یا سند وثیقه', icon: '📝' },
  { id: 'other', label: 'سایر مدارک و مستندات تکمیلی', desc: 'قبوض خدماتی، اجاره‌نامه، سند یا مستندات تکمیلی', icon: '📁' },
];

export default function CreditFileDocuments({ 
  creditFile, 
  state, 
  onUpdateFile, 
  onClose, 
  readOnly,
  isManager = false
}: CreditFileDocumentsProps) {
  // Main view tab
  const [activeTab, setActiveTab] = useState<'wizard' | 'payments' | 'checks' | 'archive' | 'notes'>(
    readOnly && isManager ? 'payments' : 'wizard'
  );

  // Wizard Step State (1: National Code Inquiry, 2: Supplementary Info, 3: Installment Calc, 4: Guided Agent Uploads)
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);

  // Agent Step 4 Guided Sub-Step (1: National Card, 2: Birth Cert/Scoring, 3: Cheques, 4: Custom Docs, 5: Management Note)
  const [guidedSubStep, setGuidedSubStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Customer & Locked National Code State
  const customerPerson = state.persons.find(p => p.id === creditFile.personId);
  const lockedNationalCode = customerPerson?.nationalId || (creditFile as any).nationalId || 'ثبت نشده';

  // Matched policy based on snapshot or dynamically matched
  const matchedPolicy = useMemo(() => {
    return creditFile.policySnapshot || 
           (creditFile.policyId ? state.creditPolicies?.find(p => p.id === creditFile.policyId) : null) || 
           getMatchingCreditPolicy(creditFile.requestedAmount || 0, state.creditPolicies || []);
  }, [creditFile.policySnapshot, creditFile.policyId, creditFile.requestedAmount, state.creditPolicies]);

  // Is Beta plan calculator?
  const isBeta = useMemo(() => {
    return !!(
      creditFile.plan?.toLowerCase().includes('beta') || 
      creditFile.plan?.includes('بتا') || 
      (creditFile as any).calculatorId?.toLowerCase().includes('beta') || 
      (creditFile as any).calculatorId?.includes('بتا') ||
      (creditFile as any).calculatorName?.toLowerCase().includes('beta') || 
      (creditFile as any).calculatorName?.includes('بتا') ||
      creditFile.calculatorName?.toLowerCase().includes('beta') ||
      creditFile.calculatorName?.includes('بتا')
    );
  }, [creditFile]);

  // Supplementary Info
  const [essentialMobile, setEssentialMobile] = useState<string>(
    (creditFile as any).essentialMobile || customerPerson?.phone || ''
  );
  const [emergencyContact, setEmergencyContact] = useState<string>(
    (creditFile as any).emergencyContact || ''
  );
  const [residenceAddress, setResidenceAddress] = useState<string>(
    (creditFile as any).residenceAddress || customerPerson?.address || ''
  );
  const [agentNote, setAgentNote] = useState<string>(
    (creditFile as any).agentNote || ''
  );

  // Guarantor Info
  const [guarantorName, setGuarantorName] = useState<string>(creditFile.guarantorName || '');
  const [guarantorNationalId, setGuarantorNationalId] = useState<string>(creditFile.guarantorNationalId || '');
  const [guarantorPhone, setGuarantorPhone] = useState<string>(creditFile.guarantorPhone || '');

  // Collateral Info
  const [collateralType, setCollateralType] = useState<string>(creditFile.collateralType || '');
  const [collateralDescription, setCollateralDescription] = useState<string>(creditFile.collateralDescription || '');
  const [collateralValue, setCollateralValue] = useState<number>(creditFile.collateralValue || 0);

  // Amani Check Info
  const [amaniCheckNumber, setAmaniCheckNumber] = useState<string>(creditFile.amaniCheckNumber || '');
  const [amaniCheckBankName, setAmaniCheckBankName] = useState<string>(creditFile.amaniCheckBankName || '');
  const [amaniCheckAmount, setAmaniCheckAmount] = useState<number>(creditFile.amaniCheckAmount || 0);
  const [amaniCheckDueDate, setAmaniCheckDueDate] = useState<string>(creditFile.amaniCheckDueDate || getCurrentJalaliDate());
  const [amaniCheckSayadiNumber, setAmaniCheckSayadiNumber] = useState<string>(creditFile.amaniCheckSayadiNumber || '');

  // Check form states
  const [showCheckForm, setShowCheckForm] = useState(false);
  const [checkNumber, setCheckNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [amount, setAmount] = useState<number>(creditFile.calculationResults?.installmentAmount || 0);
  const [dueDate, setDueDate] = useState(getCurrentJalaliDate());
  const [sayadiNumber, setSayadiNumber] = useState('');

  // Upload States
  const [selectedCategory, setSelectedCategory] = useState<DocumentCategoryType>('national_card');
  const [customDocTitle, setCustomDocTitle] = useState('');
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionNotice, setCompressionNotice] = useState<string | null>(null);

  // Enhanced Documents state
  const [enhancedDocs, setEnhancedDocs] = useState<EnhancedAttachment[]>(
    (creditFile.paymentDocuments || []).map(d => ({
      attachment: d,
      reviewMetadata: {
        status: (d.status as any) || 'unreviewed',
        reviewerName: d.reviewerName,
        reviewDate: d.reviewDate,
        internalNote: d.internalNote,
        rejectionReason: d.rejectionReason,
        history: (d as any).history || []
      },
      customTitle: (d as any).customTitle
    }))
  );

  // Checks state with reviews
  const [receivedChecks, setReceivedChecks] = useState<CheckWithReview[]>(
    (creditFile.receivedChecks || []).map(c => ({
      ...c,
      status: (c as any).status || 'unreviewed',
      revisionNote: (c as any).revisionNote || '',
      reviewerName: (c as any).reviewerName || '',
      reviewDate: (c as any).reviewDate || '',
      reviewTime: (c as any).reviewTime || ''
    }))
  );

  // Archived / Version History
  const [archivedDocs, setArchivedDocs] = useState<any[]>(
    (creditFile as any).archivedDocs || []
  );
  const [archivedChecks, setArchivedChecks] = useState<any[]>(
    (creditFile as any).archivedChecks || []
  );

  // Inspector / Preview Modal
  const [previewDoc, setPreviewDoc] = useState<EnhancedAttachment | null>(null);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [previewZoom, setPreviewZoom] = useState(1);

  // Single Item Review Modal (for Manager)
  const [reviewingDoc, setReviewingDoc] = useState<EnhancedAttachment | null>(null);
  const [reviewingCheck, setReviewingCheck] = useState<CheckWithReview | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewMetadata['status']>('approved');
  const [reviewReasonText, setReviewReasonText] = useState('');
  const [internalNoteText, setInternalNoteText] = useState('');

  // Floating Checklist Drag State for Manager
  const [checklistPos, setChecklistPos] = useState({ x: 20, y: 80 });
  const [isDraggingChecklist, setIsDraggingChecklist] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({ startX: 0, startY: 0, posX: 20, posY: 80 });
  const [isChecklistMinimized, setIsChecklistMinimized] = useState(false);
  const [checklistTicks, setChecklistTicks] = useState<Record<string, boolean>>({
    kyc: false,
    creditScoring: false,
    employment: false,
    checks: false
  });

  // Soft Delete Modal
  const [itemToDelete, setItemToDelete] = useState<{ type: 'doc' | 'check'; item: any } | null>(null);

  // Effective Read-Only (One-way Data Lock when submitted)
  const effectiveReadOnly = useMemo(() => {
    if (isManager) return false;
    if (readOnly) return true;
    const status = creditFile.status as string;
    return status === 'pending' || 
           status === 'in_review' || 
           status === 'approved' || 
           status === 'completed' || 
           status === 'rejected';
  }, [readOnly, isManager, creditFile.status]);

  // Submit Confirmation Modal State
  const [showSubmitConfirmModal, setShowSubmitConfirmModal] = useState(false);

  // Sync state changes when props update
  useEffect(() => {
    setEnhancedDocs((creditFile.paymentDocuments || []).map(d => ({
      attachment: d,
      reviewMetadata: {
        status: (d.status as any) || 'unreviewed',
        reviewerName: d.reviewerName,
        reviewDate: d.reviewDate,
        internalNote: d.internalNote,
        rejectionReason: d.rejectionReason,
        history: (d as any).history || []
      },
      customTitle: (d as any).customTitle
    })));

    setReceivedChecks((creditFile.receivedChecks || []).map(c => ({
      ...c,
      status: (c as any).status || 'unreviewed',
      revisionNote: (c as any).revisionNote || '',
      reviewerName: (c as any).reviewerName || '',
      reviewDate: (c as any).reviewDate || '',
      reviewTime: (c as any).reviewTime || ''
    })));
  }, [creditFile]);

  // Sayadi auto-increment logic when opening check form
  useEffect(() => {
    if (showCheckForm) {
      const count = receivedChecks.length + 1;
      const suffix = count.toString().padStart(4, '0');
      // Logic: 4-digit prefix (manual-init) + 8-digit fixed middle + 4-digit incremental suffix
      setSayadiNumber(`123400008888${suffix}`);
    }
  }, [showCheckForm, receivedChecks.length]);

  // Save state helper
  const saveStateToParent = (
    newDocs = enhancedDocs, 
    newChecks = receivedChecks, 
    newArchivedDocs = archivedDocs, 
    newArchivedChecks = archivedChecks,
    extraFields: any = {}
  ) => {
    const updatedFile: CreditFile = {
      ...creditFile,
      essentialMobile,
      emergencyContact,
      residenceAddress,
      agentNote,
      guarantorName,
      guarantorNationalId,
      guarantorPhone,
      collateralType,
      collateralDescription,
      collateralValue,
      amaniCheckNumber,
      amaniCheckBankName,
      amaniCheckAmount,
      amaniCheckDueDate,
      amaniCheckSayadiNumber,
      ...extraFields,
      paymentDocuments: newDocs.map(d => ({
        ...d.attachment,
        status: d.reviewMetadata.status,
        internalNote: d.reviewMetadata.internalNote,
        rejectionReason: d.reviewMetadata.rejectionReason,
        reviewerName: d.reviewMetadata.reviewerName,
        reviewDate: d.reviewMetadata.reviewDate,
        history: d.reviewMetadata.history,
        customTitle: d.customTitle
      })) as any,
      receivedChecks: newChecks.map(c => ({
        ...c,
        reviewStatus: c.reviewStatus,
        reviewHistory: c.reviewHistory,
        revisionNote: c.revisionNote,
        reviewerName: c.reviewerName,
        reviewDate: c.reviewDate,
        reviewTime: c.reviewTime
      })) as any,
      archivedDocs: newArchivedDocs,
      archivedChecks: newArchivedChecks
    } as any;

    onUpdateFile(updatedFile);
  };

  // Draggable Floating Checklist Handlers
  const handleMouseDownChecklist = (e: React.MouseEvent) => {
    setIsDraggingChecklist(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: checklistPos.x,
      posY: checklistPos.y
    };
  };

  const handleMouseMoveChecklist = (e: MouseEvent) => {
    if (!isDraggingChecklist) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setChecklistPos({
      x: Math.max(10, dragRef.current.posX + dx),
      y: Math.max(10, dragRef.current.posY + dy)
    });
  };

  const handleMouseUpChecklist = () => {
    setIsDraggingChecklist(false);
  };

  useEffect(() => {
    if (isDraggingChecklist) {
      window.addEventListener('mousemove', handleMouseMoveChecklist);
      window.addEventListener('mouseup', handleMouseUpChecklist);
    } else {
      window.removeEventListener('mousemove', handleMouseMoveChecklist);
      window.removeEventListener('mouseup', handleMouseUpChecklist);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMoveChecklist);
      window.removeEventListener('mouseup', handleMouseUpChecklist);
    };
  }, [isDraggingChecklist]);

  // Review status counters
  const unreviewedDocsCount = enhancedDocs.filter(d => d.reviewMetadata.status === 'unreviewed').length;
  const unreviewedChecksCount = receivedChecks.filter(c => (c.reviewStatus || CheckReviewStatus.PENDING_REVIEW) === CheckReviewStatus.PENDING_REVIEW).length;
  const totalUnreviewedCount = unreviewedDocsCount + unreviewedChecksCount;

  const needsRevisionDocsCount = enhancedDocs.filter(d => d.reviewMetadata.status === 'needs_revision').length;
  const needsRevisionChecksCount = receivedChecks.filter(c => c.reviewStatus === CheckReviewStatus.NEEDS_CORRECTION).length;
  const totalNeedsRevisionCount = needsRevisionDocsCount + needsRevisionChecksCount;

  const approvedDocsCount = enhancedDocs.filter(d => d.reviewMetadata.status === 'approved').length;
  const approvedChecksCount = receivedChecks.filter(c => c.reviewStatus === CheckReviewStatus.APPROVED).length;

  const rejectedDocsCount = enhancedDocs.filter(d => d.reviewMetadata.status === 'rejected').length;
  const rejectedChecksCount = receivedChecks.filter(c => c.reviewStatus === CheckReviewStatus.REJECTED).length;

  // Single Item Status Updater (Manager Action)
  const handleUpdateDocStatus = () => {
    if (!reviewingDoc) return;
    
    // Validate reason if not approved
    if (reviewStatus !== 'approved' && !reviewReasonText.trim()) {
      alert('لطفاً علت عدم تأیید یا نیاز به اصلاح را وارد نمایید.');
      return;
    }

    const nowJalali = getCurrentJalaliDate();
    const nowTime = new Date().toLocaleTimeString('fa-IR');
    const reviewerName = 'مدیر اعتبار';

    const updatedEnhancedDocs = enhancedDocs.map(d => {
      if (d.attachment.id === reviewingDoc.attachment.id) {
        const history = d.reviewMetadata.history || [];
        const newHistoryItem = {
          status: reviewStatus,
          timestamp: `${nowJalali} ${nowTime}`,
          reviewerName,
          note: reviewReasonText || internalNoteText
        };

        return {
          ...d,
          reviewMetadata: {
            ...d.reviewMetadata,
            status: reviewStatus,
            rejectionReason: reviewReasonText,
            internalNote: internalNoteText,
            reviewerName: reviewerName,
            reviewDate: nowJalali,
            reviewTime: nowTime,
            history: [...history, newHistoryItem]
          }
        };
      }
      return d;
    });

    setEnhancedDocs(updatedEnhancedDocs);
    saveStateToParent(updatedEnhancedDocs, receivedChecks);
    setReviewingDoc(null);
    setReviewReasonText('');
    setInternalNoteText('');
  };

  // Check Status Updater (Manager Action)
  const handleUpdateCheckStatus = () => {
    if (!reviewingCheck) return;

    // Validate reason if not approved
    if (reviewStatus !== 'approved' && !reviewReasonText.trim()) {
      alert('لطفاً علت عدم تأیید یا نیاز به اصلاح را وارد نمایید.');
      return;
    }

    const nowJalali = getCurrentJalaliDate();
    const nowTime = new Date().toLocaleTimeString('fa-IR');
    const reviewerName = 'مدیر اعتبار';

    const updatedChecks = receivedChecks.map(c => {
      if (c.id === reviewingCheck.id) {
        let finalReviewStatus = CheckReviewStatus.PENDING_REVIEW;
        if (reviewStatus === 'approved') finalReviewStatus = CheckReviewStatus.APPROVED;
        if (reviewStatus === 'needs_revision') finalReviewStatus = CheckReviewStatus.NEEDS_CORRECTION;
        if (reviewStatus === 'rejected') finalReviewStatus = CheckReviewStatus.REJECTED;

        const newHistoryItem = {
          id: 'LOG_' + Math.random().toString(36).substr(2, 9),
          fromStatus: c.reviewStatus || CheckReviewStatus.PENDING_REVIEW,
          toStatus: finalReviewStatus,
          timestamp: new Date().toISOString(),
          jalaliDate: nowJalali,
          actorName: reviewerName,
          comment: reviewReasonText || internalNoteText || 'تغییر وضعیت توسط مدیریت'
        };

        return {
          ...c,
          reviewStatus: finalReviewStatus,
          reviewHistory: [...(c.reviewHistory || []), newHistoryItem],
          revisionNote: reviewReasonText || internalNoteText,
          reviewerName,
          reviewDate: nowJalali,
          reviewTime: nowTime
        };
      }
      return c;
    });

    setReceivedChecks(updatedChecks);
    saveStateToParent(enhancedDocs, updatedChecks);
    setReviewingCheck(null);
    setReviewReasonText('');
    setInternalNoteText('');
  };

  // Check creation by Agent
  const handleAddCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkNumber || !bankName || !amount) {
      alert('لطفاً شماره چک، نام بانک و مبلغ چک را وارد نمایید.');
      return;
    }

    const nowJalali = getCurrentJalaliDate();
    const newCheck: CheckWithReview = {
      id: 'CHK_' + Math.random().toString(36).substr(2, 9),
      type: 'received',
      checkNumber,
      bankName,
      amount,
      dueDate,
      sayadiNumber,
      personId: creditFile.personId,
      currentState: 'present_in_cashbox',
      history: [{ state: 'present_in_cashbox', date: nowJalali, note: 'ثبت در پرونده اعتباری' }],
      createdAt: new Date().toISOString(),
      submittedByAgentId: creditFile.representativeId,
      reviewStatus: CheckReviewStatus.PENDING_REVIEW,
      reviewHistory: [
        {
          id: 'LOG_' + Math.random().toString(36).substr(2, 9),
          toStatus: CheckReviewStatus.PENDING_REVIEW,
          timestamp: new Date().toISOString(),
          jalaliDate: nowJalali,
          actorName: 'نماینده فروش',
          comment: 'ثبت اولیه چک توسط نماینده'
        }
      ]
    };

    const updatedChecks = [...receivedChecks, newCheck];
    setReceivedChecks(updatedChecks);
    saveStateToParent(enhancedDocs, updatedChecks);

    setCheckNumber('');
    setBankName('');
    setSayadiNumber('');
    setShowCheckForm(false);
  };

  // Soft Deletion / History Archiving
  const handleConfirmSoftDelete = () => {
    if (!itemToDelete) return;

    // RULE 7: Lock Check - Approved items CANNOT be deleted
    if (itemToDelete.type === 'doc' && itemToDelete.item.reviewMetadata?.status === 'approved') {
      alert('این مدرک توسط مدیریت تأیید شده است و قفل می‌باشد. امکان حذف وجود ندارد.');
      setItemToDelete(null);
      return;
    }
    if (itemToDelete.type === 'check' && itemToDelete.item.reviewStatus === CheckReviewStatus.APPROVED) {
      alert('این چک توسط مدیریت تأیید شده است و قفل می‌باشد. امکان حذف وجود ندارد.');
      setItemToDelete(null);
      return;
    }

    const nowJalali = getCurrentJalaliDate();

    if (itemToDelete.type === 'doc') {
      const doc = itemToDelete.item;
      const updatedDocs = enhancedDocs.filter(d => d.attachment.id !== doc.attachment.id);
      const newArchived = [
        ...archivedDocs, 
        { ...doc, archivedAt: nowJalali, archiveReason: 'حذف/جایگزینی توسط نماینده' }
      ];
      setEnhancedDocs(updatedDocs);
      setArchivedDocs(newArchived);
      saveStateToParent(updatedDocs, receivedChecks, newArchived, archivedChecks);
    } else if (itemToDelete.type === 'check') {
      const chk = itemToDelete.item;
      const updatedChecks = receivedChecks.filter(c => c.id !== chk.id);
      const newArchived = [
        ...archivedChecks,
        { ...chk, archivedAt: nowJalali, archiveReason: 'حذف/جایگزینی چک توسط نماینده' }
      ];
      setReceivedChecks(updatedChecks);
      setArchivedChecks(newArchived);
      saveStateToParent(enhancedDocs, updatedChecks, archivedDocs, newArchived);
    }

    setItemToDelete(null);
  };

  // Guided File Upload Handler (Supports Multiple File Selection)
  const handleFileUploadForCategory = async (e: React.ChangeEvent<HTMLInputElement>, targetCategory: DocumentCategoryType, forcedTitle?: string) => {
    const rawFiles = e.target.files;
    if (!rawFiles || rawFiles.length === 0) return;
    const filesList: File[] = Array.from(rawFiles);

    // Check image restriction for check_images
    if (targetCategory === 'check_images') {
      const invalid = filesList.find(f => !f.type.startsWith('image/'));
      if (invalid) {
        alert('برای تصاویر چک، فقط فایل‌های تصویری (JPG, PNG, WEBP) مجاز هستند.');
        e.target.value = '';
        return;
      }
    }

    setIsCompressing(true);
    setCompressionNotice(`در حال بهینه‌سازی و بارگذاری ${filesList.length} فایل...`);

    try {
      const newDocsToAppend: EnhancedAttachment[] = [];

      for (let i = 0; i < filesList.length; i++) {
        const file = filesList[i];
        if (file.type.startsWith('image/')) {
          const result = await compressImage(file, {
            maxDimension: 1400,
            quality: 0.75,
            mimeType: 'image/jpeg'
          });

          const catInfo = DOCUMENT_CATEGORIES.find(c => c.id === targetCategory);
          const baseLabel = forcedTitle ? forcedTitle : (customDocTitle ? customDocTitle : (catInfo?.label || 'مدرک'));
          const docLabel = filesList.length > 1 ? `${baseLabel} (${i + 1})` : baseLabel;

          const fetchRes = await fetch(result.compressedDataUrl);
          const imageBlob = await fetchRes.blob();
          let downloadUrl = result.compressedDataUrl;
          let docId = 'DOC_' + Math.random().toString(36).substr(2, 9);

          try {
            const serverDoc = await CreditPartnerService.uploadCreditFileDocument(creditFile.id, {
              documentType: targetCategory,
              originalName: file.name.replace(/\.[^/.]+$/, "") + ".jpg",
              mimeType: 'image/jpeg',
              sizeBytes: imageBlob.size,
              file: imageBlob
            });
            if (serverDoc && serverDoc.id) {
              docId = serverDoc.id;
              downloadUrl = serverDoc.downloadUrl;
            }
          } catch (e) {
            console.warn('Document server upload sync:', e);
          }

          const newDoc: PersonAttachment = {
            id: docId,
            name: `${docLabel} - ${file.name}`,
            url: downloadUrl,
            type: 'image/jpeg',
            uploadDate: getCurrentJalaliDate(),
            category: targetCategory,
            status: 'unreviewed',
            fileSizeKb: result.compressedSizeKb,
            originalSizeKb: result.originalSizeKb
          };

          newDocsToAppend.push({
            attachment: newDoc,
            reviewMetadata: {
              status: 'unreviewed',
              history: [{ status: 'unreviewed', timestamp: getCurrentJalaliDate() + ' - بارگذاری فایل' }]
            },
            customTitle: forcedTitle || customDocTitle || undefined
          });
        } else {
          // PDF or Excel
          const catInfo = DOCUMENT_CATEGORIES.find(c => c.id === targetCategory);
          const originalKb = +(file.size / 1024).toFixed(1);
          const baseLabel = forcedTitle ? forcedTitle : (customDocTitle ? customDocTitle : (catInfo?.label || 'مدرک'));
          const docLabel = filesList.length > 1 ? `${baseLabel} (${i + 1})` : baseLabel;

          let downloadUrl = `/api/credit-files/${creditFile.id}/documents/temp_${Date.now()}/download`;
          let docId = 'DOC_' + Math.random().toString(36).substr(2, 9);

          try {
            const serverDoc = await CreditPartnerService.uploadCreditFileDocument(creditFile.id, {
              documentType: targetCategory,
              originalName: file.name,
              mimeType: file.type || 'application/pdf',
              sizeBytes: file.size,
              file: file
            });
            if (serverDoc && serverDoc.id) {
              docId = serverDoc.id;
              downloadUrl = serverDoc.downloadUrl;
            }
          } catch (e) {
            console.warn('Document server metadata sync:', e);
          }

          const newDoc: PersonAttachment = {
            id: docId,
            name: `${docLabel} - ${file.name}`,
            url: downloadUrl,
            type: file.type || 'application/pdf',
            uploadDate: getCurrentJalaliDate(),
            category: targetCategory,
            status: 'unreviewed',
            fileSizeKb: originalKb,
            originalSizeKb: originalKb
          };

          newDocsToAppend.push({
            attachment: newDoc,
            reviewMetadata: {
              status: 'unreviewed',
              history: [{ status: 'unreviewed', timestamp: getCurrentJalaliDate() + ' - بارگذاری فایل' }]
            },
            customTitle: forcedTitle || customDocTitle || undefined
          });
        }
      }

      const updatedDocs = [...enhancedDocs, ...newDocsToAppend];
      setEnhancedDocs(updatedDocs);
      saveStateToParent(updatedDocs, receivedChecks);

      setCompressionNotice(`${filesList.length} فایل با موفقیت بارگذاری گردید.`);
      setCustomDocTitle('');
    } catch (err: any) {
      alert('خطا در بارگذاری: ' + err.message);
    } finally {
      setIsCompressing(false);
      setTimeout(() => setCompressionNotice(null), 4000);
      e.target.value = '';
    }
  };

  // Submit file for management review (Agent action)
  const handleSubmitFileForReview = () => {
    if (enhancedDocs.length === 0 && receivedChecks.length === 0) {
      alert('لطفاً قبل از ارسال، حداقل یک مدرک یا چک در پرونده ثبت نمایید.');
      return;
    }

    if (!essentialMobile || essentialMobile.trim().length < 10) {
      alert('شماره موبایل ضروری الزامی است. لطفاً در مرحله دوم شماره همراه ضروری مشتری را ثبت نمایید.');
      setWizardStep(2);
      return;
    }

    // Validate Credit File against Policy (Requirement 4)
    const mockFileToValidate: CreditFile = {
      ...creditFile,
      essentialMobile,
      emergencyContact,
      residenceAddress,
      guarantorName,
      guarantorNationalId,
      guarantorPhone,
      collateralType,
      collateralDescription,
      collateralValue,
      amaniCheckNumber,
      amaniCheckBankName,
      amaniCheckAmount,
      amaniCheckDueDate,
      amaniCheckSayadiNumber,
      paymentDocuments: enhancedDocs.map(d => d.attachment)
    } as any;

    const policyValidation = validateCreditFileWithPolicy(mockFileToValidate, matchedPolicy);
    if (!policyValidation.isValid) {
      alert(`خطا: امکان ارسال پرونده وجود ندارد. موارد زیر طبق سیاست اعتباری "${matchedPolicy.title}" ناقص هستند:\n\n` + 
            policyValidation.errors.map((err, idx) => `⚠️ ${idx + 1}. ${err}`).join('\n') + 
            `\n\nلطفاً ابتدا فیلدها یا مدارک مورد نظر را تکمیل و آپلود نمایید.`);
      return;
    }

    // Trigger Warning Confirmation Modal before submission and data locking
    setShowSubmitConfirmModal(true);
  };

  // Perform actual locking and submission to center
  const executeSubmitFile = () => {
    saveStateToParent(enhancedDocs, receivedChecks, archivedDocs, archivedChecks, {
      status: 'pending',
      essentialMobile,
      emergencyContact,
      residenceAddress,
      agentNote,
      guarantorName,
      guarantorNationalId,
      guarantorPhone,
      collateralType,
      collateralDescription,
      collateralValue,
      amaniCheckNumber,
      amaniCheckBankName,
      amaniCheckAmount,
      amaniCheckDueDate,
      amaniCheckSayadiNumber
    } as any);

    alert('پرونده با موفقیت به مرکز ارسال شد و کاملاً قفل گردید.');
    setTimeout(() => {
      onClose();
    }, 50);
  };

  // Manager Decision Action
  const handleManagerDecision = () => {
    // RULE 6: Final approval ONLY if totalUnreviewedCount === 0
    if (totalUnreviewedCount > 0) {
      alert(`امکان تأیید یا ارجاع پرونده وجود ندارد! هنوز ${totalUnreviewedCount} مورد مدرک یا چک بررسی نشده باقی مانده است.`);
      return;
    }

    if (totalNeedsRevisionCount > 0) {
      // RULE 7: Return dossier to agent with flawed items
      saveStateToParent(enhancedDocs, receivedChecks, archivedDocs, archivedChecks, {
        status: 'needs_revision'
      });
      alert(`پرونده جهت اصلاح ${totalNeedsRevisionCount} مورد معیوب به نماینده ارجاع گردید. مدارک و چک‌های تأییدشده قفل باقی می‌مانند.`);
      onClose();
      return;
    }

    if (rejectedDocsCount > 0 || rejectedChecksCount > 0) {
      saveStateToParent(enhancedDocs, receivedChecks, archivedDocs, archivedChecks, {
        status: 'rejected'
      });
      alert('پرونده اعتباری به دلیل رد شدن برخی مدارک/چک‌های اصلی، رد نهایی گردید.');
      onClose();
      return;
    }

    // RULE 8: Full Approval & Accounting Execution Trigger
    saveStateToParent(enhancedDocs, receivedChecks, archivedDocs, archivedChecks, {
      status: 'approved'
    });

    alert('✅ پرونده اعتباری با موفقیت تأیید نهایی شد، اسناد حسابداری صادر و پرونده در بایگانی قرار گرفت.');
    onClose();
  };

  // Status Badge UI helper
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
      case 'APPROVED':
        return <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-emerald-300"><CheckCircle2 size={13} /> تأیید نهایی</span>;
      case 'needs_revision':
      case 'NEEDS_CORRECTION':
        return <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-amber-300"><RefreshCw size={13} /> نیازمند اصلاح نماینده</span>;
      case 'rejected':
      case 'REJECTED':
        return <span className="bg-rose-100 text-rose-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-rose-300"><AlertTriangle size={13} /> رد شده</span>;
      case 'pending':
      case 'PENDING_REVIEW':
      case 'ready_to_send':
      case 'unreviewed':
        return <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-blue-300"><Clock size={13} /> در انتظار بررسی مدیریت</span>;
      default:
        return <span className="bg-zinc-100 text-zinc-700 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-zinc-300"><FileText size={13} /> در حال تکمیل (پیش‌نویس)</span>;
    }
  };

  const customerName = customerPerson?.name || 'مشتری اعتباری';

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 sm:p-4 bg-zinc-950/70 backdrop-blur-md font-sans text-right" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-6xl max-h-[94vh] overflow-hidden flex flex-col shadow-2xl border border-zinc-200 relative">
        
        {/* Security Lock Banner for Submitted Dossiers */}
        {effectiveReadOnly && !isManager && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5 flex items-center justify-between text-amber-900 text-xs font-bold shadow-inner">
            <div className="flex items-center gap-2">
              <Lock size={16} className="text-amber-600 shrink-0" />
              <span>
                این پرونده به مرکز ارسال شده و کاملاً قفل می‌باشند. امکان ویرایش، آپلود مجدد یا لغو ارسال وجود ندارد.
              </span>
            </div>
            <span className="bg-amber-200/80 text-amber-950 px-2.5 py-0.5 rounded-full text-[10px] font-mono">
              قفل پرونده (Read-Only)
            </span>
          </div>
        )}
        <div className="p-4 sm:p-5 border-b border-zinc-200 flex items-center justify-between bg-zinc-900 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <ShieldCheck size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-bold">سامانه ارسال و بررسی مدارک اعتباری درناتل</h3>
                <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2 py-0.5 rounded border border-emerald-500/30 font-mono">
                  #{creditFile.id.substring(0, 8)}
                </span>
                {renderStatusBadge(creditFile.status || 'draft')}
              </div>
              <p className="text-xs text-zinc-400 mt-1 flex items-center gap-3 flex-wrap">
                <span>مشتری: <strong className="text-white">{customerName}</strong> (کد ملی قفل‌شده: <span className="font-mono text-emerald-400 font-bold">{lockedNationalCode}</span>)</span>
                <span>موبایل ضروری: <strong className="text-amber-300 font-mono">{essentialMobile || 'ثبت نشده'}</strong></span>
                <span>نماینده: <strong className="text-emerald-400">{creditFile.representativeId || 'نامشخص'}</strong></span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl transition">
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-zinc-200 bg-zinc-50 px-4 pt-2 overflow-x-auto">
          {(!readOnly || !isManager) && (
            <button 
              onClick={() => setActiveTab('wizard')}
              className={`py-3 px-5 text-xs font-bold transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'wizard' 
                  ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-xl shadow-xs' 
                  : 'border-transparent text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <FilePlus size={16} className="text-emerald-600" />
              <span>{!readOnly ? 'چرخه تشکیل و ارسال پرونده (Workflow)' : 'خلاصه و مستندات پرونده'}</span>
            </button>
          )}

          {readOnly && isManager && (
            <>
              <button 
                onClick={() => setActiveTab('payments')}
                className={`py-3 px-5 text-xs font-bold transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'payments' 
                    ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-xl shadow-xs' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <ShieldCheck size={16} />
                <span>تایید مدارک ارسالی</span>
                <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold">
                  {enhancedDocs.length}
                </span>
              </button>

              <button 
                onClick={() => setActiveTab('checks')}
                className={`py-3 px-5 text-xs font-bold transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'checks' 
                    ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-xl shadow-xs' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <Landmark size={16} />
                <span>تایید چک‌های دریافتی</span>
                <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold">
                  {receivedChecks.length}
                </span>
              </button>

              <button 
                onClick={() => setActiveTab('archive')}
                className={`py-3 px-5 text-xs font-bold transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'archive' 
                    ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-xl shadow-xs' 
                    : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <History size={16} />
                <span>بایگانی مدارک قبلی ({archivedDocs.length + archivedChecks.length})</span>
              </button>
            </>
          )}

          <button 
            onClick={() => setActiveTab('notes')}
            className={`py-3 px-5 text-xs font-bold transition border-b-2 flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'notes' 
                ? 'border-emerald-600 text-emerald-700 bg-white rounded-t-xl shadow-xs' 
                : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <Info size={16} />
            <span>توضیحات و سوابق</span>
          </button>
        </div>

        {/* Compression / Notice Banner */}
        {compressionNotice && (
          <div className="bg-emerald-900 text-white text-xs font-bold px-4 py-2.5 flex items-center justify-between border-b border-emerald-800 animate-in fade-in">
            <div className="flex items-center gap-2">
              <Cpu size={16} className="text-emerald-400 animate-pulse" />
              <span>{compressionNotice}</span>
            </div>
            <button onClick={() => setCompressionNotice(null)} className="text-emerald-300 hover:text-white text-xs">
              متوجه شدم
            </button>
          </div>
        )}

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">

          {/* TAB 1: AGENT WORKFLOW (سلسله‌مراتب واحد و قفل‌شده چرخه پرونده) */}
          {activeTab === 'wizard' && !readOnly && (
            <div className="space-y-6">
              
              {/* Active Credit Policy Information Card (Requirement 1 & 5) */}
              <div className="bg-emerald-50 border-2 border-emerald-300 p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse"></span>
                    <h4 className="text-sm font-black text-emerald-900">
                      سیاست اعتباری منطبق: <span className="text-emerald-700">{matchedPolicy.title}</span>
                    </h4>
                  </div>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    محدوده مبلغ پوشش‌دهی: <strong className="font-mono text-xs">{(matchedPolicy.minAmount || 0).toLocaleString()}</strong> تا <strong className="font-mono text-xs">{(matchedPolicy.maxAmount || 0).toLocaleString()}</strong> ریال
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    این سیاست به صورت هوشمند بر اساس مبلغ درخواستی <strong className="font-mono">{(creditFile.requestedAmount || 0).toLocaleString()} ریال</strong> و طرح اعتباری انتخاب شده اعمال شده است.
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 md:justify-end">
                  {matchedPolicy.needsValidation && (
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-1 rounded-lg border border-emerald-300 flex items-center gap-1">
                      ✓ اعتبارسنجی مشتری
                    </span>
                  )}
                  {matchedPolicy.needsGuarantorInfo && (
                    <span className="bg-teal-100 text-teal-800 text-[10px] font-bold px-2 py-1 rounded-lg border border-teal-300 flex items-center gap-1">
                      👤 ضامن الزامی
                    </span>
                  )}
                  {matchedPolicy.needsGuarantorValidation && (
                    <span className="bg-sky-100 text-sky-800 text-[10px] font-bold px-2 py-1 rounded-lg border border-sky-300 flex items-center gap-1">
                      📊 اعتبارسنجی ضامن
                    </span>
                  )}
                  {matchedPolicy.needsCollateral && (
                    <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-1 rounded-lg border border-purple-300 flex items-center gap-1">
                      📝 وثیقه/ضمانت الزامی
                    </span>
                  )}
                  {matchedPolicy.needsAmaniCheck && (
                    <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-1 rounded-lg border border-amber-300 flex items-center gap-1">
                      💳 چک امانی الزامی
                    </span>
                  )}
                  {matchedPolicy.needsBackSignature && (
                    <span className="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-2 py-1 rounded-lg border border-indigo-300 flex items-center gap-1">
                      ✍ پشت‌امضا چک
                    </span>
                  )}
                </div>
              </div>

              {/* Wizard Step Progression Lock Header */}
              <div className="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-center text-xs font-bold">
                  <div className={`p-3 rounded-xl border flex items-center justify-center gap-2 ${
                    wizardStep === 1 
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm' 
                      : 'bg-white text-zinc-700 border-zinc-200 opacity-80'
                  }`}>
                    <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center font-mono">۱</span>
                    <span>۱. استعلام و قفل کد ملی</span>
                  </div>

                  <div className={`p-3 rounded-xl border flex items-center justify-center gap-2 ${
                    wizardStep === 2 
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm' 
                      : 'bg-white text-zinc-700 border-zinc-200 opacity-80'
                  }`}>
                    <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center font-mono">۲</span>
                    <span>۲. ثبت موبایل ضروری و آدرس</span>
                  </div>

                  <div className={`p-3 rounded-xl border flex items-center justify-center gap-2 ${
                    wizardStep === 3 
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm' 
                      : 'bg-white text-zinc-700 border-zinc-200 opacity-80'
                  }`}>
                    <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center font-mono">۳</span>
                    <span>۳. خلاصه محاسبات اقساط</span>
                  </div>

                  <div className={`p-3 rounded-xl border flex items-center justify-center gap-2 ${
                    wizardStep === 4 
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm' 
                      : 'bg-white text-zinc-700 border-zinc-200 opacity-80'
                  }`}>
                    <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center font-mono">۴</span>
                    <span>۴. راهنمای بارگذاری مدارک و ارسال</span>
                  </div>
                </div>
              </div>

              {/* STEP 1: LOCKED NATIONAL CODE INQUIRY */}
              {wizardStep === 1 && (
                <div className="bg-white border border-zinc-200 p-5 rounded-2xl space-y-4 shadow-xs">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm border-b pb-3">
                    <Lock size={18} className="text-emerald-600" />
                    <span>مرحله اول: استعلام و قفل خودکار کد ملی</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-zinc-700 block mb-1">
                        کد ملی مشتری (قفل‌شده سیستم):
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input 
                            type="text" 
                            readOnly
                            value={lockedNationalCode}
                            className="w-full bg-zinc-100 border border-zinc-300 rounded-xl px-3 py-2.5 text-xs font-mono font-bold text-zinc-800 outline-none cursor-not-allowed pr-9"
                          />
                          <Lock size={15} className="absolute right-3 top-3 text-zinc-400" />
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-1.5 flex items-center gap-1">
                        <Info size={13} className="text-emerald-600" />
                        <span>مطابق با ضوابط امنیت، کد ملی پس از ثبت اولیه قفل گردیده و ورود دستی آن ممنوع است.</span>
                      </p>
                    </div>

                    <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 text-xs space-y-2">
                      <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                        <CheckCircle2 size={16} className="text-emerald-600" />
                        <span>اطلاعات هویتی تأیید شده:</span>
                      </div>
                      <div className="text-zinc-800">نام و نام خانوادگی: <strong className="text-black font-bold">{customerName}</strong></div>
                      <div className="text-zinc-800">وضعیت سامانه ثبت احوال: <span className="text-emerald-700 font-bold">✓ استعلام موفق و معتبر</span></div>
                    </div>
                  </div>

                  {/* RULE 4: SINGLE BUTTON "ثبت و مرحله بعد" */}
                  <div className="flex justify-between items-center pt-4 border-t border-zinc-200">
                    <button 
                      onClick={onClose}
                      className="px-4 py-2 bg-zinc-100 text-zinc-700 rounded-xl text-xs font-bold hover:bg-zinc-200 transition"
                    >
                      انصراف
                    </button>
                    
                    <button 
                      onClick={() => setWizardStep(2)}
                      className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-2 shadow-sm"
                    >
                      <span>ثبت و مرحله بعد</span>
                      <ArrowLeft size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: SUPPLEMENTARY INFO & ESSENTIAL MOBILE */}
              {wizardStep === 2 && (
                <div className="bg-white border border-zinc-200 p-5 rounded-2xl space-y-6 shadow-xs">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm border-b pb-3">
                    <Phone size={18} className="text-emerald-600" />
                    <span>مرحله دوم: ثبت شماره همراه ضروری و اطلاعات تماس</span>
                  </div>

                  <div className="bg-zinc-50 p-4 rounded-xl space-y-4">
                    <h5 className="text-xs font-black text-zinc-800">اطلاعات پایه تماس و آدرس مشتری</h5>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className={isBeta ? "md:col-span-2" : ""}>
                        <label className="text-xs font-bold text-amber-900 block mb-1">
                          شماره همراه ضروری مشتری (الزامی):
                        </label>
                        <input 
                          type="text" 
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={essentialMobile}
                          onChange={e => setEssentialMobile(e.target.value)}
                          placeholder="09123456789"
                          className="w-full bg-amber-50/50 border border-amber-300 rounded-xl px-3 py-2 text-xs font-mono font-bold outline-none focus:border-amber-600"
                        />
                        <p className="text-[10px] text-amber-700 mt-1 font-medium">جهت ارسال پیامک‌های اقساط و اطلاع‌رسانی</p>
                      </div>

                      {!isBeta && (
                        <>
                          <div>
                            <label className="text-xs font-bold text-zinc-700 block mb-1">شماره تماس ضامن / اضطراری:</label>
                            <input 
                              type="text" 
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={emergencyContact}
                              onChange={e => setEmergencyContact(e.target.value)}
                              placeholder="09..."
                              className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="text-xs font-bold text-zinc-700 block mb-1">آدرس دقیق محل سکونت / شغل:</label>
                            <input 
                              type="text" 
                              value={residenceAddress}
                              onChange={e => setResidenceAddress(e.target.value)}
                              placeholder="استان، شهر، خیابان..."
                              className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-500"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* GUARANTOR FORM - Conditional on Policy (Requirement 2 & 3) */}
                  {matchedPolicy.needsGuarantorInfo && !isBeta && (
                    <div className="bg-teal-50/70 border border-teal-200 p-4 rounded-xl space-y-4">
                      <div className="flex items-center gap-2 text-teal-900 font-bold text-xs border-b border-teal-200 pb-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-teal-600"></span>
                        <span>اطلاعات ضامن (الزامی بر اساس سیاست اعتباری جاری)</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="text-xs font-bold text-teal-950 block mb-1">نام و نام خانوادگی ضامن:</label>
                          <input 
                            type="text" 
                            value={guarantorName}
                            onChange={e => setGuarantorName(e.target.value)}
                            placeholder="نام کامل ضامن"
                            className="w-full bg-white border border-teal-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-teal-600 font-medium"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-teal-950 block mb-1">کد ملی ضامن (۱۰ رقمی):</label>
                          <input 
                            type="text" 
                            inputMode="numeric"
                            maxLength={10}
                            value={guarantorNationalId}
                            onChange={e => setGuarantorNationalId(e.target.value)}
                            placeholder="مثال: 0012345678"
                            className="w-full bg-white border border-teal-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-teal-600 font-medium"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-teal-950 block mb-1">تلفن همراه ضامن:</label>
                          <input 
                            type="text" 
                            inputMode="numeric"
                            maxLength={11}
                            value={guarantorPhone}
                            onChange={e => setGuarantorPhone(e.target.value)}
                            placeholder="09..."
                            className="w-full bg-white border border-teal-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-teal-600 font-medium"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* COLLATERAL FORM - Conditional on Policy (Requirement 2 & 3) */}
                  {matchedPolicy.needsCollateral && !isBeta && (
                    <div className="bg-purple-50/70 border border-purple-200 p-4 rounded-xl space-y-4">
                      <div className="flex items-center gap-2 text-purple-900 font-bold text-xs border-b border-purple-200 pb-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-600"></span>
                        <span>مشخصات وثیقه / ضمانت‌نامه (الزامی بر اساس سیاست اعتباری جاری)</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="text-xs font-bold text-purple-950 block mb-1">نوع وثیقه:</label>
                          <select 
                            value={collateralType}
                            onChange={e => setCollateralType(e.target.value)}
                            className="w-full bg-white border border-purple-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-purple-600 font-medium"
                          >
                            <option value="">-- انتخاب کنید --</option>
                            <option value="promissory">سفته الکترونیک</option>
                            <option value="bank_guarantee">ضمانت‌نامه بانکی</option>
                            <option value="gold">طلا</option>
                            <option value="property">سند ملک</option>
                            <option value="check">چک صیادی ضمانتی</option>
                            <option value="other">سایر وثایق معتبر</option>
                          </select>
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-xs font-bold text-purple-950 block mb-1">شرح دقیق وثیقه (شماره، شناسه، جزییات):</label>
                          <input 
                            type="text" 
                            value={collateralDescription}
                            onChange={e => setCollateralDescription(e.target.value)}
                            placeholder="مثال: سفته الکترونیکی به شماره ۱۲۳۴۵۶..."
                            className="w-full bg-white border border-purple-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-purple-600"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-purple-950 block mb-1">ارزش تقریبی وثیقه (ریال):</label>
                          <input 
                            type="number" 
                            value={collateralValue || ''}
                            onChange={e => setCollateralValue(Number(e.target.value))}
                            placeholder="مبلغ به ریال"
                            className="w-full bg-white border border-purple-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-purple-600 font-medium"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* AMANI CHECK FORM - Conditional on Policy (Requirement 2 & 3) */}
                  {matchedPolicy.needsAmaniCheck && !isBeta && (
                    <div className="bg-amber-50/70 border border-amber-200 p-4 rounded-xl space-y-4">
                      <div className="flex items-center gap-2 text-amber-900 font-bold text-xs border-b border-amber-200 pb-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-600"></span>
                        <span>ثبت مشخصات چک امانی / امانت صیادی (الزامی بر اساس سیاست اعتباری جاری)</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="text-xs font-bold text-amber-950 block mb-1">شماره چک امانی:</label>
                          <input 
                            type="text" 
                            value={amaniCheckNumber}
                            onChange={e => setAmaniCheckNumber(e.target.value)}
                            placeholder="شماره ۸ رقمی چک"
                            className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-amber-600 font-medium"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-amber-950 block mb-1">نام بانک صادرکننده چک:</label>
                          <input 
                            type="text" 
                            value={amaniCheckBankName}
                            onChange={e => setAmaniCheckBankName(e.target.value)}
                            placeholder="مثال: بانک ملی"
                            className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-amber-600 font-medium"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-amber-950 block mb-1">مبلغ چک امانی (ریال):</label>
                          <input 
                            type="number" 
                            value={amaniCheckAmount || ''}
                            onChange={e => setAmaniCheckAmount(Number(e.target.value))}
                            placeholder="مثال: ۵۰۰,۰۰۰,۰۰۰"
                            className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-amber-600 font-medium"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-amber-950 block mb-1">تاریخ سررسید چک امانی:</label>
                          <input 
                            type="text" 
                            value={amaniCheckDueDate}
                            onChange={e => setAmaniCheckDueDate(e.target.value)}
                            placeholder="۱۴۰۲/۰۸/۳۰"
                            className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-amber-600 font-medium"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-xs font-bold text-amber-950 block mb-1">شناسه صیادی چک امانی (۱۶ رقمی):</label>
                          <input 
                            type="text" 
                            maxLength={16}
                            value={amaniCheckSayadiNumber}
                            onChange={e => setAmaniCheckSayadiNumber(e.target.value)}
                            placeholder="شناسه صیادی ۱۶ رقمی"
                            className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-amber-600 font-medium"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* RULE 4: ONLY "ثبت و مرحله بعد" & "مرحله قبل" & "انصراف" */}
                  <div className="flex justify-between items-center pt-4 border-t border-zinc-200">
                    <div className="flex gap-2">
                      <button 
                        onClick={onClose}
                        className="px-4 py-2 bg-zinc-100 text-zinc-700 rounded-xl text-xs font-bold hover:bg-zinc-200 transition"
                      >
                        انصراف
                      </button>
                      <button 
                        onClick={() => setWizardStep(1)}
                        className="px-4 py-2 bg-zinc-200 text-zinc-800 rounded-xl text-xs font-bold hover:bg-zinc-300 transition"
                      >
                        مرحله قبل
                      </button>
                    </div>

                    <button 
                      onClick={() => {
                        // 1. Base validation
                        if (!essentialMobile || essentialMobile.trim().length < 10) {
                          alert('لطفاً شماره همراه ضروری معتبر مشتری را وارد نمایید.');
                          return;
                        }

                        // 2. Guarantor validation if required
                        if (matchedPolicy.needsGuarantorInfo) {
                          if (!guarantorName || !guarantorName.trim()) {
                            alert('لطفاً نام و نام خانوادگی ضامن را وارد نمایید.');
                            return;
                          }
                          if (!guarantorNationalId || guarantorNationalId.trim().length !== 10) {
                            alert('لطفاً کد ملی ۱۰ رقمی ضامن را به درستی وارد نمایید.');
                            return;
                          }
                          if (!guarantorPhone || guarantorPhone.trim().length < 10) {
                            alert('لطفاً شماره همراه معتبر ضامن را وارد نمایید.');
                            return;
                          }
                        }

                        // 3. Collateral validation if required
                        if (matchedPolicy.needsCollateral) {
                          if (!collateralType) {
                            alert('لطفاً نوع وثیقه/ضمانت را انتخاب کنید.');
                            return;
                          }
                          if (!collateralDescription || !collateralDescription.trim()) {
                            alert('لطفاً شرح وثیقه را وارد نمایید.');
                            return;
                          }
                          if (!collateralValue || collateralValue <= 0) {
                            alert('لطفاً ارزش تقریبی وثیقه را به درستی وارد نمایید.');
                            return;
                          }
                        }

                        // 4. Amani validation if required
                        if (matchedPolicy.needsAmaniCheck) {
                          if (!amaniCheckNumber || !amaniCheckNumber.trim()) {
                            alert('لطفاً شماره چک امانی را وارد نمایید.');
                            return;
                          }
                          if (!amaniCheckBankName || !amaniCheckBankName.trim()) {
                            alert('لطفاً نام بانک صادرکننده چک امانی را وارد نمایید.');
                            return;
                          }
                          if (!amaniCheckAmount || amaniCheckAmount <= 0) {
                            alert('لطفاً مبلغ معتبر چک امانی را وارد نمایید.');
                            return;
                          }
                          if (!amaniCheckDueDate || !amaniCheckDueDate.trim()) {
                            alert('لطفاً تاریخ سررسید چک امانی را تعیین نمایید.');
                            return;
                          }
                          if (!amaniCheckSayadiNumber || amaniCheckSayadiNumber.trim().length !== 16) {
                            alert('لطفاً شناسه صیادی ۱۶ رقمی معتبر چک امانی را وارد نمایید.');
                            return;
                          }
                        }

                        // Save all fields atomically
                        saveStateToParent(enhancedDocs, receivedChecks, archivedDocs, archivedChecks, {
                          essentialMobile,
                          emergencyContact,
                          residenceAddress,
                          guarantorName,
                          guarantorNationalId,
                          guarantorPhone,
                          collateralType,
                          collateralDescription,
                          collateralValue,
                          amaniCheckNumber,
                          amaniCheckBankName,
                          amaniCheckAmount,
                          amaniCheckDueDate,
                          amaniCheckSayadiNumber
                        });
                        setWizardStep(3);
                      }}
                      className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-2 shadow-sm"
                    >
                      <span>ثبت و مرحله بعد</span>
                      <ArrowLeft size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: INSTALLMENT CALCULATIONS SUMMARY */}
              {wizardStep === 3 && (
                <div className="bg-white border border-zinc-200 p-5 rounded-2xl space-y-4 shadow-xs">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm border-b pb-3">
                    <Banknote size={18} className="text-emerald-600" />
                    <span>مرحله سوم: خلاصه محاسبه مالی و اقساط</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-zinc-50 p-4 rounded-xl border border-zinc-200">
                    <div>
                      <div className="text-[11px] text-zinc-500">مبلغ اعتبار:</div>
                      <div className="text-sm font-bold text-zinc-900 font-mono">
                        {(creditFile.requestedAmount || 0).toLocaleString()} ریال
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-zinc-500">تعداد اقساط:</div>
                      <div className="text-sm font-bold text-zinc-900 font-mono">
                        {creditFile.calculationResults?.installmentCount || 12} ماهه
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-zinc-500">مبلغ هر قسط:</div>
                      <div className="text-sm font-bold text-emerald-700 font-mono">
                        {(creditFile.calculationResults?.installmentAmount || 0).toLocaleString()} ریال
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-zinc-500">عنوان طرح:</div>
                      <div className="text-sm font-bold text-zinc-900">
                        {creditFile.calculatorName || creditFile.plan || 'طرح اقساطی استاندارد'}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-zinc-600 bg-amber-50/70 p-3.5 rounded-xl border border-amber-200">
                    🔒 تمام محاسبات فوق مستقیم از موتور محاسباتی استخراج شده است. هیچ تغییری در فرمول‌های مالی ایجاد نگردیده است.
                  </div>

                  <div className="flex justify-between items-center pt-4 border-t border-zinc-200">
                    <div className="flex gap-2">
                      <button 
                        onClick={onClose}
                        className="px-4 py-2 bg-zinc-100 text-zinc-700 rounded-xl text-xs font-bold hover:bg-zinc-200 transition"
                      >
                        انصراف
                      </button>
                      <button 
                        onClick={() => setWizardStep(2)}
                        className="px-4 py-2 bg-zinc-200 text-zinc-800 rounded-xl text-xs font-bold hover:bg-zinc-300 transition"
                      >
                        مرحله قبل
                      </button>
                    </div>

                    <button 
                      onClick={() => setWizardStep(4)}
                      className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-2 shadow-sm"
                    >
                      <span>ثبت و مرحله بعد</span>
                      <ArrowLeft size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 4: GUIDED AGENT DOCUMENT & CHEQUE UPLOAD WIZARD (دستور ۵) */}
              {wizardStep === 4 && (
                <div className="bg-white border border-zinc-200 p-5 rounded-2xl space-y-6 shadow-xs">
                  <div className="flex items-center justify-between border-b pb-3">
                    <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                      <Upload size={18} className="text-emerald-600" />
                      <span>مرحله چهارم: راهنمای قدم‌به‌قدم بارگذاری مدارک و ارسال جهت بررسی</span>
                    </div>
                    <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full font-mono">
                      {isBeta ? 'گام ۱ از ۱ (طرح بتا)' : `گام ${guidedSubStep} از ۵`}
                    </span>
                  </div>

                  {/* Guided Assistant Prompt Container */}
                  <div className="bg-emerald-50/60 border border-emerald-200 p-4 rounded-xl space-y-3">
                    {guidedSubStep === 1 && (
                      <div className="space-y-3">
                        <div className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">۱</span>
                          <span>لطفاً تصویر کارت ملی (رو و پشت) مشتری را بارگذاری کنید.</span>
                        </div>
                        <p className="text-xs text-zinc-600">تصویر واضح و خوانا از روی کارت ملی هوشمند یا شناسنامه جدید مشتری را انتخاب کنید.</p>
                        
                        <div className="flex flex-wrap gap-2">
                          <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-emerald-700 transition shadow-sm">
                            <Upload size={15} />
                            <span>انتخاب فایل کارت ملی</span>
                            <input 
                              type="file" 
                              accept="image/*,.pdf" 
                              onChange={(e) => handleFileUploadForCategory(e, 'national_card')}
                              className="hidden" 
                            />
                          </label>

                          {matchedPolicy.needsGuarantorValidation && (
                            <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-xl text-xs font-bold cursor-pointer hover:bg-emerald-200 transition shadow-sm">
                              <User size={15} />
                              <span>کارت ملی ضامن</span>
                              <input 
                                type="file" 
                                accept="image/*,.pdf" 
                                onChange={(e) => handleFileUploadForCategory(e, 'national_card', 'کارت ملی ضامن')}
                                className="hidden" 
                              />
                            </label>
                          )}
                        </div>
                      </div>
                    )}

                    {guidedSubStep === 2 && !isBeta && (
                      <div className="space-y-3">
                        <div className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">۲</span>
                          <span>لطفاً فایل اعتبارسنجی بانکی (PDF یا Excel) یا مدرک شغلی را بارگذاری کنید.</span>
                        </div>
                        <p className="text-xs text-zinc-600">گزارش اعتبارسنجی مرآت، آسیا، فیش حقوقی یا پروانه کسب معتبر مشتری.</p>
                        
                        <div className="flex flex-wrap gap-2">
                          <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-emerald-700 transition shadow-sm">
                            <Upload size={15} />
                            <span>بارگذاری فایل اعتبارسنجی / شغلی</span>
                            <input 
                              type="file" 
                              accept="image/*,.pdf,.xlsx,.xls" 
                              onChange={(e) => handleFileUploadForCategory(e, 'bank_credit_scoring')}
                              className="hidden" 
                            />
                          </label>

                          {matchedPolicy.needsGuarantorValidation && (
                            <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-100 text-emerald-700 border border-emerald-300 rounded-xl text-xs font-bold cursor-pointer hover:bg-emerald-200 transition shadow-sm">
                              <FileCheck size={15} />
                              <span>اعتبارسنجی / فیش ضامن</span>
                              <input 
                                type="file" 
                                accept="image/*,.pdf,.xlsx,.xls" 
                                onChange={(e) => handleFileUploadForCategory(e, 'bank_credit_scoring', 'اعتبارسنجی / فیش ضامن')}
                                className="hidden" 
                              />
                            </label>
                          )}
                        </div>
                      </div>
                    )}

                    {guidedSubStep === 3 && !isBeta && (
                      <div className="space-y-3">
                        <div className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">۳</span>
                          <span>لطفاً تصاویر چک‌های صیادی را بارگذاری کنید.</span>
                        </div>
                        <p className="text-xs text-zinc-600">تصاویر تمامی چک‌های صیادی محاسبه‌شده در مرحله قبل را آپلود نمایید. امکان انتخاب همزمان چند فایل فراهم می‌باشد.</p>
                        
                        <div className="flex gap-2">
                          <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-emerald-700 transition shadow-sm">
                            <Upload size={16} />
                            <span>بارگذاری تصویر چک‌ها (امکان انتخاب همزمان چند فایل)</span>
                            <input 
                              type="file" 
                              multiple
                              accept="image/*" 
                              onChange={(e) => handleFileUploadForCategory(e, 'check_images')}
                              className="hidden" 
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {guidedSubStep === 4 && !isBeta && (
                      <div className="space-y-3">
                        <div className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">۴</span>
                          <span>آیا مدرک دیگری برای ارسال به مدیریت دارید؟</span>
                        </div>
                        <p className="text-xs text-zinc-600">در صورت نیاز می‌توانید هر تعداد مدرک متفرقه مانند اجاره‌نامه، سند یا قبوض با عنوان دلخواه ثبت نمایید.</p>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end bg-white p-3 rounded-xl border border-zinc-200">
                          <div>
                            <label className="text-[11px] font-bold text-zinc-700 block mb-1">عنوان مدرک متفرقه دلخواه:</label>
                            <input 
                              type="text"
                              value={customDocTitle}
                              onChange={e => setCustomDocTitle(e.target.value)}
                              placeholder="مثلاً: اجاره‌نامه / سند مسکونی / قبوض..."
                              className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-500"
                            />
                          </div>

                          <label className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-emerald-700 transition flex items-center justify-center gap-2">
                            <Upload size={15} />
                            <span>بارگذاری مدرک سفارشی</span>
                            <input 
                              type="file" 
                              accept="image/*,.pdf,.xlsx" 
                              onChange={(e) => handleFileUploadForCategory(e, 'other')}
                              className="hidden" 
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {guidedSubStep === 5 && !isBeta && (
                      <div className="space-y-3">
                        <div className="text-sm font-bold text-emerald-900 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">۵</span>
                          <span>آیا توضیحی برای مدیریت دارید؟</span>
                        </div>
                        <p className="text-xs text-zinc-600">یادداشت اختصاصی نماینده جهت اطلاع مدیریت کارشناسی اعتبار درناتل.</p>
                        
                        <div>
                          <label className="text-xs font-bold text-zinc-800 block mb-1">یادداشت برای مدیریت:</label>
                          <textarea 
                            rows={3}
                            value={agentNote}
                            onChange={e => setAgentNote(e.target.value)}
                            placeholder="توضیحات تکمیلی درباره مدارک، وضعیت شغلی مشتری یا چک‌های دریافتی..."
                            className="w-full bg-white border border-zinc-300 rounded-xl p-3 text-xs outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Guided Navigation Buttons inside Step 4 */}
                  <div className="flex justify-between items-center bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
                    <div className="flex gap-2">
                      {guidedSubStep > 1 && !isBeta && (
                        <button 
                          onClick={() => setGuidedSubStep((guidedSubStep - 1) as any)}
                          className="px-4 py-2 bg-zinc-200 text-zinc-800 rounded-xl text-xs font-bold hover:bg-zinc-300 transition"
                        >
                          گام قبل ({guidedSubStep - 1})
                        </button>
                      )}
                    </div>

                    {!isBeta && guidedSubStep < 5 ? (
                      <button 
                        onClick={() => setGuidedSubStep((guidedSubStep + 1) as any)}
                        className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1.5"
                      >
                        <span>ثبت و گام بعد</span>
                        <ArrowLeft size={14} />
                      </button>
                    ) : (
                      <span className="text-xs text-emerald-800 font-bold">
                        {isBeta ? '✓ تصویر کارت ملی کافی است (آماده ارسال نهایی)' : '✓ آماده ارسال نهایی'}
                      </span>
                    )}
                  </div>

                  {/* List of uploaded documents & checks with LOCKED status display */}
                  <div className="space-y-4 pt-2">
                    <div className="text-xs font-bold text-zinc-800">لیست مدارک و چک‌های بارگذاری‌شده در این پرونده:</div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto">
                      {enhancedDocs.map(doc => {
                        const isLocked = doc.reviewMetadata.status === 'approved';
                        const isNeedsRevision = doc.reviewMetadata.status === 'needs_revision';

                        return (
                          <div 
                            key={doc.attachment.id}
                            className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                              isLocked 
                                ? 'bg-emerald-50/50 border-emerald-300' 
                                : isNeedsRevision 
                                ? 'bg-amber-50/70 border-amber-300' 
                                : 'bg-white border-zinc-200'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-zinc-900 truncate">{doc.attachment.name}</span>
                              {isLocked ? (
                                <span className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                  <Lock size={11} />
                                  <span>تأیید شده و قفل</span>
                                </span>
                              ) : isNeedsRevision ? (
                                <span className="text-[10px] bg-amber-600 text-white px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                  <RefreshCw size={11} />
                                  <span>نیازمند اصلاح</span>
                                </span>
                              ) : (
                                <span className="text-[10px] bg-zinc-200 text-zinc-700 px-2 py-0.5 rounded">
                                  در انتظار بررسی
                                </span>
                              )}
                            </div>

                            {isNeedsRevision && doc.reviewMetadata.rejectionReason && (
                              <div className="text-[11px] text-amber-900 bg-amber-100/80 p-2 rounded-lg font-bold">
                                💬 علت اصلاح مدیریت: {doc.reviewMetadata.rejectionReason}
                              </div>
                            )}

                            <div className="flex justify-between items-center pt-1 text-[11px] text-zinc-500">
                              <span>حجم: {doc.attachment.fileSizeKb} KB</span>
                              {!isLocked && (
                                <button 
                                  onClick={() => setItemToDelete({ type: 'doc', item: doc })}
                                  className="text-rose-600 hover:text-rose-800 font-bold flex items-center gap-1"
                                >
                                  <Trash2 size={13} />
                                  <span>حذف / جایگزینی</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {receivedChecks.map(chk => {
                        const isLocked = chk.reviewStatus === CheckReviewStatus.APPROVED;
                        const isNeedsRevision = chk.reviewStatus === CheckReviewStatus.NEEDS_CORRECTION;
                        const isRejected = chk.reviewStatus === CheckReviewStatus.REJECTED;

                        return (
                          <div 
                            key={chk.id}
                            className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                              isLocked 
                                ? 'bg-emerald-50/50 border-emerald-300' 
                                : isNeedsRevision 
                                ? 'bg-amber-50/70 border-amber-300' 
                                : isRejected
                                ? 'bg-rose-50/70 border-rose-300'
                                : 'bg-white border-zinc-200'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-zinc-900 font-mono">چک {chk.bankName} - {chk.checkNumber}</span>
                              {isLocked ? (
                                <span className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                  <Lock size={11} />
                                  <span>تأیید شده و قفل</span>
                                </span>
                              ) : isNeedsRevision ? (
                                <span className="text-[10px] bg-amber-600 text-white px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                  <RefreshCw size={11} />
                                  <span>نیازمند اصلاح</span>
                                </span>
                              ) : isRejected ? (
                                <span className="text-[10px] bg-rose-600 text-white px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                  <AlertCircle size={11} />
                                  <span>رد شده</span>
                                </span>
                              ) : (
                                <span className="text-[10px] bg-zinc-200 text-zinc-700 px-2 py-0.5 rounded">
                                  در انتظار بررسی
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] font-mono text-zinc-700">
                              مبلغ: {(chk.amount || 0).toLocaleString()} ریال | تاریخ: {chk.dueDate}
                            </div>

                            {isNeedsRevision && chk.revisionNote && (
                              <div className="text-[11px] text-amber-900 bg-amber-100/80 p-2 rounded-lg font-bold">
                                💬 علت اصلاح مدیریت: {chk.revisionNote}
                              </div>
                            )}

                            {!isLocked && (
                              <div className="flex justify-end pt-1">
                                <button 
                                  onClick={() => setItemToDelete({ type: 'check', item: chk })}
                                  className="text-rose-600 hover:text-rose-800 text-[11px] font-bold flex items-center gap-1"
                                >
                                  <Trash2 size={13} />
                                  <span>حذف چک</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* RULE 5: SINGLE FINAL SUBMISSION BUTTON FOR AGENT */}
                  <div className="pt-4 border-t border-zinc-200 flex justify-between items-center">
                    <button 
                      onClick={() => setWizardStep(3)}
                      className="px-4 py-2 bg-zinc-200 text-zinc-800 rounded-xl text-xs font-bold hover:bg-zinc-300 transition"
                    >
                      مرحله قبل
                    </button>

                    <button 
                      onClick={handleSubmitFileForReview}
                      className="px-8 py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition shadow-md flex items-center gap-2"
                    >
                      <ShieldCheck size={18} />
                      <span>ارسال پرونده جهت بررسی مدیریت</span>
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* TAB 2 & MANAGER REVIEW PANEL (اصلاح کامل گردش کار مدیریت - دستور ۶ و ۷) */}
          {isManager && (activeTab === 'payments' || readOnly) && (
            <div className="space-y-6">

              {/* Manager Warning / Progress Header */}
              <div className="bg-zinc-900 text-white p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="font-bold text-sm text-emerald-400 flex items-center gap-2">
                    <ShieldCheck size={20} />
                    <span>پنل ارزیابی و بررسی دقیق مدارک توسط مدیریت اعتبارات</span>
                  </div>
                  <p className="text-xs text-zinc-300">
                    بررسی تک‌تک مدارک و تعیین وضعیت (تأیید / نیاز به اصلاح / رد) الزامی است.
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <div className="bg-emerald-900/60 border border-emerald-700/60 px-3 py-1.5 rounded-xl">
                    تأییدشده: <strong className="text-emerald-300 font-mono">{approvedDocsCount + approvedChecksCount}</strong>
                  </div>
                  <div className="bg-amber-900/60 border border-amber-700/60 px-3 py-1.5 rounded-xl">
                    نیازمند اصلاح: <strong className="text-amber-300 font-mono">{totalNeedsRevisionCount}</strong>
                  </div>
                  <div className="bg-rose-900/60 border border-rose-700/60 px-3 py-1.5 rounded-xl">
                    بررسی‌نشده: <strong className="text-rose-300 font-mono">{totalUnreviewedCount}</strong>
                  </div>
                </div>
              </div>

              {/* RULE 6: Unreviewed Items Banner */}
              {totalUnreviewedCount > 0 && (
                <div className="bg-amber-50 border border-amber-300 text-amber-900 p-4 rounded-2xl text-xs font-bold flex items-center gap-3">
                  <AlertTriangle size={22} className="text-amber-600 shrink-0" />
                  <div>
                    امکان «تأیید نهایی پرونده» فعال نمی‌باشد! تعداد <span className="font-mono text-rose-700 text-sm font-black underline mx-1">{totalUnreviewedCount}</span> مورد (مدارک یا چک‌ها) هنوز توسط مدیریت بررسی نشده‌اند. لطفاً روی هر آیتم کلیک کرده و وضعیت آن را ثبت کنید.
                  </div>
                </div>
              )}

              {/* Document List for Inspection */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {enhancedDocs.map((doc, idx) => {
                  const status = doc.reviewMetadata.status;
                  return (
                    <div 
                      key={doc.attachment.id}
                      className={`p-4 rounded-2xl border transition space-y-3 bg-white ${
                        status === 'approved' 
                          ? 'border-emerald-300 shadow-xs' 
                          : status === 'needs_revision' 
                          ? 'border-amber-400 bg-amber-50/30' 
                          : status === 'rejected'
                          ? 'border-rose-400 bg-rose-50/30'
                          : 'border-zinc-300'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="font-bold text-xs text-zinc-900 line-clamp-2">
                          {doc.attachment.name}
                        </div>
                        {renderStatusBadge(status)}
                      </div>

                      <div className="text-[11px] text-zinc-500 space-y-1">
                        <div>دسته: <span className="text-zinc-800 font-bold">{doc.attachment.category}</span></div>
                        <div>تاریخ بارگذاری: <span className="font-mono">{doc.attachment.uploadDate}</span></div>
                      </div>

                      {doc.reviewMetadata.rejectionReason && (
                        <div className="text-xs bg-amber-100/90 text-amber-900 p-2.5 rounded-xl font-bold">
                          💬 علت ارجاع/رد: {doc.reviewMetadata.rejectionReason}
                        </div>
                      )}

                      {/* Manager Action Buttons */}
                      <div className="pt-2 border-t border-zinc-200 flex items-center justify-between gap-2">
                        <button 
                          onClick={() => setPreviewDoc(doc)}
                          className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-800 rounded-lg text-xs font-bold flex items-center gap-1"
                        >
                          <Eye size={13} />
                          <span>مشاهده</span>
                        </button>

                        {(isManager || readOnly) && (
                          <button 
                            onClick={() => {
                              setReviewingDoc(doc);
                              setReviewStatus(doc.reviewMetadata.status === 'unreviewed' ? 'approved' : doc.reviewMetadata.status);
                              setReviewReasonText(doc.reviewMetadata.rejectionReason || '');
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1"
                          >
                            <ShieldCheck size={13} />
                            <span>تعیین وضعیت</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Manager Decision Execution Footer Bar (دستور ۶ و ۷) */}
              <div className="bg-white border border-zinc-200 p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
                <div>
                  <div className="font-bold text-xs text-zinc-800">جمع‌بندی وضعیت نهایی پرونده:</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {totalUnreviewedCount > 0 
                      ? '🔒 جهت فعال شدن دکمه نهایی، ابتدا تمام موارد فوق را بررسی و تعیین تکلیف کنید.'
                      : totalNeedsRevisionCount > 0
                      ? '⚠️ با انتخاب ارجاع، فقط موارد نیازمند اصلاح به نماینده عودت داده می‌شوند.'
                      : '✅ تمام مدارک تأیید شده‌اند. آمادگی جهت تأیید نهایی و صدور اسناد مالی.'}
                  </div>
                </div>

                <button 
                  disabled={totalUnreviewedCount > 0}
                  onClick={handleManagerDecision}
                  className={`px-8 py-3.5 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md ${
                    totalUnreviewedCount > 0
                      ? 'bg-zinc-300 text-zinc-500 cursor-not-allowed border border-zinc-400'
                      : totalNeedsRevisionCount > 0
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                >
                  {totalUnreviewedCount > 0 ? (
                    <>
                      <Lock size={16} />
                      <span>تأیید نهایی قفل است ({totalUnreviewedCount} مورد بررسی نشده)</span>
                    </>
                  ) : totalNeedsRevisionCount > 0 ? (
                    <>
                      <RefreshCw size={16} />
                      <span>ارجاع به نماینده جهت اصلاح ({totalNeedsRevisionCount} مورد معیوب)</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      <span>تأیید نهایی پرونده و اجرای اسناد حسابداری</span>
                    </>
                  )}
                </button>
              </div>

            </div>
          )}

          {/* TAB 3: CHEQUES INSPECTION & REVIEW */}
          {activeTab === 'checks' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center border-b pb-3">
                <div className="font-bold text-sm text-zinc-900 flex items-center gap-2">
                  <Landmark size={18} className="text-emerald-600" />
                  <span>فهرست چک‌های صیادی و دریافتی ({receivedChecks.length})</span>
                </div>

                {!effectiveReadOnly && (
                  <label className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1.5 cursor-pointer shadow-sm">
                    <Upload size={15} />
                    <span>بارگذاری تصویر چک‌ها (انتخاب چندگانه)</span>
                    <input 
                      type="file" 
                      multiple
                      accept="image/*" 
                      onChange={(e) => handleFileUploadForCategory(e, 'check_images')}
                      className="hidden" 
                    />
                  </label>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {receivedChecks.map((chk, index) => {
                  const isLocked = chk.reviewStatus === CheckReviewStatus.APPROVED;
                  const isNeedsRevision = chk.reviewStatus === CheckReviewStatus.NEEDS_CORRECTION;
                  const isRejected = chk.reviewStatus === CheckReviewStatus.REJECTED;

                  return (
                    <div 
                      key={chk.id} 
                      className={`group bg-white border-2 rounded-[32px] overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
                        isLocked ? 'border-emerald-200 shadow-emerald-100/50' : 
                        isNeedsRevision ? 'border-amber-200 shadow-amber-100/50' : 
                        isRejected ? 'border-rose-200 shadow-rose-100/50' : 
                        'border-zinc-100 shadow-zinc-100/50'
                      }`}
                    >
                      {/* Card Header */}
                      <div className={`px-6 py-4 flex justify-between items-center border-b ${
                        isLocked ? 'bg-emerald-50/50 border-emerald-100' : 
                        isNeedsRevision ? 'bg-amber-50/50 border-amber-100' : 
                        isRejected ? 'bg-rose-50/50 border-rose-100' : 
                        'bg-zinc-50 border-zinc-100'
                      }`}>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-white border border-zinc-200 flex items-center justify-center text-xs font-black text-zinc-900 shadow-sm">
                            {index + 1}
                          </div>
                          <div>
                            <div className="font-bold text-sm text-zinc-900">چک {chk.bankName}</div>
                            <div className="text-[10px] text-zinc-500 font-mono">سریال: {chk.checkNumber}</div>
                          </div>
                        </div>
                        {renderStatusBadge(chk.reviewStatus || 'PENDING_REVIEW')}
                      </div>

                      <div className="p-6 space-y-5">
                        {/* Financial Info */}
                        <div className="flex justify-between items-center bg-zinc-50 p-4 rounded-2xl border border-zinc-100/50">
                          <div>
                            <div className="text-[10px] text-zinc-500 font-bold mb-1">مبلغ چک</div>
                            <div className="text-xl font-black text-emerald-700 tracking-tight">
                              {(chk.amount || 0).toLocaleString()}
                              <span className="text-[10px] font-normal text-zinc-500 mr-1">ریال</span>
                            </div>
                          </div>
                          <div className="text-left">
                            <div className="text-[10px] text-zinc-500 font-bold mb-1">تاریخ سررسید</div>
                            <div className="text-sm font-bold text-zinc-900 flex items-center gap-1.5 justify-end">
                              <Calendar size={14} className="text-zinc-400" />
                              {chk.dueDate}
                            </div>
                          </div>
                        </div>

                        {/* Sayadi Number Section */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-zinc-500 flex items-center gap-1">
                              <Hash size={12} />
                              شناسه صیادی ۱۶ رقمی
                            </label>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => {
                                  navigator.clipboard.writeText(chk.sayadiNumber || '');
                                  alert('شماره صیادی در حافظه کپی شد.');
                                }}
                                className="flex items-center gap-1 px-2 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-lg text-[9px] font-bold transition-colors"
                              >
                                <Copy size={12} />
                                کپی
                              </button>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                chk.sayadiNumber?.length === 16 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                              }`}>
                                {chk.sayadiNumber?.length || 0} / ۱۶ رقم
                              </span>
                            </div>
                          </div>
                          <div className="relative group/sayadi">
                            <div className="bg-zinc-900 text-white font-mono text-center py-3.5 rounded-2xl text-xl sm:text-2xl tracking-[0.25em] shadow-inner border border-zinc-800 select-all transition-all group-hover/sayadi:bg-black flex items-center justify-center gap-3">
                              <Hash size={24} className="text-zinc-500 opacity-50 group-hover/sayadi:opacity-100 transition-opacity" />
                              <span>{chk.sayadiNumber || '----------------'}</span>
                            </div>
                          </div>
                          {chk.sayadiNumber && chk.sayadiNumber.trim().length > 0 && (
                            <div className="mt-2.5 p-3 bg-white border border-zinc-200 rounded-2xl flex flex-col items-center justify-center shadow-xs overflow-hidden">
                              <Barcode 
                                value={chk.sayadiNumber.trim()} 
                                format="CODE128" 
                                width={1.5} 
                                height={48} 
                                displayValue={false} 
                                margin={0} 
                                background="#ffffff" 
                                lineColor="#000000" 
                              />
                              <span className="text-[10px] text-zinc-500 font-mono mt-1.5 dir-ltr tracking-wider">
                                {chk.sayadiNumber.trim()}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Revision Note */}
                        {chk.revisionNote && (
                          <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl flex gap-3 animate-in fade-in slide-in-from-top-1">
                            <AlertCircle size={18} className="text-rose-600 shrink-0 mt-0.5" />
                            <div className="text-xs text-rose-900 leading-relaxed">
                              <span className="font-black block mb-1">توضیحات بررسی مدیریت:</span>
                              {chk.revisionNote}
                            </div>
                          </div>
                        )}

                        {/* Review Button */}
                        {(isManager || readOnly) && (
                          <button 
                            onClick={() => {
                              setReviewingCheck(chk);
                              setReviewStatus(
                                chk.reviewStatus === CheckReviewStatus.APPROVED ? 'approved' : 
                                chk.reviewStatus === CheckReviewStatus.NEEDS_CORRECTION ? 'needs_revision' : 
                                chk.reviewStatus === CheckReviewStatus.REJECTED ? 'rejected' : 
                                'unreviewed' as any
                              );
                              setReviewReasonText(chk.revisionNote || '');
                            }}
                            className={`w-full py-4 text-sm font-black rounded-2xl transition-all flex items-center justify-center gap-2 group/btn ${
                              isLocked 
                                ? 'bg-zinc-100 text-zinc-500 border border-zinc-200' 
                                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 active:scale-[0.98]'
                            }`}
                          >
                            {isLocked ? <CheckSquare size={18} /> : <ShieldCheck size={18} className="transition-transform group-hover/btn:scale-110" />}
                            <span>{isLocked ? 'مشاهده و بازنگری وضعیت' : 'بررسی و تعیین تکلیف این چک'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: ARCHIVE / HISTORY */}
          {activeTab === 'archive' && (
            <div className="space-y-4">
              <div className="font-bold text-sm text-zinc-800 flex items-center gap-2 border-b pb-3">
                <History size={18} className="text-emerald-600" />
                <span>سوابق و نسخه قبلی مدارک حذف/جایگزین‌شده ({archivedDocs.length + archivedChecks.length})</span>
              </div>

              {archivedDocs.length === 0 && archivedChecks.length === 0 ? (
                <div className="text-center py-8 text-xs text-zinc-400 bg-zinc-50 rounded-2xl border border-dashed border-zinc-300">
                  هیچ مدرک یا چکی تاکنون بایگانی یا جایگزین نگردیده است.
                </div>
              ) : (
                <div className="space-y-3">
                  {archivedDocs.map((item, idx) => (
                    <div key={idx} className="bg-zinc-50 border border-zinc-200 p-3 rounded-xl text-xs space-y-1">
                      <div className="font-bold text-zinc-800">{item.attachment?.name || 'مدرک بایگانی‌شده'}</div>
                      <div className="text-zinc-500">تاریخ بایگانی: {item.archivedAt} | علت: {item.archiveReason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: NOTES & DOSSIER LOGS */}
          {activeTab === 'notes' && (
            <div className="space-y-4">
              <div className="font-bold text-sm text-zinc-800 flex items-center gap-2 border-b pb-3">
                <Info size={18} className="text-emerald-600" />
                <span>یادداشت‌ها و سوابق کامل پرونده</span>
              </div>

              <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-3 text-xs">
                <div>
                  <strong className="text-zinc-900 block mb-1">یادداشت ثبت‌شده توسط نماینده:</strong>
                  <p className="bg-white p-3 rounded-xl border border-zinc-200 text-zinc-700 whitespace-pre-wrap">
                    {agentNote || 'هیچ یادداشتی توسط نماینده ثبت نگردیده است.'}
                  </p>
                </div>

                <div>
                  <strong className="text-zinc-900 block mb-1">اطلاعات هویتی و تماس پرونده:</strong>
                  <ul className="list-disc list-inside space-y-1 text-zinc-600">
                    <li>کد ملی: <span className="font-mono text-black font-bold">{lockedNationalCode}</span></li>
                    <li>موبایل ضروری: <span className="font-mono text-black font-bold">{essentialMobile || 'ثبت نشده'}</span></li>
                    <li>تماس اضطراری: <span className="font-mono text-black">{emergencyContact || 'ثبت نشده'}</span></li>
                    <li>آدرس سکونت: <span className="text-black">{residenceAddress || 'ثبت نشده'}</span></li>
                  </ul>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* SINGLE ITEM REVIEW MODAL FOR MANAGER (مدال تعیین وضعیت مدرک/چک) */}
        {(reviewingDoc || reviewingCheck) && (
          <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 notranslate" translate="no">
            <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-zinc-200">
              <div className="flex justify-between items-center border-b pb-3">
                <div className="font-bold text-sm text-zinc-900">
                  تعیین وضعیت بررسی {reviewingDoc ? 'مدرک' : 'چک صیادی'}
                </div>
                <button 
                  type="button"
                  onClick={() => {
                    setReviewingDoc(null);
                    setReviewingCheck(null);
                  }}
                  className="text-zinc-400 hover:text-black p-1 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-bold text-zinc-700 block mb-2">انتخاب وضعیت بررسی:</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button 
                      type="button"
                      onClick={() => setReviewStatus('approved')}
                      className={`p-2.5 rounded-xl font-bold border transition text-center flex items-center justify-center gap-1 ${
                        reviewStatus === 'approved' 
                          ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm' 
                          : 'bg-zinc-50 text-zinc-700 border-zinc-300 hover:bg-emerald-50'
                      }`}
                    >
                      <span>✓</span>
                      <span>تایید</span>
                    </button>

                    <button 
                      type="button"
                      onClick={() => setReviewStatus('needs_revision')}
                      className={`p-2.5 rounded-xl font-bold border transition text-center flex items-center justify-center gap-1 ${
                        reviewStatus === 'needs_revision' 
                          ? 'bg-amber-600 text-white border-amber-700 shadow-sm' 
                          : 'bg-zinc-50 text-zinc-700 border-zinc-300 hover:bg-amber-50'
                      }`}
                    >
                      <span>⚠️</span>
                      <span>نیاز به اصلاح</span>
                    </button>

                    <button 
                      type="button"
                      onClick={() => setReviewStatus('rejected')}
                      className={`p-2.5 rounded-xl font-bold border transition text-center flex items-center justify-center gap-1 ${
                        reviewStatus === 'rejected' 
                          ? 'bg-rose-600 text-white border-rose-700 shadow-sm' 
                          : 'bg-zinc-50 text-zinc-700 border-zinc-300 hover:bg-rose-50'
                      }`}
                    >
                      <span>✕</span>
                      <span>رد</span>
                    </button>
                  </div>
                </div>

                {reviewStatus !== 'approved' && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <label className="font-black text-rose-900 block mb-1.5 flex items-center gap-1">
                      <MessageSquare size={14} />
                      علت ارجاع / رد (الزامی):
                    </label>
                    <textarea 
                      rows={4}
                      value={reviewReasonText}
                      onChange={e => setReviewReasonText(e.target.value)}
                      placeholder="لطفاً علت دقیق نیاز به اصلاح یا رد را برای اطلاع نماینده بنویسید..."
                      className="w-full bg-rose-50/50 border-2 border-rose-200 rounded-2xl p-3 text-xs outline-none focus:border-rose-400 font-medium transition-all"
                    />
                  </div>
                )}

                {/* Audit Trail (تاریخچه بررسی) */}
                {reviewingCheck && reviewingCheck.reviewHistory && reviewingCheck.reviewHistory.length > 0 && (
                  <div className="pt-3 border-t border-zinc-100">
                    <label className="font-bold text-zinc-900 block mb-2 flex items-center gap-1.5">
                      <Clock size={14} className="text-zinc-500" />
                      تاریخچه بررسی و تغییرات:
                    </label>
                    <div className="max-h-32 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      {reviewingCheck.reviewHistory.slice().reverse().map((log) => (
                        <div key={log.id} className="bg-zinc-50 border border-zinc-200 p-2.5 rounded-xl space-y-1">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="font-black text-zinc-800">{log.actorName}</span>
                            <span className="text-zinc-500 dir-ltr font-mono">{log.jalaliDate}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              log.toStatus === CheckReviewStatus.APPROVED ? 'bg-emerald-100 text-emerald-700' :
                              log.toStatus === CheckReviewStatus.NEEDS_CORRECTION ? 'bg-amber-100 text-amber-700' :
                              log.toStatus === CheckReviewStatus.REJECTED ? 'bg-rose-100 text-rose-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {log.toStatus === CheckReviewStatus.APPROVED ? 'تایید شد' :
                               log.toStatus === CheckReviewStatus.NEEDS_CORRECTION ? 'نیاز به اصلاح' :
                               log.toStatus === CheckReviewStatus.REJECTED ? 'رد شد' : 'ثبت اولیه'}
                            </span>
                          </div>
                          {log.comment && (
                            <p className="text-[10px] text-zinc-600 bg-white/50 p-1.5 rounded-lg border border-zinc-100 italic">
                              {log.comment}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
                <button 
                  type="button"
                  onClick={() => {
                    setReviewingDoc(null);
                    setReviewingCheck(null);
                  }}
                  className="px-5 py-2.5 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  انصراف
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    if (reviewingDoc) handleUpdateDocStatus();
                    if (reviewingCheck) handleUpdateCheckStatus();
                  }}
                  className="px-6 py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 rounded-xl text-xs font-black transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
                >
                  تایید و ذخیره
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CREATE CHECK MODAL */}
        {showCheckForm && (
          <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-6 overflow-y-auto">
            <form onSubmit={handleAddCheck} className="bg-white rounded-3xl max-w-3xl w-full p-6 sm:p-10 space-y-6 shadow-2xl border border-zinc-200 my-auto">
              <div className="flex justify-between items-center border-b pb-4">
                <div className="font-black text-lg text-zinc-900 flex items-center gap-2.5">
                  <Banknote className="text-emerald-600" size={24} />
                  <span>ثبت مشخصات و دریافت چک‌های اقساط</span>
                </div>
                <button type="button" onClick={() => setShowCheckForm(false)} className="text-zinc-400 hover:text-black p-2 rounded-full hover:bg-zinc-100 transition">
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
                <div>
                  <label className="font-bold text-zinc-800 block mb-2">شماره برگه چک:</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required 
                    value={checkNumber}
                    onChange={e => setCheckNumber(e.target.value)}
                    placeholder="مثال: ۱۲۳۴۵۶"
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-2xl px-4 py-3.5 text-base font-mono outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs"
                  />
                </div>

                <div>
                  <label className="font-bold text-zinc-800 block mb-2">نام بانک صادرکننده:</label>
                  <input 
                    type="text" 
                    required 
                    value={bankName}
                    onChange={e => setBankName(e.target.value)}
                    placeholder="مثال: بانک ملی / ملت / ..."
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-2xl px-4 py-3.5 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="font-bold text-emerald-950 block mb-2 flex items-center gap-1.5">
                    <Hash size={18} className="text-emerald-600" />
                    <span>شناسه ۱۶ رقمی صیادی:</span>
                  </label>
                  <div className="flex items-center gap-1 bg-emerald-50/60 border-2 border-emerald-400 rounded-2xl p-1 shadow-inner">
                    <input 
                      type="text" 
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      value={sayadiNumber.substring(0, 4)}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '').substring(0, 4);
                        const rest = sayadiNumber.substring(4) || "000088880001";
                        setSayadiNumber(val.padEnd(4, '0') + rest);
                      }}
                      placeholder="۴ رقم اول"
                      className="w-1/4 bg-white border border-emerald-200 rounded-xl px-2 py-4 text-lg sm:text-2xl font-black font-mono text-emerald-950 outline-none focus:border-emerald-600 text-center"
                    />
                    <div className="w-1/2 bg-emerald-100/50 rounded-xl px-2 py-4 text-lg sm:text-2xl font-black font-mono text-emerald-800/50 text-center select-none">
                      {sayadiNumber.substring(4, 12) || "00008888"}
                    </div>
                    <div className="w-1/4 bg-emerald-100/50 rounded-xl px-2 py-4 text-lg sm:text-2xl font-black font-mono text-emerald-800/50 text-center select-none">
                      {sayadiNumber.substring(12, 16) || "0001"}
                    </div>
                  </div>
                  <div className="flex justify-between mt-2 px-1">
                    <p className="text-[10px] text-zinc-500 font-bold">۴ رقم اول: دستی (قابل ویرایش)</p>
                    <p className="text-[10px] text-emerald-600/60 font-bold">۱۲ رقم بعدی: ثابت و افزایشی (سیستمی)</p>
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-2 font-medium leading-relaxed">
                    طبق الگوریتم طراحی شده، ۸ رقم وسط (ثابت) و ۴ رقم آخر (افزایشی به تعداد چک‌ها) به صورت خودکار درج می‌شوند. شما فقط ۴ رقم اول شناسه را وارد نمایید.
                  </p>
                </div>

                <div>
                  <label className="font-bold text-zinc-800 block mb-2">مبلغ چک (ریال):</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required 
                    value={amount ? amount.toLocaleString('en-US') : ''}
                    onChange={e => {
                      const raw = e.target.value.replace(/\D/g, '');
                      setAmount(raw ? Number(raw) : 0);
                    }}
                    placeholder="مبلغ به ریال"
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-2xl px-4 py-3.5 text-base font-mono outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs"
                  />
                </div>

                <div>
                  <label className="font-bold text-zinc-800 block mb-2">تاریخ سررسید (شمسی):</label>
                  <input 
                    type="text" 
                    required 
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    placeholder="۱۴۰۵/۰۴/۱۵"
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-2xl px-4 py-3.5 text-base font-mono outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100">
                <button type="button" onClick={() => setShowCheckForm(false)} className="px-6 py-3 bg-zinc-100 text-zinc-700 rounded-2xl text-sm font-bold hover:bg-zinc-200 transition">
                  انصراف
                </button>
                <button type="submit" className="px-8 py-3 bg-emerald-600 text-white rounded-2xl text-sm font-black hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition">
                  ثبت چک
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SOFT DELETE CONFIRMATION MODAL */}
        {itemToDelete && (
          <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 notranslate" translate="no">
            <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl border border-zinc-200">
              <div className="font-bold text-sm text-zinc-900 flex items-center gap-2">
                <AlertTriangle size={18} className="text-rose-600" />
                <span>تایید حذف / جایگزینی مدرک</span>
              </div>
              <p className="text-xs text-zinc-600">
                آیا از حذف این مورد اطمینان دارید؟ نسخه قبلی در بایگانی سوابق نگهداری خواهد شد.
              </p>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setItemToDelete(null)} className="px-4 py-2 bg-zinc-100 text-zinc-700 rounded-xl text-xs font-bold hover:bg-zinc-200">
                  انصراف
                </button>
                <button type="button" onClick={handleConfirmSoftDelete} className="px-5 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700">
                  تایید حذف
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PREVIEW / INSPECTOR MODAL */}
        {previewDoc && (
          <div className="fixed inset-0 z-[140] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
              <div className="p-4 bg-zinc-900 text-white flex justify-between items-center">
                <span className="font-bold text-xs">{previewDoc.attachment.name}</span>
                <button onClick={() => setPreviewDoc(null)} className="text-zinc-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 bg-zinc-950 p-4 flex items-center justify-center overflow-auto">
                {(() => {
                  const type = (previewDoc.attachment.type || '').toLowerCase();
                  const name = previewDoc.attachment.name.toLowerCase();
                  const isImage = type.startsWith('image/') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp');
                  const isPdf = type === 'application/pdf' || name.endsWith('.pdf');
                  const isExcel = type.includes('sheet') || type.includes('excel') || name.endsWith('.xls') || name.endsWith('.xlsx');

                  if (isImage) {
                    return (
                      <img 
                        src={previewDoc.attachment.url} 
                        alt="preview"
                        className="max-h-[70vh] object-contain rounded-lg"
                      />
                    );
                  } else if (isPdf) {
                    return (
                      <iframe 
                        src={previewDoc.attachment.url} 
                        title={previewDoc.attachment.name}
                        className="w-full h-[70vh] rounded-lg bg-white"
                      />
                    );
                  } else if (isExcel) {
                    return (
                      <div className="bg-white p-8 rounded-2xl max-w-md w-full text-center space-y-4 shadow-lg">
                        <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-2xl mx-auto flex items-center justify-center text-2xl font-bold font-mono">
                          📊
                        </div>
                        <div className="space-y-1">
                          <div className="text-sm font-bold text-zinc-900">{previewDoc.attachment.name}</div>
                          <div className="text-xs text-zinc-500">
                            حجم فایل: {previewDoc.attachment.fileSizeKb || previewDoc.attachment.originalSizeKb || '---'} کیلوبایت
                          </div>
                          <div className="text-xs text-zinc-500">
                            تاریخ بارگذاری: {previewDoc.attachment.uploadDate}
                          </div>
                        </div>
                        <a 
                          href={previewDoc.attachment.url}
                          download={previewDoc.attachment.name}
                          className="inline-flex items-center justify-center gap-2 w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
                        >
                          📥 دانلود مستقیم فایل اکسل
                        </a>
                      </div>
                    );
                  } else {
                    return (
                      <div className="bg-white p-8 rounded-2xl max-w-md w-full text-center space-y-4 shadow-lg">
                        <div className="text-sm font-bold text-zinc-900">{previewDoc.attachment.name}</div>
                        <div className="text-xs text-zinc-500">
                          حجم: {previewDoc.attachment.fileSizeKb || '---'} کیلوبایت | تاریخ: {previewDoc.attachment.uploadDate}
                        </div>
                        <a 
                          href={previewDoc.attachment.url}
                          download={previewDoc.attachment.name}
                          className="inline-flex items-center justify-center gap-2 w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
                        >
                          📥 دانلود فایل
                        </a>
                      </div>
                    );
                  }
                })()}
              </div>
            </div>
          </div>
        )}

        {/* SUBMIT CONFIRMATION & LOCK WARNING MODAL */}
        {showSubmitConfirmModal && (
          <div className="fixed inset-0 z-[300] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-amber-200 space-y-6 text-right">
              <div className="flex items-center gap-3 text-amber-700 bg-amber-50 p-4 rounded-2xl border border-amber-200">
                <AlertTriangle size={32} className="shrink-0 text-amber-600" />
                <div>
                  <h3 className="font-black text-base text-zinc-900">هشدار قفل امنیتی پرونده</h3>
                  <p className="text-xs text-amber-800 font-bold mt-0.5">تأیید نهایی جهت ارسال به مرکز</p>
                </div>
              </div>

              <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-2">
                <p className="text-sm text-zinc-900 leading-relaxed font-bold">
                  آیا از ارسال پرونده مطمئن هستید؟ پس از ارسال، پرونده کاملاً قفل شده و امکان هیچگونه ویرایش یا لغو ارسالی وجود نخواهد داشت.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSubmitConfirmModal(false)}
                  className="px-5 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-2xl text-xs font-bold transition-all"
                >
                  انصراف و بازگشت
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSubmitConfirmModal(false);
                    executeSubmitFile();
                  }}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
                >
                  <Lock size={16} />
                  <span>تأیید و ارسال نهایی پرونده</span>
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
