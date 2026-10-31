// Read the compact summary first; environment and samples are available via artifacts.
// Usage: node examples/read-results.mjs path/to/summary.json
import fs from 'node:fs';
import path from 'node:path';

try {
  if (process.argv.length !== 3) throw Error('Usage: node examples/read-results.mjs <summary.json>');
  const result = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  if (result.schemaVersion !== 3) throw Error(`Unsupported output schema: ${result.schemaVersion}`);
  if (result.kind !== 'result' || result.status !== 'complete' || !result.dataComplete || result.error || result.cleanupError) {
    throw Error(`Result is not complete and usable: ${result.error?.message ?? result.cleanupError?.message ?? result.status}`);
  }
  const root = path.dirname(path.resolve(process.argv[2]));
  const artifacts = Object.fromEntries(Object.entries(result.artifacts).map(([key, value]) => {
    if (value === null) return [key, null];
    if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw Error('Artifact must be relative to the result directory');
    const resolved = path.resolve(root, value);
    if (!fs.existsSync(resolved)) throw Error('Missing artifact: ' + value);
    return [key, resolved];
  }));
  const rows = result.groups.flatMap(group => {
    const target = result.targets.find(t => t.id === group.target);
    return Object.entries(group.metrics).filter(([key]) => result.metricDefinitions[key].role === 'primary').map(([key, metric]) => ({
      target: group.target, version: target.version, phase: group.phase, samples: group.valid,
      metric: key, unit: result.metricDefinitions[key].unit, p50: metric.p50, p90: metric.p90,
      difference: metric.difference ?? null
    }));
  });
  console.log(JSON.stringify({ baselineTarget: result.baselineTarget, rows, warnings: result.warnings, environment: result.environment, conditions: result.conditions, artifacts }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
