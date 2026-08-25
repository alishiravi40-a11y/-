import { KnowledgeArticle, KnowledgeGlossary } from './knowledge.types';

/**
 * Checks if a given role is permitted to view an article based on its category.
 * - 'admin' has full access.
 * - 'seller' is permitted for 'cat_sales' (Sales) and 'cat_reps' (Partners).
 * - 'stock' is permitted only for 'cat_inventory' (Inventory/Warehouse).
 * - 'agent' is permitted for 'cat_reps', 'cat_installments', and 'cat_checks'.
 */
export function isArticleAllowedForRole(categoryId: string, role: string): boolean {
  if (role === 'admin') return true;
  
  if (role === 'seller') {
    return ['cat_sales', 'cat_reps'].includes(categoryId);
  }
  if (role === 'stock') {
    return ['cat_inventory'].includes(categoryId);
  }
  if (role === 'agent') {
    return ['cat_reps', 'cat_installments', 'cat_checks'].includes(categoryId);
  }
  
  return true;
}

/**
 * Performs search and category filtering over articles.
 */
export function searchArticles(
  articles: KnowledgeArticle[],
  searchQuery: string,
  selectedCategoryId: string | null
): KnowledgeArticle[] {
  return articles.filter(art => {
    const categoryMatches = selectedCategoryId ? art.categoryId === selectedCategoryId : true;
    
    if (!searchQuery.trim()) return categoryMatches;
    
    const q = searchQuery.toLowerCase();
    const codeMatches = art.knowledgeCode?.toLowerCase().includes(q);
    const titleMatches = art.title?.toLowerCase().includes(q);
    const contentMatches = art.content?.toLowerCase().includes(q);
    const keywordMatches = art.searchKeywords?.some(k => k.toLowerCase().includes(q));

    return categoryMatches && (codeMatches || titleMatches || contentMatches || keywordMatches);
  });
}

/**
 * Performs search filtering over glossary terms.
 */
export function searchGlossary(
  glossary: KnowledgeGlossary[],
  searchQuery: string
): KnowledgeGlossary[] {
  if (!searchQuery.trim()) return glossary;
  const q = searchQuery.toLowerCase();
  return glossary.filter(item => 
    item.term.toLowerCase().includes(q) || 
    item.definition.toLowerCase().includes(q) ||
    item.relatedTerms.some(t => t.toLowerCase().includes(q))
  );
}
