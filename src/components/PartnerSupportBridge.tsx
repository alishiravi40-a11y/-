import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageSquare, Plus, Send, Paperclip, CheckCircle, Clock, AlertCircle, 
  Search, Shield, User, Filter, ArrowRight, CornerDownLeft, Eye, RefreshCw, Cpu
} from 'lucide-react';
import { AppState, PartnerTicket, PartnerTicketMessage, Person, PersonAttachment } from '../types';
import { getCurrentJalaliDate } from '../utils/jalali';
import { compressImage } from '../utils/imageCompressor';

interface PartnerSupportBridgeProps {
  state: AppState;
  currentAgent: Person;
  onUpdateState: (newState: AppState) => void;
}

export const TICKET_CATEGORIES = [
  { id: 'document_inquiry', label: 'استعلام و بررسی مدارک', icon: '📄' },
  { id: 'credit_limit_request', label: 'درخواست افزایش سقف اعتبار', icon: '💳' },
  { id: 'financial_settlement', label: 'امور مالی، تسویه و واریزی', icon: '💰' },
  { id: 'technical', label: 'سوال و پشتیبانی فنی', icon: '🛠️' },
  { id: 'feedback', label: 'انتقاد، پیشنهاد و نقطه نظر', icon: '💡' },
  { id: 'other', label: 'سایر موضوعات', icon: '📌' },
];

