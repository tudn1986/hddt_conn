import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { InvoiceDocument } from '../../shared/models/index.js';
import { directionSchema } from '../../shared/schemas/index.js';
import { AppError, isRecord } from '../../shared/utils/index.js';
import { exportReportWorkbook } from '../export/excel-report.js';
import { exportWithProfile, getProfile, listProfiles } from '../export/profile-engine.js';

function isInvoiceDocument(value: unknown): value is InvoiceDocument {
  return isRecord(value) &&
    typeof value.key === 'string' &&
    (value.direction === 'purchase' || value.direction === 'sales') &&
    isRecord(value.seller) &&
    isRecord(value.buyer) &&
    Array.isArray(value.lines) &&
    Array.isArray(value.taxSummaries) &&
    Array.isArray(value.dynamicFields);
}

const documentsSchema = z.array(z.custom<InvoiceDocument>(isInvoiceDocument)).min(1).max(100_000);
const reportSchema = z.object({ documents: documentsSchema, direction: directionSchema }).strict();
const profileSchema = z.object({
  documents: documentsSchema,
  profileId: z.string().trim().min(1).max(128).optional().default('amis-foundation-v1'),
}).strict();

function workbookHeaders(reply: FastifyReply, fileName: string): FastifyReply {
  return reply
    .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('Content-Disposition', `attachment; filename="${fileName}"`);
}

export function registerExportRoutes(app: FastifyInstance): void {
  app.post('/api/exports/report', async (request, reply) => {
    const parsed = reportSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('INVALID_EXPORT', parsed.error.issues[0]?.message || 'Dữ liệu export không hợp lệ.');
    }
    if (parsed.data.documents.some((document) => document.direction !== parsed.data.direction)) {
      throw new AppError('EXPORT_DIRECTION', 'Hướng chứng từ không nhất quán với yêu cầu export.');
    }
    const buffer = await exportReportWorkbook(parsed.data.documents, parsed.data.direction);
    app.log.info({ type: 'report', records: parsed.data.documents.length }, 'export_complete');
    return workbookHeaders(reply, `HDDT_Report_${parsed.data.direction}_${Date.now()}.xlsx`).send(buffer);
  });

  app.get('/api/exports/profiles', async () => ({ profiles: listProfiles() }));

  app.post('/api/exports/profile', async (request, reply) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('INVALID_EXPORT', parsed.error.issues[0]?.message || 'Dữ liệu export không hợp lệ.');
    }
    const profile = getProfile(parsed.data.profileId);
    const buffer = await exportWithProfile(parsed.data.documents, profile);
    app.log.info({ type: 'profile', profileId: profile.id, records: parsed.data.documents.length }, 'export_complete');
    return workbookHeaders(reply, `HDDT_${profile.id}_${Date.now()}.xlsx`).send(buffer);
  });
}
