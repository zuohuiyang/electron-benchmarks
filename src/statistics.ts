export function quantile(values: number[], p: number): number {
  if (!values.length || values.some(x => !Number.isFinite(x)) || p < 0 || p > 1) throw Error('Invalid quantile input');
  const sorted = [...values].sort((a, b) => a - b); const position = (sorted.length - 1) * p;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}
export function mean(values: number[]): number {
  if (!values.length || values.some(x => !Number.isFinite(x))) throw Error('Invalid mean input');
  return values.reduce((a, b) => a + b, 0) / values.length;
}
export function difference(value: number, baseline: number): { absolute: number; percent: number | null } {
  return { absolute: value - baseline, percent: baseline === 0 ? null : (value - baseline) / baseline * 100 };
}
interface ResourceProcess { pid: number; type: string; creationTime: number; memory: { workingSetSize: number; privateBytes?: number }; cpu: { percentCPUUsage: number; cumulativeCPUUsage?: number } }
export interface Observation { intervalMs: number; processes: ResourceProcess[] }
export function resources(observations: Observation[], logicalCpus: number, memoryOnly = false): Record<string, number> {
  if (!observations.length || logicalCpus < 1) throw Error('No resource observations');
  let weightedCpu = 0, duration = 0; const workingSet: number[] = [], privateBytes: number[] = [];
  let privateSupported = true;
  let priorIdentities: string | undefined;
  for (const observation of observations) {
    if (!Number.isFinite(observation.intervalMs) || observation.intervalMs <= 0 || !observation.processes.length) throw Error('Invalid resource interval');
    const identities = observation.processes.map(p => `${p.pid}:${p.creationTime}`).sort().join(',');
    if (priorIdentities !== undefined && identities !== priorIdentities) throw Error('Process group changed during the idle observation; refusing inconsistent CPU intervals');
    priorIdentities = identities;
    const ws = observation.processes.reduce((s, p) => s + p.memory.workingSetSize, 0);
    const cpu = observation.processes.reduce((s, p) => s + p.cpu.percentCPUUsage, 0);
    if (!Number.isFinite(ws) || ws < 0 || (!memoryOnly && (!Number.isFinite(cpu) || cpu < 0))) throw Error('Invalid resource metrics');
    workingSet.push(ws / 1024); // Electron reports KiB; the report uses MiB.
    if (observation.processes.some(p => !Number.isFinite(p.memory.privateBytes))) privateSupported = false;
    else privateBytes.push(observation.processes.reduce((s, p) => s + p.memory.privateBytes!, 0) / 1024);
    weightedCpu += cpu * observation.intervalMs; duration += observation.intervalMs;
  }
  const result: Record<string, number> = { workingSetSumMiB: mean(workingSet), observedWorkingSetPeakMiB: Math.max(...workingSet),
    cpuPercentMachine: weightedCpu / duration, cpuTimeSeconds: weightedCpu / 100 * logicalCpus / 1000 };
  if (privateSupported) result.privateBytesSumMiB = mean(privateBytes);
  if (memoryOnly) { delete result.cpuPercentMachine; delete result.cpuTimeSeconds; }
  return result;
}
export function nativeCpu(record: { durationSeconds: number; logicalCpus: number; processes: { cpuBefore100ns: string; cpuAfter100ns: string }[] }): Record<string, number> {
  if (!Number.isFinite(record.durationSeconds) || record.durationSeconds < 19 || !Number.isInteger(record.logicalCpus) || record.logicalCpus < 1 || !record.processes?.length) throw Error('Invalid native CPU observation');
  const cpuTimeSeconds = record.processes.reduce((sum, p) => {
    const delta = BigInt(p.cpuAfter100ns) - BigInt(p.cpuBefore100ns);
    if (delta < 0n) throw Error('Native CPU counter moved backwards');
    return sum + Number(delta) / 1e7;
  }, 0);
  return { cpuTimeSeconds, cpuPercentMachine: cpuTimeSeconds / record.durationSeconds / record.logicalCpus * 100 };
}
