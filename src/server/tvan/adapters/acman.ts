import type { InvoiceDocument, TvanPresentationLinkResult, TvanProviderCapability } from '../../../shared/models/index.js';
import { ACMAN_DOMAIN, ACMAN_SOLUTION_TAX_CODE } from '../../../shared/provider-resolution.js';
import { AppError, safeString } from '../../../shared/utils/index.js';
import { findNamedValue, lookupCodeOf } from '../extract.js';
import { ensurePdf, readLimited, responseFileName, safePdfFileName } from '../http.js';
import type { TvanAdapter, TvanAdapterContext, TvanPdfResult } from '../types.js';

const PROVIDER_CODE = 'tvan_acman';
const DISPLAY_NAME = 'ACMAN AC-Invoice';
const ORIGIN = 'https://' + ACMAN_DOMAIN;
const LOOKUP_URL = ORIGIN + '/tra-cuu/hoa-don.html';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';

interface AcmanLookupSession {
  lookupCode: string;
  cookieHeader?: string;
  resultHtml: string;
  hidden: Record<string, string>;
  downloadEventTarget: string;
}

function solutionTaxCodeOf(document: InvoiceDocument): string | undefined {
  return safeString(document.providers?.solution?.taxCode) || findNamedValue(document, ['msttcgp', 'MSTTCGP']);
}

