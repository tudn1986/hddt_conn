import { createHash } from 'node:crypto';
import type {
  InvoiceDocument,
  TvanArtifactStatus,
  TvanCaptchaChallenge,
  TvanProviderCapability,
  TvanRequestTrace,
} from '../../../shared/models/index.js';
import { AppError, generateId, isRecord, safeString } from '../../../shared/utils/index.js';
import { readLimited } from '../http.js';
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
import {
  isThaisonDocument,
  publicThaisonLookup,
  resolveThaisonLookup,
  type ThaisonLookup,
} from './thaison/lookup.js';
import { fetchThaisonPortal } from './thaison/http.js';
import {
  parseCaptchaBootstrapHtml,
  parseThaisonDetailHtml,
  parseThaisonLookupResultHtml,
  resolveDownloadDescriptor,
  type ThaisonDownloadDescriptor,
} from './thaison/parser.js';
import {
  contentDispositionFileName,
  detectThaisonOriginalKind,
  normalizedPdfFromOriginal,
  safeThaisonOriginalFileName,
  type ThaisonOriginalKind,
} from './thaison/artifact.js';
import { ThaisonBrowserSessionManager, type ThaisonBrowserGateway } from './thaison-browser.js';

const PROVIDER_CODE = 'tvan_thaison';
const SESSION_TTL_MS = 10 * 60_000;
const CAPTCHA_MAX_BYTES = 512 * 1024;
const HTML_MAX_BYTES = 2 * 1024 * 1024;

type TransactionStage =
  | 'search_verified'
  | 'representation_ready'
  | 'artifact_descriptor_ready'
  | 'original_ready'
  | 'pdf_ready';

type ThaisonChallengeState = {
  version: 1;
  providerCode: typeof PROVIDER_CODE;
  documentKey: string;
  binding: string;
  lookup: ThaisonLookup;
  pageUrl: string;
  cookieHeader?: string;
  captchaOpaqueId: string;
  expiresAt: number;
};

type ThaisonSharedChallengeState = {
  version: 1;
  providerCode: typeof PROVIDER_CODE;
  profile: 'shared_v1';
  documentKey: string;
  binding: string;
  browserChallengeId: string;
  expiresAt: number;
};

type ThaisonSharedTransactionState = {
  version: 1;
  providerCode: typeof PROVIDER_CODE;
  profile: 'shared_v1';
  documentKey: string;
  binding: string;
  stage: 'pdf_ready';
  artifactId: string;
  pdfFileName: string;
  expiresAt: number;
};

type ThaisonSharedArtifact = {
  documentKey: string;
  binding: string;
  content: Buffer;
  fileName: string;
  expiresAt: number;
};

type ThaisonTransactionState = {
  version: 1;
  providerCode: typeof PROVIDER_CODE;
  documentKey: string;
  binding: string;
  stage: TransactionStage;
  lookup: ThaisonLookup;
  cookieHeader?: string;
  search: {
    resultUrl: string;
    htmlDigest: string;
    detailPath: string;
    descriptors: ThaisonDownloadDescriptor[];
    verifiedAt: number;
  };
  descriptor?: ThaisonDownloadDescriptor & {
    resolvedAt: number;
  };
  original?: {
    kind: ThaisonOriginalKind;
    fileName: string;
    digest: string;
    fetchedAt: number;
  };
  pdf?: {
    fileName: string;
    digest: string;
    normalizedAt: number;
  };
  expiresAt: number;
};

type PreparedOriginal = {
  content: Buffer;
  kind: ThaisonOriginalKind;
  fileName: string;
  state: ThaisonTransactionState;
};

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function bindingOf(document: InvoiceDocument, lookup: ThaisonLookup): string {
  return digest(`${document.key}\\n${lookup.portalHost}\\n${lookup.lookupCode}`);
}

function isTenantLookup(value: unknown): value is ThaisonLookup {
  if (!isRecord(value)) return false;
  return safeString(value.portalOrigin)?.startsWith('https://') === true
    && Boolean(safeString(value.portalHost))
    && Boolean(safeString(value.lookupCode))
    && Boolean(safeString(value.sellerTaxCode))
    && value.portalProtocol === 'https:'
    && value.profile === 'tenant_v1';
}

