import { describe, expect, it, vi } from 'vitest';
import { document } from '../helpers.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';
import {
  parseVnptSearchReference,
  VnptInvoiceTvanAdapter,
  vnptLookupFromXml,
} from '../../src/server/tvan/adapters/vnpt.js';
import type { TvanAdapterContext, TvanTokenState } from '../../src/server/tvan/types.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

function vnptDocument(overrides: Record<string, unknown> = {}) {
  return document({
    providerCode: 'tvan_buuchinhvt',
    providers: {
      solution: { taxCode: '0100684378' },
      transport: { taxCode: '0100684378', code: 'tvan_buuchinhvt' },
    },
    lookup: {
      providerCode: 'tvan_buuchinhvt',
      lookupCode: 'FKEY-123',
      lookupCodeType: 'Fkey',
      confidence: 'medium',
    },
    rawSummary: {
      nbmst: '4501622475', khmshdon: 1, khhdon: '1C26TST', shdon: 123,
      msttcgp: '0100684378', ngcnhat: 'tvan_buuchinhvt',
      cttkhac: [{ ttruong: 'Fkey', dlieu: 'FKEY-123' }],
    },
    ...overrides,
  } as any);
}
function context(fetchImpl: typeof fetch, loadInvoiceXml?: TvanAdapterContext['loadInvoiceXml']) {
  const state: { token?: TvanTokenState } = {};
  const value: TvanAdapterContext = {
    fetchImpl,
    timeoutMs: 5_000,
    maxDownloadBytes: 2 * 1024 * 1024,
    get token() { return state.token; },
    setToken(token) { state.token = token; },
    loadInvoiceXml,
  };
  return value;
}

function response(body: BodyInit | null, init: ResponseInit = {}) {
  return new Response(body, init);
}

