import fs from 'node:fs';
import path from 'node:path';
import { atomicJson, readJson } from './files.js';
import type { Phase, Run, Sample, Target } from './model.js';
import { quantile, difference } from './statistics.js';
import { PRESET } from './model.js';
import { renderReportHtml } from './report-html.js';
export { escapeHtml } from './report-html.js';

export interface SummaryMetric { p50: number; p90: number; difference?: ReturnType<typeof difference> }
export interface GroupSummary { target: string; phase: Phase; valid: number; failed: number; metrics: Record<string, SummaryMetric> }
export interface ReportSummary {
  schemaVersion: 1; toolVersion: string; sceneVersion: string; layoutVersion: string; status: Run['status'];
  completed: number; planned: number; valid: number; failed: number; unexecuted: number;
  error?: string; cleanupError?: string; config: Run['config']; targets: Omit<Target, 'manifest'>[];
  environment: Run['environment']; groups: GroupSummary[]; presets: typeof PRESET; notes: string[];
  statistics: { primary: 'p50'; secondary: 'p90'; comparison: 'p50'; warmupsExcluded: true };
  links: { label: string; href: string }[];
}
export function summarize(run: Run, samples: Sample[]) {
  const groups: Record<string, GroupSummary> = {};
  for (const step of run.steps.filter(s => !s.warmup)) {
    const key = `${step.phase}/${run.targets[step.target].id}`;
    groups[key] ??= { target: run.targets[step.target].id, phase: step.phase, valid: 0, failed: 0, metrics: {} };
  }
  for (const sample of samples.filter(s => !s.step.warmup)) {
    const group = groups[`${sample.step.phase}/${sample.targetId}`];
    if (!group) throw Error(`Sample is outside the test plan: ${sample.targetId}/${sample.step.phase}`);
    if (sample.valid) group.valid++; else group.failed++;
  }
  for (const group of Object.values(groups)) {
    const records = samples.filter(s => s.valid && !s.step.warmup && s.targetId === group.target && s.step.phase === group.phase);
    const keys = new Set(records.flatMap(s => Object.keys(s.metrics)));
    for (const key of keys) {
      const values = records.map(s => s.metrics[key]).filter(Number.isFinite);
      if (values.length !== records.length) continue; // An incomplete metric must not masquerade as a full group.
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
  const notes = ['主视图与版本差值统一使用有效正式样本的 P50（中位数），P90 放在详细指标中。基准为零时，变化百分比不可计算。'];
  if (run.steps.some(s => s.phase === 'warm' || s.phase === 'cold')) notes.push('启动就绪表示 Electron 初始化完成，不代表页面可交互；首次可见视频回调不等于物理屏幕输出。计时起点为父进程发起启动前。');
  if (run.steps.some(s => s.phase === 'memory')) notes.push('私有提交量不是私有驻留物理内存。工作集求和可能重复计算共享页；观察期采样峰值不是进程生命周期峰值。');
  if (run.steps.some(s => s.phase === 'cpu')) notes.push('CPU 使用原生累计进程时间差，按实际时长与整机逻辑核容量归一化；空闲消耗很小时，计数器可能量化为零。');
  if (run.steps.some(s => s.phase === 'cold')) notes.push('重启后的首次启动不表示所有缓存或预取历史都已清空。虚拟机来宾重启数据不能证明实体机冷启动表现。');
  const valid = formal.filter(s => s.valid).length, failed = formal.length - valid;
  const summary: ReportSummary = { schemaVersion: 1, toolVersion: run.toolVersion, sceneVersion: 'windows-v1', layoutVersion: 'zh-comparison-v1', status: run.status,
    completed: formal.length, planned: run.steps.filter(s => !s.warmup).length,
    valid, failed, unexecuted: Math.max(0, run.steps.filter(s => !s.warmup).length - formal.length),
    error: run.error, cleanupError: run.cleanupError, config: run.config, targets: run.targets.map(({ manifest: _m, ...target }) => target),
    environment: run.environment, groups, presets: PRESET,
    statistics: { primary: 'p50', secondary: 'p90', comparison: 'p50', warmupsExcluded: true }, notes,
    links: [{ label: '汇总 JSON', href: 'summary.json' }, ...[['plan.json', '测试计划'], ['run.json', '运行记录']].filter(([file]) => fs.existsSync(path.join(run.root, file))).map(([href, label]) => ({ label, href }))] };
  atomicJson(path.join(run.root, 'summary.json'), summary);
  const format = (n: number | null | undefined) => n == null ? 'n/a' : n.toFixed(3);
  const html = renderReportHtml(run, samples, summary);
  fs.writeFileSync(path.join(run.root, 'report.html'), html);
  const lines = [`${run.status}: ${summary.completed}/${summary.planned} formal records`];
  if (run.error) lines.push(run.error);
  if (run.cleanupError) lines.push(run.cleanupError);
  for (const g of groups) for (const [name, m] of Object.entries(g.metrics)) lines.push(`${g.phase} ${g.target} ${name}: P50=${format(m.p50)} P90=${format(m.p90)} Δ=${format(m.difference?.absolute)} (${format(m.difference?.percent)}%)`);
  lines.push(`Report: ${path.join(run.root, 'report.html')}`); return lines.join('\n');
}
