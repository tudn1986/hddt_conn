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

  it('exposes provider-generic SoftDream artifact status/prepare/download routes with CSRF', async () => {
    const built = await buildApp({ connectorMode: 'mock', logger: false });
    app = built.app;
    const owner = await browser(app);
    const context = app.sessions.resolve(owner.sessionId);
    expect(context).toBeTruthy();

    const doc = document({ key: 'softdream-api', providerCode: 'tvan_softdreams' });
    const payload = { document: doc };
    (context!.tvanPdf as any).artifactStatus = () => ({
      providerCode: 'tvan_softdreams',
      stage: 'search_verified',
      ready: false,
      canRetryPrepare: true,
      canView: false,
      canDownloadPdf: false,
      canDownloadOriginal: false,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    (context!.tvanPdf as any).prepareArtifact = async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      providerCode: 'tvan_softdreams',
      originalFileName: 'source.zip',
      originalContentType: 'application/zip',
      pdfFileName: 'invoice.pdf',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    (context!.tvanPdf as any).viewPdf = async () => ({
      content: Buffer.from('%PDF-1.7\n%%EOF\n'),
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
    });
    (context!.tvanPdf as any).downloadOriginal = async () => ({
      content: Buffer.from('PK\\x03\\x04source'),
      fileName: 'source.zip',
      contentType: 'application/zip',
    });

    for (const url of [
      '/api/tvan/pdf/status',
      '/api/tvan/pdf/prepare-artifact',
      '/api/tvan/pdf/download',
      '/api/tvan/artifact/download-original',
    ]) {
      const denied = await app.inject({
        method: 'POST',
        url,
        headers: { cookie: owner.cookie },
        payload,
      });
      expect(denied.statusCode).toBe(403);
    }

    const headers = { cookie: owner.cookie, 'x-hddt-csrf': owner.csrfToken };
    const status = await app.inject({ method: 'POST', url: '/api/tvan/pdf/status', headers, payload });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ stage: 'search_verified', canRetryPrepare: true });

    const prepared = await app.inject({ method: 'POST', url: '/api/tvan/pdf/prepare-artifact', headers, payload });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json()).toMatchObject({ providerCode: 'tvan_softdreams', originalContentType: 'application/zip' });

    const pdf = await app.inject({ method: 'POST', url: '/api/tvan/pdf/download', headers, payload });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(String(pdf.headers['content-disposition'])).toContain('attachment');
    expect(String(pdf.headers['content-disposition'])).toContain('invoice.pdf');

    const original = await app.inject({ method: 'POST', url: '/api/tvan/artifact/download-original', headers, payload });
    expect(original.statusCode).toBe(200);
    expect(original.headers['content-type']).toContain('application/zip');
    expect(String(original.headers['content-disposition'])).toContain('source.zip');
  });

  it('returns safe manual-retry metadata for a preserved SoftDream prepare timeout', async () => {
    const built = await buildApp({ connectorMode: 'mock', logger: false });
    app = built.app;
    const owner = await browser(app);
    const context = app.sessions.resolve(owner.sessionId);
    expect(context).toBeTruthy();

    const { AppError } = await import('../../src/shared/utils/index.js');
    (context!.tvanPdf as any).prepareArtifact = async () => {
      throw new AppError(
        'TVAN_SOFTDREAMS_PREPARE_DOWNLOAD_TIMEOUT',
        'SoftDreams quá thời gian xử lý khi tạo file hóa đơn.',
        504,
        true,
        undefined,
        {
          retryMode: 'manual',
          retryStage: 'prepare_artifact',
          preserveContext: true,
          outcomeUnknown: true,
        },
      );
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/tvan/pdf/prepare-artifact',
      headers: { cookie: owner.cookie, 'x-hddt-csrf': owner.csrfToken },
      payload: { document: document({ key: 'softdream-timeout', providerCode: 'tvan_softdreams' }) },
    });
    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual(expect.objectContaining({
      error: 'TVAN_SOFTDREAMS_PREPARE_DOWNLOAD_TIMEOUT',
      retryable: true,
      retryMode: 'manual',
      retryStage: 'prepare_artifact',
      preserveContext: true,
      outcomeUnknown: true,
    }));
    expect(JSON.stringify(response.json())).not.toMatch(/cookie|invoiceToken|fileGuid/i);
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
