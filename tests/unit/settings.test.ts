import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsService } from '../../src/server/services/settings.service.js';
import { TEST_MST } from '../helpers.js';

let root = '';
let appData = '';
let dataRoot = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-settings-'));
  appData = path.join(root, 'app');
  dataRoot = path.join(root, 'data');
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe('settings service', () => {
  it('creates secure defaults and accepts only the exposed settings patch', async () => {
    const settings = new SettingsService({ appDataDir: appData, defaultDataRoot: dataRoot });
    await settings.init();
    expect(settings.getConfig()).toMatchObject({
      app: { connectorMode: 'live', defaultDirection: 'purchase', port: 3210 },
      gdt: {
        origin: 'https://hoadondientu.gdt.gov.vn',
        captchaPath: '/api/captcha',
        loginPath: '/api/security-taxpayer/authenticate',
        purchasePath: '/api/query/invoices/purchase',
        posPurchasePath: '/api/sco-query/invoices/purchase',
        detailPath: '/api/query/invoices/detail',
        posDetailPath: '/api/sco-query/invoices/detail',
        exportPath: '/api/query/invoices/export-xml',
        posExportPath: '/api/sco-query/invoices/export-xml',
        posExportMethod: 'POST',
      },
    });
    const updated = await settings.saveConfig({
      app: { connectorMode: 'mock', defaultDirection: 'sales' },
      network: { requestDelayMs: 0, maxRetries: 2 },
      gdt: { salesPath: '/api/query/invoices/sales-captured' },
    });
    expect(updated.app).toMatchObject({ connectorMode: 'mock', defaultDirection: 'sales' });
    expect(updated.gdt.salesPath).toBe('/api/query/invoices/sales-captured');
    await expect(settings.saveConfig({ gdt: { origin: 'https://evil.example' } })).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });
  });

  it('migrates v1.0.x config by adding POS defaults', async () => {
    await fs.mkdir(appData, { recursive: true });
    await fs.writeFile(path.join(appData, 'config.json'), JSON.stringify({
      schemaVersion: 1,
      app: { language: 'vi-VN', openBrowserOnStart: true, port: 3210, connectorMode: 'live', defaultDirection: 'purchase' },
      storage: { dataRoot, datasetSaveMode: 'ask', maxDatasetBytes: 209715200 },
      network: { detailConcurrency: 3, downloadConcurrency: 3, requestDelayMs: 400, requestTimeoutMs: 30000, maxRetries: 3, maxResponseBytes: 52428800, maxDownloadBytes: 104857600 },
      gdt: { origin: 'https://hoadondientu.gdt.gov.vn', captchaPath: '/api/captcha', loginPath: '/api/security-taxpayer/authenticate', purchasePath: '/api/query/invoices/purchase', salesPath: '/api/query/invoices/sold', detailPath: '/api/query/invoices/detail', exportPath: '/api/query/invoices/export-xml' },
      export: { defaultFormat: 'xlsx' },
    }));
    const settings = new SettingsService({ appDataDir: appData, defaultDataRoot: dataRoot });
    await settings.init();
    expect(settings.getConfig().gdt).toMatchObject({
      posPurchasePath: '/api/sco-query/invoices/purchase',
      posDetailPath: '/api/sco-query/invoices/detail',
      posExportPath: '/api/sco-query/invoices/export-xml',
      posExportMethod: 'POST',
    });
  });

  it('remembers only the username and never persists a password field', async () => {
    const settings = new SettingsService({ appDataDir: appData, defaultDataRoot: dataRoot });
    await settings.init();
    await settings.rememberUsername(TEST_MST);
    const accountsText = await fs.readFile(path.join(appData, 'accounts.json'), 'utf8');
    expect(JSON.parse(accountsText)).toEqual({
      schemaVersion: 1,
      lastUsername: TEST_MST,
      accounts: [{ username: TEST_MST, rememberPassword: false, passwordStorage: 'none' }],
    });
    expect(accountsText.toLowerCase()).not.toContain('secret');
  });

  it('quarantines malformed configuration and regenerates a valid file', async () => {
    await fs.mkdir(appData, { recursive: true });
    await fs.writeFile(path.join(appData, 'config.json'), '{broken', 'utf8');
    const settings = new SettingsService({ appDataDir: appData, defaultDataRoot: dataRoot });
    await settings.init();
    expect(settings.getConfig().schemaVersion).toBe(1);
    expect((await fs.readdir(appData)).some((name) => name.startsWith('config.json.invalid-'))).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(appData, 'config.json'), 'utf8'))).toMatchObject({ schemaVersion: 1 });
  });
});
