import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { isVersion, phasesFor } from './config.js';
import { BenchmarkError, failure, failureExitCode, type Failure } from './errors.js';
import { atomicJson, isWithin, manifest, readJson, sha256, writeNewJson } from './files.js';
import { cleanupWorkRoot, createWorkRoot, detailPath } from './layout.js';
import type { Config, Run } from './model.js';
import { PRESET } from './model.js';
import { report, resultExitCode } from './report.js';
import { abandonQueueRun, activePath, claim, clearActive, confirmRestart, execute, freezeColdRuntime, prepare, runtimePathsMatch, type QueueRuntime } from './runner.js';
import { cacheRelease } from './targets.js';
import { assertDesktop, inspect, localRoot, startup, startupCommand, TOOL_ROOT } from './windows.js';

type JobStatus = 'pending' | 'running' | 'complete' | 'failed' | 'interrupted';
interface Job {
  config: Config;
  status: JobStatus;
  summary: string | null;
  error: Failure | null;
}
interface Queue extends QueueRuntime {
  workRoot?: string;
  userSid: string;
  jobs: Job[];
  next: number;
  status: Exclude<JobStatus, 'pending'>;
  error: Failure | null;
}

const queueFile = (root: string) => path.join(root, 'state.json');
export const summaryPath = (root: string) => path.join(root, 'summary.json');
const save = (queue: Queue) => atomicJson(queueFile(queue.queue), queue);
const system = { inspect, assertDesktop, claim, prepare, execute, confirmRestart, cacheRelease,
  startup, runtimePathsMatch, freezeColdRuntime, cleanupWorkRoot, report, abandonQueueRun };
const control = () => readJson<{ root: string; queue?: string; pid: number; creation: string }>(activePath());

function publish(queue: Queue) {
  const summary = {
    schemaVersion: 3, kind: 'queue', status: queue.status, completed: queue.next,
    total: queue.jobs.length, error: queue.error,
    jobs: queue.jobs.map(({ config, status, summary, error }) => ({
      test: config.test, deployTo: config.deployTo ?? null, out: config.out ?? null, status, summary, error
    }))
  };
  atomicJson(summaryPath(queue.queue), summary);
  return { summary, file: summaryPath(queue.queue),
    exitCode: queue.status === 'complete' ? 0 : queue.error ? failureExitCode(queue.error) : 1 };
}

function stopCheck(root: string, check: () => void): void {
  check();
  if (fs.existsSync(path.join(root, 'STOP'))) throw new BenchmarkError('INTERRUPTED', 'measurement', 'STOP requested');
}

async function drive(queue: Queue, check: () => void, ops: typeof system, resumed?: Run) {
  const guard = () => stopCheck(queue.queue, check);
  try {
    while (queue.next < queue.jobs.length) {
      const job = queue.jobs[queue.next];
      if (!resumed) guard();
      console.error(`Job ${queue.next + 1}/${queue.jobs.length}: ${job.config.test}${job.config.deployTo ? ` on ${job.config.deployTo}` : ''}`);
      if (!resumed) {
        job.status = 'running';
        save(queue);
        publish(queue);
      }
      const run = resumed ?? await ops.prepare(job.config, guard, {
        queue: queue.queue, toolRoot: queue.toolRoot, toolManifest: queue.toolManifest,
        nodePath: queue.nodePath, nodeSha256: queue.nodeSha256, startupCommand: queue.startupCommand
      });
      if ((resumed || run.status === 'prepared') && !await ops.execute(run, guard, Boolean(resumed))) return;
      resumed = undefined;
      const result = ops.report(run);
      job.summary = summaryPath(run.root);
      if (resultExitCode(result)) {
        const detail = result.cleanupError ?? result.error ??
          { code: 'INCOMPLETE_DATA', stage: 'measurement', message: 'Job did not collect complete data' };
        throw new BenchmarkError(detail.code, detail.stage, detail.message);
      }
      job.status = 'complete';
      queue.next++;
      save(queue);
      publish(queue);
    }
    queue.status = 'complete';
  } catch (error) {
    fail(queue, error);
  }
  return finish(queue, ops);
}

