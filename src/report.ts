import fs from 'node:fs';
import path from 'node:path';
import { atomicJson, readJson } from './files.js';
import type { Phase, Run, Sample } from './model.js';
import { phasesFor } from './config.js';
import { detailPath } from './layout.js';
import { quantile, difference } from './statistics.js';
import { metricDefinitions, phaseMetrics, type MetricDefinition } from './metrics.js';
import { failureExitCode, type Failure } from './errors.js';

export interface SummaryMetric { p50: number; p90: number; difference?: ReturnType<typeof difference> }
export interface GroupSummary {
  target: string; phase: Phase; planned: number; valid: number; failed: number; unexecuted: number;
  missingMetrics: string[]; metrics: Record<string, SummaryMetric>;
}
export interface Warning { code: string; message: string; target?: string; phase?: Phase }
export interface ReportSummary {
  schemaVersion: 3; kind: 'result'; toolVersion: string; sceneVersion: string; status: Run['status'];
  test: Run['config']['test']; scenarios: readonly Phase[]; time: Run['time'] & { updatedAt: string };
  environment: { os: string | null; build: string | null; architecture: string | null; cpu: { models: string[]; logicalCores: number }; memoryBytes: number | null; virtualized: boolean | null };
  conditions: { warmupsPerTarget: Partial<Record<Phase, number>>; formalRunsPerTarget: Partial<Record<Phase, number>>; resourceObservation: { settleMs: number; observeMs: number; sampleMs: number } | null };
  outputDirectory: string; baselineTarget: string; dataComplete: boolean;
  completed: number; planned: number; valid: number; failed: number; unexecuted: number;
  error: Failure | null; cleanupError: Failure | null;
  targets: Pick<Run['targets'][number], 'id' | 'input' | 'version' | 'identity'>[];
  groups: GroupSummary[]; metricDefinitions: Record<string, MetricDefinition>; warnings: Warning[];
  statistics: { primary: 'p50'; secondary: 'p90'; comparison: 'p50'; quantileMethod: 'linear-interpolation'; warmupsExcluded: true; failedExcluded: true; difference: 'target-minus-baseline'; zeroBaselinePercent: null };
  artifacts: { summary: string; environment: string; samples: string; logs: string; plan: string | null; state: string | null };
}

export function summarize(run: Run, samples: Sample[]): GroupSummary[] {
  const groups: Record<string, GroupSummary> = {};
  for (const step of run.steps.filter(s => !s.warmup)) {
    const key = `${step.phase}/${run.targets[step.target].id}`;
    groups[key] ??= { target: run.targets[step.target].id, phase: step.phase, planned: 0, valid: 0, failed: 0, unexecuted: 0, missingMetrics: [], metrics: {} };
    groups[key].planned++;
  }
  for (const sample of samples.filter(s => !s.step.warmup)) {
    const group = groups[`${sample.step.phase}/${sample.targetId}`];
    if (!group) throw Error(`Sample is outside the test plan: ${sample.targetId}/${sample.step.phase}`);
    if (sample.valid) group.valid++; else group.failed++;
  }
  for (const group of Object.values(groups)) {
    group.unexecuted = Math.max(0, group.planned - group.valid - group.failed);
    const records = samples.filter(s => s.valid && !s.step.warmup && s.targetId === group.target && s.step.phase === group.phase);
    for (const key of phaseMetrics[group.phase]) {
      const values = records.map(s => s.metrics[key]);
      if (!values.length || !values.every(Number.isFinite)) { group.missingMetrics.push(key); continue; }
      group.metrics[key] = { p50: quantile(values, .5), p90: quantile(values, .9) };
    }
  }
  for (const group of Object.values(groups)) {
    const baseline = groups[`${group.phase}/${run.targets[0].id}`];
    if (group.target === run.targets[0].id) continue;
    for (const [key, metric] of Object.entries(group.metrics)) if (baseline?.metrics[key]) metric.difference = difference(metric.p50, baseline.metrics[key].p50);
  }
  return Object.values(groups);
}

