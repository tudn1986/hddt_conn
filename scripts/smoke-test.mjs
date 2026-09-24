import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../dist/server/app.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-smoke-'));
let app;
try {
  const built = await buildApp({ connectorMode: 'mock', logger: false, appDataDir: path.join(root, 'app'), defaultDataRoot: path.join(root, 'data'), exitHandler: () => undefined });
  app = built.app;
  const origin = await app.listen({ port: 0, host: '127.0.0.1' });
  let cookie = '';
  let csrf = '';
  const captureCookie = (response) => {
    const next = response.headers.get('set-cookie');
    if (next) cookie = next.split(';', 1)[0];
  };
  const get = async (route) => {
    const response = await fetch(`${origin}${route}`, { headers: cookie ? { Cookie: cookie } : undefined });
    captureCookie(response);
    if (!response.ok) throw new Error(`${route} HTTP ${response.status}: ${await response.text()}`);
    return response;
  };
  const post = async (route, body) => {
    const response = await fetch(`${origin}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HDDT-CSRF': csrf, Cookie: cookie }, body: JSON.stringify(body || {}) });
    captureCookie(response);
    if (!response.ok) throw new Error(`${route} HTTP ${response.status}: ${await response.text()}`);
    return response;
  };

  const status = await (await get('/api/app/status')).json();
  if (status.version !== '1.3.0-rc.2' || !status.csrfToken || status.config.storageMode !== 'browser') throw new Error('invalid public status payload');
  csrf = status.csrfToken;
  const captcha = await (await get('/api/auth/captcha')).json();
  const login = await (await post('/api/auth/login', { username: '0101234567', password: 'smoke-memory-only', captcha: 'AB12', ckey: captcha.ckey })).json();
  if (!login.success || !login.csrfToken || 'token' in login) throw new Error('unsafe/failed login response');
  csrf = login.csrfToken;
  const queried = await (await post('/api/invoices/query', { direction: 'purchase', fromDate: '2026-09-01', toDate: '2026-09-09', page: 1, pageSize: 2 })).json();
  if (queried.documents.length !== 2) throw new Error('query count mismatch');
  const detailed = await (await post('/api/invoices/details', { direction: 'purchase', items: queried.documents.map((document) => ({ locator: { sellerTaxCode: document.seller.taxCode, templateNo: document.templateNo, series: document.series, invoiceNo: document.invoiceNo }, summary: document.rawSummary })) })).json();
  if (!detailed.documents.every((document) => document.lines.length === 1)) throw new Error('detail missing lines');
  const excel = Buffer.from(await (await post('/api/exports/report', { documents: detailed.documents, direction: 'purchase' })).arrayBuffer());
  if (excel.subarray(0, 2).toString() !== 'PK') throw new Error('invalid Excel');
  const first = detailed.documents[0];
  const xml = await post('/api/downloads/file', { invoiceSource: first.invoiceSource, locator: { sellerTaxCode: first.seller.taxCode, templateNo: first.templateNo, series: first.series, invoiceNo: first.invoiceNo }, issueDate: first.issueDate, type: 'xml' });
  if (!String(xml.headers.get('content-type')).includes('application/xml')) throw new Error('invalid streamed XML');
  const businessFiles = await fs.readdir(path.join(root, 'data'), { recursive: true }).catch(() => []);
  if (businessFiles.length) throw new Error('server persisted business data');
  console.log(JSON.stringify({ ok: true, version: status.version, invoices: detailed.documents.length, streamedDownloads: 1, serverBusinessFiles: 0 }));
} finally {
  await app?.close().catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });
}
