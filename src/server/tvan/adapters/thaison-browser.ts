import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { AppError, generateId, safeString } from '../../../shared/utils/index.js';

const CAPTCHA_MAX_BYTES = 512 * 1024;
export const THAISON_CHALLENGE_TTL_MS = 5 * 60_000;

let sharedBrowserPromise: Promise<Browser> | undefined;
let activeContexts = 0;

function configuredContextLimit(): number {
  const raw = Number(process.env.HDDT_THAISON_MAX_CONTEXTS || 2);
  return Number.isFinite(raw) ? Math.max(1, Math.min(6, Math.floor(raw))) : 2;
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
      'TVAN_THAISON_BROWSER_UNAVAILABLE',
      'Không tìm thấy Chromium/Chrome/Edge để mở phiên Thái Sơn eInvoice.',
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
        'TVAN_THAISON_BROWSER_UNAVAILABLE',
        error instanceof Error
          ? 'Không khởi tạo được Chromium cho Thái Sơn eInvoice: ' + error.message
          : 'Không khởi tạo được Chromium cho Thái Sơn eInvoice.',
        503,
        true,
      );
    });
  }
  return sharedBrowserPromise;
}

async function closeContextBounded(context: BrowserContext): Promise<void> {
  await Promise.race([
    context.close().catch(() => undefined),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      timer.unref?.();
    }),
  ]);
}

function acquireContextSlot(limit: number): () => void {
  if (activeContexts >= limit) {
    throw new AppError(
      'TVAN_THAISON_BROWSER_BUSY',
      'Thái Sơn eInvoice đang có quá nhiều phiên CAPTCHA đang mở. Hãy hoàn tất phiên hiện tại rồi thử lại.',
      503,
      true,
      1500,
    );
  }
  activeContexts += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeContexts = Math.max(0, activeContexts - 1);
  };
}

function trustedPortalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLocaleLowerCase('vi-VN');
    return url.protocol === 'https:'
      && (host === 'einvoice.vn' || host === 'www.einvoice.vn');
  } catch {
    return false;
  }
}

function isAllowedUrl(raw: string, origin: string): boolean {
  if (/^(?:data:|blob:|about:)/i.test(raw)) return true;
  try {
    const url = new URL(raw);
    return trustedPortalOrigin(origin) && url.protocol === 'https:' && url.origin === origin;
  } catch {
    return false;
  }
}

type BrowserNavigationTextResult = {
  status: number;
  ok: boolean;
  contentType: string;
  declaredBytes: number;
  actualBytes: number;
  text: string;
};

async function browserSubmitLookupNavigation(
  page: Page,
  url: string,
  lookupCode: string,
  captchaToken: string,
  captcha: string,
  maxBytes: number,
): Promise<BrowserNavigationTextResult> {
  const navigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await page.evaluate((input) => {
    const lookup = document.querySelector<HTMLInputElement>('input[name="MaNhanHoaDon"]');
    const form = lookup?.closest('form');
    const token = form?.querySelector<HTMLInputElement>('input[name="CaptchaDeText"]');
    const captchaInput = form?.querySelector<HTMLInputElement>('input[name="CaptchaInputText"]');
    if (!lookup || !form || !token || !captchaInput) {
      throw new Error('Lookup form fields are missing.');
    }
    const expected = new URL(input.url);
    const action = new URL(form.getAttribute('action') || location.href, location.href);
    if (action.origin !== expected.origin || action.pathname.replace(/\/+$/, '') !== expected.pathname.replace(/\/+$/, '')) {
      throw new Error('Lookup form action does not match the active portal.');
    }
    lookup.value = input.lookupCode;
    token.value = input.captchaToken;
    captchaInput.value = input.captcha;
    HTMLFormElement.prototype.submit.call(form);
  }, { url, lookupCode, captchaToken, captcha });

  const response = await navigationPromise;
  if (!response) {
    throw new AppError('TVAN_THAISON_CAPTCHA_HTTP_ERROR', 'Không nhận được navigation response khi xác thực CAPTCHA Thái Sơn.', 502, true);
  }
  const headers = response.headers();
  const declaredBytes = Number(headers['content-length'] || 0);
  if (declaredBytes > maxBytes) {
    return {
      status: response.status(),
      ok: response.ok(),
      contentType: headers['content-type'] || '',
      declaredBytes,
      actualBytes: declaredBytes,
      text: '',
    };
  }
  const text = await page.content();
  const actualBytes = Buffer.byteLength(text, 'utf8');
  return {
    status: response.status(),
    ok: response.ok(),
    contentType: headers['content-type'] || '',
    declaredBytes,
    actualBytes,
    text: actualBytes <= maxBytes ? text : '',
  };
}

