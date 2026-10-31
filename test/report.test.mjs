import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { report, resultExitCode, terminalSummary } from '../dist/report.js';
import { reportFixture } from './report-fixture.mjs';

function emit(fixture) {
  fixture.save();
  const result = report(fixture.run);
  assert.deepEqual(result, JSON.parse(fs.readFileSync(path.join(fixture.root,result.artifacts.summary), 'utf8')));
  assert.equal(fs.existsSync(path.join(fixture.root, 'report.html')), false);
  for (const file of Object.values(result.artifacts).filter(Boolean)) { assert(!path.isAbsolute(file)); assert(fs.existsSync(path.join(fixture.root,file)), file); }
  return result;
}

for (const [kind, targets] of [['startup', 1], ['startup', 3], ['startup:warm', 1], ['memory', 1], ['memory', 3], ['cpu', 1], ['cpu', 3]]) {
  test(`${kind}/${targets} emits complete machine-readable results without HTML`, () => {
    const fixture = reportFixture(kind, targets), result = emit(fixture);
    assert.equal(result.schemaVersion, 3); assert.equal(result.kind, 'result');
    assert.equal(result.dataComplete, true); assert.equal(resultExitCode(result), 0);
    assert.equal(result.baselineTarget, 'target-1'); assert.equal(result.targets.length, targets);
    assert.equal(result.statistics.primary, 'p50'); assert.equal(result.statistics.comparison, 'p50');
    assert.equal(result.valid, targets * 3);
    assert.equal(result.unexecuted, 0); assert.equal(result.error, null);
    assert.equal(result.environment.os, fixture.run.environment.os); assert.equal(result.layoutVersion, undefined);
    assert.equal(result.links, undefined);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.root,result.artifacts.environment))).os, fixture.run.environment.os);
    for (const group of result.groups) {
      assert.equal(group.planned, 3); assert.equal(group.valid, 3); assert.deepEqual(group.missingMetrics, []);
      for (const [key, metric] of Object.entries(group.metrics)) {
        assert(metric.p50 < 900, 'warmups excluded'); assert(metric.p90 >= metric.p50);
        assert(result.metricDefinitions[key].unit); assert(result.metricDefinitions[key].description);
      }
    }
    assert.equal(fs.readdirSync(path.join(fixture.root,result.artifacts.samples)).length, fixture.samples.length);
    assert.match(terminalSummary(result), /P50=/); assert.doesNotMatch(terminalSummary(result), /\.html/);
  });
}

test('comparison computes unrounded P50 differences rather than P90 differences', () => {
  const fixture = reportFixture('startup', 2);
  for (const sample of fixture.samples.filter(s => !s.step.warmup)) {
    sample.metrics.appReadyMs = (sample.step.target === 0 ? [10, 20, 30] : [12, 21, 100])[sample.step.round];
  }
  const result = emit(fixture), metric = result.groups[1].metrics.appReadyMs;
  assert.equal(metric.difference.percent, 5); assert.equal(metric.difference.absolute, 1);
  assert.equal(metric.p50, 21); assert.equal(metric.p90, 84.2);
});

test('failed and unexecuted samples are explicit and never appear as zero', () => {
  const fixture = reportFixture('startup', 1);
  const cold = fixture.samples.find(s => !s.step.warmup);
  cold.valid = false; cold.error = 'Clock failed'; cold.metrics = {};
  fixture.samples.splice(0, fixture.samples.length, cold);
  fixture.run.status = 'failed'; fixture.run.error = 'Clock failed';
  const result = emit(fixture);
  assert.equal(result.valid, 0); assert.equal(result.failed, 1); assert.equal(result.unexecuted, 2);
  assert.equal(result.dataComplete, false); assert.equal(resultExitCode(result), 1);
  assert.equal(result.error.message, 'Clock failed');
  assert(result.groups.every(g => !Object.keys(g.metrics).length));
  assert(result.warnings.some(w => w.code === 'INCOMPLETE_DATA'));
});

test('zero baselines are valid; percentage is explicitly null', () => {
  const fixture = reportFixture('cpu', 2);
  for (const sample of fixture.samples) sample.metrics = sample.step.target === 0 ? { cpuPercentMachine: 0, cpuTimeSeconds: 0 } : { cpuPercentMachine: .05, cpuTimeSeconds: .32 };
  const result = emit(fixture);
  assert.equal(result.dataComplete, true);
  assert.equal(result.groups[0].metrics.cpuPercentMachine.p50, 0);
  assert.deepEqual(result.groups[1].metrics.cpuPercentMachine.difference, { absolute: .05, percent: null });
});

test('missing metrics cannot aggregate a smaller subset or produce success', () => {
  const fixture = reportFixture('memory', 1);
  delete fixture.samples.find(s => !s.step.warmup).metrics.privateBytesSumMiB;
  const result = emit(fixture);
  assert.equal(result.groups[0].metrics.privateBytesSumMiB, undefined);
  assert.deepEqual(result.groups[0].missingMetrics, ['privateBytesSumMiB']);
  assert.equal(result.status, 'complete'); assert.equal(result.dataComplete, false);
  assert.equal(resultExitCode(result), 1);
});

