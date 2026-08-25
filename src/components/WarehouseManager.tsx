import React, { useState, useEffect } from 'react';
import { Warehouse, WarehouseTransfer, Product, AccountSubsidiary } from '../types';
import { Warehouse as WarehouseIcon, ArrowLeftRight, Plus, MapPin, Trash2, Edit2, CheckCircle2, Star, ShieldAlert, BookOpen, RotateCcw } from 'lucide-react';
import { getCurrentJalaliDate, normalizeJalaliDate, validateJalaliDate } from '../utils/jalali';
import { WarehouseService } from '../services/warehouseService';

export interface WarehouseAccountMappingUI {
  id: string;
  organizationId: string;
  warehouseId: string;
  warehouseName?: string;
  subsidiaryId: string;
  subsidiaryCode?: string;
  subsidiaryName?: string;
  effectiveFrom: string;
  status: 'CURRENT' | 'EXPIRED' | 'PLANNED' | 'CANCELLED';
  changeReason?: string | null;
}

interface WarehouseManagerProps {
  warehouses: Warehouse[];
  onAddWarehouse: (w: Partial<Warehouse>) => Promise<void> | void;
  onDeleteWarehouse: (id: string) => Promise<void> | void;
  onUpdateWarehouse: (w: Warehouse) => Promise<void> | void;
  onSetDefaultWarehouse?: (id: string) => Promise<void> | void;
  products: Product[];
  currentStocks: any;
  onTransfer: (transfer: WarehouseTransfer & { serialNumbers?: string[] }) => void;
  onReverseTransfer?: (transactionId: string, reason: string) => Promise<void> | void;
  subsidiaries?: AccountSubsidiary[];
  transfers?: any[];
  currentUserPermissions?: string[];
}

