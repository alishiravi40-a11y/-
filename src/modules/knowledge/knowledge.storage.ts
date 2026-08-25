import { KnowledgeState } from './knowledge.types';
import {
  DEFAULT_KNOWLEDGE_CATEGORIES,
  DEFAULT_KNOWLEDGE_ARTICLES,
  DEFAULT_KNOWLEDGE_STEPS,
  DEFAULT_KNOWLEDGE_ERRORS,
  DEFAULT_KNOWLEDGE_GLOSSARY,
  DEFAULT_KNOWLEDGE_VERSIONS
} from './knowledge.seed';

export function loadKnowledgeState(): KnowledgeState {
  try {
    const loadedCategories = localStorage.getItem('accounting_knowledge_categories') 
      ? JSON.parse(localStorage.getItem('accounting_knowledge_categories')!) 
      : [...DEFAULT_KNOWLEDGE_CATEGORIES];

    const loadedArticles = localStorage.getItem('accounting_knowledge_articles') 
      ? JSON.parse(localStorage.getItem('accounting_knowledge_articles')!) 
      : [...DEFAULT_KNOWLEDGE_ARTICLES];

    const loadedSteps = localStorage.getItem('accounting_knowledge_steps') 
      ? JSON.parse(localStorage.getItem('accounting_knowledge_steps')!) 
      : [...DEFAULT_KNOWLEDGE_STEPS];

    const loadedErrors = localStorage.getItem('accounting_knowledge_errors') 
      ? JSON.parse(localStorage.getItem('accounting_knowledge_errors')!) 
      : [...DEFAULT_KNOWLEDGE_ERRORS];

    const loadedGlossary = localStorage.getItem('accounting_knowledge_glossary') 
      ? JSON.parse(localStorage.getItem('accounting_knowledge_glossary')!) 
      : [...DEFAULT_KNOWLEDGE_GLOSSARY];

    const loadedVersions = localStorage.getItem('accounting_knowledge_versions') 
      ? JSON.parse(localStorage.getItem('accounting_knowledge_versions')!) 
      : [...DEFAULT_KNOWLEDGE_VERSIONS];

    // Seed if empty in storage
    if (!localStorage.getItem('accounting_knowledge_categories')) {
      localStorage.setItem('accounting_knowledge_categories', JSON.stringify(loadedCategories));
    }
    if (!localStorage.getItem('accounting_knowledge_articles')) {
      localStorage.setItem('accounting_knowledge_articles', JSON.stringify(loadedArticles));
    }
    if (!localStorage.getItem('accounting_knowledge_steps')) {
      localStorage.setItem('accounting_knowledge_steps', JSON.stringify(loadedSteps));
    }
    if (!localStorage.getItem('accounting_knowledge_errors')) {
      localStorage.setItem('accounting_knowledge_errors', JSON.stringify(loadedErrors));
    }
    if (!localStorage.getItem('accounting_knowledge_glossary')) {
      localStorage.setItem('accounting_knowledge_glossary', JSON.stringify(loadedGlossary));
    }
    if (!localStorage.getItem('accounting_knowledge_versions')) {
      localStorage.setItem('accounting_knowledge_versions', JSON.stringify(loadedVersions));
    }

    return {
      categories: loadedCategories,
      articles: loadedArticles,
      steps: loadedSteps,
      errors: loadedErrors,
      glossary: loadedGlossary,
      versions: loadedVersions
    };
  } catch (e) {
    console.error("Error loading knowledge state from storage", e);
    return {
      categories: [...DEFAULT_KNOWLEDGE_CATEGORIES],
      articles: [...DEFAULT_KNOWLEDGE_ARTICLES],
      steps: [...DEFAULT_KNOWLEDGE_STEPS],
      errors: [...DEFAULT_KNOWLEDGE_ERRORS],
      glossary: [...DEFAULT_KNOWLEDGE_GLOSSARY],
      versions: [...DEFAULT_KNOWLEDGE_VERSIONS]
    };
  }
}

export function saveKnowledgeState(state: Partial<KnowledgeState>) {
  try {
    if (state.categories) {
      localStorage.setItem('accounting_knowledge_categories', JSON.stringify(state.categories));
    }
    if (state.articles) {
      localStorage.setItem('accounting_knowledge_articles', JSON.stringify(state.articles));
    }
    if (state.steps) {
      localStorage.setItem('accounting_knowledge_steps', JSON.stringify(state.steps));
    }
    if (state.errors) {
      localStorage.setItem('accounting_knowledge_errors', JSON.stringify(state.errors));
    }
    if (state.glossary) {
      localStorage.setItem('accounting_knowledge_glossary', JSON.stringify(state.glossary));
    }
    if (state.versions) {
      localStorage.setItem('accounting_knowledge_versions', JSON.stringify(state.versions));
    }
  } catch (e) {
    console.error("Error saving knowledge state to storage", e);
  }
}

export function clearKnowledgeState() {
  try {
    localStorage.removeItem('accounting_knowledge_categories');
    localStorage.removeItem('accounting_knowledge_articles');
    localStorage.removeItem('accounting_knowledge_steps');
    localStorage.removeItem('accounting_knowledge_errors');
    localStorage.removeItem('accounting_knowledge_glossary');
    localStorage.removeItem('accounting_knowledge_versions');
  } catch (e) {
    console.error("Error clearing knowledge state", e);
  }
}
