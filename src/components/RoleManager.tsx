import React, { useState } from 'react';
import { Role, Permission, RolePermission } from '../types';
import { Shield, Plus, Edit2, Trash2, Check, X, Save, Lock, AlertTriangle, ToggleLeft, ToggleRight, HelpCircle } from 'lucide-react';

interface RoleManagerProps {
  roles: Role[];
  permissions: Permission[];
  rolePermissions: RolePermission[];
  onAddRole: (role: Role) => void;
  onUpdateRole: (role: Role) => void;
  onDeleteRole: (id: string) => void;
  onUpdateRolePermissions: (rolePermissions: RolePermission[]) => void;
}

export function RoleManager({
  roles = [],
  permissions = [],
  rolePermissions = [],
  onAddRole,
  onUpdateRole,
  onDeleteRole,
  onUpdateRolePermissions,
}: RoleManagerProps) {
  const [selectedRoleId, setSelectedRoleId] = useState<string>(roles[0]?.id || 'role_seller');
  const [isEditingRole, setIsEditingRole] = useState(false);
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [roleFormData, setRoleFormData] = useState<Partial<Role>>({
    name: '',
    description: '',
    maximumDiscountPercent: 0,
    maximumCreditLimit: 0,
    isActive: true,
  });

  const selectedRole = roles.find(r => r.id === selectedRoleId);

  // Group permissions by category for standard modular visualization
  const permissionsByCategory = permissions.reduce((acc, p) => {
    if (!acc[p.category]) {
      acc[p.category] = [];
    }
    acc[p.category].push(p);
    return acc;
  }, {} as Record<string, Permission[]>);

  const handleTogglePermission = (permissionId: string) => {
    if (!selectedRoleId) return;
    
    // Find if the entry exists
    const existingIndex = rolePermissions.findIndex(
      rp => rp.roleId === selectedRoleId && rp.permissionId === permissionId
    );

    let updatedPermissions = [...rolePermissions];
    if (existingIndex > -1) {
      updatedPermissions[existingIndex] = {
        ...updatedPermissions[existingIndex],
        allow: !updatedPermissions[existingIndex].allow,
      };
    } else {
      updatedPermissions.push({
        roleId: selectedRoleId,
        permissionId,
        allow: true,
      });
    }

    onUpdateRolePermissions(updatedPermissions);
  };

  const handleRoleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleFormData.name) return;

    if (isCreatingRole) {
      const newRole: Role = {
        id: 'role_' + crypto.randomUUID().substring(0, 8),
        name: roleFormData.name,
        description: roleFormData.description || '',
        isSystemRole: false,
        isActive: roleFormData.isActive ?? true,
        maximumDiscountPercent: Number(roleFormData.maximumDiscountPercent || 0),
        maximumCreditLimit: Number(roleFormData.maximumCreditLimit || 0),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onAddRole(newRole);
      setSelectedRoleId(newRole.id);
      setIsCreatingRole(false);
    } else if (isEditingRole && selectedRole) {
      const updatedRole: Role = {
        ...selectedRole,
        name: roleFormData.name,
        description: roleFormData.description || '',
        isActive: roleFormData.isActive ?? true,
        maximumDiscountPercent: Number(roleFormData.maximumDiscountPercent || 0),
        maximumCreditLimit: Number(roleFormData.maximumCreditLimit || 0),
        updatedAt: new Date().toISOString(),
      };
      onUpdateRole(updatedRole);
      setIsEditingRole(false);
    }

    setRoleFormData({
      name: '',
      description: '',
      maximumDiscountPercent: 0,
      maximumCreditLimit: 0,
      isActive: true,
    });
  };

  const startEditRole = () => {
    if (!selectedRole) return;
    setRoleFormData({
      name: selectedRole.name,
      description: selectedRole.description,
      maximumDiscountPercent: selectedRole.maximumDiscountPercent,
      maximumCreditLimit: selectedRole.maximumCreditLimit,
      isActive: selectedRole.isActive,
    });
    setIsEditingRole(true);
    setIsCreatingRole(false);
  };

  const startCreateRole = () => {
    setRoleFormData({
      name: '',
      description: '',
      maximumDiscountPercent: 0,
      maximumCreditLimit: 0,
      isActive: true,
    });
    setIsCreatingRole(true);
    setIsEditingRole(false);
  };

  const handleDeleteSelectedRole = () => {
    if (!selectedRoleId || selectedRole?.isSystemRole) return;
    if (confirm(`آیا از حذف نقش "${selectedRole?.name}" اطمینان دارید؟`)) {
      onDeleteRole(selectedRoleId);
      // Fallback selection to first remaining role
      const remaining = roles.filter(r => r.id !== selectedRoleId);
      if (remaining.length > 0) {
        setSelectedRoleId(remaining[0].id);
      }
    }
  };

  const isPermissionAllowed = (permissionId: string) => {
    const mapping = rolePermissions.find(
      rp => rp.roleId === selectedRoleId && rp.permissionId === permissionId
    );
    return mapping ? mapping.allow : false;
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Visual Header */}
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Shield size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">مدیریت نقش‌ها و سطوح دسترسی (RBAC)</h2>
            <p className="text-xs text-gray-500 mt-1">
              تنظیم زیرساخت نقش‌های کاربری، کنترل سقف تخفیف، محدودیت‌های اعتباری و مجوزهای دسترسی داده‌محور
            </p>
          </div>
        </div>
        <button
          onClick={startCreateRole}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-all shadow-sm font-bold text-sm"
        >
          <Plus size={18} />
          <span>ایجاد نقش جدید</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Roles Sidebar Selection */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-3">
            <h3 className="font-bold text-gray-700 text-sm border-b pb-2">فهرست نقش‌های سیستم</h3>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {roles.map(role => {
                const isSelected = role.id === selectedRoleId;
                return (
                  <button
                    key={role.id}
                    onClick={() => {
                      setSelectedRoleId(role.id);
                      setIsEditingRole(false);
                      setIsCreatingRole(false);
                    }}
                    className={`w-full text-right p-3 rounded-xl transition-all border flex flex-col gap-1 ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-200 shadow-sm'
                        : 'bg-white border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className="font-bold text-gray-800 text-sm">{role.name}</span>
                      <div className="flex gap-1">
                        {role.isSystemRole && (
                          <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                            سیستمی
                          </span>
                        )}
                        {!role.isActive && (
                          <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                            غیرفعال
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-1">{role.description}</p>
                    
                    {/* Key limits summarized under role */}
                    <div className="flex gap-4 text-[10px] text-gray-400 mt-2 border-t pt-1 border-dashed">
                      <span>سقف تخفیف: {role.maximumDiscountPercent}%</span>
                      <span>سقف اعتبار: {role.maximumCreditLimit === 1000000000000 ? 'نامحدود' : `${role.maximumCreditLimit.toLocaleString()} ریال`}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Roles Management & Permissions Grid */}
        <div className="lg:col-span-8 space-y-6">
          {/* Role Form Panel (Create/Edit) */}
          {(isCreatingRole || isEditingRole) && (
            <form onSubmit={handleRoleSubmit} className="bg-white p-6 rounded-xl border border-indigo-100 shadow-sm space-y-4">
              <div className="flex justify-between items-center pb-2 border-b">
                <h3 className="font-bold text-indigo-900">
                  {isCreatingRole ? 'تعریف نقش کاربری جدید' : `ویرایش مشخصات نقش: ${selectedRole?.name}`}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingRole(false);
                    setIsEditingRole(false);
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600">نام نقش *</label>
                  <input
                    type="text"
                    required
                    disabled={isEditingRole && selectedRole?.isSystemRole}
                    className="w-full p-2.5 rounded-lg border focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 text-sm"
                    value={roleFormData.name}
                    onChange={e => setRoleFormData({ ...roleFormData, name: e.target.value })}
                    placeholder="مثال: کارشناس ارشد فروش"
                  />
                  {isEditingRole && selectedRole?.isSystemRole && (
                    <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-0.5">
                      <Lock size={10} /> نام نقش‌های پیش‌فرض سیستم غیرقابل تغییر است.
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600">توضیحات نقش</label>
                  <input
                    type="text"
                    className="w-full p-2.5 rounded-lg border focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 text-sm"
                    value={roleFormData.description}
                    onChange={e => setRoleFormData({ ...roleFormData, description: e.target.value })}
                    placeholder="توضیح مختصر در مورد محدوده مسئولیت این نقش"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600">حداکثر درصد تخفیف مجاز (%)</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*"

                    min="0"
                    max="100"
                    className="w-full p-2.5 rounded-lg border focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 text-sm"
                    value={roleFormData.maximumDiscountPercent || 0}
                    onChange={e => setRoleFormData({ ...roleFormData, maximumDiscountPercent: Number(e.target.value) })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600">حداکثر سقف فروش اعتباری مجاز (ریال)</label>
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*"

                    min="0"
                    className="w-full p-2.5 rounded-lg border focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 text-sm"
                    value={roleFormData.maximumCreditLimit || 0}
                    onChange={e => setRoleFormData({ ...roleFormData, maximumCreditLimit: Number(e.target.value) })}
                  />
                </div>

                <div className="md:col-span-2 flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="role_is_active_cb"
                    checked={roleFormData.isActive ?? true}
                    onChange={e => setRoleFormData({ ...roleFormData, isActive: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  <label htmlFor="role_is_active_cb" className="text-xs font-bold text-gray-700 cursor-pointer">
                    این نقش فعال است (در صورت غیرفعال بودن، کاربران منتسب به این نقش قادر به ورود به سیستم نخواهند بود)
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingRole(false);
                    setIsEditingRole(false);
                  }}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <Save size={16} />
                  <span>ذخیره مشخصات نقش</span>
                </button>
              </div>
            </form>
          )}

          {/* Role details display & Permissions Matrix */}
          {selectedRole && !isEditingRole && !isCreatingRole && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Selected Role Actions Bar */}
              <div className="bg-gray-50/70 p-4 border-b flex justify-between items-center gap-2 flex-wrap">
                <div>
                  <h3 className="font-bold text-gray-800 text-base flex items-center gap-2">
                    <span>{selectedRole.name}</span>
                    {selectedRole.isSystemRole && (
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                        نقش سیستمی غیرقابل حذف
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">{selectedRole.description}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={startEditRole}
                    className="flex items-center gap-1 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs"
                  >
                    <Edit2 size={14} />
                    <span>ویرایش مشخصات</span>
                  </button>
                  {!selectedRole.isSystemRole && (
                    <button
                      onClick={handleDeleteSelectedRole}
                      className="flex items-center gap-1 bg-white hover:bg-red-50 border border-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs"
                    >
                      <Trash2 size={14} />
                      <span>حذف نقش</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Limits and Constraints Summary */}
              <div className="p-5 bg-indigo-50/30 border-b border-indigo-100/30 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-8 bg-indigo-500 rounded-full" />
                  <div>
                    <span className="text-[11px] text-gray-400 block">حداکثر سقف تخفیف در فاکتور</span>
                    <span className="font-extrabold text-indigo-950 text-sm">
                      {selectedRole.maximumDiscountPercent}% تخفیف
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-8 bg-indigo-500 rounded-full" />
                  <div>
                    <span className="text-[11px] text-gray-400 block">حداکثر سقف فروش اعتباری مجاز</span>
                    <span className="font-extrabold text-indigo-950 text-sm">
                      {selectedRole.maximumCreditLimit === 1000000000000
                        ? 'بدون محدودیت سقف اعتبار'
                        : `${selectedRole.maximumCreditLimit.toLocaleString()} ریال`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Security Infrastructure Notice (Requirement: No hardcoded blocks, visual-only setup) */}
              <div className="m-4 p-3 bg-amber-50 rounded-lg border border-amber-100 flex items-start gap-2.5">
                <div className="text-amber-600 mt-0.5">
                  <AlertTriangle size={16} />
                </div>
                <div className="text-xs text-amber-800 leading-relaxed">
                  <span className="font-bold">توضیح زیرساخت امنیتی:</span> در این فاز، تغییرات اعمال شده روی دسترسی‌ها کاملاً داده‌محور و داینامیک ثبت می‌شوند اما جهت جلوگیری از رگرسیون (Regression) و حفظ تداوم عملیات‌های مالی، هیچ محدودیت یا قفل کاربری روی صفحات یا منوها به صورت عملی اعمال نمی‌شود و این مجوزها صرفاً برای فاز بعدی پروژه به صورت ساختاریافته ذخیره می‌گردند.
                </div>
              </div>

              {/* Permissions List Grid */}
              <div className="p-5 space-y-6">
                <h4 className="font-extrabold text-gray-800 text-sm flex items-center gap-1.5 pb-2 border-b">
                  <Check size={16} className="text-green-600" />
                  <span>ماتریس مجوزهای دسترسی نقش</span>
                </h4>

                <div className="space-y-6">
                  {Object.entries(permissionsByCategory).map(([category, items]) => (
                    <div key={category} className="space-y-2">
                      <h5 className="font-bold text-gray-700 text-xs bg-gray-100/80 px-3 py-1.5 rounded-md flex items-center justify-between">
                        <span>گروه: {category}</span>
                        <span className="text-[10px] text-gray-400 font-normal">
                          {items.length} مجوز دسترسی
                        </span>
                      </h5>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {items.map(p => {
                          const allowed = isPermissionAllowed(p.id);
                          const isSpecialRepresentativePermission = 
                            selectedRole.id === 'role_representative' && 
                            (p.id === 'AccessCreditPurchase' || p.id === 'AccessInvestmentSales');

                          return (
                            <div
                              key={p.id}
                              onClick={() => handleTogglePermission(p.id)}
                              className={`p-3 rounded-xl border flex justify-between items-start gap-4 cursor-pointer transition-all ${
                                allowed
                                  ? 'bg-emerald-50/40 border-emerald-100 hover:bg-emerald-50'
                                  : 'bg-white border-gray-100 hover:bg-gray-50'
                              } ${
                                isSpecialRepresentativePermission 
                                  ? 'ring-2 ring-indigo-500/10 border-indigo-200' 
                                  : ''
                              }`}
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-gray-800">{p.name}</span>
                                  {isSpecialRepresentativePermission && (
                                    <span className="text-[9px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded-full">
                                      خاص نماینده
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-gray-400 leading-normal">{p.description}</p>
                              </div>
                              <div className="mt-0.5 text-gray-300">
                                {allowed ? (
                                  <div className="text-emerald-600">
                                    <ToggleRight size={24} />
                                  </div>
                                ) : (
                                  <div className="text-gray-300">
                                    <ToggleLeft size={24} />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
