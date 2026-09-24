import { describe, expect, it } from 'vitest';
import { extractTvanObservation } from '../../src/shared/tvan-catalog/index.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';
import { document } from '../helpers.js';

describe('TVAN catalog extraction', () => {
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