type BrowserNavigationBinaryResult = {
  status: number;
  ok: boolean;
  contentType: string;
  contentDisposition: string;
  declaredBytes: number;
  actualBytes: number;
  tooLarge: boolean;
  content: Buffer;
};

type CdpHeader = { name: string; value: string };

function cdpHeaderValue(headers: CdpHeader[] | undefined, name: string): string {
  const expected = name.toLocaleLowerCase('en-US');
  return headers?.find((header) => header.name.toLocaleLowerCase('en-US') === expected)?.value || '';
}

async function browserLoadPdfInFrame(
  page: Page,
  url: string,
  maxBytes: number,
): Promise<BrowserNavigationBinaryResult> {
  const expected = new URL(url);
  const current = new URL(page.url());
  if (expected.origin !== current.origin) {
    throw new AppError('TVAN_THAISON_PDF_HTTP_ERROR', 'URL PDF Thái Sơn rời khỏi portal hiện tại.', 502);
  }

  const cdp = await page.context().newCDPSession(page);
  let trackedUrl = expected.toString();
  let settled = false;
  let timeout: NodeJS.Timeout | undefined;
  let pausedHandler: ((event: any) => Promise<void>) | undefined;

  const capture = new Promise<BrowserNavigationBinaryResult>((resolve, reject) => {
    const finish = (result: BrowserNavigationBinaryResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    pausedHandler = async (event: any): Promise<void> => {
      const requestUrl = safeString(event?.request?.url);
      const status = Number(event?.responseStatusCode || 0);
      const headers = (event?.responseHeaders || []) as CdpHeader[];
      if (!requestUrl || !status) {
        await cdp.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => undefined);
        return;
      }

      let normalizedUrl: string;
      try {
        normalizedUrl = new URL(requestUrl).toString();
      } catch {
        await cdp.send('Fetch.continueResponse', { requestId: event.requestId }).catch(() => undefined);
        return;
      }
      if (normalizedUrl !== trackedUrl) {
        await cdp.send('Fetch.continueResponse', { requestId: event.requestId }).catch(() => undefined);
        return;
      }

      if (status >= 300 && status < 400) {
        const location = cdpHeaderValue(headers, 'location');
        if (!location) {
          await cdp.send('Fetch.continueResponse', { requestId: event.requestId }).catch(() => undefined);
          fail(new AppError('TVAN_THAISON_PDF_HTTP_ERROR', 'Thái Sơn chuyển hướng PDF nhưng không có Location.', 502, true));
          return;
        }
        const redirected = new URL(location, normalizedUrl);
        if (redirected.origin !== expected.origin) {
          await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => undefined);
          fail(new AppError('TVAN_THAISON_PDF_HTTP_ERROR', 'Thái Sơn chuyển hướng PDF ra ngoài portal hiện tại.', 502));
          return;
        }
        trackedUrl = redirected.toString();
        await cdp.send('Fetch.continueResponse', { requestId: event.requestId }).catch(() => undefined);
        return;
      }

      const contentType = cdpHeaderValue(headers, 'content-type');
      const contentDisposition = cdpHeaderValue(headers, 'content-disposition');
      const declaredBytes = Number(cdpHeaderValue(headers, 'content-length') || 0);
      const base = {
        status,
        ok: status >= 200 && status < 300,
        contentType,
        contentDisposition,
        declaredBytes,
      };

      if (declaredBytes > maxBytes) {
        await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Aborted' }).catch(() => undefined);
        finish({ ...base, actualBytes: declaredBytes, tooLarge: true, content: Buffer.alloc(0) });
        return;
      }

      try {
        const streamResult = await cdp.send('Fetch.takeResponseBodyAsStream', { requestId: event.requestId });
        const handle = safeString(streamResult?.stream);
        if (!handle) throw new Error('Missing response stream handle.');

        const chunks: Buffer[] = [];
        let actualBytes = 0;
        let tooLarge = false;
        try {
          while (true) {
            const result = await cdp.send('IO.read', { handle, size: 64 * 1024 });
            const chunk = Buffer.from(
              String(result?.data || ''),
              result?.base64Encoded ? 'base64' : 'utf8',
            );
            actualBytes += chunk.length;
            if (actualBytes > maxBytes) {
              tooLarge = true;
              break;
            }
            chunks.push(chunk);
            if (result?.eof) break;
          }
        } finally {
          await cdp.send('IO.close', { handle }).catch(() => undefined);
        }

        if (tooLarge) {
          await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Aborted' }).catch(() => undefined);
          finish({ ...base, actualBytes, tooLarge: true, content: Buffer.alloc(0) });
          return;
        }

        const content = Buffer.concat(chunks);
        const responseHeaders = headers
          .filter((header) => !['content-length', 'transfer-encoding', 'content-encoding'].includes(header.name.toLocaleLowerCase('en-US')))
          .concat({ name: 'Content-Length', value: String(content.length) });
        await cdp.send('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: status,
          responseHeaders,
          body: content.toString('base64'),
        });
        finish({ ...base, actualBytes: content.length, tooLarge: false, content });
      } catch (error) {
        await cdp.send('Fetch.continueResponse', { requestId: event.requestId }).catch(() => undefined);
        fail(new AppError(
          'TVAN_THAISON_PDF_CAPTURE_FAILED',
          error instanceof Error
            ? 'Không lấy được raw PDF từ browser response Thái Sơn: ' + error.message
            : 'Không lấy được raw PDF từ browser response Thái Sơn.',
          502,
          true,
        ));
      }
    };
    cdp.on('Fetch.requestPaused', pausedHandler);
    timeout = setTimeout(() => {
      fail(new AppError(
        'TVAN_THAISON_PDF_NAVIGATION_TIMEOUT',
        'Hết thời gian chờ browser nhận PDF Thái Sơn.',
        504,
        true,
      ));
    }, 12_000);
    timeout.unref?.();
  });

  try {
    await cdp.send('Fetch.enable', {
      patterns: [{
        urlPattern: expected.origin + '/*',
        resourceType: 'Document',
        requestStage: 'Response',
      }],
    });
    await page.evaluate((pdfUrl) => {
      document.getElementById('hddt-thaison-pdf-frame')?.remove();
      const iframe = document.createElement('iframe');
      iframe.id = 'hddt-thaison-pdf-frame';
      iframe.style.display = 'none';
      iframe.src = pdfUrl;
      document.body.appendChild(iframe);
    }, expected.toString());
    return await capture;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (pausedHandler) cdp.off('Fetch.requestPaused', pausedHandler);
    await cdp.send('Fetch.disable').catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }
}

