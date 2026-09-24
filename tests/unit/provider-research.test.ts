import { describe, expect, it } from 'vitest';
import { document } from '../helpers.js';
import { providerResearchFor, sanitizeRawForDisplay } from '../../src/shared/provider-research.js';

describe('provider research UI model', () => {
  it('prefers dataset lookup evidence and keeps provider knowledge separately', () => {
    const invoice = document({
      providers: { solution: { taxCode: '0100727825' }, transport: { code: 'tvan_fpt' } },
      providerCode: 'tvan_fpt',
      lookup: {
        lookupCode: 'FAST-CODE-001',
        lookupCodeType: 'Mã tra cứu',
        lookupBaseUrl: 'https://seller.example.vn',
        lookupPathRaw: '/lookup?id=1',
        sourceSection: 'invoice.cttkhac',
        sourceField: 'PortalLink',
        confidence: 'high',
      },
      rawSummary: {
        msttcgp: '0100727825',
        cttkhac: [
          { ttruong: 'Mã tra cứu', dlieu: 'FAST-CODE-001' },
          { ttruong: 'PortalLink', dlieu: 'https://seller.example.vn/lookup?id=1' },
        ],
      },
    } as any);

    const research = providerResearchFor(invoice);
    expect(research.solutionTaxCode).toBe('0100727825');
    expect(research.providerName).toBe('FAST');
    expect(research.lookupCode).toBe('FAST-CODE-001');
    expect(research.supportedByKnownAdapter).toBe(false);
    expect(research.portals[0]).toMatchObject({
      url: 'https://seller.example.vn/lookup?id=1',
      source: 'dataset',
      confidence: 'high',
    });
    expect(research.portals.some(item => item.url.startsWith('https://einvoice.fast.com.vn'))).toBe(true);
  });

  it('marks current supported providers as adapter-backed', () => {
    const invoice = document({
      providers: { solution: { taxCode: '0314743623' } },
      rawSummary: { msttcgp: '0314743623' },
    } as any);
    const research = providerResearchFor(invoice);
    expect(research.adapterCode).toBe('ehoadondientu');
    expect(research.supportedByKnownAdapter).toBe(true);
    expect(research.portals.some(item => item.url === 'https://ehoadondientu.com/Tracuu.aspx')).toBe(true);
  });

  it('redacts secrets but preserves lookup evidence in Raw JSON', () => {
    const shown = sanitizeRawForDisplay({
      Fkey: 'LOOKUP-123',
      PortalLink: 'https://portal.example/lookup',
      password: 'secret',
      cookie: 'session=secret',
      access_token: 'token',
      nested: { captcha: '1234', MA_TRA_CUU: 'ABC' },
    }) as Record<string, any>;

    expect(shown.Fkey).toBe('LOOKUP-123');
    expect(shown.PortalLink).toBe('https://portal.example/lookup');
    expect(shown.password).toBe('[REDACTED]');
    expect(shown.cookie).toBe('[REDACTED]');
    expect(shown.access_token).toBe('[REDACTED]');
    expect(shown.nested.captcha).toBe('[REDACTED]');
    expect(shown.nested.MA_TRA_CUU).toBe('ABC');
  });
});
