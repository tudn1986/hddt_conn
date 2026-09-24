import type { InvoiceDocument } from '../../shared/models/index.js';
import { solutionProviderTaxCodeOf } from '../../shared/solution-provider.js';

export type DetailFilter = 'has' | 'missing';

export interface InvoiceFilters {
  issueDateFrom?: string;
  issueDateTo?: string;
  type?: string;
  templateNo?: string;
  series?: string;
  invoiceNo?: string;
  partnerTaxCode?: string;
  partner?: string;
  invoiceStatuses?: string[];
  processingStatuses?: string[];
  providerCodes?: string[];
  lookupCode?: string;
  detail?: DetailFilter;
}

export const typeOfInvoice = (document: InvoiceDocument): string =>
  String(document.documentTypeCode ?? document.templateNo ?? '');

const normalized = (value: unknown): string =>
  String(value ?? '').trim().toLocaleLowerCase('vi-VN');

const contains = (value: unknown, needle?: string): boolean =>
  !needle?.trim() || normalized(value).includes(normalized(needle));

export function filterInvoices(
  documents: InvoiceDocument[],
  filters: InvoiceFilters,
): InvoiceDocument[] {
  return documents.filter((document) => {
    const issueDate = String(document.issueDate ?? '').slice(0, 10);
    const partner = document.direction === 'purchase' ? document.seller : document.buyer;
    const hasDetail = Array.isArray(document.lines) && document.lines.length > 0;

    return (!filters.issueDateFrom || issueDate >= filters.issueDateFrom)
      && (!filters.issueDateTo || issueDate <= filters.issueDateTo)
      && (!filters.type || typeOfInvoice(document) === filters.type)
      && contains(document.templateNo, filters.templateNo)
      && contains(document.series, filters.series)
      && contains(document.invoiceNo, filters.invoiceNo)
      && contains(partner?.taxCode, filters.partnerTaxCode)
      && contains(partner?.name, filters.partner)
      && (!filters.invoiceStatuses?.length
        || filters.invoiceStatuses.includes(String(document.invoiceStatus ?? '')))
      && (!filters.processingStatuses?.length
        || filters.processingStatuses.includes(String(document.processingStatus ?? '')))
      && (!filters.providerCodes?.length
        || filters.providerCodes.includes(String(solutionProviderTaxCodeOf(document) ?? ''))
        || filters.providerCodes.includes(String(document.providerCode ?? '')))
      && contains(document.lookup?.lookupCode, filters.lookupCode)
      && (!filters.detail
        || (filters.detail === 'has' ? hasDetail : !hasDetail));
  });
}
