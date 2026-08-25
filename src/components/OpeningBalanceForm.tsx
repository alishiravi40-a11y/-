import { AnimatePresence } from "motion/react";
import SerialNumbersModal from "./SerialNumbersModal";
import React, { useState, useEffect } from 'react';
import { Package as PackageIcon, Plus, Trash2, Save, X, Calendar as CalendarIcon, User, Home } from 'lucide-react';
import { Product, OpeningBalance, OpeningBalanceItem, AppState } from '../types';
import ProductSelector from './ProductSelector';
import { validateSerialNumbers, parseNumericValue } from '../utils/accounting';

interface OpeningBalanceFormProps {
  initialData?: OpeningBalance;
  products: Product[];
  productCategories: string[];
  currentStocks: Record<string, number>;
  onAddCategory?: (category: string) => void;
  onCreateProduct: (name: string, category: string, unit: string, initialStock: number, reorderPoint: number, serialNumber?: string, defaultSalePrice?: number) => string;
  onSave: (ob: Omit<OpeningBalance, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
  nextNumber: number;
  appState: AppState;
}

const OpeningBalanceForm: React.FC<OpeningBalanceFormProps> = ({
  initialData,
  products,
  productCategories,
  currentStocks,
  onAddCategory,
  onCreateProduct,
  onSave,
  onCancel,
  nextNumber,
  appState
}) => {
  const [number, setNumber] = useState(nextNumber);
  const [date, setDate] = useState(new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [recordedBy, setRecordedBy] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<OpeningBalanceItem[]>([]);
  const [activeSerialRow, setActiveSerialRow] = useState<number | null>(null);

  useEffect(() => {
    if (initialData) {
      setNumber(initialData.number);
      setDate(initialData.date);
      setRecordedBy(initialData.recordedBy || '');
      setWarehouse(initialData.warehouse || '');
      setDescription(initialData.description || '');
      setItems([...initialData.items]);
    }
  }, [initialData]);

  const addItem = () => {
    setItems([...items, { productId: '', quantity: 1, unitCost: 0, discount: 0 }]);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const handleRowChange = (index: number, field: keyof OpeningBalanceItem, value: any) => {
    setItems(prev => {
      const updated = [...prev];
      
      if (field === 'productId') {
        updated[index] = { ...updated[index], productId: value };
        // Continuous Entry
        if (index === updated.length - 1 && value !== '') {
          updated.push({ productId: '', quantity: 1, unitCost: 0, discount: 0, serialNumbers: [] });
        }
      } else if (field === 'quantity' || field === 'unitCost' || field === 'discount' || field === 'serialNumbers') {
        updated[index] = { ...updated[index], [field]: field === 'serialNumbers' ? value : parseNumericValue(value) };
      } else {
        updated[index] = { ...updated[index], [field]: value };
      }
      
      return updated;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const activeItems = items.filter(it => it.productId);
    
    if (activeItems.length === 0) {
      alert('لطفاً حداقل یک کالا اضافه کنید');
      return;
    }
    if (activeItems.some(item => item.quantity <= 0)) {
      alert('لطفاً اطلاعات کالاها را به طور کامل و صحیح وارد کنید');
      return;
    }

    // Strict Serial Number Validation
    for (const item of activeItems) {
      const prod = products.find(p => p.id === item.productId);
      if (prod?.hasSerial) {
        const serialErrors = validateSerialNumbers(
          item.productId!,
          item.serialNumbers || [],
          item.quantity,
          appState,
          'opening',
          initialData?.id
        );
        if (serialErrors.length > 0) {
          alert(`خطا در ردیف کالا "${prod.name}":\n${serialErrors.join('\n')}`);
          return;
        }
      }
    }

    onSave({
      number,
      date,
      recordedBy,
      warehouse,
      description,
      items: activeItems
    });
  };

  return (
    <div className="max-w-4xl mx-auto border-none shadow-xl bg-white/80 backdrop-blur-md rounded-2xl overflow-hidden">
      <div className="border-b border-gray-100 pb-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600">
              <PackageIcon size={24} />
            </div>
            <h2 className="text-xl font-bold text-gray-800">
              {initialData ? 'ویرایش سند موجودی افتتاحیه' : 'ثبت موجودی افتتاحیه جدید'}
            </h2>
          </div>
          <button 
            onClick={onCancel}
            className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      </div>
      
      <div className="pt-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                شماره سند
              </label>
              <input
                type="text" inputMode="numeric" pattern="[0-9]*"

                value={number}
                onChange={e => setNumber(parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <CalendarIcon size={14} className="text-gray-400" />
                تاریخ
              </label>
              <input
                type="text"
                value={date}
                onChange={e => setDate(e.target.value)}
                placeholder="۱۴۰۲/۰۱/۰۱"
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all text-left"
                dir="ltr"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <User size={14} className="text-gray-400" />
                طرف حساب (سرمایه اولیه)
              </label>
              <input
                type="text"
                value="سرمایه اولیه"
                disabled
                className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600 flex items-center gap-2">
                <Home size={14} className="text-gray-400" />
                انبار
              </label>
              <input
                type="text"
                value={warehouse}
                onChange={e => setWarehouse(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-600 flex items-center gap-2">
              توضیحات
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all min-h-[80px]"
            />
          </div>

          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="text-zinc-400 text-[10px] border-b border-zinc-200">
                    <th className="py-2 px-1">کالا</th>
                    <th className="py-2 px-1 text-center">تعداد</th>
                    <th className="py-2 px-1 text-center">فی (ریال)</th>
                    <th className="py-2 px-1 text-center">تخفیف</th>
                    <th className="py-2 px-1 text-center">جمع (ریال)</th>
                    <th className="py-2 px-1 text-center"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={index} className="border-b border-zinc-100">
                      <td className="py-2 px-1">
                        <ProductSelector
                          products={products}
                          productCategories={productCategories}
                          selectedProductId={item.productId}
                          onSelect={(id) => handleRowChange(index, 'productId', id)}
                          onCreateProduct={onCreateProduct}
                          onAddCategory={onAddCategory}
                          currentStocks={currentStocks}
                          label=""
                        />
                        {item.productId && (
                          <div className="text-[9px] text-zinc-400 mt-0.5">
                            {products.find(p => p.id === item.productId)?.category} / {products.find(p => p.id === item.productId)?.unit}
                          </div>
                        )}
                        {products.find(p => p.id === item.productId)?.hasSerial && (
                          <button 
                            type="button" 
                            onClick={() => setActiveSerialRow(index)}
                            className="mt-1 block w-full text-[9px] font-bold py-1 px-2 rounded bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100 transition"
                          >
                            {(item.serialNumbers?.length || 0)} از {item.quantity || 1} سریال
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-1">
                        <input
                          type="text"

                          value={item.quantity > 0 ? item.quantity.toLocaleString() : ''}
                          onChange={(e) => handleRowChange(index, 'quantity', e.target.value)}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 font-mono text-xs text-zinc-800 text-center"
                        />
                      </td>
                      <td className="py-2 px-1">
                        <input
                          type="text"

                          value={item.unitCost > 0 ? item.unitCost.toLocaleString() : ''}
                          onChange={(e) => handleRowChange(index, 'unitCost', e.target.value)}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 font-mono text-xs text-zinc-800 text-center"
                        />
                      </td>
                      <td className="py-2 px-1">
                        <input
                          type="text"

                          value={item.discount > 0 ? item.discount.toLocaleString() : ''}
                          onChange={(e) => handleRowChange(index, 'discount', e.target.value)}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 font-mono text-xs text-zinc-800 text-center"
                        />
                      </td>
                      <td className="py-2 px-1 text-center font-mono text-xs">
                        {((item.quantity * item.unitCost) - item.discount).toLocaleString()}
                      </td>
                      <td className="py-2 px-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="text-red-400 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <button
              type="button"
              onClick={addItem}
              className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-emerald-200 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-medium hover:bg-emerald-100"
            >
              <Plus size={16} />
              افزودن کالا به سند
            </button>

            <div className="flex justify-end pt-4">
              <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 w-full md:w-64 space-y-2">
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>جمع کل:</span>
                  <span className="font-mono">{items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>تخفیف کل:</span>
                  <span className="font-mono">{items.reduce((sum, item) => sum + (item.discount || 0), 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-emerald-800 border-t border-zinc-200 pt-2">
                  <span>مبلغ نهایی:</span>
                  <span className="font-mono">{items.reduce((sum, item) => sum + ((item.quantity * item.unitCost) - (item.discount || 0)), 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t border-gray-100">
            <button
              type="button"
              onClick={onCancel}
              className="px-6 py-2.5 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-all font-medium"
            >
              انصراف
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all font-medium flex items-center gap-2"
            >
              <Save size={18} />
              ثبت سند
            </button>
          </div>
        </form>

        <AnimatePresence>
          {activeSerialRow !== null && (
            <SerialNumbersModal
              productName={products.find(p => p.id === items[activeSerialRow].productId)?.name || 'کالای ناشناس'}
              expectedQuantity={items[activeSerialRow].quantity || 1}
              initialSerials={items[activeSerialRow].serialNumbers || []}
              isSellMode={false}
              appState={appState}
              productId={items[activeSerialRow].productId}
              type="opening"
              excludeId={initialData?.id}
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

      </div>
    </div>
  );
};

export default OpeningBalanceForm;
