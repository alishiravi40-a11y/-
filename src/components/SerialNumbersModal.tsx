import React, { useState, useRef, useMemo } from 'react';
import { X, Camera, Plus, Trash2, Check, AlertTriangle, Box } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import BarcodeScanner from './BarcodeScanner';

import { AppState } from '../types';
import { validateSerialNumbers, getAvailableSerialNumbers } from '../utils/accounting';

interface SerialNumbersModalProps {
  productName: string;
  expectedQuantity: number;
  initialSerials: string[];
  onSave: (serials: string[]) => void;
  onClose: () => void;
  isSellMode: boolean; // if true, maybe show different UI or warnings
  appState: AppState;
  productId: string;
  type: 'buy' | 'sell' | 'opening';
  excludeId?: string;
}

export default function SerialNumbersModal({
  productName,
  expectedQuantity,
  initialSerials,
  onSave,
  onClose,
  isSellMode,
  appState,
  productId,
  type,
  excludeId
}: SerialNumbersModalProps) {
  const [serials, setSerials] = useState<string[]>(initialSerials);
  const [newSerial, setNewSerial] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const availableInStock = useMemo(() => {
    if (type !== 'sell') return [];
    const inStock = getAvailableSerialNumbers(productId, appState, excludeId);
    // Filter out what's already selected in THIS modal session
    return inStock.filter(sn => !serials.includes(sn));
  }, [productId, appState, type, serials, excludeId]);

  const handleAddManual = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const rawVal = newSerial.trim();
    if (!rawVal) return;

    // Smart split by space, comma, newline, or vertical bar to allow pasting multiple serials/IMEIs
    const parsedSerials = rawVal
      .split(/[\s,，、\n|]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (parsedSerials.length === 0) return;

    const duplicates: string[] = [];
    const added: string[] = [];
    const validationErrors: string[] = [];

    parsedSerials.forEach(val => {
      // Internal duplicate check
      if (serials.includes(val) || added.includes(val)) {
        duplicates.push(val);
      } else {
        // Business logic validation
        const errs = validateSerialNumbers(productId, [val], 1, appState, type, excludeId);
        // We ignore the "quantity mismatch" error from the utility because we are validating 1 by 1 here
        const filteredErrs = errs.filter(e => !e.includes('تعداد شماره سریال‌ها'));
        
        if (filteredErrs.length > 0) {
          validationErrors.push(`${val}: ${filteredErrs[0]}`);
        } else {
          added.push(val);
        }
      }
    });

    if (validationErrors.length > 0) {
      setErrorMessage(validationErrors[0]);
      return;
    }

    if (duplicates.length > 0 && added.length === 0) {
      setErrorMessage(`سریال(های) وارد شده تکراری هستند: ${duplicates.join(', ')}`);
      return;
    }

    setSerials([...serials, ...added]);
    setNewSerial('');
    setErrorMessage(null);

    // Maintain focus on the input field for continuous entry
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 50);
  };

  const handleRemove = (index: number) => {
    setSerials(serials.filter((_, i) => i !== index));
  };

  const handleScan = (barcode: string) => {
    if (serials.includes(barcode)) {
      alert('این شماره سریال قبلاً اسکن شده است.');
      return;
    }
    setSerials(prev => [...prev, barcode]);
    // The scanner closes itself after scan, but we don't close this modal so user can see it
  };

  const missingCount = expectedQuantity - serials.length;

  const handleSave = () => {
    if (serials.length !== expectedQuantity) {
      setErrorMessage(`تعداد سریال‌های وارد شده (${serials.length}) باید دقیقاً برابر با تعداد کالا (${expectedQuantity}) باشد.`);
      return;
    }
    onSave(serials);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-100 bg-zinc-50">
          <div>
            <h3 className="font-sans font-bold text-sm text-zinc-800">ثبت سریال‌های کالا</h3>
            <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">{productName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          <div className="flex justify-between items-center bg-blue-50 border border-blue-100 rounded-xl p-3">
            <div className="text-right flex-1">
              <span className="block text-[10px] text-blue-500 font-bold mb-1">وضعیت سریال‌ها</span>
              <span className="font-sans text-xs text-blue-800 font-bold">
                {serials.length} از {expectedQuantity} شماره سریال وارد شده است
              </span>
            </div>
            {missingCount !== 0 && (
              <div className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${missingCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                {missingCount > 0 ? `${missingCount} سریال مانده` : `${Math.abs(missingCount)} سریال اضافه`}
              </div>
            )}
            {missingCount === 0 && (
              <div className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 text-emerald-700 flex items-center space-x-1 space-x-reverse">
                <Check size={12} />
                <span>تکمیل شد</span>
              </div>
            )}
          </div>

          {/* Available in Stock (Only for Sales) */}
          {type === 'sell' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold text-zinc-400 flex items-center gap-1">
                  <Box size={12} className="text-zinc-400" />
                  انتخاب از موجودی انبار:
                </div>
                <span className="text-[9px] text-zinc-400 font-mono">{availableInStock.length} سریال موجود</span>
              </div>
              
              {availableInStock.length === 0 ? (
                <div className="text-[10px] text-zinc-400 bg-zinc-50 border border-zinc-100 rounded-lg p-3 text-center italic">
                  هیچ سریال آزادی در انبار یافت نشد.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1 border border-zinc-100 rounded-xl bg-zinc-50/50">
                  {availableInStock.map((sn, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (serials.length < expectedQuantity) {
                          setSerials([...serials, sn]);
                          setErrorMessage(null);
                        } else {
                          setErrorMessage("تعداد سریال‌ها تکمیل است.");
                        }
                      }}
                      className="bg-white border border-zinc-200 hover:border-blue-300 hover:bg-blue-50 text-zinc-700 hover:text-blue-700 px-2 py-1.5 rounded-lg text-[11px] font-mono font-bold transition shadow-sm active:scale-95"
                    >
                      {sn}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex space-x-2 space-x-reverse">
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              className="flex-1 bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-colors py-3 rounded-xl flex flex-col items-center justify-center space-y-1"
            >
              <Camera size={20} />
              <span className="font-sans text-[10px] font-bold">اسکن با دوربین</span>
            </button>
          </div>

          <form onSubmit={handleAddManual} className="relative">
            <input
              ref={inputRef}
              type="text"
              autoFocus
              value={newSerial}
              onChange={(e) => {
                setNewSerial(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="ورود دستی سریال و اینتر (یا چسباندن چندین سریال)..."
              className={`w-full bg-zinc-50 border ${errorMessage ? 'border-red-300' : 'border-zinc-200'} rounded-xl px-3 py-2.5 font-mono text-xs text-left focus:outline-none focus:border-blue-500 transition-colors`}
              dir="ltr"
            />
            <button
              type="submit"
              disabled={!newSerial.trim()}
              className="absolute left-1 top-1 bottom-1 bg-blue-600 disabled:bg-zinc-300 text-white px-3 rounded-lg flex items-center justify-center transition"
            >
              <Plus size={16} />
            </button>
          </form>

          {errorMessage && (
            <div className="bg-red-50 text-red-700 text-[10px] font-bold py-2 px-3 rounded-xl border border-red-100 animate-in fade-in slide-in-from-top-1 flex items-center gap-2">
              <AlertTriangle size={12} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-[10px] font-bold text-zinc-400 border-b border-zinc-100 pb-1">لیست سریال‌های ثبت شده:</div>
            {serials.length === 0 ? (
              <div className="text-center py-6 text-zinc-400 text-xs bg-zinc-50 rounded-xl border border-dashed border-zinc-200">
                هنوز هیچ سریالی ثبت نشده است
              </div>
            ) : (
              <div className="space-y-2">
                {serials.map((serial, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-white border border-zinc-200 rounded-lg p-2.5 shadow-sm">
                    <span className="font-mono text-xs font-bold text-zinc-800">{serial}</span>
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <span className="text-[9px] font-bold text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">
                        {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemove(idx)}
                        className="text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 p-1.5 rounded-lg transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex space-x-2 space-x-reverse">
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-sans text-xs font-bold py-3 rounded-xl transition flex justify-center items-center space-x-1 space-x-reverse"
          >
            <Check size={16} />
            <span>تایید و ثبت در ردیف فاکتور</span>
          </button>
        </div>
      </motion.div>

      {showScanner && (
        <BarcodeScanner
          onScan={handleScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
