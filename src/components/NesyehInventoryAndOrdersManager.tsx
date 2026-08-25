import React, { useState, useMemo } from 'react';
import { 
  Package, ShoppingBag, Plus, Search, Filter, Edit3, Trash2, CheckCircle2, 
  AlertCircle, Info, Tag, Layers, ArrowUpRight, Eye, Check, X, ShieldAlert, Clock,
  Truck, CheckCheck, FileText, CornerDownLeft, Receipt, ArrowRightLeft, Lock,
  CreditCard, Scale, DollarSign, FileCheck
} from 'lucide-react';
import { 
  AppState, Product, NesyehOrderableItem, NesyehBadgeType, 
  NesyehPurchaseOrder, NesyehPurchaseOrderStatus, NesyehPurchaseOrderItem,
  Invoice, InvoiceItem, NesyehPaymentDeclaration, NesyehPaymentStatus,
  JournalVoucher, Check as CheckType
} from '../types';
import { getCurrentJalaliDate } from '../utils/jalali';
import { calculateProductStocks } from '../utils/accounting';
import { resolvePartnerCreditRules } from '../utils/partnerProcess';
import { globalFinancialEventAdapter } from '../modules/sms';
import { InvoiceService } from '../services/invoiceService';

interface NesyehInventoryAndOrdersManagerProps {
  state: AppState;
  onUpdateState: (newState: AppState) => void;
  currentUserId?: string;
}

