import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright-core';
import { document } from '../helpers.js';
import { AppError } from '../../src/shared/utils/index.js';
import { presentationForSolutionTaxCode } from '../../src/shared/provider-resolution.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';
import { TvanPdfService } from '../../src/server/tvan/pdf.service.js';
import {
  FastEinvoiceTvanAdapter,
  fastKeySearchFromXml,
} from '../../src/server/tvan/adapters/fast.js';
import {
  FastBrowserSessionManager,
  type FastBrowserGateway,
} from '../../src/server/tvan/adapters/fast-browser.js';
import type { TvanAdapterContext, TvanTokenState } from '../../src/server/tvan/types.js';

const FAST_MST = '0100727825';
const KEYSEARCH = 'FAST-KEY-ABC-123';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n');

function fastDocument(overrides: Record<string, unknown> = {}) {
  return document({
    seller: { taxCode: '0100123456', name: 'FAST seller', dynamicFields: [] },
    templateNo: 1,
    series: '1C26TST',
    invoiceNo: 123,
    providerCode: 'tvan_transport',
    providers: {
      solution: { taxCode: FAST_MST },
      transport: { code: 'tvan_transport' },
    },
    lookup: {
      providerCode: 'tvan_transport',
      lookupCode: KEYSEARCH,
      lookupCodeType: 'KeySearch',
      sourceSection: 'invoice.ttkhac',
      sourceField: 'KeySearch',
      confidence: 'medium',
    },
    rawSummary: {
      msttcgp: FAST_MST,
      ttkhac: [{ ttruong: 'KeySearch', dlieu: KEYSEARCH }],
    },
    ...overrides,
  } as any);
}

function adapterContext(loadInvoiceXml?: TvanAdapterContext['loadInvoiceXml']): TvanAdapterContext {
  const state: { token?: TvanTokenState } = {};
  return {
    fetchImpl: fetch,
    timeoutMs: 5_000,
    maxDownloadBytes: 2 * 1024 * 1024,
    get token() { return state.token; },
    setToken(token) { state.token = token; },
    loadInvoiceXml,
  };
}

