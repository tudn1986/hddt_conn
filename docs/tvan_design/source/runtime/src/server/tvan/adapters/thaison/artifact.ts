import yauzl, { type Entry, type ZipFile } from 'yauzl';
import type { InvoiceDocument } from '../../../../shared/models/index.js';
import { AppError } from '../../../../shared/utils/index.js';
import { isSafeZipEntryName, isZip } from '../../../gdt/zip.js';
import { ensurePdf, safePdfFileName } from '../../http.js';

export type ThaisonOriginalKind = 'pdf' | 'zip';

export interface ThaisonNormalizedPdf {
  content: Buffer;
  fileName: string;
}

function openZip(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, {
      lazyEntries: true,
      autoClose: false,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (error, zip) => {
      if (error || !zip) {
        reject(new AppError('TVAN_THAISON_ARTIFACT_INVALID', 'Thái Sơn không trả ZIP hợp lệ.', 502, true));
      } else resolve(zip);
    });
  });
}

function collectEntries(zip: ZipFile, maxBytes: number): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const pdfs: Entry[] = [];
    let count = 0;
    let totalUncompressed = 0;
    let settled = false;

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      zip.removeAllListeners();
      reject(new AppError('TVAN_THAISON_ZIP_UNSAFE', message, 502));
    };

    zip.once('error', () => fail('Không đọc được ZIP Thái Sơn.'));
    zip.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(pdfs);
    });
    zip.on('entry', (entry) => {
      count += 1;
      totalUncompressed += entry.uncompressedSize;
      if (
        count > 100
        || !isSafeZipEntryName(entry.fileName)
        || (entry.generalPurposeBitFlag & 1) !== 0
        || entry.uncompressedSize > maxBytes
        || totalUncompressed > maxBytes
      ) {
        fail('ZIP Thái Sơn chứa entry không an toàn, mã hóa hoặc vượt giới hạn.');
        return;
      }
      if (!entry.fileName.endsWith('/') && entry.fileName.toLocaleLowerCase('en-US').endsWith('.pdf')) {
        pdfs.push(entry);
      }
      zip.readEntry();
    });
    zip.readEntry();
  });
}

function readEntry(zip: ZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new AppError('TVAN_THAISON_ARTIFACT_INVALID', 'Không đọc được PDF trong ZIP Thái Sơn.', 502, true));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy(new AppError('TVAN_RESPONSE_TOO_LARGE', 'PDF trong ZIP Thái Sơn vượt giới hạn dung lượng.', 502));
        } else {
          chunks.push(chunk);
        }
      });
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

function canonicalStem(value: string): string {
  return value.toLocaleLowerCase('vi-VN').replace(/[^a-z0-9]+/g, '');
}

function expectedInvoiceStem(document: InvoiceDocument): string {
  return canonicalStem(`${document.templateNo ?? ''}${document.invoiceNo ?? ''}`);
}

export function detectThaisonOriginalKind(bytes: Buffer): ThaisonOriginalKind {
  if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'pdf';
  if (isZip(bytes)) return 'zip';
  throw new AppError(
    'TVAN_THAISON_ARTIFACT_INVALID',
    'Thái Sơn không trả original artifact dạng PDF/ZIP hợp lệ.',
    502,
    true,
  );
}

export function contentDispositionFileName(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* continue */ }
  }
  return /filename="?([^";]+)"?/i.exec(value)?.[1];
}

export function safeThaisonOriginalFileName(
  document: InvoiceDocument,
  rawName: string | undefined,
  kind: ThaisonOriginalKind,
): string {
  const fallbackStem = [document.templateNo, document.invoiceNo]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .join('') || 'thaison_einvoice';
  const fallback = `${fallbackStem}.${kind}`;
  const base = String(rawName || fallback)
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(0, 220);
  if (!base) return fallback;
  const ext = `.${kind}`;
  return base.toLocaleLowerCase('en-US').endsWith(ext) ? base : base + ext;
}

export async function normalizedPdfFromOriginal(
  document: InvoiceDocument,
  original: Buffer,
  originalFileName: string,
  maxBytes: number,
): Promise<ThaisonNormalizedPdf | undefined> {
  const kind = detectThaisonOriginalKind(original);
  if (kind === 'pdf') {
    ensurePdf(original);
    return {
      content: original,
      fileName: safePdfFileName(originalFileName),
    };
  }

  const zip = await openZip(original);
  try {
    const entries = await collectEntries(zip, maxBytes);
    if (!entries.length) return undefined;

    let selected: Entry | undefined;
    if (entries.length === 1) {
      selected = entries[0];
    } else {
      const expected = expectedInvoiceStem(document);
      const matches = entries.filter((entry) => {
        const leaf = entry.fileName.split('/').pop() || entry.fileName;
        return expected && canonicalStem(leaf.replace(/\.pdf$/i, '')).includes(expected);
      });
      if (matches.length === 1) selected = matches[0];
      else {
        throw new AppError(
          'TVAN_THAISON_PDF_AMBIGUOUS',
          'ZIP Thái Sơn chứa nhiều PDF nhưng không đủ evidence để chọn deterministic.',
          502,
          false,
          undefined,
          { retryStage: 'prepare_artifact', preserveContext: true },
        );
      }
    }

    const content = await readEntry(zip, selected, maxBytes);
    ensurePdf(content);
    const leaf = selected.fileName.split('/').pop() || 'thaison_einvoice.pdf';
    return {
      content,
      fileName: safePdfFileName(leaf),
    };
  } finally {
    zip.close();
  }
}