function sharedChallengeStateOf(value: unknown): ThaisonSharedChallengeState | undefined {
  if (!isRecord(value)) return undefined;
  const state = value as unknown as ThaisonSharedChallengeState;
  if (
    state.version !== 1
    || state.providerCode !== PROVIDER_CODE
    || state.profile !== 'shared_v1'
    || !safeString(state.documentKey)
    || !safeString(state.binding)
    || !safeString(state.browserChallengeId)
    || !Number.isFinite(state.expiresAt)
  ) return undefined;
  return state;
}

function parseSharedState(token: TvanTokenState | undefined, document: InvoiceDocument): ThaisonSharedTransactionState | undefined {
  if (!token || token.expiresAt <= Date.now()) return undefined;
  try {
    const parsed = JSON.parse(token.token) as ThaisonSharedTransactionState;
    if (
      parsed?.version === 1
      && parsed.providerCode === PROVIDER_CODE
      && parsed.profile === 'shared_v1'
      && parsed.documentKey === document.key
      && parsed.stage === 'pdf_ready'
      && Boolean(safeString(parsed.binding))
      && Boolean(safeString(parsed.artifactId))
      && Boolean(safeString(parsed.pdfFileName))
      && parsed.expiresAt > Date.now()
    ) return parsed;
  } catch {
    // Not a shared Thái Sơn transaction token.
  }
  return undefined;
}

function challengeStateOf(value: unknown): ThaisonChallengeState | undefined {
  if (!isRecord(value) || !isTenantLookup(value.lookup)) return undefined;
  const state = value as unknown as ThaisonChallengeState;
  if (
    state.version !== 1
    || state.providerCode !== PROVIDER_CODE
    || !safeString(state.documentKey)
    || !safeString(state.binding)
    || !safeString(state.pageUrl)
    || !safeString(state.captchaOpaqueId)
    || !Number.isFinite(state.expiresAt)
  ) return undefined;
  return state;
}

function parseState(token: TvanTokenState | undefined, document: InvoiceDocument): ThaisonTransactionState | undefined {
  if (!token || token.expiresAt <= Date.now()) return undefined;
  try {
    const parsed = JSON.parse(token.token) as ThaisonTransactionState;
    if (
      parsed?.version === 1
      && parsed.providerCode === PROVIDER_CODE
      && parsed.documentKey === document.key
      && isTenantLookup(parsed.lookup)
      && parsed.binding === bindingOf(document, parsed.lookup)
      && parsed.search?.detailPath
      && parsed.expiresAt > Date.now()
    ) return parsed;
  } catch {
    // Not a Thái Sơn transaction token.
  }
  return undefined;
}

function saveState(context: TvanAdapterContext, state: ThaisonTransactionState): void {
  context.setToken({
    token: JSON.stringify(state),
    expiresAt: state.expiresAt,
  });
}

function imageMimeType(contentType: string, bytes: Buffer): string | undefined {
  const mime = contentType.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US');
  if (
    bytes.subarray(0, 6).toString('ascii') === 'GIF87a'
    || bytes.subarray(0, 6).toString('ascii') === 'GIF89a'
  ) return 'image/gif';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return mime?.startsWith('image/') ? mime : undefined;
}

function endpoint(lookup: ThaisonLookup, path: string): string {
  const url = new URL(path, lookup.portalOrigin);
  if (url.origin !== lookup.portalOrigin) {
    throw new AppError('TVAN_THAISON_PORTAL_REJECTED', 'Endpoint Thái Sơn rời khỏi tenant portal hiện tại.', 502);
  }
  return url.toString();
}

