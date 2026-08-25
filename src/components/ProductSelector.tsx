/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Search, PackagePlus, X, Check, Package, Barcode, Camera } from 'lucide-react';
import { Product } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface ProductSelectorProps {
  products: Product[];
  productCategories: string[];
  selectedProductId: string;
  onSelect: (productId: string) => void;
  onCreateProduct: (name: string, category: string, unit: string, initialStock: number, reorderPoint: number, serialNumber?: string, defaultSalePrice?: number) => string;
  onAddCategory?: (category: string) => void;
  label: string;
  placeholder?: string;
  currentStocks: any;
}

export default function ProductSelector({
  products,
  productCategories,
  selectedProductId,
  onSelect,
  onCreateProduct,
  onAddCategory,
  label,
  placeholder = "انتخاب کالا...",
  currentStocks
}: ProductSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  // Quick Create Form States
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState(productCategories[0] || 'عمومی');
  const [customCategory, setCustomCategory] = useState('');
  const [newUnit, setNewUnit] = useState('دستگاه');
  const [newReorderPoint, setNewReorderPoint] = useState<number>(1);
  const [newDefaultSalePrice, setNewDefaultSalePrice] = useState<number>(0);

  const selectedProduct = useMemo(() => {
    return products.find(p => p.id === selectedProductId);
  }, [products, selectedProductId]);

  const getStockQty = (productId: string) => {
    const stockInfo = currentStocks[productId];
    if (stockInfo && typeof stockInfo === 'object') {
      return stockInfo.quantity ?? 0;
    }
    return stockInfo ?? 0;
  };

  const filteredProducts = useMemo(() => {
    if (!searchQuery) return products;
    const query = searchQuery.trim().toLowerCase();
    return products.filter(p => 
      p.name.toLowerCase().includes(query) || 
      p.code.toLowerCase().includes(query)
      
    );
  }, [products, searchQuery]);

  const handleCreate = (e?: React.FormEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (!newName.trim() || !newUnit.trim()) return;

    const categoryToUse = newCategory === 'جدید' ? customCategory.trim() || 'عمومی' : newCategory;

    const newId = onCreateProduct(
      newName.trim(),
      categoryToUse,
      newUnit.trim(),
      0,
      newReorderPoint,
      undefined,
      newDefaultSalePrice || undefined
    );

    // Reset states
    setNewName('');
    setNewCategory(productCategories[0] || 'عمومی');
    setCustomCategory('');
    setNewUnit('دستگاه');
    setNewReorderPoint(1);
    setNewDefaultSalePrice(0);

    setShowQuickCreate(false);
    setSearchQuery('');
    onSelect(newId);
    setIsOpen(false);
  };

  return (
    <div className="relative flex flex-col space-y-1.5 w-full">
      <label className="font-sans text-xs font-semibold text-zinc-700 text-right">{label}</label>

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-white border border-zinc-200 hover:border-zinc-300 rounded-xl px-3.5 py-2.5 text-right font-sans text-xs transition shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
      >
        {selectedProduct ? (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-2 space-x-reverse text-zinc-800">
              <Package size={15} className="text-emerald-500" />
              <span className="font-semibold">{selectedProduct.name}</span>
              <span className="font-mono text-[10px] text-zinc-400">({selectedProduct.code})</span>
            </div>
            <div className="bg-zinc-100 text-zinc-600 font-sans text-[10px] px-2 py-0.5 rounded-full">
              موجودی: {getStockQty(selectedProduct.id)} {selectedProduct.unit}
            </div>
          </div>
        ) : (
          <span className="text-zinc-400">{placeholder}</span>
        )}
        {!selectedProduct && <Search size={15} className="text-zinc-400" />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute z-40 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 shadow-xl rounded-2xl overflow-hidden flex flex-col"
          >
            {/* Search Input */}
            <div className="flex items-center bg-zinc-50 border-b border-zinc-100 p-2.5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجوی نام، کد یا سریال کالا..."
                className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 border-none outline-none focus:ring-0 text-right"
                dir="rtl"
                autoFocus
              />
              <Search size={14} className="text-zinc-400 ml-1.5" />
            </div>

            {/* List and Quick Create form */}
            {!showQuickCreate ? (
              <div className="flex flex-col max-h-[220px] overflow-y-auto">
                {filteredProducts.length > 0 ? (
                  filteredProducts.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onSelect(p.id);
                        setIsOpen(false);
                        setSearchQuery('');
                      }}
                      className={`flex items-center justify-between px-3.5 py-2.5 hover:bg-zinc-50 text-right transition border-b border-zinc-50 last:border-none ${
                        selectedProductId === p.id ? 'bg-emerald-50 text-emerald-900' : 'text-zinc-700'
                      }`}
                    >
                      <div className="flex flex-col text-right font-sans">
                        <div className="flex items-center space-x-1.5 space-x-reverse text-xs">
                          <Package size={13} className="text-zinc-400 animate-pulse" />
                          <span className="font-medium">{p.name}</span>
                          <span className="font-mono text-[9px] text-zinc-400">({p.code})</span>
                        </div>
                        {p.hasSerial && (
                          <span className="font-mono text-[9px] text-zinc-500 mt-0.5" dir="ltr">
                            دارای سریال
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 space-x-reverse">
                        <span className="text-[10px] text-zinc-500 font-sans">
                          {getStockQty(p.id)} {p.unit}
                        </span>
                        {selectedProductId === p.id && <Check size={13} className="text-emerald-600" />}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-center font-sans text-xs text-zinc-400">
                    کالایی با این مشخصات یافت نشد
                  </div>
                )}

                {/* Quick Create Action */}
                <button
                  type="button"
                  onClick={() => setShowQuickCreate(true)}
                  className="w-full flex items-center justify-center space-x-2 space-x-reverse bg-emerald-50 hover:bg-emerald-100 text-emerald-700 py-3 text-xs font-semibold font-sans border-t border-zinc-100 transition"
                >
                  <PackagePlus size={14} />
                  <span>تعریف سریع کالا در انبار</span>
                </button>
              </div>
            ) : (
              /* QUICK CREATE INLINE FORM */
              <div
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreate(e);
                  }
                }}
                className="p-4 space-y-3 bg-zinc-50/80 border-t border-zinc-100 max-h-[350px] overflow-y-auto"
              >
                <div className="flex items-center justify-between border-b border-zinc-200/60 pb-2">
                  <span className="font-sans text-xs font-bold text-zinc-800">ایجاد سریع کالا در انبار</span>
                  <button
                    type="button"
                    onClick={() => setShowQuickCreate(false)}
                    className="p-1 text-zinc-400 hover:text-zinc-600"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 text-right mb-0.5">نام کالا *</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="مانند: آیفون ۱۵ پرو"
                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                      dir="rtl"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 text-right mb-0.5">دسته‌بندی *</label>
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                      dir="rtl"
                    >
                      {productCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      <option value="جدید">افزودن دسته‌بندی جدید...</option>
                    </select>
                    {newCategory === 'جدید' && (
                      <div className="flex items-center gap-1 mt-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            if (customCategory.trim() && onAddCategory) {
                              onAddCategory(customCategory.trim());
                              setNewCategory(customCategory.trim());
                              setCustomCategory('');
                            }
                          }}
                          className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 p-1.5 rounded-lg transition"
                          title="ذخیره دسته‌بندی"
                        >
                          <Check size={14} />
                        </button>
                        <input
                          type="text"
                          placeholder="نام دسته‌بندی جدید"
                          value={customCategory}
                          onChange={(e) => setCustomCategory(e.target.value)}
                          className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                          dir="rtl"
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 text-right mb-0.5">واحد شمارش *</label>
                      <input
                        type="text"
                        value={newUnit}
                        onChange={(e) => setNewUnit(e.target.value)}
                        placeholder="عدد / دستگاه"
                        className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                        dir="rtl"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 text-right mb-0.5">نقطه سفارش *</label>
                      <input
                        type="text" inputMode="numeric" pattern="[0-9]*"

                        value={newReorderPoint}
                        onChange={(e) => setNewReorderPoint(parseInt(e.target.value) || 0)}
                        className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                        dir="rtl"
                        min="0"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 text-right mb-0.5">قیمت فروش پیش‌فرض (ریال)</label>
                    <input
                      type="text" inputMode="numeric" pattern="[0-9]*"

                      value={newDefaultSalePrice || ''}
                      onChange={(e) => setNewDefaultSalePrice(parseInt(e.target.value) || 0)}
                      placeholder="مانند: ۵۰۰۰۰۰۰"
                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right font-mono"
                      dir="rtl"
                    />
                  </div>
                </div>

                <div className="flex space-x-2 space-x-reverse pt-2">
                  <button
                    type="button"
                    onClick={() => handleCreate()}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-sans text-xs font-semibold py-1.5 rounded-lg transition-all"
                  >
                    ثبت و انتخاب کالا
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQuickCreate(false)}
                    className="px-3 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-sans text-xs font-medium py-1.5 rounded-lg transition-all"
                  >
                    انصراف
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
