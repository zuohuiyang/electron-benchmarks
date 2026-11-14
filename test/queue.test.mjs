import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { activePath } from '../dist/runner.js';
import { recoverInactiveQueue, resumeQueue, startQueue } from '../dist/queue.js';

function fixture(t) {
  fs.mkdirSync('.test-output', { recursive: true });
  const base = fs.mkdtempSync(path.resolve('.test-output/queue-'));
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = base;
  t.after(() => {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    fs.rmSync(base, { recursive: true, force: true });
  });
  const jobs = ['ssd', 'hdd'].map(drive => ({
    test: 'startup:all', electrons: [path.join(base, 'electron.exe')], repeat: 1,
    deployTo: path.join(base, drive), out: path.join(base, 'reports', drive)
  }));
  const events = [];
  const ops = {
    inspect(pid) {
      if (pid !== undefined) throw Error('Old controller exited');
      return { userSid: 'fixture', creationFileTime100ns: 'new' };
    },
    assertDesktop() {},
    claim(root, cold, queue) {
      fs.writeFileSync(activePath(), JSON.stringify({ root, cold, queue, pid: 1, creation: 'old' }));
    },
    confirmRestart() { events.push('confirm'); },
    startup(action) { events.push(action); },
    freezeColdRuntime() {},
    runtimePathsMatch(runtime) { return Boolean(runtime.startupCommand); },
    cleanupWorkRoot() { events.push('clean'); },
    abandonQueueRun() { events.push('abandon'); },
    prepare(config, check, runtime) {
      check();
      events.push(`prepare:${path.basename(config.deployTo)}`);
      const run = { root: config.out, config, ...runtime, status: 'prepared' };
      ops.claim(run.root, true, run.queue);
      fs.mkdirSync(path.join(run.root, 'detail'), { recursive: true });
      return run;
    },
    execute(run, check, continuing) {
      check();
      events.push(`${continuing ? 'resume' : 'start'}:${path.basename(run.root)}`);
      if (!continuing) {
        run.status = 'waiting-reboot';
        fs.writeFileSync(path.join(run.root, 'detail', 'state.json'), JSON.stringify(run));
        return false;
      }
      run.status = 'complete';
      return true;
    },
    report(run) {
      const result = { status: run.status, dataComplete: run.status === 'complete', error: run.failure };
      fs.writeFileSync(path.join(run.root, 'summary.json'), JSON.stringify(result));
      return result;
    }
  };
  return { jobs, events, ops };
}

test('queue confirms once, resumes each job and returns one terminal report path', async t => {
  const { jobs, events, ops } = fixture(t);
  assert.equal(await startQueue(jobs, () => {}, ops), undefined);
  const root = JSON.parse(fs.readFileSync(activePath())).queue;
  const file = path.join(root, 'summary.json');
  assert.equal(JSON.parse(fs.readFileSync(file)).status, 'running');

  assert.deepEqual(await resumeQueue(() => {}, ops), { handled: true, result: undefined });
  assert.equal(JSON.parse(fs.readFileSync(file)).completed, 1);

  const { result } = await resumeQueue(() => {}, ops);
  assert.equal(result.file, file);
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.status, 'complete');
  assert.equal(result.summary.completed, 2);
  assert.deepEqual(result.summary.jobs.map(job => job.summary), jobs.map(job => path.join(job.out, 'summary.json')));
  assert.deepEqual(result.summary, JSON.parse(fs.readFileSync(file)));
  assert.equal(fs.existsSync(activePath()), false);
  assert.deepEqual(events, ['confirm', 'check', 'install', 'prepare:ssd', 'start:ssd',
    'resume:ssd', 'prepare:hdd', 'start:hdd', 'resume:hdd', 'remove', 'clean']);
});

test('job failure leaves later jobs pending and keeps the failed report', async t => {
  const { jobs, ops } = fixture(t);
  ops.execute = run => {
    run.status = 'failed';
    run.failure = { code: 'MEASUREMENT_FAILED', stage: 'measurement', message: 'fixture failure' };
    return true;
  };
  const { summary, exitCode } = await startQueue(jobs, () => {}, ops);
  assert.equal(exitCode, 1);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.jobs[0].error.message, 'fixture failure');
  assert.equal(summary.jobs[0].summary, path.join(jobs[0].out, 'summary.json'));
  assert.equal(summary.jobs[1].status, 'pending');
  assert.equal(fs.existsSync(jobs[1].out), false);
});

test('an abandoned queue without a login command frees the account', async t => {
  const { jobs, ops } = fixture(t);
  await startQueue(jobs.map(job => ({ ...job, test: 'startup:warm' })), () => {}, ops);
  const state = JSON.parse(fs.readFileSync(activePath()));
  const abandoned = path.join(state.queue, 'recovery-1-old-0');
  fs.mkdirSync(abandoned);
  fs.writeFileSync(path.join(abandoned, 'owner.json'), JSON.stringify({ pid: 2, creation: 'abandoned' }));
  fs.mkdirSync(path.join(state.queue, 'recovery-incomplete.next'));
  await recoverInactiveQueue(ops);
  assert.equal(fs.existsSync(activePath()), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(state.queue, 'summary.json'))).status, 'failed');
});
