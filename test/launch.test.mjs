import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { launch } from '../dist/launch.js';

const gpuLine = String.raw`[4760:1114/150133.475:ERROR:gpu\ipc\client\command_buffer_proxy_impl.cc:477] GPU state invalid after WaitForGetOffsetInRange.` + '\r\n';
const stderr = gpuLine.repeat(2);

async function sample(phase, { omit, code = 0, visibility = 'visible' } = {}) {
  const child = Object.assign(new EventEmitter(), { pid: 4760, stdout: new PassThrough(), stderr: new PassThrough() });
  const ops = {
    inspect: (pid = process.pid) => ({ pid, cpuPriority: 32, ioPriority: 2, memoryPriority: 5 }),
    spawn: () => {
      const creationQpcMs = Number(process.hrtime.bigint()) / 1e6;
      queueMicrotask(async () => {
        const ended = once(child.stdout, 'end');
        const events = [
          { event: 'app-ready', sinceCreationMs: 55.0407 },
          { event: 'first-video-frame', creationQpcMs, firstFrameMs: 253.488, pid: child.pid,
            frame: { width: 1280, height: 720, paused: false, visibility } },
          { event: 'diagnostics', networkRequests: [] }
        ];
        child.stdout.end(events.filter(event => event.event !== omit)
          .map(event => '@@VIDEO_BENCH@@' + JSON.stringify(event) + '\n').join(''));
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

test('resource samples still reject Electron stderr errors', async () => {
  const result = await sample('memory');
  assert.equal(result.valid, false);
  assert.match(result.error, /Unexpected Electron stderr/);
});
