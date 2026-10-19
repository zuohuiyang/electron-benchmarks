import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function sha256(file: string): string {
  const fd = fs.openSync(file, 'r');
  try { const hash = createHash('sha256'); const b = Buffer.alloc(1024 * 1024); let n: number;
    while ((n = fs.readSync(fd, b, 0, b.length, null))) hash.update(b.subarray(0, n));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
export function manifest(root: string): { path: string; sha256: string }[] {
  const rows: { path: string; sha256: string }[] = [];
  function visit(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error(`Symlinks are not supported in frozen inputs: ${file}`);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) rows.push({ path: path.relative(root, file).replaceAll('\\', '/'), sha256: sha256(file) });
    }
  }
  visit(root); return rows;
}
export function verifyManifest(root: string, expected: ReturnType<typeof manifest>): void {
  if (JSON.stringify(manifest(root)) !== JSON.stringify(expected)) throw Error(`Frozen input changed: ${root}`);
}
export function atomicJson(file: string, value: unknown): void {
  const temp = `${file}.${process.pid}.next`;
  const fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
export function writeNewJson(file: string, value: unknown): void {
  const fd = fs.openSync(file, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as T;
export function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
