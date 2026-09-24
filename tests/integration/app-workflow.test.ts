import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { TEST_MST } from '../helpers.js';

let root = '';
let app: FastifyInstance;
let csrf = '';
let cookie = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-app-'));
  const built = await buildApp({
    connectorMode: 'mock',
    logger: false,
    appDataDir: path.join(root, 'app'),
    defaultDataRoot: path.join(root, 'data'),
    exitHandler: () => undefined,
  });
  app = built.app;
  const status = await app.inject({ method: 'GET', url: '/api/app/status' });
  csrf = status.json().csrfToken;
  cookie = String(status.headers['set-cookie']).split(';', 1)[0];
});

afterEach(async () => {
  await app?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

function inject(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
  const options: InjectOptions = {
    method,
    url,
    headers: method === 'GET' ? { cookie } : { 'x-hddt-csrf': csrf, cookie },
  };
  if (payload !== undefined) options.payload = payload as any;
  return app.inject(options);
}

async function login() {
  const captchaResponse = await inject('GET', '/api/auth/captcha');
  expect(captchaResponse.statusCode).toBe(200);
  const captcha = captchaResponse.json();
  const response = await inject('POST', '/api/auth/login', {
    username: TEST_MST,
    password: 'only-in-request-memory',
    captcha: 'AB12',
    ckey: captcha.ckey,
    rememberUsername: true,
  });
  expect(response.statusCode).toBe(200);
  cookie = String(response.headers['set-cookie']).split(';', 1)[0];
  csrf = response.json().csrfToken;
  expect(response.json()).toMatchObject({ success: true, message: 'Đăng nhập demo thành công.' });
  expect(response.body).not.toMatch(/cookie|only-in-request-memory/i);
}

describe('local Fastify API security', () => {
  it('issues CSRF and security headers and rejects cross-origin/missing-CSRF requests', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/app/status' });
    expect(status.statusCode).toBe(200);
    expect(status.headers['x-content-type-options']).toBe('nosniff');
    expect(status.headers['x-frame-options']).toBe('DENY');
    expect(status.json()).toMatchObject({
      version: '1.3.0-rc.2',
      authenticated: false,
      connectorMode: 'mock',
      capabilities: { liveSales: true, offlineDataset: true },
    });
    expect(status.json().csrfToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const missing = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error).toBe('CSRF_INVALID');

    const rejectedBeforeJsonParsing = await app.inject({
      method: 'POST',
      url: '/api/datasets/import',
      headers: { cookie, 'content-type': 'application/json' },
      payload: '{',
    });
    expect(rejectedBeforeJsonParsing.statusCode).toBe(403);
    expect(rejectedBeforeJsonParsing.json().error).toBe('CSRF_INVALID');

    const evil = await app.inject({ method: 'GET', url: '/api/app/status', headers: { origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error).toBe('ORIGIN_REJECTED');
  });

  it('sanitizes malformed JSON errors instead of exposing stack traces', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-hddt-csrf': csrf, cookie, 'content-type': 'application/json' },
      payload: '{',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'BAD_REQUEST', message: 'Yêu cầu không hợp lệ.', retryable: false });
    expect(response.body).not.toMatch(/stack|node_modules|SyntaxError/i);
  });
});

