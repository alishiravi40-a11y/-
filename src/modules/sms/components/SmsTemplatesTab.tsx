/**
 * SMS Templates Management Tab
 * Dedicated UI for managing SMS message templates with dynamic variable insertion chips,
 * validation against unknown variables, and live interpolation preview.
 */

import React, { useState } from 'react';
import {
  FileText,
  Plus,
  Edit3,
  Trash2,
  Search,
  CheckCircle2,
  XCircle,
  Copy,
  Sparkles,
  AlertTriangle,
  X,
  Code,
  Shield,
} from 'lucide-react';
import { SmsEventTrigger, SmsTemplate } from '../types';
import { SmsTemplateEngine, DEFAULT_SMS_TEMPLATES } from '../templateEngine';

interface SmsTemplatesTabProps {
  templates: SmsTemplate[];
  onSaveTemplate: (template: SmsTemplate) => void;
  onDeleteTemplate?: (templateId: string) => void;
  userRole: 'SUPER_ADMIN' | 'ACCOUNTANT' | 'SALES_AGENT';
}

const DYNAMIC_VARIABLE_CHIPS = [
  { label: 'نام مشتری', tag: '{customer_name}' },
  { label: 'شماره فاکتور', tag: '{invoice_number}' },
  { label: 'مبلغ کل', tag: '{amount}' },
  { label: 'تاریخ سررسید', tag: '{due_date}' },
  { label: 'مبلغ باقیمانده', tag: '{remaining_amount}' },
  { label: 'شماره چک', tag: '{check_number}' },
  { label: 'نام بانک', tag: '{bank_name}' },
  { label: 'لینک پرداخت', tag: '{payment_link}' },
];