function validateDetailIdentity(document: InvoiceDocument, visibleText: string): void {
  const normalized = visibleText.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const compact = normalized.toLocaleUpperCase('vi-VN').replace(/\s+/g, '');
  const seller = String(document.seller?.taxCode || '').trim().toLocaleUpperCase('vi-VN').replace(/\s+/g, '');
  const series = String(document.series || '').trim().toLocaleUpperCase('vi-VN').replace(/\s+/g, '');
  const templateSeries = `${document.templateNo ?? ''}${series}`;
  const invoiceNo = String(document.invoiceNo ?? '').trim();

  if (!seller || !compact.includes(seller)) {
    throw new AppError('TVAN_THAISON_INVOICE_MISMATCH', 'Bản thể hiện Thái Sơn không khớp MST người bán của hóa đơn.', 422);
  }
  if (series && !compact.includes(series) && !compact.includes(templateSeries)) {
    throw new AppError('TVAN_THAISON_INVOICE_MISMATCH', 'Bản thể hiện Thái Sơn không khớp ký hiệu hóa đơn.', 422);
  }
  if (invoiceNo) {
    const escaped = invoiceNo.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const invoicePattern = new RegExp(`(?:^|\\D)0*${escaped}(?:\\D|$)`);
    if (!invoicePattern.test(normalized)) {
      throw new AppError('TVAN_THAISON_INVOICE_MISMATCH', 'Bản thể hiện Thái Sơn không khớp số hóa đơn.', 422);
    }
  }
}

function publicTrace(endpointUrl: string, method: 'GET' | 'POST', response?: Response): TvanRequestTrace {
  const url = new URL(endpointUrl);
  return {
    endpoint: `${url.origin}${url.pathname}`,
    method,
    responseStatus: response?.status,
    responseContentType: response?.headers.get('content-type') || undefined,
  };
}

async function readHtml(response: Response, maxBytes: number): Promise<string> {
  const bytes = await readLimited(response, Math.min(maxBytes, HTML_MAX_BYTES));
  return bytes.toString('utf8');
}

export class ThaisonTvanAdapter implements TvanAdapter {
  readonly providerCode = PROVIDER_CODE;
  readonly displayName = 'Thái Sơn EInvoice';
  readonly captchaMode = 'per_invoice' as const;
  readonly priority = 'P3' as const;
  readonly challengeSingleUse = true;
  private readonly sharedArtifacts = new Map<string, ThaisonSharedArtifact>();

  constructor(
    private readonly browserGateway: ThaisonBrowserGateway = new ThaisonBrowserSessionManager(),
  ) {}

  private sharedArtifact(document: InvoiceDocument, context: TvanAdapterContext): { state: ThaisonSharedTransactionState; artifact: ThaisonSharedArtifact } | undefined {
    const state = parseSharedState(context.token, document);
    if (!state) return undefined;
    let lookup: ThaisonLookup;
    try {
      lookup = resolveThaisonLookup(document);
    } catch {
      return undefined;
    }
    if (lookup.profile !== 'shared_v1' || state.binding !== bindingOf(document, lookup)) return undefined;
    const artifact = this.sharedArtifacts.get(state.artifactId);
    if (!artifact || artifact.expiresAt <= Date.now() || artifact.documentKey !== document.key || artifact.binding !== state.binding) {
      if (artifact) this.sharedArtifacts.delete(state.artifactId);
      context.setToken(undefined);
      return undefined;
    }
    return { state, artifact };
  }

  cacheDiscriminator(document: InvoiceDocument): string | undefined {
    try {
      const lookup = resolveThaisonLookup(document);
      return bindingOf(document, lookup);
    } catch {
      return undefined;
    }
  }

