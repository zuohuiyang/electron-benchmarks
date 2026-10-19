import fs from 'node:fs';
import path from 'node:path';
import { atomicJson, readJson } from './files.js';
import type { Run, Sample } from './model.js';
import { quantile, difference } from './statistics.js';
import { PRESET } from './model.js';
export const escapeHtml = (s: unknown): string => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function summarize(run: Run, samples: Sample[]) {
  const groups: Record<string, { target: string; phase: string; valid: number; failed: number; metrics: Record<string, { p50: number; p90: number; difference?: ReturnType<typeof difference> }> }> = {};
  for (const step of run.steps.filter(s => !s.warmup)) {
    const key = `${step.phase}/${run.targets[step.target].id}`;
    groups[key] ??= { target: run.targets[step.target].id, phase: step.phase, valid: 0, failed: 0, metrics: {} };
  }
  for (const sample of samples.filter(s => !s.step.warmup)) {
    const group = groups[`${sample.step.phase}/${sample.targetId}`];
    if (sample.valid) group.valid++; else group.failed++;
  }
  for (const group of Object.values(groups)) {
    const records = samples.filter(s => s.valid && !s.step.warmup && s.targetId === group.target && s.step.phase === group.phase);
    const keys = new Set(records.flatMap(s => Object.keys(s.metrics)));
    for (const key of keys) {
      const values = records.map(s => s.metrics[key]).filter(Number.isFinite);
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
export function report(run: Run): string {
  const dir = path.join(run.root, 'samples');
  const samples = fs.existsSync(dir) ? fs.readdirSync(dir).filter(s => s.endsWith('.json')).sort().map(s => readJson<Sample>(path.join(dir, s))) : [];
  const groups = summarize(run, samples);
  const formal = samples.filter(s => !s.step.warmup);
  const summary = { schemaVersion: 1, toolVersion: run.toolVersion, sceneVersion: 'windows-v1', status: run.status,
    completed: formal.length, planned: run.steps.filter(s => !s.warmup).length,
    error: run.error, cleanupError: run.cleanupError, config: run.config, targets: run.targets.map(({ manifest: _m, ...target }) => target),
    environment: run.environment, groups, presets: PRESET,
    notes: ['Lower is better for these metrics; differences use unrounded P50 values.', 'Working-set sums can double-count shared pages; private bytes are committed private memory, not private resident RAM.', 'CPU uses native cumulative GetProcessTimes deltas divided by actual wall duration and logical processors. Small idle values can quantize to zero.', 'Sampled memory peak is not the lifetime peak.', 'Post-reboot does not mean all caches or prefetch history were cleared.', 'Hypervisor presence is recorded; guest results do not establish physical-machine cold performance.'] };
  atomicJson(path.join(run.root, 'summary.json'), summary);
  const format = (n: number | null | undefined) => n == null ? 'n/a' : n.toFixed(3);
  const rows = groups.flatMap(g => Object.entries(g.metrics).map(([name, m]) => `<tr><td>${escapeHtml(g.phase)}</td><td>${escapeHtml(g.target)}</td><td>${escapeHtml(name)}</td><td>${g.valid}/${g.failed}</td><td>${format(m.p50)}</td><td>${format(m.p90)}</td><td>${format(m.difference?.absolute)}</td><td>${format(m.difference?.percent)}</td></tr>`)).join('');
  const samplesHtml = samples.map(s => `<tr><td>${escapeHtml(s.step.id)}</td><td>${escapeHtml(s.step.phase)}</td><td>${escapeHtml(s.targetId)}</td><td>${s.step.warmup ? 'warmup' : 'formal'}</td><td>${s.valid ? 'valid' : escapeHtml(s.error)}</td><td><a href="samples/${s.step.id}.json">raw JSON</a></td><td>${escapeHtml(JSON.stringify(s.metrics))}</td></tr>`).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Electron Benchmarks</title><style>body{font:15px system-ui;max-width:1400px;margin:32px auto;padding:0 20px;color:#172033}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{padding:9px;border:1px solid #ccd3dd;text-align:left}th{background:#edf2f8}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f5f8;padding:16px}a{color:#235cc8}h2{margin-top:36px}</style><h1>Electron Benchmarks</h1><p>Status: ${escapeHtml(run.status)} · ${summary.completed}/${summary.planned} formal records · baseline: ${escapeHtml(run.targets[0]?.id)}</p><p>${escapeHtml(run.error ?? '')} ${escapeHtml(run.cleanupError ?? '')}</p><h2>Version comparison</h2><table><tr><th>Test</th><th>Target</th><th>Metric (unit in name)</th><th>Valid/failed</th><th>P50</th><th>P90</th><th>Δ P50</th><th>Δ %</th></tr>${rows}</table><ul>${summary.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul><h2>Targets and environment</h2><pre>${escapeHtml(JSON.stringify({ targets: summary.targets, environment: run.environment, config: run.config }, null, 2))}</pre><h2>Every run, in execution order</h2><table><tr><th>ID</th><th>Test</th><th>Target</th><th>Kind</th><th>Status</th><th>Evidence</th><th>Metrics</th></tr>${samplesHtml}</table><p><a href="summary.json">Structured summary</a> · <a href="run.json">Frozen plan and state</a></p></html>`;
  fs.writeFileSync(path.join(run.root, 'report.html'), html);
  const lines = [`${run.status}: ${summary.completed}/${summary.planned} formal records`];
  if (run.error) lines.push(run.error);
  if (run.cleanupError) lines.push(run.cleanupError);
  for (const g of groups) for (const [name, m] of Object.entries(g.metrics)) lines.push(`${g.phase} ${g.target} ${name}: P50=${format(m.p50)} P90=${format(m.p90)} Δ=${format(m.difference?.absolute)} (${format(m.difference?.percent)}%)`);
  lines.push(`Report: ${path.join(run.root, 'report.html')}`); return lines.join('\n');
}
