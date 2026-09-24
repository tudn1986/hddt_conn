import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { document } from '../helpers.js';

function sessionIdFromCookie(cookie: string): string {
  const separator = cookie.indexOf('=');
  return decodeURIComponent(cookie.slice(separator + 1));
}

async function browser(app: FastifyInstance) {
  const response = await app.inject({ method: 'GET', url: '/api/app/status' });
  const cookie = String(response.headers['set-cookie']).split(';', 1)[0];
  return { cookie, sessionId: sessionIdFromCookie(cookie), csrfToken: response.json().csrfToken as string };
}

describe('TVAN artifact public API', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => app?.close());

  it('streams session-scoped original/PDF artifacts with safe download headers', async () => {
    const built = await buildApp({ connectorMode: 'mock', logger: false });
    app = built.app;
    const owner = await browser(app);
    const other = await browser(app);
    const context = app.sessions.resolve(owner.sessionId);
    expect(context).toBeTruthy();
    const id = '11111111-1111-4111-8111-111111111111';
    const original = Buffer.from('PK\x03\x04zip');
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    (context!.tvanPdf as any).artifacts.set(id, {
      id,
      providerCode: 'artifact_test',
      original,
      originalFileName: 'source.zip',
      originalContentType: 'application/zip',
      pdf,
      pdfFileName: 'invoice.pdf',
      expiresAt: Date.now() + 60_000,
    });

    const file = await app.inject({
      method: 'GET',
      url: `/api/tvan/artifacts/${id}/file`,
      headers: { cookie: owner.cookie },
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('application/zip');
    expect(String(file.headers['content-disposition'])).toContain('source.zip');
    expect(String(file.headers['content-disposition'])).not.toContain('/opt/');

    const rendered = await app.inject({
      method: 'GET',
      url: `/api/tvan/artifacts/${id}/pdf`,
      headers: { cookie: owner.cookie },
    });
    expect(rendered.statusCode).toBe(200);
    expect(rendered.headers['content-type']).toContain('application/pdf');
    expect(String(rendered.headers['content-disposition'])).toContain('inline');
    expect(String(rendered.headers['content-disposition'])).toContain('invoice.pdf');

    const crossSession = await app.inject({
      method: 'GET',
      url: `/api/tvan/artifacts/${id}/pdf`,
      headers: { cookie: other.cookie },
    });
    expect(crossSession.statusCode).toBe(404);
  });

  it('streams the direct original-file route with CSRF and safe attachment headers', async () => {
    const built = await buildApp({ connectorMode: 'mock', logger: false });
    app = built.app;
    const owner = await browser(app);
    const context = app.sessions.resolve(owner.sessionId);
    expect(context).toBeTruthy();

    (context!.tvanPdf as any).downloadOriginal = async () => ({
      content: Buffer.from('PK\\x03\\x04original'),
      fileName: 'provider-original.zip',
      contentType: 'application/zip',
    });
    const payload = { document: document({ key: 'original-file', providerCode: 'tvan_softdreams' }) };

    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/tvan/file/download',
      headers: { cookie: owner.cookie },
      payload,
    });
    expect(missingCsrf.statusCode).toBe(403);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tvan/file/download',
      headers: { cookie: owner.cookie, 'x-hddt-csrf': owner.csrfToken },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(String(response.headers['content-disposition'])).toContain('provider-original.zip');
    expect(String(response.headers['content-disposition'])).not.toContain('/opt/');
  });
});
