import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  DatasetDocument,
  DatasetFile,
  Direction,
  InvoiceDocument,
} from '../../shared/models/index.js';
import { buildDocumentKey } from '../../shared/filenames/index.js';
import { normalizeInvoice } from '../../shared/normalizer/index.js';
import { datasetEnvelopeSchema } from '../../shared/schemas/index.js';
import {
  AppError,
  assertPathInside,
  atomicWriteJson,
  cloneJson,
  ensureDir,
  isRecord,
} from '../../shared/utils/index.js';
import type { SettingsService } from './settings.service.js';

const APP_VERSION = '1.3.1';

function repairFinancialFields(item: DatasetDocument, direction: Direction): void {
  const rawSummary = isRecord(item.rawSummary) ? item.rawSummary : undefined;
  const rawDetail = isRecord(item.rawDetail) ? item.rawDetail : undefined;
  if (!rawSummary && !rawDetail) return;

  const summary = rawSummary ?? rawDetail;
  if (!summary) return;
  const invoiceSource = item.normalized.invoiceSource ?? 'standard';
  const refreshed = normalizeInvoice(direction, invoiceSource, summary, rawDetail);

  // Dataset status/relation fields may include local merge decisions, so only repair the
  // financial projections that older normalizers left blank. Raw payloads remain intact.
  if (item.normalized.subtotal == null && refreshed.subtotal !== undefined) {
    item.normalized.subtotal = refreshed.subtotal;
  }
  if (item.normalized.vatAmount == null && refreshed.vatAmount !== undefined) {
    item.normalized.vatAmount = refreshed.vatAmount;
  }
}

export class DatasetService {
  constructor(private readonly settings: SettingsService) {}

  buildFilename(direction: Direction, fromDate: string, toDate: string): string {
    const from = fromDate.replace(/-/g, '');
    const to = toDate.replace(/-/g, '');
    const prefix = direction === 'purchase' ? 'HDDT_PURCHASE' : 'HDDT_SALES';
    return `${prefix}_${from}_${to}.json`;
  }

  async save(
    accountTaxCode: string,
    direction: Direction,
    fromDate: string,
    toDate: string,
    documents: InvoiceDocument[]
  ): Promise<string> {
    const mstDir = this.settings.getMstDataDir(accountTaxCode);
    await ensureDir(mstDir);
    const realDataRoot = await fs.realpath(this.settings.getDataRoot());
    const realMstDir = assertPathInside(realDataRoot, await fs.realpath(mstDir));
    const filePath = path.join(realMstDir, this.buildFilename(direction, fromDate, toDate));
    const dataset: DatasetFile = {
      format: 'hddt-dataset',
      schemaVersion: 1,
      appVersion: APP_VERSION,
      meta: {
        accountTaxCode,
        direction,
        fromDate,
        toDate,
        createdAt: new Date().toISOString(),
        source: 'hoadondientu.gdt.gov.vn',
        recordCount: documents.length,
        detailCount: documents.filter((document) => document.lines.length > 0).length,
        sourceCounts: {
          standard: documents.filter((document) => (document.invoiceSource ?? 'standard') === 'standard').length,
          pos: documents.filter((document) => document.invoiceSource === 'pos').length,
        },
      },
      documents: documents.map((document): DatasetDocument => {
        const normalized = cloneJson(document);
        normalized.rawSummary = undefined;
        normalized.rawDetail = undefined;
        return {
          key: document.key,
          normalized,
          rawSummary: document.rawSummary,
          rawDetail: document.rawDetail,
        };
      }),
    };
    this.validate(dataset);
    const bytes = Buffer.byteLength(JSON.stringify(dataset));
    if (bytes > this.settings.getConfig().storage.maxDatasetBytes) {
      throw new AppError('DATASET_TOO_LARGE', 'Dataset vượt giới hạn dung lượng cấu hình.', 413);
    }
    await atomicWriteJson(filePath, dataset);
    return filePath;
  }

  validate(value: unknown): DatasetFile {
    const result = datasetEnvelopeSchema.safeParse(value);
    if (!result.success) {
      throw new AppError(
        'INVALID_DATASET',
        `Dataset không hợp lệ: ${result.error.issues[0]?.message || 'sai schema'}`
      );
    }
    const dataset = result.data as unknown as DatasetFile;
    if (dataset.meta.recordCount !== dataset.documents.length) {
      throw new AppError('INVALID_DATASET', 'recordCount không khớp số chứng từ.');
    }
    const keys = new Set<string>();
    for (const item of dataset.documents) {
      if (item.normalized.direction !== dataset.meta.direction) {
        throw new AppError('INVALID_DATASET', 'Hướng chứng từ không nhất quán.');
      }
      const wasLegacySource = !item.normalized.invoiceSource;
      if (wasLegacySource) {
        item.normalized.invoiceSource = 'standard';
        const migratedKey = buildDocumentKey(item.normalized.direction, 'standard', {
          sellerTaxCode: item.normalized.seller.taxCode ?? '',
          templateNo: item.normalized.templateNo ?? '',
          series: item.normalized.series ?? '',
          invoiceNo: item.normalized.invoiceNo ?? '',
        });
        item.key = migratedKey;
        item.normalized.key = migratedKey;
      } else if (item.key !== item.normalized.key) {
        throw new AppError('INVALID_DATASET', 'Key chứng từ không nhất quán.');
      }
      if (keys.has(item.key)) throw new AppError('INVALID_DATASET', 'Dataset có key hóa đơn trùng.');
      keys.add(item.key);
      repairFinancialFields(item, dataset.meta.direction);
      item.normalized.rawSummary = item.rawSummary;
      item.normalized.rawDetail = item.rawDetail;
    }
    return dataset;
  }

  import(value: unknown): DatasetFile {
    return this.validate(cloneJson(value));
  }

  async open(filePath: string): Promise<DatasetFile> {
    if (path.extname(filePath).toLowerCase() !== '.json') {
      throw new AppError('INVALID_DATASET_PATH', 'Chỉ được mở file .json.');
    }
    const safePath = assertPathInside(this.settings.getDataRoot(), filePath);
    const realDataRoot = await fs.realpath(this.settings.getDataRoot());
    const realPath = assertPathInside(realDataRoot, await fs.realpath(safePath));
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) throw new AppError('INVALID_DATASET_PATH', 'Đường dẫn không phải file.');
    if (stat.size > this.settings.getConfig().storage.maxDatasetBytes) {
      throw new AppError('DATASET_TOO_LARGE', 'Dataset vượt giới hạn dung lượng cấu hình.', 413);
    }
    return this.validate(JSON.parse(await fs.readFile(realPath, 'utf8')) as unknown);
  }

  async list(accountTaxCode: string): Promise<Array<{ fileName: string; filePath: string; size: number }>> {
    const mstDir = this.settings.getMstDataDir(accountTaxCode);
    const entries = await fs.readdir(mstDir, { withFileTypes: true }).catch(() => []);
    const result: Array<{ fileName: string; filePath: string; size: number }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^HDDT_(PURCHASE|SALES)_\d{8}_\d{8}\.json$/.test(entry.name)) continue;
      const filePath = path.join(mstDir, entry.name);
      const stat = await fs.stat(filePath);
      result.push({ fileName: entry.name, filePath, size: stat.size });
    }
    return result.sort((a, b) => b.fileName.localeCompare(a.fileName));
  }
}
