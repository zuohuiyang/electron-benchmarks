import fs from 'node:fs';
import path from 'node:path';
import { plan, validateConfig } from './config.js';
import { PRESET, type Config, type Run } from './model.js';
import { atomicJson, readJson, writeNewJson, manifest, sha256, isWithin } from './files.js';
import { TOOL_ROOT, localRoot, inspect, environment, assertDesktop, waitIdle } from './windows.js';
import { resolveTarget, verifyTarget } from './targets.js';
import { launch } from './launch.js';
import { report } from './report.js';
import { BenchmarkError, failure } from './errors.js';
import { detailPath, createOutputRoot, createWorkRoot, cleanupWorkRoot, runTime } from './layout.js';
export { outputRoot } from './layout.js';

const activePath = (): string => path.join(localRoot(), 'active.json');
const save = (run: Run) => atomicJson(detailPath(run.root, 'state.json'), run);
interface Active { root: string; pid: number; creation: string }
function log(run: Run, message: string): void {
  console.error(message);
  fs.appendFileSync(detailPath(run.root, 'logs', 'events.ndjson'), JSON.stringify({ time: new Date().toISOString(), message }) + '\n');
}
function frozenPlan(run: Run) {
  return { schemaVersion: run.schemaVersion, toolVersion: run.toolVersion, root: run.root, workRoot: run.workRoot,
    time: run.time, presets: run.presets, config: run.config, targets: run.targets, steps: run.steps,
    userSid: run.userSid, nodePath: run.nodePath, nodeSha256: run.nodeSha256, toolRoot: run.toolRoot, toolManifest: run.toolManifest };
}
export function assertFrozenPlan(run: Run): void {
  const file = detailPath(run.root, 'plan.json');
  if (!run.planSha256 || sha256(file) !== run.planSha256 || JSON.stringify(readJson(file)) !== JSON.stringify(frozenPlan(run))) throw Error('Frozen test configuration or plan changed');
}
function clearActive(root: string): void {
  if (fs.existsSync(activePath()) && readJson<Active>(activePath()).root === root) fs.unlinkSync(activePath());
}
async function claim(root: string): Promise<void> {
  fs.mkdirSync(localRoot(), { recursive: true });
  const info = inspect();
  if (fs.existsSync(activePath())) {
    const old = readJson<Active>(activePath());
    let alive = false;
    try { alive = inspect(old.pid).creationFileTime100ns === old.creation; } catch { /* Previous process is gone. */ }
    if (alive) throw new BenchmarkError('RUN_BUSY', 'prepare', `Another benchmark is running: ${old.root}`);
    const current = detailPath(old.root, 'state.json');
    const stateFile = fs.existsSync(current) ? current : path.join(old.root, 'run.json');
    if (fs.existsSync(stateFile)) {
      const previous = readJson<Run>(stateFile);
      if (previous.startupCommand || previous.status === 'waiting-reboot') throw new BenchmarkError('RUN_BUSY', 'prepare', `A legacy cold task requires cleanup with its original tool version: ${old.root}`);
      previous.status = 'interrupted'; previous.error = 'Previous controller exited unexpectedly; no automatic resumption.';
      previous.failure = { code: 'INTERRUPTED', stage: 'measurement', message: previous.error };
      atomicJson(stateFile, previous);
      if (previous.schemaVersion === 2) { report(previous); cleanupWorkRoot(previous); }
    }
    fs.unlinkSync(activePath());
  }
  writeNewJson(activePath(), { root, pid: process.pid, creation: info.creationFileTime100ns });
}
function cleanup(run: Run): void {
  try { cleanupWorkRoot(run); }
  catch (error) { run.cleanupError = `Could not clean runtime workspace ${run.workRoot}: ${String(error)}`; }
}
export async function prepare(config: Config, check: () => void): Promise<Run> {
  validateConfig(config);
  if (config.out && fs.existsSync(config.out)) throw new BenchmarkError('OUTPUT_EXISTS', 'input', `Output already exists: ${config.out}`);
  let env: Record<string, unknown>, native;
  try { env = await environment(); check(); native = inspect(); assertDesktop(native); }
  catch (error) { const f = failure(error, 'ENVIRONMENT_NOT_READY', 'environment'); throw new BenchmarkError(f.code, f.stage, f.message); }
  const started = new Date();
  const root = createOutputRoot(config, localRoot(), started);
  fs.mkdirSync(detailPath(root)); fs.mkdirSync(detailPath(root, 'samples')); fs.mkdirSync(detailPath(root, 'logs'));
  await claim(root);
  let run: Run | undefined, workRoot: string | undefined;
  try {
    workRoot = createWorkRoot();
    if (isWithin(workRoot, root) || isWithin(root, workRoot)) throw Error('Results and runtime workspace must be separate.');
    fs.mkdirSync(path.join(workRoot, 'profiles'));
    const targets = [];
    for (const [index, input] of config.electrons.entries()) { check(); targets.push(await resolveTarget(input, index, root, workRoot)); }
    run = { schemaVersion: 2, toolVersion: readJson<{ version: string }>(path.join(TOOL_ROOT, 'package.json')).version,
      root, workRoot, time: runTime(started), presets: PRESET, config, targets, steps: plan(config), next: 0, status: 'prepared',
      lastBoot: native.bootId, userSid: native.userSid, nodePath: process.execPath, nodeSha256: sha256(process.execPath),
      toolRoot: TOOL_ROOT, toolManifest: [], environment: env, restartCount: 0 };
    run.toolManifest = ['dist', 'harness', 'native'].flatMap(dir => manifest(path.join(TOOL_ROOT, dir)).map(entry => ({ ...entry, path: `${dir}/${entry.path}` })));
    for (const target of targets) {
      check(); log(run, `Preflight ${target.id}: ${target.executable}`);
      fs.mkdirSync(target.profileTemplate);
      const sample = await launch(target, { id: `preflight-${target.id}`, phase: 'warm', target: targets.indexOf(target), round: 0, warmup: true }, target.profileTemplate, check, run.toolRoot);
      writeNewJson(detailPath(root, 'logs', `${sample.step.id}.json`), sample);
      if (!sample.valid) { check(); throw new BenchmarkError('PREFLIGHT_FAILED', 'prepare', `Preflight failed: ${sample.error}`); }
      const versions = (sample.raw.events as Record<string, any>[]).find(e => e.event === 'diagnostics')?.versions;
      if (!versions?.electron || Number(versions.electron.split('.')[0]) < 22) throw Error('Target must be Electron >=22');
      target.version = versions.electron;
      if (/^\d/.test(target.input) && target.input !== target.version) throw Error(`Downloaded version mismatch: ${target.input} / ${target.version}`);
      verifyTarget(target);
    }
    writeNewJson(detailPath(root, 'plan.json'), frozenPlan(run));
    run.planSha256 = sha256(detailPath(root, 'plan.json')); save(run);
    log(run, `Baseline: ${targets[0].id}\nTargets: ${targets.map(t => `${t.id}=${t.version}`).join(', ')}\nOutput: ${root}`);
    return run;
  } catch (error) {
    if (run) {
      run.failure = failure(error, 'PREPARATION_FAILED', 'prepare'); run.error = run.failure.message;
      run.status = run.failure.code === 'INTERRUPTED' ? 'interrupted' : 'failed'; cleanup(run); save(run); clearActive(root); return run;
    }
    if (workRoot) cleanupWorkRoot({ workRoot });
    clearActive(root); throw error;
  }
}
async function verifyInputs(run: Run): Promise<void> {
  for (const target of run.targets) verifyTarget(target);
  if (sha256(run.nodePath) !== run.nodeSha256) throw Error('Node runtime changed');
  for (const entry of run.toolManifest) if (sha256(path.join(run.toolRoot, entry.path)) !== entry.sha256) throw Error(`Tool input changed: ${entry.path}`);
}
export async function execute(run: Run, userCheck: () => void): Promise<void> {
  const check = () => { userCheck(); if (fs.existsSync(detailPath(run.root, 'STOP'))) throw new BenchmarkError('INTERRUPTED', 'measurement', 'STOP requested'); };
  try {
    validateConfig(run.config);
    const info = inspect();
    if (run.schemaVersion !== 2 || run.userSid !== info.userSid || run.lastBoot !== info.bootId) throw Error('Run identity or boot changed');
    assertDesktop(info); assertFrozenPlan(run);
    while (run.next < run.steps.length) {
      check(); assertFrozenPlan(run); const step = run.steps[run.next]; const current = inspect();
      if (current.bootId !== run.lastBoot) throw Error('Batch must remain in one boot');
      const target = run.targets[step.target], profile = path.join(run.workRoot, 'profiles', step.id);
      fs.cpSync(target.profileTemplate, profile, { recursive: true, force: false, errorOnExist: true });
      log(run, `[${run.next + 1}/${run.steps.length}] ${step.phase} ${target.id} ${step.warmup ? 'warmup' : 'formal'}: waiting for idle`);
      const idle = await waitIdle(detailPath(run.root, 'logs', `${step.id}-environment.ndjson`), check);
      run.pendingStep = step.id; run.status = 'running'; save(run);
      const sample = await launch(target, step, profile, check, run.toolRoot);
      sample.raw.environment = idle;
      writeNewJson(detailPath(run.root, 'samples', `${step.id}.json`), sample);
      try { await verifyInputs(run); }
      catch (error) { sample.valid = false; sample.error = String(error); sample.metrics = {}; atomicJson(detailPath(run.root, 'samples', `${step.id}.json`), sample); }
      if (!sample.valid) { check(); throw Error(sample.error ?? 'Invalid sample'); }
      run.next++; delete run.pendingStep; save(run); log(run, JSON.stringify(sample.metrics));
    }
    run.status = 'complete';
  } catch (error) {
    run.failure = failure(error, 'MEASUREMENT_FAILED', 'measurement'); run.error = run.failure.message;
    run.status = run.failure.code === 'INTERRUPTED' ? 'interrupted' : 'failed';
  } finally {
    cleanup(run); save(run); clearActive(run.root); log(run, `Task ${run.status}${run.error ? ': ' + run.error : ''}`);
  }
}
