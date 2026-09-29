import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

import type { ConnectorMode } from '../shared/models/index.js';
import { AppError, isRecord, publicErrorMessage } from '../shared/utils/index.js';
import type { GdtConnector } from './gdt/connector.js';
import { createConnector } from './gdt/connector.js';
import { DatasetService } from './services/dataset.service.js';
import { SessionRegistry, SESSION_COOKIE, INSECURE_SESSION_COOKIE, parseCookie, sessionCookie } from './services/session-registry.service.js';
import { SettingsService } from './services/settings.service.js';
import { TvanCatalogService } from './services/tvan-catalog.service.js';
import { TvanBackportService } from './tvan/backport.service.js';
import { closeSoftdreamsRenderer } from './tvan/adapters/softdreams/representation-renderer.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerAdminRoutes } from './routes/admin.routes.js';
import { registerDatasetRoutes } from './routes/dataset.routes.js';
import { registerDownloadRoutes } from './routes/download.routes.js';
import { registerExportRoutes } from './routes/export.routes.js';
import { registerInvoiceRoutes } from './routes/invoice.routes.js';
import { registerSettingsRoutes } from './routes/settings.routes.js';
import { registerTvanRoutes } from './routes/tvan.routes.js';
import { registerPresentationRoutes } from './routes/presentation.routes.js';

const currentDir = typeof __dirname === 'string'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
export const APP_VERSION = '1.3.1';

export type BuildAppOptions = {
  connectorMode?: ConnectorMode;
  connector?: GdtConnector;
  logger?: boolean;
  appDataDir?: string;
  defaultDataRoot?: string;
  exitHandler?: () => void;
};

function modeFromEnvironment(): ConnectorMode | undefined {
  const value = process.env.HDDT_CONNECTOR;
  if (!value) return undefined;
  if (value !== 'live' && value !== 'mock') {
    throw new AppError('INVALID_CONNECTOR_MODE', 'HDDT_CONNECTOR chỉ nhận live hoặc mock.', 500);
  }
  return value;
}

function allowedOriginsFromEnvironment(): Set<string> {
  const configured = process.env.HDDT_ALLOWED_ORIGINS || '';
  const origins = new Set<string>();
  for (const value of configured.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Invalid entries are ignored rather than weakening the Origin allow-list.
    }
  }
  return origins;
}

function trustedProxyCidrs(): string[] | false {
  const values = (process.env.HDDT_TRUST_PROXY_CIDRS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  return values.length ? values : false;
}

function requestOriginAllowed(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return true;
    return allowedOriginsFromEnvironment().has(url.origin);
  } catch {
    return false;
  }
}

