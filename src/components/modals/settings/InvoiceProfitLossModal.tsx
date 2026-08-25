import React from 'react';
import { TrendingUp, X } from 'lucide-react';

export interface InvoiceProfitLossData {
  invoiceNumber: string;
  revenue: number;
  cogs: number;
  profitLoss: number;
  isProfit: boolean;
}

interface InvoiceProfitLossModalProps {
  data: InvoiceProfitLossData | null;
  onClose: () => void;
}

export const InvoiceProfitLossModal: React.FC<InvoiceProfitLossModalProps> = ({
  data,
  onClose,
}) => {
  if (!data) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" style={{ direction: 'rtl' }}>
      <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-zinc-150 text-right space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-xl ${data.isProfit ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
              <TrendingUp size={20} />
            </div>
            <h3 className="font-sans font-bold text-sm text-zinc-900">سود و زیان ناخالص فاکتور فروش #{data.invoiceNumber}</h3>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 transition"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 font-sans text-xs">
          <div className="flex justify-between p-2.5 bg-zinc-50 rounded-xl">
            <span className="text-zinc-500">مجموع درآمد خالص فروش فاکتور:</span>
            <span className="font-mono font-bold text-zinc-800">{data.revenue.toLocaleString()} ریال</span>
          </div>
          <div className="flex justify-between p-2.5 bg-zinc-50 rounded-xl">
            <span className="text-zinc-500">بهای تمام شده کالای فروش رفته (COGS):</span>
            <span className="font-mono font-bold text-zinc-800">{data.cogs.toLocaleString()} ریال</span>
          </div>

          <div className={`flex justify-between p-3.5 rounded-2xl ${
            data.isProfit ? 'bg-emerald-50 border border-emerald-100 text-emerald-800' : 'bg-rose-50 border border-rose-100 text-rose-800'
          }`}>
            <span className="font-bold">{data.isProfit ? 'سود ناخالص فاکتور:' : 'زیان ناخالص فاکتور:'}</span>
            <div className="flex flex-col items-end gap-1">
              <span className="font-mono font-black text-sm">
                {data.isProfit ? '+' : ''}{data.profitLoss.toLocaleString()} ریال
              </span>
              <span className="text-[10px] font-bold">
                ({data.revenue > 0 ? Math.round((data.profitLoss / data.revenue) * 100) : 0}٪ بازدهی ناخالص)
              </span>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white font-sans text-xs font-bold rounded-xl transition shadow-lg shadow-zinc-950/10"
          >
            بستن پنجره
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceProfitLossModal;