export default function PartnerSupportBridge({ state, currentAgent, onUpdateState }: PartnerSupportBridgeProps) {
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'new' | 'in_progress' | 'answered' | 'closed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // New Ticket Form State
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newCategory, setNewCategory] = useState<PartnerTicket['category']>('document_inquiry');
  const [newPriority, setNewPriority] = useState<PartnerTicket['priority']>('medium');
  const [newMessage, setNewMessage] = useState('');
  const [attachments, setAttachments] = useState<PersonAttachment[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);

  // Reply state
  const [replyText, setReplyText] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<PersonAttachment[]>([]);

  // Agent Tickets List
  const agentTickets = useMemo(() => {
    const raw = (state.partnerTickets || []).filter(t => t.agentId === currentAgent.id || t.agentName === currentAgent.name);
    return raw.filter(t => {
      const matchStatus = selectedStatusFilter === 'all' || t.status === selectedStatusFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchQuery = !q || t.subject.toLowerCase().includes(q) || t.ticketNumber.toLowerCase().includes(q);
      return matchStatus && matchQuery;
    });
  }, [state.partnerTickets, currentAgent, selectedStatusFilter, searchQuery]);

  // Selected Ticket Object
  const activeTicket = useMemo(() => {
    if (!selectedTicketId) return agentTickets[0] || null;
    return (state.partnerTickets || []).find(t => t.id === selectedTicketId) || null;
  }, [state.partnerTickets, selectedTicketId, agentTickets]);

  // File Upload with Image Compression
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, isReply = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCompressing(true);
    try {
      if (file.type.startsWith('image/')) {
        const result = await compressImage(file, { maxDimension: 1200, quality: 0.75 });
        const newAtt: PersonAttachment = {
          id: 'ATT_' + Math.random().toString(36).substr(2, 9),
          name: file.name,
          url: result.compressedDataUrl,
          type: 'image/jpeg',
          uploadDate: getCurrentJalaliDate(),
          fileSizeKb: result.compressedSizeKb,
          originalSizeKb: result.originalSizeKb
        };
        if (isReply) {
          setReplyAttachments(prev => [...prev, newAtt]);
        } else {
          setAttachments(prev => [...prev, newAtt]);
        }
      } else {
        const objectUrl = URL.createObjectURL(file);
        const newAtt: PersonAttachment = {
          id: 'ATT_' + Math.random().toString(36).substr(2, 9),
          name: file.name,
          url: objectUrl,
          type: file.type || 'application/octet-stream',
          uploadDate: getCurrentJalaliDate(),
          fileSizeKb: +(file.size / 1024).toFixed(1)
        };
        if (isReply) {
          setReplyAttachments(prev => [...prev, newAtt]);
        } else {
          setAttachments(prev => [...prev, newAtt]);
        }
      }
    } catch (err) {
      alert('خطا در بارگذاری ضمیمه: ' + (err as Error).message);
    } finally {
      setIsCompressing(false);
      e.target.value = '';
    }
  };

  // Create Ticket Handler
  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.trim() || !newMessage.trim()) return;

    const ticketNo = 'T-' + (Math.floor(Math.random() * 9000) + 1000);
    const initialMsg: PartnerTicketMessage = {
      id: 'MSG_' + Date.now(),
      senderId: currentAgent.id,
      senderName: currentAgent.name,
      senderRole: 'agent',
      message: newMessage.trim(),
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: getCurrentJalaliDate() + ' ' + new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    };

    const newTicketObj: PartnerTicket = {
      id: 'TCK_' + Date.now(),
      ticketNumber: ticketNo,
      agentId: currentAgent.id,
      agentName: currentAgent.name,
      subject: newSubject.trim(),
      category: newCategory,
      priority: newPriority,
      status: 'new',
      messages: [initialMsg],
      createdAt: getCurrentJalaliDate(),
      updatedAt: getCurrentJalaliDate()
    };

    const updatedTickets = [newTicketObj, ...(state.partnerTickets || [])];
    onUpdateState({ ...state, partnerTickets: updatedTickets });

    // Reset form
    setNewSubject('');
    setNewMessage('');
    setAttachments([]);
    setShowNewTicketModal(false);
    setSelectedTicketId(newTicketObj.id);
  };

  // Reply to Ticket Handler
  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || (!replyText.trim() && replyAttachments.length === 0)) return;

    const replyMsg: PartnerTicketMessage = {
      id: 'MSG_' + Date.now(),
      senderId: currentAgent.id,
      senderName: currentAgent.name,
      senderRole: 'agent',
      message: replyText.trim(),
      attachments: replyAttachments.length > 0 ? replyAttachments : undefined,
      createdAt: getCurrentJalaliDate() + ' ' + new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    };

    const updatedTicket: PartnerTicket = {
      ...activeTicket,
      status: 'in_progress',
      messages: [...activeTicket.messages, replyMsg],
      updatedAt: getCurrentJalaliDate()
    };

    const updatedTickets = (state.partnerTickets || []).map(t => t.id === activeTicket.id ? updatedTicket : t);
    onUpdateState({ ...state, partnerTickets: updatedTickets });

    setReplyText('');
    setReplyAttachments([]);
  };

  return (
    <div className="space-y-5 font-sans text-right" dir="rtl">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-800 to-emerald-950 text-white rounded-2xl p-4 sm:p-6 shadow-md border border-zinc-800 flex justify-between items-center flex-wrap gap-4">
        <div className="flex items-center space-x-3 space-x-reverse">
          <div className="bg-emerald-500/20 text-emerald-400 p-3 rounded-2xl border border-emerald-500/30">
            <MessageSquare size={26} />
          </div>
          <div>
            <h2 className="text-base sm:text-xl font-black">پل ارتباطی و پشتیبانی نماینده با مدیریت</h2>
            <p className="text-xs text-zinc-300 mt-1">
              ارسال نظرات، پیگیری وضعیت مدارک، درخواست افزایش اعتبار و ارتباط مستقیم با مدیریت مجموعه
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowNewTicketModal(true)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition flex items-center gap-2 shadow-lg shadow-emerald-900/30"
        >
          <Plus size={16} />
          <span>ارسال پیام / تیکت جدید</span>
        </button>
      </div>

      {/* Main Container Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[500px]">
        {/* Left Column: Tickets List */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-zinc-200 shadow-xs flex flex-col overflow-hidden">
          {/* Filters & Search */}
          <div className="p-3.5 bg-zinc-50 border-b border-zinc-200 space-y-2.5">
            <div className="relative">
              <Search size={14} className="absolute right-3 top-2.5 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="جستجو در تیکت‌ها و گفتگوها..."
                className="w-full bg-white border border-zinc-300 rounded-xl pr-9 pl-3 py-1.5 text-xs outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px] font-bold">
              {[
                { id: 'all', label: 'همه' },
                { id: 'new', label: 'جدید' },
                { id: 'in_progress', label: 'در حال بررسی' },
                { id: 'answered', label: 'پاسخ داده شده' },
                { id: 'closed', label: 'بسته‌شده' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedStatusFilter(tab.id as any)}
                  className={`px-2.5 py-1 rounded-lg transition whitespace-nowrap ${
                    selectedStatusFilter === tab.id
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tickets Stream */}
          <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 max-h-[520px]">
            {agentTickets.length === 0 ? (
              <div className="p-8 text-center text-zinc-400 text-xs flex flex-col items-center">
                <MessageSquare size={36} className="mb-2 opacity-30 text-emerald-600" />
                <span>هیچ پیام یا تیکتی ثبت نشده است.</span>
                <button
                  onClick={() => setShowNewTicketModal(true)}
                  className="mt-3 text-emerald-700 font-bold hover:underline"
                >
                  ایجاد اولین پیام ارتباطی ➔
                </button>
              </div>
            ) : (
              agentTickets.map(t => {
                const isSelected = activeTicket?.id === t.id;
                const catObj = TICKET_CATEGORIES.find(c => c.id === t.category) || TICKET_CATEGORIES[5];
                const lastMsg = t.messages[t.messages.length - 1];

                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTicketId(t.id)}
                    className={`p-3.5 cursor-pointer transition flex flex-col justify-between space-y-2 ${
                      isSelected ? 'bg-emerald-50/70 border-r-4 border-emerald-600' : 'hover:bg-zinc-50'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{catObj.icon}</span>
                        <span className="text-xs font-bold text-zinc-800 line-clamp-1">{t.subject}</span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        t.status === 'answered'
                          ? 'bg-emerald-100 text-emerald-800'
                          : t.status === 'new'
                          ? 'bg-amber-100 text-amber-800'
                          : t.status === 'in_progress'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-zinc-100 text-zinc-600'
                      }`}>
                        {t.status === 'answered' ? 'پاسخ داده شد' : t.status === 'new' ? 'جدید' : t.status === 'in_progress' ? 'در حال بررسی' : 'بسته‌شده'}
                      </span>
                    </div>

                    <p className="text-[11px] text-zinc-500 line-clamp-1">
                      {lastMsg?.message || 'بدون متن'}
                    </p>

                    <div className="flex justify-between items-center text-[10px] text-zinc-400 font-mono pt-1">
                      <span>شماره: {t.ticketNumber}</span>
                      <span>{t.updatedAt}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Ticket Conversation Thread */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-zinc-200 shadow-xs flex flex-col overflow-hidden">
          {activeTicket ? (
            <>
              {/* Ticket Top Bar */}
              <div className="p-4 bg-zinc-50 border-b border-zinc-200 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold bg-zinc-900 text-white font-mono px-2 py-0.5 rounded">
                      {activeTicket.ticketNumber}
                    </span>
                    <h3 className="text-xs sm:text-sm font-bold text-zinc-800">{activeTicket.subject}</h3>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    دسته: {TICKET_CATEGORIES.find(c => c.id === activeTicket.category)?.label} | 
                    اولویّت: {activeTicket.priority === 'urgent' ? 'فوری' : activeTicket.priority === 'high' ? 'مهم' : 'عادی'}
                  </p>
                </div>

                <div className="text-left text-[11px]">
                  <span className={`font-bold px-2.5 py-1 rounded-full ${
                    activeTicket.status === 'answered'
                      ? 'bg-emerald-100 text-emerald-800'
                      : activeTicket.status === 'new'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {activeTicket.status === 'answered' ? 'پاسخ داده شده' : 'در حال پیگیری'}
                  </span>
                </div>
              </div>

              {/* Message History Thread */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[420px] bg-zinc-50/30">
                {activeTicket.messages.map(msg => {
                  const isAdmin = msg.senderRole === 'admin';

                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col max-w-[85%] ${isAdmin ? 'mr-auto items-start' : 'ml-auto items-end'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 text-[10px] text-zinc-500 font-bold">
                        <span>{isAdmin ? '🛡️ مدیریت مجموعه' : `👤 ${msg.senderName}`}</span>
                        <span>•</span>
                        <span className="font-mono">{msg.createdAt}</span>
                      </div>

                      <div className={`p-3.5 rounded-2xl text-xs space-y-2 shadow-xs ${
                        isAdmin
                          ? 'bg-zinc-900 text-white rounded-tr-none'
                          : 'bg-emerald-600 text-white rounded-tl-none'
                      }`}>
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.message}</p>

                        {/* Attachments */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="pt-2 border-t border-white/20 space-y-1.5">
                            <span className="text-[10px] opacity-80 block">پیوست‌ها:</span>
                            {msg.attachments.map(att => (
                              <a
                                key={att.id}
                                href={att.url}
                                target="_blank"
                                rel="noreferrer"
                                className="bg-white/10 hover:bg-white/20 p-2 rounded-lg text-[10px] flex items-center justify-between transition text-white"
                              >
                                <span className="truncate max-w-[180px]">{att.name}</span>
                                <span className="font-mono opacity-70">{att.fileSizeKb} KB</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reply Box */}
              <form onSubmit={handleSendReply} className="p-3 bg-white border-t border-zinc-200 space-y-2">
                {replyAttachments.length > 0 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {replyAttachments.map(att => (
                      <span key={att.id} className="text-[10px] bg-emerald-50 text-emerald-800 font-bold px-2 py-1 rounded-lg border border-emerald-200">
                        📎 {att.name} ({att.fileSizeKb} KB)
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="پاسخ یا توضیح جدید برای مدیریت..."
                    className="flex-1 bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-500"
                  />

                  <label className="p-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-xl cursor-pointer transition" title="پیوست مدرک">
                    <Paperclip size={16} />
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={e => handleFileUpload(e, true)}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="submit"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1 transition"
                  >
                    <Send size={14} />
                    <span>ارسال</span>
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-400">
              <MessageSquare size={48} className="mb-3 opacity-20 text-emerald-600" />
              <h3 className="text-sm font-bold text-zinc-700">یک گفتگو را برای مشاهده انتخاب کنید</h3>
              <p className="text-xs text-zinc-400 mt-1 max-w-sm">
                از سمت راست می‌توانید پیام‌های قبلی را باز کرده یا با دکمه ثبت پیام جدید، درخواست جدیدی ارسال کنید.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create New Ticket */}
      <AnimatePresence>
        {showNewTicketModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 font-sans text-right" dir="rtl">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl border border-zinc-200"
            >
              {/* Header */}
              <div className="bg-zinc-900 text-white p-4 flex justify-between items-center border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <MessageSquare size={20} className="text-emerald-400" />
                  <h3 className="text-sm font-bold">ثبت تیکت / پیام جدید به مدیریت</h3>
                </div>
                <button onClick={() => setShowNewTicketModal(false)} className="text-zinc-400 hover:text-white">
                  ✕
                </button>
              </div>

              {/* Form Body */}
              <form onSubmit={handleCreateTicket} className="p-4 sm:p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="sm:col-span-2">
                    <label className="font-bold text-zinc-700 block mb-1">موضوع یا عنوان پیام:</label>
                    <input
                      type="text"
                      required
                      value={newSubject}
                      onChange={e => setNewSubject(e.target.value)}
                      placeholder="مثال: استعلام تایید مدارک خریدار پرونده #1002"
                      className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-zinc-700 block mb-1">دسته‌بندی موضوع:</label>
                    <select
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value as any)}
                      className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 outline-none font-bold"
                    >
                      {TICKET_CATEGORIES.map(cat => (
                        <option key={cat.id} value={cat.id}>
                          {cat.icon} {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-zinc-700 block mb-1">میزان اولویّت:</label>
                    <select
                      value={newPriority}
                      onChange={e => setNewPriority(e.target.value as any)}
                      className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 outline-none font-bold"
                    >
                      <option value="low">عادی</option>
                      <option value="medium">متوسط / مهم</option>
                      <option value="urgent">فوری / ضروری</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="font-bold text-zinc-700 block mb-1">متن کامل پیام یا نقطه نظر:</label>
                    <textarea
                      required
                      rows={5}
                      value={newMessage}
                      onChange={e => setNewMessage(e.target.value)}
                      placeholder="مشروح نظر، گزارش، استعلام یا درخواست خود را اینجا بنویسید..."
                      className="w-full bg-zinc-50 border border-zinc-300 rounded-xl p-3 text-xs outline-none focus:border-emerald-500 resize-none"
                    />
                  </div>

                  {/* Attachment Box */}
                  <div className="sm:col-span-2 bg-zinc-50 p-3 rounded-xl border border-zinc-200 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-zinc-700">پیوست تصویر مدرک / فایل (اختیاری):</span>
                      <label className="bg-white border border-zinc-300 hover:bg-zinc-100 text-zinc-700 font-bold px-3 py-1 rounded-lg text-[11px] cursor-pointer transition flex items-center gap-1">
                        {isCompressing ? (
                          <>
                            <RefreshCw size={12} className="animate-spin" />
                            <span>در حال فشرده‌سازی...</span>
                          </>
                        ) : (
                          <>
                            <Paperclip size={12} />
                            <span>انتخاب فایل/عکس</span>
                            <input
                              type="file"
                              accept="image/*,.pdf"
                              disabled={isCompressing}
                              onChange={e => handleFileUpload(e, false)}
                              className="hidden"
                            />
                          </>
                        )}
                      </label>
                    </div>

                    {attachments.length > 0 && (
                      <div className="flex items-center gap-2 overflow-x-auto pt-1">
                        {attachments.map(att => (
                          <div key={att.id} className="bg-emerald-100 text-emerald-900 text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-1">
                            <span>📎 {att.name}</span>
                            <span className="font-mono text-emerald-700">({att.fileSizeKb} KB)</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setShowNewTicketModal(false)}
                    className="px-4 py-2 bg-zinc-200 text-zinc-700 rounded-xl hover:bg-zinc-300 transition"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition flex items-center gap-1.5 shadow-sm"
                  >
                    <Send size={14} />
                    <span>ارسال پیام به مدیریت</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
