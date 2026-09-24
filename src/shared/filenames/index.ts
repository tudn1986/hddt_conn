import type { InvoiceDocument, InvoiceLocator, InvoiceSource } from '../models/index.js';
import { AppError } from '../utils/index.js';

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function toBusinessDateYYYYMMDD(input?: string | Date | null): string {
  if (!input) throw new AppError('MISSING_ISSUE_DATE', 'Hóa đơn thiếu ngày lập để đặt tên file.');
  if (typeof input === 'string') {
    const pureDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
    if (pureDate) {
      const year = Number(pureDate[1]);
      const month = Number(pureDate[2]);
      const day = Number(pureDate[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new AppError('INVALID_ISSUE_DATE', 'Ngày lập hóa đơn không tồn tại trong lịch.');
      }
      return `${pureDate[1]}${pureDate[2]}${pureDate[3]}`;
    }
  }
  const date = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(date.valueOf())) {
    throw new AppError('INVALID_ISSUE_DATE', 'Ngày lập hóa đơn không hợp lệ.');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${get('year')}${get('month')}${get('day')}`;
}

export function sanitizeFilenamePart(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .normalize('NFC')
    .trim()
    .replace(INVALID_FILENAME_CHARS, '')
    .replace(/\.\.+/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 100);
}

function requiredPart(value: string, label: string): string {
  if (!value || /^\.+$/.test(value)) throw new AppError('INVALID_FILENAME', `Thiếu ${label} để đặt tên file.`);
  return value;
}

export function buildInvoiceFilename(
  locator: InvoiceLocator,
  issueDate: string | Date | undefined,
  ext: 'xml' | 'zip',
  invoiceSource: InvoiceSource = 'standard'
): string {
  const ymd = toBusinessDateYYYYMMDD(issueDate);
  const mst = requiredPart(sanitizeFilenamePart(locator.sellerTaxCode), 'MST người bán');
  const series = requiredPart(sanitizeFilenamePart(locator.series), 'ký hiệu hóa đơn');
  const invoiceNo = requiredPart(sanitizeFilenamePart(locator.invoiceNo), 'số hóa đơn');
  const prefix = invoiceSource === 'pos' ? 'POS_' : '';
  return `${prefix}${ymd}_${mst}_${series}_${invoiceNo}.${ext}`;
}

export function buildFilenameFromDocument(
  document: InvoiceDocument,
  ext: 'xml' | 'zip'
): string {
  return buildInvoiceFilename(
    {
      sellerTaxCode: document.seller.taxCode ?? '',
      templateNo: document.templateNo ?? '',
      series: document.series ?? '',
      invoiceNo: document.invoiceNo ?? '',
    },
    document.issueDate,
    ext,
    document.invoiceSource
  );
}

export function buildDocumentKey(direction: string, invoiceSource: InvoiceSource, locator: InvoiceLocator): string {
  return [
    direction,
    invoiceSource,
    sanitizeFilenamePart(locator.sellerTaxCode),
    sanitizeFilenamePart(locator.templateNo),
    sanitizeFilenamePart(locator.series),
    sanitizeFilenamePart(locator.invoiceNo),
  ].join('|');
}
