import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config, Run } from './model.js';
import { localRoot } from './windows.js';
import { isWithin } from './files.js';
import { BenchmarkError } from './errors.js';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
export const detailPath = (root: string, ...parts: string[]): string => path.join(root, 'detail', ...parts);
export function runTime(now = new Date()) {
  const offset = -now.getTimezoneOffset() || 0;
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
  return { startedAt: now.toISOString(), localStartedAt: `${date}T${clock}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, utcOffsetMinutes: offset };
}
export function outputRoot(config: Config, base = localRoot(), now = new Date()): string {
  if (config.out) return path.resolve(config.out);
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const name = `${stamp}-${config.test.split(':')[0]}`;
  let root = path.resolve(base, 'runs', name), suffix = 2;
  while (fs.existsSync(root)) root = path.resolve(base, 'runs', `${name}-${suffix++}`);
  return root;
}
export function createOutputRoot(config: Config, base = localRoot(), now = new Date()): string {
  while (true) {
    const root = outputRoot(config, base, now);
    fs.mkdirSync(path.dirname(root), { recursive: true });
    try { fs.mkdirSync(root); return root; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (config.out) throw new BenchmarkError('OUTPUT_EXISTS', 'input', `Output already exists: ${root}`);
    }
  }
}
export function createWorkRoot(base = localRoot()): string {
  const parent = path.join(base, 'w');
  fs.mkdirSync(parent, { recursive: true });
  while (true) {
    const root = path.join(parent, randomUUID().slice(0, 8));
    try { fs.mkdirSync(root); return root; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
}
export function cleanupWorkRoot(run: Pick<Run, 'workRoot'>, base = localRoot()): void {
  const parent = path.resolve(base, 'w'), root = path.resolve(run.workRoot);
  if (root === parent || !isWithin(root, parent) || !/^[0-9a-f]{8}$/.test(path.basename(root))) throw Error('Refusing to remove an invalid workspace path');
  fs.rmSync(root, { recursive: true, force: true });
}
