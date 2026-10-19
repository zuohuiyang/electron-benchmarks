import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Config, Phase, Step } from './model.js';
import { PRESET } from './model.js';

export const HELP = `Electron Benchmarks (Windows x64, Node >=22.12)
  electron-bench <startup|memory|cpu|all> --electron <exact-version|electron.exe> [options]
  electron-bench --config benchmark.json

  --electron <value>  Repeat to compare targets; the first is the baseline
  --scenario <warm|cold>  startup only; defaults to warm
  --repeat <n>  Formal runs per target/test; startup 20, resources 10
  --out <directory>  New output directory (never overwritten)
  --help  Show help without preparing or running a test

  all runs cold, warm, memory, cpu; cold/all require interactive reboot consent.
  Cold: Windows reboot, sign in, wait >=120s and 3 CPU readings <=10%.
  Resource tests: static window, settle 10s, observe 20s, sample every 1s.
  Ctrl+C or a STOP file in the output directory stops the run.
  Task management and interrupted-run resumption are not implemented.`;

export function validateConfig(value: unknown): Config {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Configuration must be an object');
  const c = value as Record<string, unknown>;
  for (const key of Object.keys(c)) if (!['test', 'electrons', 'scenario', 'repeat', 'out'].includes(key)) throw Error(`Unknown configuration field: ${key}`);
  if (!['startup', 'memory', 'cpu', 'all'].includes(String(c.test))) throw Error('Choose startup, memory, cpu, or all');
  if (!Array.isArray(c.electrons) || !c.electrons.length || c.electrons.some(x => typeof x !== 'string' || !x.trim() || /[\r\n\0]/.test(x))) throw Error('electrons must contain version numbers or executable paths');
  if (c.scenario !== undefined && (c.test !== 'startup' || !['warm', 'cold'].includes(String(c.scenario)))) throw Error('--scenario is only supported by startup (warm or cold)');
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
  for (let i = 1; i < args.length; i++) {
    const [flag, ...inline] = args[i].split('=');
    if (!['--electron', '--scenario', '--repeat', '--out'].includes(flag)) throw Error(`Unknown option: ${flag}`);
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
  const phases: Phase[] = config.test === 'all' ? ['cold', 'warm', 'memory', 'cpu'] : [config.test === 'startup' ? config.scenario ?? 'warm' : config.test];
  for (const phase of phases) {
    const warmups = phase === 'cold' ? 0 : phase === 'warm' ? PRESET.warmups : PRESET.resourceWarmups;
    for (const [warmup, count] of [[true, warmups], [false, config.repeat ?? (['cold', 'warm'].includes(phase) ? PRESET.startupRepeat : PRESET.resourceRepeat)]] as const) {
      for (let round = 0; round < count; round++) {
        const order = config.electrons.map((_, i) => i);
        // Balanced positions for any number of targets, recorded in run.json.
        const rotated = order.slice(round % order.length).concat(order.slice(0, round % order.length));
        for (const target of rotated) steps.push({ id: String(steps.length).padStart(6, '0'), phase, target, round, warmup });
      }
    }
  }
  return steps;
}
