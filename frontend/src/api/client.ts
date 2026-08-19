import createClient, { type Client } from 'openapi-fetch'
import type { components, paths } from '@/api/generated/schema'
import { ApiError, type ApiResponse, type ApiResult } from '@/api/types'

const API_PATH_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/

type ContractPostPath = {
  [Path in keyof paths]: paths[Path] extends { post: unknown } ? Path : never
}[keyof paths] &
  string
export type BobApiEntity = components['schemas']['BobEntity']
export type AuxApiEntity = components['schemas']['AuxEntity']
export type VouApiEntity = components['schemas']['VouEntity']
type ConcretePostPath<Path extends string> =
  Path extends `/bob/{entity}/${infer Action}`
    ? `bob/${BobApiEntity}/${Action}`
    : Path extends `/aux/{entity}/${infer Action}`
      ? `aux/${AuxApiEntity}/${Action}`
      : Path extends `/vou/{entity}/${infer Action}`
        ? `vou/${VouApiEntity}/${Action}`
        : Path extends `/rpt/{report}/${infer Action}`
          ? `rpt/${string}/${Action}`
          : Path extends `/wfl/{processName}/${infer Action}`
            ? `wfl/${string}/${Action}`
            : Path extends `/${infer Concrete}`
              ? Concrete
              : never

export type ApiPostPath = ConcretePostPath<ContractPostPath>

type ContractPathFor<Path extends ApiPostPath> =
  `/${Path}` extends ContractPostPath
    ? `/${Path}`
    : Path extends `bob/${BobApiEntity}/${infer Action}`
      ? `/bob/{entity}/${Action}`
      : Path extends `aux/${AuxApiEntity}/${infer Action}`
        ? `/aux/{entity}/${Action}`
        : Path extends `vou/${VouApiEntity}/${infer Action}`
          ? `/vou/{entity}/${Action}`
          : Path extends `rpt/${string}/${infer Action}`
            ? `/rpt/{report}/${Action}` extends ContractPostPath
              ? `/rpt/{report}/${Action}`
              : never
            : Path extends `wfl/${string}/${infer Action}`
              ? `/wfl/{processName}/${Action}` extends ContractPostPath
                ? `/wfl/{processName}/${Action}`
                : never
              : never

type ContractPostOperation<Path extends ApiPostPath> =
  paths[ContractPathFor<Path> & keyof paths] extends {
    post: infer Operation
  }
    ? Operation
    : never

export type ApiPostRequest<Path extends ApiPostPath> =
  ContractPostOperation<Path> extends {
    requestBody: { content: { 'application/json': infer Request } }
  }
    ? Request
    : never

type ApiPostResponse<Path extends ApiPostPath> =
  ContractPostOperation<Path> extends {
    responses: { 200: { content: { 'application/json': infer Response } } }
  }
    ? Response
    : never

export type ApiPostData<Path extends ApiPostPath> =
  ApiPostResponse<Path> extends { data: infer Data } ? NonNullable<Data> : never

interface ApiClientOptions {
  baseUrl?: string
  timeoutMs?: number
  fetcher?: typeof fetch
}

interface PostOptions {
  signal?: AbortSignal
}

interface FileRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface CsvDownload {
  blob: Blob
  filename: string
  requestId?: string
}

