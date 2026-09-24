import { describe, expect, it } from 'vitest';
import {
  hasInvoiceDetail,
  mergeIncrementalDocuments,
  toExistingInvoiceRef,
} from '../../src/shared/incremental-sync/index.js';
import { normalizeInvoice } from '../../src/shared/normalizer/index.js';
import { document, rawSummary } from '../helpers.js';

describe('incremental invoice sync helpers', () => {
  it('preserves cached detail while refreshing summary/status', () => {
    const detail = {
      ...rawSummary({ tthai: 1, ttxly: 5 }),
      hdhhdvu: [{ stt: 1, ma: 'OLD', ten: 'Chi tiết đã lưu', sluong: 2 }],
    };
    const existing = normalizeInvoice('purchase', 'standard', rawSummary(), detail);
    const refreshed = normalizeInvoice('purchase', 'standard', rawSummary({
      tthai: 6,
      ttxly: 8,
      ncnhat: '2026-09-12T10:00:00+07:00',
    }));

    const merged = mergeIncrementalDocuments([existing], [refreshed]);
    expect(merged).toHaveLength(1);
    expect(merged[0].invoiceStatus).toBe(6);
    expect(merged[0].processingStatus).toBe(8);
    expect(merged[0].lines[0].itemCode).toBe('OLD');
    expect(merged[0].rawDetail).toEqual(detail);
  });

  it('keeps documents outside the refreshed result and appends new invoices', () => {
    const existing = document();
    const incoming = normalizeInvoice('purchase', 'standard', rawSummary({ shdon: 999 }));
    const merged = mergeIncrementalDocuments([existing], [incoming]);
    expect(merged.map((item) => item.key)).toEqual([existing.key, incoming.key]);
  });

  it('re-hydrates special type 06 cached detail when HHDV is still unresolved', () => {
    const existing = document({
      documentTypeCode: '06_01',
      subtotal: undefined,
      vatAmount: 0,
      lines: [],
      rawDetail: { id: 'cached-but-incomplete' },
    });
    expect(hasInvoiceDetail(existing)).toBe(false);
    expect(toExistingInvoiceRef(existing).hasDetail).toBe(false);
  });

  it('builds a compact existing reference without sending raw detail', () => {
    const existing = document({ rawDetail: { secretLargePayload: true } });
    const ref = toExistingInvoiceRef(existing);
    expect(ref.key).toBe(existing.key);
    expect(ref.hasDetail).toBe(true);
    expect(ref).not.toHaveProperty('rawDetail');
    expect(ref).not.toHaveProperty('lines');
    expect(hasInvoiceDetail(existing)).toBe(true);
  });
});

// Relation-driven updates are intentionally local: no original detail refresh is required.
describe('relation-driven status updates', () => {
  it('marks the matched original as replaced from a tchat=2 child locator', () => {
    const original = document({
      key: 'purchase|standard|4501622475|1|1C26TST|109',
      invoiceNo: 109,
      invoiceStatus: 1,
      nature: 1,
      rawDetail: { cached: true },
    });
    const replacement = normalizeInvoice('purchase', 'standard', rawSummary({
      id: 'replacement-116',
      shdon: 116,
      tchat: 2,
      tthai: 2,
      khmshdgoc: '1',
      khhdgoc: '1C26TST',
      shdgoc: 109,
      tdlhdgoc: '2026-07-14T17:00:00Z',
      gchdgoc: 'Hóa đơn thay thế cho hóa đơn số 109',
    }));

    const merged = mergeIncrementalDocuments([original], [replacement]);
    const refreshedOriginal = merged.find((item) => item.invoiceNo === 109)!;
    expect(refreshedOriginal.invoiceStatus).toBe(4);
    expect(refreshedOriginal.nature).toBe(1);
    expect(refreshedOriginal.rawDetail).toEqual({ cached: true });
    expect(replacement.relation?.kind).toBe('replacement');
    expect(replacement.relation?.original.invoiceNo).toBe(109);
  });

  it('marks the matched original as adjusted from a tchat=3 child locator', () => {
    const original = document({
      key: 'purchase|standard|4501622475|1|1C26TST|839',
      invoiceNo: 839,
      invoiceStatus: 1,
      nature: 1,
    });
    const adjustment = normalizeInvoice('purchase', 'standard', rawSummary({
      id: 'adjustment-843',
      shdon: 843,
      tchat: 3,
      tthai: 3,
      khmshdgoc: 1,
      khhdgoc: '1C26TST',
      shdgoc: 839,
      gchdgoc: 'Điều chỉnh hóa đơn 839',
    }));

    const merged = mergeIncrementalDocuments([original], [adjustment]);
    expect(merged.find((item) => item.invoiceNo === 839)?.invoiceStatus).toBe(5);
    expect(adjustment.relation?.kind).toBe('adjustment');
  });
});
