import { describe, it, expect } from 'vitest';
import { normalizeInvoice } from '../../src/shared/normalizer/index.js';
import { document, rawSummary } from '../helpers.js';

describe('normalizer', () => {
  it('maps detail with hdhhdvu lines', () => {
    const raw = {
      id: 'x1',
      nbmst: '4501622475',
      khmshdon: 1,
      khhdon: '1C26SND',
      shdon: 99,
      tdlap: '2026-07-15T00:00:00+07:00',
      nbten: 'Seller Co',
      nmten: 'Buyer Co',
      nmmst: '4601622475',
      tgtttbso: 1100,
      tgtthue: 100,
      tgtcthue: 1000,
      ngcnhat: 'tvan_softdreams',
      Fkey: 'FK1',
      PortalLink: 'https://tracuu.easyinvoice.vn/x',
      hdhhdvu: [
        {
          stt: 1,
          ten: 'Service A',
          dvtinh: 'Gói',
          sluong: 1,
          dgia: 1000,
          thtien: 1000,
          ltsuat: '10%',
          tsuat: 10,
          tthue: 100,
        },
      ],
    };

    const doc = normalizeInvoice('purchase', 'standard', raw, raw);
    expect(doc.seller.taxCode).toBe('4501622475');
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0].itemName).toBe('Service A');
    expect(doc.lookup?.lookupCode).toBe('FK1');
    expect(doc.grandTotal).toBe(1100);
  });

  it('merges detail into summary without losing summary-only status fields', () => {
    const summary = rawSummary({ tthai: 7, ttxly: 5, customSummary: 'keep-me' });
    const detail = {
      nbmst: '4501622475',
      khmshdon: 1,
      khhdon: '1C26TST',
      shdon: 123,
      hdhhdvu: [{ stt: 1, ten: 'Chi tiết', sluong: 2, dgia: 50, thtien: 100 }],
    };
    const normalized = normalizeInvoice('purchase', 'standard', summary, detail);
    expect(normalized.invoiceStatus).toBe(7);
    expect(normalized.processingStatus).toBe(5);
    expect(normalized.lines[0]).toMatchObject({ itemName: 'Chi tiết', quantity: 2, amount: 100 });
    expect(normalized.rawSummary).toBe(summary);
    expect(normalized.rawDetail).toBe(detail);
    expect(normalized.dynamicFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'customSummary', rawValue: 'keep-me' }),
    ]));
  });

  it('keeps nested party-specific dynamic fields in the correct party', () => {
    const normalized = normalizeInvoice('purchase', 'standard', rawSummary(), {
      nbmst: '4501622475',
      khmshdon: 1,
      khhdon: '1C26TST',
      shdon: 123,
      nguoiban: { mst: '4501622475', ten: 'Seller nested', customSeller: 'S' },
      nguoimua: { mst: '0101234567', ten: 'Buyer nested', customBuyer: 'B' },
    });
    expect(normalized.seller.name).toBe('Seller nested');
    expect(normalized.seller.dynamicFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'customSeller', rawValue: 'S' }),
    ]));
    expect(normalized.seller.dynamicFields.some((field) => field.name === 'customBuyer')).toBe(false);
    expect(normalized.buyer.dynamicFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'customBuyer', rawValue: 'B' }),
    ]));
  });

  it('can normalize an already-normalized line without data loss', () => {
    const source = document();
    const normalized = normalizeInvoice('purchase', 'standard', source as unknown as Record<string, unknown>);
    expect(normalized.lines[0]).toMatchObject({
      itemName: 'Dịch vụ kiểm thử',
      unit: 'Gói',
      quantity: 1,
      unitPrice: 1_000_000,
      vatAmount: 100_000,
    });
    expect(normalized.processingStatus).toBe(5);
  });

  it('normalizes live standard-6 and POS detail field names', () => {
    const standard = normalizeInvoice('purchase', 'standard', {
      nbmst: '0304043037', khmshdon: 1, khhdon: 'K26THC', shdon: 224346,
      thdon: null, tlhdon: 'Hóa đơn giá trị gia tăng', ntnhan: '2026-06-08T03:34:27.553Z',
      ncnhat: '2026-06-08T03:34:36.219Z', ttxly: 6,
      hdhhdvu: [{ stt: 1, ten: 'Cước dịch vụ', ltsuat: '8%', tthue: 68204, tthhdtrung: [] }],
    });
    expect(standard.documentTypeName).toBe('Hóa đơn giá trị gia tăng');
    expect(standard.receivedTime).toBe('2026-06-08T03:34:27.553Z');
    expect(standard.updatedTime).toBe('2026-06-08T03:34:36.219Z');

    const pos = normalizeInvoice('purchase', 'pos', {
      nbmst: '0110269067', khmshdon: 1, khhdon: 'C26MHA', shdon: 64929330,
      tentvandnkntt: 'tvan_hilo', thtttoan: 'CK/TM', ttxly: 8,
      thttltsuat: [{ tsuat: '8%', thtien: 156167, tthue: 12493 }, { tsuat: 'KCT', thtien: 11340, tthue: 0 }],
      hdhhdvu: [{
        stt: 1, mhhdvu: 'TRANSPORTATION_FEE', ten: 'Cước phí vận chuyển', ltsuat: '8%', tsuat: 0.08,
        ttkhac: [{ ttruong: 'Hilo-TienThue', kdlieu: 'string', dlieu: '13160' }],
        tthhdtrung: [{ lhhdtrung: 2, ttruong: 'BKSPTVChuyen', dlieu: '29E-132.93' }],
      }],
    });
    expect(pos.invoiceSource).toBe('pos');
    expect(pos.providerCode).toBe('tvan_hilo');
    expect(pos.paymentMethod).toBe('CK/TM');
    expect(pos.taxSummaries.map(t => t.vatRateText)).toEqual(['8%', 'KCT']);
    expect(pos.lines[0].itemCode).toBe('TRANSPORTATION_FEE');
    expect(pos.lines[0].supplementalInfo[0]).toMatchObject({ name: 'BKSPTVChuyen', rawValue: '29E-132.93' });
  });


  it('extracts MISA TransactionID as lookup code for TVAN PDF adapters', () => {
    const normalized = normalizeInvoice('purchase', 'standard', {
      nbmst: '2400865795', khmshdon: 6, khhdon: '6C26NLK', shdon: 187,
      ngcnhat: 'tvan_misa',
      cttkhac: [{ ttruong: 'TransactionID', kdlieu: 'string', dlieu: 'N6F3TW0XMV3A' }],
    });
    expect(normalized.providerCode).toBe('tvan_misa');
    expect(normalized.lookup).toMatchObject({
      providerCode: 'tvan_misa',
      lookupCode: 'N6F3TW0XMV3A',
      lookupCodeType: 'TransactionID',
    });
  });

  it('resolves type 02 MISA HHDV and VAT from ttttkhac in invoice currency', () => {
    const normalized = normalizeInvoice('purchase', 'standard', {
      nbmst: '0801414154', khmshdon: 2, khhdon: 'C26TKK', shdon: 539,
      hdon: '02', dvtte: 'USD', tgia: 25880, tthai: 1, ttxly: 5,
      tgtcthue: null, tgtthue: null, tgtttbso: 11142.3, ttcktmai: 0,
      ngcnhat: 'tvan_misa',
      ttttkhac: [
        { ttruong: 'TotalAmountWithoutVAT', kdlieu: 'numeric', dlieu: '288362725.0' },
        { ttruong: 'TotalAmountWithoutVATOC', kdlieu: 'numeric', dlieu: '11142.30' },
        { ttruong: 'TotalVATAmountOC', kdlieu: 'numeric', dlieu: '0.0' },
      ],
    });
    expect(normalized.subtotal).toBe(11142.3);
    expect(normalized.vatAmount).toBe(0);
  });

  it('resolves type 02 Viettel HHDV from grand total and reports no-VAT as zero', () => {
    const normalized = normalizeInvoice('sales', 'standard', {
      nbmst: '4601622475', khmshdon: 2, khhdon: 'C26TCL', shdon: 31,
      hdon: '02', dvtte: 'USD', tthai: 1, ttxly: 5,
      tgtcthue: null, tgtthue: null, tgtttbso: 18419.13, ttcktmai: 0,
      ngcnhat: 'tvan_viettel',
      thttltsuat: [],
    });
    expect(normalized.subtotal).toBe(18419.13);
    expect(normalized.vatAmount).toBe(0);
  });

  it('resolves type 06_01 MISA HHDV from StockTotalAmountOC and VAT zero', () => {
    const normalized = normalizeInvoice('purchase', 'standard', {
      nbmst: '0900986579', khmshdon: 6, khhdon: 'C26NYY', shdon: 46,
      hdon: '06_01', dvtte: 'USD', tthai: 1, ttxly: 5,
      tgtcthue: null, tgtthue: null, tgtttbso: null,
      ngcnhat: 'tvan_misa',
      ttkhac: [
        { ttruong: 'StockTotalAmount', kdlieu: 'numeric', dlieu: '703594384.0' },
        { ttruong: 'StockTotalAmountOC', kdlieu: 'numeric', dlieu: '27186.8' },
      ],
    });
    expect(normalized.subtotal).toBe(27186.8);
    expect(normalized.vatAmount).toBe(0);
  });

  it('does not lose summary financial fields when detail replaces dynamic containers with empty arrays', () => {
    const summary = {
      nbmst: '0900986579', khmshdon: 6, khhdon: 'C26NYY', shdon: 46,
      hdon: '06_01', dvtte: 'USD', tthai: 1, ttxly: 5,
      ttkhac: [
        { ttruong: 'StockTotalAmountOC', kdlieu: 'numeric', dlieu: '27186.8' },
      ],
    };
    const detail = {
      ...summary,
      ttkhac: [],
      hdhhdvu: [{ stt: 1, ten: 'Hàng A' }],
    };
    const normalized = normalizeInvoice('purchase', 'standard', summary, detail);
    expect(normalized.subtotal).toBe(27186.8);
    expect(normalized.vatAmount).toBe(0);
  });

  it('resolves type 06_01 subtotal from detail lines including provider AmountOC fields', () => {
    const normalized = normalizeInvoice('purchase', 'standard', {
      nbmst: '3603960559', khmshdon: 6, khhdon: 'C26NPX', shdon: 208,
      hdon: '06_01', dvtte: 'USD', tthai: 1, ttxly: 5,
      tgtcthue: null, tgtthue: null, tgtttbso: null,
      ngcnhat: 'tvan_viettel',
    }, {
      nbmst: '3603960559', khmshdon: 6, khhdon: 'C26NPX', shdon: 208,
      hdon: '06_01', dvtte: 'USD',
      hdhhdvu: [
        { stt: 1, ten: 'Hàng A', ttkhac: [{ ttruong: 'AmountOC', dlieu: '501.60' }] },
        { stt: 2, ten: 'Hàng B', ttkhac: [{ ttruong: 'AmountWithoutVATOC', dlieu: '726.00' }] },
      ],
    });
    expect(normalized.lines.map((line) => line.amount)).toEqual([501.6, 726]);
    expect(normalized.subtotal).toBe(1227.6);
    expect(normalized.vatAmount).toBe(0);
  });

  it('keeps ordinary VAT invoice totals unchanged', () => {
    const normalized = normalizeInvoice('purchase', 'standard', rawSummary({
      hdon: '01', tgtcthue: 1000, tgtthue: 100, tgtttbso: 1100,
      thttltsuat: [{ tsuat: '10%', thtien: 1000, tthue: 100 }],
    }));
    expect(normalized.subtotal).toBe(1000);
    expect(normalized.vatAmount).toBe(100);
  });

});
