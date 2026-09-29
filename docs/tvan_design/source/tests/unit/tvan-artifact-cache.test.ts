import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TvanPdfService } from '../../src/server/tvan/pdf.service.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';
import type { TvanAdapter } from '../../src/server/tvan/types.js';
import { document } from '../helpers.js';

const PDF = Buffer.from('%PDF-1.7\ncache\n%%EOF\n');
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('TVAN artifact cache + singleflight', () => {
  it('joins concurrent SoftDream-style prepare/view/original requests and reuses the same artifact', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-tvan-cache-'));
    roots.push(root);
    let prepares = 0;
    const adapter: TvanAdapter = {
      providerCode: 'cache_provider',
      displayName: 'Cache Provider',
      priority: 'P3',
      captchaMode: 'per_invoice',
      matches: (item) => item.providerCode === 'cache_provider',
      capability: () => ({
        providerCode: 'cache_provider',
        displayName: 'Cache Provider',
        supported: true,
        priority: 'P3',
        captchaMode: 'per_invoice',
      }),
      prepareArtifact: async () => {
        prepares += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          original: PDF,
          originalFileName: 'source.pdf',
          originalContentType: 'application/pdf',
          pdf: PDF,
          pdfFileName: 'normalized.pdf',
        };
      },
      downloadPdf: async () => ({
        content: PDF,
        contentType: 'application/pdf',
        fileName: 'fallback.pdf',
      }),
    };
    const service = new TvanPdfService({
      getAppDataDir: () => root,
      getConfig: () => ({
        network: { requestTimeoutMs: 5_000, maxDownloadBytes: 10 * 1024 * 1024 },
      }),
    } as any, {
      registry: new TvanRegistry([adapter]),
      fetchImpl: fetch,
      namespace: 'cache-test',
    });
    const invoice = document({ key: 'cache-doc', providerCode: 'cache_provider' });
    try {
      const [info, viewed, original] = await Promise.all([
        service.prepareArtifact(invoice),
        service.viewPdf(invoice),
        service.downloadOriginal(invoice),
      ]);
      expect(prepares).toBe(1);
      expect(info.providerCode).toBe('cache_provider');
      expect(viewed.content).toEqual(PDF);
      expect(original.content).toEqual(PDF);

      await service.viewPdf(invoice);
      await service.downloadOriginal(invoice);
      const secondInfo = await service.prepareArtifact(invoice);
      expect(prepares).toBe(1);
      expect(secondInfo.id).toBe(info.id);
      expect(service.artifactStatus(invoice)).toMatchObject({
        stage: 'pdf_ready',
        ready: true,
        canView: true,
        canDownloadPdf: true,
        canDownloadOriginal: true,
      });
    } finally {
      await service.dispose();
    }
  });
});
