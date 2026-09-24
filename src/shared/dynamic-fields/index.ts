import type { DynamicField } from '../models/index.js';
import { isRecord, safeString } from '../utils/index.js';

const CONTAINERS = ['ttkhac', 'cttkhac', 'nbttkhac', 'nmttkhac', 'ttttkhac'];
const KNOWN_STATIC_KEYS = new Set([
  'id', 'idhdon', 'stt', 'sxep', 'tchat', 'ten', 'hhdvu', 'dvtinh', 'dvt',
  'sluong', 'dgia', 'thtien', 'tien', 'ltsuat', 'tsuat', 'tthue', 'thtcthue',
  'tlckhau', 'stckhau', 'stbchu', 'dvtte', 'tgia', 'tthhdtrung', 'nbmst',
  'nbten', 'nbmst_ten', 'nbdchi', 'nmmst', 'nmten', 'nmdchi', 'khmshdon',
  'khhdon', 'shdon', 'tdlap', 'nlap', 'loaihd', 'tenloaihd', 'tthai',
  'ttxly', 'ngcnhat', 'tgtttbso', 'tgtttbchu', 'tgtthue', 'tgtcthue',
  'htttoan', 'hdhhdvu', 'thue', 'thttltsuat', 'nguoiban', 'nguoimua',
  'seller', 'buyer', 'taxSummaries',
  'key', 'direction', 'invoiceSource', 'portalInvoiceId', 'portalLineId', 'documentTypeCode',
  'documentTypeName', 'templateNo', 'series', 'invoiceNo', 'issueDate',
  'signingTime', 'receivedTime', 'codedTime', 'updatedTime', 'currency',
  'exchangeRate', 'subtotal', 'nonTaxableAmount', 'discountAmount',
  'vatAmount', 'feeAmount', 'otherAmount', 'grandTotal', 'grandTotalInWords',
  'paymentMethod', 'invoiceStatus', 'processingStatus', 'nature', 'providerCode',
  'lookup', 'qrCode', 'lines', 'dynamicFields', 'rawSummary', 'rawDetail',
  'taxCode', 'name', 'address', 'bankAccount', 'bankName', 'phone', 'email',
  'fax', 'website', 'identityNo', 'lineNo', 'sortOrder', 'lineType', 'itemName',
  'unit', 'quantity', 'unitPrice', 'amount', 'vatRateText', 'vatRate',
  'amountBeforeTax', 'discountRate', 'amountInWords', 'supplementalInfo', 'duplicateGoodsInfo', 'raw',
  'taxableAmount', 'vatRateValue',
]);

export function extractDynamicFields(
  raw: Record<string, unknown> | null | undefined,
  section: string
): DynamicField[] {
  if (!raw) return [];
  const result: DynamicField[] = [];

  for (const containerName of CONTAINERS) {
    const container = raw[containerName];
    const dynamicSection = section.endsWith(`.${containerName}`)
      ? section
      : `${section}.${containerName}`;
    if (Array.isArray(container)) {
      for (const item of container) {
        if (!isRecord(item)) continue;
        const name =
          safeString(item.ttruong) || safeString(item.ten) || safeString(item.name) || safeString(item.key) ||
          safeString(item.ma) || 'unknown';
        result.push({
          section: dynamicSection,
          name,
          dataType: safeString(item.kdlieu) || safeString(item.kieu) || safeString(item.type),
          rawValue: item.dlieu ?? item.value ?? item.giatri ?? item,
        });
      }
    } else if (isRecord(container)) {
      for (const [name, rawValue] of Object.entries(container)) {
        result.push({ section: dynamicSection, name, rawValue });
      }
    }
  }

  for (const [name, rawValue] of Object.entries(raw)) {
    if (
      KNOWN_STATIC_KEYS.has(name) ||
      CONTAINERS.includes(name) ||
      rawValue === null ||
      rawValue === undefined
    ) continue;
    result.push({ section, name, rawValue });
  }
  return result;
}

export function dedupeDynamicFields(fields: DynamicField[]): DynamicField[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.section}\u0000${field.name}\u0000${JSON.stringify(field.rawValue)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
