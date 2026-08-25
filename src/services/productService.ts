/**
 * Centralized, Secure Product & Inventory Master Data Service
 * Handles communication with /api/products, /api/product-categories, and /api/measurement-units.
 * Enforces explicit JWT authorization and server-authoritative persistence.
 */

import { Product, ProductCategory, MeasurementUnit } from '../types';
import { getDefaultAuthSessionService } from './authSessionService';

export interface ProductApiError {
  status: number;
  code: string;
  message: string;
}

export class ProductService {
  /**
   * Helper to execute authorized API calls with JSON handling
   */
  private static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    let token: string | null = null;
    try {
      token = await getDefaultAuthSessionService().getAccessToken();
    } catch {
      // Fallback
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(endpoint, {
      ...options,
      headers,
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMsg = json?.message || json?.error || `HTTP error ${response.status}`;
      const err: any = new Error(errorMsg);
      err.status = response.status;
      err.code = json?.error || 'ERR_API_ERROR';
      throw err;
    }

    return json;
  }

  // ============================================================================
  // PRODUCTS
  // ============================================================================

  /**
   * Retrieves products for the authenticated user's active organization.
   */
  static async getProducts(includeInactive: boolean = false): Promise<Product[]> {
    const url = `/api/products${includeInactive ? '?includeInactive=true' : ''}`;
    const result = await this.request<{ success: boolean; data: Product[] }>(url, {
      method: 'GET',
    });
    return result?.data || [];
  }

  /**
   * Retrieves single product by ID.
   */
  static async getProductById(id: string): Promise<Product> {
    const result = await this.request<{ success: boolean; data: Product }>(`/api/products/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    return result?.data;
  }

  /**
   * Generates the next sequential unique product code atomically.
   */
  static async getNextProductCode(): Promise<string> {
    const result = await this.request<{ success: boolean; nextCode: string }>('/api/products/next-code', {
      method: 'GET',
    });
    return result?.nextCode || '';
  }

  /**
   * Creates a new product or service in the database.
   */
  static async createProduct(product: Partial<Product>): Promise<Product> {
    const payload = {
      name: product.name,
      code: product.code,
      category: product.category,
      categoryId: product.categoryId,
      unit: product.unit,
      measurementUnitId: product.measurementUnitId,
      isService: product.isService ?? (product.productKind === 'SERVICE'),
      productKind: product.productKind,
      hasSerial: product.hasSerial ?? product.isSerialized,
      isSerialized: product.isSerialized ?? product.hasSerial,
      reorderPoint: product.reorderPoint,
      defaultSalePrice: product.defaultSalePrice,
      status: product.status || 'ACTIVE',
    };

    const result = await this.request<{ success: boolean; data: Product }>('/api/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return result?.data;
  }

  /**
   * Updates an existing product or service in the database.
   */
  static async updateProduct(id: string, updates: Partial<Product>): Promise<Product> {
    const payload = {
      name: updates.name,
      code: updates.code,
      category: updates.category,
      categoryId: updates.categoryId,
      unit: updates.unit,
      measurementUnitId: updates.measurementUnitId,
      isService: updates.isService,
      productKind: updates.productKind,
      hasSerial: updates.hasSerial,
      isSerialized: updates.isSerialized,
      reorderPoint: updates.reorderPoint,
      defaultSalePrice: updates.defaultSalePrice,
      status: updates.status,
    };

    const result = await this.request<{ success: boolean; data: Product }>(`/api/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return result?.data;
  }

  /**
   * Deactivates a product (converts physical deletion to status: INACTIVE).
   */
  static async deleteProduct(id: string): Promise<{ success: boolean; id: string }> {
    const result = await this.request<{ success: boolean; id: string }>(`/api/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return result;
  }

  // ============================================================================
  // PRODUCT CATEGORIES
  // ============================================================================

  /**
   * Retrieves product categories for the active organization.
   */
  static async getCategories(): Promise<ProductCategory[]> {
    const result = await this.request<{ success: boolean; data: ProductCategory[] }>('/api/product-categories', {
      method: 'GET',
    });
    return result?.data || [];
  }

  /**
   * Creates a new product category in the database.
   */
  static async createCategory(category: {
    title: string;
    code?: string;
    parentCategoryId?: string | null;
    description?: string | null;
  }): Promise<ProductCategory> {
    const result = await this.request<{ success: boolean; data: ProductCategory }>('/api/product-categories', {
      method: 'POST',
      body: JSON.stringify(category),
    });
    return result?.data;
  }

  /**
   * Updates a product category.
   */
  static async updateCategory(
    id: string,
    updates: {
      title?: string;
      code?: string;
      parentCategoryId?: string | null;
      description?: string | null;
      isActive?: boolean;
    }
  ): Promise<ProductCategory> {
    const result = await this.request<{ success: boolean; data: ProductCategory }>(
      `/api/product-categories/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      }
    );
    return result?.data;
  }

  /**
   * Deactivates a product category.
   */
  static async deleteCategory(id: string): Promise<{ success: boolean; id: string }> {
    const result = await this.request<{ success: boolean; id: string }>(
      `/api/product-categories/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
    return result;
  }

  // ============================================================================
  // MEASUREMENT UNITS
  // ============================================================================

  /**
   * Retrieves measurement units for the active organization.
   */
  static async getMeasurementUnits(): Promise<MeasurementUnit[]> {
    const result = await this.request<{ success: boolean; data: MeasurementUnit[] }>('/api/measurement-units', {
      method: 'GET',
    });
    return result?.data || [];
  }

  /**
   * Creates a new measurement unit.
   */
  static async createMeasurementUnit(unit: {
    title: string;
    code?: string;
    allowsFraction?: boolean;
    decimalPlaces?: number;
    isSystem?: boolean;
  }): Promise<MeasurementUnit> {
    const result = await this.request<{ success: boolean; data: MeasurementUnit }>('/api/measurement-units', {
      method: 'POST',
      body: JSON.stringify(unit),
    });
    return result?.data;
  }

  /**
   * Updates a measurement unit.
   */
  static async updateMeasurementUnit(
    id: string,
    updates: {
      title?: string;
      code?: string;
      allowsFraction?: boolean;
      decimalPlaces?: number;
      isActive?: boolean;
    }
  ): Promise<MeasurementUnit> {
    const result = await this.request<{ success: boolean; data: MeasurementUnit }>(
      `/api/measurement-units/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      }
    );
    return result?.data;
  }

  /**
   * Deactivates a measurement unit.
   */
  static async deleteMeasurementUnit(id: string): Promise<{ success: boolean; id: string }> {
    const result = await this.request<{ success: boolean; id: string }>(
      `/api/measurement-units/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
    return result;
  }
}