interface ContractPostResult {
  data?: unknown
  error?: unknown
  response: Response
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
  private readonly contractClient?: Client<paths>
  private csrfToken: string | null = null

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl?.trim()
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    if (this.baseUrl) {
      this.contractClient = createClient<paths>({
        baseUrl: normalizeBaseUrl(this.baseUrl),
        fetch: (request) => this.fetcher(request),
      })
    }
  }

  setCsrfToken(token: string | null): void {
    this.csrfToken = token
  }

  async post<TResponse, TRequest = Record<string, never>>(
    path: ApiPostPath,
    body: TRequest,
    options: PostOptions = {},
  ): Promise<ApiResult<TResponse>> {
    if (!this.baseUrl || !this.contractClient) {
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

      const contractRequest = this.resolveContractPost(normalizedPath)
      const post = this.contractClient.POST as unknown as (
        path: ContractPostPath,
        options: {
          body: unknown
          credentials: RequestCredentials
          headers: Headers
          params?: {
            path: { entity?: string; processName?: string; report?: string }
          }
          parseAs: 'text'
          signal: AbortSignal
        },
      ) => Promise<ContractPostResult>
      const result = await post(contractRequest.path, {
        body,
        credentials: 'include',
        headers,
        ...(contractRequest.entity ||
        contractRequest.processName ||
        contractRequest.report
          ? {
              params: {
                path: {
                  ...(contractRequest.entity
                    ? { entity: contractRequest.entity }
                    : {}),
                  ...(contractRequest.processName
                    ? { processName: contractRequest.processName }
                    : {}),
                  ...(contractRequest.report
                    ? { report: contractRequest.report }
                    : {}),
                },
              },
            }
          : {}),
        parseAs: 'text',
        signal: controller.signal,
      })
      const { response } = result

      if (response.status !== 200) {
        throw new ApiError(
          'protocol',
          `后端返回了不符合约定的 HTTP 状态：${response.status}`,
        )
      }

      let payload: unknown
      try {
        const rawPayload = result.data ?? result.error
        if (typeof rawPayload !== 'string') {
          throw new TypeError('OpenAPI client did not return a text payload')
        }
        payload = JSON.parse(rawPayload)
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
          details: payload.data,
        })
      }

      return {
        data: payload.data as TResponse,
        requestId: payload.requestId,
      }
    } catch (error) {
      if (error instanceof ApiError) throw error

      if (timedOut) {
        throw new ApiError('timeout', '请求超时，请稍后重试。', {
          cause: error,
        })
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

  async postContract<Path extends ApiPostPath>(
    path: Path,
    body: ApiPostRequest<Path>,
    options: PostOptions = {},
  ): Promise<ApiResult<ApiPostData<Path>>> {
    const result = await this.post<
      ApiPostData<Path> | null,
      ApiPostRequest<Path>
    >(path, body, options)
    if (result.data === null) {
      throw new ApiError('protocol', '后端成功响应缺少契约数据。')
    }
    return { ...result, data: result.data }
  }

  private resolveContractPost(path: string): {
    path: ContractPostPath
    entity?: string
    processName?: string
    report?: string
  } {
    const segments = path.split('/')
    if (
      segments.length === 3 &&
      segments[0] === 'rpt' &&
      segments[1] !== 'definition'
    ) {
      return {
        path: `/rpt/{report}/${segments[2]}` as ContractPostPath,
        report: segments[1],
      }
    }
    if (
      segments.length === 3 &&
      (segments[0] === 'bob' || segments[0] === 'aux' || segments[0] === 'vou')
    ) {
      return {
        path: `/${segments[0]}/{entity}/${segments[2]}` as ContractPostPath,
        entity: segments[1],
      }
    }
    if (
      segments.length === 3 &&
      segments[0] === 'wfl' &&
      segments[1] !== 'process-definition' &&
      segments[1] !== 'process-instance' &&
      ['query', 'get', 'audit-history', 'create-child'].includes(
        segments[2] ?? '',
      )
    ) {
      return {
        path: `/wfl/{processName}/${segments[2]}` as ContractPostPath,
        processName: segments[1],
      }
    }
    return { path: `/${path}` as ContractPostPath }
  }

  async uploadAttachment(
    uploadUrl: string,
    file: File,
    options: FileRequestOptions = {},
  ): Promise<void> {
    await this.uploadFile(
      uploadUrl,
      '/files/attachments/upload/',
      file,
      options,
      false,
    )
  }

  async uploadCustomerAttachment(
    uploadUrl: string,
    file: File,
    options: FileRequestOptions = {},
  ): Promise<void> {
    await this.uploadFile(
      uploadUrl,
      '/files/customer-attachments/upload/',
      file,
      options,
      false,
    )
  }

  async uploadFeedbackAttachment(
    uploadUrl: string,
    file: File,
    options: FileRequestOptions = {},
  ): Promise<void> {
    await this.uploadFile(
      uploadUrl,
      '/files/feedback/attachments/upload/',
      file,
      options,
      true,
    )
  }

  private async uploadFile(
    uploadUrl: string,
    requiredPrefix: string,
    file: File,
    options: FileRequestOptions,
    requiresCsrf: boolean,
  ): Promise<void> {
    const url = this.resolveFileUrl(uploadUrl, requiredPrefix)
    const response = await this.fileRequest(
      url,
      {
        method: 'PUT',
        credentials: 'include',
        headers: new Headers({
          'Content-Type': file.type,
          ...(requiresCsrf && this.csrfToken
            ? { 'X-CSRF-Token': this.csrfToken }
            : {}),
        }),
        body: file,
      },
      options,
    )

    if (response.status !== 204) {
      await this.throwFileResponseError(response)
    }
  }

  async fetchAttachment(
    downloadUrl: string,
    options: FileRequestOptions = {},
  ): Promise<Blob> {
    const url = this.resolveFileUrl(downloadUrl, '/files/attachments/download/')
    const response = await this.fileRequest(
      url,
      {
        method: 'GET',
        credentials: 'include',
        headers: new Headers({ Accept: 'application/octet-stream' }),
      },
      options,
    )

    if (response.status !== 200) {
      await this.throwFileResponseError(response)
    }
    return response.blob()
  }

  async fetchCustomerAttachment(
    downloadUrl: string,
    options: FileRequestOptions = {},
  ): Promise<Blob> {
    const url = this.resolveFileUrl(
      downloadUrl,
      '/files/customer-attachments/download/',
    )
    const response = await this.fileRequest(
      url,
      {
        method: 'GET',
        credentials: 'include',
        headers: new Headers({ Accept: 'application/octet-stream' }),
      },
      options,
    )
    if (response.status !== 200) await this.throwFileResponseError(response)
    return response.blob()
  }

  async exportReportCsv(
    report: string,
    body: components['schemas']['RptExecuteRequest'],
    options: FileRequestOptions = {},
  ): Promise<CsvDownload> {
    if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(report)) {
      throw new ApiError('configuration', '报表编码不符合接口约定。')
    }
    const response = await this.fileRequest(
      this.resolveApiUrl(`rpt/${report}/export`),
      {
        method: 'POST',
        credentials: 'include',
        headers: new Headers({
          Accept: 'text/csv, application/json',
          'Content-Type': 'application/json',
          ...(this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}),
        }),
        body: JSON.stringify(body),
      },
      options,
    )
    if (response.status !== 200) await this.throwFileResponseError(response)

    const requestId = response.headers.get('X-Request-ID') ?? undefined
    const contentType = response.headers.get('Content-Type') ?? ''
    if (contentType.toLowerCase().includes('application/json')) {
      const payload = await this.readBusinessResponse(response)
      if (payload.code === 0 || payload.code === '0') {
        throw new ApiError('protocol', 'CSV 导出端点返回了非 CSV 成功响应。', {
          requestId: payload.requestId ?? requestId,
        })
      }
      throw new ApiError('business', payload.message || '业务操作失败。', {
        code: payload.code,
        requestId: payload.requestId ?? requestId,
        details: payload.data,
      })
    }
    if (!contentType.toLowerCase().includes('text/csv')) {
      throw new ApiError('protocol', '导出响应不是 CSV 文件。', { requestId })
    }
    return {
      blob: await response.blob(),
      filename:
        csvFilename(response.headers.get('Content-Disposition')) ??
        `${report}.csv`,
      requestId,
    }
  }

  private resolveFileUrl(value: string, requiredPrefix: string): URL {
    if (!this.baseUrl) {
      throw new ApiError(
        'configuration',
        '未配置真实后端 API，请设置 VITE_API_BASE_URL。',
      )
    }

    const normalizedBaseUrl = normalizeBaseUrl(this.baseUrl)
    const base = normalizedBaseUrl.startsWith('/')
      ? new URL(normalizedBaseUrl, window.location.origin)
      : new URL(normalizedBaseUrl)
    const resolved = new URL(value, base)
    if (
      resolved.origin !== base.origin ||
      !resolved.pathname.startsWith(requiredPrefix)
    ) {
      throw new ApiError('configuration', '附件地址不符合后端文件端点约定。')
    }
    return resolved
  }

  private resolveApiUrl(path: string): URL {
    if (!this.baseUrl) {
      throw new ApiError(
        'configuration',
        '未配置真实后端 API，请设置 VITE_API_BASE_URL。',
      )
    }
    const normalizedBaseUrl = normalizeBaseUrl(this.baseUrl)
    const base = normalizedBaseUrl.startsWith('/')
      ? new URL(normalizedBaseUrl, window.location.origin)
      : new URL(normalizedBaseUrl)
    const resolved = new URL(path, base)
    if (
      resolved.origin !== base.origin ||
      !resolved.pathname.startsWith(base.pathname)
    ) {
      throw new ApiError(
        'configuration',
        '报表导出地址不符合后端 API 端点约定。',
      )
    }
    return resolved
  }

  private async fileRequest(
    url: URL,
    init: RequestInit,
    options: FileRequestOptions,
  ): Promise<Response> {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs ?? 60_000)
    const abortFromCaller = () => controller.abort(options.signal?.reason)

    if (options.signal?.aborted) {
      abortFromCaller()
    } else {
      options.signal?.addEventListener('abort', abortFromCaller, { once: true })
    }

    try {
      return await this.fetcher(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (timedOut) {
        throw new ApiError('timeout', '附件请求超时，请稍后重试。', {
          cause: error,
        })
      }
      if (options.signal?.aborted) {
        throw new ApiError('aborted', '附件请求已取消。', { cause: error })
      }
      throw new ApiError('network', '无法连接附件服务。', { cause: error })
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  private async throwFileResponseError(response: Response): Promise<never> {
    let message = `附件服务返回了 HTTP ${response.status}。`
    let requestId = response.headers.get('X-Request-ID') ?? undefined
    let payload:
      | {
          error?: unknown
          requestId?: unknown
          code?: unknown
          message?: unknown
          data?: unknown
        }
      | undefined
    try {
      payload = (await response.json()) as typeof payload
    } catch {
      // Technical file endpoints may return an empty/non-JSON proxy response.
    }
    if (payload && isApiResponse(payload)) {
      throw new ApiError(
        payload.code === 0 || payload.code === '0' ? 'protocol' : 'business',
        payload.message || message,
        {
          code: payload.code,
          requestId: payload.requestId ?? requestId,
          details: payload.data,
        },
      )
    }
    if (typeof payload?.error === 'string' && payload.error) {
      message = payload.error
    }
    if (typeof payload?.requestId === 'string' && payload.requestId) {
      requestId = payload.requestId
    }

    if (response.status === 400 || response.status === 409) {
      throw new ApiError('business', message, {
        code: response.status,
        requestId,
      })
    }
    throw new ApiError('protocol', message, {
      code: response.status,
      requestId,
    })
  }

  private async readBusinessResponse(
    response: Response,
  ): Promise<ApiResponse<unknown>> {
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
    return payload
  }
}

function csvFilename(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) return undefined
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1]
  const plain = /filename="?([^";]+)"?/i.exec(contentDisposition)?.[1]
  const value = utf8 ?? plain
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const apiClient = new ApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
})