export function report(run: Run): ReportSummary {
  const dir = detailPath(run.root, 'samples');
  const samples = fs.existsSync(dir) ? fs.readdirSync(dir).filter(s => s.endsWith('.json')).sort().map(s => readJson<Sample>(path.join(dir, s))) : [];
  const seen = new Set<string>();
  for (const sample of samples) {
    const step = run.steps.find(s => s.id === sample.step.id);
    if (!step || seen.has(step.id) || step.phase !== sample.step.phase || step.target !== sample.step.target ||
        step.round !== sample.step.round || step.warmup !== sample.step.warmup || run.targets[step.target].id !== sample.targetId) {
      throw Error(`Sample does not match the test plan or is duplicated: ${sample.step.id}`);
    }
    seen.add(step.id);
  }
  const groups = summarize(run, samples);
  const formal = samples.filter(s => !s.step.warmup);
  const valid = formal.filter(s => s.valid).length, failed = formal.length - valid;
  const planned = run.steps.filter(s => !s.warmup).length;
  const dataComplete = valid === planned && failed === 0 && groups.every(g => !g.missingMetrics.length);
  const warnings: Warning[] = groups.filter(g => g.valid === 1).map(g => ({ code: 'SINGLE_SAMPLE', target: g.target, phase: g.phase,
    message: 'Only one valid formal sample; P50 equals P90. Do not infer a performance improvement or regression.' }));
  if (!dataComplete) warnings.push({ code: 'INCOMPLETE_DATA', message: 'Formal samples or required metrics are missing or invalid. Inspect group counts and missingMetrics.' });
  if (run.steps.some(s => s.phase === 'cold')) warnings.push({ code: 'COLD_CACHE_SCOPE', message: 'First launch after reboot does not imply all cache or prefetch history was cleared. Guest reboot does not establish physical-machine cold performance.' });
  const selectedMetrics = [...new Set(groups.flatMap(g => phaseMetrics[g.phase]))];
  const existing = (file: string) => fs.existsSync(detailPath(run.root, file)) ? `detail/${file}` : null;
  const env = run.environment, cpus = Array.isArray(env.cpus) ? env.cpus as { model: string }[] : [];
  const controller = env.controller as { virtualized?: boolean } | undefined;
  const phases = phasesFor(run.config.test), presets = run.presets;
  const warmupsPerTarget = Object.fromEntries(phases.map(phase => [phase, run.steps.filter(s => s.phase === phase && s.target === 0 && s.warmup).length]));
  const formalRunsPerTarget = Object.fromEntries(phases.map(phase => [phase, run.steps.filter(s => s.phase === phase && s.target === 0 && !s.warmup).length]));
  const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
  const summary: ReportSummary = {
    schemaVersion: 3, kind: 'result', toolVersion: run.toolVersion, sceneVersion: 'windows-v1', status: run.status,
    test: run.config.test, scenarios: phases, time: { ...run.time, updatedAt: new Date().toISOString() },
    environment: { os: text(env.os), build: text(env.build), architecture: text(env.architecture), cpu: { models: [...new Set(cpus.map(c => c.model))], logicalCores: cpus.length }, memoryBytes: typeof env.memoryBytes === 'number' ? env.memoryBytes : null, virtualized: typeof controller?.virtualized === 'boolean' ? controller.virtualized : null },
    conditions: { warmupsPerTarget, formalRunsPerTarget, resourceObservation: phases.some(p => p === 'memory' || p === 'cpu') ? { settleMs: presets.settleMs, observeMs: presets.observeMs, sampleMs: presets.sampleMs } : null },
    outputDirectory: run.root, baselineTarget: run.targets[0].id, dataComplete,
    completed: formal.length, planned, valid, failed, unexecuted: Math.max(0, planned - formal.length),
    error: run.failure ?? (run.error ? { code: run.status === 'interrupted' ? 'INTERRUPTED' : 'RUN_FAILED', stage: 'measurement', message: run.error } : null),
    cleanupError: run.cleanupError ? { code: 'CLEANUP_FAILED', stage: 'cleanup', message: run.cleanupError } : null,
    targets: run.targets.map(({ id, input, version, identity }) => ({ id, input, version, identity })), groups,
    metricDefinitions: Object.fromEntries(selectedMetrics.map(key => [key, metricDefinitions[key]])), warnings,
    statistics: { primary: 'p50', secondary: 'p90', comparison: 'p50', quantileMethod: 'linear-interpolation', warmupsExcluded: true, failedExcluded: true, difference: 'target-minus-baseline', zeroBaselinePercent: null },
    artifacts: { summary: 'summary.json', environment: 'detail/environment.json', samples: 'detail/samples/', logs: 'detail/logs/', plan: existing('plan.json'), state: existing('state.json') }
  };
  atomicJson(path.join(run.root, summary.artifacts.environment), { schemaVersion: 1, presets, ...run.environment });
  atomicJson(path.join(run.root, summary.artifacts.summary), summary);
  return summary;
}

export function resultExitCode(summary: ReportSummary): number {
  if (summary.cleanupError) return 1;
  if (summary.error) return failureExitCode(summary.error);
  if (summary.status === 'interrupted') return 130;
  return summary.status === 'complete' && summary.dataComplete ? 0 : 1;
}

export function terminalSummary(summary: ReportSummary, root = '.'): string {
  const lines = [`${summary.status}: ${summary.valid}/${summary.planned} valid formal samples; ${summary.failed} failed, ${summary.unexecuted} unexecuted`];
  for (const group of summary.groups) for (const [key, metric] of Object.entries(group.metrics)) {
    const definition = summary.metricDefinitions[key];
    if (definition.role !== 'primary') continue;
    const delta = metric.difference ? `; delta=${metric.difference.percent === null ? 'n/a' : metric.difference.percent.toFixed(2) + '%'}` : '';
    lines.push(`${group.phase} ${group.target} ${key}: P50=${metric.p50.toFixed(3)} ${definition.unit}${delta}`);
  }
  for (const error of [summary.error, summary.cleanupError]) if (error) lines.push(`${error.code}: ${error.message}`);
  for (const warning of summary.warnings) lines.push(`${warning.code}: ${warning.message}`);
  lines.push(`Summary: ${path.resolve(root, summary.artifacts.summary)}`);
  return lines.join('\n');
}
