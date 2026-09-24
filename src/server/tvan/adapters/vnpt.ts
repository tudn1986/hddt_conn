import type { InvoiceDocument, TvanProviderCapability, TvanPresentationLinkResult } from '../../../shared/models/index.js';
import { VNPT_DOMAIN, VNPT_SOLUTION_TAX_CODE } from '../../../shared/provider-resolution.js';
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

const PROVIDER_CODE = 'tvan_vnpt';
const DISPLAY_NAME = 'VNPT Invoice';
const CENTRAL_ORIGIN = 'https://' + VNPT_DOMAIN;
const CAPTCHA_PATH = '/Captcha/Show';
const CAPTCHA_MAX_BYTES = 512 * 1024;
const SESSION_TTL_MS = 10 * 60_000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
type VnptPortalMode = 'central' | 'home';

interface VnptLookup {
  lookupCode: string;
  source: 'document' | 'xml:fkey';
  portalOrigin: string;
  portalHost: string;
  bootstrapUrl: string;
  sellerTaxCode?: string;
}

interface VnptChallengeState {
  version: 1;
  providerCode: typeof PROVIDER_CODE;
  documentKey: string;
  lookup: VnptLookup;
  mode: VnptPortalMode;
  pageUrl: string;
  formAction: string;
  antiForgeryToken: string;
  cookieHeader?: string;
}

interface VnptTransactionState extends VnptChallengeState {
  stage: 'verified';
  checkCode: string;
  pattern?: string;
  comId?: string;
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

function isVnptHost(host: string): boolean {
  const normalized = host.toLocaleLowerCase();
  return normalized === 'vnpt-invoice.com.vn' || normalized.endsWith('.vnpt-invoice.com.vn');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}
function xmlValue(xml: string, localName: string): string | undefined {
  const escaped = localName.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
  const expression = new RegExp(
    '<(?:[A-Za-z_][\\w.-]*:)?' + escaped + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?' + escaped + '\\s*>',
    'i',
  );
  const value = expression.exec(xml)?.[1];
  return value ? decodeEntities(value.replace(/<[^>]+>/g, '').trim()) : undefined;
}

export function vnptLookupFromXml(xmlBytes: Buffer): { lookupCode?: string; source?: 'xml:fkey' } {
  const xml = xmlBytes.toString('utf8');
  const direct = xmlValue(xml, 'Fkey') || xmlValue(xml, 'FKey');
  if (direct) return { lookupCode: direct, source: 'xml:fkey' };

  const blocks = xml.match(/<(?:[A-Za-z_][\w.-]*:)?TTin\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?TTin\s*>/gi) || [];
  for (const block of blocks) {
    const name = xmlValue(block, 'TTruong')?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
    if (name === 'fkey' || name === 'ma tra cuu') {
      const value = xmlValue(block, 'DLieu');
      if (value) return { lookupCode: value, source: 'xml:fkey' };
    }
  }
  return {};
}
function explicitPortalOrigin(document: InvoiceDocument): string | undefined {
  const base = safeString(document.lookup?.lookupBaseUrl);
  if (!base) return undefined;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || !isVnptHost(url.hostname)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

async function lookupOf(document: InvoiceDocument, context: TvanAdapterContext): Promise<VnptLookup> {
  if (solutionTaxCodeOf(document) !== VNPT_SOLUTION_TAX_CODE) {
    throw new AppError('TVAN_VNPT_PROVIDER_MISMATCH', 'XML/lookup VNPT chỉ áp dụng cho MSTTCGP 0100684378.', 422);
  }
  let lookupCode = findNamedValue(document, ['Fkey', 'FKey', 'fkey', 'Mã tra cứu', 'Ma tra cuu']) || lookupCodeOf(document);
  let source: VnptLookup['source'] = 'document';
  if (!lookupCode) {
    if (!context.loadInvoiceXml) throw new AppError('TVAN_VNPT_LOOKUP_MISSING', 'Thiếu Fkey và backend chưa có GDT XML bridge.', 422);
    if (!completeLocator(document)) throw new AppError('TVAN_VNPT_XML_LOCATOR_MISSING', 'Thiếu locator để tải XML GDT cho VNPT.', 422);
    const resolved = vnptLookupFromXml(await context.loadInvoiceXml(document));
    lookupCode = resolved.lookupCode;
    source = resolved.source || 'xml:fkey';
  }
  if (!lookupCode) throw new AppError('TVAN_VNPT_LOOKUP_MISSING', 'Không tìm thấy Fkey/mã tra cứu VNPT trong dataset hoặc XML GDT.', 422);
  const portalOrigin = explicitPortalOrigin(document) || CENTRAL_ORIGIN;
  const portal = new URL(portalOrigin);
  const central = portal.hostname.toLocaleLowerCase() === VNPT_DOMAIN;
  const bootstrapUrl = central
    ? portalOrigin + '/Portal/Index'
    : portalOrigin + '/?strFkey=' + encodeURIComponent(lookupCode);
  return {
    lookupCode,
    source,
    portalOrigin,
    portalHost: portal.hostname.toLocaleLowerCase(),
    bootstrapUrl,
    sellerTaxCode: safeString(document.seller?.taxCode),
  };
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
    if (!value) values.delete(name);
    else values.set(name, value);
  }
  return values.size ? [...values.entries()].map(([name, value]) => name + '=' + value).join('; ') : undefined;
}

async function fetchPortal(
  context: TvanAdapterContext,
  url: string,
  init: RequestInit,
  initialCookie?: string,
): Promise<{ response: Response; cookieHeader?: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs);
  timer.unref?.();
  let current = new URL(url);
  let currentInit: RequestInit = { ...init };
  let cookieHeader = initialCookie;
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (current.protocol !== 'https:' || !isVnptHost(current.hostname)) {
        throw new AppError('TVAN_VNPT_URL_REJECTED', 'VNPT redirect ra ngoài miền vnpt-invoice.com.vn.', 502);
      }
      const headers = new Headers(currentInit.headers || {});
      headers.set('User-Agent', BROWSER_UA);
      if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'vi-VN,vi;q=0.9,en;q=0.7');
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
    throw new AppError('TVAN_VNPT_TOO_MANY_REDIRECTS', 'VNPT redirect quá nhiều lần.', 502, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new AppError('TVAN_TIMEOUT', 'VNPT phản hồi quá thời gian chờ.', 504, true);
    throw new AppError('TVAN_NETWORK', 'Không kết nối được cổng VNPT Invoice.', 502, true);
  } finally {
    clearTimeout(timer);
  }
}

