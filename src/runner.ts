import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { phasesFor, plan, validateConfig } from './config.js';
import { PRESET, type Config, type Run } from './model.js';
import { atomicJson, readJson, writeNewJson, manifest, verifyManifest, sha256, isWithin } from './files.js';
import { TOOL_ROOT, localRoot, inspect, environment, assertDesktop, waitIdle, sleep, startup, startupCommand, reboot } from './windows.js';
import { copyTarget, resolveTarget, verifyTarget } from './targets.js';
import { launch } from './launch.js';
import { report } from './report.js';
import { BenchmarkError, failure } from './errors.js';
import { detailPath, createOutputRoot, createWorkRoot, cleanupWorkRoot, runTime } from './layout.js';
export { outputRoot } from './layout.js';

const activePath = (): string => path.join(localRoot(), 'active.json');
const save = (run: Run) => atomicJson(detailPath(run.root, 'state.json'), run);
interface Controller { pid: number; creation: string }
interface Active extends Controller { root: string; cold?: boolean }

function controllerAlive(owner: Controller, inspectProcess = inspect): boolean {
  try { return inspectProcess(owner.pid).creationFileTime100ns === owner.creation; }
  catch { return false; }
}
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
async function claim(root: string, cold: boolean): Promise<void> {
  fs.mkdirSync(localRoot(), { recursive: true });
  const info = inspect();
  if (fs.existsSync(activePath())) {
    const old = readJson<Active>(activePath());
    if (controllerAlive(old)) throw new BenchmarkError('RUN_BUSY', 'prepare', `Another benchmark is running: ${old.root}`);
    const current = detailPath(old.root, 'state.json');
    const stateFile = fs.existsSync(current) ? current : path.join(old.root, 'run.json');
    if (fs.existsSync(stateFile)) {
      const previous = readJson<Run>(stateFile);
      if (previous.startupCommand || previous.status === 'waiting-reboot') {
        if (!previous.startupCommand || stateFile !== current || !old.cold) {
          throw new BenchmarkError('RUN_BUSY', 'prepare', `A legacy cold task requires cleanup with its original tool version: ${old.root}`);
        }
        const marker = detailPath(old.root, 'logs', `restart-${previous.restartCount}.json`);
        if (fs.existsSync(marker) && controllerAlive(readJson<Controller>(marker))) {
          throw new BenchmarkError('RUN_BUSY', 'prepare', `A cold controller is resuming: ${old.root}`);
        }
        if (previous.status === 'waiting-reboot' && !fs.existsSync(marker) && !fs.existsSync(detailPath(old.root, 'STOP'))) {
          throw new BenchmarkError('RUN_BUSY', 'prepare', `Cold test is waiting for restart or sign-in: ${old.root}`);
        }
        await startup('remove', previous.startupCommand);
        delete previous.startupCommand;
        delete previous.cleanupError;
      }
      if (!isTerminal(previous)) {
        previous.status = 'interrupted'; previous.error = 'Previous controller exited unexpectedly or STOP was requested';
        previous.failure = { code: 'INTERRUPTED', stage: 'measurement', message: previous.error };
      }
      atomicJson(stateFile, previous);
      if (previous.schemaVersion === 2) { report(previous); cleanupWorkRoot(previous); }
    }
    fs.unlinkSync(activePath());
  }
  writeNewJson(activePath(), { root, pid: process.pid, creation: info.creationFileTime100ns, cold });
}
async function finalize(run: Run, changeStartup = startup): Promise<void> {
  save(run);
  await cleanup(run, changeStartup);
  save(run);
  report(run);
  if (!run.startupCommand) clearActive(run.root);
}

async function cleanup(run: Run, changeStartup: typeof startup): Promise<void> {
  const errors: string[] = [];
  if (run.startupCommand) {
    try {
      await changeStartup('remove', run.startupCommand);
      delete run.startupCommand;
    } catch (error) {
      errors.push(`Could not remove HKCU Run/ElectronBenchmarks (${run.startupCommand}): ${String(error)}`);
    }
  }
  if (!run.startupCommand) {
    try { cleanupWorkRoot(run); }
    catch (error) { errors.push(`Could not clean runtime workspace ${run.workRoot}: ${String(error)}`); }
  }
  if (errors.length) run.cleanupError = errors.join('\n');
  else delete run.cleanupError;
}

function freezeColdRuntime(run: Run): void {
  // Cache the pinned executable separately so Windows can clean the workspace
  // while that executable is still running.
  const cache = path.join(localRoot(), 'node', run.nodeSha256.slice(0, 16));
  fs.mkdirSync(cache, { recursive: true });
  run.nodePath = path.join(cache, 'node.exe');
  if (!fs.existsSync(run.nodePath)) {
    const temporary = path.join(cache, `node-${process.pid}.tmp`);
    fs.copyFileSync(process.execPath, temporary, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temporary, run.nodePath);
  }
  if (sha256(run.nodePath) !== run.nodeSha256) throw Error('Pinned Node runtime changed');

  run.toolRoot = path.join(run.workRoot, 'tool');
  for (const name of ['package.json', 'bin', 'dist', 'harness', 'native/windows-helper.exe']) {
    const destination = path.join(run.toolRoot, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(TOOL_ROOT, name), destination, { recursive: true, dereference: true });
  }
  run.toolManifest = manifest(run.toolRoot);
}

