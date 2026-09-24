import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AccountsFile, AppConfig, RuntimeInfo } from '../../shared/models/index.js';
import { applyProductionLockedSettings, PRODUCTION_LOCKED_SETTINGS } from '../../shared/release-config.js';
import { appConfigSchema, settingsPatchSchema } from '../../shared/schemas/index.js';
import {
  AppError,
  atomicWriteJson,
  cloneJson,
  ensureDir,
  getAppDataDir,
  requireSafeTaxCode,
} from '../../shared/utils/index.js';

function defaultConfig(dataRoot?: string): AppConfig {
  return {
    schemaVersion: 1,
    app: {
      language: 'vi-VN',
      openBrowserOnStart: true,
      port: 3210,
      connectorMode: 'live',
      defaultDirection: 'purchase',
    },
    storage: {
      dataRoot: path.resolve(dataRoot || path.join(os.homedir(), 'HDDT_DATA')),
      datasetSaveMode: 'ask',
      maxDatasetBytes: 200 * 1024 * 1024,
    },
    network: {
      detailConcurrency: PRODUCTION_LOCKED_SETTINGS.detailConcurrency,
      downloadConcurrency: PRODUCTION_LOCKED_SETTINGS.downloadConcurrency,
      requestDelayMs: PRODUCTION_LOCKED_SETTINGS.requestDelayMs,
      requestTimeoutMs: 30_000,
      maxRetries: PRODUCTION_LOCKED_SETTINGS.maxRetries,
      maxResponseBytes: 50 * 1024 * 1024,
      maxDownloadBytes: 100 * 1024 * 1024,
    },
    gdt: {
      origin: 'https://hoadondientu.gdt.gov.vn',
      captchaPath: '/api/captcha',
      loginPath: '/api/security-taxpayer/authenticate',
      purchasePath: '/api/query/invoices/purchase',
      salesPath: PRODUCTION_LOCKED_SETTINGS.salesPath,
      posPurchasePath: '/api/sco-query/invoices/purchase',
      posSalesPath: '',
      detailPath: '/api/query/invoices/detail',
      posDetailPath: '/api/sco-query/invoices/detail',
      exportPath: '/api/query/invoices/export-xml',
      posExportPath: '/api/sco-query/invoices/export-xml',
      exportMethod: 'GET',
      posExportMethod: 'POST',
    },
    export: { defaultFormat: 'xlsx' },
  };
}

export class SettingsService {
  private readonly appDataDir: string;
  private readonly configPath: string;
  private readonly accountsPath: string;
  private readonly runtimePath: string;
  private config: AppConfig;
  private accounts: AccountsFile = { schemaVersion: 1, accounts: [] };

  constructor(options: { appDataDir?: string; defaultDataRoot?: string } = {}) {
    this.appDataDir = path.resolve(options.appDataDir || getAppDataDir());
    this.configPath = path.join(this.appDataDir, 'config.json');
    this.accountsPath = path.join(this.appDataDir, 'accounts.json');
    this.runtimePath = path.join(this.appDataDir, 'runtime.json');
    this.config = defaultConfig(options.defaultDataRoot);
  }

  async init(): Promise<void> {
    await ensureDir(this.appDataDir);
    await ensureDir(this.getLogDir());
    await this.loadConfig();
    await this.loadAccounts();
    await this.cleanupLogs();
  }

  private async quarantineInvalid(filePath: string): Promise<void> {
    const backup = `${filePath}.invalid-${Date.now()}`;
    await fs.rename(filePath, backup).catch(() => undefined);
  }

