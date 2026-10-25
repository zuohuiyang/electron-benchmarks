import type { Failure } from './errors.js';
export type TestName = 'startup' | 'memory' | 'cpu' | 'all';
export type Phase = 'cold' | 'warm' | 'memory' | 'cpu';
export interface Config {
  test: TestName; electrons: string[]; scenario?: 'warm' | 'cold'; repeat?: number; out?: string;
}
export const PRESET = Object.freeze({ startupRepeat: 20, resourceRepeat: 10, warmups: 5,
  resourceWarmups: 1, settleMs: 10_000, observeMs: 20_000, sampleMs: 1_000,
  minimumBootSeconds: 120, cpuLimit: 10, idleReadings: 3, idleIntervalMs: 2_000,
  idleTimeoutMs: 1_200_000, launchTimeoutMs: 30_000, restartCountdownMs: 15_000 });
export interface Target {
  id: string; input: string; executable: string; version: string; identity: string;
  manifest: { path: string; sha256: string }[]; profileTemplate: string;
}
export interface Step { id: string; phase: Phase; target: number; round: number; warmup: boolean }
export interface NativeInfo {
  pid: number; frequency: string; qpcBefore: string; qpcAfter: string;
  utcFileTime100ns: string; creationFileTime100ns: string;
  cpuPriority: number; ioPriority: number; memoryPriority: number;
  bootId: string; uptimeSeconds: number; idleTime: string; kernelTime: string; userTime: string;
  readBytes: string; writeBytes: string; elevated: boolean; desktop: string;
  sessionId: number; interactiveSessions: number; userSid: string; virtualized: boolean;
}
export interface Sample {
  schemaVersion: 1; step: Step; targetId: string; valid: boolean; error?: string;
  metrics: Record<string, number>; raw: Record<string, unknown>; startedAt: string;
}
export interface Run {
  schemaVersion: 1; toolVersion: string; root: string; config: Config; targets: Target[];
  steps: Step[]; next: number; status: 'prepared' | 'running' | 'waiting-reboot' | 'complete' | 'failed' | 'interrupted';
  lastBoot: string; pendingStep?: string; warmBoot?: string; userSid: string;
  nodePath: string; nodeSha256: string; toolRoot: string;
  toolManifest: { path: string; sha256: string }[]; environment: Record<string, unknown>;
  restartCount: number; startupCommand?: string; error?: string; cleanupError?: string; failure?: Failure;
  planSha256?: string;
}
