import type {
  InvoiceDocument,
  TvanArtifactStatus,
  TvanCaptchaChallenge,
  TvanProviderCapability,
} from '../../../shared/models/index.js';
import { FAST_SOLUTION_TAX_CODE } from '../../../shared/provider-resolution.js';
import { AppError, isRecord, safeString } from '../../../shared/utils/index.js';
import { findNamedValue, lookupCodeOf } from '../extract.js';
import { ensurePdf, safePdfFileName } from '../http.js';
import type {
  TvanAdapter,
  TvanAdapterContext,
  TvanCaptchaVerifyTrace,
  TvanChallengeResult,
  TvanPdfResult,
} from '../types.js';
import {
  FAST_CHALLENGE_TTL_MS,
  FastBrowserSessionManager,
  type FastBrowserGateway,
} from './fast-browser.js';

const PROVIDER_CODE = 'tvan_fast';
const DISPLAY_NAME = 'FAST e-Invoice';
const PDF_TTL_MS = 5 * 60_000;

type FastLookup = {
  keySearch: string;
  source: 'lookup' | 'document' | 'gdt_xml';
};

type FastPrivateState = {
  version: 2;
  providerCode: typeof PROVIDER_CODE;
  challengeId: string;
  documentKey: string;
  keySearch: string;
  invoiceNo: string;
};

type VerifiedPdf = {
  result: TvanPdfResult;
  expiresAt: number;
};

function normalizedName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function xmlValue(xml: string, localName: string): string | undefined {
  const escaped = localName.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
  const expression = new RegExp(
    '<(?:[A-Za-z_][\\w.-]*:)?' + escaped + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?' + escaped + '\\s*>',
    'i',
  );
  const value = expression.exec(xml)?.[1];
  return value ? decodeXmlEntities(value.replace(/<[^>]+>/g, '').trim()) : undefined;
}

export function fastKeySearchFromXml(xmlBytes: Buffer): string | undefined {
  const xml = xmlBytes.toString('utf8');
  const blocks = xml.match(/<(?:[A-Za-z_][\w.-]*:)?TTin\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?TTin\s*>/gi) || [];
  for (const block of blocks) {
    const name = xmlValue(block, 'TTruong');
    if (!name || normalizedName(name) !== 'keysearch') continue;
    const value = xmlValue(block, 'DLieu');
    if (value) return value;
  }
  return undefined;
}

function solutionTaxCodeOf(document: InvoiceDocument): string | undefined {
  return safeString(document.providers?.solution?.taxCode)
    || findNamedValue(document, ['msttcgp', 'MSTTCGP']);
}

function completeLocator(document: InvoiceDocument): boolean {
  return Boolean(
    document.seller?.taxCode
    && document.templateNo !== undefined && document.templateNo !== ''
    && document.series
    && document.invoiceNo !== undefined && document.invoiceNo !== '',
  );
}

function invoiceNoOf(document: InvoiceDocument): string | undefined {
  return safeString(document.invoiceNo);
}

function directKeySearch(document: InvoiceDocument): FastLookup | undefined {
  const lookup = lookupCodeOf(document);
  const raw = findNamedValue(document, ['KeySearch', 'keySearch', 'KEYSEARCH']);
  if (lookup && raw && lookup !== raw) {
    throw new AppError(
      'TVAN_FAST_LOOKUP_MISMATCH',
      'Dataset có nhiều giá trị KeySearch FAST khác nhau; không tự chọn mã tra cứu.',
      409,
    );
  }
  if (lookup) return { keySearch: lookup, source: 'lookup' };
  if (raw) return { keySearch: raw, source: 'document' };
  return undefined;
}

async function lookupOf(document: InvoiceDocument, context: TvanAdapterContext): Promise<FastLookup> {
  if (solutionTaxCodeOf(document) !== FAST_SOLUTION_TAX_CODE) {
    throw new AppError('TVAN_FAST_PROVIDER_MISMATCH', 'Hóa đơn không thuộc giải pháp FAST e-Invoice.', 422);
  }
  const direct = directKeySearch(document);
  if (direct) return direct;
  if (!context.loadInvoiceXml || !completeLocator(document)) {
    throw new AppError('TVAN_FAST_LOOKUP_MISSING', 'Không tìm thấy KeySearch FAST trong dataset/XML GDT.', 422);
  }
  const xml = await context.loadInvoiceXml(document);
  if (xml.length > context.maxDownloadBytes) {
    throw new AppError('TVAN_RESPONSE_TOO_LARGE', 'XML GDT vượt giới hạn dung lượng khi tìm KeySearch FAST.', 502);
  }
  const keySearch = fastKeySearchFromXml(xml);
  if (!keySearch) {
    throw new AppError('TVAN_FAST_LOOKUP_MISSING', 'Không tìm thấy KeySearch FAST trong XML GDT.', 422);
  }
  return { keySearch, source: 'gdt_xml' };
}

