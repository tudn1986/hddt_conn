import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';

const projectRoot = path.resolve(import.meta.dirname, '..');
const appVersion = (await fs.readFile(path.join(projectRoot, 'VERSION'), 'utf8')).trim();
const releaseName = `hddt_conn_v${appVersion}`;
const outputPath = path.resolve(projectRoot, '..', `${releaseName}.zip`);
const excludedTopLevel = new Set(['node_modules', 'dist', 'release', '.package-work', 'coverage', '.git']);

async function collect(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!prefix && excludedTopLevel.has(entry.name)) continue;
    if (entry.name === 'RELEASE_MANIFEST.json' || (entry.name.startsWith('.env') && entry.name !== '.env.example')) continue;
    if (entry.name.endsWith('.log') || entry.name.endsWith('.part') || entry.name.endsWith('.bak')) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collect(absolute, relative));
    else if (entry.isFile()) files.push({ absolute, relative });
  }
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function sha256(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

const sourceFiles = await collect(projectRoot);
const manifestFiles = [];
for (const file of sourceFiles) {
  const stat = await fs.stat(file.absolute);
  manifestFiles.push({ path: file.relative, size: stat.size, sha256: await sha256(file.absolute) });
}
const manifest = {
  format: 'hddt-source-release-manifest',
  schemaVersion: 1,
  appVersion,
  releaseRevision: appVersion,
  generatedAt: new Date().toISOString(),
  scope: 'source',
  manifestSelfExcluded: true,
  fileCount: manifestFiles.length,
  totalBytes: manifestFiles.reduce((total, file) => total + file.size, 0),
  verification: {
    report: 'docs/RELEASE_NOTES_v' + appVersion + '.md',
    dependencyEnabledVerify: 'pnpm-verify-required-before-packaging',
    typescriptSyntaxParse: 'covered-by-pnpm-verify',
    mjsSyntax: 'covered-by-pnpm-verify',
    selectedOnlyExportStaticAssertions: 'pass',
    liveGdtCredentialTest: 'not-run-no-authorized-credentials',
    deploymentAcceptance: 'required-on-target-environment',
  },
  knownLimits: [
    'Selected invoices without hydrated detail lines have no ChiTiet rows until GDT detail is loaded.',
    'TVAN PDF batch remains subject to provider capability, CAPTCHA and the existing batch request limit.',
    'Type 06 list summaries from some providers contain no HHDV amount; correct subtotal requires GDT detail hydration and is never fabricated from an empty summary.',
    'POS sales endpoint is empty until captured and verified.',
    'AMIS profiles are foundation mappings until an official workbook is provided.',
    'Full dependency-enabled verify/build must run in CI or the target deployment environment before production acceptance.',
  ],
  files: manifestFiles,
};
const manifestPath = path.join(projectRoot, 'RELEASE_MANIFEST.json');
const temporaryManifestPath = `${manifestPath}.${process.pid}.tmp`;
await fs.writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await fs.rename(temporaryManifestPath, manifestPath);

const zipFiles = [...sourceFiles, { absolute: manifestPath, relative: 'RELEASE_MANIFEST.json' }]
  .sort((a, b) => a.relative.localeCompare(b.relative));
await fs.rm(outputPath, { force: true });
await new Promise(async (resolve, reject) => {
  const zip = new yazl.ZipFile();
  const output = createWriteStream(outputPath, { mode: 0o600 });
  zip.outputStream.pipe(output).once('close', resolve).once('error', reject);
  try {
    for (const file of zipFiles) {
      const stat = await fs.stat(file.absolute);
      zip.addFile(file.absolute, path.posix.join(releaseName, file.relative), {
        mode: stat.mode,
        compress: true,
      });
    }
    zip.end();
  } catch (error) {
    reject(error);
  }
});

const stat = await fs.stat(outputPath);
console.log(JSON.stringify({ outputPath, size: stat.size, sha256: await sha256(outputPath), files: zipFiles.length }));
