import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { downloadArtifact } from '@electron/get';
import { isVersion } from './config.js';
import { manifest, isWithin, sha256 } from './files.js';
import { localRoot, exec, powershell, TOOL_ROOT } from './windows.js';
import type { Target } from './model.js';

export function distributionManifest(executable: string): { path: string; sha256: string }[] {
  const root = path.dirname(executable);
  // Local GN build directories also contain obj/, test executables, and multi-GB PDBs.
  // Freeze runtime assets only; never traverse the entire build output.
  const files = fs.readdirSync(root, { withFileTypes: true });
  const rows: { path: string; sha256: string }[] = [];
  for (const entry of files) {
    const selected = entry.name === path.basename(executable) || /\.(dll|pak|bin|dat)$/i.test(entry.name) || entry.name === 'vk_swiftshader_icd.json' || ['locales', 'resources', 'swiftshader'].includes(entry.name);
    if (entry.isSymbolicLink() && selected) throw Error(`Runtime input symlink is unsupported: ${entry.name}`);
    if (entry.isFile() && (entry.name === path.basename(executable) || /\.(dll|pak|bin|dat)$/i.test(entry.name) || entry.name === 'vk_swiftshader_icd.json')) rows.push({ path: entry.name, sha256: sha256(path.join(root, entry.name)) });
    else if (entry.isDirectory() && ['locales', 'resources', 'swiftshader'].includes(entry.name)) rows.push(...manifest(path.join(root, entry.name)).map(row => ({ ...row, path: `${entry.name}/${row.path}` })));
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
export function verifyTarget(target: Target): void {
  if (JSON.stringify(distributionManifest(target.executable)) !== JSON.stringify(target.manifest)) throw Error(`Target runtime inputs changed: ${target.executable}`);
}

export async function resolveTarget(input: string, index: number, runRoot: string): Promise<Target> {
  let executable: string;
  if (isVersion(input)) {
    if (Number(input.split('.')[0]) < 22) throw Error('Electron >=22 is required by the fixed scenario APIs.');
    const cache = path.join(localRoot(), 'versions', input, 'win32-x64');
    executable = path.join(cache, 'electron.exe');
    // A completion marker prevents an interrupted unzip from being used as a target.
    if (!fs.existsSync(path.join(cache, '.complete'))) {
      console.error(`Preparing Electron ${input}...`);
      const zip = await downloadArtifact({ version: input, artifactName: 'electron', platform: 'win32', arch: 'x64' });
      const staging = `${cache}.${randomUUID()}.partial`;
      fs.mkdirSync(staging, { recursive: true });
      await exec(powershell(), ['-NoProfile', '-NonInteractive', '-File', path.join(TOOL_ROOT, 'scripts/extract.ps1')], { env: { ...process.env, BENCH_ZIP: zip, BENCH_DESTINATION: staging }, windowsHide: true, timeout: 300_000 });
      fs.writeFileSync(path.join(staging, '.complete'), input);
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      if (fs.existsSync(cache)) throw Error(`Incomplete download cache exists; remove it before retrying: ${cache}`);
      fs.renameSync(staging, cache);
    }
  } else {
    executable = path.resolve(input);
    if (!fs.existsSync(executable) || !fs.statSync(executable).isFile() || path.extname(executable).toLowerCase() !== '.exe') throw Error(`Expected an Electron executable path or exact version: ${input}`);
  }
  const root = path.dirname(executable);
  if (isWithin(runRoot, root) || isWithin(root, runRoot)) throw Error('Output and Electron distribution directories must not contain one another.');
  // Fingerprint the full distribution (not just its launcher).
  const inputs = distributionManifest(executable);
  const identity = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
  return { id: `target-${index + 1}`, input, executable, version: isVersion(input) ? input : 'local (preflight pending)', identity, manifest: inputs, profileTemplate: path.join(runRoot, 'profiles', `template-${index + 1}`) };
}
