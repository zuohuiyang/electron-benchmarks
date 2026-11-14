import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { launch } from '../dist/launch.js';

const gpuLine = String.raw`[4760:1114/150133.475:ERROR:gpu\ipc\client\command_buffer_proxy_impl.cc:477] GPU state invalid after WaitForGetOffsetInRange.` + '\r\n';
const stderr = gpuLine.repeat(2);

async function sample(phase, { omit, code = 0, visibility = 'visible', intervalMs = 1000, observerPid = 4760 } = {}) {
  const child = Object.assign(new EventEmitter(), { pid: 4760, stdout: new PassThrough(), stderr: new PassThrough() });
  const startup = phase === 'warm' || phase === 'cold';
  const ops = {
    inspect: (pid = process.pid) => ({ pid, cpuPriority: 32, ioPriority: 2, memoryPriority: 5 }),
    spawn: (_file, args) => {
      if (args[0] === '--observe-cpu') {
        assert.equal(args[1], String(child.pid));
        const observer = Object.assign(new EventEmitter(), { stdout: new PassThrough() });
        queueMicrotask(async () => {
          const ended = once(observer.stdout, 'end');
          observer.stdout.end(JSON.stringify({
            durationSeconds: 20, logicalCpus: 4,
            processes: [{ pid: observerPid, cpuBefore100ns: '0', cpuAfter100ns: '10000000' }]
          }));
          await ended;
          observer.emit('close', 0);
        });
        return observer;
      }
      const creationQpcMs = Number(process.hrtime.bigint()) / 1e6;
      queueMicrotask(async () => {
        const ended = once(child.stdout, 'end');
        const processes = [{ pid: child.pid, creationTime: 1, memory: { workingSetSize: 2048, privateBytes: 1024 },
          cpu: { percentCPUUsage: 0 } }];
        const events = startup ? [
          { event: 'app-ready', sinceCreationMs: 55.0407 },
          { event: 'first-video-frame', creationQpcMs, firstFrameMs: 253.488, pid: child.pid,
            frame: { width: 1280, height: 720, paused: false, visibility } },
          { event: 'diagnostics', networkRequests: [] }
        ] : [
          { event: 'resource-ready', processes },
          { event: 'resources', visible: visibility === 'visible', observations: [{ intervalMs, processes }] }
        ];
        const prefix = startup ? '@@VIDEO_BENCH@@' : '@@ELECTRON_BENCH@@';
        child.stdout.end(events.filter(event => event.event !== omit)
          .map(event => prefix + JSON.stringify(event) + '\n').join(''));
        child.stderr.end(stderr);
        await ended;
        child.emit('close', code);
      });
      return child;
    }
  };
  return launch({ id: 'target-2', executable: 'fixture.exe' }, { phase }, 'fixture-profile', () => {}, undefined, ops);
}

test('cold and warm startup retain both SSD GPU stderr lines and report valid metrics', async () => {
  for (const phase of ['cold', 'warm']) {
    const result = await sample(phase);
    assert.equal(result.valid, true, result.error);
    assert.equal(result.raw.stderr, stderr);
    assert.equal(result.raw.exitCode, 0);
    assert.ok(result.metrics.videoCallbackMs > result.metrics.appReadyMs);
  }
});

test('startup still rejects missing endpoints, hidden video and nonzero exit', async () => {
  for (const [options, error] of [
    [{ omit: 'app-ready' }, /Missing startup endpoints/],
    [{ omit: 'first-video-frame' }, /priority was not verified/],
    [{ visibility: 'hidden' }, /Invalid startup timestamps or video frame/],
    [{ code: 1 }, /Electron exited with code 1/],
  ]) {
    const result = await sample('warm', options);
    assert.equal(result.valid, false);
    assert.match(result.error, error);
    assert.deepEqual(result.metrics, {});
    assert.equal(result.raw.stderr, stderr);
  }
});

test('memory and CPU samples retain stderr and report valid observation metrics', async () => {
  for (const [phase, metrics] of [
    ['memory', { privateBytesSumMiB: 1, workingSetSumMiB: 2, observedWorkingSetPeakMiB: 2 }],
    ['cpu', { cpuPercentMachine: 1.25, cpuTimeSeconds: 1 }]
  ]) {
    const result = await sample(phase);
    assert.equal(result.valid, true, result.error);
    assert.deepEqual(result.metrics, metrics);
    assert.equal(result.raw.stderr, stderr);
  }
});

test('resource samples reject invalid intervals, native CPU process mismatch and nonzero exit', async () => {
  for (const [phase, options, error] of [
    ['memory', { intervalMs: 0 }, /Invalid resource interval/],
    ['cpu', { observerPid: 123 }, /Native CPU process group mismatch/],
    ['memory', { code: 1 }, /Electron exited with code 1/],
  ]) {
    const result = await sample(phase, options);
    assert.equal(result.valid, false);
    assert.match(result.error, error);
    assert.deepEqual(result.metrics, {});
    assert.equal(result.raw.stderr, stderr);
  }
});
