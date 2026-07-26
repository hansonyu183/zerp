export type BusinessCode = number | string

export interface ApiResponse<T> {
  code: BusinessCode
  message: string
  data: T
  requestId?: string
}

export interface ApiResult<T> {
  data: T
  requestId?: string
}

export interface PageRequest {
  page: number
  pageSize: number
  filters?: Record<string, unknown>
  sort?: Array<{
    field: string
    order: 'asc' | 'desc'
  }>
}

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type ApiErrorKind =
  | 'configuration'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'protocol'
  | 'business'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly code?: BusinessCode
  readonly requestId?: string
  readonly causeValue?: unknown

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: {
      code?: BusinessCode
      requestId?: string
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.code = options.code
    this.requestId = options.requestId
    this.causeValue = options.cause
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId
      ? `${error.message}（请求编号：${error.requestId}）`
      : error.message
  }

  return error instanceof Error ? error.message : '发生未知错误，请稍后重试。'
}