function imageMime(bytes: Buffer, header: string): 'image/gif' | 'image/png' | 'image/jpeg' {
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return 'image/gif';
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length >= png.length && bytes.subarray(0, png.length).equals(png)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (/image\/(gif|png|jpeg)/i.test(header)) {
    throw new AppError('TVAN_THAISON_CAPTCHA_IMAGE_INVALID', 'Ảnh CAPTCHA Thái Sơn có Content-Type ảnh nhưng signature không hợp lệ.', 502, true);
  }
  throw new AppError('TVAN_THAISON_CAPTCHA_IMAGE_INVALID', 'Thái Sơn không trả ảnh CAPTCHA hợp lệ.', 502, true);
}

function decodeHtmlUrl(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&#x3D;/gi, '=').replace(/&#61;/gi, '=');
}

function pdfUrlsFromHtml(html: string, portalUrl: string, lookupCode: string): string[] {
  const origin = new URL(portalUrl).origin;
  const links = [
    ...[...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]),
    ...[...html.matchAll(/["'](\/tra-cuu\/xem-hoa-don\?[^"']+)["']/gi)].map((match) => match[1]),
    ...[...html.matchAll(/["'](\/tra-cuu\/tai-hoa-don-dien-tu\?[^"']+)["']/gi)].map((match) => match[1]),
  ].map(decodeHtmlUrl);
  const candidates: Array<{ url: string; priority: number }> = [];
  for (const raw of links) {
    let url: URL;
    try { url = new URL(raw, portalUrl); } catch { continue; }
    if (url.origin !== origin) continue;
    const path = url.pathname.toLocaleLowerCase('vi-VN');
    if (path === '/tra-cuu/xem-hoa-don') {
      const code = safeString(url.searchParams.get('code'));
      if (code !== lookupCode) continue;
      url.hash = '';
      candidates.push({ url: url.toString(), priority: 1 });
    } else if (path === '/tra-cuu/tai-hoa-don-dien-tu' && url.searchParams.get('format')?.toLocaleLowerCase() === 'pdf') {
      candidates.push({ url: url.toString(), priority: 2 });
    }
  }
  candidates.sort((a, b) => a.priority - b.priority);
  return [...new Set(candidates.map((candidate) => candidate.url))];
}

