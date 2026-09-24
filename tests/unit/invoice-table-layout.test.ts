import { describe, expect, it } from 'vitest';
import {
  computeInvoiceTableMetrics,
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

  it('uses a right-side spacer instead of stretching business columns when there is spare room', () => {
    const metrics = computeInvoiceTableMetrics(defaultColumns, 1888);
    expect(metrics.spacerWidth).toBeGreaterThan(0);
    expect(metrics.scrollX).toBe(metrics.viewportWidth);
    expect(metrics.layout.columnWidths.partner).toBe(340);
  });

  it('enables horizontal scrolling when the user displays many columns', () => {
    const allColumns: InvoiceColumnKey[] = [
      'invoiceSource', 'issueDate', 'documentType', 'templateNo', 'series',
      'invoiceNo', 'partnerTaxCode', 'partner', 'currency', 'subtotal',
      'vatAmount', 'grandTotal', 'invoiceStatus', 'processingStatus',
      'providerCode', 'lookupCode', 'detail', 'actions',
    ];
    const metrics = computeInvoiceTableMetrics(allColumns, 1330);
    expect(metrics.spacerWidth).toBe(0);
    expect(metrics.scrollX).toBeGreaterThan(metrics.viewportWidth);
  });
});
