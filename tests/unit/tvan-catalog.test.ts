import { describe, expect, it } from 'vitest';
import { extractTvanObservation, tvanObservationIdentity } from '../../src/shared/tvan-catalog/index.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';
import { document } from '../helpers.js';
import { normalizeInvoice } from '../../src/shared/normalizer/index.js';

describe('TVAN catalog extraction', () => {
  it('keeps solution, transport and presentation identities distinct for FPT-carried ehoadondientu invoices', () => {
    const doc = normalizeInvoice('purchase', 'standard', {
      nbmst: '0108834240', khmshdon: 1, khhdon: 'C25TLT', shdon: 583,
      nmmst: '4601622475', msttcgp: '0314743623', tvandnkntt: '0104128565', ngcnhat: 'tvan_fpt',
    });
    const observation = extractTvanObservation(doc, new TvanRegistry().capability(doc));
    expect(observation).toMatchObject({
      providerCode: 'tvan_fpt', providerTaxCode: '0104128565', displayName: 'ehoadondientu.com',
      solutionProviderTaxCode: '0314743623', transportProviderTaxCode: '0104128565',
      transportProviderCode: 'tvan_fpt', presentationProviderCode: 'ehoadondientu',
    });
    expect(observation?.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ semanticRole: 'solution_provider_tax_code', fieldName: 'msttcgp' }),
      expect.objectContaining({ semanticRole: 'transport_provider_tax_code', fieldName: 'tvandnkntt' }),
      expect.objectContaining({ semanticRole: 'transport_provider_code', fieldName: 'ngcnhat' }),
    ]));
    expect(observation?.aliases).not.toContainEqual({ type: 'tax_code', value: '0314743623' });
  });

  it('uses solution MST as identity even when two solutions share the same FPT transport', () => {
    const registry = new TvanRegistry();
    const input = (msttcgp: string) => normalizeInvoice('purchase', 'standard', {
      nbmst: '0108834240', khmshdon: 1, khhdon: 'C25TLT', shdon: 583,
      msttcgp, tvandnkntt: '0104128565', ngcnhat: 'tvan_fpt',
    });
    const a = input('0314743623');
    const b = input('0101234567');
    const observationA = extractTvanObservation(a, registry.capability(a));
    const observationB = extractTvanObservation(b, registry.capability(b));
    expect(observationA && tvanObservationIdentity(observationA)).toBe('solution_tax_code:0314743623');
    expect(observationB && tvanObservationIdentity(observationB)).toBe('solution_tax_code:0101234567');
    expect(tvanObservationIdentity(observationA!)).not.toBe(tvanObservationIdentity(observationB!));
    expect(observationA?.transportProviderCode).toBe(observationB?.transportProviderCode);
    expect(observationA?.presentationProviderCode).toBe('ehoadondientu');
    expect(observationB?.presentationProviderCode).toBeUndefined();
    expect(observationB?.displayName).toBe('0101234567');
  });

  it('extracts provider metadata and removes lookup code/seller MST from stored endpoint patterns', () => {
    const doc = document({
      providerCode: 'tvan_softdreams',
      lookup: {
        providerCode: 'tvan_softdreams',
        lookupCode: 'SECRET-FKEY-123',
        lookupCodeType: 'Fkey',
        lookupBaseUrl: 'http://4501622475hd.easyinvoice.com.vn',
        lookupPathRaw: '/Search/Index?fkey=SECRET-FKEY-123',
        sourceField: 'PortalLink',
        sourceSection: 'invoice.ttkhac',
      },
      rawDetail: {
        msttcgp: '0105987432',
        ttkhac: [
          { ttruong: 'PortalLink', dlieu: 'http://4501622475hd.easyinvoice.com.vn/Search/Index?fkey=SECRET-FKEY-123' },
          { ttruong: 'Fkey', dlieu: 'SECRET-FKEY-123' },
        ],
      },
    });
    const observation = extractTvanObservation(doc, new TvanRegistry().capability(doc));
    expect(observation).toBeTruthy();
    expect(observation).toMatchObject({
      providerCode: 'tvan_softdreams',
      providerTaxCode: '0105987432',
      displayName: 'SoftDreams EasyInvoice',
    });
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain('SECRET-FKEY-123');
    expect(serialized).not.toContain('4501622475hd.easyinvoice.com.vn');
    expect(serialized).toContain('<sellerTaxCode>hd.easyinvoice.com.vn');
  });

  it('adds known provider portal for supported adapters without inventing missing tax codes', () => {
    const doc = document({ providerCode: 'tvan_misa', lookup: { providerCode: 'tvan_misa', lookupCode: 'MISA-LOOKUP' } });
    const observation = extractTvanObservation(doc, new TvanRegistry().capability(doc));
    expect(observation?.providerTaxCode).toBeUndefined();
    expect(observation?.endpoints).toContainEqual(expect.objectContaining({ kind: 'provider_portal', origin: 'https://www.meinvoice.vn' }));
  });
});
