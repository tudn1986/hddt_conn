import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../shared/utils/index.js';

export function registerDatasetRoutes(app: FastifyInstance): void {
  app.post('/api/datasets/import', async (request) => {
    const parsed = z.object({ dataset: z.unknown() }).strict().safeParse(request.body);
    if (!parsed.success) throw new AppError('INVALID_DATASET', 'Thiếu dữ liệu dataset.');
    // Validation remains transient. Only aggregated TVAN metadata is persisted by the catalog.
    const imported = app.dataset.import(parsed.data.dataset);
    try {
      app.tvanCatalog.observeDocuments(imported.documents.map((item) => item.normalized), 'dataset_import');
    } catch (error) {
      request.log.error({ err: error, source: 'dataset_import', documents: imported.documents.length }, 'tvan_catalog_observe_failed');
    }
    return imported;
  });

  app.post('/api/datasets/save', async () => {
    throw new AppError('CLIENT_STORAGE_REQUIRED', 'Bản public chỉ lưu dataset tại máy người dùng.', 410);
  });
  app.post('/api/datasets/open', async () => {
    throw new AppError('CLIENT_STORAGE_REQUIRED', 'Hãy mở file JSON trực tiếp từ trình duyệt.', 410);
  });
  app.get('/api/datasets', async () => {
    throw new AppError('CLIENT_STORAGE_REQUIRED', 'Máy chủ không có danh sách dataset của người dùng.', 410);
  });
}
