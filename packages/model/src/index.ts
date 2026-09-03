/**
 * Identifies the deterministic shared-model artifact used by both runtimes.
 * It deliberately has no environment or I/O dependency.
 */
export const modelBuildId = 'zerp-model-0.2.0'

export * from './approval.ts'
export * from './warehouse.ts'
export * from './parity.ts'
