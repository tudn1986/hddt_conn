import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptsDir = import.meta.dirname;
for (const name of (await fs.readdir(scriptsDir)).filter((value) => value.endsWith('.mjs')).sort()) {
  const result = spawnSync(process.execPath, ['--check', path.join(scriptsDir, name)], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
