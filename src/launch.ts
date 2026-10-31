import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { inspect, assertPriority, helperPath, TOOL_ROOT } from './windows.js';
import { PRESET, type Target, type Step, type Sample } from './model.js';
import { resources, nativeCpu, type Observation } from './statistics.js';

const benignGpuProbe = /^\[\d+:\d{4}\/\d{6}\.\d+:ERROR:ui\\gl\\direct_composition_support\.cc:\d+\] AMD VideoProcessorGetOutputExtension failed: .+$/;
export function stderrHasFailure(stderr: string): boolean {
  return stderr.split(/\r?\n/).some(line => !benignGpuProbe.test(line) &&
    /:ERROR:|:FATAL:|^(?:\([^)]*\)\s*)?(?:\w*Error:|FATAL\b)|\bUnhandled(?:PromiseRejection| exception| rejection)|sandbox access/i.test(line));
}
export async function launch(target: Target, step: Step, profile: string, check: () => void, root = TOOL_ROOT): Promise<Sample> {
  const startup = step.phase === 'cold' || step.phase === 'warm';
  const anchor = inspect(); assertPriority(anchor);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUNTIME_STARTUP_TRACE', 'RUNTIME_BENCH_PREVIEW'].includes(key.toUpperCase())) delete env[key];
  Object.assign(env, { RUNTIME_BENCH_PROFILE: profile, RUNTIME_BENCH_CLOCK_ANCHOR: JSON.stringify(anchor), ELECTRON_BENCH_HELPER: helperPath(root),
    BENCH_SETTLE_MS: String(PRESET.settleMs), BENCH_OBSERVE_MS: String(PRESET.observeMs), BENCH_SAMPLE_MS: String(PRESET.sampleMs) });
  const startedAt = new Date().toISOString();
  const before = process.hrtime.bigint();
  const child = spawn(target.executable, [path.join(root, 'harness', startup ? 'startup' : 'resource')], { env, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const after = process.hrtime.bigint();
  // Event payloads are validated below before any number enters a report.
  const events: Record<string, any>[] = [];
  let stderr = '', error: string | undefined; let priority: ReturnType<typeof inspect> | undefined;
  let observer: ReturnType<typeof spawn> | undefined;
  let cpuResult: Promise<Record<string, any>> | undefined;
  const kill = () => { for (const proc of [child, observer]) if (proc?.pid && proc.exitCode === null && proc.signalCode === null) spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }); };
  return await new Promise<Sample>(resolve => {
    const timeout = setTimeout(() => { error = 'Measurement timed out'; kill(); }, startup ? PRESET.launchTimeoutMs : PRESET.settleMs + PRESET.observeMs + 20_000);
    const stop = setInterval(() => { try { check(); } catch (e) { error = String(e); kill(); } }, 250);
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', e => { error = e.message; });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      const prefix = startup ? '@@VIDEO_BENCH@@' : '@@ELECTRON_BENCH@@';
      if (!line.startsWith(prefix)) return;
      try {
        const event = JSON.parse(line.slice(prefix.length)); events.push(event);
        if (event.event === 'error') error = event.message;
        if (event.event === 'resource-ready' && step.phase === 'cpu') {
          if (cpuResult || !Array.isArray(event.processes) || event.processes.some((p: any) => !Number.isInteger(p.pid) || p.pid < 1)) throw Error('Invalid or duplicate process group');
          observer = spawn(helperPath(root), ['--observe-cpu', event.processes.map((p: any) => p.pid).join(',')], { windowsHide: true });
          cpuResult = new Promise((resolve, reject) => {
            let stdout = ''; observer!.stdout!.on('data', chunk => { stdout += chunk; });
            observer!.once('error', reject);
            observer!.once('close', code => { try { if (code !== 0) throw Error(`Native CPU observer failed (${code})`); resolve(JSON.parse(stdout)); } catch (e) { reject(e); } });
          });
          // The rejection is consumed again at close; avoid an unhandled rejection meanwhile.
          cpuResult.catch(() => {});
        }
        // No priority or resource inspection until AFTER both startup endpoints.
        if (['first-video-frame', 'resources'].includes(event.event)) {
          priority = inspect(child.pid); assertPriority(priority);
        }
      } catch (e) { error = String(e); kill(); }
    });
    child.once('close', async code => {
      clearInterval(stop); clearTimeout(timeout); lines.close();
      const metrics: Record<string, number> = {};
      try {
        if (code !== 0 || error) throw Error(error ?? `Electron exited with code ${code}`);
        if (stderrHasFailure(stderr)) throw Error('Unexpected Electron stderr; see raw sample');
        if (!priority || priority.pid !== child.pid) throw Error('Actual Electron process priority was not verified');
        if (startup) {
          const frames = events.filter(e => e.event === 'first-video-frame');
          const ready = events.find(e => e.event === 'app-ready');
          const diagnostics = events.find(e => e.event === 'diagnostics');
          if (frames.length !== 1 || !ready || !diagnostics || diagnostics.networkRequests?.length !== 0) throw Error('Missing startup endpoints or unexpected network request');
          const frame = frames[0];
          const parentToCreationMs = frame.creationQpcMs - Number(before) / 1e6;
          const spawnCallMs = Number(after - before) / 1e6;
          const appReadyMs = parentToCreationMs + ready.sinceCreationMs;
          const videoCallbackMs = parentToCreationMs + frame.firstFrameMs;
          if (frame.pid !== child.pid || parentToCreationMs < 0 || parentToCreationMs > spawnCallMs + 2 ||
              ![appReadyMs, videoCallbackMs].every(Number.isFinite) || appReadyMs <= 0 || videoCallbackMs <= appReadyMs ||
              frame.frame.width !== 1280 || frame.frame.height !== 720 || frame.frame.paused || frame.frame.visibility !== 'visible') throw Error('Invalid startup timestamps or video frame');
          Object.assign(metrics, { appReadyMs, videoCallbackMs, parentToCreationMs, spawnCallMs });
        } else {
          const record = events.find(e => e.event === 'resources');
          if (!record?.visible) throw Error('Resource workload did not remain visible');
          const all = resources(record.observations as Observation[], os.cpus().length, true);
          if (step.phase === 'cpu') {
            if (!cpuResult) throw Error('Native CPU interval missing');
            const cpu = await cpuResult;
            const expectedPids = events.find(e => e.event === 'resource-ready')!.processes.map((p: any) => p.pid).sort().join(',');
            if (cpu.processes.map((p: any) => p.pid).sort().join(',') !== expectedPids) throw Error('Native CPU process group mismatch');
            Object.assign(all, nativeCpu(cpu as Parameters<typeof nativeCpu>[0]));
            events.push({ event: 'native-cpu', ...cpu });
          }
          const keys = step.phase === 'memory' ? ['privateBytesSumMiB', 'workingSetSumMiB', 'observedWorkingSetPeakMiB'] : ['cpuPercentMachine', 'cpuTimeSeconds'];
          for (const key of keys) if (all[key] !== undefined) metrics[key] = all[key];
          if (step.phase === 'memory' && metrics.privateBytesSumMiB === undefined) throw Error('This Electron build does not expose Windows privateBytes');
        }
      } catch (e) { error = (e as Error).message; kill(); }
      resolve({ schemaVersion: 1, step, targetId: target.id, valid: !error, error,
        metrics: error ? {} : metrics, startedAt,
        raw: { timingOrigin: 'parent-before-spawn-qpc-v1', parentBeforeSpawnNs: before.toString(), parentAfterSpawnNs: after.toString(), prelaunch: anchor, priority, events, stderr, exitCode: code } });
    });
  });
}
