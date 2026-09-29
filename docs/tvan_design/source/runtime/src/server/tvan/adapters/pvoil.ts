import type { InvoiceDocument, TvanProviderCapability } from '../../../shared/models/index.js';
import { PVOIL_DOMAIN, PVOIL_SOLUTION_TAX_CODE } from '../../../shared/provider-resolution.js';
import { AppError, generateId, isRecord, safeString } from '../../../shared/utils/index.js';
import { findNamedValue, lookupCodeOf } from '../extract.js';
import { ensurePdf, readLimited, responseFileName, safePdfFileName } from '../http.js';
import type {
  TvanAdapter,
  TvanAdapterContext,
  TvanCaptchaVerifyTrace,
  TvanChallengeResult,
  TvanPdfResult,
} from '../types.js';

const PROVIDER_CODE = 'tvan_pvoil';
const DISPLAY_NAME = 'PVOIL eInvoice';
const ORIGIN = 'https://' + PVOIL_DOMAIN;
const SEARCH_URL = ORIGIN + '/Invoice/Search';
const CAPTCHA_URL = ORIGIN + '/Captcha/Show';
const SESSION_TTL_MS = 10 * 60_000;
const CAPTCHA_MAX_BYTES = 512 * 1024;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

interface PvoilChallengeState {
  version: 1;
  providerCode: typeof PROVIDER_CODE;
  documentKey: string;
  lookupCode: string;
  cookieHeader?: string;
}
interface PvoilTokenState extends PvoilChallengeState {
  stage: 'verified';
  invoiceId: string;
  pattern: string;
  expiresAt: number;
}

function solutionTaxCodeOf(document: InvoiceDocument): string | undefined {
  return safeString(document.providers?.solution?.taxCode) || findNamedValue(document, ['msttcgp', 'MSTTCGP']);
}

function completeLocator(document: InvoiceDocument): boolean {
  return Boolean(
    document.seller?.taxCode
    && document.templateNo !== undefined && document.templateNo !== ''
    && document.series
    && document.invoiceNo !== undefined && document.invoiceNo !== '',
  );
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function xmlValue(xml: string, localName: string): string | undefined {
  const escaped = localName.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
  const match = new RegExp(
    '<(?:[A-Za-z_][\\w.-]*:)?' + escaped + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?' + escaped + '\\s*>',
    'i',
  ).exec(xml);
  return match?.[1] ? stripHtml(match[1]) : undefined;
}

export function pvoilLookupFromXml(xmlBytes: Buffer): string | undefined {
  const xml = xmlBytes.toString('utf8');
  const direct = xmlValue(xml, 'Fkey') || xmlValue(xml, 'FKey');
  if (direct) return direct;
  const blocks = xml.match(/<(?:[A-Za-z_][\w.-]*:)?TTin\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?TTin\s*>/gi) || [];
  for (const block of blocks) {
    const name = xmlValue(block, 'TTruong')?.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (name === 'fkey' || name === 'ma tra cuu') {
      const value = xmlValue(block, 'DLieu');
      if (value) return value;
    }
  }
  return undefined;
}

function cookiePairs(raw: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!raw) return result;
  for (const part of raw.split(/;\s*/)) {
    const equal = part.indexOf('=');
    if (equal > 0) result.set(part.slice(0, equal).trim(), part.slice(equal + 1).trim());
  }
  return result;
}
function responseSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const direct = headers.getSetCookie?.();
  if (direct?.length) return direct;
  const fallback = response.headers.get('set-cookie');
  return fallback ? [fallback] : [];
}

function mergeCookies(previous: string | undefined, response: Response): string | undefined {
  const values = cookiePairs(previous);
  for (const raw of responseSetCookies(response)) {
    const first = raw.split(';', 1)[0] || '';
    const equal = first.indexOf('=');
    if (equal <= 0) continue;
    const name = first.slice(0, equal).trim();
    const value = first.slice(equal + 1).trim();
    if (!value) values.delete(name); else values.set(name, value);
  }
  return values.size ? [...values].map(([name, value]) => name + '=' + value).join('; ') : undefined;
}

