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

const businessMessageTranslations: Readonly<Record<string, string>> = {
  'document attributes are incomplete; return to draft and save before continuing':
    '单据资料不完整，请先编辑并补全必填信息，保存后再重试。',
  'inventory timeline would become negative':
    '库存不足，无法完成销售出库。请先补充库存后重试。',
  'settlement-method reference is unavailable':
    '结算方式已失效，请先编辑并重新选择后再提交审核。',
  'submitter cannot review the same version':
    '提交人与审核人不能为同一人，请由其他有审批权限的用户处理。',
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const message = sanitizeUserMessage(error.message)
    if (error.kind === 'business' && businessMessageTranslations[message]) {
      return businessMessageTranslations[message]
    }
    if (containsChineseText(message)) return message

    return {
      configuration: '系统配置异常，请联系管理员。',
      network: '网络连接失败，请检查网络后重试。',
      timeout: '请求超时，请稍后重试。',
      aborted: '请求已取消。',
      protocol: '服务响应异常，请稍后重试。',
      business: '操作未完成，请检查输入后重试。',
    }[error.kind]
  }

  if (error instanceof Error) {
    const message = sanitizeUserMessage(error.message)
    if (containsChineseText(message)) return message
  }
  return '操作失败，请稍后重试。'
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