function successGateway(): FastBrowserGateway & {
  createChallenge: ReturnType<typeof vi.fn>;
  verifyAndDownload: ReturnType<typeof vi.fn>;
  closeChallenge: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    createChallenge: vi.fn().mockResolvedValue({
      challengeId: '11111111-1111-4111-8111-111111111111',
      imageBase64: PNG.toString('base64'),
      imageMimeType: 'image/png',
      expiresAt: Date.now() + 300_000,
    }),
    verifyAndDownload: vi.fn().mockResolvedValue({
      content: PDF,
      invoice: '123',
      fileName: 'FAST_123.pdf',
      contentDisposition: 'inline; filename="FAST_123.pdf"',
      responseStatus: 200,
      responseContentType: 'application/pdf',
    }),
    closeChallenge: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe('FAST e-Invoice browser-backed adapter', () => {
  it('maps only the exact FAST solution tax code and keeps transport identity separate', () => {
    expect(presentationForSolutionTaxCode(FAST_MST)).toMatchObject({
      providerCode: 'tvan_fast',
      adapterCode: 'tvan_fast',
      domain: 'einvoice.fast.com.vn',
      confidence: 'high',
    });
    expect(presentationForSolutionTaxCode('0100727825-001')).toBeUndefined();

    const adapter = new FastEinvoiceTvanAdapter(successGateway());
    const registry = new TvanRegistry([adapter]);
    expect(registry.resolve(fastDocument())?.providerCode).toBe('tvan_fast');

    const other = fastDocument({
      providers: {
        solution: { taxCode: '0109999999' },
        transport: { taxCode: FAST_MST, code: 'tvan_transport' },
      },
      rawSummary: { msttcgp: '0109999999', tvandnkntt: FAST_MST },
    });
    expect(registry.resolve(other)).toBeUndefined();
  });

  it('extracts only TTKhac.KeySearch from GDT XML', () => {
    const xml = Buffer.from(
      '<HDon><DLHDon><TTKhac>'
      + '<TTin><TTruong>MCCQT</TTruong><DLieu>DO-NOT-USE</DLieu></TTin>'
      + '<TTin><TTruong>KeySearch</TTruong><DLieu>XML-FAST-KEY</DLieu></TTin>'
      + '</TTKhac></DLHDon></HDon>',
    );
    expect(fastKeySearchFromXml(xml)).toBe('XML-FAST-KEY');
  });

  it('creates CAPTCHA, preserves case, downloads PDF during verify and reuses only verified PDF cache', async () => {
    const gateway = successGateway();
    const adapter = new FastEinvoiceTvanAdapter(gateway);
    const context = adapterContext();
    const invoice = fastDocument();

    const prepared = await adapter.getCaptchaChallenge(invoice, context);
    expect(prepared.challenge).toMatchObject({
      providerCode: 'tvan_fast',
      kind: 'text',
      imageMimeType: 'image/png',
    });
    expect(gateway.createChallenge).toHaveBeenCalledWith(expect.objectContaining({
      documentKey: invoice.key,
      keySearch: KEYSEARCH,
    }));

    await adapter.verifyCaptcha(invoice, prepared.challenge, prepared.privateState, 'aB3', context);
    expect(gateway.verifyAndDownload).toHaveBeenCalledWith(expect.objectContaining({
      captcha: 'aB3',
      expectedInvoiceNo: '123',
    }));
    expect(adapter.artifactStatus(invoice, context)).toMatchObject({
      stage: 'pdf_ready',
      canView: true,
      canDownloadPdf: true,
      canDownloadOriginal: false,
    });

    const first = await adapter.downloadPdf(invoice, context);
    const second = await adapter.downloadPdf(invoice, context);
    expect(first.content.equals(PDF)).toBe(true);
    expect(second.fileName).toBe('FAST_123.pdf');
    expect(gateway.verifyAndDownload).toHaveBeenCalledTimes(1);
  });

  it('loads KeySearch from GDT XML when the dataset does not contain it', async () => {
    const gateway = successGateway();
    const adapter = new FastEinvoiceTvanAdapter(gateway);
    const loadInvoiceXml = vi.fn().mockResolvedValue(Buffer.from(
      '<HDon><DLHDon><TTKhac><TTin><TTruong>KeySearch</TTruong><DLieu>XML-KEY</DLieu></TTin></TTKhac></DLHDon></HDon>',
    ));
    const invoice = fastDocument({
      lookup: undefined,
      rawSummary: { msttcgp: FAST_MST },
    });
    await adapter.getCaptchaChallenge(invoice, adapterContext(loadInvoiceXml));
    expect(loadInvoiceXml).toHaveBeenCalledOnce();
    expect(gateway.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ keySearch: 'XML-KEY' }));
  });

  it('clears verified state and closes the challenge when verification fails', async () => {
    const gateway = successGateway();
    gateway.verifyAndDownload.mockRejectedValueOnce(
      new AppError('TVAN_FAST_CAPTCHA_INVALID', 'invalid captcha', 422, true),
    );
    const adapter = new FastEinvoiceTvanAdapter(gateway);
    const context = adapterContext();
    const invoice = fastDocument();
    const prepared = await adapter.getCaptchaChallenge(invoice, context);

    await expect(adapter.verifyCaptcha(invoice, prepared.challenge, prepared.privateState, 'bad', context))
      .rejects.toMatchObject({ code: 'TVAN_FAST_CAPTCHA_INVALID' });
    expect(gateway.closeChallenge).toHaveBeenCalledWith(prepared.challenge.id);
    await expect(adapter.downloadPdf(invoice, context))
      .rejects.toMatchObject({ code: 'TVAN_FAST_CAPTCHA_REQUIRED' });
  });

  it('makes failed FAST challenges single-use in TvanPdfService without changing generic service semantics', async () => {
    const gateway = successGateway();
    gateway.verifyAndDownload.mockRejectedValue(
      new AppError('TVAN_FAST_CAPTCHA_INVALID', 'invalid captcha', 422, true),
    );
    const adapter = new FastEinvoiceTvanAdapter(gateway);
    const registry = new TvanRegistry([adapter]);
    const settings = {
      getConfig: () => ({ network: { requestTimeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024 } }),
    } as any;
    const service = new TvanPdfService(settings, { registry });
    const prepared = await service.prepareView(fastDocument());
    const challengeId = prepared.challenge?.id;
    expect(challengeId).toBeTruthy();

    await expect(service.verifyCaptcha(challengeId!, 'bad'))
      .rejects.toMatchObject({ code: 'TVAN_FAST_CAPTCHA_INVALID' });
    await expect(service.verifyCaptcha(challengeId!, 'bad'))
      .rejects.toMatchObject({ code: 'TVAN_CAPTCHA_NOT_FOUND' });
    await service.dispose();
  });

  it('closes the previous FAST browser challenge before refresh and when a waiting batch is deleted', async () => {
    const gateway = successGateway();
    const adapter = new FastEinvoiceTvanAdapter(gateway);
    const registry = new TvanRegistry([adapter]);
    const settings = {
      getConfig: () => ({ network: { requestTimeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024 } }),
    } as any;
    const service = new TvanPdfService(settings, { registry });
    const invoice = fastDocument();

    const first = await service.prepareView(invoice);
    await service.prepareView(invoice);
    expect(gateway.closeChallenge).toHaveBeenCalledWith(first.challenge?.id);

    gateway.closeChallenge.mockClear();
    const batch = await service.startBatch([invoice]);
    expect(batch.status).toBe('waiting_captcha');
    expect(batch.challenge?.id).toBeTruthy();
    await service.deleteBatch(batch.id);
    expect(gateway.closeChallenge).toHaveBeenCalledWith(batch.challenge?.id);

    await service.dispose();
  });
});

