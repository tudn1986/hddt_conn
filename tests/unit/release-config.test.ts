import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/shared/models/index.js';
import {
  applyProductionLockedSettings,
  PRODUCTION_LOCKED_SETTINGS,
} from '../../src/shared/release-config.js';

function sampleConfig(): AppConfig {
  return {
    schemaVersion: 1,
    app: {
      language: 'vi-VN',
      openBrowserOnStart: true,
      port: 3210,
      connectorMode: 'live',
      defaultDirection: 'purchase',
    },
    storage: {
      dataRoot: '/tmp/hddt',
      datasetSaveMode: 'ask',
      maxDatasetBytes: 200 * 1024 * 1024,
    },
    network: {
      detailConcurrency: 5,
      downloadConcurrency: 4,
      requestDelayMs: 999,
      requestTimeoutMs: 30_000,
      maxRetries: 9,
      maxResponseBytes: 50 * 1024 * 1024,
      maxDownloadBytes: 100 * 1024 * 1024,
    },
    gdt: {
      origin: 'https://hoadondientu.gdt.gov.vn',
      captchaPath: '/api/captcha',
      loginPath: '/api/security-taxpayer/authenticate',
      purchasePath: '/api/query/invoices/purchase',
      salesPath: '/api/debug/sales',
      posPurchasePath: '/api/sco-query/invoices/purchase',
      posSalesPath: '',
      detailPath: '/api/query/invoices/detail',
      posDetailPath: '/api/sco-query/invoices/detail',
      exportPath: '/api/query/invoices/export-xml',
      posExportPath: '/api/sco-query/invoices/export-xml',
      exportMethod: 'GET',
      posExportMethod: 'POST',
    },
    export: { defaultFormat: 'xlsx' },
  };
}

describe('production release settings', () => {
  it('forces the verified production values', () => {
    const locked = applyProductionLockedSettings(sampleConfig(), true);
    expect(locked.gdt.salesPath).toBe(PRODUCTION_LOCKED_SETTINGS.salesPath);
    expect(locked.network.detailConcurrency).toBe(1);
    expect(locked.network.downloadConcurrency).toBe(1);
    expect(locked.network.requestDelayMs).toBe(200);
    expect(locked.network.maxRetries).toBe(3);
  });

  it('leaves values editable in developer/test mode', () => {
    const source = sampleConfig();
    const editable = applyProductionLockedSettings(source, false);
    expect(editable).toBe(source);
    expect(editable.gdt.salesPath).toBe('/api/debug/sales');
    expect(editable.network.detailConcurrency).toBe(5);
  });
});
