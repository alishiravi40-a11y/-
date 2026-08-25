export interface KnowledgeCategory {
  id: string;
  title: string;
  description: string;
  parentId?: string;
  displayOrder: number;
}

export interface KnowledgeArticle {
  id: string;
  categoryId: string;
  knowledgeCode: string;
  title: string;
  content: string;
  targetRoute?: string;
  searchKeywords: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeStep {
  id: string;
  articleId: string;
  stepNumber: number;
  title: string;
  description: string;
  uiSelector?: string;
  imageUrl?: string;
}

export interface KnowledgeError {
  id: string;
  errorCode: string;
  errorTitle: string;
  cause: string;
  solution: string;
  articleId: string;
}

export interface KnowledgeGlossary {
  id: string;
  term: string;
  definition: string;
  relatedTerms: string[];
}

export interface KnowledgeVersion {
  id: string;
  articleId: string;
  version: string;
  compatibleAppVersion: string;
  changeLog: string;
}

export interface KnowledgeState {
  categories: KnowledgeCategory[];
  articles: KnowledgeArticle[];
  steps: KnowledgeStep[];
  errors: KnowledgeError[];
  glossary: KnowledgeGlossary[];
  versions: KnowledgeVersion[];
}
