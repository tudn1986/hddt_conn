import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  DownloadManifest,
  DownloadTask,
  InvoiceDocument,
  InvoiceLocator,
  InvoiceSource,
} from '../../shared/models/index.js';
import { buildInvoiceFilename } from '../../shared/filenames/index.js';
import {
  AppError,
  atomicWriteJson,
  assertPathInside,
  ensureDir,
  generateId,
  sha256Buffer,
  sha256File,
  sleep,
} from '../../shared/utils/index.js';
import type { GdtConnector } from '../gdt/connector.js';
import { SessionExpiredError } from '../gdt/connector.js';
import { isZip, validateInvoiceXml } from '../gdt/zip.js';
import type { SettingsService } from './settings.service.js';

type QueueInput = {
  invoiceSource: InvoiceSource;
  locator: InvoiceLocator;
  issueDate?: string;
  types: Array<'xml' | 'zip'>;
  overwrite?: boolean;
};

export class DownloadService {
  private readonly tasks = new Map<string, DownloadTask>();
  private running = false;
  private paused = false;
  private listeners: Array<(tasks: DownloadTask[]) => void> = [];
  private manifestWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly settings: SettingsService,
    private readonly getConnector: () => GdtConnector,
    private readonly getAccountMst: () => string | null
  ) {}

  onUpdate(callback: (tasks: DownloadTask[]) => void): () => void {
    this.listeners.push(callback);
    return () => { this.listeners = this.listeners.filter((listener) => listener !== callback); };
  }

  private emit(): void {
    const tasks = this.getTasks();
    for (const listener of this.listeners) {
      try { listener(tasks); } catch { /* A disconnected UI must not stop the queue. */ }
    }
  }

  getTasks(): DownloadTask[] {
    return Array.from(this.tasks.values()).map((task) => ({ ...task, locator: { ...task.locator } }));
  }

  getState(): { running: boolean; paused: boolean; tasks: DownloadTask[] } {
    return { running: this.running, paused: this.paused, tasks: this.getTasks() };
  }

  hasActiveTasks(): boolean {
    return this.running || Array.from(this.tasks.values()).some(
      (task) => task.status === 'pending' || task.status === 'downloading'
    );
  }

  enqueue(items: QueueInput[]): DownloadTask[] {
    const accountMst = this.getAccountMst();
    if (!accountMst) throw new SessionExpiredError();
    const mstDir = this.settings.getMstDataDir(accountMst);
    const prepared = new Map<string, {
      invoiceSource: InvoiceSource;
      locator: InvoiceLocator;
      issueDate: string;
      type: 'xml' | 'zip';
      targetPath: string;
      fileName: string;
      overwrite: boolean;
    }>();

    // Validate every input and filename before mutating the in-memory queue.
    for (const item of items) {
      if (!item.issueDate) throw new AppError('MISSING_ISSUE_DATE', 'Hóa đơn thiếu ngày lập.');
      for (const type of [...new Set(item.types)]) {
        const fileName = buildInvoiceFilename(item.locator, item.issueDate, type, item.invoiceSource);
        const targetPath = assertPathInside(mstDir, path.join(mstDir, fileName));
        prepared.set(targetPath, {
          invoiceSource: item.invoiceSource,
          locator: { ...item.locator },
          issueDate: item.issueDate,
          type,
          targetPath,
          fileName,
          overwrite: item.overwrite === true,
        });
      }
    }

    const created: DownloadTask[] = [];

    for (const item of prepared.values()) {
      const duplicates = Array.from(this.tasks.values()).filter((task) => task.targetPath === item.targetPath);
      const active = duplicates.find((task) => task.status === 'pending' || task.status === 'downloading');
      const completed = duplicates.find((task) => task.status === 'done' || task.status === 'skipped');
      if (active || (completed && !item.overwrite)) {
        const duplicate = active || completed!;
        created.push({ ...duplicate, locator: { ...duplicate.locator } });
        continue;
      }
      for (const duplicate of duplicates) this.tasks.delete(duplicate.id);
      const task: DownloadTask = {
        id: generateId(),
        invoiceSource: item.invoiceSource,
        locator: item.locator,
        issueDate: item.issueDate,
        type: item.type,
        status: 'pending',
        attempts: 0,
        targetPath: item.targetPath,
        fileName: item.fileName,
        overwrite: item.overwrite,
        createdAt: new Date().toISOString(),
      };
      this.tasks.set(task.id, task);
      created.push({ ...task, locator: { ...task.locator } });
    }
    this.emit();
    return created;
  }

  enqueueFromDocuments(
    documents: InvoiceDocument[],
    types: Array<'xml' | 'zip'>,
    overwrite = false
  ): DownloadTask[] {
    return this.enqueue(documents.map((document) => ({
      invoiceSource: document.invoiceSource ?? 'standard',
      locator: {
        sellerTaxCode: document.seller.taxCode ?? '',
        templateNo: document.templateNo ?? '',
        series: document.series ?? '',
        invoiceNo: document.invoiceNo ?? '',
      },
      issueDate: document.issueDate,
      types,
      overwrite,
    })));
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.emit();
    const network = this.settings.getConfig().network;
    try {
      const workerCount = Math.min(
        network.downloadConcurrency,
        this.getTasks().filter((task) => task.status === 'pending').length
      );
      await Promise.all(
        Array.from({ length: workerCount }, () =>
          this.worker(network.requestDelayMs, network.maxRetries)
        )
      );
    } finally {
      this.running = false;
      this.emit();
    }
  }

  pause(): void {
    this.paused = true;
    this.emit();
  }

  resume(): void {
    this.paused = false;
    if (!this.running) void this.start();
    this.emit();
  }

  retryFailed(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'failed') {
        task.status = 'pending';
        task.attempts = 0;
        task.error = undefined;
      }
    }
    this.emit();
  }

  clearCompleted(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === 'done' || task.status === 'skipped') this.tasks.delete(id);
    }
    this.emit();
  }

  private nextPending(): DownloadTask | null {
    for (const task of this.tasks.values()) {
      if (task.status === 'pending') return task;
    }
    return null;
  }

  private async worker(delayMs: number, maxAttempts: number): Promise<void> {
    const connector = this.getConnector();
    while (!this.paused) {
      const task = this.nextPending();
      if (!task) return;
      task.status = 'downloading';
      task.attempts += 1;
      this.emit();
      try {
        if (!task.overwrite) {
          const existingLink = await fs.lstat(task.targetPath).catch(() => null);
          if (existingLink?.isSymbolicLink()) {
            throw new AppError('EXISTING_FILE_INVALID', 'Từ chối file đích là symbolic link.', 409);
          }
          const existing = existingLink;
          if (existing?.isFile() && existing.size > 0) {
            const maxBytes = this.settings.getConfig().network.maxDownloadBytes;
            if (existing.size > maxBytes) {
              throw new AppError('EXISTING_FILE_INVALID', 'File đã có vượt giới hạn dung lượng.', 409);
            }
            const existingBytes = await fs.readFile(task.targetPath);
            if (task.type === 'xml') validateInvoiceXml(existingBytes);
            if (task.type === 'zip' && !isZip(existingBytes)) {
              throw new AppError('EXISTING_FILE_INVALID', 'File ZIP đã có không hợp lệ.', 409);
            }
            task.status = 'skipped';
            task.size = existing.size;
            task.sha256 = await sha256File(task.targetPath);
            task.completedAt = new Date().toISOString();
            await this.appendManifest(task);
            this.emit();
            continue;
          }
        }

        const file = task.type === 'xml'
          ? await connector.downloadXml(task.invoiceSource, task.locator)
          : await connector.downloadZip(task.invoiceSource, task.locator);
        if (!file.content.length || file.content.length !== file.size) {
          throw new AppError('DOWNLOAD_INVALID', 'File tải về rỗng hoặc sai kích thước.', 502, true);
        }
        if (task.type === 'xml') validateInvoiceXml(file.content);
        if (task.type === 'zip' && !isZip(file.content)) {
          throw new AppError('ZIP_INVALID', 'File tải về không phải ZIP hợp lệ.', 502, true);
        }

        await this.writeFileAtomically(task.targetPath, file.content, task.overwrite);
        task.status = 'done';
        task.completedAt = new Date().toISOString();
        task.size = file.size;
        task.sha256 = sha256Buffer(file.content);
        task.error = undefined;
        await this.appendManifest(task);
      } catch (error) {
        if (error instanceof SessionExpiredError) {
          task.status = 'pending';
          task.attempts = Math.max(0, task.attempts - 1);
          task.error = error.code;
          this.paused = true;
          this.emit();
          return;
        }
        const retryable = error instanceof AppError ? error.retryable : true;
        task.error = error instanceof AppError ? error.code : error instanceof Error ? error.message : 'UNKNOWN';
        if (!retryable || task.attempts >= maxAttempts) {
          task.status = 'failed';
        } else {
          task.status = 'pending';
          await sleep(Math.min(10_000, Math.max(250, delayMs) * 2 ** (task.attempts - 1)));
        }
      }
      this.emit();
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  private async writeFileAtomically(targetPath: string, content: Buffer, overwrite: boolean): Promise<void> {
    await ensureDir(path.dirname(targetPath));
    const realDataRoot = await fs.realpath(this.settings.getDataRoot());
    const realTargetDir = assertPathInside(realDataRoot, await fs.realpath(path.dirname(targetPath)));
    targetPath = assertPathInside(realTargetDir, path.join(realTargetDir, path.basename(targetPath)));
    const partPath = `${targetPath}.${process.pid}.${generateId()}.part`;
    const backupPath = `${targetPath}.${process.pid}.${generateId()}.bak`;
    let handle: fs.FileHandle | undefined;
    let backupCreated = false;
    let committed = false;
    try {
      handle = await fs.open(partPath, 'wx', 0o600);
      await handle.writeFile(content);
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (overwrite) {
        try {
          await fs.rename(targetPath, backupPath);
          backupCreated = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await fs.rename(partPath, targetPath);
        committed = true;
        if (backupCreated) await fs.unlink(backupPath).catch(() => undefined);
      } else {
        // Hard-linking a complete .part file creates the destination without a
        // partial-write window and fails safely if another process won the race.
        await fs.link(partPath, targetPath);
        await fs.unlink(partPath);
      }
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (backupCreated) {
        const targetExists = await fs.stat(targetPath).then(() => true).catch(() => false);
        if (!targetExists) {
          try {
            await fs.rename(backupPath, targetPath);
            backupCreated = false;
          } catch {
            // Preserve the .bak file for manual recovery when restore fails.
          }
        }
      }
      throw error;
    } finally {
      await fs.unlink(partPath).catch(() => undefined);
      if (committed) await fs.unlink(backupPath).catch(() => undefined);
    }
  }

  private manifestKey(task: DownloadTask): string {
    return [
      task.invoiceSource,
      task.locator.sellerTaxCode,
      task.locator.templateNo,
      task.locator.series,
      task.locator.invoiceNo,
      task.type,
    ].join('|');
  }

  private async appendManifest(task: DownloadTask): Promise<void> {
    this.manifestWrite = this.manifestWrite.catch(() => undefined).then(async () => {
      if (!task.size || !task.sha256) return;
      const mstDir = path.dirname(task.targetPath);
      const manifestPath = path.join(mstDir, 'download-manifest.json');
      let manifest: DownloadManifest = { schemaVersion: 1, files: [] };
      try {
        const value = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as DownloadManifest;
        if (value.schemaVersion === 1 && Array.isArray(value.files)) manifest = value;
      } catch {
        // Rebuild starts with the current completed entry when no valid manifest exists.
      }
      const key = this.manifestKey(task);
      manifest.files = manifest.files.filter((entry) => entry.key !== key);
      manifest.files.push({
        key,
        invoiceSource: task.invoiceSource,
        fileName: task.fileName,
        type: task.type,
        downloadedAt: task.completedAt || new Date().toISOString(),
        size: task.size,
        sha256: task.sha256,
      });
      await atomicWriteJson(manifestPath, manifest);
    });
    await this.manifestWrite;
  }
}
