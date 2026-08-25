import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmationModalData {
  title: string;
  message: string;
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
}

interface AppConfirmationModalProps {
  modal: ConfirmationModalData | null;
  onClose: () => void;
}

export const AppConfirmationModal: React.FC<AppConfirmationModalProps> = ({
  modal,
  onClose,
}) => {
  if (!modal) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" style={{ direction: 'rtl' }}>
      <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-zinc-150 text-right">
        <div className="flex items-center gap-3 text-amber-500 mb-4 justify-start">
          <AlertTriangle size={24} />
          <h3 className="font-sans font-bold text-lg text-zinc-900">{modal.title}</h3>
        </div>
        
        <p className="font-sans text-sm text-zinc-600 leading-relaxed mb-6 whitespace-pre-line">
          {modal.message}
        </p>
        
        <div className="flex gap-3 justify-end">
          {modal.onConfirm ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-sans text-xs font-bold rounded-xl transition"
              >
                {modal.cancelText || 'انصراف'}
              </button>
              <button
                onClick={() => {
                  modal.onConfirm?.();
                  onClose();
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-sans text-xs font-bold rounded-xl transition shadow-lg shadow-red-500/20"
              >
                {modal.confirmText || 'بله، تایید می‌شود'}
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white font-sans text-xs font-bold rounded-xl transition shadow-lg shadow-zinc-950/10"
            >
              متوجه شدم
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppConfirmationModal;
