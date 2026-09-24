import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CaptchaChallenge, DownloadedFile, InvoiceLocator, InvoiceSource, InvoiceQuery, LoginInput, LoginResult, PortalInvoiceDetail, PortalInvoicePage } from '../../src/shared/models/index.js';
import { buildApp } from '../../src/server/app.js';
import type { GdtConnector } from '../../src/server/gdt/connector.js';
import { SessionExpiredError } from '../../src/server/gdt/connector.js';

class DetailConnector implements GdtConnector {
  active = 0;
  maximumActive = 0;
  expireInvoiceNo: string | null = null;
  async startSession(): Promise<CaptchaChallenge> { return { ckey: 'k', captchaImageBase64: '' }; }
  async login(_input: LoginInput): Promise<LoginResult> { return { success: true }; }
  async logout(): Promise<void> {}
  async queryInvoices(_input: InvoiceQuery): Promise<PortalInvoicePage> { return { total: 0, page: 1, pageSize: 50, items: [] }; }
  async downloadXml(_source: InvoiceSource, _locator: InvoiceLocator): Promise<DownloadedFile> { throw new Error('not used'); }
  async downloadZip(_source: InvoiceSource, _locator: InvoiceLocator): Promise<DownloadedFile> { throw new Error('not used'); }
  isAuthenticated(): boolean { return true; }
  getSessionInfo(): { username?: string } { return { username: '0101234567' }; }

  async getInvoiceDetail(_source: InvoiceSource, locator: InvoiceLocator): Promise<PortalInvoiceDetail> {
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 25));
    this.active -= 1;
    if (String(locator.invoiceNo) === this.expireInvoiceNo) throw new SessionExpiredError();
    return { raw: {
      nbmst: locator.sellerTaxCode,
      nbten: 'Seller',
      nmmst: '0101234567',
      nmten: 'Buyer',
      khmshdon: locator.templateNo,
      khhdon: locator.series,
      shdon: locator.invoiceNo,
      tdlap: '2026-09-09T00:00:00+07:00',
      hdhhdvu: [{ stt: 1, ten: `Line ${locator.invoiceNo}` }],
    } };
  }
}

let root = '';
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function setup(connector: GdtConnector) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-detail-'));
  const built = await buildApp({
    connector,
    connectorMode: 'mock',
    logger: false,
    appDataDir: path.join(root, 'app'),
    defaultDataRoot: path.join(root, 'data'),
  });
  app = built.app;
  await built.settings.saveConfig({ network: { requestDelayMs: 0, detailConcurrency: 3, maxRetries: 1 } });
  const status = await built.app.inject({ method: 'GET', url: '/api/app/status' });
  return { csrf: status.json().csrfToken as string, cookie: String(status.headers['set-cookie']).split(';', 1)[0] };
}

function requestItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    locator: {
      sellerTaxCode: '4501622475',
      templateNo: 1,
      series: '1C26TST',
      invoiceNo: String(index + 1),
    },
  }));
}

describe('detail batch integration', () => {
  it('honors configured concurrency and keeps response order', async () => {
    const connector = new DetailConnector();
    const browser = await setup(connector);
    const response = await app!.inject({
      method: 'POST',
      url: '/api/invoices/details',
      headers: { 'x-hddt-csrf': browser.csrf, cookie: browser.cookie },
      payload: { direction: 'purchase', items: requestItems(8) },
    });
    expect(response.statusCode).toBe(200);
    expect(connector.maximumActive).toBe(3);
    expect(response.json().documents.map((item: any) => String(item.invoiceNo))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('returns completed partial data and a clear 401 on session expiry', async () => {
    const connector = new DetailConnector();
    connector.expireInvoiceNo = '3';
    const browser = await setup(connector);
    const response = await app!.inject({
      method: 'POST',
      url: '/api/invoices/details',
      headers: { 'x-hddt-csrf': browser.csrf, cookie: browser.cookie },
      payload: { direction: 'purchase', items: requestItems(6) },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'SESSION_EXPIRED' });
    expect(response.json().partial.length).toBeGreaterThan(0);
    expect(response.json().partial.every((item: any) => String(item.invoiceNo) !== '3')).toBe(true);
  });
});
