import React from 'react';
import { Package, X, Calendar, User, Home, Hash, FileText } from 'lucide-react';
import { OpeningBalance, Product } from '../types';

interface OpeningBalanceDetailModalProps {
  openingBalance: OpeningBalance;
  products: Product[];
  onClose: () => void;
  onEdit?: (ob: OpeningBalance) => void;
  onDelete?: (id: string) => void;
  onNew?: () => void;
}

const OpeningBalanceDetailModal: React.FC<OpeningBalanceDetailModalProps> = ({
  openingBalance,
  products,
  onClose,
  onEdit,
  onDelete,
  onNew
}) => {
  const totalValue = openingBalance.items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
  const [showConfirmDelete, setShowConfirmDelete] = React.useState(false);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-emerald-600 text-white p-6 relative">
          <h3 className="text-xl font-bold flex items-center gap-3">
            <Package size={24} />
            جزئیات سند موجودی افتتاحیه
          </h3>
          <button 
            onClick={onClose}
            className="absolute left-6 top-6 p-2 hover:bg-white/20 rounded-full transition-colors text-white"
          >
            <X size={20} />
          </button>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            <div className="flex flex-col">
              <span className="text-emerald-100 text-[10px] font-bold uppercase">شماره سند</span>
              <span className="text-lg font-bold">{openingBalance.number}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-emerald-100 text-[10px] font-bold uppercase">تاریخ</span>
              <span className="text-lg font-bold">{openingBalance.date}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-emerald-100 text-[10px] font-bold uppercase">کاربر</span>
              <span className="text-lg font-bold">{openingBalance.recordedBy || '-'}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-emerald-100 text-[10px] font-bold uppercase">انبار</span>
              <span className="text-lg font-bold">{openingBalance.warehouse || 'مرکزی'}</span>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="space-y-6">
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                <FileText size={14} />
                توضیحات سند
              </h4>
              <p className="text-gray-700 leading-relaxed">
                {openingBalance.description || 'توضیحاتی برای این سند ثبت نشده است.'}
              </p>
            </div>

            <div className="overflow-hidden border border-gray-100 rounded-2xl">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs font-bold">
                    <th className="p-4 border-b border-gray-100">نام کالا</th>
                    <th className="p-4 border-b border-gray-100">تعداد</th>
                    <th className="p-4 border-b border-gray-100">بهای واحد (ریال)</th>
                    <th className="p-4 border-b border-gray-100">جمع کل (ریال)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {openingBalance.items.map((item, idx) => {
                    const product = products.find(p => p.id === item.productId);
                    return (
                      <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-4 text-sm font-bold text-gray-700">{product?.name || 'کالای نامشخص'}</td>
                        <td className="p-4 text-sm font-medium text-gray-600">{item.quantity.toLocaleString()}</td>
                        <td className="p-4 text-sm font-medium text-gray-600">{item.unitCost.toLocaleString()}</td>
                        <td className="p-4 text-sm font-bold text-emerald-600">{(item.quantity * item.unitCost).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-emerald-50/30">
                    <td colSpan={3} className="p-4 text-sm font-bold text-gray-700 text-left">مجموع ارزش افتتاحیه:</td>
                    <td className="p-4 text-lg font-black text-emerald-600">{totalValue.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            
            <div className="flex flex-col gap-2 pt-4 border-t border-gray-100">
              <div className="flex gap-2">
                {onEdit && (
                  <button
                    onClick={() => {
                      onEdit(openingBalance);
                      onClose();
                    }}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition font-bold text-xs shadow-sm flex items-center justify-center gap-2"
                  >
                    اصلاح سند
                  </button>
                )}
                {onDelete && (
                  showConfirmDelete ? (
                    <div className="flex-1 flex gap-1">
                      <button
                        onClick={() => {
                          onDelete(openingBalance.id);
                          onClose();
                        }}
                        className="flex-1 px-3 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition font-bold text-[10px]"
                      >
                        بله، حذف
                      </button>
                      <button
                        onClick={() => setShowConfirmDelete(false)}
                        className="flex-1 px-3 py-2.5 bg-gray-200 text-gray-600 rounded-xl hover:bg-gray-300 transition font-bold text-[10px]"
                      >
                        انصراف
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowConfirmDelete(true)}
                      className="flex-1 px-4 py-2.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl hover:bg-rose-100 transition font-bold text-xs"
                    >
                      حذف سند
                    </button>
                  )
                )}
              </div>
              
              {onNew && (
                <button
                  onClick={() => {
                    onNew();
                    onClose();
                  }}
                  className="w-full px-4 py-3 bg-zinc-800 text-white rounded-xl hover:bg-zinc-900 transition font-bold text-xs flex items-center justify-center gap-2 shadow-md"
                >
                  ثبت موجودی افتتاحیه جدید
                </button>
              )}
              
              <button
                onClick={onClose}
                className="w-full py-2.5 text-gray-500 hover:text-gray-700 transition font-medium text-xs"
              >
                بستن پنجره
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OpeningBalanceDetailModal;
