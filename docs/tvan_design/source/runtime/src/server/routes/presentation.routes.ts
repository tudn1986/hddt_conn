import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { InvoiceDocument } from '../../shared/models/index.js';
import { AppError, isRecord } from '../../shared/utils/index.js';

function isInvoiceDocument(value: unknown): value is InvoiceDocument {
  return isRecord(value)
    && typeof value.key === 'string'
    && isRecord(value.seller)
    && isRecord(value.buyer)
    && Array.isArray(value.lines)
    && Array.isArray(value.dynamicFields)
    && (value.direction === 'purchase' || value.direction === 'sales')
    && (value.invoiceSource === 'standard' || value.invoiceSource === 'pos');
}

const documentSchema = z.custom<InvoiceDocument>(isInvoiceDocument, 'Hóa đơn không hợp lệ.');
const documentBodySchema = z.object({ document: documentSchema }).strict();
const challengeSchema = z.object({
  challengeId: z.string().uuid(),
  answer: z.string().min(1).max(512),
}).strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(
      'INVALID_PRESENTATION_REQUEST',
      result.error.issues[0]?.message || 'Dữ liệu bản thể hiện không hợp lệ.',
      400,
    );
  }
  return result.data;
}

export function registerPresentationRoutes(app: FastifyInstance): void {
  app.get('/api/presentation/adapters', async (request) => ({
    adapters: request.sessionContext.tvanPdf.presentationAdapters(),
  }));

  app.post('/api/presentation/status', async (request) => {
    const body = parse(documentBodySchema, request.body);
    return request.sessionContext.tvanPdf.presentationStatus(body.document);
  });

  app.post('/api/presentation/prepare', async (request) => {
    const body = parse(documentBodySchema, request.body);
    return request.sessionContext.tvanPdf.preparePresentation(body.document);
  });
  app.post('/api/presentation/challenge', async (request) => {
    const body = parse(challengeSchema, request.body);
    return request.sessionContext.tvanPdf.verifyCaptcha(body.challengeId, body.answer);
  });

  app.post('/api/presentation/resolve-link', async (request) => {
    const body = parse(documentBodySchema, request.body);
    return request.sessionContext.tvanPdf.resolvePresentationLink(body.document);
  });

  app.post('/api/presentation/view', async (request, reply) => {
    const body = parse(documentBodySchema, request.body);
    const pdf = await request.sessionContext.tvanPdf.viewPdf(body.document);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`)
      .header('Content-Length', String(pdf.content.length));
    return reply.send(pdf.content);
  });

  app.post('/api/presentation/download', async (request, reply) => {
    const body = parse(documentBodySchema, request.body);
    const pdf = await request.sessionContext.tvanPdf.viewPdf(body.document);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`)
      .header('Content-Length', String(pdf.content.length));
    return reply.send(pdf.content);
  });

  app.post('/api/presentation/download-original', async (request, reply) => {
    const body = parse(documentBodySchema, request.body);
    const file = await request.sessionContext.tvanPdf.downloadOriginal(body.document);
    reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
      .header('Content-Length', String(file.content.length));
    return reply.send(file.content);
  });
}
