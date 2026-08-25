/**
 * Centralized, Secure Warehouse Master Data Service
 * Handles communication with /api/warehouses.
 * Enforces explicit JWT authorization, database authority, and optimistic concurrency.
 */

import { Warehouse } from '../types';
import { getDefaultAuthSessionService } from './authSessionService';

export interface WarehouseApiError {
  status: number;
  code: string;
  message: string;
}

export class WarehouseService {
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

  /**
   * Retrieves warehouses for the authenticated user's active organization.
   */
  static async getWarehouses(includeInactive: boolean = false): Promise<Warehouse[]> {
    const url = `/api/warehouses${includeInactive ? '?includeInactive=true' : ''}`;
    const result = await this.request<{ success: boolean; data: Warehouse[] }>(url, {
      method: 'GET',
    });
    return result?.data || [];
  }

  /**
   * Retrieves single warehouse by ID.
   */
  static async getWarehouseById(id: string): Promise<Warehouse> {
    const result = await this.request<{ success: boolean; data: Warehouse }>(`/api/warehouses/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    return result?.data;
  }

  /**
   * Generates the next sequential unique warehouse code atomically.
   */
  static async getNextWarehouseCode(): Promise<string> {
    const result = await this.request<{ success: boolean; nextCode: string }>('/api/warehouses/next-code', {
      method: 'GET',
    });
    return result?.nextCode || '';
  }

  /**
   * Creates a new warehouse in the database.
   */
  static async createWarehouse(warehouse: Partial<Warehouse> & { operationKey?: string; requestFingerprint?: string }): Promise<Warehouse> {
    const payload = {
      name: warehouse.name,
      code: warehouse.code,
      branchId: warehouse.branchId,
      location: warehouse.location,
      isDefault: Boolean(warehouse.isDefault),
      status: warehouse.status || 'ACTIVE',
      operationKey: warehouse.operationKey,
      requestFingerprint: warehouse.requestFingerprint,
    };

    const result = await this.request<{ success: boolean; data: Warehouse }>('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return result.data;
  }

  /**
   * Updates an existing warehouse with optimistic concurrency control.
   */
  static async updateWarehouse(
    id: string,
    updates: Partial<Warehouse> & { expectedVersion?: number; operationKey?: string; requestFingerprint?: string }
  ): Promise<Warehouse> {
    const payload = {
      name: updates.name,
      code: updates.code,
      branchId: updates.branchId,
      location: updates.location,
      expectedVersion: updates.expectedVersion !== undefined ? updates.expectedVersion : updates.version,
      operationKey: updates.operationKey,
      requestFingerprint: updates.requestFingerprint,
    };

    const result = await this.request<{ success: boolean; data: Warehouse }>(`/api/warehouses/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    return result.data;
  }

  /**
   * Sets warehouse as default active warehouse for its branch.
   */
  static async setDefaultWarehouse(id: string): Promise<Warehouse> {
    const result = await this.request<{ success: boolean; data: Warehouse }>(`/api/warehouses/${encodeURIComponent(id)}/set-default`, {
      method: 'PATCH',
    });

    return result.data;
  }

  /**
   * Deactivates a warehouse (soft-delete).
   */
  static async deactivateWarehouse(id: string, replacementDefaultWarehouseId?: string): Promise<{ success: boolean; data: Warehouse }> {
    const result = await this.request<{ success: boolean; data: Warehouse }>(`/api/warehouses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ replacementDefaultWarehouseId }),
    });

    return result;
  }

  /**
   * Retrieves warehouse account mappings from server.
   */
  static async getAccountMappings(warehouseId?: string): Promise<any[]> {
    const url = `/api/warehouses/account-mappings${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ''}`;
    const result = await this.request<{ success: boolean; data: any[] }>(url, {
      method: 'GET',
    });
    return result?.data || [];
  }

  /**
   * Sets warehouse account mapping on server.
   */
  static async setAccountMapping(warehouseId: string, subsidiaryId: string, changeReason?: string): Promise<any> {
    const result = await this.request<{ success: boolean; data: any }>('/api/warehouses/account-mappings', {
      method: 'POST',
      body: JSON.stringify({ warehouseId, subsidiaryId, changeReason })
    });
    return result?.data;
  }

  /**
   * Fetches warehouse transfers from server.
   */
  static async getTransfers(): Promise<any[]> {
    const result = await this.request<{ success: boolean; data: any[] }>('/api/warehouse-transfers', {
      method: 'GET',
    });
    return result?.data || [];
  }

  /**
   * Fetches available serial numbers for a product in a warehouse.
   */
  static async getProductSerials(warehouseId: string, productId: string): Promise<Array<{ id: string; serialNumber: string; status: string }>> {
    const url = `/api/warehouses/${encodeURIComponent(warehouseId)}/products/${encodeURIComponent(productId)}/serials`;
    const result = await this.request<{ success: boolean; data: any[] }>(url, {
      method: 'GET',
    });
    return result?.data || [];
  }

  /**
   * Reverses a posted transfer.
   */
  static async reverseTransfer(transactionId: string, reversalReason: string, operationKey: string, requestFingerprint: string): Promise<any> {
    const result = await this.request<{ success: boolean; data: any }>(`/api/warehouse-transfers/${encodeURIComponent(transactionId)}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ transactionId, reversalReason, operationKey, requestFingerprint })
    });
    return result;
  }
}
