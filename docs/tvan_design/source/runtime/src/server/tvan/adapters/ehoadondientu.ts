import { parseFragment } from 'parse5';
import type { InvoiceDocument, TvanProviderCapability } from '../../../shared/models/index.js';
import { EHOADON_DOMAIN, EHOADON_SOLUTION_TAX_CODE } from '../../../shared/provider-resolution.js';
import { AppError, safeString } from '../../../shared/utils/index.js';
import { findNamedValue, lookupCodeOf } from '../extract.js';
import { validateInvoiceXml } from '../../gdt/zip.js';
import { assertAllowedUrl, ensurePdf, fetchWithTimeout, readLimited, safePdfFileName } from '../http.js';
import type { TvanAdapter, TvanAdapterContext, TvanPdfResult } from '../types.js';

const ORIGIN = `https://${EHOADON_DOMAIN}`;
const ALLOWED_HOSTS = [EHOADON_DOMAIN] as const;
const LOOKUP_MAX_BYTES = 1024 * 1024;

type HtmlNode = {
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  value?: string;
};

export interface EhoadonLookupResult {
  providerRef: string;
  series?: string;
  invoiceNo?: string;
  issueDate?: string;
  buyerTaxCode?: string;
}

function nodes(root: HtmlNode, visit: (node: HtmlNode) => void): void {
  visit(root);
  for (const child of root.childNodes || []) nodes(child, visit);
}

function attribute(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((item) => item.name.toLowerCase() === name)?.value;
}

function nodeText(node: HtmlNode): string {
  return [node.value || '', ...(node.childNodes || []).map(nodeText)].join('');
}

function field(root: HtmlNode, names: string[]): string | undefined {
  const found: string[] = [];
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  nodes(root, (node) => {
    if (![attribute(node, 'id'), attribute(node, 'name')].some((value) => value && wanted.has(value.toLowerCase()))) return;
    const value = safeString(attribute(node, 'value') || nodeText(node));
    if (value) found.push(value);
  });
  if (new Set(found).size > 1) throw new AppError('TVAN_EHOADON_LOOKUP_INVALID', 'Dữ liệu tra cứu hóa đơn không nhất quán.', 502);
  return found[0];
}

function normalizedHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cells(row: HtmlNode, tag: 'th' | 'td'): HtmlNode[] {
  return (row.childNodes || []).filter((child) => child.tagName === tag);
}

function visible(cell: HtmlNode): boolean {
  return attribute(cell, 'hidden') === undefined
    && !/display\s*:\s*none/i.test(attribute(cell, 'style') || '');
}

function tableMetadata(root: HtmlNode): Omit<EhoadonLookupResult, 'providerRef'> | undefined {
  const tables: HtmlNode[] = [];
  nodes(root, (node) => { if (node.tagName === 'table' && field(node, ['lblData']) && field(node, ['lblStt'])) tables.push(node); });
  if (!tables.length) return undefined;
  if (tables.length > 1) throw new AppError('TVAN_EHOADON_LOOKUP_INVALID', 'Kết quả tra cứu có nhiều bảng hóa đơn.', 502);
  const rows: HtmlNode[] = [];
  nodes(tables[0], (node) => { if (node.tagName === 'tr') rows.push(node); });
  const dataIndex = rows.findIndex((row) => field(row, ['lblData']) && field(row, ['lblStt']));
  const headerRow = rows.slice(0, dataIndex).reverse().find((row) => cells(row, 'th').length > 0);
  if (!headerRow || dataIndex < 0) throw new AppError('TVAN_EHOADON_LOOKUP_INVALID', 'Bảng tra cứu thiếu header hoặc dòng dữ liệu.', 502);
  const allHeaders = cells(headerRow, 'th');
  const allData = cells(rows[dataIndex], 'td');
  const shownHeaders = allHeaders.filter(visible);
  const shownData = allData.filter(visible);
  const aligned = shownHeaders.length === shownData.length
    ? [shownHeaders, shownData]
    : allHeaders.length === allData.length ? [allHeaders, allData] : undefined;
  if (!aligned || !aligned[0].length) throw new AppError('TVAN_EHOADON_LOOKUP_INVALID', 'Cột dữ liệu tra cứu không khớp header.', 502);
  const columns = new Map(aligned[0].map((header, index) => [normalizedHeader(nodeText(header)), safeString(nodeText(aligned[1][index]))]));
  if (!columns.get('so seri') || !columns.get('so hoa don')) {
    throw new AppError('TVAN_EHOADON_LOOKUP_INVALID', 'Bảng tra cứu thiếu ký hiệu hoặc số hóa đơn.', 502);
  }
  return {
    series: columns.get('so seri'),
    invoiceNo: columns.get('so hoa don'),
    issueDate: columns.get('ngay'),
    buyerTaxCode: columns.get('ma so thue'),
  };
}

