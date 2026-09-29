import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yazl from 'yazl';

const projectRoot = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const appVersion = String(packageJson.version || '').trim();
if (!appVersion) throw new Error('package.json version is required');
const args = new Map(process.argv.slice(2).map((value, index, all) => value.startsWith('--') ? [value.slice(2), all[index + 1]] : ['', '']));
const targetPlatform = args.get('platform') || process.platform;
const targetArch = args.get('arch') || process.arch;
const supported = new Set(['win32:x64', 'darwin:arm64', 'darwin:x64', 'linux:x64', 'linux:arm64']);
if (!supported.has(`${targetPlatform}:${targetArch}`)) {
  throw new Error(`Unsupported portable target: ${targetPlatform}-${targetArch}`);
}
if (targetPlatform !== process.platform || targetArch !== process.arch) {
  throw new Error(
    `Node SEA packaging must run on the target OS/architecture. Current=${process.platform}-${process.arch}, requested=${targetPlatform}-${targetArch}.`
  );
}

const pnpmFallback = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(command, commandArgs, options = {}) {
  const commandName = path.basename(String(command)).toLowerCase();
  const needsWindowsShell = process.platform === 'win32' && /\.(?:cmd|bat)$/.test(commandName);
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: needsWindowsShell,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

function runPnpm(commandArgs, options = {}) {
  const lifecycleExecPath = process.env.npm_execpath;
  const userAgent = process.env.npm_config_user_agent || '';
  const invokedByPnpm = userAgent.toLowerCase().startsWith('pnpm/') || /pnpm/i.test(lifecycleExecPath || '');

  // When this script is launched by `pnpm package:*`, npm_execpath normally
  // points to pnpm.cjs. Execute that JavaScript file with the current Node
  // process instead of spawning pnpm.cmd directly. Newer Node releases reject
  // direct .cmd/.bat execution with shell:false on Windows (EINVAL).
  if (invokedByPnpm && lifecycleExecPath && /\.(?:c?js|mjs)$/i.test(lifecycleExecPath)) {
    return run(process.execPath, [lifecycleExecPath, ...commandArgs], options);
  }

  // Fallback for direct `node scripts/package-portable.mjs ...` usage.
  // run() enables the Windows command shell only for .cmd/.bat launchers.
  return run(pnpmFallback, commandArgs, options);
}

runPnpm(['run', 'build']);
const workDir = path.join(projectRoot, '.package-work');
const platformLabel = targetPlatform === 'win32' ? 'windows' : targetPlatform === 'darwin' ? 'macos' : 'linux';
const artifactBase = `hddt_conn_v${appVersion}_${platformLabel}_${targetArch}`;
const releaseRoot = path.join(projectRoot, 'release');
const releaseDir = path.join(releaseRoot, artifactBase);
await fs.rm(workDir, { recursive: true, force: true });
await fs.rm(releaseDir, { recursive: true, force: true });
await fs.mkdir(workDir, { recursive: true });
await fs.mkdir(releaseDir, { recursive: true });
const brandingSvg = path.join(projectRoot, 'assets', 'branding', 'hddt_conn_icon_app_1024.svg');

async function firstExisting(paths) {
  for (const candidate of paths) {
    try { await fs.access(candidate); return candidate; } catch {}
  }
  return undefined;
}

const bundlePath = path.join(workDir, 'hddt.cjs');
runPnpm([
  'exec', 'esbuild', 'src/server/index.ts', '--bundle', '--platform=node', '--format=cjs',
  '--target=node22', '--legal-comments=none', '--minify',
  '--define:process.env.NODE_ENV="production"',
  '--define:import.meta.url="file:///__hddt_sea__/app.js"',
  `--outfile=${bundlePath}`,
]);

const blobPath = path.join(workDir, 'hddt-sea.blob');
const seaConfigPath = path.join(workDir, 'sea-config.json');
await fs.writeFile(seaConfigPath, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}, null, 2));
run(process.execPath, ['--experimental-sea-config', seaConfigPath]);

