import { describe, expect, it } from 'vitest';
import {
  INVOICE_COLUMN_PRESETS,
  loadInvoiceUiPreferences,
  sanitizeInvoiceUiPreferences,
  sanitizeInvoiceUiSessionState,
  sanitizeVisibleColumns,
  saveInvoiceUiPreferences,
} from '../../src/web/pages/invoice-ui-preferences';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('invoice UI preferences', () => {
  it('falls back to the default columns when stored data is invalid', () => {
    expect(sanitizeVisibleColumns(['bad-key'])).toEqual(INVOICE_COLUMN_PRESETS.default);
    expect(sanitizeInvoiceUiPreferences(null).selectedPreset).toBe('default');
  });

  it('removes unknown and duplicate column keys', () => {
    expect(sanitizeVisibleColumns(['issueDate', 'issueDate', 'partner', 'removed'])).toEqual(['issueDate', 'partner']);
  });

  it('keeps the TVAN/provider column and filter while hiding lookup-code diagnostics', () => {
    expect(sanitizeVisibleColumns(['issueDate', 'providerCode', 'lookupCode', 'invoiceNo']))
      .toEqual(['issueDate', 'providerCode', 'invoiceNo']);
    expect(sanitizeInvoiceUiSessionState({
      filters: { providerCodes: ['tvan_softdreams'], lookupCode: 'SECRET-FKEY', invoiceNo: '17' },
      advancedOpen: true,
    }).filters).toEqual({ providerCodes: ['tvan_softdreams'], invoiceNo: '17' });
  });

  it('round-trips preferences through storage', () => {
    const storage = new MemoryStorage();
    saveInvoiceUiPreferences({
      schemaVersion: 2,
      visibleColumns: ['issueDate', 'invoiceNo', 'grandTotal'],
      selectedPreset: 'custom',
    }, storage);
    expect(loadInvoiceUiPreferences(storage)).toEqual({
      schemaVersion: 2,
      visibleColumns: ['issueDate', 'invoiceNo', 'grandTotal'],
      selectedPreset: 'custom',
    });
  });
});
