export type FailureStage = 'input' | 'environment' | 'prepare' | 'consent' | 'measurement' | 'cleanup' | 'output';
export interface Failure { code: string; stage: FailureStage; message: string }

export class BenchmarkError extends Error {
  constructor(public code: string, public stage: FailureStage, message: string) { super(message); }
}

export function failure(error: unknown, code: string, stage: FailureStage): Failure {
  return error instanceof BenchmarkError
    ? { code: error.code, stage: error.stage, message: error.message }
    : { code, stage, message: error instanceof Error ? error.message : String(error) };
}

export function failureExitCode(error: Failure): number {
  if (error.code === 'INTERRUPTED') return 130;
  return error.stage === 'input' ? 2 : 1;
}
