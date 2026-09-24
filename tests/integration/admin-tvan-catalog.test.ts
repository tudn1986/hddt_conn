import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { MockGdtConnector } from '../../src/server/gdt/connector.js';
import { document, rawSummary, TEST_MST } from '../helpers.js';

let root = '';
let app: FastifyInstance;
let cookie = '';
let csrf = '';
const adminToken = 'catalog-admin-token-longer-than-thirty-two-characters';
const previousAdminToken = process.env.HDDT_ADMIN_TOKEN;

beforeEach(async () => {
  process.env.HDDT_ADMIN_TOKEN = adminToken;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-catalog-'));
  const connector = new MockGdtConnector();
  vi.spyOn(connector, 'isAuthenticated').mockReturnValue(true);
  vi.spyOn(connector, 'queryInvoices').mockResolvedValue({
    total: 1,
    page: 1,
    pageSize: 15,
    items: [rawSummary({ providerCode: 'tvan_softdreams', msttcgp: '0105987432', PortalLink: 'http://4501622475hd.easyinvoice.com.vn/Search/Index?fkey=SECRET' })],
  });
  vi.spyOn(connector, 'getInvoiceDetail').mockResolvedValue({
    raw: { ...rawSummary(), providerCode: 'tvan_softdreams', msttcgp: '0105987432', PortalLink: 'http://4501622475hd.easyinvoice.com.vn/Search/Index?fkey=SECRET', Fkey: 'SECRET', hdhhdvu: [] },
  });
  const built = await buildApp({ connector, connectorMode: 'mock', logger: false, appDataDir: path.join(root, 'app'), defaultDataRoot: path.join(root, 'data') });
  app = built.app;
  const status = await app.inject({ method: 'GET', url: '/api/app/status' });
  cookie = String(status.headers['set-cookie']).split(';', 1)[0];
  csrf = status.json().csrfToken;
});

afterEach(async () => {
  await app?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
  if (previousAdminToken === undefined) delete process.env.HDDT_ADMIN_TOKEN;
  else process.env.HDDT_ADMIN_TOKEN = previousAdminToken;
});

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: { cookie, 'x-hddt-csrf': csrf }, payload: payload as any });
const adminGet = (url: string) => app.inject({ method: 'GET', url, headers: { cookie, authorization: `Bearer ${adminToken}` } });

describe('persistent TVAN Catalog', () => {
  it('hooks dataset import, GDT query and query-auto and exposes sanitized catalog through admin API', async () => {
    const importedDoc = document({
      providerCode: 'tvan_invoice',
      lookup: { providerCode: 'tvan_invoice', lookupCode: 'PRIVATE-LOOKUP', lookupBaseUrl: 'https://tracuuhoadon.minvoice.com.vn', lookupPathRaw: '/api/Search/SearchInvoice?masothue=4501622475&sobaomat=PRIVATE-LOOKUP' },
      rawDetail: { msttcgp: '0106026495', sobaomat: 'PRIVATE-LOOKUP' },
    });
    const dataset = {
      format: 'hddt-dataset', schemaVersion: 1, appVersion: '1.3.0-rc.2',
      meta: { accountTaxCode: TEST_MST, direction: 'purchase', fromDate: '2026-07-01', toDate: '2026-07-31', createdAt: new Date().toISOString(), source: 'test', recordCount: 1, detailCount: 1 },
      documents: [{ key: importedDoc.key, normalized: importedDoc, rawSummary: importedDoc.rawSummary, rawDetail: importedDoc.rawDetail }],
    };
    expect((await post('/api/datasets/import', { dataset })).statusCode).toBe(200);

    const direct = await post('/api/invoices/query', { direction: 'purchase', source: 'standard', fromDate: '2026-07-01', toDate: '2026-07-31', page: 1, pageSize: 15 });
    expect(direct.statusCode).toBe(200);

    const auto = await post('/api/invoices/query-auto', { direction: 'purchase', sources: ['standard'], statuses: ['5'], fromDate: '2026-07-01', toDate: '2026-07-31', page: 1 });
    expect(auto.statusCode).toBe(200);

    const stats = await adminGet('/api/admin/tvan-catalog/stats');
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({ providers: 2, datasetImportDocuments: 1, gdtQueryDocuments: 1, gdtQueryAutoDocuments: 1, schemaVersion: 1 });

    const list = await adminGet('/api/admin/tvan-catalog?page=1&pageSize=50');
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(2);
    const softdreams = list.json().items.find((item: any) => item.providerCode === 'tvan_softdreams');
    expect(softdreams).toBeTruthy();

    const detail = await adminGet(`/api/admin/tvan-catalog/${softdreams.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().providerTaxCode).toBe('0105987432');
    const serialized = JSON.stringify(detail.json());
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('4501622475hd.easyinvoice.com.vn');
    expect(serialized).toContain('<sellerTaxCode>hd.easyinvoice.com.vn');
  });
});
