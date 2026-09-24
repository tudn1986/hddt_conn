import type {
  AppConfig,
  ExistingInvoiceRef,
  InvoiceDocument,
  InvoiceSource,
  QueryAutoInput,
  QueryAutoResult,
  QueryAutoWarning,
} from '../../shared/models/index.js';
import { buildDocumentKey } from '../../shared/filenames/index.js';
import {
  buildBusinessLocatorKey,
  documentBusinessLocatorKey,
  existingBusinessLocatorKey,
} from '../../shared/incremental-sync/index.js';
import { normalizeInvoice } from '../../shared/normalizer/index.js';
import { locatorSchema } from '../../shared/schemas/index.js';
import {
  incrementalWindow,
  splitByMonth,
  ttxly6SupplementWindow,
  type DateChunk,
} from '../../shared/utils/date-utils.js';
import { AppError, isRecord, sleep } from '../../shared/utils/index.js';
import { SessionExpiredError, type GdtConnector } from '../gdt/connector.js';

function comparable(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function statusChanged(existing: ExistingInvoiceRef, refreshed: InvoiceDocument): boolean {
  return comparable(existing.invoiceStatus) !== comparable(refreshed.invoiceStatus)
    || comparable(existing.processingStatus) !== comparable(refreshed.processingStatus);
}

type QueryStage = 'main' | 'ttxly6Supplement';

interface QueryChain {
  stage: QueryStage;
  source: InvoiceSource;
  status: '5' | '6' | '8';
  chunk: DateChunk;
}

/** One instance per request. Cursor chains are sequential, never inferred from page size. */
export class InvoiceQueryService {
  constructor(private connector: GdtConnector, private network: AppConfig['network']) {}

  async queryAuto(input: QueryAutoInput, signal?: AbortSignal): Promise<QueryAutoResult> {
    const statuses = input.statuses?.length
      ? input.statuses
      : [input.status ?? '5'] as Array<'5' | '6' | '8'>;
    const sources: InvoiceSource[] = input.sources?.length
      ? input.sources
      : input.source
        ? [input.source]
        : input.direction === 'purchase'
          ? ['standard', 'pos']
          : ['standard'];

    const mainWindow = incrementalWindow(input.fromDate, input.toDate, input.baselineToDate);
    const mainChunks = mainWindow ? splitByMonth(mainWindow.start, mainWindow.end) : [];
    const supplementWindow = input.baselineToDate
      && input.supplementTtxly6 !== false
      && input.direction === 'purchase'
      && sources.includes('standard')
      ? ttxly6SupplementWindow(input.toDate)
      : undefined;
    const supplementChunks = supplementWindow
      ? splitByMonth(supplementWindow.start, supplementWindow.end)
      : [];

    const {
      existingDocuments: _existingDocuments,
      baselineToDate: _baselineToDate,
      supplementTtxly6: _supplementTtxly6,
      ...queryInput
    } = input;

    const documents: InvoiceDocument[] = [];
    const warnings: QueryAutoWarning[] = [];
    const keys = new Set<string>();
    const hydrateIndexes: number[] = [];
    const existingByKey = new Map<string, ExistingInvoiceRef>();
    const existingByBusiness = new Map<string, ExistingInvoiceRef[]>();

    let expired = false;
    let pages = 0;
    let completedChunks = 0;
    let hydrated = 0;
    let existingCount = 0;
    let existingComplete = 0;
    let existingMissingDetail = 0;
    let newDocuments = 0;
    let changedStatuses = 0;
    let supplementFound = 0;
    let duplicateAcrossQueries = 0;

    for (const existing of input.existingDocuments ?? []) {
      const expectedKey = buildDocumentKey(input.direction, existing.invoiceSource, {
        sellerTaxCode: existing.sellerTaxCode,
        templateNo: existing.templateNo,
        series: existing.series,
        invoiceNo: existing.invoiceNo,
      });
      if (expectedKey !== existing.key) {
        throw new AppError('EXISTING_IDENTITY_INVALID', `Key dataset không khớp locator: ${existing.key}`, 400);
      }
      if (existingByKey.has(existing.key)) {
        throw new AppError('EXISTING_IDENTITY_DUPLICATE', `Dataset có key trùng: ${existing.key}`, 400);
      }
      existingByKey.set(existing.key, existing);
      const businessKey = existingBusinessLocatorKey(existing);
      const matches = existingByBusiness.get(businessKey) ?? [];
      matches.push(existing);
      existingByBusiness.set(businessKey, matches);
    }

    const check = () => {
      if (signal?.aborted) throw new AppError('QUERY_CANCELLED', 'Đã dừng truy vấn.', 499);
    };
    const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
      for (let attempt = 1; ; attempt++) {
        check();
        try {
          return await fn();
        } catch (error) {
          if (error instanceof SessionExpiredError) {
            expired = true;
            throw error;
          }
          if (!(error instanceof AppError) || !error.retryable || attempt >= this.network.maxRetries) throw error;
          await sleep(Math.min(10_000, Math.max(250, this.network.requestDelayMs) * 2 ** (attempt - 1)));
        }
      }
    };
    const code = (error: unknown) => error instanceof AppError ? error.code : 'REQUEST_FAILED';

    const acceptListItem = (
      item: Record<string, unknown>,
      source: InvoiceSource,
      stage: QueryStage,
      status: '5' | '6' | '8',
      chunk: DateChunk
    ) => {
      const doc = normalizeInvoice(input.direction, source, item);
      if (keys.has(doc.key)) {
        duplicateAcrossQueries++;
        return;
      }

      keys.add(doc.key);
      if (stage === 'ttxly6Supplement') supplementFound++;
      const index = documents.push(doc) - 1;
      const existing = existingByKey.get(doc.key);
      if (!existing) {
        newDocuments++;
        hydrateIndexes.push(index);
        return;
      }

      existingCount++;
      if (statusChanged(existing, doc)) changedStatuses++;
      if (
        existing.portalInvoiceId && doc.portalInvoiceId
        && existing.portalInvoiceId !== doc.portalInvoiceId
      ) {
        warnings.push({
          stage: 'query',
          code: 'PORTAL_ID_CHANGED',
          source,
          status,
          chunk,
          key: doc.key,
          message: 'Khóa nghiệp vụ trùng dataset nhưng portalInvoiceId đã thay đổi; giữ identity theo locator.',
        });
      }
      if (
        existing.buyerTaxCode && doc.buyer.taxCode
        && existing.buyerTaxCode !== doc.buyer.taxCode
      ) {
        warnings.push({
          stage: 'query',
          code: 'BUYER_TAX_CODE_CHANGED',
          source,
          status,
          chunk,
          key: doc.key,
          message: 'MST người mua trong summary mới khác dataset; summary mới sẽ được merge nhưng detail cũ vẫn được giữ.',
        });
      }

      if (existing.hasDetail) {
        existingComplete++;
      } else {
        existingMissingDetail++;
        hydrateIndexes.push(index);
      }
    };

    const runChain = async (chain: QueryChain): Promise<boolean> => {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      let received = 0;
      try {
        for (let pageNumber = 1; ; pageNumber++) {
          check();
          if (pageNumber > 10_000 || documents.length >= 50_000) {
            throw new AppError('QUERY_LIMIT', 'Giới hạn 10.000 trang/chain hoặc 50.000 hóa đơn.', 413);
          }
          const page = await retry(() => this.connector.queryInvoices({
            ...queryInput,
            source: chain.source,
            sources: undefined,
            statuses: undefined,
            status: chain.status,
            fromDate: chain.chunk.start,
            toDate: chain.chunk.end,
            cursor,
            page: pageNumber,
            pageSize: 15,
          }));
          pages++;
          received += page.items.length;
          for (const item of page.items) {
            if (!isRecord(item)) throw new AppError('PORTAL_FORMAT', 'Dữ liệu danh sách không hợp lệ.', 502);
            acceptListItem(item, chain.source, chain.stage, chain.status, chain.chunk);
          }
          if (!page.nextCursor) {
            if (received < page.total) {
              warnings.push({
                stage: 'query',
                code: 'MISSING_CURSOR',
                source: chain.source,
                status: chain.status,
                chunk: chain.chunk,
                message: `${chain.stage}: GDT không trả cursor dù tổng lớn hơn số đã nhận.`,
              });
            }
            break;
          }
          if (!page.items.length || cursors.has(page.nextCursor)) {
            throw new AppError('CURSOR_LOOP', 'Cursor lặp hoặc trang rỗng có cursor.', 502);
          }
          cursors.add(page.nextCursor);
          cursor = page.nextCursor;
          if (this.network.requestDelayMs) await sleep(this.network.requestDelayMs);
        }
        return true;
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error instanceof SessionExpiredError) return false;
        const detail = error instanceof AppError ? error.message : 'Một phần chain chưa tải được.';
        warnings.push({
          stage: 'query',
          code: code(error),
          source: chain.source,
          status: chain.status,
          chunk: chain.chunk,
          message: `${chain.stage}, source=${chain.source}, ttxly=${chain.status}: ${detail}`,
        });
        return false;
      }
    };

    const runChunkGroup = async (chains: QueryChain[]): Promise<void> => {
      let completed = true;
      for (const chain of chains) {
        if (expired) break;
        const ok = await runChain(chain);
        if (!ok) completed = false;
        if (this.network.requestDelayMs) await sleep(this.network.requestDelayMs);
      }
      if (!expired && completed) completedChunks++;
    };

    for (const chunk of mainChunks) {
      const chains: QueryChain[] = [];
      for (const source of sources) {
        for (const status of statuses) chains.push({ stage: 'main', source, status, chunk });
      }
      await runChunkGroup(chains);
      if (expired) break;
    }

    if (!expired) {
      for (const chunk of supplementChunks) {
        await runChunkGroup([{ stage: 'ttxly6Supplement', source: 'standard', status: '6', chunk }]);
        if (expired) break;
      }
    }

    // Relation resolution happens after list dedup so originals returned in the same sync are visible.
    const fetchedByBusiness = new Map<string, InvoiceDocument[]>();
    for (const document of documents) {
      const businessKey = documentBusinessLocatorKey(document);
      const matches = fetchedByBusiness.get(businessKey) ?? [];
      matches.push(document);
      fetchedByBusiness.set(businessKey, matches);
    }

    let replacementFound = 0;
    let adjustmentFound = 0;
    let originalMatched = 0;
    let originalNotFound = 0;
    const markedReplaced = new Set<string>();
    const markedAdjusted = new Set<string>();

    for (const child of documents) {
      const nature = comparable(child.nature);
      if ((nature === '2' || nature === '3') && !child.relation) {
        warnings.push({
          stage: 'relation',
          code: 'RELATION_LOCATOR_INCOMPLETE',
          source: child.invoiceSource,
          key: child.key,
          message: 'Hóa đơn thay thế/điều chỉnh thiếu locator hóa đơn gốc; không tự cập nhật dữ liệu lịch sử.',
        });
        originalNotFound++;
        continue;
      }
      if (!child.relation) continue;
      if (child.relation.kind === 'replacement') replacementFound++;
      else adjustmentFound++;

      const relationKey = buildBusinessLocatorKey(child.invoiceSource, child.relation.original);
      const candidates = new Map<string, { key: string; status?: number | string }>();
      for (const existing of existingByBusiness.get(relationKey) ?? []) {
        candidates.set(existing.key, { key: existing.key, status: existing.invoiceStatus });
      }
      for (const fetched of fetchedByBusiness.get(relationKey) ?? []) {
        if (fetched.key !== child.key) candidates.set(fetched.key, { key: fetched.key, status: fetched.invoiceStatus });
      }

      if (candidates.size === 0) {
        originalNotFound++;
        warnings.push({
          stage: 'relation',
          code: 'ORIGINAL_INVOICE_NOT_IN_DATASET',
          source: child.invoiceSource,
          key: child.key,
          message: 'Không tìm thấy hóa đơn gốc theo nbmst + khmshdgoc + khhdgoc + shdgoc; không tự query lịch sử.',
        });
        continue;
      }
      if (candidates.size > 1) {
        warnings.push({
          stage: 'relation',
          code: 'ORIGINAL_LOCATOR_AMBIGUOUS',
          source: child.invoiceSource,
          key: child.key,
          message: 'Locator hóa đơn gốc khớp nhiều record; không tự chọn record để cập nhật.',
        });
        continue;
      }

      originalMatched++;
      const [original] = candidates.values();
      if (child.relation.kind === 'replacement') {
        if (comparable(original.status) !== '4') markedReplaced.add(original.key);
      } else if (comparable(original.status) !== '5') {
        markedAdjusted.add(original.key);
      }
    }

    let hydrationCursor = 0;
    const worker = async () => {
      while (!expired) {
        check();
        const targetIndex = hydrateIndexes[hydrationCursor++];
        if (targetIndex === undefined) return;
        const doc = documents[targetIndex];
        try {
          const locator = locatorSchema.parse({
            sellerTaxCode: doc.seller.taxCode || '',
            templateNo: doc.templateNo ?? '',
            series: doc.series || '',
            invoiceNo: doc.invoiceNo ?? '',
          });
          const response = await retry(() => this.connector.getInvoiceDetail(doc.invoiceSource, locator));
          if (!isRecord(response.raw)) throw new AppError('PORTAL_FORMAT', 'Chi tiết không hợp lệ.', 502);
          const summary = isRecord(doc.rawSummary) ? doc.rawSummary : {};
          const merged = normalizeInvoice(input.direction, doc.invoiceSource, summary, response.raw);
          if (merged.key !== doc.key || merged.invoiceSource !== doc.invoiceSource) {
            throw new AppError('DETAIL_IDENTITY', 'Chi tiết không khớp khóa/nguồn hóa đơn.', 502);
          }
          documents[targetIndex] = merged;
          hydrated++;
        } catch (error) {
          if (signal?.aborted) throw error;
          if (error instanceof SessionExpiredError) {
            expired = true;
            return;
          }
          warnings.push({
            stage: 'detail',
            code: code(error),
            source: doc.invoiceSource,
            key: doc.key,
            message: 'Chưa tải được chi tiết; bản tóm tắt được giữ lại.',
          });
        }
        if (this.network.requestDelayMs) await sleep(this.network.requestDelayMs);
      }
    };

    await Promise.all(Array.from(
      {
        length: Math.min(
          5,
          Math.max(1, this.network.detailConcurrency),
          hydrateIndexes.length
        ),
      },
      worker
    ));

    return {
      documents,
      total: documents.length,
      warnings,
      partial: expired || warnings.some((warning) => warning.stage !== 'relation'),
      sessionExpired: expired,
      chunks: mainChunks.length + supplementChunks.length,
      completedChunks,
      pages,
      hydrated,
      windows: {
        main: mainWindow,
        ttxly6Supplement: supplementWindow,
      },
      sync: {
        found: documents.length,
        existing: existingCount,
        existingComplete,
        existingMissingDetail,
        newDocuments,
        statusChanged: changedStatuses,
        detailSkipped: existingComplete,
        ttxly6SupplementFound: supplementFound,
        duplicateAcrossQueries,
        replacementFound,
        adjustmentFound,
        originalMatched,
        originalNotFound,
        originalMarkedReplaced: markedReplaced.size,
        originalMarkedAdjusted: markedAdjusted.size,
      },
    };
  }
}
