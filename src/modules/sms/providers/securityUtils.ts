/**
 * Security & Masking Utilities for SMS Providers
 * Ensures sensitive information (API keys, secret tokens) are never leaked in logs or UI.
 */

import { SmsProviderConfig } from '../types';

/**
 * Mask sensitive API Key or Token
 * Example: "1234567890ABCDEF" -> "1234***CDEF"
 */
export function maskApiKey(apiKey?: string): string {
  if (!apiKey) return '';
  if (apiKey.length <= 6) return '***';
  const prefix = apiKey.substring(0, 4);
  const suffix = apiKey.substring(apiKey.length - 4);
  return `${prefix}***${suffix}`;
}

/**
 * Mask sensitive provider configuration before logging or exporting to UI
 */
export function sanitizeProviderConfig(config: SmsProviderConfig): SmsProviderConfig {
  return {
    ...config,
    apiKey: maskApiKey(config.apiKey),
  };
}
