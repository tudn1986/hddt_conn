import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatasetService } from '../../src/server/services/dataset.service.js';
import { SettingsService } from '../../src/server/services/settings.service.js';
import { document, TEST_MST } from '../helpers.js';

let temporaryRoot = '';
let dataRoot = '';
let service: DatasetService;

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-dataset-'));
  dataRoot = path.join(temporaryRoot, 'data');
  const settings = new SettingsService({
    appDataDir: path.join(temporaryRoot, 'app'),
    defaultDataRoot: dataRoot,
  });
  await settings.init();
  service = new DatasetService(settings);
});

afterEach(async () => {
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true });
});

describe('dataset service', () => {
  it('atomically saves, lists and opens a versioned dataset', async () => {
    const source = document();
    const filePath = await service.save(TEST_MST, 'purchase', '2026-07-01', '2026-07-31', [source]);
    expect(path.basename(filePath)).toBe('HDDT_PURCHASE_20260701_20260731.json');
    const disk = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(disk).toMatchObject({
      format: 'hddt-dataset',
      schemaVersion: 1,
      meta: { accountTaxCode: TEST_MST, recordCount: 1, detailCount: 1 },
    });
    expect(disk.documents[0].normalized.rawSummary).toBeUndefined();
    expect(disk.documents[0].rawSummary).toEqual(source.rawSummary);
    const opened = await service.open(filePath);
    expect(opened.documents[0].normalized.rawSummary).toEqual(source.rawSummary);
    expect((await service.list(TEST_MST))[0]).toMatchObject({ fileName: path.basename(filePath) });
  });

  it('rejects inconsistent counts, duplicate keys and direction mismatch', () => {
    const base = {
      format: 'hddt-dataset',
      schemaVersion: 1,
      appVersion: '1.0.0',
      meta: {
        accountTaxCode: TEST_MST,
        direction: 'purchase',
        fromDate: '2026-07-01',
        toDate: '2026-07-31',
        createdAt: new Date().toISOString(),
        source: 'test',
        recordCount: 1,
        detailCount: 1,
      },
      documents: [{ key: document().key, normalized: document() }],
    };
    expect(() => service.import({ ...base, meta: { ...base.meta, recordCount: 2 } })).toThrow(/recordCount/i);
    expect(() => service.import({ ...base, documents: [base.documents[0], base.documents[0]], meta: { ...base.meta, recordCount: 2 } })).toThrow(/trùng/i);
    expect(() => service.import({ ...base, documents: [{ key: base.documents[0].key, normalized: document({ direction: 'sales' }) }] })).toThrow(/không nhất quán/i);
  });

  it('rejects lexical path traversal', async () => {
    await expect(service.open(path.join(dataRoot, '..', 'outside.json'))).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_DATA_ROOT',
    });
  });

  it.runIf(process.platform !== 'win32')('rejects a symlink that escapes dataRoot', async () => {
    const legitimate = await service.save(TEST_MST, 'purchase', '2026-07-01', '2026-07-31', [document()]);
    const outside = path.join(temporaryRoot, 'outside.json');
    await fs.copyFile(legitimate, outside);
    const link = path.join(dataRoot, 'linked.json');
    await fs.symlink(outside, link);
    await expect(service.open(link)).rejects.toMatchObject({ code: 'PATH_OUTSIDE_DATA_ROOT' });
  });

  it('repairs blank HHDV/VAT fields from raw payload when importing an older dataset', () => {
    const source = document({
      documentTypeCode: '06_01',
      currency: 'USD',
      subtotal: undefined,
      vatAmount: undefined,
      grandTotal: undefined,
      rawSummary: {
        nbmst: '4501622475', khmshdon: 6, khhdon: 'C26NYY', shdon: 123,
        hdon: '06_01', dvtte: 'USD', tthai: 1, ttxly: 5,
        ttkhac: [
          { ttruong: 'StockTotalAmount', kdlieu: 'numeric', dlieu: '703594384.0' },
          { ttruong: 'StockTotalAmountOC', kdlieu: 'numeric', dlieu: '27186.8' },
        ],
      },
    });
    const normalized = { ...source, rawSummary: undefined, rawDetail: undefined };
    const dataset = {
      format: 'hddt-dataset',
      schemaVersion: 1,
      appVersion: '1.2.0',
      meta: {
        accountTaxCode: TEST_MST,
        direction: 'purchase',
        fromDate: '2026-09-01',
        toDate: '2026-09-30',
        createdAt: new Date().toISOString(),
        source: 'test',
        recordCount: 1,
        detailCount: 0,
      },
      documents: [{ key: source.key, normalized, rawSummary: source.rawSummary }],
    };
    const imported = service.import(dataset);
    expect(imported.documents[0].normalized.subtotal).toBe(27186.8);
    expect(imported.documents[0].normalized.vatAmount).toBe(0);
  });

});
