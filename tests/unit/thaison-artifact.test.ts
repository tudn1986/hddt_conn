import { describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { document } from '../helpers.js';
import {
  detectThaisonOriginalKind,
  normalizedPdfFromOriginal,
  safeThaisonOriginalFileName,
} from '../../src/server/tvan/adapters/thaison/artifact.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n');

function makeZip(entries: Array<{ name: string; content: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    for (const entry of entries) zip.addBuffer(entry.content, entry.name);
    zip.end();
  });
}

describe('Thái Sơn original artifact normalization', () => {
  it('accepts direct PDF and sanitizes provider filename', async () => {
    const doc = document({ templateNo: 1, invoiceNo: 1139 });
    expect(detectThaisonOriginalKind(PDF)).toBe('pdf');
    expect(safeThaisonOriginalFileName(doc, '../bad/name.pdf', 'pdf')).toBe('.._bad_name.pdf');
    const normalized = await normalizedPdfFromOriginal(doc, PDF, '11139.pdf', 1024 * 1024);
    expect(normalized?.content.equals(PDF)).toBe(true);
    expect(normalized?.fileName).toBe('11139.pdf');
  });

  it('selects the single PDF from ZIP and returns undefined when ZIP has no PDF', async () => {
    const doc = document({ templateNo: 1, invoiceNo: 1139 });
    const withPdf = await makeZip([
      { name: '11139.pdf', content: PDF },
      { name: 'invoice.xml', content: Buffer.from('<xml/>') },
    ]);
    expect(detectThaisonOriginalKind(withPdf)).toBe('zip');
    const normalized = await normalizedPdfFromOriginal(doc, withPdf, '11139.zip', 1024 * 1024);
    expect(normalized?.fileName).toBe('11139.pdf');
    expect(normalized?.content.equals(PDF)).toBe(true);

    const withoutPdf = await makeZip([{ name: 'invoice.xml', content: Buffer.from('<xml/>') }]);
    await expect(normalizedPdfFromOriginal(doc, withoutPdf, '11139.zip', 1024 * 1024))
      .resolves.toBeUndefined();
  });

  it('fails closed when multiple PDFs cannot be selected deterministically', async () => {
    const doc = document({ templateNo: 1, invoiceNo: 1139 });
    const zip = await makeZip([
      { name: 'a.pdf', content: PDF },
      { name: 'b.pdf', content: PDF },
    ]);
    await expect(normalizedPdfFromOriginal(doc, zip, '11139.zip', 1024 * 1024))
      .rejects.toMatchObject({ code: 'TVAN_THAISON_PDF_AMBIGUOUS' });
  });

  it('rejects non-PDF/non-ZIP bytes', () => {
    expect(() => detectThaisonOriginalKind(Buffer.from('<html>error</html>')))
      .toThrow(/PDF\/ZIP hợp lệ/i);
  });
});