function completeLocator(document: InvoiceDocument): boolean {
  return Boolean(document.seller?.taxCode && document.series && document.invoiceNo !== undefined && document.invoiceNo !== '');
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
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function normalizeInvoiceNo(value: unknown): string {
  const text = String(value ?? '').trim();
  if (/^\d+$/.test(text)) return text.replace(/^0+(?=\d)/, '');
  return text;
}

function xmlValue(xml: string, localName: string): string | undefined {
  const escaped = localName.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
  const match = new RegExp(
    '<(?:[A-Za-z_][\\w.-]*:)?' + escaped + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?' + escaped + '\\s*>',
    'i',
  ).exec(xml);
  return match?.[1] ? stripHtml(match[1]) : undefined;
}
export function acmanLookupFromXml(xmlBytes: Buffer): string | undefined {
  const xml = xmlBytes.toString('utf8');
  const direct = xmlValue(xml, 'MA_TRA_CUU') || xmlValue(xml, 'MaTraCuu') || xmlValue(xml, 'MATRACUU');
  if (direct) return direct;
  const blocks = xml.match(/<(?:[A-Za-z_][\w.-]*:)?TTin\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?TTin\s*>/gi) || [];
  for (const block of blocks) {
    const name = xmlValue(block, 'TTruong')?.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (name === 'ma tra cuu' || name === 'ma tra cuu hoa don') {
      const value = xmlValue(block, 'DLieu');
      if (value) return value;
    }
  }
  return undefined;
}

function parseHiddenInputs(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const type = /\btype=["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLocaleLowerCase();
    if (type !== 'hidden') continue;
    const name = /\bname=["']([^"']+)/i.exec(tag)?.[1];
    if (!name) continue;
    const value = /\bvalue=["']([^"']*)/i.exec(tag)?.[1] || '';
    result[decodeEntities(name)] = decodeEntities(value);
  }
  return result;
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
async function fetchAcman(
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
      if (current.protocol !== 'https:' || current.hostname.toLocaleLowerCase() !== ACMAN_DOMAIN) {
        throw new AppError('TVAN_ACMAN_URL_REJECTED', 'ACMAN redirect ra ngoài miền được phép.', 502);
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
    throw new AppError('TVAN_ACMAN_TOO_MANY_REDIRECTS', 'ACMAN redirect quá nhiều lần.', 502, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('TVAN_TIMEOUT', 'ACMAN phản hồi quá thời gian chờ.', 504, true);
    }
    throw new AppError('TVAN_NETWORK', 'Không kết nối được cổng ACMAN.', 502, true);
  } finally {
    clearTimeout(timer);
  }
}

function findDownloadEventTarget(document: InvoiceDocument, html: string): string {
  const seller = safeString(document.seller?.taxCode) || '';
  const series = safeString(document.series) || '';
  const invoiceNo = normalizeInvoiceNo(document.invoiceNo);
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const decoded = decodeEntities(rowMatch[0]);
    const cells = [...decoded.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripHtml(match[1]));
    if (seller && !cells.includes(seller)) continue;
    if (series && !cells.includes(series)) continue;
    if (invoiceNo && !cells.some((cell) => normalizeInvoiceNo(cell) === invoiceNo)) continue;
    const target = /__doPostBack\('([^']*btnDownloadPDF)'\s*,/i.exec(decoded)?.[1];
    if (target) return target;
  }
  throw new AppError('TVAN_ACMAN_INVOICE_MISMATCH', 'Kết quả ACMAN không khớp MST người bán/ký hiệu/số hóa đơn.', 409);
}

async function lookupCodeFor(document: InvoiceDocument, context: TvanAdapterContext): Promise<string> {
  let code = findNamedValue(document, ['MA_TRA_CUU', 'MaTraCuu', 'Mã tra cứu', 'Ma tra cuu', 'Mã tra cứu hóa đơn'])
    || lookupCodeOf(document);
  if (!code && context.loadInvoiceXml && completeLocator(document)) {
    code = acmanLookupFromXml(await context.loadInvoiceXml(document));
  }
  if (!code) throw new AppError('TVAN_ACMAN_LOOKUP_MISSING', 'Không tìm thấy mã tra cứu ACMAN trong dataset hoặc XML GDT.', 422);
  return code;
}

async function prepareLookup(document: InvoiceDocument, context: TvanAdapterContext): Promise<AcmanLookupSession> {
  if (solutionTaxCodeOf(document) !== ACMAN_SOLUTION_TAX_CODE) {
    throw new AppError('TVAN_ACMAN_PROVIDER_MISMATCH', 'ACMAN chỉ áp dụng cho MSTTCGP 0104908371.', 422);
  }
  const sellerTaxCode = safeString(document.seller?.taxCode);
  if (!sellerTaxCode) throw new AppError('TVAN_ACMAN_SELLER_MISSING', 'Thiếu MST người bán để tra cứu ACMAN.', 422);
  const lookupCode = await lookupCodeFor(document, context);
  const bootstrap = await fetchAcman(context, LOOKUP_URL, { method: 'GET', headers: { Accept: 'text/html,*/*;q=0.8' } });
  if (!bootstrap.response.ok) throw new AppError('TVAN_ACMAN_PORTAL_HTTP_ERROR', 'ACMAN trả HTTP ' + bootstrap.response.status + ' khi mở trang tra cứu.', 502);
  const initialHtml = (await readLimited(bootstrap.response, context.maxDownloadBytes)).toString('utf8');
  const form = new URLSearchParams(parseHiddenInputs(initialHtml));
  form.set('ctl00$PageContent$txtMaDonViPhatHanh', sellerTaxCode);
  form.set('ctl00$PageContent$txtMaTraCuuHoaDon', lookupCode);
  form.set('__EVENTTARGET', 'ctl00$PageContent$btnTraCuu');
  form.set('__EVENTARGUMENT', '');
  const searched = await fetchAcman(context, LOOKUP_URL, {
    method: 'POST',
    headers: {
      Accept: 'text/html,*/*;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: ORIGIN,
      Referer: LOOKUP_URL,
    },
    body: form.toString(),
  }, bootstrap.cookieHeader);
  if (!searched.response.ok) throw new AppError('TVAN_ACMAN_LOOKUP_HTTP_ERROR', 'ACMAN trả HTTP ' + searched.response.status + ' khi tra cứu.', 502);
  const resultHtml = (await readLimited(searched.response, context.maxDownloadBytes)).toString('utf8');
  return {
    lookupCode,
    cookieHeader: searched.cookieHeader,
    resultHtml,
    hidden: parseHiddenInputs(resultHtml),
    downloadEventTarget: findDownloadEventTarget(document, resultHtml),
  };
}

export class AcmanTvanAdapter implements TvanAdapter {
  readonly providerCode = PROVIDER_CODE;
  readonly displayName = DISPLAY_NAME;
  readonly captchaMode = 'none' as const;
  readonly priority = 'P1' as const;
  matches(document: InvoiceDocument): boolean {
    return solutionTaxCodeOf(document) === ACMAN_SOLUTION_TAX_CODE;
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    const direct = Boolean(findNamedValue(document, ['MA_TRA_CUU', 'MaTraCuu', 'Mã tra cứu', 'Ma tra cuu']) || lookupCodeOf(document));
    const supported = this.matches(document) && (direct || completeLocator(document));
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      supported,
      captchaMode: this.captchaMode,
      priority: this.priority,
      reason: supported ? undefined : 'Thiếu mã tra cứu ACMAN và locator GDT để tải XML.',
    };
  }

  async resolvePresentationLink(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPresentationLinkResult> {
    const lookupCode = await lookupCodeFor(document, context);
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      providerTaxCode: ACMAN_SOLUTION_TAX_CODE,
      sellerTaxCode: safeString(document.seller?.taxCode),
      lookupCode,
      metadataUrl: LOOKUP_URL,
      metadataMethod: 'POST',
      resolvedAt: new Date().toISOString(),
      steps: [
        { stage: 'lookup_code', status: 'ok', label: 'Mã tra cứu ACMAN', value: lookupCode },
        { stage: 'presentation_link', status: 'ready', label: 'ACMAN AC-Invoice', value: LOOKUP_URL },
      ],
    };
  }
  async downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult> {
    const session = await prepareLookup(document, context);
    const form = new URLSearchParams(session.hidden);
    form.set('ctl00$PageContent$txtMaDonViPhatHanh', safeString(document.seller?.taxCode) || '');
    form.set('ctl00$PageContent$txtMaTraCuuHoaDon', session.lookupCode);
    form.set('__EVENTTARGET', session.downloadEventTarget);
    form.set('__EVENTARGUMENT', '');
    const downloaded = await fetchAcman(context, LOOKUP_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/pdf,application/octet-stream,*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: ORIGIN,
        Referer: LOOKUP_URL,
      },
      body: form.toString(),
    }, session.cookieHeader);
    if (!downloaded.response.ok) throw new AppError('TVAN_ACMAN_DOWNLOAD_FAILED', 'ACMAN trả HTTP ' + downloaded.response.status + ' khi tải PDF.', 502);
    const bytes = await readLimited(downloaded.response, context.maxDownloadBytes);
    ensurePdf(bytes);
    return {
      content: bytes,
      contentType: 'application/pdf',
      fileName: responseFileName(downloaded.response)
        || safePdfFileName([document.seller?.taxCode, document.series, document.invoiceNo].filter(Boolean).join('_') || 'acman_invoice'),
    };
  }
}