export function parseEhoadonLookupHtml(html: string): EhoadonLookupResult {
  const root = parseFragment(html) as unknown as HtmlNode;
  const data = field(root, ['lblData']);
  const status = field(root, ['lblStt']);
  if (!data || !status) {
    throw new AppError(html.trim() ? 'TVAN_EHOADON_LOOKUP_INVALID' : 'TVAN_EHOADON_LOOKUP_NOT_FOUND', 'Không tìm thấy mã tham chiếu hóa đơn.', 502);
  }
  if (!/^\d{1,24}$/.test(data) || !/^\d{1,24}$/.test(status)) {
    throw new AppError('TVAN_EHOADON_LOOKUP_INVALID', 'Mã tham chiếu hóa đơn không hợp lệ.', 502);
  }
  const table = tableMetadata(root);
  return {
    providerRef: `ct_${data}_${status}`,
    series: table?.series || field(root, ['lblKyHieu', 'lblKihieu', 'lblSeries', 'series']),
    invoiceNo: table?.invoiceNo || field(root, ['lblSoHoaDon', 'lblSohd', 'lblInvoiceNo', 'invoiceNo']),
    issueDate: table?.issueDate || field(root, ['lblNgayLap', 'lblNgayHoaDon', 'issueDate']),
    buyerTaxCode: table?.buyerTaxCode || field(root, ['lblMstNguoiMua', 'lblMSTNM', 'buyerTaxCode']),
  };
}

function solutionTaxCodeOf(document: InvoiceDocument): string | undefined {
  return document.providers?.solution?.taxCode || findNamedValue(document, ['msttcgp']);
}

function portalHostOf(document: InvoiceDocument): string | undefined {
  const input = document.lookup?.lookupBaseUrl || findNamedValue(document, ['PortalLink', 'lookupUrl']);
  if (!input) return undefined;
  try { return new URL(input).hostname.toLowerCase(); } catch { return undefined; }
}

function lookupCode(document: InvoiceDocument): string | undefined {
  return lookupCodeOf(document) || findNamedValue(document, ['Mã tra cứu', 'Ma tra cuu', 'mahoadon']);
}

function canLoadInvoiceXml(document: InvoiceDocument): boolean {
  return solutionTaxCodeOf(document) === EHOADON_SOLUTION_TAX_CODE
    && Boolean(document.seller?.taxCode && document.templateNo !== undefined && document.series
      && document.invoiceNo !== undefined && document.invoiceNo !== '');
}

export function ehoadonReferenceFromXml(xml: Buffer, document: InvoiceDocument): string {
  if (solutionTaxCodeOf(document) !== EHOADON_SOLUTION_TAX_CODE) {
    throw new AppError('TVAN_EHOADON_XML_ID_UNSUPPORTED', 'XML fallback chỉ áp dụng cho đúng MSTTCGP ehoadondientu.', 422);
  }
  validateInvoiceXml(xml);
  if (xml.length > 10 * 1024 * 1024) throw new AppError('TVAN_RESPONSE_TOO_LARGE', 'XML GDT vượt giới hạn dung lượng.', 502);
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(xml); }
  catch { throw new AppError('TVAN_EHOADON_XML_ID_UNSUPPORTED', 'XML GDT không phải UTF-8 hợp lệ.', 422); }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) {
    throw new AppError('TVAN_EHOADON_XML_ID_UNSUPPORTED', 'XML chứa khai báo thực thể không được hỗ trợ.', 422);
  }
  const root = parseFragment(source) as unknown as HtmlNode;
  const ids: string[] = [];
  nodes(root, (node) => {
    if (node.tagName?.toLowerCase().split(':').at(-1) !== 'dlhdon') return;
    const id = attribute(node, 'id');
    if (id) ids.push(id);
  });
  if (!ids.length) throw new AppError('TVAN_EHOADON_XML_ID_MISSING', 'XML GDT thiếu DLHDon/@Id.', 422);
  if (ids.length !== 1 || !/^\d{24}$/.test(ids[0])) {
    throw new AppError('TVAN_EHOADON_XML_ID_UNSUPPORTED', 'DLHDon/@Id không đúng định dạng 24 chữ số của provider.', 422);
  }
  return `ct_${ids[0].slice(0, 14)}_${ids[0].slice(14)}`;
}