function antiForgeryToken(html: string): string | undefined {
  return /name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)/i.exec(html)?.[1]
    || /value=["']([^"']+)["'][^>]*name=["']__RequestVerificationToken["']/i.exec(html)?.[1];
}

function imageMimeType(contentType: string, bytes: Buffer): string | undefined {
  const mime = contentType.split(';', 1)[0]?.trim().toLocaleLowerCase();
  if (mime?.startsWith('image/')) return mime;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return undefined;
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
type SearchReference =
  | { mode: 'home'; checkCode: string }
  | { mode: 'share'; invoiceId: string; pattern: string; comId: string; fkey?: string };

export function parseVnptSearchReference(html: string): SearchReference | undefined {
  const home = /ajxCall4Portal\s*\(\s*["']([^"']+)["']/i.exec(html);
  if (home?.[1]) return { mode: 'home', checkCode: decodeEntities(home[1]) };

  const share = /showDetailInv\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["'](?:\s*,\s*["']([^"']*)["'])?/i.exec(html);
  if (share) return {
    mode: 'share',
    invoiceId: decodeEntities(share[1]),
    pattern: decodeEntities(share[2]),
    comId: decodeEntities(share[3]),
    fkey: share[4] ? decodeEntities(share[4]) : undefined,
  };
  return undefined;
}

function validatePreview(document: InvoiceDocument, html: string): void {
  const text = stripHtml(html).normalize('NFKC');
  const seller = safeString(document.seller?.taxCode);
  const series = safeString(document.series);
  if ((seller && !text.includes(seller)) || (series && !text.includes(series))) {
    throw new AppError('TVAN_VNPT_INVOICE_MISMATCH', 'Bản thể hiện VNPT không khớp MST người bán/ký hiệu hóa đơn.', 409);
  }
}

function parseToken(context: TvanAdapterContext, document: InvoiceDocument): VnptTransactionState | undefined {
  if (!context.token || context.token.expiresAt <= Date.now()) return undefined;
  try {
    const parsed = JSON.parse(context.token.token) as VnptTransactionState;
    if (parsed.providerCode !== PROVIDER_CODE || parsed.documentKey !== document.key || parsed.expiresAt <= Date.now()) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}
async function previewReference(
  document: InvoiceDocument,
  state: VnptChallengeState,
  reference: SearchReference,
  context: TvanAdapterContext,
): Promise<{ checkCode: string; pattern?: string; comId?: string; cookieHeader?: string }> {
  if (reference.mode === 'home') {
    const endpoint = state.lookup.portalOrigin + '/HomeNoLogin/ajxPreview/';
    const body = new URLSearchParams({ checkCode: reference.checkCode, fkey: state.lookup.lookupCode, nameCus: '' }).toString();
    const fetched = await fetchPortal(context, endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Origin: state.lookup.portalOrigin, Referer: state.pageUrl, 'X-Requested-With': 'XMLHttpRequest' },
      body,
    }, state.cookieHeader);
    if (!fetched.response.ok) throw new AppError('TVAN_VNPT_PREVIEW_HTTP_ERROR', 'VNPT trả HTTP ' + fetched.response.status + ' khi lấy bản thể hiện.', 502, fetched.response.status >= 500);
    let payload: unknown;
    try { payload = JSON.parse((await readLimited(fetched.response, context.maxDownloadBytes)).toString('utf8')); }
    catch { throw new AppError('TVAN_VNPT_PREVIEW_INVALID', 'VNPT không trả JSON bản thể hiện hợp lệ.', 502); }
    if (!isRecord(payload) || !safeString(payload.str)) throw new AppError('TVAN_VNPT_PREVIEW_INVALID', 'VNPT không trả HTML bản thể hiện hợp lệ.', 502);
    validatePreview(document, safeString(payload.str) || '');
    return { checkCode: reference.checkCode, cookieHeader: fetched.cookieHeader };
  }

  const endpoint = state.lookup.portalOrigin + '/Share/ajxPreviewv2';
  const body = new URLSearchParams({ idInvoice: reference.invoiceId, pattern: reference.pattern, comId: reference.comId, fkey: reference.fkey || state.lookup.lookupCode }).toString();
  const fetched = await fetchPortal(context, endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Origin: state.lookup.portalOrigin, Referer: state.pageUrl, 'X-Requested-With': 'XMLHttpRequest' },
    body,
  }, state.cookieHeader);
  if (!fetched.response.ok) throw new AppError('TVAN_VNPT_PREVIEW_HTTP_ERROR', 'VNPT trả HTTP ' + fetched.response.status + ' khi lấy bản thể hiện.', 502, fetched.response.status >= 500);
  let payload: unknown;
  try { payload = JSON.parse((await readLimited(fetched.response, context.maxDownloadBytes)).toString('utf8')); }
  catch { throw new AppError('TVAN_VNPT_PREVIEW_INVALID', 'VNPT không trả JSON bản thể hiện hợp lệ.', 502); }
  if (!isRecord(payload) || payload.result === false || !safeString(payload.result) || !safeString(payload.checkCode)) {
    throw new AppError('TVAN_VNPT_PREVIEW_INVALID', safeString(isRecord(payload) ? payload.message : undefined) || 'VNPT không trả checkCode/bản thể hiện hợp lệ.', 502);
  }
  validatePreview(document, safeString(payload.result) || '');
  return {
    checkCode: safeString(payload.checkCode) as string,
    pattern: reference.pattern,
    comId: reference.comId,
    cookieHeader: fetched.cookieHeader,
  };
}

