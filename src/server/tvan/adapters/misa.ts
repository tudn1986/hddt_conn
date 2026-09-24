import type {
  InvoiceDocument,
  TvanPresentationLinkResult,
  TvanProviderCapability,
} from '../../../shared/models/index.js';
import { AppError, isRecord, safeString } from '../../../shared/utils/index.js';
import { findNamedValue, lookupCodeOf, providerCodeOf } from '../extract.js';
import {
  assertAllowedUrl,
  ensurePdf,
  fetchWithTimeout,
  readJson,
  readLimited,
  responseFileName,
  safePdfFileName,
} from '../http.js';
import type { TvanAdapter, TvanAdapterContext, TvanPdfResult } from '../types.js';

const ORIGIN = 'https://www.meinvoice.vn';
const BARE_ORIGIN = 'https://meinvoice.vn';
const ALLOWED_HOSTS = ['www.meinvoice.vn', 'meinvoice.vn', 'download.meinvoice.vn', 'meinvoice.misacdn.net'] as const;
const META_ENDPOINTS = [
  `${ORIGIN}/tra-cuu/GetInvoiceDataByTransactionID`,
  `${ORIGIN}/tra-cuu/GetEinvoiceByTransactionID`,
] as const;
const REQUEST_TIME_ENDPOINTS = [
  `${BARE_ORIGIN}/tra-cuu/GetRequestTimeEnCode`,
  `${ORIGIN}/tra-cuu/GetRequestTimeEnCode`,
] as const;
const LEGACY_DOWNLOAD_ORIGIN = 'https://download.meinvoice.vn';
const PRODUCTION_DOWNLOAD_PATH = '/tra-cuu/tra-cuu/DownloadHandler.ashx';

function productionDownloadUrl(transactionId: string, ext: string): string {
  const target = new URL(PRODUCTION_DOWNLOAD_PATH, ORIGIN);
  target.searchParams.set('Type', 'pdf');
  target.searchParams.set('Viewer', '1');
  target.searchParams.set('ext', ext);
  target.searchParams.set('Code', transactionId);
  return target.toString();
}

function transactionIdOf(document: InvoiceDocument): string | undefined {
  const explicit = findNamedValue(document, ['TransactionID', 'transactionID']);
  if (explicit) return explicit;
  if (document.lookup?.lookupCodeType?.toLocaleLowerCase() === 'transactionid') return lookupCodeOf(document);
  return providerCodeOf(document).includes('misa') ? lookupCodeOf(document) : undefined;
}

function defaultName(document: InvoiceDocument): string {
  return safePdfFileName([
    document.seller?.taxCode,
    document.series,
    document.invoiceNo,
  ].filter(Boolean).join('_') || 'MISA_invoice');
}

function collectUrlCandidates(value: unknown): string[] {
  const urls: string[] = [];
  const visit = (node: unknown, depth = 0) => {
    if (depth > 6 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (typeof node === 'string') {
      const text = node.trim();
      if (/^(?:https?:\/\/|\/)/i.test(text) && /(pdf|report|download|view|handler)/i.test(text)) urls.push(text);
      if (text.startsWith('{') || text.startsWith('[')) {
        try { visit(JSON.parse(text) as unknown, depth + 1); } catch { /* ordinary string */ }
      }
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (typeof child === 'string') {
        const text = child.trim();
        if (/^(?:https?:\/\/|\/)/i.test(text) && /(pdf|report|download|view|handler)/i.test(`${key} ${text}`)) urls.push(text);
        try {
          const decoded = JSON.parse(text) as unknown;
          if (decoded && typeof decoded === 'object') visit(decoded, depth + 1);
        } catch { /* ordinary string */ }
      } else if (Array.isArray(child) || isRecord(child)) {
        visit(child, depth + 1);
      }
    }
  };
  visit(value);
  return [...new Set(urls)];
}

function requestTimeExtension(payload: string): string | undefined {
  const raw = payload.trim();
  if (!raw) return undefined;

  // MISA's own browser sample takes SubString(55, 8) from the raw HTTP response.
  // Do this before JSON decoding: decoding can remove quotes/escapes and shift the offset.
  if (raw.length >= 63) {
    const token = raw.slice(55, 63);
    if (/^[A-Za-z0-9_-]{8}$/.test(token)) return token;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string') {
      const nested = parsed.trim();
      if (/^[A-Za-z0-9_-]{8}$/.test(nested)) return nested;
      if (nested.length >= 63) {
        const token = nested.slice(55, 63);
        if (/^[A-Za-z0-9_-]{8}$/.test(token)) return token;
      }
    }
    if (isRecord(parsed)) {
      for (const key of ['customData', 'CustomData', 'data', 'Data', 'ext', 'extension', 'code', 'value']) {
        const value = safeString(parsed[key]);
        if (!value) continue;
        const text = value.trim();
        if (/^[A-Za-z0-9_-]{8}$/.test(text)) return text;
        const nested = requestTimeExtension(text);
        if (nested) return nested;
      }
    }
  } catch { /* endpoint may return an opaque encoded string */ }

  const exact = raw.match(/(?:^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{8})(?:[^A-Za-z0-9_-]|$)/)?.[1];
  return exact;
}

