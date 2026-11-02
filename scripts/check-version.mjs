import fs from 'node:fs/promises';
import path from 'node:path';

// Fails when the release version drifts between its canonical locations.
const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');

const fileVersion = (await read('VERSION')).trim();
const packageVersion = JSON.parse(await read('package.json')).version;
const sourceMatch = /APP_VERSION\s*=\s*'([^']+)'/.exec(await read('src/shared/version.ts'));
const sourceVersion = sourceMatch?.[1];

const found = { 'VERSION': fileVersion, 'package.json': packageVersion, 'src/shared/version.ts': sourceVersion };
const distinct = new Set(Object.values(found));
if (distinct.size !== 1 || distinct.has(undefined) || distinct.has('')) {
  console.error('Version mismatch:', found);
  process.exit(1);
}

// Deployment defaults must follow the release version (they previously lagged at 1.3.0-public).
for (const [file, pattern] of [['compose.yml', /HDDT_IMAGE_TAG:-([^}]+)\}/g], ['.env.example', /^HDDT_IMAGE_TAG=(.+)$/gm]]) {
  for (const match of (await read(file)).matchAll(pattern)) {
    if (match[1].trim() !== fileVersion) {
      console.error(`${file} image tag ${match[1].trim()} does not match VERSION ${fileVersion}`);
      process.exit(1);
    }
  }
}

// Hard-coded copies of the version elsewhere in source are a regression.
const offenders = [];
async function walk(dir) {
  for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) await walk(relative);
    else if (/\.(ts|tsx)$/.test(entry.name) && relative !== 'src/shared/version.ts') {
      const text = await read(relative);
      if (/\b(?:const|let)\s+APP_VERSION\s*=\s*['"]/.test(text) || text.includes(`'${fileVersion}'`) || text.includes(`'${fileVersion}-public'`)) offenders.push(relative);
    }
  }
}
await walk('src');
if (offenders.length) {
  console.error('Hard-coded version found; import APP_VERSION from src/shared/version.ts instead:', offenders);
  process.exit(1);
}
console.log(`Version OK: ${fileVersion}`);
