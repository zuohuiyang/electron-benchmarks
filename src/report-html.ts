import type { Phase, Run, Sample } from './model.js';
import type { GroupSummary, ReportSummary, SummaryMetric } from './report.js';
import { isVersion } from './config.js';
import { reportStyle } from './report-style.js';

export const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Metric { key: string; label: string; description: string; unit: string; digits?: number }
const startupMetrics: Metric[] = [
  { key: 'appReadyMs', label: '启动就绪', description: '发起启动 → Electron 初始化完成', unit: 'ms' },
  { key: 'videoCallbackMs', label: '首次可见视频回调', description: '发起启动 → 首次观察到可见视频回调', unit: 'ms' }
];
const phases: Record<Phase, { label: string; note: string; metrics: Metric[] }> = {
  cold: { label: '冷启动', note: '每次正式运行前重启系统', metrics: startupMetrics },
  warm: { label: '热启动', note: '同次开机内预热后测量', metrics: startupMetrics },
  memory: { label: '内存', note: '单窗口空闲 · 静置 10 秒，观察 20 秒', metrics: [
    { key: 'privateBytesSumMiB', label: '私有提交量', description: '各进程私有提交量之和', unit: 'MiB' },
    { key: 'workingSetSumMiB', label: '工作集总和', description: '共享页面可能被重复计算', unit: 'MiB' },
    { key: 'observedWorkingSetPeakMiB', label: '观察期工作集峰值', description: '采样峰值，不是进程生命周期峰值', unit: 'MiB' }
  ] },
  cpu: { label: 'CPU', note: '单窗口空闲 · 按整机逻辑核容量归一化', metrics: [
    { key: 'cpuPercentMachine', label: '平均 CPU 占用', description: '100% 表示整机全部逻辑核满载', unit: '%' },
    { key: 'cpuTimeSeconds', label: '累计 CPU 时间', description: '观察期内各进程消耗的 CPU 秒数', unit: 's', digits: 3 }
  ] }
};
const internalMetrics: Metric[] = [
  { key: 'parentToCreationMs', label: '发起启动至进程创建', description: '', unit: 'ms', digits: 3 },
  { key: 'spawnCallMs', label: '创建进程调用耗时', description: '', unit: 'ms', digits: 3 }
];
const format = (n: number | null | undefined, digits = 2): string => n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits);
const numberValue = (n: number | undefined): number | undefined => n !== undefined && Number.isFinite(n) ? n : undefined;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const textValue = (value: unknown): string => typeof value === 'string' && value.trim() ? value : '未记录';
const colors = ['#4668d8', '#8b6bc0', '#31958d', '#bb8239', '#b35f91'];

function disclosure(title: string, hint: string, body: string): string {
  return `<details class="detail"><summary><span class="detail-label"><span class="chevron" aria-hidden="true"></span>${title}</span><span class="detail-hint">${escapeHtml(hint)}</span></summary><div class="detail-body">${body}</div></details>`;
}

