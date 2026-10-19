import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, plan } from '../dist/config.js';
import { quantile, difference, resources, nativeCpu } from '../dist/statistics.js';
import { resumeAllowed, assertFrozenPlan, copyDependencies } from '../dist/runner.js';
import { summarize, escapeHtml } from '../dist/report.js';
import { manifest, verifyManifest, atomicJson, writeNewJson, sha256 } from '../dist/files.js';
import { startupCommand, systemCpu, assertPriority } from '../dist/windows.js';
import { stderrHasFailure } from '../dist/launch.js';
fs.mkdirSync('.test-output', { recursive: true });

test('stderr severity does not confuse deprecation prose with runtime failures', () => {
  assert.equal(stderrHasFailure('(node:123) [DEP0169] DeprecationWarning: url.parse() is prone to errors.'), false);
  for (const line of ['[1:1020/000000.000:ERROR:gpu.cc:5] failed', 'TypeError: invalid value', 'UnhandledPromiseRejectionWarning: failed']) assert.equal(stderrHasFailure(line), true);
});

test('CLI preserves target order and accepts versions/paths without shell parsing', () => {
  const c = parseArgs(['startup', '--electron=40.0.0', '--electron', 'build with space/electron.exe', '--repeat', '3']);
  assert.equal(c.electrons[0], '40.0.0'); assert.match(c.electrons[1], /build with space/);
  assert.equal(c.repeat, 3);
  for (const args of [['cpu', '--electron', '40.0.0', '--scenario', 'cold'], ['startup', '--electron', '40.0.0', '--repeat', '0'], ['all', '--config', 'x'], ['startup', '--electron', '--out']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(['--help']), 'help');
});
test('JSON config is equivalent to CLI and resolves paths relative to its file', () => {
  const root = fs.mkdtempSync(path.resolve('.test-output/config-'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ test: 'startup', electrons: ['40.0.0', './build/electron.exe'], repeat: 2 }));
  const c = parseArgs(['--config', path.join(root, 'config.json')]);
  assert.equal(c.electrons[1], path.join(root, 'build/electron.exe'));
  assert.deepEqual(plan(c), plan({ test: 'startup', electrons: ['40.0.0', 'any'], repeat: 2 }));
  assert.throws(() => parseArgs(['--config', 'x', '--repeat', '2']));
});
test('all is cold-first; cold count equals targets times repeat; no cold warmups', () => {
  const steps = plan({ test: 'all', electrons: ['a', 'b', 'c'], repeat: 2 });
  assert.equal(steps.filter(s => s.phase === 'cold').length, 6);
  assert(steps.filter(s => s.phase === 'cold').every(s => !s.warmup));
  assert.deepEqual([...new Set(steps.map(s => s.phase))], ['cold', 'warm', 'memory', 'cpu']);
  assert.deepEqual(steps.slice(0, 6).map(s => s.target), [0, 1, 2, 1, 2, 0]);
  assert.equal(steps.filter(s => s.phase === 'warm' && s.warmup).length, 15);
});
test('cold continuation never replays a pending sample or same-boot launch', () => {
  assert.equal(resumeAllowed({ status: 'waiting-reboot', lastBoot: 'A' }, 'B'), true);
  for (const state of [{ status: 'waiting-reboot', lastBoot: 'A', pendingStep: '2' }, { status: 'running', lastBoot: 'A' }, { status: 'failed', lastBoot: 'A' }]) assert.equal(resumeAllowed(state, 'B'), false);
  assert.equal(resumeAllowed({ status: 'waiting-reboot', lastBoot: 'A' }, 'A'), false);
});
test('quantiles match fixed linear interpolation; baseline zero is not a zero-percent result', () => {
  assert.equal(quantile([40, 10, 30, 20], .5), 25); assert.equal(quantile([10, 20], .9), 19);
  assert.deepEqual(difference(8, 10), { absolute: -2, percent: -20 });
  assert.deepEqual(difference(1, 0), { absolute: 1, percent: null });
  assert.throws(() => quantile([], .5));
});
const processRow = (pid = 1) => ({ pid, type: 'Browser', creationTime: 123, memory: { workingSetSize: 2048, privateBytes: 1024 }, cpu: { percentCPUUsage: 25 } });
test('resources use KiB, distinguish shared working set, and integrate machine-normalized CPU', () => {
  const result = resources([{ intervalMs: 1000, processes: [processRow()] }, { intervalMs: 1000, processes: [processRow()] }], 4);
  assert.equal(result.workingSetSumMiB, 2); assert.equal(result.privateBytesSumMiB, 1);
  assert.equal(result.cpuPercentMachine, 25); assert.equal(result.cpuTimeSeconds, 2);
  assert.throws(() => resources([{ intervalMs: 1000, processes: [processRow()] }, { intervalMs: 1000, processes: [processRow(2)] }], 4));
});
test('report excludes failed and warmup values, retains their counts, escapes untrusted text', () => {
  const run = { targets: [{ id: 'a' }, { id: 'b' }], steps: [{ phase: 'warm', target: 0 }, { phase: 'warm', target: 1 }] };
  const sample = (id, value, valid, warmup = false) => ({ targetId: id, step: { phase: 'warm', warmup }, valid, metrics: { appReadyMs: value } });
  const groups = summarize(run, [sample('a', 10, true), sample('b', 8, true), sample('b', 0, false), sample('a', 999, true, true)]);
  assert.equal(groups[1].failed, 1); assert.equal(groups[0].metrics.appReadyMs.p50, 10);
  assert.equal(groups[1].metrics.appReadyMs.difference.percent, -20);
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
});
test('frozen manifests detect content changes and unlisted files; sample writes never overwrite', () => {
  const dir = fs.mkdtempSync(path.resolve('.test-output/frozen-'));
  fs.writeFileSync(path.join(dir, 'a'), 'a'); const snapshot = manifest(dir);
  verifyManifest(dir, snapshot); fs.writeFileSync(path.join(dir, 'a'), 'b'); assert.throws(() => verifyManifest(dir, snapshot));
  const file = path.join(dir, 'state.json'); writeNewJson(file, { next: 1 });
  assert.throws(() => writeNewJson(file, {})); atomicJson(file, { next: 2 }); assert.equal(JSON.parse(fs.readFileSync(file)).next, 2);
});
test('cold startup command rejects registry expansion paths; priority checks include IO and memory', () => {
  assert.match(startupCommand('C:\\node.exe', 'C:\\tool\\cli.js', 'C:\\run'), /--continue-cold/);
  assert.throws(() => startupCommand('C:\\%TEMP%\\node.exe', 'C:\\cli', 'C:\\run'));
  assertPriority({ cpuPriority: 32, ioPriority: 2, memoryPriority: 5 });
  assert.throws(() => assertPriority({ cpuPriority: 32, ioPriority: 1, memoryPriority: 5 }));
  assert.equal(systemCpu({ kernelTime: '100', userTime: '100', idleTime: '50' }, { kernelTime: '200', userTime: '200', idleTime: '150' }), 50);
});

