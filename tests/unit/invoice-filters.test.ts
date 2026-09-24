import { describe, expect, it } from 'vitest';
import { filterInvoices } from '../../src/web/pages/invoice-filters.js';
import { document } from '../helpers.js';

describe('invoice header filters', () => {
  const purchase = document({
    key: 'purchase',
    issueDate: '2026-07-15T00:00:00+07:00',
    templateNo: '01',
    series: '1C26TST',
    invoiceNo: '00123',
    invoiceStatus: 1,
    processingStatus: 0,
    providerCode: 'tvan_misa',
    providers: { solution: { taxCode: '0101243150' }, transport: { code: 'tvan_misa' } },
    lookup: { lookupCode: 'ABC-001' },
  });
  const sales = document({
    key: 'sales',
    direction: 'sales',
    issueDate: '2026-08-01T00:00:00+07:00',
    documentTypeCode: '02GTTT',
    templateNo: 2,
    series: '2C26ABC',
    invoiceNo: 456,
    invoiceStatus: 3,
    processingStatus: 5,
    providerCode: 'tvan_viettel',
    providers: { solution: { taxCode: '0100109106' }, transport: { code: 'tvan_viettel' } },
    seller: { taxCode: 'SELLER', name: 'Người bán', dynamicFields: [] },
    buyer: { taxCode: 'BUYER', name: 'Khách mua', dynamicFields: [] },
    lookup: { lookupCode: 'XYZ-002' },
    lines: [],
  });
  const docs = [purchase, sales];

  it('supports inclusive issue-date boundaries', () => {
    expect(filterInvoices(docs, { issueDateFrom: '2026-07-15', issueDateTo: '2026-07-15' })).toEqual([purchase]);
    expect(filterInvoices(docs, { issueDateFrom: '2026-07-15', issueDateTo: '2026-08-01' })).toEqual(docs);
  });

  it('filters identifiers as strings and preserves leading-zero searches', () => {
    expect(filterInvoices(docs, { templateNo: '01', invoiceNo: '001' })).toEqual([purchase]);
    expect(filterInvoices(docs, { series: '2c26', invoiceNo: '456' })).toEqual([sales]);
    expect(filterInvoices(docs, { lookupCode: 'abc-0' })).toEqual([purchase]);
  });

  it('uses seller for purchases and buyer for sales', () => {
    expect(filterInvoices(docs, { partnerTaxCode: '450162', partner: 'công ty bán' })).toEqual([purchase]);
    expect(filterInvoices(docs, { partnerTaxCode: 'buyer', partner: 'khách mua' })).toEqual([sales]);
  });

  it('filters invoice status independently from processing status', () => {
    expect(filterInvoices(docs, { invoiceStatuses: ['1'] })).toEqual([purchase]);
    expect(filterInvoices(docs, { invoiceStatuses: ['3'] })).toEqual([sales]);
  });

  it('filters the displayed processing status, including zero', () => {
    expect(filterInvoices(docs, { processingStatuses: ['0'] })).toEqual([purchase]);
    expect(filterInvoices(docs, { processingStatuses: ['5'] })).toEqual([sales]);
  });

  it('filters solution providers by MSTTCGP and keeps legacy provider-code filters compatible', () => {
    const before = JSON.stringify(docs);
    expect(filterInvoices(docs, { type: '01GTKT', providerCodes: ['0101243150'], detail: 'has' })).toEqual([purchase]);
    expect(filterInvoices(docs, { providerCodes: ['0100109106'], detail: 'missing' })).toEqual([sales]);
    expect(filterInvoices(docs, { providerCodes: ['tvan_misa'] })).toEqual([purchase]);
    expect(filterInvoices(docs, {})).toEqual(docs);
    expect(JSON.stringify(docs)).toBe(before);
  });
});
