import fs from 'node:fs';
import path from 'node:path';
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
const documentsBodySchema = z.object({ documents: z.array(documentSchema).min(1).max(2_000) }).strict();
const captchaSchema = z.object({ challengeId: z.string().uuid(), answer: z.string().min(1).max(512) }).strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError('INVALID_TVAN_REQUEST', result.error.issues[0]?.message || 'Dữ liệu TVAN không hợp lệ.', 400);
  return result.data;
}

export function registerTvanRoutes(app: FastifyInstance): void {
  app.post('/api/tvan/capabilities', async (request) => {
    const body = parse(documentsBodySchema, request.body);
    return { providers: request.sessionContext.tvanPdf.capabilities(body.documents) };
  });

  app.post('/api/tvan/pdf/prepare-view', async (request) => {
    const body = parse(documentBodySchema, request.body);
    return request.sessionContext.tvanPdf.prepareView(body.document);
  });

  app.post('/api/tvan/presentation-link/resolve', async (request) => {
    const body = parse(documentBodySchema, request.body);
    return request.sessionContext.tvanPdf.resolvePresentationLink(body.document);
  });

  app.post('/api/tvan/supervised/prepare', async (request) => {
    const body = parse(documentBodySchema, request.body);
    return request.sessionContext.tvanPdf.prepareSupervised(body.document);
  });

  app.post('/api/tvan/supervised/download-plan', async (request) => {
    const body = parse(documentBodySchema, request.body);
    return request.sessionContext.tvanPdf.describeDownloadRequest(body.document);
  });

  app.post('/api/tvan/pdf/captcha', async (request) => {
    const body = parse(captchaSchema, request.body);
    return request.sessionContext.tvanPdf.verifyCaptcha(body.challengeId, body.answer);
  });

  app.post('/api/tvan/artifacts/prepare', async (request) => {
    const body = parse(documentBodySchema, request.body);
    return request.sessionContext.tvanPdf.prepareArtifact(body.document);
  });

  app.post('/api/tvan/file/download', async (request, reply) => {
    const body = parse(documentBodySchema, request.body);
    const file = await request.sessionContext.tvanPdf.downloadOriginal(body.document);
    reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
      .header('Content-Length', String(file.content.length));
    return reply.send(file.content);
  });

  app.get<{ Params: { id: string } }>('/api/tvan/artifacts/:id/file', async (request, reply) => {
    const file = request.sessionContext.tvanPdf.getArtifactFile(request.params.id);
    reply
      .header('Content-Type', file.contentType)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
      .header('Content-Length', String(file.content.length));
    return reply.send(file.content);
  });

  app.get<{ Params: { id: string } }>('/api/tvan/artifacts/:id/pdf', async (request, reply) => {
    const pdf = request.sessionContext.tvanPdf.getArtifactPdf(request.params.id);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`)
      .header('Content-Length', String(pdf.content.length));
    return reply.send(pdf.content);
  });

  app.post('/api/tvan/pdf/view', async (request, reply) => {
    const body = parse(documentBodySchema, request.body);
    const pdf = await request.sessionContext.tvanPdf.viewPdf(body.document);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`)
      .header('Content-Length', String(pdf.content.length));
    return reply.send(pdf.content);
  });

  app.post('/api/tvan/pdf/batch/start', async (request) => {
    const body = parse(documentsBodySchema, request.body);
    return request.sessionContext.tvanPdf.startBatch(body.documents);
  });

  app.get<{ Params: { id: string } }>('/api/tvan/pdf/batch/:id', async (request) => (
    request.sessionContext.tvanPdf.getBatch(request.params.id)
  ));

  app.post<{ Params: { id: string } }>('/api/tvan/pdf/batch/:id/captcha', async (request) => {
    const body = parse(captchaSchema, request.body);
    return request.sessionContext.tvanPdf.submitBatchCaptcha(request.params.id, body.challengeId, body.answer);
  });

  app.get<{ Params: { id: string } }>('/api/tvan/pdf/batch/:id/archive', async (request, reply) => {
    const archivePath = request.sessionContext.tvanPdf.getArchivePath(request.params.id);
    const stat = await fs.promises.stat(archivePath);
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(archivePath))}`)
      .header('Content-Length', String(stat.size));
    const stream = fs.createReadStream(archivePath);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void request.sessionContext.tvanPdf.deleteBatch(request.params.id);
    };
    stream.once('close', cleanup);
    stream.once('error', cleanup);
    reply.raw.once('close', cleanup);
    return reply.send(stream);
  });

}
