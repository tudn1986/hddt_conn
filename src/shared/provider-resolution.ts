import type { InvoicePresentationProvider } from './models/index.js';

export const EHOADON_SOLUTION_TAX_CODE = '0314743623';
export const EHOADON_DOMAIN = 'ehoadondientu.com';

export function presentationForSolutionTaxCode(taxCode: string | undefined): InvoicePresentationProvider | undefined {
  if (taxCode !== EHOADON_SOLUTION_TAX_CODE) return undefined;
  return {
    providerCode: 'ehoadondientu',
    adapterCode: 'ehoadondientu',
    domain: EHOADON_DOMAIN,
    confidence: 'high',
  };
}
