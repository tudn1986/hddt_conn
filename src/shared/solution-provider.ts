import type { InvoiceDocument } from './models/index.js';

const FRIENDLY_SOLUTION_PROVIDERS: Record<string, string> = {
  '0101243150': 'MISA',
  '0100109106': 'VIETTEL',
  '0106026495': 'M-INVOICE',
  '0106026495-001': 'M-INVOICE',
  '0105987432': 'SOFTDREAMS',
  '0100684378': 'VNPT',
  '0104908371': 'ACMAN',
  '0305795054': 'PVOIL',
  '0401486901': 'VISNAM',
  '0102519041': 'EFY',
  '0101360697': 'BKAV',
  '0108971656': 'MY SOFTWARE',
  '0105958921': 'ITT',
  '0101300842': 'THÁI SƠN',
  '0104128565': 'FPT IS',
  '0106870211': 'ICORP / VIET-INVOICE',
  '0100727825': 'FAST',
  '0100686209': 'MOBIFONE',
  '0105232093': 'CYBERLOTUS',
  '0103930279': 'NACENCOMM',
  '0314743623': 'EHOADONDIENTU',
};

function cleanTaxCode(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return /^\d{10}(?:-\d{3})?$/.test(text) ? text : undefined;
}

export function solutionProviderTaxCodeOf(document: InvoiceDocument): string | undefined {
  const direct = cleanTaxCode(document.providers?.solution?.taxCode);
  if (direct) return direct;

  for (const source of [document.rawSummary, document.rawDetail]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const record = source as Record<string, unknown>;
    const value = cleanTaxCode(record.msttcgp ?? record.MSTTCGP);
    if (value) return value;
  }

  for (const field of document.dynamicFields || []) {
    if (String(field.name || '').trim().toLocaleLowerCase('vi-VN') !== 'msttcgp') continue;
    const value = cleanTaxCode(field.rawValue);
    if (value) return value;
  }
  return undefined;
}

export function solutionProviderFriendlyName(taxCode: string | undefined): string | undefined {
  if (!taxCode) return undefined;
  return FRIENDLY_SOLUTION_PROVIDERS[taxCode] || taxCode;
}

export function solutionProviderDisplayOf(document: InvoiceDocument): {
  taxCode?: string;
  label?: string;
} {
  const taxCode = solutionProviderTaxCodeOf(document);
  return { taxCode, label: solutionProviderFriendlyName(taxCode) };
}
