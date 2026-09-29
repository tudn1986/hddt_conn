import fs, { type FileHandle } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_VERSION, buildApp } from './app.js';

async function findAvailablePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => {
      const fallback = net.createServer();
      fallback.unref();
      fallback.once('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const address = fallback.address();
        const port = typeof address === 'object' && address ? address.port : preferred + 1;
        fallback.close(() => resolve(port));
      });
    });
    server.listen(preferred, '127.0.0.1', () => server.close(() => resolve(preferred)));
  });
}

function openBrowser(url: string): void {
  const command = process.platform === 'win32' ? 'cmd'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'start', '""', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.once('error', () => undefined);
  child.unref();
}

async function healthyInstance(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/app/status`, {
      signal: AbortSignal.timeout(1_200),
    });
    if (!response.ok) return false;
    const value = await response.json() as { version?: unknown };
    return value.version === APP_VERSION;
  } catch {
    return false;
  }
}

async function processIsRunning(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

type InstanceLockInfo = {
  pid: number;
  startedAt?: string;
  appVersion?: string;
};

async function readLockInfo(lockPath: string): Promise<InstanceLockInfo | null> {
  try {
    const raw = (await fs.readFile(lockPath, 'utf8')).trim();
    if (!raw) return null;
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as Partial<InstanceLockInfo>;
      const pid = Number(parsed.pid);
      if (!Number.isSafeInteger(pid) || pid <= 0) return null;
      return {
        pid,
        startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : undefined,
        appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : undefined,
      };
    }
    const pid = Number(raw);
    return Number.isSafeInteger(pid) && pid > 0 ? { pid } : null;
  } catch {
    return null;
  }
}

async function lockOwnerIsRunning(lockPath: string): Promise<boolean> {
  const lock = await readLockInfo(lockPath);
  return lock ? processIsRunning(lock.pid) : false;
}

async function lockAgeMs(lockPath: string): Promise<number> {
  try {
    const stat = await fs.stat(lockPath);
    return Math.max(0, Date.now() - stat.mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function waitForExistingRuntime(
  readRuntime: () => Promise<{ port: number } | null>,
  attempts = 40
): Promise<number | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const runtime = await readRuntime();
    if (runtime && await healthyInstance(runtime.port)) return runtime.port;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error(`${name} phải là cổng TCP từ 1024 đến 65535.`);
  }
  return parsed;
}

async function main(): Promise<void> {
  let shutdownFromUi: () => void = () => undefined;
  const dockerMode = process.env.HDDT_DOCKER === '1';
  const built = await buildApp({
    exitHandler: () => shutdownFromUi(),
    defaultDataRoot: process.env.HDDT_DATA_ROOT,
  });
  const { app, settings } = built;
  const existing = dockerMode ? null : await settings.readRuntime();
  if (existing && await healthyInstance(existing.port)) {
    openBrowser(`http://127.0.0.1:${existing.port}`);
    await app.close();
    return;
  }

  const lockPath = path.join(settings.getAppDataDir(), 'instance.lock');
  if (dockerMode) {
    // Container lifecycle already guarantees one process per container. runtime.json
    // and instance.lock live on a persistent volume, so remove stale files left by
    // a previous container/PID namespace before acquiring the current lock.
    await settings.removeRuntime().catch(() => undefined);
    await fs.unlink(lockPath).catch(() => undefined);
  }
  let lock: FileHandle;
  try {
    lock = await fs.open(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const runningOwner = await lockOwnerIsRunning(lockPath);
    if (runningOwner) {
      const port = await waitForExistingRuntime(() => settings.readRuntime());
      if (port) {
        openBrowser(`http://127.0.0.1:${port}`);
        await app.close();
        return;
      }

      // A stale legacy lock may contain a PID that Windows has already reused
      // for an unrelated process. A genuine HDDT startup should publish
      // runtime.json before this grace period expires.
      const ageMs = await lockAgeMs(lockPath);
      if (ageMs < 30_000) {
        await app.close();
        throw new Error('Một instance HDDT khác đang khởi động nhưng chưa sẵn sàng.');
      }
    }

    await settings.removeRuntime().catch(() => undefined);
    await fs.unlink(lockPath);
    lock = await fs.open(lockPath, 'wx', 0o600);
  }
  await lock.writeFile(JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
  }));
  await lock.sync();

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'hddt_stopping');
    await app.close().catch(() => undefined);
    await settings.removeRuntime().catch(() => undefined);
    await lock.close().catch(() => undefined);
    await fs.unlink(lockPath).catch(() => undefined);
  };
  shutdownFromUi = () => {
    void shutdown('WEBUI').finally(() => process.exit(0));
  };

  try {
    const preferredPort = envPort('HDDT_PORT', settings.getConfig().app.port || 3210);
    const fixedPort = dockerMode || process.env.HDDT_FIXED_PORT === '1';
    const port = fixedPort ? preferredPort : await findAvailablePort(preferredPort);
    const host = process.env.HDDT_BIND_HOST?.trim() || '127.0.0.1';
    await app.listen({ port, host });
    await settings.writeRuntime(port);
    const url = process.env.HDDT_PUBLIC_URL?.trim() || `http://${process.env.HDDT_PUBLIC_HOST?.trim() || '127.0.0.1'}:${port}`;
    app.log.info({ url, connectorMode: process.env.HDDT_CONNECTOR || settings.getConfig().app.connectorMode }, 'hddt_started');
    if (!dockerMode && process.env.HDDT_NO_OPEN_BROWSER !== '1' && settings.getConfig().app.openBrowserOnStart) openBrowser(url);
  } catch (error) {
    await shutdown('STARTUP_ERROR');
    throw error;
  }

  process.once('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown('SIGTERM').then(() => process.exit(0)));
}

void main().catch((error) => {
  console.error('Không thể khởi động HDDT:', error instanceof Error ? error.message : 'UNKNOWN');
  process.exitCode = 1;
});
