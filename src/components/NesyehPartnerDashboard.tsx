import React, { useState, useMemo } from 'react';
import { 
  ShoppingBag, Wallet, TrendingUp, 
  Search, LogOut, Package, ShieldCheck, 
  FileText, CheckCircle2, Clock, AlertCircle, Filter, Plus, ArrowUpRight,
  Receipt, FileSpreadsheet, Scale, Info, Ban, ShieldAlert, Calendar,
  CreditCard, Send, CheckSquare, Image as ImageIcon, CornerDownLeft, Eye, X, Building2, User,
  Users, MessageSquare, HelpCircle, PhoneCall, Check, ChevronDown, RefreshCw, SendHorizontal, FileQuestion
} from 'lucide-react';
import { 
  AppState, Person, BusinessPartner, NesyehPartnerSettings,
  NesyehOrderableItem, NesyehPurchaseOrder, NesyehPurchaseOrderItem, NesyehPurchaseOrderStatus,
  NesyehPaymentDeclaration, NesyehPaymentType, NesyehPaymentStatus
} from '../types';
import { calculatePersonBalances } from '../utils/accounting';
import { DataIntegrityEngine } from '../utils/integrityEngine';
import { globalFinancialEventAdapter } from '../modules/sms';
import { PersonService } from '../services/personService';

export type NesyehAccountStatus = 'HEALTHY' | 'NEAR_LIMIT' | 'OVERDUE' | 'SUSPENDED';

export interface NesyehControlCheckResult {
  allowed: boolean;
  status: NesyehAccountStatus;
  reason: string;
  creditLimit: number;
  usedCredit: number;
  remainingLimit: number;
  netDebt: number;
  totalDebtor: number;
  totalCreditor: number;
  paymentTermDays: number;
  lateFeePercentage: number;
  isPurchaseAllowed: boolean;
  overdueCount: number;
  openInvoicesCount: number;
}

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  category: 'مالی' | 'ارسال کالا' | 'سقف اعتبار' | 'مشکل فنی' | 'سایر';
  priority: 'عادی' | 'مهم' | 'فوری';
  status: 'در حال بررسی' | 'پاسخ داده شده' | 'بسته شده';
  message: string;
  adminResponse?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * تابع کنترل وضعیت حساب و سنجش امکان ثبت سفارش خرید نسیه
 */
export function canCreateNesyehOrder(
  partner: BusinessPartner | null | undefined,
  agentPerson: Person | null | undefined,
  state: AppState
): NesyehControlCheckResult {
  const nesyehSettings: NesyehPartnerSettings = partner?.salesExtension?.nesyehSettings || partner?.nesyehSettings || {
    creditLimit: partner?.profile?.creditLimit || agentPerson?.creditLimit || 150000000,
    paymentTermDays: 30,
    lateFeePercentage: 1.5,
    isPurchaseAllowed: true,
    contractNotes: 'قرارداد عاملی نسیه - فروش مستقیم'
  };

  const creditLimit = nesyehSettings.creditLimit || 150000000;
  const isPurchaseAllowed = nesyehSettings.isPurchaseAllowed !== false;

  const personId = partner?.personId || agentPerson?.id;
  let netDebt = 0;
  let totalDebtor = 0;
  let totalCreditor = 0;

  if (personId && state.vouchers) {
    const balances = calculatePersonBalances(state.vouchers, personId, 'SUB_CREDITORS');
    const personBal = balances[personId];
    if (personBal) {
      netDebt = Math.max(0, personBal.net);
      totalDebtor = personBal.debit || 0;
      totalCreditor = personBal.credit || 0;
    }
  }

  const activeOrdersSum = (state.partnerOrders || [])
    .filter(o => o.businessPartnerId === partner?.id && (o.status === 'SUBMITTED' || o.status === 'APPROVED' || o.status === 'UNDER_REVIEW'))
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const nesyehOrdersSum = (state.nesyehPurchaseOrders || [])
    .filter(o => o.partnerId === partner?.id && (o.status === 'SUBMITTED' || o.status === 'APPROVED' || o.status === 'UNDER_REVIEW'))
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const usedCredit = netDebt + activeOrdersSum + nesyehOrdersSum;
  const remainingLimit = Math.max(0, creditLimit - usedCredit);

  const partnerChecks = (state.checks || []).filter(c => 
    c.representativeId === partner?.id || 
    c.representativeId === personId ||
    c.history?.some(h => h.note?.includes(partner?.id || ''))
  );
  const bouncedChecks = partnerChecks.filter(c => c.currentState === 'bounced');
  const overdueCount = bouncedChecks.length;

  const openInvoicesCount = (state.invoices || []).filter(i => 
    (i.personId === personId || i.personId === partner?.id) && i.type === 'sell' && i.status !== 'voided' && (i.paidAmount || 0) < i.totalAmount
  ).length;

  let status: NesyehAccountStatus = 'HEALTHY';
  let allowed = true;
  let reason = 'حساب نماینده در وضعیت سالم قرار دارد و ثبت سفارش جدید مجاز است.';

  if (!isPurchaseAllowed) {
    status = 'SUSPENDED';
    allowed = false;
    reason = 'ثبت سفارش جدید بر اساس تنظیمات مدیریت سیستم متوقف شده است.';
  } else if (overdueCount > 0) {
    status = 'OVERDUE';
    allowed = false;
    reason = `حساب نماینده دارای ${overdueCount} فقره تعهد/چک برگشتی معوق می‌باشد.`;
  } else if (usedCredit >= creditLimit) {
    status = 'SUSPENDED';
    allowed = false;
    reason = 'سقف خرید نسیه نماینده کاملاً تکمیل شده است و ظرفیت خرید جدید وجود ندارد.';
  } else if (usedCredit >= creditLimit * 0.8) {
    status = 'NEAR_LIMIT';
    allowed = true;
    reason = 'مصرف اعتبار بیش از ۸۰٪ سقف مجاز است. هشدار نزدیک شدن به سقف اعتبار.';
  }

  return {
    allowed,
    status,
    reason,
    creditLimit,
    usedCredit,
    remainingLimit,
    netDebt,
    totalDebtor,
    totalCreditor,
    paymentTermDays: nesyehSettings.paymentTermDays || 30,
    lateFeePercentage: nesyehSettings.lateFeePercentage || 1.5,
    isPurchaseAllowed,
    overdueCount,
    openInvoicesCount
  };
}

interface NesyehPartnerDashboardProps {
  state: AppState;
  currentUserId: string;
  currentAgentId?: string;
  onLogout: () => void;
  onUpdateState?: (newState: AppState) => void;
}

