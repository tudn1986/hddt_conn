import { describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { createMockInvoiceZip, extractInvoiceXml, isSafeZipEntryName, isZip, validateInvoiceXml } from '../../src/server/gdt/zip.js';

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

describe('ZIP/XML validation', () => {
  it('creates and extracts a valid invoice package', async () => {
    const xml = Buffer.from('<?xml version="1.0"?><HDon><DLHDon/></HDon>');
    const zip = await createMockInvoiceZip(xml);
    expect(isZip(zip)).toBe(true);
    expect((await extractInvoiceXml(zip)).equals(xml)).toBe(true);
  });

  it('prefers the canonical invoice.xml when metadata XML is also present', async () => {
    const invoice = Buffer.from('<HDon><DLHDon/></HDon>');
    const zip = await makeZip([
      { name: 'metadata.xml', content: Buffer.from('<TDiep/>') },
      { name: 'invoice.xml', content: invoice },
    ]);
    expect((await extractInvoiceXml(zip)).equals(invoice)).toBe(true);
  });

  it('rejects ambiguous, missing and oversized XML entries', async () => {
    const ambiguous = await makeZip([
      { name: 'a.xml', content: Buffer.from('<HDon/>') },
      { name: 'b.xml', content: Buffer.from('<HDon/>') },
    ]);
    await expect(extractInvoiceXml(ambiguous)).rejects.toMatchObject({ code: 'XML_EXTRACT_FAILED' });
    await expect(extractInvoiceXml(Buffer.from('not a zip'))).rejects.toMatchObject({ code: 'ZIP_INVALID' });
    const oversized = await makeZip([{ name: 'invoice.xml', content: Buffer.from('<HDon>' + 'x'.repeat(100) + '</HDon>') }]);
    await expect(extractInvoiceXml(oversized, 16)).rejects.toMatchObject({ code: 'ZIP_UNSAFE' });
  });



  it('rejects traversal, absolute, Windows and control-character ZIP entry names', () => {
    for (const name of [
      '../invoice.xml',
      'foo/../../invoice.xml',
      '/absolute/invoice.xml',
      'C:\\Windows\\invoice.xml',
      '..\\invoice.xml',
      './invoice.xml',
      'invoice.xml\u0000.txt',
      'invoice.xml\n',
    ]) {
      expect(isSafeZipEntryName(name)).toBe(false);
    }
    expect(isSafeZipEntryName('invoice.xml')).toBe(true);
    expect(isSafeZipEntryName('nested/invoice.xml')).toBe(true);
    expect(isSafeZipEntryName('foo..bar/invoice.xml')).toBe(true);
  });

  it('rejects HTML, prefix spoofing and empty files', () => {
    expect(() => validateInvoiceXml(Buffer.alloc(0))).toThrow(/rỗng/i);
    expect(() => validateInvoiceXml(Buffer.from('<html></html>'))).toThrow(/không giống XML/i);
    expect(() => validateInvoiceXml(Buffer.from('<HDonEvil/>'))).toThrow(/không giống XML/i);
  });
});
