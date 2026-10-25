import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs, HELP } from './config.js';
import { readJson } from './files.js';
import { prepare, execute } from './runner.js';
import { helperPath } from './windows.js';
import { report, resultExitCode, terminalSummary } from './report.js';
import { BenchmarkError, failure, failureExitCode, type FailureStage } from './errors.js';
import type { Run } from './model.js';

export async function main(args = process.argv.slice(2)): Promise<void> {
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; };
  const check = () => { if (interrupted) throw new BenchmarkError('INTERRUPTED', 'measurement', 'User interrupted test'); };
  let stage: FailureStage = 'input';
  let fallbackCode = 'INVALID_INPUT';
  try {
    const internal = args[0] === '--continue-cold';
    const config = internal ? null : parseArgs(args);
    if (config === 'help') { console.log(HELP); return; }
    stage = 'environment'; fallbackCode = 'ENVIRONMENT_NOT_READY';
    if (process.platform !== 'win32' || process.arch !== 'x64' || Number(os.release().split('.')[0]) < 10) throw new BenchmarkError('UNSUPPORTED_PLATFORM', stage, 'This release supports Windows 10/11 x64 only.');
    if (!fs.existsSync(helperPath())) throw new BenchmarkError('NATIVE_HELPER_MISSING', stage, 'Native helper missing. Build with npm run build on Windows x64.');
    process.on('SIGINT', onInterrupt); process.on('SIGTERM', onInterrupt);
    stage = 'prepare'; fallbackCode = 'PREPARATION_FAILED';
    let run: Run;
    if (internal) {
      if (args.length !== 2) throw new BenchmarkError('INVALID_INPUT', 'input', 'Invalid internal cold continuation');
      const root = path.resolve(args[1]);
      run = readJson<Run>(path.join(root, 'run.json'));
      if (run.root !== root) throw Error('Run directory changed');
      await execute(run, check, true);
    } else {
      run = await prepare(config!, check);
      if (run.status === 'prepared') await execute(run, check);
    }
    stage = 'output'; fallbackCode = 'OUTPUT_FAILED';
    const summary = report(run);
    process.exitCode = resultExitCode(summary);
    console.error(terminalSummary(summary));
    console.log(JSON.stringify(summary));
  } catch (error) {
    const detail = failure(error, fallbackCode, stage);
    process.exitCode = failureExitCode(detail);
    console.error(`${detail.code}: ${detail.message}`);
    console.log(JSON.stringify({ schemaVersion: 2, kind: 'error', status: detail.code === 'INTERRUPTED' ? 'interrupted' : 'failed', error: detail }));
  } finally {
    process.off('SIGINT', onInterrupt); process.off('SIGTERM', onInterrupt);
  }
}