async function confirmCold(run: Run): Promise<void> {
  for (const phase of phasesFor(run.config.test)) {
    const count = run.steps.filter(step => step.phase === phase && !step.warmup).length;
    log(run, `${phase}: ${count / run.targets.length} formal samples per target`);
  }
  log(run, `${run.steps.filter(step => step.phase === 'cold').length} Windows restarts. Sign in after each restart unless automatic sign-in is configured.`);
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const abort = new AbortController();
  prompt.once('close', abortQuestion);
  prompt.once('SIGINT', abortQuestion);
  process.once('SIGINT', abortQuestion);
  process.once('SIGTERM', abortQuestion);
  let answer = '';
  try { answer = await prompt.question('Start the test and restart sequence? [y/N] ', { signal: abort.signal }); }
  catch (error) { if (!abort.signal.aborted) throw error; }
  finally {
    process.off('SIGINT', abortQuestion);
    process.off('SIGTERM', abortQuestion);
    prompt.close();
  }
  if (!/^y(es)?$/i.test(answer.trim())) throw new BenchmarkError('INTERRUPTED', 'consent', 'Restart sequence declined');

  function abortQuestion(): void { abort.abort(); }
}
export async function prepare(config: Config, check: () => void): Promise<Run> {
  validateConfig(config);
  const cold = phasesFor(config.test).includes('cold');
  if (config.out && fs.existsSync(config.out)) throw new BenchmarkError('OUTPUT_EXISTS', 'input', `Output already exists: ${config.out}`);
  let env: Record<string, unknown>, native;
  try { env = await environment(); check(); native = inspect(); assertDesktop(native); }
  catch (error) { const f = failure(error, 'ENVIRONMENT_NOT_READY', 'environment'); throw new BenchmarkError(f.code, f.stage, f.message); }
  const started = new Date();
  const root = createOutputRoot(config, localRoot(), started);
  fs.mkdirSync(detailPath(root)); fs.mkdirSync(detailPath(root, 'samples')); fs.mkdirSync(detailPath(root, 'logs'));
  await claim(root, cold);
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
    if (cold) freezeColdRuntime(run);
    else run.toolManifest = ['dist', 'harness', 'native'].flatMap(dir => manifest(path.join(TOOL_ROOT, dir)).map(entry => ({ ...entry, path: `${dir}/${entry.path}` })));
    for (const target of targets) {
      check();
      log(run, `Copying runtime files for ${target.id}`);
      copyTarget(target, run.workRoot);
      check();
      log(run, `Preflight ${target.id}: ${target.executable}`);
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
    if (cold) {
      const command = startupCommand(run.nodePath, path.join(run.toolRoot, 'bin', 'electron-benchmarks.js'));
      await startup('check', command);
      await confirmCold(run);
      check();
      run.startupCommand = command;
      save(run);
      await startup('install', command);
    }
    return run;
  } catch (error) {
    if (run) {
      run.failure = failure(error, 'PREPARATION_FAILED', 'prepare'); run.error = run.failure.message;
      run.status = run.failure.code === 'INTERRUPTED' ? 'interrupted' : 'failed';
      await finalize(run);
      return run;
    }
    if (workRoot) cleanupWorkRoot({ workRoot });
    clearActive(root); throw error;
  }
}
async function verifyInputs(run: Run): Promise<void> {
  for (const target of run.targets) verifyTarget(target);
  if (sha256(run.nodePath) !== run.nodeSha256) throw Error('Node runtime changed');
  if (run.startupCommand) verifyManifest(run.toolRoot, run.toolManifest);
  else for (const entry of run.toolManifest) if (sha256(path.join(run.toolRoot, entry.path)) !== entry.sha256) throw Error(`Tool input changed: ${entry.path}`);
}
export function loadColdRun(): Run | undefined {
  if (!fs.existsSync(activePath())) return;
  const active = readJson<Active>(activePath());
  const run = readJson<Run>(detailPath(active.root, 'state.json'));
  if (!run.startupCommand || run.root !== active.root || !runtimePathsMatch(run)) return;
  return run;
}

function isTerminal(run: Run): boolean {
  return run.status === 'complete' || run.status === 'failed' || run.status === 'interrupted';
}

function runtimePathsMatch(run: Run): boolean {
  return path.relative(run.toolRoot, TOOL_ROOT) === '' && path.relative(run.nodePath, process.execPath) === '' &&
    run.startupCommand === startupCommand(process.execPath, path.join(TOOL_ROOT, 'bin', 'electron-benchmarks.js'));
}

