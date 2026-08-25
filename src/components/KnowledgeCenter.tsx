import React, { useState, useMemo } from 'react';
import { 
  KnowledgeCategory, 
  KnowledgeArticle, 
  KnowledgeStep, 
  KnowledgeError, 
  KnowledgeGlossary, 
  KnowledgeVersion 
} from '../types';
import { 
  isArticleAllowedForRole as serviceIsArticleAllowedForRole, 
  searchArticles, 
  searchGlossary 
} from '../modules/knowledge/knowledge.service';
import { 
  BookOpen, 
  Search, 
  Plus, 
  Trash2, 
  ChevronLeft, 
  ChevronDown, 
  Book, 
  HelpCircle, 
  CheckCircle2, 
  AlertTriangle, 
  ExternalLink, 
  FileText, 
  Layers, 
  UserCheck, 
  Tag, 
  Sparkles,
  Info,
  X,
  PlusCircle
} from 'lucide-react';

interface KnowledgeCenterProps {
  categories: KnowledgeCategory[];
  articles: KnowledgeArticle[];
  steps: KnowledgeStep[];
  errors: KnowledgeError[];
  glossary: KnowledgeGlossary[];
  versions: KnowledgeVersion[];
  currentUserRole: string;
  onAddArticle: (article: KnowledgeArticle) => void;
  onDeleteArticle: (id: string) => void;
  onAddStep: (step: KnowledgeStep) => void;
  onAddError: (error: KnowledgeError) => void;
  onNavigateToTab: (tabId: string) => void;
}