  matches(document: InvoiceDocument): boolean {
    return isThaisonDocument(document);
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    try {
      resolveThaisonLookup(document);
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
        reason: error instanceof Error ? error.message : 'Thái Sơn chưa đủ evidence để enable portal này.',
      };
    }
  }

  async getCaptchaChallenge(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanChallengeResult> {
    context.setToken(undefined);
    const lookup = resolveThaisonLookup(document);
    if (lookup.profile === 'shared_v1') {
      const portalUrl = endpoint(lookup, '/tra-cuu');
      const browserChallenge = await this.browserGateway.createChallenge({
        documentKey: document.key,
        lookupCode: lookup.lookupCode,
        portalUrl,
        timeoutMs: context.timeoutMs,
        maxDownloadBytes: context.maxDownloadBytes,
      });
      const privateState: ThaisonSharedChallengeState = {
        version: 1,
        providerCode: PROVIDER_CODE,
        profile: 'shared_v1',
        documentKey: document.key,
        binding: bindingOf(document, lookup),
        browserChallengeId: browserChallenge.challengeId,
        expiresAt: browserChallenge.expiresAt,
      };
      return {
        challenge: {
          id: browserChallenge.challengeId,
          providerCode: this.providerCode,
          kind: 'text',
          prompt: 'Nhập mã xác thực hiển thị trên ảnh Thái Sơn EInvoice.',
          imageBase64: browserChallenge.imageBase64,
          imageMimeType: browserChallenge.imageMimeType,
          expiresAt: new Date(browserChallenge.expiresAt).toISOString(),
        },
        privateState,
        trace: publicTrace(portalUrl, 'GET'),
      };
    }
    const bootstrapUrl = endpoint(lookup, '/');
    const bootstrap = await fetchThaisonPortal(context, lookup, bootstrapUrl, {
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
      throw new AppError(
        'TVAN_THAISON_CAPTCHA_BOOTSTRAP_FAILED',
        `Tenant Thái Sơn trả HTTP ${bootstrap.response.status} khi mở trang tra cứu.`,
        502,
        bootstrap.response.status >= 500,
      );
    }

    const bootstrapHtml = await readHtml(bootstrap.response, context.maxDownloadBytes);
    const parsed = parseCaptchaBootstrapHtml(bootstrapHtml);
    const imageUrl = endpoint(lookup, parsed.imagePath);
    const image = await fetchThaisonPortal(context, lookup, imageUrl, {
      method: 'GET',
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Referer: bootstrap.finalUrl,
      },
    }, bootstrap.cookieHeader);
    if (!image.response.ok) {
      throw new AppError(
        'TVAN_THAISON_CAPTCHA_IMAGE_INVALID',
        `Tenant Thái Sơn trả HTTP ${image.response.status} khi lấy CAPTCHA.`,
        502,
        image.response.status >= 500,
      );
    }

    const imageBytes = await readLimited(image.response, Math.min(CAPTCHA_MAX_BYTES, context.maxDownloadBytes));
    const mimeType = imageMimeType(image.response.headers.get('content-type') || '', imageBytes);
    if (!mimeType) {
      throw new AppError('TVAN_THAISON_CAPTCHA_IMAGE_INVALID', 'Tenant Thái Sơn không trả ảnh CAPTCHA hợp lệ.', 502, true);
    }

    const expiresAt = Date.now() + SESSION_TTL_MS;
    const challengeId = generateId();
    const privateState: ThaisonChallengeState = {
      version: 1,
      providerCode: PROVIDER_CODE,
      documentKey: document.key,
      binding: bindingOf(document, lookup),
      lookup,
      pageUrl: bootstrap.finalUrl,
      cookieHeader: image.cookieHeader,
      captchaOpaqueId: parsed.opaqueId,
      expiresAt,
    };

    return {
      challenge: {
        id: challengeId,
        providerCode: this.providerCode,
        kind: 'text',
        prompt: 'Nhập mã xác thực hiển thị trên ảnh Thái Sơn EInvoice.',
        imageBase64: imageBytes.toString('base64'),
        imageMimeType: mimeType,
        expiresAt: new Date(expiresAt).toISOString(),
      },
      privateState,
      trace: publicTrace(bootstrap.finalUrl, 'GET', image.response),
    };
  }

  async verifyCaptcha(
    document: InvoiceDocument,
    _challenge: TvanCaptchaChallenge,
    privateState: unknown,
    answer: string,
    context: TvanAdapterContext,
  ): Promise<TvanCaptchaVerifyTrace> {
    const lookup = resolveThaisonLookup(document);
    if (lookup.profile === 'shared_v1') {
      const sharedChallenge = sharedChallengeStateOf(privateState);
      if (
        !sharedChallenge
        || sharedChallenge.documentKey !== document.key
        || sharedChallenge.expiresAt <= Date.now()
        || sharedChallenge.binding !== bindingOf(document, lookup)
      ) {
        throw new AppError('TVAN_THAISON_CHALLENGE_MISMATCH', 'Phiên CAPTCHA portal chung Thái Sơn không hợp lệ hoặc đã hết hạn.', 409);
      }
      const captcha = answer.trim();
      if (!captcha || captcha.length > 32) {
        throw new AppError('TVAN_THAISON_CAPTCHA_INVALID', 'CAPTCHA Thái Sơn không hợp lệ.', 400, true);
      }
      const downloaded = await this.browserGateway.verifyAndDownload({
        challengeId: sharedChallenge.browserChallengeId,
        documentKey: document.key,
        captcha,
        maxDownloadBytes: context.maxDownloadBytes,
      });
      const fileName = safeThaisonOriginalFileName(
        document,
        contentDispositionFileName(downloaded.contentDisposition),
        'pdf',
      );
      const artifactId = generateId();
      const expiresAt = Date.now() + SESSION_TTL_MS;
      const binding = bindingOf(document, lookup);
      this.sharedArtifacts.set(artifactId, {
        documentKey: document.key,
        binding,
        content: downloaded.content,
        fileName,
        expiresAt,
      });
      const transaction: ThaisonSharedTransactionState = {
        version: 1,
        providerCode: PROVIDER_CODE,
        profile: 'shared_v1',
        documentKey: document.key,
        binding,
        stage: 'pdf_ready',
        artifactId,
        pdfFileName: fileName,
        expiresAt,
      };
      context.setToken({ token: JSON.stringify(transaction), expiresAt });
      const expiry = new Date(expiresAt).toISOString();
      return {
        request: publicTrace(endpoint(lookup, '/tra-cuu'), 'POST'),
        tokenExpiresAt: expiry,
        stage: 'pdf_ready',
        contextExpiresAt: expiry,
      };
    }

    const state = challengeStateOf(privateState);
    if (!state || state.documentKey !== document.key || state.expiresAt <= Date.now()) {
      throw new AppError('TVAN_THAISON_CHALLENGE_MISMATCH', 'Phiên CAPTCHA Thái Sơn không hợp lệ hoặc đã hết hạn.', 409);
    }

    if (state.binding !== bindingOf(document, lookup)) {
      throw new AppError('TVAN_THAISON_CHALLENGE_MISMATCH', 'CAPTCHA Thái Sơn không thuộc hóa đơn/portal hiện tại.', 409);
    }

    const captcha = answer.trim();
    if (!captcha || captcha.length > 32) {
      throw new AppError('TVAN_THAISON_CAPTCHA_INVALID', 'CAPTCHA Thái Sơn không hợp lệ.', 400, true);
    }

    const searchUrl = endpoint(lookup, '/xem-hoa-don');
    const body = new URLSearchParams({
      MA_NHAN_HOA_DON: lookup.lookupCode,
      CaptchaDeText: state.captchaOpaqueId,
      CaptchaInputText: captcha,
    }).toString();

    const searched = await fetchThaisonPortal(context, lookup, searchUrl, {
      method: 'POST',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: lookup.portalOrigin,
        Referer: state.pageUrl,
        'Upgrade-Insecure-Requests': '1',
      },
      body,
    }, state.cookieHeader);

    if (!searched.response.ok) {
      throw new AppError(
        'TVAN_THAISON_SEARCH_HTTP_ERROR',
        `Thái Sơn trả HTTP ${searched.response.status} khi tra cứu hóa đơn.`,
        502,
        searched.response.status >= 500,
      );
    }

    const html = await readHtml(searched.response, context.maxDownloadBytes);
    const result = parseThaisonLookupResultHtml(html);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const transaction: ThaisonTransactionState = {
      version: 1,
      providerCode: PROVIDER_CODE,
      documentKey: document.key,
      binding: bindingOf(document, lookup),
      stage: 'search_verified',
      lookup,
      cookieHeader: searched.cookieHeader,
      search: {
        resultUrl: searched.finalUrl,
        htmlDigest: digest(html),
        detailPath: result.detailPath,
        descriptors: result.descriptors,
        verifiedAt: Date.now(),
      },
      expiresAt,
    };
    saveState(context, transaction);

    const expiry = new Date(expiresAt).toISOString();
    return {
      request: {
        ...publicTrace(searchUrl, 'POST', searched.response),
        requestBody: '[MA_NHAN_HOA_DON + CaptchaDeText + user-entered CaptchaInputText]',
      },
      tokenExpiresAt: expiry,
      stage: 'search_verified',
      contextExpiresAt: expiry,
    };
  }

  artifactStatus(document: InvoiceDocument, context: TvanAdapterContext): TvanArtifactStatus {
    const shared = this.sharedArtifact(document, context);
    if (shared) {
      return {
        providerCode: this.providerCode,
        stage: 'pdf_ready',
        ready: true,
        canRetryPrepare: false,
        canView: true,
        canDownloadPdf: true,
        canDownloadOriginal: true,
        expiresAt: new Date(shared.state.expiresAt).toISOString(),
        originalKind: 'pdf',
        originalFileName: shared.artifact.fileName,
        pdfFileName: shared.artifact.fileName,
      };
    }
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
      originalKind: state.original?.kind,
      originalFileName: state.original?.fileName,
      pdfFileName: state.pdf?.fileName,
    };
  }

  private async prepareOriginal(document: InvoiceDocument, context: TvanAdapterContext): Promise<PreparedOriginal> {
    let state = parseState(context.token, document);
    if (!state) {
      throw new AppError('TVAN_CAPTCHA_REQUIRED', 'Cần xác thực CAPTCHA Thái Sơn trước khi chuẩn bị artifact.', 428, true);
    }

    if (!state.descriptor) {
      const detailUrl = endpoint(state.lookup, state.search.detailPath);
      const detail = await fetchThaisonPortal(context, state.lookup, detailUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: state.search.resultUrl,
        },
      }, state.cookieHeader);
      if (!detail.response.ok) {
        throw new AppError(
          'TVAN_THAISON_DETAIL_HTTP_ERROR',
          `Thái Sơn trả HTTP ${detail.response.status} khi lấy bản thể hiện HTML.`,
          502,
          detail.response.status >= 500,
          undefined,
          { retryStage: 'prepare_artifact', preserveContext: true },
        );
      }

      const detailHtml = await readHtml(detail.response, context.maxDownloadBytes);
      const parsed = parseThaisonDetailHtml(detailHtml);
      validateDetailIdentity(document, parsed.visibleText);
      state = {
        ...state,
        stage: 'representation_ready',
        cookieHeader: detail.cookieHeader,
      };
      saveState(context, state);

      const descriptor = resolveDownloadDescriptor(state.search.descriptors, parsed.descriptors);
      state = {
        ...state,
        stage: 'artifact_descriptor_ready',
        descriptor: {
          ...descriptor,
          resolvedAt: Date.now(),
        },
      };
      saveState(context, state);
    }

    const descriptor = state.descriptor;
    if (!descriptor) {
      throw new AppError('TVAN_THAISON_DOWNLOAD_DESCRIPTOR_MISSING', 'Thiếu download descriptor Thái Sơn.', 502);
    }

    const downloadUrl = endpoint(state.lookup, descriptor.relativePath);
    const downloaded = await fetchThaisonPortal(context, state.lookup, downloadUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/zip,application/pdf,application/octet-stream,*/*',
        Referer: state.search.resultUrl,
      },
    }, state.cookieHeader);
    if (!downloaded.response.ok) {
      throw new AppError(
        'TVAN_THAISON_DOWNLOAD_HTTP_ERROR',
        `Thái Sơn trả HTTP ${downloaded.response.status} khi tải original artifact.`,
        502,
        downloaded.response.status >= 500,
        undefined,
        { retryStage: 'prepare_artifact', preserveContext: true },
      );
    }

    const originalContent = await readLimited(downloaded.response, context.maxDownloadBytes);
    const kind = detectThaisonOriginalKind(originalContent);
    const fileName = safeThaisonOriginalFileName(
      document,
      contentDispositionFileName(downloaded.response.headers.get('content-disposition')),
      kind,
    );
    state = {
      ...state,
      stage: 'original_ready',
      cookieHeader: downloaded.cookieHeader,
      original: {
        kind,
        fileName,
        digest: digest(originalContent),
        fetchedAt: Date.now(),
      },
    };
    saveState(context, state);
    return { content: originalContent, kind, fileName, state };
  }

  async prepareArtifact(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPreparedArtifact<false>> {
    const lookup = resolveThaisonLookup(document);
    if (lookup.profile === 'shared_v1') {
      const shared = this.sharedArtifact(document, context);
      if (!shared) {
        throw new AppError('TVAN_CAPTCHA_REQUIRED', 'Cần xác thực CAPTCHA portal chung Thái Sơn trước khi lấy PDF.', 428, true);
      }
      return {
        original: shared.artifact.content,
        originalFileName: shared.artifact.fileName,
        originalContentType: 'application/pdf',
        pdf: shared.artifact.content,
        pdfFileName: shared.artifact.fileName,
      };
    }
    const original = await this.prepareOriginal(document, context);
    const normalized = await normalizedPdfFromOriginal(
      document,
      original.content,
      original.fileName,
      context.maxDownloadBytes,
    );

    if (!normalized) {
      return {
        original: original.content,
        originalFileName: original.fileName,
        originalContentType: original.kind === 'pdf' ? 'application/pdf' : 'application/zip',
      };
    }

    const state: ThaisonTransactionState = {
      ...original.state,
      stage: 'pdf_ready',
      pdf: {
        fileName: normalized.fileName,
        digest: digest(normalized.content),
        normalizedAt: Date.now(),
      },
    };
    saveState(context, state);
    return {
      original: original.content,
      originalFileName: original.fileName,
      originalContentType: original.kind === 'pdf' ? 'application/pdf' : 'application/zip',
      pdf: normalized.content,
      pdfFileName: normalized.fileName,
    };
  }

  async downloadOriginal(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanOriginalFileResult> {
    const lookup = resolveThaisonLookup(document);
    if (lookup.profile === 'shared_v1') {
      const prepared = await this.prepareArtifact(document, context);
      return {
        content: prepared.pdf!,
        fileName: prepared.pdfFileName!,
        contentType: 'application/pdf',
      };
    }
    const original = await this.prepareOriginal(document, context);
    return {
      content: original.content,
      fileName: original.fileName,
      contentType: original.kind === 'pdf' ? 'application/pdf' : 'application/zip',
    };
  }

  async downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult> {
    const prepared = await this.prepareArtifact(document, context);
    if (!prepared.pdf || !prepared.pdfFileName) {
      throw new AppError(
        'TVAN_THAISON_PDF_NOT_FOUND',
        'Original artifact Thái Sơn chưa có PDF provider; chỉ có thể tải file gốc.',
        422,
        false,
        undefined,
        { retryStage: 'prepare_artifact', preserveContext: true },
      );
    }
    return {
      content: prepared.pdf,
      contentType: 'application/pdf',
      fileName: prepared.pdfFileName,
    };
  }

  async discardChallenge(_challenge: TvanCaptchaChallenge, privateState: unknown): Promise<void> {
    const shared = sharedChallengeStateOf(privateState);
    if (shared) await this.browserGateway.closeChallenge(shared.browserChallengeId);
  }

  async dispose(): Promise<void> {
    this.sharedArtifacts.clear();
    await this.browserGateway.dispose();
  }

  describeDownloadRequest(document: InvoiceDocument, context: TvanAdapterContext) {
    const lookup = resolveThaisonLookup(document);
    const shared = this.sharedArtifact(document, context);
    const state = shared ? undefined : parseState(context.token, document);
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      lookup: publicThaisonLookup(lookup),
      endpoint: '/api/tvan/pdf/prepare-artifact',
      method: 'POST' as const,
      requestBody: state ? '[backend-private Thái Sơn transaction]' : '[CAPTCHA required]',
      tokenReady: Boolean(shared || state),
      tokenExpiresAt: shared
        ? new Date(shared.state.expiresAt).toISOString()
        : state ? new Date(state.expiresAt).toISOString() : undefined,
      plannedAt: new Date().toISOString(),
    };
  }
}