function normalizedDate(value: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value.trim());
  if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  return undefined;
}

function validateInvoice(result: EhoadonLookupResult, document: InvoiceDocument): void {
  const equal = (left: string | undefined, right: string | number | undefined) =>
    !left || right === undefined || right === '' || left.trim() === String(right).trim();
  const invoiceNo = (value: string | number | undefined) => {
    const text = String(value ?? '').trim();
    return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
  };
  const dateMatches = !result.issueDate || !document.issueDate
    || !normalizedDate(result.issueDate) || !normalizedDate(document.issueDate)
    || normalizedDate(result.issueDate) === normalizedDate(document.issueDate);
  if (!equal(result.series, document.series)
    || (result.invoiceNo && document.invoiceNo !== undefined && invoiceNo(result.invoiceNo) !== invoiceNo(document.invoiceNo))
    || !equal(result.buyerTaxCode, document.buyer?.taxCode)
    || !dateMatches) {
    throw new AppError('TVAN_EHOADON_INVOICE_MISMATCH', 'Dữ liệu tra cứu không khớp hóa đơn đã chọn.', 422);
  }
}

function sessionCookie(response: Response): string | undefined {
  const values = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  for (const value of values) {
    const match = /(?:^|[,;]\s*)ASP\.NET_SessionId=([A-Za-z0-9_-]{1,128})(?:;|,|$)/i.exec(value);
    if (match) return `ASP.NET_SessionId=${match[1]}`;
  }
  return undefined;
}

export class EhoadonDientuPresentationAdapter implements TvanAdapter {
  readonly providerCode = 'ehoadondientu';
  readonly displayName = 'ehoadondientu.com';
  readonly captchaMode = 'none' as const;
  readonly priority = 'P1' as const;

  matches(document: InvoiceDocument): boolean {
    const taxCode = solutionTaxCodeOf(document);
    if (taxCode) return taxCode === EHOADON_SOLUTION_TAX_CODE;
    return portalHostOf(document) === EHOADON_DOMAIN;
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    const code = lookupCode(document);
    const xmlFallback = canLoadInvoiceXml(document);
    return {
      providerCode: this.providerCode,
      displayName: this.displayName,
      supported: Boolean(code || xmlFallback),
      captchaMode: this.captchaMode,
      priority: this.priority,
      reason: code || xmlFallback ? undefined : 'Thiếu mã tra cứu hoặc định danh GDT để tải XML ehoadondientu.',
    };
  }