test('native CPU uses nonnegative cumulative process times, ignoring buggy Electron percentages', () => {
  const result = nativeCpu({ durationSeconds: 20, logicalCpus: 4, processes: [{ cpuBefore100ns: '10000000', cpuAfter100ns: '50000000' }] });
  assert.equal(result.cpuTimeSeconds, 4); assert.equal(result.cpuPercentMachine, 5);
  assert.throws(() => nativeCpu({ durationSeconds: 20, logicalCpus: 4, processes: [{ cpuBefore100ns: '2', cpuAfter100ns: '1' }] }));
  const memory = resources([{ intervalMs: 1000, processes: [{ ...processRow(), cpu: { percentCPUUsage: -1 } }] }], 4, true);
  assert.equal(memory.privateBytesSumMiB, 1); assert.equal(memory.cpuPercentMachine, undefined);
});
test('changing a saved config or frozen plan prevents cold continuation', () => {
  const dir = fs.mkdtempSync(path.resolve('.test-output/plan-'));
  const frozen = { schemaVersion: 1, toolVersion: 'test', root: dir, config: { test: 'startup', electrons: ['40.0.0'] }, targets: [], steps: [], userSid: 'test', nodePath: 'node', nodeSha256: 'hash', toolRoot: dir, toolManifest: [] };
  const file = path.join(dir, 'plan.json'); fs.writeFileSync(file, JSON.stringify(frozen));
  const run = { ...frozen, planSha256: sha256(file) };
  assertFrozenPlan(run);
  assert.throws(() => assertFrozenPlan({ ...run, config: { ...run.config, repeat: 2 } }));
  fs.appendFileSync(file, ' '); assert.throws(() => assertFrozenPlan(run));
});
test('cold snapshot resolves hoisted npm dependencies and freezes transitive code', () => {
  const root = fs.mkdtempSync(path.resolve('.test-output/hoisted-'));
  const source = path.join(root, 'node_modules/app');
  const dep = path.join(root, 'node_modules/dep');
  const leaf = path.join(root, 'node_modules/leaf');
  for (const dir of [source, dep, leaf]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ dependencies: { dep: '1' }, optionalDependencies: { leaf: '1', absent: '1' } }));
  fs.writeFileSync(path.join(dep, 'package.json'), JSON.stringify({ dependencies: { leaf: '1' } }));
  fs.writeFileSync(path.join(leaf, 'package.json'), '{}'); fs.writeFileSync(path.join(leaf, 'index.js'), 'frozen');
  const to = path.join(root, 'snapshot'); copyDependencies(source, to);
  assert.equal(fs.readFileSync(path.join(to, 'node_modules/dep/node_modules/leaf/index.js'), 'utf8'), 'frozen');
  assert.equal(fs.readFileSync(path.join(to, 'node_modules/leaf/index.js'), 'utf8'), 'frozen');
  assert.equal(fs.existsSync(path.join(to, 'node_modules/absent')), false);
  fs.writeFileSync(path.join(leaf, 'index.js'), 'changed');
  assert.equal(fs.readFileSync(path.join(to, 'node_modules/dep/node_modules/leaf/index.js'), 'utf8'), 'frozen');
});
