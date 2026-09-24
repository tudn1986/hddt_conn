import { InvoiceQueryService } from '../services/invoice-query.service.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { InvoiceLocator, InvoiceSource } from '../../shared/models/index.js';
import { invoiceQuerySchema, queryAutoSchema, locatorSchema, directionSchema, invoiceSourceSchema } from '../../shared/schemas/index.js';
import { normalizeInvoice } from '../../shared/normalizer/index.js';
import { AppError, isRecord, sleep } from '../../shared/utils/index.js';
import { SessionExpiredError } from '../gdt/connector.js';

const summarySchema = z.record(z.string(), z.unknown());
const detailSchema = z.object({
  direction: directionSchema,
  invoiceSource: invoiceSourceSchema.default('standard'),
  locator: locatorSchema,
  summary: summarySchema.optional(),
}).strict();
const detailsSchema = z.object({
  direction: directionSchema,
  items: z.array(z.object({
    invoiceSource: invoiceSourceSchema.default('standard'),
    locator: locatorSchema,
    summary: summarySchema.optional(),
  }).strict()).min(1).max(500),
}).strict();

async function fetchDetailWithRetry(
  app: FastifyInstance,
  request: FastifyRequest,
  source: InvoiceSource,
  locator: InvoiceLocator
): Promise<Record<string, unknown>> {
  const network = app.settings.getConfig().network;
  for (let attempt = 1; attempt <= network.maxRetries; attempt += 1) {
    try {
      const response = await request.sessionContext.session.getConnector().getInvoiceDetail(source, locator);
      if (!isRecord(response.raw)) throw new AppError('PORTAL_FORMAT', 'Chi tiết hóa đơn không đúng schema.', 502);
      return response.raw;
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      const retryable = error instanceof AppError ? error.retryable : true;
      if (!retryable || attempt >= network.maxRetries) throw error;
      await sleep(Math.min(10_000, Math.max(250, network.requestDelayMs) * 2 ** (attempt - 1)));
    }
  }
  throw new AppError('DETAIL_FAILED', 'Không tải được chi tiết hóa đơn.', 502);
}

export function registerInvoiceRoutes(app: FastifyInstance): void {
  app.post('/api/invoices/query-auto', async (request, reply) => {
    if (!request.sessionContext.session.isAuthenticated()) throw new SessionExpiredError();
    const parsed = queryAutoSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.cursor || parsed.data.page !== 1) {
      throw new AppError('INVALID_QUERY', parsed.success ? 'Không truyền cursor/page cho query-auto.' : parsed.error.issues[0]?.message || 'Bộ lọc không hợp lệ.');
    }
    const controller = new AbortController();
    const disconnect = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on('close', disconnect);
    try {
      const service = new InvoiceQueryService(request.sessionContext.session.getConnector(), app.settings.getConfig().network);
      const result = await service.queryAuto(parsed.data, controller.signal);
      try {
        app.tvanCatalog.observeDocuments(result.documents, 'gdt_query_auto');
      } catch (error) {
        request.log.error({ err: error, source: 'gdt_query_auto', documents: result.documents.length }, 'tvan_catalog_observe_failed');
      }
      if (result.sessionExpired) {
        return reply.status(401).send({
          ...result,
          error: 'SESSION_EXPIRED',
          message: 'Phiên GDT hết hạn. Kết quả đã tải được giữ lại.',
        });
      }
      return result;
    } finally {
      reply.raw.off('close', disconnect);
    }
  });

  app.post('/api/invoices/query', async (request) => {
    if (!request.sessionContext.session.isAuthenticated()) throw new SessionExpiredError();
    const parsed = invoiceQuerySchema.safeParse(request.body);
    if (!parsed.success) throw new AppError('INVALID_QUERY', parsed.error.issues[0]?.message || 'Bộ lọc không hợp lệ.');
    const source: InvoiceSource = parsed.data.source ?? 'standard';
    const page = await request.sessionContext.session.getConnector().queryInvoices({ ...parsed.data, source, sources: undefined });
    const documents = page.items.map((item) => {
      if (!isRecord(item)) throw new AppError('PORTAL_FORMAT', 'GDT trả item không hợp lệ.', 502);
      return normalizeInvoice(parsed.data.direction, source, item);
    });
    try {
      app.tvanCatalog.observeDocuments(documents, 'gdt_query');
    } catch (error) {
      request.log.error({ err: error, source: 'gdt_query', documents: documents.length }, 'tvan_catalog_observe_failed');
    }
    return { total: page.total, page: page.page, pageSize: page.pageSize, nextCursor: page.nextCursor, documents };
  });

  app.post('/api/invoices/detail', async (request) => {
    if (!request.sessionContext.session.isAuthenticated()) throw new SessionExpiredError();
    const parsed = detailSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError('INVALID_DETAIL_REQUEST', parsed.error.issues[0]?.message || 'Yêu cầu detail không hợp lệ.');
    const raw = await fetchDetailWithRetry(app, request, parsed.data.invoiceSource, parsed.data.locator);
    return {
      document: normalizeInvoice(
        parsed.data.direction,
        parsed.data.invoiceSource,
        parsed.data.summary || raw,
        raw
      ),
    };
  });

  app.post('/api/invoices/details', async (request, reply) => {
    if (!request.sessionContext.session.isAuthenticated()) throw new SessionExpiredError();
    const parsed = detailsSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError('INVALID_DETAIL_REQUEST', parsed.error.issues[0]?.message || 'Yêu cầu details không hợp lệ.');
    const { direction, items } = parsed.data;
    const documents: ReturnType<typeof normalizeInvoice>[] = [];
    const errors: Array<{ index: number; code: string; message: string; source: InvoiceSource }> = [];
    let cursor = 0;
    let expired = false;
    const concurrency = Math.min(5, Math.max(1, app.settings.getConfig().network.detailConcurrency), items.length);
    const worker = async () => {
      while (!expired) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];
        try {
          const raw = await fetchDetailWithRetry(app, request, item.invoiceSource, item.locator);
          documents.push(normalizeInvoice(direction, item.invoiceSource, item.summary || raw, raw));
        } catch (error) {
          if (error instanceof SessionExpiredError) { expired = true; return; }
          errors.push({
            index,
            source: item.invoiceSource,
            code: error instanceof AppError ? error.code : 'DETAIL_FAILED',
            message: error instanceof Error ? error.message : 'Không tải được chi tiết.',
          });
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    if (expired) {
      return reply.status(401).send({ error: 'SESSION_EXPIRED', message: 'Phiên GDT hết hạn.', partial: documents, errors });
    }
    return { documents, errors };
  });
}
