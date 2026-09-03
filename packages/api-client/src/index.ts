import { hc } from 'hono/client'

import type { TargetAppType } from '@zerp/api/client'

export interface TargetApiClientOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  modelBuildId: string
}

export type TargetApiClient = ReturnType<typeof createTargetApiClient>

/**
 * The isolated target client is derived directly from the executable Hono AppType.
 * It intentionally owns no request or response DTOs.
 */
export function createTargetApiClient(options: TargetApiClientOptions) {
  const request = options.fetch ?? globalThis.fetch
  return hc<TargetAppType>(options.baseUrl, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      request(input, { ...init, credentials: 'include' }),
    headers: { 'X-ZERP-Model-Build': options.modelBuildId },
  })
}