function metadataExtension(payloads: unknown[]): string | undefined {
  for (const payload of payloads) {
    if (!isRecord(payload)) continue;
    // The supplied production captures from GetInvoiceDataByTransactionID contain
    // customData such as "1_73XNGR" / "G0NL2642". This is exactly the 8-char
    // extension shape used by MISA's documented downloadhandler browser flow.
    for (const key of ['customData', 'CustomData']) {
      const value = safeString(payload[key])?.trim();
      if (value && /^[A-Za-z0-9_-]{8}$/.test(value) && value.toLocaleLowerCase() !== 'false') return value;
    }
  }
  return undefined;
}

function lookupUrlCandidate(document: InvoiceDocument): string | undefined {
  const base = safeString(document.lookup?.lookupBaseUrl);
  const rawPath = safeString(document.lookup?.lookupPathRaw);
  if (!base && !rawPath) return undefined;
  try {
    const url = base ? new URL(rawPath || '/', base) : new URL(rawPath!);
    if (!(ALLOWED_HOSTS as readonly string[]).includes(url.hostname.toLocaleLowerCase())) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

async function tryPdfRequest(
  url: string,
  transactionId: string,
  context: TvanAdapterContext,
  visited: Set<string> = new Set(),
  depth = 0,
): Promise<{ bytes: Buffer; response: Response } | null> {
  if (depth > 4) return null;
  const target = assertAllowedUrl(url.startsWith('/') ? `${ORIGIN}${url}` : url, ALLOWED_HOSTS);
  const targetKey = target.href;
  if (visited.has(targetKey)) return null;
  visited.add(targetKey);
  const attempts: RequestInit[] = [
    { method: 'GET', headers: { Accept: 'application/pdf,*/*', Referer: `${ORIGIN}/tra-cuu/` } },
    {
      method: 'POST',
      headers: {
        Accept: 'application/pdf,*/*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Referer: `${ORIGIN}/tra-cuu/`,
      },
      body: new URLSearchParams({ code: transactionId, transactionID: transactionId }),
    },
  ];
  for (const init of attempts) {
    const response = await fetchWithTimeout(context.fetchImpl, target, init, context.timeoutMs, ALLOWED_HOSTS);
    if (!response.ok) continue;
    const type = response.headers.get('content-type') || '';
    if (type.includes('application/json') || type.includes('text/json')) {
      const body = await readJson(response, Math.min(context.maxDownloadBytes, 4 * 1024 * 1024)).catch(() => undefined);
      const nested = collectUrlCandidates(body);
      for (const candidate of nested) {
        const resolved = await tryPdfRequest(candidate, transactionId, context, visited, depth + 1).catch(() => null);
        if (resolved) return resolved;
      }
      continue;
    }
    const bytes = await readLimited(response, context.maxDownloadBytes);
    if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return { bytes, response };
  }
  return null;
}

async function tryDocumentedPublicDownload(
  transactionId: string,
  context: TvanAdapterContext,
  preferredExt?: string,
): Promise<{ bytes: Buffer; response: Response } | null> {
  const tryExt = async (ext: string): Promise<{ bytes: Buffer; response: Response } | null> => {
    const candidates: string[] = [];

    // Production MISA contract confirmed from the browser:
    //   ext  = customData returned by GetInvoiceDataByTransactionID
    //   Code = TransactionID / lookup code
    //   GET https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx
    //       ?Type=pdf&Viewer=1&ext=<customData>&Code=<TransactionID>
    // Keep parameter names/casing and path exactly as observed; some ASP.NET handlers
    // are tolerant, but the adapter should reproduce the production request first.
    candidates.push(productionDownloadUrl(transactionId, ext));

    // Compatibility probes for older/public meInvoice builds. These are deliberately
    // after the confirmed production route and are accepted only when bytes are %PDF-.
    const legacy = new URL('/downloadhandler.ashx', LEGACY_DOWNLOAD_ORIGIN);
    legacy.searchParams.set('type', 'pdf');
    legacy.searchParams.set('code', transactionId);
    legacy.searchParams.set('viewer', '1');
    legacy.searchParams.set('ext', ext);
    candidates.push(legacy.toString());

    for (const origin of [ORIGIN, BARE_ORIGIN]) {
      const target = new URL('/tra-cuu/downloadhandler.ashx', origin);
      target.searchParams.set('type', 'pdf');
      target.searchParams.set('code', transactionId);
      target.searchParams.set('Viewer', '1');
      target.searchParams.set('SearchType', '2');
      target.searchParams.set('ext', ext);
      candidates.push(target.toString());
    }

    for (const candidate of candidates) {
      const result = await tryPdfRequest(candidate, transactionId, context).catch(() => null);
      if (result) return result;
    }
    return null;
  };

  // Production contract: customData is the PDF handler `ext`. Do not replace it with
  // a request-time token when it is present. This also avoids an unnecessary network
  // request before every invoice preview/download.
  if (preferredExt) return tryExt(preferredExt);

  // Backward compatibility only: older captures may not expose customData. In that
  // case retain the documented request-time flow as a last-resort adapter path.
  for (const endpoint of REQUEST_TIME_ENDPOINTS) {
    const timeResponse = await fetchWithTimeout(context.fetchImpl, assertAllowedUrl(endpoint, ALLOWED_HOSTS), {
      method: 'GET',
      headers: { Accept: 'application/json,text/plain,*/*', Referer: `${ORIGIN}/tra-cuu/` },
    }, context.timeoutMs, ALLOWED_HOSTS).catch(() => undefined);
    if (!timeResponse?.ok) continue;
    const timePayload = (await readLimited(timeResponse, 128 * 1024)).toString('utf8');
    const ext = requestTimeExtension(timePayload);
    if (!ext) continue;
    const documented = await tryExt(ext);
    if (documented) return documented;
  }

  return null;
}

async function fetchMetadata(transactionId: string, context: TvanAdapterContext): Promise<unknown[]> {
  const bodies: Array<() => BodyInit> = [
    () => new URLSearchParams({ transactionID: transactionId }),
    () => new URLSearchParams({ transactionId }),
    () => new URLSearchParams({ code: transactionId }),
    () => transactionId,
  ];
  const payloads: unknown[] = [];
  let lastStatus = 0;
  let lastError: unknown;

  for (const endpoint of META_ENDPOINTS) {
    for (const bodyFactory of bodies) {
      try {
        const body = bodyFactory();
        const response = await fetchWithTimeout(context.fetchImpl, assertAllowedUrl(endpoint, ALLOWED_HOSTS), {
          method: 'POST',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            Origin: ORIGIN,
            Referer: `${ORIGIN}/tra-cuu/`,
          },
          body,
        }, context.timeoutMs, ALLOWED_HOSTS);
        lastStatus = response.status;
        if (!response.ok) continue;
        const payload = await readJson(response, Math.min(context.maxDownloadBytes, 8 * 1024 * 1024));
        if (isRecord(payload) && payload.success === false) {
          lastError = new AppError('TVAN_MISA_LOOKUP_REJECTED', safeString(payload.errorCode) || 'MISA từ chối mã tra cứu.', 502, true);
          continue;
        }
        payloads.push(payload);
        // Do not spam every body variant after a valid response from the same endpoint.
        break;
      } catch (error) {
        lastError = error;
      }
    }
    // Production contract is GetInvoiceDataByTransactionID. Once it succeeds, do not
    // call compatibility metadata routes unnecessarily.
    if (payloads.length) return payloads;
  }

  if (payloads.length) return payloads;
  if (lastError instanceof AppError) throw lastError;
  throw new AppError('TVAN_MISA_LOOKUP_FAILED', `MISA trả HTTP ${lastStatus || 'không xác định'}.`, 502, true);
}

async function fetchProductionMetadata(
  transactionId: string,
  context: TvanAdapterContext,
): Promise<unknown> {
  const endpoint = META_ENDPOINTS[0];
  const response = await fetchWithTimeout(context.fetchImpl, assertAllowedUrl(endpoint, ALLOWED_HOSTS), {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Origin: ORIGIN,
      Referer: `${ORIGIN}/tra-cuu/`,
    },
    body: new URLSearchParams({ transactionID: transactionId }),
  }, context.timeoutMs, ALLOWED_HOSTS);

  if (!response.ok) {
    throw new AppError(
      'TVAN_MISA_LOOKUP_FAILED',
      `MISA GetInvoiceDataByTransactionID trả HTTP ${response.status}.`,
      502,
      response.status >= 500,
    );
  }

  const payload = await readJson(response, Math.min(context.maxDownloadBytes, 8 * 1024 * 1024));
  if (isRecord(payload) && payload.success === false) {
    throw new AppError(
      'TVAN_MISA_LOOKUP_REJECTED',
      safeString(payload.errorCode) || 'MISA từ chối mã tra cứu.',
      502,
      true,
    );
  }
  return payload;
}

