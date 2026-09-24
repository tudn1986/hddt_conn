import { describe, it, expect } from 'vitest';
import {
  toBusinessDateYYYYMMDD,
  buildInvoiceFilename,
  sanitizeFilenamePart,
} from '../../src/shared/filenames/index.js';

describe('filename rules', () => {
  it('formats VN business date from UTC ISO near midnight', () => {
    // 2026-07-30T17:00:00Z = 2026-07-31 00:00 Asia/Ho_Chi_Minh
    const ymd = toBusinessDateYYYYMMDD('2026-07-30T17:00:00Z');
    expect(ymd).toBe('20260731');
  });

  it('builds standard filename', () => {
    const name = buildInvoiceFilename(
      {
        sellerTaxCode: '4501622475',
        templateNo: 1,
        series: '1C26SND',
        invoiceNo: 12345678,
      },
      '2026-05-12',
      'xml'
    );
    expect(name).toBe('20260512_4501622475_1C26SND_12345678.xml');
  });

  it('prefixes POS download filenames to avoid cross-source collisions', () => {
    const name = buildInvoiceFilename({ sellerTaxCode: '0110269067', templateNo: 1, series: 'C26MHA', invoiceNo: 64929330 }, '2026-05-20', 'xml', 'pos');
    expect(name).toBe('POS_20260520_0110269067_C26MHA_64929330.xml');
  });

  it('sanitizes invalid characters', () => {
    expect(sanitizeFilenamePart('AB/CD:EF')).toBe('ABCDEF');
  });

  it('rejects missing and impossible business dates', () => {
    expect(() => toBusinessDateYYYYMMDD()).toThrow(/thiếu ngày lập/i);
    expect(() => toBusinessDateYYYYMMDD('2026-02-30')).toThrow(/không tồn tại/i);
    expect(() => toBusinessDateYYYYMMDD('not-a-date')).toThrow(/không hợp lệ/i);
  });

  it('never permits path components in the final filename', () => {
    const name = buildInvoiceFilename(
      { sellerTaxCode: '4501622475', templateNo: 1, series: '../1C26/ABC', invoiceNo: '12:3' },
      '2026-09-09',
      'zip'
    );
    expect(name).toBe('20260909_4501622475_.1C26ABC_123.zip');
    expect(name).not.toMatch(/[\\/]/);
  });

  it('rejects a filename part that normalizes to dots only', () => {
    expect(() => buildInvoiceFilename(
      { sellerTaxCode: '4501622475', templateNo: 1, series: '..', invoiceNo: 123 },
      '2026-09-09',
      'xml'
    )).toThrow(/ký hiệu/i);
  });
});
