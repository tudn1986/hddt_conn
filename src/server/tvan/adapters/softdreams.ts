import yauzl, { type Entry, type ZipFile } from 'yauzl';
import type {
  InvoiceDocument,
  TvanDownloadRequestPlan,
  TvanPresentationLinkResult,
  TvanProviderCapability,
  TvanRequestTrace,
} from '../../../shared/models/index.js';
import { AppError, generateId, isRecord, safeString } from '../../../shared/utils/index.js';
import { isSafeZipEntryName, isZip } from '../../gdt/zip.js';
import { findNamedValue, lookupCodeOf, providerCodeOf } from '../extract.js';
import { ensurePdf, readLimited, safePdfFileName } from '../http.js';
import type {
  TvanAdapter,
  TvanAdapterContext,
  TvanCaptchaVerifyTrace,
  TvanChallengeResult,
  TvanOriginalFileResult,
  TvanPdfResult,
  TvanPreparedArtifact,
  TvanTokenState,
} from '../types.js';
import type { TvanArtifactStatus } from '../../../shared/models/index.js';
import { parseSoftdreamsSearchResponse, type SoftdreamsSearchResult } from './softdreams/search-parser.js';
import { renderSoftdreamsRepresentation } from './softdreams/representation-renderer.js';

const PROVIDER_TAX_CODE = '0105987432';
const CAPTCHA_PATH = '/Captcha/Show';
const SEARCH_PATH = '/Search/Search';
const SEARCH_PAGE_PATH = '/Search/Index';
const PREPARE_DOWNLOAD_PATH = '/Invoice/DownloadPdfAndFileAttachFromAvailableHtml';
const PREPARE_PDF_PATH = '/Invoice/DownloadFileFromHtml';
const DOWNLOAD_PATH = '/Invoice/Download';
const SESSION_TTL_MS = 10 * 60_000;
const CAPTCHA_MAX_BYTES = 2 * 1024 * 1024;
const SOFTDREAMS_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

interface SoftdreamsLookup {
  sellerTaxCode: string;
  providerTaxCode: string;
  portalOrigin: string;
  portalHost: string;
  portalProtocol: 'http:' | 'https:';
  fkey: string;
}

interface SoftdreamsChallengeState extends SoftdreamsLookup {
  documentKey: string;
  pageUrl: string;
  cookieHeader?: string;
}

type SoftdreamsArtifactType = 'pdf' | 'zip';

type SoftdreamsTransactionStage =
  | 'search_verified'
  | 'representation_ready'
  | 'artifact_descriptor_ready'
  | 'original_ready'
  | 'pdf_ready';

interface SoftdreamsTransactionState {
  version: 2;
  providerCode: 'tvan_softdreams';
  documentKey: string;
  stage: SoftdreamsTransactionStage;
  lookup: SoftdreamsLookup;
  pageUrl: string;
  cookieHeader?: string;
  search: SoftdreamsSearchResult;
  representation?: {
    html: string;
    pageCount: number;
    renderer: 'row' | 'chromium';
    renderedAt: number;
  };
  descriptor?: {
    fileGuid: string;
    fileName: string;
    downloadUrl: string;
    preparedAt: number;
  };
  expiresAt: number;
}

function normalizedHostSellerTaxCode(document: InvoiceDocument): string | undefined {
  return safeString(document.seller?.taxCode)
    || findNamedValue(document, ['nbmst', 'MST người bán', 'sellerTaxCode']);
}

function providerTaxCodeOf(document: InvoiceDocument): string | undefined {
  return findNamedValue(document, ['msttcgp', 'tvandnkntt', 'MSTTCGP']);
}

function portalLinkOf(document: InvoiceDocument): string | undefined {
  return findNamedValue(document, ['PortalLink', 'Portal Link', 'portalLink'])
    || safeString(document.lookup?.lookupBaseUrl);
}

function fkeyOf(document: InvoiceDocument): string | undefined {
  return findNamedValue(document, ['Fkey', 'FKey', 'fkey']) || lookupCodeOf(document);
}

