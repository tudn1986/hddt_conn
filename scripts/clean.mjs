import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
for (const name of ['dist', '.package-work']) {
  const target = path.join(projectRoot, name);
  if (path.dirname(target) !== projectRoot) throw new Error(`Unsafe clean target: ${target}`);
  await fs.rm(target, { recursive: true, force: true });
}
