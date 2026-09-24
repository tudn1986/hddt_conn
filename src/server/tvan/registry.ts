import type { InvoiceDocument, TvanProviderCapability } from '../../shared/models/index.js';
import { providerCodeOf } from './extract.js';
import { MisaTvanAdapter } from './adapters/misa.js';
import { ViettelTvanAdapter } from './adapters/viettel.js';
import { InvoiceTvanAdapter } from './adapters/invoice.js';
import { SoftdreamsTvanAdapter } from './adapters/softdreams.js';
import type { TvanAdapter } from './types.js';

export class TvanRegistry {
  private readonly adapters: TvanAdapter[];

  constructor(adapters: TvanAdapter[] = [new MisaTvanAdapter(), new InvoiceTvanAdapter(), new SoftdreamsTvanAdapter(), new ViettelTvanAdapter()]) {
    this.adapters = [...adapters];
  }

  getAdapters(): TvanAdapter[] { return [...this.adapters]; }

  resolve(document: InvoiceDocument): TvanAdapter | undefined {
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
