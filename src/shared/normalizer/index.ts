import type {
  Direction,
  DynamicField,
  InvoiceDocument,
  InvoiceLine,
  InvoiceLocator,
  InvoiceSource,
  LineSupplementalInfo,
  Party,
  TaxSummary,
} from '../models/index.js';
import { buildDocumentKey } from '../filenames/index.js';
import { dedupeDynamicFields, extractDynamicFields } from '../dynamic-fields/index.js';
import { extractLookup } from '../lookup/index.js';
import { normalizeInvoiceRelation } from '../invoice-relations/normalize-relation.js';
import { presentationForSolutionTaxCode } from '../provider-resolution.js';
import { readLineAmount, resolveFinancialAmounts } from './financial-amounts.js';
import {
  isRecord,
  safeNumber,
  safeString,
  safeStringOrNumber,
} from '../utils/index.js';


function mergeRecords(
  summary: Record<string, unknown>,
  detail?: Record<string, unknown> | null
): Record<string, unknown> {
  const merged = { ...summary };
  if (detail) {
    for (const [key, value] of Object.entries(detail)) {
      if (value !== undefined && value !== null) merged[key] = value;
    }
  }
  return merged;
}

function existingDynamicFields(value: unknown): DynamicField[] {
  if (!Array.isArray(value)) return [];
  const result: DynamicField[] = [];
  for (const field of value) {
    if (!isRecord(field)) continue;
    const section = safeString(field.section);
    const name = safeString(field.name);
    if (section && name) {
      result.push({
        section,
        name,
        dataType: safeString(field.dataType),
        rawValue: field.rawValue,
      });
    }
  }
  return result;
}

function supplementalInfo(value: unknown): LineSupplementalInfo[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    type: safeStringOrNumber(item.lhhdtrung ?? item.type),
    name: safeString(item.ttruong ?? item.name),
    rawValue: item.dlieu ?? item.value ?? item.rawValue,
  }));
}

function mapLine(raw: Record<string, unknown>, invoiceCurrency?: string): InvoiceLine {
  const rawTax = raw.tsuat ?? raw.thue;
  return {
    portalLineId: safeString(raw.id ?? raw.hdid ?? raw.portalLineId),
    portalInvoiceId: safeString(raw.idhdon ?? raw.portalInvoiceId),
    lineNo: safeNumber(raw.stt ?? raw.lineNo),
    sortOrder: safeNumber(raw.sxep ?? raw.sortOrder),
    lineType: safeStringOrNumber(raw.tchat ?? raw.lineType),
    itemCode: safeString(raw.mhhdvu ?? raw.ma ?? raw.itemCode),
    itemName: safeString(raw.ten ?? raw.hhdvu ?? raw.itemName),
    unit: safeString(raw.dvtinh ?? raw.dvt ?? raw.unit),
    quantity: safeNumber(raw.sluong ?? raw.quantity),
    unitPrice: safeNumber(raw.dgia ?? raw.unitPrice),
    amount: readLineAmount(raw, invoiceCurrency, 'amount'),
    vatRateText: safeString(
      raw.ltsuat ?? raw.vatRateText ?? (typeof rawTax === 'string' ? rawTax : undefined)
    ),
    vatRate: safeNumber(rawTax ?? raw.vatRate),
    vatAmount: readLineAmount(raw, invoiceCurrency, 'vatAmount'),
    amountBeforeTax: readLineAmount(raw, invoiceCurrency, 'amountBeforeTax'),
    discountRate: safeNumber(raw.tlckhau ?? raw.discountRate),
    discountAmount: safeNumber(raw.stckhau ?? raw.discountAmount),
    amountInWords: safeString(raw.stbchu ?? raw.amountInWords),
    currency: safeString(raw.dvtte ?? raw.currency),
    exchangeRate: safeNumber(raw.tgia ?? raw.exchangeRate),
    dynamicFields: dedupeDynamicFields([
      ...existingDynamicFields(raw.dynamicFields),
      ...extractDynamicFields(raw, 'line'),
    ]),
    supplementalInfo: supplementalInfo(raw.tthhdtrung ?? raw.supplementalInfo),
    duplicateGoodsInfo: raw.tthhdtrung ?? raw.duplicateGoodsInfo,
    raw,
  };
}

