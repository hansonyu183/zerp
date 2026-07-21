import { ApiError, type ApiResponse, type ApiResult } from '@/api/types'

const API_PATH_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/

interface ApiClientOptions {
  baseUrl?: string
  timeoutMs?: number
  fetcher?: typeof fetch
}

interface PostOptions {
  signal?: AbortSignal
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (!value || typeof value !== 'object') return false

  const response = value as Record<string, unknown>
  return (
    (typeof response.code === 'number' || typeof response.code === 'string') &&
    typeof response.message === 'string' &&
    'data' in response &&
    (response.requestId === undefined || typeof response.requestId === 'string')
  )
}

export class ApiClient {
  private readonly baseUrl?: string
  private readonly timeoutMs: number
  private readonly fetcher: typeof fetch
  private csrfToken: string | null = null

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl?.trim()
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  }

  setCsrfToken(token: string | null): void {
    this.csrfToken = token
  }

  async post<TResponse, TRequest = Record<string, never>>(
    path: string,
    body: TRequest,
    options: PostOptions = {},
  ): Promise<ApiResult<TResponse>> {
    if (!this.baseUrl) {
      throw new ApiError(
        'configuration',
        '未配置真实后端 API，请设置 VITE_API_BASE_URL。',
      )
    }

    const normalizedPath = path.replace(/^\/+|\/+$/g, '')
    if (!API_PATH_PATTERN.test(normalizedPath)) {
      throw new ApiError(
        'configuration',
        `API 路径必须符合 domain/entity/action：${path}`,
      )
    }

    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)
    const abortFromCaller = () => controller.abort(options.signal?.reason)

    if (options.signal?.aborted) {
      abortFromCaller()
    } else {
      options.signal?.addEventListener('abort', abortFromCaller, { once: true })
    }

    try {
      const headers = new Headers({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      })

      if (this.csrfToken) headers.set('X-CSRF-Token', this.csrfToken)

      const response = await this.fetcher(
        new URL(normalizedPath, normalizeBaseUrl(this.baseUrl)),
        {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      )

      if (response.status !== 200) {
        throw new ApiError(
          'protocol',
          `后端返回了不符合约定的 HTTP 状态：${response.status}`,
        )
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch (error) {
        throw new ApiError('protocol', '后端响应不是有效的 JSON。', {
          cause: error,
        })
      }

      if (!isApiResponse(payload)) {
        throw new ApiError('protocol', '后端响应不符合统一响应包络。')
      }

      if (payload.code !== 0 && payload.code !== '0') {
        throw new ApiError('business', payload.message || '业务操作失败。', {
          code: payload.code,
          requestId: payload.requestId,
        })
      }

      return {
        data: payload.data as TResponse,
        requestId: payload.requestId,
      }
    } catch (error) {
      if (error instanceof ApiError) throw error

      if (timedOut) {
        throw new ApiError('timeout', '请求超时，请稍后重试。', { cause: error })
      }

      if (options.signal?.aborted) {
        throw new ApiError('aborted', '请求已取消。', { cause: error })
      }

      throw new ApiError('network', '无法连接真实后端 API。', { cause: error })
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abortFromCaller)
    }
  }
}

export const apiClient = new ApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
})