  async loadConfig(): Promise<AppConfig> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf8');
      const legacy = JSON.parse(raw) as Partial<AppConfig> & { gdt?: Partial<AppConfig['gdt']> };
      const defaults = defaultConfig();
      const candidate = applyProductionLockedSettings({
        ...defaults,
        ...legacy,
        app: { ...defaults.app, ...(legacy.app || {}) },
        storage: { ...defaults.storage, ...(legacy.storage || {}) },
        network: { ...defaults.network, ...(legacy.network || {}) },
        gdt: { ...defaults.gdt, ...(legacy.gdt || {}) },
        export: { ...defaults.export, ...(legacy.export || {}) },
      } as AppConfig);
      const parsed = appConfigSchema.safeParse(candidate);
      if (!parsed.success) {
        await this.quarantineInvalid(this.configPath);
        await this.saveConfig();
      } else {
        this.config = parsed.data;
        // Persist migrated defaults so v1.0.x config becomes explicit v1.1.0 config.
        await this.saveConfig();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await this.quarantineInvalid(this.configPath);
      }
      await this.saveConfig();
    }
    await ensureDir(this.config.storage.dataRoot);
    return this.getConfig();
  }

  getConfig(): AppConfig { return cloneJson(this.config); }

  async saveConfig(patch?: unknown): Promise<AppConfig> {
    if (patch !== undefined) {
      const parsedPatch = settingsPatchSchema.safeParse(patch);
      if (!parsedPatch.success) {
        throw new AppError('INVALID_SETTINGS', parsedPatch.error.issues[0]?.message || 'Cấu hình không hợp lệ.');
      }
      const value = parsedPatch.data;
      const candidate: AppConfig = {
        ...this.config,
        app: { ...this.config.app, ...(value.app || {}) },
        storage: { ...this.config.storage, ...(value.storage || {}) },
        network: { ...this.config.network, ...(value.network || {}) },
        gdt: { ...this.config.gdt, ...(value.gdt || {}) },
        export: { ...this.config.export, ...(value.export || {}) },
      };
      candidate.storage.dataRoot = path.resolve(candidate.storage.dataRoot);
      const releaseCandidate = applyProductionLockedSettings(candidate);
      const parsed = appConfigSchema.safeParse(releaseCandidate);
      if (!parsed.success) {
        throw new AppError('INVALID_SETTINGS', parsed.error.issues[0]?.message || 'Cấu hình không hợp lệ.');
      }
      this.config = parsed.data;
    }
    await atomicWriteJson(this.configPath, this.config);
    await ensureDir(this.config.storage.dataRoot);
    return this.getConfig();
  }

  async loadAccounts(): Promise<AccountsFile> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.accountsPath, 'utf8')) as Partial<AccountsFile>;
      const accounts = Array.isArray(parsed.accounts)
        ? parsed.accounts
            .filter((entry) => entry && typeof entry.username === 'string' && /^\d{10}(?:-\d{3})?$/.test(entry.username))
            .map((entry) => ({
              username: entry.username,
              displayName: typeof entry.displayName === 'string' ? entry.displayName.slice(0, 200) : undefined,
              rememberPassword: false as const,
              passwordStorage: 'none' as const,
            }))
        : [];
      this.accounts = {
        schemaVersion: 1,
        lastUsername: typeof parsed.lastUsername === 'string' ? parsed.lastUsername : undefined,
        accounts,
      };
    } catch {
      this.accounts = { schemaVersion: 1, accounts: [] };
    }
    return this.getAccounts();
  }

  getAccounts(): AccountsFile { return cloneJson(this.accounts); }

  async rememberUsername(username: string): Promise<void> {
    const safeUsername = requireSafeTaxCode(username);
    const accounts = this.accounts.accounts.filter((entry) => entry.username !== safeUsername);
    accounts.unshift({
      username: safeUsername,
      rememberPassword: false,
      passwordStorage: 'none',
    });
    this.accounts = { schemaVersion: 1, lastUsername: safeUsername, accounts: accounts.slice(0, 20) };
    await atomicWriteJson(this.accountsPath, this.accounts);
  }

  async forgetLastUsername(): Promise<void> {
    this.accounts = { ...this.accounts, lastUsername: undefined };
    await atomicWriteJson(this.accountsPath, this.accounts);
  }

  async writeRuntime(port: number): Promise<void> {
    await atomicWriteJson(this.runtimePath, {
      port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    } satisfies RuntimeInfo);
  }

  async readRuntime(): Promise<RuntimeInfo | null> {
    try {
      const value = JSON.parse(await fs.readFile(this.runtimePath, 'utf8')) as RuntimeInfo;
      if (
        Number.isInteger(value.port) && value.port >= 1024 && value.port <= 65535 &&
        Number.isInteger(value.pid) && value.pid > 0 &&
        typeof value.startedAt === 'string'
      ) return value;
    } catch {
      // Missing or invalid runtime metadata means there is no reusable instance.
    }
    return null;
  }

  async removeRuntime(): Promise<void> {
    await fs.unlink(this.runtimePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  getDataRoot(): string { return this.config.storage.dataRoot; }

  getMstDataDir(mst: string): string {
    return path.join(this.getDataRoot(), requireSafeTaxCode(mst));
  }

  getAppDataDir(): string { return this.appDataDir; }
  getLogDir(): string { return path.join(this.appDataDir, 'logs'); }

  private async cleanupLogs(): Promise<void> {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const entries = await fs.readdir(this.getLogDir(), { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.log')).map(async (entry) => {
      const filePath = path.join(this.getLogDir(), entry.name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fs.unlink(filePath).catch(() => undefined);
    }));
  }
}