function lookupOf(document: InvoiceDocument): SoftdreamsLookup {
  const sellerTaxCode = normalizedHostSellerTaxCode(document);
  const providerTaxCode = providerTaxCodeOf(document) || PROVIDER_TAX_CODE;
  const portalRaw = portalLinkOf(document);
  const fkey = fkeyOf(document);

  if (!sellerTaxCode) {
    throw new AppError('TVAN_SOFTDREAMS_SELLER_TAX_CODE_MISSING', 'Không tìm thấy MST người bán của hóa đơn SoftDreams.', 422);
  }
  if (!portalRaw) {
    throw new AppError('TVAN_SOFTDREAMS_PORTAL_MISSING', 'Không tìm thấy PortalLink của hóa đơn SoftDreams.', 422);
  }
  if (!fkey) {
    throw new AppError('TVAN_SOFTDREAMS_FKEY_MISSING', 'Không tìm thấy Fkey / mã tra cứu của hóa đơn SoftDreams.', 422);
  }

  let portal: URL;
  try {
    portal = new URL(portalRaw);
  } catch {
    throw new AppError('TVAN_SOFTDREAMS_PORTAL_INVALID', 'PortalLink SoftDreams không phải URL hợp lệ.', 422);
  }
  if (!['http:', 'https:'].includes(portal.protocol)) {
    throw new AppError('TVAN_SOFTDREAMS_PORTAL_INVALID', 'PortalLink SoftDreams không dùng HTTP/HTTPS.', 422);
  }

  const host = portal.hostname.toLocaleLowerCase();
  const expectedHosts = [
    `${sellerTaxCode}hd.easyinvoice.vn`.toLocaleLowerCase(),
    `${sellerTaxCode}hd.easyinvoice.com.vn`.toLocaleLowerCase(),
  ];
  if (!expectedHosts.includes(host)) {
    throw new AppError(
      'TVAN_SOFTDREAMS_PORTAL_REJECTED',
      `PortalLink SoftDreams không khớp MST người bán ${sellerTaxCode}.`,
      422,
    );
  }

  // Keep the exact scheme observed in PortalLink. Some seller-specific EasyInvoice
  // deployments still serve the production AJAX/download flow over HTTP and behave
  // differently on their HTTPS virtual host. Host validation remains strict and
  // redirects are restricted to this seller-specific hostname.
  return {
    sellerTaxCode,
    providerTaxCode,
    portalOrigin: `${portal.protocol}//${host}`,
    portalHost: host,
    portalProtocol: portal.protocol as 'http:' | 'https:',
    fkey,
  };
}

function endpoint(lookup: SoftdreamsLookup, path: string): string {
  return `${lookup.portalOrigin}${path}`;
}

