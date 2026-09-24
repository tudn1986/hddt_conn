import ExcelJS from 'exceljs';
import type {
  DynamicField,
  ExportColumnMapping,
  ExportProfile,
  ExportTransform,
  InvoiceDocument,
} from '../../shared/models/index.js';
import { AppError, escapeExcelFormula } from '../../shared/utils/index.js';

/** Foundation only: replace mappings after receiving an official AMIS import workbook. */
export const AMIS_FOUNDATION_PROFILE: ExportProfile = {
  id: 'amis-foundation-v1',
  name: 'MISA AMIS mua vào — mapping nền (chưa phải mẫu chính thức)',
  version: '1.0.0',
  documentDirection: 'purchase',
  sheets: [{
    name: 'ChungTu',
    columns: [
      { targetColumn: 'Ngày hạch toán', source: 'issueDate', type: 'date', required: true },
      { targetColumn: 'Số hóa đơn', source: 'invoiceNo', type: 'text', required: true },
      { targetColumn: 'Ký hiệu', source: 'series', type: 'text', required: true },
      { targetColumn: 'Mẫu số', source: 'templateNo', type: 'text' },
      { targetColumn: 'MST đối tượng', source: 'seller.taxCode', type: 'text', required: true },
      { targetColumn: 'Tên đối tượng', source: 'seller.name', type: 'text' },
      { targetColumn: 'Tiền hàng', source: 'subtotal', type: 'number' },
      { targetColumn: 'Tiền thuế', source: 'vatAmount', type: 'number' },
      { targetColumn: 'Tổng tiền', source: 'grandTotal', type: 'number' },
      { targetColumn: 'Loại tiền', source: 'currency', type: 'text', transform: ['default:VND'] },
    ],
  }],
};

export const AMIS_SALES_FOUNDATION_PROFILE: ExportProfile = {
  ...AMIS_FOUNDATION_PROFILE,
  id: 'amis-sales-foundation-v1',
  name: 'MISA AMIS bán ra — mapping nền (chưa phải mẫu chính thức)',
  documentDirection: 'sales',
  sheets: AMIS_FOUNDATION_PROFILE.sheets.map((sheet) => ({
    ...sheet,
    columns: sheet.columns.map((column) => {
      if (column.source === 'seller.taxCode') return { ...column, source: 'buyer.taxCode' };
      if (column.source === 'seller.name') return { ...column, source: 'buyer.name' };
      return { ...column };
    }),
  })),
};

const PROFILES = new Map<string, ExportProfile>([
  [AMIS_FOUNDATION_PROFILE.id, AMIS_FOUNDATION_PROFILE],
  [AMIS_SALES_FOUNDATION_PROFILE.id, AMIS_SALES_FOUNDATION_PROFILE],
]);

function allDynamicFields(document: InvoiceDocument): DynamicField[] {
  return [
    ...document.dynamicFields,
    ...document.seller.dynamicFields,
    ...document.buyer.dynamicFields,
    ...document.lines.flatMap((line) => line.dynamicFields),
  ];
}

export function resolveProfileSource(document: InvoiceDocument, source: string): unknown {
  if (source.startsWith('dynamic:')) {
    const [, section, ...nameParts] = source.split(':');
    const name = nameParts.join(':');
    return allDynamicFields(document).find(
      (field) => (!section || field.section === section) && field.name === name
    )?.rawValue;
  }
  let current: unknown = document;
  for (const part of source.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function transformValue(value: unknown, transforms: ExportTransform[] = []): unknown {
  let result = value;
  for (const transform of transforms) {
    if (transform.startsWith('default:')) {
      if (result === null || result === undefined || result === '') result = transform.slice(8);
    } else if (transform === 'trim') {
      if (result !== null && result !== undefined) result = String(result).trim();
    } else if (transform === 'uppercase') {
      if (result !== null && result !== undefined) result = String(result).toUpperCase();
    } else if (transform === 'lowercase') {
      if (result !== null && result !== undefined) result = String(result).toLowerCase();
    }
  }
  return result;
}

export function mapProfileValue(value: unknown, column: ExportColumnMapping): string | number | null {
  const transformed = transformValue(value, column.transform);
  if (transformed === null || transformed === undefined || transformed === '') return null;
  if (column.type === 'number') {
    const numberValue = Number(transformed);
    if (!Number.isFinite(numberValue)) {
      throw new AppError('PROFILE_TYPE_ERROR', `${column.targetColumn} không phải số.`);
    }
    return numberValue;
  }
  if (column.type === 'date') {
    const text = String(transformed);
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const date = new Date(text);
    if (!Number.isFinite(date.valueOf())) {
      throw new AppError('PROFILE_TYPE_ERROR', `${column.targetColumn} không phải ngày hợp lệ.`);
    }
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }
  return escapeExcelFormula(String(transformed));
}

export function getProfile(profileId: string): ExportProfile {
  const profile = PROFILES.get(profileId);
  if (!profile) throw new AppError('PROFILE_NOT_FOUND', 'Không tìm thấy export profile.', 404);
  return profile;
}

export async function exportWithProfile(
  documents: InvoiceDocument[],
  profile: ExportProfile = AMIS_FOUNDATION_PROFILE
): Promise<Buffer> {
  if (profile.documentDirection && documents.some((document) => document.direction !== profile.documentDirection)) {
    throw new AppError('PROFILE_DIRECTION', 'Dataset không đúng hướng chứng từ của profile.');
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HDDT_v1.2.1';
  workbook.created = new Date();

  for (const sheetProfile of profile.sheets) {
    const sheet = workbook.addWorksheet(sheetProfile.name.slice(0, 31), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.addRow(sheetProfile.columns.map((column) => column.targetColumn));
    sheet.getRow(1).font = { bold: true };
    for (const [index, document] of documents.entries()) {
      const row = sheetProfile.columns.map((column) => {
        const value = mapProfileValue(resolveProfileSource(document, column.source), column);
        if (column.required && (value === null || value === '')) {
          throw new AppError(
            'PROFILE_REQUIRED',
            `Dòng ${index + 2}, cột ${column.targetColumn}: thiếu dữ liệu bắt buộc.`
          );
        }
        return value;
      });
      sheet.addRow(row);
    }
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheetProfile.columns.length },
    };
    sheetProfile.columns.forEach((column, index) => {
      const excelColumn = sheet.getColumn(index + 1);
      if (column.type === 'text' || column.type === 'vat-rate') excelColumn.numFmt = '@';
      excelColumn.width = Math.min(50, Math.max(14, column.targetColumn.length + 2));
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function listProfiles(): ExportProfile[] {
  return Array.from(PROFILES.values()).map((profile) => structuredClone(profile));
}