export class MisaTvanAdapter implements TvanAdapter {
  readonly providerCode = 'tvan_misa';
  readonly displayName = 'MISA meInvoice';
  readonly captchaMode = 'none' as const;
  readonly priority = 'P1' as const;

  matches(document: InvoiceDocument): boolean {
    return providerCodeOf(document).includes('misa');
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    const transactionId = transactionIdOf(document);
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      supported: Boolean(transactionId),
      captchaMode: this.captchaMode,
      priority: this.priority,
      reason: transactionId ? undefined : 'Thiếu TransactionID/Mã tra cứu MISA trong payload GDT.',
    };
  }

  async resolvePresentationLink(
    document: InvoiceDocument,
    context: TvanAdapterContext,
  ): Promise<TvanPresentationLinkResult> {
    const transactionId = transactionIdOf(document);
    if (!transactionId) {
      throw new AppError('TVAN_LOOKUP_MISSING', 'Không tìm thấy TransactionID/Mã tra cứu của hóa đơn MISA.', 422);
    }

    // Supervised MISA flow: use only the production metadata contract so the UI
    // shows exactly what was queried and what value was returned.
    const payload = await fetchProductionMetadata(transactionId, context);
    const customData = metadataExtension([payload]);
    if (!customData) {
      throw new AppError(
        'TVAN_MISA_CUSTOM_DATA_MISSING',
        'MISA đã trả metadata nhưng không có customData hợp lệ để tạo link bản thể hiện.',
        502,
        true,
      );
    }

    const metadataRequestBody = new URLSearchParams({ transactionID: transactionId }).toString();
    const downloadUrl = productionDownloadUrl(transactionId, customData);
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      lookupCode: transactionId,
      customData,
      metadataUrl: META_ENDPOINTS[0],
      metadataMethod: 'POST',
      metadataRequestBody,
      downloadUrl,
      resolvedAt: new Date().toISOString(),
      steps: [
        {
          stage: 'lookup_code',
          status: 'ok',
          label: 'Mã tra cứu / TransactionID',
          value: transactionId,
        },
        {
          stage: 'metadata',
          status: 'ok',
          label: 'GetInvoiceDataByTransactionID',
          value: META_ENDPOINTS[0],
        },
        {
          stage: 'custom_data',
          status: 'ok',
          label: 'customData',
          value: customData,
        },
        {
          stage: 'presentation_link',
          status: 'ready',
          label: 'DownloadHandler PDF',
          value: downloadUrl,
        },
      ],
    };
  }

  async downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult> {
    const transactionId = transactionIdOf(document);
    if (!transactionId) throw new AppError('TVAN_LOOKUP_MISSING', 'Không tìm thấy TransactionID của hóa đơn MISA.', 422);

    // The supplied production capture is GetInvoiceDataByTransactionID with body transactionID=<id>.
    // Keep GetEinvoiceByTransactionID as a compatibility probe, but no longer make it the only metadata route.
    const metadata = await fetchMetadata(transactionId, context).catch(() => []);

    // Confirmed production MISA path: customData from metadata is the PDF handler
    // `ext`; TransactionID is the handler `Code`. Try this before any generic URL
    // discovery so preview/batch performs the minimum production requests.
    const documented = await tryDocumentedPublicDownload(
      transactionId,
      context,
      metadataExtension(metadata),
    ).catch(() => null);
    if (documented) {
      ensurePdf(documented.bytes);
      return {
        content: documented.bytes,
        contentType: 'application/pdf',
        fileName: responseFileName(documented.response) || defaultName(document),
      };
    }

    // Compatibility only: follow an allow-listed lookup/report URL when supplied by
    // normalized data or by a legacy MISA metadata response.
    const lookupUrl = lookupUrlCandidate(document);
    const candidates = [lookupUrl, ...metadata.flatMap((payload) => collectUrlCandidates(payload))]
      .filter((value): value is string => Boolean(value));
    for (const candidate of candidates) {
      const result = await tryPdfRequest(candidate, transactionId, context).catch(() => null);
      if (result) {
        ensurePdf(result.bytes);
        return {
          content: result.bytes,
          contentType: 'application/pdf',
          fileName: responseFileName(result.response) || defaultName(document),
        };
      }
    }

    // Keep a very small compatibility set for older public lookup builds. These are all same-provider,
    // allow-listed routes and are accepted only if the returned bytes begin with %PDF-.
    const probes = [
      `/tra-cuu/DownloadInvoicePDF?transactionID=${encodeURIComponent(transactionId)}`,
      `/tra-cuu/DownloadPDF?transactionID=${encodeURIComponent(transactionId)}`,
      `/tra-cuu/DownloadInvoice?transactionID=${encodeURIComponent(transactionId)}`,
      `/tra-cuu/DownloadEinvoice?code=${encodeURIComponent(transactionId)}`,
      `/tra-cuu/GetInvoicePDFByTransactionID?transactionID=${encodeURIComponent(transactionId)}`,
    ];
    for (const probe of probes) {
      const result = await tryPdfRequest(probe, transactionId, context).catch(() => null);
      if (result) {
        ensurePdf(result.bytes);
        return {
          content: result.bytes,
          contentType: 'application/pdf',
          fileName: responseFileName(result.response) || defaultName(document),
        };
      }
    }

    throw new AppError(
      'TVAN_MISA_PDF_ROUTE_UNKNOWN',
      'MISA đã trả metadata nhưng không tải được PDF từ /tra-cuu/tra-cuu/DownloadHandler.ashx với ext=customData và Code=TransactionID. Hãy lưu raw response HTTP của request PDF tại TVAN Backport nếu route production thay đổi.',
      502,
    );
  }
}
