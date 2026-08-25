/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BusinessPartner, Calculator, AgentCalculatorOverride, AppState } from '../types';

export type CalculatorType = 'sadi_bazaar' | 'pelkani' | 'beta';

export interface CalculatorEngineSettings {
  // Sadi Bazaar settings
  sadiBazaarBaseRate: number; // default 7 (%)
  sadiBazaarIntervalSurcharges: Record<number, number>; // e.g. { 1: 0, 2: 4.5 }

  // Pelkani settings
  pelkaniTier1MaxCount: number; // 6
  pelkaniTier1BaseRate: number; // 7.5 (%)
  pelkaniTier2MaxCount: number; // 9
  pelkaniTier2BaseRate: number; // 8.0 (%)
  pelkaniTier3BaseRate: number; // 8.5 (%)

  // Beta settings
  betaBankFeeRate: number; // default 5 (%)
}

export const DEFAULT_CALCULATOR_SETTINGS: CalculatorEngineSettings = {
  sadiBazaarBaseRate: 7,
  sadiBazaarIntervalSurcharges: {
    1: 0,
    2: 4.5,
  },
  pelkaniTier1MaxCount: 6,
  pelkaniTier1BaseRate: 7.5,
  pelkaniTier2MaxCount: 9,
  pelkaniTier2BaseRate: 8.0,
  pelkaniTier3BaseRate: 8.5,
  betaBankFeeRate: 5,
};

export interface CreditCalculationResult {
  calcType: CalculatorType;
  principal: number;
  installmentCount: number;
  intervalMonths: number;
  baseRatePercent: number;
  stepPercent: number;
  installmentFeePercent: number;
  installmentFeeAmount: number;
  subtotalInitial: number; // مبلغ اولیه (اصل + کارمزد اقساط)
  intervalSurchargePercent: number;
  intervalSurchargeAmount: number;
  subtotalAfterInterval: number; // مبلغ پس از افزایش دوره پرداخت
  bankFeePercent: number; // حق کارمزد بانک (ویژه بتا)
  bankFeeAmount: number;
  subtotalAfterBank: number; // مبلغ بعد از بانک (ویژه بتا)
  representativeCommissionPercent: number;
  representativeCommissionAmount: number;
  maxCommissionPercent?: number; // Add this
  finalTotal: number; // مبلغ نهایی مشتری
}

/**
 * 1- Sadi Bazaar Calculator
 */
export function calculateSadiBazaar(
  principal: number,
  installmentCount: number,
  intervalMonths: number = 1,
  representativeCommission: number = 0,
  customSettings?: Partial<CalculatorEngineSettings>
): CreditCalculationResult {
  const settings = { ...DEFAULT_CALCULATOR_SETTINGS, ...customSettings };
  const baseRate = settings.sadiBazaarBaseRate ?? 7;
  const step = baseRate / 2; // 3.5%
  
  const safeCount = Math.max(1, installmentCount);
  const installmentFeePercent = baseRate + (safeCount - 1) * step;
  const installmentFeeAmount = Math.round(principal * (installmentFeePercent / 100));
  const subtotalInitial = principal + installmentFeeAmount;

  const intervalSurchargePercent = settings.sadiBazaarIntervalSurcharges[intervalMonths] || (intervalMonths === 2 ? 4.5 : 0);
  const intervalSurchargeAmount = Math.round(subtotalInitial * (intervalSurchargePercent / 100));
  const subtotalAfterInterval = subtotalInitial + intervalSurchargeAmount;

  const repCommPercent = Math.max(0, representativeCommission);
  const repCommAmount = Math.round(subtotalAfterInterval * (repCommPercent / 100));
  const finalTotal = subtotalAfterInterval + repCommAmount;

  return {
    calcType: 'sadi_bazaar',
    principal,
    installmentCount: safeCount,
    intervalMonths,
    baseRatePercent: baseRate,
    stepPercent: step,
    installmentFeePercent,
    installmentFeeAmount,
    subtotalInitial,
    intervalSurchargePercent,
    intervalSurchargeAmount,
    subtotalAfterInterval,
    bankFeePercent: 0,
    bankFeeAmount: 0,
    subtotalAfterBank: subtotalAfterInterval,
    representativeCommissionPercent: repCommPercent,
    representativeCommissionAmount: repCommAmount,
    maxCommissionPercent: (customSettings as any)?.maxCommissionPercent,
    finalTotal,
  };
}

/**
 * 2- Pelkani Calculator
 */
