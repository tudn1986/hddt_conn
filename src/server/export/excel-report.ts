/**
 * General Excel report exporter — Spec section 16
 */

import type { InvoiceDocument } from '../../shared/models/index.js';
import { AppError, escapeExcelFormula } from '../../shared/utils/index.js';
import { APP_VERSION } from '../../shared/version.js';
import { createXlsxStream, writeSheet } from './xlsx-stream.js';

const EXCEL_MAX_ROWS = 1_048_576;

function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return escapeExcelFormula(String(v));
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatDateCell(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;
      return iso;
    }
    const fmt = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    return fmt.format(d);
  } catch {
    return iso;
  }
}

export async function exportReportWorkbook(
  documents: InvoiceDocument[],
  _direction: 'purchase' | 'sales'
): Promise<Buffer> {
  const lineCount = documents.reduce((total, document) => total + document.lines.length, 0);
  const taxCount = documents.reduce((total, document) => total + document.taxSummaries.length, 0);
  const dynamicCount = documents.reduce(
    (total, document) => total +
      document.dynamicFields.length +
      document.seller.dynamicFields.length +
      document.buyer.dynamicFields.length +
      document.lines.reduce((lineTotal, line) => lineTotal + line.dynamicFields.length, 0),
    0
  );
  if ([documents.length, lineCount, taxCount, dynamicCount].some((count) => count + 1 > EXCEL_MAX_ROWS)) {
    throw new AppError('EXCEL_ROW_LIMIT', 'Dữ liệu vượt giới hạn số dòng của Excel.', 413);
  }
  const xlsx = createXlsxStream(`HDDT_v${APP_VERSION}`);
  try {
    writeSheet(xlsx.writer, {
      name: 'HoaDon',
      headers: [
        'STT', 'Nguồn', 'Hướng', 'Ngày lập', 'Loại chứng từ', 'Mẫu số', 'Ký hiệu', 'Số hóa đơn',
        'MST người bán', 'Tên người bán', 'MST người mua', 'Tên người mua',
        'Tiền trước thuế', 'Tiền thuế', 'Tổng tiền', 'Tiền tệ', 'Tỷ giá',
        'Trạng thái', 'TVAN', 'Mã tra cứu', 'Link tra cứu', 'Key',
      ],
      textColumns: [5, 6, 7, 8, 10, 21],
      headerFill: true,
      rows: function* () {
        for (const [idx, d] of documents.entries()) {
          yield [
            idx + 1, d.invoiceSource === 'pos' ? 'Máy tính tiền' : 'HĐĐT thường', d.direction, formatDateCell(d.issueDate),
            asText(d.documentTypeName || d.documentTypeCode),
            asText(d.templateNo), asText(d.series), asText(d.invoiceNo),
            asText(d.seller?.taxCode), asText(d.seller?.name),
            asText(d.buyer?.taxCode), asText(d.buyer?.name),
            asNumber(d.subtotal), asNumber(d.vatAmount), asNumber(d.grandTotal),
            asText(d.currency), asNumber(d.exchangeRate),
            asText(d.invoiceStatus), asText(d.providerCode),
            asText(d.lookup?.lookupCode),
            asText(d.lookup?.lookupPathRaw || d.lookup?.lookupBaseUrl),
            asText(d.key),
          ];
        }
      },
    });

    writeSheet(xlsx.writer, {
      name: 'ChiTiet',
      headers: [
        'STT', 'Key hóa đơn', 'Số hóa đơn', 'Ký hiệu', 'STT dòng',
        'Mã hàng hóa/dịch vụ', 'Tên hàng/dịch vụ', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền',
        'Thuế suất', 'Tiền thuế', 'Chiết khấu', 'Tiền tệ',
      ],
      textColumns: [1, 2, 3, 5],
      headerFill: true,
      rows: function* () {
        let lineStt = 0;
        for (const d of documents) {
          for (const line of d.lines || []) {
            lineStt += 1;
            yield [
              lineStt, asText(d.key), asText(d.invoiceNo), asText(d.series),
              asNumber(line.lineNo), asText(line.itemCode), asText(line.itemName), asText(line.unit),
              asNumber(line.quantity), asNumber(line.unitPrice), asNumber(line.amount),
              asText(line.vatRateText ?? line.vatRate), asNumber(line.vatAmount),
              asNumber(line.discountAmount), asText(line.currency || d.currency),
            ];
          }
        }
      },
    });

    writeSheet(xlsx.writer, {
      name: 'Thue',
      headers: ['STT', 'Key hóa đơn', 'Số hóa đơn', 'Thuế suất', 'Tiền chịu thuế', 'Tiền thuế', 'Giá trị thuế suất'],
      textColumns: [1, 2],
      headerFill: true,
      rows: function* () {
        let taxStt = 0;
        for (const d of documents) {
          for (const t of d.taxSummaries || []) {
            taxStt += 1;
            yield [
              taxStt, asText(d.key), asText(d.invoiceNo), asText(t.vatRateText),
              asNumber(t.taxableAmount), asNumber(t.vatAmount), asNumber(t.vatRateValue),
            ];
          }
        }
      },
    });

    writeSheet(xlsx.writer, {
      name: 'TraCuu',
      headers: ['STT', 'Key', 'Số hóa đơn', 'TVAN', 'Mã tra cứu', 'Loại mã', 'Base URL', 'Path', 'Confidence'],
      textColumns: [1, 2, 4],
      headerFill: true,
      rows: function* () {
        for (const [idx, d] of documents.entries()) {
          yield [
            idx + 1, asText(d.key), asText(d.invoiceNo),
            asText(d.providerCode || d.lookup?.providerCode),
            asText(d.lookup?.lookupCode), asText(d.lookup?.lookupCodeType),
            asText(d.lookup?.lookupBaseUrl), asText(d.lookup?.lookupPathRaw),
            asText(d.lookup?.confidence),
          ];
        }
      },
    });

    writeSheet(xlsx.writer, {
      name: 'Dynamic',
      headers: ['STT', 'Key hóa đơn', 'Section', 'Name', 'Value'],
      textColumns: [1],
      headerFill: true,
      rows: function* () {
        let dynStt = 0;
        for (const d of documents) {
          const fields = [
            ...(d.dynamicFields || []),
            ...(d.seller.dynamicFields || []),
            ...(d.buyer.dynamicFields || []),
            ...d.lines.flatMap((line) => line.dynamicFields || []),
          ];
          for (const f of fields) {
            dynStt += 1;
            yield [
              dynStt, asText(d.key), asText(f.section), asText(f.name),
              asText(typeof f.rawValue === 'object' ? JSON.stringify(f.rawValue) : f.rawValue),
            ];
          }
        }
      },
    });

    return await xlsx.finish();
  } catch (error) {
    xlsx.abort();
    throw error;
  }
}
