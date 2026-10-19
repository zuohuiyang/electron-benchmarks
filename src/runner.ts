import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { plan } from './config.js';
import { PRESET, type Config, type Run } from './model.js';
import { atomicJson, readJson, writeNewJson, manifest, verifyManifest, sha256, isWithin } from './files.js';
import { TOOL_ROOT, localRoot, inspect, environment, assertDesktop, startup, startupCommand, waitIdle, sleep, reboot } from './windows.js';
import { resolveTarget, verifyTarget } from './targets.js';
import { launch } from './launch.js';
import { report } from './report.js';

const activePath = (): string => path.join(localRoot(), 'active.json');
const save = (run: Run) => atomicJson(path.join(run.root, 'run.json'), run);
interface Active { root: string; pid: number; creation: string }
function frozenPlan(run: Run) {
  return { schemaVersion: run.schemaVersion, toolVersion: run.toolVersion, root: run.root, config: run.config,
    targets: run.targets, steps: run.steps, userSid: run.userSid, nodePath: run.nodePath,
    nodeSha256: run.nodeSha256, toolRoot: run.toolRoot, toolManifest: run.toolManifest };
}
export function assertFrozenPlan(run: Run): void {
  const file = path.join(run.root, 'plan.json');
  if (!run.planSha256 || sha256(file) !== run.planSha256 || JSON.stringify(readJson(file)) !== JSON.stringify(frozenPlan(run))) throw Error('Frozen test configuration or plan changed');
}
export function resumeAllowed(run: Pick<Run, 'status' | 'pendingStep' | 'lastBoot'>, boot: string): boolean {
  return run.status === 'waiting-reboot' && !run.pendingStep && run.lastBoot !== boot;
}
export function toolCopy(source: string, destination: string): void {
  if (isWithin(destination, source)) throw Error('Cold output must be outside the installed tool directory.');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['bin', 'dist', 'harness', 'tools/windows/autologon.ps1', 'native/windows-helper.exe', 'package.json', 'scripts/extract.ps1']) {
    const from = path.join(source, name), to = path.join(destination, name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, dereference: true, errorOnExist: true, force: false });
  }
  copyDependencies(source, destination);
  fs.copyFileSync(process.execPath, path.join(destination, 'node.exe'));
}
// npm may hoist dependencies OUTSIDE the installed package. Resolve their actual
// locations, then build a self-contained dependency tree in the frozen snapshot.
export function copyDependencies(source: string, destination: string, ancestry: string[] = []): void {
  const pkg = readJson<{ dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>(path.join(source, 'package.json'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw Error(`Invalid dependency name: ${name}`);
    let base = source; let found: string | undefined;
    while (true) {
      const candidate = path.join(base, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) { found = fs.realpathSync(candidate); break; }
      const parent = path.dirname(base); if (parent === base) break; base = parent;
    }
    if (!found) {
      if (name in (pkg.optionalDependencies ?? {})) continue;
      throw Error(`Runtime dependency missing: ${name}`);
    }
    if (ancestry.includes(found)) throw Error(`Cyclic runtime dependency unsupported in cold snapshot: ${name}`);
    const to = path.join(destination, 'node_modules', name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(found, to, { recursive: true, dereference: true, errorOnExist: true, force: false,
      filter: from => path.basename(from) !== 'node_modules' });
    copyDependencies(found, to, [...ancestry, found]);
  }
}
async function clearRegistration(run: Run): Promise<void> {
  if (run.startupCommand) {
    try { await startup('remove', run.startupCommand); }
    catch (error) {
      run.cleanupError = `Could not remove HKCU Run/ElectronBenchmarks: ${String(error)}. Delete ONLY the entry matching ${run.startupCommand}`;
    }
  }
}
function clearActive(run: Run): void {
  if (fs.existsSync(activePath()) && readJson<Active>(activePath()).root === run.root) fs.unlinkSync(activePath());
}
async function claim(root: string): Promise<void> {
  fs.mkdirSync(localRoot(), { recursive: true });
  const info = inspect();
  if (fs.existsSync(activePath())) {
    const old = readJson<Active>(activePath());
    let alive = false;
    try { alive = inspect(old.pid).creationFileTime100ns === old.creation; } catch { /* Previous process is gone. */ }
    if (alive) throw Error(`Another benchmark is running: ${old.root}`);
    const stateFile = path.join(old.root, 'run.json');
    if (fs.existsSync(stateFile)) {
      const previous = readJson<Run>(stateFile);
      if (previous.status === 'waiting-reboot' && !fs.existsSync(path.join(old.root, 'STOP'))) throw Error(`Cold test is waiting for reboot/login: ${old.root}. To stop it, create a STOP file there and run this command again.`);
      previous.status = 'interrupted'; previous.error = 'Previous controller exited unexpectedly; no automatic resumption.';
      await clearRegistration(previous); save(previous); report(previous);
      if (previous.cleanupError) throw Error(previous.cleanupError);
    } else console.warn(`Previous preparation was interrupted before registration: ${old.root}`);
    fs.unlinkSync(activePath());
  }
  writeNewJson(activePath(), { root, pid: process.pid, creation: info.creationFileTime100ns });
}
async function consent(message: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Cold/all requires an interactive terminal for reboot consent.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^(y|yes)$/i.test((await rl.question(message)).trim()); } finally { rl.close(); }
}
export async function prepare(config: Config, check: () => void): Promise<Run> {
  const cold = config.test === 'all' || config.scenario === 'cold';
  const root = path.resolve(config.out ?? path.join(localRoot(), 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`));
  if (fs.existsSync(root)) throw Error(`Output already exists: ${root}`);
  if (cold && isWithin(root, TOOL_ROOT)) throw Error('For cold/all, use a persistent output outside the installed tool/source directory.');
  const env = await environment(); check();
  const native = inspect(); assertDesktop(native);
  await claim(root);
  let run: Run | undefined;
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(root, 'samples')); fs.mkdirSync(path.join(root, 'profiles'));
    const targets = [];
    for (const [index, input] of config.electrons.entries()) { check(); targets.push(await resolveTarget(input, index, root)); }
    run = { schemaVersion: 1, toolVersion: readJson<{ version: string }>(path.join(TOOL_ROOT, 'package.json')).version,
      root, config, targets, steps: plan(config), next: 0, status: 'prepared', lastBoot: native.bootId, userSid: native.userSid,
      nodePath: process.execPath, nodeSha256: sha256(process.execPath), toolRoot: TOOL_ROOT, toolManifest: [], environment: env, restartCount: 0 };
    if (cold) {
      toolCopy(TOOL_ROOT, path.join(root, 'tool'));
      run.toolRoot = path.join(root, 'tool'); run.nodePath = path.join(run.toolRoot, 'node.exe');
      run.toolManifest = manifest(run.toolRoot);
    } else {
      // Freeze just the executable tool inputs, not source files or output directories.
      run.toolManifest = ['dist', 'harness', 'native'].flatMap(dir => manifest(path.join(TOOL_ROOT, dir)).map(entry => ({ ...entry, path: `${dir}/${entry.path}` })));
    }
    for (const target of targets) {
      check(); console.log(`Preflight ${target.id}: ${target.executable}`);
      fs.mkdirSync(target.profileTemplate);
      const sample = await launch(target, { id: `preflight-${target.id}`, phase: 'warm', target: targets.indexOf(target), round: 0, warmup: true }, target.profileTemplate, check, run.toolRoot);
      writeNewJson(path.join(root, `${sample.step.id}.json`), sample);
      if (!sample.valid) throw Error(`Preflight failed: ${sample.error}`);
      const events = sample.raw.events as Record<string, any>[];
      const versions = events.find(e => e.event === 'diagnostics')?.versions;
      if (!versions?.electron || Number(versions.electron.split('.')[0]) < 22) throw Error('Target must be Electron >=22');
      target.version = versions.electron;
      if (String(target.input).match(/^\d/) && target.input !== target.version) throw Error(`Downloaded version mismatch: ${target.input} / ${target.version}`);
      verifyTarget(target);
      // Distributions are shared across samples; profiles never are.
    }
    writeNewJson(path.join(root, 'plan.json'), frozenPlan(run));
    run.planSha256 = sha256(path.join(root, 'plan.json'));
    save(run);
    console.log(`Baseline: ${targets[0].id}\nTargets: ${targets.map(t => `${t.id}=${t.version}`).join(', ')}\nFormal runs: ${run.steps.filter(s => !s.warmup).length}\nOutput: ${root}`);
    for (const phase of [...new Set(run.steps.map(step => step.phase))]) {
      const steps = run.steps.filter(step => step.phase === phase);
      console.log(`${phase}: ${steps.filter(step => !step.warmup).length / targets.length} formal runs and ${steps.filter(step => step.warmup).length / targets.length} warmups per target`);
    }
    if (run.steps.some(step => step.phase === 'memory' || step.phase === 'cpu')) console.log(`Resources: settle ${PRESET.settleMs / 1000}s, observe ${PRESET.observeMs / 1000}s, sample every ${PRESET.sampleMs / 1000}s`);
    if (cold) {
      const autologon = env.autologon as Record<string, unknown>;
      if (autologon.configured !== true) console.log('Automatic login is not verified. Sign in after every reboot, or configure it separately with tools/windows/autologon.ps1 enable -AutologonPath <official tool path>.');
      console.log(`Cold samples: ${run.steps.filter(s => s.phase === 'cold').length} independent reboot cycles. Tool and Node pinned in ${run.toolRoot}. A temporary HKCU Run entry will be installed; no scheduled tasks. Ctrl+C / STOP file cancels.`);
      if (!await consent('Start this test and its reboot sequence? [y/N] ')) {
        run.status = 'interrupted'; run.error = 'User declined reboot sequence'; save(run); console.log(report(run)); clearActive(run); return run;
      }
      check();
      run.startupCommand = startupCommand(run.nodePath, path.join(run.toolRoot, 'bin/electron-bench.js'), run.root);
      save(run); await startup('install', run.startupCommand);
    }
    return run;
  } catch (error) {
    if (run) { run.status = 'failed'; run.error = String(error); await clearRegistration(run); save(run); console.error(report(run)); clearActive(run); }
    else if (fs.existsSync(activePath()) && readJson<Active>(activePath()).root === root) fs.unlinkSync(activePath());
    throw error;
  }
}
async function verifyInputs(run: Run): Promise<void> {
  for (const target of run.targets) verifyTarget(target);
  if (sha256(run.nodePath) !== run.nodeSha256) throw Error('Pinned Node runtime changed');
  if (run.config.test === 'all' || run.config.scenario === 'cold') verifyManifest(run.toolRoot, run.toolManifest);
  else for (const entry of run.toolManifest) if (sha256(path.join(run.toolRoot, entry.path)) !== entry.sha256) throw Error(`Tool input changed: ${entry.path}`);
}
async function restartNext(run: Run, check: () => void): Promise<never> {
  check(); const info = inspect(); assertDesktop(info);
  const max = run.steps.filter(s => s.phase === 'cold').length;
  if (run.restartCount >= max) throw Error('Reboot budget exhausted');
  console.log(`Reboot in 15 seconds (${run.restartCount + 1}/${max}); Ctrl+C or ${path.join(run.root, 'STOP')} stops it.`);
  await sleep(PRESET.restartCountdownMs, check);
  run.restartCount++; run.lastBoot = info.bootId; run.status = 'waiting-reboot'; save(run);
  await reboot();
  await sleep(60_000, check);
  throw Error('Windows did not restart; automatic retries disabled.');
}
export async function execute(run: Run, userCheck: () => void, continuing = false): Promise<void> {
  const check = () => { userCheck(); if (fs.existsSync(path.join(run.root, 'STOP'))) throw Error('STOP requested'); };
  const info = inspect();
  try {
    if (run.schemaVersion !== 1 || run.userSid !== info.userSid) throw Error('Run identity is incompatible');
    assertDesktop(info);
    assertFrozenPlan(run);
    if (continuing) {
      if (!fs.existsSync(activePath()) || readJson<Active>(activePath()).root !== run.root) throw Error('No matching active cold task');
      if (['complete', 'failed', 'interrupted'].includes(run.status)) { await clearRegistration(run); clearActive(run); return; }
      if (!resumeAllowed(run, info.bootId)) throw Error('Not a normal post-reboot continuation; refusing to replay or resume an interrupted sample');
      if (run.toolRoot !== TOOL_ROOT || run.nodePath.toLowerCase() !== process.execPath.toLowerCase()) throw Error('Tool/runtime path changed');
      // Hashes are checked AFTER the cold endpoint, avoiding pre-reading frozen scenario/media files.
      atomicJson(activePath(), { root: run.root, pid: process.pid, creation: info.creationFileTime100ns });
    }
    while (run.next < run.steps.length) {
      check(); assertFrozenPlan(run); const step = run.steps[run.next]; const current = inspect();
      if (step.phase === 'cold' && current.bootId === run.lastBoot) await restartNext(run, check);
      if (step.phase === 'warm') {
        if (run.warmBoot && run.warmBoot !== current.bootId) throw Error('Warm batch must remain in one boot');
        run.warmBoot = current.bootId;
      }
      const target = run.targets[step.target];
      const profile = path.join(run.root, 'profiles', step.id);
      fs.cpSync(target.profileTemplate, profile, { recursive: true, force: false, errorOnExist: true });
      console.log(`[${run.next + 1}/${run.steps.length}] ${step.phase} ${target.id} ${step.warmup ? 'warmup' : 'formal'}: waiting for idle`);
      const idle = await waitIdle(path.join(run.root, `${step.id}-environment.ndjson`), check);
      run.pendingStep = step.id; run.status = 'running'; save(run);
      const sample = await launch(target, step, profile, check, run.toolRoot);
      sample.raw.environment = idle;
      run.lastBoot = current.bootId;
      // Persist before verifying so errors never erase a measured attempt.
      writeNewJson(path.join(run.root, 'samples', `${step.id}.json`), sample);
      try { await verifyInputs(run); }
      catch (error) { sample.valid = false; sample.error = String(error); sample.metrics = {}; atomicJson(path.join(run.root, 'samples', `${step.id}.json`), sample); }
      if (!sample.valid) throw Error(sample.error ?? 'Invalid sample');
      run.next++; delete run.pendingStep; save(run);
      console.log(JSON.stringify(sample.metrics));
    }
    run.status = 'complete';
  } catch (error) {
    run.status = /STOP|interrupt/i.test(String(error)) ? 'interrupted' : 'failed'; run.error = String(error);
  } finally {
    await clearRegistration(run); save(run); clearActive(run); console.log(report(run));
  }
  if (run.status !== 'complete' || run.cleanupError) process.exitCode = 1;
}
