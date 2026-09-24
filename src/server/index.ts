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

async function lockOwnerIsRunning(lockPath: string): Promise<boolean> {
  try {
    const pid = Number((await fs.readFile(lockPath, 'utf8')).trim());
    return processIsRunning(pid);
  } catch {
    return false;
  }
}

async function waitForExistingRuntime(
  readRuntime: () => Promise<{ port: number } | null>,
  attempts = 15
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
      if (port) openBrowser(`http://127.0.0.1:${port}`);
      await app.close();
      if (!port) throw new Error('Một instance HDDT khác đang khởi động nhưng chưa sẵn sàng.');
      return;
    }
    await fs.unlink(lockPath);
    lock = await fs.open(lockPath, 'wx', 0o600);
  }
  await lock.writeFile(String(process.pid));
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