  async downloadPdf(document: InvoiceDocument, context: TvanAdapterContext): Promise<TvanPdfResult> {
    if (!this.matches(document)) {
      throw new AppError('TVAN_EHOADON_PROVIDER_MISMATCH', 'Hóa đơn không thuộc ehoadondientu.', 422);
    }
    const code = lookupCode(document);
    let providerRef: string | undefined;
    if (!code) {
      if (!canLoadInvoiceXml(document)) throw new AppError('TVAN_EHOADON_REFERENCE_MISSING', 'Thiếu mã tra cứu hoặc định danh GDT.', 422);
      if (!context.loadInvoiceXml) throw new AppError('TVAN_EHOADON_XML_ID_MISSING', 'Phiên GDT không hỗ trợ tải XML hóa đơn.', 422);
      const xml = await context.loadInvoiceXml(document);
      providerRef = ehoadonReferenceFromXml(xml, document);
    }
    let cookie: string | undefined;
    try {
      const bootstrap = await fetchWithTimeout(context.fetchImpl, assertAllowedUrl(`${ORIGIN}/Tracuu.aspx`, ALLOWED_HOSTS), { method: 'GET' }, context.timeoutMs, ALLOWED_HOSTS);
      if (!bootstrap.ok) throw new AppError('TVAN_EHOADON_SESSION_FAILED', 'Không khởi tạo được phiên tra cứu.', 502);
      cookie = sessionCookie(bootstrap);
      await bootstrap.body?.cancel();
      if (!cookie) throw new AppError('TVAN_EHOADON_SESSION_FAILED', 'Portal không cấp phiên tra cứu.', 502);

      if (code) {
        const lookup = await fetchWithTimeout(context.fetchImpl, assertAllowedUrl(`${ORIGIN}/Tracuu.aspx/tracuu`, ALLOWED_HOSTS), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Origin: ORIGIN,
            Referer: `${ORIGIN}/Tracuu.aspx`,
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: cookie,
          },
          body: JSON.stringify({ mahoadon: code, loai: 'mhd', lang: '' }),
        }, context.timeoutMs, ALLOWED_HOSTS);
        if (!lookup.ok) throw new AppError('TVAN_EHOADON_LOOKUP_HTTP_ERROR', 'Portal từ chối tra cứu hóa đơn.', 502);
        cookie = sessionCookie(lookup) || cookie;
        const payload = await readLimited(lookup, Math.min(LOOKUP_MAX_BYTES, context.maxDownloadBytes));
        let parsed: unknown;
        try { parsed = JSON.parse(payload.toString('utf8')); } catch {
          throw new AppError('TVAN_EHOADON_LOOKUP_INVALID', 'Portal trả dữ liệu tra cứu không hợp lệ.', 502);
        }
        const html = parsed && typeof parsed === 'object' ? (parsed as { d?: unknown }).d : undefined;
        if (typeof html !== 'string') throw new AppError('TVAN_EHOADON_LOOKUP_INVALID', 'Portal thiếu kết quả tra cứu.', 502);
        const found = parseEhoadonLookupHtml(html);
        validateInvoice(found, document);
        providerRef = found.providerRef;
      }

      if (!providerRef) throw new AppError('TVAN_EHOADON_REFERENCE_MISSING', 'Không tìm thấy mã tham chiếu hóa đơn.', 422);
      const target = new URL('/Account/GenerateFile.aspx', ORIGIN);
      // The portal starts GenerateFile in an iframe, then polls CheckCompleted only to close its loading dialog.
      // The backend reads the PDF response directly; no pre-download completion request is needed.
      target.searchParams.set('r', providerRef);
      target.searchParams.set('type', 'pdf');
      const downloaded = await fetchWithTimeout(context.fetchImpl, assertAllowedUrl(target.toString(), ALLOWED_HOSTS), {
        method: 'GET', headers: { Cookie: cookie },
      }, context.timeoutMs, ALLOWED_HOSTS);
      if (!downloaded.ok) throw new AppError('TVAN_EHOADON_PDF_HTTP_ERROR', 'Portal không trả file PDF.', 502);
      const contentType = downloaded.headers.get('content-type') || '';
      const content = await readLimited(downloaded, context.maxDownloadBytes);
      if (/\b(?:text\/html|application\/json)\b/i.test(contentType)) {
        throw new AppError('TVAN_EHOADON_PDF_INVALID', 'Portal trả nội dung không phải PDF.', 502);
      }
      try { ensurePdf(content); } catch {
        throw new AppError('TVAN_EHOADON_PDF_INVALID', 'Portal trả nội dung không phải PDF.', 502);
      }
      return {
        content,
        fileName: safePdfFileName([document.seller?.taxCode, document.series, document.invoiceNo].filter(Boolean).join('_') || 'ehoadondientu_invoice'),
        contentType: 'application/pdf',
      };
    } finally {
      cookie = undefined;
    }
  }
}
