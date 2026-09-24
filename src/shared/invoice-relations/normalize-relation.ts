import type { InvoiceRelation } from '../models/index.js';

function normalizeString(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value === 'object') return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function normalizeScalar(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return normalizeString(value);
}

/**
 * Normalize the one-way relation carried by replacement/adjustment invoices.
 * GDT exposes child -> original. The reverse direction is derived in RAM later.
 */
export function normalizeInvoiceRelation(
  raw: Record<string, unknown>,
): InvoiceRelation | undefined {
  const nature = Number(normalizeScalar(raw.tchat ?? raw.nature));
  if (nature !== 2 && nature !== 3) return undefined;

  const sellerTaxCode = normalizeString(raw.nbmst ?? raw.sellerTaxCode);
  const templateNo = normalizeScalar(raw.khmshdgoc ?? raw.originalTemplateNo);
  const series = normalizeString(raw.khhdgoc ?? raw.originalSeries);
  const invoiceNo = normalizeScalar(raw.shdgoc ?? raw.originalInvoiceNo);

  if (!sellerTaxCode || templateNo === undefined || !series || invoiceNo === undefined) {
    return undefined;
  }

  return {
    kind: nature === 2 ? 'replacement' : 'adjustment',
    original: {
      sellerTaxCode,
      templateNo,
      series,
      invoiceNo,
      issuedAt: normalizeString(raw.tdlhdgoc ?? raw.originalIssuedAt),
    },
    description: normalizeString(raw.gchdgoc ?? raw.relationDescription),
  };
}
