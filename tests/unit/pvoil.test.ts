import { describe, expect, it, vi } from 'vitest';
import { document } from '../helpers.js';
import { PvoilTvanAdapter, parsePvoilSearchReference, pvoilLookupFromXml } from '../../src/server/tvan/adapters/pvoil.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';
import type { TvanAdapterContext, TvanTokenState } from '../../src/server/tvan/types.js';

const PNG = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

function pvoilDocument(overrides: Record<string, unknown> = {}) {
  return document({
    seller: { taxCode: '0305795054', name: 'PVOIL', dynamicFields: [] },
    templateNo: 1,
    series: 'C25TPV',
    invoiceNo: '123',
    providerCode: 'tckntt_pvoil',
    providers: {
      solution: { taxCode: '0305795054' },
      transport: { taxCode: '0305795054', code: 'tckntt_pvoil' },
    },
    lookup: {
      providerCode: 'tckntt_pvoil',
      lookupCode: 'FKEY-PVOIL-123',
      lookupCodeType: 'Fkey',
      confidence: 'medium',
    },
    rawSummary: {
      msttcgp: '0305795054',
      ngcnhat: 'tckntt_pvoil',
      cttkhac: [{ ttruong: 'Fkey', dlieu: 'FKEY-PVOIL-123' }],
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

describe('PVOIL adapter', () => {
  it('resolves exact MSTTCGP 0305795054', () => {
    const doc = pvoilDocument();
    const registry = new TvanRegistry();
    expect(registry.resolve(doc)?.providerCode).toBe('tvan_pvoil');
    expect(registry.capability(doc)).toMatchObject({
      providerCode: 'tvan_pvoil',
      displayName: 'PVOIL eInvoice',
      supported: true,
      captchaMode: 'per_invoice',
      priority: 'P3',
    });
  });

  it('does not match a different solution provider', () => {
    const other = pvoilDocument({
      providers: { solution: { taxCode: '0101234567' }, transport: { code: 'tckntt_pvoil' } },
      rawSummary: { msttcgp: '0101234567', ngcnhat: 'tckntt_pvoil' },
    });
    expect(new TvanRegistry().resolve(other)?.providerCode).not.toBe('tvan_pvoil');
  });

  it('extracts Fkey from XML and parses search reference', () => {
    const xml = Buffer.from('<HDon><DLHDon><TTKhac><TTin><TTruong>Fkey</TTruong><DLieu>XML-FKEY</DLieu></TTin></TTKhac></DLHDon></HDon>');
    expect(pvoilLookupFromXml(xml)).toBe('XML-FKEY');
    expect(parsePvoilSearchReference('<a onclick="ajxCall4Portal(\'INV-77\',\'1\',true,false)">Xem</a>'))
      .toEqual({ invoiceId: 'INV-77', pattern: '1' });
  });

  it('completes CAPTCHA -> preview -> PDF flow', async () => {
    const calls: Array<{ url: string; method: string; body?: string; cookie?: string }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || {});
      const body = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ url, method, body, cookie: headers.get('cookie') || undefined });

      if (url.endsWith('/Invoice/Search') && method === 'GET') {
        return response('<html>search</html>', { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'ASP.NET_SessionId=PVOIL; Path=/' } });
      }
      if (url.endsWith('/Captcha/Show')) {
        return response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      if (url.endsWith('/Invoice/Search') && method === 'POST') {
        return response('<a onclick="ajxCall4Portal(\'INV-77\',\'1\',true,false)">Xem</a>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (url.endsWith('/Invoice/InvPreview/')) {
        return response(JSON.stringify({ success: true, data: '<div>0305795054 C25TPV</div>' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/Invoice/DownloadPDF?')) {
        return response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
      }
      throw new Error('Unexpected request ' + method + ' ' + url);
    }) as unknown as typeof fetch;

    const adapter = new PvoilTvanAdapter();
    const ctx = context(fetchImpl);
    const challenge = await adapter.getCaptchaChallenge(pvoilDocument(), ctx);
    expect(challenge.challenge).toMatchObject({ providerCode: 'tvan_pvoil', kind: 'text', imageMimeType: 'image/png' });
    expect(challenge.challenge.imageBase64).toBe(PNG.toString('base64'));

    await adapter.verifyCaptcha(pvoilDocument(), challenge.challenge, challenge.privateState, '1234', ctx);
    expect(ctx.token).toBeTruthy();
    const search = calls.find(call => call.url.endsWith('/Invoice/Search') && call.method === 'POST');
    expect(search?.body).toContain('TT78=true');
    expect(search?.body).toContain('key=FKEY-PVOIL-123');
    expect(search?.body).toContain('captch=1234');
    expect(calls.some(call => call.cookie?.includes('ASP.NET_SessionId=PVOIL'))).toBe(true);

    const pdf = await adapter.downloadPdf(pvoilDocument(), ctx);
    expect(pdf.content.subarray(0,5).toString()).toBe('%PDF-');
    expect(calls.at(-1)?.url).toContain('/Invoice/DownloadPDF?');
    expect(calls.at(-1)?.url).toContain('id=INV-77');
    expect(calls.at(-1)?.url).toContain('pattern=1');
  });

  it('uses XML bridge when dataset has no Fkey', async () => {
    const loadInvoiceXml = vi.fn().mockResolvedValue(Buffer.from('<HDon><DLHDon><TTKhac><TTin><TTruong>Fkey</TTruong><DLieu>XML-PVOIL</DLieu></TTin></TTKhac></DLHDon></HDon>'));
    const adapter = new PvoilTvanAdapter();
    const doc = pvoilDocument({ lookup: undefined, rawSummary: { msttcgp: '0305795054' } });
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith('/Invoice/Search')) return response('<html>search</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      if (url.endsWith('/Captcha/Show')) return response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
      throw new Error('Unexpected request ' + url);
    }) as unknown as typeof fetch;
    await adapter.getCaptchaChallenge(doc, context(fetchImpl, loadInvoiceXml));
    expect(loadInvoiceXml).toHaveBeenCalledOnce();
  });
});