function fileNameFromDisposition(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* ignore */ }
  }
  return /filename="?([^";]+)"?/i.exec(value)?.[1];
}

function verifiedFileName(document: InvoiceDocument, rawName?: string): string {
  const fallback = [document.seller?.taxCode, document.series, document.invoiceNo]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .join('_') || 'fast_einvoice';
  return safePdfFileName(rawName || fallback);
}

function privateStateOf(value: unknown): FastPrivateState | undefined {
  if (!isRecord(value)) return undefined;
  const version = Number(value.version);
  const providerCode = safeString(value.providerCode);
  const challengeId = safeString(value.challengeId);
  const documentKey = safeString(value.documentKey);
  const keySearch = safeString(value.keySearch);
  const invoiceNo = safeString(value.invoiceNo);
  if (
    version !== 2
    || providerCode !== PROVIDER_CODE
    || !challengeId
    || !documentKey
    || !keySearch
    || !invoiceNo
  ) return undefined;
  return { version: 2, providerCode: PROVIDER_CODE, challengeId, documentKey, keySearch, invoiceNo };
}

export class FastEinvoiceTvanAdapter implements TvanAdapter {
  readonly providerCode = PROVIDER_CODE;
  readonly displayName = DISPLAY_NAME;
  readonly captchaMode = 'per_invoice' as const;
  readonly priority = 'P1' as const;
  readonly challengeSingleUse = true;
  private readonly verifiedPdfs = new Map<string, VerifiedPdf>();

  constructor(private readonly browser: FastBrowserGateway = new FastBrowserSessionManager()) {}

