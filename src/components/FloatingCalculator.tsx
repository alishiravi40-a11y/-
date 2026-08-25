import React, { useState } from 'react';
import { Calculator, X, Delete, Copy, Check } from 'lucide-react';
import { safeEvaluateExpression } from '../utils/safeCalculator';

export default function FloatingCalculator() {
  const [isOpen, setIsOpen] = useState(false);
  const [display, setDisplay] = useState('0');
  const [equation, setEquation] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const handleNum = (num: string) => {
    if (display === '0' || display === 'خطا') {
      setDisplay(num);
    } else {
      setDisplay(display + num);
    }
  };

  const handleOp = (op: string) => {
    if (display === 'خطا') return;
    setEquation(display + ' ' + op + ' ');
    setDisplay('0');
  };

  const handleClear = () => {
    setDisplay('0');
    setEquation('');
  };

  const handleBackspace = () => {
    if (display.length <= 1 || display === 'خطا') {
      setDisplay('0');
    } else {
      setDisplay(display.slice(0, -1));
    }
  };

  const handleEqual = () => {
    try {
      if (!equation) return;
      const fullExpr = equation + display;
      const evalRes = safeEvaluateExpression(fullExpr);
      if (evalRes.isError) {
        setDisplay('خطا');
      } else {
        setDisplay(evalRes.result);
      }
      setEquation('');
    } catch {
      setDisplay('خطا');
      setEquation('');
    }
  };

  const formatDisplay = (val: string) => {
    if (val === 'خطا') return 'خطا';
    const num = Number(val);
    if (!isNaN(num) && val !== '' && !val.endsWith('.')) {
      return num.toLocaleString('fa-IR');
    }
    return val;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(display);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="fixed bottom-6 left-6 z-[120]">
      {isOpen ? (
        <div className="bg-zinc-900 text-white rounded-3xl p-5 shadow-2xl border border-zinc-800 w-80 animate-in zoom-in-95 duration-200 select-none">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 text-emerald-400">
              <Calculator size={18} />
              <span className="text-xs font-black">ماشین‌حساب سریع</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={copyToClipboard}
                className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl transition-colors"
                title="کپی نتیجه"
              >
                {isCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Display */}
          <div className="bg-zinc-950 p-4 rounded-2xl mb-4 text-left font-mono">
            <div className="text-[10px] text-zinc-500 h-4 overflow-hidden text-ellipsis whitespace-nowrap">
              {equation}
            </div>
            <div className="text-2xl font-black text-emerald-400 overflow-x-auto whitespace-nowrap scrollbar-none dir-ltr">
              {formatDisplay(display)}
            </div>
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-4 gap-2 text-sm font-bold dir-ltr">
            <button
              onClick={handleClear}
              className="p-3 bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 rounded-2xl font-bold transition-colors col-span-2 text-xs"
            >
              پاکسازی (C)
            </button>
            <button
              onClick={handleBackspace}
              className="p-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-2xl flex items-center justify-center transition-colors"
            >
              <Delete size={18} />
            </button>
            <button
              onClick={() => handleOp('÷')}
              className="p-3 bg-emerald-600/30 text-emerald-400 hover:bg-emerald-600/40 rounded-2xl transition-colors"
            >
              ÷
            </button>

            <button onClick={() => handleNum('7')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl">7</button>
            <button onClick={() => handleNum('8')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl">8</button>
            <button onClick={() => handleNum('9')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl">9</button>
            <button onClick={() => handleOp('×')} className="p-3 bg-emerald-600/30 text-emerald-400 hover:bg-emerald-600/40 rounded-2xl">×</button>

            <button onClick={() => handleNum('4')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl">4</button>
            <button onClick={() => handleNum('5')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl">5</button>
            <button onClick={() => handleNum('6')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl">6</button>
            <button onClick={() => handleOp('-')} className="p-3 bg-emerald-600/30 text-emerald-400 hover:bg-emerald-600/40 rounded-2xl">-</button>

            <button onClick={() => handleNum('1')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl">1</button>
            <button onClick={() => handleNum('2')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl">2</button>
            <button onClick={() => handleNum('3')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl">3</button>
            <button onClick={() => handleOp('+')} className="p-3 bg-emerald-600/30 text-emerald-400 hover:bg-emerald-600/40 rounded-2xl">+</button>

            <button onClick={() => handleNum('0')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl col-span-2">0</button>
            <button onClick={() => handleNum('000')} className="p-3 bg-zinc-800/80 hover:bg-zinc-700 rounded-2xl text-xs">000</button>
            <button onClick={handleEqual} className="p-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black transition-colors">=</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white p-4 rounded-full shadow-2xl border-2 border-white/20 flex items-center justify-center transition-all hover:scale-105 active:scale-95 group"
          title="ماشین‌حساب شناور سریع"
        >
          <Calculator size={24} className="group-hover:rotate-12 transition-transform" />
        </button>
      )}
    </div>
  );
}
