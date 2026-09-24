import { describe, expect, it } from 'vitest';
import {
  buildBusinessKey,
  buildInvoiceRelationContext,
  buildRelationViewModels,
  formatVietnamDate,
  normalizeInvoiceRelation,
} from '../../src/shared/invoice-relations/index.js';
import { document } from '../helpers.js';

describe('invoice relation normalization and indexing', () => {
  it('normalizes replacement relation from GDT fields', () => {
    const relation = normalizeInvoiceRelation({
      nbmst: '4601576518',
      tchat: 2,
      khmshdgoc: 1,
      khhdgoc: 'C26TJB',
      shdgoc: 109,
      tdlhdgoc: '2026-08-29T17:00:00Z',
      gchdgoc: 'Thay thế cho hóa đơn 109',
    });

    expect(relation).toEqual({
      kind: 'replacement',
      original: {
        sellerTaxCode: '4601576518',
        templateNo: 1,
        series: 'C26TJB',
        invoiceNo: 109,
        issuedAt: '2026-08-29T17:00:00Z',
      },
      description: 'Thay thế cho hóa đơn 109',
    });
  });

  it('does not create a relation when the original locator is incomplete', () => {
    expect(normalizeInvoiceRelation({ nbmst: '4601576518', tchat: 2, khmshdgoc: 1 })).toBeUndefined();
  });

  it('uses the four-part business locator only', () => {
    expect(buildBusinessKey('4601576518', 1, 'C26TJB', 109)).toBe('4601576518|1|C26TJB|109');
  });
});

describe('invoice relation view models', () => {
  it('shows forward replacement and reverse replaced-by from the same dataset', () => {
    const original = document({
      key: 'original-109',
      seller: { taxCode: '4601576518', name: 'Seller', dynamicFields: [] },
      templateNo: 1,
      series: 'C26TJB',
      invoiceNo: 109,
      invoiceStatus: 4,
    });
    const replacement = document({
      key: 'replacement-116',
      seller: { taxCode: '4601576518', name: 'Seller', dynamicFields: [] },
      templateNo: 1,
      series: 'C26TJB',
      invoiceNo: 116,
      issueDate: '2026-08-30T10:00:00+07:00',
      nature: 2,
      invoiceStatus: 2,
      relation: {
        kind: 'replacement',
        original: {
          sellerTaxCode: '4601576518',
          templateNo: 1,
          series: 'C26TJB',
          invoiceNo: 109,
          issuedAt: '2026-08-29T17:00:00Z',
        },
      },
    });

    const docs = [original, replacement];
    const context = buildInvoiceRelationContext(docs);
    const models = buildRelationViewModels(docs, context);

    expect(models.get(replacement.key)).toMatchObject({
      mode: 'replaces',
      title: 'Thay thế cho hóa đơn',
      related: [{ invoiceKey: original.key, invoiceNo: '109', issuedDate: '30/08/2026', inDataset: true }],
    });
    expect(models.get(original.key)).toMatchObject({
      mode: 'replaced-by',
      title: 'Bị thay thế bởi',
      related: [{ invoiceKey: replacement.key, invoiceNo: '116', inDataset: true }],
    });
  });

  it('keeps forward data when the original invoice is outside the dataset', () => {
    const replacement = document({
      key: 'replacement-only',
      seller: { taxCode: '4601576518', name: 'Seller', dynamicFields: [] },
      invoiceNo: 116,
      nature: 2,
      invoiceStatus: 2,
      relation: {
        kind: 'replacement',
        original: {
          sellerTaxCode: '4601576518',
          templateNo: 1,
          series: 'C26TJB',
          invoiceNo: 109,
          issuedAt: '2026-08-29T17:00:00Z',
        },
      },
    });

    const context = buildInvoiceRelationContext([replacement]);
    const model = buildRelationViewModels([replacement], context).get(replacement.key)!;
    expect(model.related[0]).toMatchObject({
      invoiceNo: '109',
      series: 'C26TJB',
      issuedDate: '30/08/2026',
      inDataset: false,
    });
    expect(model.related[0].invoiceKey).toBeUndefined();
  });

  it('returns all direct adjustments for one original invoice', () => {
    const original = document({
      key: 'original-100',
      invoiceNo: 100,
      invoiceStatus: 5,
    });
    const adjustments = [105, 108, 112].map((invoiceNo, index) => document({
      key: `adjustment-${invoiceNo}`,
      invoiceNo,
      issueDate: `2026-06-${String(5 + index * 7).padStart(2, '0')}T00:00:00+07:00`,
      invoiceStatus: 3,
      nature: 3,
      relation: {
        kind: 'adjustment',
        original: {
          sellerTaxCode: original.seller.taxCode!,
          templateNo: original.templateNo!,
          series: original.series!,
          invoiceNo: original.invoiceNo!,
        },
      },
    }));

    const docs = [original, ...adjustments];
    const context = buildInvoiceRelationContext(docs);
    const model = buildRelationViewModels(docs, context).get(original.key)!;

    expect(model.mode).toBe('adjusted-by');
    expect(model.title).toBe('Bị điều chỉnh bởi 3 hóa đơn');
    expect(model.related.map(item => item.invoiceNo)).toEqual(['105', '108', '112']);
  });

  it('returns an empty reverse model for status 4/5 when the related child is outside the dataset', () => {
    const original = document({ key: 'original-missing-child', invoiceNo: 109, invoiceStatus: 4 });
    const context = buildInvoiceRelationContext([original]);
    const model = buildRelationViewModels([original], context).get(original.key)!;
    expect(model.mode).toBe('replaced-by');
    expect(model.related).toEqual([]);
  });

  it('does not guess when the original locator matches multiple records', () => {
    const originalA = document({ key: 'duplicate-a', invoiceNo: 109 });
    const originalB = document({ key: 'duplicate-b', invoiceNo: 109 });
    const replacement = document({
      key: 'replacement-ambiguous',
      invoiceNo: 116,
      invoiceStatus: 2,
      nature: 2,
      relation: {
        kind: 'replacement',
        original: {
          sellerTaxCode: originalA.seller.taxCode!,
          templateNo: originalA.templateNo!,
          series: originalA.series!,
          invoiceNo: originalA.invoiceNo!,
        },
      },
    });

    const docs = [originalA, originalB, replacement];
    const context = buildInvoiceRelationContext(docs);
    const model = buildRelationViewModels(docs, context).get(replacement.key)!;
    expect(model.ambiguous).toBe(true);
    expect(model.related[0].invoiceKey).toBeUndefined();
    expect(model.related[0].inDataset).toBe(false);
  });
});

describe('Vietnam relation date formatting', () => {
  it('formats UTC timestamps in Asia/Ho_Chi_Minh timezone', () => {
    expect(formatVietnamDate('2026-08-29T17:00:00Z')).toBe('30/08/2026');
  });
});