async function fetchPvoil(
  context: TvanAdapterContext,
  url: string,
  init: RequestInit,
  initialCookie?: string,
): Promise<{ response: Response; cookieHeader?: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs);
  timer.unref?.();
  let current = new URL(url);
  let currentInit = { ...init };
  let cookieHeader = initialCookie;
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (current.protocol !== 'https:' || current.hostname.toLocaleLowerCase() !== PVOIL_DOMAIN) {
        throw new AppError('TVAN_PVOIL_URL_REJECTED', 'PVOIL redirect ra ngoài miền được phép.', 502);
      }
      const headers = new Headers(currentInit.headers || {});
      headers.set('User-Agent', BROWSER_UA);
      if (cookieHeader) headers.set('Cookie', cookieHeader);
      const response = await context.fetchImpl(current, { ...currentInit, headers, redirect: 'manual', signal: controller.signal });
      cookieHeader = mergeCookies(cookieHeader, response);
      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
        return { response, cookieHeader, finalUrl: current.toString() };
      }
      try { await response.body?.cancel(); } catch { /* best effort */ }
      current = new URL(location, current);
      if (response.status === 303 || ([301, 302].includes(response.status) && String(currentInit.method || 'GET').toUpperCase() === 'POST')) {
        currentInit = { ...currentInit, method: 'GET', body: undefined };
      }
    }
    throw new AppError('TVAN_PVOIL_TOO_MANY_REDIRECTS', 'PVOIL redirect quá nhiều lần.', 502, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new AppError('TVAN_TIMEOUT', 'PVOIL phản hồi quá thời gian chờ.', 504, true);
    throw new AppError('TVAN_NETWORK', 'Không kết nối được cổng hóa đơn PVOIL.', 502, true);
  } finally {
    clearTimeout(timer);
  }
}
function imageMimeType(contentType: string, bytes: Buffer): string | undefined {
  const mime = contentType.split(';', 1)[0]?.trim().toLocaleLowerCase();
  if (mime?.startsWith('image/')) return mime;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return undefined;
}

export function parsePvoilSearchReference(html: string): { invoiceId: string; pattern: string } | undefined {
  const match = /ajxCall4Portal\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/i.exec(html);
  return match?.[1] && match[2] ? { invoiceId: decodeEntities(match[1]), pattern: decodeEntities(match[2]) } : undefined;
}

async function lookupCodeFor(document: InvoiceDocument, context: TvanAdapterContext): Promise<string> {
  let code = findNamedValue(document, ['Fkey', 'FKey', 'fkey', 'Mã tra cứu', 'Ma tra cuu']) || lookupCodeOf(document);
  if (!code && context.loadInvoiceXml && completeLocator(document)) {
    code = pvoilLookupFromXml(await context.loadInvoiceXml(document));
  }
  if (!code) throw new AppError('TVAN_PVOIL_LOOKUP_MISSING', 'Không tìm thấy Fkey/mã tra cứu PVOIL trong dataset hoặc XML GDT.', 422);
  return code;
}

