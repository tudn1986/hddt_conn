import type { InvoiceLine, TaxSummary } from '../models/index.js';
import { isRecord, safeNumber, safeString } from '../utils/index.js';

const INVOICE_DYNAMIC_CONTAINERS = ['ttttkhac', 'ttkhac', 'cttkhac'] as const;
const LINE_DYNAMIC_CONTAINERS = ['ttkhac', 'cttkhac'] as const;

function canonicalName(value: unknown): string {
  return (safeString(value) || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function uniqueRecords(values: Array<Record<string, unknown> | null | undefined>): Record<string, unknown>[] {
  const seen = new Set<Record<string, unknown>>();
  const result: Record<string, unknown>[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function firstNumber(records: Record<string, unknown>[], keys: string[]): number | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = safeNumber(record[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function numberFromDynamicContainer(
  raw: Record<string, unknown>,
  names: string[],
  containers: readonly string[]
): number | undefined {
  const wanted = new Set(names.map(canonicalName));
  for (const containerName of containers) {
    const container = raw[containerName];
    if (Array.isArray(container)) {
      for (const item of container) {
        if (!isRecord(item)) continue;
        const name = canonicalName(item.ttruong ?? item.ten ?? item.name ?? item.key ?? item.ma);
        if (!wanted.has(name)) continue;
        const value = safeNumber(item.dlieu ?? item.value ?? item.giatri ?? item.rawValue);
        if (value !== undefined) return value;
      }
      continue;
    }
    if (!isRecord(container)) continue;
    for (const [name, rawValue] of Object.entries(container)) {
      if (!wanted.has(canonicalName(name))) continue;
      const value = safeNumber(rawValue);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function namedNumber(
  records: Record<string, unknown>[],
  names: string[],
  containers: readonly string[] = INVOICE_DYNAMIC_CONTAINERS
): number | undefined {
  for (const record of records) {
    const value = numberFromDynamicContainer(record, names, containers);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isForeignCurrency(currency: string | undefined): boolean {
  return !!currency && currency.trim().toUpperCase() !== 'VND';
}

function currencyAwareNamedNumber(
  records: Record<string, unknown>[],
  currency: string | undefined,
  originalCurrencyNames: string[],
  baseCurrencyNames: string[],
  containers: readonly string[] = INVOICE_DYNAMIC_CONTAINERS
): number | undefined {
  const foreign = isForeignCurrency(currency);
  const firstNames = foreign ? originalCurrencyNames : baseCurrencyNames;
  const secondNames = foreign ? baseCurrencyNames : originalCurrencyNames;
  return namedNumber(records, firstNames, containers)
    ?? namedNumber(records, secondNames, containers);
}

function sumNumbers(values: Array<number | undefined>): number | undefined {
  let found = false;
  let total = 0;
  for (const value of values) {
    if (value === undefined) continue;
    found = true;
    total += value;
  }
  return found ? total : undefined;
}

function sumTaxableAmounts(taxSummaries: TaxSummary[]): number | undefined {
  return sumNumbers(taxSummaries.map((item) => item.taxableAmount));
}

function sumVatAmounts(taxSummaries: TaxSummary[]): number | undefined {
  return sumNumbers(taxSummaries.map((item) => item.vatAmount));
}

function sumLineSubtotals(lines: InvoiceLine[]): number | undefined {
  return sumNumbers(lines.map((line) => line.amountBeforeTax ?? line.amount));
}

function sumLineVat(lines: InvoiceLine[]): number | undefined {
  return sumNumbers(lines.map((line) => line.vatAmount));
}

export function isNoVatDocumentType(documentTypeCode: unknown): boolean {
  const code = (safeString(documentTypeCode) || '').trim().toUpperCase();
  return code === '02' || code === '06' || code.startsWith('06_');
}

export function readLineAmount(
  raw: Record<string, unknown>,
  currency: string | undefined,
  kind: 'amount' | 'amountBeforeTax' | 'vatAmount'
): number | undefined {
  if (kind === 'vatAmount') {
    const direct = safeNumber(raw.tthue ?? raw.vatAmount);
    if (direct !== undefined) return direct;
    return currencyAwareNamedNumber(
      [raw],
      currency,
      ['VATAmountOC', 'TotalVATAmountOC'],
      ['VATAmount', 'TotalVATAmount'],
      LINE_DYNAMIC_CONTAINERS
    );
  }

  if (kind === 'amountBeforeTax') {
    const direct = safeNumber(raw.thtcthue ?? raw.amountBeforeTax);
    if (direct !== undefined) return direct;
    return currencyAwareNamedNumber(
      [raw],
      currency,
      ['AmountWithoutVATOC', 'AmountOC'],
      ['AmountWithoutVAT', 'Amount'],
      LINE_DYNAMIC_CONTAINERS
    );
  }

  const direct = safeNumber(raw.thtien ?? raw.tien ?? raw.amount);
  if (direct !== undefined) return direct;
  return currencyAwareNamedNumber(
    [raw],
    currency,
    ['AmountOC', 'AmountWithoutVATOC'],
    ['Amount', 'AmountWithoutVAT'],
    LINE_DYNAMIC_CONTAINERS
  );
}

export interface FinancialAmounts {
  subtotal?: number;
  vatAmount?: number;
}

export function resolveFinancialAmounts(input: {
  source: Record<string, unknown>;
  summary: Record<string, unknown>;
  detail?: Record<string, unknown> | null;
  lines: InvoiceLine[];
  taxSummaries: TaxSummary[];
}): FinancialAmounts {
  const { source, summary, detail, lines, taxSummaries } = input;
  const records = uniqueRecords([source, detail, summary]);
  const currency = safeString(source.dvtte ?? source.currency);
  const documentTypeCode = source.hdon ?? source.documentTypeCode ?? source.loaihd;
  const noVatDocument = isNoVatDocumentType(documentTypeCode);

  const explicitVat = firstNumber(records, ['tgtthue', 'vatAmount']);
  const namedVat = currencyAwareNamedNumber(
    records,
    currency,
    ['TotalVATAmountOC', 'VATAmountOC'],
    ['TotalVATAmount', 'VATAmount']
  );
  const taxSummaryVat = sumVatAmounts(taxSummaries);
  const lineVat = sumLineVat(lines);
  const vatAmount = explicitVat
    ?? namedVat
    ?? taxSummaryVat
    ?? lineVat
    ?? (noVatDocument ? 0 : undefined);

  const explicitSubtotal = firstNumber(records, ['tgtcthue', 'thtien', 'subtotal']);
  const namedSubtotal = currencyAwareNamedNumber(
    records,
    currency,
    [
      'TotalAmountWithoutVATOC',
      'TotalSaleAmountOC',
      'StockTotalAmountOC',
      'AmountWithoutVATOC',
    ],
    [
      'TotalAmountWithoutVAT',
      'TotalSaleAmount',
      'StockTotalAmount',
      'AmountWithoutVAT',
    ]
  );
  const taxSummarySubtotal = sumTaxableAmounts(taxSummaries);
  const lineSubtotal = sumLineSubtotals(lines);

  let subtotal = explicitSubtotal
    ?? namedSubtotal
    ?? taxSummarySubtotal
    ?? lineSubtotal;

  // Type 02 (sales invoice) and type 06/06_01 (stock-transfer document) are no-VAT
  // documents in the GDT payloads supported by this application. Some providers omit
  // tgtcthue/tgtthue entirely for these document types. When no better subtotal source
  // exists, the payable/total amount is therefore the HHDV amount after reversing any
  // explicitly supplied discount/fee/other components.
  if (subtotal === undefined && noVatDocument) {
    const grandTotal = firstNumber(records, ['tgtttbso', 'tongtien', 'grandTotal'])
      ?? currencyAwareNamedNumber(
        records,
        currency,
        ['TotalAmountOC', 'StockTotalAmountOC'],
        ['TotalAmount', 'StockTotalAmount']
      );
    if (grandTotal !== undefined) {
      const discount = firstNumber(records, ['ttcktmai', 'ttckhau', 'discountAmount']) ?? 0;
      const fee = firstNumber(records, ['tgtphi', 'phikhac', 'feeAmount']) ?? 0;
      const other = firstNumber(records, ['tgtkhac', 'khac', 'otherAmount']) ?? 0;
      subtotal = grandTotal + discount - fee - other - (vatAmount ?? 0);
    }
  }

  return { subtotal, vatAmount };
}
