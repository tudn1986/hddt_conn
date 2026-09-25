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
const PROVIDER_SOLUTION_TAX_CODE = '0106026495-001';

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
    'Mã tra cứu',
    'Ma tra cuu',
    'securityCode',
  ]) || lookupCodeOf(document);
}

function providerTaxCodeOf(document: InvoiceDocument): string | undefined {
  return safeString(document.providers?.solution?.taxCode)
    || findNamedValue(document, ['msttcgp', 'MSTTCGP', 'tvandnkntt']);
}

function providerTaxCodeMatches(value: string | undefined): boolean {
  return value === PROVIDER_TAX_CODE
    || value === PROVIDER_SOLUTION_TAX_CODE
    || Boolean(value?.startsWith(PROVIDER_TAX_CODE + '-'));
}

function completeLocator(document: InvoiceDocument): boolean {
  return Boolean(
    sellerTaxCodeOf(document)
    && document.templateNo !== undefined && document.templateNo !== ''
    && document.series
    && document.invoiceNo !== undefined && document.invoiceNo !== '',
  );
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function xmlValue(xml: string, localName: string): string | undefined {
  const escaped = localName.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
  const value = new RegExp(
    '<(?:[A-Za-z_][\\w.-]*:)?' + escaped + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?' + escaped + '\\s*>',
    'i',
  ).exec(xml)?.[1];
  return value ? decodeEntities(value.replace(/<[^>]+>/g, '').trim()) : undefined;
}

export function minvoiceLookupFromXml(xmlBytes: Buffer): string | undefined {
  const xml = xmlBytes.toString('utf8');
  const direct = xmlValue(xml, 'SoBaoMat') || xmlValue(xml, 'MaTraCuu') || xmlValue(xml, 'LookupCode');
  if (direct) return direct;
  const blocks = xml.match(/<(?:[A-Za-z_][\w.-]*:)?TTin\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?TTin\s*>/gi) || [];
  for (const block of blocks) {
    const name = xmlValue(block, 'TTruong')?.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi-VN').replace(/[^a-z0-9]+/g, ' ').trim();
    if (name === 'ma tra cuu' || name === 'so bao mat' || name === 'ma bao mat') {
      const value = xmlValue(block, 'DLieu');
      if (value) return value;
    }
  }
  return undefined;
}

async function lookupCodeFor(document: InvoiceDocument, context: TvanAdapterContext): Promise<string> {
  let code = securityCodeOf(document);
  if (!code && context.loadInvoiceXml && completeLocator(document)) {
    code = minvoiceLookupFromXml(await context.loadInvoiceXml(document));
  }
  if (!code) throw new AppError(
    'TVAN_INVOICE_SECURITY_CODE_MISSING',
    'Không tìm thấy Mã tra cứu/Số bảo mật M-Invoice trong dataset hoặc XML GDT.',
    422,
  );
  return code.trim();
}

function presentationUrl(document: InvoiceDocument, lookupCode?: string): string {
  const sellerTaxCode = sellerTaxCodeOf(document);
  const securityCode = lookupCode || securityCodeOf(document);
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
    // Some GDT payloads identify this provider through MSTTCGP/tvandnkntt only.
    return providerTaxCodeMatches(providerTaxCodeOf(document));
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    const sellerTaxCode = sellerTaxCodeOf(document);
    const directLookup = securityCodeOf(document);
    const canResolveFromXml = completeLocator(document);
    const missing = [
      sellerTaxCode ? undefined : 'MST người bán',
      directLookup || canResolveFromXml ? undefined : 'Mã tra cứu/Số bảo mật và locator GDT',
    ].filter((value): value is string => Boolean(value));
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      supported: this.matches(document) && missing.length === 0,
      captchaMode: this.captchaMode,
      priority: this.priority,
      reason: missing.length ? `Thiếu ${missing.join(' và ')} để lấy bản thể hiện M-Invoice.` : undefined,
    };
  }

  async resolvePresentationLink(
    document: InvoiceDocument,
    context: TvanAdapterContext,
  ): Promise<TvanPresentationLinkResult> {
    const sellerTaxCode = sellerTaxCodeOf(document);
    const securityCode = await lookupCodeFor(document, context);
    const downloadUrl = presentationUrl(document, securityCode);
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
    const lookupCode = await lookupCodeFor(document, context);
    const url = presentationUrl(document, lookupCode);
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
