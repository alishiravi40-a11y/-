import React, { useState } from 'react';
import { User, Warehouse, UserRole, Role, Person } from '../types';
import { UserPlus, Trash2, Edit2, Users, Save, X, Search } from 'lucide-react';
import { isValidNationalId, isUniqueNationalId } from '../utils/validation';
import { toEnglishDigits } from '../utils/accounting';

interface UserManagerProps {
  users: User[];
  warehouses: Warehouse[];
  persons: Person[];
  roles?: Role[];
  onAddUser: (user: User) => void;
  onDeleteUser: (id: string) => void;
  onUpdateUser: (user: User) => void;
}

export function UserManager({ users, warehouses, persons, roles = [], onAddUser, onDeleteUser, onUpdateUser }: UserManagerProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<Partial<User & { nationalId?: string }>>({ role: 'seller', allowedWarehouseIds: [] });
  const [nationalIdQuery, setNationalIdQuery] = useState('');
  const [foundPerson, setFoundPerson] = useState<Person | null>(null);

  const resetForm = () => {
    setFormData({ role: 'seller', allowedWarehouseIds: [] });
    setNationalIdQuery('');
    setFoundPerson(null);
    setEditingUser(null);
    setShowAdd(false);
  };

  const handleSearchNationalId = () => {
    if (!isValidNationalId(nationalIdQuery)) {
      alert('کد ملی نامعتبر است.');
      return;
    }
    const person = persons.find(p => p.nationalId === nationalIdQuery);
    if (person) {
      setFoundPerson(person);
      setFormData({ ...formData, name: person.name });
    } else {
      alert('شخصی با این کد ملی یافت نشد. لطفاً ابتدا شخص را در سیستم تعریف کنید.');
    }
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.username || !formData.password || !formData.defaultWarehouseId) {
      alert('لطفاً تمامی فیلدهای الزامی را پر کنید.');
      return;
    }

    // In this system, we want users to be linked to a person with a National ID
    const person = foundPerson || persons.find(p => p.name === formData.name);
    
    if (!person) {
      alert('کاربر حتماً باید به یک شخص در سیستم متصل باشد. لطفاً کد ملی معتبر وارد کرده و جستجو کنید.');
      return;
    }
    const userData: User = {
      ...(editingUser || { id: crypto.randomUUID(), createdAt: new Date().toISOString() }),
      ...formData as User,
      personId: person?.id
    };

    if (editingUser) {
      onUpdateUser(userData);
    } else {
      onAddUser(userData);
    }
    resetForm();
  };

  const handleDelete = (user: User) => {
    const hasTransactions = users.some(u => u.id === user.id) && false; // Placeholder for transaction check logic if applicable in future
    
    // For now, only prevent if it's the only admin
    if (user.role === 'admin' && users.filter(u => u.role === 'admin').length === 1) {
      alert('امکان حذف تنها مدیر سیستم وجود ندارد.');
      return;
    }

    if (window.confirm(`آیا از حذف کاربر "${user.name}" اطمینان دارید؟`)) {
      onDeleteUser(user.id);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
              <Users size={20} />
            </div>
            <h2 className="text-xl font-bold text-gray-800">مدیریت کاربران</h2>
          </div>
          <button 
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors shadow-sm"
          >
            <UserPlus size={18} />
            <span>افزودن کاربر</span>
          </button>
        </div>

        {/* User Form */}
        {(showAdd || editingUser) && (
          <div className="mb-8 p-6 bg-purple-50/50 rounded-xl border border-purple-100 space-y-4">
            <h3 className="font-bold text-purple-900">{editingUser ? 'ویرایش کاربر' : 'تعریف کاربر جدید'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex gap-2">
                <input 
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  placeholder="کد ملی شخص" 
                  className="p-3 rounded-lg border flex-1 font-mono" 
                  value={nationalIdQuery} 
                  onChange={e => setNationalIdQuery(toEnglishDigits(e.target.value).replace(/\D/g, ''))} 
                />
                <button 
                  onClick={handleSearchNationalId}
                  className="bg-zinc-800 text-white px-4 rounded-lg hover:bg-zinc-900"
                >
                  <Search size={18} />
                </button>
              </div>
              <input placeholder="نام و نام خانوادگی (از جستجو)" className="p-3 rounded-lg border bg-gray-50" value={formData.name || ''} readOnly />
              <input placeholder="نام کاربری" className="p-3 rounded-lg border" value={formData.username || ''} onChange={e => setFormData({...formData, username: e.target.value})} />
              <input type="password" placeholder="رمز عبور" className="p-3 rounded-lg border" value={formData.password || ''} onChange={e => setFormData({...formData, password: e.target.value})} />
              <select className="p-3 rounded-lg border" value={formData.role || 'seller'} onChange={e => setFormData({...formData, role: e.target.value as UserRole})}>
                <option value="admin">مدیر کل (قدیمی)</option>
                <option value="accountant">حسابدار (قدیمی)</option>
                <option value="cashier">صندوق‌دار (قدیمی)</option>
                <option value="seller">فروشنده (قدیمی)</option>
                <option value="agent">نماینده (قدیمی)</option>
              </select>
              <select 
                className="p-3 rounded-lg border font-bold text-indigo-700 bg-indigo-50/50 border-indigo-200" 
                value={formData.roleId || ''} 
                onChange={e => {
                  const rId = e.target.value;
                  const selectedRole = roles.find(r => r.id === rId);
                  let legacyRole: UserRole = 'seller';
                  if (rId === 'role_super_admin') legacyRole = 'admin';
                  else if (rId === 'role_representative') legacyRole = 'agent';
                  else if (rId === 'role_seller') legacyRole = 'seller';
                  
                  setFormData({
                    ...formData,
                    roleId: rId,
                    role: legacyRole
                  });
                }}
              >
                <option value="">انتخاب نقش امنیتی (RBAC)</option>
                {roles.map(r => (
                  <option key={r.id} value={r.id}>{r.name} {r.isSystemRole ? '(سیستمی)' : ''}</option>
                ))}
              </select>
              <select className="p-3 rounded-lg border" value={formData.defaultWarehouseId || ''} onChange={e => setFormData({...formData, defaultWarehouseId: e.target.value})}>
                <option value="">انتخاب انبار پیش‌فرض</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            
            {/* Warehouse Access */}
            <div className="space-y-2">
                <label className="text-sm font-bold text-gray-700">دسترسی انبارها:</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {warehouses.map(w => (
                        <label key={w.id} className="flex items-center gap-2 p-2 bg-white rounded border cursor-pointer">
                            <input type="checkbox" checked={formData.allowedWarehouseIds?.includes(w.id)} onChange={e => {
                                const newIds = e.target.checked 
                                    ? [...(formData.allowedWarehouseIds || []), w.id] 
                                    : (formData.allowedWarehouseIds || []).filter(id => id !== w.id);
                                setFormData({...formData, allowedWarehouseIds: newIds});
                            }} />
                            {w.name}
                        </label>
                    ))}
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button onClick={resetForm} className="px-4 py-2 text-gray-600 hover:bg-white rounded-lg"><X size={18}/></button>
              <button onClick={handleSubmit} className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-bold flex items-center gap-2"><Save size={18}/> ذخیره</button>
            </div>
          </div>
        )}

        {/* User List */}
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between p-4 bg-white border rounded-lg hover:bg-gray-50 transition-colors">
              <div>
                <h4 className="font-bold text-gray-800">{u.name}</h4>
                <p className="text-xs text-gray-500">
                  نام کاربری: {u.username} - نقش امنیتی (RBAC): <span className="font-bold text-indigo-600">{roles.find(r => r.id === u.roleId)?.name || u.role}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditingUser(u); setFormData(u); }} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"><Edit2 size={16}/></button>
                <button onClick={() => handleDelete(u)} className="p-2 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={16}/></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

}
