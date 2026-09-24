import type { InvoicePresentationProvider } from './models/index.js';

export const EHOADON_SOLUTION_TAX_CODE = '0314743623';
export const EHOADON_DOMAIN = 'ehoadondientu.com';
export const VNPT_SOLUTION_TAX_CODE = '0100684378';
export const VNPT_DOMAIN = 'portaltool-miennam.vnpt-invoice.com.vn';

export function presentationForSolutionTaxCode(taxCode: string | undefined): InvoicePresentationProvider | undefined {
  if (taxCode === EHOADON_SOLUTION_TAX_CODE) return {
    providerCode: 'ehoadondientu', adapterCode: 'ehoadondientu', domain: EHOADON_DOMAIN, confidence: 'high',
  };
  if (taxCode === VNPT_SOLUTION_TAX_CODE) return {
    providerCode: 'tvan_vnpt', adapterCode: 'tvan_vnpt', domain: VNPT_DOMAIN, confidence: 'high',
  };
  return undefined;
}
