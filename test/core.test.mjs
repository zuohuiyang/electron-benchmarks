import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, plan, validateConfig } from '../dist/config.js';
import { quantile, difference, resources, nativeCpu } from '../dist/statistics.js';
import { assertFrozenPlan } from '../dist/runner.js';
import { summarize } from '../dist/report.js';
import { manifest, verifyManifest, atomicJson, writeNewJson, sha256 } from '../dist/files.js';
import { systemCpu, assertPriority } from '../dist/windows.js';
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

test('CLI and JSON share the exact supported test:scenario combinations', () => {
  const expected = {
    startup: ['warm'], 'startup:warm': ['warm'], memory: ['memory'], cpu: ['cpu']
  };
  const schema = JSON.parse(fs.readFileSync('docs/config.schema.json', 'utf8'));
  assert.deepEqual(schema.properties.test.enum, Object.keys(expected));
  assert.equal(schema.properties.scenario, undefined);
  const root = fs.mkdtempSync(path.resolve('.test-output/selector-config-'));
  for (const [name, phases] of Object.entries(expected)) {
    const file = path.join(root, name.replace(':', '-') + '.json');
    fs.writeFileSync(file, JSON.stringify({ test: name, electrons: ['40.0.0'], repeat: 2 }));
    const cli = parseArgs([name, '--electron', '40.0.0', '--repeat', '2']);
    const json = parseArgs(['--config', file]);
    assert.deepEqual(cli, json); assert.deepEqual(plan(cli), plan(json));
    const steps = plan(cli);
    assert.deepEqual([...new Set(steps.map(s => s.phase))], phases);
    for (const phase of phases) assert.equal(steps.filter(s => s.phase === phase && !s.warmup).length, 2);
    assert(steps.filter(s => s.phase === 'cold').every(s => !s.warmup));
    const defaults = plan({ test: name, electrons: ['40.0.0'] });
    for (const phase of phases) assert.equal(defaults.filter(s => s.phase === phase && !s.warmup).length, ['cold', 'warm'].includes(phase) ? 20 : 10);
  }
  assert.deepEqual(plan({ test: 'startup', electrons: ['40.0.0'] }), plan({ test: 'startup:warm', electrons: ['40.0.0'] }));
});

test('unknown selectors, multiple colons and legacy scenario inputs are rejected clearly', () => {
  for (const test of ['starup:cold', 'startup:cool', 'startup:', ':cold', 'startup:cold:all', 'memory:cold', 'memory:all', 'cpu:warm', 'all:cold', 'constructor', '__proto__', ['startup'], null]) {
    assert.throws(() => validateConfig({ test, electrons: ['40.0.0'] }), /Supported/);
  }
  assert.throws(() => parseArgs(['starup:cold', '--electron', '40.0.0']), /Did you mean startup:cold/);
  assert.throws(() => parseArgs(['startup:cold:all', '--electron', '40.0.0']), /at most one colon/);
  assert.throws(() => parseArgs(['startup', '--electron', '40.0.0', '--scenario', 'cold']), /no longer supported.*startup:warm/);
  assert.throws(() => validateConfig({ test: 'startup', electrons: ['40.0.0'], scenario: 'cold' }), /no longer supported.*startup:warm/);
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
test('summary excludes failed and warmup values and retains their counts', () => {
  const run = { targets: [{ id: 'a' }, { id: 'b' }], steps: [{ phase: 'warm', target: 0 }, { phase: 'warm', target: 1 }] };
  const sample = (id, value, valid, warmup = false) => ({ targetId: id, step: { phase: 'warm', warmup }, valid, metrics: { appReadyMs: value } });
  const groups = summarize(run, [sample('a', 10, true), sample('b', 8, true), sample('b', 0, false), sample('a', 999, true, true)]);
  assert.equal(groups[1].failed, 1); assert.equal(groups[0].metrics.appReadyMs.p50, 10);
  assert.equal(groups[1].metrics.appReadyMs.difference.percent, -20);
});
test('frozen manifests detect content changes and unlisted files; sample writes never overwrite', () => {
  const dir = fs.mkdtempSync(path.resolve('.test-output/frozen-'));
  fs.writeFileSync(path.join(dir, 'a'), 'a'); const snapshot = manifest(dir);
  verifyManifest(dir, snapshot); fs.writeFileSync(path.join(dir, 'a'), 'b'); assert.throws(() => verifyManifest(dir, snapshot));
  const file = path.join(dir, 'state.json'); writeNewJson(file, { next: 1 });
  assert.throws(() => writeNewJson(file, {})); atomicJson(file, { next: 2 }); assert.equal(JSON.parse(fs.readFileSync(file)).next, 2);
});
test('priority checks include CPU, IO and memory', () => {
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
test('changing a saved config or frozen plan prevents execution', () => {
  const dir = fs.mkdtempSync(path.resolve('.test-output/plan-'));
  const frozen = { schemaVersion: 2, toolVersion: 'test', root: dir, workRoot: dir + '/workspace', time: {}, presets: {}, config: { test: 'startup', electrons: ['40.0.0'] }, targets: [], steps: [], userSid: 'test', nodePath: 'node', nodeSha256: 'hash', toolRoot: dir, toolManifest: [] };
  fs.mkdirSync(path.join(dir,'detail'));
  const file = path.join(dir, 'detail/plan.json'); fs.writeFileSync(file, JSON.stringify(frozen));
  const run = { ...frozen, planSha256: sha256(file) };
  assertFrozenPlan(run);
  assert.throws(() => assertFrozenPlan({ ...run, config: { ...run.config, repeat: 2 } }));
  fs.appendFileSync(file, ' '); assert.throws(() => assertFrozenPlan(run));
});
