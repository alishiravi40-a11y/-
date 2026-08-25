import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

interface CategoryManagerProps {
  categories: string[];
  onAddCategory: (category: string) => void;
  onDeleteCategory: (category: string) => void;
}

export default function CategoryManager({ categories, onAddCategory, onDeleteCategory }: CategoryManagerProps) {
  const [newCategory, setNewCategory] = useState('');

  const handleAdd = () => {
    if (newCategory.trim() && !categories.includes(newCategory.trim())) {
      onAddCategory(newCategory.trim());
      setNewCategory('');
    }
  };

  return (
    <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-3">
      <span className="block font-sans text-xs font-bold text-zinc-800 text-right">مدیریت دسته‌بندی‌ها</span>
      <div className="flex gap-2">
        <button onClick={handleAdd} className="bg-emerald-600 text-white p-2 rounded-xl">
          <Plus size={16} />
        </button>
        <input
          type="text"
          placeholder="نام دسته‌بندی جدید"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          className="flex-1 bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right"
        />
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        {categories.map(cat => (
          <div key={cat} className="flex items-center gap-1 bg-zinc-100 px-2 py-1 rounded-lg text-xs font-sans text-zinc-700">
            <button onClick={(e) => { e.stopPropagation(); onDeleteCategory(cat); }} className="text-rose-500"><Trash2 size={12} /></button>
            <span>{cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