export function WarehouseManager({ 
  warehouses, 
  onAddWarehouse, 
  onDeleteWarehouse,
  onUpdateWarehouse,
  onSetDefaultWarehouse,
  products,
  currentStocks,
  onTransfer,
  onReverseTransfer,
  subsidiaries = [],
  transfers = [],
  currentUserPermissions = []
}: WarehouseManagerProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newLoc, setNewLoc] = useState('');
  const [newIsDefault, setNewIsDefault] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingWh, setEditingWh] = useState<Warehouse | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editLoc, setEditLoc] = useState('');

  // Account Mappings State
  const [accountMappings, setAccountMappings] = useState<WarehouseAccountMappingUI[]>([]);
  const [editingMappingWhId, setEditingMappingWhId] = useState<string | null>(null);
  const [selectedSubForWh, setSelectedSubForWh] = useState<Record<string, string>>({});
  const [changeReasonForWh, setChangeReasonForWh] = useState<Record<string, string>>({});
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [mappingError, setMappingError] = useState('');

  // Internal Transfer State
  const [showTransfer, setShowTransfer] = useState(false);
  const [fromWh, setFromWh] = useState('');
  const [toWh, setToWh] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [transferQty, setTransferQty] = useState(0);
  const [transferDate, setTransferDate] = useState(getCurrentJalaliDate());

  // Serialized Product State
  const [availableSerials, setAvailableSerials] = useState<Array<{ id: string; serialNumber: string; status: string }>>([]);
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [isLoadingSerials, setIsLoadingSerials] = useState(false);

  // Load account mappings on component mount
  useEffect(() => {
    let isMounted = true;
    WarehouseService.getAccountMappings()
      .then(data => {
        if (isMounted) {
          setAccountMappings(data || []);
        }
      })
      .catch(err => {
        console.error('Error fetching warehouse account mappings:', err);
      });
    return () => { isMounted = false; };
  }, [warehouses]);

  const selectedProdObj = products.find(p => p.id === selectedProduct);
  const isSerializedProduct = Boolean(
    selectedProdObj && (selectedProdObj.isSerialized || (selectedProdObj as any).is_serialized || (selectedProdObj as any).hasSerial)
  );

  // Load available serials when source warehouse or selected product changes
  useEffect(() => {
    if (fromWh && selectedProduct && isSerializedProduct) {
      setIsLoadingSerials(true);
      WarehouseService.getProductSerials(fromWh, selectedProduct)
        .then(res => {
          setAvailableSerials(res || []);
          setSelectedSerials([]);
          setTransferQty(0);
        })
        .catch(err => {
          console.error('Error fetching product serials:', err);
          setAvailableSerials([]);
          setSelectedSerials([]);
          setTransferQty(0);
        })
        .finally(() => {
          setIsLoadingSerials(false);
        });
    } else {
      setAvailableSerials([]);
      setSelectedSerials([]);
    }
  }, [fromWh, selectedProduct, isSerializedProduct]);

  const toggleSerial = (sn: string) => {
    setSelectedSerials(prev => {
      const exists = prev.includes(sn);
      const next = exists ? prev.filter(x => x !== sn) : [...prev, sn];
      setTransferQty(next.length);
      return next;
    });
  };

  const fromMapping = accountMappings.find(m => m.warehouseId === fromWh && m.status === 'CURRENT');
  const toMapping = accountMappings.find(m => m.warehouseId === toWh && m.status === 'CURRENT');
  const hasValidMappings = Boolean(fromMapping && toMapping);

  const handleAdd = async () => {
    if (!newName.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onAddWarehouse({
        name: newName.trim(),
        code: newCode.trim() || undefined,
        location: newLoc.trim() || undefined,
        isDefault: newIsDefault || warehouses.length === 0,
      });
      setNewName('');
      setNewCode('');
      setNewLoc('');
      setNewIsDefault(false);
      setShowAdd(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingWh || !editName.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onUpdateWarehouse({
        ...editingWh,
        name: editName.trim(),
        code: editCode.trim() || editingWh.code,
        location: editLoc.trim() || undefined
      });
      setEditingWh(null);
      setEditName('');
      setEditCode('');
      setEditLoc('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveMapping = async (warehouseId: string) => {
    const selectedSubId = selectedSubForWh[warehouseId];
    if (!selectedSubId) {
      setMappingError('لطفاً یک حساب معین انتخاب کنید.');
      return;
    }
    setIsSavingMapping(true);
    setMappingError('');
    try {
      await WarehouseService.setAccountMapping(
        warehouseId, 
        selectedSubId, 
        changeReasonForWh[warehouseId] || 'تعیین حساب معین موجودی انبار'
      );
      // Re-fetch mappings strictly AFTER server response
      const freshMappings = await WarehouseService.getAccountMappings();
      setAccountMappings(freshMappings);
      setEditingMappingWhId(null);
    } catch (err: any) {
      console.error('Error setting account mapping:', err);
      setMappingError(err.message || 'خطا در ثبت نگاشت حساب معین انبار');
    } finally {
      setIsSavingMapping(false);
    }
  };

  const handleTransferSubmit = () => {
    if (!fromWh || !toWh || !selectedProduct) return;
    if (!hasValidMappings) {
      alert('انبار مبدأ یا مقصد فاقد نگاشت حساب معین موجودی است.');
      return;
    }

    const finalQty = isSerializedProduct ? selectedSerials.length : transferQty;
    if (finalQty <= 0) {
      alert(isSerializedProduct ? 'لطفاً حداقل یک شماره سریال انتخاب کنید.' : 'مقدار انتقال باید بزرگتر از صفر باشد.');
      return;
    }

    const normalizedTransferDate = normalizeJalaliDate(transferDate);
    if (!validateJalaliDate(normalizedTransferDate)) {
      alert(`تاریخ انتقال وارد شده (${transferDate}) نامعتبر است. لطفاً تاریخ صحیح شمسی را به صورت YYYY/MM/DD وارد کنید.`);
      return;
    }
    setTransferDate(normalizedTransferDate);

    onTransfer({
      id: crypto.randomUUID(),
      fromWarehouseId: fromWh,
      toWarehouseId: toWh,
      items: [{ 
        productId: selectedProduct, 
        quantity: finalQty,
        serialNumbers: isSerializedProduct ? selectedSerials : undefined
      }],
      date: normalizedTransferDate,
      description: `انتقال داخلی بین انبارها`
    } as any);

    setShowTransfer(false);
    setSelectedProduct('');
    setTransferQty(0);
    setSelectedSerials([]);
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Warehouses List & Account Mappings */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <WarehouseIcon size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">مدیریت اطلاعات پایه و حساب معین انبارها</h2>
              <p className="text-xs text-gray-500 mt-0.5">مشاهده و نگاشت حساب معین موجودی کالا برای هر انبار</p>
            </div>
          </div>
          <button 
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus size={18} />
            <span>تعریف انبار جدید</span>
          </button>
        </div>

        {mappingError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <ShieldAlert size={16} />
            <span>{mappingError}</span>
          </div>
        )}

        {showAdd && (
          <div className="mb-8 p-4 bg-gray-50 rounded-xl border border-dashed border-gray-200 animate-in fade-in slide-in-from-top-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">نام انبار <span className="text-red-500">*</span></label>
                <input 
                  placeholder="نام انبار (مثلاً: انبار مرکزی)"
                  className="w-full p-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">کد انبار (اختیاری - خودکار)</label>
                <input 
                  placeholder="کد یکتا (تولید خودکار در صورت خالی بودن)"
                  className="w-full p-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none bg-white font-mono"
                  value={newCode}
                  onChange={e => setNewCode(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">موقعیت مکانی / آدرس</label>
                <input 
                  placeholder="موقعیت مکانی / آدرس انبار"
                  className="w-full p-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={newLoc}
                  onChange={e => setNewLoc(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-gray-200">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={newIsDefault}
                  onChange={e => setNewIsDefault(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span>تعیین به عنوان انبار پیش‌فرض</span>
              </label>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowAdd(false)} 
                  disabled={isSubmitting}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  انصراف
                </button>
                <button 
                  onClick={handleAdd} 
                  disabled={isSubmitting || !newName.trim()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold disabled:opacity-50"
                >
                  {isSubmitting ? 'در حال ثبت...' : 'تایید و ثبت انبار'}
                </button>
              </div>
            </div>
          </div>
        )}

        {editingWh && (
          <div className="mb-8 p-4 bg-blue-50/40 rounded-xl border border-dashed border-blue-200 animate-in fade-in slide-in-from-top-4">
            <h4 className="text-sm font-bold text-blue-800 mb-3">ویرایش اطلاعات انبار: {editingWh.name}</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">نام انبار <span className="text-red-500">*</span></label>
                <input 
                  placeholder="نام انبار"
                  className="w-full p-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">کد انبار</label>
                <input 
                  placeholder="کد انبار"
                  className="w-full p-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none bg-white font-mono"
                  value={editCode}
                  onChange={e => setEditCode(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">موقعیت مکانی / آدرس</label>
                <input 
                  placeholder="موقعیت مکانی / آدرس"
                  className="w-full p-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={editLoc}
                  onChange={e => setEditLoc(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setEditingWh(null)} 
                disabled={isSubmitting}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                انصراف
              </button>
              <button 
                onClick={handleUpdate} 
                disabled={isSubmitting || !editName.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold disabled:opacity-50"
              >
                {isSubmitting ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {warehouses.map(wh => {
            const currentMap = accountMappings.find(m => m.warehouseId === wh.id && m.status === 'CURRENT');
            const isEditingThisMapping = editingMappingWhId === wh.id;

            return (
              <div key={wh.id} className="p-5 border rounded-2xl relative group hover:border-blue-300 hover:shadow-md transition-all bg-white flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-3 bg-gray-50 text-gray-600 rounded-xl group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                      <WarehouseIcon size={24} />
                    </div>
                    <div className="flex items-center gap-1">
                      {!wh.isDefault && onSetDefaultWarehouse && (
                        <button 
                          onClick={() => onSetDefaultWarehouse(wh.id)}
                          className="p-2 text-amber-500 hover:bg-amber-50 hover:text-amber-600 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          title="تنظیم به عنوان انبار پیش‌فرض"
                        >
                          <Star size={16} />
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          setEditingWh(wh);
                          setEditName(wh.name);
                          setEditCode(wh.code || '');
                          setEditLoc(wh.location || '');
                        }}
                        className="p-2 text-blue-500 hover:bg-blue-50 hover:text-blue-600 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        title="ویرایش انبار"
                      >
                        <Edit2 size={16} />
                      </button>
                      {!wh.isDefault && (
                        <button 
                          onClick={() => onDeleteWarehouse(wh.id)}
                          className="p-2 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          title="غیرفعال‌سازی انبار"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold text-gray-800 text-lg">{wh.name}</h3>
                    {wh.code && (
                      <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        {wh.code}
                      </span>
                    )}
                  </div>

                  {wh.location && (
                    <div className="flex items-center gap-1 text-xs text-gray-400 mb-3">
                      <MapPin size={12} />
                      <span>{wh.location}</span>
                    </div>
                  )}

                  {/* Current Account Subsidiary Mapping Info */}
                  <div className="my-3 p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                      <span className="flex items-center gap-1 text-slate-700 font-bold">
                        <BookOpen size={13} className="text-blue-600" />
                        حساب معین موجودی انبار:
                      </span>
                      <button
                        onClick={() => {
                          setEditingMappingWhId(isEditingThisMapping ? null : wh.id);
                          if (currentMap) {
                            setSelectedSubForWh(prev => ({ ...prev, [wh.id]: currentMap.subsidiaryId }));
                          }
                        }}
                        className="text-blue-600 hover:underline text-[11px] font-bold"
                      >
                        {isEditingThisMapping ? 'انصراف' : (currentMap ? 'تغییر نگاشت' : 'تعیین نگاشت')}
                      </button>
                    </div>

                    {currentMap ? (
                      <div className="text-xs font-bold text-slate-800 font-mono">
                        {currentMap.subsidiaryCode ? `${currentMap.subsidiaryCode} - ` : ''}
                        {currentMap.subsidiaryName || 'حساب معین اختصاصی'}
                      </div>
                    ) : (
                      <div className="text-xs text-rose-600 font-semibold flex items-center gap-1">
                        <ShieldAlert size={12} />
                        <span>فاقد نگاشت حساب معین (جهت انتقال الزامی است)</span>
                      </div>
                    )}

                    {/* Inline Mapping Selection Form */}
                    {isEditingThisMapping && (
                      <div className="mt-2 pt-2 border-t border-slate-200 space-y-2">
                        <select
                          className="w-full p-2 text-xs rounded-lg border bg-white focus:ring-2 focus:ring-blue-500"
                          value={selectedSubForWh[wh.id] || ''}
                          onChange={e => setSelectedSubForWh(prev => ({ ...prev, [wh.id]: e.target.value }))}
                        >
                          <option value="">انتخاب حساب معین موجودی...</option>
                          {subsidiaries.map(sub => (
                            <option key={sub.id} value={sub.id}>
                              {sub.code} - {sub.name} ({sub.generalType || 'معین'})
                            </option>
                          ))}
                        </select>

                        <input 
                          placeholder="علت تغییر نگاشت (اختیاری)"
                          className="w-full p-2 text-xs rounded-lg border bg-white"
                          value={changeReasonForWh[wh.id] || ''}
                          onChange={e => setChangeReasonForWh(prev => ({ ...prev, [wh.id]: e.target.value }))}
                        />

                        <button
                          onClick={() => handleSaveMapping(wh.id)}
                          disabled={isSavingMapping || !selectedSubForWh[wh.id]}
                          className="w-full py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
                        >
                          {isSavingMapping ? 'در حال ثبت نگاشت...' : 'ذخیره نگاشت حساب معین'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-100">
                  {wh.isDefault ? (
                    <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full font-bold inline-flex items-center gap-1">
                      <CheckCircle2 size={12} />
                      انبار پیش‌فرض
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-400">
                      انبار فرعی
                    </span>
                  )}
                  {wh.status === 'INACTIVE' && (
                    <span className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-bold">
                      غیرفعال
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {warehouses.length === 0 && (
            <div className="col-span-full p-12 text-center text-gray-400 italic">هیچ انباری در پایگاه‌داده تعریف نشده است.</div>
          )}
        </div>
      </div>

      {/* Internal Transfer */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
              <ArrowLeftRight size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">انتقال داخلی بین انبارها همراه با سند اتمیک</h2>
              <p className="text-xs text-gray-500 mt-0.5">انتقال اتمیک موجودی و صدور سند بدهکار انبار مقصد / بستانکار انبار مبدأ</p>
            </div>
          </div>
          <button 
            onClick={() => setShowTransfer(!showTransfer)}
            className="text-orange-600 hover:bg-orange-50 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
          >
            {showTransfer ? 'انصراف' : 'ثبت انتقال جدید'}
          </button>
        </div>

        {showTransfer && (
          <div className="p-6 bg-orange-50/30 border border-orange-100 rounded-2xl space-y-4 animate-in fade-in zoom-in-95">
            {/* Warning Banner if missing account mapping */}
            {fromWh && toWh && !hasValidMappings && (
              <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-bold flex items-center gap-2">
                <ShieldAlert size={18} className="text-amber-600 shrink-0" />
                <div>
                  <p>انبار مبدأ یا مقصد فاقد نگاشت حساب معین موجودی فعال است.</p>
                  <p className="text-[11px] font-normal text-amber-700 mt-0.5">
                    جهت صدور سند اتمیک حسابداری، باید ابتدا برای هر دو انبار مبدأ و مقصد حساب معین معتبر تعیین شود.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-gray-500 mr-2">از انبار (مبدأ):</label>
                <select 
                  className="w-full p-3 rounded-lg border bg-white"
                  value={fromWh}
                  onChange={e => setFromWh(e.target.value)}
                >
                  <option value="">انتخاب انبار مبدأ</option>
                  {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500 mr-2">به انبار (مقصد):</label>
                <select 
                  className="w-full p-3 rounded-lg border bg-white"
                  value={toWh}
                  onChange={e => setToWh(e.target.value)}
                >
                  <option value="">انتخاب انبار مقصد</option>
                  {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500 mr-2">کالا:</label>
                <select 
                  className="w-full p-3 rounded-lg border bg-white"
                  value={selectedProduct}
                  onChange={e => setSelectedProduct(e.target.value)}
                >
                  <option value="">انتخاب کالا</option>
                  {products.map(p => {
                    const stock = currentStocks[p.id]?.warehouseStocks[fromWh] || 0;
                    const isSer = p.isSerialized || (p as any).is_serialized || (p as any).hasSerial;
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} ({stock} موجود {p.unit || 'عدد'}) {isSer ? '🔒 سریال‌دار' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500 mr-2">تعداد انتقال:</label>
                {isSerializedProduct ? (
                  <div className="w-full p-3 rounded-lg border bg-slate-100 text-slate-700 font-mono font-bold text-center text-xs">
                    {selectedSerials.length} عدد (خودکار بر اساس سریال)
                  </div>
                ) : (
                  <input 
                    type="number"
                    inputMode="numeric"
                    className="w-full p-3 rounded-lg border bg-white font-mono"
                    value={transferQty}
                    onChange={e => {
                      const val = Number(e.target.value);
                      const maxStock = currentStocks[selectedProduct]?.warehouseStocks[fromWh] || 0;
                      setTransferQty(Math.min(val, maxStock));
                    }}
                  />
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500 mr-2">تاریخ انتقال:</label>
                <input 
                  type="text"
                  className="w-full p-3 rounded-lg border bg-white font-mono text-center"
                  value={transferDate}
                  onChange={e => setTransferDate(e.target.value)}
                />
              </div>
            </div>

            {/* Serial Selector for Serialized Products */}
            {isSerializedProduct && fromWh && selectedProduct && (
              <div className="p-4 bg-white border border-blue-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-bold text-blue-800">
                    انتخاب شماره سریال‌های کالای سریال‌دار در انبار مبدأ ({availableSerials.length} سریال موجود):
                  </span>
                  {isLoadingSerials && <span className="text-xs text-blue-500 animate-pulse">در حال دریافت سریال‌ها از سرور...</span>}
                </div>

                {availableSerials.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto p-1">
                    {availableSerials.map(s => {
                      const isChecked = selectedSerials.includes(s.serialNumber);
                      return (
                        <label 
                          key={s.id} 
                          className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors font-mono ${
                            isChecked ? 'bg-blue-50 border-blue-400 text-blue-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                        >
                          <input 
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSerial(s.serialNumber)}
                            className="rounded text-blue-600 focus:ring-blue-500"
                          />
                          <span>{s.serialNumber}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-rose-600 font-medium py-2">
                    {isLoadingSerials ? 'در حال بارگذاری...' : 'هیچ شماره سریال فعالی برای این کالا در انبار مبدأ یافت نشد.'}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button 
                onClick={handleTransferSubmit}
                disabled={
                  !fromWh || 
                  !toWh || 
                  fromWh === toWh ||
                  !selectedProduct || 
                  !hasValidMappings ||
                  (isSerializedProduct ? selectedSerials.length === 0 : transferQty <= 0)
                }
                className="px-8 py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 disabled:opacity-50 shadow-lg shadow-orange-200 transition-all"
              >
                ثبت جابجایی و صدور سند
              </button>
            </div>
          </div>
        )}

        {/* Transfers History Table */}
        {transfers.length > 0 && (
          <div className="mt-8 border-t pt-6 space-y-4">
            <h3 className="text-base font-bold text-slate-800">تاریخچه انتقال‌های داخلی بین انبارها</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-600 font-bold border-b">
                    <th className="p-3">شماره سند / مدرک</th>
                    <th className="p-3">تاریخ</th>
                    <th className="p-3">انبار مبدأ $\rightarrow$ انبار مقصد</th>
                    <th className="p-3">تعداد اقلام</th>
                    <th className="p-3">وضعیت</th>
                    <th className="p-3">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transfers.map(tr => {
                    const isReversed = tr.status === 'REVERSED';
                    return (
                      <tr key={tr.id} className={isReversed ? 'bg-slate-50 opacity-60' : 'hover:bg-slate-50'}>
                        <td className="p-3 font-mono font-bold text-slate-800">
                          {tr.document_number || tr.documentNumber || tr.id}
                        </td>
                        <td className="p-3 font-mono">{tr.transaction_date || tr.date || '-'}</td>
                        <td className="p-3 font-medium">
                          {tr.source_warehouse_name || tr.fromWarehouseId} $\rightarrow$ {tr.destination_warehouse_name || tr.toWarehouseId}
                        </td>
                        <td className="p-3 font-mono">
                          {Array.isArray(tr.inventory_transaction_items) ? tr.inventory_transaction_items.length : (tr.items?.length || 1)} قلم
                        </td>
                        <td className="p-3">
                          {isReversed ? (
                            <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-bold">برگشت داده شده</span>
                          ) : (
                            <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">ثبت نهایی (POSTED)</span>
                          )}
                        </td>
                        <td className="p-3">
                          {!isReversed && onReverseTransfer && (
                            <button
                              onClick={() => {
                                const reason = prompt('علت برگشت این انتقال را وارد کنید:');
                                if (reason && reason.trim()) {
                                  onReverseTransfer(tr.id, reason.trim());
                                }
                              }}
                              className="flex items-center gap-1 bg-rose-50 text-rose-600 hover:bg-rose-100 px-2.5 py-1 rounded-lg font-bold transition"
                            >
                              <RotateCcw size={12} />
                              <span>برگشت انتقال</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
