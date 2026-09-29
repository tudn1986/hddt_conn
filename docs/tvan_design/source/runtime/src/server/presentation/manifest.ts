import type { PresentationAdapterIdentity } from '../../shared/models/index.js';
import type { TvanAdapter } from '../tvan/types.js';

type ManifestEntry = Omit<PresentationAdapterIdentity, 'providerCode' | 'displayName'>;

const MANIFESTS: Record<string, ManifestEntry> = {
  tvan_misa: { providerFamily: 'misa', adapterId: 'misa-production-v1', adapterVersion: '1.0.0' },
  tvan_invoice: { providerFamily: 'minvoice', adapterId: 'minvoice-searchinvoice-v1', adapterVersion: '1.0.0' },
  tvan_softdreams: { providerFamily: 'softdreams', adapterId: 'softdreams-easyinvoice-v1', adapterVersion: '1.0.0' },
  tvan_viettel: { providerFamily: 'viettel', adapterId: 'viettel-sinvoice-v1', adapterVersion: '1.0.0' },
  ehoadondientu: { providerFamily: 'ehoadondientu', adapterId: 'ehoadondientu-v1', adapterVersion: '1.0.0' },
  tvan_vnpt: { providerFamily: 'vnpt', adapterId: 'vnpt-portal-v1', adapterVersion: '1.0.0' },
  tvan_acman: { providerFamily: 'acman', adapterId: 'acman-v1', adapterVersion: '1.0.0' },
  tvan_pvoil: { providerFamily: 'pvoil', adapterId: 'pvoil-v1', adapterVersion: '1.0.0' },
  tvan_fast: { providerFamily: 'fast', adapterId: 'fast-einvoice-browser-captcha-v1', adapterVersion: '2.0.0' },
  tvan_thaison: { providerFamily: 'thaison', adapterId: 'thaison-einvoice-v1', adapterVersion: '1.0.0' },
};

export function presentationIdentityOf(adapter: TvanAdapter): PresentationAdapterIdentity {
  const manifest = MANIFESTS[adapter.providerCode] || {
    providerFamily: adapter.providerCode,
    adapterId: adapter.providerCode + '-legacy-v1',
    adapterVersion: '1.0.0',
  };
  return {
    ...manifest,
    providerCode: adapter.providerCode,
    displayName: adapter.displayName,
  };
}

export function presentationAdapters(adapters: TvanAdapter[]): PresentationAdapterIdentity[] {
  return adapters.map(presentationIdentityOf);
}
