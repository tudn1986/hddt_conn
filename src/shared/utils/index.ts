import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type AppErrorPublicDetails = Record<string, string | number | boolean | undefined>;

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
    public readonly publicDetails?: AppErrorPublicDetails,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function generateId(): string { return crypto.randomUUID(); }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function safeNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

export function safeString(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value === 'object') return undefined;
  const valueString = String(value).trim();
  return valueString.length ? valueString : undefined;
}

export function safeStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : safeString(value);
}

/** Prefix risky text so Excel cannot interpret untrusted values as formulas. */
export function escapeExcelFormula(value: string): string {
  return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function cloneJson<T>(value: T): T { return structuredClone(value); }

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/** Atomic JSON write in the destination directory, with fsync and cleanup. */
export async function atomicWriteJson(filePath: string, data: unknown, mode = 0o600): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  const content = `${JSON.stringify(data, null, 2)}\n`;
  JSON.parse(content);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tempPath, 'wx', mode);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export function sha256Buffer(value: Uint8Array): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256Buffer(await fs.readFile(filePath));
}

export function getAppDataDir(): string {
  if (process.env.HDDT_APP_DATA_DIR) return path.resolve(process.env.HDDT_APP_DATA_DIR);
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'HDDT');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'HDDT');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'HDDT');
}

export function requireSafeTaxCode(value: string): string {
  const taxCode = value.trim();
  if (!/^\d{10}(?:-\d{3})?$/.test(taxCode)) {
    throw new AppError('INVALID_TAX_CODE', 'MST phải gồm 10 chữ số, có thể kèm hậu tố -xxx.');
  }
  return taxCode;
}

export function assertPathInside(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('PATH_OUTSIDE_DATA_ROOT', 'Đường dẫn nằm ngoài thư mục dữ liệu HDDT.', 403);
  }
  return resolvedCandidate;
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error && error.name === 'AbortError') return 'Yêu cầu đến GDT đã hết thời gian chờ.';
  return 'Đã xảy ra lỗi kỹ thuật. Xem log cục bộ để biết thêm chi tiết.';
}