export function calculatePelkani(
  principal: number,
  installmentCount: number,
  intervalMonths: number = 1,
  representativeCommission: number = 0,
  customSettings?: Partial<CalculatorEngineSettings>
): CreditCalculationResult {
  const settings = { ...DEFAULT_CALCULATOR_SETTINGS, ...customSettings };
  const safeCount = Math.max(1, installmentCount);

  let baseRate: number;
  if (safeCount <= (settings.pelkaniTier1MaxCount ?? 6)) {
    baseRate = settings.pelkaniTier1BaseRate ?? 7.5;
  } else if (safeCount <= (settings.pelkaniTier2MaxCount ?? 9)) {
    baseRate = settings.pelkaniTier2BaseRate ?? 8.0;
  } else {
    baseRate = settings.pelkaniTier3BaseRate ?? 8.5;
  }

  const step = baseRate / 2;
  const installmentFeePercent = baseRate + (safeCount - 1) * step;
  const installmentFeeAmount = Math.round(principal * (installmentFeePercent / 100));
  const subtotalInitial = principal + installmentFeeAmount;

  const intervalSurchargePercent = settings.sadiBazaarIntervalSurcharges[intervalMonths] || (intervalMonths === 2 ? 4.5 : 0);
  const intervalSurchargeAmount = Math.round(subtotalInitial * (intervalSurchargePercent / 100));
  const subtotalAfterInterval = subtotalInitial + intervalSurchargeAmount;

  const repCommPercent = Math.max(0, representativeCommission);
  const repCommAmount = Math.round(subtotalAfterInterval * (repCommPercent / 100));
  const finalTotal = subtotalAfterInterval + repCommAmount;

  return {
    calcType: 'pelkani',
    principal,
    installmentCount: safeCount,
    intervalMonths,
    baseRatePercent: baseRate,
    stepPercent: step,
    installmentFeePercent,
    installmentFeeAmount,
    subtotalInitial,
    intervalSurchargePercent,
    intervalSurchargeAmount,
    subtotalAfterInterval,
    bankFeePercent: 0,
    bankFeeAmount: 0,
    subtotalAfterBank: subtotalAfterInterval,
    representativeCommissionPercent: repCommPercent,
    representativeCommissionAmount: repCommAmount,
    maxCommissionPercent: (customSettings as any)?.maxCommissionPercent,
    finalTotal,
  };
}

/**
 * 3- Beta Calculator
 */
export function calculateBeta(
  principal: number,
  installmentCount: number,
  intervalMonths: number = 1,
  representativeCommission: number = 0,
  customSettings?: Partial<CalculatorEngineSettings>
): CreditCalculationResult {
  const settings = { ...DEFAULT_CALCULATOR_SETTINGS, ...customSettings };
  
  // Step 1: Calculate Sadi Bazaar base
  const sadiResult = calculateSadiBazaar(principal, installmentCount, intervalMonths, 0, settings);
  const subtotalInitial = sadiResult.subtotalInitial;
  const subtotalAfterInterval = sadiResult.subtotalAfterInterval;

  // Step 2: Add Bank Fee (حق کارمزد بانک)
  const bankFeePercent = settings.betaBankFeeRate ?? 5;
  const bankFeeAmount = Math.round(subtotalAfterInterval * (bankFeePercent / 100));
  const subtotalAfterBank = subtotalAfterInterval + bankFeeAmount;

  // Step 3: Add Representative Commission
  const repCommPercent = Math.max(0, representativeCommission);
  const repCommAmount = Math.round(subtotalAfterBank * (repCommPercent / 100));
  const finalTotal = subtotalAfterBank + repCommAmount;

  return {
    calcType: 'beta',
    principal,
    installmentCount: sadiResult.installmentCount,
    intervalMonths,
    baseRatePercent: sadiResult.baseRatePercent,
    stepPercent: sadiResult.stepPercent,
    installmentFeePercent: sadiResult.installmentFeePercent,
    installmentFeeAmount: sadiResult.installmentFeeAmount,
    subtotalInitial,
    intervalSurchargePercent: sadiResult.intervalSurchargePercent,
    intervalSurchargeAmount: sadiResult.intervalSurchargeAmount,
    subtotalAfterInterval,
    bankFeePercent,
    bankFeeAmount,
    subtotalAfterBank,
    representativeCommissionPercent: repCommPercent,
    representativeCommissionAmount: repCommAmount,
    maxCommissionPercent: (customSettings as any)?.maxCommissionPercent,
    finalTotal,
  };
}

