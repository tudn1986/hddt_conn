export type InvoiceColumnKey =
  | 'invoiceSource'
  | 'issueDate'
  | 'documentType'
  | 'templateNo'
  | 'series'
  | 'invoiceNo'
  | 'partnerTaxCode'
  | 'partner'
  | 'currency'
  | 'subtotal'
  | 'vatAmount'
  | 'grandTotal'
  | 'invoiceStatus'
  | 'processingStatus'
  | 'providerCode'
  | 'lookupCode'
  | 'detail'
  | 'actions';

export type InvoiceTableProfile = 'hd' | 'hd-plus' | 'full-hd' | 'two-k';

export interface InvoiceTableLayout {
  profile: InvoiceTableProfile;
  label: string;
  selectionWidth: number;
  columnWidths: Record<InvoiceColumnKey, number>;
}

export interface InvoiceTableMetrics {
  layout: InvoiceTableLayout;
  viewportWidth: number;
  controlsWidth: number;
  visibleColumnsWidth: number;
  intrinsicWidth: number;
  spacerWidth: number;
  scrollX: number;
}

const HD_LAYOUT: InvoiceTableLayout = {
  profile: 'hd',
  label: 'HD / Compact',
  selectionWidth: 40,
  columnWidths: {
    invoiceSource: 100,
    issueDate: 92,
    documentType: 112,
    templateNo: 82,
    series: 72,
    invoiceNo: 88,
    partnerTaxCode: 104,
    partner: 220,
    currency: 72,
    subtotal: 112,
    vatAmount: 104,
    grandTotal: 128,
    invoiceStatus: 124,
    processingStatus: 120,
    providerCode: 110,
    lookupCode: 100,
    detail: 90,
    actions: 64,
  },
};

const HD_PLUS_LAYOUT: InvoiceTableLayout = {
  profile: 'hd-plus',
  label: 'HD+ / Standard',
  selectionWidth: 44,
  columnWidths: {
    invoiceSource: 108,
    issueDate: 96,
    documentType: 120,
    templateNo: 88,
    series: 80,
    invoiceNo: 96,
    partnerTaxCode: 110,
    partner: 260,
    currency: 80,
    subtotal: 125,
    vatAmount: 115,
    grandTotal: 140,
    invoiceStatus: 132,
    processingStatus: 130,
    providerCode: 120,
    lookupCode: 110,
    detail: 96,
    actions: 68,
  },
};

const FULL_HD_LAYOUT: InvoiceTableLayout = {
  profile: 'full-hd',
  label: '1080p / Comfortable',
  selectionWidth: 44,
  columnWidths: {
    invoiceSource: 112,
    issueDate: 100,
    documentType: 128,
    templateNo: 92,
    series: 88,
    invoiceNo: 105,
    partnerTaxCode: 115,
    partner: 340,
    currency: 86,
    subtotal: 140,
    vatAmount: 130,
    grandTotal: 155,
    invoiceStatus: 145,
    processingStatus: 140,
    providerCode: 135,
    lookupCode: 120,
    detail: 100,
    actions: 70,
  },
};

const TWO_K_LAYOUT: InvoiceTableLayout = {
  profile: 'two-k',
  label: '2K / Wide',
  selectionWidth: 44,
  columnWidths: {
    invoiceSource: 112,
    issueDate: 100,
    documentType: 130,
    templateNo: 96,
    series: 90,
    invoiceNo: 110,
    partnerTaxCode: 120,
    partner: 420,
    currency: 90,
    subtotal: 150,
    vatAmount: 140,
    grandTotal: 165,
    invoiceStatus: 155,
    processingStatus: 150,
    providerCode: 145,
    lookupCode: 140,
    detail: 110,
    actions: 74,
  },
};

/**
 * Breakpoints are based on the actual table container width, not the physical
 * monitor width. This keeps the layout correct when the browser is not
 * maximized, the OS scale is changed, or the app is placed beside another app.
 */
export function resolveInvoiceTableLayout(viewportWidth: number): InvoiceTableLayout {
  if (viewportWidth < 1440) return HD_LAYOUT;
  if (viewportWidth < 1800) return HD_PLUS_LAYOUT;
  if (viewportWidth < 2200) return FULL_HD_LAYOUT;
  return TWO_K_LAYOUT;
}

/**
 * Ant Design's selection column is generated outside `columns`. Its width
 * therefore has to be included explicitly when calculating the virtual
 * table's horizontal size. The former expand column was intentionally removed;
 * HHDV detail is opened from the amount cells instead.
 *
 * When the visible data columns are narrower than the viewport, a dedicated
 * blank spacer column is used at the far right. This prevents the browser from
 * assigning all spare width to the expand column (the large blank area that
 * was visible before this fix) and prevents business columns from stretching
 * to visually misleading widths on 2K displays.
 */
export function computeInvoiceTableMetrics(
  visibleColumnKeys: readonly InvoiceColumnKey[],
  viewportWidth: number,
): InvoiceTableMetrics {
  const safeViewportWidth = Math.max(320, Math.floor(Number.isFinite(viewportWidth) ? viewportWidth : 320));
  const layout = resolveInvoiceTableLayout(safeViewportWidth);
  const controlsWidth = layout.selectionWidth;
  const visibleColumnsWidth = visibleColumnKeys.reduce(
    (sum, key) => sum + layout.columnWidths[key],
    0,
  );
  const intrinsicWidth = controlsWidth + visibleColumnsWidth;
  const spacerWidth = Math.max(0, safeViewportWidth - intrinsicWidth);

  return {
    layout,
    viewportWidth: safeViewportWidth,
    controlsWidth,
    visibleColumnsWidth,
    intrinsicWidth,
    spacerWidth,
    scrollX: Math.max(safeViewportWidth, intrinsicWidth),
  };
}
