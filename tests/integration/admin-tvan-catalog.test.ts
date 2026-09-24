import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { MockGdtConnector } from '../../src/server/gdt/connector.js';
import { document, rawSummary, TEST_MST } from '../helpers.js';
import { normalizeInvoice } from '../../src/shared/normalizer/index.js';
import { SettingsService } from '../../src/server/services/settings.service.js';
import { TvanCatalogDbService } from '../../src/server/services/tvan-catalog-db.service.js';
import { TvanCatalogService } from '../../src/server/services/tvan-catalog.service.js';

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
    expect(stats.json()).toMatchObject({ providers: 2, datasetImportDocuments: 1, gdtQueryDocuments: 1, gdtQueryAutoDocuments: 1, schemaVersion: 2 });

    const list = await adminGet('/api/admin/tvan-catalog?page=1&pageSize=50');
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(2);
    const softdreams = list.json().items.find((item: any) => item.providerCode === 'tvan_softdreams');
    expect(softdreams).toBeTruthy();

    const detail = await adminGet(`/api/admin/tvan-catalog/${softdreams.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().providerTaxCode).toBe('0105987432');
    expect(detail.json().solutionProviderTaxCode).toBe('0105987432');
    expect(detail.json().presentationProviderCode).toBe('tvan_softdreams');
    const serialized = JSON.stringify(detail.json());
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('4501622475hd.easyinvoice.com.vn');
    expect(serialized).toContain('<sellerTaxCode>hd.easyinvoice.com.vn');
  });

  it('aggregates and persists separate solution providers sharing FPT transport, while repeats update one row', async () => {
    const invoice = (msttcgp: string, shdon: number) => normalizeInvoice('purchase', 'standard', {
      nbmst: '0108834240', khmshdon: 1, khhdon: 'C25TLT', shdon,
      nmmst: '4601622475', msttcgp, tvandnkntt: '0104128565', ngcnhat: 'tvan_fpt',
    });
    const a = invoice('0314743623', 583);
    const b = invoice('0101234567', 584);
    expect(app.tvanCatalog.observeDocuments([a, b], 'dataset_import').providers).toBe(2);
    const first = await adminGet('/api/admin/tvan-catalog?q=tvan_fpt');
    expect(first.statusCode).toBe(200);
    expect(first.json().total).toBe(2);
    expect(first.json().items.map((item: any) => item.solutionProviderTaxCode).sort()).toEqual(['0101234567', '0314743623']);
    expect(first.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        solutionProviderTaxCode: '0314743623', transportProviderCode: 'tvan_fpt',
        transportProviderTaxCode: '0104128565', presentationProviderCode: 'ehoadondientu',
      }),
    ]));
    expect((await adminGet('/api/admin/tvan-catalog?q=0314743623')).json().total).toBe(1);
    expect((await adminGet('/api/admin/tvan-catalog?q=ehoadondientu')).json().total).toBe(1);
    expect(app.tvanCatalog.observeDocuments([a], 'dataset_import').providers).toBe(1);
    const second = await adminGet('/api/admin/tvan-catalog');
    expect(second.json().total).toBe(2);
    expect(second.json().items.find((item: any) => item.solutionProviderTaxCode === '0314743623').seenDocuments).toBe(2);
  });

  it('migrates a v1 SQLite database to v2 without replacing its provider row', async () => {
    const legacyDir = path.join(root, 'legacy');
    await fs.mkdir(legacyDir);
    const databasePath = path.join(legacyDir, 'tvan-catalog.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE tvan_catalog_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO tvan_catalog_meta VALUES('schema_version', '1');
      CREATE TABLE tvan_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, provider_code TEXT, provider_tax_code TEXT,
        display_name TEXT NOT NULL, adapter_supported INTEGER NOT NULL DEFAULT 0,
        pdf_supported INTEGER NOT NULL DEFAULT 0, captcha_mode TEXT,
        first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
        seen_documents INTEGER NOT NULL DEFAULT 0, seen_dataset_import INTEGER NOT NULL DEFAULT 0,
        seen_gdt_query INTEGER NOT NULL DEFAULT 0, seen_gdt_query_auto INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO tvan_providers(id, provider_code, provider_tax_code, display_name, first_seen_at, last_seen_at, created_at, updated_at, seen_documents)
      VALUES(7, 'tvan_fpt', '0104128565', 'Legacy FPT', '2025-01-01', '2025-01-01', '2025-01-01', '2025-01-01', 3);
      CREATE TABLE tvan_provider_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT, provider_id INTEGER NOT NULL,
        alias_type TEXT NOT NULL, alias_value TEXT NOT NULL,
        first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1, UNIQUE(alias_type, alias_value)
      );
      INSERT INTO tvan_provider_aliases(provider_id, alias_type, alias_value, first_seen_at, last_seen_at)
      VALUES(7, 'provider_code', 'tvan_fpt', '2025-01-01', '2025-01-01');
    `);
    legacy.close();
    const migrated = new TvanCatalogDbService(new SettingsService({ appDataDir: legacyDir }));
    try {
      expect(migrated.getStats()).toMatchObject({ schemaVersion: 2, providers: 1, observedDocuments: 3 });
      expect(migrated.getProvider(7)).toMatchObject({ id: 7, providerCode: 'tvan_fpt', providerTaxCode: '0104128565' });
      const check = new DatabaseSync(databasePath);
      try {
        expect((check.prepare("SELECT value FROM tvan_catalog_meta WHERE key='schema_version'").get() as any).value).toBe('2');
        const columns = (check.prepare('PRAGMA table_info(tvan_providers)').all() as Array<{ name: string }>).map((row) => row.name);
        expect(columns).toEqual(expect.arrayContaining([
          'solution_provider_tax_code', 'transport_provider_code', 'transport_provider_tax_code', 'presentation_provider_code',
        ]));
      } finally { check.close(); }
    } finally { migrated.close(); }

    const service = new TvanCatalogService(new SettingsService({ appDataDir: legacyDir }));
    try {
      const invoice = (msttcgp: string, shdon: number) => normalizeInvoice('purchase', 'standard', {
        nbmst: '0108834240', khmshdon: 1, khhdon: 'C25TLT', shdon,
        msttcgp, tvandnkntt: '0104128565', ngcnhat: 'tvan_fpt',
      });
      expect(service.observeDocuments([invoice('0314743623', 583), invoice('0101234567', 584)], 'dataset_import').providers).toBe(2);
      expect(service.getStats().providers).toBe(3);
      expect(service.getProvider(7)).toMatchObject({ id: 7, seenDocuments: 3, providerCode: 'tvan_fpt' });
      expect(service.getProvider(7)?.aliases).toContainEqual(expect.objectContaining({ type: 'provider_code', value: 'tvan_fpt' }));
    } finally { service.close(); }
  });
});
