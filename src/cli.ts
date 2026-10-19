import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs, HELP } from './config.js';
import { readJson } from './files.js';
import { prepare, execute } from './runner.js';
import { helperPath } from './windows.js';
import type { Run } from './model.js';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const internal = args[0] === '--continue-cold';
  const config = internal ? null : parseArgs(args);
  if (config === 'help') { console.log(HELP); return; }
  if (process.platform !== 'win32' || process.arch !== 'x64' || Number(os.release().split('.')[0]) < 10) throw Error('This release supports Windows 10/11 x64 only.');
  if (!fs.existsSync(helperPath())) throw Error('Native helper missing. Build with npm run build on Windows x64.');
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; };
  process.on('SIGINT', onInterrupt); process.on('SIGTERM', onInterrupt);
  const check = () => { if (interrupted) throw Error('User interrupted test'); };
  try {
    if (internal) {
      if (args.length !== 2) throw Error('Invalid internal cold continuation');
      const root = path.resolve(args[1]);
      const run = readJson<Run>(path.join(root, 'run.json'));
      if (run.root !== root) throw Error('Run directory changed');
      await execute(run, check, true);
    } else if (config) {
      const run = await prepare(config, check);
      if (run.status === 'prepared') await execute(run, check);
    }
  } finally { process.off('SIGINT', onInterrupt); process.off('SIGTERM', onInterrupt); }
}