export async function buildApp(options: BuildAppOptions = {}) {
  const settings = new SettingsService({
    appDataDir: options.appDataDir,
    defaultDataRoot: options.defaultDataRoot,
  });
  await settings.init();
  const config = settings.getConfig();
  const logFile = path.join(settings.getLogDir(), `${new Date().toISOString().slice(0, 10)}.log`);
  const logger = options.logger === false ? false : {
    level: 'info',
    file: logFile,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
        'password',
        'captcha',
        'token',
      ],
      censor: '[REDACTED]',
    },
  };
  const app = Fastify({
    logger,
    forceCloseConnections: true,
    bodyLimit: Math.min(config.storage.maxDatasetBytes + 1024 * 1024, 256 * 1024 * 1024),
    requestTimeout: 120_000,
    trustProxy: trustedProxyCidrs(),
  });
  const requestWindows = new Map<string, { startedAt: number; count: number }>();

  const connectorMode = options.connectorMode ?? modeFromEnvironment() ?? config.app.connectorMode;
  const liveOptions = {
    origin: config.gdt.origin,
    timeoutMs: config.network.requestTimeoutMs,
    maxResponseBytes: config.network.maxResponseBytes,
    maxDownloadBytes: config.network.maxDownloadBytes,
    captchaPath: config.gdt.captchaPath,
    loginPath: config.gdt.loginPath,
    purchasePath: config.gdt.purchasePath,
    salesPath: config.gdt.salesPath,
    posPurchasePath: config.gdt.posPurchasePath,
    posSalesPath: config.gdt.posSalesPath,
    detailPath: config.gdt.detailPath,
    posDetailPath: config.gdt.posDetailPath,
    exportPath: config.gdt.exportPath,
    posExportPath: config.gdt.posExportPath,
    exportMethod: config.gdt.exportMethod,
    posExportMethod: config.gdt.posExportMethod,
  };
  const factory: typeof createConnector = options.connector
    ? (() => options.connector as GdtConnector)
    : createConnector;
  const sessions = new SessionRegistry({
    mode: connectorMode,
    settings,
    liveOptions,
    connectorFactory: factory,
    idleTimeoutMs: Number(process.env.HDDT_SESSION_IDLE_MS || 30 * 60_000),
    absoluteTimeoutMs: Number(process.env.HDDT_SESSION_ABSOLUTE_MS || 8 * 60 * 60_000),
    maxSessions: Number(process.env.HDDT_MAX_SESSIONS || 500),
  });
  const dataset = new DatasetService(settings);
  const tvanBackport = new TvanBackportService(settings);
  const tvanCatalog = new TvanCatalogService(settings);

  app.decorate('settings', settings);
  app.decorate('sessions', sessions);
  app.decorate('dataset', dataset);
  app.decorate('tvanBackport', tvanBackport);
  app.decorate('tvanCatalog', tvanCatalog);

  app.addHook('onRequest', async (request, reply) => {
    const now = Date.now();
    const key = request.ip;
    let window = requestWindows.get(key);
    if (!window || now - window.startedAt >= 60_000) {
      window = { startedAt: now, count: 0 };
      requestWindows.set(key, window);
    }
    window.count += 1;
    if (window.count > Number(process.env.HDDT_RATE_LIMIT_PER_MINUTE || 300)) {
      reply.header('Retry-After', '60');
      throw new AppError('RATE_LIMITED', 'Quá nhiều yêu cầu; vui lòng thử lại sau.', 429, true);
    }
    if (requestWindows.size > 10_000) {
      for (const [ip, item] of requestWindows) if (now - item.startedAt >= 60_000) requestWindows.delete(ip);
    }
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'no-referrer')
      .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
      .header('Cache-Control', request.url.startsWith('/api/') ? 'no-store' : 'no-cache');
    if (request.url === '/api/health') return;
    const secureCookie = process.env.NODE_ENV === 'production' && process.env.HDDT_INSECURE_HTTP !== '1';
    const cookieName = secureCookie ? SESSION_COOKIE : INSECURE_SESSION_COOKIE;
    let context = sessions.resolve(parseCookie(request.headers.cookie, cookieName));
    if (!context) {
      context = sessions.create({ ip: request.ip, userAgent: request.headers['user-agent'] });
      reply.header('Set-Cookie', sessionCookie(context.id, 8 * 60 * 60, secureCookie));
    }
    request.sessionContext = context;
    if (process.env.NODE_ENV === 'production') {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self' blob:; frame-ancestors 'none'"
      );
    }
    // Reject forbidden API mutations before Fastify parses potentially large JSON bodies.
    // This prevents stale CSRF/session requests from allocating the full dataset payload in memory.
    if (request.url.startsWith('/api/')) {
      const origin = request.headers.origin;
      if (origin && !requestOriginAllowed(origin)) {
        throw new AppError(
          'ORIGIN_REJECTED',
          'Từ chối Origin chưa được cho phép. Cấu hình HDDT_ALLOWED_ORIGINS khi chạy Docker/LAN.',
          403,
        );
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const supplied = String(request.headers['x-hddt-csrf'] || '');
        const expected = request.sessionContext.csrfToken;
        const valid = supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
        if (!valid) {
          throw new AppError('CSRF_INVALID', 'Thiếu hoặc sai mã bảo vệ phiên cục bộ.', 403);
        }
      }
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const frameworkStatus = isRecord(error) && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
    const statusCode = error instanceof AppError
      ? error.statusCode
      : frameworkStatus >= 400 && frameworkStatus < 500 ? frameworkStatus : 500;
    if (statusCode >= 500) request.log.error({ err: error }, 'request_failed');
    else request.log.warn({ code: error instanceof AppError ? error.code : 'BAD_REQUEST' }, 'request_rejected');
    reply.status(statusCode).send({
      error: error instanceof AppError ? error.code : statusCode < 500 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      message: error instanceof AppError
        ? publicErrorMessage(error)
        : statusCode < 500 ? 'Yêu cầu không hợp lệ.' : publicErrorMessage(error),
      retryable: error instanceof AppError ? error.retryable : false,
      ...(error instanceof AppError ? error.publicDetails : undefined),
    });
  });

  app.get('/api/health', async () => ({ ok: true, version: APP_VERSION }));

  app.get('/api/app/status', async (request) => ({
    version: APP_VERSION,
    authenticated: request.sessionContext.session.isAuthenticated(),
    session: request.sessionContext.session.getSessionInfo(),
    connectorMode: request.sessionContext.session.getMode(),
    csrfToken: request.sessionContext.csrfToken,
    capabilities: {
      livePurchase: true,
      livePurchaseStandard: true,
      livePurchasePos: connectorMode === 'mock' || !!config.gdt.posPurchasePath,
      liveSales: connectorMode === 'mock' || !!config.gdt.salesPath,
      liveSalesPos: connectorMode === 'mock' || !!config.gdt.posSalesPath,
      detail: true,
      detailStandard: true,
      detailPos: connectorMode === 'mock' || !!config.gdt.posDetailPath,
      xml: true,
      zip: true,
      exportStandard: true,
      exportPos: connectorMode === 'mock' || !!config.gdt.posExportPath,
      offlineDataset: true,
    },
    config: {
      storageMode: 'browser' as const,
    },
  }));

  app.post<{ Body: { force?: boolean } }>('/api/app/exit', async (request, reply) => {
    if (process.env.HDDT_DOCKER === '1') {
      throw new AppError(
        'DOCKER_MANAGED_LIFECYCLE',
        'Bản Docker được quản lý bằng Portainer. Hãy Stop/Restart Stack hoặc container trong Portainer.',
        409,
      );
    }
    if (false && request.body?.force !== true) {
      throw new AppError('TASKS_ACTIVE', 'Đang có tác vụ tải file. Xác nhận force để thoát.', 409);
    }
    await sessions.destroy(request.sessionContext.id, 'session.logout');
    reply.send({ ok: true });
    const exit = options.exitHandler ?? (() => process.exit(0));
    setTimeout(exit, 100).unref();
  });

  registerAuthRoutes(app);
  registerAdminRoutes(app);
  registerInvoiceRoutes(app);
  registerDatasetRoutes(app);
  registerDownloadRoutes(app);
  registerExportRoutes(app);
  registerSettingsRoutes(app);
  registerTvanRoutes(app);
  registerPresentationRoutes(app);

  const candidates = [
    path.join(path.dirname(process.execPath), 'public'),
    path.resolve(currentDir, '../public'),
    path.resolve(process.cwd(), 'dist/public'),
  ];
  const staticRoot = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html')));
  if (staticRoot) {
    await app.register(fastifyStatic, { root: staticRoot, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.status(404).send({ error: 'NOT_FOUND' });
      return reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    tvanCatalog.close();
    await sessions.close();
    await closeSoftdreamsRenderer();
  });
  return { app, settings, sessions };
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionContext: import('./services/session-registry.service.js').SessionContext;
  }
  interface FastifyInstance {
    settings: SettingsService;
    sessions: SessionRegistry;
    dataset: DatasetService;
    tvanBackport: TvanBackportService;
    tvanCatalog: TvanCatalogService;
  }
}
