/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { Plus, Trash2, Save, FileText, ShoppingBag, ShoppingCart, HelpCircle, ArrowLeft, RefreshCw, X, Calculator, TrendingUp, AlertCircle, Sparkles, Search, QrCode, ShieldCheck } from 'lucide-react';
import BarcodeScanner from './BarcodeScanner';
import { Person, Product, Invoice, InvoiceItem, AppState, Check, User, CriticalDetails } from '../types';
import { getCurrentJalaliDate, normalizeJalaliDate, validateJalaliDate } from '../utils/jalali';
import { getPreviousPurchasePrice, parseNumericValue, toEnglishDigits, validateSerialNumbers, checkCreditLimit, getFilteredPersonsForSell, calculatePersonBalances, resolveInvoiceVoucher } from '../utils/accounting';
import { resolvePartnerCreditRules } from '../utils/partnerProcess';
import PersonSelector from './PersonSelector';
import ProductSelector from './ProductSelector';
import CheckSettlementCalculator from './CheckSettlementCalculator';
import SerialNumbersModal from './SerialNumbersModal';
import CriticalStatusPanel from './CriticalStatusPanel';

interface InvoiceFormProps {
  persons: Person[];
  products: Product[];
  productCategories: string[];
  currentStocks: Record<string, number>;
  onAddCategory?: (category: string) => void;
  onSubmit: (
    invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'isConverted' | 'voucherId'>, 
    cheques?: Omit<Check, 'id' | 'currentState' | 'history' | 'createdAt'>[], 
    settlementCommission?: number,
    criticalDetails?: Omit<CriticalDetails, 'updatedAt'>
  ) => void;
  onCancel: () => void;
  initialInvoice?: Invoice; // If editing or converting
  mode?: 'create' | 'view';
  onConvertToReal?: (invoiceId: string) => void; // Converts pro-invoice to real
  onUpdate?: (updatedInvoice: Invoice) => void;
  onDelete?: (invoiceId: string) => void;
  allInvoices?: Invoice[];
  operatingCostRate?: number;
  vouchers?: any[];
  appState: AppState;
  onNew?: (type: 'buy' | 'sell') => void;
  currentUser?: User | null;
  onOpenAdvancedSearch?: () => void;
  initialType?: 'buy' | 'sell';
}

