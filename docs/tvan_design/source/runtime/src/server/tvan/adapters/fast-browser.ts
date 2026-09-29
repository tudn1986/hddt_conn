import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { FAST_DOMAIN } from '../../../shared/provider-resolution.js';
import { AppError, generateId, isRecord, safeString } from '../../../shared/utils/index.js';

const FAST_ORIGIN = 'https://' + FAST_DOMAIN;
const FAST_HANDLER_PATH = '/AppHandler/EInvoiceQuery.ashx';
const FAST_CAPTCHA_PATH = '/index.aspx/GetData';
const CAPTCHA_MAX_BYTES = 512 * 1024;
export const FAST_CHALLENGE_TTL_MS = 5 * 60_000;

let sharedBrowserPromise: Promise<Browser> | undefined;
let activeFastContexts = 0;

function configuredFastContextLimit(): number {
  const raw = Number(process.env.HDDT_FAST_MAX_CONTEXTS || 4);
  return Number.isFinite(raw) ? Math.max(1, Math.min(8, Math.floor(raw))) : 4;
}

function chromiumExecutable(): string {
  const configured = process.env.HDDT_CHROMIUM_EXECUTABLE?.trim();
  const programFiles = process.env.PROGRAMFILES;
  const programFilesX86 = process.env['PROGRAMFILES(X86)'];
  const localAppData = process.env.LOCALAPPDATA;
  const home = process.env.HOME;
  const candidates = [
    configured,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    programFiles && path.join(programFiles, 'Google/Chrome/Application/chrome.exe'),
    programFiles && path.join(programFiles, 'Microsoft/Edge/Application/msedge.exe'),
    programFilesX86 && path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe'),
    programFilesX86 && path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'),
    localAppData && path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),
    home && path.join(home, '.local/bin/chromium'),
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find((value) => fs.existsSync(value));
  if (!found) {
    throw new AppError(
      'TVAN_FAST_BROWSER_UNAVAILABLE',
      'Không tìm thấy Chromium/Chrome/Edge để mở phiên FAST e-Invoice.',
      503,
      true,
    );
  }
  return found;
}

async function sharedBrowser(): Promise<Browser> {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = chromium.launch({
      executablePath: chromiumExecutable(),
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    }).then((instance) => {
      instance.on('disconnected', () => {
        sharedBrowserPromise = undefined;
      });
      return instance;
    }).catch((error: unknown) => {
      sharedBrowserPromise = undefined;
      throw new AppError(
        'TVAN_FAST_BROWSER_UNAVAILABLE',
        error instanceof Error
          ? 'Không khởi tạo được Chromium cho FAST e-Invoice: ' + error.message
          : 'Không khởi tạo được Chromium cho FAST e-Invoice.',
        503,
        true,
      );
    });
  }
  return sharedBrowserPromise;
}

function acquireContextSlot(limit: number): () => void {
  if (activeFastContexts >= limit) {
    throw new AppError(
      'TVAN_FAST_BROWSER_BUSY',
      'FAST e-Invoice đang có quá nhiều phiên CAPTCHA đang mở. Hãy thử lại sau khi hoàn tất phiên hiện tại.',
      503,
      true,
      1500,
    );
  }
  activeFastContexts += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeFastContexts = Math.max(0, activeFastContexts - 1);
  };
}

function isAllowedFastUrl(raw: string): boolean {
  if (/^(?:data:|blob:|about:)/i.test(raw)) return true;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname.toLocaleLowerCase() === FAST_DOMAIN;
  } catch {
    return false;
  }
}

function pngBase64(value: unknown, maxDownloadBytes: number): string {
  const text = safeString(value);
  if (!text) {
    throw new AppError('TVAN_FAST_CAPTCHA_IMAGE_INVALID', 'FAST không trả ảnh CAPTCHA.', 502, true);
  }
  const raw = text.replace(/^data:image\/png;base64,/i, '');
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, 'base64');
  } catch {
    throw new AppError('TVAN_FAST_CAPTCHA_IMAGE_INVALID', 'CAPTCHA FAST không phải base64 hợp lệ.', 502, true);
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (
    bytes.length < pngSignature.length
    || bytes.length > Math.min(CAPTCHA_MAX_BYTES, maxDownloadBytes)
    || !bytes.subarray(0, pngSignature.length).equals(pngSignature)
  ) {
    throw new AppError('TVAN_FAST_CAPTCHA_IMAGE_INVALID', 'FAST không trả ảnh CAPTCHA PNG hợp lệ.', 502, true);
  }
  return raw;
}

