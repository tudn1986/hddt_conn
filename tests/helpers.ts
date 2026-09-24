import type { InvoiceDocument, InvoiceLocator } from '../src/shared/models/index.js';

export const TEST_MST = '0101234567';

export function locator(overrides: Partial<InvoiceLocator> = {}): InvoiceLocator {
  return {
    sellerTaxCode: '4501622475',
    templateNo: 1,
    series: '1C26TST',
    invoiceNo: 123,
    ...overrides,
  };
}

export function document(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    key: 'purchase|standard|4501622475|1|1C26TST|123',
    direction: 'purchase',
    invoiceSource: 'standard',
    documentTypeCode: '01GTKT',
    documentTypeName: 'Hóa đơn GTGT',
    templateNo: 1,
    series: '1C26TST',
    invoiceNo: 123,
    issueDate: '2026-07-15T00:00:00+07:00',
    seller: {
      taxCode: '4501622475',
      name: 'Công ty bán',
      address: 'Hà Nội',
      dynamicFields: [],
    },
    buyer: {
      taxCode: TEST_MST,
      name: 'Công ty mua',
      address: 'TP.HCM',
      dynamicFields: [],
    },
    currency: 'VND',
    subtotal: 1_000_000,
    vatAmount: 100_000,
    grandTotal: 1_100_000,
    invoiceStatus: 1,
    processingStatus: 5,
    taxSummaries: [{ vatRateText: '10%', vatRateValue: 10, taxableAmount: 1_000_000, vatAmount: 100_000 }],
    lines: [{
      lineNo: 1,
      itemCode: '00001234',
      itemName: 'Dịch vụ kiểm thử',
      unit: 'Gói',
      quantity: 1,
      unitPrice: 1_000_000,
      amount: 1_000_000,
      vatRateText: '10%',
      vatAmount: 100_000,
      dynamicFields: [],
      supplementalInfo: [],
    }],
    dynamicFields: [],
    rawSummary: { nbmst: '4501622475', khmshdon: 1, khhdon: '1C26TST', shdon: 123 },
    ...overrides,
  };
}

export function rawSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'summary-1',
    nbmst: '4501622475',
    nbten: 'Công ty bán',
    nmmst: TEST_MST,
    nmten: 'Công ty mua',
    khmshdon: 1,
    khhdon: '1C26TST',
    shdon: 123,
    tdlap: '2026-07-15T00:00:00+07:00',
    tgtcthue: 1_000_000,
    tgtthue: 100_000,
    tgtttbso: 1_100_000,
    dvtte: 'VND',
    tthai: 1,
    ttxly: 5,
    ...overrides,
  };
}
