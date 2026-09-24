import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { exportReportWorkbook } from '../../src/server/export/excel-report.js';
import {
  AMIS_FOUNDATION_PROFILE,
  exportWithProfile,
  getProfile,
  listProfiles,
  mapProfileValue,
  resolveProfileSource,
} from '../../src/server/export/profile-engine.js';
import { document } from '../helpers.js';

describe('Excel report export', () => {
  it('creates all required sheets and preserves identifiers as text', async () => {
    const source = document({
      seller: { taxCode: '0012345678', name: '=DANGEROUS()', dynamicFields: [] },
      dynamicFields: [{ section: 'invoice.cttkhac', name: 'Fkey', rawValue: '@LOOKUP' }],
    });
    const buffer = await exportReportWorkbook([source], 'purchase');
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['HoaDon', 'ChiTiet', 'Thue', 'TraCuu', 'Dynamic']);
    const invoiceSheet = workbook.getWorksheet('HoaDon')!;
    // Assert by semantic header, not fixed column letters: v1.1.0 added `Nguồn` and
    // future report columns must not silently invalidate identifier-safety tests.
    const headerColumns = new Map(
      (invoiceSheet.getRow(1).values as unknown[]).slice(1).map((value, index) => [String(value), index + 1])
    );
    const dataCell = (header: string) => invoiceSheet.getRow(2).getCell(headerColumns.get(header)!);
    expect(dataCell('Số hóa đơn').value).toBe('123');
    expect(dataCell('Số hóa đơn').numFmt).toBe('@');
    expect(dataCell('MST người bán').value).toBe('0012345678');
    expect(dataCell('MST người bán').numFmt).toBe('@');
    expect(dataCell('Tên người bán').value).toBe("'=DANGEROUS()");

    const lineSheet = workbook.getWorksheet('ChiTiet')!;
    const lineHeaderColumns = new Map(
      (lineSheet.getRow(1).values as unknown[]).slice(1).map((value, index) => [String(value), index + 1])
    );
    const itemCodeCell = lineSheet.getRow(2).getCell(lineHeaderColumns.get('Mã hàng hóa/dịch vụ')!);
    expect(itemCodeCell.value).toBe('00001234');
    expect(itemCodeCell.numFmt).toBe('@');

    expect(workbook.getWorksheet('Dynamic')!.getCell('E2').value).toBe("'@LOOKUP");
  });
});

describe('export profile engine', () => {
  it('lists versioned purchase and sales foundation profiles', () => {
    expect(listProfiles().map((profile) => profile.id)).toEqual([
      'amis-foundation-v1',
      'amis-sales-foundation-v1',
    ]);
    expect(getProfile('amis-foundation-v1').documentDirection).toBe('purchase');
    expect(() => getProfile('missing')).toThrow(/không tìm thấy/i);
  });

  it('resolves normalized and dynamic paths and applies safe transforms', () => {
    const source = document({ dynamicFields: [{ section: 'invoice', name: 'Custom', rawValue: ' abc ' }] });
    expect(resolveProfileSource(source, 'seller.taxCode')).toBe('4501622475');
    expect(resolveProfileSource(source, 'dynamic:invoice:Custom')).toBe(' abc ');
    expect(mapProfileValue(' =cmd', { targetColumn: 'Text', source: 'x', type: 'text', transform: ['trim', 'uppercase'] })).toBe("'=CMD");
    expect(mapProfileValue(undefined, { targetColumn: 'Currency', source: 'currency', type: 'text', transform: ['default:VND'] })).toBe('VND');
  });

  it('enforces profile direction and required values', async () => {
    await expect(exportWithProfile([document({ direction: 'sales' })], AMIS_FOUNDATION_PROFILE))
      .rejects.toMatchObject({ code: 'PROFILE_DIRECTION' });
    await expect(exportWithProfile([document({ invoiceNo: undefined })], AMIS_FOUNDATION_PROFILE))
      .rejects.toMatchObject({ code: 'PROFILE_REQUIRED' });
  });

  it('exports a loadable profile workbook', async () => {
    const buffer = await exportWithProfile([document()], AMIS_FOUNDATION_PROFILE);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    expect(workbook.getWorksheet('ChungTu')?.rowCount).toBe(2);
    expect(workbook.getWorksheet('ChungTu')?.getCell('B2').numFmt).toBe('@');
  });
});