export function NesyehPartnerDashboard({
  state,
  currentUserId,
  currentAgentId,
  onLogout,
  onUpdateState,
}: NesyehPartnerDashboardProps) {
  // 5-Tab Navigation Layout
  const [activeTab, setActiveTab] = useState<'overview' | 'customers' | 'catalog' | 'finances' | 'support'>('overview');
  
  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [brandFilter, setBrandFilter] = useState<string>('all');

  // Cart and Purchase Order State
  const [cart, setCart] = useState<Array<{ item: NesyehOrderableItem; quantity: number }>>([]);
  const [orderNote, setOrderNote] = useState<string>('');
  const [isCartModalOpen, setIsCartModalOpen] = useState<boolean>(false);
  const [selectedViewOrder, setSelectedViewOrder] = useState<NesyehPurchaseOrder | null>(null);

  // Profile Completion Modal State
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [editPartnerName, setEditPartnerName] = useState<string>('');
  const [editStoreName, setEditStoreName] = useState<string>('');

  // Payment Declaration State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);
  const [declType, setDeclType] = useState<NesyehPaymentType>('POS');
  const [declAmount, setDeclAmount] = useState<number>(0);
  const [declDate, setDeclDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [declPosTerminal, setDeclPosTerminal] = useState<string>('');
  const [declPosBatchSummaryDate, setDeclPosBatchSummaryDate] = useState<string>('');
  const [declBankName, setDeclBankName] = useState<string>('');
  const [declBankTrackingNumber, setDeclBankTrackingNumber] = useState<string>('');
  const [declBankReceiptImage, setDeclBankReceiptImage] = useState<string>('');
  const [declCheckDueDate, setDeclCheckDueDate] = useState<string>('');
  const [declCheckNumber, setDeclCheckNumber] = useState<string>('');
  const [declCheckSayadId, setDeclCheckSayadId] = useState<string>('');
  const [declCheckImage, setDeclCheckImage] = useState<string>('');
  const [declNotes, setDeclNotes] = useState<string>('');

  // Add Customer Modal State
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState<boolean>(false);
  const [custName, setCustName] = useState<string>('');
  const [custMobile, setCustMobile] = useState<string>('');
  const [custNationalId, setCustNationalId] = useState<string>('');
  const [custPhone, setCustPhone] = useState<string>('');
  const [custAddress, setCustAddress] = useState<string>('');
  const [custNotes, setCustNotes] = useState<string>('');

  // Support & Tickets State
  const [isSupportModalOpen, setIsSupportModalOpen] = useState<boolean>(false);
  const [ticketSubject, setTicketSubject] = useState<string>('');
  const [ticketCategory, setTicketCategory] = useState<'مالی' | 'ارسال کالا' | 'سقف اعتبار' | 'مشکل فنی' | 'سایر'>('مالی');
  const [ticketPriority, setTicketPriority] = useState<'عادی' | 'مهم' | 'فوری'>('عادی');
  const [ticketMessage, setTicketMessage] = useState<string>('');
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);

  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([
    {
      id: 'TICK_101',
      ticketNumber: 'ST-8821',
      subject: 'استعلام افزایش سقف خرید نسیه اعتباری',
      category: 'سقف اعتبار',
      priority: 'مهم',
      status: 'پاسخ داده شده',
      message: 'با سلام، با توجه به افزایش میزان تقاضای خریداران نسیه در منطقه، درخواست بررسی افزایش سقف اعتبار از ۱۵۰ میلیون به ۲۵۰ میلیون ریال را دارم.',
      adminResponse: 'با سلام و احترام، درخواست شما در جلسه اعتبارسنجی هفته جاری بررسی و پس از تکمیل گردش حساب ۶ ماهه تایید خواهد شد.',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    }
  ]);

  // 1. دریافت اطلاعات نماینده تجاری جاری
  const currentPartner = useMemo(() => {
    let found = null;
    if (currentAgentId) {
      const cleanId = currentAgentId.replace('BP_', '');
      found = (state.businessPartners || []).find(p => 
        p.personId === currentAgentId || 
        p.personId === cleanId || 
        p.id === currentAgentId || 
        p.id === `BP_${cleanId}` ||
        p.profile?.partnerId === currentAgentId
      );
    }
    if (!found) {
      found = (state.businessPartners || []).find(p => (p.users || []).includes(currentUserId));
    }
    return found;
  }, [state.businessPartners, currentUserId, currentAgentId]);

  // 2. دریافت رکورد شخص مرتبط با نماینده
  const agentPerson = useMemo(() => {
    if (!currentPartner) return null;
    return state.persons?.find(p => p.id === currentPartner.personId || p.id === currentAgentId);
  }, [state.persons, currentPartner, currentAgentId]);

  const partnerName = useMemo(() => {
    const name = currentPartner?.profile?.partnerName || agentPerson?.name || '';
    const genericNames = ['نماینده تجاری', 'همکار', 'شریک تجاری', 'نماینده جدید', 'بدون نام', 'نماینده تجاری نسیه', 'نماینده فروش', 'نماینده تجاری فروش'];
    if (genericNames.includes(name.trim())) {
      return '';
    }
    return name;
  }, [currentPartner, agentPerson]);

  const storeName = useMemo(() => {
    const name = currentPartner?.profile?.storeName || agentPerson?.agentDetails?.storeName || '';
    if (name.trim() === 'فروشگاه طرف قرارداد') return '';
    return name;
  }, [currentPartner, agentPerson]);

  const partnerCode = agentPerson?.code || currentPartner?.id || 'DEFERRED_AGENT';

  // 3. محاسبه ارزیابی وضعیت و کنترل حساب نماینده فروش
  const controlCheck = useMemo(() => {
    return canCreateNesyehOrder(currentPartner, agentPerson, state);
  }, [currentPartner, agentPerson, state]);

  // 4. لیست مشتریان نسیه متصل به این نماینده
  const myCustomers = useMemo(() => {
    const pId = currentPartner?.id || currentPartner?.personId || currentAgentId || agentPerson?.id;
    return (state.persons || []).filter(p => 
      p.representativeId === pId ||
      p.representativeId === currentAgentId ||
      p.createdBy === currentUserId
    );
  }, [state.persons, currentPartner, currentAgentId, agentPerson, currentUserId]);

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return myCustomers;
    const q = searchQuery.toLowerCase().trim();
    return myCustomers.filter(c => 
      c.name?.toLowerCase().includes(q) ||
      c.mobile?.includes(q) ||
      c.nationalId?.includes(q) ||
      c.code?.toLowerCase().includes(q)
    );
  }, [myCustomers, searchQuery]);

  // 5. ویترین کالاهای قابل سفارش
  const catalogList = useMemo(() => {
    const configuredCatalog = (state.nesyehCatalog || []).filter(c => c.isActive);
    if (configuredCatalog.length > 0) {
      return configuredCatalog;
    }
    return (state.products || []).map(p => ({
      id: `NCI_${p.id}`,
      productId: p.id,
      code: p.code,
      name: p.name,
      brand: (p as any).brand || '',
      category: p.category || '',
      image: (p as any).image || '',
      description: (p as any).description || '',
      cashPrice: p.defaultSalePrice || 0,
      suggestedNesyehPrice: Math.round((p.defaultSalePrice || 0) * 1.05),
      orderableCapacity: p.initialStock || 50,
      isActive: true,
      priority: 1,
      badge: 'NEW' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }, [state.nesyehCatalog, state.products]);

  const filteredCatalog = useMemo(() => {
    let items = catalogList;
    if (categoryFilter !== 'all') {
      items = items.filter(i => i.category === categoryFilter);
    }
    if (brandFilter !== 'all') {
      items = items.filter(i => i.brand === brandFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      items = items.filter(i => 
        i.name.toLowerCase().includes(q) || 
        i.code.toLowerCase().includes(q) ||
        (i.brand && i.brand.toLowerCase().includes(q))
      );
    }
    return items.sort((a, b) => a.priority - b.priority);
  }, [catalogList, categoryFilter, brandFilter, searchQuery]);

  const categories = useMemo(() => {
    const cats = new Set(catalogList.map(i => i.category).filter(Boolean));
    return Array.from(cats) as string[];
  }, [catalogList]);

  const brands = useMemo(() => {
    const b = new Set(catalogList.map(i => i.brand).filter(Boolean));
    return Array.from(b) as string[];
  }, [catalogList]);

  // 6. سفارشات ثبت‌شده توسط نماینده
  const myPurchaseOrders = useMemo(() => {
    const pid = currentPartner?.id || currentPartner?.personId || currentAgentId;
    return (state.nesyehPurchaseOrders || []).filter(o => 
      o.partnerId === pid || 
      o.partnerId === currentPartner?.id || 
      o.partnerId === currentPartner?.personId
    );
  }, [state.nesyehPurchaseOrders, currentPartner, currentAgentId]);

  // Cart operations
  const handleAddToCart = (item: NesyehOrderableItem, qty: number = 1) => {
    setCart(prev => {
      const existingIndex = prev.findIndex(c => c.item.id === item.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex].quantity += qty;
        return updated;
      }
      return [...prev, { item, quantity: qty }];
    });
  };

  const handleUpdateCartQty = (itemId: string, qty: number) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(c => c.item.id !== itemId));
    } else {
      setCart(prev => prev.map(c => c.item.id === itemId ? { ...c, quantity: qty } : c));
    }
  };

  const cartTotalAmount = useMemo(() => {
    return cart.reduce((sum, c) => sum + (c.quantity * c.item.suggestedNesyehPrice), 0);
  }, [cart]);

  const handleSubmitPurchaseOrder = () => {
    if (cart.length === 0) return;
    if (!controlCheck.allowed) {
      alert(`ثبت سفارش غیرمجاز می‌باشد: ${controlCheck.reason}`);
      return;
    }

    const now = new Date().toISOString();
    const orderNum = `NPO-${Math.floor(100000 + Math.random() * 900000)}`;

    const items: NesyehPurchaseOrderItem[] = cart.map(c => ({
      id: `NPOI_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      orderableItemId: c.item.id,
      productId: c.item.productId,
      productName: c.item.name,
      productCode: c.item.code,
      requestedQuantity: c.quantity,
      cashPrice: c.item.cashPrice,
      unitPrice: c.item.suggestedNesyehPrice,
      totalPrice: c.quantity * c.item.suggestedNesyehPrice
    }));

    const newOrder: NesyehPurchaseOrder = {
      id: `NPO_${Date.now()}`,
      orderNumber: orderNum,
      partnerId: currentPartner?.id || currentAgentId || 'PARTNER',
      partnerName: partnerName || 'نماینده فروش',
      storeName: storeName || 'فروشگاه',
      orderDate: now,
      items,
      totalAmount: cartTotalAmount,
      partnerNotes: orderNote,
      status: 'SUBMITTED',
      createdAt: now,
      updatedAt: now
    };

    const updatedOrders = [newOrder, ...(state.nesyehPurchaseOrders || [])];

    // Safely emit SMS event for order submission
    globalFinancialEventAdapter.emitNesyehOrderSubmitted({
      orderNumber: newOrder.orderNumber,
      partnerName: newOrder.partnerName,
      totalAmount: newOrder.totalAmount,
      itemCount: newOrder.items.length,
      customerPhone: currentPartner?.mobile || currentPartner?.phone || '',
    });

    if (currentPartner) {
      const creditLimit = currentPartner.creditLimit || 0;
      const currentDebt = currentPartner.creditUsed || 0;
      if (creditLimit > 0) {
        const ratio = Math.round((currentDebt / creditLimit) * 100);
        if (ratio >= 80) {
          globalFinancialEventAdapter.emitCreditLimitApproaching({
            partnerName: currentPartner.name,
            currentDebt,
            creditLimit,
            debtRatioPercent: ratio,
            customerPhone: currentPartner.mobile || currentPartner.phone || '',
          });
        }
      }
    }

    if (onUpdateState) {
      onUpdateState({
        ...state,
        nesyehPurchaseOrders: updatedOrders
      });
    }

    setCart([]);
    setOrderNote('');
    setIsCartModalOpen(false);
    alert(`درخواست سفارش شماره ${orderNum} با موفقیت ثبت شد و برای بررسی مدیریت ارسال گردید.`);
  };

  // 7. ثبت مشتری جدید
  const handleAddCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim() || !custMobile.trim()) {
      alert('نام و شماره موبایل مشتری الزامی است.');
      return;
    }

    const pId = currentPartner?.id || currentPartner?.personId || currentAgentId || agentPerson?.id;
    const nextCode = `CUST-${Math.floor(1000 + Math.random() * 9000)}`;
    const newPersonPayload: Partial<Person> = {
      code: nextCode,
      name: custName.trim(),
      mobile: custMobile.trim(),
      phone: custPhone.trim(),
      nationalId: custNationalId.trim(),
      address: custAddress.trim(),
      role: 'debtor',
      createdAt: new Date().toISOString(),
      createdBy: currentUserId,
      representativeId: pId
    };

    try {
      const savedPerson = await PersonService.createPerson(newPersonPayload);
      if (onUpdateState) {
        onUpdateState({
          ...state,
          persons: [savedPerson, ...(state.persons || [])]
        });
      }

      setCustName('');
      setCustMobile('');
      setCustNationalId('');
      setCustPhone('');
      setCustAddress('');
      setCustNotes('');
      setIsAddCustomerModalOpen(false);
      alert(`مشتری جدید «${savedPerson.name}» با کد ${savedPerson.code} ثبت گردید.`);
    } catch (err: any) {
      console.error('Failed to create customer in NesyehPartnerDashboard:', err);
      alert(`خطا در ثبت مشتری در پایگاه‌داده: ${err.message || 'خطای ناشناخته'}`);
    }
  };

  // 8. اسناد حسابداری مرتبط با این نماینده
  const partnerVouchers = useMemo(() => {
    const personId = currentPartner?.personId || agentPerson?.id;
    if (!personId || !state.vouchers) return [];
    return state.vouchers.filter(v => 
      v.entries.some(e => e.floatingDetailed?.id === personId || e.description?.includes(personId))
    );
  }, [state.vouchers, currentPartner, agentPerson]);

  // 9. اعلام پرداخت‌های ثبت‌شده توسط نماینده
  const myPaymentDeclarations = useMemo(() => {
    const pid = currentPartner?.id || currentPartner?.personId || currentAgentId || agentPerson?.id;
    return (state.nesyehPaymentDeclarations || []).filter(d => 
      d.partnerId === pid || 
      d.partnerId === currentPartner?.id || 
      d.partnerId === currentPartner?.personId ||
      d.partnerId === agentPerson?.id
    );
  }, [state.nesyehPaymentDeclarations, currentPartner, currentAgentId, agentPerson]);

  const handleSubmitPaymentDeclaration = (e: React.FormEvent) => {
    e.preventDefault();
    if (declAmount <= 0) {
      alert('لطفاً مبلغ معتبر اعلام پرداخت را به ریال وارد نمایید.');
      return;
    }

    const now = new Date().toISOString();
    const declNum = `NPD-${Math.floor(100000 + Math.random() * 900000)}`;
    const pid = currentPartner?.id || currentAgentId || agentPerson?.id || 'PARTNER';

    const newDecl: NesyehPaymentDeclaration = {
      id: `NPD_${Date.now()}`,
      declarationNumber: declNum,
      partnerId: pid,
      partnerName: partnerName || 'نماینده فروش',
      paymentType: declType,
      amount: declAmount,
      paymentDate: declDate || now.split('T')[0],
      declarationDate: now,
      status: 'PENDING',
      posTerminalNumber: declType === 'POS' ? declPosTerminal : undefined,
      posBatchSummaryDate: declType === 'POS' ? (declPosBatchSummaryDate || declDate) : undefined,
      bankName: declType === 'BANK_TRANSFER' ? declBankName : undefined,
      trackingNumber: declType === 'BANK_TRANSFER' ? declBankTrackingNumber : undefined,
      receiptImage: declType === 'BANK_TRANSFER' ? declBankReceiptImage : undefined,
      checkDueDate: declType === 'CHECK' ? declCheckDueDate : undefined,
      checkNumber: declType === 'CHECK' ? declCheckNumber : undefined,
      checkSayadId: declType === 'CHECK' ? declCheckSayadId : undefined,
      checkImage: declType === 'CHECK' ? declCheckImage : undefined,
      partnerNotes: declNotes,
      createdAt: now,
      updatedAt: now
    };

    const updatedDeclarations = [newDecl, ...(state.nesyehPaymentDeclarations || [])];

    if (onUpdateState) {
      onUpdateState({
        ...state,
        nesyehPaymentDeclarations: updatedDeclarations
      });
    }

    setDeclAmount(0);
    setDeclNotes('');
    setDeclPosTerminal('');
    setDeclPosBatchSummaryDate('');
    setDeclBankName('');
    setDeclBankTrackingNumber('');
    setDeclBankReceiptImage('');
    setDeclCheckDueDate('');
    setDeclCheckNumber('');
    setDeclCheckSayadId('');
    setDeclCheckImage('');
    setIsPaymentModalOpen(false);

    alert(`اعلام پرداخت شماره ${declNum} با موفقیت ثبت شد و برای بررسی و تایید مدیریت ارسال گردید.`);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPartnerName.trim()) {
      alert('نام نماینده الزامی است.');
      return;
    }

    if (currentPartner && onUpdateState) {
      const engine = DataIntegrityEngine.getInstance();
      const updates = {
        profile: {
          ...currentPartner.profile,
          partnerName: editPartnerName.trim(),
          storeName: editStoreName ? editStoreName.trim() : ''
        }
      };
      const result = engine.updateBusinessPartner(currentPartner.id, updates as any, state as any);
      if (!result.success) {
        alert(`خطا در ویرایش اطلاعات پروفایل:\n${result.errors?.join('\n')}`);
        return;
      }
      onUpdateState(result.updatedState as any);
      setIsProfileModalOpen(false);
      alert('اطلاعات پروفایل با موفقیت ثبت شد.');
    }
  };

  const handleCreateSupportTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketSubject.trim() || !ticketMessage.trim()) {
      alert('عنوان و متن پیام پشتیبانی الزامی است.');
      return;
    }

    const now = new Date().toISOString();
    const newTicket: SupportTicket = {
      id: `TICK_${Date.now()}`,
      ticketNumber: `ST-${Math.floor(1000 + Math.random() * 9000)}`,
      subject: ticketSubject.trim(),
      category: ticketCategory,
      priority: ticketPriority,
      status: 'در حال بررسی',
      message: ticketMessage.trim(),
      createdAt: now,
      updatedAt: now
    };

    setSupportTickets(prev => [newTicket, ...prev]);
    setTicketSubject('');
    setTicketMessage('');
    setIsSupportModalOpen(false);
    alert(`تیکت شماره ${newTicket.ticketNumber} با موفقیت ارسال شد.`);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans" dir="rtl">
      
      {/* پروفایل ناقص (Incomplete Profile Overlay / Modal) */}
      {isProfileModalOpen && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl max-w-md w-full p-8 shadow-2xl text-right space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-lg">
              <Building2 className="w-8 h-8" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-lg font-black text-white">ویرایش اطلاعات پروفایل نمایندگی نسیه</h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                لطفاً اطلاعات هویتی و نام فروشگاه خود را وارد نمایید.
              </p>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">نام کامل نماینده:</label>
                <input
                  type="text"
                  required
                  value={editPartnerName || partnerName}
                  onChange={e => setEditPartnerName(e.target.value)}
                  placeholder="مثال: علی شیراوی"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">نام فروشگاه (اختیاری):</label>
                <input
                  type="text"
                  value={editStoreName || storeName}
                  onChange={e => setEditStoreName(e.target.value)}
                  placeholder="مثال: فروشگاه مرکزی پایتخت"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsProfileModalOpen(false)}
                  className="w-1/3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 rounded-xl text-xs transition-all shadow-lg flex items-center justify-center gap-1.5 cursor-pointer mt-4"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="w-2/3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl text-xs transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer mt-4"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  ذخیره اطلاعات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* سربرگ اصلی پنل نماینده (Main Header Banner) */}
      <header className="bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 border-b border-emerald-500/30 sticky top-0 z-30 shadow-xl px-4 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          <div className="flex items-center gap-3.5">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/60 text-white font-bold text-2xl border border-emerald-400/40">
              <ShoppingBag className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-base md:text-lg font-black text-white">{partnerName || 'نماینده فروش نسیه'}</h1>
                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                  <ShieldCheck className="w-4 h-4" />
                  پنل نماینده فروش نسیه (خرید مستقیم)
                </span>
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-bold px-2.5 py-0.5 rounded-full">
                  وضعیت: فعال (Active)
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 flex items-center gap-3 flex-wrap">
                {storeName && (
                  <>
                    <span>فروشگاه: <strong className="text-emerald-300 font-bold">{storeName}</strong></span>
                    <span>•</span>
                  </>
                )}
                <span>کد نمایندگی: <strong className="text-emerald-400 font-mono">{partnerCode}</strong></span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end md:self-auto">
            <button
              onClick={() => {
                setEditPartnerName(partnerName);
                setEditStoreName(storeName);
                setIsProfileModalOpen(true);
              }}
              className="bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <User className="w-4 h-4 text-emerald-400" />
              ویرایش پروفایل
            </button>

            <button
              onClick={onLogout}
              className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <LogOut className="w-4 h-4" />
              خروج
            </button>
          </div>

        </div>
      </header>

      {/* هدر خلاصه وضعیت سریع (Quick Status Summary Header Banner) */}
      <section className="bg-slate-800/90 border-b border-slate-700 px-4 py-3">
        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-900/80 border border-emerald-500/30 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-medium">سقف خرید نسیه مصوب</span>
                <strong className="text-xs text-white font-mono font-bold">{controlCheck.creditLimit.toLocaleString('fa-IR')} ریال</strong>
              </div>
            </div>
            <span className="text-[9px] bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/20 font-bold">مصوب</span>
          </div>

          <div className="bg-slate-900/80 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Scale className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-medium">بدهی جاری / مانده فاکتورها</span>
                <strong className="text-xs text-amber-300 font-mono font-bold">{controlCheck.netDebt.toLocaleString('fa-IR')} ریال</strong>
              </div>
            </div>
            <span className="text-[9px] bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded border border-amber-500/20 font-bold">{controlCheck.openInvoicesCount} فاکتور</span>
          </div>

          <div className="bg-slate-900/80 border border-indigo-500/30 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <ShoppingBag className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-medium">اعتبار قابل استفاده (زنده)</span>
                <strong className="text-xs text-indigo-300 font-mono font-bold">{controlCheck.remainingLimit.toLocaleString('fa-IR')} ریال</strong>
              </div>
            </div>
            <span className="text-[9px] bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20 font-bold">آماده خرید</span>
          </div>
        </div>
      </section>

      {/* سربرگ تب‌های ۵گانه ناوبری (5-Tab Navigation Layout) */}
      <nav className="bg-slate-800/80 border-b border-slate-700/80 px-4 backdrop-blur">
        <div className="max-w-7xl mx-auto flex items-center gap-1.5 overflow-x-auto py-2.5 no-scrollbar">
          
          {/* TAB 1: Overview */}
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap shadow-sm ${
              activeTab === 'overview'
                ? 'bg-emerald-600 text-white shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            نگاه کلی (Overview)
          </button>

          {/* TAB 2: Customers */}
          <button
            onClick={() => setActiveTab('customers')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap shadow-sm ${
              activeTab === 'customers'
                ? 'bg-emerald-600 text-white shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            مشتریان نسیه ({myCustomers.length})
          </button>

          {/* TAB 3: Catalog */}
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap shadow-sm ${
              activeTab === 'catalog'
                ? 'bg-emerald-600 text-white shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
            }`}
          >
            <Package className="w-4 h-4" />
            سفارش کالا / ویترین ({catalogList.length})
          </button>

          {/* TAB 4: Finances */}
          <button
            onClick={() => setActiveTab('finances')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap shadow-sm ${
              activeTab === 'finances'
                ? 'bg-emerald-600 text-white shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
            }`}
          >
            <Wallet className="w-4 h-4" />
            حساب مالی و صورتحساب
          </button>

          {/* TAB 5: Support */}
          <button
            onClick={() => setActiveTab('support')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap shadow-sm ${
              activeTab === 'support'
                ? 'bg-emerald-600 text-white shadow-emerald-900/40'
                : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            پشتیبانی و تیکت ({supportTickets.length})
          </button>

        </div>
      </nav>

      {/* محتوای اصلی */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        
        {/* TAB 1: OVERVIEW (نگاه کلی) */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            
            {/* بنر وضعیت سلامت حساب */}
            {controlCheck.status === 'HEALTHY' && (
              <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-emerald-300">وضعیت حساب: سالم و خوش‌حساب (HEALTHY)</h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {controlCheck.reason}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('catalog')}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  ثبت سفارش جدید کالا
                </button>
              </div>
            )}

            {/* کارت‌های میانبر و اقدام سریع */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <button
                onClick={() => setActiveTab('catalog')}
                className="bg-slate-800/80 border border-slate-700 hover:border-emerald-500/50 p-4 rounded-2xl text-right transition-all shadow-md flex flex-col justify-between cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <strong className="block text-xs font-bold text-white mb-0.5">سفارش عمده کالا</strong>
                  <span className="text-[10px] text-slate-400">مشاهده ویترین و ثبت سفارش نسیه</span>
                </div>
              </button>

              <button
                onClick={() => setIsAddCustomerModalOpen(true)}
                className="bg-slate-800/80 border border-slate-700 hover:border-indigo-500/50 p-4 rounded-2xl text-right transition-all shadow-md flex flex-col justify-between cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <strong className="block text-xs font-bold text-white mb-0.5">ثبت مشتری جدید</strong>
                  <span className="text-[10px] text-slate-400">تعریف خریدار نسیه جدید</span>
                </div>
              </button>

              <button
                onClick={() => setIsPaymentModalOpen(true)}
                className="bg-slate-800/80 border border-slate-700 hover:border-amber-500/50 p-4 rounded-2xl text-right transition-all shadow-md flex flex-col justify-between cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <strong className="block text-xs font-bold text-white mb-0.5">اعلام واریزی / تسویه</strong>
                  <span className="text-[10px] text-slate-400">ثبت فیش بانکی، کارتخوان یا چک</span>
                </div>
              </button>

              <button
                onClick={() => setIsSupportModalOpen(true)}
                className="bg-slate-800/80 border border-slate-700 hover:border-teal-500/50 p-4 rounded-2xl text-right transition-all shadow-md flex flex-col justify-between cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <strong className="block text-xs font-bold text-white mb-0.5">ارسال تیکت پشتیبانی</strong>
                  <span className="text-[10px] text-slate-400">ارتباط مستقیم با دفتر مرکزی</span>
                </div>
              </button>
            </div>

            {/* بخش هشدارهای مهم و شرایط تسویه */}
            <div className="bg-gradient-to-r from-amber-950/50 via-slate-900 to-slate-900 border border-amber-500/40 rounded-2xl p-5 shadow-xl space-y-3">
              <div className="flex items-center gap-2.5 text-amber-400">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <h3 className="text-sm font-bold">هشدارهای مهم و اطلاعیه‌های حسابداری نماینده فروش</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                  <div>
                    <span className="text-white font-bold block mb-0.5">وضعیت مهلت تسویه:</span>
                    <p className="text-slate-300 leading-relaxed">
                      مهلت استاندارد تسویه فاکتورهای نسیه <strong className="text-amber-300 font-mono">{controlCheck.paymentTermDays} روز</strong> پس از صدور است. در صورت نزدیک شدن به سررسید، جهت جلوگیری از اعمال جریمه تأخیر (<span className="font-mono text-amber-300">{controlCheck.lateFeePercentage}% ماهانه</span>) لطفاً اقدام فرمایید.
                    </p>
                  </div>
                </div>

                <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                  <div>
                    <span className="text-white font-bold block mb-0.5">اطلاعیه تسویه و اعلام پرداخت:</span>
                    <p className="text-slate-300 leading-relaxed">
                      تمام واریزی‌های بانکی، کارکرد کارتخوان و چک‌های پرداختی خود را از طریق بخش «اعلام واریزی / تسویه» ثبت نمایید تا پس از بررسی مدیریت اعمال گردد.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* لیست آخرین سفارشات خرید نسیه */}
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-400" />
                  سفارشات خرید نسیه اخیر ({myPurchaseOrders.length})
                </h3>
                <button 
                  onClick={() => setActiveTab('catalog')} 
                  className="text-xs text-emerald-400 hover:underline font-medium cursor-pointer"
                >
                  ثبت سفارش جدید
                </button>
              </div>

              {myPurchaseOrders.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs">
                  هنوز هیچ سفارشی توسط این نمایندگی ثبت نشده است.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-slate-700/80 text-slate-400 pb-2">
                        <th className="py-2.5 px-3">شماره سفارش</th>
                        <th className="py-2.5 px-3">تاریخ ثبت</th>
                        <th className="py-2.5 px-3">مبلغ کل (ریال)</th>
                        <th className="py-2.5 px-3">تعداد اقلام</th>
                        <th className="py-2.5 px-3">وضعیت سفارش</th>
                        <th className="py-2.5 px-3 text-center">جزئیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {myPurchaseOrders.map(order => (
                        <tr key={order.id} className="hover:bg-slate-700/30">
                          <td className="py-3.5 px-3 font-mono font-bold text-emerald-300">{order.orderNumber || order.id}</td>
                          <td className="py-3.5 px-3 text-slate-300 font-mono">
                            {new Date(order.orderDate || order.createdAt).toLocaleDateString('fa-IR')}
                          </td>
                          <td className="py-3.5 px-3 font-mono text-white font-bold">
                            {order.totalAmount?.toLocaleString('fa-IR')}
                          </td>
                          <td className="py-3.5 px-3 text-slate-300 font-mono">
                            {order.items?.length || 0} کالا
                          </td>
                          <td className="py-3.5 px-3">
                            <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border ${
                              order.status === 'CONVERTED_TO_INVOICE' ? 'bg-emerald-500/30 text-emerald-300 border-emerald-500/50' :
                              order.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                              order.status === 'REJECTED' ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
                              order.status === 'CANCELLED' ? 'bg-slate-700 text-slate-400 border-slate-600' :
                              'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            }`}>
                              {order.status === 'CONVERTED_TO_INVOICE' ? 'تبدیل‌شده به فاکتور رسمی' :
                               order.status === 'APPROVED' ? 'تایید شده' :
                               order.status === 'REJECTED' ? 'رد شده' :
                               order.status === 'CANCELLED' ? 'لغو شده' : 'در حال بررسی'}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-center">
                            <button
                              onClick={() => setSelectedViewOrder(order)}
                              className="text-xs text-teal-400 hover:text-teal-300 font-bold bg-teal-500/10 px-2.5 py-1 rounded-md border border-teal-500/20 cursor-pointer"
                            >
                              مشاهده
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

        {/* TAB 2: CUSTOMERS (مشتریان نسیه) */}
        {activeTab === 'customers' && (
          <div className="space-y-5">
            
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">مدیریت خریداران و مشتریان نسیه</h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    لیست اشخاص و مشتریان طرف قرارداد که توسط این نمایندگی خدمت‌رسانی می‌شوند.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsAddCustomerModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                تعریف مشتری نسیه جدید
              </button>
            </div>

            {/* جستجو */}
            <div className="bg-slate-800/90 border border-slate-700/80 p-3 rounded-2xl">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
                <input
                  type="text"
                  placeholder="جستجوی نام مشتری، شماره موبایل یا کد ملی..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-xs text-white pr-9 pl-3 py-2.5 rounded-xl focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* جدول مشتریان */}
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 shadow-lg">
              {filteredCustomers.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs space-y-3">
                  <Users className="w-8 h-8 mx-auto text-slate-500" />
                  <p>هیچ مشتری ثبت‌شده‌ای یافت نشد.</p>
                  <button
                    onClick={() => setIsAddCustomerModalOpen(true)}
                    className="text-emerald-400 hover:underline text-xs font-bold"
                  >
                    برای ثبت اولین مشتری کلیک کنید
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-slate-700/80 text-slate-400 pb-2">
                        <th className="py-2.5 px-3">کد مشتری</th>
                        <th className="py-2.5 px-3">نام و نام خانوادگی</th>
                        <th className="py-2.5 px-3">شماره موبایل</th>
                        <th className="py-2.5 px-3">کد ملی</th>
                        <th className="py-2.5 px-3">تلفن ثابت</th>
                        <th className="py-2.5 px-3">تاریخ ثبت</th>
                        <th className="py-2.5 px-3 text-center">وضعیت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {filteredCustomers.map(cust => (
                        <tr key={cust.id} className="hover:bg-slate-700/30">
                          <td className="py-3 px-3 font-mono text-emerald-400 font-bold">{cust.code}</td>
                          <td className="py-3 px-3 font-bold text-white">{cust.name}</td>
                          <td className="py-3 px-3 font-mono text-slate-300">{cust.mobile || '—'}</td>
                          <td className="py-3 px-3 font-mono text-slate-300">{cust.nationalId || '—'}</td>
                          <td className="py-3 px-3 font-mono text-slate-300">{cust.phone || '—'}</td>
                          <td className="py-3 px-3 font-mono text-slate-400 text-[11px]">
                            {cust.createdAt ? new Date(cust.createdAt).toLocaleDateString('fa-IR') : '—'}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">
                              فعال
                            </span>
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

        {/* TAB 3: CATALOG (سفارش کالا / ویترین) */}
        {activeTab === 'catalog' && (
          <div className="space-y-5 pb-20">
            
            <div className="bg-slate-800/90 border border-emerald-500/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">ویترین موجودی قابل سفارش نسیه</h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    انتخاب کالا و ثبت درخواست خرید نسیه مستقیم از شرکت
                  </p>
                </div>
              </div>

              {cart.length > 0 && (
                <button
                  onClick={() => setIsCartModalOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-2 cursor-pointer shrink-0 animate-bounce"
                >
                  <ShoppingBag className="w-4 h-4" />
                  مشاهده سبد سفارش ({cart.reduce((sum, c) => sum + c.quantity, 0)} کالا)
                </button>
              )}
            </div>

            <div className="bg-slate-800/90 border border-slate-700/80 p-4 rounded-2xl flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5" />
                <input
                  type="text"
                  placeholder="جستجوی نام کالا، کد محصول یا برند..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-xs text-white pr-9 pl-3 py-2.5 rounded-xl focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-xs text-white px-3 py-2.5 rounded-xl focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="all">همه دسته‌بندی‌ها</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>

                {brands.length > 0 && (
                  <select
                    value={brandFilter}
                    onChange={e => setBrandFilter(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-xs text-white px-3 py-2.5 rounded-xl focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="all">همه برندها</option>
                    {brands.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* کارت‌های محصولات ویترین */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredCatalog.map(item => {
                const cartEntry = cart.find(c => c.item.id === item.id);
                const qtyInCart = cartEntry ? cartEntry.quantity : 0;

                return (
                  <div key={item.id} className="bg-slate-800/90 border border-slate-700 hover:border-emerald-500/40 rounded-2xl p-4 flex flex-col justify-between shadow-lg transition-all">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-mono bg-slate-900 text-slate-400 px-2 py-0.5 rounded border border-slate-700">
                          کد: {item.code}
                        </span>
                        {item.badge && (
                          <span className="text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
                            ویژه
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs font-bold text-white mb-1.5 line-clamp-2">{item.name}</h4>
                      {item.brand && (
                        <span className="text-[10px] text-teal-400 block mb-2 font-medium">برند: {item.brand}</span>
                      )}

                      <div className="bg-slate-900/60 p-2.5 rounded-xl space-y-1 my-3 border border-slate-800">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-400">قیمت نسیه پیشنهادی:</span>
                          <strong className="text-emerald-400 font-mono">{item.suggestedNesyehPrice.toLocaleString('fa-IR')} ریال</strong>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <span className="text-slate-400">ظرفیت انبار:</span>
                          <span className="text-slate-300 font-mono font-bold">{item.orderableCapacity} عدد</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-700/60">
                      {qtyInCart > 0 ? (
                        <div className="flex items-center justify-between bg-emerald-950/60 border border-emerald-500/40 rounded-xl p-1.5">
                          <button
                            onClick={() => handleUpdateCartQty(item.id, qtyInCart - 1)}
                            className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-white rounded-lg flex items-center justify-center font-bold text-sm cursor-pointer"
                          >
                            -
                          </button>
                          <span className="font-mono text-xs font-bold text-emerald-300 px-2">{qtyInCart} عدد</span>
                          <button
                            onClick={() => handleUpdateCartQty(item.id, qtyInCart + 1)}
                            className="w-7 h-7 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center justify-center font-bold text-sm cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleAddToCart(item, 1)}
                          className="w-full bg-slate-700 hover:bg-emerald-600 text-white py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                        >
                          <Plus className="w-4 h-4" />
                          افزودن به سبد
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {cart.length > 0 && (
              <div className="fixed bottom-6 left-6 z-40 animate-bounce">
                <button
                  type="button"
                  onClick={() => setIsCartModalOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-3 rounded-2xl text-xs font-black shadow-2xl flex items-center gap-3 border border-emerald-400/40 cursor-pointer"
                >
                  <ShoppingBag className="w-5 h-5" />
                  <span>مشاهده سبد خرید و پیش‌فاکتور ({cart.reduce((sum, c) => sum + c.quantity, 0)} کالا)</span>
                  <span className="bg-slate-900/80 font-mono text-emerald-300 px-2.5 py-1 rounded-xl">
                    {cartTotalAmount.toLocaleString('fa-IR')} ریال
                  </span>
                </button>
              </div>
            )}

          </div>
        )}

        {/* TAB 4: FINANCES (حساب مالی و صورتحساب) */}
        {activeTab === 'finances' && (
          <div className="space-y-6">
            
            {/* کارت‌های خلاصه حساب مالی */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-lg">
                <span className="text-xs text-slate-400 font-medium block mb-1">جمع بدهکار (خریدها و بارهای تحویلی)</span>
                <div className="text-xl font-black text-rose-400 font-mono">
                  {controlCheck.totalDebtor.toLocaleString('fa-IR')} <span className="text-xs font-sans text-slate-400">ریال</span>
                </div>
              </div>

              <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-lg">
                <span className="text-xs text-slate-400 font-medium block mb-1">جمع بستانکار (پرداختی‌ها و واریزی‌ها)</span>
                <div className="text-xl font-black text-emerald-400 font-mono">
                  {controlCheck.totalCreditor.toLocaleString('fa-IR')} <span className="text-xs font-sans text-slate-400">ریال</span>
                </div>
              </div>

              <div className="bg-slate-800/90 border border-amber-500/40 rounded-2xl p-5 shadow-lg">
                <span className="text-xs text-slate-400 font-medium block mb-1">مانده خالص بدهی فعلی</span>
                <div className="text-xl font-black text-amber-300 font-mono">
                  {controlCheck.netDebt.toLocaleString('fa-IR')} <span className="text-xs font-sans text-slate-400">ریال</span>
                </div>
              </div>
            </div>

            {/* بخش اعلام پرداخت و تسویه */}
            <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-lg space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-emerald-400" />
                    اعلام واریزی‌ها و درخواست‌های تسویه حساب ({myPaymentDeclarations.length})
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">ثبت واریزی بانکی، کارکرد دستگاه پوز یا چک‌های پرداختی</p>
                </div>

                <button
                  onClick={() => setIsPaymentModalOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  ثبت اعلام پرداخت جدید
                </button>
              </div>

              {myPaymentDeclarations.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  هیچ اعلام پرداختی ثبت نشده است.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-slate-700/80 text-slate-400">
                        <th className="py-2.5 px-3">شماره پیگیری</th>
                        <th className="py-2.5 px-3">روش پرداخت</th>
                        <th className="py-2.5 px-3">مبلغ (ریال)</th>
                        <th className="py-2.5 px-3">تاریخ واریز</th>
                        <th className="py-2.5 px-3">وضعیت تایید</th>
                        <th className="py-2.5 px-3">توضیحات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {myPaymentDeclarations.map(decl => (
                        <tr key={decl.id} className="hover:bg-slate-700/30">
                          <td className="py-3 px-3 font-mono font-bold text-emerald-400">{decl.declarationNumber}</td>
                          <td className="py-3 px-3">
                            <span className="bg-slate-900 px-2 py-0.5 rounded text-[10px] font-bold text-slate-300">
                              {decl.paymentType === 'POS' ? 'دستگاه پوز' :
                               decl.paymentType === 'BANK_TRANSFER' ? 'حواله بانکی / فیش' : 'چک صیادی'}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-white">{decl.amount.toLocaleString('fa-IR')}</td>
                          <td className="py-3 px-3 font-mono text-slate-300">{decl.paymentDate}</td>
                          <td className="py-3 px-3">
                            <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                              (decl.status === 'APPROVED' || decl.status === 'VERIFIED' || decl.status === 'RECONCILED_WITH_DISCREPANCY')
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                              decl.status === 'REJECTED' 
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
                              'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            }`}>
                              {(decl.status === 'APPROVED' || decl.status === 'VERIFIED' || decl.status === 'RECONCILED_WITH_DISCREPANCY')
                                ? (decl.status === 'RECONCILED_WITH_DISCREPANCY' ? 'تایید با مغایرت' : 'تایید شده (سند صادر شد)') :
                               decl.status === 'REJECTED' ? 'رد شده' : 'در حال بررسی واحد مالی'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-slate-400 text-[11px] max-w-xs truncate">
                            {decl.partnerNotes || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* دفتر اسناد حسابداری */}
            <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-lg">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                دفتر اسناد حسابداری و گردش حساب ({partnerVouchers.length} سند)
              </h3>

              {partnerVouchers.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  هیچ سند حسابداری مستقیمی ثبت نشده است.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-slate-700/80 text-slate-400">
                        <th className="py-2.5 px-3">شماره سند</th>
                        <th className="py-2.5 px-3">تاریخ</th>
                        <th className="py-2.5 px-3">شرح سند</th>
                        <th className="py-2.5 px-3">مبلغ بدهکار</th>
                        <th className="py-2.5 px-3">مبلغ بستانکار</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {partnerVouchers.map(v => (
                        <tr key={v.id} className="hover:bg-slate-700/30">
                          <td className="py-3 px-3 font-mono font-bold text-emerald-400">#{v.voucherNumber}</td>
                          <td className="py-3 px-3 font-mono text-slate-300">{v.date}</td>
                          <td className="py-3 px-3 text-slate-200">{v.description}</td>
                          <td className="py-3 px-3 font-mono text-rose-300">
                            {v.entries.reduce((sum, e) => sum + (e.debit || 0), 0).toLocaleString('fa-IR')}
                          </td>
                          <td className="py-3 px-3 font-mono text-emerald-300">
                            {v.entries.reduce((sum, e) => sum + (e.credit || 0), 0).toLocaleString('fa-IR')}
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

        {/* TAB 5: SUPPORT (پشتیبانی و تیکت) */}
        {activeTab === 'support' && (
          <div className="space-y-6">
            
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">مرکز پشتیبانی و تیکت‌های نمایندگی</h3>
                  <p className="text-xs text-slate-300 mt-0.5">
                    ارتباط مستقیم با کارشناسان حسابداری و بازرگانی دفتر مرکزی
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsSupportModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                ارسال تیکت جدید
              </button>
            </div>

            {/* لیست تیکت‌های پشتیبانی */}
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 shadow-lg space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FileQuestion className="w-4 h-4 text-emerald-400" />
                تیکت‌های فعال و سوابق پاسخ‌ها ({supportTickets.length})
              </h3>

              {supportTickets.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs">
                  هیچ تیکتی ثبت نشده است.
                </div>
              ) : (
                <div className="space-y-3">
                  {supportTickets.map(t => (
                    <div key={t.id} className="bg-slate-900/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-emerald-400 text-xs font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            {t.ticketNumber}
                          </span>
                          <h4 className="text-xs font-bold text-white">{t.subject}</h4>
                        </div>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700 font-bold">
                            دسته: {t.category}
                          </span>
                          <span className={`px-2.5 py-0.5 rounded-full font-bold border ${
                            t.status === 'پاسخ داده شده' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                            t.status === 'بسته شده' ? 'bg-slate-700 text-slate-400 border-slate-600' :
                            'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          }`}>
                            {t.status}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-slate-200 leading-relaxed bg-slate-950/40 p-3 rounded-xl border border-slate-850">
                        {t.message}
                      </p>

                      {t.adminResponse && (
                        <div className="bg-emerald-950/30 border border-emerald-500/30 p-3 rounded-xl text-xs space-y-1">
                          <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            پاسخ پشتیبانی دفتر مرکزی:
                          </div>
                          <p className="text-slate-200 leading-relaxed">{t.adminResponse}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* راهنما و سوالات متداول نمایندگان نسیه */}
            <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 shadow-lg space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-emerald-400" />
                راهنمای جامع و سوالات متداول عاملیت نسیه
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-1">
                  <strong className="text-emerald-300 font-bold block">سفارشات نسیه چگونه تایید می‌شوند؟</strong>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    سفارشات ثبت‌شده در بخش ویترین فوراً توسط واحد بازرگانی بررسی شده و پس از اعتبارسنجی سقف اعتبار، تبدیل به فاکتور رسمی فروش نسیه می‌شوند.
                  </p>
                </div>

                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-1">
                  <strong className="text-emerald-300 font-bold block">نحوه ثبت واریزی‌ها و فیش‌های بانکی چگونه است؟</strong>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    کلیه واریزی‌های شبا، دستگاه پوز یا چک‌های صیادی از طریق تب «حساب مالی» و دکمه «اعلام واریزی / تسویه» ثبت شده و پس از تایید حسابداری در حساب شما اعمال می‌گردد.
                  </p>
                </div>
              </div>
            </div>

          </div>
        )}

      </main>

      {/* MODAL 1: ADD CUSTOMER MODAL */}
      {isAddCustomerModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 text-right">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                تعریف و ثبت خریدار / مشتری نسیه جدید
              </h3>
              <button 
                onClick={() => setIsAddCustomerModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCustomerSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">نام و نام خانوادگی مشتری (*):</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: محمد حسینی"
                  value={custName}
                  onChange={e => setCustName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">شماره همراه (*):</label>
                  <input
                    type="text"
                    required
                    maxLength={11}
                    placeholder="09123456789"
                    value={custMobile}
                    onChange={e => setCustMobile(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">کد ملی:</label>
                  <input
                    type="text"
                    maxLength={10}
                    placeholder="1234567890"
                    value={custNationalId}
                    onChange={e => setCustNationalId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">تلفن ثابت:</label>
                  <input
                    type="text"
                    placeholder="02188888888"
                    value={custPhone}
                    onChange={e => setCustPhone(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">آدرس محل سکونت / کسب:</label>
                  <input
                    type="text"
                    placeholder="آدرس کامل..."
                    value={custAddress}
                    onChange={e => setCustAddress(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-3 border-t border-slate-800">
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  ذخیره و ایجاد پرونده مشتری
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddCustomerModalOpen(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CART / PURCHASE ORDER SUBMISSION */}
      {isCartModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-5 text-right">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-emerald-400" />
                سبد درخواست سفارش خرید عمده نسیه
              </h3>
              <button 
                onClick={() => setIsCartModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto divide-y divide-slate-800 space-y-2 pr-1">
              {cart.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  سبد خرید شما در حال حاضر خالی است.
                </div>
              ) : (
                cart.map(c => (
                  <div key={c.item.id} className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                    <div>
                      <h5 className="font-bold text-white">{c.item.name}</h5>
                      <span className="text-[10px] text-slate-400">کد: {c.item.code} • فی: {c.item.suggestedNesyehPrice.toLocaleString('fa-IR')} ریال</span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto">
                      <div className="flex items-center border border-slate-700 bg-slate-950 rounded-lg p-1 gap-1">
                        <button
                          type="button"
                          onClick={() => handleUpdateCartQty(c.item.id, c.quantity - 1)}
                          className="w-6 h-6 bg-slate-800 hover:bg-slate-700 text-white rounded flex items-center justify-center font-bold text-xs cursor-pointer"
                        >
                          -
                        </button>
                        <span className="font-mono text-xs font-bold text-emerald-300 px-2 min-w-[32px] text-center">
                          {c.quantity} عدد
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateCartQty(c.item.id, c.quantity + 1)}
                          className="w-6 h-6 bg-emerald-700 hover:bg-emerald-600 text-white rounded flex items-center justify-center font-bold text-xs cursor-pointer"
                        >
                          +
                        </button>
                      </div>

                      <span className="font-mono text-emerald-300 font-bold min-w-[90px] text-left">
                        {(c.quantity * c.item.suggestedNesyehPrice).toLocaleString('fa-IR')} ریال
                      </span>

                      <button
                        type="button"
                        onClick={() => handleUpdateCartQty(c.item.id, 0)}
                        className="text-rose-400 hover:text-rose-300 p-1 cursor-pointer"
                        title="حذف از سبد"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="bg-slate-950 p-3 rounded-xl space-y-2 border border-slate-800 text-xs">
              <div className="flex justify-between font-bold text-white">
                <span>مبلغ کل سفارش:</span>
                <span className="font-mono text-emerald-400 text-sm">{cartTotalAmount.toLocaleString('fa-IR')} ریال</span>
              </div>
              <div className="flex justify-between text-slate-400 text-[11px]">
                <span>اعتبار باقیمانده فعلی:</span>
                <span className="font-mono text-indigo-300">{controlCheck.remainingLimit.toLocaleString('fa-IR')} ریال</span>
              </div>
            </div>

            <div>
              <label className="block text-slate-300 text-xs font-bold mb-1">توضیحات و یادداشت سفارش:</label>
              <textarea
                rows={2}
                value={orderNote}
                onChange={e => setOrderNote(e.target.value)}
                placeholder="توضیحات تحویل یا بسته‌بندی..."
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={handleSubmitPurchaseOrder}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                ثبت نهایی و ارسال سفارش خرید
              </button>
              <button
                onClick={() => setIsCartModalOpen(false)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: PAYMENT DECLARATION MODAL */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 text-right">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-400" />
                ثبت فرم اعلام پرداخت و درخواست تسویه
              </h3>
              <button 
                onClick={() => setIsPaymentModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitPaymentDeclaration} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">روش پرداخت (*):</label>
                <select
                  value={declType}
                  onChange={e => setDeclType(e.target.value as NesyehPaymentType)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="POS">دستگاه کارتخوان (POS)</option>
                  <option value="BANK_TRANSFER">حواله بانکی / واریز به حساب</option>
                  <option value="CHECK">چک صیادی</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">مبلغ واریزی (ریال) (*):</label>
                  <input
                    type="number"
                    required
                    min={1000}
                    placeholder="مثال: ۵۰۰۰۰۰۰۰"
                    value={declAmount || ''}
                    onChange={e => setDeclAmount(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">تاریخ پرداخت:</label>
                  <input
                    type="date"
                    value={declDate}
                    onChange={e => setDeclDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {declType === 'POS' && (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-3">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1">شماره ترمینال پوز:</label>
                    <input
                      type="text"
                      placeholder="مثال: 98123456"
                      value={declPosTerminal}
                      onChange={e => setDeclPosTerminal(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                    />
                  </div>
                </div>
              )}

              {declType === 'BANK_TRANSFER' && (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-300 font-bold mb-1">نام بانک مبدا:</label>
                      <input
                        type="text"
                        placeholder="بانک ملی"
                        value={declBankName}
                        onChange={e => setDeclBankName(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-bold mb-1">شماره پیگیری / پیوند:</label>
                      <input
                        type="text"
                        placeholder="12345678"
                        value={declBankTrackingNumber}
                        onChange={e => setDeclBankTrackingNumber(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {declType === 'CHECK' && (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-300 font-bold mb-1">شماره چک (*):</label>
                      <input
                        type="text"
                        required
                        placeholder="987654"
                        value={declCheckNumber}
                        onChange={e => setDeclCheckNumber(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-bold mb-1">شناسه صیادی ۱۶ رقمی (*):</label>
                      <input
                        type="text"
                        required
                        maxLength={16}
                        placeholder="1234567890123456"
                        value={declCheckSayadId}
                        onChange={e => setDeclCheckSayadId(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-300 font-bold mb-1">بانک صادرکننده:</label>
                      <input
                        type="text"
                        placeholder="مثال: بانک صادرات"
                        value={declBankName}
                        onChange={e => setDeclBankName(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-bold mb-1">تاریخ سررسید چک:</label>
                      <input
                        type="date"
                        value={declCheckDueDate}
                        onChange={e => setDeclCheckDueDate(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-bold mb-1">توضیحات تکمیلی:</label>
                <textarea
                  rows={2}
                  value={declNotes}
                  onChange={e => setDeclNotes(e.target.value)}
                  placeholder="توضیحات..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex gap-3 pt-3 border-t border-slate-800">
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  ارسال اعلام پرداخت به مدیریت
                </button>
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: CREATE SUPPORT TICKET MODAL */}
      {isSupportModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 text-right">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                ارسال تیکت پشتیبانی جدید به دفتر مرکزی
              </h3>
              <button 
                onClick={() => setIsSupportModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSupportTicket} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">موضوع تیکت (*):</label>
                <input
                  type="text"
                  required
                  placeholder="عنوان و موضوع درخواست..."
                  value={ticketSubject}
                  onChange={e => setTicketSubject(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">دسته‌بندی موضوع:</label>
                  <select
                    value={ticketCategory}
                    onChange={e => setTicketCategory(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="مالی">امور مالی و حسابداری</option>
                    <option value="ارسال کالا">ارسال کالا و انبار</option>
                    <option value="سقف اعتبار">سقف خرید و اعتبار</option>
                    <option value="مشکل فنی">مشکل فنی سامانه</option>
                    <option value="سایر">سایر موارد</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">اولویت درخواست:</label>
                  <select
                    value={ticketPriority}
                    onChange={e => setTicketPriority(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="عادی">عادی</option>
                    <option value="مهم">مهم</option>
                    <option value="فوری">فوری</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">شرح پیام و درخواست (*):</label>
                <textarea
                  rows={4}
                  required
                  value={ticketMessage}
                  onChange={e => setTicketMessage(e.target.value)}
                  placeholder="متن کامل پیام و درخواست خود را بنویسید..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex gap-3 pt-3 border-t border-slate-800">
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  ثبت و ارسال تیکت
                </button>
                <button
                  type="button"
                  onClick={() => setIsSupportModalOpen(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: VIEW ORDER DETAILS MODAL */}
      {selectedViewOrder && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-5 text-right">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-400" />
                  جزئیات سفارش خرید نسیه #{selectedViewOrder.orderNumber}
                </h3>
                <span className="text-[10px] text-slate-400 font-mono">
                  تاریخ: {new Date(selectedViewOrder.orderDate || selectedViewOrder.createdAt).toLocaleDateString('fa-IR')}
                </span>
              </div>
              <button 
                onClick={() => setSelectedViewOrder(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto divide-y divide-slate-800 space-y-2 pr-1 text-xs">
              {selectedViewOrder.items?.map(it => (
                <div key={it.id} className="pt-2 flex items-center justify-between gap-3">
                  <div>
                    <h5 className="font-bold text-white">{it.productName}</h5>
                    <span className="text-[10px] text-slate-400">تعداد: {it.requestedQuantity} عدد • فی: {it.unitPrice.toLocaleString('fa-IR')} ریال</span>
                  </div>
                  <span className="font-mono text-emerald-300 font-bold">{it.totalPrice.toLocaleString('fa-IR')} ریال</span>
                </div>
              ))}
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center text-xs font-bold">
              <span className="text-slate-300">مبلغ کل سفارش:</span>
              <span className="font-mono text-emerald-400 text-sm">{selectedViewOrder.totalAmount?.toLocaleString('fa-IR')} ریال</span>
            </div>

            {selectedViewOrder.partnerNotes && (
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
                <span className="text-slate-400 font-bold block mb-1">یادداشت نماینده:</span>
                <p className="text-slate-200">{selectedViewOrder.partnerNotes}</p>
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-slate-800">
              <button
                onClick={() => setSelectedViewOrder(null)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-5 py-2 rounded-xl text-xs transition-colors cursor-pointer"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default NesyehPartnerDashboard;