function mapParty(
  root: Record<string, unknown>,
  nested: Record<string, unknown> | undefined,
  prefix: 'nb' | 'nm',
  section: 'seller' | 'buyer'
): Party {
  const raw = { ...root, ...(nested || {}) };
  const prefixed = (suffix: string) => raw[`${prefix}${suffix}`];
  const containerName = `${prefix}ttkhac`;
  const partyDynamicSource = root[containerName] === undefined
    ? undefined
    : { [containerName]: root[containerName] };

  const bankAccount = prefix === 'nb'
    ? (raw.nbstkhoan ?? prefixed('stkhoan') ?? prefixed('stknh'))
    : (raw.nmstkhoan ?? prefixed('stkhoan') ?? prefixed('stknh'));
  const bankName = prefix === 'nb'
    ? (raw.nbtnhang ?? prefixed('tnhang') ?? prefixed('tennh'))
    : (raw.nmtnhang ?? prefixed('tnhang') ?? prefixed('tennh'));
  const phone = prefix === 'nb'
    ? (raw.nbsdthoai ?? prefixed('sdthoai') ?? prefixed('sdt'))
    : (raw.nmsdthoai ?? prefixed('sdthoai') ?? prefixed('sdt'));
  const email = prefix === 'nb'
    ? (raw.nbdctdtu ?? prefixed('dctdtu') ?? prefixed('email'))
    : (raw.nmdctdtu ?? prefixed('dctdtu') ?? prefixed('email'));
  const identity = prefix === 'nm'
    ? (raw.nmcccd ?? raw.nmcmnd ?? prefixed('cccd') ?? prefixed('cmnd'))
    : prefixed('cccd');

  return {
    taxCode: safeString(nested?.mst ?? nested?.taxCode ?? prefixed('mst') ?? raw.mst ?? raw.taxCode),
    name: safeString(
      nested?.ten ?? nested?.name ?? prefixed('ten') ?? raw[`${prefix}mst_ten`] ?? raw.ten ?? raw.name
    ),
    address: safeString(nested?.dchi ?? nested?.address ?? prefixed('dchi') ?? raw.dchi ?? raw.address),
    bankAccount: safeString(nested?.stknh ?? nested?.bankAccount ?? bankAccount ?? raw.stknh ?? raw.bankAccount),
    bankName: safeString(nested?.tennh ?? nested?.bankName ?? bankName ?? raw.tennh ?? raw.bankName),
    phone: safeString(nested?.sdt ?? nested?.phone ?? phone ?? raw.sdt ?? raw.phone),
    email: safeString(nested?.email ?? email ?? raw.email),
    fax: safeString(nested?.fax ?? prefixed('fax') ?? raw.fax),
    website: safeString(nested?.website ?? prefixed('website') ?? raw.website),
    identityNo: safeString(nested?.cccd ?? nested?.identityNo ?? identity ?? raw.cccd ?? raw.identityNo),
    dynamicFields: dedupeDynamicFields([
      ...existingDynamicFields(nested?.dynamicFields),
      ...extractDynamicFields(nested, section),
      ...extractDynamicFields(partyDynamicSource, section),
    ]),
  };
}

