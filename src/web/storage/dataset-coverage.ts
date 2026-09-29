import type { DatasetFile } from '../../shared/models/index.js';

/**
 * Returns the range that is safe to use as an authoritative incremental-sync baseline.
 * Legacy/full datasets retain their historical behavior. Selection snapshots are partial
 * by definition and therefore must never suppress re-querying their source date range.
 */
export function authoritativeCoverageRange(dataset: DatasetFile): [string, string] | null {
  const fromDate = dataset.meta?.fromDate;
  const toDate = dataset.meta?.toDate;
  if (!fromDate || !toDate) return null;
  if (dataset.meta.datasetScope === 'selection' || dataset.meta.coverageComplete === false) return null;
  return [fromDate, toDate];
}
