import React, { useState } from 'react';
import { CostCenter } from '../types';
import { Target, Plus, Trash2, Hash } from 'lucide-react';

interface CostCenterManagerProps {
  costCenters: CostCenter[];
  onAdd: (c: CostCenter) => void;
  onDelete: (id: string) => void;
}

export function CostCenterManager({ costCenters, onAdd, onDelete }: CostCenterManagerProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');

  const handleAdd = () => {
    if (!name || !code) return;
    onAdd({ id: crypto.randomUUID(), name, code, description: desc });
    setName('');
    setCode('');
    setDesc('');
    setShowAdd(false);
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm space-y-6" dir="rtl">
      <div className="flex justify-between items-center border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
            <Target size={20} />
          </div>
          <h2 className="text-xl font-bold text-gray-800">تعریف مراکز هزینه (Cost Centers)</h2>
        </div>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
        >
          <Plus size={18} />
          <span>مرکز هزینه جدید</span>
        </button>
      </div>

      {showAdd && (
        <div className="p-5 bg-purple-50/30 border border-purple-100 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input 
              placeholder="نام مرکز هزینه (مثلاً: واحد فروش)"
              className="p-3 rounded-lg border focus:ring-2 focus:ring-purple-500 outline-none bg-white"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <input 
              placeholder="کد مرکز"
              className="p-3 rounded-lg border focus:ring-2 focus:ring-purple-500 outline-none bg-white"
              value={code}
              onChange={e => setCode(e.target.value)}
            />
            <input 
              placeholder="توضیحات (اختیاری)"
              className="p-3 rounded-lg border focus:ring-2 focus:ring-purple-500 outline-none bg-white col-span-full"
              value={desc}
              onChange={e => setDesc(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg">انصراف</button>
            <button onClick={handleAdd} className="px-6 py-2 bg-purple-600 text-white rounded-lg font-bold">ثبت مرکز هزینه</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {costCenters.map(cc => (
          <div key={cc.id} className="p-4 border rounded-xl hover:border-purple-300 hover:shadow-md transition-all group bg-white">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2 text-purple-600 bg-purple-50 px-2 py-1 rounded-md text-xs font-bold">
                <Hash size={12} />
                <span>{cc.code}</span>
              </div>
              <button 
                onClick={() => onDelete(cc.id)}
                className="text-red-300 hover:text-red-600 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={16} />
              </button>
            </div>
            <h3 className="font-bold text-gray-800 mb-1">{cc.name}</h3>
            <p className="text-xs text-gray-400 line-clamp-2">{cc.description || 'بدون توضیحات'}</p>
          </div>
        ))}
        {costCenters.length === 0 && (
          <div className="col-span-full p-12 text-center text-gray-400 italic">هنوز مرکز هزینه‌ای تعریف نشده است.</div>
        )}
      </div>

      <div className="p-4 bg-gray-50 rounded-xl text-xs text-gray-500 leading-relaxed border border-gray-100">
        <strong>نکته حسابداری:</strong> مراکز هزینه به شما کمک می‌کنند تا هزینه‌ها و درآمدهای خود را به تفکیک واحدها، پروژه‌ها یا بخش‌های مختلف کسب‌وکار ردیابی کنید. هنگام ثبت فاکتور یا سند دستی، می‌توانید مرکز هزینه مربوطه را انتخاب کنید تا گزارشات دقیق‌تری داشته باشید.
      </div>
    </div>
  );
}
