/**
 * General Excel report exporter — Spec section 16
 */

import ExcelJS from 'exceljs';
import type { InvoiceDocument } from '../../shared/models/index.js';
import { AppError, escapeExcelFormula } from '../../shared/utils/index.js';

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
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HDDT_v1.3.1';
  wb.created = new Date();

  const sheetInv = wb.addWorksheet('HoaDon', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const invHeaders = [
    'STT', 'Nguồn', 'Hướng', 'Ngày lập', 'Loại chứng từ', 'Mẫu số', 'Ký hiệu', 'Số hóa đơn',
    'MST người bán', 'Tên người bán', 'MST người mua', 'Tên người mua',
    'Tiền trước thuế', 'Tiền thuế', 'Tổng tiền', 'Tiền tệ', 'Tỷ giá',
    'Trạng thái', 'TVAN', 'Mã tra cứu', 'Link tra cứu', 'Key',
  ];
  sheetInv.addRow(invHeaders);
  styleHeader(sheetInv);

  documents.forEach((d, idx) => {
    sheetInv.addRow([
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
    ]);
  });
  autoFilterAndWidth(sheetInv);
  ['F', 'G', 'H', 'I', 'K', 'V'].forEach((col) => {
    sheetInv.getColumn(col).numFmt = '@';
  });

  const sheetLine = wb.addWorksheet('ChiTiet', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheetLine.addRow([
    'STT', 'Key hóa đơn', 'Số hóa đơn', 'Ký hiệu', 'STT dòng',
    'Mã hàng hóa/dịch vụ', 'Tên hàng/dịch vụ', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền',
    'Thuế suất', 'Tiền thuế', 'Chiết khấu', 'Tiền tệ',
  ]);
  styleHeader(sheetLine);
  let lineStt = 0;
  for (const d of documents) {
    for (const line of d.lines || []) {
      lineStt += 1;
      sheetLine.addRow([
        lineStt, asText(d.key), asText(d.invoiceNo), asText(d.series),
        asNumber(line.lineNo), asText(line.itemCode), asText(line.itemName), asText(line.unit),
        asNumber(line.quantity), asNumber(line.unitPrice), asNumber(line.amount),
        asText(line.vatRateText ?? line.vatRate), asNumber(line.vatAmount),
        asNumber(line.discountAmount), asText(line.currency || d.currency),
      ]);
    }
  }
  autoFilterAndWidth(sheetLine);
  ['B', 'C', 'D', 'F'].forEach((column) => { sheetLine.getColumn(column).numFmt = '@'; });

  const sheetTax = wb.addWorksheet('Thue', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheetTax.addRow([
    'STT', 'Key hóa đơn', 'Số hóa đơn', 'Thuế suất',
    'Tiền chịu thuế', 'Tiền thuế', 'Giá trị thuế suất',
  ]);
  styleHeader(sheetTax);
  let taxStt = 0;
  for (const d of documents) {
    for (const t of d.taxSummaries || []) {
      taxStt += 1;
      sheetTax.addRow([
        taxStt, asText(d.key), asText(d.invoiceNo), asText(t.vatRateText),
        asNumber(t.taxableAmount), asNumber(t.vatAmount), asNumber(t.vatRateValue),
      ]);
    }
  }
  autoFilterAndWidth(sheetTax);
  ['B', 'C'].forEach((column) => { sheetTax.getColumn(column).numFmt = '@'; });

  const sheetLookup = wb.addWorksheet('TraCuu', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheetLookup.addRow([
    'STT', 'Key', 'Số hóa đơn', 'TVAN', 'Mã tra cứu', 'Loại mã',
    'Base URL', 'Path', 'Confidence',
  ]);
  styleHeader(sheetLookup);
  documents.forEach((d, idx) => {
    sheetLookup.addRow([
      idx + 1, asText(d.key), asText(d.invoiceNo),
      asText(d.providerCode || d.lookup?.providerCode),
      asText(d.lookup?.lookupCode), asText(d.lookup?.lookupCodeType),
      asText(d.lookup?.lookupBaseUrl), asText(d.lookup?.lookupPathRaw),
      asText(d.lookup?.confidence),
    ]);
  });
  autoFilterAndWidth(sheetLookup);
  ['B', 'C', 'E'].forEach((column) => { sheetLookup.getColumn(column).numFmt = '@'; });

  const sheetDyn = wb.addWorksheet('Dynamic', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheetDyn.addRow(['STT', 'Key hóa đơn', 'Section', 'Name', 'Value']);
  styleHeader(sheetDyn);
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
      sheetDyn.addRow([
        dynStt, asText(d.key), asText(f.section), asText(f.name),
        asText(typeof f.rawValue === 'object' ? JSON.stringify(f.rawValue) : f.rawValue),
      ]);
    }
  }
  autoFilterAndWidth(sheetDyn);
  sheetDyn.getColumn('B').numFmt = '@';

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };
}

function autoFilterAndWidth(sheet: ExcelJS.Worksheet) {
  const colCount = sheet.columnCount;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: colCount },
  };
  sheet.columns.forEach((col) => {
    let max = 12;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > max) max = Math.min(len + 2, 50);
    });
    col.width = max;
  });
}
