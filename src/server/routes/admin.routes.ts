import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../shared/utils/index.js';

function safeEqual(left: string, right: string): boolean {
  const a = crypto.createHash('sha256').update(left).digest();
  const b = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireAdmin(request: FastifyRequest): void {
  const configured = process.env.HDDT_ADMIN_TOKEN || '';
  if (configured.length < 32) throw new AppError('ADMIN_DISABLED', 'Quản trị phiên chưa được bật.', 404);
  const header = String(request.headers.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!supplied || !safeEqual(supplied, configured)) throw new AppError('ADMIN_UNAUTHORIZED', 'Không có quyền quản trị.', 401);
}

const tvanListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  providerCode: z.string().trim().max(100).optional(),
  providerTaxCode: z.string().trim().max(32).optional(),
  supported: z.enum(['true', 'false']).optional(),
  source: z.enum(['dataset_import', 'gdt_query', 'gdt_query_auto']).optional(),
  host: z.string().trim().max(255).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  sort: z.enum(['lastSeenAt', 'firstSeenAt', 'seenDocuments', 'displayName']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
}).strict();

const backportBodySchema = z.object({
  providerCode: z.string().trim().min(2).max(80),
  rawJson: z.string().max(20_971_520).optional(),
  rawXml: z.string().max(20_971_520).optional(),
  notes: z.string().max(2_000).optional(),
}).strict();

export function registerAdminRoutes(app: FastifyInstance): void {
  app.get('/api/admin/sessions', async (request) => {
    requireAdmin(request);
    return { sessions: app.sessions.list(), currentAdminSessionId: request.sessionContext.adminId };
  });

  app.get('/api/admin/audit', async (request) => {
    requireAdmin(request);
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(1_000).optional() }).safeParse(request.query);
    if (!parsed.success) throw new AppError('INVALID_ADMIN_QUERY', 'Tham số audit không hợp lệ.');
    return { events: app.sessions.getAudit(parsed.data.limit) };
  });

  app.get('/api/admin/tvan-catalog/stats', async (request) => {
    requireAdmin(request);
    return app.tvanCatalog.getStats();
  });

  app.get('/api/admin/tvan-catalog', async (request) => {
    requireAdmin(request);
    const parsed = tvanListQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new AppError('INVALID_ADMIN_QUERY', parsed.error.issues[0]?.message || 'Tham số TVAN Catalog không hợp lệ.');
    return app.tvanCatalog.listProviders({
      ...parsed.data,
      supported: parsed.data.supported === undefined ? undefined : parsed.data.supported === 'true',
    });
  });

  app.get<{ Params: { id: string } }>('/api/admin/tvan-catalog/:id', async (request) => {
    requireAdmin(request);
    const parsed = z.coerce.number().int().positive().safeParse(request.params.id);
    if (!parsed.success) throw new AppError('INVALID_ADMIN_QUERY', 'ID TVAN không hợp lệ.');
    const provider = app.tvanCatalog.getProvider(parsed.data);
    if (!provider) throw new AppError('TVAN_CATALOG_NOT_FOUND', 'Không tìm thấy TVAN trong catalog.', 404);
    return provider;
  });

  app.post('/api/admin/tvan-backport/analyze', async (request) => {
    requireAdmin(request);
    const parsed = backportBodySchema.safeParse(request.body);
    if (!parsed.success) throw new AppError('INVALID_ADMIN_BODY', parsed.error.issues[0]?.message || 'Payload Backport không hợp lệ.');
    return { analysis: app.tvanBackport.analyze(parsed.data) };
  });

  app.post('/api/admin/tvan-backport/samples', async (request) => {
    requireAdmin(request);
    const parsed = backportBodySchema.safeParse(request.body);
    if (!parsed.success) throw new AppError('INVALID_ADMIN_BODY', parsed.error.issues[0]?.message || 'Payload Backport không hợp lệ.');
    return { sample: await app.tvanBackport.save(parsed.data) };
  });

  app.get('/api/admin/tvan-backport/samples', async (request) => {
    requireAdmin(request);
    return { samples: await app.tvanBackport.list() };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/sessions/:id', async (request) => {
    requireAdmin(request);
    if (request.params.id === request.sessionContext.adminId) throw new AppError('ADMIN_SELF_REVOKE', 'Không thu hồi phiên đang dùng để quản trị.', 409);
    const revoked = await app.sessions.destroyByAdminId(request.params.id, 'admin.revoked');
    if (!revoked) throw new AppError('SESSION_NOT_FOUND', 'Không tìm thấy phiên.', 404);
    return { ok: true };
  });
}
