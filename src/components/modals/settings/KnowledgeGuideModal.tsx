import React from 'react';
import { motion } from 'motion/react';
import { BookOpen, X, FileCheck, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { AppState, KnowledgeArticle } from '../../../types';

interface KnowledgeGuideModalProps {
  activeTab: string;
  activeKnowledgeArticle: KnowledgeArticle | null;
  appState: AppState;
  setActiveKnowledgeArticle: (art: KnowledgeArticle | null) => void;
  setActiveTab: (tab: any) => void;
}

export const KnowledgeGuideModal: React.FC<KnowledgeGuideModalProps> = ({
  activeTab,
  activeKnowledgeArticle,
  appState,
  setActiveKnowledgeArticle,
  setActiveTab,
}) => {
  const TAB_KNOWLEDGE_CODES: Record<string, string> = {
    invoices: 'INV-001',
    checks: 'CHK-014',
    installments: 'INS-023',
    people: 'REP-041',
    warehouses: 'STK-051'
  };

  const code = TAB_KNOWLEDGE_CODES[activeTab];

  return (
    <>
      {/* FLOATING HELP BUTTON FOR IKC METADATA */}
      {code && !activeKnowledgeArticle && (
        <button
          onClick={() => {
            const article = (appState.knowledgeArticles || []).find(art => art.knowledgeCode === code);
            if (article) {
              setActiveKnowledgeArticle(article);
            }
          }}
          className="fixed bottom-6 left-6 z-[90] bg-zinc-950 text-white hover:bg-zinc-900 hover:scale-105 active:scale-95 transition-all duration-200 px-4 py-2.5 rounded-full flex items-center gap-2 shadow-2xl border border-zinc-800 font-sans text-xs font-bold"
          dir="rtl"
        >
          <BookOpen size={16} className="text-emerald-400" />
          <span>راهنمای این بخش</span>
        </button>
      )}

      {/* KNOWLEDGE GUIDE OVERLAY MODAL */}
      {activeKnowledgeArticle && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" style={{ direction: 'rtl' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="bg-white rounded-3xl p-6 max-w-2xl w-full shadow-2xl border border-zinc-150 text-right space-y-6 max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                  <BookOpen size={22} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-sans font-black text-base text-zinc-900">{activeKnowledgeArticle.title}</h3>
                    <span className="bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-md font-mono text-[10px] font-bold border border-zinc-200">
                      {activeKnowledgeArticle.knowledgeCode}
                    </span>
                  </div>
                  <p className="text-zinc-500 text-[10px] font-sans mt-0.5">
                    آموزش‌ها و راهنمای ممیزی شده مرکز دانش هوشمند (IKC)
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setActiveKnowledgeArticle(null)}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 bg-zinc-50 hover:bg-zinc-100 rounded-xl transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content Body */}
            <div className="space-y-5 font-sans">
              {/* Introduction */}
              <div className="bg-zinc-50/50 p-4 rounded-2xl border border-zinc-100 leading-relaxed text-xs text-zinc-700">
                {activeKnowledgeArticle.content}
              </div>

              {/* Dynamic Steps (Interactive Checklist) */}
              {(() => {
                const artSteps = (appState.knowledgeSteps || []).filter(s => s.articleId === activeKnowledgeArticle.id);
                if (artSteps.length === 0) return null;
                return (
                  <div className="space-y-3">
                    <h4 className="font-bold text-zinc-800 text-xs flex items-center gap-1.5">
                      <FileCheck size={16} className="text-emerald-500" />
                      <span>مراحل انجام فرآیند:</span>
                    </h4>
                    <div className="grid gap-2">
                      {artSteps.sort((a, b) => a.stepNumber - b.stepNumber).map((st) => (
                        <div key={st.id} className="flex gap-3 p-3 bg-zinc-50 rounded-xl border border-zinc-100 items-start">
                          <span className="flex items-center justify-center w-5 h-5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full mt-0.5 font-mono">
                            {st.stepNumber}
                          </span>
                          <div>
                            <strong className="text-zinc-800 text-xs block font-bold">{st.title}</strong>
                            <p className="text-zinc-600 text-[11px] leading-relaxed mt-0.5">{st.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Common Errors & Solutions */}
              {(() => {
                const artErrors = (appState.knowledgeErrors || []).filter(e => e.articleId === activeKnowledgeArticle.id);
                if (artErrors.length === 0) return null;
                return (
                  <div className="space-y-3 pt-1">
                    <h4 className="font-bold text-zinc-800 text-xs flex items-center gap-1.5">
                      <AlertTriangle size={16} className="text-amber-500" />
                      <span>خطاهای رایج و راه‌حل‌ها:</span>
                    </h4>
                    <div className="grid gap-2">
                      {artErrors.map((err) => (
                        <div key={err.id} className="p-3 bg-amber-50/30 rounded-xl border border-amber-100/60 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-mono text-[9px] font-bold">
                              {err.errorCode}
                            </span>
                            <strong className="text-zinc-950 text-xs font-bold">{err.errorTitle}</strong>
                          </div>
                          <div className="text-[11px] space-y-1">
                            <p className="text-zinc-700 leading-relaxed">
                              <span className="font-bold text-zinc-900">علت خطا: </span>{err.cause}
                            </p>
                            <p className="text-emerald-800 font-medium leading-relaxed">
                              <span className="font-bold text-emerald-950">راه‌حل: </span>{err.solution}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer Buttons */}
            <div className="flex gap-3 justify-end border-t border-zinc-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setActiveKnowledgeArticle(null);
                  setActiveTab('knowledge_center');
                }}
                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-sans text-xs font-bold rounded-xl transition flex items-center gap-1.5"
              >
                <span>مشاهده کامل در مرکز دانش</span>
                <ArrowUpRight size={14} />
              </button>
              <button
                type="button"
                onClick={() => setActiveKnowledgeArticle(null)}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white font-sans text-xs font-bold rounded-xl transition"
              >
                بستن راهنما
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
};

export default KnowledgeGuideModal;
