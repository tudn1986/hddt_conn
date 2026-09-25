import type { InvoicePresentationProvider } from './models/index.js';

export const EHOADON_SOLUTION_TAX_CODE = '0314743623';
export const EHOADON_DOMAIN = 'ehoadondientu.com';
export const VNPT_SOLUTION_TAX_CODE = '0100684378';
export const VNPT_DOMAIN = 'portaltool-miennam.vnpt-invoice.com.vn';
export const ACMAN_SOLUTION_TAX_CODE = '0104908371';
export const ACMAN_DOMAIN = 'hoadondientu.acman.vn';
export const PVOIL_SOLUTION_TAX_CODE = '0305795054';
export const PVOIL_DOMAIN = 'hoadon.pvoil.vn';
export const MINVOICE_SOLUTION_TAX_CODE = '0106026495-001';
export const MINVOICE_PROVIDER_TAX_CODE = '0106026495';

export function presentationForSolutionTaxCode(taxCode: string | undefined): InvoicePresentationProvider | undefined {
  if (taxCode === MINVOICE_SOLUTION_TAX_CODE || taxCode === MINVOICE_PROVIDER_TAX_CODE || taxCode?.startsWith(MINVOICE_PROVIDER_TAX_CODE + '-')) return {
    providerCode: 'tvan_invoice', adapterCode: 'tvan_invoice', confidence: 'high',
  };
  if (taxCode === EHOADON_SOLUTION_TAX_CODE) return {
    providerCode: 'ehoadondientu', adapterCode: 'ehoadondientu', domain: EHOADON_DOMAIN, confidence: 'high',
  };
  if (taxCode === VNPT_SOLUTION_TAX_CODE) return {
    providerCode: 'tvan_vnpt', adapterCode: 'tvan_vnpt', domain: VNPT_DOMAIN, confidence: 'high',
  };
  if (taxCode === ACMAN_SOLUTION_TAX_CODE) return {
    providerCode: 'tvan_acman', adapterCode: 'tvan_acman', domain: ACMAN_DOMAIN, confidence: 'high',
  };
  if (taxCode === PVOIL_SOLUTION_TAX_CODE) return {
    providerCode: 'tvan_pvoil', adapterCode: 'tvan_pvoil', domain: PVOIL_DOMAIN, confidence: 'high',
  };
  return undefined;
}
