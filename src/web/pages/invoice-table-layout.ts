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
export type InvoiceTableContentWidthHints = Partial<Record<InvoiceColumnKey, number>>;

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

type ColumnWidthRule = {
  min: number;
  max: number;
  growWeight: number;
};

const COLUMN_WIDTH_RULES: Record<InvoiceColumnKey, ColumnWidthRule> = {
  invoiceSource: { min: 80, max: 120, growWeight: 0.25 },
  issueDate: { min: 92, max: 100, growWeight: 0 },
  documentType: { min: 90, max: 150, growWeight: 0.75 },
  templateNo: { min: 68, max: 110, growWeight: 0.25 },
  series: { min: 68, max: 120, growWeight: 0.35 },
  invoiceNo: { min: 96, max: 150, growWeight: 1.5 },
  partnerTaxCode: { min: 100, max: 145, growWeight: 0.5 },
  partner: { min: 180, max: 520, growWeight: 6 },
  currency: { min: 64, max: 90, growWeight: 0 },
  subtotal: { min: 100, max: 160, growWeight: 0.6 },
  vatAmount: { min: 96, max: 155, growWeight: 0.55 },
  grandTotal: { min: 116, max: 185, growWeight: 1 },
  invoiceStatus: { min: 100, max: 190, growWeight: 2.2 },
  processingStatus: { min: 100, max: 190, growWeight: 2 },
  providerCode: { min: 100, max: 175, growWeight: 1.25 },
  lookupCode: { min: 96, max: 220, growWeight: 3 },
  detail: { min: 82, max: 110, growWeight: 0.25 },
  actions: { min: 68, max: 88, growWeight: 0 },
};

const HD_LAYOUT: InvoiceTableLayout = {
  profile: 'hd',
  label: 'HD / Compact',
  selectionWidth: 40,
  columnWidths: {
    invoiceSource: 88,
    issueDate: 92,
    documentType: 104,
    templateNo: 76,
    series: 76,
    invoiceNo: 116,
    partnerTaxCode: 104,
    partner: 220,
    currency: 70,
    subtotal: 112,
    vatAmount: 104,
    grandTotal: 128,
    invoiceStatus: 120,
    processingStatus: 116,
    providerCode: 112,
    lookupCode: 104,
    detail: 88,
    actions: 72,
  },
};

const HD_PLUS_LAYOUT: InvoiceTableLayout = {
  profile: 'hd-plus',
  label: 'HD+ / Standard',
  selectionWidth: 44,
  columnWidths: {
    invoiceSource: 96,
    issueDate: 94,
    documentType: 110,
    templateNo: 80,
    series: 82,
    invoiceNo: 120,
    partnerTaxCode: 108,
    partner: 260,
    currency: 74,
    subtotal: 118,
    vatAmount: 110,
    grandTotal: 136,
    invoiceStatus: 126,
    processingStatus: 120,
    providerCode: 118,
    lookupCode: 112,
    detail: 90,
    actions: 74,
  },
};

const FULL_HD_LAYOUT: InvoiceTableLayout = {
  profile: 'full-hd',
  label: '1080p / Comfortable',
  selectionWidth: 44,
  columnWidths: {
    invoiceSource: 100,
    issueDate: 96,
    documentType: 116,
    templateNo: 84,
    series: 84,
    invoiceNo: 124,
    partnerTaxCode: 112,
    partner: 300,
    currency: 76,
    subtotal: 124,
    vatAmount: 116,
    grandTotal: 144,
    invoiceStatus: 132,
    processingStatus: 124,
    providerCode: 124,
    lookupCode: 120,
    detail: 92,
    actions: 76,
  },
};

