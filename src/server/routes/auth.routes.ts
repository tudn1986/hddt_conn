import type { FastifyInstance } from 'fastify';
import { loginSchema } from '../../shared/schemas/index.js';
import { AppError } from '../../shared/utils/index.js';
import { clearSessionCookie, sessionCookie } from '../services/session-registry.service.js';

const WINDOW_MS = 60_000;
const MAX_FAILURES = 10;

function secureCookie(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.HDDT_INSECURE_HTTP !== '1';
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/session', async (request) => request.sessionContext.session.startSession());
  app.get('/api/auth/captcha', async (request) => request.sessionContext.session.startSession());

  app.post('/api/auth/login', async (request, reply) => {
    const context = request.sessionContext;
    const now = Date.now();
    context.loginFailures = context.loginFailures.filter((failure) => failure >= now - WINDOW_MS);
    if (context.loginFailures.length >= MAX_FAILURES) {
      throw new AppError('LOGIN_RATE_LIMIT', 'Quá nhiều lần đăng nhập lỗi; thử lại sau một phút.', 429, true);
    }
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('INVALID_LOGIN_INPUT', parsed.error.issues[0]?.message || 'Thông tin đăng nhập không hợp lệ.');
    }
    const { rememberUsername: _rememberUsername, ...credentials } = parsed.data;
    const result = await context.session.login(credentials);
    if (!result.success) {
      context.loginFailures.push(now);
      app.sessions.audit('auth.login_failed', context);
      return reply.status(401).send(result);
    }
    context.loginFailures = [];
    await app.sessions.rotate(context);
    app.sessions.audit('auth.login_succeeded', context);
    reply.header('Set-Cookie', sessionCookie(context.id, 8 * 60 * 60, secureCookie()));
    return { success: true, message: result.message, csrfToken: context.csrfToken };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await app.sessions.destroy(request.sessionContext.id, 'auth.logout');
    reply.header('Set-Cookie', clearSessionCookie(secureCookie()));
    return { ok: true };
  });

  app.post('/api/auth/heartbeat', async (request) => ({
    ok: true,
    expiresAt: new Date(Math.min(
      request.sessionContext.absoluteExpiresAt,
      request.sessionContext.lastSeenAt + Number(process.env.HDDT_SESSION_IDLE_MS || 30 * 60_000),
    )).toISOString(),
  }));
}