export function NesyehInventoryAndOrdersManager({
  state,
  onUpdateState,
}: NesyehInventoryAndOrdersManagerProps) {
  const [activeTab, setActiveTab] = useState<'catalog' | 'orders' | 'payments'>('catalog');

  // --- CATALOG MANAGEMENT STATE ---
  const [searchCatalogQuery, setSearchCatalogQuery] = useState('');
  const [isAddingCatalogItem, setIsAddingCatalogItem] = useState(false);
  const [editingCatalogItem, setEditingCatalogItem] = useState<NesyehOrderableItem | null>(null);

  // Form state for catalog item
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [itemCashPrice, setItemCashPrice] = useState<number>(0);
  const [itemNesyehPrice, setItemNesyehPrice] = useState<number>(0);
  const [itemCapacity, setItemCapacity] = useState<number>(100);
  const [itemPriority, setItemPriority] = useState<number>(1);
  const [itemBadge, setItemBadge] = useState<NesyehBadgeType | ''>('NEW');
  const [itemIsActive, setItemIsActive] = useState<boolean>(true);

  // --- ORDERS MANAGEMENT STATE ---
  const [searchOrdersQuery, setSearchOrdersQuery] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [selectedOrder, setSelectedOrder] = useState<NesyehPurchaseOrder | null>(null);
  const [editingOrderItems, setEditingOrderItems] = useState<NesyehPurchaseOrderItem[]>([]);
  const [adminNotes, setAdminNotes] = useState<string>('');

  // --- PAYMENTS MANAGEMENT STATE (Phase 5.2) ---
  const [searchPaymentsQuery, setSearchPaymentsQuery] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');
  const [selectedPayment, setSelectedPayment] = useState<NesyehPaymentDeclaration | null>(null);
  const [paymentAdminNotes, setPaymentAdminNotes] = useState<string>('');
  const [posBankMatchedAmount, setPosBankMatchedAmount] = useState<number>(0);

  // 1. Catalog List
  const catalogItems = useMemo(() => {
    return state.nesyehCatalog || [];
  }, [state.nesyehCatalog]);

  const filteredCatalogItems = useMemo(() => {
    if (!searchCatalogQuery.trim()) return catalogItems;
    const q = searchCatalogQuery.toLowerCase().trim();
    return catalogItems.filter(item => 
      item.name.toLowerCase().includes(q) || 
      item.code.toLowerCase().includes(q) ||
      (item.brand && item.brand.toLowerCase().includes(q)) ||
      (item.category && item.category.toLowerCase().includes(q))
    );
  }, [catalogItems, searchCatalogQuery]);

  // Available base products not yet added to showcase (or all products)
  const baseProducts = useMemo(() => {
    return state.products || [];
  }, [state.products]);

  // Handle product selection in form
  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    const prod = baseProducts.find(p => p.id === productId);
    if (prod) {
      const cash = prod.defaultSalePrice || 0;
      setItemCashPrice(cash);
      setItemNesyehPrice(Math.round(cash * 1.05));
    }
  };

  // Save new / edited catalog item
  const handleSaveCatalogItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId && !editingCatalogItem) return;

    const baseProd = baseProducts.find(p => p.id === selectedProductId) || (editingCatalogItem ? {
      code: editingCatalogItem.code,
      name: editingCatalogItem.name,
      brand: editingCatalogItem.brand,
      category: editingCatalogItem.category,
      image: editingCatalogItem.image,
      description: editingCatalogItem.description,
    } : null);

    if (!baseProd) return;

    const now = new Date().toISOString();

    let updatedCatalog = [...(state.nesyehCatalog || [])];

    if (editingCatalogItem) {
      updatedCatalog = updatedCatalog.map(item => {
        if (item.id === editingCatalogItem.id) {
          return {
            ...item,
            cashPrice: itemCashPrice,
            suggestedNesyehPrice: itemNesyehPrice,
            orderableCapacity: itemCapacity,
            priority: itemPriority,
            badge: itemBadge ? (itemBadge as NesyehBadgeType) : undefined,
            isActive: itemIsActive,
            updatedAt: now
          };
        }
        return item;
      });
    } else {
      const newItem: NesyehOrderableItem = {
        id: `NCI_${Date.now()}`,
        productId: selectedProductId,
        code: (baseProd as Product).code || editingCatalogItem?.code || 'P-000',
        name: (baseProd as Product).name || editingCatalogItem?.name || 'کالا',
        brand: (baseProd as any)?.brand || '',
        category: (baseProd as Product).category || '',
        image: (baseProd as any)?.image || '',
        description: (baseProd as any)?.description || '',
        cashPrice: itemCashPrice,
        suggestedNesyehPrice: itemNesyehPrice,
        orderableCapacity: itemCapacity,
        priority: itemPriority,
        badge: itemBadge ? (itemBadge as NesyehBadgeType) : undefined,
        isActive: itemIsActive,
        createdAt: now,
        updatedAt: now
      };
      updatedCatalog.push(newItem);
    }

    onUpdateState({
      ...state,
      nesyehCatalog: updatedCatalog
    });

    setIsAddingCatalogItem(false);
    setEditingCatalogItem(null);
    setSelectedProductId('');
  };

  // Toggle active status
  const handleToggleCatalogActive = (itemId: string) => {
    const updatedCatalog = (state.nesyehCatalog || []).map(item => {
      if (item.id === itemId) {
        return { ...item, isActive: !item.isActive, updatedAt: new Date().toISOString() };
      }
      return item;
    });
    onUpdateState({ ...state, nesyehCatalog: updatedCatalog });
  };

  // Delete item from catalog
  const handleDeleteCatalogItem = (itemId: string) => {
    if (!confirm('آیا از حذف این کالا از ویترین نسیه اطمینان دارید؟')) return;
    const updatedCatalog = (state.nesyehCatalog || []).filter(item => item.id !== itemId);
    onUpdateState({ ...state, nesyehCatalog: updatedCatalog });
  };

  // 2. Orders List
  const nesyehOrders = useMemo(() => {
    return state.nesyehPurchaseOrders || [];
  }, [state.nesyehPurchaseOrders]);

  const filteredOrders = useMemo(() => {
    return nesyehOrders.filter(order => {
      const matchesSearch = 
        order.orderNumber.toLowerCase().includes(searchOrdersQuery.toLowerCase()) ||
        order.partnerName.toLowerCase().includes(searchOrdersQuery.toLowerCase()) ||
        (order.storeName && order.storeName.toLowerCase().includes(searchOrdersQuery.toLowerCase()));

      const matchesStatus = orderStatusFilter === 'all' || order.status === orderStatusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [nesyehOrders, searchOrdersQuery, orderStatusFilter]);

  // Open order reviewer
  const handleOpenOrder = (order: NesyehPurchaseOrder) => {
    setSelectedOrder(order);
    setEditingOrderItems(JSON.parse(JSON.stringify(order.items)));
    setAdminNotes(order.adminNotes || '');
  };

  // Update quantity in reviewer
  const handleItemQuantityChange = (itemId: string, newQty: number) => {
    setEditingOrderItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const approvedQuantity = Math.max(0, newQty);
        return {
          ...item,
          approvedQuantity,
          totalPrice: approvedQuantity * item.unitPrice
        };
      }
      return item;
    }));
  };

  // Update status of order
  const handleUpdateOrderStatus = (newStatus: NesyehPurchaseOrderStatus) => {
    if (!selectedOrder) return;

    // Check if items were modified
    let finalStatus = newStatus;
    const isModified = editingOrderItems.some(edited => {
      const orig = selectedOrder.items.find(i => i.id === edited.id);
      return orig && (orig.approvedQuantity !== edited.approvedQuantity || orig.unitPrice !== edited.unitPrice);
    });

    if (isModified && newStatus === 'APPROVED') {
      finalStatus = 'MODIFIED_BY_COMPANY';
    }

    const calculatedTotal = editingOrderItems.reduce((sum, item) => {
      const qty = item.approvedQuantity !== undefined ? item.approvedQuantity : item.requestedQuantity;
      return sum + (qty * item.unitPrice);
    }, 0);

    const updatedOrders = (state.nesyehPurchaseOrders || []).map(o => {
      if (o.id === selectedOrder.id) {
        return {
          ...o,
          items: editingOrderItems,
          totalAmount: calculatedTotal,
          adminNotes,
          status: finalStatus,
          updatedAt: new Date().toISOString()
        };
      }
      return o;
    });

    // Safely emit SMS event for order status change
    globalFinancialEventAdapter.emitNesyehOrderStatusChanged({
      orderNumber: selectedOrder.orderNumber,
      partnerName: selectedOrder.partnerName,
      oldStatus: selectedOrder.status,
      newStatus: finalStatus,
      totalAmount: calculatedTotal,
      customerPhone: selectedOrder.partnerPhone || '',
    });

    onUpdateState({
      ...state,
      nesyehPurchaseOrders: updatedOrders
    });

    setSelectedOrder(null);
  };

  // Convert approved Nesyeh purchase order into an official sales invoice
  const handleConvertToInvoice = async () => {
    if (!selectedOrder) return;

    if (selectedOrder.status === 'CONVERTED_TO_INVOICE' || selectedOrder.salesInvoiceId) {
      alert('این سفارش قبلاً به فاکتور رسمی فروش تبدیل شده است.');
      return;
    }

    // 1. Find partner and person
    const partner = (state.businessPartners || []).find(bp => bp.id === selectedOrder.partnerId || bp.personId === selectedOrder.partnerId);
    const person = (state.persons || []).find(p => p.id === partner?.personId || p.id === selectedOrder.partnerId || p.name === selectedOrder.partnerName);

    const targetPersonId = person?.id || partner?.personId || selectedOrder.partnerId;
    const personName = person?.name || selectedOrder.partnerName;

    // 2. Build invoice items
    const warehouseId = (state.warehouses && state.warehouses.length > 0) ? state.warehouses[0].id : 'wh_main';
    const invoiceItems: InvoiceItem[] = editingOrderItems.map(item => {
      const qty = item.approvedQuantity !== undefined ? item.approvedQuantity : item.requestedQuantity;
      const prod = (state.products || []).find(p => p.id === item.productId);
      
      let costPrice = prod?.initialUnitCost || 0;
      if (costPrice === 0) {
        costPrice = Math.round(item.unitPrice * 0.85); // fallback cost estimate
      }

      return {
        productId: item.productId,
        quantity: qty,
        unitPrice: item.unitPrice,
        discount: 0,
        warehouseId: warehouseId,
        costPrice: costPrice,
        totalCostPrice: costPrice * qty
      };
    });

    const totalCalculatedAmount = invoiceItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

    // Call atomic server endpoint via InvoiceService
    let serverResult;
    try {
      serverResult = await InvoiceService.createInvoice({
        type: 'sell',
        personId: targetPersonId,
        personName: personName,
        date: getCurrentJalaliDate(),
        dateJalali: getCurrentJalaliDate(),
        isProInvoice: false,
        discount: 0,
        taxPercent: 0,
        description: `فاکتور فروش رسمی نسیه صادر شده بابت سفارش شماره ${selectedOrder.orderNumber} - نماینده: ${selectedOrder.partnerName}`,
        items: invoiceItems.map(it => ({
          productId: it.productId,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          discount: it.discount || 0,
          warehouseId: it.warehouseId,
          costPrice: it.costPrice,
          totalCostPrice: it.totalCostPrice
        }))
      });
    } catch (err: any) {
      const norm = InvoiceService.normalizeError(err);
      alert(`❌ خطا در صدور فاکتور رسمی نسیه:\n${norm.message}`);
      return;
    }

    // 3. Create real Invoice object with authoritative server IDs
    const partnerRules = resolvePartnerCreditRules(targetPersonId, state.businessPartners || []);
    const newInvoice: Invoice = {
      id: serverResult.invoiceId,
      invoiceNumber: serverResult.invoiceNumber,
      type: 'sell',
      isProInvoice: false,
      isConverted: false,
      date: getCurrentJalaliDate(),
      personId: targetPersonId,
      items: invoiceItems,
      discount: 0,
      taxPercent: 0,
      description: `فاکتور فروش رسمی نسیه صادر شده بابت سفارش شماره ${selectedOrder.orderNumber} - نماینده: ${selectedOrder.partnerName}`,
      totalAmount: totalCalculatedAmount,
      paidAmount: 0, // deferred credit sale
      createdAt: new Date().toISOString(),
      voucherId: serverResult.journalVoucherId || undefined,
      creditRulesSnapshot: {
        maxCreditLimit: partnerRules.maxCreditLimit,
        defaultInstallmentDays: partnerRules.defaultInstallmentDays,
        penaltyRatePerMonth: partnerRules.penaltyRatePerMonth,
        snapshotCreatedAt: new Date().toISOString()
      }
    };

    // 4. Update order record
    const updatedOrders = (state.nesyehPurchaseOrders || []).map(o => {
      if (o.id === selectedOrder.id) {
        return {
          ...o,
          items: editingOrderItems,
          totalAmount: totalCalculatedAmount,
          adminNotes,
          status: 'CONVERTED_TO_INVOICE' as NesyehPurchaseOrderStatus,
          salesInvoiceId: serverResult.invoiceId,
          convertedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      return o;
    });

    // 5. Update state atomically (no parallel client-side voucher generation)
    onUpdateState({
      ...state,
      invoices: [...(state.invoices || []), newInvoice],
      nesyehPurchaseOrders: updatedOrders
    });

    setSelectedOrder(null);
    alert(`✅ سفارش نسیه شماره ${selectedOrder.orderNumber} با موفقیت به فاکتور فروش رسمی شماره ${serverResult.invoiceNumber} تبدیل شد و سند حسابداری در سرور صادر گردید.`);
  };

  // --- PAYMENT VERIFICATION & ACCOUNTING INTEGRATION (Phase 5.2) ---
  const filteredPayments = useMemo(() => {
    let list = state.nesyehPaymentDeclarations || [];
    if (paymentStatusFilter !== 'all') {
      list = list.filter(p => p.status === paymentStatusFilter);
    }
    if (searchPaymentsQuery.trim()) {
      const q = searchPaymentsQuery.toLowerCase().trim();
      list = list.filter(p => 
        p.declarationNumber.toLowerCase().includes(q) ||
        p.partnerName.toLowerCase().includes(q) ||
        (p.trackingNumber && p.trackingNumber.toLowerCase().includes(q)) ||
        (p.checkNumber && p.checkNumber.toLowerCase().includes(q)) ||
        (p.posTerminalNumber && p.posTerminalNumber.toLowerCase().includes(q))
      );
    }
    return list;
  }, [state.nesyehPaymentDeclarations, paymentStatusFilter, searchPaymentsQuery]);

  const handleApprovePayment = (declaration: NesyehPaymentDeclaration, customPosBankAmount?: number) => {
    const now = new Date().toISOString();
    const jalaliDate = getCurrentJalaliDate();

    // 1. Determine effective processed amount
    let processedAmount = declaration.amount;
    let isDiscrepancy = false;

    if (declaration.paymentType === 'POS' && customPosBankAmount !== undefined && customPosBankAmount !== declaration.amount) {
      processedAmount = customPosBankAmount;
      isDiscrepancy = true;
    }

    // 2. Find Partner Person in state
    const person = (state.persons || []).find(p => 
      p.id === declaration.partnerId || 
      p.representativeId === declaration.partnerId || 
      p.code === declaration.partnerId ||
      p.name.includes(declaration.partnerName)
    );

    // 3. Find Asset Account (Bank/Check) and Debtor Subsidiaries
    const assetSub = declaration.paymentType === 'CHECK'
      ? ((state.subsidiaries || []).find(s => s.code === '10201' || s.id.includes('CHECK') || s.name.includes('چک')) || (state.subsidiaries || []).find(s => s.code === '10101') || state.subsidiaries[0])
      : ((state.subsidiaries || []).find(s => s.code === '10101' || s.id.includes('BANK') || s.name.includes('بانک')) || state.subsidiaries[0]);

    const debtorsSub = (state.subsidiaries || []).find(s => s.code === '10301' || s.id.includes('DEBTORS') || s.name.includes('بدهکاران')) || state.subsidiaries[1] || assetSub;

    // 4. Generate standard double-entry voucher
    const nextVoucherNo = (state.vouchers?.length || 0) + 1001;
    const typeLabel = declaration.paymentType === 'POS' ? 'کارتخوان (POS)' : declaration.paymentType === 'BANK_TRANSFER' ? 'واریز بانکی' : 'چک صیادی';
    const baseDesc = `دریافت وجه از نماینده فروش ${declaration.partnerName} بابت اعلام پرداخت ${declaration.declarationNumber} (${typeLabel})`;

    const voucher: JournalVoucher = {
      id: `VOUCHER_NPD_${Date.now()}`,
      voucherNumber: nextVoucherNo,
      date: jalaliDate,
      description: isDiscrepancy 
        ? `${baseDesc} - مغایرت کارتخوان: اعلامی ${declaration.amount.toLocaleString('fa-IR')}، واریزی واقعی بانک ${processedAmount.toLocaleString('fa-IR')}`
        : baseDesc,
      entries: [
        {
          subsidiaryId: assetSub ? assetSub.id : (declaration.paymentType === 'CHECK' ? '10201' : '10101'),
          debit: processedAmount,
          credit: 0,
          description: `بدهکار: ${declaration.paymentType === 'CHECK' ? 'اسناد دریافتنی (چک دریافتی)' : 'بانک / حساب واریزی'} - ${declaration.partnerName}`
        },
        {
          subsidiaryId: debtorsSub ? debtorsSub.id : '10301',
          debit: 0,
          credit: processedAmount,
          description: `بستانکار: کاهش بدهی نماینده فروش ${declaration.partnerName}`,
          floatingDetailed: person ? {
            type: 'person',
            id: person.id,
            name: person.name
          } : undefined
        }
      ],
      isAutomatic: true,
      sourceType: 'cash_transaction',
      gregorianDate: new Date().toISOString(),
      sourceId: declaration.id,
      
    };

    // 5. If CHECK, create check entry in state.checks
    let newCheckEntry: CheckType | undefined = undefined;
    if (declaration.paymentType === 'CHECK') {
      newCheckEntry = {
        id: `CHK_NPD_${Date.now()}`,
        type: 'received',
        personId: person?.id || declaration.partnerId,
        amount: declaration.amount,
        dueDate: declaration.checkDueDate || jalaliDate,
        bankName: declaration.bankName || 'بانک صادرکننده چک',
        checkNumber: declaration.checkNumber || 'CHK-001',
        sayadiNumber: declaration.checkSayadId || '',
        currentState: 'present_in_cashbox',
        submittedByAgentId: declaration.partnerId,
        representativeId: declaration.partnerId,
        reviewStatus: 'approved' as any,
        createdAt: now,
        history: [
          {
            date: jalaliDate,
            state: 'present_in_cashbox',
            note: `تایید فیزیکی/سیستمی چک و صدور سند دریافت ${voucher.voucherNumber}`
          }
        ]
      };
    }

    // 6. Update declaration status
    const updatedDecl: NesyehPaymentDeclaration = {
      ...declaration,
      status: isDiscrepancy ? 'RECONCILED_WITH_DISCREPANCY' : 'VERIFIED',
      posBankMatchedAmount: processedAmount,
      discrepancyAmount: isDiscrepancy ? Math.abs(declaration.amount - processedAmount) : 0,
      discrepancyStatus: isDiscrepancy ? 'DISCREPANCY_PENDING' : 'MATCHED',
      voucherId: voucher.id,
      checkId: newCheckEntry?.id,
      verifiedAt: now,
      verifiedBy: 'مدیریت',
      adminNotes: paymentAdminNotes || (isDiscrepancy ? `تطبیق با صورتحساب بانک: واریزی بانک ${processedAmount.toLocaleString('fa-IR')} ریال` : 'تایید نهایی و صدور سند حسابداری'),
      updatedAt: now
    };

    const updatedDeclarations = (state.nesyehPaymentDeclarations || []).map(d => 
      d.id === declaration.id ? updatedDecl : d
    );

    const updatedVouchers = [voucher, ...(state.vouchers || [])];
    const updatedChecks = newCheckEntry ? [newCheckEntry, ...(state.checks || [])] : (state.checks || []);

    onUpdateState({
      ...state,
      nesyehPaymentDeclarations: updatedDeclarations,
      vouchers: updatedVouchers,
      checks: updatedChecks
    });

    // Safely emit SMS event for payment verification
    const partnerObj = (state.persons || []).find(p => p.id === declaration.partnerId);
    globalFinancialEventAdapter.emitNesyehPaymentVerified({
      declarationId: declaration.id,
      partnerName: declaration.partnerName,
      paymentType: declaration.paymentType,
      amount: processedAmount,
      receiptNo: declaration.trackingNumber,
      checkNo: declaration.checkNumber,
      customerPhone: partnerObj?.mobile || partnerObj?.phone || '',
    });

    setSelectedPayment(null);
    setPaymentAdminNotes('');
    alert(`✅ اعلام پرداخت ${declaration.declarationNumber} با موفقیت تایید شد. سند حسابداری شماره ${nextVoucherNo} به مبلغ ${processedAmount.toLocaleString('fa-IR')} ریال در دفاتر ثبت گردید.`);
  };

  const handleRejectPayment = (declaration: NesyehPaymentDeclaration) => {
    const now = new Date().toISOString();
    const updatedDecl: NesyehPaymentDeclaration = {
      ...declaration,
      status: 'REJECTED',
      verifiedAt: now,
      verifiedBy: 'مدیریت',
      adminNotes: paymentAdminNotes || 'اعلام پرداخت مورد تایید قرار نگرفت.',
      updatedAt: now
    };

    const updatedDeclarations = (state.nesyehPaymentDeclarations || []).map(d => 
      d.id === declaration.id ? updatedDecl : d
    );

    onUpdateState({
      ...state,
      nesyehPaymentDeclarations: updatedDeclarations
    });

    setSelectedPayment(null);
    setPaymentAdminNotes('');
    alert(`❌ اعلام پرداخت ${declaration.declarationNumber} رد شد. هیچ سند حسابداری یا تغییری در بدهی ثبت گردید.`);
  };

  return (
    <div className="space-y-6 font-sans" dir="rtl">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 p-6 rounded-2xl border border-teal-500/30 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-teal-500/20 text-teal-300 border border-teal-500/40 flex items-center justify-center shrink-0 shadow-lg">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black">مدیریت موجودی قابل سفارش و سفارشات نسیه</h2>
              <span className="bg-teal-500/20 text-teal-300 border border-teal-500/40 text-xs px-2.5 py-0.5 rounded-full font-bold">
                زیرسیستم مستقل
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              تنظیم ویترین کالاهای قابل سفارش و مدیریت چرخه بررسی سفارش‌های خریدهای نسیه نمایندگان
            </p>
          </div>
        </div>

        {/* Tab Toggle */}
        <div className="flex bg-slate-950/80 p-1 rounded-xl border border-slate-700/80">
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'catalog' 
                ? 'bg-teal-600 text-white shadow-md' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" />
            ویترین موجودی قابل سفارش ({catalogItems.length})
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'orders' 
                ? 'bg-teal-600 text-white shadow-md' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            بررسی سفارشات نسیه ({nesyehOrders.length})
          </button>

          <button
            onClick={() => setActiveTab('payments')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'payments' 
                ? 'bg-teal-600 text-white shadow-md' 
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            بررسی و تایید اعلام پرداخت‌ها ({(state.nesyehPaymentDeclarations || []).filter(d => d.status === 'PENDING').length})
          </button>
        </div>
      </div>

      {/* Disclaimers Guard Banner */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-3 text-xs text-amber-200">
        <Info className="w-5 h-5 text-amber-400 shrink-0" />
        <div>
          <span className="font-bold text-amber-300">اصول کلیدی ایزولاسیون انبار و حسابداری:</span>
          تعداد موجودی قابل سفارش در ویترین نسیه صرفاً ظرفیت اختصاصی نمایش سفارش به نماینده است و به هیچ عنوان باعث کسر یا رزرو موجودی واقعی انبار نمی‌شود. همچنین تایید سفارش‌ها در این بخش هیچ سند مالی یا فاکتور رسمی صادر نخواهد کرد.
        </div>
      </div>

      {/* TAB 1: CATALOG MANAGEMENT */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          
          <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-3" />
              <input
                type="text"
                placeholder="جستجوی کالا بر اساس کد، نام، برند یا دسته..."
                value={searchCatalogQuery}
                onChange={e => setSearchCatalogQuery(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 text-xs text-zinc-800 pr-9 pl-3 py-2.5 rounded-xl focus:outline-none focus:border-teal-500"
              />
            </div>

            <button
              onClick={() => {
                setEditingCatalogItem(null);
                setSelectedProductId('');
                setItemCashPrice(0);
                setItemNesyehPrice(0);
                setItemCapacity(100);
                setItemPriority(1);
                setItemBadge('NEW');
                setItemIsActive(true);
                setIsAddingCatalogItem(true);
              }}
              className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              افزودن کالا به ویترین سفارش نسیه
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            {filteredCatalogItems.length === 0 ? (
              <div className="text-center py-12 text-zinc-400 text-xs">
                هیچ کالایی در ویترین موجودی قابل سفارش نسیه قرار ندارد.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold">
                      <th className="py-3 px-3">برچسب / اولویت</th>
                      <th className="py-3 px-3">کد / نام کالا</th>
                      <th className="py-3 px-3">برند / دسته</th>
                      <th className="py-3 px-3">قیمت نقدی پایه</th>
                      <th className="py-3 px-3">قیمت پیشنهادی نسیه</th>
                      <th className="py-3 px-3">ظرفیت قابل سفارش</th>
                      <th className="py-3 px-3">وضعیت نمایش</th>
                      <th className="py-3 px-3 text-center">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredCatalogItems.map(item => (
                      <tr key={item.id} className="hover:bg-teal-50/20 transition-colors">
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-2">
                            {item.badge && (
                              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${
                                item.badge === 'NEW' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                item.badge === 'SPECIAL' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                item.badge === 'LIMITED' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                'bg-rose-50 text-rose-700 border-rose-200'
                              }`}>
                                {item.badge === 'NEW' ? 'جدید' : item.badge === 'SPECIAL' ? 'ویژه' : item.badge === 'LIMITED' ? 'محدود' : 'پیشنهاد'}
                              </span>
                            )}
                            <span className="text-[10px] font-mono text-zinc-400">اولویت: {item.priority}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="font-bold text-zinc-800">{item.name}</div>
                          <div className="text-[10px] text-teal-600 font-mono">{item.code}</div>
                        </td>

                        <td className="py-3.5 px-3 text-zinc-600">
                          {item.brand || '-'} / {item.category || '-'}
                        </td>

                        <td className="py-3.5 px-3 font-mono text-zinc-700">
                          {item.cashPrice.toLocaleString('fa-IR')} <span className="text-[10px] text-zinc-400 font-sans">ریال</span>
                        </td>

                        <td className="py-3.5 px-3 font-mono font-bold text-teal-700">
                          {item.suggestedNesyehPrice.toLocaleString('fa-IR')} <span className="text-[10px] text-zinc-400 font-sans">ریال</span>
                        </td>

                        <td className="py-3.5 px-3 font-mono font-bold text-amber-600">
                          {item.orderableCapacity} عدد
                        </td>

                        <td className="py-3.5 px-3">
                          <button
                            onClick={() => handleToggleCatalogActive(item.id)}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold border cursor-pointer transition-all ${
                              item.isActive 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' 
                                : 'bg-zinc-100 text-zinc-500 border-zinc-200 hover:bg-zinc-200'
                            }`}
                          >
                            {item.isActive ? 'فعال (در حال نمایش)' : 'غیرفعال (مخفی)'}
                          </button>
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => {
                                setEditingCatalogItem(item);
                                setSelectedProductId(item.productId);
                                setItemCashPrice(item.cashPrice);
                                setItemNesyehPrice(item.suggestedNesyehPrice);
                                setItemCapacity(item.orderableCapacity);
                                setItemPriority(item.priority);
                                setItemBadge(item.badge || '');
                                setItemIsActive(item.isActive);
                                setIsAddingCatalogItem(true);
                              }}
                              className="p-1.5 text-teal-600 hover:bg-teal-50 rounded-lg cursor-pointer"
                              title="ویرایش"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => handleDeleteCatalogItem(item.id)}
                              className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer"
                              title="حذف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
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

      {/* TAB 2: PURCHASE ORDERS MANAGEMENT */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          
          <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-3" />
              <input
                type="text"
                placeholder="جستجوی سفارش بر اساس شماره سفارش یا نام نماینده..."
                value={searchOrdersQuery}
                onChange={e => setSearchOrdersQuery(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 text-xs text-zinc-800 pr-9 pl-3 py-2.5 rounded-xl focus:outline-none focus:border-teal-500"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Filter className="w-4 h-4 text-zinc-400 shrink-0" />
              <select
                value={orderStatusFilter}
                onChange={e => setOrderStatusFilter(e.target.value)}
                className="bg-zinc-50 border border-zinc-200 text-xs text-zinc-800 px-3 py-2.5 rounded-xl focus:outline-none focus:border-teal-500 cursor-pointer font-medium"
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="SUBMITTED">ارسال شده (SUBMITTED)</option>
                <option value="UNDER_REVIEW">در حال بررسی (UNDER_REVIEW)</option>
                <option value="MODIFIED_BY_COMPANY">اصلاح‌شده توسط شرکت (MODIFIED_BY_COMPANY)</option>
                <option value="APPROVED">تایید شده (APPROVED)</option>
                <option value="CONVERTED_TO_INVOICE">تبدیل‌شده به فاکتور (CONVERTED_TO_INVOICE)</option>
                <option value="READY">آماده ارسال (READY)</option>
                <option value="SHIPPED">ارسال شده (SHIPPED)</option>
                <option value="DELIVERED">تحویل شده (DELIVERED)</option>
                <option value="REJECTED">رد شده (REJECTED)</option>
                <option value="CANCELLED">لغو شده (CANCELLED)</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            {filteredOrders.length === 0 ? (
              <div className="text-center py-12 text-zinc-400 text-xs">
                هیچ سفارشی جهت نمایش در این بخش یافت نشد.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold">
                      <th className="py-3 px-3">شماره سفارش</th>
                      <th className="py-3 px-3">نماینده / فروشگاه</th>
                      <th className="py-3 px-3">تاریخ ثبت</th>
                      <th className="py-3 px-3">مبلغ کل (ریال)</th>
                      <th className="py-3 px-3">تعداد اقلام</th>
                      <th className="py-3 px-3">وضعیت سفارش</th>
                      <th className="py-3 px-3 text-center">عملیات بررسی</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredOrders.map(order => (
                      <tr key={order.id} className="hover:bg-teal-50/20 transition-colors">
                        <td className="py-3.5 px-3 font-mono font-bold text-teal-700">
                          {order.orderNumber}
                        </td>

                        <td className="py-3.5 px-3">
                          <div className="font-bold text-zinc-800">{order.partnerName}</div>
                          <div className="text-[10px] text-zinc-500">{order.storeName || '-'}</div>
                        </td>

                        <td className="py-3.5 px-3 text-zinc-600 font-mono">
                          {new Date(order.orderDate || order.createdAt).toLocaleDateString('fa-IR')}
                        </td>

                        <td className="py-3.5 px-3 font-mono font-bold text-teal-800">
                          {order.totalAmount.toLocaleString('fa-IR')} <span className="text-[10px] text-zinc-400 font-sans">ریال</span>
                        </td>

                        <td className="py-3.5 px-3 text-zinc-700 font-mono">
                          {order.items.length} کالا
                        </td>

                        <td className="py-3.5 px-3">
                          <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border ${
                            order.status === 'CONVERTED_TO_INVOICE' ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm' :
                            order.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            order.status === 'MODIFIED_BY_COMPANY' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                            order.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                            order.status === 'CANCELLED' ? 'bg-slate-100 text-slate-600 border-slate-300' :
                            order.status === 'UNDER_REVIEW' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            order.status === 'READY' ? 'bg-teal-50 text-teal-700 border-teal-200' :
                            order.status === 'SHIPPED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            order.status === 'DELIVERED' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                            'bg-zinc-100 text-zinc-700 border-zinc-200'
                          }`}>
                            {order.status === 'CONVERTED_TO_INVOICE' ? 'تبدیل‌شده به فاکتور' :
                             order.status === 'APPROVED' ? 'تایید شده' :
                             order.status === 'MODIFIED_BY_COMPANY' ? 'اصلاح شده توسط شرکت' :
                             order.status === 'REJECTED' ? 'رد شده' :
                             order.status === 'CANCELLED' ? 'لغو شده' :
                             order.status === 'UNDER_REVIEW' ? 'در حال بررسی' :
                             order.status === 'READY' ? 'آماده ارسال' :
                             order.status === 'SHIPPED' ? 'ارسال شده' :
                             order.status === 'DELIVERED' ? 'تحویل شده' :
                             'ارسال شده'}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          <button
                            onClick={() => handleOpenOrder(order)}
                            className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            بررسی و تغییر وضعیت
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

      {/* TAB 3: PAYMENTS & SETTLEMENTS VERIFICATION (Phase 5.2) */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm">
              <div className="flex items-center justify-between text-zinc-500 text-xs font-semibold mb-2">
                <span>اعلام‌های در انتظار بررسی</span>
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-xl font-bold text-amber-600 font-mono">
                {filteredPayments
                  .filter(p => p.status === 'PENDING')
                  .reduce((sum, p) => sum + p.amount, 0)
                  .toLocaleString('fa-IR')} <span className="text-xs text-zinc-400 font-sans">ریال</span>
              </div>
              <div className="text-[11px] text-zinc-400 mt-1">
                {filteredPayments.filter(p => p.status === 'PENDING').length} اعلام پرداخت جدید
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm">
              <div className="flex items-center justify-between text-zinc-500 text-xs font-semibold mb-2">
                <span>اعلام‌های تاییدشده (اعمال دفتری)</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-xl font-bold text-emerald-600 font-mono">
                {filteredPayments
                  .filter(p => p.status === 'VERIFIED' || p.status === 'RECONCILED_WITH_DISCREPANCY')
                  .reduce((sum, p) => sum + (p.posBankMatchedAmount || p.amount), 0)
                  .toLocaleString('fa-IR')} <span className="text-xs text-zinc-400 font-sans">ریال</span>
              </div>
              <div className="text-[11px] text-zinc-400 mt-1">
                {filteredPayments.filter(p => p.status === 'VERIFIED' || p.status === 'RECONCILED_WITH_DISCREPANCY').length} مورد تایید و دارای سند حسابداری
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm">
              <div className="flex items-center justify-between text-zinc-500 text-xs font-semibold mb-2">
                <span>مغایرت‌های کنترل کارتخوان</span>
                <AlertCircle className="w-4 h-4 text-purple-500" />
              </div>
              <div className="text-xl font-bold text-purple-600 font-mono">
                {filteredPayments
                  .filter(p => p.status === 'RECONCILED_WITH_DISCREPANCY')
                  .reduce((sum, p) => sum + (p.discrepancyAmount || 0), 0)
                  .toLocaleString('fa-IR')} <span className="text-xs text-zinc-400 font-sans">ریال</span>
              </div>
              <div className="text-[11px] text-zinc-400 mt-1">
                {filteredPayments.filter(p => p.status === 'RECONCILED_WITH_DISCREPANCY').length} اعلام دارای مغایرت واریزی بانک
              </div>
            </div>
          </div>

          {/* Search & Filter bar */}
          <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-3" />
              <input
                type="text"
                placeholder="جستجو با شماره اعلام، نام نماینده، کد پیگیری یا شماره چک..."
                value={searchPaymentsQuery}
                onChange={e => setSearchPaymentsQuery(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 text-xs text-zinc-800 pr-9 pl-3 py-2.5 rounded-xl focus:outline-none focus:border-teal-500"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Filter className="w-4 h-4 text-zinc-400 shrink-0" />
              <select
                value={paymentStatusFilter}
                onChange={e => setPaymentStatusFilter(e.target.value)}
                className="bg-zinc-50 border border-zinc-200 text-xs text-zinc-800 px-3 py-2.5 rounded-xl focus:outline-none focus:border-teal-500 cursor-pointer font-medium"
              >
                <option value="all">همه وضعیت‌ها</option>
                <option value="PENDING">در انتظار بررسی (PENDING)</option>
                <option value="VERIFIED">تایید شده (VERIFIED)</option>
                <option value="RECONCILED_WITH_DISCREPANCY">مغایرت‌دار در کنترل کارتخوان</option>
                <option value="REJECTED">رد شده (REJECTED)</option>
              </select>
            </div>
          </div>

          {/* Payments Table */}
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            {filteredPayments.length === 0 ? (
              <div className="text-center py-12 text-zinc-400 text-xs">
                هیچ اعلام پرداختی جهت نمایش در این بخش یافت نشد.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold">
                      <th className="py-3 px-3">شماره اعلام</th>
                      <th className="py-3 px-3">نام نماینده / فروشگاه</th>
                      <th className="py-3 px-3">روش پرداخت</th>
                      <th className="py-3 px-3">مبلغ اعلامی (ریال)</th>
                      <th className="py-3 px-3">تاریخ اعلام / واریز</th>
                      <th className="py-3 px-3">اطلاعات تراکنش</th>
                      <th className="py-3 px-3">وضعیت بررسی</th>
                      <th className="py-3 px-3 text-center">عملیات بررسی</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {filteredPayments.map(decl => (
                      <tr key={decl.id} className="hover:bg-teal-50/20 transition-colors">
                        <td className="py-3.5 px-3 font-mono font-bold text-teal-700">
                          {decl.declarationNumber}
                        </td>

                        <td className="py-3.5 px-3 font-bold text-zinc-800">
                          {decl.partnerName}
                        </td>

                        <td className="py-3.5 px-3">
                          <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border ${
                            decl.paymentType === 'POS' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                            decl.paymentType === 'BANK_TRANSFER' ? 'bg-teal-50 text-teal-700 border-teal-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {decl.paymentType === 'POS' ? 'کارتخوان (POS)' :
                             decl.paymentType === 'BANK_TRANSFER' ? 'واریز بانکی' : 'چک'}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 font-mono font-bold text-teal-800">
                          {decl.amount.toLocaleString('fa-IR')} <span className="text-[10px] text-zinc-400 font-sans">ریال</span>
                        </td>

                        <td className="py-3.5 px-3 text-zinc-600 font-mono">
                          {decl.paymentDate}
                        </td>

                        <td className="py-3.5 px-3 text-zinc-600 text-[11px]">
                          {decl.paymentType === 'POS' && (
                            <span>پایانه: <strong className="font-mono text-zinc-800">{decl.posTerminalNumber || 'نامشخص'}</strong></span>
                          )}
                          {decl.paymentType === 'BANK_TRANSFER' && (
                            <span>بانک: {decl.bankName || '-'} | پیگیری: <strong className="font-mono text-zinc-800">{decl.trackingNumber || '-'}</strong></span>
                          )}
                          {decl.paymentType === 'CHECK' && (
                            <span>چک: <strong className="font-mono text-zinc-800">{decl.checkNumber || '-'}</strong> | سررسید: <span className="font-mono">{decl.checkDueDate || '-'}</span></span>
                          )}
                        </td>

                        <td className="py-3.5 px-3">
                          <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border ${
                            decl.status === 'VERIFIED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            decl.status === 'RECONCILED_WITH_DISCREPANCY' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                            decl.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                          }`}>
                            {decl.status === 'VERIFIED' ? 'تاییدشده (سند صادرشد)' :
                             decl.status === 'RECONCILED_WITH_DISCREPANCY' ? 'مغایرت‌دار کارتخوان' :
                             decl.status === 'REJECTED' ? 'رد شده' : 'در انتظار بررسی'}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-center">
                          <button
                            onClick={() => {
                              setSelectedPayment(decl);
                              setPaymentAdminNotes(decl.adminNotes || '');
                              setPosBankMatchedAmount(decl.posBankMatchedAmount || decl.amount);
                            }}
                            className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            بررسی و تطبیق مالی
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

      {/* MODAL: VERIFY AND RECONCILE PAYMENT DECLARATION */}
      {selectedPayment && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-zinc-200 text-right space-y-4 max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-teal-600" />
                بررسی و تطبیق مالی اعلام پرداخت {selectedPayment.declarationNumber}
              </h3>
              <button
                onClick={() => setSelectedPayment(null)}
                className="text-zinc-400 hover:text-zinc-600 text-xs cursor-pointer font-bold"
              >
                بستن ×
              </button>
            </div>

            {/* Declaration Details */}
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-xs space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-zinc-400">نام نماینده:</span>
                  <div className="font-bold text-zinc-800 mt-0.5">{selectedPayment.partnerName}</div>
                </div>
                <div>
                  <span className="text-zinc-400">روش پرداخت:</span>
                  <div className="font-bold text-teal-700 mt-0.5">
                    {selectedPayment.paymentType === 'POS' ? 'دستگاه کارتخوان (POS)' :
                     selectedPayment.paymentType === 'BANK_TRANSFER' ? 'واریز مستقیم بانکی' : 'چک بانکی'}
                  </div>
                </div>
                <div>
                  <span className="text-zinc-400">مبلغ اعلامی نماینده:</span>
                  <div className="font-bold text-emerald-700 font-mono text-sm mt-0.5">
                    {selectedPayment.amount.toLocaleString('fa-IR')} ریال
                  </div>
                </div>
                <div>
                  <span className="text-zinc-400">تاریخ اعلام / واریز:</span>
                  <div className="font-mono font-bold text-zinc-700 mt-0.5">{selectedPayment.paymentDate}</div>
                </div>
              </div>

              {/* Specific info depending on type */}
              {selectedPayment.paymentType === 'POS' && (
                <div className="border-t border-zinc-200 pt-3 space-y-2">
                  <div className="text-zinc-500 font-semibold flex items-center gap-1">
                    <Receipt className="w-3.5 h-3.5 text-indigo-600" />
                    مشخصات تراکنش کارتخوان:
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-zinc-700">
                    <div>شماره پایانه (Terminal ID): <strong className="font-mono">{selectedPayment.posTerminalNumber || 'ثبت نشده'}</strong></div>
                    <div>تاریخ جمع‌بندی: <strong className="font-mono">{selectedPayment.posBatchSummaryDate || selectedPayment.paymentDate}</strong></div>
                  </div>

                  {/* POS Bank Statement Reconciliation Box */}
                  <div className="bg-indigo-50/80 border border-indigo-200 rounded-xl p-3 mt-3 space-y-2">
                    <label className="block font-bold text-indigo-900 text-[11px]">
                      کنترل و تطبیق صورتحساب بانک بابت کارکرد کارتخوان:
                    </label>
                    <p className="text-[11px] text-indigo-700 leading-relaxed">
                      در صورتی که مبلغ واریز شده توسط بانک به حساب شرکت متفاوت از جمع اعلامی نماینده است، مبلغ واقعی صورتحساب بانک را در زیر وارد کنید. سند حسابداری دقیقا به میزان واریزی بانک صادر می‌شود.
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs font-bold text-zinc-700 whitespace-nowrap">مبلغ واریزی بانک (ریال):</span>
                      <input
                        type="number"
                        value={posBankMatchedAmount || ''}
                        onChange={e => setPosBankMatchedAmount(Number(e.target.value))}
                        className="w-full bg-white border border-indigo-300 rounded-lg px-3 py-1.5 font-mono text-xs font-bold text-indigo-900 focus:outline-none focus:border-indigo-600"
                      />
                    </div>
                    {posBankMatchedAmount !== selectedPayment.amount && posBankMatchedAmount > 0 && (
                      <div className="text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2 flex items-center justify-between">
                        <span>مغایرت محاسبه‌شده:</span>
                        <span className="font-mono">
                          {Math.abs(selectedPayment.amount - posBankMatchedAmount).toLocaleString('fa-IR')} ریال
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedPayment.paymentType === 'BANK_TRANSFER' && (
                <div className="border-t border-zinc-200 pt-3 space-y-2">
                  <div className="text-zinc-500 font-semibold">مشخصات واریز بانکی:</div>
                  <div className="grid grid-cols-2 gap-2 text-zinc-700">
                    <div>بانک مقصد: <strong>{selectedPayment.bankName || '-'}</strong></div>
                    <div>شماره پیگیری: <strong className="font-mono">{selectedPayment.trackingNumber || '-'}</strong></div>
                  </div>
                  {selectedPayment.receiptImage && (
                    <div className="pt-1">
                      <a 
                        href={selectedPayment.receiptImage} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-teal-600 underline font-bold hover:text-teal-800 text-[11px] inline-flex items-center gap-1"
                      >
                        مشاهده تصویر رسید واریزی
                      </a>
                    </div>
                  )}
                </div>
              )}

              {selectedPayment.paymentType === 'CHECK' && (
                <div className="border-t border-zinc-200 pt-3 space-y-2">
                  <div className="text-zinc-500 font-semibold">مشخصات چک دریافتی:</div>
                  <div className="grid grid-cols-2 gap-2 text-zinc-700">
                    <div>شماره چک: <strong className="font-mono">{selectedPayment.checkNumber || '-'}</strong></div>
                    <div>سررسید چک: <strong className="font-mono">{selectedPayment.checkDueDate || '-'}</strong></div>
                    <div>شناسه صیادی: <strong className="font-mono">{selectedPayment.checkSayadId || '-'}</strong></div>
                  </div>
                  {selectedPayment.checkImage && (
                    <div className="pt-1">
                      <a 
                        href={selectedPayment.checkImage} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-teal-600 underline font-bold hover:text-teal-800 text-[11px] inline-flex items-center gap-1"
                      >
                        مشاهده تصویر برگه چک
                      </a>
                    </div>
                  )}
                </div>
              )}

              {selectedPayment.partnerNotes && (
                <div className="border-t border-zinc-200 pt-2 text-zinc-600">
                  <span className="font-bold">یادداشت نماینده:</span> {selectedPayment.partnerNotes}
                </div>
              )}
            </div>

            {/* Admin Notes */}
            <div>
              <label className="block text-xs font-bold text-zinc-700 mb-1">یادداشت / دستور مدیریت اداری و مالی:</label>
              <textarea
                rows={2}
                value={paymentAdminNotes}
                onChange={e => setPaymentAdminNotes(e.target.value)}
                placeholder="توضیحات بابت تایید، مغایرت یا علت رد اعلام پرداخت..."
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-2.5 text-xs text-zinc-800 focus:outline-none focus:border-teal-500"
              />
            </div>

            {/* Verification Actions */}
            <div className="flex items-center gap-2 pt-3 border-t border-zinc-100">
              <button
                onClick={() => handleApprovePayment(selectedPayment, selectedPayment.paymentType === 'POS' ? posBankMatchedAmount : undefined)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                تایید نهایی و صدور سند حسابداری
              </button>

              <button
                onClick={() => handleRejectPayment(selectedPayment)}
                className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors cursor-pointer flex items-center gap-1"
              >
                <X className="w-4 h-4" />
                رد اعلام پرداخت
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT CATALOG ITEM */}
      {isAddingCatalogItem && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-zinc-200 text-right space-y-4">
            
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                <Package className="w-4 h-4 text-teal-600" />
                {editingCatalogItem ? 'ویرایش کالای ویترین نسیه' : 'افزودن کالا به ویترین قابل سفارش نسیه'}
              </h3>
              <button
                onClick={() => setIsAddingCatalogItem(false)}
                className="text-zinc-400 hover:text-zinc-600 text-xs cursor-pointer font-bold"
              >
                بستن ×
              </button>
            </div>

            <form onSubmit={handleSaveCatalogItem} className="space-y-4 text-xs">
              
              {!editingCatalogItem && (
                <div>
                  <label className="block font-bold text-zinc-700 mb-1">انتخاب کالا از لیست محصولات اصلی:</label>
                  <select
                    value={selectedProductId}
                    onChange={e => handleSelectProduct(e.target.value)}
                    required
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-zinc-800 font-bold focus:outline-none focus:border-teal-500 cursor-pointer"
                  >
                    <option value="">-- انتخاب محصول --</option>
                    {baseProducts.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.code} - {p.name} ({p.brand || 'بدون برند'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-700 mb-1">قیمت نقدی پایه (ریال):</label>
                  <input
                    type="number"
                    value={itemCashPrice}
                    onChange={e => setItemCashPrice(Number(e.target.value))}
                    required
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-zinc-800 font-mono focus:outline-none focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-zinc-700 mb-1">قیمت پیشنهادی نسیه (ریال):</label>
                  <input
                    type="number"
                    value={itemNesyehPrice}
                    onChange={e => setItemNesyehPrice(Number(e.target.value))}
                    required
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-zinc-800 font-mono font-bold focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-700 mb-1">تعداد قابل سفارش (ظرفیت نمایش):</label>
                  <input
                    type="number"
                    value={itemCapacity}
                    onChange={e => setItemCapacity(Number(e.target.value))}
                    required
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-zinc-800 font-mono focus:outline-none focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-zinc-700 mb-1">اولویت نمایش (عدد کمتر = بالاتر):</label>
                  <input
                    type="number"
                    value={itemPriority}
                    onChange={e => setItemPriority(Number(e.target.value))}
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-zinc-800 font-mono focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-700 mb-1">برچسب کالا:</label>
                  <select
                    value={itemBadge}
                    onChange={e => setItemBadge(e.target.value as any)}
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:border-teal-500 cursor-pointer"
                  >
                    <option value="">بدون برچسب</option>
                    <option value="NEW">جدید (NEW)</option>
                    <option value="SPECIAL">ویژه (SPECIAL)</option>
                    <option value="LIMITED">محدود (LIMITED)</option>
                    <option value="OFFER">پیشنهاد (OFFER)</option>
                  </select>
                </div>

                <div className="flex items-center pt-5">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={itemIsActive}
                      onChange={e => setItemIsActive(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                    <span className="mr-3 font-bold text-zinc-700">نمایش فعال در ویترین</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setIsAddingCatalogItem(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  ذخیره کالا در ویترین
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* MODAL: REVIEW ORDER */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-zinc-200 text-right space-y-4 max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-teal-600" />
                  بررسی سفارش نسیه: <span className="font-mono text-teal-700">{selectedOrder.orderNumber}</span>
                </h3>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  ثبت‌شده توسط: <span className="font-bold text-zinc-700">{selectedOrder.partnerName}</span> ({selectedOrder.storeName || 'فروشگاه'})
                </p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-zinc-400 hover:text-zinc-600 text-xs cursor-pointer font-bold"
              >
                بستن ×
              </button>
            </div>

            {/* Disclaimer or Converted Info Banner in Modal */}
            {selectedOrder.status === 'CONVERTED_TO_INVOICE' || selectedOrder.salesInvoiceId ? (
              <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3.5 text-xs text-emerald-900 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>این سفارش به فاکتور رسمی فروش تبدیل شده است (شناسه فاکتور: <span className="font-mono text-emerald-800 font-extrabold">{selectedOrder.salesInvoiceId}</span>).</span>
                </div>
                <span className="text-[10px] bg-emerald-600 text-white font-extrabold px-3 py-1 rounded-lg">
                  ثبت رسمی حسابداری
                </span>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0" />
                تایید یا ویرایش اقلام این سفارش صرفاً بررسی درخواستی نماینده است و تا زمان کلیک بر روی «تبدیل به فاکتور فروش رسمی»، هیچ سند حسابداری صادر نمی‌شود و هیچ موجودی انبار کسر نمی‌گردد.
              </div>
            )}

            {/* Convertible to Official Invoice Callout */}
            {selectedOrder.status !== 'CONVERTED_TO_INVOICE' && 
             ['APPROVED', 'MODIFIED_BY_COMPANY', 'READY', 'SHIPPED', 'DELIVERED'].includes(selectedOrder.status) && (
              <div className="bg-gradient-to-r from-emerald-900 to-teal-900 text-white p-3.5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg border border-emerald-500/30">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <div>
                    <h5 className="text-xs font-extrabold text-white">صدور فاکتور رسمی فروش نسیه</h5>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      این سفارش تایید گردیده است. با کلیک بر روی کلید زیر، فاکتور رسمی فروش صادر و سند حسابداری خودکار در دفاتر ثبت می‌شود.
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleConvertToInvoice}
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-4 py-2.5 rounded-xl text-xs transition-all shadow-md flex items-center gap-2 cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <Receipt className="w-4 h-4" />
                  تبدیل به فاکتور فروش رسمی
                </button>
              </div>
            )}

            {/* Items Table */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-zinc-700">اقلام درخواستی سفارش:</h4>
              <div className="border border-zinc-200 rounded-xl overflow-hidden">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold">
                      <th className="py-2.5 px-3">کالای درخواستی</th>
                      <th className="py-2.5 px-3">تعداد درخواستی</th>
                      <th className="py-2.5 px-3">تعداد تاییدشده</th>
                      <th className="py-2.5 px-3">فی نسیه (ریال)</th>
                      <th className="py-2.5 px-3">مبلغ کل (ریال)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {editingOrderItems.map(item => {
                      const qty = item.approvedQuantity !== undefined ? item.approvedQuantity : item.requestedQuantity;
                      return (
                        <tr key={item.id} className="hover:bg-zinc-50">
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-zinc-800">{item.productName}</div>
                            <div className="text-[10px] text-teal-600 font-mono">{item.productCode}</div>
                          </td>

                          <td className="py-2.5 px-3 font-mono text-zinc-600">
                            {item.requestedQuantity} عدد
                          </td>

                          <td className="py-2.5 px-3">
                            <input
                              type="number"
                              min="0"
                              value={qty}
                              onChange={e => handleItemQuantityChange(item.id, Number(e.target.value))}
                              className="w-20 bg-zinc-50 border border-zinc-300 rounded-lg px-2 py-1 text-xs font-mono font-bold text-zinc-800 focus:outline-none focus:border-teal-500"
                            />
                          </td>

                          <td className="py-2.5 px-3 font-mono text-zinc-700">
                            {item.unitPrice.toLocaleString('fa-IR')}
                          </td>

                          <td className="py-2.5 px-3 font-mono font-bold text-teal-700">
                            {(qty * item.unitPrice).toLocaleString('fa-IR')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Notes Section */}
            <div className="space-y-3 text-xs">
              {selectedOrder.partnerNotes && (
                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                  <span className="font-bold text-zinc-700 block mb-1">توضیحات نماینده:</span>
                  <p className="text-zinc-600">{selectedOrder.partnerNotes}</p>
                </div>
              )}

              <div>
                <label className="block font-bold text-zinc-700 mb-1">توضیحات و پاسخ شرکت برای نماینده:</label>
                <textarea
                  rows={2}
                  value={adminNotes}
                  onChange={e => setAdminNotes(e.target.value)}
                  placeholder="توضیحات تکمیلی تایید یا اصلاح سفارش..."
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-xl p-2.5 text-zinc-800 focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-zinc-100 text-xs">
              <div className="flex gap-2">
                <button
                  onClick={() => handleUpdateOrderStatus('REJECTED')}
                  className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold cursor-pointer flex items-center gap-1"
                >
                  <X className="w-4 h-4" />
                  رد سفارش
                </button>

                <button
                  onClick={() => handleUpdateOrderStatus('UNDER_REVIEW')}
                  className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 font-bold cursor-pointer flex items-center gap-1"
                >
                  <Clock className="w-4 h-4" />
                  در حال بررسی
                </button>
              </div>

              <div className="flex gap-2">
                {selectedOrder.status === 'APPROVED' || selectedOrder.status === 'MODIFIED_BY_COMPANY' ? (
                  <>
                    <button
                      onClick={() => handleUpdateOrderStatus('READY')}
                      className="px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold cursor-pointer flex items-center gap-1 shadow-md"
                    >
                      <Check className="w-4 h-4" />
                      تغییر به وضعیت: آماده ارسال
                    </button>
                    <button
                      onClick={() => handleUpdateOrderStatus('SHIPPED')}
                      className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer flex items-center gap-1 shadow-md"
                    >
                      <Truck className="w-4 h-4" />
                      تغییر به وضعیت: ارسال شده
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleUpdateOrderStatus('APPROVED')}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer flex items-center gap-1.5 shadow-md"
                  >
                    <CheckCheck className="w-4 h-4" />
                    تایید سفارش و ابلاغ به نماینده
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* [FUTURE INTEGRATION POINT / مسیرهای اتصال آینده]: */}
      {/* 
        1. [FUTURE INTEGRATION POINT]: تبدیل سفارش تاییدشده به فاکتور فروش واقعی (Conversion of NesyehPurchaseOrder to real sales Invoice)
        2. [FUTURE INTEGRATION POINT]: کنترل خودکار سقف خرید نسیه هنگام ثبت سفارش (Automatic credit limit validation)
        3. [FUTURE INTEGRATION POINT]: سیستم اطلاع‌رسانی پیامکی تغییر وضعیت سفارش (SMS alert on order status changes)
        4. [FUTURE INTEGRATION POINT]: گزارش‌های تحلیلی عملکرد و حجم خریدهای نماینده (Performance analytics)
        5. [FUTURE INTEGRATION POINT]: شبکه ویزیتورها جهت پیگیری تحویل کالای نسیه (Visitor network tracking)
      */}

    </div>
  );
}

export default NesyehInventoryAndOrdersManager;
