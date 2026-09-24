import { describe, expect, it } from 'vitest';
import { dedupeDynamicFields, extractDynamicFields } from '../../src/shared/dynamic-fields/index.js';
import { extractLookup } from '../../src/shared/lookup/index.js';

describe('dynamic fields and lookup extraction', () => {
  it('preserves arrays, object containers and unknown top-level fields', () => {
    const fields = extractDynamicFields({
      cttkhac: [
        { ten: 'Fkey', kieu: 'string', dlieu: 'ABC-123' },
        { name: 'Nested object', value: { a: 1 } },
      ],
      customVendorValue: 42,
      shdon: 10,
    }, 'invoice');
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ section: 'invoice.cttkhac', name: 'Fkey', rawValue: 'ABC-123' }),
      expect.objectContaining({ section: 'invoice.cttkhac', name: 'Nested object', rawValue: { a: 1 } }),
      expect.objectContaining({ section: 'invoice', name: 'customVendorValue', rawValue: 42 }),
    ]));
    expect(fields.some((field) => field.name === 'shdon')).toBe(false);
  });


  it('parses live GDT ttruong/kdlieu/dlieu fields', () => {
    const fields = extractDynamicFields({
      cttkhac: [
        { ttruong: 'Fkey', kdlieu: 'string', dlieu: 'LIVE-CODE' },
        { ttruong: 'TotalAmount', kdlieu: 'numeric', dlieu: '123.45' },
      ],
    }, 'invoice');
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Fkey', dataType: 'string', rawValue: 'LIVE-CODE' }),
      expect.objectContaining({ name: 'TotalAmount', dataType: 'numeric', rawValue: '123.45' }),
    ]));
    expect(extractLookup({ cttkhac: [{ ttruong: 'Fkey', kdlieu: 'string', dlieu: 'LIVE-CODE' }] })?.lookupCode)
      .toBe('LIVE-CODE');
  });

  it('recognizes M-Invoice Số bảo mật as lookupCode', () => {
    const lookup = extractLookup({
      cttkhac: [{ ttruong: 'Số bảo mật', kdlieu: 'string', dlieu: 'A349FB0BF1854FAE' }],
    }, 'tvan_invoice');
    expect(lookup).toMatchObject({
      providerCode: 'tvan_invoice',
      lookupCode: 'A349FB0BF1854FAE',
      lookupCodeType: 'Số bảo mật',
      confidence: 'medium',
    });
  });

  it('deduplicates only identical section/name/value tuples', () => {
    const fields = dedupeDynamicFields([
      { section: 'invoice', name: 'x', rawValue: 1 },
      { section: 'invoice', name: 'x', rawValue: 1 },
      { section: 'seller', name: 'x', rawValue: 1 },
    ]);
    expect(fields).toHaveLength(2);
  });

  it('combines lookup code and observed URL without fabricating a provider link', () => {
    const lookup = extractLookup({
      cttkhac: [
        { ten: 'Fkey', dlieu: 'SECRET-CODE' },
        { ten: 'PortalLink', dlieu: 'https://tracuu.example.vn/path?q=1' },
      ],
    }, 'provider-x');
    expect(lookup).toMatchObject({
      providerCode: 'provider-x',
      lookupCode: 'SECRET-CODE',
      lookupBaseUrl: 'https://tracuu.example.vn',
      lookupPathRaw: '/path?q=1',
      confidence: 'high',
    });
  });

  it('does not invent a URL when only provider metadata is known', () => {
    expect(extractLookup({}, 'unknown-tvan')).toEqual({
      providerCode: 'unknown-tvan',
      lookupCode: undefined,
      lookupCodeType: undefined,
      lookupBaseUrl: undefined,
      lookupPathRaw: undefined,
      sourceSection: undefined,
      sourceField: undefined,
      confidence: 'low',
    });
  });
});