export function KnowledgeCenter({
  categories = [],
  articles = [],
  steps = [],
  errors = [],
  glossary = [],
  versions = [],
  currentUserRole,
  onAddArticle,
  onDeleteArticle,
  onAddStep,
  onAddError,
  onNavigateToTab
}: KnowledgeCenterProps) {
  // Navigation & View State
  const [activeSubTab, setActiveSubTab] = useState<'articles' | 'glossary' | 'create'>('articles');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(articles[0]?.id || null);
  
  // Interactive Step Tracker
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});

  // RBAC Simulator - Filter view based on simulated or current role
  const [simulatedRole, setSimulatedRole] = useState<string>(currentUserRole || 'admin');

  // Form State for creating new article
  const [newArticle, setNewArticle] = useState({
    title: '',
    categoryId: categories[0]?.id || '',
    knowledgeCode: 'MODULE-XXX',
    content: '',
    targetRoute: '',
    searchKeywords: '',
    compatibleVersion: 'v1.0.0',
    changeLog: 'ثبت اولیه مقاله در مرکز دانش'
  });

  // Form State for dynamic steps & errors under creation
  const [formSteps, setFormSteps] = useState<{ title: string; description: string; uiSelector?: string }[]>([]);
  const [formErrors, setFormErrors] = useState<{ errorCode: string; errorTitle: string; cause: string; solution: string }[]>([]);

  // Simple text search algorithm (Filters articles by Title, Content, Code, and Keywords)
  const filteredArticles = useMemo(() => {
    return searchArticles(articles, searchQuery, selectedCategoryId);
  }, [articles, selectedCategoryId, searchQuery]);

  // Glossary filter
  const filteredGlossary = useMemo(() => {
    return searchGlossary(glossary, searchQuery);
  }, [glossary, searchQuery]);

  // Retrieve current active article detail
  const activeArticle = useMemo(() => {
    return articles.find(art => art.id === selectedArticleId) || filteredArticles[0] || null;
  }, [articles, selectedArticleId, filteredArticles]);

  // Steps for active article
  const activeSteps = useMemo(() => {
    if (!activeArticle) return [];
    return steps
      .filter(s => s.articleId === activeArticle.id)
      .sort((a, b) => a.stepNumber - b.stepNumber);
  }, [steps, activeArticle]);

  // Errors for active article
  const activeErrors = useMemo(() => {
    if (!activeArticle) return [];
    return errors.filter(e => e.articleId === activeArticle.id);
  }, [errors, activeArticle]);

  // Version history for active article
  const activeVersions = useMemo(() => {
    if (!activeArticle) return [];
    return versions.filter(v => v.articleId === activeArticle.id);
  }, [versions, activeArticle]);

  // Check role authorization for current article (Simulated RBAC Filtering)
  const isArticleAllowedForRole = (art: KnowledgeArticle, role: string) => {
    return serviceIsArticleAllowedForRole(art.categoryId, role);
  };

  // Toggle step completion status
  const handleToggleStep = (stepId: string) => {
    setCompletedSteps(prev => ({
      ...prev,
      [stepId]: !prev[stepId]
    }));
  };

  // Form helpers
  const handleAddFormStep = () => {
    setFormSteps([...formSteps, { title: '', description: '', uiSelector: '' }]);
  };

  const handleRemoveFormStep = (index: number) => {
    setFormSteps(formSteps.filter((_, i) => i !== index));
  };

  const handleFormStepChange = (index: number, field: string, value: string) => {
    const updated = [...formSteps];
    updated[index] = { ...updated[index], [field]: value };
    setFormSteps(updated);
  };

  const handleAddFormError = () => {
    setFormErrors([...formErrors, { errorCode: '', errorTitle: '', cause: '', solution: '' }]);
  };

  const handleRemoveFormError = (index: number) => {
    setFormErrors(formErrors.filter((_, i) => i !== index));
  };

  const handleFormErrorChange = (index: number, field: string, value: string) => {
    const updated = [...formErrors];
    updated[index] = { ...updated[index], [field]: value };
    setFormErrors(updated);
  };

  const handleCreateArticle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newArticle.title || !newArticle.content) {
      alert('لطفاً عنوان و متن اصلی مقاله را وارد کنید.');
      return;
    }

    const articleId = 'art_' + crypto.randomUUID().substring(0, 8);
    
    // Create new article object
    const createdArticle: KnowledgeArticle = {
      id: articleId,
      categoryId: newArticle.categoryId,
      knowledgeCode: newArticle.knowledgeCode || 'KNOW-999',
      title: newArticle.title,
      content: newArticle.content,
      targetRoute: newArticle.targetRoute || undefined,
      searchKeywords: newArticle.searchKeywords.split(',').map(k => k.trim()).filter(Boolean),
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    onAddArticle(createdArticle);

    // Save Steps
    formSteps.forEach((step, idx) => {
      onAddStep({
        id: `step_${articleId}_${idx + 1}`,
        articleId,
        stepNumber: idx + 1,
        title: step.title || `مرحله ${idx + 1}`,
        description: step.description || '',
        uiSelector: step.uiSelector || undefined
      });
    });

    // Save Errors
    formErrors.forEach((err, idx) => {
      onAddError({
        id: `err_${articleId}_${idx + 1}`,
        errorCode: err.errorCode || `ERR-KNOW-${idx + 1}`,
        errorTitle: err.errorTitle || 'خطای سیستم',
        cause: err.cause || '',
        solution: err.solution || '',
        articleId
      });
    });

    // Reset forms
    setNewArticle({
      title: '',
      categoryId: categories[0]?.id || '',
      knowledgeCode: 'MODULE-XXX',
      content: '',
      targetRoute: '',
      searchKeywords: '',
      compatibleVersion: 'v1.0.0',
      changeLog: 'ثبت اولیه مقاله در مرکز دانش'
    });
    setFormSteps([]);
    setFormErrors([]);
    
    // Switch view
    setSelectedArticleId(articleId);
    setActiveSubTab('articles');
  };

  return (
    <div id="knowledge-center-container" className="flex flex-col h-full bg-slate-50 text-slate-800 font-sans leading-relaxed text-right">
      
      {/* 1. Header Banner */}
      <div className="bg-gradient-to-l from-slate-900 via-slate-800 to-indigo-950 p-6 text-white rounded-xl shadow-md mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600/35 p-3 rounded-xl border border-indigo-500/20">
            <BookOpen className="h-8 w-8 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">مرکز دانش هوشمند (Intelligent Knowledge Center)</h1>
            <p className="text-slate-400 text-sm mt-1">پایگاه دانش زنده سازمانی، مستندات عملیاتی، مربی‌گری مرحله‌ای و عیب‌یابی فرآیندها</p>
          </div>
        </div>
        
        {/* RBAC Simulator Control Panel */}
        <div className="bg-slate-800/80 backdrop-blur-sm border border-slate-700/50 p-3 rounded-lg flex items-center gap-3 text-xs">
          <span className="text-slate-300 font-medium">شبیه‌ساز دسترسی (RBAC):</span>
          <select 
            value={simulatedRole} 
            onChange={(e) => setSimulatedRole(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="admin">مدیر ارشد (دسترسی کامل)</option>
            <option value="seller">فروشنده (فقط فروش و مشتری)</option>
            <option value="stock">انباردار (فقط کاردکس و ورود کالا)</option>
            <option value="agent">نماینده (محدود به فاکتور و اقساط)</option>
          </select>
          <div className="flex items-center gap-1 text-indigo-400 font-mono">
            <UserCheck size={14} />
            <span>فعال</span>
          </div>
        </div>
      </div>

      {/* 2. Secondary Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-3 mb-6 gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveSubTab('articles')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 flex items-center gap-2 ${
              activeSubTab === 'articles' 
                ? 'bg-slate-900 text-white shadow-sm' 
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <FileText size={16} />
            <span>مقالات و راهنماهای کاربردی</span>
          </button>
          
          <button
            onClick={() => setActiveSubTab('glossary')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 flex items-center gap-2 ${
              activeSubTab === 'glossary' 
                ? 'bg-slate-900 text-white shadow-sm' 
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Book size={16} />
            <span>واژه‌نامه مفاهیم مالی</span>
          </button>

          <button
            onClick={() => setActiveSubTab('create')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 flex items-center gap-2 ${
              activeSubTab === 'create' 
                ? 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700' 
                : 'bg-white text-indigo-600 hover:bg-slate-100 border border-indigo-200'
            }`}
          >
            <Plus size={16} />
            <span>افزودن سند دانش جدید</span>
          </button>
        </div>

        {/* 3. Search Bar Widget */}
        <div className="relative w-full max-w-md">
          <input
            type="text"
            placeholder="جستجوی کد دانش، عبارت کلیدی یا خطاها..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-lg py-2 pl-4 pr-10 text-sm focus:outline-none focus:border-indigo-500 shadow-sm"
          />
          <Search className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 h-4 w-4" />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 4. Active Sub-tab View Rendering */}
      {activeSubTab === 'articles' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-280px)] min-h-[500px]">
          
          {/* A. Categories & Sidebar Tree (lg:col-span-4) */}
          <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col overflow-y-auto">
            <h2 className="text-md font-semibold text-slate-950 mb-3 border-b border-slate-100 pb-2 flex items-center gap-2">
              <Layers className="text-slate-500" size={18} />
              <span>دسته بندی‌ها و مقالات</span>
            </h2>
            
            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1 mb-4">
              <button
                onClick={() => setSelectedCategoryId(null)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                  selectedCategoryId === null 
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700' 
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                همه دسته‌ها
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                    selectedCategoryId === cat.id 
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700' 
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {cat.title}
                </button>
              ))}
            </div>

            {/* List of articles filtered */}
            <div className="space-y-2 flex-1">
              {filteredArticles.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  <Info size={20} className="mx-auto mb-2 opacity-50" />
                  مقاله‌ای متناسب با فیلتر یا جستجوی شما یافت نشد.
                </div>
              ) : (
                filteredArticles.map(art => {
                  const isAllowed = isArticleAllowedForRole(art, simulatedRole);
                  const isSelected = art.id === activeArticle?.id;
                  
                  return (
                    <div
                      key={art.id}
                      onClick={() => isAllowed && setSelectedArticleId(art.id)}
                      className={`p-3 rounded-lg border text-right transition-all cursor-pointer relative ${
                        isSelected 
                          ? 'bg-slate-900 border-slate-950 text-white shadow-md transform -translate-x-1' 
                          : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                      } ${!isAllowed ? 'opacity-45 cursor-not-allowed bg-slate-100 border-dashed' : ''}`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                          isSelected ? 'bg-slate-800 text-indigo-300' : 'bg-slate-200 text-slate-700'
                        }`}>
                          {art.knowledgeCode}
                        </span>
                        
                        {!isAllowed && (
                          <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                            <AlertTriangle size={8} />
                            عدم دسترسی نقش
                          </span>
                        )}
                      </div>
                      
                      <h3 className="font-semibold text-sm mt-1.5 truncate">{art.title}</h3>
                      <p className={`text-xs mt-1 truncate ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {art.content}
                      </p>
                      
                      {/* Delete option for non-system created articles */}
                      {art.id.startsWith('art_') && art.id !== 'art_sales_invoice' && art.id !== 'art_check_deposit' && art.id !== 'art_installment_cancel' && art.id !== 'art_rep_register' && art.id !== 'art_stk_receipt' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if(confirm('آیا از حذف این مقاله دانش اطمینان دارید؟')) {
                              onDeleteArticle(art.id);
                              if (selectedArticleId === art.id) {
                                setSelectedArticleId(null);
                              }
                            }
                          }}
                          className="absolute bottom-2 left-2 text-slate-400 hover:text-red-500 transition-colors p-1"
                          title="حذف مقاله"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* B. Rich Detail View (lg:col-span-8) */}
          <div className="lg:col-span-8 flex flex-col h-full gap-6 overflow-y-auto">
            {activeArticle ? (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col gap-6">
                
                {/* Article Header Details */}
                <div className="border-b border-slate-100 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="bg-indigo-100 text-indigo-800 text-xs font-semibold px-2.5 py-1 rounded-full">
                        {categories.find(c => c.id === activeArticle.categoryId)?.title || 'دسته‌بندی نشده'}
                      </span>
                      <span className="font-mono text-slate-500 text-sm font-bold">
                        {activeArticle.knowledgeCode}
                      </span>
                    </div>

                    {/* Meta version compatible */}
                    <div className="text-xs text-slate-500 font-mono">
                      نسخه دانش: <span className="text-slate-800 font-bold">v1.0.0</span> | تطابق با سیستم: <span className="text-emerald-700 font-bold">سازگار (Active)</span>
                    </div>
                  </div>

                  <h1 className="text-2xl font-bold text-slate-900 mt-3">{activeArticle.title}</h1>
                  
                  {/* Article main content body */}
                  <div className="text-slate-700 text-sm mt-4 bg-slate-50 p-4 rounded-xl border border-slate-100 leading-relaxed whitespace-pre-wrap">
                    {activeArticle.content}
                  </div>

                  {/* Target route navigation shortcut */}
                  {activeArticle.targetRoute && (
                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={() => onNavigateToTab(activeArticle.targetRoute!)}
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all shadow-sm"
                      >
                        <ExternalLink size={14} />
                        <span>انتقال مستقیم به صفحه عملیاتی مرتبط</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Training Interactive Stepper section */}
                <div>
                  <h3 className="text-md font-bold text-slate-900 mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
                    <Sparkles className="text-indigo-500" size={18} />
                    <span>مراحل عملیاتی و راهنمای تعاملی فرآیند</span>
                  </h3>

                  {activeSteps.length === 0 ? (
                    <div className="text-sm text-slate-500 bg-slate-50 p-4 rounded-xl text-center border">
                      مراحل آموزشی اختصاصی برای این فاکتور تعریف نشده است.
                    </div>
                  ) : (
                    <div className="relative border-r-2 border-slate-200 pr-6 mr-3 space-y-6">
                      {activeSteps.map((step, idx) => {
                        const isDone = completedSteps[step.id] || false;
                        return (
                          <div key={step.id} className="relative">
                            
                            {/* Stepper Node Icon / Number */}
                            <button
                              onClick={() => handleToggleStep(step.id)}
                              className={`absolute -right-[37px] top-0 h-7 w-7 rounded-full flex items-center justify-center border-2 transition-all ${
                                isDone 
                                  ? 'bg-emerald-500 border-emerald-600 text-white shadow' 
                                  : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-500'
                              }`}
                              title="تغییر وضعیت انجام"
                            >
                              {isDone ? <CheckCircle2 size={14} /> : <span className="text-xs font-bold">{step.stepNumber}</span>}
                            </button>

                            <div className={`p-4 rounded-xl border transition-all ${
                              isDone ? 'bg-emerald-50/50 border-emerald-200' : 'bg-slate-50 border-slate-200'
                            }`}>
                              <div className="flex justify-between items-start gap-4">
                                <h4 className={`font-semibold text-sm ${isDone ? 'text-emerald-800 line-through' : 'text-slate-900'}`}>
                                  {step.title}
                                </h4>
                                <button
                                  onClick={() => handleToggleStep(step.id)}
                                  className={`text-xs font-medium px-2 py-0.5 rounded ${
                                    isDone ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                                  }`}
                                >
                                  {isDone ? 'انجام شد' : 'علامت به عنوان انجام شده'}
                                </button>
                              </div>
                              <p className="text-xs text-slate-600 mt-2">{step.description}</p>
                              
                              {step.uiSelector && (
                                <div className="mt-2.5 flex items-center gap-1.5 text-[10px] font-mono text-slate-500 bg-slate-100 rounded px-2 py-1 w-max">
                                  <span className="font-bold text-slate-700">شناسه فنی المان:</span>
                                  <code>{step.uiSelector}</code>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Errors & Solution handlers view */}
                <div>
                  <h3 className="text-md font-bold text-slate-900 mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
                    <AlertTriangle className="text-amber-500" size={18} />
                    <span>عیب‌یابی، خطاها و راهکارها (Troubleshooting)</span>
                  </h3>

                  {activeErrors.length === 0 ? (
                    <div className="text-sm text-slate-500 bg-slate-50 p-4 rounded-xl text-center border">
                      خطای شناخته شده‌ای برای این فرآیند ثبت نشده است.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {activeErrors.map(err => (
                        <div key={err.id} className="p-4 rounded-xl border border-red-200 bg-red-50/20 text-right space-y-2 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-xs font-bold text-red-700 bg-red-100/70 px-1.5 py-0.5 rounded">
                                {err.errorCode}
                              </span>
                              <AlertTriangle className="text-red-500 h-4 w-4" />
                            </div>
                            <h4 className="font-bold text-sm text-red-950 mt-1">{err.errorTitle}</h4>
                            <p className="text-xs text-slate-600 mt-2 font-medium">
                              <span className="text-red-800 font-bold">علت احتمالی: </span>
                              {err.cause}
                            </p>
                          </div>
                          
                          <div className="bg-white border border-red-100 p-2.5 rounded-lg text-xs mt-2">
                            <span className="text-emerald-800 font-bold">راهکار حل مشکل: </span>
                            <span className="text-slate-700">{err.solution}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
                <BookOpen size={40} className="mx-auto mb-3 opacity-40" />
                یک مقاله را از لیست سمت راست انتخاب کنید تا مستندات آن نمایش داده شود.
              </div>
            )}
          </div>

        </div>
      )}

      {/* Glossary rendering tab */}
      {activeSubTab === 'glossary' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
            <Book className="text-slate-500" size={20} />
            <span>واژه‌نامه مفاهیم مالی و سیستم</span>
          </h2>
          <p className="text-xs text-slate-500">برای آشنایی با اصطلاحات و تعاریف استفاده شده در ماژول‌های حسابداری، انبار و فروش از لیست زیر استفاده نمایید.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {filteredGlossary.length === 0 ? (
              <div className="col-span-2 text-center py-8 text-slate-400 text-xs">
                عبارتی برای جستجوی شما یافت نشد.
              </div>
            ) : (
              filteredGlossary.map(item => (
                <div key={item.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100/70 transition-all space-y-2">
                  <h3 className="font-bold text-indigo-950 text-sm flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
                    {item.term}
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {item.definition}
                  </p>
                  
                  {item.relatedTerms && item.relatedTerms.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[10px] text-slate-400">کلمات مرتبط:</span>
                      {item.relatedTerms.map((term, i) => (
                        <button
                          key={i}
                          onClick={() => setSearchQuery(term)}
                          className="text-[10px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-0.5 rounded transition-colors"
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Creation form subtab */}
      {activeSubTab === 'create' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2 mb-4">
            <PlusCircle className="text-indigo-600" size={20} />
            <span>ثبت و انتشار مقاله دانش جدید</span>
          </h2>

          <form onSubmit={handleCreateArticle} className="space-y-6">
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">دسته بندی سند</label>
                <select
                  value={newArticle.categoryId}
                  onChange={(e) => setNewArticle({ ...newArticle, categoryId: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:border-indigo-500"
                >
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">کد یکتای مستند (MODULE-XXX)</label>
                <input
                  type="text"
                  placeholder="مثال: INV-002"
                  value={newArticle.knowledgeCode}
                  onChange={(e) => setNewArticle({ ...newArticle, knowledgeCode: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-sm text-left font-mono focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">مسیر صفحه متناظر در سیستم</label>
                <select
                  value={newArticle.targetRoute}
                  onChange={(e) => setNewArticle({ ...newArticle, targetRoute: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="">ندارد (مستند کلی مفاهیم)</option>
                  <option value="dashboard">پیشخوان سیستم</option>
                  <option value="invoices">فاکتورها</option>
                  <option value="people">اشخاص و همکاران</option>
                  <option value="installments">مدیریت اقساط</option>
                  <option value="opening_balances">موجودی افتتاحیه</option>
                  <option value="products">کالاهای انبار</option>
                  <option value="warehouses">مدیریت انبارها</option>
                  <option value="checks">مدیریت چک‌ها</option>
                  <option value="reports">گزارش‌های معین</option>
                  <option value="accounts">حساب‌های معین</option>
                  <option value="cost_centers">مراکز هزینه</option>
                  <option value="users">مدیریت کاربران</option>
                  <option value="roles">نقش‌ها و دسترسی‌ها</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">عنوان مستند دانش</label>
                <input
                  type="text"
                  placeholder="مثال: روش اعمال تخفیف فاکتور بر اساس سقف اختیارات"
                  value={newArticle.title}
                  onChange={(e) => setNewArticle({ ...newArticle, title: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">کلمات کلیدی برای جستجو (جدا شده با کاما)</label>
                <input
                  type="text"
                  placeholder="مثال: تخفیف, فاکتور, سود فاکتور, فروشنده"
                  value={newArticle.searchKeywords}
                  onChange={(e) => setNewArticle({ ...newArticle, searchKeywords: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">شرح مفصل سند دانش</label>
              <textarea
                rows={4}
                placeholder="متن کامل آموزش، توضیحات تکمیلی و قوانین حاکم بر این فرآیند را بنویسید..."
                value={newArticle.content}
                onChange={(e) => setNewArticle({ ...newArticle, content: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm focus:outline-none focus:border-indigo-500 leading-relaxed"
                required
              />
            </div>

            {/* Stepper manager inside form */}
            <div className="border-t border-slate-100 pt-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1">
                  <Sparkles size={16} className="text-indigo-500" />
                  <span>افزودن مراحل آموزش گام‌به‌گام (دلخواه)</span>
                </h3>
                <button
                  type="button"
                  onClick={handleAddFormStep}
                  className="bg-slate-100 hover:bg-indigo-50 text-indigo-700 border border-slate-200 hover:border-indigo-200 px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-all"
                >
                  <PlusCircle size={14} />
                  <span>افزودن مرحله جدید</span>
                </button>
              </div>

              <div className="space-y-3">
                {formSteps.map((step, idx) => (
                  <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-4 relative space-y-3">
                    <button
                      type="button"
                      onClick={() => handleRemoveFormStep(idx)}
                      className="absolute top-3 left-3 text-slate-400 hover:text-red-500"
                      title="حذف مرحله"
                    >
                      <Trash2 size={14} />
                    </button>
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">
                      گام {idx + 1}
                    </span>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">عنوان مرحله</label>
                        <input
                          type="text"
                          placeholder="مثال: کلیک روی دکمه صدور فاکتور جدید"
                          value={step.title}
                          onChange={(e) => handleFormStepChange(idx, 'title', e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">شناسه المان صفحه (CSS Selector - جهت راهنمای تصویری آینده)</label>
                        <input
                          type="text"
                          placeholder="مثال: #btn-add-invoice"
                          value={step.uiSelector}
                          onChange={(e) => handleFormStepChange(idx, 'uiSelector', e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs font-mono text-left focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">شرح اقدامات مرحله</label>
                      <textarea
                        rows={2}
                        placeholder="اقداماتی که کاربر باید در این مرحله انجام دهد..."
                        value={step.description}
                        onChange={(e) => handleFormStepChange(idx, 'description', e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Error Troubleshooting builder inside form */}
            <div className="border-t border-slate-100 pt-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1">
                  <AlertTriangle size={16} className="text-amber-500" />
                  <span>خطاهای متداول و راهکارها (دلخواه)</span>
                </h3>
                <button
                  type="button"
                  onClick={handleAddFormError}
                  className="bg-slate-100 hover:bg-amber-50 text-amber-700 border border-slate-200 hover:border-amber-200 px-3 py-1.5 rounded text-xs font-semibold flex items-center gap-1 transition-all"
                >
                  <PlusCircle size={14} />
                  <span>افزودن عیب‌یاب خطا</span>
                </button>
              </div>

              <div className="space-y-3">
                {formErrors.map((err, idx) => (
                  <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-4 relative space-y-3">
                    <button
                      type="button"
                      onClick={() => handleRemoveFormError(idx)}
                      className="absolute top-3 left-3 text-slate-400 hover:text-red-500"
                      title="حذف خطا"
                    >
                      <Trash2 size={14} />
                    </button>
                    <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">
                      عیب‌یاب خطای {idx + 1}
                    </span>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">کد خطا</label>
                        <input
                          type="text"
                          placeholder="مثال: ERR-STK-002"
                          value={err.errorCode}
                          onChange={(e) => handleFormErrorChange(idx, 'errorCode', e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs text-left font-mono focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">عنوان خطا</label>
                        <input
                          type="text"
                          placeholder="مثال: موجودی منفی انبار"
                          value={err.errorTitle}
                          onChange={(e) => handleFormErrorChange(idx, 'errorTitle', e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">علت وقوع خطا</label>
                        <textarea
                          rows={2}
                          placeholder="دلیل اصلی رخ دادن این خطا برای کاربر..."
                          value={err.cause}
                          onChange={(e) => handleFormErrorChange(idx, 'cause', e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">راهکار حل خطا</label>
                        <textarea
                          rows={2}
                          placeholder="دستورالعمل واضح و مرحله‌به‌مرحله به کاربر جهت رفع مشکل..."
                          value={err.solution}
                          onChange={(e) => handleFormErrorChange(idx, 'solution', e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded p-2 text-xs focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveSubTab('articles')}
                className="bg-white hover:bg-slate-50 border border-slate-300 px-5 py-2 rounded-lg text-sm font-semibold transition-all text-slate-700"
              >
                انصراف
              </button>
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-all shadow-md"
              >
                انتشار سند در مرکز دانش
              </button>
            </div>

          </form>
        </div>
      )}

    </div>
  );
}
