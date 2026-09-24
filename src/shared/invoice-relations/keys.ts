import type { InvoiceDocument, OriginalInvoiceLocator } from '../models/index.js';

function normalizedPart(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * Business locator used by GDT relation payloads.
 *
 * Intentionally excludes response UUIDs, internal IDs, direction and source.
 * When one locator matches multiple records the relation is treated as ambiguous
 * instead of silently selecting one record.
 */
export function buildBusinessKey(
  sellerTaxCode: string | undefined,
  templateNo: string | number | undefined,
  series: string | undefined,
  invoiceNo: string | number | undefined,
): string | undefined {
  const seller = normalizedPart(sellerTaxCode);
  const template = normalizedPart(templateNo);
  const invoiceSeries = normalizedPart(series);
  const number = normalizedPart(invoiceNo);

  if (!seller || !template || !invoiceSeries || !number) return undefined;
  return [seller, template, invoiceSeries, number].join('|');
}

export function businessKeyFromLocator(locator: OriginalInvoiceLocator): string | undefined {
  return buildBusinessKey(
    locator.sellerTaxCode,
    locator.templateNo,
    locator.series,
    locator.invoiceNo,
  );
}

export function businessKeyFromDocument(document: InvoiceDocument): string | undefined {
  return buildBusinessKey(
    document.seller?.taxCode,
    document.templateNo,
    document.series,
    document.invoiceNo,
  );
}