function cookiePairs(raw: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!raw) return result;
  for (const item of raw.split(/;\s*/)) {
    const equal = item.indexOf('=');
    if (equal <= 0) continue;
    const name = item.slice(0, equal).trim();
    const value = item.slice(equal + 1).trim();
    if (name) result.set(name, value);
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
    if (!name) continue;
    if (!value) values.delete(name);
    else values.set(name, value);
  }
  if (!values.size) return undefined;
  return [...values.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function fetchPortal(
  context: TvanAdapterContext,
  lookup: SoftdreamsLookup,
  url: string,
  init: RequestInit,
  initialCookie?: string,
): Promise<{ response: Response; cookieHeader?: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs);
  timer.unref?.();
  let current = new URL(url);
  let cookieHeader = initialCookie;
  let currentInit: RequestInit = { ...init };

  const assertPortal = (candidate: URL) => {
    const allowedProtocols = lookup.portalProtocol === 'http:' ? ['http:', 'https:'] : ['https:'];
    if (!allowedProtocols.includes(candidate.protocol) || candidate.hostname.toLocaleLowerCase() !== lookup.portalHost) {
      throw new AppError('TVAN_SOFTDREAMS_REDIRECT_REJECTED', 'SoftDreams redirect ra ngoài PortalLink của người bán.', 502);
    }
  };

  try {
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      assertPortal(current);
      const headers = new Headers(currentInit.headers || {});
      headers.set('User-Agent', SOFTDREAMS_BROWSER_UA);
      if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7');
      if (cookieHeader) headers.set('Cookie', cookieHeader);
      const response = await context.fetchImpl(current, {
        ...currentInit,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
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
    throw new AppError('TVAN_SOFTDREAMS_TOO_MANY_REDIRECTS', 'SoftDreams redirect quá nhiều lần.', 502, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AppError('TVAN_TIMEOUT', 'SoftDreams phản hồi quá thời gian chờ.', 504, true);
    }
    throw new AppError('TVAN_NETWORK', 'Không kết nối được cổng EasyInvoice SoftDreams.', 502, true);
  } finally {
    clearTimeout(timer);
  }
}

function imageMimeType(contentType: string, bytes: Buffer): string | undefined {
  const mime = contentType.split(';', 1)[0]?.trim().toLocaleLowerCase();
  if (mime?.startsWith('image/')) return mime;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  return undefined;
}

function deepStringField(value: unknown, names: string[], depth = 0): string | undefined {
  if (depth > 6 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepStringField(item, names, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const normalizedNames = names.map((name) => name.toLocaleLowerCase());
  for (const [key, child] of Object.entries(value)) {
    if (normalizedNames.includes(key.toLocaleLowerCase())) {
      const direct = safeString(child);
      if (direct) return direct;
    }
  }
  for (const child of Object.values(value)) {
    const found = deepStringField(child, names, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function parseDownloadDescriptor(text: string): { fileGuid: string; fileName: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AppError(
      'TVAN_SOFTDREAMS_DOWNLOAD_DESCRIPTOR_INVALID',
      'SoftDreams không trả descriptor JSON hợp lệ.',
      502,
      false,
      undefined,
      { retryStage: 'prepare_artifact', preserveContext: true },
    );
  }
  const fileGuid = deepStringField(value, ['fileGuid', 'guid']);
  const fileName = deepStringField(value, ['fileName', 'filename']);
  if (!fileGuid || !fileName) {
    const providerMessage = deepStringField(value, ['msg', 'message', 'error']);
    throw new AppError(
      providerMessage ? 'TVAN_SOFTDREAMS_PREPARE_PROVIDER_ERROR' : 'TVAN_SOFTDREAMS_DOWNLOAD_DESCRIPTOR_INVALID',
      providerMessage
        ? 'SoftDreams báo lỗi khi tạo file hóa đơn.'
        : 'SoftDreams không trả fileGuid/fileName hợp lệ.',
      502,
      false,
      undefined,
      { retryStage: 'prepare_artifact', preserveContext: true },
    );
  }
  if (
    !/^[A-Za-z0-9-]{16,128}$/.test(fileGuid)
    || fileName.length > 255
    || /[\\/\u0000-\u001f\u007f]/.test(fileName)
  ) {
    throw new AppError(
      'TVAN_SOFTDREAMS_DOWNLOAD_DESCRIPTOR_INVALID',
      'SoftDreams trả fileGuid/fileName không hợp lệ.',
      502,
      false,
      undefined,
      { retryStage: 'prepare_artifact', preserveContext: true },
    );
  }
  return { fileGuid, fileName };
}

function serializeState(state: SoftdreamsTransactionState): string {
  return JSON.stringify(state);
}

function parseState(token: TvanTokenState | undefined, document: InvoiceDocument): SoftdreamsTransactionState | undefined {
  if (!token || token.expiresAt <= Date.now()) return undefined;
  try {
    const parsed = JSON.parse(token.token) as SoftdreamsTransactionState;
    if (
      parsed?.version === 2
      && parsed.providerCode === 'tvan_softdreams'
      && parsed.documentKey === document.key
      && parsed.lookup?.portalHost
      && parsed.lookup?.fkey
      && parsed.search?.invoiceToken
      && parsed.search?.invoiceHtml
      && parsed.expiresAt > Date.now()
    ) return parsed;
  } catch { /* not our token state */ }
  return undefined;
}

function saveState(context: TvanAdapterContext, state: SoftdreamsTransactionState): void {
  context.setToken({ token: serializeState(state), expiresAt: state.expiresAt });
}

function publicLookup(lookup: SoftdreamsLookup): Record<string, string> {
  return {
    portalUrl: lookup.portalOrigin,
    fkey: lookup.fkey,
    sellerTaxCode: lookup.sellerTaxCode,
    providerTaxCode: lookup.providerTaxCode,
  };
}

function defaultPdfName(document: InvoiceDocument): string {
  return safePdfFileName([
    document.seller?.taxCode,
    document.series,
    document.invoiceNo,
  ].filter(Boolean).join('_') || 'EasyInvoice_invoice');
}

function openZip(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, {
      lazyEntries: true,
      autoClose: false,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (error, zip) => {
      if (error || !zip) reject(new AppError('TVAN_SOFTDREAMS_ZIP_INVALID', 'SoftDreams không trả gói ZIP hợp lệ.', 502));
      else resolve(zip);
    });
  });
}

function collectPdfEntries(zip: ZipFile, maxBytes: number): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    let count = 0;
    let totalPdfBytes = 0;
    const fail = (message: string) => {
      zip.removeAllListeners();
      reject(new AppError('TVAN_SOFTDREAMS_ZIP_UNSAFE', message, 502));
    };
    zip.once('error', () => fail('Không đọc được ZIP hóa đơn SoftDreams.'));
    zip.once('end', () => resolve(entries));
    zip.on('entry', (entry) => {
      count += 1;
      if (count > 100 || !isSafeZipEntryName(entry.fileName) || (entry.generalPurposeBitFlag & 1) !== 0 || entry.uncompressedSize > maxBytes) {
        fail('ZIP SoftDreams chứa entry không an toàn, mã hóa hoặc quá lớn.');
        return;
      }
      if (!entry.fileName.endsWith('/') && entry.fileName.toLocaleLowerCase().endsWith('.pdf')) {
        totalPdfBytes += entry.uncompressedSize;
        if (totalPdfBytes > maxBytes) {
          fail('ZIP SoftDreams chứa tổng dung lượng PDF vượt giới hạn cho phép.');
          return;
        }
        entries.push(entry);
      }
      zip.readEntry();
    });
    zip.readEntry();
  });
}

function readZipEntry(zip: ZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new AppError('TVAN_SOFTDREAMS_PDF_EXTRACT_FAILED', 'Không đọc được PDF trong ZIP SoftDreams.', 502));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) stream.destroy(new AppError('TVAN_RESPONSE_TOO_LARGE', 'PDF SoftDreams vượt giới hạn dung lượng.', 502));
        else chunks.push(chunk);
      });
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

