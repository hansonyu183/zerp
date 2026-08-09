import { translateBusinessMessage } from '@/api/business-error-messages'

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
  'configuration' | 'network' | 'timeout' | 'aborted' | 'protocol' | 'business'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly code?: BusinessCode
  readonly requestId?: string
  readonly details?: unknown
  readonly causeValue?: unknown

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: {
      code?: BusinessCode
      requestId?: string
      details?: unknown
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.code = options.code
    this.requestId = options.requestId
    this.details = options.details
    this.causeValue = options.cause
  }
}

function normalizedCode(code: BusinessCode | undefined): number | undefined {
  if (typeof code === 'number') return code
  if (typeof code !== 'string' || !/^\d+$/u.test(code)) return undefined
  return Number(code)
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const message = sanitizeUserMessage(error.message)
    if (error.kind !== 'business') {
      return {
        configuration: '系统配置异常，请联系管理员。',
        network: '网络连接失败，请检查网络后重试。',
        timeout: '请求超时，请稍后重试。',
        aborted: '请求已取消。',
        protocol: '服务响应异常，请稍后重试。',
      }[error.kind]
    }

    const code = normalizedCode(error.code)
    if (code === 5000) return '系统暂时无法完成操作，请稍后重试。'
    if (containsChineseText(message)) return message

    const translated = translateBusinessMessage(message)
    if (translated) return translated
    if (code === 1001) return '登录失败，请检查账号和密码后重试。'
    if (code === 1002) return '没有权限执行此操作，请联系管理员。'
    if (code === 2001)
      return '输入内容不符合要求，请检查必填项、格式和取值范围。'
    if (code === 3001)
      return '当前数据状态不允许此操作，请刷新并检查相关业务资料。'
    return '业务条件不满足，请检查相关资料后重试。'
  }

  if (error instanceof Error) {
    const message = sanitizeUserMessage(error.message)
    if (containsChineseText(message)) return message
  }
  return '操作失败，请稍后重试。'
}

export function getDiagnosticErrorMessage(error: unknown): string {
  const message = getErrorMessage(error)
  if (!(error instanceof ApiError)) return message

  const diagnostics = [
    error.code === undefined ? '' : `错误码：${String(error.code)}`,
    error.requestId ? `请求标识：${error.requestId}` : '',
  ].filter(Boolean)
  return diagnostics.length
    ? `${message}（${diagnostics.join('；')}）`
    : message
}

export function containsChineseText(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
}

export function sanitizeUserMessage(value: string): string {
  return value
    .replace(/\s*[（(]?请求(?:编号|号)\s*[：:]\s*[^）)\s]+[）)]?/giu, '')
    .replace(/\s*[（(]?request[\s_-]*id\s*[：:]\s*[^）)\s]+[）)]?/giu, '')
    .trim()
}
