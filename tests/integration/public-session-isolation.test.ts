import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';

type BrowserState = { cookie: string; csrf: string };

function cookieFrom(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.split(';', 1)[0];
}

async function bootstrap(app: FastifyInstance): Promise<BrowserState> {
  const response = await app.inject({ method: 'GET', url: '/api/app/status' });
  expect(response.statusCode).toBe(200);
  return {
    cookie: cookieFrom(response.headers['set-cookie'])!,
    csrf: response.json().csrfToken,
  };
}

async function captcha(app: FastifyInstance, browser: BrowserState) {
  const response = await app.inject({ method: 'GET', url: '/api/auth/captcha', headers: { cookie: browser.cookie } });
  expect(response.statusCode).toBe(200);
  return response.json() as { ckey: string };
}

async function login(app: FastifyInstance, browser: BrowserState, username: string) {
  const challenge = await captcha(app, browser);
  const response = await app.inject({
    method: 'POST', url: '/api/auth/login',
    headers: { cookie: browser.cookie, 'x-hddt-csrf': browser.csrf },
    payload: { username, password: 'safe-test-password', captcha: 'AB12', ckey: challenge.ckey },
  });
  expect(response.statusCode).toBe(200);
  browser.cookie = cookieFrom(response.headers['set-cookie'])!;
  browser.csrf = response.json().csrfToken;
}

describe('public browser session isolation', () => {
  let app: FastifyInstance | undefined;
  let root = '';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-public-session-'));
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  const buildIsolatedApp = () => buildApp({
    connectorMode: 'mock',
    logger: false,
    appDataDir: path.join(root, 'app'),
    defaultDataRoot: path.join(root, 'data'),
  });

  it('isolates cookies, CSRF and logout between two browsers', async () => {
    const built = await buildIsolatedApp();
    app = built.app;
    const a = await bootstrap(app);
    const b = await bootstrap(app);
    expect(a.cookie).not.toBe(b.cookie);
    expect(a.csrf).not.toBe(b.csrf);

    const crossover = await app.inject({
      method: 'PUT', url: '/api/settings',
      headers: { cookie: b.cookie, 'x-hddt-csrf': a.csrf }, payload: {},
    });
    expect(crossover.statusCode).toBe(403);
    expect(crossover.json().error).toBe('CSRF_INVALID');

    await login(app, a, '0101234567');
    await login(app, b, '0107654321');
    const bBefore = await app.inject({ method: 'GET', url: '/api/app/status', headers: { cookie: b.cookie } });
    expect(bBefore.json().authenticated).toBe(true);

    const logoutA = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: a.cookie, 'x-hddt-csrf': a.csrf } });
    expect(logoutA.statusCode).toBe(200);
    const bAfter = await app.inject({ method: 'GET', url: '/api/app/status', headers: { cookie: b.cookie } });
    expect(bAfter.json().authenticated).toBe(true);
    expect(bAfter.json().session.username).toBe('0107654321');
  });

  it('sets hardened cookie attributes in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const built = await buildIsolatedApp();
      app = built.app;
      const response = await app.inject({ method: 'GET', url: '/api/app/status' });
      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toContain('__Host-hddt_session=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
