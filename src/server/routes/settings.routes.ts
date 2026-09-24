import type { FastifyInstance } from 'fastify';
import { AppError } from '../../shared/utils/index.js';

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/settings', async () => ({
    production: true,
    storage: { mode: 'browser' },
    connectorMode: app.settings.getConfig().app.connectorMode,
  }));

  app.put('/api/settings', async () => {
    throw new AppError('SETTINGS_LOCKED', 'Cấu hình máy chủ được quản trị bằng biến môi trường; giao diện public không được thay đổi.', 403);
  });

  app.post('/api/settings/open-data-root', async () => {
    throw new AppError('CLIENT_STORAGE_REQUIRED', 'Thư mục dữ liệu nằm trên máy người dùng và chỉ trình duyệt được quyền mở.', 410);
  });

  app.get('/api/accounts', async () => ({ accounts: [] }));
}