  matches(document: InvoiceDocument): boolean {
    return solutionTaxCodeOf(document) === FAST_SOLUTION_TAX_CODE;
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    const invoiceNo = invoiceNoOf(document);
    let hasLookup = false;
    try { hasLookup = Boolean(directKeySearch(document)); } catch { /* surface conflict during prepare */ }
    const supported = this.matches(document) && Boolean(invoiceNo) && (hasLookup || completeLocator(document));
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      supported,
      captchaMode: this.captchaMode,
      priority: this.priority,
      reason: supported
        ? undefined
        : !this.matches(document)
          ? 'Hóa đơn không thuộc giải pháp FAST e-Invoice.'
          : !invoiceNo
            ? 'Thiếu số hóa đơn để đối chiếu kết quả FAST.'
            : 'Thiếu KeySearch và locator GDT để tìm KeySearch từ XML.',
    };
  }

  private cachedPdf(document: InvoiceDocument): TvanPdfResult | undefined {
    const cached = this.verifiedPdfs.get(document.key);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
      this.verifiedPdfs.delete(document.key);
      return undefined;
    }
    return cached.result;
  }

  async getCaptchaChallenge(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanChallengeResult> {
    const invoiceNo = invoiceNoOf(document);
    if (!invoiceNo) {
      throw new AppError('TVAN_FAST_INVOICE_NO_MISSING', 'Thiếu số hóa đơn để tra cứu FAST.', 422);
    }
    this.verifiedPdfs.delete(document.key);
    context.setToken(undefined);
    const lookup = await lookupOf(document, context);
    const challenge = await this.browser.createChallenge({
      documentKey: document.key,
      keySearch: lookup.keySearch,
      timeoutMs: context.timeoutMs,
      maxDownloadBytes: context.maxDownloadBytes,
    });
    return {
      challenge: {
        id: challenge.challengeId,
        providerCode: this.providerCode,
        kind: 'text',
        prompt: 'Nhập mã xác thực hiển thị trên ảnh FAST e-Invoice.',
        imageBase64: challenge.imageBase64,
        imageMimeType: challenge.imageMimeType,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
      },
      privateState: {
        version: 2,
        providerCode: PROVIDER_CODE,
        challengeId: challenge.challengeId,
        documentKey: document.key,
        keySearch: lookup.keySearch,
        invoiceNo,
      } satisfies FastPrivateState,
      trace: {
        endpoint: 'https://einvoice.fast.com.vn/index.aspx/GetData',
        method: 'POST',
      },
    };
  }

  async verifyCaptcha(
    document: InvoiceDocument,
    challenge: { id: string },
    privateState: unknown,
    answer: string,
    context: TvanAdapterContext,
  ): Promise<TvanCaptchaVerifyTrace> {
    const state = privateStateOf(privateState);
    const candidateChallengeId = state?.challengeId || challenge.id;
    try {
      if (
        !state
        || state.challengeId !== challenge.id
        || state.documentKey !== document.key
        || state.invoiceNo !== invoiceNoOf(document)
      ) {
        throw new AppError('TVAN_FAST_CHALLENGE_MISMATCH', 'CAPTCHA FAST không thuộc hóa đơn hiện tại.', 409);
      }
      const lookup = await lookupOf(document, context);
      if (lookup.keySearch !== state.keySearch) {
        throw new AppError('TVAN_FAST_CHALLENGE_MISMATCH', 'KeySearch FAST đã thay đổi so với challenge hiện tại.', 409);
      }
      const captcha = answer.trim();
      if (!captcha || captcha.length > 6) {
        throw new AppError('TVAN_FAST_CAPTCHA_INVALID', 'CAPTCHA FAST phải có từ 1 đến 6 ký tự.', 400, true);
      }
      const downloaded = await this.browser.verifyAndDownload({
        challengeId: state.challengeId,
        documentKey: document.key,
        captcha,
        expectedInvoiceNo: state.invoiceNo,
        maxDownloadBytes: context.maxDownloadBytes,
      });
      try {
        ensurePdf(downloaded.content);
      } catch (error) {
        if (error instanceof AppError && error.code === 'TVAN_PDF_INVALID') {
          throw new AppError('TVAN_FAST_PDF_INVALID', 'FAST không trả file PDF hợp lệ.', 502, true);
        }
        throw error;
      }
      const fileName = verifiedFileName(
        document,
        fileNameFromDisposition(downloaded.contentDisposition) || downloaded.fileName,
      );
      const expiresAt = Date.now() + PDF_TTL_MS;
      const result: TvanPdfResult = {
        content: downloaded.content,
        contentType: 'application/pdf',
        fileName,
      };
      this.verifiedPdfs.set(document.key, { result, expiresAt });
      context.setToken({
        token: JSON.stringify({ providerCode: PROVIDER_CODE, documentKey: document.key, verified: true }),
        expiresAt,
      });
      return {
        request: {
          endpoint: 'https://einvoice.fast.com.vn/AppHandler/EInvoiceQuery.ashx',
          method: 'POST',
          requestBody: '[browser-backed KeySearch + user-entered CAPTCHA; t=2 then t=4]',
          responseStatus: downloaded.responseStatus,
          responseContentType: downloaded.responseContentType,
        },
        tokenExpiresAt: new Date(expiresAt).toISOString(),
        stage: 'pdf_ready',
        contextExpiresAt: new Date(expiresAt).toISOString(),
      };
    } catch (error) {
      context.setToken(undefined);
      this.verifiedPdfs.delete(document.key);
      await this.browser.closeChallenge(candidateChallengeId).catch(() => undefined);
      throw error;
    }
  }

  artifactStatus(document: InvoiceDocument, _context: TvanAdapterContext): TvanArtifactStatus {
    const pdf = this.cachedPdf(document);
    return {
      providerCode: this.providerCode,
      stage: pdf ? 'pdf_ready' : 'new',
      ready: Boolean(pdf),
      canRetryPrepare: !pdf,
      canView: Boolean(pdf),
      canDownloadPdf: Boolean(pdf),
      canDownloadOriginal: false,
      expiresAt: this.verifiedPdfs.get(document.key)
        ? new Date(this.verifiedPdfs.get(document.key)!.expiresAt).toISOString()
        : undefined,
      pdfFileName: pdf?.fileName,
    };
  }

  async downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult> {
    const pdf = this.cachedPdf(document);
    if (pdf) return pdf;
    context.setToken(undefined);
    throw new AppError('TVAN_FAST_CAPTCHA_REQUIRED', 'Cần xác thực CAPTCHA FAST trước khi xem/tải PDF.', 428, true);
  }

  async discardChallenge(challenge: TvanCaptchaChallenge, privateState: unknown): Promise<void> {
    const state = privateStateOf(privateState);
    await this.browser.closeChallenge(state?.challengeId || challenge.id);
  }

  async dispose(): Promise<void> {
    this.verifiedPdfs.clear();
    await this.browser.dispose();
  }
}

export { FAST_CHALLENGE_TTL_MS };