/**
 * Helper to determine calculator type from ID/Name/Type string and execute calculation
 */
export function resolveCalculatorType(calculatorIdOrType?: string, calculatorName?: string): CalculatorType {
  const searchStr = `${calculatorIdOrType || ''} ${calculatorName || ''}`.toLowerCase();
  
  if (searchStr.includes('pelkani') || searchStr.includes('پلکانی')) {
    return 'pelkani';
  }
  if (searchStr.includes('beta') || searchStr.includes('بتا')) {
    return 'beta';
  }
  return 'sadi_bazaar';
}

export function calculateCredit(
  calcType: CalculatorType,
  principal: number,
  installmentCount: number,
  intervalMonths: number = 1,
  representativeCommission: number = 0,
  customSettings?: Partial<CalculatorEngineSettings>
): CreditCalculationResult {
  switch (calcType) {
    case 'pelkani':
      return calculatePelkani(principal, installmentCount, intervalMonths, representativeCommission, customSettings);
    case 'beta':
      return calculateBeta(principal, installmentCount, intervalMonths, representativeCommission, customSettings);
    case 'sadi_bazaar':
    default:
      return calculateSadiBazaar(principal, installmentCount, intervalMonths, representativeCommission, customSettings);
  }
}

export interface ResolvedCalculatorConfig extends CalculatorEngineSettings {
  maxInstallmentCount?: number;
  minInstallmentCount?: number;
  maxCreditLimit?: number;
  maxCommissionPercent?: number;
  source: 'agent_override' | 'calculator_config' | 'global_settings' | 'default_system';
}

/**
 * Resolves effective calculator settings according to strict 3-level fallback hierarchy:
 * Level 1: Agent Override (BusinessPartner.calculatorOverrides) - Highest Priority
 * Level 2: Calculator Config (Calculator object in state.calculators)
 * Level 3: Global System Settings (state.settings or DEFAULT_CALCULATOR_SETTINGS) - Base Priority
 */
export function getAgentCalculatorOverride(
  calculatorOverrides: Record<string, AgentCalculatorOverride> | AgentCalculatorOverride[] | undefined,
  calcId: string,
  calcObj?: { id?: string; type?: string; name?: string }
): AgentCalculatorOverride | undefined {
  if (!calculatorOverrides) return undefined;
  
  const targetCalcType = resolveCalculatorType(calcId, calcObj?.name);
  
  // Helper to reject mismatching specific overrides (prevent leaking 'CALC_BETA_MANSOURI' override into 'CALC_BETA_HAMID')
  const isMismatch = (override: AgentCalculatorOverride | undefined): boolean => {
    if (!override) return false;
    const overrideCalcId = override.calculatorId;
    if (overrideCalcId && overrideCalcId !== calcId && overrideCalcId !== calcObj?.id) {
      const isOverrideSpecific = overrideCalcId.startsWith('CALC_') && overrideCalcId !== 'CALC_SADI' && overrideCalcId !== 'CALC_PELKANI';
      const isCurrentSpecific = calcId.startsWith('CALC_') && calcId !== 'CALC_SADI' && calcId !== 'CALC_PELKANI';
      if (isOverrideSpecific && isCurrentSpecific && overrideCalcId !== calcId) {
        return true;
      }
    }
    return false;
  };

  if (Array.isArray(calculatorOverrides)) {
    // 1. Direct exact matches
    const exact = calculatorOverrides.find((o: any) => 
      o && (
        o.calculatorId === calcId || 
        (calcObj?.id && o.calculatorId === calcObj.id)
      )
    );
    if (exact && !isMismatch(exact)) return exact;

    // 2. Fallback to generic matches on exact calc type (only if the override's ID is the generic type itself)
    const generic = calculatorOverrides.find((o: any) => 
      o && (
        o.calculatorId === targetCalcType || 
        o.calculatorId === calcObj?.type
      )
    );
    if (generic && !isMismatch(generic)) return generic;

    return undefined;
  }
  
  const overrides = calculatorOverrides as Record<string, AgentCalculatorOverride>;
  
  // 1. Look for exact matches by key
  let found = overrides[calcId];
  if (!found && calcObj?.id) {
    found = overrides[calcObj.id];
  }

  // 2. Fallback to generic keys (only if the override actually belongs to this calcId or is a generic type)
  if (!found && calcObj?.type) {
    found = overrides[calcObj.type];
  }
  if (!found && targetCalcType) {
    found = overrides[targetCalcType];
  }

  // 3. Reject mismatching specific overrides
  if (found && isMismatch(found)) {
    found = undefined;
  }

  // 4. Fallback search through values only if no exact match found
  if (!found) {
    found = Object.values(overrides).find(o => 
      o && (
        o.calculatorId === calcId || 
        (calcObj?.id && o.calculatorId === calcObj.id)
      )
    );
    
    if (!found) {
      found = Object.values(overrides).find(o => 
        o && (
          o.calculatorId === targetCalcType ||
          o.calculatorId === calcObj?.type
        )
      );
    }

    // Apply mismatch check on value search findings as well
    if (found && isMismatch(found)) {
      found = undefined;
    }
  }
  
  return found;
}

