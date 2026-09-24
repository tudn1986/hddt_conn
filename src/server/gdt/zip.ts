import yauzl, { type Entry, type ZipFile } from 'yauzl';
import yazl from 'yazl';
import { AppError } from '../../shared/utils/index.js';

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08));
}

export function isSafeZipEntryName(name: string): boolean {
  if (!name || name.length > 512 || /[\u0000\r\n]/.test(name)) return false;
  return !name.includes('\\') &&
    !name.startsWith('/') &&
    !/^[A-Za-z]:/.test(name) &&
    !name.split('/').some((part) => part === '.' || part === '..');
}

function openZip(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      {
        lazyEntries: true,
        autoClose: false,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zip) => {
        if (error || !zip) {
          reject(new AppError('ZIP_INVALID', 'GDT không trả gói ZIP hợp lệ.', 502));
        } else {
          resolve(zip);
        }
      }
    );
  });
}

function collectEntries(zip: ZipFile, maxEntryBytes: number): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    let entryCount = 0;
    const fail = (message: string) => {
      zip.removeAllListeners();
      reject(new AppError('ZIP_UNSAFE', message, 502));
    };
    zip.once('error', () => fail('Không đọc được cấu trúc ZIP từ GDT.'));
    zip.once('end', () => resolve(entries));
    zip.on('entry', (entry) => {
      entryCount += 1;
      const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (
        entryCount > 100 ||
        !isSafeZipEntryName(entry.fileName) ||
        (entry.generalPurposeBitFlag & 1) !== 0 ||
        fileType === 0xa000 ||
        entry.uncompressedSize > maxEntryBytes
      ) {
        fail('ZIP chứa entry không an toàn, mã hóa hoặc quá lớn.');
        return;
      }
      if (!entry.fileName.endsWith('/')) entries.push(entry);
      zip.readEntry();
    });
    zip.readEntry();
  });
}

function readEntry(zip: ZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new AppError('XML_EXTRACT_FAILED', 'Không đọc được XML trong ZIP.', 502));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          stream.destroy(new AppError('XML_SIZE', 'XML vượt giới hạn dung lượng.', 502));
        } else {
          chunks.push(chunk);
        }
      });
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

export function validateInvoiceXml(bytes: Uint8Array): void {
  if (!bytes.length) throw new AppError('XML_EMPTY', 'File XML rỗng.', 502);
  const prefix = Buffer.from(bytes).subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (prefix.includes('\u0000') || !/^(?:<\?xml\b[^>]*>\s*)?<(?:HDon|TDiep)(?:\s|>)/.test(prefix)) {
    throw new AppError('XML_INVALID', 'Nội dung tải về không giống XML hóa đơn.', 502);
  }
}

export async function extractInvoiceXml(
  bytes: Uint8Array,
  maxXmlBytes = 10 * 1024 * 1024
): Promise<Buffer> {
  const buffer = Buffer.from(bytes);
  if (!isZip(buffer)) throw new AppError('ZIP_INVALID', 'GDT export-xml không trả ZIP hợp lệ.', 502);
  const zip = await openZip(buffer);
  try {
    const entries = await collectEntries(zip, maxXmlBytes);
    const exact = entries.filter((entry) => entry.fileName.toLowerCase() === 'invoice.xml');
    const nested = entries.filter((entry) => entry.fileName.toLowerCase().endsWith('/invoice.xml'));
    const allXml = entries.filter((entry) => entry.fileName.toLowerCase().endsWith('.xml'));
    const candidates = exact.length ? exact : nested.length ? nested : allXml;
    if (candidates.length !== 1) {
      throw new AppError(
        'XML_EXTRACT_FAILED',
        candidates.length ? 'ZIP có nhiều XML và không xác định được invoice.xml.' : 'ZIP không chứa XML.',
        502
      );
    }
    const xml = await readEntry(zip, candidates[0], maxXmlBytes);
    validateInvoiceXml(xml);
    return xml;
  } finally {
    zip.close();
  }
}

export function createMockInvoiceZip(xml: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    zip.addBuffer(xml, 'invoice.xml');
    zip.end();
  });
}
