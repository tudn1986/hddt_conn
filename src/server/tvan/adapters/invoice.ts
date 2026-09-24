import type {
  InvoiceDocument,
  TvanPresentationLinkResult,
  TvanProviderCapability,
} from '../../../shared/models/index.js';
import { AppError, safeString } from '../../../shared/utils/index.js';
import { findNamedValue, lookupCodeOf, providerCodeOf } from '../extract.js';
import {
  assertAllowedUrl,
  ensurePdf,
  fetchWithTimeout,
  readLimited,
  responseFileName,
  safePdfFileName,
} from '../http.js';
import type { TvanAdapter, TvanAdapterContext, TvanPdfResult } from '../types.js';

const ORIGIN = 'https://tracuuhoadon.minvoice.com.vn';
const SEARCH_ENDPOINT = `${ORIGIN}/api/Search/SearchInvoice`;
const ALLOWED_HOSTS = ['tracuuhoadon.minvoice.com.vn'] as const;
const PROVIDER_TAX_CODE = '0106026495';

function sellerTaxCodeOf(document: InvoiceDocument): string | undefined {
  return safeString(document.seller?.taxCode)
    || findNamedValue(document, ['nbmst', 'masothue', 'MST người bán']);
}

function securityCodeOf(document: InvoiceDocument): string | undefined {
  return findNamedValue(document, [
    'Số bảo mật',
    'So bao mat',
    'sobaomat',
    'Mã bảo mật',
    'Ma bao mat',
    'securityCode',
  ]) || lookupCodeOf(document);
}

function providerTaxCodeOf(document: InvoiceDocument): string | undefined {
  return findNamedValue(document, ['msttcgp', 'tvandnkntt', 'MSTTCGP']);
}

function presentationUrl(document: InvoiceDocument): string {
  const sellerTaxCode = sellerTaxCodeOf(document);
  const securityCode = securityCodeOf(document);
  if (!sellerTaxCode) {
    throw new AppError('TVAN_INVOICE_SELLER_TAX_CODE_MISSING', 'Không tìm thấy MST người bán để truy vấn bản thể hiện M-Invoice.', 422);
  }
  if (!securityCode) {
    throw new AppError('TVAN_INVOICE_SECURITY_CODE_MISSING', 'Không tìm thấy Số bảo mật của hóa đơn M-Invoice.', 422);
  }

  const target = new URL(SEARCH_ENDPOINT);
  target.searchParams.set('masothue', sellerTaxCode);
  target.searchParams.set('sobaomat', securityCode);
  target.searchParams.set('type', 'PDF');
  target.searchParams.set('inchuyendoi', 'false');
  return target.toString();
}

function defaultName(document: InvoiceDocument): string {
  return safePdfFileName([
    document.seller?.taxCode,
    document.series,
    document.invoiceNo,
  ].filter(Boolean).join('_') || 'MInvoice_invoice');
}

export class InvoiceTvanAdapter implements TvanAdapter {
  readonly providerCode = 'tvan_invoice';
  readonly displayName = 'M-Invoice';
  readonly captchaMode = 'none' as const;
  readonly priority = 'P1' as const;

  matches(document: InvoiceDocument): boolean {
    const code = providerCodeOf(document);
    if (code === this.providerCode || code.includes('tvan_invoice')) return true;
    // Some older GDT payloads identify this TVAN only through msttcgp/tvandnkntt.
    return providerTaxCodeOf(document) === PROVIDER_TAX_CODE;
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    const sellerTaxCode = sellerTaxCodeOf(document);
    const securityCode = securityCodeOf(document);
    const missing = [
      sellerTaxCode ? undefined : 'MST người bán',
      securityCode ? undefined : 'Số bảo mật',
    ].filter((value): value is string => Boolean(value));
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      supported: missing.length === 0,
      captchaMode: this.captchaMode,
      priority: this.priority,
      reason: missing.length ? `Thiếu ${missing.join(' và ')} trong payload GDT.` : undefined,
    };
  }

  async resolvePresentationLink(
    document: InvoiceDocument,
    _context: TvanAdapterContext,
  ): Promise<TvanPresentationLinkResult> {
    const sellerTaxCode = sellerTaxCodeOf(document);
    const securityCode = securityCodeOf(document);
    const downloadUrl = presentationUrl(document);
    if (!sellerTaxCode || !securityCode) {
      // presentationUrl already throws a more specific error; keep this only for type narrowing.
      throw new AppError('TVAN_INVOICE_LOOKUP_MISSING', 'Thiếu thông tin truy vấn M-Invoice.', 422);
    }

    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      lookupCode: securityCode,
      sellerTaxCode,
      securityCode,
      providerTaxCode: providerTaxCodeOf(document) || PROVIDER_TAX_CODE,
      metadataUrl: SEARCH_ENDPOINT,
      metadataMethod: 'GET',
      downloadUrl,
      resolvedAt: new Date().toISOString(),
      steps: [
        {
          stage: 'seller_tax_code',
          status: 'ok',
          label: 'MST người bán / masothue',
          value: sellerTaxCode,
        },
        {
          stage: 'security_code',
          status: 'ok',
          label: 'Số bảo mật / sobaomat',
          value: securityCode,
        },
        {
          stage: 'presentation_link',
          status: 'ready',
          label: 'SearchInvoice PDF',
          value: downloadUrl,
        },
      ],
    };
  }

  async downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult> {
    const url = presentationUrl(document);
    const response = await fetchWithTimeout(
      context.fetchImpl,
      assertAllowedUrl(url, ALLOWED_HOSTS),
      {
        method: 'GET',
        headers: {
          Accept: 'application/pdf,*/*',
          Referer: `${ORIGIN}/`,
        },
      },
      context.timeoutMs,
      ALLOWED_HOSTS,
    );
    if (!response.ok) {
      throw new AppError(
        'TVAN_INVOICE_PDF_HTTP_ERROR',
        `M-Invoice trả HTTP ${response.status} khi truy vấn bản thể hiện PDF.`,
        502,
        response.status >= 500,
      );
    }
    const content = await readLimited(response, context.maxDownloadBytes);
    ensurePdf(content);
    return {
      content,
      contentType: 'application/pdf',
      fileName: responseFileName(response) || defaultName(document),
    };
  }
}
