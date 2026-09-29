import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright-core';
import yazl from 'yazl';
import { document } from '../helpers.js';
import type { InvoiceDocument } from '../../src/shared/models/index.js';
import { ThaisonTvanAdapter } from '../../src/server/tvan/adapters/thaison.js';
import { resolveThaisonLookup } from '../../src/server/tvan/adapters/thaison/lookup.js';
import { parseCaptchaBootstrapHtml, resolveDownloadDescriptor } from '../../src/server/tvan/adapters/thaison/parser.js';
import { normalizedPdfFromOriginal } from '../../src/server/tvan/adapters/thaison/artifact.js';
import { ThaisonBrowserSessionManager, type ThaisonBrowserGateway } from '../../src/server/tvan/adapters/thaison-browser.js';
import type { TvanAdapterContext, TvanTokenState } from '../../src/server/tvan/types.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
const UUID = '2067f654-be40-4039-a43f-70d316508774';

function thaisonDocument(overrides: Record<string, unknown> = {}): InvoiceDocument {
  return document({
    key: 'thaison-delmar-1139',
    providerCode: 'tvan_thaison',
    seller: { taxCode: '0311996400-001', name: 'Delmar', dynamicFields: [] },
    templateNo: 1,
    series: 'C25TDM',
    invoiceNo: 1139,
    providers: {
      solution: { taxCode: '0101300842' },
      presentation: { adapterCode: 'tvan_thaison' },
    },
    lookup: {
      providerCode: 'tvan_thaison',
      confidence: 'low',
    },
    rawDetail: {
      msttcgp: '0101300842',
      ttkhac: [
        { ttruong: 'DC TC', dlieu: 'http://Delmarhan.einvoice.com.vn' },
        { ttruong: 'Mã TC', dlieu: '1D2DGQRRCBH' },
      ],
    },
    ...overrides,
  } as any);
}

function context(fetchImpl: typeof fetch): TvanAdapterContext {
  const state: { token?: TvanTokenState } = {};
  return {
    fetchImpl,
    timeoutMs: 5_000,
    maxDownloadBytes: 2 * 1024 * 1024,
    get token() { return state.token; },
    setToken(value) { state.token = value; },
  };
}

function makeZip(entries: Array<{ name: string; content: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    for (const entry of entries) zip.addBuffer(entry.content, entry.name);
    zip.end();
  });
}

describe('Thái Sơn lookup/capability', () => {
  it('resolves raw DC TC + Mã TC only for the verified tenant profile', () => {
    const lookup = resolveThaisonLookup(thaisonDocument());
    expect(lookup).toMatchObject({
      portalOrigin: 'https://delmarhan.einvoice.com.vn',
      portalHost: 'delmarhan.einvoice.com.vn',
      lookupCode: '1D2DGQRRCBH',
      sellerTaxCode: '0311996400-001',
      profile: 'tenant_v1',
    });
  });

  it('uses canonical shared portal for shared, unverified-tenant and missing-DC records', () => {
    const adapter = new ThaisonTvanAdapter();
    const shared = thaisonDocument({
      rawDetail: {
        msttcgp: '0101300842',
        ttkhac: [
          { ttruong: 'DC TC', dlieu: 'https://einvoice.vn/tra-cuu' },
          { ttruong: 'Mã TC', dlieu: '683DE41E95I' },
        ],
      },
    });
    expect(resolveThaisonLookup(shared)).toMatchObject({
      portalOrigin: 'https://einvoice.vn',
      portalHost: 'einvoice.vn',
      lookupCode: '683DE41E95I',
      profile: 'shared_v1',
    });
    expect(adapter.capability(shared)).toMatchObject({ supported: true });

    const otherTenant = thaisonDocument({
      rawDetail: {
        msttcgp: '0101300842',
        ttkhac: [
          { ttruong: 'DC TC', dlieu: 'https://vinahongduong.einvoice.com.vn' },
          { ttruong: 'Mã TC', dlieu: 'ABCDEFGHIJK' },
        ],
      },
    });
    expect(resolveThaisonLookup(otherTenant)).toMatchObject({
      portalOrigin: 'https://einvoice.vn',
      profile: 'shared_v1',
    });
    expect(adapter.capability(otherTenant)).toMatchObject({ supported: true });

    const missing = thaisonDocument({
      rawDetail: {
        msttcgp: '0101300842',
        ttkhac: [{ ttruong: 'Mã TC', dlieu: 'XVUQQCU61' }],
      },
    });
    expect(resolveThaisonLookup(missing)).toMatchObject({
      portalOrigin: 'https://einvoice.vn',
      profile: 'shared_v1',
      lookupCode: 'XVUQQCU61',
    });
    expect(adapter.capability(missing)).toMatchObject({ supported: true });
  });

  it('accepts normalized/raw lookup values when they are semantically identical', () => {
    const doc = thaisonDocument({
      lookup: {
        providerCode: 'tvan_thaison',
        lookupCode: '1D2DGQRRCBH',
        lookupBaseUrl: 'http://delmarhan.einvoice.com.vn/',
        confidence: 'high',
      },
    });
    expect(resolveThaisonLookup(doc)).toMatchObject({
      portalHost: 'delmarhan.einvoice.com.vn',
      lookupCode: '1D2DGQRRCBH',
    });
  });

  it('rejects conflicting Mã TC values instead of choosing silently', () => {
    const doc = thaisonDocument({
      lookup: {
        providerCode: 'tvan_thaison',
        lookupCode: 'AAAAAAAAAAA',
        confidence: 'high',
      },
    });
    expect(() => resolveThaisonLookup(doc)).toThrow(/nhiều Mã TC/i);
  });
});



