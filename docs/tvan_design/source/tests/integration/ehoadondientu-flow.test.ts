import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeInvoice } from '../../src/shared/normalizer/index.js';
import { extractTvanObservation } from '../../src/shared/tvan-catalog/index.js';
import { MockGdtConnector } from '../../src/server/gdt/connector.js';
import { SessionRegistry } from '../../src/server/services/session-registry.service.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';
import { parseEhoadonLookupHtml } from '../../src/server/tvan/adapters/ehoadondientu.js';
import { TvanPdfService } from '../../src/server/tvan/pdf.service.js';
import { document } from '../helpers.js';

const fixture = (name: string) => new URL(`../fixtures/ehoadondientu/${name}`, import.meta.url);

afterEach(() => vi.unstubAllGlobals());

describe('ehoadondientu GDT XML bridge', () => {
  it('normalizes the no-lookup dataset and reaches viewer/batch through the current GDT connector', async () => {
    const [dataset, xml, pdf, html] = await Promise.all([
      fs.readFile(fixture('gdt-dataset.json'), 'utf8').then((text) => JSON.parse(text)),
      fs.readFile(fixture('invoice.xml')),
      fs.readFile(fixture('invoice.pdf')),
      fs.readFile(fixture('tracuu-production-capture.html'), 'utf8'),
    ]);
    const invoice = normalizeInvoice('purchase', 'standard', dataset);
    expect(invoice.lookup?.lookupCode).toBeUndefined();
    expect(invoice.providers).toMatchObject({
      solution: { taxCode: '0314743623' },
      transport: { taxCode: '0104128565', code: 'tvan_fpt' },
      presentation: { adapterCode: 'ehoadondientu' },
    });
    expect(parseEhoadonLookupHtml(html)).toEqual({
      providerRef: 'ct_01088342402020_0100001948',
      series: 'C25TLT', invoiceNo: '583', issueDate: '31/12/2025', buyerTaxCode: '4601622475',
    });
    const tvan = new TvanRegistry();
    expect(tvan.resolve(invoice)?.providerCode).toBe('ehoadondientu');
    expect(tvan.capability(invoice)).toMatchObject({ supported: true, priority: 'P1', captchaMode: 'none' });
    expect(extractTvanObservation(invoice, tvan.capability(invoice))).toMatchObject({
      solutionProviderTaxCode: '0314743623', transportProviderCode: 'tvan_fpt',
      transportProviderTaxCode: '0104128565', presentationProviderCode: 'ehoadondientu',
    });

    const connector = new MockGdtConnector();
    vi.spyOn(connector, 'isAuthenticated').mockReturnValue(true);
    const downloadXml = vi.spyOn(connector, 'downloadXml').mockResolvedValue({
      content: xml, filename: 'invoice.xml', contentType: 'application/xml', size: xml.length,
    });
    const calls: Array<{ url: string; cookie: string | null }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, cookie: new Headers(init?.headers).get('cookie') });
      if (url.endsWith('/Tracuu.aspx')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'ASP.NET_SessionId=A; Path=/; HttpOnly' } });
      }
      if (url.includes('/Account/GenerateFile.aspx')) {
        return new Response(new Uint8Array(pdf), { status: 200, headers: { 'content-type': 'application/pdf' } });
      }
      throw new Error(`Unexpected provider request: ${url}`);
    }) as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);
    const sessions = new SessionRegistry({
      mode: 'mock', liveOptions: {},
      settings: { getConfig: () => ({ network: { requestTimeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024 } }) } as any,
      connectorFactory: (() => connector) as any,
    });
    try {
      const session = sessions.create();
      expect(await session.tvanPdf.prepareView(invoice)).toMatchObject({ ready: true, capability: { supported: true, providerCode: 'ehoadondientu' } });
      const viewed = await session.tvanPdf.viewPdf(invoice);
      expect(viewed.contentType).toBe('application/pdf');
      expect(viewed.content.subarray(0, 5).toString()).toBe('%PDF-');
      expect(downloadXml).toHaveBeenCalledWith('standard', {
        sellerTaxCode: '0108834240', templateNo: 1, series: 'C25TLT', invoiceNo: 583,
      });
      expect(calls.map((call) => new URL(call.url).pathname)).toEqual(['/Tracuu.aspx', '/Account/GenerateFile.aspx']);
      expect(new URL(calls[1].url).searchParams.get('r')).toBe('ct_01088342402020_0100001948');
      expect(calls[1].cookie).toBe('ASP.NET_SessionId=A');
      expect(calls.every((call) => new URL(call.url).hostname === 'ehoadondientu.com')).toBe(true);
      const batch = await session.tvanPdf.startBatch([invoice, document({ key: 'unknown', providerCode: 'unknown' })]);
      expect(batch).toMatchObject({ status: 'done', archiveReady: true });
      expect(batch.tasks.find((task) => task.documentKey === invoice.key)?.status).toBe('done');
      expect(batch.tasks.find((task) => task.documentKey === 'unknown')?.status).toBe('failed');
      expect((await fs.stat(session.tvanPdf.getArchivePath(batch.id))).size).toBeGreaterThan(0);
    } finally {
      await sessions.close();
    }
  });

  it('keeps real adapter capabilities and batch continuation in a mixed provider batch', async () => {
    const [dataset, xml, pdf] = await Promise.all([
      fs.readFile(fixture('gdt-dataset.json'), 'utf8').then((text) => JSON.parse(text)),
      fs.readFile(fixture('invoice.xml')),
      fs.readFile(fixture('invoice.pdf')),
    ]);
    const eho = normalizeInvoice('purchase', 'standard', dataset);
    const docs = [
      document({ key: 'viettel', providerCode: 'tvan_viettel', lookup: { providerCode: 'tvan_viettel', lookupCode: 'VIETTEL-CODE' } }),
      document({ key: 'misa', providerCode: 'tvan_misa', lookup: { providerCode: 'tvan_misa', lookupCode: 'MISA-CODE' } }),
      document({ key: 'invoice', providerCode: 'tvan_invoice', lookup: { providerCode: 'tvan_invoice', lookupCode: 'INVOICE-CODE' } }),
      document({
        key: 'softdreams', providerCode: 'tvan_softdreams',
        lookup: { providerCode: 'tvan_softdreams', lookupCode: 'SOFT-CODE', lookupBaseUrl: 'http://4501622475hd.easyinvoice.com.vn' },
        rawSummary: { ngcnhat: 'tvan_softdreams', msttcgp: '0105987432', PortalLink: 'http://4501622475hd.easyinvoice.com.vn/Search/Index?fkey=SOFT-CODE', Fkey: 'SOFT-CODE' },
      }),
      eho,
      document({ key: 'unknown', providerCode: 'unknown' }),
    ];
    const registry = new TvanRegistry();
    expect(docs.map((item) => registry.capability(item))).toEqual([
      expect.objectContaining({ providerCode: 'tvan_viettel', captchaMode: 'session', priority: 'P2' }),
      expect.objectContaining({ providerCode: 'tvan_misa', captchaMode: 'none', priority: 'P1' }),
      expect.objectContaining({ providerCode: 'tvan_invoice', captchaMode: 'none', priority: 'P1' }),
      expect.objectContaining({ providerCode: 'tvan_softdreams', captchaMode: 'per_invoice', priority: 'P3' }),
      expect.objectContaining({ providerCode: 'ehoadondientu', captchaMode: 'none', priority: 'P1', supported: true }),
      expect.objectContaining({ providerCode: 'unknown', supported: false }),
    ]);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://ehoadondientu.com/Tracuu.aspx') return new Response('', { status: 200, headers: { 'set-cookie': 'ASP.NET_SessionId=A; Path=/' } });
      if (url.startsWith('https://ehoadondientu.com/Account/GenerateFile.aspx')) return new Response(new Uint8Array(pdf), { status: 200, headers: { 'content-type': 'application/pdf' } });
      return new Response('mock upstream unavailable', { status: 503 });
    }) as typeof fetch;
    const service = new TvanPdfService({ getConfig: () => ({ network: { requestTimeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024 } }) } as any,
      { registry, fetchImpl, loadInvoiceXml: async () => xml });
    try {
      const state = await service.startBatch(docs);
      expect(state.status).toBe('done');
      expect(state.archiveReady).toBe(true);
      expect(state.tasks.find((task) => task.documentKey === eho.key)).toMatchObject({ providerCode: 'ehoadondientu', priority: 'P1', status: 'done' });
      expect(state.tasks.find((task) => task.documentKey === 'unknown')?.status).toBe('failed');
      expect(state.tasks.find((task) => task.documentKey === 'viettel')?.priority).toBe('P2');
      expect(state.tasks.find((task) => task.documentKey === 'softdreams')?.priority).toBe('P3');
      expect((await fs.stat(service.getArchivePath(state.id))).size).toBeGreaterThan(0);
    } finally {
      await service.dispose();
    }
  });
});
