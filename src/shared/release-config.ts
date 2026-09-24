import type { AppConfig } from './models/index.js';

/**
 * Production release constants.
 *
 * These values are intentionally kept in source code so a developer build can
 * expose/edit the corresponding controls for diagnostics, while production
 * builds always use the verified release values regardless of an older
 * config.json or a crafted settings request.
 */
export const PRODUCTION_LOCKED_SETTINGS = Object.freeze({
  salesPath: '/api/query/invoices/sold',
  detailConcurrency: 1,
  downloadConcurrency: 1,
  requestDelayMs: 200,
  maxRetries: 3,
} as const);

export function applyProductionLockedSettings(
  config: AppConfig,
  production = process.env.NODE_ENV === 'production',
): AppConfig {
  if (!production) return config;

  return {
    ...config,
    network: {
      ...config.network,
      detailConcurrency: PRODUCTION_LOCKED_SETTINGS.detailConcurrency,
      downloadConcurrency: PRODUCTION_LOCKED_SETTINGS.downloadConcurrency,
      requestDelayMs: PRODUCTION_LOCKED_SETTINGS.requestDelayMs,
      maxRetries: PRODUCTION_LOCKED_SETTINGS.maxRetries,
    },
    gdt: {
      ...config.gdt,
      salesPath: PRODUCTION_LOCKED_SETTINGS.salesPath,
    },
  };
}