export class VnptInvoiceTvanAdapter implements TvanAdapter {
  readonly providerCode = PROVIDER_CODE;
  readonly displayName = DISPLAY_NAME;
  readonly captchaMode = 'per_invoice' as const;
  readonly priority = 'P3' as const;

  matches(document: InvoiceDocument): boolean {
    return solutionTaxCodeOf(document) === VNPT_SOLUTION_TAX_CODE;
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
      reason: supported ? undefined : 'Thiếu Fkey và locator GDT để lấy Fkey/MCCQT từ XML.',
    };
  }

  async resolvePresentationLink(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPresentationLinkResult> {
    const lookup = await lookupOf(document, context);
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      lookupCode: lookup.lookupCode,
      sellerTaxCode: lookup.sellerTaxCode,
      providerTaxCode: VNPT_SOLUTION_TAX_CODE,
      metadataUrl: lookup.bootstrapUrl,
      metadataMethod: 'GET',
      resolvedAt: new Date().toISOString(),
      steps: [
        { stage: 'lookup_code', status: 'ok', label: lookup.source === 'document' ? 'Fkey / mã tra cứu' : 'Fkey từ XML GDT', value: lookup.lookupCode },
        { stage: 'presentation_link', status: 'ready', label: 'VNPT Invoice (cần CAPTCHA để tra cứu)', value: lookup.portalOrigin },
      ],
    };
  }
  async getCaptchaChallenge(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanChallengeResult> {
    const lookup = await lookupOf(document, context);
    const bootstrap = await fetchPortal(context, lookup.bootstrapUrl, {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    if (!bootstrap.response.ok) throw new AppError('TVAN_VNPT_PORTAL_HTTP_ERROR', 'VNPT trả HTTP ' + bootstrap.response.status + ' khi mở trang tra cứu.', 502, bootstrap.response.status >= 500);
    const html = (await readLimited(bootstrap.response, context.maxDownloadBytes)).toString('utf8');
    const token = antiForgeryToken(html);
    if (!token) throw new AppError('TVAN_VNPT_ANTIFORGERY_MISSING', 'Không tìm thấy anti-forgery token trên cổng VNPT.', 502);
    const home = /action=["'][^"']*\/HomeNoLogin\/SearchByFkey/i.test(html);
    const formAction = home ? '/HomeNoLogin/SearchByFkey' : '/Portal/Index';

    const captcha = await fetchPortal(context, lookup.portalOrigin + CAPTCHA_PATH, {
      method: 'GET',
      headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'Cache-Control': 'no-cache', Referer: bootstrap.finalUrl },
    }, bootstrap.cookieHeader);
    if (!captcha.response.ok) throw new AppError('TVAN_VNPT_CAPTCHA_HTTP_ERROR', 'VNPT trả HTTP ' + captcha.response.status + ' khi lấy CAPTCHA.', 502, captcha.response.status >= 500);
    const bytes = await readLimited(captcha.response, Math.min(CAPTCHA_MAX_BYTES, context.maxDownloadBytes));
    const mimeType = imageMimeType(captcha.response.headers.get('content-type') || '', bytes);
    if (!mimeType) throw new AppError('TVAN_VNPT_CAPTCHA_IMAGE_INVALID', 'VNPT không trả ảnh CAPTCHA hợp lệ.', 502);
    const privateState: VnptChallengeState = {
      version: 1,
      providerCode: PROVIDER_CODE,
      documentKey: document.key,
      lookup,
      mode: home ? 'home' : 'central',
      pageUrl: bootstrap.finalUrl,
      formAction,
      antiForgeryToken: token,
      cookieHeader: captcha.cookieHeader,
    };
    return {
      challenge: {
        id: generateId(),
        providerCode: this.providerCode,
        kind: 'text',
        prompt: 'Nhập mã xác thực hiển thị trên ảnh VNPT Invoice.',
        imageBase64: bytes.toString('base64'),
        imageMimeType: mimeType,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      },
      privateState,
      trace: {
        endpoint: lookup.portalOrigin + CAPTCHA_PATH,
        method: 'GET',
        responseStatus: captcha.response.status,
        responseContentType: captcha.response.headers.get('content-type') || undefined,
      },
    };
  }
  async verifyCaptcha(
    document: InvoiceDocument,
    _challenge: { id: string },
    privateState: unknown,
    answer: string,
    context: TvanAdapterContext,
  ): Promise<TvanCaptchaVerifyTrace> {
    if (!isRecord(privateState)) throw new AppError('TVAN_VNPT_CHALLENGE_STATE_INVALID', 'Phiên CAPTCHA VNPT không hợp lệ.', 409);
    const state = privateState as unknown as VnptChallengeState;
    const currentLookup = await lookupOf(document, context);
    if (state.providerCode !== PROVIDER_CODE || state.documentKey !== document.key || state.lookup.lookupCode !== currentLookup.lookupCode) {
      throw new AppError('TVAN_VNPT_CHALLENGE_MISMATCH', 'CAPTCHA không thuộc hóa đơn VNPT hiện tại.', 409);
    }
    const captcha = answer.trim();
    if (!captcha) throw new AppError('TVAN_VNPT_CAPTCHA_EMPTY', 'Chưa nhập mã xác thực VNPT.', 400);

    const body = state.mode === 'home'
      ? new URLSearchParams({ __RequestVerificationToken: state.antiForgeryToken, isHomepage: 'true', strFkey: state.lookup.lookupCode, captch: captcha }).toString()
      : new URLSearchParams({ __RequestVerificationToken: state.antiForgeryToken, slTracuu: '0', Fkey: state.lookup.lookupCode, captch: captcha, checkInvType: '0' }).toString();
    const searched = await fetchPortal(context, new URL(state.formAction, state.lookup.portalOrigin).toString(), {
      method: 'POST',
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Content-Type': 'application/x-www-form-urlencoded', Origin: state.lookup.portalOrigin, Referer: state.pageUrl },
      body,
    }, state.cookieHeader);
    if (!searched.response.ok) {
      const status = searched.response.status;
      if ([400, 401, 403, 422].includes(status)) throw new AppError('TVAN_VNPT_CAPTCHA_INVALID', 'VNPT không chấp nhận CAPTCHA hoặc mã tra cứu.', 422);
      throw new AppError('TVAN_VNPT_SEARCH_HTTP_ERROR', 'VNPT trả HTTP ' + status + ' khi tra cứu hóa đơn.', 502, status >= 500);
    }
    const searchHtml = (await readLimited(searched.response, context.maxDownloadBytes)).toString('utf8');
    const reference = parseVnptSearchReference(searchHtml);
    if (!reference) throw new AppError('TVAN_VNPT_CAPTCHA_OR_LOOKUP_INVALID', 'Không tìm thấy hóa đơn VNPT. Kiểm tra CAPTCHA và mã tra cứu.', 422);

    const preview = await previewReference(document, { ...state, pageUrl: searched.finalUrl, cookieHeader: searched.cookieHeader }, reference, context);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const transaction: VnptTransactionState = {
      ...state,
      pageUrl: searched.finalUrl,
      cookieHeader: preview.cookieHeader || searched.cookieHeader,
      stage: 'verified',
      checkCode: preview.checkCode,
      pattern: preview.pattern,
      comId: preview.comId,
      expiresAt,
    };
    context.setToken({ token: JSON.stringify(transaction), expiresAt });
    return {
      request: { endpoint: new URL(state.formAction, state.lookup.portalOrigin).toString(), method: 'POST', requestBody: '[lookup code + user-entered CAPTCHA + anti-forgery token]', responseStatus: searched.response.status, responseContentType: searched.response.headers.get('content-type') || undefined },
      tokenExpiresAt: new Date(expiresAt).toISOString(),
    };
  }
  async downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult> {
    const state = parseToken(context, document);
    if (!state) {
      context.setToken(undefined);
      throw new AppError('TVAN_CAPTCHA_REQUIRED', 'Cần xác thực CAPTCHA VNPT cho hóa đơn này.', 428, true);
    }

    const target = state.mode === 'home'
      ? new URL('/HomeNoLogin/downloadPDF', state.lookup.portalOrigin)
      : new URL('/Share/DownloadPDF', state.lookup.portalOrigin);
    if (state.mode === 'home') {
      target.searchParams.set('checkCode', state.checkCode);
      target.searchParams.set('fkey', state.lookup.lookupCode);
      target.searchParams.set('nameCus', '');
    } else {
      if (!state.pattern || !state.comId) throw new AppError('TVAN_VNPT_DOWNLOAD_STATE_INVALID', 'Thiếu pattern/comId của phiên VNPT.', 409);
      target.searchParams.set('pattern', state.pattern);
      target.searchParams.set('comid', state.comId);
      target.searchParams.set('id', state.checkCode);
    }

    const downloaded = await fetchPortal(context, target.toString(), {
      method: 'GET',
      headers: { Accept: 'application/pdf,application/octet-stream,*/*', Referer: state.pageUrl },
    }, state.cookieHeader);
    if ([401, 403, 419, 422].includes(downloaded.response.status)) {
      context.setToken(undefined);
      throw new AppError('TVAN_CAPTCHA_REQUIRED', 'Phiên CAPTCHA VNPT đã hết hạn hoặc không hợp lệ.', 428, true);
    }
    if (!downloaded.response.ok) throw new AppError('TVAN_VNPT_DOWNLOAD_FAILED', 'VNPT trả HTTP ' + downloaded.response.status + ' khi tải PDF.', 502, downloaded.response.status >= 500);
    const bytes = await readLimited(downloaded.response, context.maxDownloadBytes);
    ensurePdf(bytes);
    return {
      content: bytes,
      contentType: 'application/pdf',
      fileName: responseFileName(downloaded.response) || safePdfFileName([document.seller?.taxCode, document.series, document.invoiceNo].filter(Boolean).join('_') || 'vnpt_invoice'),
    };
  }
}
