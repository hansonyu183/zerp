/**
 * Identifies the deterministic shared-model artifact used by both runtimes.
 * It deliberately has no environment or I/O dependency.
 */
export const modelBuildId = 'zerp-model-0.4.0'

export * from './approval.ts'
export * from './acc.ts'
export * from './submission.ts'
export * from './archives.ts'
export * from './aux-current.ts'
export * from './vou.ts'
export * from './parity.ts'

export * from './intermediary-calculation.ts'
