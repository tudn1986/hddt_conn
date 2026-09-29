import { describe, expect, it } from 'vitest';
import { document } from '../helpers.js';
import { normalizeInvoice } from '../../src/shared/normalizer/index.js';
import { AcmanTvanAdapter } from '../../src/server/tvan/adapters/acman.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';

describe('ACMAN adapter resolution', () => {
  it('resolves ACMAN from msttcgp while EFY remains transport providerCode', () => {
    const doc = normalizeInvoice('purchase', 'standard', {
      nbmst: '4601305620',
      nbten: 'CÔNG TY CỔ PHẦN SẢN XUẤT TM&DV QKT BẮC THÁI',
      nmmst: '4601622475',
      khmshdon: 1,
      khhdon: 'C25TBT',
      shdon: 896,
      ngcnhat: 'tvan_efy',
      tvandnkntt: '0102519041',
      msttcgp: '0104908371',
      cttkhac: [{ ttruong: 'MA_TRA_CUU', dlieu: '9282368B9570' }],
      dvtte: 'VND',
      tgtcthue: 2373000,
      tgtthue: 0,
      tgtttbso: 2373000,
    });

    expect(doc.providerCode).toBe('tvan_efy');
    expect(doc.lookup?.lookupCode).toBe('9282368B9570');
    expect(new TvanRegistry().resolve(doc)?.providerCode).toBe('tvan_acman');
    expect(new TvanRegistry().capability(doc)).toMatchObject({
      providerCode: 'tvan_acman',
      supported: true,
      captchaMode: 'none',
      priority: 'P1',
    });
  });

  it('does not match a non-ACMAN solution on the same transport code', () => {
    const other = document({
      providerCode: 'tvan_efy',
      rawSummary: { msttcgp: '0102519041', ngcnhat: 'tvan_efy' },
    });
    expect(new AcmanTvanAdapter().matches(other)).toBe(false);
  });
});