export default function InvoiceForm({
  persons,
  products,
  productCategories,
  currentStocks,
  onAddCategory,
  onSubmit,
  onCancel,
  initialInvoice,
  mode = 'create',
  onConvertToReal,
  onUpdate,
  onDelete,
  allInvoices = [],
  operatingCostRate,
  vouchers = [],
  appState,
  onNew,
  currentUser,
  onOpenAdvancedSearch,
  initialType
}: InvoiceFormProps) {
  const [isEditing, setIsEditing] = useState(mode === 'create' || (initialInvoice && mode === 'view'));
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const isViewModeActive = mode === 'view' && !isEditing;
  const [type, setType] = useState<'buy' | 'sell'>(initialInvoice?.type || initialType || 'sell');

  // Warehouse restriction
  const allowedWarehouses = useMemo(() => {
    if (!currentUser || currentUser.role === 'admin') return appState.warehouses;
    return appState.warehouses.filter(w => currentUser.allowedWarehouseIds.includes(w.id));
  }, [appState.warehouses, currentUser]);

  const defaultWarehouseId = useMemo(() => {
    if (initialInvoice) return initialInvoice.items[0]?.warehouseId || '';
    
    // Check for "انبار مرکزی" specifically for purchase invoices
    if (type === 'buy') {
      const centralWarehouse = appState.warehouses.find(w => 
        w.name.trim() === 'انبار مرکزی' || 
        w.name.trim().includes('انبار مرکزی') ||
        w.id === 'w1' // Common default ID
      );
      if (centralWarehouse) return centralWarehouse.id;
      
      // Fallback to first available warehouse if buy and central not found
      if (allowedWarehouses.length > 0) return allowedWarehouses[0].id;
    }

    return currentUser?.defaultWarehouseId || appState.settings.defaultWarehouseId || (allowedWarehouses.length > 0 ? allowedWarehouses[0].id : '');
  }, [initialInvoice, currentUser, appState.settings.defaultWarehouseId, type, appState.warehouses, allowedWarehouses]);
  const [isProInvoice, setIsProInvoice] = useState<boolean>(initialInvoice?.isProInvoice || false);
  const [personId, setPersonId] = useState<string>(initialInvoice?.personId || '');
  const [date, setDate] = useState<string>(initialInvoice?.date || getCurrentJalaliDate());
  const [discount, setDiscount] = useState<number>(initialInvoice?.discount || 0);
  const [taxPercent, setTaxPercent] = useState<number>(initialInvoice?.taxPercent || 0);
  const [description, setDescription] = useState<string>(initialInvoice?.description || '');
  const [purchaseManagerProfitRate, setPurchaseManagerProfitRate] = useState<number>(initialInvoice?.purchaseManagerProfitRate || 0);
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);

  // Payment states for sell invoices
  const [cashPaidAmount, setCashPaidAmount] = useState<number>(Number(initialInvoice?.cashPaidAmount) || 0);
  const [posPaidAmount, setPosPaidAmount] = useState<number>(Number(initialInvoice?.posPaidAmount) || 0);
  const [posTerminalId, setPosTerminalId] = useState<string>(initialInvoice?.posTerminalId || '');
  const [isInstallmentDeferred, setIsInstallmentDeferred] = useState<boolean>(initialInvoice?.isInstallmentDeferred || false);
  const [isSettledWithChecks, setIsSettledWithChecks] = useState<boolean>(initialInvoice?.isSettledWithChecks || false);
  const [isPaidFromWallet, setIsPaidFromWallet] = useState<boolean>(initialInvoice?.isPaidFromWallet || false);
  const [invoiceWarehouseId, setInvoiceWarehouseId] = useState<string>(defaultWarehouseId);

  // Feature: Critical Status Panel
  const [phoneBoxStatus, setPhoneBoxStatus] = useState<CriticalDetails['phoneBoxStatus']>('none');
  const [ownershipStatus, setOwnershipStatus] = useState<CriticalDetails['ownershipStatus']>('none');
  const [guaranteeCheckStatus, setGuaranteeCheckStatus] = useState<CriticalDetails['guaranteeCheckStatus']>('none');
  const [showCriticalInquiry, setShowCriticalInquiry] = useState(false);
  const [showCriticalPanel, setShowCriticalPanel] = useState(false);

  // Custom dialog states to replace native confirm/alert in iframe
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);

  const [pendingAlert, setPendingAlert] = useState<{
    title: string;
    message: string;
    onClose: () => void;
  } | null>(null);

  const askConfirmation = (title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setPendingConfirm({
        title,
        message,
        onConfirm: () => {
          setPendingConfirm(null);
          resolve(true);
        },
        onCancel: () => {
          setPendingConfirm(null);
          resolve(false);
        }
      });
    });
  };

  const showAlert = (title: string, message: string): Promise<void> => {
    return new Promise((resolve) => {
      setPendingAlert({
        title,
        message,
        onClose: () => {
          setPendingAlert(null);
          resolve();
        }
      });
    });
  };

  // Keep track of which type we last synced for
  const [lastSyncedType, setLastSyncedType] = useState<'buy' | 'sell' | null>(null);

  // Sync warehouse when type changes for new invoices
  useEffect(() => {
    if (!initialInvoice && type !== lastSyncedType) {
      setInvoiceWarehouseId(defaultWarehouseId);
      setItems(prev => prev.map(item => ({ ...item, warehouseId: defaultWarehouseId })));
      setLastSyncedType(type);
    }
  }, [type, initialInvoice, defaultWarehouseId, lastSyncedType]);
  const [showCheckCalculator, setShowCheckCalculator] = useState(false);
  const [settlementCheques, setSettlementCheques] = useState<Omit<Check, 'id' | 'currentState' | 'history' | 'createdAt'>[]>([]);
  const [settlementCommission, setSettlementCommission] = useState<number>(0);
  
  const autoSubmitRef = React.useRef(false);

  useEffect(() => {
    if (autoSubmitRef.current && settlementCheques.length > 0) {
      autoSubmitRef.current = false;
      performSubmit();
    }
  }, [settlementCheques]);

  // Rows state
  const [items, setItems] = useState<InvoiceItem[]>(
    initialInvoice?.items || [{ productId: '', quantity: 1, unitPrice: 0, discount: 0, warehouseId: defaultWarehouseId }]
  );
  
  const [activeSerialRow, setActiveSerialRow] = useState<number | null>(null);
  const [scanningRowIndex, setScanningRowIndex] = useState<number | null>(null);

  // Calculate associated voucher
  const associatedVoucher = useMemo(() => {
    if (!initialInvoice) return null;
    return resolveInvoiceVoucher(initialInvoice, vouchers) || null;
  }, [vouchers, initialInvoice]);

  // If initialInvoice is provided (e.g., viewing a pro-invoice), set states
  useEffect(() => {
    if (initialInvoice) {
      setType(initialInvoice.type);
      setIsProInvoice(initialInvoice.isProInvoice);
      setPersonId(initialInvoice.personId);
      setDate(initialInvoice.date);
      setDiscount(initialInvoice.discount);
      setTaxPercent(initialInvoice.taxPercent);
      setDescription(initialInvoice.description || '');
      setItems(initialInvoice.items);
      setPurchaseManagerProfitRate(initialInvoice.purchaseManagerProfitRate || 0);
      setCashPaidAmount(Number(initialInvoice.cashPaidAmount) || 0);
      setPosPaidAmount(Number(initialInvoice.posPaidAmount) || 0);
      setPosTerminalId(initialInvoice.posTerminalId || '');
      setIsInstallmentDeferred(initialInvoice.isInstallmentDeferred || false);
      setIsSettledWithChecks(initialInvoice.isSettledWithChecks || false);
      setIsPaidFromWallet(initialInvoice.isPaidFromWallet || false);
    } else {
      // Reset form for a new invoice
      setIsEditing(false);
      if (initialType) setType(initialType);
      setIsProInvoice(false);
      setPersonId('');
      setDate(getCurrentJalaliDate());
      setDiscount(0);
      setTaxPercent(0);
      setDescription('');
      setItems([{ id: Date.now().toString(), productId: '', quantity: 1, unitPrice: 0 }]);
      setPurchaseManagerProfitRate(0);
      setCashPaidAmount(0);
      setPosPaidAmount(0);
      setPosTerminalId('');
      setIsInstallmentDeferred(false);
      setIsSettledWithChecks(false);
      setIsPaidFromWallet(false);
    }
  }, [initialInvoice, initialType]);

  // Pre-populate critical details state when selected person changes (sync with customer's current status)
  useEffect(() => {
    if (personId) {
      const selectedPerson = persons.find(p => p.id === personId);
      if (selectedPerson && selectedPerson.criticalDetails) {
        setPhoneBoxStatus(selectedPerson.criticalDetails.phoneBoxStatus || 'none');
        setOwnershipStatus(selectedPerson.criticalDetails.ownershipStatus || 'none');
        setGuaranteeCheckStatus(selectedPerson.criticalDetails.guaranteeCheckStatus || 'none');
      } else {
        setPhoneBoxStatus('none');
        setOwnershipStatus('none');
        setGuaranteeCheckStatus('none');
      }
    } else {
      setPhoneBoxStatus('none');
      setOwnershipStatus('none');
      setGuaranteeCheckStatus('none');
    }
  }, [personId, persons]);

  const resolvedPersons = useMemo(() => {
    if (type === 'sell') {
      return getFilteredPersonsForSell(persons, appState.businessPartners || []);
    }
    return persons;
  }, [persons, type, appState.businessPartners]);

  const hasMobileProduct = useMemo(() => {
    return items.some(item => {
      const prod = products.find(p => p.id === item.productId);
      return prod && prod.category === 'موبایل';
    });
  }, [items, products]);

  const isSelectedPersonAgent = useMemo(() => {
    const p = persons.find(x => x.id === personId);
    return p?.isAgent || false;
  }, [personId, persons]);

  const selectedPersonWalletBalance = useMemo(() => {
    const p = persons.find(x => x.id === personId);
    return p?.walletBalance || 0;
  }, [personId, persons]);

  const safetyLockStatus = useMemo(() => {
    if (!personId || type !== 'sell' || isProInvoice) return { locked: false, reason: '' };
    const person = persons.find(p => p.id === personId);
    if (!person) return { locked: false, reason: '' };

    // 1. Debt check (Normal + Installment)
    let normalDebt = 0;
    appState.invoices.forEach(inv => {
      if (inv.personId === person.id && !inv.isProInvoice) {
        if (inv.type === 'sell') normalDebt += (inv.totalAmount - (inv.paidAmount || 0));
        else normalDebt -= (inv.totalAmount - (inv.paidAmount || 0));
      }
    });

    let installmentDebt = 0;
    appState.installmentBooks.forEach(book => {
      if (book.personId === person.id && book.status === 'active') {
        const bookInstallments = appState.installments.filter(inst => inst.bookId === book.id);
        bookInstallments.forEach(inst => {
          if (inst.status !== 'paid') {
            installmentDebt += (inst.amount - inst.paidAmount);
          }
        });
      }
    });

    const totalDebt = normalDebt + installmentDebt;
    const limit = person.creditLimit || 500000000;

    if (totalDebt > limit) {
      return { locked: true, reason: `بدهی کل مشتری (${totalDebt.toLocaleString()} ریال) از سقف اعتبار (${limit.toLocaleString()} ریال) فراتر رفته است.` };
    }

    // 2. Critical items check
    if (hasMobileProduct) {
      if (person.criticalDetails?.phoneBoxStatus === 'at_store') {
        return { locked: true, reason: 'کارتن گوشی مشتری در وضعیت «امانت نزد فروشگاه» است. لطفاً پیش از ثبت فاکتور جدید تعیین تکلیف کنید.' };
      }
      if (person.criticalDetails?.ownershipStatus === 'at_store') {
        return { locked: true, reason: 'سند مالکیت مشتری در وضعیت «نزد فروشگاه» است. لطفاً پیش از ثبت فاکتور جدید تعیین تکلیف کنید.' };
      }
    }

    return { locked: false, reason: '' };
  }, [personId, type, isProInvoice, persons, appState, hasMobileProduct]);

  const evaluationData = useMemo(() => {
    if (!initialInvoice || type !== 'buy' || !allInvoices) return null;

    // 1. Map all purchased serial numbers in this invoice to their product ID and unit purchase price
    const serialPurchaseMap = new Map<string, { productId: string; purchasePrice: number }>();
    initialInvoice.items.forEach(item => {
      const prod = products.find(p => p.id === item.productId);
      if (prod && prod.category === 'موبایل') {
        (item.serialNumbers || []).forEach(sn => {
          if (sn) {
            serialPurchaseMap.set(sn, {
              productId: item.productId,
              purchasePrice: item.unitPrice
            });
          }
        });
      }
    });

    // 2. Trace all sales of these IMEIs
    let soldCount = 0;
    let totalRevenueFromSerials = 0;
    let totalCostOfSerials = 0;
    const trackingDetails: Array<{
      serial: string;
      productName: string;
      purchasePrice: number;
      salePrice?: number;
      saleDate?: string;
      isSold: boolean;
      profit: number;
    }> = [];

    // Initialize list
    serialPurchaseMap.forEach((val, sn) => {
      const prodName = products.find(p => p.id === val.productId)?.name || 'گوشی موبایل';
      trackingDetails.push({
        serial: sn,
        productName: prodName,
        purchasePrice: val.purchasePrice,
        isSold: false,
        profit: 0
      });
    });

    // Loop through all sales invoices
    const salesInvoices = allInvoices.filter(inv => inv.type === 'sell' && !inv.isProInvoice);
    salesInvoices.forEach(saleInv => {
      saleInv.items.forEach(item => {
        (item.serialNumbers || []).forEach(sn => {
          const detail = trackingDetails.find(d => d.serial === sn);
          if (detail && !detail.isSold) { // Prevent double count
            detail.isSold = true;
            detail.salePrice = item.unitPrice;
            detail.saleDate = saleInv.date;
            detail.profit = item.unitPrice - detail.purchasePrice;
            soldCount++;
            totalRevenueFromSerials += item.unitPrice;
            totalCostOfSerials += detail.purchasePrice;
          }
        });
      });
    });

    // Calculate profit of non-sold ones as 0
    const grossProfit = totalRevenueFromSerials - totalCostOfSerials;
    const profitPercentOfInvoice = initialInvoice.totalAmount > 0 
      ? (grossProfit / initialInvoice.totalAmount) * 100 
      : 0;

    const managerRate = initialInvoice.purchaseManagerProfitRate || 0;
    const diffRate = profitPercentOfInvoice - managerRate;

    return {
      totalSerialsCount: trackingDetails.length,
      soldCount,
      unsoldCount: trackingDetails.length - soldCount,
      totalRevenueFromSerials,
      totalCostOfSerials,
      grossProfit,
      profitPercentOfInvoice,
      managerRate,
      diffRate,
      trackingDetails
    };
  }, [initialInvoice, type, allInvoices, products]);

  const handleAddRow = () => {
    setItems([...items, { productId: '', quantity: 1, unitPrice: 0, discount: 0, serialNumbers: [], warehouseId: invoiceWarehouseId }]);
  };

  const handleRemoveRow = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const handleRowChange = (index: number, field: keyof InvoiceItem, value: any) => {
    setItems(prev => {
      const updated = [...prev];
      
      if (field === 'productId') {
        updated[index] = { ...updated[index], productId: value };
        const productObj = products.find(p => p.id === value);
        
        // Auto-fill quantity to 1 by default
        if (updated[index].quantity === 0 || !updated[index].quantity) {
          updated[index].quantity = 1;
        }
        
        // Default price for Buy Invoice is the last purchase price
        if (type === 'buy') {
          const prevPrice = getPreviousPurchasePrice(value, [], products); // empty history falls back to seed price
          updated[index].unitPrice = prevPrice;
        } else {
          if (productObj && productObj.defaultSalePrice && productObj.defaultSalePrice > 0) {
            updated[index].unitPrice = productObj.defaultSalePrice;
          } else {
            // Default sale price approximation based on buy price + 30% margin
            const prevBuyPrice = getPreviousPurchasePrice(value, [], products);
            updated[index].unitPrice = Math.round(prevBuyPrice * 1.3);
          }
        }
        
        // Continuous Entry: Add an empty row if we just filled the product of the last row
        if (index === updated.length - 1 && value !== '') {
          updated.push({ productId: '', quantity: 1, unitPrice: 0, discount: 0, serialNumbers: [] });
        }
      } else if (field === 'quantity' || field === 'unitPrice' || field === 'discount' || field === 'serialNumbers') {
        updated[index] = { ...updated[index], [field]: field === 'serialNumbers' ? value : parseNumericValue(value) };
      } else {
        updated[index] = { ...updated[index], [field]: value };
      }
      
      return updated;
    });
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let rowDiscounts = 0;
    
    items.forEach(item => {
      subtotal += (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
      rowDiscounts += (Number(item.discount) || 0);
    });

    const netAmount = subtotal - rowDiscounts - (Number(discount) || 0);
    const vatAmount = Math.round(netAmount * ((Number(taxPercent) || 0) / 100));
    const finalAmount = netAmount + vatAmount;

    return {
      subtotal,
      rowDiscounts,
      netAmount,
      vatAmount,
      finalAmount
    };
  }, [items, discount, taxPercent]);

  const isFormValid = useMemo(() => {
    if (!personId) return false;
    
const activeItems = items.filter(it => it.productId);
    if (activeItems.length === 0) return false;
    const hasInvalidItem = activeItems.some(it => it.quantity <= 0);
    return !hasInvalidItem;
  }, [personId, items]);

  const negativeStockItems = useMemo(() => {
    if (type !== 'sell' || isProInvoice) return [];
    
    return items.filter(item => {
      if (!item.productId) return false;
      const stock = currentStocks[item.productId] || 0;
      // If we are editing a real invoice, the current stock already has these items deducted.
      // So we add back the original quantity to see the true available stock.
      let availableStock = stock;
      if (initialInvoice && !initialInvoice.isProInvoice && initialInvoice.type === 'sell') {
        const originalItem = initialInvoice.items.find(it => it.productId === item.productId);
        if (originalItem) {
          availableStock += originalItem.quantity;
        }
      }
      return item.quantity > availableStock;
    });
  }, [items, type, isProInvoice, currentStocks, initialInvoice]);

  const performSubmit = async (isFinal = false) => {
    const normalizedDate = normalizeJalaliDate(date);
    if (!validateJalaliDate(normalizedDate)) {
      await showAlert("خطای تاریخ", `تاریخ وارد شده (${date}) نامعتبر است. لطفاً تاریخ صحیح شمسی را به صورت YYYY/MM/DD وارد کنید.`);
      return;
    }
    setDate(normalizedDate);

    if (type === 'sell' && isSettledWithChecks && settlementCheques.length === 0) {
      autoSubmitRef.current = true;
      setShowCheckCalculator(true);
      return;
    }

    if (safetyLockStatus.locked && !isFinal) {
      const override = await askConfirmation(
        "⚠️ قفل ایمنی فعال است",
        `${safetyLockStatus.reason}\n\nآیا با مسئولیت خود مایل به عبور از این محدودیت و ثبت فاکتور هستید؟`
      );
      if (!override) return;
    }

    if (!personId) {
      await showAlert("خطای ثبت", "لطفاً طرف حساب را انتخاب کنید.");
      return;
    }

    const activeItems = items.filter(it => it.productId);
    if (activeItems.length === 0) {
      await showAlert("خطای ثبت", "لطفاً حداقل یک کالا انتخاب کنید.");
      return;
    }

    const invalidItem = activeItems.find(it => it.quantity <= 0);
    if (invalidItem) {
      await showAlert("خطای ثبت", "لطفاً تعداد کالا را وارد کنید.");
      return;
    }

    if (negativeStockItems.length > 0) {
      const itemNames = negativeStockItems.map(it => products.find(p => p.id === it.productId)?.name).join('، ');
      if (appState.settings.preventNegativeStock) {
        await showAlert(
          "❌ خطای موجودی منفی انبار",
          `موجودی کالاهای (${itemNames}) کافی نیست.\nبه دلیل فعال بودن تنظیم «جلوگیری از منفی شدن انبار»، ثبت این فاکتور مسدود است.`
        );
        return;
      } else {
        const proceed = await askConfirmation(
          "⚠️ اخطار موجودی منفی",
          `موجودی کالاهای (${itemNames}) کافی نیست و انبار منفی خواهد شد.\n\nآیا با مسئولیت خود مایل به ثبت این فاکتور با موجودی منفی هستید؟`
        );
        if (!proceed) return;
      }
    }

    if (type === 'sell' && isInstallmentDeferred) {
      const person = persons.find(p => p.id === personId);
      if (person) {
        const newInvoiceCreditPart = (Number(totals.finalAmount) || 0) - ((Number(cashPaidAmount) || 0) + (Number(posPaidAmount) || 0));
        const creditStatus = checkCreditLimit(person, appState.vouchers || [], newInvoiceCreditPart, appState.businessPartners || []);
        const personRules = resolvePartnerCreditRules(person, appState.businessPartners || []);
        if (appState.settings.controlCreditLimit && !creditStatus.allowed) {
          await showAlert(
            "❌ خطای سقف اعتبار مشتری",
            `سقف اعتبار این مشتری (${personRules.maxCreditLimit.toLocaleString()} ریال) تکمیل شده است. مانده بدهی فعلی او: ${creditStatus.currentDebt.toLocaleString()} ریال.\nبه دلیل فعال بودن تنظیم «کنترل سقف اعتبار مشتری»، ثبت فاکتور قسطی جدید برای او غیرمجاز است.`
          );
          return;
        }
      }
    }

    for (const item of activeItems) {
      const prod = products.find(p => p.id === item.productId);
      if (prod?.hasSerial) {
        const serialErrors = validateSerialNumbers(
          item.productId!,
          item.serialNumbers || [],
          item.quantity,
          appState,
          type,
          initialInvoice?.id
        );
        if (serialErrors.length > 0) {
          await showAlert(`خطا در ردیف کالا "${prod.name}"`, serialErrors.join('\n'));
          return;
        }
      }
    }

    const subtotal = activeItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const itemDiscounts = activeItems.reduce((sum, item) => sum + item.discount, 0);
    const totalDiscount = discount + itemDiscounts;
    const vat = Math.round((subtotal - totalDiscount) * (taxPercent / 100));
    const finalTotal = subtotal - totalDiscount + vat;

    if (type === 'sell' && !isProInvoice) {
      const selectedPerson = appState.persons.find(p => p.id === personId);
      if (selectedPerson && selectedPerson.isAgent) {
        const invoiceRemainingToPay = isPaidFromWallet ? 0 : ((Number(finalTotal) || 0) - ((Number(cashPaidAmount) || 0) + (Number(posPaidAmount) || 0)));
        
        if (!selectedPerson.isDocumentsApproved) {
          if (isPaidFromWallet) {
            await showAlert("خطای اعتبارسنجی", 'امکان استفاده از کیف پول همکار تا زمان تایید نهایی مدارک وجود ندارد.');
            return;
          }
          if (isInstallmentDeferred) {
            await showAlert("خطای اعتبارسنجی", 'امکان فروش اقساطی/چک صیادی همکار تا زمان تایید نهایی مدارک وجود ندارد.');
            return;
          }
          if (invoiceRemainingToPay > 0) {
            await showAlert("خطای اعتبارسنجی", 'امکان خرید نسیه/اعتباری برای همکار تا زمان تایید نهایی مدارک و تضامین وجود ندارد.');
            return;
          }
        }
        if (selectedPerson.isOfflineWholesaleEnabled === false) {
          await showAlert("خطای اعتبارسنجی", 'دسترسی عمده‌فروشی آفلاین این همکار موقتاً مسدود شده است.');
          return;
        }
        if (isInstallmentDeferred && selectedPerson.isInstallmentEnabled === false) {
          await showAlert("خطای اعتبارسنجی", 'دسترسی فروش اقساطی این همکار موقتاً مسدود شده است.');
          return;
        }
        if (isPaidFromWallet) {
          const currentWalletBal = selectedPerson.walletBalance || 0;
          if (finalTotal > currentWalletBal) {
            await showAlert(
              "خطای موجودی کیف پول",
              `مبلغ فاکتور (${finalTotal.toLocaleString()} ریال) بیشتر از موجودی کیف پول اعتباری همکار (${currentWalletBal.toLocaleString()} ریال) است.`
            );
            return;
          }
        }
        const creditRules = resolvePartnerCreditRules(selectedPerson, appState.businessPartners || []);
        const allowedCreditLimit = creditRules.maxCreditLimit;
        const balances = calculatePersonBalances(appState.vouchers || [], selectedPerson.id);
        const pBal = balances[selectedPerson.id] || { net: 0, nature: 'بی‌حساب' };
        const unpaidDebt = pBal.nature === 'بدهکار' ? pBal.net : (pBal.nature === 'بستانکار' ? -pBal.net : 0);

        if (unpaidDebt + invoiceRemainingToPay > allowedCreditLimit) {
          await showAlert(
            "خطای سقف اعتبار مجاز",
            `مجموع بدهی همکار (${unpaidDebt.toLocaleString()} ریال) به همراه مبلغ باقیمانده این فاکتور (${invoiceRemainingToPay.toLocaleString()} ریال) از سقف اعتبار مجاز تعیین شده (${allowedCreditLimit.toLocaleString()} ریال) بیشتر است.`
          );
          return;
        }
      }
    }

    let finalInstallmentDeferred = isInstallmentDeferred;

    if (initialInvoice && isEditing && onUpdate) {
      onUpdate({
        ...initialInvoice,
        type,
        isProInvoice,
        personId,
        date: normalizedDate,
        items: activeItems,
        discount,
        taxPercent,
        totalAmount: finalTotal,
        paidAmount: initialInvoice.paidAmount || 0,
        cashPaidAmount: type === 'sell' ? cashPaidAmount : undefined,
        posPaidAmount: type === 'sell' ? posPaidAmount : undefined,
        posTerminalId: type === 'sell' ? posTerminalId : undefined,
        isInstallmentDeferred: type === 'sell' ? finalInstallmentDeferred : undefined,
        isSettledWithChecks: type === 'sell' ? isSettledWithChecks : undefined,
        isPaidFromWallet: type === 'sell' ? isPaidFromWallet : undefined,
        description: description.trim() || undefined,
        purchaseManagerProfitRate: type === 'buy' && activeItems.some(item => {
          const prod = products.find(p => p.id === item.productId);
          return prod && prod.category === 'موبایل';
        }) ? purchaseManagerProfitRate : undefined
      });
      setIsEditing(false);
    } else {
      // Feature: Critical Status Panel Inquiry
      if ((finalInstallmentDeferred || isSettledWithChecks) && type === 'sell' && !showCriticalInquiry && !initialInvoice && !isFinal && hasMobileProduct) {
        setShowCriticalInquiry(true);
        return;
      }

      // Create Credit Rules Snapshot for sales invoice
      const creditRules = (type === 'sell' && personId) ? resolvePartnerCreditRules(personId, appState.businessPartners || []) : undefined;
      const creditRulesSnapshot = creditRules ? {
        maxCreditLimit: creditRules.maxCreditLimit,
        defaultInstallmentDays: creditRules.defaultInstallmentDays,
        penaltyRatePerMonth: creditRules.penaltyRatePerMonth,
        snapshotCreatedAt: new Date().toISOString()
      } : undefined;

      onSubmit({
        type,
        isProInvoice,
        personId,
        date: normalizedDate,
        items: activeItems,
        discount,
        taxPercent,
        totalAmount: finalTotal,
        paidAmount: 0,
        cashPaidAmount: type === 'sell' ? cashPaidAmount : undefined,
        posPaidAmount: type === 'sell' ? posPaidAmount : undefined,
        posTerminalId: type === 'sell' ? posTerminalId : undefined,
        isInstallmentDeferred: type === 'sell' ? finalInstallmentDeferred : undefined,
        isSettledWithChecks: type === 'sell' ? isSettledWithChecks : undefined,
        isPaidFromWallet: type === 'sell' ? isPaidFromWallet : undefined,
        description: description.trim() || undefined,
        creditRulesSnapshot: type === 'sell' ? creditRulesSnapshot : undefined,
        purchaseManagerProfitRate: type === 'buy' && activeItems.some(item => {
          const prod = products.find(p => p.id === item.productId);
          return prod && prod.category === 'موبایل';
        }) ? purchaseManagerProfitRate : undefined
      }, settlementCheques, settlementCommission, ((showCriticalInquiry || isFinal) && hasMobileProduct) ? {
        phoneBoxStatus,
        ownershipStatus,
        guaranteeCheckStatus,
        manualNotes: ''
      } : undefined);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    performSubmit();
  };

  // Quick Create Handlers for Selector
  const handleCreatePersonInline = (name: string, nationalId?: string, mobile?: string, phone?: string, address?: string, role?: 'debtor' | 'creditor' | 'both') => {
    // We delegate creation back to main state or store locally
    // In React setup we can dispatch an event or use callback
    // Since App has state, we can lift up. But we need to return the new person's ID immediately!
    const newId = `p_inline_${Date.now()}`;
    const customEvent = new CustomEvent('create_person_inline', {
      detail: { id: newId, name, nationalId, mobile, phone, address, role }
    });
    window.dispatchEvent(customEvent);
    return newId;
  };

  const handleCreateProductInline = (name: string, category: string, unit: string, initialStock: number, reorderPoint: number, serialNumber?: string, defaultSalePrice?: number) => {
    const newId = `k_inline_${Date.now()}`;
    const customEvent = new CustomEvent('create_product_inline', {
      detail: { id: newId, name, category, unit, initialStock, reorderPoint, serialNumber, defaultSalePrice }
    });
    window.dispatchEvent(customEvent);
    return newId;
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 pb-20">
      {/* Sub-Header */}
      <div className="bg-white border-b border-zinc-200 px-4 py-3 flex flex-col sticky top-0 z-30 shadow-xs">
        <div className="flex items-center justify-between w-full">
          <button type="button" onClick={onCancel} className="text-zinc-500 hover:text-zinc-800 p-1">
            <ArrowLeft size={20} />
          </button>
          
          <div className="text-center flex flex-col items-center">
            <span className={`font-sans text-sm md:text-base font-extrabold px-4 py-1.5 rounded-full ${
              type === 'sell' 
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                : 'bg-blue-50 text-blue-700 border border-blue-200'
            }`}>
              {isProInvoice 
                ? (type === 'sell' ? 'پیش‌فاکتور فروش کالا' : 'پیش‌فاکتور خرید کالا') 
                : (type === 'sell' ? 'فاکتور رسمی فروش کالا' : 'فاکتور رسمی خرید کالا')
              }
            </span>
          </div>
          
          <div className="w-8">
            {onOpenAdvancedSearch && (
              <button type="button" onClick={onOpenAdvancedSearch} className="text-zinc-500 hover:text-emerald-600 p-1">
                <Search size={20} />
              </button>
            )}
          </div>
        </div>

        {/* Invoice & Document numbers info banner */}
        <div className="flex justify-center items-center gap-4 md:gap-6 mt-2 text-right bg-zinc-50 py-1.5 px-3 rounded-xl border border-zinc-150 font-sans text-[10px] md:text-[11px] font-bold text-zinc-600">
          <div>
            <span className="text-zinc-400">شماره فاکتور:</span>{' '}
            <span className="font-mono text-zinc-900 text-xs bg-zinc-200/60 px-2 py-0.5 rounded">
              {initialInvoice ? initialInvoice.invoiceNumber : (allInvoices.length > 0 ? Math.max(...allInvoices.map(i => i.invoiceNumber)) + 1 : 1)}
            </span>
          </div>
          <div className="w-px h-3.5 bg-zinc-200" />
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-400">شماره سند حسابداری:</span>{' '}
            <span className="font-mono text-indigo-700 font-extrabold text-xs bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200 shadow-sm">
              {isProInvoice 
                ? 'فاقد اثر مالی' 
                : (associatedVoucher ? associatedVoucher.voucherNumber : (vouchers.length > 0 ? Math.max(...vouchers.map(v => v.voucherNumber)) + 1 : 1))
              }
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-4 flex-1 overflow-y-auto">
        {/* Toggle Controls (Buy vs Sell & Real vs Pro) */}
        {!isViewModeActive && !initialInvoice && (
          <div className="grid grid-cols-2 gap-2 bg-zinc-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setType('sell')}
              className={`py-2 rounded-lg font-sans text-xs font-semibold text-center transition-all ${
                type === 'sell' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
              }`}
            >
              <div className="flex items-center justify-center space-x-1.5 space-x-reverse">
                <ShoppingCart size={13} />
                <span>فروش کالا</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setType('buy')}
              className={`py-2 rounded-lg font-sans text-xs font-semibold text-center transition-all ${
                type === 'buy' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
              }`}
            >
              <div className="flex items-center justify-center space-x-1.5 space-x-reverse">
                <ShoppingBag size={13} />
                <span>خرید کالا</span>
              </div>
            </button>
          </div>
        )}

        {/* Pro-Invoice Switcher */}
        {!isViewModeActive && !initialInvoice && (
          <div className="flex items-center justify-between bg-white px-4 py-3 rounded-2xl border border-zinc-100">
            <div className="flex flex-col text-right">
              <span className="font-sans text-xs font-semibold text-zinc-800">ثبت به عنوان پیش‌فاکتور (قرنطینه)</span>
              <span className="font-sans text-[10px] text-zinc-400 mt-0.5">تا زمان تبدیل، بر کالا و حساب‌ها اثری ندارد</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                checked={isProInvoice} 
                onChange={(e) => setIsProInvoice(e.target.checked)} 
                className="sr-only peer" 
              />
              <div className="w-9 h-5 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>
        )}

        {/* Pro-Invoice Warning Alert */}
        {isProInvoice && (
          <div className="bg-amber-50 border border-amber-100 text-amber-800 text-[11px] px-3 py-2.5 rounded-xl font-sans leading-relaxed text-right">
            ⚠️ <strong>هشدار قرنطینه پیش‌فاکتور:</strong> این سند پیش‌نویس بوده و هیچ‌گونه سند حسابداری صادر نمی‌کند و تغییری در انبار یا حساب طرف‌های مالی ایجاد نمی‌نماید.
          </div>
        )}

        {/* Basic Metadata */}
        <div className="bg-white p-4 rounded-2xl border border-zinc-100 space-y-3.5 shadow-sm">
          <div className="flex flex-col gap-2">
            <PersonSelector
              persons={resolvedPersons}
              selectedPersonId={personId}
              onSelect={setPersonId}
              onCreatePerson={handleCreatePersonInline}
              label={type === 'sell' ? "نام خریدار (مشتری)" : "نام فروشنده (تأمین‌کننده)"}
              invoiceType={type}
              vouchers={appState.vouchers}
              installmentBooks={appState.installmentBooks}
            />
            {personId && (
              <button
                type="button"
                onClick={() => setShowCriticalPanel(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-xl text-[10px] font-bold transition border border-amber-200 self-end"
              >
                <AlertCircle size={14} className="text-amber-600" />
                توضیحات ضروری و وضعیت تعهدات مشتری
              </button>
            )}
          </div>

          <div>
            <label className="block font-sans text-xs font-semibold text-zinc-700 text-right mb-1">انتخاب انبار</label>
            <select
              value={invoiceWarehouseId}
              onChange={(e) => {
                setInvoiceWarehouseId(e.target.value);
                setItems(items.map(item => ({ ...item, warehouseId: e.target.value })));
              }}
              className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
              disabled={isViewModeActive}
            >
              <option value="">انتخاب انبار</option>
              {allowedWarehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-sans text-xs font-semibold text-zinc-700 text-right mb-1">تاریخ فاکتور (شمسی روز)</label>
            <input
              type="text"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="مثال: 1405/04/20"
              className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 font-mono text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
              dir="ltr"
              required
              disabled={isViewModeActive}
            />
          </div>

          {type === 'buy' && hasMobileProduct && (
            <div className="pt-2 border-t border-dashed border-zinc-100">
              <label className="block font-sans text-xs font-bold text-emerald-800 text-right mb-1">
                نرخ آنالیز مدیر خرید (٪ سود پیش‌بینی شده)
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={purchaseManagerProfitRate > 0 ? purchaseManagerProfitRate.toString() : ''}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9.]/g, '');
                  setPurchaseManagerProfitRate(val ? parseFloat(val) : 0);
                }}
                placeholder="مثلاً: 2"
                className="w-full bg-emerald-50/30 border border-emerald-100 rounded-xl px-3.5 py-2.5 font-mono text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-center"
                disabled={isViewModeActive}
              />
              <span className="block text-[9px] text-zinc-400 text-right mt-1">
                این نرخ سود پیش‌بینی‌شده به عنوان مبنای ارزیابی کارنامه این فاکتور موبایل ذخیره می‌شود.
              </span>
            </div>
          )}
        </div>

        {/* Invoice Items Title */}
        <div className="flex items-center justify-between">
          {!isViewModeActive && (
            <button
              type="button"
              onClick={handleAddRow}
              className="flex items-center space-x-1.5 space-x-reverse text-xs text-emerald-600 font-semibold hover:text-emerald-500 bg-emerald-50 hover:bg-emerald-100/60 px-3 py-1.5 rounded-lg transition"
            >
              <Plus size={14} />
              <span>افزودن ردیف کالا</span>
            </button>
          )}
          <span className="font-sans text-xs font-bold text-zinc-800 text-right">لیست اقلام کالا</span>
        </div>

        {/* Invoice Item Rows */}
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={index} className="bg-white p-3 rounded-2xl border border-zinc-150 relative space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                {!isViewModeActive && items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(index)}
                    className="text-red-500 hover:text-red-600 p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <span className="font-sans text-[11px] font-bold text-zinc-500">ردیف {index + 1}</span>
              </div>

              {isViewModeActive ? (
                <div className="flex items-center justify-between bg-zinc-50 p-2.5 rounded-xl font-sans text-xs">
                  <div className="font-semibold text-zinc-800 text-right">
                    {products.find(p => p.id === item.productId)?.name || 'کالای ناشناس'}
                  </div>
                  <div className="font-mono text-[10px] text-zinc-500">
                    {item.quantity} عدد × {item.unitPrice.toLocaleString()} ریال
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <ProductSelector
                    products={products}
                    productCategories={productCategories}
                    selectedProductId={item.productId}
                    onSelect={(id) => handleRowChange(index, 'productId', id)}
                    onCreateProduct={handleCreateProductInline}
                    onAddCategory={onAddCategory}
                    currentStocks={currentStocks}
                    label="انتخاب کالا"
                  />
                  {products.find(p => p.id === item.productId)?.hasSerial ? (
                    <div className="flex flex-col space-y-1 mt-2">
                      <button 
                        type="button" 
                        onClick={() => setActiveSerialRow(index)}
                        className="bg-blue-50 text-blue-600 border border-blue-200 rounded-lg px-2 py-1.5 text-xs font-bold w-full text-center hover:bg-blue-100 transition"
                      >
                        {(item.serialNumbers?.length || 0)} از {item.quantity || 1} شماره سریال وارد شده است
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="شماره سریال گوشی موبایل"
                        value={item.serialNumbers?.[0] || ''}
                        onChange={(e) => handleRowChange(index, 'serialNumbers', [e.target.value])}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-emerald-500 mt-2 pl-8"
                        dir="rtl"
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const form = e.currentTarget.form;
                            if (form) {
                              const elements = Array.from(form.elements) as HTMLElement[];
                              const index = elements.indexOf(e.currentTarget);
                              if (index > -1 && index + 1 < elements.length) {
                                elements[index + 1].focus();
                              }
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setScanningRowIndex(index)}
                        className="absolute left-2 top-3.5 text-zinc-400 hover:text-emerald-600 transition"
                      >
                        <QrCode size={16} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 mt-2">
                <div>
                  <label className="block text-[10px] text-zinc-500 text-right mb-0.5">تعداد / مقدار</label>
                  {(() => {
                    const stock = currentStocks[item.productId] || 0;
                    let availableStock = stock;
                    if (initialInvoice && !initialInvoice.isProInvoice && initialInvoice.type === 'sell') {
                      const originalItem = initialInvoice.items.find(it => it.productId === item.productId);
                      if (originalItem) {
                        availableStock += originalItem.quantity;
                      }
                    }
                    const isInsufficient = type === 'sell' && !isProInvoice && item.productId && item.quantity > availableStock;

                    return (
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={item.quantity > 0 ? item.quantity.toLocaleString() : ''}
                          onChange={(e) => handleRowChange(index, 'quantity', e.target.value)}
                          className={`w-full ${isInsufficient ? 'bg-red-50 border-red-300 text-red-900 focus:border-red-500' : 'bg-zinc-50 border-zinc-200 text-zinc-800 focus:border-emerald-500'} border rounded-lg px-2 py-1 font-mono text-xs text-center focus:outline-none transition-colors`}
                          disabled={isViewModeActive}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const form = e.currentTarget.form;
                              if (form) {
                                const elements = Array.from(form.elements) as HTMLElement[];
                                const idx = elements.indexOf(e.currentTarget);
                                if (idx > -1 && idx + 1 < elements.length) elements[idx + 1].focus();
                              }
                            }
                          }}
                        />
                        {isInsufficient && !isViewModeActive && (
                          <div className="absolute -bottom-3 right-0 bg-red-600 text-white text-[7px] px-1 rounded-sm shadow-sm whitespace-nowrap z-10">
                            موجودی: {availableStock}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 text-right mb-0.5">فی (ریال)</label>
                  {(() => {
                    const buyPrice = item.productId ? getPreviousPurchasePrice(item.productId, allInvoices, products) : 0;
                    const isPriceWarning = currentUser?.role !== 'seller' && type === 'sell' && item.productId && item.unitPrice > 0 && buyPrice > 0 && item.unitPrice < buyPrice;
                    
                    return (
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={item.unitPrice > 0 ? item.unitPrice.toLocaleString() : ''}
                          onChange={(e) => handleRowChange(index, 'unitPrice', e.target.value)}
                          className={`w-full ${isPriceWarning ? 'bg-red-50 border-red-300 text-red-900 focus:border-red-500' : 'bg-zinc-50 border-zinc-200 text-zinc-800 focus:border-emerald-500'} border rounded-lg px-2 py-1 font-mono text-xs text-center focus:outline-none transition-colors`}
                          disabled={isViewModeActive}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const form = e.currentTarget.form;
                              if (form) {
                                const elements = Array.from(form.elements) as HTMLElement[];
                                const idx = elements.indexOf(e.currentTarget);
                                if (idx > -1 && idx + 1 < elements.length) elements[idx + 1].focus();
                              }
                            }
                          }}
                        />
                        {isPriceWarning && !isViewModeActive && (
                          <div className="absolute -top-3 right-0 bg-red-500 text-white text-[7px] px-1 rounded-sm shadow-sm animate-pulse">
                            کمتر از خرید ({buyPrice.toLocaleString()})
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 text-right mb-0.5">تخفیف ردیف</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={item.discount > 0 ? item.discount.toLocaleString() : ''}
                    onChange={(e) => handleRowChange(index, 'discount', e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                    disabled={isViewModeActive}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const form = e.currentTarget.form;
                        if (form) {
                          const elements = Array.from(form.elements) as HTMLElement[];
                          const idx = elements.indexOf(e.currentTarget);
                          if (idx > -1 && idx + 1 < elements.length) elements[idx + 1].focus();
                        }
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary and Additional Fields */}
        <div className="bg-white p-4 rounded-2xl border border-zinc-100 space-y-3.5 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-zinc-500 text-right mb-0.5">تخفیف کلی فاکتور (ریال)</label>
              <input
                type="text"
                inputMode="numeric"
                value={discount > 0 ? discount.toLocaleString() : ''}
                onChange={(e) => setDiscount(parseNumericValue(e.target.value))}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                disabled={isViewModeActive}
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 text-right mb-0.5">مالیات بر ارزش افزوده (٪)</label>
              <input
                type="text"
                inputMode="numeric"
                value={taxPercent > 0 ? taxPercent.toLocaleString() : ''}
                onChange={(e) => setTaxPercent(parseNumericValue(e.target.value))}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                disabled={isViewModeActive}
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-zinc-500 text-right mb-0.5">توضیحات فاکتور</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="شرح فاکتور..."
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-emerald-500"
              rows={2}
              disabled={isViewModeActive}
            />
          </div>

          {/* Pricing totals box */}
          <div className="bg-zinc-50/75 p-3 rounded-xl space-y-2 border border-zinc-150 font-sans text-xs">
            <div className="flex justify-between">
              <span className="font-mono font-semibold text-zinc-800">{totals.subtotal.toLocaleString()} ریال</span>
              <span className="text-zinc-500">جمع کل اقلام:</span>
            </div>
            {(totals.rowDiscounts > 0 || discount > 0) && (
              <div className="flex justify-between text-red-600">
                <span className="font-mono font-semibold">{(totals.rowDiscounts + discount).toLocaleString()} ریال-</span>
                <span>تخفیفات فاکتور:</span>
              </div>
            )}
            {totals.vatAmount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span className="font-mono font-semibold">{totals.vatAmount.toLocaleString()} ریال+</span>
                <span>مالیات ارزش افزوده ({taxPercent}٪):</span>
              </div>
            )}
            <div className="h-px bg-zinc-200 my-1" />
            <div className="flex justify-between text-zinc-900 font-bold text-sm">
              <span className="font-mono text-emerald-600">{(Number(totals.finalAmount) || 0).toLocaleString()} ریال</span>
              <span>قابل پرداخت نهایی:</span>
            </div>
          </div>

          {/* Payment Section for Sell Invoices */}
          {type === 'sell' && !isProInvoice && (
            <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 space-y-3">
              <span className="block font-sans text-xs font-bold text-emerald-800 text-right">تسویه فاکتور فروش (ریال)</span>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-zinc-500 text-right mb-0.5">مبلغ نقدی / واریز به بانک</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={cashPaidAmount === 0 ? '0' : (Number(cashPaidAmount) || 0).toLocaleString()}
                    onChange={(e) => setCashPaidAmount(parseNumericValue(e.target.value))}
                    className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                    placeholder="۰"
                    disabled={isViewModeActive}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[10px] text-zinc-500 text-right mb-0.5">کشیده شده به کارتخوان (POS)</label>
                  <div className="flex gap-2">
                    <select
                      value={posTerminalId}
                      onChange={(e) => setPosTerminalId(e.target.value)}
                      className="w-1/2 bg-white border border-emerald-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500"
                      disabled={isViewModeActive}
                    >
                      <option value="">انتخاب دستگاه...</option>
                      {appState.bankTerminals?.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={posPaidAmount === 0 ? '0' : (Number(posPaidAmount) || 0).toLocaleString()}
                      onChange={(e) => setPosPaidAmount(parseNumericValue(e.target.value))}
                      className="w-1/2 bg-white border border-emerald-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                      placeholder="مبلغ"
                      disabled={isViewModeActive}
                    />
                  </div>
                </div>
              </div>

              {/* Installment toggle display */}
              <div className="flex flex-col gap-2 pt-1 font-sans text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="flex items-center space-x-1.5 space-x-reverse">
                  <input
                    type="checkbox"
                    id="isInstallmentDeferred"
                    checked={isInstallmentDeferred}
                    onChange={(e) => setIsInstallmentDeferred(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 border-zinc-300 rounded focus:ring-emerald-500"
                    disabled={isViewModeActive}
                  />
                  <label htmlFor="isInstallmentDeferred" className="font-semibold text-zinc-700 cursor-pointer select-none">
                    مابقی به صورت فروش اقساطی انتقال یابد
                  </label>
                </div>

                <div className="flex items-center space-x-1.5 space-x-reverse">
                  <input
                    type="checkbox"
                    id="isSettledWithChecks"
                    checked={isSettledWithChecks}
                    onChange={(e) => {
                      setIsSettledWithChecks(e.target.checked);
                    }}
                    className="w-4 h-4 text-emerald-600 border-zinc-300 rounded focus:ring-emerald-500"
                    disabled={isViewModeActive}
                  />
                  <label htmlFor="isSettledWithChecks" className="font-semibold text-zinc-700 cursor-pointer select-none">
                    تسویه با اسناد دریافتی
                  </label>
                </div>

                {isSelectedPersonAgent && (
                  <div className="flex items-center space-x-1.5 space-x-reverse bg-amber-50 px-3 py-2 rounded-xl border border-amber-100 col-span-2">
                    <input
                      type="checkbox"
                      id="isPaidFromWallet"
                      checked={isPaidFromWallet}
                      onChange={(e) => {
                        setIsPaidFromWallet(e.target.checked);
                      }}
                      className="w-4 h-4 text-amber-600 border-amber-300 rounded focus:ring-amber-500"
                      disabled={isViewModeActive}
                    />
                    <label htmlFor="isPaidFromWallet" className="font-semibold text-amber-900 cursor-pointer select-none">
                      تسویه از کیف پول همکار (موجودی: {(selectedPersonWalletBalance || 0).toLocaleString()} ریال)
                    </label>
                  </div>
                )}
              </div>
                
                <span className="text-zinc-500 text-[10px] text-right">
                  مانده بدهی:{' '}
                  <span className={`font-mono font-bold ${(Number(totals.finalAmount) || 0) - ((Number(cashPaidAmount) || 0) + (Number(posPaidAmount) || 0)) > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
                    {Math.max(0, (Number(totals.finalAmount) || 0) - ((Number(cashPaidAmount) || 0) + (Number(posPaidAmount) || 0))).toLocaleString()} ریال
                  </span>
                </span>
              </div>
              {settlementCheques.length > 0 && (
                <div className="bg-indigo-50 p-2 rounded-lg border border-indigo-100 flex items-center justify-between font-sans text-[10px] text-indigo-700">
                  <span>تعداد {settlementCheques.length} فقره چک به مبلغ {settlementCheques.reduce((s, c) => s + c.amount, 0).toLocaleString()} ریال ثبت شد.</span>
                  <button type="button" onClick={() => setShowCheckCalculator(true)} className="underline font-bold">ویرایش چک‌ها</button>
                </div>
              )}
            </div>
          )}
        </div>

        {showCheckCalculator && (
          <CheckSettlementCalculator
            remainingAmount={isNaN((Number(totals.finalAmount) || 0) - ((Number(cashPaidAmount) || 0) + (Number(posPaidAmount) || 0))) ? 0 : (Number(totals.finalAmount) || 0) - ((Number(cashPaidAmount) || 0) + (Number(posPaidAmount) || 0))}
            personId={personId}
            persons={persons}
            state={appState}
            onConfirm={(cheques, commission) => {
              setSettlementCheques(cheques);
              setSettlementCommission(commission);
              setShowCheckCalculator(false);
              setIsSettledWithChecks(true);
              setIsInstallmentDeferred(true); // Automatically set to installment if checks are used
            }}
            onCancel={() => {
              setShowCheckCalculator(false);
              if (settlementCheques.length === 0) setIsSettledWithChecks(false);
            }}
          />
        )}

        {/* Global Inventory Warning */}
        {negativeStockItems.length > 0 && !isViewModeActive && (
          <div className="bg-rose-600 border-2 border-rose-400 p-5 rounded-2xl flex items-start gap-4 animate-bounce shadow-xl">
            <div className="bg-white p-2.5 rounded-full text-rose-600 shadow-lg shrink-0">
              <AlertCircle size={24} className="stroke-[3px]" />
            </div>
            <div className="flex-1 text-right">
              <h4 className="font-sans text-sm font-extrabold text-white">⚠️ هشدار بسیار مهم: موجودی منفی انبار!</h4>
              <p className="font-sans text-xs text-rose-50 mt-1.5 font-bold leading-relaxed">
                تعداد اقلام انتخابی در {negativeStockItems.length} ردیف، بیشتر از کل موجودی انبار شماست. ثبت این فاکتور باعث بروز اختلال در تراز کالا و موجودی فیزیکی می‌شود.
              </p>
            </div>
          </div>
        )}

        {/* Actions Bar */}
        <div className="pt-2 space-y-3">
          {isViewModeActive ? (
            <div className="space-y-3">
              {showConfirmDelete ? (
                <div className="bg-red-50 p-4 rounded-2xl border border-red-150 space-y-3 w-full text-right animate-in fade-in slide-in-from-top-2 duration-200">
                  <p className="text-xs font-sans text-red-800 font-bold leading-relaxed">
                    ⚠️ آیا از حذف این فاکتور مطمئن هستید؟ با حذف فاکتور، تمامی اسناد حسابداری و سوابق مالی مرتبط نیز حذف خواهند شد.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onDelete && onDelete(initialInvoice!.id)}
                      className="flex-1 bg-red-600 hover:bg-red-500 text-white font-sans text-xs font-bold py-2.5 rounded-xl transition shadow-lg shadow-red-500/20"
                    >
                      بله، حذف شود
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowConfirmDelete(false)}
                      className="flex-1 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-sans text-xs font-bold py-2.5 rounded-xl transition"
                    >
                      انصراف
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {onUpdate && (
                      <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-sans text-xs font-bold py-3 rounded-xl shadow-md transition flex items-center justify-center gap-1.5"
                      >
                        <RefreshCw size={14} />
                        ویرایش فاکتور
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => setShowConfirmDelete(true)}
                        className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-sans text-xs font-bold py-3 rounded-xl transition flex items-center justify-center gap-1.5"
                      >
                        <Trash2 size={14} />
                        حذف فاکتور
                      </button>
                    )}
                  </div>

                  {onNew && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onNew('buy')}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-[11px] sm:text-xs font-extrabold py-3.5 rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 border-2 border-emerald-500/20"
                      >
                        <Plus size={16} className="stroke-[3px]" />
                        فاکتور خرید جدید
                      </button>
                      <button
                        type="button"
                        onClick={() => onNew('sell')}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-[11px] sm:text-xs font-extrabold py-3.5 rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 border-2 border-emerald-500/20"
                      >
                        <Plus size={16} className="stroke-[3px]" />
                        فاکتور فروش جدید
                      </button>
                    </div>
                  )}
                </>
              )}

              {type === 'buy' && hasMobileProduct && (
                <button
                  type="button"
                  onClick={() => setShowEvaluationModal(true)}
                  className="w-full bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 hover:from-indigo-500 hover:to-blue-500 text-white font-sans text-xs font-bold py-3 rounded-xl shadow-md transition duration-200 flex items-center justify-center space-x-2 space-x-reverse mb-2"
                >
                  <TrendingUp size={15} />
                  <span>ارزیابی و کارنامه مقایسه‌ای فاکتور (IMEI)</span>
                </button>
              )}

              {isProInvoice && onConvertToReal && (
                <button
                  type="button"
                  onClick={() => onConvertToReal(initialInvoice!.id)}
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-sans text-xs font-bold py-3 rounded-xl shadow-md transition duration-200 flex items-center justify-center space-x-2 space-x-reverse"
                >
                  <RefreshCw size={15} className="animate-spin-slow" />
                  <span>تبدیل فوری به فاکتور قطعی و سندزنی</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="flex space-x-2 space-x-reverse">
                <button
                  type="submit"
                  className={`flex-1 font-sans text-xs font-bold py-3 rounded-xl shadow-md transition-all duration-200 flex items-center justify-center space-x-1.5 space-x-reverse ${
                    isFormValid 
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20 active:scale-[0.98]' 
                      : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
                  }`}
                >
                  <Save size={15} />
                  <span>{initialInvoice ? 'ذخیره اصلاحات فاکتور' : 'ثبت و ذخیره فاکتور'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (initialInvoice && isEditing) {
                      setIsEditing(false);
                    } else {
                      onCancel();
                    }
                  }}
                  className="px-6 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-sans text-xs font-semibold py-3 rounded-xl transition"
                >
                  {initialInvoice && isEditing ? 'انصراف از ویرایش' : 'انصراف'}
                </button>
              </div>
              
              {safetyLockStatus.locked && (
                <div className="bg-rose-50 text-rose-700 text-[10px] font-bold py-3 px-4 rounded-xl flex flex-col gap-2 border border-rose-100 mb-2 text-right" dir="rtl">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className="shrink-0 text-rose-600 animate-pulse" />
                    <span>{safetyLockStatus.reason}</span>
                  </div>
                  {personId && (safetyLockStatus.reason.includes('کارتن') || safetyLockStatus.reason.includes('سند') || safetyLockStatus.reason.includes('امانت') || safetyLockStatus.reason.includes('تعهدات') || safetyLockStatus.reason.includes('مالکیت')) && (
                    <button
                      type="button"
                      onClick={() => setShowCriticalPanel(true)}
                      className="mt-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[10px] font-sans font-bold self-start transition-colors shadow-sm flex items-center gap-1"
                    >
                      ✏️ تعیین تکلیف و تغییر وضعیت امانی (کارتن / سند)
                    </button>
                  )}
                </div>
              )}

              {!isFormValid && (
                <div className="bg-red-50 text-red-700 text-[10px] font-bold py-2 px-3 rounded-lg flex items-center justify-center space-x-1 space-x-reverse border border-red-100 animate-pulse text-center">
                  <AlertCircle size={13} className="shrink-0" />
                  <span>جهت ذخیره، لطفاً نام طرف حساب و مشخصات کامل اقلام فاکتور (کالا و تعداد) را تکمیل کنید.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </form>

      <AnimatePresence>
        {activeSerialRow !== null && (
          <SerialNumbersModal
            productName={products.find(p => p.id === items[activeSerialRow].productId)?.name || 'کالای ناشناس'}
            expectedQuantity={items[activeSerialRow].quantity || 1}
            initialSerials={items[activeSerialRow].serialNumbers || []}
            isSellMode={type === 'sell'}
            appState={appState}
            productId={items[activeSerialRow].productId}
            type={type}
            excludeId={initialInvoice?.id}
            onClose={() => setActiveSerialRow(null)}
            onSave={(newSerials) => {
              handleRowChange(activeSerialRow, 'serialNumbers', newSerials);
              if (newSerials.length > 0) {
                handleRowChange(activeSerialRow, 'quantity', newSerials.length);
              }
              setActiveSerialRow(null);
            }}
          />
        )}
      </AnimatePresence>

      {showEvaluationModal && evaluationData && (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-zinc-100 flex flex-col animate-in zoom-in-95 duration-200" dir="rtl text-right">
            {/* Header */}
            <div className="p-5 border-b border-zinc-150 flex items-center justify-between sticky top-0 bg-white z-10">
              <button 
                onClick={() => setShowEvaluationModal(false)}
                className="text-zinc-400 hover:text-zinc-600 p-1"
              >
                <X size={18} />
              </button>
              <div className="flex items-center space-x-2 space-x-reverse text-right">
                <Sparkles size={16} className="text-indigo-600" />
                <span className="font-sans text-sm font-bold text-zinc-800">کارنامه مقایسه‌ای و ارزیابی فاکتور خرید</span>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6 text-right font-sans">
              {/* Highlights Card */}
              <div className="bg-gradient-to-br from-indigo-50/50 to-blue-50/50 rounded-2xl p-4 border border-indigo-100 space-y-3.5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-3 rounded-xl border border-indigo-50 text-center">
                    <span className="text-[10px] text-zinc-500 block">تعداد کل سریال‌ها (IMEI)</span>
                    <span className="font-mono text-base font-bold text-zinc-800">{evaluationData.totalSerialsCount} عدد</span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-indigo-50 text-center">
                    <span className="text-[10px] text-zinc-500 block">فروخته شده / ردیابی شده</span>
                    <span className="font-mono text-base font-bold text-emerald-600">{evaluationData.soldCount} عدد</span>
                  </div>
                </div>

                <div className="h-px bg-indigo-100/50 my-2" />

                <div className="flex justify-between text-xs">
                  <span className="font-mono font-bold text-zinc-800">{evaluationData.totalCostOfSerials.toLocaleString()} ریال</span>
                  <span className="text-zinc-500">بهای تمام‌شده سریال‌های فروش‌رفته:</span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="font-mono font-bold text-zinc-800">{evaluationData.totalRevenueFromSerials.toLocaleString()} ریال</span>
                  <span className="text-zinc-500">مجموع فروش حاصله از سریال‌ها:</span>
                </div>

                <div className="h-px bg-indigo-100/50 my-2" />

                {/* Profit Calculations */}
                <div className="flex justify-between text-xs font-bold text-emerald-700">
                  <span className="font-mono">{evaluationData.grossProfit.toLocaleString()} ریال</span>
                  <span>سود ناخالص واقعی:</span>
                </div>

                <div className="flex justify-between text-xs font-bold text-zinc-700">
                  <span className="font-mono">{evaluationData.profitPercentOfInvoice.toFixed(2)}٪</span>
                  <span>بازدهی سود از کل فاکتور:</span>
                </div>

                {/* Operational Expense Rate setting */}
                {operatingCostRate !== undefined && (
                  <div className="bg-amber-50/50 p-2.5 rounded-xl border border-dashed border-amber-200 space-y-1 mt-2">
                    <div className="flex justify-between text-[11px] text-amber-800">
                      <span className="font-mono font-semibold">{(operatingCostRate || 0)}٪</span>
                      <span>نرخ هزینه عملیاتی پیش‌فرض:</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-amber-900 font-bold">
                      <span className="font-mono">
                        {Math.round(initialInvoice!.totalAmount * ((operatingCostRate || 0) / 100)).toLocaleString()} ریال
                      </span>
                      <span>هزینه عملیاتی کسر شده:</span>
                    </div>
                    <div className="h-px bg-amber-200/50 my-1" />
                    <div className="flex justify-between text-xs text-amber-950 font-bold">
                      <span className="font-mono">
                        {(evaluationData.grossProfit - Math.round(initialInvoice!.totalAmount * ((operatingCostRate || 0) / 100))).toLocaleString()} ریال
                      </span>
                      <span>سود خالص واقعی تخمینی:</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Manager Rate Comparison */}
              <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-150 space-y-2.5 text-right">
                <div className="flex justify-between text-xs">
                  <span className="font-mono font-semibold text-indigo-700">
                    {evaluationData.managerRate}%
                  </span>
                  <span className="text-zinc-600">نرخ آنالیز اولیه مدیر خرید:</span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="font-mono font-semibold text-emerald-700">
                    {evaluationData.profitPercentOfInvoice.toFixed(2)}%
                  </span>
                  <span className="text-zinc-600">درصد سود واقعی تحقق‌یافته:</span>
                </div>

                <div className="h-px bg-zinc-200 my-1.5" />

                <div className="flex items-center space-x-2 space-x-reverse justify-end">
                  <span className="text-xs font-bold">ارزیابی نهایی انحراف:</span>
                  {evaluationData.diffRate >= 0 ? (
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-1 rounded-full font-bold flex items-center gap-1">
                      <TrendingUp size={12} />
                      {(evaluationData.diffRate).toFixed(2)}٪ بالاتر از پیش‌بینی
                    </span>
                  ) : (
                    <span className="bg-rose-100 text-rose-800 text-[10px] px-2 py-1 rounded-full font-bold flex items-center gap-1">
                      <AlertCircle size={12} />
                      {Math.abs(evaluationData.diffRate).toFixed(2)}٪ پایین‌تر از پیش‌بینی
                    </span>
                  )}
                </div>
              </div>

              {/* Tracking serials list */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-zinc-700 block mb-1">رهگیری وضعیت سریال‌ها (IMEI)</span>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {evaluationData.trackingDetails.map((det, idx) => (
                    <div key={idx} className="bg-white p-2.5 rounded-xl border border-zinc-150 flex items-center justify-between text-xs" dir="rtl">
                      <div className="text-right">
                        <span className="font-bold text-zinc-800 block text-[11px]">{det.serial}</span>
                        <span className="text-[10px] text-zinc-400">{det.productName}</span>
                      </div>
                      <div className="text-left font-mono">
                        {det.isSold ? (
                          <div className="space-y-0.5">
                            <span className="text-emerald-600 font-bold block text-left">فروخته شده</span>
                            <div className="text-[10px] text-zinc-400 text-left">سود: {det.profit.toLocaleString()} ریال</div>
                          </div>
                        ) : (
                          <span className="text-zinc-400 font-medium block text-left">در انبار موجود</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex justify-end rounded-b-3xl">
              <button 
                onClick={() => setShowEvaluationModal(false)}
                className="px-6 py-2 bg-zinc-800 text-white hover:bg-zinc-700 rounded-xl font-bold text-xs shadow-md transition"
              >
                بستن گزارش
              </button>
            </div>
          </div>
        </div>
      )}

      {showCriticalInquiry && (
        <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl border border-zinc-100 flex flex-col animate-in zoom-in-95 duration-200" dir="rtl">
              <div className="p-5 border-b border-zinc-150 flex items-center justify-between">
                  <span className="font-sans text-sm font-bold text-zinc-800">تعیین وضعیت اقلام امانی و ضمانت</span>
                  <Sparkles size={16} className="text-amber-600" />
              </div>
              <div className="p-6 space-y-5 text-right font-sans">
                  <div className="space-y-2">
                      <label className="block text-[11px] font-bold text-zinc-500">وضعیت کارتن گوشی</label>
                      <select 
                          value={phoneBoxStatus}
                          onChange={(e) => setPhoneBoxStatus(e.target.value as any)}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-xs"
                      >
                          <option value="none">نامشخص / ندارد</option>
                          <option value="at_store">نزد فروشگاه (امانت)</option>
                          <option value="delivered">تحویل به مشتری</option>
                      </select>
                  </div>
                  <div className="space-y-2">
                      <label className="block text-[11px] font-bold text-zinc-500">وضعیت مالکیت و انتقال</label>
                      <select 
                          value={ownershipStatus}
                          onChange={(e) => setOwnershipStatus(e.target.value as any)}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-xs"
                      >
                          <option value="none">نامشخص</option>
                          <option value="at_store">سند نزد فروشگاه</option>
                          <option value="delivered">انتقال داده شده</option>
                      </select>
                  </div>
                  <div className="space-y-2">
                      <label className="block text-[11px] font-bold text-zinc-500">وضعیت چک ضمانت</label>
                      <select 
                          value={guaranteeCheckStatus}
                          onChange={(e) => setGuaranteeCheckStatus(e.target.value as any)}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-xs"
                      >
                          <option value="none">ندارد</option>
                          <option value="at_store">نزد فروشگاه</option>
                          <option value="delivered">عودت داده شده</option>
                      </select>
                  </div>
              </div>
              <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex gap-2 rounded-b-3xl">
                  <button 
                      onClick={() => performSubmit(true)}
                      className="flex-1 py-3 bg-emerald-600 text-white hover:bg-emerald-500 rounded-xl font-bold text-xs shadow-md transition"
                  >
                      تایید و ثبت نهایی فاکتور
                  </button>
                  <button 
                      onClick={() => setShowCriticalInquiry(false)}
                      className="px-6 py-3 bg-zinc-200 text-zinc-700 rounded-xl font-bold text-xs"
                  >
                      انصراف
                  </button>
              </div>
          </div>
        </div>
      )}
      {showCriticalPanel && personId && (
        <CriticalStatusPanel
          person={persons.find(p => p.id === personId)!}
          appState={appState}
          onClose={() => setShowCriticalPanel(false)}
          onUpdateNotes={(notes) => {
            const customEvent = new CustomEvent('update_person_critical', {
              detail: { id: personId, criticalDetails: { manualNotes: notes } }
            });
            window.dispatchEvent(customEvent);
          }}
          onUpdateStatus={(status) => {
            const customEvent = new CustomEvent('update_person_critical', {
              detail: { id: personId, criticalDetails: status }
            });
            window.dispatchEvent(customEvent);
          }}
        />
      )}

      {scanningRowIndex !== null && (
        <BarcodeScanner
          onScan={(barcode) => {
            handleRowChange(scanningRowIndex, 'serialNumbers', [barcode]);
            setScanningRowIndex(null);
          }}
          onClose={() => setScanningRowIndex(null)}
        />
      )}

      {pendingConfirm && (
        <div className="fixed inset-0 bg-zinc-950/60 backdrop-blur-xs z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl border border-zinc-150 flex flex-col p-6 animate-in zoom-in-95 duration-200" dir="rtl">
            <h3 className="font-sans text-sm font-bold text-zinc-900 text-right mb-2">{pendingConfirm.title}</h3>
            <p className="font-sans text-xs text-zinc-600 text-right leading-relaxed whitespace-pre-line mb-6">{pendingConfirm.message}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={pendingConfirm.onConfirm}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-md transition-colors"
              >
                تایید و ادامه
              </button>
              <button
                onClick={pendingConfirm.onCancel}
                className="px-6 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-xl text-xs font-semibold transition-colors"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAlert && (
        <div className="fixed inset-0 bg-zinc-950/60 backdrop-blur-xs z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl border border-zinc-150 flex flex-col p-6 animate-in zoom-in-95 duration-200" dir="rtl">
            <h3 className="font-sans text-sm font-bold text-zinc-900 text-right mb-2">{pendingAlert.title}</h3>
            <p className="font-sans text-xs text-zinc-600 text-right leading-relaxed whitespace-pre-line mb-6">{pendingAlert.message}</p>
            <button
              onClick={pendingAlert.onClose}
              className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
            >
              متوجه شدم
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
