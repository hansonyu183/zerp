import { createWflStarlark } from './index.ts'

;(
  globalThis as typeof globalThis & {
    __zerpCreateWflStarlark?: typeof createWflStarlark
  }
).__zerpCreateWflStarlark = createWflStarlark