async function restartNext(run: Run, boot: string, check: () => void, ops: typeof system): Promise<never> {
  const total = run.steps.filter(step => step.phase === 'cold').length;
  if (run.restartCount >= total) throw Error('Restart budget exhausted');
  log(run, `Restart in 15 seconds (${run.restartCount + 1}/${total}). Ctrl+C or ${detailPath(run.root, 'STOP')} stops it.`);
  await ops.sleep(PRESET.restartCountdownMs, check);
  ops.assertDesktop(ops.inspect());
  run.restartCount++;
  run.lastBoot = boot;
  run.status = 'waiting-reboot';
  save(run);
  report(run);
  check();
  await ops.reboot();
  await ops.sleep(60_000, check);
  throw Error('Windows did not restart within 60 seconds');
}

const system = { inspect, assertDesktop, waitIdle, sleep, reboot, launch, startup, runtimePathsMatch };

export async function execute(run: Run, userCheck: () => void, continuing = false, ops = system): Promise<boolean> {
  const check = () => {
    userCheck();
    if (fs.existsSync(detailPath(run.root, 'STOP'))) throw new BenchmarkError('INTERRUPTED', 'measurement', 'STOP requested');
  };
  let owned = !continuing;
  try {
    const info = ops.inspect();
    if (continuing) {
      if (!fs.existsSync(activePath())) return false;
      const active = readJson<Active>(activePath());
      if (active.root !== run.root || info.userSid !== run.userSid || !ops.runtimePathsMatch(run)) return false;
      if (controllerAlive(active, ops.inspect)) return false;
      const stop = fs.existsSync(detailPath(run.root, 'STOP'));
      if (run.status === 'waiting-reboot' && run.lastBoot === info.bootId && !stop) return false;
      // A durable per-restart claim distinguishes a duplicate controller from
      // an abandoned attempt. Only the first controller may sample.
      let abandoned = false;
      const marker = detailPath(run.root, 'logs', `restart-${run.restartCount}.json`);
      const owner = { pid: process.pid, creation: info.creationFileTime100ns };
      try { writeNewJson(marker, { ...owner, boot: info.bootId }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let previous: Controller | undefined;
        try { previous = readJson<Controller>(marker); }
        catch {
          // An exclusive marker can be observed while its owner writes it.
          await ops.sleep(250, userCheck);
          if (!fs.existsSync(activePath())) return false;
          if (controllerAlive(readJson<Active>(activePath()), ops.inspect)) return false;
          try { previous = readJson<Controller>(marker); } catch { /* Partial claim abandoned. */ }
        }
        if (previous && controllerAlive(previous, ops.inspect)) return false;
        abandoned = true;
      }
      atomicJson(activePath(), { ...active, ...owner });
      owned = true;
      if (isTerminal(run)) return true;
      check();
      if (abandoned) throw Error('Previous continuation exited unexpectedly; the sample will not be replayed');
    }
    validateConfig(run.config);
    if (run.schemaVersion !== 2 || run.userSid !== info.userSid) throw Error('Run identity changed');
    ops.assertDesktop(info);
    assertFrozenPlan(run);
    if (continuing) {
      if (run.status !== 'waiting-reboot' || run.pendingStep || run.steps[run.next]?.phase !== 'cold') {
        throw Error('Unexpected controller exit or invalid restart state');
      }
    } else if (run.lastBoot !== info.bootId) throw Error('Initial boot changed');
    while (run.next < run.steps.length) {
      check();
      assertFrozenPlan(run);
      const step = run.steps[run.next], current = ops.inspect();
      if (current.bootId !== info.bootId) throw Error('Boot changed during execution');
      if (step.phase === 'cold' && run.lastBoot === current.bootId) await restartNext(run, current.bootId, check, ops);
      const target = run.targets[step.target], profile = path.join(run.workRoot, 'profiles', step.id);
      fs.cpSync(target.profileTemplate, profile, { recursive: true, force: false, errorOnExist: true });
      log(run, `[${run.next + 1}/${run.steps.length}] ${step.phase} ${target.id} ${step.warmup ? 'warmup' : 'formal'}: waiting for idle`);
      const idle = await ops.waitIdle(detailPath(run.root, 'logs', `${step.id}-environment.ndjson`), check);
      run.pendingStep = step.id;
      run.status = 'running';
      run.lastBoot = current.bootId;
      save(run);
      const sample = await ops.launch(target, step, profile, check, run.toolRoot);
      sample.raw.environment = idle;
      if (step.phase === 'cold') sample.raw.restart = { number: run.restartCount, bootId: current.bootId };
      try { await verifyInputs(run); }
      catch (error) { sample.valid = false; sample.error = String(error); sample.metrics = {}; }
      writeNewJson(detailPath(run.root, 'samples', `${step.id}.json`), sample);
      if (!sample.valid) { check(); throw Error(sample.error ?? 'Invalid sample'); }
      run.next++;
      delete run.pendingStep;
      save(run);
      log(run, JSON.stringify(sample.metrics));
    }
    run.status = 'complete';
  } catch (error) {
    if (!owned) throw error;
    run.failure = failure(error, 'MEASUREMENT_FAILED', 'measurement'); run.error = run.failure.message;
    run.status = run.failure.code === 'INTERRUPTED' ? 'interrupted' : 'failed';
  } finally {
    if (owned) {
      await finalize(run, ops.startup);
      log(run, `Task ${run.status}${run.error ? ': ' + run.error : ''}`);
    }
  }
  return true;
}
