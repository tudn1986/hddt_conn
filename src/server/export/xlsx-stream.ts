/**
 * Streaming XLSX writing helpers.
 *
 * The in-memory ExcelJS Workbook keeps every cell as an object (~130 MB per 1,000 invoices for
 * the full report). The streaming WorkbookWriter flushes each committed row to the zip stream, so
 * memory stays roughly proportional to the (small) compressed output instead of the row count.
 */
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';

export interface XlsxStream {
  writer: ExcelJS.stream.xlsx.WorkbookWriter;
  /** Finalizes the workbook and resolves with the complete XLSX file. */
  finish(): Promise<Buffer>;
  /** Discards a partially written workbook after an error. */
  abort(): void;
}

export function createXlsxStream(creator: string): XlsxStream {
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  const closed = new Promise<void>((resolve, reject) => {
    sink.on('data', (chunk: Buffer) => chunks.push(chunk));
    sink.on('end', resolve);
    sink.on('error', reject);
  });
  // An aborted export never reaches 'end'; make sure that is not an unhandled rejection.
  closed.catch(() => undefined);

  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useStyles: true, useSharedStrings: false });
  writer.creator = creator;
  writer.created = new Date();
  const zip = (writer as unknown as { zip?: { on?: (event: string, listener: () => void) => void; archive?: { abort?: () => void } } }).zip;
  zip?.on?.('error', () => undefined);

  return {
    writer,
    async finish() {
      await Promise.all([writer.commit(), closed]);
      return Buffer.concat(chunks);
    },
    abort() {
      try { zip?.archive?.abort?.(); } catch { /* best effort */ }
      sink.destroy();
      chunks.length = 0;
    },
  };
}

export interface SheetSpec {
  name: string;
  headers: string[];
  /** 0-based columns whose cells are stored as text (identifiers, tax codes, series). */
  textColumns?: number[];
  /** Fixed column widths; when omitted the width is fitted to the content (12–50). */
  fixedWidths?: number[];
  headerFill?: boolean;
  autoFilter?: boolean;
  /** Called once to measure widths (when not fixed) and once to write; must restart on each call. */
  rows: () => Iterable<unknown[]>;
}

function fitWidth(current: number, value: unknown): number {
  const length = String(value ?? '').length;
  return length > current ? Math.min(length + 2, 50) : current;
}

export function writeSheet(writer: ExcelJS.stream.xlsx.WorkbookWriter, spec: SheetSpec): void {
  let widths: number[];
  if (spec.fixedWidths) {
    widths = spec.fixedWidths;
  } else {
    widths = spec.headers.map((header) => fitWidth(12, header));
    for (const row of spec.rows()) {
      for (let index = 0; index < row.length; index += 1) {
        widths[index] = fitWidth(widths[index] ?? 12, row[index]);
      }
    }
  }

  const sheet = writer.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
  const textColumns = new Set(spec.textColumns ?? []);
  sheet.columns = widths.map((width, index) => ({ width, style: textColumns.has(index) ? { numFmt: '@' } : {} }));

  const header = sheet.addRow(spec.headers);
  header.font = { bold: true };
  if (spec.headerFill) {
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
  }
  header.commit();

  for (const values of spec.rows()) sheet.addRow(values as ExcelJS.CellValue[]).commit();

  if (spec.autoFilter !== false) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.headers.length } };
  }
  sheet.commit();
}
