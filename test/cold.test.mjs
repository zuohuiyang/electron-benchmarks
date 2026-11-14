import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execute } from '../dist/runner.js';
import { detailPath } from '../dist/layout.js';
import { sha256 } from '../dist/files.js';
import { reportFixture } from './report-fixture.mjs';

function coldRun(t, selector = 'startup:cold', deploy = false) {
  const { run, samples } = reportFixture(selector, 1, 1);
  const base = path.join(run.root, 'local');
  const previousLocal = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = base;
  t.after(() => {
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocal;
    fs.rmSync(run.root, { recursive: true, force: true });
  });
  const local = path.join(base, 'ElectronBenchmarks');
  run.workRoot = path.join(local, 'w', 'aabbccdd');
  run.toolRoot = path.join(run.workRoot, 'tool');
  run.nodePath = process.execPath;
  run.nodeSha256 = sha256(process.execPath);
  if (deploy) {
    run.config.deployTo = path.join(run.root, 'external');
    run.deployRoot = path.join(run.config.deployTo, 'w', '11223344');
  }
  const dist = deploy ? path.join(run.deployRoot, 'targets', 'target-1') : path.join(run.root, 'electron');
  fs.mkdirSync(dist, { recursive: true });
  for (const target of run.targets) {
    target.executable = path.join(dist, 'electron.exe');
    fs.writeFileSync(target.executable, 'test fixture');
    target.manifest = [{ path: 'electron.exe', sha256: sha256(target.executable) }];
    target.profileTemplate = path.join(run.workRoot, 'profiles', 'template');
    fs.mkdirSync(target.profileTemplate, { recursive: true });
  }
  fs.mkdirSync(run.toolRoot);
  for (const sample of samples) fs.unlinkSync(detailPath(run.root, 'samples', sample.step.id + '.json'));
  const { schemaVersion, toolVersion, root, workRoot, time, presets, config, targets, steps,
    userSid, nodePath, nodeSha256, toolRoot, toolManifest } = run;
  const planFile = detailPath(run.root, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify({ schemaVersion, toolVersion, root, workRoot,
    ...(deploy ? { deployRoot: run.deployRoot } : {}), time,
    presets, config, targets, steps, userSid, nodePath, nodeSha256, toolRoot, toolManifest }));
  Object.assign(run, { next: 0, status: 'waiting-reboot', lastBoot: 'before', restartCount: 1, startupCommand: 'fixture' });
  run.planSha256 = sha256(planFile);
  const active = path.join(local, 'active.json');
  const setOwner = (pid, creation) => fs.writeFileSync(active, JSON.stringify({ root, pid, creation, cold: true }));
  setOwner(12345, 'gone');
  const info = { userSid, bootId: 'after', creationFileTime100ns: 'current' };
  const launches = [], registry = [];
  const ops = {
    inspect(pid) {
      if (pid !== undefined) throw Error('No such process');
      return info;
    },
    runtimePathsMatch: () => true,
    assertDesktop() {},
    waitIdle: async (_file, check) => { check(); return info; },
    sleep: async (_ms, check) => check(),
    reboot: async () => assert.fail('Unexpected reboot'),
    launch: async (target, step, profile) => {
      if (deploy) {
        assert.equal(target.executable, path.join(dist, 'electron.exe'));
        assert.equal(path.dirname(profile), path.join(run.workRoot, 'profiles'));
      }
      launches.push(step.phase);
      return samples.find(sample => sample.step.id === step.id);
    },
    startup: async action => { registry.push(action); }
  };
  return { run, info, ops, active, launches, registry, setOwner };
}

