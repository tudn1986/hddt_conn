import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { invoiceSourceSchema, locatorSchema } from '../../shared/schemas/index.js';
import { AppError, sha256Buffer } from '../../shared/utils/index.js';
import { SessionExpiredError } from '../gdt/connector.js';
import { buildInvoiceFilename } from '../../shared/filenames/index.js';
import { isZip, validateInvoiceXml } from '../gdt/zip.js';

const requestSchema = z.object({
  invoiceSource: invoiceSourceSchema.default('standard'),
  locator: locatorSchema,
  issueDate: z.string().min(1).max(64),
  type: z.enum(['xml', 'zip']),
}).strict();

export function registerDownloadRoutes(app: FastifyInstance): void {
  app.post('/api/downloads/file', async (request, reply) => {
    const session = request.sessionContext.session;
    if (!session.isAuthenticated()) throw new SessionExpiredError();
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('INVALID_DOWNLOAD_REQUEST', parsed.error.issues[0]?.message || 'Yêu cầu tải không hợp lệ.');
    }
    const { invoiceSource, locator, issueDate, type } = parsed.data;
    const connector = session.getConnector();
    const file = type === 'xml'
      ? await connector.downloadXml(invoiceSource, locator)
      : await connector.downloadZip(invoiceSource, locator);
    if (!file.content.length || file.content.length !== file.size) {
      throw new AppError('DOWNLOAD_INVALID', 'File tải về rỗng hoặc sai kích thước.', 502, true);
    }
    if (type === 'xml') validateInvoiceXml(file.content);
    if (type === 'zip' && !isZip(file.content)) throw new AppError('ZIP_INVALID', 'File tải về không phải ZIP hợp lệ.', 502, true);
    const fileName = buildInvoiceFilename(locator, issueDate, type, invoiceSource);
    app.sessions.audit('business.download_streamed', request.sessionContext, {
      type,
      size: file.content.length,
      sha256Prefix: sha256Buffer(file.content).slice(0, 12),
    });
    return reply
      .header('Content-Type', type === 'xml' ? 'application/xml; charset=utf-8' : 'application/zip')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .header('Content-Length', String(file.content.length))
      .header('X-HDDT-Filename', encodeURIComponent(fileName))
      .send(file.content);
  });

  app.get('/api/downloads/status', async () => ({ running: false, paused: false, tasks: [] }));

  for (const path of ['/api/downloads/queue', '/api/downloads/start', '/api/downloads/pause', '/api/downloads/resume', '/api/downloads/retry', '/api/downloads/clear-completed', '/api/downloads/open-folder']) {
    app.post(path, async () => {
      throw new AppError('CLIENT_STORAGE_REQUIRED', 'Bản public tải từng file về trình duyệt; máy chủ không giữ hàng đợi hoặc thư mục dữ liệu.', 410);
    });
  }
}
