import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/server/app.js';
import { MockGdtConnector, SessionExpiredError } from '../../src/server/gdt/connector.js';
import { AppError } from '../../src/shared/utils/index.js';
import { incrementalWindow, splitByMonth, ttxly6SupplementWindow } from '../../src/shared/utils/date-utils.js';
import { document, rawSummary } from '../helpers.js';
import { normalizeInvoice } from '../../src/shared/normalizer/index.js';
import { toExistingInvoiceRef } from '../../src/shared/incremental-sync/index.js';
import type { InvoiceQuery } from '../../src/shared/models/index.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-auto-'));
  const connector = new MockGdtConnector();
  vi.spyOn(connector, 'isAuthenticated').mockReturnValue(true);
  const built = await buildApp({ connector, connectorMode: 'mock', logger: false, appDataDir: path.join(root, 'app'), defaultDataRoot: path.join(root, 'data') });
  await built.settings.saveConfig({ network: { detailConcurrency: 2, requestDelayMs: 0, maxRetries: 2 } });
  cleanup = async () => { await built.app.close(); await fs.rm(root, { recursive: true, force: true }); };
  const status = await built.app.inject({ method: 'GET', url: '/api/app/status' });
  const cookie = String(status.headers['set-cookie']).split(';', 1)[0];
  const sessionCsrf = status.json().csrfToken as string;
  const post = (payload: unknown, csrf = sessionCsrf) => built.app.inject({ method: 'POST', url: '/api/invoices/query-auto', headers: { 'x-hddt-csrf': csrf, cookie }, payload: payload as any });
  return { connector, post };
}
const input = { direction: 'purchase', sources: ['standard'] as const, fromDate: '2024-01-15', toDate: '2024-03-10' };
describe('query-auto', () => {
  it('splits UTC leap months and rejects impossible/noncanonical dates', () => {
    expect(splitByMonth(input.fromDate, input.toDate)).toEqual([{ start: '2024-01-15', end: '2024-01-31' }, { start: '2024-02-01', end: '2024-02-29' }, { start: '2024-03-01', end: '2024-03-10' }]);
    for (const value of ['2023-02-29', '2024-2-01', '2024-13-01', '2024-01-01T00:00:00Z']) expect(() => splitByMonth(value, '2025-01-01')).toThrow();
    expect(() => splitByMonth('2025-01-01', '2024-01-01')).toThrow();
    expect(splitByMonth('2024-12-31', '2025-01-01')).toHaveLength(2);
    expect(incrementalWindow('2026-01-01', '2026-09-12', '2026-05-16')).toEqual({ start: '2026-05-17', end: '2026-09-12' });
    expect(incrementalWindow('2026-01-01', '2026-05-16', '2026-05-16')).toBeUndefined();
    expect(ttxly6SupplementWindow('2026-05-16')).toEqual({ start: '2026-04-01', end: '2026-05-16' });
    expect(ttxly6SupplementWindow('2027-01-10')).toEqual({ start: '2026-12-01', end: '2027-01-10' });
  });
  it('follows short-page opaque cursors sequentially, deduplicates composite keys and hydrates with bounded retry', async () => {
    const { connector, post } = await setup();
    const calls: InvoiceQuery[] = [];
    vi.spyOn(connector, 'queryInvoices').mockImplementation(async q => {
      calls.push(q);
      return { total: 2, page: q.page!, pageSize: 100, items: [rawSummary({ khmshdon: q.cursor ? 2 : 1, shdon: q.fromDate, tdlap: q.fromDate })], nextCursor: q.cursor ? undefined : 'opaque:next' };
    });
    let active = 0, max = 0, attempts = 0;
    vi.spyOn(connector, 'getInvoiceDetail').mockImplementation(async (_source, loc) => {
      const attempt = ++attempts; active++; max = Math.max(max, active);
      await new Promise(r => setTimeout(r, 5)); active--;
      if (attempt === 1) throw new AppError('RATE_LIMITED', 'retry', 502, true);
      return { raw: { nbmst: loc.sellerTaxCode, khmshdon: loc.templateNo, khhdon: loc.series, shdon: loc.invoiceNo, hdhhdvu: [{ ma: 'SP1', ten: 'Item', sluong: 0 }] } };
    });
    const response = await post(input); const result = response.json();
    expect(response.statusCode).toBe(200); expect(result.documents).toHaveLength(6);
    expect(calls.map(q => q.cursor)).toEqual([undefined, 'opaque:next', undefined, 'opaque:next', undefined, 'opaque:next']);
    expect(calls[2].toDate).toBe('2024-02-29'); expect(max).toBe(2);
    expect(result.documents.every((d: any) => d.lines[0].itemCode === 'SP1' && d.lines[0].quantity === 0)).toBe(true);
    expect(result.hydrated).toBe(6); expect(attempts).toBe(7);
  });
  it('keeps summaries with warnings for page and detail failures, stops cursor cycles', async () => {
    const { connector, post } = await setup();
    vi.spyOn(connector, 'queryInvoices').mockImplementation(async q => {
      if (q.fromDate.startsWith('2024-02')) throw new AppError('PORTAL_FORMAT', 'bad', 502);
      return { total: 10, page: 1, pageSize: 100, items: [rawSummary()], nextCursor: 'repeat' };
    });
    vi.spyOn(connector, 'getInvoiceDetail').mockRejectedValue(new AppError('PORTAL_FORMAT', 'bad', 502));
    const result = (await post(input)).json();
    expect(result.partial).toBe(true); expect(result.documents).toHaveLength(1);
    expect(result.warnings.map((w: any) => w.code)).toContain('CURSOR_LOOP');
    expect(result.warnings.some((w: any) => w.stage === 'detail')).toBe(true);
  });
  it('preserves CSRF and auth and returns partial documents on expiry', async () => {
    const { connector, post } = await setup();
    expect((await post(input, 'wrong')).statusCode).toBe(403);
    expect((await post({ ...input, fromDate: '2024-02-30' })).statusCode).toBe(400);
    vi.spyOn(connector, 'queryInvoices').mockResolvedValue({ total: 1, page: 1, pageSize: 100, items: [rawSummary()] });
    vi.spyOn(connector, 'getInvoiceDetail').mockRejectedValue(new SessionExpiredError());
    const response = await post(input);
    expect(response.statusCode).toBe(401); expect(response.json().documents).toHaveLength(1);
    vi.mocked(connector.isAuthenticated).mockReturnValue(false);
    expect((await post(input)).statusCode).toBe(401);
  });

  it('refreshes status but never calls detail for an existing invoice that already has detail', async () => {
    const { connector, post } = await setup();
    const existing = document({
      portalInvoiceId: 'summary-1',
      processingStatus: 5,
      invoiceStatus: 1,
      rawDetail: { ...rawSummary(), hdhhdvu: [{ stt: 1, ma: 'CACHED', ten: 'Cached detail' }] },
    });
    vi.spyOn(connector, 'queryInvoices').mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 15,
      items: [rawSummary({ tthai: 6, ttxly: 8 })],
    });
    const detail = vi.spyOn(connector, 'getInvoiceDetail');

    const response = await post({
      direction: 'purchase',
      sources: ['standard'],
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      statuses: ['8'],
      existingDocuments: [toExistingInvoiceRef(existing)],
    });
    const result = response.json();

    expect(response.statusCode).toBe(200);
    expect(detail).not.toHaveBeenCalled();
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].processingStatus).toBe(8);
    expect(result.documents[0].lines).toEqual([]);
    expect(result.hydrated).toBe(0);
    expect(result.sync).toMatchObject({
      found: 1,
      existing: 1,
      existingComplete: 1,
      existingMissingDetail: 0,
      newDocuments: 0,
      statusChanged: 1,
      detailSkipped: 1,
    });
  });

  it('hydrates an existing invoice exactly once when the opened dataset is missing detail', async () => {
    const { connector, post } = await setup();
    const summaryOnly = normalizeInvoice('purchase', 'standard', rawSummary());
    vi.spyOn(connector, 'queryInvoices').mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 15,
      items: [rawSummary()],
    });
    const detail = vi.spyOn(connector, 'getInvoiceDetail').mockResolvedValue({
      raw: { ...rawSummary(), hdhhdvu: [{ stt: 1, ma: 'FILLED', ten: 'Hydrated once' }] },
    });

    const result = (await post({
      direction: 'purchase',
      sources: ['standard'],
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      statuses: ['5'],
      existingDocuments: [toExistingInvoiceRef(summaryOnly)],
    })).json();

    expect(detail).toHaveBeenCalledTimes(1);
    expect(result.hydrated).toBe(1);
    expect(result.documents[0].lines[0].itemCode).toBe('FILLED');
    expect(result.sync).toMatchObject({
      existing: 1,
      existingComplete: 0,
      existingMissingDetail: 1,
      newDocuments: 0,
      detailSkipped: 0,
    });
  });

  it('passes sales direction through query-auto and hydrates the sold invoice detail', async () => {
    const { connector, post } = await setup();
    const query = vi.spyOn(connector, 'queryInvoices').mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 15,
      items: [rawSummary({ nbmst: '4601622475', khmshdon: 2, khhdon: 'C26TCL', shdon: 526 })],
    });
    vi.spyOn(connector, 'getInvoiceDetail').mockResolvedValue({
      raw: {
        nbmst: '4601622475', khmshdon: 2, khhdon: 'C26TCL', shdon: 526,
        hdhhdvu: [{ stt: 1, ten: 'Hàng bán ra', sluong: 1, dgia: 64.71, thtien: 64.71 }],
      },
    });
    const response = await post({ direction: 'sales', fromDate: '2026-09-01', toDate: '2026-09-09', status: '5' });
    const result = response.json();
    expect(response.statusCode).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ direction: 'sales', pageSize: 15 }));
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].direction).toBe('sales');
    expect(result.documents[0].lines[0].itemName).toBe('Hàng bán ra');
    expect(result.hydrated).toBe(1);
  });

  it('queries standard and POS as independent source chains by default for purchase', async () => {
    const { connector, post } = await setup();
    const chains: string[] = [];
    vi.spyOn(connector, 'queryInvoices').mockImplementation(async q => {
      chains.push(`${q.source}:${q.status}`);
      return { total: 1, page: 1, pageSize: 15, items: [rawSummary({ shdon: q.source === 'pos' ? 456 : 123, ttxly: Number(q.status) })] };
    });
    vi.spyOn(connector, 'getInvoiceDetail').mockImplementation(async (source, loc) => ({ raw: { nbmst: loc.sellerTaxCode, khmshdon: loc.templateNo, khhdon: loc.series, shdon: loc.invoiceNo, ttxly: 5, hdhhdvu: [] } }));
    const result = (await post({ direction: 'purchase', fromDate: '2026-09-01', toDate: '2026-09-09', statuses: ['5', '6', '8'] })).json();
    expect(chains).toEqual(['standard:5', 'standard:6', 'standard:8', 'pos:5', 'pos:6', 'pos:8']);
    expect(result.pages).toBe(6);
    expect(result.documents.map((d: any) => d.invoiceSource).sort()).toEqual(['pos', 'standard']);
  });

  it('queries ttxly 5, 6 and 8 separately and deduplicates the merged documents', async () => {
    const { connector, post } = await setup();
    const statuses: string[] = [];
    vi.spyOn(connector, 'queryInvoices').mockImplementation(async q => {
      statuses.push(String(q.status));
      return { total: 1, page: 1, pageSize: 15, items: [rawSummary({ ttxly: Number(q.status) })] };
    });
    vi.spyOn(connector, 'getInvoiceDetail').mockResolvedValue({ raw: rawSummary() });
    const result = (await post({ direction: 'purchase', sources: ['standard'], fromDate: '2026-09-01', toDate: '2026-09-09', statuses: ['5', '6', '8'] })).json();
    expect(statuses).toEqual(['5', '6', '8']);
    expect(result.documents).toHaveLength(1);
    expect(result.completedChunks).toBe(1);
    expect(result.pages).toBe(3);
  });

  it('uses baselineToDate for the main window and adds the bounded purchase standard ttxly=6 supplement', async () => {
    const { connector, post } = await setup();
    const calls: Array<{ source?: string; status?: string; fromDate: string; toDate: string }> = [];
    vi.spyOn(connector, 'queryInvoices').mockImplementation(async q => {
      calls.push({ source: q.source, status: q.status, fromDate: q.fromDate, toDate: q.toDate });
      return { total: 0, page: 1, pageSize: 15, items: [] };
    });

    const response = await post({
      direction: 'purchase',
      sources: ['standard'],
      statuses: ['5'],
      fromDate: '2026-01-01',
      toDate: '2026-05-16',
      baselineToDate: '2026-05-16',
      existingDocuments: [],
    });
    const result = response.json();

    expect(response.statusCode).toBe(200);
    expect(result.windows.main).toBeUndefined();
    expect(result.windows.ttxly6Supplement).toEqual({ start: '2026-04-01', end: '2026-05-16' });
    expect(calls).toEqual([
      { source: 'standard', status: '6', fromDate: '2026-04-01', toDate: '2026-04-30' },
      { source: 'standard', status: '6', fromDate: '2026-05-01', toDate: '2026-05-16' },
    ]);
  });

  it('finds replacement/adjustment relations against the opened dataset without querying original detail', async () => {
    const { connector, post } = await setup();
    const original = document({
      key: 'purchase|standard|4501622475|1|1C26TST|109',
      invoiceNo: 109,
      invoiceStatus: 1,
      rawDetail: { ...rawSummary({ shdon: 109 }), hdhhdvu: [{ stt: 1, ten: 'cached' }] },
    });
    const query = vi.spyOn(connector, 'queryInvoices').mockImplementation(async q => {
      if (q.status === '6') return { total: 0, page: 1, pageSize: 15, items: [] };
      return {
        total: 1,
        page: 1,
        pageSize: 15,
        items: [rawSummary({
          id: 'replacement-116',
          shdon: 116,
          tchat: 2,
          tthai: 2,
          khmshdgoc: 1,
          khhdgoc: '1C26TST',
          shdgoc: 109,
          tdlhdgoc: '2026-05-14T17:00:00Z',
          gchdgoc: 'Hóa đơn thay thế số 109',
        })],
      };
    });
    const detail = vi.spyOn(connector, 'getInvoiceDetail').mockImplementation(async (_source, loc) => ({
      raw: { ...rawSummary({ shdon: loc.invoiceNo, tchat: 2, tthai: 2, khmshdgoc: 1, khhdgoc: '1C26TST', shdgoc: 109 }), hdhhdvu: [] },
    }));

    const response = await post({
      direction: 'purchase',
      sources: ['standard'],
      statuses: ['5'],
      fromDate: '2026-01-01',
      toDate: '2026-05-20',
      baselineToDate: '2026-05-16',
      existingDocuments: [toExistingInvoiceRef(original)],
    });
    const result = response.json();

    expect(response.statusCode).toBe(200);
    expect(query).toHaveBeenCalled();
    expect(detail).toHaveBeenCalledTimes(1); // new replacement only; original is never hydrated again
    expect(result.sync.replacementFound).toBe(1);
    expect(result.sync.originalMatched).toBe(1);
    expect(result.sync.originalMarkedReplaced).toBe(1);
    expect(result.warnings.some((warning: any) => warning.code === 'ORIGINAL_INVOICE_NOT_IN_DATASET')).toBe(false);
  });

});