describe('Thái Sơn parser/artifact fail-closed gates', () => {
  it('rejects bootstrap HTML when the observed lookup fields are incomplete', () => {
    expect(() => parseCaptchaBootstrapHtml(
      '<form action="/xem-hoa-don" method="post">'
      + '<input name="CaptchaDeText" value="opaque" />'
      + '<img id="CaptchaImage" src="/DefaultCaptcha/Generate?t=opaque" />'
      + '</form>',
    )).toThrow(/thiếu field tra cứu\/CAPTCHA/i);
  });

  it('rejects conflicting provider download UUIDs', () => {
    expect(() => resolveDownloadDescriptor(
      [{ downloadId: '2067f654-be40-4039-a43f-70d316508774', relativePath: '/tai-ve-hoa-don/2067f654-be40-4039-a43f-70d316508774' }],
      [{ downloadId: '3067f654-be40-4039-a43f-70d316508775', relativePath: '/tai-ve-hoa-don/3067f654-be40-4039-a43f-70d316508775' }],
    )).toThrow(/nhiều download UUID/i);
  });

  it('keeps XML-only ZIP as original-only and rejects ambiguous multi-PDF ZIP', async () => {
    const xmlOnly = await makeZip([{ name: 'invoice.xml', content: Buffer.from('<xml/>') }]);
    await expect(normalizedPdfFromOriginal(thaisonDocument(), xmlOnly, '11139.zip', 2 * 1024 * 1024))
      .resolves.toBeUndefined();

    const ambiguous = await makeZip([
      { name: 'a.pdf', content: PDF },
      { name: 'b.pdf', content: PDF },
    ]);
    await expect(normalizedPdfFromOriginal(thaisonDocument(), ambiguous, '11139.zip', 2 * 1024 * 1024))
      .rejects.toMatchObject({ code: 'TVAN_THAISON_PDF_AMBIGUOUS' });
  });

  it('rejects ZIP whose total uncompressed content exceeds the configured limit', async () => {
    const oversized = await makeZip([
      { name: '11139.pdf', content: PDF },
      { name: 'payload.xml', content: Buffer.alloc(4096, 0x41) },
    ]);
    await expect(normalizedPdfFromOriginal(thaisonDocument(), oversized, '11139.zip', 1024))
      .rejects.toMatchObject({ code: 'TVAN_THAISON_ZIP_UNSAFE' });
  });

  it('does not perform network I/O for unsupported Thái Sơn tenant profiles', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network must not run'); }) as unknown as typeof fetch;
    const adapter = new ThaisonTvanAdapter();
    const unsupported = thaisonDocument({
      rawDetail: {
        msttcgp: '0101300842',
        ttkhac: [
          { ttruong: 'DC TC', dlieu: 'https://evil.example/tra-cuu' },
          { ttruong: 'Mã TC', dlieu: 'ABCDEFGHIJK' },
        ],
      },
    });
    await expect(adapter.getCaptchaChallenge(unsupported, context(fetchImpl)))
      .rejects.toMatchObject({ code: 'TVAN_THAISON_PORTAL_REJECTED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


describe('Thái Sơn adapter shared portal flow', () => {
  it('keeps CAPTCHA/PDF in one browser session and exposes only safe public state', async () => {
    const calls: string[] = [];
    const gateway: ThaisonBrowserGateway = {
      createChallenge: vi.fn(async (input) => {
        calls.push('create:' + input.documentKey + ':' + input.lookupCode + ':' + input.portalUrl);
        return {
          challengeId: 'shared-challenge-1',
          imageBase64: GIF.toString('base64'),
          imageMimeType: 'image/gif',
          expiresAt: Date.now() + 5 * 60_000,
          portalUrl: input.portalUrl,
        };
      }),
      verifyAndDownload: vi.fn(async (input) => {
        calls.push('verify:' + input.challengeId + ':' + input.documentKey + ':' + input.captcha);
        return {
          content: PDF,
          contentDisposition: 'inline; filename="shared-539.pdf"',
          responseStatus: 200,
          responseContentType: 'application/pdf',
          pdfUrl: 'https://einvoice.vn/tra-cuu/xem-hoa-don?code=MASKED',
        };
      }),
      closeChallenge: vi.fn(async (id) => { calls.push('close:' + id); }),
      closeDocument: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const fetchImpl = vi.fn(async () => { throw new Error('shared flow must stay in browser gateway'); }) as unknown as typeof fetch;
    const adapter = new ThaisonTvanAdapter(gateway);
    const ctx = context(fetchImpl);
    const doc = thaisonDocument({
      key: 'thaison-shared-539',
      templateNo: 1,
      series: 'C25TVC',
      invoiceNo: 539,
      rawDetail: {
        msttcgp: '0101300842',
        ttkhac: [
          { ttruong: 'DC TC', dlieu: 'http://einvoice.vn/tra-cuu' },
          { ttruong: 'Mã TC', dlieu: '683DE41E95I' },
        ],
      },
    });

    const challenge = await adapter.getCaptchaChallenge(doc, ctx);
    expect(challenge.challenge).toMatchObject({
      id: 'shared-challenge-1',
      providerCode: 'tvan_thaison',
      imageMimeType: 'image/gif',
    });
    expect(JSON.stringify(challenge.challenge)).not.toContain('683DE41E95I');

    const verified = await adapter.verifyCaptcha(doc, challenge.challenge, challenge.privateState, 'ABCD', ctx);
    expect(verified.stage).toBe('pdf_ready');
    expect(adapter.artifactStatus(doc, ctx)).toMatchObject({ stage: 'pdf_ready', canView: true });

    const artifact = await adapter.prepareArtifact(doc, ctx);
    expect(artifact.originalContentType).toBe('application/pdf');
    expect(artifact.pdf?.equals(PDF)).toBe(true);
    expect(artifact.pdfFileName).toBe('shared-539.pdf');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(calls).toEqual([
      'create:thaison-shared-539:683DE41E95I:https://einvoice.vn/tra-cuu',
      'verify:shared-challenge-1:thaison-shared-539:ABCD',
    ]);
  });
});

describe('Thái Sơn adapter tenant flow', () => {
  it('keeps cookie/private state backend-only and prepares original ZIP + provider PDF', async () => {
    const zip = await makeZip([
      { name: '11139.pdf', content: PDF },
      { name: 'invoice.xml', content: Buffer.from('<xml/>') },
    ]);
    const calls: Array<{ url: string; method: string; cookie?: string; body?: string }> = [];

    const fetchImpl = vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || {});
      const body = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ url, method, cookie: headers.get('cookie') || undefined, body });

      if (url === 'https://delmarhan.einvoice.com.vn/' && method === 'GET') {
        return new Response(
          '<form action="/xem-hoa-don" method="post">'
          + '<input name="MA_NHAN_HOA_DON" />'
          + '<input name="CaptchaDeText" value="opaque-1" />'
          + '<input name="CaptchaInputText" />'
          + '<img id="CaptchaImage" src="/DefaultCaptcha/Generate?t=opaque-1" />'
          + '</form>',
          { status: 200, headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'ASP.NET_SessionId=s1; Path=/' } },
        );
      }
      if (url === 'https://delmarhan.einvoice.com.vn/DefaultCaptcha/Generate?t=opaque-1' && method === 'GET') {
        expect(headers.get('referer')).toBe('https://delmarhan.einvoice.com.vn/');
        return new Response(GIF, { status: 200, headers: { 'Content-Type': 'image/gif', 'Set-Cookie': 'SERVERID=node1; Path=/' } });
      }
      if (url === 'https://delmarhan.einvoice.com.vn/xem-hoa-don' && method === 'POST') {
        expect(headers.get('cookie')).toContain('ASP.NET_SessionId=s1');
        expect(headers.get('cookie')).toContain('SERVERID=node1');
        const form = new URLSearchParams(body);
        expect(form.get('MA_NHAN_HOA_DON')).toBe('1D2DGQRRCBH');
        expect(form.get('CaptchaDeText')).toBe('opaque-1');
        expect(form.get('CaptchaInputText')).toBe('ABCD');
        return new Response(
          '<html><body>'
          + '<iframe src="/Download/DetailHoaDon"></iframe>'
          + '<script>var u="/tai-ve-hoa-don/' + UUID + '";</script>'
          + '</body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }
      if (url === 'https://delmarhan.einvoice.com.vn/Download/DetailHoaDon' && method === 'GET') {
        return new Response(
          '<html><body>'
          + '<div>Mã số thuế: 0311996400-001</div>'
          + '<div>Ký hiệu: 1C25TDM</div>'
          + '<div>Số hóa đơn: 1139</div>'
          + '<a href="/tai-ve-hoa-don/' + UUID + '?printFlag=true">download</a>'
          + '</body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }
      if (url === 'https://delmarhan.einvoice.com.vn/tai-ve-hoa-don/' + UUID && method === 'GET') {
        return new Response(new Uint8Array(zip), {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="11139.zip"',
          },
        });
      }
      throw new Error('Unexpected request: ' + method + ' ' + url);
    }) as unknown as typeof fetch;

    const adapter = new ThaisonTvanAdapter();
    const ctx = context(fetchImpl);
    const doc = thaisonDocument();

    const prepared = await adapter.getCaptchaChallenge(doc, ctx);
    expect(prepared.challenge.imageMimeType).toBe('image/gif');
    expect(JSON.stringify(prepared.challenge)).not.toContain('opaque-1');
    expect(prepared.trace?.endpoint).toBe('https://delmarhan.einvoice.com.vn/');

    const verified = await adapter.verifyCaptcha(doc, prepared.challenge, prepared.privateState, 'ABCD', ctx);
    expect(verified.stage).toBe('search_verified');
    expect(verified.request?.requestBody).not.toContain('1D2DGQRRCBH');
    expect(verified.request?.requestBody).not.toContain('ABCD');

    const artifact = await adapter.prepareArtifact(doc, ctx);
    expect(artifact.originalContentType).toBe('application/zip');
    expect(artifact.originalFileName).toBe('11139.zip');
    expect(artifact.original.equals(zip)).toBe(true);
    expect(artifact.pdf?.equals(PDF)).toBe(true);
    expect(artifact.pdfFileName).toBe('11139.pdf');
    expect(adapter.artifactStatus(doc, ctx)).toMatchObject({
      stage: 'pdf_ready',
      canView: true,
      canDownloadOriginal: true,
    });

    expect(calls.map((item) => [item.method, new URL(item.url).pathname])).toEqual([
      ['GET', '/'],
      ['GET', '/DefaultCaptcha/Generate'],
      ['POST', '/xem-hoa-don'],
      ['GET', '/Download/DetailHoaDon'],
      ['GET', '/tai-ve-hoa-don/' + UUID],
    ]);
  });

  it('keeps original_ready when a valid ZIP contains no PDF', async () => {
    const zip = await makeZip([{ name: 'invoice.xml', content: Buffer.from('<xml/>') }]);
    let token: TvanTokenState | undefined;
    const adapter = new ThaisonTvanAdapter();
    const doc = thaisonDocument();
    const fetchImpl = vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      if (url.endsWith('/') && method === 'GET') {
        return new Response(
          '<form action="/xem-hoa-don" method="post"><input name="MA_NHAN_HOA_DON" />'
          + '<input name="CaptchaDeText" value="o" /><input name="CaptchaInputText" />'
          + '<img id="CaptchaImage" src="/DefaultCaptcha/Generate?t=o" /></form>',
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        );
      }
      if (url.includes('/DefaultCaptcha/Generate')) return new Response(GIF, { status: 200, headers: { 'Content-Type': 'image/gif' } });
      if (url.endsWith('/xem-hoa-don')) {
        return new Response('<iframe src="/Download/DetailHoaDon"></iframe><a href="/tai-ve-hoa-don/' + UUID + '">x</a>', { status: 200 });
      }
      if (url.endsWith('/Download/DetailHoaDon')) {
        return new Response('0311996400-001 1C25TDM Số hóa đơn: 1139 <a href="/tai-ve-hoa-don/' + UUID + '">x</a>', { status: 200 });
      }
      if (url.includes('/tai-ve-hoa-don/')) return new Response(new Uint8Array(zip), { status: 200, headers: { 'Content-Type': 'application/zip' } });
      throw new Error('unexpected ' + url);
    }) as unknown as typeof fetch;
    const ctx: TvanAdapterContext = {
      fetchImpl,
      timeoutMs: 5_000,
      maxDownloadBytes: 2 * 1024 * 1024,
      get token() { return token; },
      setToken(value) { token = value; },
    };

    const challenge = await adapter.getCaptchaChallenge(doc, ctx);
    await adapter.verifyCaptcha(doc, challenge.challenge, challenge.privateState, 'X', ctx);
    const artifact = await adapter.prepareArtifact(doc, ctx);
    expect(artifact.originalContentType).toBe('application/zip');
    expect(artifact.pdf).toBeUndefined();
    expect(adapter.artifactStatus(doc, ctx)).toMatchObject({
      stage: 'original_ready',
      canView: false,
      canDownloadOriginal: true,
    });
    await expect(adapter.downloadPdf(doc, ctx)).rejects.toMatchObject({ code: 'TVAN_THAISON_PDF_NOT_FOUND' });
  });
});


describe('Thái Sơn shared browser lifecycle', () => {
  const SHARED_LOOKUP = '683DE41E95I';
  const RENDERED_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

  function fakeBrowser(options: {
    viewMarkup?: 'href' | 'script';
    viewResponse?: 'html' | 'pdf';
    downloadResponse?: 'pdf' | 'zip';
  } = {}) {
    const contexts: Array<{ close: ReturnType<typeof vi.fn>; page: any; cdp: any }> = [];
    const newContext = vi.fn(async () => {
      let closed = false;
      let closeHandler: (() => void) | undefined;
      let pausedHandler: ((event: any) => void) | undefined;
      let activePdfBody = PDF;
      const viewMarkup = options.viewMarkup === 'script'
        ? '<script>$("#viewInvoice").attr("src", "/tra-cuu/xem-hoa-don?code=' + SHARED_LOOKUP + '");</script>'
        : '<a href="/tra-cuu/xem-hoa-don?code=' + SHARED_LOOKUP + '">Xem</a>';
      const html = viewMarkup + '<a href="/tra-cuu/tai-hoa-don-dien-tu?format=pdf">Tải</a>';

      const cdp = {
        on: vi.fn((event: string, handler: (payload: any) => void) => {
          if (event === 'Fetch.requestPaused') pausedHandler = handler;
        }),
        off: vi.fn((event: string, handler: (payload: any) => void) => {
          if (event === 'Fetch.requestPaused' && pausedHandler === handler) pausedHandler = undefined;
        }),
        detach: vi.fn().mockResolvedValue(undefined),
        send: vi.fn(async (method: string, args?: any) => {
          if (method === 'Fetch.enable' || method === 'Fetch.disable' || method === 'IO.close') return {};
          if (method === 'Fetch.takeResponseBodyAsStream') return { stream: 'pdf-stream-1' };
          if (method === 'IO.read') return { data: activePdfBody.toString('base64'), base64Encoded: true, eof: true };
          if (method === 'Fetch.fulfillRequest') return {};
          if (['Fetch.continueRequest', 'Fetch.continueResponse', 'Fetch.failRequest'].includes(method)) return {};
          throw new Error('Unexpected CDP method: ' + method + ' ' + JSON.stringify(args));
        }),
      };

      const evaluate = vi.fn(async (_fn: unknown, input?: any) => {
        if (!input) return {
          token: 'opaque-shared-token',
          src: '/DefaultCaptcha/Generate?t=opaque-shared-token',
          imageDataUrl: 'data:image/png;base64,' + RENDERED_PNG.toString('base64'),
        };
        if (typeof input === 'object' && input.lookupCode) {
          expect(input.url).toBe('https://einvoice.vn/tra-cuu');
          expect(input.lookupCode).toBe(SHARED_LOOKUP);
          expect(input.captchaToken).toBe('opaque-shared-token');
          expect(input.captcha).toBe('GaHv');
          return undefined;
        }
        if (typeof input === 'string' && input.includes('/tra-cuu/xem-hoa-don?code=')) {
          activePdfBody = options.viewResponse === 'pdf'
            ? PDF
            : Buffer.from('<!doctype html><html>viewer wrapper</html>');
          queueMicrotask(() => pausedHandler?.({
            requestId: 'pdf-request-1', request: { url: input }, responseStatusCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: options.viewResponse === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8' },
              { name: 'Content-Disposition', value: 'inline; filename="6_C25NBT_82.pdf"' },
              { name: 'Content-Length', value: String(activePdfBody.length) },
            ],
          }));
          return undefined;
        }
        if (typeof input === 'string' && input.includes('/tra-cuu/tai-hoa-don-dien-tu?format=pdf')) {
          activePdfBody = options.downloadResponse === 'zip'
            ? Buffer.from('504b0304140008000800f14a', 'hex')
            : PDF;
          queueMicrotask(() => pausedHandler?.({
            requestId: 'pdf-request-1', request: { url: input }, responseStatusCode: 200,
            responseHeaders: [
              { name: 'Content-Type', value: options.downloadResponse === 'zip' ? 'text/html; charset=utf-8' : 'application/pdf' },
              { name: 'Content-Disposition', value: 'attachment; filename="1_C25TVC_539.pdf"' },
              { name: 'Content-Length', value: String(activePdfBody.length) },
            ],
          }));
          return undefined;
        }
        throw new Error('Unexpected evaluate input: ' + JSON.stringify(input));
      });

      const navigationResponse = {
        headers: () => ({ 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(html)) }),
        status: () => 200,
        ok: () => true,
      };
      let context: any;
      const page = {
        setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(),
        route: vi.fn().mockResolvedValue(undefined), goto: vi.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
        waitForFunction: vi.fn().mockResolvedValue(undefined), waitForNavigation: vi.fn().mockResolvedValue(navigationResponse),
        content: vi.fn().mockResolvedValue(html), url: vi.fn(() => 'https://einvoice.vn/tra-cuu'),
        context: vi.fn(() => context), isClosed: vi.fn(() => closed), evaluate,
      };
      const close = vi.fn(async () => { closed = true; closeHandler?.(); });
      context = {
        newPage: vi.fn().mockResolvedValue(page), newCDPSession: vi.fn().mockResolvedValue(cdp), close,
        once: vi.fn((event: string, handler: () => void) => { if (event === 'close') closeHandler = handler; }),
      };
      contexts.push({ close, page, cdp });
      return context as any;
    });
    return { instance: { newContext, on: vi.fn() } as unknown as Browser, contexts, newContext };
  }

  it('extracts the HAR-proven viewer URL from script assignment before trying the ZIP fallback', async () => {
    const browser = fakeBrowser({
      viewMarkup: 'script',
      viewResponse: 'pdf',
      downloadResponse: 'zip',
    });
    const manager = new ThaisonBrowserSessionManager(async () => browser.instance, 2);
    const challenge = await manager.createChallenge({
      documentKey: 'doc-har', lookupCode: SHARED_LOOKUP, portalUrl: 'https://einvoice.vn/tra-cuu',
      timeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024,
    });
    const result = await manager.verifyAndDownload({
      challengeId: challenge.challengeId, documentKey: 'doc-har', captcha: 'GaHv', maxDownloadBytes: 2 * 1024 * 1024,
    });

    const { page } = browser.contexts[0];
    expect(result.content.equals(PDF)).toBe(true);
    expect(result.pdfUrl).toBe('https://einvoice.vn/tra-cuu/xem-hoa-don?code=' + SHARED_LOOKUP);
    expect(page.evaluate.mock.calls.some((call: any[]) =>
      typeof call[1] === 'string' && call[1].includes('/xem-hoa-don?code=' + SHARED_LOOKUP),
    )).toBe(true);
    expect(page.evaluate.mock.calls.some((call: any[]) =>
      typeof call[1] === 'string' && call[1].includes('/tai-hoa-don-dien-tu?format=pdf'),
    )).toBe(false);
    await manager.dispose();
  });

  it('falls back from viewer HTML to the PDF download candidate in the same context', async () => {
    const browser = fakeBrowser();
    const manager = new ThaisonBrowserSessionManager(async () => browser.instance, 2);
    const challenge = await manager.createChallenge({
      documentKey: 'doc-1', lookupCode: SHARED_LOOKUP, portalUrl: 'https://einvoice.vn/tra-cuu',
      timeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024,
    });
    expect(challenge.imageMimeType).toBe('image/png');
    const result = await manager.verifyAndDownload({
      challengeId: challenge.challengeId, documentKey: 'doc-1', captcha: 'GaHv', maxDownloadBytes: 2 * 1024 * 1024,
    });
    expect(result.content.equals(PDF)).toBe(true);
    expect(result.pdfUrl).toBe('https://einvoice.vn/tra-cuu/tai-hoa-don-dien-tu?format=pdf');
    expect(browser.contexts).toHaveLength(1);
    expect(browser.contexts[0].close).toHaveBeenCalledOnce();
    await manager.dispose();
  });

  it('releases the browser quota when a document challenge is replaced', async () => {
    const browser = fakeBrowser();
    const manager = new ThaisonBrowserSessionManager(async () => browser.instance, 1);
    await manager.createChallenge({
      documentKey: 'doc-1', lookupCode: SHARED_LOOKUP, portalUrl: 'https://einvoice.vn/tra-cuu',
      timeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024,
    });
    await expect(manager.createChallenge({
      documentKey: 'doc-2', lookupCode: SHARED_LOOKUP + 'X', portalUrl: 'https://einvoice.vn/tra-cuu',
      timeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024,
    })).rejects.toMatchObject({ code: 'TVAN_THAISON_BROWSER_BUSY' });
    await manager.createChallenge({
      documentKey: 'doc-1', lookupCode: SHARED_LOOKUP, portalUrl: 'https://einvoice.vn/tra-cuu',
      timeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024,
    });
    expect(browser.contexts[0].close).toHaveBeenCalledOnce();
    await manager.dispose();
    expect(browser.contexts[1].close).toHaveBeenCalledOnce();
  });
});
