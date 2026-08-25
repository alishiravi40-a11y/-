/**
 * Calculator Service
 * Handles server-authoritative CRUD operations for Calculators via /api/calculators.
 */

import { Calculator } from '../types';
import { getDefaultAuthSessionService } from './authSessionService';

export interface CalculatorDbRecord {
  id: string;
  organization_id?: string;
  name: string;
  description?: string | null;
  is_active?: boolean | null;
  type?: 'sadi_bazaar' | 'beta' | 'pelkani' | 'standard_bank';
  agent_bank_id?: string | null;
  bank_name?: string | null;
  base_rate_percent?: number | null;
  pelkani_tier1_base_rate?: number | null;
  pelkani_tier2_base_rate?: number | null;
  pelkani_tier3_base_rate?: number | null;
  beta_bank_fee_rate?: number | null;
  max_installment_count?: number | null;
  declining_slope_percentage?: number | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Maps a database record from the `calculators` table to the client-side `Calculator` domain model.
 */
export function mapDbRecordToCalculator(record: CalculatorDbRecord): Calculator {
  return {
    id: record.id,
    name: record.name,
    description: record.description || '',
    isActive: record.is_active !== false,
    type: (record.type as Calculator['type']) || 'sadi_bazaar',
    agentBankId: record.agent_bank_id || undefined,
    bankName: record.bank_name || undefined,
    baseRatePercent: record.base_rate_percent !== null && record.base_rate_percent !== undefined ? Number(record.base_rate_percent) : undefined,
    pelkaniTier1BaseRate: record.pelkani_tier1_base_rate !== null && record.pelkani_tier1_base_rate !== undefined ? Number(record.pelkani_tier1_base_rate) : undefined,
    pelkaniTier2BaseRate: record.pelkani_tier2_base_rate !== null && record.pelkani_tier2_base_rate !== undefined ? Number(record.pelkani_tier2_base_rate) : undefined,
    pelkaniTier3BaseRate: record.pelkani_tier3_base_rate !== null && record.pelkani_tier3_base_rate !== undefined ? Number(record.pelkani_tier3_base_rate) : undefined,
    betaBankFeeRate: record.beta_bank_fee_rate !== null && record.beta_bank_fee_rate !== undefined ? Number(record.beta_bank_fee_rate) : undefined,
    maxInstallmentCount: record.max_installment_count !== null && record.max_installment_count !== undefined ? Number(record.max_installment_count) : undefined,
    decliningSlopePercentage: record.declining_slope_percentage !== null && record.declining_slope_percentage !== undefined ? Number(record.declining_slope_percentage) : undefined,
  };
}

/**
 * Maps client Calculator domain model to server payload format.
 */
export function mapCalculatorToDbPayload(calculator: Partial<Calculator>): Partial<CalculatorDbRecord> {
  const payload: any = {};
  if (calculator.id !== undefined) payload.id = calculator.id;
  if (calculator.name !== undefined) payload.name = calculator.name;
  if (calculator.description !== undefined) payload.description = calculator.description;
  if (calculator.isActive !== undefined) payload.is_active = calculator.isActive;
  if (calculator.type !== undefined) payload.type = calculator.type;
  if (calculator.agentBankId !== undefined) payload.agent_bank_id = calculator.agentBankId || null;
  if (calculator.bankName !== undefined) payload.bank_name = calculator.bankName || null;
  if (calculator.baseRatePercent !== undefined) payload.base_rate_percent = calculator.baseRatePercent ?? null;
  if (calculator.pelkaniTier1BaseRate !== undefined) payload.pelkani_tier1_base_rate = calculator.pelkaniTier1BaseRate ?? null;
  if (calculator.pelkaniTier2BaseRate !== undefined) payload.pelkani_tier2_base_rate = calculator.pelkaniTier2BaseRate ?? null;
  if (calculator.pelkaniTier3BaseRate !== undefined) payload.pelkani_tier3_base_rate = calculator.pelkaniTier3BaseRate ?? null;
  if (calculator.betaBankFeeRate !== undefined) payload.beta_bank_fee_rate = calculator.betaBankFeeRate ?? null;
  if (calculator.maxInstallmentCount !== undefined) payload.max_installment_count = calculator.maxInstallmentCount ?? null;
  if (calculator.decliningSlopePercentage !== undefined) payload.declining_slope_percentage = calculator.decliningSlopePercentage ?? null;
  return payload;
}

export class CalculatorService {
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
      const errorMsg = json?.message || json?.error || `Request failed with status ${response.status}`;
      throw new Error(errorMsg);
    }

    return json;
  }

  /**
   * Fetches all calculators for the active organization
   */
  static async getCalculators(): Promise<Calculator[]> {
    const response = await this.request<{ success: boolean; data: CalculatorDbRecord[] }>('/api/calculators', {
      method: 'GET',
    });

    if (!response?.data) return [];
    return response.data.map(mapDbRecordToCalculator);
  }

  /**
   * Creates a new calculator
   */
  static async createCalculator(calculator: Partial<Calculator>): Promise<Calculator> {
    const payload = mapCalculatorToDbPayload(calculator);
    const response = await this.request<{ success: boolean; data: CalculatorDbRecord }>('/api/calculators', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!response?.data) {
      throw new Error('پاسخ معتبری از سرور دریافت نشد.');
    }

    return mapDbRecordToCalculator(response.data);
  }

  /**
   * Updates an existing calculator
   */
  static async updateCalculator(id: string, updates: Partial<Calculator>): Promise<Calculator> {
    const payload = mapCalculatorToDbPayload(updates);
    const response = await this.request<{ success: boolean; data: CalculatorDbRecord }>(`/api/calculators/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    if (!response?.data) {
      throw new Error('پاسخ معتبری از سرور دریافت نشد.');
    }

    return mapDbRecordToCalculator(response.data);
  }

  /**
   * Deletes a calculator by ID
   */
  static async deleteCalculator(id: string): Promise<boolean> {
    const response = await this.request<{ success: boolean; message?: string }>(`/api/calculators/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

    return response?.success === true;
  }
}