describe('FAST browser context lifecycle', () => {
  function fakeBrowser() {
    const contexts: Array<{ close: ReturnType<typeof vi.fn>; page: any }> = [];
    const newContext = vi.fn(async () => {
      let closed = false;
      const page = {
        setDefaultTimeout: vi.fn(),
        setDefaultNavigationTimeout: vi.fn(),
        route: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        isClosed: vi.fn(() => closed),
        evaluate: vi.fn(async (_fn: unknown, input: any) => {
          const url = String(input.url || '');
          if (url.endsWith('/index.aspx/GetData')) {
            return {
              status: 200,
              ok: true,
              contentType: 'application/json',
              declaredBytes: 0,
              actualBytes: 64,
              text: JSON.stringify({ d: PNG.toString('base64') }),
            };
          }
          const parsed = new URL(url);
          if (parsed.searchParams.get('t') === '2') {
            expect(Buffer.from(parsed.searchParams.get('p') || '', 'base64').toString('utf8')).toBe(KEYSEARCH);
            expect(parsed.searchParams.get('c')).toBe('aB3');
            return {
              status: 200,
              ok: true,
              contentType: 'application/json',
              declaredBytes: 0,
              actualBytes: 80,
              text: JSON.stringify([{ error: '1', invoice: '123', fileName: 'server/FAST_123.pdf' }]),
            };
          }
          if (parsed.searchParams.get('t') === '4') {
            expect(parsed.searchParams.get('c')).toBe('aB3');
            expect(parsed.searchParams.get('n')).toBe('123');
            return {
              status: 200,
              ok: true,
              contentType: 'application/pdf',
              contentDisposition: 'inline; filename="FAST_123.pdf"',
              declaredBytes: PDF.length,
              actualBytes: PDF.length,
              tooLarge: false,
              bodyBase64: PDF.toString('base64'),
            };
          }
          throw new Error('Unexpected browser evaluate URL: ' + url);
        }),
      };
      const close = vi.fn(async () => { closed = true; });
      const context = { newPage: vi.fn().mockResolvedValue(page), close };
      contexts.push({ close, page });
      return context as any;
    });
    return {
      instance: { newContext, on: vi.fn() } as unknown as Browser,
      contexts,
      newContext,
    };
  }

  it('refresh closes the previous document context and verify consumes the replacement context', async () => {
    const browser = fakeBrowser();
    const manager = new FastBrowserSessionManager(async () => browser.instance, 2);
    const first = await manager.createChallenge({
      documentKey: 'doc-1',
      keySearch: KEYSEARCH,
      timeoutMs: 5_000,
      maxDownloadBytes: 2 * 1024 * 1024,
    });
    const second = await manager.createChallenge({
      documentKey: 'doc-1',
      keySearch: KEYSEARCH,
      timeoutMs: 5_000,
      maxDownloadBytes: 2 * 1024 * 1024,
    });
    expect(first.challengeId).not.toBe(second.challengeId);
    expect(browser.contexts[0].close).toHaveBeenCalledOnce();

    const result = await manager.verifyAndDownload({
      challengeId: second.challengeId,
      documentKey: 'doc-1',
      captcha: 'aB3',
      expectedInvoiceNo: 123,
      maxDownloadBytes: 2 * 1024 * 1024,
    });
    expect(result.content.equals(PDF)).toBe(true);
    expect(browser.contexts[1].close).toHaveBeenCalledOnce();
    await expect(manager.verifyAndDownload({
      challengeId: second.challengeId,
      documentKey: 'doc-1',
      captcha: 'aB3',
      expectedInvoiceNo: 123,
      maxDownloadBytes: 2 * 1024 * 1024,
    })).rejects.toMatchObject({ code: 'TVAN_FAST_CHALLENGE_MISMATCH' });
    await manager.dispose();
  });

  it('enforces the global FAST browser-context cap and releases slots on dispose', async () => {
    const browser = fakeBrowser();
    const manager = new FastBrowserSessionManager(async () => browser.instance, 1);
    await manager.createChallenge({
      documentKey: 'doc-1',
      keySearch: KEYSEARCH,
      timeoutMs: 5_000,
      maxDownloadBytes: 2 * 1024 * 1024,
    });
    await expect(manager.createChallenge({
      documentKey: 'doc-2',
      keySearch: KEYSEARCH + '-2',
      timeoutMs: 5_000,
      maxDownloadBytes: 2 * 1024 * 1024,
    })).rejects.toMatchObject({ code: 'TVAN_FAST_BROWSER_BUSY' });
    await manager.dispose();
    expect(browser.contexts[0].close).toHaveBeenCalledOnce();
  });
});
