import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const initial = spawnSync(pnpm, ['run', 'build:web'], { cwd: projectRoot, stdio: 'inherit', shell: false });
if (initial.status !== 0) process.exit(initial.status ?? 1);

const children = [
  spawn(pnpm, ['exec', 'vite', 'build', '--watch'], { cwd: projectRoot, stdio: 'inherit', shell: false }),
  spawn(pnpm, ['exec', 'tsx', 'watch', 'src/server/index.ts'], { cwd: projectRoot, stdio: 'inherit', shell: false }),
];

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
for (const child of children) {
  child.once('exit', (code) => {
    if (!stopping && code && code !== 0) {
      stop('SIGTERM');
      process.exitCode = code;
    }
  });
  child.once('error', (error) => {
    console.error(error.message);
    stop('SIGTERM');
    process.exitCode = 1;
  });
}
