import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, phasesFor, validateJobOutputs, HELP } from './config.js';
import { prepare, execute, loadColdRun } from './runner.js';
import { helperPath } from './windows.js';
import { report, resultExitCode, terminalSummary } from './report.js';
import { recoverInactiveQueue, resumeQueue, startQueue, summaryPath } from './queue.js';
import { BenchmarkError, failure, failureExitCode, type FailureStage } from './errors.js';

export async function main(args = process.argv.slice(2)): Promise<void> {
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; };
  const check = () => { if (interrupted) throw new BenchmarkError('INTERRUPTED', 'measurement', 'User interrupted test'); };
  let stage: FailureStage = 'input';
  let fallbackCode = 'INVALID_INPUT';
  try {
    const continuing = args[0] === '--continue-cold';
    if (continuing && args.length !== 1) throw Error('Invalid internal continuation arguments');
    const config = continuing ? undefined : parseArgs(args);
    if (config === 'help') { console.log(HELP); return; }
    const jobs = config && ('jobs' in config ? config.jobs : [config]);
    if (jobs && config && 'jobs' in config) validateJobOutputs(jobs);
    if (jobs && jobs.some(job => phasesFor(job.test).includes('cold')) && (!process.stdin.isTTY || !process.stderr.isTTY)) {
      throw new BenchmarkError('REBOOT_CONSENT_REQUIRED', 'consent', 'Cold startup requires an interactive terminal to confirm Windows restarts.');
    }
    stage = 'environment'; fallbackCode = 'ENVIRONMENT_NOT_READY';
    if (process.platform !== 'win32' || process.arch !== 'x64' || Number(os.release().split('.')[0]) < 10) throw new BenchmarkError('UNSUPPORTED_PLATFORM', stage, 'This release supports Windows 10/11 x64 only.');
    if (!fs.existsSync(helperPath())) throw new BenchmarkError('NATIVE_HELPER_MISSING', stage, 'Native helper missing. Build with npm run build on Windows x64.');
    process.on('SIGINT', onInterrupt); process.on('SIGTERM', onInterrupt);
    stage = 'prepare'; fallbackCode = 'PREPARATION_FAILED';
    if (continuing) {
      const { handled, result } = await resumeQueue(check);
      if (handled) {
        if (result) finishQueue(result);
        return;
      }
    }
    if (jobs) await recoverInactiveQueue();
    if (jobs && jobs.length > 1) {
      finishQueue(await startQueue(jobs, check));
      return;
    }
    const run = jobs ? await prepare(jobs[0], check) : loadColdRun();
    if (!run) return;
    if ((continuing || run.status === 'prepared') && !await execute(run, check, continuing)) return;
    stage = 'output'; fallbackCode = 'OUTPUT_FAILED';
    const summary = report(run);
    process.exitCode = resultExitCode(summary);
    console.error(terminalSummary(summary, run.root));
    console.log(JSON.stringify(summary));
    openSummary(summaryPath(run.root));
  } catch (error) {
    const detail = failure(error, fallbackCode, stage);
    process.exitCode = failureExitCode(detail);
    console.error(`${detail.code}: ${detail.message}`);
    console.log(JSON.stringify({ schemaVersion: 3, kind: 'error', status: detail.code === 'INTERRUPTED' ? 'interrupted' : 'failed', error: detail }));
  } finally {
    process.off('SIGINT', onInterrupt); process.off('SIGTERM', onInterrupt);
  }
}

function finishQueue(result: Awaited<ReturnType<typeof startQueue>>): void {
  if (!result) return;
  const { summary, file, exitCode } = result;
  process.exitCode = exitCode;
  console.error(`${summary.status}: ${summary.completed}/${summary.total} jobs completed
Summary: ${file}`);
  console.log(JSON.stringify(summary));
  openSummary(file);
}

function openSummary(file: string): void {
  const notepad = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'notepad.exe');
  try {
    const child = spawn(notepad, [file], { detached: true, stdio: 'ignore' });
    child.on('error', error => console.error(`Could not open ${file} in Notepad: ${error.message}`));
    child.unref();
  } catch (error) {
    console.error(`Could not open ${file} in Notepad: ${String(error)}`);
  }
}
