import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';

let root = '';
let app: FastifyInstance;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-static-session-'));
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
  await app.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe('session creation scope', () => {
  it('does not create a server session for non-API requests', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/does-not-exist.js' });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('still creates a session for the first API request', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/app/status' });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toContain('hddt_session=');
    expect(response.json().csrfToken).toBeTruthy();
  });

  it('keeps /api/health session-free', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
