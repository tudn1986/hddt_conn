import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';

let root = '';
let app: FastifyInstance;
const adminToken = 'test-admin-token-that-is-longer-than-thirty-two-characters';
const previousAdminToken = process.env.HDDT_ADMIN_TOKEN;

beforeEach(async () => {
  process.env.HDDT_ADMIN_TOKEN = adminToken;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-admin-'));
  const built = await buildApp({
    connectorMode: 'mock',
    logger: false,
    appDataDir: path.join(root, 'app'),
    defaultDataRoot: path.join(root, 'data'),
    exitHandler: () => undefined,
  });
  app = built.app;
});

afterEach(async () => {
  await app?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
  if (previousAdminToken === undefined) delete process.env.HDDT_ADMIN_TOKEN;
  else process.env.HDDT_ADMIN_TOKEN = previousAdminToken;
});

describe('admin WebUI backing API', () => {
  it('requires the admin token, reports the current admin browser session and revokes another session with CSRF', async () => {
    const adminStatus = await app.inject({ method: 'GET', url: '/api/app/status' });
    const adminCookie = String(adminStatus.headers['set-cookie']).split(';', 1)[0];
    const csrf = adminStatus.json().csrfToken as string;

    await app.inject({ method: 'GET', url: '/api/app/status' });

    const denied = await app.inject({ method: 'GET', url: '/api/admin/sessions', headers: { cookie: adminCookie } });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error).toBe('ADMIN_UNAUTHORIZED');

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/sessions',
      headers: { cookie: adminCookie, authorization: `Bearer ${adminToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().sessions).toHaveLength(2);
    expect(list.json().currentAdminSessionId).toBeTruthy();

    const target = list.json().sessions.find((item: any) => item.id !== list.json().currentAdminSessionId);
    expect(target).toBeTruthy();

    const missingCsrf = await app.inject({
      method: 'DELETE',
      url: `/api/admin/sessions/${target.id}`,
      headers: { cookie: adminCookie, authorization: `Bearer ${adminToken}` },
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json().error).toBe('CSRF_INVALID');

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/admin/sessions/${target.id}`,
      headers: {
        cookie: adminCookie,
        authorization: `Bearer ${adminToken}`,
        'x-hddt-csrf': csrf,
      },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ ok: true });
  });

  it('keeps TVAN Backport under admin token + CSRF and removes the public endpoint', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/app/status' });
    const cookie = String(status.headers['set-cookie']).split(';', 1)[0];
    const csrf = status.json().csrfToken as string;
    const payload = { providerCode: 'tvan_test', rawJson: JSON.stringify({ password: 'secret-value', endpoint: 'https://example.invalid/debug?token=secret' }) };

    const publicRoute = await app.inject({ method: 'POST', url: '/api/tvan/backport/analyze', headers: { cookie, 'x-hddt-csrf': csrf }, payload });
    expect(publicRoute.statusCode).toBe(404);

    const noToken = await app.inject({ method: 'GET', url: '/api/admin/tvan-backport/samples', headers: { cookie } });
    expect(noToken.statusCode).toBe(401);

    const wrongToken = await app.inject({ method: 'GET', url: '/api/admin/tvan-backport/samples', headers: { cookie, authorization: 'Bearer wrong-token-that-is-longer-than-thirty-two-characters' } });
    expect(wrongToken.statusCode).toBe(401);

    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/admin/tvan-backport/analyze',
      headers: { cookie, authorization: `Bearer ${adminToken}` },
      payload,
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(missingCsrf.json().error).toBe('CSRF_INVALID');

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/admin/tvan-backport/analyze',
      headers: { cookie, authorization: `Bearer ${adminToken}`, 'x-hddt-csrf': csrf },
      payload,
    });
    expect(allowed.statusCode).toBe(200);
    expect(JSON.stringify(allowed.json())).not.toContain('secret-value');
  });

  it('keeps the established public TVAN flow routes while rejecting invalid artifact ids safely', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/app/status' });
    const cookie = String(status.headers['set-cookie']).split(';', 1)[0];
    const csrf = status.json().csrfToken as string;

    for (const url of ['/api/tvan/supervised/prepare', '/api/tvan/supervised/download-plan', '/api/tvan/presentation-link/resolve']) {
      const response = await app.inject({ method: 'POST', url, headers: { cookie, 'x-hddt-csrf': csrf }, payload: {} });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('INVALID_TVAN_REQUEST');
    }

    const missing = await app.inject({ method: 'GET', url: '/api/tvan/artifacts/00000000-0000-4000-8000-000000000000/pdf', headers: { cookie } });
    expect(missing.statusCode).toBe(404);
    expect(JSON.stringify(missing.json())).not.toContain('/opt/');

    const traversal = await app.inject({ method: 'GET', url: '/api/tvan/artifacts/..%2F..%2Fetc%2Fpasswd/pdf', headers: { cookie } });
    expect(traversal.statusCode).toBe(404);
    expect(JSON.stringify(traversal.body)).not.toContain('/etc/passwd');
  });
});
