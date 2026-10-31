import type { Phase } from './model.js';

export const phaseMetrics: Record<Phase, string[]> = {
  cold: ['appReadyMs', 'videoCallbackMs', 'parentToCreationMs', 'spawnCallMs'],
  warm: ['appReadyMs', 'videoCallbackMs', 'parentToCreationMs', 'spawnCallMs'],
  memory: ['privateBytesSumMiB', 'workingSetSumMiB', 'observedWorkingSetPeakMiB'],
  cpu: ['cpuPercentMachine', 'cpuTimeSeconds']
};

export interface MetricDefinition {
  unit: 'ms' | 'MiB' | '%' | 's'; direction: 'lower' | 'informational';
  role: 'primary' | 'secondary' | 'diagnostic'; description: string;
}

export const metricDefinitions: Record<string, MetricDefinition> = {
  appReadyMs: { unit: 'ms', direction: 'lower', role: 'primary', description: 'Parent before spawn to app.whenReady entry; Electron initialized, not page interactivity.' },
  videoCallbackMs: { unit: 'ms', direction: 'lower', role: 'secondary', description: 'Parent before spawn to first observed visible video callback; not physical screen presentation.' },
  parentToCreationMs: { unit: 'ms', direction: 'informational', role: 'diagnostic', description: 'Parent before spawn to Windows process creation; timing boundary check.' },
  spawnCallMs: { unit: 'ms', direction: 'informational', role: 'diagnostic', description: 'Synchronous spawn call duration; timing boundary check.' },
  privateBytesSumMiB: { unit: 'MiB', direction: 'lower', role: 'primary', description: 'Per-run mean of summed process private committed memory; not resident physical memory.' },
  workingSetSumMiB: { unit: 'MiB', direction: 'lower', role: 'secondary', description: 'Per-run mean of summed process working sets; shared pages may be counted more than once.' },
  observedWorkingSetPeakMiB: { unit: 'MiB', direction: 'lower', role: 'secondary', description: 'Per-run maximum sampled working-set sum during observation; not lifetime peak.' },
  cpuPercentMachine: { unit: '%', direction: 'lower', role: 'primary', description: 'Per-run native CPU time / actual observation duration / logical CPU count * 100; 100% means all logical CPUs fully occupied.' },
  cpuTimeSeconds: { unit: 's', direction: 'lower', role: 'secondary', description: 'Total native process CPU time consumed during one observation; small intervals may quantize to zero.' }
};