export const SmsTemplatesTab: React.FC<SmsTemplatesTabProps> = ({
  templates,
  onSaveTemplate,
  onDeleteTemplate,
  userRole,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTriggerFilter, setSelectedTriggerFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Partial<SmsTemplate> | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const canEdit = userRole === 'SUPER_ADMIN';

  const filteredTemplates = templates.filter((tpl) => {
    const matchesSearch =
      tpl.title.includes(searchTerm) ||
      tpl.content.includes(searchTerm) ||
      tpl.id.includes(searchTerm);

    const matchesTrigger =
      selectedTriggerFilter === 'all' || tpl.eventTrigger === selectedTriggerFilter;

    return matchesSearch && matchesTrigger;
  });

  const handleOpenNewModal = () => {
    if (!canEdit) return;
    setEditingTemplate({
      id: `tpl_custom_${Date.now().toString().slice(-4)}`,
      title: '',
      eventTrigger: 'manual_custom',
      content: '',
      variables: [],
      isActive: true,
      updatedAt: new Date().toISOString(),
    });
    setValidationError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (tpl: SmsTemplate) => {
    if (!canEdit) return;
    setEditingTemplate({ ...tpl });
    setValidationError(null);
    setIsModalOpen(true);
  };

  const handleInsertVariable = (tag: string) => {
    if (!editingTemplate) return;
    const currentContent = editingTemplate.content || '';
    const updatedContent = currentContent + ' ' + tag;

    const extracted = SmsTemplateEngine.extractVariables(updatedContent);

    setEditingTemplate({
      ...editingTemplate,
      content: updatedContent,
      variables: extracted,
    });
  };

  const handleContentChange = (content: string) => {
    const extracted = SmsTemplateEngine.extractVariables(content);
    setEditingTemplate((prev) => (prev ? { ...prev, content, variables: extracted } : null));
  };

  const handleSaveModal = () => {
    if (!editingTemplate || !editingTemplate.title || !editingTemplate.content) {
      setValidationError('لطفاً تمامی فیلدهای ضروری (عنوان و متن قالب) را تکمیل نمایید.');
      return;
    }

    // Validate variables format
    const extracted = SmsTemplateEngine.extractVariables(editingTemplate.content);
    const validTags = DYNAMIC_VARIABLE_CHIPS.map((c) => c.tag.replace(/[{}]/g, ''));
    
    // Check for weird brace usage
    const invalidVars = extracted.filter((v) => !validTags.includes(v) && !v.startsWith('custom_'));
    if (invalidVars.length > 0) {
      setValidationError(
        `متغیرهای ناشناخته شناسایی شدند: {${invalidVars.join(', ')}}. لطفاً از متغیرهای استاندارد استفاده نمایید.`
      );
      return;
    }

    onSaveTemplate(editingTemplate as SmsTemplate);
    setIsModalOpen(false);
    setEditingTemplate(null);
  };

  // Preview mock interpolation
  const getPreviewRender = (content?: string) => {
    if (!content) return '';
    return content
      .replace(/{customer_name}/g, 'رضا احمدی')
      .replace(/{invoice_number}/g, 'INV-1004')
      .replace(/{amount}/g, '۱۵۰,۰۰۰,۰۰۰ ریال')
      .replace(/{due_date}/g, '۱۴۰۵/0۲/15')
      .replace(/{remaining_amount}/g, '۵۰,۰۰۰,۰۰۰ ریال')
      .replace(/{check_number}/g, '458901')
      .replace(/{bank_name}/g, 'بانک ملی')
      .replace(/{payment_link}/g, 'https://pay.example.ir/1004');
  };

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            مدیریت قالب‌های پیامک و متغیرهای پویا
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            تعریف و ویرایش متن پیامک‌های سیستم با قابلیت درج هوشمند اطلاعات فاکتور، چک و اقساط
          </p>
        </div>

        {canEdit ? (
          <button
            onClick={handleOpenNewModal}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-2 transition-all shadow-sm shrink-0"
          >
            <Plus className="w-4 h-4" />
            تعریف قالب جدید
          </button>
        ) : (
          <div className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-semibold flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-slate-500" />
            مشاهده فقط خواندنی
          </div>
        )}
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row items-center gap-3 justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
          <input
            type="text"
            placeholder="جستجو در عنوان یا متن قالب..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-3 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-bold text-slate-500 whitespace-nowrap">فیلتر رویداد:</span>
          <select
            value={selectedTriggerFilter}
            onChange={(e) => setSelectedTriggerFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">همه رویدادها</option>
            <option value="cash_sale">فروش نقدی</option>
            <option value="installment_sale">فروش اقساطی</option>
            <option value="installment_due">سررسید قسط</option>
            <option value="installment_overdue">معوقه قسط</option>
            <option value="check_due">سررسید چک</option>
            <option value="check_bounced">چک برگشتی</option>
            <option value="manual_custom">دستی و سفارشی</option>
          </select>
        </div>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredTemplates.map((tpl) => (
          <div
            key={tpl.id}
            className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:border-emerald-200 transition-all flex flex-col justify-between space-y-4"
          >
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      tpl.isActive ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  />
                  <h3 className="text-sm font-bold text-slate-800">{tpl.title}</h3>
                </div>

                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                  {tpl.eventTrigger}
                </span>
              </div>

              {/* Template Raw Text */}
              <div className="mt-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/60 font-mono text-xs text-slate-700 leading-relaxed dir-rtl text-right">
                {tpl.content}
              </div>

              {/* Variables Chips */}
              <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                <span className="text-[11px] text-slate-400 font-semibold ml-1">متغیرها:</span>
                {tpl.variables.length > 0 ? (
                  tpl.variables.map((v, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-mono border border-emerald-200"
                    >
                      {`{${v}}`}
                    </span>
                  ))
                ) : (
                  <span className="text-[10px] text-slate-400 italic">بدون متغیر پویا</span>
                )}
              </div>
            </div>

            {/* Template Card Footer */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-[11px] text-slate-400">شناسه: {tpl.id}</span>

              {canEdit && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenEditModal(tpl)}
                    className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    ویرایش
                  </button>
                  {onDeleteTemplate && (
                    <button
                      onClick={() => onDeleteTemplate(tpl.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create Modal */}
      {isModalOpen && editingTemplate && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 space-y-5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-600" />
                {editingTemplate.id?.startsWith('tpl_custom_') ? 'تعریف قالب جدید پیامک' : 'ویرایش قالب پیامک'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {validationError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {validationError}
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">عنوان قالب</label>
                  <input
                    type="text"
                    value={editingTemplate.title || ''}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, title: e.target.value })
                    }
                    placeholder="مثال: یادآوری اقساط معوق"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">رویداد مرتبط</label>
                  <select
                    value={editingTemplate.eventTrigger || 'manual_custom'}
                    onChange={(e) =>
                      setEditingTemplate({
                        ...editingTemplate,
                        eventTrigger: e.target.value as SmsEventTrigger,
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="cash_sale">فروش نقدی</option>
                    <option value="installment_sale">فروش اقساطی</option>
                    <option value="installment_due">سررسید قسط</option>
                    <option value="installment_overdue">معوقه قسط</option>
                    <option value="check_due">سررسید چک</option>
                    <option value="check_bounced">چک برگشتی</option>
                    <option value="manual_custom">دستی و سفارشی</option>
                  </select>
                </div>
              </div>

              {/* Dynamic Variable Chips Bar */}
              <div>
                <label className="font-bold text-slate-700 block mb-1.5 flex items-center justify-between">
                  <span>درج متغیرهای هوشمند پویا (روی متغیر کلیک کنید)</span>
                  <span className="text-[10px] text-slate-400">خودکار به انتهای متن اضافه می‌شود</span>
                </label>
                <div className="flex flex-wrap gap-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60">
                  {DYNAMIC_VARIABLE_CHIPS.map((chip, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleInsertVariable(chip.tag)}
                      className="px-2.5 py-1 bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-300 rounded-lg font-mono text-[11px] transition-all flex items-center gap-1 shadow-2xs"
                    >
                      <Code className="w-3 h-3 text-emerald-600" />
                      {chip.label}
                      <span className="text-emerald-600 font-bold">{chip.tag}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea Content */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">متن اصلی قالب پیامک</label>
                <textarea
                  rows={4}
                  value={editingTemplate.content || ''}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="متن پیامک خود را بنویسید..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-mono text-xs focus:outline-none focus:border-emerald-500 dir-rtl text-right leading-relaxed"
                />
              </div>

              {/* Live Preview Render Box */}
              {editingTemplate.content && (
                <div className="p-3 bg-emerald-50/60 border border-emerald-200/80 rounded-xl space-y-1">
                  <span className="text-[11px] font-bold text-emerald-800 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    پیش‌نمایش جایگذاری آزمایشی متغیرها (Sample Render):
                  </span>
                  <p className="text-xs text-slate-800 leading-relaxed font-sans font-medium">
                    {getPreviewRender(editingTemplate.content)}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleSaveModal}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-colors shadow-sm"
              >
                ثبت و ذخیره قالب
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
