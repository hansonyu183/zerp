import { describe, expect, it } from 'vitest'
import { ApiError, getErrorMessage, sanitizeUserMessage } from '@/api/types'

describe('API user messages', () => {
  it('隐藏请求编号并保留中文业务信息', () => {
    expect(
      getErrorMessage(
        new ApiError('business', '资料保存失败（请求编号：REQ-1）', {
          requestId: 'REQ-1',
        }),
      ),
    ).toBe('资料保存失败')
    expect(sanitizeUserMessage('操作失败 requestId: req-2')).toBe('操作失败')
  })

  it('将英文和协议内部错误转换为中文通用提示', () => {
    expect(getErrorMessage(new Error('internal server error'))).toBe(
      '操作失败，请稍后重试。',
    )
    expect(getErrorMessage(new ApiError('protocol', 'invalid payload'))).toBe(
      '服务响应异常，请稍后重试。',
    )
  })
})
