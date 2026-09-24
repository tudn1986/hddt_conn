import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const serverEntry = path.join(projectRoot, 'dist', 'server', 'index.js');
const publicDir = path.join(projectRoot, 'dist', 'public');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!fs.existsSync(serverEntry) || !fs.existsSync(publicDir)) {
  console.log('[HDDT] Chưa có dist hoàn chỉnh; đang build source trước khi chạy...');
  run(pnpm, ['run', 'build']);
}

const childEnv = { ...process.env, NODE_ENV: 'production' };
const bindHost = String(childEnv.HDDT_BIND_HOST || '127.0.0.1').trim().toLowerCase();
const loopbackOnly = ['127.0.0.1', 'localhost', '::1'].includes(bindHost);
if (childEnv.HDDT_DOCKER !== '1' && loopbackOnly && !childEnv.HDDT_INSECURE_HTTP) {
  childEnv.HDDT_INSECURE_HTTP = '1';
}

run(process.execPath, [serverEntry], { env: childEnv });
