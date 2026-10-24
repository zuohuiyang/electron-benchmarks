import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { report } from '../dist/report.js';
import { reportFixture } from './report-fixture.mjs';

function render(fixture) {
  fixture.save(); report(fixture.run);
  const html = fs.readFileSync(path.join(fixture.root, 'report.html'), 'utf8');
  return { html, main: html.split('<section class="details-stack"')[0],
    summary: JSON.parse(fs.readFileSync(path.join(fixture.root, 'summary.json'), 'utf8')) };
}

for (const [kind, targets, metrics] of [['startup', 1, 2], ['startup', 3, 6], ['all', 1, 9], ['all', 3, 27]]) {
  test(`Chinese ${kind}/${targets} report uses P50 consistently and keeps original records`, () => {
    const fixture = reportFixture(kind, targets), { html, main, summary } = render(fixture);
    assert.match(html, /lang="zh-CN"/);
    assert.match(main, new RegExp(`data-layout="${targets === 1 ? 'single' : 'comparison'}"`));
    assert.match(main, /统计口径：<strong>P50（中位数）<\/strong>/);
    const primary = [...main.matchAll(/data-statistic="([^"]+)" data-value="([^"]+)"/g)];
    assert.equal(primary.length, metrics);
    assert(primary.every(([, statistic, value]) => statistic === 'p50' && Number(value) < 900));
    assert.doesNotMatch(main, /data-statistic="p90"|<div class="single-p90">/);
    assert.match(html.slice(main.length), /data-statistic="p90"/);
    assert.equal(summary.statistics.primary, 'p50'); assert.equal(summary.statistics.comparison, 'p50');
    assert.equal(summary.valid, targets * 3 * (kind === 'all' ? 4 : 1));
    assert.equal(summary.unexecuted, 0);
    assert.doesNotMatch(html, /<script\b|演示数据|中文静态样稿|prototype-nav"/);
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    for (const href of links) assert(fs.existsSync(path.join(fixture.root, decodeURIComponent(href))), href);
    assert.equal(links.filter(link => link.startsWith('samples/')).length, fixture.samples.length);
    if (kind === 'all') {
      const phaseOrder = [...main.matchAll(/(?:tbody|section)[^>]*data-phase="([^"]+)"/g)].map(m => m[1]);
      assert.deepEqual(phaseOrder, ['cold', 'warm', 'memory', 'cpu']);
      assert.match(html, /主视图仍对这些每轮结果取 P50/);
    }
  });
}

test('comparison computes unrounded P50 differences rather than P90 differences', () => {
  const fixture = reportFixture('startup', 2);
  for (const sample of fixture.samples.filter(s => !s.step.warmup)) {
    sample.metrics.appReadyMs = (sample.step.target === 0 ? [10, 20, 30] : [12, 21, 100])[sample.step.round];
  }
  const { main, summary } = render(fixture);
  assert.equal(summary.groups[1].metrics.appReadyMs.difference.percent, 5);
  assert.match(main, /↑ 5\.00%/);
  assert.match(main, /data-value="21"/);
  assert.doesNotMatch(main, /data-value="84\.2"/);
});

test('failed, unexecuted and missing values stay distinct from measured zero', () => {
  const fixture = reportFixture('all', 1);
  const cold = fixture.samples.find(s => s.step.phase === 'cold');
  cold.valid = false; cold.error = 'Clock failed'; cold.metrics = {};
  fixture.samples.splice(0, fixture.samples.length, cold);
  fixture.run.status = 'failed'; fixture.run.error = 'Clock failed';
  const { main, summary, html } = render(fixture);
  assert.equal(summary.valid, 0); assert.equal(summary.failed, 1); assert.equal(summary.unexecuted, 11);
  assert.match(main, /无有效样本/); assert.match(main, /未测量/);
  assert.doesNotMatch(main, /data-value="0"|已完成/);
  assert.match(html, /Clock failed/);
  assert(fs.existsSync(path.join(fixture.root, 'samples', cold.step.id + '.json')));
});

test('zero baselines remain valid but never produce a fabricated percentage', () => {
  const fixture = reportFixture('cpu', 2);
  for (const sample of fixture.samples) sample.metrics = sample.step.target === 0 ? { cpuPercentMachine: 0, cpuTimeSeconds: 0 } : { cpuPercentMachine: .05, cpuTimeSeconds: .32 };
  const { main, summary } = render(fixture);
  assert.equal(summary.groups[1].metrics.cpuPercentMachine.difference.percent, null);
  assert.match(main, /百分比不可计算/);
  assert.match(main, /data-value="0"/);
  assert.doesNotMatch(main, /Infinity|NaN/);
});

test('missing metrics do not aggregate a smaller subset as if every run supplied them', () => {
  const fixture = reportFixture('memory', 1);
  delete fixture.samples.find(s => !s.step.warmup).metrics.privateBytesSumMiB;
  const { main, summary } = render(fixture);
  assert.equal(summary.groups[0].metrics.privateBytesSumMiB, undefined);
  assert.match(main, /数据不完整/);
  assert.match(main, /指标未返回/);
  assert.doesNotMatch(main, /data-metric="privateBytesSumMiB"/);
});

test('reports escape target, environment and error text, and support five target columns', () => {
  const fixture = reportFixture('startup', 5);
  const payload = '<img src=x onerror="alert(1)">';
  fixture.run.targets[0].version = payload;
  fixture.run.environment.os = payload;
  fixture.run.error = payload;
  fixture.samples[0].valid = false; fixture.samples[0].error = payload; fixture.samples[0].metrics = {};
  const { html, main } = render(fixture);
  assert.doesNotMatch(html, /<img\b|<script\b/);
  assert.match(html, /&lt;img/);
  assert.equal((main.match(/class="version-line"/g) ?? []).length, 5);
  assert.match(html, /本地构建 1/); assert.match(html, /本地构建 2/);
});

test('a complete flag cannot hide missing formal samples', () => {
  const fixture = reportFixture('startup', 1);
  fixture.samples.splice(fixture.samples.findIndex(s => !s.step.warmup), 1);
  const { main, summary } = render(fixture);
  assert.equal(summary.unexecuted, 1);
  assert.match(main, /数据不完整/);
  assert.doesNotMatch(main, /已完成/);
});