describe('end-to-end API workflow with mock portal', () => {
  it('login -> paginate -> detail -> save/open -> Excel -> bulk XML/ZIP -> offline import', async () => {
    await login();

    const account = await inject('GET', '/api/accounts');
    expect(account.json()).toEqual({ accounts: [] });

    const pageOne = await inject('POST', '/api/invoices/query', {
      direction: 'purchase',
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      page: 1,
      pageSize: 2,
    });
    expect(pageOne.statusCode).toBe(200);
    expect(pageOne.json()).toMatchObject({ total: 3, page: 1, pageSize: 2, nextCursor: '2' });
    expect(pageOne.json().documents).toHaveLength(2);

    const pageTwo = await inject('POST', '/api/invoices/query', {
      direction: 'purchase',
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      page: 2,
      pageSize: 2,
      cursor: pageOne.json().nextCursor,
    });
    expect(pageTwo.json().documents).toHaveLength(1);
    expect(pageTwo.json().nextCursor).toBeUndefined();

    const sales = await inject('POST', '/api/invoices/query', {
      direction: 'sales', fromDate: '2026-07-01', toDate: '2026-07-31', page: 1, pageSize: 10,
    });
    expect(sales.statusCode).toBe(200);
    expect(sales.json().documents.every((item: any) => item.direction === 'sales')).toBe(true);

    const summaries = pageOne.json().documents;
    const details = await inject('POST', '/api/invoices/details', {
      direction: 'purchase',
      items: summaries.map((summary: any) => ({
        locator: {
          sellerTaxCode: summary.seller.taxCode,
          templateNo: summary.templateNo,
          series: summary.series,
          invoiceNo: summary.invoiceNo,
        },
        summary: summary.rawSummary,
      })),
    });
    expect(details.statusCode).toBe(200);
    expect(details.json().documents).toHaveLength(2);
    expect(details.json().documents.every((item: any) => item.lines.length === 1)).toBe(true);
    expect(details.json().documents[0].rawSummary).toBeTruthy();
    expect(details.json().documents[0].rawDetail).toBeTruthy();

    const documents = details.json().documents;
    const save = await inject('POST', '/api/datasets/save', {
      accountTaxCode: TEST_MST,
      direction: 'purchase',
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
      documents,
    });
    expect(save.statusCode).toBe(410);

    const dataset = {
      format: 'hddt-dataset', schemaVersion: 1, appVersion: '1.3.0-rc.2-public',
      meta: { accountTaxCode: TEST_MST, direction: 'purchase', fromDate: '2026-07-01', toDate: '2026-07-31', createdAt: new Date().toISOString(), source: 'hoadondientu.gdt.gov.vn', recordCount: documents.length, detailCount: documents.length, sourceCounts: { standard: documents.length, pos: 0 } },
      documents: documents.map((document: any) => ({ key: document.key, normalized: document, rawSummary: document.rawSummary, rawDetail: document.rawDetail })),
    };
    const opened = await inject('POST', '/api/datasets/import', { dataset });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().meta).toMatchObject({ recordCount: 2, detailCount: 2 });

    const report = await inject('POST', '/api/exports/report', { documents, direction: 'purchase' });
    expect(report.statusCode).toBe(200);
    expect(report.headers['content-type']).toContain('spreadsheetml');
    expect(report.rawPayload.subarray(0, 2).toString()).toBe('PK');

    const profile = await inject('POST', '/api/exports/profile', { documents, profileId: 'amis-foundation-v1' });
    expect(profile.statusCode).toBe(200);
    expect(profile.rawPayload.subarray(0, 2).toString()).toBe('PK');

    const direct = await inject('POST', '/api/downloads/file', {
      invoiceSource: documents[0].invoiceSource,
      locator: { sellerTaxCode: documents[0].seller.taxCode, templateNo: documents[0].templateNo, series: documents[0].series, invoiceNo: documents[0].invoiceNo },
      issueDate: documents[0].issueDate,
      type: 'xml',
    });
    expect(direct.statusCode).toBe(200);
    expect(direct.headers['content-type']).toContain('application/xml');
    expect(direct.headers['x-hddt-filename']).toBeTruthy();
    await expect(fs.readdir(path.join(root, 'data', TEST_MST))).rejects.toThrow();

    const logout = await inject('POST', '/api/auth/logout');
    expect(logout.statusCode).toBe(200);
    const forbiddenQuery = await inject('POST', '/api/invoices/query', {
      direction: 'purchase', fromDate: '2026-07-01', toDate: '2026-07-31', page: 1, pageSize: 10,
    });
    expect(forbiddenQuery.statusCode).toBe(403);

    const fresh = await app.inject({ method: 'GET', url: '/api/app/status' });
    cookie = String(fresh.headers['set-cookie']).split(';', 1)[0];
    csrf = fresh.json().csrfToken;
    const offlineImport = await inject('POST', '/api/datasets/import', { dataset: opened.json() });
    expect(offlineImport.statusCode).toBe(200);
    expect(offlineImport.json().documents).toHaveLength(2);
  }, 15_000);
});
