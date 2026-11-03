import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatasetService } from '../../src/server/services/dataset.service.js';
import { SettingsService } from '../../src/server/services/settings.service.js';
import { document, TEST_MST } from '../helpers.js';

const MIB = 1024 * 1024;

let temporaryRoot = '';
let dataRoot = '';
let settings: SettingsService;
let service: DatasetService;

function bulkDocument(index: number) {
  return document({
    key: `purchase|standard|4501622475|1|1C26TST|${index}`,
    invoiceNo: index,
    lines: Array.from({ length: 30 }, (_, lineIndex) => ({
      lineNo: lineIndex + 1,
      itemCode: `SP${lineIndex}`,
      itemName: `Hàng hóa ${index}-${lineIndex}`,
      unit: 'Cái',
      quantity: 1,
      unitPrice: 1000,
      amount: 1000,
      vatRateText: '10%',
      vatAmount: 100,
      dynamicFields: [],
      supplementalInfo: [],
    })),
    rawSummary: { nbmst: '4501622475', khmshdon: 1, khhdon: '1C26TST', shdon: index },
  });
}

function limitDatasetBytes(bytes: number): void {
  const config = settings.getConfig();
  vi.spyOn(settings, 'getConfig').mockReturnValue({ ...config, storage: { ...config.storage, maxDatasetBytes: bytes } });
}

async function saveBulk(count: number): Promise<string> {
  const documents = Array.from({ length: count }, (_, index) => bulkDocument(index + 1));
  return service.save(TEST_MST, 'purchase', '2026-07-01', '2026-07-31', documents);
}

/** Number of bulk documents whose compact dataset file is about `fraction` of the limit. */
async function countForFraction(limit: number, fraction: number): Promise<number> {
  const probe = await saveBulk(10);
  const perDocument = (await fs.stat(probe)).size / 10;
  return Math.floor((limit * fraction) / perDocument);
}

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-dataset-limits-'));
  dataRoot = path.join(temporaryRoot, 'data');
  settings = new SettingsService({ appDataDir: path.join(temporaryRoot, 'app'), defaultDataRoot: dataRoot });
  await settings.init();
  service = new DatasetService(settings);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
});

describe('dataset size limits', () => {
  it('writes compact JSON on a single line', async () => {
    const filePath = await service.save(TEST_MST, 'purchase', '2026-07-01', '2026-07-31', [document()]);
    const raw = await fs.readFile(filePath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.trimEnd()).not.toContain('\n');
    expect(JSON.parse(raw).meta.recordCount).toBe(1);
  });

  it('opens every dataset it saved, even when pretty-printing it would exceed the limit', async () => {
    limitDatasetBytes(MIB);
    const count = await countForFraction(MIB, 0.9);
    const filePath = await saveBulk(count);

    const size = (await fs.stat(filePath)).size;
    expect(size).toBeLessThan(MIB);
    // The pre-v1.3.1-2 writer produced pretty JSON: prove that this payload would have been refused.
    const pretty = JSON.stringify(JSON.parse(await fs.readFile(filePath, 'utf8')), null, 2);
    expect(Buffer.byteLength(pretty)).toBeGreaterThan(MIB);

    const opened = await service.open(filePath);
    expect(opened.meta.recordCount).toBe(count);
    expect(opened.documents).toHaveLength(count);
  });

  it('still opens legacy pretty-printed datasets within the legacy allowance', async () => {
    limitDatasetBytes(MIB);
    const count = await countForFraction(MIB, 0.9);
    const filePath = await saveBulk(count);
    const legacyPath = path.join(path.dirname(filePath), 'HDDT_PURCHASE_20250101_20250131.json');
    await fs.writeFile(legacyPath, `${JSON.stringify(JSON.parse(await fs.readFile(filePath, 'utf8')), null, 2)}\n`);

    const legacySize = (await fs.stat(legacyPath)).size;
    expect(legacySize).toBeGreaterThan(MIB);
    expect(legacySize).toBeLessThanOrEqual(MIB * 2);
    expect((await service.open(legacyPath)).meta.recordCount).toBe(count);
  });

  it('rejects files beyond the legacy allowance without parsing them', async () => {
    limitDatasetBytes(MIB);
    const oversized = path.join(dataRoot, 'oversized.json');
    await fs.mkdir(dataRoot, { recursive: true });
    await fs.writeFile(oversized, ' '.repeat(Math.ceil(MIB * 2.1)));
    await expect(service.open(oversized)).rejects.toMatchObject({ code: 'DATASET_TOO_LARGE' });
  });

  it('refuses to save a dataset whose compact size exceeds the limit and leaves no file behind', async () => {
    limitDatasetBytes(MIB);
    const count = await countForFraction(MIB, 1.3);
    await expect(saveBulk(count)).rejects.toMatchObject({ code: 'DATASET_TOO_LARGE' });
    const leftovers = await service.list(TEST_MST);
    expect(leftovers.some((entry) => entry.size > MIB)).toBe(false);
  });
});
