import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { exportReportWorkbook } from '../../src/server/export/excel-report.js';
import { AMIS_FOUNDATION_PROFILE, exportWithProfile } from '../../src/server/export/profile-engine.js';
import { document } from '../helpers.js';

function bulkDocument(index: number) {
  return document({
    key: `purchase|standard|4501622475|1|1C26TST|${index}`,
    invoiceNo: index,
    lines: [1, 2].map((lineNo) => ({
      lineNo,
      itemCode: `00${index}${lineNo}`,
      itemName: `Mặt hàng ${index}-${lineNo}`,
      unit: 'Cái',
      quantity: lineNo,
      unitPrice: 1000,
      amount: lineNo * 1000,
      vatRateText: '10%',
      vatAmount: lineNo * 100,
      dynamicFields: [],
      supplementalInfo: [],
    })),
    dynamicFields: [{ section: 'invoice.cttkhac', name: 'Fkey', rawValue: `LK${index}` }],
  });
}

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  return workbook;
}

describe('streaming Excel export', () => {
  it('keeps the report layout: frozen bold header, filter, text columns and fitted widths', async () => {
    const workbook = await load(await exportReportWorkbook([
      document({ seller: { taxCode: '0012345678', name: 'Công ty có tên rất dài '.repeat(5), dynamicFields: [] } }),
    ], 'purchase'));
    const sheet = workbook.getWorksheet('HoaDon')!;

    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    const header = sheet.getCell('A1');
    expect(header.font?.bold).toBe(true);
    expect((header.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFE0E0E0');
    for (let column = 1; column <= 22; column += 1) {
      const width = sheet.getColumn(column).width ?? 0;
      expect(width).toBeGreaterThanOrEqual(12);
      expect(width).toBeLessThanOrEqual(50);
    }
    expect(sheet.getColumn(10).width).toBe(50);
    expect(sheet.getCell('I2').numFmt).toBe('@');
    expect(sheet.getCell('I2').value).toBe('0012345678');
  });

  it('writes every row of every sheet when the report is large', async () => {
    const count = 1200;
    const workbook = await load(await exportReportWorkbook(
      Array.from({ length: count }, (_, index) => bulkDocument(index + 1)),
      'purchase'
    ));

    expect(workbook.getWorksheet('HoaDon')!.rowCount).toBe(count + 1);
    expect(workbook.getWorksheet('ChiTiet')!.rowCount).toBe(count * 2 + 1);
    expect(workbook.getWorksheet('Thue')!.rowCount).toBe(count + 1);
    expect(workbook.getWorksheet('TraCuu')!.rowCount).toBe(count + 1);
    expect(workbook.getWorksheet('Dynamic')!.rowCount).toBe(count + 1);
    expect(workbook.getWorksheet('HoaDon')!.getRow(count + 1).getCell(1).value).toBe(count);
    expect(workbook.getWorksheet('ChiTiet')!.getRow(count * 2 + 1).getCell(6).value).toBe(`00${count}2`);
  }, 60_000);

  it('exports an empty-line document set without sheets losing their headers', async () => {
    const workbook = await load(await exportReportWorkbook([document({ lines: [], taxSummaries: [] })], 'purchase'));
    expect(workbook.getWorksheet('ChiTiet')!.rowCount).toBe(1);
    expect(workbook.getWorksheet('Thue')!.rowCount).toBe(1);
    expect(workbook.getWorksheet('ChiTiet')!.getCell('A1').value).toBe('STT');
  });

  it('rejects an invalid profile row and the next export still works', async () => {
    await expect(exportWithProfile([document({ invoiceNo: undefined })], AMIS_FOUNDATION_PROFILE))
      .rejects.toMatchObject({ code: 'PROFILE_REQUIRED' });
    const buffer = await exportWithProfile([bulkDocument(1), bulkDocument(2)], AMIS_FOUNDATION_PROFILE);
    const workbook = await load(buffer);
    const sheet = workbook.getWorksheet('ChungTu')!;
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getCell('A1').font?.bold).toBe(true);
    expect(sheet.getCell('B2').numFmt).toBe('@');
    expect(sheet.getColumn(2).width).toBe(14);
  });
});