test('continuation samples once on a new boot, then runs warm and resource steps on that boot', async t => {
  const { run, info, ops, active, launches, registry } = coldRun(t, 'all', true);
  info.bootId = 'before';
  assert.equal(await execute(run, () => {}, true, ops), false);
  assert.deepEqual(launches, []);
  info.bootId = 'after';
  assert.equal(await execute(run, () => {}, true, ops), true);
  assert.deepEqual(launches, run.steps.map(step => step.phase));
  const messages = fs.readFileSync(detailPath(run.root, 'logs', 'events.ndjson'), 'utf8')
    .trim().split('\n').map(line => JSON.parse(line).message);
  assert.ok(messages.includes(`Idle check complete. Starting [1/${run.steps.length}] cold target-1 sample 1/1`));
  assert.ok(messages.includes(`Next: [2/${run.steps.length}] warm target-1 warmup 1/5`));
  assert.ok(messages.includes('All samples finished. Finalizing results.'));
  assert.equal(launches.filter(phase => phase === 'cold').length, 1);
  assert.deepEqual(registry, ['remove']);
  assert.equal(fs.existsSync(active), false);
  const result = JSON.parse(fs.readFileSync(path.join(run.root, 'summary.json')));
  assert.equal(result.status, 'complete');
  assert.equal(result.dataComplete, true);
  assert.equal(fs.existsSync(run.deployRoot), false);
  assert.equal(fs.existsSync(run.workRoot), false);
  assert.equal(fs.existsSync(run.config.deployTo), true);
});

test('a live continuation keeps ownership; an abandoned claim honors STOP and cleans up', async t => {
  const { run, info, ops, active, launches, registry } = coldRun(t);
  const inspect = ops.inspect;
  ops.inspect = pid => pid === 12346 ? { creationFileTime100ns: 'live' } : inspect(pid);
  const marker = detailPath(run.root, 'logs', 'restart-1.json');
  fs.writeFileSync(marker, JSON.stringify({ pid: 12346, creation: 'live', boot: info.bootId }));
  assert.equal(await execute(run, () => {}, true, ops), false);
  assert.deepEqual(registry, []);
  fs.writeFileSync(detailPath(run.root, 'STOP'), '');
  ops.inspect = inspect;
  assert.equal(await execute(run, () => {}, true, ops), true);
  assert.equal(run.status, 'interrupted');
  assert.deepEqual(launches, []);
  assert.deepEqual(registry, ['remove']);
  assert.equal(fs.existsSync(active), false);
});

test('failed registry cleanup retains the runtime for retry without replaying the sample', async t => {
  const { run, ops, active, launches, registry } = coldRun(t);
  const startup = ops.startup;
  ops.startup = async () => { throw Error('registry unavailable'); };
  assert.equal(await execute(run, () => {}, true, ops), true);
  assert.equal(run.status, 'complete');
  assert.match(run.cleanupError, /registry unavailable/);
  assert(fs.existsSync(run.toolRoot));
  assert(fs.existsSync(active));
  ops.startup = startup;
  assert.equal(await execute(run, () => {}, true, ops), true);
  assert.equal(run.cleanupError, undefined);
  assert.deepEqual(launches, ['cold']);
  assert.deepEqual(registry, ['remove']);
  assert.equal(fs.existsSync(run.workRoot), false);
  assert.equal(fs.existsSync(active), false);
});

test('failed restart records a terminal result and cleans the startup entry', async t => {
  const { run, info, ops, registry, launches } = coldRun(t);
  run.status = 'prepared';
  run.restartCount = 0;
  info.bootId = run.lastBoot;
  ops.reboot = async () => {
    const summary = JSON.parse(fs.readFileSync(path.join(run.root, 'summary.json')));
    assert.equal(summary.status, 'waiting-reboot');
    throw Error('Windows refused restart');
  };
  assert.equal(await execute(run, () => {}, false, ops), true);
  assert.equal(run.status, 'failed');
  assert.match(run.error, /Windows refused restart/);
  assert.deepEqual(launches, []);
  assert.deepEqual(registry, ['remove']);
});

test('STOP during the countdown cancels before the reboot request', async t => {
  const { run, info, ops, registry, launches } = coldRun(t);
  run.status = 'prepared';
  run.restartCount = 0;
  info.bootId = run.lastBoot;
  let rebooted = false;
  ops.reboot = async () => { rebooted = true; };
  ops.sleep = async (_ms, check) => {
    fs.writeFileSync(detailPath(run.root, 'STOP'), '');
    check();
  };
  assert.equal(await execute(run, () => {}, false, ops), true);
  assert.equal(run.status, 'interrupted');
  assert.equal(rebooted, false);
  assert.deepEqual(launches, []);
  assert.deepEqual(registry, ['remove']);
});