function fail(queue: Queue, error: unknown): void {
  queue.error = failure(error, 'QUEUE_FAILED', 'prepare');
  queue.status = queue.error.code === 'INTERRUPTED' ? 'interrupted' : 'failed';
  const job = queue.jobs[queue.next];
  if (job?.status === 'running') {
    job.status = queue.status;
    job.error = queue.error;
  }
}

async function finish(queue: Queue, ops: typeof system) {
  // Persist the result before removing the login entry, so a later login can
  // retry interrupted finalization without replaying any samples.
  save(queue);
  publish(queue);
  try {
    if (queue.startupCommand) await ops.startup('remove', queue.startupCommand);
  } catch (error) {
    cleanupFailure(queue, error);
    save(queue);
    return publish(queue);
  }
  try {
    if (queue.workRoot) ops.cleanupWorkRoot({ workRoot: queue.workRoot });
  } catch (error) {
    cleanupFailure(queue, error);
  } finally {
    const active = control();
    if (active.queue === queue.queue) clearActive(active.root);
  }
  save(queue);
  return publish(queue);
}

function cleanupFailure(queue: Queue, error: unknown): void {
  const cleanup = failure(error, 'QUEUE_CLEANUP_FAILED', 'cleanup');
  if (queue.error) {
    queue.error = { ...queue.error, message: `${queue.error.message}; ${cleanup.message}` };
  } else {
    queue.status = 'failed';
    queue.error = cleanup;
  }
}

export async function startQueue(configs: Config[], check: () => void, ops = system) {
  const info = ops.inspect();
  ops.assertDesktop(info);
  const root = path.join(localRoot(), 'queues', 'runs', randomUUID());
  const queue: Queue = {
    queue: root, jobs: configs.map(config => ({ config, status: 'pending', summary: null, error: null })),
    next: 0, status: 'running', error: null, userSid: info.userSid, toolRoot: TOOL_ROOT,
    toolManifest: [], nodePath: process.execPath, nodeSha256: sha256(process.execPath)
  };
  // Keep the queue report separate from every job output, even if a user picked
  // an output under the account workspace.
  if (configs.some(({ out }) => out && (isWithin(root, out) || isWithin(out, root)))) {
    throw new BenchmarkError('INVALID_INPUT', 'input', 'Job outputs must be separate from the queue directory');
  }
  const restarts = configs.reduce((total, config) => total + (phasesFor(config.test).includes('cold')
    ? config.electrons.length * (config.repeat ?? PRESET.startupRepeat) : 0), 0);
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.mkdirSync(root);
  try {
    await ops.claim(root, restarts > 0, root);
  } catch (error) {
    fs.rmdirSync(root);
    throw error;
  }
  console.error(`Summary: ${summaryPath(root)}`);
  try {
    save(queue);
    publish(queue);
    if (restarts) {
      console.error(`${configs.length} jobs, ${restarts} Windows restarts. Sign in after each restart unless automatic sign-in is configured.`);
      await ops.confirmRestart();
      stopCheck(root, check);
      // The frozen controller can run entirely from its own copy after login.
      // Fill the version cache while the original package dependencies are available.
      for (const version of new Set(configs.flatMap(config => config.electrons).filter(isVersion))) {
        stopCheck(root, check);
        await ops.cacheRelease(version);
      }
      const workRoot = createWorkRoot();
      queue.workRoot = workRoot;
      const runtime = { ...queue, workRoot };
      ops.freezeColdRuntime(runtime);
      Object.assign(queue, { nodePath: runtime.nodePath, toolRoot: runtime.toolRoot, toolManifest: runtime.toolManifest });
      const command = startupCommand(queue.nodePath, path.join(queue.toolRoot, 'bin', 'electron-benchmarks.js'));
      await ops.startup('check', command);
      queue.startupCommand = command;
      save(queue);
      await ops.startup('install', command);
    } else {
      queue.toolManifest = ['dist', 'harness', 'native'].flatMap(dir =>
        manifest(path.join(TOOL_ROOT, dir)).map(entry => ({ ...entry, path: `${dir}/${entry.path}` })));
    }
  } catch (error) {
    fail(queue, error);
    return finish(queue, ops);
  }
  return drive(queue, check, ops);
}