async function extractPdfFromZip(bytes: Buffer, preferredZipName: string, maxBytes: number): Promise<{ content: Buffer; fileName: string }> {
  if (!isZip(bytes)) throw new AppError('TVAN_SOFTDREAMS_DOWNLOAD_INVALID', 'SoftDreams không trả PDF hoặc ZIP hợp lệ.', 502, true);
  const zip = await openZip(bytes);
  try {
    const entries = await collectPdfEntries(zip, maxBytes);
    if (!entries.length) throw new AppError('TVAN_SOFTDREAMS_PDF_NOT_FOUND', 'ZIP SoftDreams không chứa file PDF.', 502, true);
    const preferredStem = preferredZipName.replace(/\.zip$/i, '').toLocaleLowerCase();
    const entry = entries.find((item) => item.fileName.replace(/\.pdf$/i, '').toLocaleLowerCase().endsWith(preferredStem))
      || entries.find((item) => /(?:^|\/)hoadon[_-]/i.test(item.fileName))
      || entries[0];
    const content = await readZipEntry(zip, entry, maxBytes);
    ensurePdf(content);
    const leaf = entry.fileName.split('/').pop() || preferredZipName.replace(/\.zip$/i, '.pdf');
    return { content, fileName: safePdfFileName(leaf) };
  } finally {
    zip.close();
  }
}

function artifactTypeOf(bytes: Buffer): SoftdreamsArtifactType {
  if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'pdf';
  if (isZip(bytes)) return 'zip';
  throw new AppError(
    'TVAN_SOFTDREAMS_DOWNLOAD_INVALID',
    'SoftDreams không trả PDF hoặc ZIP hợp lệ.',
    502,
    true,
  );
}