export function hasActiveCalculatorOverrides(
  partner: BusinessPartner | undefined | null
): boolean {
  if (!partner || !partner.calculatorOverrides) return false;
  
  const overrides = partner.calculatorOverrides;
  
  if (Array.isArray(overrides)) {
    return overrides.some(o => o != null && o.isActive === true);
  }
  
  const record = overrides as Record<string, AgentCalculatorOverride>;
  return Object.values(record).some(o => o != null && o.isActive === true);
}

export function getActiveCalculatorOverridesCount(
  calculatorOverrides: Record<string, AgentCalculatorOverride> | AgentCalculatorOverride[] | undefined
): number {
  if (!calculatorOverrides) return 0;
  
  if (Array.isArray(calculatorOverrides)) {
    const types = new Set(
      calculatorOverrides
        .filter(o => o != null && o.isActive === true)
        .map(o => resolveCalculatorType(o.calculatorId))
    );
    return types.size;
  }
  
  const overrides = calculatorOverrides as Record<string, AgentCalculatorOverride>;
  const types = new Set<string>();
  Object.keys(overrides).forEach(key => {
    const o = overrides[key];
    if (o != null && o.isActive === true) {
      types.add(resolveCalculatorType(key, (o as any).calculatorName) || key);
    }
  });
  
  return types.size;
}

