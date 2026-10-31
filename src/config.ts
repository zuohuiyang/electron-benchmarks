import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Config, Phase, Step, TestName } from './model.js';
import { PRESET } from './model.js';
import { BenchmarkError } from './errors.js';

export const HELP = `electron-benchmarks 0.1.0 (Windows x64, Node >=22.12)
  electron-benchmarks <test[:scenario]> --electron <exact-version|electron.exe> [options]
  electron-benchmarks --config benchmark.json

  startup / startup:warm  Warm startup (default startup scenario)
  memory                 Idle memory
  cpu                    Idle CPU
  startup:cold, startup:all, all are not available in 0.1.0 (cold startup deferred).

  --electron <value>  Repeat to compare targets; the first is the baseline
  --repeat <n>  Formal runs per target/test; startup 20, resources 10
  --out <directory>  New output directory (never overwritten)
  --help  Show help without preparing or running a test

  stdout: one JSON result/error on normal process exit (help is plain text).
  stderr: progress and a short human-readable summary. No HTML is generated.
  Results: summary.json and detail/ (environment, plan, state, samples, logs).
  Default directory: YYYYMMDD-HHmm-test in local time; collisions get -2, -3.
  Read status, dataComplete, error, cleanupError, and sample counts before comparison.
  Exit codes: 0 complete, 1 execution/output failure, 2 invalid input, 130 interrupted.

  JSON uses the same test string, e.g. {"test":"startup:warm","electrons":["40.0.0"],"repeat":3}.
  Resource tests: static window, settle 10s, observe 20s, sample every 1s.
  Ctrl+C or detail/STOP in the output directory stops the run.
  Task management and interrupted-run resumption are not implemented.`;

const TEST_PHASES: Record<TestName, readonly Phase[]> = {
  startup: ['warm'], 'startup:warm': ['warm'], memory: ['memory'], cpu: ['cpu']
};

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j])));
    row = next;
  }
  return row[b.length];
}

export function parseTest(value: unknown): TestName {
  if (['startup:cold', 'startup:all', 'all', '--continue-cold'].includes(String(value))) throw new BenchmarkError('UNSUPPORTED_TEST', 'input', `${value} is not available in 0.1.0. Cold startup is deferred. Use startup, memory, or cpu.`);
  if (typeof value === 'string' && Object.hasOwn(TEST_PHASES, value)) return value as TestName;
  const names = [...Object.keys(TEST_PHASES), 'startup:cold', 'startup:all', 'all'];
  const prefix = typeof value === 'string' && value.split(':').length > 2
    ? 'Use test[:scenario] with at most one colon.' : `Unknown test: ${JSON.stringify(value)}.`;
  const suggested = typeof value === 'string' && value.length <= 64
    ? names.map(name => ({ name, distance: editDistance(value, name) })).sort((a, b) => a.distance - b.distance)[0] : undefined;
  throw Error(`${prefix}${suggested && suggested.distance <= 2 ? ` Did you mean ${suggested.name}?` : ''} Supported in 0.1.0: ${Object.keys(TEST_PHASES).join(', ')}.`);
}

export const phasesFor = (test: TestName): readonly Phase[] => TEST_PHASES[parseTest(test)];

export function validateConfig(value: unknown): Config {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Configuration must be an object');
  const c = value as Record<string, unknown>;
  if (Object.hasOwn(c, 'scenario')) throw Error('The scenario field is no longer supported. Use test: "startup:warm".');
  for (const key of Object.keys(c)) if (!['test', 'electrons', 'repeat', 'out'].includes(key)) throw Error(`Unknown configuration field: ${key}`);
  parseTest(c.test);
  if (!Array.isArray(c.electrons) || !c.electrons.length || c.electrons.some(x => typeof x !== 'string' || !x.trim() || /[\r\n\0]/.test(x))) throw Error('electrons must contain version numbers or executable paths');
  if (c.repeat !== undefined && (!Number.isInteger(c.repeat) || Number(c.repeat) < 1 || Number(c.repeat) > 10_000)) throw Error('repeat must be an integer between 1 and 10000');
  if (c.out !== undefined && (typeof c.out !== 'string' || !c.out.trim() || /[\r\n\0]/.test(c.out))) throw Error('out must be a directory path');
  return c as unknown as Config;
}

export function parseArgs(args: string[], cwd = process.cwd()): Config | 'help' {
  if (args.includes('--help') || !args.length) return 'help';
  if (args[0] === '--config' || args[0]?.startsWith('--config=')) {
    const inline = args[0].includes('=');
    if (args.length !== (inline ? 1 : 2)) throw Error('--config cannot be combined with test arguments');
    const file = path.resolve(cwd, inline ? args[0].slice(9) : args[1]);
    const config = validateConfig(JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
    // Relative paths in a config are relative to the config itself, not the shell.
    const base = path.dirname(file);
    return { ...config, electrons: config.electrons.map(x => isVersion(x) ? x : path.resolve(base, x)),
      ...(config.out ? { out: path.resolve(base, config.out) } : {}) };
  }
  const c: Record<string, unknown> = { test: args[0], electrons: [] };
  parseTest(c.test);
  for (let i = 1; i < args.length; i++) {
    const [flag, ...inline] = args[i].split('=');
    if (flag === '--scenario') throw Error('--scenario is no longer supported. Use startup:warm as the test.');
    if (!['--electron', '--repeat', '--out'].includes(flag)) throw Error(`Unknown option: ${flag}`);
    const value = inline.length ? inline.join('=') : args[++i];
    if (!value || value.startsWith('--')) throw Error(`Missing value for ${flag}`);
    if (flag === '--electron') (c.electrons as string[]).push(isVersion(value) ? value : path.resolve(cwd, value));
    else {
      const key = flag.slice(2);
      if (key in c) throw Error(`Option specified twice: ${flag}`);
      c[key] = flag === '--repeat' ? Number(value) : flag === '--out' ? path.resolve(cwd, value) : value;
    }
  }
  return validateConfig(c);
}
export const isVersion = (s: string): boolean => /^\d+\.\d+\.\d+(?:-(?:beta|alpha|nightly)\.\d+)?$/.test(s);
export function plan(config: Config): Step[] {
  const steps: Step[] = [];
  const phases = phasesFor(config.test);
  for (const phase of phases) {
    const warmups = phase === 'cold' ? 0 : phase === 'warm' ? PRESET.warmups : PRESET.resourceWarmups;
    for (const [warmup, count] of [[true, warmups], [false, config.repeat ?? (['cold', 'warm'].includes(phase) ? PRESET.startupRepeat : PRESET.resourceRepeat)]] as const) {
      for (let round = 0; round < count; round++) {
        const order = config.electrons.map((_, i) => i);
        // Balanced positions for any number of targets, recorded in detail/state.json.
        const rotated = order.slice(round % order.length).concat(order.slice(0, round % order.length));
        for (const target of rotated) steps.push({ id: String(steps.length).padStart(6, '0'), phase, target, round, warmup });
      }
    }
  }
  return steps;
}