function safeOriginalFileName(fileName: string, kind: SoftdreamsArtifactType): string {
  const fallback = kind === 'pdf' ? 'SoftDreams.pdf' : 'SoftDreams.zip';
  const base = fileName.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 220);
  if (!base) return fallback;
  if (kind === 'pdf') return base.toLocaleLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
  return base.toLocaleLowerCase().endsWith('.zip') ? base : `${base}.zip`;
}

async function fetchProviderArtifact(
  document: InvoiceDocument,
  context: TvanAdapterContext,
  state: SoftdreamsTransactionState,
): Promise<{ content: Buffer; fileName: string; kind: SoftdreamsArtifactType; cookieHeader?: string }> {
  if (state.documentKey !== document.key || !state.descriptor) {
    throw new AppError('TVAN_CAPTCHA_REQUIRED', 'Cần xác thực và chuẩn bị hóa đơn SoftDreams trước khi tải file.', 428, true);
  }
  const downloaded = await fetchPortal(context, state.lookup, state.descriptor.downloadUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/zip,application/pdf,application/octet-stream,*/*',
      Referer: state.pageUrl,
    },
  }, state.cookieHeader);
  if (!downloaded.response.ok) {
    throw new AppError(
      'TVAN_SOFTDREAMS_DOWNLOAD_HTTP_ERROR',
      `SoftDreams trả HTTP ${downloaded.response.status} khi tải hóa đơn.`,
      502,
      downloaded.response.status >= 500,
    );
  }
  const content = await readLimited(downloaded.response, context.maxDownloadBytes);
  const kind = artifactTypeOf(content);
  return {
    content,
    kind,
    fileName: safeOriginalFileName(state.descriptor.fileName, kind),
    cookieHeader: downloaded.cookieHeader,
  };
}

export class SoftdreamsTvanAdapter implements TvanAdapter {
  readonly providerCode = 'tvan_softdreams';
  readonly displayName = 'SoftDreams EasyInvoice';
  readonly captchaMode = 'per_invoice' as const;
  readonly priority = 'P3' as const;

  matches(document: InvoiceDocument): boolean {
    const code = providerCodeOf(document);
    if (code === this.providerCode || code.includes('softdreams')) return true;
    return providerTaxCodeOf(document) === PROVIDER_TAX_CODE;
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    try {
      lookupOf(document);
      return {
        providerCode: this.providerCode,
        displayName: this.displayName,
        supported: true,
        captchaMode: this.captchaMode,
        priority: this.priority,
      };
    } catch (error) {
      return {
        providerCode: this.providerCode,
        displayName: this.displayName,
        supported: false,
        captchaMode: this.captchaMode,
        priority: this.priority,
        reason: error instanceof Error ? error.message : 'Thiếu PortalLink/Fkey SoftDreams.',
      };
    }
  }

  async resolvePresentationLink(
    document: InvoiceDocument,
    _context: TvanAdapterContext,
  ): Promise<TvanPresentationLinkResult> {
    const lookup = lookupOf(document);
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      lookupCode: lookup.fkey,
      sellerTaxCode: lookup.sellerTaxCode,
      providerTaxCode: lookup.providerTaxCode,
      metadataUrl: endpoint(lookup, SEARCH_PAGE_PATH),
      metadataMethod: 'GET',
      resolvedAt: new Date().toISOString(),
      steps: [
        { stage: 'lookup_code', status: 'ok', label: 'Fkey / mã tra cứu', value: lookup.fkey },
        { stage: 'presentation_link', status: 'ready', label: 'Portal EasyInvoice (cần CAPTCHA để tạo link tải)', value: lookup.portalOrigin },
      ],
    };
  }

  async getCaptchaChallenge(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanChallengeResult> {
    const lookup = lookupOf(document);
    const searchPageUrl = endpoint(lookup, SEARCH_PAGE_PATH);

    // Mirror the browser lifecycle before requesting the CAPTCHA. EasyInvoice seller
    // portals can initialize ASP.NET/session state on Search/Index; jumping directly
    // to Captcha/Show is not equivalent to the observed production flow.
    const bootstrap = await fetchPortal(context, lookup, searchPageUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    if (!bootstrap.response.ok) {
      try { await bootstrap.response.body?.cancel(); } catch { /* best effort */ }
      throw new AppError('TVAN_SOFTDREAMS_PORTAL_HTTP_ERROR', `SoftDreams trả HTTP ${bootstrap.response.status} khi khởi tạo trang tra cứu.`, 502, bootstrap.response.status >= 500);
    }
    try { await bootstrap.response.body?.cancel(); } catch { /* best effort */ }

    const captchaUrl = endpoint(lookup, CAPTCHA_PATH);
    const fetched = await fetchPortal(context, lookup, captchaUrl, {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Referer: bootstrap.finalUrl,
      },
    }, bootstrap.cookieHeader);
    if (!fetched.response.ok) {
      throw new AppError('TVAN_SOFTDREAMS_CAPTCHA_HTTP_ERROR', `SoftDreams trả HTTP ${fetched.response.status} khi lấy CAPTCHA.`, 502, fetched.response.status >= 500);
    }
    const bytes = await readLimited(fetched.response, Math.min(CAPTCHA_MAX_BYTES, context.maxDownloadBytes));
    const mimeType = imageMimeType(fetched.response.headers.get('content-type') || '', bytes);
    if (!mimeType) throw new AppError('TVAN_SOFTDREAMS_CAPTCHA_IMAGE_INVALID', 'SoftDreams không trả ảnh CAPTCHA hợp lệ.', 502, true);

    return {
      challenge: {
        id: generateId(),
        providerCode: this.providerCode,
        kind: 'text',
        prompt: 'Nhập mã xác thực hiển thị trên ảnh EasyInvoice.',
        imageBase64: bytes.toString('base64'),
        imageMimeType: mimeType,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
      privateState: {
        ...lookup,
        documentKey: document.key,
        pageUrl: bootstrap.finalUrl,
        cookieHeader: fetched.cookieHeader,
      } satisfies SoftdreamsChallengeState,
      trace: {
        endpoint: captchaUrl,
        method: 'GET',
        responseStatus: fetched.response.status,
        responseContentType: fetched.response.headers.get('content-type') || undefined,
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
    if (!isRecord(privateState)) {
      throw new AppError('TVAN_SOFTDREAMS_CHALLENGE_STATE_INVALID', 'Phiên CAPTCHA SoftDreams không hợp lệ.', 409);
    }
    const lookup = lookupOf(document);
    const challengeState = privateState as unknown as SoftdreamsChallengeState;
    if (
      challengeState.documentKey !== document.key
      || challengeState.portalHost !== lookup.portalHost
      || challengeState.fkey !== lookup.fkey
    ) {
      throw new AppError('TVAN_SOFTDREAMS_CHALLENGE_MISMATCH', 'CAPTCHA không thuộc hóa đơn SoftDreams hiện tại.', 409);
    }

    const captcha = answer.trim();
    if (!captcha) throw new AppError('TVAN_SOFTDREAMS_CAPTCHA_EMPTY', 'Chưa nhập mã xác thực SoftDreams.', 400);

    const searchUrl = endpoint(lookup, SEARCH_PATH);
    const searchBody = new URLSearchParams({ typeSearch: '', FKey: lookup.fkey, Capcha: captcha }).toString();
    const searched = await fetchPortal(context, lookup, searchUrl, {
      method: 'POST',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: lookup.portalOrigin,
        Referer: challengeState.pageUrl,
        'Upgrade-Insecure-Requests': '1',
      },
      body: searchBody,
    }, challengeState.cookieHeader);

    if (!searched.response.ok) {
      const status = searched.response.status;
      if ([400, 401, 403, 422].includes(status)) {
        throw new AppError(
          'TVAN_SOFTDREAMS_CAPTCHA_INVALID',
          'SoftDreams không chấp nhận mã CAPTCHA hoặc thông tin tra cứu.',
          422,
        );
      }
      throw new AppError(
        'TVAN_SOFTDREAMS_SEARCH_HTTP_ERROR',
        `SoftDreams trả HTTP ${status} khi tra cứu Fkey.`,
        502,
        status >= 500,
      );
    }

    const searchBytes = await readLimited(searched.response, context.maxDownloadBytes);
    const searchResult = parseSoftdreamsSearchResponse(searchBytes.toString('utf8'));
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const transaction: SoftdreamsTransactionState = {
      version: 2,
      providerCode: 'tvan_softdreams',
      documentKey: document.key,
      stage: 'search_verified',
      lookup,
      pageUrl: searched.finalUrl,
      cookieHeader: searched.cookieHeader,
      search: searchResult,
      expiresAt,
    };
    saveState(context, transaction);

    const request: TvanRequestTrace = {
      endpoint: searchUrl,
      method: 'POST',
      requestBody: new URLSearchParams({
        typeSearch: '',
        FKey: lookup.fkey,
        Capcha: '[user-entered-captcha]',
      }).toString(),
      responseStatus: searched.response.status,
      responseContentType: searched.response.headers.get('content-type') || undefined,
    };
    const expiry = new Date(expiresAt).toISOString();
    return {
      request,
      tokenExpiresAt: expiry,
      stage: 'search_verified',
      contextExpiresAt: expiry,
    };
  }

  artifactStatus(document: InvoiceDocument, context: TvanAdapterContext): TvanArtifactStatus {
    const state = parseState(context.token, document);
    if (!state) {
      return {
        providerCode: this.providerCode,
        stage: 'new',
        ready: false,
        canRetryPrepare: false,
        canView: false,
        canDownloadPdf: false,
        canDownloadOriginal: false,
      };
    }
    return {
      providerCode: this.providerCode,
      stage: state.stage,
      ready: state.stage === 'pdf_ready',
      canRetryPrepare: ['search_verified', 'representation_ready', 'artifact_descriptor_ready'].includes(state.stage),
      canView: state.stage === 'pdf_ready',
      canDownloadPdf: state.stage === 'pdf_ready',
      canDownloadOriginal: ['original_ready', 'pdf_ready'].includes(state.stage),
      expiresAt: new Date(state.expiresAt).toISOString(),
      originalFileName: state.descriptor?.fileName,
    };
  }

  describeDownloadRequest(document: InvoiceDocument, context: TvanAdapterContext): TvanDownloadRequestPlan {
    const lookup = lookupOf(document);
    const state = parseState(context.token, document);
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      lookup: publicLookup(lookup),
      endpoint: '/api/tvan/pdf/prepare-artifact',
      method: 'POST',
      requestBody: state
        ? '[backend-private SoftDreams transaction]'
        : '[CAPTCHA/Search required before artifact preparation]',
      tokenReady: Boolean(state),
      tokenExpiresAt: state ? new Date(state.expiresAt).toISOString() : undefined,
      plannedAt: new Date().toISOString(),
    };
  }

  async prepareArtifact(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPreparedArtifact> {
    let state = parseState(context.token, document);
    if (!state) {
      throw new AppError(
        'TVAN_CAPTCHA_REQUIRED',
        'Cần xác thực CAPTCHA SoftDreams cho hóa đơn này trước khi tạo bản thể hiện.',
        428,
        true,
      );
    }

    if (!state.representation) {
      const rendered = await renderSoftdreamsRepresentation(state.search);
      state = {
        ...state,
        stage: 'representation_ready',
        representation: {
          html: rendered.html,
          pageCount: rendered.pageCount,
          renderer: rendered.renderer,
          renderedAt: Date.now(),
        },
      };
      saveState(context, state);
    }
    const representation = state.representation;
    if (!representation) {
      throw new AppError('TVAN_SOFTDREAMS_RENDER_FAILED', 'Không tạo được representation SoftDreams.', 502, true);
    }

    if (!state.descriptor) {
      const isDataToolbar = state.search.renderModel.toolbarType.toLocaleUpperCase() === 'DA_LIEU';
      const preparePath = isDataToolbar ? PREPARE_PDF_PATH : PREPARE_DOWNLOAD_PATH;
      const prepareUrl = endpoint(state.lookup, preparePath);
      const form = new URLSearchParams({
        token: state.search.invoiceToken,
        html: Buffer.from(representation.html, 'utf8').toString('base64'),
      });
      if (isDataToolbar) form.set('isImage', 'false');

      const prepared = await fetchPortal(context, state.lookup, prepareUrl, {
        method: 'POST',
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Origin: state.lookup.portalOrigin,
          Referer: state.pageUrl,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: form.toString(),
      }, state.cookieHeader);

      if (!prepared.response.ok) {
        const status = prepared.response.status;
        if (status === 408) {
          throw new AppError(
            'TVAN_SOFTDREAMS_PREPARE_DOWNLOAD_TIMEOUT',
            'SoftDreams quá thời gian xử lý khi tạo file hóa đơn.',
            504,
            true,
            undefined,
            {
              retryMode: 'manual',
              retryStage: 'prepare_artifact',
              preserveContext: true,
              outcomeUnknown: true,
            },
          );
        }
        throw new AppError(
          'TVAN_SOFTDREAMS_PREPARE_DOWNLOAD_HTTP_ERROR',
          `SoftDreams trả HTTP ${status} khi tạo file tải.`,
          502,
          status >= 500,
          undefined,
          {
            retryMode: 'manual',
            retryStage: 'prepare_artifact',
            preserveContext: true,
          },
        );
      }

      const prepareBytes = await readLimited(
        prepared.response,
        Math.min(context.maxDownloadBytes, 2 * 1024 * 1024),
      );
      const descriptor = parseDownloadDescriptor(prepareBytes.toString('utf8'));

      const downloadUrl = new URL(endpoint(state.lookup, DOWNLOAD_PATH));
      downloadUrl.searchParams.set('fileGuid', descriptor.fileGuid);
      downloadUrl.searchParams.set('fileName', descriptor.fileName);
      state = {
        ...state,
        stage: 'artifact_descriptor_ready',
        cookieHeader: prepared.cookieHeader,
        descriptor: {
          ...descriptor,
          downloadUrl: downloadUrl.toString(),
          preparedAt: Date.now(),
        },
      };
      saveState(context, state);
    }

    const original = await fetchProviderArtifact(document, context, state);
    state = {
      ...state,
      stage: 'original_ready',
      cookieHeader: original.cookieHeader || state.cookieHeader,
    };
    saveState(context, state);

    let result: TvanPreparedArtifact;
    if (original.kind === 'pdf') {
      ensurePdf(original.content);
      const pdfFileName = safePdfFileName(original.fileName);
      result = {
        original: original.content,
        originalFileName: original.fileName,
        originalContentType: 'application/pdf',
        pdf: original.content,
        pdfFileName,
      };
    } else {
      const extracted = await extractPdfFromZip(
        original.content,
        original.fileName,
        context.maxDownloadBytes,
      );
      result = {
        original: original.content,
        originalFileName: original.fileName,
        originalContentType: 'application/zip',
        pdf: extracted.content,
        pdfFileName: extracted.fileName,
      };
    }

    state = { ...state, stage: 'pdf_ready' };
    saveState(context, state);
    return result;
  }

  async downloadOriginal(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanOriginalFileResult> {
    const state = parseState(context.token, document);
    if (!state?.descriptor) {
      throw new AppError(
        'TVAN_CAPTCHA_REQUIRED',
        'Cần xác thực và chuẩn bị hóa đơn SoftDreams trước khi tải file gốc.',
        428,
        true,
      );
    }
    const artifact = await fetchProviderArtifact(document, context, state);
    return {
      content: artifact.content,
      fileName: artifact.fileName,
      contentType: artifact.kind === 'pdf' ? 'application/pdf' : 'application/zip',
    };
  }

  async downloadArtifact(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPreparedArtifact> {
    return this.prepareArtifact(document, context);
  }

  async downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult> {
    const artifact = await this.prepareArtifact(document, context);
    return {
      content: artifact.pdf,
      contentType: 'application/pdf',
      fileName: artifact.pdfFileName,
    };
  }
}
