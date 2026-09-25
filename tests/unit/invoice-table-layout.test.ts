import { describe, expect, it } from 'vitest';
import {
  computeInvoiceTableMetrics,
  estimateInvoiceColumnContentWidth,
  resolveInvoiceTableLayout,
  type InvoiceColumnKey,
} from '../../src/web/pages/invoice-table-layout.js';

const defaultColumns: InvoiceColumnKey[] = [
  'issueDate',
  'series',
  'invoiceNo',
  'partnerTaxCode',
  'partner',
  'currency',
  'subtotal',
  'vatAmount',
  'grandTotal',
  'invoiceStatus',
];

const allColumns: InvoiceColumnKey[] = [
  'invoiceSource', 'issueDate', 'documentType', 'templateNo', 'series',
  'invoiceNo', 'partnerTaxCode', 'partner', 'currency', 'subtotal',
  'vatAmount', 'grandTotal', 'invoiceStatus', 'processingStatus',
  'providerCode', 'lookupCode', 'detail', 'actions',
];

describe('invoice table responsive layout', () => {
  it('maps actual table widths to HD, HD+, 1080p and 2K profiles', () => {
    expect(resolveInvoiceTableLayout(1330).profile).toBe('hd');
    expect(resolveInvoiceTableLayout(1568).profile).toBe('hd-plus');
    expect(resolveInvoiceTableLayout(1888).profile).toBe('full-hd');
    expect(resolveInvoiceTableLayout(2528).profile).toBe('two-k');
  });

  it('keeps only the selection control column at a compact explicit width', () => {
    for (const width of [1330, 1568, 1888, 2528]) {
      const layout = resolveInvoiceTableLayout(width);
      expect(layout.selectionWidth).toBeGreaterThanOrEqual(40);
      expect(layout.selectionWidth).toBeLessThanOrEqual(44);
    }
  });

  it('uses the designed preferred widths before content/visibility adaptation', () => {
    expect(resolveInvoiceTableLayout(1330).columnWidths.invoiceNo).toBe(116);
    expect(resolveInvoiceTableLayout(1888).columnWidths.invoiceNo).toBe(124);
    expect(resolveInvoiceTableLayout(2528).columnWidths.invoiceNo).toBe(132);
    expect(resolveInvoiceTableLayout(1888).columnWidths.partner).toBe(300);
  });

  it('uses P90 content width so a single abnormal long value does not stretch the table', () => {
    const normalValues = Array.from({ length: 100 }, (_, index) => `Công ty ABC ${index}`);
    const width = estimateInvoiceColumnContentWidth(
      [...normalValues, 'X'.repeat(500)],
      'Tên đối tác',
    );
    expect(width).toBeGreaterThan(100);
    expect(width).toBeLessThan(220);
  });

  it('lets content widen an information-bearing column within its max bound', () => {
    const short = computeInvoiceTableMetrics(allColumns, 1888, { partner: 190 });
    const long = computeInvoiceTableMetrics(allColumns, 1888, { partner: 480 });
    expect(long.layout.columnWidths.partner).toBeGreaterThan(short.layout.columnWidths.partner);
    expect(long.layout.columnWidths.partner).toBeLessThanOrEqual(520);
  });

  it('reallocates spare space to useful columns when the user hides columns', () => {
    const compact = computeInvoiceTableMetrics(
      ['invoiceNo', 'partner', 'grandTotal'],
      1888,
      { invoiceNo: 96, partner: 180, grandTotal: 116 },
    );
    const crowded = computeInvoiceTableMetrics(
      allColumns,
      1888,
      { invoiceNo: 96, partner: 180, grandTotal: 116 },
    );
    expect(compact.layout.columnWidths.partner).toBeGreaterThan(crowded.layout.columnWidths.partner);
    expect(compact.layout.columnWidths.invoiceNo).toBeGreaterThanOrEqual(96);
    expect(compact.layout.columnWidths.grandTotal).toBeGreaterThanOrEqual(116);
  });

  it('keeps a right-side spacer only after visible columns have reached useful max widths', () => {
    const metrics = computeInvoiceTableMetrics(defaultColumns, 2528, {
      partner: 520,
      invoiceStatus: 190,
      invoiceNo: 150,
      grandTotal: 185,
    });
    expect(metrics.spacerWidth).toBeGreaterThanOrEqual(0);
    expect(metrics.scrollX).toBe(metrics.viewportWidth);
  });

  it('enables horizontal scrolling when many visible columns need more than the viewport', () => {
    const largeHints = Object.fromEntries(
      allColumns.map(key => [key, 1_000]),
    ) as Partial<Record<InvoiceColumnKey, number>>;
    const metrics = computeInvoiceTableMetrics(allColumns, 1330, largeHints);
    expect(metrics.spacerWidth).toBe(0);
    expect(metrics.scrollX).toBeGreaterThan(metrics.viewportWidth);
  });
});