const executableName = targetPlatform === 'win32' ? 'hddt-server.exe' : 'hddt-server';
const executablePath = path.join(releaseDir, executableName);
await fs.copyFile(process.execPath, executablePath);
if (targetPlatform === 'darwin') {
  run('codesign', ['--remove-signature', executablePath]);
}
const postjectArgs = [
  'exec', 'postject', executablePath, 'NODE_SEA_BLOB', blobPath,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
];
if (targetPlatform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA');
runPnpm(postjectArgs);
if (targetPlatform === 'darwin') run('codesign', ['--sign', '-', executablePath]);
if (targetPlatform !== 'win32') await fs.chmod(executablePath, 0o755);

await fs.cp(path.join(projectRoot, 'dist', 'public'), path.join(releaseDir, 'public'), { recursive: true });
for (const fileName of ['README_FIRST.txt', 'LICENSE.txt', 'VERSION']) {
  await fs.copyFile(path.join(projectRoot, fileName), path.join(releaseDir, fileName));
}
for (const fileName of ['DEPLOYMENT_GUIDE.md', 'USER_GUIDE.md']) {
  const source = path.join(projectRoot, 'docs', fileName);
  try { await fs.copyFile(source, path.join(releaseDir, fileName)); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
if (targetPlatform === 'win32') {
  await fs.copyFile(path.join(projectRoot, 'Start-HDDT.cmd'), path.join(releaseDir, 'Start-HDDT.cmd'));
  await fs.copyFile(path.join(projectRoot, 'Start-HDDT.vbs'), path.join(releaseDir, 'Start-HDDT.vbs'));
  await fs.copyFile(path.join(projectRoot, 'HDDT-Tray.ps1'), path.join(releaseDir, 'HDDT-Tray.ps1'));

  const windowsIcon = path.join(releaseDir, 'hddt_conn.ico');
  run('magick', [brandingSvg, '-background', 'none', '-define', 'icon:auto-resize=256,128,64,48,32,16', windowsIcon]);

  const systemRoot = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const cscPath = await firstExisting([
    path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(systemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ]);
  if (!cscPath) throw new Error('Windows C# compiler (csc.exe) is required to build HDDT_CONN.exe.');
  run(cscPath, [
    '/nologo',
    '/target:winexe',
    '/reference:System.Windows.Forms.dll',
    `/win32icon:${windowsIcon}`,
    `/out:${path.join(releaseDir, 'HDDT_CONN.exe')}`,
    path.join(projectRoot, 'scripts', 'windows-launcher.cs'),
  ]);
} else if (targetPlatform === 'darwin') {
  const commandLauncher = path.join(releaseDir, 'Start HDDT.command');
  await fs.copyFile(path.join(projectRoot, 'Start HDDT.command'), commandLauncher);
  await fs.chmod(commandLauncher, 0o755);

  // Build a tiny macOS application wrapper so end users do not get a Terminal
  // window when launching the portable release. The Node SEA server itself
  // remains a background process and continues to open the WebUI in the
  // default browser.
  const appLauncher = path.join(releaseDir, 'Start HDDT.app');
  run('/usr/bin/osacompile', [
    '-o', appLauncher,
    path.join(projectRoot, 'scripts', 'macos-launcher.applescript'),
  ]);
  const iconsetDir = path.join(workDir, 'hddt_conn.iconset');
  await fs.mkdir(iconsetDir, { recursive: true });
  const iconsetSizes = [
    ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
  ];
  for (const [fileName, size] of iconsetSizes) {
    run('magick', [brandingSvg, '-background', 'none', '-resize', `${size}x${size}`, path.join(iconsetDir, fileName)]);
  }
  const macIcon = path.join(workDir, 'hddt_conn.icns');
  run('/usr/bin/iconutil', ['-c', 'icns', iconsetDir, '-o', macIcon]);
  const resourcesDir = path.join(appLauncher, 'Contents', 'Resources');
  await fs.mkdir(resourcesDir, { recursive: true });
  await fs.copyFile(macIcon, path.join(resourcesDir, 'hddt_conn.icns'));

  const infoPlist = path.join(appLauncher, 'Contents', 'Info.plist');
  run('/usr/libexec/PlistBuddy', ['-c', 'Add :LSUIElement bool true', infoPlist]);
  run('/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleIconFile string hddt_conn.icns', infoPlist]);
  run('codesign', ['--force', '--deep', '--sign', '-', appLauncher]);
}
await fs.writeFile(path.join(releaseDir, 'BUILD_INFO.json'), `${JSON.stringify({
  appVersion,
  platform: targetPlatform,
  arch: targetArch,
  node: process.version,
  packagedAt: new Date().toISOString(),
  format: 'Node.js Single Executable Application',
}, null, 2)}\n`);

async function filesUnder(directory, prefix = '') {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(absolute, relative));
    else if (entry.isFile()) output.push({ absolute, relative });
  }
  return output;
}

const checksumFiles = await filesUnder(releaseDir);
const checksumLines = [];
for (const file of checksumFiles) {
  const hash = crypto.createHash('sha256').update(await fs.readFile(file.absolute)).digest('hex');
  checksumLines.push(`${hash}  ${file.relative}`);
}
await fs.writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), `${checksumLines.sort().join('\n')}\n`);

const zipPath = path.join(releaseRoot, `${artifactBase}.zip`);
await fs.mkdir(releaseRoot, { recursive: true });
await fs.rm(zipPath, { force: true });
await new Promise(async (resolve, reject) => {
  const zip = new yazl.ZipFile();
  const output = (await import('node:fs')).createWriteStream(zipPath, { mode: 0o600 });
  zip.outputStream.pipe(output).once('close', resolve).once('error', reject);
  try {
    for (const file of await filesUnder(releaseDir)) {
      const stat = await fs.stat(file.absolute);
      zip.addFile(file.absolute, path.posix.join(artifactBase, file.relative), { mode: stat.mode });
    }
    zip.end();
  } catch (error) {
    reject(error);
  }
});
await fs.rm(workDir, { recursive: true, force: true });
console.log(zipPath);