type BrowserFetchTextResult = {
  status: number;
  ok: boolean;
  contentType: string;
  declaredBytes: number;
  actualBytes: number;
  text: string;
};

async function browserFetchText(
  page: Page,
  url: string,
  method: 'GET' | 'POST',
  maxBytes: number,
  body?: string,
): Promise<BrowserFetchTextResult> {
  return page.evaluate(async (input) => {
    const response = await fetch(input.url, {
      method: input.method,
      credentials: 'include',
      cache: 'no-store',
      headers: input.body === undefined
        ? { Accept: 'application/json, text/javascript, */*; q=0.01' }
        : { Accept: 'application/json, text/javascript, */*; q=0.01', 'Content-Type': 'application/json; charset=utf-8' },
      body: input.body,
    });
    const declaredBytes = Number(response.headers.get('content-length') || 0);
    if (declaredBytes > input.maxBytes) {
      return {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type') || '',
        declaredBytes,
        actualBytes: declaredBytes,
        text: '',
      };
    }
    const text = await response.text();
    const actualBytes = new TextEncoder().encode(text).byteLength;
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type') || '',
      declaredBytes,
      actualBytes,
      text,
    };
  }, { url, method, maxBytes, body });
}

type BrowserFetchBinaryResult = {
  status: number;
  ok: boolean;
  contentType: string;
  contentDisposition: string;
  declaredBytes: number;
  actualBytes: number;
  tooLarge: boolean;
  bodyBase64: string;
};