test('a complete flag cannot hide missing samples; one sample yields a structured warning', () => {
  const fixture = reportFixture('startup', 1, 2);
  fixture.samples.splice(fixture.samples.findIndex(s => !s.step.warmup), 1);
  const result = emit(fixture);
  assert.equal(result.unexecuted, 1); assert.equal(result.groups[0].unexecuted, 1);
  assert.equal(result.dataComplete, false); assert.equal(resultExitCode(result), 1);
  assert(result.warnings.some(w => w.code === 'SINGLE_SAMPLE' && w.target === 'target-1' && w.phase === 'warm'));
});

test('sample identity and duplicate files cannot inflate sample counts', () => {
  const fixture = reportFixture('startup', 1);
  fs.writeFileSync(path.join(fixture.root, 'detail/samples', 'duplicate.json'), JSON.stringify(fixture.samples[0]));
  assert.throws(() => report(fixture.run), /duplicated/);
  fixture.save(); fixture.samples[0].targetId = 'wrong-target'; fixture.save();
  assert.throws(() => report(fixture.run), /test plan/);
});

test('user-declined consent is interrupted, cleanup failures are not success', () => {
  const fixture = reportFixture('startup', 1);
  fixture.samples.length = 0; fixture.run.status = 'interrupted';
  fixture.run.failure = { code: 'INTERRUPTED', stage: 'consent', message: 'User declined reboot sequence' };
  const result = emit(fixture);
  assert.equal(resultExitCode(result), 130); assert.equal(result.error.stage, 'consent');
  fixture.run.cleanupError = 'Remove only this task startup entry';
  const failedCleanup = emit(fixture);
  assert.equal(resultExitCode(failedCleanup), 1); assert.equal(failedCleanup.cleanupError.code, 'CLEANUP_FAILED');
});

test('CLI invalid input produces one parseable JSON document and separate stderr', () => {
  const child = spawnSync(process.execPath, ['bin/electron-benchmarks.js', 'startup', '--electron', '40.0.0', '--repeat', '0'], { encoding: 'utf8' });
  assert.equal(child.status, 2); const result = JSON.parse(child.stdout);
  assert.equal(result.schemaVersion, 3); assert.equal(result.kind, 'error');
  assert.equal(result.error.code, 'INVALID_INPUT'); assert.equal(result.error.stage, 'input');
  assert.match(child.stderr, /INVALID_INPUT/); assert.doesNotMatch(child.stdout, /Preflight|Summary:/);
});

test('CLI help names available tests and misspelled selectors return a correction', () => {
  const help = spawnSync(process.execPath, ['bin/electron-benchmarks.js', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /not available in 0.1.0/);
  assert.doesNotMatch(help.stdout, /--scenario/);
  const child = spawnSync(process.execPath, ['bin/electron-benchmarks.js', 'starup:cold', '--electron', '40.0.0'], { encoding: 'utf8' });
  assert.equal(child.status, 2);
  const result = JSON.parse(child.stdout);
  assert.equal(result.error.code, 'INVALID_INPUT');
  assert.match(result.error.message, /Did you mean startup:cold/);
  assert.doesNotMatch(child.stderr, /Preflight|Reboot in|Preparing Electron/);
});

for (const selector of ['startup:cold', 'startup:all', 'all', '--continue-cold']) test(`noninteractive ${selector} fails before output creation or environment inspection`, { skip: process.platform !== 'win32' }, () => {
  // No --out: cold defaults outside the source tree, and must fail before creating it.
  const child = spawnSync(process.execPath, ['bin/electron-benchmarks.js', selector, '--electron', '40.0.0'], { encoding: 'utf8' });
  assert.equal(child.status, 2); const result = JSON.parse(child.stdout);
  assert.equal(result.error.code, 'UNSUPPORTED_TEST');
  assert.doesNotMatch(child.stderr, /Preflight|Reboot in|Preparing Electron/);
});

test('consumer example reads metrics with units and preserves sample warnings', () => {
  const fixture = reportFixture('startup', 2, 1), result = emit(fixture);
  const child = spawnSync(process.execPath, ['examples/read-results.mjs', path.join(fixture.root,result.artifacts.summary)], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  const consumed = JSON.parse(child.stdout);
  assert.equal(consumed.rows.length, 2); assert.equal(consumed.rows[0].unit, 'ms');
  assert.equal(consumed.rows[0].p50, result.groups[0].metrics.appReadyMs.p50);
  assert.equal(consumed.rows[1].difference.percent, result.groups[1].metrics.appReadyMs.difference.percent);
  assert(consumed.warnings.some(w => w.code === 'SINGLE_SAMPLE'));
  fixture.run.status = 'failed'; emit(fixture);
  const rejected = spawnSync(process.execPath, ['examples/read-results.mjs', result.artifacts.summary], { encoding: 'utf8' });
  assert.equal(rejected.status, 1); assert.equal(rejected.stdout, '');
});
