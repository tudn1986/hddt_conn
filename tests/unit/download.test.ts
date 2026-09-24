import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CaptchaChallenge, DownloadedFile, InvoiceLocator, InvoiceSource, InvoiceQuery, LoginInput, LoginResult, PortalInvoiceDetail, PortalInvoicePage } from '../../src/shared/models/index.js';
import type { GdtConnector } from '../../src/server/gdt/connector.js';
import { SessionExpiredError } from '../../src/server/gdt/connector.js';
import { createMockInvoiceZip } from '../../src/server/gdt/zip.js';
import { DownloadService } from '../../src/server/services/download.service.js';
import { SettingsService } from '../../src/server/services/settings.service.js';
import { AppError } from '../../src/shared/utils/index.js';
import { document, TEST_MST } from '../helpers.js';

class DownloadConnector implements GdtConnector {
  mode: 'success' | 'retry-once' | 'expired' = 'success';
  calls = 0;
  async startSession(): Promise<CaptchaChallenge> { return { ckey: 'k', captchaImageBase64: '' }; }
  async login(_input: LoginInput): Promise<LoginResult> { return { success: true }; }
  async logout(): Promise<void> {}
  async queryInvoices(_input: InvoiceQuery): Promise<PortalInvoicePage> { return { total: 0, page: 1, pageSize: 50, items: [] }; }
  async getInvoiceDetail(_source: InvoiceSource, _locator: InvoiceLocator): Promise<PortalInvoiceDetail> { return { raw: {} }; }
  isAuthenticated(): boolean { return true; }
  getSessionInfo(): { username?: string } { return { username: TEST_MST }; }

  private beforeDownload(): void {
    this.calls += 1;
    if (this.mode === 'expired') throw new SessionExpiredError();
    if (this.mode === 'retry-once' && this.calls === 1) {
      throw new AppError('TEMPORARY', 'Temporary failure', 503, true);
    }
  }

  async downloadXml(_source: InvoiceSource, _locator: InvoiceLocator): Promise<DownloadedFile> {
    this.beforeDownload();
    const content = Buffer.from('<?xml version="1.0"?><HDon><DLHDon/></HDon>');
    return { content, filename: 'ignored.xml', contentType: 'application/xml', size: content.length };
  }

  async downloadZip(_source: InvoiceSource, _locator: InvoiceLocator): Promise<DownloadedFile> {
    this.beforeDownload();
    const content = await createMockInvoiceZip(Buffer.from('<HDon><DLHDon/></HDon>'));
    return { content, filename: 'ignored.zip', contentType: 'application/zip', size: content.length };
  }
}

let root = '';
let dataRoot = '';
let settings: SettingsService;
let connector: DownloadConnector;
let service: DownloadService;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-download-'));
  dataRoot = path.join(root, 'data');
  settings = new SettingsService({ appDataDir: path.join(root, 'app'), defaultDataRoot: dataRoot });
  await settings.init();
  await settings.saveConfig({ network: { requestDelayMs: 0, maxRetries: 3, downloadConcurrency: 2 } });
  connector = new DownloadConnector();
  service = new DownloadService(settings, () => connector, () => TEST_MST);
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function waitForQueue(timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (service.getState().running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (service.getState().running) throw new Error('queue timeout');
}

describe('download queue', () => {
  it('validates all input before mutating the queue', () => {
    const invalid = document({ key: 'bad', issueDate: undefined });
    expect(() => service.enqueueFromDocuments([document(), invalid], ['xml'])).toThrow(/thiếu ngày lập/i);
    expect(service.getTasks()).toHaveLength(0);
  });

  it('downloads XML and ZIP with exact filenames and a SHA-256 manifest', async () => {
    const tasks = service.enqueueFromDocuments([document()], ['xml', 'zip']);
    expect(tasks.map((task) => task.fileName).sort()).toEqual([
      '20260715_4501622475_1C26TST_123.xml',
      '20260715_4501622475_1C26TST_123.zip',
    ]);
    await service.start();
    expect(service.getTasks().every((task) => task.status === 'done')).toBe(true);
    const mstDir = path.join(dataRoot, TEST_MST);
    for (const task of service.getTasks()) {
      expect((await fs.stat(path.join(mstDir, task.fileName))).size).toBeGreaterThan(0);
      expect(task.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    const manifest = JSON.parse(await fs.readFile(path.join(mstDir, 'download-manifest.json'), 'utf8'));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files.every((entry: any) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
  });

  it('skips a valid existing file and rejects a corrupt collision', async () => {
    service.enqueueFromDocuments([document()], ['xml']);
    await service.start();
    service.clearCompleted();
    service.enqueueFromDocuments([document()], ['xml']);
    await service.start();
    expect(service.getTasks()[0].status).toBe('skipped');

    const target = path.join(dataRoot, TEST_MST, '20260715_4501622475_1C26TST_123.xml');
    await fs.writeFile(target, '<html>broken</html>');
    service.clearCompleted();
    service.enqueueFromDocuments([document()], ['xml']);
    await service.start();
    expect(service.getTasks()[0]).toMatchObject({ status: 'failed', attempts: 1, error: 'XML_INVALID' });
  });

  it('retries a transient failure and completes', async () => {
    connector.mode = 'retry-once';
    service.enqueueFromDocuments([document()], ['xml']);
    await service.start();
    expect(service.getTasks()[0]).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('pauses without losing tasks on session expiry and resumes after login', async () => {
    connector.mode = 'expired';
    service.enqueueFromDocuments([document()], ['xml']);
    await service.start();
    expect(service.getState()).toMatchObject({ running: false, paused: true });
    expect(service.getTasks()[0]).toMatchObject({ status: 'pending', attempts: 0, error: 'SESSION_EXPIRED' });
    connector.mode = 'success';
    service.resume();
    await waitForQueue();
    expect(service.getTasks()[0].status).toBe('done');
  });

  it.runIf(process.platform !== 'win32')('rejects a symlink file collision', async () => {
    const mstDir = path.join(dataRoot, TEST_MST);
    await fs.mkdir(mstDir, { recursive: true });
    const outside = path.join(root, 'outside.xml');
    await fs.writeFile(outside, '<HDon/>');
    await fs.symlink(outside, path.join(mstDir, '20260715_4501622475_1C26TST_123.xml'));
    service.enqueueFromDocuments([document()], ['xml']);
    await service.start();
    expect(service.getTasks()[0]).toMatchObject({ status: 'failed', error: 'EXISTING_FILE_INVALID' });
  });
});