const TWO_K_LAYOUT: InvoiceTableLayout = {
  profile: 'two-k',
  label: '2K / Wide',
  selectionWidth: 44,
  columnWidths: {
    invoiceSource: 104,
    issueDate: 100,
    documentType: 120,
    templateNo: 88,
    series: 90,
    invoiceNo: 132,
    partnerTaxCode: 120,
    partner: 380,
    currency: 80,
    subtotal: 132,
    vatAmount: 124,
    grandTotal: 152,
    invoiceStatus: 140,
    processingStatus: 132,
    providerCode: 136,
    lookupCode: 140,
    detail: 100,
    actions: 80,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateTextWidth(text: string): number {
  let width = 0;
  for (const character of Array.from(text)) {
    if (/\s/.test(character)) width += 3.5;
    else if (/[.,:;|!']/u.test(character)) width += 3.8;
    else if (/[ilI1]/u.test(character)) width += 4.6;
    else if (/[MWmw@%]/u.test(character)) width += 9.2;
    else if (/[0-9]/u.test(character)) width += 7.1;
    else if (/[A-ZĐ]/u.test(character)) width += 7.8;
    else width += 6.9;
  }
  return width;
}

/**
 * Estimate a useful content width without allowing one pathological long value
 * to widen the whole table. P90 represents the normal visible dataset while
 * ellipsis + tooltip continue to protect the remaining outliers.
 */
export function estimateInvoiceColumnContentWidth(
  values: readonly unknown[],
  header: string,
  options: { headerControls?: boolean; padding?: number } = {},
): number {
  const sampled = values.length <= 500
    ? values
    : Array.from({ length: 500 }, (_, index) => values[Math.floor(index * (values.length - 1) / 499)]);
  const widths = sampled
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .map(value => estimateTextWidth(value))
    .sort((left, right) => left - right);
  const percentileIndex = widths.length ? Math.floor((widths.length - 1) * 0.9) : 0;
  const contentWidth = widths[percentileIndex] || 0;
  const headerWidth = estimateTextWidth(header) + (options.headerControls === false ? 0 : 24);
  return Math.ceil(Math.max(contentWidth, headerWidth) + (options.padding ?? 20));
}

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

function growWidthsToUseSpace(
  widths: Record<InvoiceColumnKey, number>,
  visibleColumnKeys: readonly InvoiceColumnKey[],
  availableWidth: number,
): number {
  let remaining = Math.max(0, Math.floor(availableWidth));
  for (let pass = 0; pass < 12 && remaining > 0; pass += 1) {
    const active = visibleColumnKeys.filter(key => {
      const rule = COLUMN_WIDTH_RULES[key];
      return rule.growWeight > 0 && widths[key] < rule.max;
    });
    if (!active.length) break;

    const totalWeight = active.reduce((sum, key) => sum + COLUMN_WIDTH_RULES[key].growWeight, 0);
    let consumed = 0;
    for (const key of active) {
      if (remaining <= 0) break;
      const rule = COLUMN_WIDTH_RULES[key];
      const capacity = rule.max - widths[key];
      const requested = Math.max(1, Math.floor(remaining * rule.growWeight / totalWeight));
      const growth = Math.min(capacity, requested, remaining);
      widths[key] += growth;
      consumed += growth;
      remaining -= growth;
    }
    if (!consumed) break;
  }
  return remaining;
}

/**
 * Ant Design's selection column is generated outside `columns`. Its width
 * therefore has to be included explicitly when calculating the virtual
 * table's horizontal size.
 *
 * Width calculation has three inputs:
 * 1. the current responsive profile (HD/HD+/Full HD/2K);
 * 2. P90 content-width hints from the currently filtered dataset;
 * 3. the columns that the user actually chose to display.
 *
 * Visible business columns may grow only up to their max width. If all of them
 * reach max width, any remaining room becomes the existing right-side spacer.
 * If the selected columns need more than the viewport at their useful widths,
 * horizontal scrolling is preserved rather than compressing information below
 * the declared minimum widths.
 */
export function computeInvoiceTableMetrics(
  visibleColumnKeys: readonly InvoiceColumnKey[],
  viewportWidth: number,
  contentWidthHints: InvoiceTableContentWidthHints = {},
): InvoiceTableMetrics {
  const safeViewportWidth = Math.max(320, Math.floor(Number.isFinite(viewportWidth) ? viewportWidth : 320));
  const baseLayout = resolveInvoiceTableLayout(safeViewportWidth);
  const columnWidths = { ...baseLayout.columnWidths };

  for (const key of visibleColumnKeys) {
    const rule = COLUMN_WIDTH_RULES[key];
    const hint = contentWidthHints[key];
    columnWidths[key] = Number.isFinite(hint)
      ? clamp(Math.round(hint as number), rule.min, rule.max)
      : clamp(columnWidths[key], rule.min, rule.max);
  }

  const initialVisibleWidth = visibleColumnKeys.reduce((sum, key) => sum + columnWidths[key], 0);
  const initialIntrinsicWidth = baseLayout.selectionWidth + initialVisibleWidth;
  const remainingAfterGrowth = growWidthsToUseSpace(
    columnWidths,
    visibleColumnKeys,
    safeViewportWidth - initialIntrinsicWidth,
  );

  const layout: InvoiceTableLayout = {
    ...baseLayout,
    columnWidths,
  };
  const controlsWidth = layout.selectionWidth;
  const visibleColumnsWidth = visibleColumnKeys.reduce(
    (sum, key) => sum + layout.columnWidths[key],
    0,
  );
  const intrinsicWidth = controlsWidth + visibleColumnsWidth;
  const spacerWidth = Math.max(0, remainingAfterGrowth);
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