describe('VNPT Invoice adapter', () => {
  it('resolves MSTTCGP 0100684378 to VNPT instead of transport TVAN', () => {
    const registry = new TvanRegistry();
    const doc = vnptDocument();
    expect(registry.resolve(doc)?.providerCode).toBe('tvan_vnpt');
    expect(registry.capability(doc)).toMatchObject({
      providerCode: 'tvan_vnpt',
      displayName: 'VNPT Invoice',
      supported: true,
      captchaMode: 'per_invoice',
      priority: 'P3',
    });
  });

  it('does not match a different solution provider even with tvan_buuchinhvt transport', () => {
    const registry = new TvanRegistry();
    const other = vnptDocument({
      providers: { solution: { taxCode: '0101234567' }, transport: { code: 'tvan_buuchinhvt' } },
      rawSummary: { msttcgp: '0101234567', ngcnhat: 'tvan_buuchinhvt' },
    });
    expect(registry.resolve(other)?.providerCode).not.toBe('tvan_vnpt');
  });
  it('extracts only VNPT Fkey from XML and never treats MCCQT as a lookup code', () => {
    const fkeyXml = Buffer.from(
      '<HDon><DLHDon><TTKhac><TTin><TTruong>Fkey</TTruong><DLieu>ABC-XML</DLieu></TTin></TTKhac><MCCQT>MCCQT-1</MCCQT></DLHDon></HDon>',
    );
    expect(vnptLookupFromXml(fkeyXml)).toEqual({ lookupCode: 'ABC-XML', source: 'xml:fkey' });

    const mccqtXml = Buffer.from('<HDon><DLHDon><MCCQT>MCCQT-ONLY</MCCQT></DLHDon></HDon>');
    expect(vnptLookupFromXml(mccqtXml)).toEqual({});
  });

  it('parses both VNPT portal generations without executing provider JS', () => {
    expect(parseVnptSearchReference("<button onclick=\"ajxCall4Portal('CHECK-1','x')\">Xem</button>"))
      .toEqual({ mode: 'home', checkCode: 'CHECK-1' });
    expect(parseVnptSearchReference("<a onclick=\"showDetailInv('INV-1','1','4911','FKEY-X')\">Xem</a>"))
      .toEqual({ mode: 'share', invoiceId: 'INV-1', pattern: '1', comId: '4911', fkey: 'FKEY-X' });
  });

  it('uses the GDT XML bridge when the dataset has no lookup code', async () => {
    const doc = vnptDocument({ lookup: undefined, rawSummary: { msttcgp: '0100684378', ngcnhat: 'tvan_buuchinhvt' } });
    const adapter = new VnptInvoiceTvanAdapter();
    const loadInvoiceXml = vi.fn().mockResolvedValue(Buffer.from('<HDon><DLHDon><TTKhac><TTin><TTruong>Fkey</TTruong><DLieu>FKEY-FROM-GDT</DLieu></TTin></TTKhac></DLHDon></HDon>'));
    const result = await adapter.resolvePresentationLink(doc, context(vi.fn() as any, loadInvoiceXml));
    expect(loadInvoiceXml).toHaveBeenCalledOnce();
    expect(result.lookupCode).toBe('FKEY-FROM-GDT');
    expect(result.metadataUrl).toBe('https://portaltool-miennam.vnpt-invoice.com.vn/Portal/Index');
  });
  it('completes the newer HomeNoLogin CAPTCHA -> preview -> PDF flow', async () => {
    const origin = 'https://seller-tt78.vnpt-invoice.com.vn';
    const doc = vnptDocument({
      lookup: {
        providerCode: 'tvan_buuchinhvt',
        lookupCode: 'FKEY-123',
        lookupCodeType: 'Fkey',
        lookupBaseUrl: origin,
        lookupPathRaw: '/?strFkey=FKEY-123',
        confidence: 'high',
      },
    });
    const calls: Array<{ url: string; method: string; body?: string; cookie?: string }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || {});
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined, cookie: headers.get('cookie') || undefined });
      if (url.includes('strFkey=') && method === 'GET') {
        return response('<form action="/HomeNoLogin/SearchByFkey"><input name="__RequestVerificationToken" value="TOKEN-HOME"></form>', {
          status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'ASP.NET_SessionId=HOME; Path=/' },
        });
      }
      if (url.endsWith('/Captcha/Show')) return response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
      if (url.endsWith('/HomeNoLogin/SearchByFkey')) {
        return response('<button onclick="ajxCall4Portal(\'CHECK-HOME\',\'x\')">Xem</button>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (url.endsWith('/HomeNoLogin/ajxPreview/')) {
        return response(JSON.stringify({ str: '<div>MST 4501622475 Ký hiệu 1C26TST</div>' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/HomeNoLogin/downloadPDF?')) return response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
      throw new Error('Unexpected request ' + method + ' ' + url);
    }) as unknown as typeof fetch;
    const adapter = new VnptInvoiceTvanAdapter();
    const ctx = context(fetchImpl);
    const challenge = await adapter.getCaptchaChallenge(doc, ctx);
    expect(challenge.challenge).toMatchObject({ providerCode: 'tvan_vnpt', kind: 'text', imageMimeType: 'image/png' });
    expect(challenge.challenge.imageBase64).toBe(PNG.toString('base64'));

    await adapter.verifyCaptcha(doc, challenge.challenge, challenge.privateState, 'USER-CAPTCHA', ctx);
    expect(ctx.token).toBeTruthy();
    const searched = calls.find((call) => call.url.endsWith('/HomeNoLogin/SearchByFkey'));
    expect(searched?.body).toContain('strFkey=FKEY-123');
    expect(searched?.body).toContain('captch=USER-CAPTCHA');
    expect(calls.some((call) => call.cookie?.includes('ASP.NET_SessionId=HOME'))).toBe(true);

    const pdf = await adapter.downloadPdf(doc, ctx);
    expect(pdf.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(calls.at(-1)?.url).toContain('/HomeNoLogin/downloadPDF?');
    expect(calls.at(-1)?.url).toContain('checkCode=CHECK-HOME');
  });

  it('completes the legacy Portal/Share flow and uses Share/DownloadPDF', async () => {
    const doc = vnptDocument();
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      calls.push({ url, method });
      if (url.endsWith('/Portal/Index') && method === 'GET') {
        return response('<form action="/Portal/Index"><input name="__RequestVerificationToken" value="TOKEN-CENTRAL"></form>', {
          status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'ASP.NET_SessionId=CENTRAL; Path=/' },
        });
      }
      if (url.endsWith('/Captcha/Show')) return response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
      if (url.endsWith('/Portal/Index') && method === 'POST') {
        return response('<a onclick="showDetailInv(\'INV-77\',\'1\',\'4911\',\'FKEY-123\')">Xem</a>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (url.endsWith('/Share/ajxPreviewv2')) {
        return response(JSON.stringify({ result: '<div>4501622475 1C26TST</div>', checkCode: 'CHECK-SHARE' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/Share/DownloadPDF?')) return response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
      throw new Error('Unexpected request ' + method + ' ' + url);
    }) as unknown as typeof fetch;

    const adapter = new VnptInvoiceTvanAdapter();
    const ctx = context(fetchImpl);
    const challenge = await adapter.getCaptchaChallenge(doc, ctx);
    await adapter.verifyCaptcha(doc, challenge.challenge, challenge.privateState, 'USER-CAPTCHA', ctx);
    const pdf = await adapter.downloadPdf(doc, ctx);
    expect(pdf.content.subarray(0, 5).toString()).toBe('%PDF-');
    const download = calls.at(-1)?.url || '';
    expect(download).toContain('/Share/DownloadPDF?');
    expect(download).toContain('pattern=1');
    expect(download).toContain('comid=4911');
    expect(download).toContain('id=CHECK-SHARE');
  });

  it('rejects redirects outside the VNPT domain family', async () => {
    const adapter = new VnptInvoiceTvanAdapter();
    const fetchImpl = vi.fn().mockResolvedValue(response(null, { status: 302, headers: { location: 'https://evil.example/captcha' } })) as unknown as typeof fetch;
    await expect(adapter.getCaptchaChallenge(vnptDocument(), context(fetchImpl))).rejects.toMatchObject({ code: 'TVAN_VNPT_URL_REJECTED' });
  });
});