export function resolveEffectiveCalculatorSettings(
  calculatorId: string,
  partner?: BusinessPartner | null,
  calculators?: Calculator[] | null,
  globalSettings?: AppState['settings'] | null
): ResolvedCalculatorConfig {
  let source: ResolvedCalculatorConfig['source'] = 'default_system';

  // Level 3: Start with Global System Settings
  let baseRate = Number(globalSettings?.sadiBazaarBaseRate ?? DEFAULT_CALCULATOR_SETTINGS.sadiBazaarBaseRate);
  let pTier1 = Number(globalSettings?.pelkaniTier1BaseRate ?? DEFAULT_CALCULATOR_SETTINGS.pelkaniTier1BaseRate);
  let pTier2 = Number(globalSettings?.pelkaniTier2BaseRate ?? DEFAULT_CALCULATOR_SETTINGS.pelkaniTier2BaseRate);
  let pTier3 = Number(globalSettings?.pelkaniTier3BaseRate ?? DEFAULT_CALCULATOR_SETTINGS.pelkaniTier3BaseRate);
  let betaFee = Number(globalSettings?.betaBankFeeRate ?? DEFAULT_CALCULATOR_SETTINGS.betaBankFeeRate);

  if (
    globalSettings?.sadiBazaarBaseRate !== undefined ||
    globalSettings?.pelkaniTier1BaseRate !== undefined ||
    globalSettings?.betaBankFeeRate !== undefined
  ) {
    source = 'global_settings';
  }

  let maxInstallmentCount: number | undefined;
  let minInstallmentCount: number | undefined;
  let maxCreditLimit: number | undefined;
  let customCommissionPercent: number | undefined;

  // Level 2: Calculator Object Config (Canonical ID match, Type match, or first available)
  let calcObj = calculators?.find(c => 
    c.id === calculatorId || 
    c.type === calculatorId ||
    c.id.toLowerCase() === calculatorId?.toLowerCase()
  );
  if (!calcObj && calculators && calculators.length > 0) {
    calcObj = calculators.find(c => resolveCalculatorType(c.id, c.name) === resolveCalculatorType(calculatorId)) || calculators[0];
  }

  if (calcObj) {
    let touched = false;
    if (calcObj.baseRatePercent !== undefined && !isNaN(Number(calcObj.baseRatePercent))) { baseRate = Number(calcObj.baseRatePercent); touched = true; }
    if (calcObj.pelkaniTier1BaseRate !== undefined && !isNaN(Number(calcObj.pelkaniTier1BaseRate))) { pTier1 = Number(calcObj.pelkaniTier1BaseRate); touched = true; }
    if (calcObj.pelkaniTier2BaseRate !== undefined && !isNaN(Number(calcObj.pelkaniTier2BaseRate))) { pTier2 = Number(calcObj.pelkaniTier2BaseRate); touched = true; }
    if (calcObj.pelkaniTier3BaseRate !== undefined && !isNaN(Number(calcObj.pelkaniTier3BaseRate))) { pTier3 = Number(calcObj.pelkaniTier3BaseRate); touched = true; }
    if (calcObj.betaBankFeeRate !== undefined && !isNaN(Number(calcObj.betaBankFeeRate))) { betaFee = Number(calcObj.betaBankFeeRate); touched = true; }
    if (calcObj.maxInstallmentCount !== undefined && !isNaN(Number(calcObj.maxInstallmentCount))) { maxInstallmentCount = Number(calcObj.maxInstallmentCount); touched = true; }
    if (touched) source = 'calculator_config';
  }

  // Level 1: Agent Override (BusinessPartner) - Flexible Array/Object & ID/Type Matching
  const override = getAgentCalculatorOverride(partner?.calculatorOverrides, calculatorId, calcObj);

  if (override && override.isActive !== false) {
    let touched = false;
    if (override.baseRatePercent !== undefined && !isNaN(Number(override.baseRatePercent))) {
      baseRate = Number(override.baseRatePercent);
      pTier1 = override.pelkaniTier1BaseRate !== undefined ? Number(override.pelkaniTier1BaseRate) : Number(override.baseRatePercent);
      pTier2 = override.pelkaniTier2BaseRate !== undefined ? Number(override.pelkaniTier2BaseRate) : Number(override.baseRatePercent);
      pTier3 = override.pelkaniTier3BaseRate !== undefined ? Number(override.pelkaniTier3BaseRate) : Number(override.baseRatePercent);
      touched = true;
    }
    if (override.pelkaniTier1BaseRate !== undefined && !isNaN(Number(override.pelkaniTier1BaseRate))) { pTier1 = Number(override.pelkaniTier1BaseRate); touched = true; }
    if (override.pelkaniTier2BaseRate !== undefined && !isNaN(Number(override.pelkaniTier2BaseRate))) { pTier2 = Number(override.pelkaniTier2BaseRate); touched = true; }
    if (override.pelkaniTier3BaseRate !== undefined && !isNaN(Number(override.pelkaniTier3BaseRate))) { pTier3 = Number(override.pelkaniTier3BaseRate); touched = true; }
    if (override.betaBankFeeRate !== undefined && !isNaN(Number(override.betaBankFeeRate))) { betaFee = Number(override.betaBankFeeRate); touched = true; }
    if (override.maxInstallmentCount !== undefined && !isNaN(Number(override.maxInstallmentCount))) { maxInstallmentCount = Number(override.maxInstallmentCount); touched = true; }
    if (override.minInstallmentCount !== undefined && !isNaN(Number(override.minInstallmentCount))) { minInstallmentCount = Number(override.minInstallmentCount); touched = true; }
    if (override.maxCreditLimit !== undefined && !isNaN(Number(override.maxCreditLimit))) { maxCreditLimit = Number(override.maxCreditLimit); touched = true; }
    if (override.customCommissionPercent !== undefined && !isNaN(Number(override.customCommissionPercent))) { customCommissionPercent = Number(override.customCommissionPercent); touched = true; }
    if (touched) source = 'agent_override';
  }

  return {
    sadiBazaarBaseRate: baseRate,
    sadiBazaarIntervalSurcharges: DEFAULT_CALCULATOR_SETTINGS.sadiBazaarIntervalSurcharges,
    pelkaniTier1MaxCount: DEFAULT_CALCULATOR_SETTINGS.pelkaniTier1MaxCount,
    pelkaniTier1BaseRate: pTier1,
    pelkaniTier2MaxCount: DEFAULT_CALCULATOR_SETTINGS.pelkaniTier2MaxCount,
    pelkaniTier2BaseRate: pTier2,
    pelkaniTier3BaseRate: pTier3,
    betaBankFeeRate: betaFee,
    maxInstallmentCount,
    minInstallmentCount,
    maxCreditLimit,
    maxCommissionPercent: customCommissionPercent,
    source,
  };
}