function validatePreview(document: InvoiceDocument, html: string): void {
  const text = stripHtml(html).normalize('NFKC');
  const seller = safeString(document.seller?.taxCode);
  const series = safeString(document.series);
  if ((seller && !text.includes(seller)) || (series && !text.includes(series))) {
    throw new AppError('TVAN_PVOIL_INVOICE_MISMATCH', 'Bản thể hiện PVOIL không khớp MST người bán/ký hiệu hóa đơn.', 409);
  }
}
function parseToken(context: TvanAdapterContext, document: InvoiceDocument): PvoilTokenState | undefined {
  if (!context.token || context.token.expiresAt <= Date.now()) return undefined;
  try {
    const parsed = JSON.parse(context.token.token) as PvoilTokenState;
    if (parsed.providerCode !== PROVIDER_CODE || parsed.documentKey !== document.key || parsed.expiresAt <= Date.now()) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export class PvoilTvanAdapter implements TvanAdapter {
  readonly providerCode = PROVIDER_CODE;
  readonly displayName = DISPLAY_NAME;
  readonly captchaMode = 'per_invoice' as const;
  readonly priority = 'P3' as const;

  matches(document: InvoiceDocument): boolean {
    return solutionTaxCodeOf(document) === PVOIL_SOLUTION_TAX_CODE;
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    const direct = Boolean(findNamedValue(document, ['Fkey', 'FKey', 'fkey', 'Mã tra cứu', 'Ma tra cuu']) || lookupCodeOf(document));
    const supported = this.matches(document) && (direct || completeLocator(document));
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      supported,
      captchaMode: this.captchaMode,
      priority: this.priority,
      reason: supported ? undefined : 'Thiếu Fkey/mã tra cứu PVOIL và locator GDT để tải XML.',
    };
  }
  async getCaptchaChallenge(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanChallengeResult> {
    if (!this.matches(document)) throw new AppError('TVAN_PVOIL_PROVIDER_MISMATCH', 'PVOIL chỉ áp dụng cho MSTTCGP 0305795054.', 422);
    const lookupCode = await lookupCodeFor(document, context);
    const page = await fetchPvoil(context, SEARCH_URL, { method: 'GET', headers: { Accept: 'text/html,*/*;q=0.8' } });
    if (!page.response.ok) throw new AppError('TVAN_PVOIL_PORTAL_HTTP_ERROR', 'PVOIL trả HTTP ' + page.response.status + ' khi mở trang tra cứu.', 502);
    await readLimited(page.response, context.maxDownloadBytes);

    const captcha = await fetchPvoil(context, CAPTCHA_URL, {
      method: 'GET',
      headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', Referer: SEARCH_URL },
    }, page.cookieHeader);
    if (!captcha.response.ok) throw new AppError('TVAN_PVOIL_CAPTCHA_HTTP_ERROR', 'PVOIL trả HTTP ' + captcha.response.status + ' khi lấy CAPTCHA.', 502);
    const bytes = await readLimited(captcha.response, Math.min(CAPTCHA_MAX_BYTES, context.maxDownloadBytes));
    const mimeType = imageMimeType(captcha.response.headers.get('content-type') || '', bytes);
    if (!mimeType) throw new AppError('TVAN_PVOIL_CAPTCHA_IMAGE_INVALID', 'PVOIL không trả ảnh CAPTCHA hợp lệ.', 502);
    const privateState: PvoilChallengeState = {
      version: 1,
      providerCode: PROVIDER_CODE,
      documentKey: document.key,
      lookupCode,
      cookieHeader: captcha.cookieHeader,
    };
    return {
      challenge: {
        id: generateId(),
        providerCode: this.providerCode,
        kind: 'text',
        prompt: 'Nhập mã kiểm tra hiển thị trên ảnh PVOIL.',
        imageBase64: bytes.toString('base64'),
        imageMimeType: mimeType,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      },
      privateState,
      trace: { endpoint: CAPTCHA_URL, method: 'GET', responseStatus: captcha.response.status, responseContentType: captcha.response.headers.get('content-type') || undefined },
    };
  }
  async verifyCaptcha(
    document: InvoiceDocument,
    _challenge: { id: string },
    privateState: unknown,
    answer: string,
    context: TvanAdapterContext,
  ): Promise<TvanCaptchaVerifyTrace> {
    if (!isRecord(privateState)) throw new AppError('TVAN_PVOIL_CHALLENGE_STATE_INVALID', 'Phiên CAPTCHA PVOIL không hợp lệ.', 409);
    const state = privateState as unknown as PvoilChallengeState;
    const lookupCode = await lookupCodeFor(document, context);
    if (state.providerCode !== PROVIDER_CODE || state.documentKey !== document.key || state.lookupCode !== lookupCode) {
      throw new AppError('TVAN_PVOIL_CHALLENGE_MISMATCH', 'CAPTCHA không thuộc hóa đơn PVOIL hiện tại.', 409);
    }
    const captcha = answer.trim();
    if (!captcha) throw new AppError('TVAN_PVOIL_CAPTCHA_EMPTY', 'Chưa nhập mã kiểm tra PVOIL.', 400);

    const body = new URLSearchParams({ TT78: 'true', key: state.lookupCode, captch: captcha }).toString();
    const searched = await fetchPvoil(context, SEARCH_URL, {
      method: 'POST',
      headers: { Accept: 'text/html,*/*;q=0.8', 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN, Referer: SEARCH_URL },
      body,
    }, state.cookieHeader);
    if (!searched.response.ok) {
      const status = searched.response.status;
      if ([400, 401, 403, 422].includes(status)) throw new AppError('TVAN_PVOIL_CAPTCHA_INVALID', 'PVOIL không chấp nhận CAPTCHA hoặc mã tra cứu.', 422);
      throw new AppError('TVAN_PVOIL_SEARCH_HTTP_ERROR', 'PVOIL trả HTTP ' + status + ' khi tra cứu.', 502);
    }
    const html = (await readLimited(searched.response, context.maxDownloadBytes)).toString('utf8');
    const reference = parsePvoilSearchReference(html);
    if (!reference) throw new AppError('TVAN_PVOIL_CAPTCHA_OR_LOOKUP_INVALID', 'Không tìm thấy hóa đơn PVOIL. Kiểm tra CAPTCHA và mã tra cứu.', 422);

    const preview = await fetchPvoil(context, ORIGIN + '/Invoice/InvPreview/', {
      method: 'POST',
      headers: { Accept: 'application/json,*/*;q=0.8', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Origin: ORIGIN, Referer: SEARCH_URL, 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ invid: reference.invoiceId, pattern: reference.pattern }).toString(),
    }, searched.cookieHeader);
    if (!preview.response.ok) throw new AppError('TVAN_PVOIL_PREVIEW_HTTP_ERROR', 'PVOIL trả HTTP ' + preview.response.status + ' khi lấy bản thể hiện.', 502);
    let payload: unknown;
    try { payload = JSON.parse((await readLimited(preview.response, context.maxDownloadBytes)).toString('utf8')); }
    catch { throw new AppError('TVAN_PVOIL_PREVIEW_INVALID', 'PVOIL không trả JSON bản thể hiện hợp lệ.', 502); }
    if (!isRecord(payload) || payload.success === false || !safeString(payload.data)) {
      throw new AppError('TVAN_PVOIL_PREVIEW_INVALID', 'PVOIL không trả HTML bản thể hiện hợp lệ.', 502);
    }
    validatePreview(document, safeString(payload.data) || '');

    const expiresAt = Date.now() + SESSION_TTL_MS;
    const token: PvoilTokenState = { ...state, stage: 'verified', invoiceId: reference.invoiceId, pattern: reference.pattern, cookieHeader: preview.cookieHeader || searched.cookieHeader, expiresAt };
    context.setToken({ token: JSON.stringify(token), expiresAt });
    return {
      request: { endpoint: SEARCH_URL, method: 'POST', requestBody: '[lookup code + user-entered CAPTCHA]', responseStatus: searched.response.status, responseContentType: searched.response.headers.get('content-type') || undefined },
      tokenExpiresAt: new Date(expiresAt).toISOString(),
    };
  }
  async downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult> {
    const state = parseToken(context, document);
    if (!state) {
      context.setToken(undefined);
      throw new AppError('TVAN_CAPTCHA_REQUIRED', 'Cần xác thực CAPTCHA PVOIL cho hóa đơn này.', 428, true);
    }
    const target = new URL('/Invoice/DownloadPDF', ORIGIN);
    target.searchParams.set('id', state.invoiceId);
    target.searchParams.set('pattern', state.pattern);
    const downloaded = await fetchPvoil(context, target.toString(), {
      method: 'GET',
      headers: { Accept: 'application/pdf,application/octet-stream,*/*', Referer: SEARCH_URL },
    }, state.cookieHeader);
    if ([401, 403, 419, 422].includes(downloaded.response.status)) {
      context.setToken(undefined);
      throw new AppError('TVAN_CAPTCHA_REQUIRED', 'Phiên CAPTCHA PVOIL đã hết hạn hoặc không hợp lệ.', 428, true);
    }
    if (!downloaded.response.ok) throw new AppError('TVAN_PVOIL_DOWNLOAD_FAILED', 'PVOIL trả HTTP ' + downloaded.response.status + ' khi tải PDF.', 502);
    const bytes = await readLimited(downloaded.response, context.maxDownloadBytes);
    ensurePdf(bytes);
    return {
      content: bytes,
      contentType: 'application/pdf',
      fileName: responseFileName(downloaded.response)
        || safePdfFileName([document.seller?.taxCode, document.series, document.invoiceNo].filter(Boolean).join('_') || 'pvoil_invoice'),
    };
  }
}
