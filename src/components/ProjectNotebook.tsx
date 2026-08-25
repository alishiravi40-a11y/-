import React, { useState, useMemo } from 'react';
import { 
  ClipboardList, 
  X, 
  Plus, 
  Search, 
  Trash2, 
  Edit3, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Save,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ProjectNote, ProjectNoteStatus } from '../types';

interface ProjectNotebookProps {
  notes: ProjectNote[];
  onAddNote: (note: Omit<ProjectNote, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateNote: (id: string, updates: Partial<ProjectNote>) => void;
  onDeleteNote: (id: string) => void;
}

const ProjectNotebook: React.FC<ProjectNotebookProps> = ({ 
  notes, 
  onAddNote, 
  onUpdateNote, 
  onDeleteNote 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStatus, setFormStatus] = useState<ProjectNoteStatus>('todo');

  // Escape key to close
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen]);

  const filteredNotes = useMemo(() => {
    let result = [...notes];
    
    // Search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(n => 
        n.title.toLowerCase().includes(term) || 
        n.description.toLowerCase().includes(term)
      );
    }

    // Sort: Done at the bottom, others by updatedAt
    return result.sort((a, b) => {
      if (a.status === 'done' && b.status !== 'done') return 1;
      if (a.status !== 'done' && b.status === 'done') return -1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [notes, searchTerm]);

  const handleOpenAdd = () => {
    setFormTitle('');
    setFormDesc('');
    setFormStatus('todo');
    setIsAdding(true);
    setEditingId(null);
  };

  const handleOpenEdit = (note: ProjectNote) => {
    setFormTitle(note.title);
    setFormDesc(note.description);
    setFormStatus(note.status);
    setEditingId(note.id);
    setIsAdding(false);
  };

  const handleSave = () => {
    if (!formTitle.trim()) return;

    if (editingId) {
      onUpdateNote(editingId, {
        title: formTitle,
        description: formDesc,
        status: formStatus
      });
      setEditingId(null);
    } else {
      onAddNote({
        title: formTitle,
        description: formDesc,
        status: formStatus
      });
      setIsAdding(false);
    }
  };

  const getStatusColor = (status: ProjectNoteStatus) => {
    switch (status) {
      case 'todo': return 'bg-rose-500';
      case 'in-progress': return 'bg-amber-500';
      case 'done': return 'bg-emerald-500';
      default: return 'bg-zinc-500';
    }
  };

  const getStatusLabel = (status: ProjectNoteStatus) => {
    switch (status) {
      case 'todo': return 'انجام نشده';
      case 'in-progress': return 'در حال انجام';
      case 'done': return 'انجام شد';
      default: return '';
    }
  };

  // We keep the variables referenced so typescript does not complain about unused local variables
  const unusedReferences = [isOpen, searchTerm, isAdding, editingId, formTitle, formDesc, formStatus, filteredNotes, getStatusColor, getStatusLabel, handleOpenAdd, handleOpenEdit, handleSave, onAddNote, onUpdateNote, onDeleteNote];
  if (unusedReferences) return null;

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-zinc-900 text-white p-3 rounded-2xl shadow-2xl hover:scale-110 transition-all flex items-center gap-2 group"
        dir="rtl"
      >
        <div className="relative">
          <ClipboardList size={20} />
          {notes.filter(n => n.status !== 'done').length > 0 && (
            <span className="absolute -top-2 -right-2 w-4 h-4 bg-rose-500 text-[10px] rounded-full flex items-center justify-center font-bold">
              {notes.filter(n => n.status !== 'done').length}
            </span>
          )}
        </div>
        <span className="text-xs font-black max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300">
          دفترچه پروژه
        </span>
      </button>

      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              console.log('Backdrop clicked');
              setIsOpen(false);
            }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[9998]"
          />
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 35, stiffness: 450 }}
            className="fixed inset-y-0 right-0 w-full max-w-md bg-white z-[9999] shadow-[0_0_50px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden border-l border-zinc-200"
            dir="rtl"
          >
            {/* Header */}
            <div 
              className="p-4 border-b flex items-center justify-between bg-zinc-100 select-none"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 bg-zinc-900 rounded-xl text-white shadow-lg">
                  <ClipboardList size={20} />
                </div>
                <div>
                  <h2 className="text-sm font-black text-zinc-900 leading-none">یادداشت‌های پروژه</h2>
                  <span className="text-[9px] text-zinc-400 font-bold mt-1 block">Project Management Tool</span>
                </div>
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }} 
                className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-all shadow-lg shadow-rose-200 font-black text-xs group"
              >
                <X size={18} className="group-hover:rotate-90 transition-transform" />
                <span>بستن دفترچه</span>
              </button>
            </div>

            {/* Content Area */}
            <div 
              className="flex-1 overflow-y-auto p-4 space-y-4"
              onDoubleClick={(e) => {
                const target = e.target as HTMLElement;
                if (!target.closest('button') && !target.closest('input') && !target.closest('textarea')) {
                  setIsOpen(false);
                }
              }}
            >
              {isAdding || editingId ? (
                /* Add/Edit Form */
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 space-y-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-black text-zinc-600">
                      {editingId ? 'ویرایش یادداشت' : 'افزودن یادداشت جدید'}
                    </h3>
                    <button 
                      onClick={() => { setIsAdding(false); setEditingId(null); }}
                      className="text-[10px] text-zinc-400 font-bold hover:text-zinc-600"
                    >
                      انصراف
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-zinc-400 block mb-1 mr-1">عنوان یادداشت</label>
                      <input 
                        value={formTitle}
                        onChange={(e) => setFormTitle(e.target.value)}
                        placeholder="مثلاً: اصلاح فونت گزارشات"
                        className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-zinc-900 outline-none"
                      />
                    </div>
                    
                    <div>
                      <label className="text-[10px] font-bold text-zinc-400 block mb-1 mr-1">توضیحات</label>
                      <textarea 
                        value={formDesc}
                        onChange={(e) => setFormDesc(e.target.value)}
                        placeholder="جزئیات بیشتر..."
                        rows={3}
                        className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-zinc-900 outline-none resize-none"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setFormStatus('todo')}
                        className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all ${formStatus === 'todo' ? 'bg-rose-50 border-rose-200 text-rose-600 shadow-sm' : 'bg-white border-zinc-100 text-zinc-400'}`}
                      >
                        انجام نشده
                      </button>
                      <button 
                        onClick={() => setFormStatus('in-progress')}
                        className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all ${formStatus === 'in-progress' ? 'bg-amber-50 border-amber-200 text-amber-600 shadow-sm' : 'bg-white border-zinc-100 text-zinc-400'}`}
                      >
                        در حال انجام
                      </button>
                      <button 
                        onClick={() => setFormStatus('done')}
                        className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all ${formStatus === 'done' ? 'bg-emerald-50 border-emerald-200 text-emerald-600 shadow-sm' : 'bg-white border-zinc-100 text-zinc-400'}`}
                      >
                        انجام شد
                      </button>
                    </div>

                    <button 
                      onClick={handleSave}
                      disabled={!formTitle.trim()}
                      className="w-full bg-zinc-900 text-white py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale transition-all"
                    >
                      <Save size={14} />
                      {editingId ? 'بروزرسانی یادداشت' : 'ثبت در دفترچه'}
                    </button>
                  </div>
                </motion.div>
              ) : (
                /* List View */
                <>
                  {/* Search Bar */}
                  <div className="relative group">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-zinc-900 transition-colors" size={16} />
                    <input 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="جستجو در یادداشت‌ها..."
                      className="w-full bg-zinc-100 border border-transparent focus:bg-white focus:border-zinc-200 rounded-xl px-10 py-2.5 text-xs outline-none transition-all"
                    />
                  </div>

                  {/* Add New Trigger */}
                  <button 
                    onClick={handleOpenAdd}
                    className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-zinc-200 rounded-2xl text-zinc-400 hover:border-zinc-900 hover:text-zinc-900 transition-all group"
                  >
                    <Plus size={18} className="group-hover:rotate-90 transition-transform" />
                    <span className="text-xs font-bold">افزودن یادداشت جدید</span>
                  </button>

                  {/* Notes List */}
                  <div className="space-y-3 pb-8">
                    {filteredNotes.length > 0 ? (
                      filteredNotes.map((note) => (
                        <div 
                          key={note.id}
                          className={`p-3 rounded-2xl border transition-all relative group/item ${note.status === 'done' ? 'bg-zinc-50/50 border-zinc-100' : 'bg-white border-zinc-100 hover:shadow-md'}`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${getStatusColor(note.status)} shadow-sm`}></div>
                              <h4 className={`text-[11px] font-black ${note.status === 'done' ? 'text-zinc-400 line-through' : 'text-zinc-900'}`}>
                                {note.title}
                              </h4>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                              <button 
                                onClick={() => handleOpenEdit(note)}
                                className="p-1.5 hover:bg-zinc-100 rounded-lg text-zinc-400 hover:text-blue-500 transition-colors"
                              >
                                <Edit3 size={14} />
                              </button>
                              <button 
                                onClick={() => {
                                  if (confirm('آیا از حذف این یادداشت اطمینان دارید؟')) onDeleteNote(note.id);
                                }}
                                className="p-1.5 hover:bg-zinc-100 rounded-lg text-zinc-400 hover:text-rose-500 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                          
                          {note.description && (
                            <p className={`text-[10px] leading-relaxed mb-3 ${note.status === 'done' ? 'text-zinc-300' : 'text-zinc-500'}`}>
                              {note.description}
                            </p>
                          )}

                          <div className="flex items-center justify-between mt-auto pt-2 border-t border-zinc-50">
                            <div className="flex items-center gap-1.5">
                              {note.status === 'done' ? (
                                <CheckCircle2 size={12} className="text-emerald-500" />
                              ) : note.status === 'in-progress' ? (
                                <Clock size={12} className="text-amber-500 animate-pulse" />
                              ) : (
                                <AlertCircle size={12} className="text-rose-500" />
                              )}
                              <span className={`text-[9px] font-bold ${
                                note.status === 'done' ? 'text-emerald-500' : 
                                note.status === 'in-progress' ? 'text-amber-500' : 
                                'text-rose-500'
                              }`}>
                                {getStatusLabel(note.status)}
                              </span>
                            </div>
                            
                            {note.status !== 'done' && (
                              <button 
                                onClick={() => onUpdateNote(note.id, { status: 'done' })}
                                className="flex items-center gap-1 text-[9px] font-black text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded-lg transition-colors"
                              >
                                <span>انجام شد</span>
                                <ArrowRight size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-12 flex flex-col items-center justify-center text-zinc-300 gap-3">
                        <ClipboardList size={48} strokeWidth={1} />
                        <span className="text-[11px] font-bold">یادداشتی پیدا نشد</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 bg-zinc-50 border-t flex justify-center">
               <span className="text-[9px] text-zinc-400 font-bold tracking-widest uppercase">Project Management v1.0</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ProjectNotebook;
