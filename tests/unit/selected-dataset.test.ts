import { describe, expect, it } from 'vitest';
import { authoritativeCoverageRange } from '../../src/web/storage/dataset-coverage.js';
import { buildSelectedDataset, selectedDatasetFileName } from '../../src/web/storage/local-workspace.js';
import { datasetEnvelopeSchema } from '../../src/shared/schemas/index.js';
import { document, TEST_MST } from '../helpers.js';

describe('selected dataset snapshots', () => {
  it('builds an additive schema-v1 selection snapshot without mutating invoice payloads', () => {
    const source = document();
    const dataset = buildSelectedDataset({
      accountTaxCode: TEST_MST,
      direction: 'purchase',
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      documents: [source],
      sourceRecordCount: 42,
    }, '2026-09-27T06:05:00.000Z');

    expect(dataset).toMatchObject({
      format: 'hddt-dataset',
      schemaVersion: 1,
      meta: {
        accountTaxCode: TEST_MST,
        direction: 'purchase',
        fromDate: '2026-09-01',
        toDate: '2026-09-30',
        recordCount: 1,
        datasetScope: 'selection',
        coverageComplete: false,
        sourceRecordCount: 42,
      },
    });
    expect(dataset.documents[0].normalized.rawSummary).toBeUndefined();
    expect(dataset.documents[0].rawSummary).toEqual(source.rawSummary);
    expect(source.rawSummary).toBeTruthy();
    expect(datasetEnvelopeSchema.parse(dataset).meta).toMatchObject({
      datasetScope: 'selection',
      coverageComplete: false,
      sourceRecordCount: 42,
    });
  });

  it('uses a namespace and timestamp that cannot collide with the legacy full-dataset filename', () => {
    const createdAt = new Date('2026-09-27T06:05:07.123Z');
    expect(selectedDatasetFileName('purchase', '2026-09-01', '2026-09-30', 20, createdAt))
      .toBe('HDDT_PURCHASE_SELECTED_20260901_20260930_20HD_20260927T060507123Z.json');
  });

  it('never treats a selection snapshot as an authoritative coverage baseline', () => {
    const full = buildSelectedDataset({
      accountTaxCode: TEST_MST,
      direction: 'purchase',
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      documents: [document()],
      sourceRecordCount: 10,
    });
    expect(authoritativeCoverageRange(full)).toBeNull();

    const legacy = structuredClone(full);
    delete legacy.meta.datasetScope;
    delete legacy.meta.coverageComplete;
    delete legacy.meta.sourceRecordCount;
    expect(authoritativeCoverageRange(legacy)).toEqual(['2026-09-01', '2026-09-30']);
  });
});
