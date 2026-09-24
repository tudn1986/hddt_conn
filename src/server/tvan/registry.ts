import type { InvoiceDocument, TvanProviderCapability } from '../../shared/models/index.js';
import { providerCodeOf } from './extract.js';
import { presentationForSolutionTaxCode } from '../../shared/provider-resolution.js';
import { findNamedValue } from './extract.js';
import { MisaTvanAdapter } from './adapters/misa.js';
import { ViettelTvanAdapter } from './adapters/viettel.js';
import { InvoiceTvanAdapter } from './adapters/invoice.js';
import { SoftdreamsTvanAdapter } from './adapters/softdreams.js';
import { EhoadonDientuPresentationAdapter } from './adapters/ehoadondientu.js';
import type { TvanAdapter } from './types.js';

export class TvanRegistry {
  private readonly adapters: TvanAdapter[];

  constructor(adapters: TvanAdapter[] = [new MisaTvanAdapter(), new InvoiceTvanAdapter(), new SoftdreamsTvanAdapter(), new ViettelTvanAdapter(), new EhoadonDientuPresentationAdapter()]) {
    this.adapters = [...adapters];
  }

  getAdapters(): TvanAdapter[] { return [...this.adapters]; }

  resolve(document: InvoiceDocument): TvanAdapter | undefined {
    const taxCode = document.providers?.solution?.taxCode || findNamedValue(document, ['msttcgp']);
    const presentation = presentationForSolutionTaxCode(taxCode);
    if (presentation?.adapterCode) {
      const explicit = this.adapters.find((adapter) => adapter.providerCode === presentation.adapterCode);
      if (explicit) return explicit;
    }
    if (!taxCode) {
      const domainMatch = this.adapters.find((adapter) => adapter.providerCode === 'ehoadondientu' && adapter.matches(document));
      if (domainMatch) return domainMatch;
    }
    return this.adapters.find((adapter) => adapter.matches(document));
  }

  capability(document: InvoiceDocument): TvanProviderCapability {
    const adapter = this.resolve(document);
    if (adapter) return adapter.capability(document);
    const providerCode = providerCodeOf(document) || 'unknown';
    return {
      providerCode,
      displayName: providerCode,
      supported: false,
      captchaMode: 'per_invoice',
      priority: 'P3',
      reason: 'TVAN chưa có adapter PDF. Hãy cung cấp raw JSON/XML tại trang TVAN Backport.',
    };
  }
}
