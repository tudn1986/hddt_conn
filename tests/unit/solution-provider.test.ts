import { describe, expect, it } from 'vitest';
import { document } from '../helpers.js';
import {
  solutionProviderDisplayOf,
  solutionProviderFriendlyName,
  solutionProviderTaxCodeOf,
} from '../../src/shared/solution-provider.js';

describe('solution provider display', () => {
  it.each([
    ['0101243150', 'MISA'],
    ['0100109106', 'VIETTEL'],
    ['0106026495', 'M-INVOICE'],
    ['0106026495-001', 'M-INVOICE'],
    ['0105987432', 'SOFTDREAMS'],
    ['0100684378', 'VNPT'],
    ['0104908371', 'ACMAN'],
    ['0305795054', 'PVOIL'],
    ['0314743623', 'EHOADONDIENTU'],
  ])('maps MSTTCGP %s to %s', (taxCode, label) => {
    expect(solutionProviderFriendlyName(taxCode)).toBe(label);
  });

  it('uses providers.solution first and preserves leading zeros', () => {
    const invoice = document({
      providers: { solution: { taxCode: '0314743623' }, transport: { code: 'tvan_fpt' } },
      providerCode: 'tvan_fpt',
    });
    expect(solutionProviderDisplayOf(invoice)).toEqual({
      taxCode: '0314743623',
      label: 'EHOADONDIENTU',
    });
  });

  it('falls back to raw MSTTCGP and does not use transport provider as solution provider', () => {
    const invoice = document({
      providers: undefined,
      providerCode: 'tvan_fpt',
      rawSummary: { msttcgp: '0101243150', ngcnhat: 'tvan_fpt' },
    });
    expect(solutionProviderTaxCodeOf(invoice)).toBe('0101243150');
    expect(solutionProviderFriendlyName(solutionProviderTaxCodeOf(invoice))).toBe('MISA');
  });

  it('shows an unknown solution provider as its MSTTCGP', () => {
    expect(solutionProviderFriendlyName('0101234567')).toBe('0101234567');
  });
});
