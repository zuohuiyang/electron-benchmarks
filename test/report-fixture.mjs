// Synthetic records for renderer tests only; never used as benchmark results.
import fs from 'node:fs';
import path from 'node:path';
import { plan } from '../dist/config.js';

export function reportFixture(test = 'startup', targetCount = 1, repeat = 3) {
  fs.mkdirSync('.test-output', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.test-output/report-test-'));
  fs.mkdirSync(path.join(root, 'samples'));
  const inputs = ['40.0.0', '41.0.0', 'C:/fixture/local/electron.exe', '42.0.0', 'C:/fixture/other/electron.exe'];
  const config = { test, electrons: inputs.slice(0, targetCount), repeat, out: root };
  const targets = config.electrons.map((input, index) => ({ id: `target-${index + 1}`, input,
    executable: input.endsWith('.exe') ? input : `C:/fixture/${input}/electron.exe`,
    version: input.endsWith('.exe') ? '43.0.0-nightly.20260502' : input,
    identity: `test-only-build-${index}`, manifest: [], profileTemplate: root + `/profiles/${index}` }));
  const steps = plan(config);
  const run = { schemaVersion: 1, toolVersion: '0.1.0-test-fixture', root, config, targets, steps,
    next: steps.length, status: 'complete', lastBoot: 'test-only', userSid: 'test-only',
    nodePath: 'C:/fixture/node.exe', nodeSha256: 'test-only', toolRoot: root, toolManifest: [], restartCount: 0,
    environment: { os: '自动化测试夹具（非实测）', build: 'test', architecture: 'x64', node: process.version,
      cpus: [{ model: 'Fixture CPU' }, { model: 'Fixture CPU' }], memoryBytes: 8 * 1024 ** 3,
      controller: { virtualized: false, cpuPriority: 32, ioPriority: 2, memoryPriority: 5 } } };
  const samples = steps.map((step, index) => {
    const n = step.warmup ? 999 : 10 + step.round * 10 + step.target;
    const metrics = step.phase === 'cold' || step.phase === 'warm' ? {
      appReadyMs: n, videoCallbackMs: n + 100, parentToCreationMs: 1 + step.target / 10, spawnCallMs: 2
    } : step.phase === 'memory' ? {
      privateBytesSumMiB: n + 100, workingSetSumMiB: n + 200, observedWorkingSetPeakMiB: n + 250
    } : { cpuPercentMachine: n / 100, cpuTimeSeconds: n / 1000 };
    return { schemaVersion: 1, step, targetId: targets[step.target].id, valid: true, metrics,
      startedAt: new Date(Date.UTC(2026, 9, 25, 1, 0, index)).toISOString(), raw: { source: 'synthetic test fixture' } };
  });
  function save() {
    fs.writeFileSync(path.join(root, 'run.json'), JSON.stringify(run));
    fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify({ config, steps }));
    for (const file of fs.readdirSync(path.join(root, 'samples'))) fs.unlinkSync(path.join(root, 'samples', file));
    for (const sample of samples) fs.writeFileSync(path.join(root, 'samples', `${sample.step.id}.json`), JSON.stringify(sample));
  }
  save();
  return { root, run, samples, save };
}