async function browserFetchBinary(page: Page, url: string, maxBytes: number): Promise<BrowserFetchBinaryResult> {
  return page.evaluate(async (input) => {
    const response = await fetch(input.url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/pdf,application/octet-stream,*/*' },
    });
    const declaredBytes = Number(response.headers.get('content-length') || 0);
    if (declaredBytes > input.maxBytes) {
      return {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type') || '',
        contentDisposition: response.headers.get('content-disposition') || '',
        declaredBytes,
        actualBytes: declaredBytes,
        tooLarge: true,
        bodyBase64: '',
      };
    }

    const chunks: Uint8Array[] = [];
    let actualBytes = 0;
    const reader = response.body?.getReader();
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          actualBytes += value.byteLength;
          if (actualBytes > input.maxBytes) {
            await reader.cancel();
            return {
              status: response.status,
              ok: response.ok,
              contentType: response.headers.get('content-type') || '',
              contentDisposition: response.headers.get('content-disposition') || '',
              declaredBytes,
              actualBytes,
              tooLarge: true,
              bodyBase64: '',
            };
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    const bytes = new Uint8Array(actualBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let binary = '';
    const step = 0x8000;
    for (let index = 0; index < bytes.length; index += step) {
      binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + step)));
    }
    return {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type') || '',
      contentDisposition: response.headers.get('content-disposition') || '',
      declaredBytes,
      actualBytes,
      tooLarge: false,
      bodyBase64: btoa(binary),
    };
  }, { url, maxBytes });
}

function parseLookupResponse(text: string): { invoice: string; fileName: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AppError('TVAN_FAST_PROVIDER_CHANGED', 'FAST trả response t=2 không phải JSON hợp lệ.', 502, true);
  }
  if (!Array.isArray(payload) || !isRecord(payload[0])) {
    throw new AppError('TVAN_FAST_PROVIDER_CHANGED', 'FAST thay đổi schema response t=2.', 502, true);
  }
  const record = payload[0];
  if (safeString(record.error) !== '1') {
    throw new AppError('TVAN_FAST_CAPTCHA_INVALID', 'FAST không chấp nhận CAPTCHA hoặc mã tra cứu.', 422, true);
  }
  const invoice = safeString(record.invoice);
  const fileName = safeString(record.fileName);
  if (!invoice || !fileName) {
    throw new AppError('TVAN_FAST_PROVIDER_CHANGED', 'FAST thiếu invoice/fileName sau khi xác thực CAPTCHA.', 502, true);
  }
  return { invoice, fileName };
}

function canonicalInvoiceNo(value: unknown): string {
  const text = String(value ?? '').normalize('NFKC').trim();
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text.toLocaleUpperCase('vi-VN');
}

type FastBrowserSession = {
  challengeId: string;
  documentKey: string;
  keySearch: string;
  context: BrowserContext;
  page: Page;
  expiresAt: number;
  expiryTimer: NodeJS.Timeout;
  releaseSlot: () => void;
};

export interface FastBrowserChallenge {
  challengeId: string;
  imageBase64: string;
  imageMimeType: 'image/png';
  expiresAt: number;
}

export interface FastBrowserPdfResult {
  content: Buffer;
  invoice: string;
  fileName: string;
  contentDisposition?: string;
  responseStatus: number;
  responseContentType?: string;
}

export interface FastBrowserGateway {
  createChallenge(input: {
    documentKey: string;
    keySearch: string;
    timeoutMs: number;
    maxDownloadBytes: number;
  }): Promise<FastBrowserChallenge>;
  verifyAndDownload(input: {
    challengeId: string;
    documentKey: string;
    captcha: string;
    expectedInvoiceNo: string | number;
    maxDownloadBytes: number;
  }): Promise<FastBrowserPdfResult>;
  closeChallenge(challengeId: string): Promise<void>;
  closeDocument(documentKey: string): Promise<void>;
  dispose(): Promise<void>;
}

export class FastBrowserSessionManager implements FastBrowserGateway {
  private readonly sessions = new Map<string, FastBrowserSession>();
  private readonly byDocument = new Map<string, string>();

  constructor(
    private readonly browserProvider: () => Promise<Browser> = sharedBrowser,
    private readonly contextLimit = configuredFastContextLimit(),
  ) {}

  private async closeSession(session: FastBrowserSession): Promise<void> {
    this.sessions.delete(session.challengeId);
    if (this.byDocument.get(session.documentKey) === session.challengeId) {
      this.byDocument.delete(session.documentKey);
    }
    clearTimeout(session.expiryTimer);
    await session.context.close().catch(() => undefined);
    session.releaseSlot();
  }

  async closeChallenge(challengeId: string): Promise<void> {
    const session = this.sessions.get(challengeId);
    if (session) await this.closeSession(session);
  }

  async closeDocument(documentKey: string): Promise<void> {
    const challengeId = this.byDocument.get(documentKey);
    if (challengeId) await this.closeChallenge(challengeId);
  }

  async createChallenge(input: {
    documentKey: string;
    keySearch: string;
    timeoutMs: number;
    maxDownloadBytes: number;
  }): Promise<FastBrowserChallenge> {
    await this.closeDocument(input.documentKey);
    const releaseSlot = acquireContextSlot(this.contextLimit);
    let context: BrowserContext | undefined;
    try {
      const browser = await this.browserProvider();
      context = await browser.newContext({
        locale: 'vi-VN',
        javaScriptEnabled: true,
      });
      const page = await context.newPage();
      const timeoutMs = Math.max(1_000, input.timeoutMs);
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);
      await page.route('**/*', async (route) => {
        if (isAllowedFastUrl(route.request().url())) await route.continue();
        else await route.abort('blockedbyclient');
      });

      const bootstrapUrl = FAST_ORIGIN + '/index.aspx?c=' + encodeURIComponent(input.keySearch);
      try {
        const navigation = await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        if (navigation && !navigation.ok()) {
          throw new Error('HTTP ' + navigation.status());
        }
        await page.waitForLoadState('networkidle', { timeout: Math.min(5_000, timeoutMs) }).catch(() => undefined);
      } catch (error) {
        throw new AppError(
          'TVAN_FAST_BROWSER_BOOTSTRAP_FAILED',
          error instanceof Error
            ? 'Không mở được portal FAST e-Invoice: ' + error.message
            : 'Không mở được portal FAST e-Invoice.',
          502,
          true,
        );
      }

      const captchaResponse = await browserFetchText(
        page,
        FAST_ORIGIN + FAST_CAPTCHA_PATH,
        'POST',
        Math.min(input.maxDownloadBytes, 1024 * 1024),
        '{}',
      );
      if (
        captchaResponse.declaredBytes > input.maxDownloadBytes
        || captchaResponse.actualBytes > input.maxDownloadBytes
      ) {
        throw new AppError('TVAN_RESPONSE_TOO_LARGE', 'CAPTCHA FAST vượt giới hạn dung lượng.', 502);
      }
      if (!captchaResponse.ok) {
        throw new AppError(
          'TVAN_FAST_CAPTCHA_HTTP_ERROR',
          'FAST trả HTTP ' + captchaResponse.status + ' khi lấy CAPTCHA.',
          502,
          captchaResponse.status >= 500,
        );
      }
      let payload: unknown;
      try {
        payload = JSON.parse(captchaResponse.text);
      } catch {
        throw new AppError('TVAN_FAST_CAPTCHA_IMAGE_INVALID', 'FAST trả CAPTCHA JSON không hợp lệ.', 502, true);
      }
      const imageBase64 = pngBase64(isRecord(payload) ? payload.d : undefined, input.maxDownloadBytes);
      const challengeId = generateId();
      const expiresAt = Date.now() + FAST_CHALLENGE_TTL_MS;
      const expiryTimer = setTimeout(() => void this.closeChallenge(challengeId), FAST_CHALLENGE_TTL_MS);
      expiryTimer.unref?.();
      const session: FastBrowserSession = {
        challengeId,
        documentKey: input.documentKey,
        keySearch: input.keySearch,
        context,
        page,
        expiresAt,
        expiryTimer,
        releaseSlot,
      };
      this.sessions.set(challengeId, session);
      this.byDocument.set(input.documentKey, challengeId);
      return { challengeId, imageBase64, imageMimeType: 'image/png', expiresAt };
    } catch (error) {
      await context?.close().catch(() => undefined);
      releaseSlot();
      throw error;
    }
  }

  async verifyAndDownload(input: {
    challengeId: string;
    documentKey: string;
    captcha: string;
    expectedInvoiceNo: string | number;
    maxDownloadBytes: number;
  }): Promise<FastBrowserPdfResult> {
    const session = this.sessions.get(input.challengeId);
    if (!session || session.documentKey !== input.documentKey) {
      throw new AppError('TVAN_FAST_CHALLENGE_MISMATCH', 'CAPTCHA FAST không thuộc hóa đơn hiện tại.', 409);
    }
    if (session.expiresAt <= Date.now() || session.page.isClosed()) {
      await this.closeSession(session);
      throw new AppError('TVAN_FAST_SESSION_EXPIRED', 'Phiên browser FAST đã hết hạn.', 410, true);
    }

    try {
      const searchUrl = new URL(FAST_ORIGIN + FAST_HANDLER_PATH);
      searchUrl.searchParams.set('p', Buffer.from(session.keySearch, 'utf8').toString('base64'));
      searchUrl.searchParams.set('t', '2');
      searchUrl.searchParams.set('c', input.captcha);
      searchUrl.searchParams.set('r', String(Date.now()));

      const searched = await browserFetchText(session.page, searchUrl.toString(), 'POST', input.maxDownloadBytes);
      if (searched.declaredBytes > input.maxDownloadBytes || searched.actualBytes > input.maxDownloadBytes) {
        throw new AppError('TVAN_RESPONSE_TOO_LARGE', 'Response t=2 FAST vượt giới hạn dung lượng.', 502);
      }
      if (!searched.ok) {
        throw new AppError(
          'TVAN_FAST_CAPTCHA_HTTP_ERROR',
          'FAST trả HTTP ' + searched.status + ' khi xác thực CAPTCHA.',
          502,
          searched.status >= 500,
        );
      }
      const descriptor = parseLookupResponse(searched.text);
      if (canonicalInvoiceNo(descriptor.invoice) !== canonicalInvoiceNo(input.expectedInvoiceNo)) {
        throw new AppError('TVAN_FAST_INVOICE_MISMATCH', 'FAST trả về số hóa đơn khác hóa đơn đang mở.', 409);
      }

      const pdfUrl = new URL(FAST_ORIGIN + FAST_HANDLER_PATH);
      pdfUrl.searchParams.set('p', Buffer.from(descriptor.fileName, 'utf8').toString('base64'));
      pdfUrl.searchParams.set('t', '4');
      pdfUrl.searchParams.set('c', input.captcha);
      pdfUrl.searchParams.set('n', descriptor.invoice);
      pdfUrl.searchParams.set('r', String(Date.now()));

      const downloaded = await browserFetchBinary(session.page, pdfUrl.toString(), input.maxDownloadBytes);
      if (downloaded.tooLarge) {
        throw new AppError('TVAN_RESPONSE_TOO_LARGE', 'PDF FAST vượt giới hạn dung lượng.', 502);
      }
      if (!downloaded.ok) {
        throw new AppError(
          'TVAN_FAST_PDF_HTTP_ERROR',
          'FAST trả HTTP ' + downloaded.status + ' khi tải PDF.',
          502,
          downloaded.status >= 500,
        );
      }
      return {
        content: Buffer.from(downloaded.bodyBase64, 'base64'),
        invoice: descriptor.invoice,
        fileName: descriptor.fileName,
        contentDisposition: downloaded.contentDisposition || undefined,
        responseStatus: downloaded.status,
        responseContentType: downloaded.contentType || undefined,
      };
    } finally {
      // FAST CAPTCHA is single-use. Never retain/reuse the context after any verification attempt.
      await this.closeSession(session);
    }
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()];
    await Promise.allSettled(sessions.map((session) => this.closeSession(session)));
    this.sessions.clear();
    this.byDocument.clear();
  }
}
