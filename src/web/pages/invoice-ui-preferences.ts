import type { InvoiceFilters } from './invoice-filters';
import type { InvoiceColumnKey } from './invoice-table-layout';

export const INVOICE_UI_PREFERENCES_STORAGE_KEY = 'hddt.invoice-ui-preferences.v2';
export const INVOICE_UI_SESSION_STORAGE_KEY = 'hddt.invoice-ui-session.v1';

export type InvoiceColumnPreset = 'default' | 'compact' | 'accounting' | 'all' | 'custom';

export const ALL_INVOICE_COLUMN_KEYS: readonly InvoiceColumnKey[] = [
  'invoiceSource',
  'issueDate',
  'documentType',
  'templateNo',
  'series',
  'invoiceNo',
  'partnerTaxCode',
  'partner',
  'currency',
  'subtotal',
  'vatAmount',
  'grandTotal',
  'invoiceStatus',
  'processingStatus',
  'providerCode',
  'lookupCode',
  'detail',
  'actions',
];

export const INVOICE_COLUMN_PRESETS: Record<Exclude<InvoiceColumnPreset, 'custom'>, readonly InvoiceColumnKey[]> = {
  default: [
    'issueDate', 'series', 'invoiceNo', 'partnerTaxCode', 'partner',
    'currency', 'subtotal', 'vatAmount', 'grandTotal', 'invoiceStatus',
  ],
  compact: [
    'issueDate', 'series', 'invoiceNo', 'partnerTaxCode', 'partner',
    'currency', 'grandTotal', 'invoiceStatus',
  ],
  accounting: [
    'issueDate', 'templateNo', 'series', 'invoiceNo', 'partnerTaxCode', 'partner',
    'currency', 'subtotal', 'vatAmount', 'grandTotal', 'invoiceStatus',
  ],
  all: ALL_INVOICE_COLUMN_KEYS,
};

export const INVOICE_COLUMN_PRESET_LABELS: Record<Exclude<InvoiceColumnPreset, 'custom'>, string> = {
  default: 'Mặc định',
  compact: 'Tối giản',
  accounting: 'Kế toán',
  all: 'Đầy đủ',
};

export interface InvoiceUiPreferencesV2 {
  schemaVersion: 2;
  visibleColumns: InvoiceColumnKey[];
  selectedPreset: InvoiceColumnPreset;
}

export interface InvoiceUiSessionStateV1 {
  schemaVersion: 1;
  quickSearch: string;
  filters: InvoiceFilters;
  advancedOpen: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const validColumnKeys = new Set<string>(ALL_INVOICE_COLUMN_KEYS);
const publicHiddenColumnKeys = new Set<string>(['lookupCode']);
const validPresets = new Set<InvoiceColumnPreset>(['default', 'compact', 'accounting', 'all', 'custom']);

export function sanitizeVisibleColumns(value: unknown): InvoiceColumnKey[] {
  if (!Array.isArray(value)) return [...INVOICE_COLUMN_PRESETS.default];
  const result = [...new Set(value.filter((item): item is InvoiceColumnKey => typeof item === 'string' && validColumnKeys.has(item) && !publicHiddenColumnKeys.has(item)))];
  return result.length ? result : [...INVOICE_COLUMN_PRESETS.default];
}

export function sanitizeInvoiceUiPreferences(value: unknown): InvoiceUiPreferencesV2 {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const preset = typeof source.selectedPreset === 'string' && validPresets.has(source.selectedPreset as InvoiceColumnPreset)
    ? source.selectedPreset as InvoiceColumnPreset
    : 'default';
  return {
    schemaVersion: 2,
    visibleColumns: sanitizeVisibleColumns(source.visibleColumns),
    selectedPreset: preset,
  };
}

export function loadInvoiceUiPreferences(storage?: StorageLike): InvoiceUiPreferencesV2 {
  const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) return sanitizeInvoiceUiPreferences(null);
  try {
    const raw = target.getItem(INVOICE_UI_PREFERENCES_STORAGE_KEY);
    return sanitizeInvoiceUiPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeInvoiceUiPreferences(null);
  }
}

export function saveInvoiceUiPreferences(preferences: InvoiceUiPreferencesV2, storage?: StorageLike): void {
  const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  if (!target) return;
  try {
    target.setItem(INVOICE_UI_PREFERENCES_STORAGE_KEY, JSON.stringify(sanitizeInvoiceUiPreferences(preferences)));
  } catch {
    // UI preferences are non-critical; storage failures must never block invoice work.
  }
}

export function sanitizeInvoiceUiSessionState(value: unknown): InvoiceUiSessionStateV1 {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const filters = source.filters && typeof source.filters === 'object' && !Array.isArray(source.filters)
    ? source.filters as InvoiceFilters
    : {};
  const publicFilters = { ...filters };
  delete publicFilters.lookupCode;
  return {
    schemaVersion: 1,
    quickSearch: typeof source.quickSearch === 'string' ? source.quickSearch.slice(0, 500) : '',
    filters: publicFilters,
    advancedOpen: source.advancedOpen === true,
  };
}

export function loadInvoiceUiSessionState(storage?: StorageLike): InvoiceUiSessionStateV1 {
  const target = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  if (!target) return sanitizeInvoiceUiSessionState(null);
  try {
    const raw = target.getItem(INVOICE_UI_SESSION_STORAGE_KEY);
    return sanitizeInvoiceUiSessionState(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeInvoiceUiSessionState(null);
  }
}

export function saveInvoiceUiSessionState(state: InvoiceUiSessionStateV1, storage?: StorageLike): void {
  const target = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  if (!target) return;
  try {
    target.setItem(INVOICE_UI_SESSION_STORAGE_KEY, JSON.stringify(sanitizeInvoiceUiSessionState(state)));
  } catch {
    // Session UI state is best-effort only.
  }
}