function isPdfMagic(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 5).equals(Buffer.from('%PDF-'));
}

type Session = {
  challengeId: string;
  documentKey: string;
  lookupCode: string;
  portalUrl: string;
  captchaToken: string;
  context: BrowserContext;
  page: Page;
  expiresAt: number;
  expiryTimer: NodeJS.Timeout;
  releaseSlot: () => void;
};

export interface ThaisonBrowserChallenge {
  challengeId: string;
  imageBase64: string;
  imageMimeType: string;
  expiresAt: number;
  portalUrl: string;
}

export interface ThaisonBrowserPdfResult {
  content: Buffer;
  contentDisposition?: string;
  responseStatus: number;
  responseContentType?: string;
  pdfUrl: string;
}

export interface ThaisonBrowserGateway {
  createChallenge(input: {
    documentKey: string;
    lookupCode: string;
    portalUrl: string;
    timeoutMs: number;
    maxDownloadBytes: number;
  }): Promise<ThaisonBrowserChallenge>;
  verifyAndDownload(input: {
    challengeId: string;
    documentKey: string;
    captcha: string;
    maxDownloadBytes: number;
  }): Promise<ThaisonBrowserPdfResult>;
  closeChallenge(challengeId: string): Promise<void>;
  closeDocument(documentKey: string): Promise<void>;
  dispose(): Promise<void>;
}

export class ThaisonBrowserSessionManager implements ThaisonBrowserGateway {
  private readonly sessions = new Map<string, Session>();
  private readonly byDocument = new Map<string, string>();

  constructor(
    private readonly browserProvider: () => Promise<Browser> = sharedBrowser,
    private readonly contextLimit = configuredContextLimit(),
  ) {}