export function renderReportHtml(run: Run, samples: Sample[], summary: ReportSummary): string {
  const multi = run.targets.length > 1;
  const selected = [...new Set(run.steps.map(step => step.phase))];
  const resources = selected.some(phase => phase === 'memory' || phase === 'cpu');
  const baseTitle = { startup: '启动', memory: '内存', cpu: 'CPU', all: '性能' }[run.config.test];
  const title = baseTitle + (multi ? '版本对比' : '测试报告');
  const localTargets = run.targets.filter(target => !isVersion(target.input));
  const targetName = (index: number): string => {
    const target = run.targets[index];
    if (isVersion(target.input)) return target.version;
    return `本地构建${localTargets.length > 1 ? ' ' + (localTargets.indexOf(target) + 1) : ''}`;
  };
  const targetLabel = (index: number): string => isVersion(run.targets[index].input) ? targetName(index) : `${targetName(index)} · ${run.targets[index].version}`;
  const dot = (index: number) => `<span class="dot" style="background:${colors[index % colors.length]}" aria-hidden="true"></span>`;
  const group = (phase: Phase, index: number): GroupSummary => summary.groups.find(g => g.phase === phase && g.target === run.targets[index].id)!;
  const count = (phase: Phase, index: number, warmup = false): number => run.steps.filter(step => step.phase === phase && step.target === index && step.warmup === warmup).length;
  const counts = (phase: Phase, warmup = false): string => {
    const values = run.targets.map((_, index) => count(phase, index, warmup));
    return Math.min(...values) === Math.max(...values) ? String(values[0]) : `${Math.min(...values)}–${Math.max(...values)}`;
  };
  const unavailable = (g: GroupSummary): string => g.valid ? '指标未返回' : g.failed ? '无有效样本' : '未测量';
  const groupStatus = (phase: Phase, index: number): string => {
    const g = group(phase, index), missing = Math.max(0, count(phase, index) - g.valid - g.failed);
    return `${g.valid} / ${count(phase, index)} 个有效样本 · ${g.failed} 个失败${missing ? ` · ${missing} 个未测量` : ''}`;
  };
  const valueHtml = (phase: Phase, metric: Metric, index: number): string => {
    const g = group(phase, index), value = numberValue(g.metrics[metric.key]?.p50);
    if (value === undefined) return `<div class="metric-number metric-empty">—</div><div class="metric-unavailable">${unavailable(g)}</div>`;
    return `<div class="metric-number" data-phase="${phase}" data-metric="${metric.key}" data-statistic="p50" data-value="${value}">${format(value, metric.digits)}<span class="unit">${metric.unit}</span></div>`;
  };
  const differenceHtml = (metric: Metric, stat: SummaryMetric | undefined, index: number): string => {
    if (!stat) return '';
    if (!index) return '<span class="reference">基准值</span>';
    if (!stat.difference) return '<span class="reference">基准无有效数据</span>';
    const { absolute, percent } = stat.difference;
    const badge = percent === null ? '<span class="delta neutral">百分比不可计算</span>' : absolute === 0 ? '<span class="delta neutral">持平</span>' :
      `<span class="delta ${absolute > 0 ? 'up' : 'down'}">${absolute > 0 ? '↑' : '↓'} ${format(Math.abs(percent))}%</span>`;
    return `${badge}<span class="delta-absolute">${absolute > 0 ? '+' : absolute < 0 ? '−' : ''}${format(Math.abs(absolute), metric.digits)} ${metric.unit === '%' ? '百分点' : metric.unit}</span>`;
  };

  function matrix(): string {
    const columnNote = (index: number): string => {
      const target = run.targets[index];
      const origin = isVersion(target.input) ? '官方发布版本' : target.version;
      if (selected.length !== 1) return origin;
      const g = group(selected[0], index);
      return `${origin} · ${g.valid} 个有效样本${g.failed ? ` · ${g.failed} 个失败` : ''}`;
    };
    const header = `<thead><tr><th scope="col"><span class="column-label">测试指标</span></th>${run.targets.map((_, index) =>
      `<th scope="col" class="${index === 0 ? 'baseline-column' : ''}"><div class="version-line">${dot(index)}<span class="version">${escapeHtml(targetName(index))}</span>${index === 0 ? '<span class="baseline-badge">基准</span>' : ''}</div><span class="version-note">${escapeHtml(columnNote(index))}</span></th>`).join('')}</tr></thead>`;
    const bodies = selected.map(phase => {
      const definition = phases[phase];
      const rows = definition.metrics.map(metric => {
        const values = run.targets.map((_, i) => numberValue(group(phase, i).metrics[metric.key]?.p50));
        const scale = Math.max(0, ...values.filter((v): v is number => v !== undefined)) * 1.1;
        return `<tr><th scope="row"><div class="metric-title">${metric.label}</div><div class="metric-description">${metric.description}</div></th>${run.targets.map((_, index) => {
          const g = group(phase, index), value = values[index];
          return `<td class="${index === 0 ? 'baseline-column' : ''}">${valueHtml(phase, metric, index)}<div class="delta-line">${differenceHtml(metric, g.metrics[metric.key], index)}</div>${selected.length === 1 && value !== undefined ? `<div class="bar-track"><div class="bar" style="background:${colors[index % colors.length]};width:${scale ? value / scale * 100 : 0}%"></div></div>` : ''}</td>`;
        }).join('')}</tr>`;
      }).join('');
      return `<tbody data-phase="${phase}">${selected.length > 1 ? `<tr class="group-row"><th scope="rowgroup" colspan="${run.targets.length + 1}">${definition.label}<small>${definition.note} · 每版本计划 ${counts(phase)} 个正式样本</small></th></tr>` : ''}${rows}</tbody>`;
    }).join('');
    return `<section class="card ${selected.length > 1 ? 'all-matrix' : ''}"><div class="card-heading"><h2>${selected.length > 1 ? '全部测试结果' : phases[selected[0]].label + '对比'}</h2><p>数值越低越好</p></div><div class="comparison-wrapper"><table class="comparison" style="--table-width:${Math.max(760, 270 + run.targets.length * 240)}px">${header}${bodies}</table></div><div class="table-note">变化均相对 ${escapeHtml(targetLabel(0))}，以未舍入的 P50 计算。${selected.length === 1 ? '同一指标内使用相同的条形比例尺。' : '不同指标按各自单位阅读。'}</div></section>`;
  }

  function single(): string {
    if (selected.length === 1) {
      const phase = selected[0];
      return `<div class="single-grid">${phases[phase].metrics.map(metric => `<section class="single-card metric-card"><div class="card-context"><h2>${metric.label}</h2><span>数值越低越好</span></div><div class="single-value">${valueHtml(phase, metric, 0)}</div><div class="metric-description">${metric.description}</div><div class="card-context"><span>${escapeHtml(groupStatus(phase, 0))}</span></div></section>`).join('')}</div>`;
    }
    return `<div class="single-grid">${selected.map(phase => `<section class="single-card" data-phase="${phase}"><div class="single-heading"><h2>${phases[phase].label}</h2><span>${escapeHtml(groupStatus(phase, 0))}</span></div>${phases[phase].metrics.map(metric => `<div class="single-metric-row"><div><div class="single-metric-label">${metric.label}</div><div class="metric-description">${metric.description}</div></div><div class="single-metric-value">${valueHtml(phase, metric, 0)}</div></div>`).join('')}<div class="single-section-note">${phases[phase].note}</div></section>`).join('')}</div>`;
  }

  function metricDetails(): string {
    const row = (phase: Phase, metric: Metric, statistic: 'p50' | 'p90'): string => `<tr><td>${metric.label}<span class="label">${statistic.toUpperCase()} · ${metric.unit}</span></td>${run.targets.map((_, i) => `<td data-statistic="${statistic}">${format(group(phase, i).metrics[metric.key]?.[statistic], metric.digits ?? 3)}</td>`).join('')}</tr>`;
    return `<p>所有测试先得到每轮正式结果，再汇总 P50 / P90；预热不参与。主视图统一展示 P50，P90 在此查看。分位数按排序后的线性插值计算。</p>${resources ? '<p>“平均 CPU”指每轮观察期的平均占用，“观察期峰值”指每轮观察期的最大值；主视图仍对这些每轮结果取 P50。内存私有提交量与工作集总和先取每轮采样均值，再汇总多轮分位数。</p>' : ''}<table class="data-table"><thead><tr><th>详细指标</th>${run.targets.map((_, i) => `<th>${escapeHtml(targetLabel(i))}</th>`).join('')}</tr></thead><tbody>${selected.map(phase => `<tr class="phase-detail-row"><th colspan="${run.targets.length + 1}">${phases[phase].label}</th></tr>${phases[phase].metrics.map(m => row(phase, m, 'p90')).join('')}${phase === 'cold' || phase === 'warm' ? internalMetrics.map(m => row(phase, m, 'p50')).join('') : ''}`).join('')}</tbody></table>${summary.notes.map(note => `<p>${escapeHtml(note)}</p>`).join('')}`;
  }

  function sampleDetails(): string {
    const positions = new Map(run.steps.map((step, index) => [step.id, index]));
    const ordered = [...samples].sort((a, b) => (positions.get(a.step.id) ?? Infinity) - (positions.get(b.step.id) ?? Infinity));
    function table(rows: Sample[]): string {
      if (!rows.length) return '<p>暂无记录。</p>';
      return `<div class="comparison-wrapper"><table class="data-table"><thead><tr><th>测试 / 轮次</th><th>版本</th><th>状态</th><th>本轮测量值</th><th>原始记录</th></tr></thead><tbody>${rows.map(sample => {
        const index = run.targets.findIndex(target => target.id === sample.targetId);
        const definition = phases[sample.step.phase];
        const results = sample.valid ? definition.metrics.filter(m => numberValue(sample.metrics[m.key]) !== undefined).map(m => `<span>${m.label} ${format(sample.metrics[m.key], m.digits ?? 3)} ${m.unit}</span>`).join('') : escapeHtml(sample.error ?? '测量失败');
        return `<tr class="${sample.valid ? '' : 'failure-row'}"><td>${definition.label} · 第 ${sample.step.round + 1} 轮</td><td>${escapeHtml(targetLabel(index))}</td><td>${sample.valid ? '有效' : '失败'}</td><td class="result-list">${results}</td><td><a href="samples/${encodeURIComponent(sample.step.id)}.json">${escapeHtml(sample.step.id)}.json ↗</a></td></tr>`;
      }).join('')}</tbody></table></div>`;
    }
    return `<p>以下是每轮实际测量值，未做分位数汇总。正式样本按实际执行顺序显示；失败和预热记录均保留。${summary.unexecuted ? `尚有 ${summary.unexecuted} 个正式样本未执行。` : ''}</p>${table(ordered.filter(s => !s.step.warmup))}<details class="nested"><summary>查看 ${ordered.filter(s => s.step.warmup).length} 个预热样本</summary>${table(ordered.filter(s => s.step.warmup))}</details>`;
  }

  const env = run.environment, controller = record(env.controller);
  const cpus = Array.isArray(env.cpus) ? env.cpus : [];
  const cpuName = textValue(record(cpus[0]).model).trim();
  function environmentDetails(): string {
    const fields: [string, string][] = [
      ['操作系统', `${textValue(env.os)}${env.build ? ' · build ' + String(env.build) : ''}`],
      ['处理器', `${cpuName}${cpus.length ? ' · ' + cpus.length + ' 逻辑核' : ''}`],
      ['系统总内存', typeof env.memoryBytes === 'number' ? format(env.memoryBytes / 1024 ** 3) + ' GiB' : '未记录'],
      ['工具 / 运行时', `${run.toolVersion} / ${textValue(env.node)} · ${textValue(env.architecture)}`],
      ['标准场景版本', summary.sceneVersion],
      ['检测到虚拟化', controller.virtualized === true ? '是' : controller.virtualized === false ? '否' : '未记录'],
      ['电源计划', Array.isArray(env.power) ? env.power.join('；') : '未记录'],
      ['优先级（CPU / IO / 内存）', [controller.cpuPriority, controller.ioPriority, controller.memoryPriority].map(v => v == null ? '未记录' : String(v)).join(' / ')],
      ['结果目录', run.root]
    ];
    return `<dl class="env-grid">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>${run.targets.map((target, i) => `<div class="target-card"><strong>${dot(i)} ${escapeHtml(targetLabel(i))}${multi && i === 0 ? ' · 基准' : ''}</strong><div class="path">${escapeHtml(target.executable)}<br>构建身份：${escapeHtml(target.identity)}</div></div>`).join('')}<p>完整配置、环境计数器与采集记录保留在 JSON 文件中。</p>`;
  }

  const failures = samples.filter(s => !s.valid).length;
  const statusNames: Record<Run['status'], string> = { prepared: '已准备', running: '运行中', 'waiting-reboot': '等待重启', complete: '已完成', failed: '失败', interrupted: '已中断' };
  const missingMetrics = summary.groups.some(g => g.valid > 0 && phases[g.phase].metrics.some(m => !g.metrics[m.key]));
  const inconsistent = run.status === 'complete' && (summary.valid !== summary.planned || summary.failed > 0 || missingMetrics);
  const statusName = inconsistent ? '数据不完整' : statusNames[run.status];
  const errors = [run.error, run.cleanupError, inconsistent ? '有效样本或必要指标不完整，请检查逐次记录。' : undefined].filter((v): v is string => Boolean(v));
  const timestamps = samples.map(s => s.startedAt).filter(v => Number.isFinite(Date.parse(v))).sort();
  const time = timestamps[0] ? `<time datetime="${escapeHtml(timestamps[0])}">${escapeHtml(timestamps[0].slice(0, 16).replace('T', ' '))} UTC</time>` : '';
  const scenario = run.config.test === 'all' ? '全部标准测试' : run.config.test === 'startup' ? `仅${phases[selected[0]].label}` : '单窗口空闲';
  const facts = run.config.test === 'all' ? `<span>启动 <strong>${counts('cold')}</strong> 次 / 条件 / 版本</span><span>资源 <strong>${counts('memory')}</strong> 次 / 项 / 版本</span><span>计划重启 <strong>${run.steps.filter(s => s.phase === 'cold').length}</strong> 次</span>` : `<span>正式 <strong>${counts(selected[0])}</strong> 次 / 版本</span><span>预热 <strong>${counts(selected[0], true)}</strong> 次 / 版本</span>`;
  const smallSample = summary.groups.some(g => g.valid === 1);
  const sampleNote = summary.unexecuted || summary.failed ? `已记录 ${summary.completed} / ${summary.planned} 个正式样本，其中 ${summary.valid} 个有效、${summary.failed} 个失败，${summary.unexecuted} 个未执行。缺失数据不填零。` : smallSample ? '部分测试仅有 1 个有效样本，P50 与 P90 相同；不能据此判断版本性能优劣。' : '主视图按每项测试的有效正式样本汇总；失败和预热不参与分位数计算。';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title} · Electron Benchmarks</title><style>${reportStyle}</style></head><body><main data-layout="${multi ? 'comparison' : 'single'}" data-test="${run.config.test}" data-primary-statistic="p50">