function taxSummaryFrom(raw: Record<string, unknown>): TaxSummary {
  const rateText = safeString(raw.tsuat ?? raw.ltsuat ?? raw.vatRateText);
  return {
    vatRateText: rateText,
    taxableAmount: safeNumber(raw.thtien ?? raw.tgtcthue ?? raw.taxableAmount),
    vatAmount: safeNumber(raw.tthue ?? raw.tgtthue ?? raw.vatAmount),
    vatRateValue: safeNumber(raw.gttsuat ?? raw.vatRateValue ?? raw.tsuat),
  };
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * Normalize both /api/query and /api/sco-query payloads into one stable domain model.
 * The source is supplied by the caller from the endpoint namespace; it is never inferred from ttxly.
 */
export function normalizeInvoice(
  direction: Direction,
  invoiceSource: InvoiceSource,
  summary: Record<string, unknown>,
  detail?: Record<string, unknown> | null
): InvoiceDocument {
  const source = mergeRecords(summary, detail);
  const sellerTaxCode = safeString(source.nbmst ?? source.sellerTaxCode) || '';
  const templateNo = safeStringOrNumber(source.khmshdon ?? source.templateNo) ?? '';
  const series = safeString(source.khhdon ?? source.series) || '';
  const invoiceNo = safeStringOrNumber(source.shdon ?? source.invoiceNo) ?? '';
  const locator: InvoiceLocator = { sellerTaxCode, templateNo, series, invoiceNo };

  const sellerNested = isRecord(source.nguoiban)
    ? source.nguoiban
    : isRecord(source.seller) ? source.seller : undefined;
  const buyerNested = isRecord(source.nguoimua)
    ? source.nguoimua
    : isRecord(source.buyer) ? source.buyer : undefined;
  const seller = mapParty(source, sellerNested, 'nb', 'seller');
  const buyer = mapParty(source, buyerNested, 'nm', 'buyer');
  if (!seller.taxCode) seller.taxCode = sellerTaxCode;

  const currency = safeString(source.dvtte ?? source.currency);
  const lines = arrayOfRecords(source.hdhhdvu ?? source.lines).map((line) => mapLine(line, currency));
  const rawTax = source.thue ?? source.thttltsuat ?? source.taxSummaries ?? source.thuesuat;
  const taxSummaries = arrayOfRecords(rawTax).map(taxSummaryFrom);
  const financial = resolveFinancialAmounts({ source, summary, detail, lines, taxSummaries });
  const issueDate = safeString(source.tdlap ?? source.nlap ?? source.ddLap ?? source.issueDate);
  const solutionProviderTaxCode = safeString(source.msttcgp);
  const transportProviderTaxCode = safeString(source.tvandnkntt);
  const transportProviderCode = safeString(source.ngcnhat ?? source.tentvandnkntt);
  const providerCode = safeString(source.ngcnhat ?? source.tentvandnkntt ?? source.providerCode);
  const dynamicFields = dedupeDynamicFields([
    ...existingDynamicFields(summary.dynamicFields),
    ...extractDynamicFields(summary, 'invoice'),
    ...existingDynamicFields(detail?.dynamicFields),
    ...(detail ? extractDynamicFields(detail, 'invoice') : []),
  ]);

  return {
    key: buildDocumentKey(direction, invoiceSource, locator),
    direction,
    invoiceSource,
    portalInvoiceId: safeString(source.id ?? source.portalInvoiceId),
    documentTypeCode: safeString(source.loaihd ?? source.hdon ?? source.documentTypeCode),
    documentTypeName: safeString(source.tenloaihd ?? source.thdon ?? source.tlhdon ?? source.documentTypeName),
    templateNo,
    series,
    invoiceNo,
    issueDate,
    signingTime: safeString(source.nky ?? source.tdky ?? source.signingTime),
    receivedTime: safeString(source.ntnhan ?? source.tdnhan ?? source.receivedTime),
    codedTime: safeString(source.ncma ?? source.tdmahoa ?? source.codedTime),
    updatedTime: safeString(source.ncnhat ?? source.tdcapnhat ?? source.updatedTime),
    seller,
    buyer,
    currency,
    exchangeRate: safeNumber(source.tgia ?? source.exchangeRate),
    subtotal: financial.subtotal,
    nonTaxableAmount: safeNumber(source.tgtkcthue ?? source.thtienkct ?? source.nonTaxableAmount),
    discountAmount: safeNumber(source.ttcktmai ?? source.ttckhau ?? source.discountAmount),
    vatAmount: financial.vatAmount,
    feeAmount: safeNumber(source.tgtphi ?? source.phikhac ?? source.feeAmount),
    otherAmount: safeNumber(source.tgtkhac ?? source.khac ?? source.otherAmount),
    grandTotal: safeNumber(source.tgtttbso ?? source.tongtien ?? source.grandTotal),
    grandTotalInWords: safeString(source.tgtttbchu ?? source.grandTotalInWords),
    paymentMethod: safeString(source.thtttoan ?? source.htttoan ?? source.paymentMethod),
    invoiceStatus: safeStringOrNumber(source.tthai ?? source.invoiceStatus),
    processingStatus: safeStringOrNumber(source.ttxly ?? source.processingStatus),
    nature: safeStringOrNumber(source.tchat ?? source.nature),
    relation: normalizeInvoiceRelation(summary) ?? normalizeInvoiceRelation(source),
    providerCode,
    providers: {
      solution: solutionProviderTaxCode ? { taxCode: solutionProviderTaxCode } : undefined,
      transport: transportProviderTaxCode || transportProviderCode
        ? { taxCode: transportProviderTaxCode, code: transportProviderCode }
        : undefined,
      presentation: presentationForSolutionTaxCode(solutionProviderTaxCode),
    },
    lookup: extractLookup(source, providerCode),
    qrCode: safeString(source.qrcode ?? source.qrCode),
    taxSummaries,
    lines,
    dynamicFields,
    rawSummary: summary,
    rawDetail: detail ?? undefined,
  };
}

export function locatorFromRaw(raw: Record<string, unknown>): InvoiceLocator {
  return {
    sellerTaxCode: safeString(raw.nbmst) || '',
    templateNo: safeStringOrNumber(raw.khmshdon) ?? '',
    series: safeString(raw.khhdon) || '',
    invoiceNo: safeStringOrNumber(raw.shdon) ?? '',
  };
}