  private async closeSession(session: Session): Promise<void> {
    this.sessions.delete(session.challengeId);
    if (this.byDocument.get(session.documentKey) === session.challengeId) this.byDocument.delete(session.documentKey);
    clearTimeout(session.expiryTimer);
    session.releaseSlot();
    await closeContextBounded(session.context);
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
    lookupCode: string;
    portalUrl: string;
    timeoutMs: number;
    maxDownloadBytes: number;
  }): Promise<ThaisonBrowserChallenge> {
    await this.closeDocument(input.documentKey);
    const releaseSlot = acquireContextSlot(this.contextLimit);
    let context: BrowserContext | undefined;
    try {
      const portal = new URL(input.portalUrl);
      if (!trustedPortalOrigin(portal.origin) || portal.pathname.replace(/\/+$/, '').toLocaleLowerCase('vi-VN') !== '/tra-cuu') {
        throw new AppError('TVAN_THAISON_PORTAL_INVALID', 'Portal Thái Sơn không thuộc allowlist hoặc sai đường dẫn tra cứu.', 422);
      }
      const browser = await this.browserProvider();
      context = await browser.newContext({ locale: 'vi-VN', javaScriptEnabled: true });
      context.once('close', releaseSlot);
      const page = await context.newPage();
      const timeoutMs = Math.max(1_000, input.timeoutMs);
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);
      await page.route('**/*', async (route) => {
        if (isAllowedUrl(route.request().url(), portal.origin)) await route.continue();
        else await route.abort('blockedbyclient');
      });

      let navigation;
      try {
        navigation = await page.goto(portal.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        if (navigation && !navigation.ok()) throw new Error('HTTP ' + navigation.status());
      } catch (error) {
        throw new AppError(
          'TVAN_THAISON_BROWSER_BOOTSTRAP_FAILED',
          error instanceof Error
            ? 'Không mở được portal Thái Sơn eInvoice: ' + error.message
            : 'Không mở được portal Thái Sơn eInvoice.',
          502,
          true,
        );
      }

      await page.waitForFunction(() => {
        const lookup = document.querySelector<HTMLInputElement>('input[name="MaNhanHoaDon"]');
        const form = lookup?.closest('form');
        const token = form?.querySelector<HTMLInputElement>('input[name="CaptchaDeText"]');
        const image = form?.querySelector<HTMLImageElement>('img#CaptchaImage');
        return Boolean(token?.value && image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
      });

      const captchaMeta = await page.evaluate(() => {
        const lookup = document.querySelector<HTMLInputElement>('input[name="MaNhanHoaDon"]');
        const form = lookup?.closest('form');
        const token = form?.querySelector<HTMLInputElement>('input[name="CaptchaDeText"]')?.value || '';
        const image = form?.querySelector<HTMLImageElement>('img#CaptchaImage');
        const src = image?.getAttribute('src') || '';
        if (!token || !image || !src || !image.naturalWidth || !image.naturalHeight) {
          return { token, src, imageDataUrl: '' };
        }
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context2d = canvas.getContext('2d');
        if (!context2d) return { token, src, imageDataUrl: '' };
        context2d.drawImage(image, 0, 0);
        return { token, src, imageDataUrl: canvas.toDataURL('image/png') };
      });
      if (!captchaMeta.token || !captchaMeta.src || !captchaMeta.imageDataUrl) {
        throw new AppError(
          'TVAN_THAISON_CAPTCHA_MARKUP_CHANGED',
          'Không tìm thấy CAPTCHA hợp lệ trong form tra cứu MaNhanHoaDon của portal Thái Sơn.',
          502,
          true,
        );
      }
      const captchaUrl = new URL(captchaMeta.src, portal);
      if (captchaUrl.origin !== portal.origin) {
        throw new AppError('TVAN_THAISON_CAPTCHA_IMAGE_INVALID', 'URL CAPTCHA Thái Sơn rời khỏi portal hiện tại.', 502);
      }
      const encoded = /^data:image\/png;base64,(.+)$/i.exec(captchaMeta.imageDataUrl)?.[1];
      if (!encoded) {
        throw new AppError('TVAN_THAISON_CAPTCHA_IMAGE_INVALID', 'Không chuyển được CAPTCHA Thái Sơn đã render sang PNG.', 502, true);
      }
      const imageBytes = Buffer.from(encoded, 'base64');
      if (imageBytes.length > Math.min(CAPTCHA_MAX_BYTES, input.maxDownloadBytes)) {
        throw new AppError('TVAN_RESPONSE_TOO_LARGE', 'Ảnh CAPTCHA Thái Sơn vượt giới hạn dung lượng.', 502);
      }
      const mime = imageMime(imageBytes, 'image/png');
      const challengeId = generateId();
      const expiresAt = Date.now() + THAISON_CHALLENGE_TTL_MS;
      const expiryTimer = setTimeout(() => void this.closeChallenge(challengeId), THAISON_CHALLENGE_TTL_MS);
      expiryTimer.unref?.();
      const session: Session = {
        challengeId,
        documentKey: input.documentKey,
        lookupCode: input.lookupCode,
        portalUrl: portal.toString(),
        captchaToken: captchaMeta.token,
        context,
        page,
        expiresAt,
        expiryTimer,
        releaseSlot,
      };
      this.sessions.set(challengeId, session);
      this.byDocument.set(input.documentKey, challengeId);
      return {
        challengeId,
        imageBase64: imageBytes.toString('base64'),
        imageMimeType: mime,
        expiresAt,
        portalUrl: portal.toString(),
      };
    } catch (error) {
      releaseSlot();
      if (context) await closeContextBounded(context);
      throw error;
    }
  }

  async verifyAndDownload(input: {
    challengeId: string;
    documentKey: string;
    captcha: string;
    maxDownloadBytes: number;
  }): Promise<ThaisonBrowserPdfResult> {
    const session = this.sessions.get(input.challengeId);
    if (!session || session.documentKey !== input.documentKey) {
      throw new AppError('TVAN_THAISON_CHALLENGE_MISMATCH', 'CAPTCHA Thái Sơn không thuộc hóa đơn hiện tại.', 409);
    }
    if (session.expiresAt <= Date.now() || session.page.isClosed()) {
      await this.closeSession(session);
      throw new AppError('TVAN_THAISON_SESSION_EXPIRED', 'Phiên browser Thái Sơn đã hết hạn.', 410, true);
    }

    try {
      const submitted = await browserSubmitLookupNavigation(
        session.page,
        session.portalUrl,
        session.lookupCode,
        session.captchaToken,
        input.captcha,
        Math.min(input.maxDownloadBytes, 2 * 1024 * 1024),
      );
      if (submitted.declaredBytes > input.maxDownloadBytes || submitted.actualBytes > input.maxDownloadBytes) {
        throw new AppError('TVAN_RESPONSE_TOO_LARGE', 'HTML xác thực Thái Sơn vượt giới hạn dung lượng.', 502);
      }
      if (!submitted.ok) {
        throw new AppError(
          'TVAN_THAISON_CAPTCHA_HTTP_ERROR',
          'Thái Sơn trả HTTP ' + submitted.status + ' khi xác thực CAPTCHA.',
          502,
          submitted.status >= 500,
        );
      }
      const pdfUrls = pdfUrlsFromHtml(submitted.text, session.portalUrl, session.lookupCode);
      if (!pdfUrls.length) {
        throw new AppError(
          'TVAN_THAISON_CAPTCHA_INVALID',
          'Thái Sơn chưa chấp nhận CAPTCHA hoặc Mã TC; cần lấy CAPTCHA mới và thử lại.',
          422,
          true,
        );
      }

      const failures: string[] = [];
      for (const pdfUrl of pdfUrls) {
        try {
          const downloaded = await browserLoadPdfInFrame(
            session.page,
            pdfUrl,
            input.maxDownloadBytes,
          );
          if (downloaded.tooLarge) {
            throw new AppError('TVAN_RESPONSE_TOO_LARGE', 'PDF Thái Sơn vượt giới hạn dung lượng.', 502);
          }
          if (downloaded.ok && isPdfMagic(downloaded.content)) {
            return {
              content: downloaded.content,
              contentDisposition: downloaded.contentDisposition || undefined,
              responseStatus: downloaded.status,
              responseContentType: downloaded.contentType || undefined,
              pdfUrl,
            };
          }

          const head = downloaded.content.subarray(0, 12).toString('hex') || 'empty';
          failures.push(
            new URL(pdfUrl).pathname
              + ':status=' + downloaded.status
              + ',type=' + (downloaded.contentType || 'unknown')
              + ',bytes=' + downloaded.actualBytes
              + ',head=' + head,
          );
        } catch (error) {
          if (error instanceof AppError && error.code === 'TVAN_RESPONSE_TOO_LARGE') throw error;
          failures.push(
            new URL(pdfUrl).pathname
              + ':error=' + (error instanceof AppError ? error.code : error instanceof Error ? error.name : 'unknown'),
          );
        }
      }

      throw new AppError(
        'TVAN_THAISON_PDF_INVALID',
        'Không candidate PDF Thái Sơn nào trả bytes %PDF hợp lệ. ' + failures.join(' | '),
        502,
        true,
      );
    } finally {
      // Thái Sơn CAPTCHA + hidden token + ASP.NET session are one supervised attempt.
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
