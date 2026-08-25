import React, { useState } from 'react';
import { Package, Search, Plus, Edit2, Trash2, ChevronRight, Calendar, User, Home, Eye } from 'lucide-react';
import { OpeningBalance, Product } from '../types';

interface OpeningBalanceListProps {
  openingBalances: OpeningBalance[];
  products: Product[];
  onAdd: () => void;
  onEdit: (ob: OpeningBalance) => void;
  onDelete: (id: string) => void;
  onView: (ob: OpeningBalance) => void;
}

const OpeningBalanceList: React.FC<OpeningBalanceListProps> = ({
  openingBalances,
  products,
  onAdd,
  onEdit,
  onDelete,
  onView
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredBalances = openingBalances.filter(ob => 
    ob.number.toString().includes(searchTerm) ||
    ob.description?.includes(searchTerm) ||
    ob.recordedBy?.includes(searchTerm)
  ).sort((a, b) => b.number - a.number);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-xl text-emerald-600">
              <Package size={24} />
            </div>
            اسناد موجودی افتتاحیه
          </h2>
          <p className="text-gray-500 mt-1 mr-12">مدیریت موجودی اولیه انبار و تراز افتتاحیه کالاها</p>
        </div>
        <button
          onClick={onAdd}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all font-bold"
        >
          <Plus size={20} />
          ثبت موجودی افتتاحیه جدید
        </button>
      </div>

      <div className="relative group">
        <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-emerald-500 transition-colors" size={20} />
        <input
          type="text"
          placeholder="جستجو در شماره سند، توضیحات یا کاربر..."
          className="w-full pr-12 pl-4 py-4 bg-white border-none rounded-2xl shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-gray-700 placeholder:text-gray-400"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid gap-4">
        {filteredBalances.map((ob) => (
          <div key={ob.id} className="overflow-hidden border-none shadow-sm hover:shadow-md transition-all group bg-white rounded-2xl">
            <div className="p-0">
              <div className="flex flex-col md:flex-row md:items-center p-5 gap-6">
                <div className="flex items-center gap-4 min-w-[120px]">
                  <div className="w-12 h-12 bg-gray-50 rounded-2xl flex flex-col items-center justify-center border border-gray-100">
                    <span className="text-[10px] text-gray-400 font-medium">سند</span>
                    <span className="text-lg font-bold text-gray-700 leading-tight">{ob.number}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-1">
                      <Calendar size={12} />
                      {ob.date}
                    </div>
                    <div className="font-bold text-gray-800">
                      {ob.items.length} ردیف کالا
                    </div>
                  </div>
                </div>

                <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4 border-r border-gray-100 pr-6">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">کاربر</div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 font-medium">
                      <User size={14} className="text-gray-300" />
                      {ob.recordedBy || 'تعیین نشده'}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">انبار</div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 font-medium">
                      <Home size={14} className="text-gray-300" />
                      {ob.warehouse || 'انبار مرکزی'}
                    </div>
                  </div>
                  <div className="col-span-2 md:col-span-1 space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">توضیحات</div>
                    <div className="text-sm text-gray-500 line-clamp-1">
                      {ob.description || 'بدون توضیحات'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t md:border-t-0 md:border-r border-gray-100 pt-4 md:pt-0 pr-0 md:pr-6">
                  <button
                    onClick={() => onView(ob)}
                    className="p-2.5 text-blue-500 hover:bg-blue-50 rounded-xl transition-colors"
                    title="مشاهده جزئیات"
                  >
                    <Eye size={18} />
                  </button>
                  <button
                    onClick={() => onEdit(ob)}
                    className="p-2.5 text-amber-500 hover:bg-amber-50 rounded-xl transition-colors"
                    title="ویرایش"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => onDelete(ob.id)}
                    className="p-2.5 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                    title="حذف"
                  >
                    <Trash2 size={18} />
                  </button>
                  <div className="w-8 flex justify-center text-gray-300 group-hover:text-emerald-500 transition-colors">
                    <ChevronRight size={20} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}

        {filteredBalances.length === 0 && (
          <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-100">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Package size={32} className="text-gray-300" />
            </div>
            <h3 className="text-lg font-bold text-gray-700">سندی یافت نشد</h3>
            <p className="text-gray-400 mt-1">هنوز هیچ سند موجودی افتتاحیه‌ای در سیستم ثبت نشده است.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OpeningBalanceList;