export async function resumeQueue(check: () => void, ops = system): Promise<{ handled: boolean; result?: Awaited<ReturnType<typeof drive>> }> {
  if (!fs.existsSync(activePath())) return { handled: false };
  const active = control();
  if (!active.queue) return { handled: false };
  const queue = readJson<Queue>(queueFile(active.queue));
  const info = ops.inspect();
  if (queue.queue !== active.queue || queue.userSid !== info.userSid || !ops.runtimePathsMatch(queue)) return { handled: true };
  const current = detailPath(active.root, 'state.json');
  if (ownerAlive(active, ops.inspect)) return { handled: true };
  if (queue.status === 'running' && fs.existsSync(current)) {
    const run = readJson<Run>(current);
    const job = queue.jobs[queue.next];
    if (job?.status === 'running' && run.root === active.root && run.queue === queue.queue &&
        JSON.stringify(run.config) === JSON.stringify(job.config)) {
      return { handled: true, result: await drive(queue, check, ops, run) };
    }
  }
  return { handled: true, result: await recover(queue, active.root, ops) };
}

// A foreground invocation can release an abandoned queue before its login
// command was registered, or a queue that never needed to reboot.
export async function recoverInactiveQueue(ops = system): Promise<void> {
  if (!fs.existsSync(activePath())) return;
  const active = control();
  if (!active.queue || ownerAlive(active, ops.inspect)) return;
  const file = queueFile(active.queue);
  if (!fs.existsSync(file)) {
    clearActive(active.root);
    return;
  }
  const queue = readJson<Queue>(file);
  if (queue.queue !== active.queue || queue.userSid !== ops.inspect().userSid) return;
  if (queue.status === 'running' && queue.startupCommand) return;
  await recover(queue, active.root, ops);
}

function ownerAlive(owner: { pid: number; creation: string }, inspectProcess: typeof inspect): boolean {
  try { return inspectProcess(owner.pid).creationFileTime100ns === owner.creation; }
  catch { return false; }
}

async function recover(queue: Queue, currentRoot: string, ops: typeof system) {
  // Serialize recovery so an abandoned job can never be measured twice.
  const info = ops.inspect();
  // A marker is scoped to the abandoned owner. Taking ownership makes the
  // next recovery use a fresh marker if this controller also exits.
  const active = control();
  if (active.root !== currentRoot || active.queue !== queue.queue || ownerAlive(active, ops.inspect)) return;
  const owner = { pid: process.pid, creation: info.creationFileTime100ns };
  const candidate = path.join(queue.queue, `recovery-${randomUUID()}.next`);
  fs.mkdirSync(candidate);
  const candidateOwner = path.join(candidate, 'owner.json');
  try {
    writeNewJson(candidateOwner, owner);
    for (let attempt = 0; ; attempt++) {
      const marker = path.join(queue.queue, `recovery-${active.pid}-${active.creation}-${attempt}`);
      try { fs.renameSync(candidate, marker); }
      catch (error) {
        const existingOwner = path.join(marker, 'owner.json');
        if (!fs.existsSync(existingOwner)) throw error;
        const previous = readJson<typeof owner>(existingOwner);
        if (ownerAlive(previous, ops.inspect)) return;
        continue;
      }
      const latest = control();
      if (latest.pid !== active.pid || latest.creation !== active.creation || latest.queue !== active.queue) return;
      atomicJson(activePath(), { ...active, ...owner });
      break;
    }
  } finally {
    if (fs.existsSync(candidateOwner)) fs.unlinkSync(candidateOwner);
    if (fs.existsSync(candidate)) fs.rmdirSync(candidate);
  }
  if (queue.status === 'running') fail(queue, Error('Queue controller exited unexpectedly'));
  const current = detailPath(currentRoot, 'state.json');
  if (fs.existsSync(current)) {
    const run = readJson<Run>(current);
    const job = queue.jobs[queue.next];
    if (run.queue === queue.queue && job && JSON.stringify(run.config) === JSON.stringify(job.config)) {
      try {
        await ops.abandonQueueRun(run, queue.error);
        job.summary = summaryPath(run.root);
      } catch (error) { cleanupFailure(queue, error); }
    }
  }
  return finish(queue, ops);
}
