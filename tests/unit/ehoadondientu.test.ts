import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeInvoice } from '../../src/shared/normalizer/index.js';
import { document } from '../helpers.js';
import { EhoadonDientuPresentationAdapter, ehoadonReferenceFromXml, parseEhoadonLookupHtml } from '../../src/server/tvan/adapters/ehoadondientu.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';
import { TvanPdfService } from '../../src/server/tvan/pdf.service.js';
import type { InvoiceDocument } from '../../src/shared/models/index.js';
import type { TvanAdapterContext } from '../../src/server/tvan/types.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const HTML = `<div>
  <span id="lblData">01088342402020</span><span id="lblStt">0100001948</span>
  <span id="lblKyHieu">1C26TST</span><span id="lblSoHoaDon">123</span>
  <span id="lblNgayLap">15/07/2026</span><span id="lblMstNguoiMua">0101234567</span>
</div>`;
const PRODUCTION_TABLE_HTML = readFileSync(
  new URL('../fixtures/ehoadondientu/tracuu-production-capture.html', import.meta.url),
  'utf8',
);
const XML = Buffer.from('<?xml version="1.0"?><HDon><DLHDon Id="010883424020200100001948"><TTChung/></DLHDon></HDon>');

function ehoDocument(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return document({
    providerCode: 'tvan_fpt',
    providers: {
      solution: { taxCode: '0314743623' },
      transport: { taxCode: '0104128565', code: 'tvan_fpt' },
      presentation: { providerCode: 'ehoadondientu', adapterCode: 'ehoadondientu', domain: 'ehoadondientu.com', confidence: 'high' },
    },
    lookup: { providerCode: 'tvan_fpt', lookupCode: 'LOOKUP-123' },
    rawSummary: { ngcnhat: 'tvan_fpt', tvandnkntt: '0104128565', msttcgp: '0314743623' },
    ...overrides,
  });
}

function mockPortal(html = HTML, pdf: Buffer | string = PDF, pdfType = 'application/pdf') {
  const calls: Array<{ url: string; cookie: string | null; method: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const cookie = new Headers(init?.headers).get('cookie');
    calls.push({ url, cookie, method: init?.method || 'GET' });
    if (url.endsWith('/Tracuu.aspx')) {
      return new Response('', { status: 200, headers: { 'set-cookie': 'ASP.NET_SessionId=A; Path=/; HttpOnly' } });
    }
    if (url.endsWith('/Tracuu.aspx/tracuu')) {
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('origin')).toBe('https://ehoadondientu.com');
      expect(headers.get('referer')).toBe('https://ehoadondientu.com/Tracuu.aspx');
      expect(headers.get('x-requested-with')).toBe('XMLHttpRequest');
      expect(JSON.parse(String(init?.body))).toEqual({ mahoadon: 'LOOKUP-123', loai: 'mhd', lang: '' });
      return new Response(JSON.stringify({ d: html }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/Account/GenerateFile.aspx')) {
      return new Response(typeof pdf === 'string' ? pdf : new Uint8Array(pdf), { status: 200, headers: { 'content-type': pdfType } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function context(fetchImpl: typeof fetch): TvanAdapterContext {
  return { fetchImpl, timeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024, setToken: () => undefined };
}

describe('ehoadondientu presentation provider', () => {
  it('keeps solution and TVAN identities separate, including leading zeroes', () => {
    const normalized = normalizeInvoice('purchase', 'standard', {
      nbmst: '4501622475', khmshdon: 1, khhdon: '1C26TST', shdon: 123,
      ngcnhat: 'tvan_fpt', tvandnkntt: '0104128565', msttcgp: '0314743623',
      'Mã tra cứu': 'LOOKUP-123',
    });
    expect(normalized.providerCode).toBe('tvan_fpt');
    expect(normalized.providers).toMatchObject({
      solution: { taxCode: '0314743623' },
      transport: { taxCode: '0104128565', code: 'tvan_fpt' },
      presentation: { adapterCode: 'ehoadondientu', domain: 'ehoadondientu.com', confidence: 'high' },
    });
    expect(new TvanRegistry().resolve(normalized)?.providerCode).toBe('ehoadondientu');
  });

  it('does not match tvan_fpt with another solution provider and retains old registry mapping', () => {
    const registry = new TvanRegistry();
    const other = ehoDocument({ providers: { solution: { taxCode: '0106026495' } }, rawSummary: { ngcnhat: 'tvan_fpt', msttcgp: '0106026495' } });
    expect(registry.resolve(other)?.providerCode).not.toBe('ehoadondientu');
    expect(registry.resolve(ehoDocument({ providers: undefined, rawSummary: { msttcgp: '0314743623', ngcnhat: 'tvan_fpt' } }))?.providerCode).toBe('ehoadondientu');
    expect(registry.resolve(ehoDocument({ providers: undefined, rawSummary: {}, lookup: { lookupBaseUrl: 'https://ehoadondientu.com/Tracuu.aspx', lookupCode: 'LOOKUP-123' } }))?.providerCode).toBe('ehoadondientu');
    expect(registry.resolve(ehoDocument({ providerCode: 'tvan_misa', providers: undefined, rawSummary: {}, lookup: { lookupBaseUrl: 'https://ehoadondientu.com/Tracuu.aspx', lookupCode: 'LOOKUP-123' } }))?.providerCode).toBe('ehoadondientu');
  });

  it('parses numeric reference and invoice metadata from lookup HTML', () => {
    expect(parseEhoadonLookupHtml(HTML)).toMatchObject({
      providerRef: 'ct_01088342402020_0100001948',
      series: '1C26TST', invoiceNo: '123', issueDate: '15/07/2026', buyerTaxCode: '0101234567',
    });
    expect(() => parseEhoadonLookupHtml('<span id="lblData">x</span><span id="lblStt">1</span>')).toThrow();
  });

  it('aligns production-style table headers with visible data cells', () => {
    expect(parseEhoadonLookupHtml(PRODUCTION_TABLE_HTML)).toEqual({
      providerRef: 'ct_01088342402020_0100001948',
      series: 'C25TLT', invoiceNo: '583', issueDate: '31/12/2025', buyerTaxCode: '4601622475',
    });
    expect(parseEhoadonLookupHtml(PRODUCTION_TABLE_HTML).invoiceNo).not.toBe('Ngày');
  });

  it('derives a provider-private XML reference only from the exact MST and 24-digit DLHDon Id', () => {
    expect(ehoadonReferenceFromXml(XML, ehoDocument())).toBe('ct_01088342402020_0100001948');
    expect(() => ehoadonReferenceFromXml(Buffer.from('<HDon><DLHDon/></HDon>'), ehoDocument()))
      .toThrowError(expect.objectContaining({ code: 'TVAN_EHOADON_XML_ID_MISSING' }));
    expect(() => ehoadonReferenceFromXml(Buffer.from('<HDon><DLHDon Id="123"/></HDon>'), ehoDocument()))
      .toThrowError(expect.objectContaining({ code: 'TVAN_EHOADON_XML_ID_UNSUPPORTED' }));
    expect(() => ehoadonReferenceFromXml(XML, ehoDocument({ providers: { solution: { taxCode: '0106026495' } } })))
      .toThrowError(expect.objectContaining({ code: 'TVAN_EHOADON_XML_ID_UNSUPPORTED' }));
  });

  it('refuses mismatched lookup metadata before GenerateFile', async () => {
    const portal = mockPortal(PRODUCTION_TABLE_HTML.replace('>583</td>', '>999</td>'));
    await expect(new EhoadonDientuPresentationAdapter().downloadPdf(ehoDocument(), context(portal.fetchImpl)))
      .rejects.toMatchObject({ code: 'TVAN_EHOADON_INVOICE_MISMATCH' });
    expect(portal.calls.some((call) => call.url.includes('GenerateFile.aspx'))).toBe(false);
  });

  it('keeps the ASP.NET cookie backend-only through lookup and PDF download', async () => {
    const portal = mockPortal(PRODUCTION_TABLE_HTML);
    const adapter = new EhoadonDientuPresentationAdapter();
    const pdf = await adapter.downloadPdf(ehoDocument({
      series: 'C25TLT', invoiceNo: 583, issueDate: '2025-12-31',
      buyer: { taxCode: '4601622475', dynamicFields: [] },
    }), context(portal.fetchImpl));
    expect(pdf.content.equals(PDF)).toBe(true);
    expect(portal.calls.map((call) => call.cookie)).toEqual([null, 'ASP.NET_SessionId=A', 'ASP.NET_SessionId=A']);
    expect(new URL(portal.calls[2].url).searchParams.get('r')).toBe('ct_01088342402020_0100001948');
    expect(JSON.stringify(pdf)).not.toContain('ASP.NET_SessionId');
    expect(portal.calls.every((call) => new URL(call.url).hostname === 'ehoadondientu.com')).toBe(true);
  });

  it('never loads XML for another solution provider', async () => {
    const loadInvoiceXml = vi.fn(async () => XML);
    const ctx = { ...context(mockPortal().fetchImpl), loadInvoiceXml };
    await expect(new EhoadonDientuPresentationAdapter().downloadPdf(
      ehoDocument({ providers: { solution: { taxCode: '0106026495' } }, lookup: { providerCode: 'tvan_fpt' } }), ctx,
    )).rejects.toMatchObject({ code: 'TVAN_EHOADON_PROVIDER_MISMATCH' });
    expect(loadInvoiceXml).not.toHaveBeenCalled();
  });

  it('supports an invoice without lookup code through GDT XML and the existing viewer', async () => {
    const portal = mockPortal(PRODUCTION_TABLE_HTML);
    const invoice = ehoDocument({
      lookup: { providerCode: 'tvan_fpt' },
      series: 'C25TLT', invoiceNo: 583, issueDate: '2025-12-31',
      buyer: { taxCode: '4601622475', dynamicFields: [] },
    });
    const loadInvoiceXml = async (item: InvoiceDocument) => {
      expect(item.key).toBe(invoice.key);
      return XML;
    };
    const adapter = new EhoadonDientuPresentationAdapter();
    expect(adapter.capability(invoice)).toMatchObject({ supported: true, captchaMode: 'none', priority: 'P1' });
    const service = new TvanPdfService({ getConfig: () => ({ network: { requestTimeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024 } }) } as any,
      { fetchImpl: portal.fetchImpl, loadInvoiceXml });
    try {
      expect(await service.prepareView(invoice)).toMatchObject({ ready: true, capability: { providerCode: 'ehoadondientu', supported: true } });
      expect((await service.viewPdf(invoice)).content.equals(PDF)).toBe(true);
      expect(portal.calls.map((call) => new URL(call.url).pathname)).toEqual(['/Tracuu.aspx', '/Account/GenerateFile.aspx']);
      expect(new URL(portal.calls[1].url).searchParams.get('r')).toBe('ct_01088342402020_0100001948');
      expect(portal.calls[1].cookie).toBe('ASP.NET_SessionId=A');
    } finally {
      await service.dispose();
    }
  });

  it.each([
    ['text/html', '<html>not ready</html>'],
    ['application/json', '{"error":"pending"}'],
    ['application/pdf', '<html>not a pdf</html>'],
  ])('rejects a 200 response containing %s instead of PDF bytes', async (type, body) => {
    const portal = mockPortal(HTML, body, type);
    await expect(new EhoadonDientuPresentationAdapter().downloadPdf(ehoDocument(), context(portal.fetchImpl)))
      .rejects.toMatchObject({ code: 'TVAN_EHOADON_PDF_INVALID' });
  });

  it('rejects redirects to other hosts without sending the session cookie', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/Tracuu.aspx')) return new Response('', { status: 200, headers: { 'set-cookie': 'ASP.NET_SessionId=A; Path=/' } });
      return new Response('', { status: 302, headers: { location: 'https://evil.invalid/collect' } });
    }) as typeof fetch;
    await expect(new EhoadonDientuPresentationAdapter().downloadPdf(ehoDocument(), context(fetchImpl)))
      .rejects.toMatchObject({ code: 'TVAN_URL_REJECTED' });
    expect(calls.every((url) => new URL(url).hostname === 'ehoadondientu.com')).toBe(true);
  });

});
