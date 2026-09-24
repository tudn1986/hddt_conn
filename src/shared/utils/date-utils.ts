import { isoDateSchema } from '../schemas/index.js';
import { AppError } from './index.js';

export interface DateChunk { start: string; end: string; }

function assertIsoDate(value: string): void {
  if (!isoDateSchema.safeParse(value).success) {
    throw new AppError('INVALID_DATE', 'Ngày không hợp lệ (YYYY-MM-DD).');
  }
}

export function nextIsoDate(value: string): string {
  assertIsoDate(value);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function previousIsoDate(value: string): string {
  assertIsoDate(value);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/** First calendar day of the month immediately before the month containing toDate. */
export function firstDayOfPreviousMonth(toDate: string): string {
  assertIsoDate(toDate);
  const [year, month] = toDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}

/**
 * Main incremental window. Existing dataset coverage is authoritative: when baselineToDate exists,
 * do not rescan dates through that baseline. The user's fromDate can still narrow the new window.
 */
export function incrementalWindow(
  fromDate: string,
  toDate: string,
  baselineToDate?: string
): DateChunk | undefined {
  assertIsoDate(fromDate);
  assertIsoDate(toDate);
  if (fromDate > toDate) throw new AppError('INVALID_DATE_RANGE', 'Khoảng ngày không hợp lệ (YYYY-MM-DD).');
  if (baselineToDate) assertIsoDate(baselineToDate);

  const start = baselineToDate
    ? [fromDate, nextIsoDate(baselineToDate)].sort().at(-1) as string
    : fromDate;
  if (start > toDate) return undefined;
  return { start, end: toDate };
}

export function ttxly6SupplementWindow(toDate: string): DateChunk {
  assertIsoDate(toDate);
  return { start: firstDayOfPreviousMonth(toDate), end: toDate };
}

export function splitByMonth(fromDate: string, toDate: string): DateChunk[] {
  if (!isoDateSchema.safeParse(fromDate).success || !isoDateSchema.safeParse(toDate).success || fromDate > toDate) {
    throw new AppError('INVALID_DATE_RANGE', 'Khoảng ngày không hợp lệ (YYYY-MM-DD).');
  }
  const chunks: DateChunk[] = [];
  let start = fromDate;
  while (start <= toDate) {
    const [year, month] = start.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const end = last < toDate ? last : toDate;
    chunks.push({ start, end });
    if (end === toDate) break;
    start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  }
  return chunks;
}