<header class="masthead"><div class="brand"><span class="brand-icon" aria-hidden="true">≋</span>Electron Benchmarks</div><div class="masthead-right">${time}<span class="status ${errors.length || run.status === 'interrupted' || run.status === 'failed' ? 'problem' : ''}">${statusName} · ${summary.completed} / ${summary.planned}</span></div></header>
<section class="hero"><div><div class="eyebrow">${multi ? '版本对比' : '单版本测量'}</div><h1>${title}</h1><p class="subtitle">${multi ? `在相同环境下，横向比较 ${run.targets.length} 个 Electron 版本的测试结果。` : `查看 ${escapeHtml(targetLabel(0))} 在标准场景中的各项测试结果。`}</p></div><span class="scene">${scenario}</span></section>
<div class="run-facts"><span>${multi ? '基准' : '被测版本'} <strong>${escapeHtml(targetLabel(0))}</strong></span><span><strong>${run.targets.length}</strong> 个版本</span>${facts}<span><strong>${failures}</strong> 条失败记录</span></div>
${errors.map(error => `<div class="report-alert">${escapeHtml(error)}</div>`).join('')}
<div class="statistic-heading"><h2>主要指标</h2><span>统计口径：<strong>P50（中位数）</strong></span></div>
${multi ? matrix() : single()}
<div class="sample-note"><span class="info" aria-hidden="true">i</span>${sampleNote}</div>
<section class="details-stack" aria-label="详细报告">${disclosure('详细指标', 'P90 与指标口径', metricDetails())}${disclosure('逐次样本', `${summary.completed} 个正式 · ${samples.filter(s => s.step.warmup).length} 个预热 · ${failures} 个失败`, sampleDetails())}${disclosure('测试环境与版本', `${textValue(env.os)} · ${textValue(env.architecture)}`, environmentDetails())}</section>
<footer><span>Electron Benchmarks · ${escapeHtml(run.toolVersion)} · ${summary.sceneVersion}</span><div class="footer-links">${summary.links.map(link => `<a href="${link.href}">${link.label} ↗</a>`).join('')}</div></footer>
</main></body></html>`;
}
