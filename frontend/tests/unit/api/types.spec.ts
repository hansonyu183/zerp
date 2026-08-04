import { describe, expect, it } from 'vitest'
import {
  ApiError,
  getDiagnosticErrorMessage,
  getErrorMessage,
  sanitizeUserMessage,
} from '@/api/types'

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
    expect(
      getErrorMessage(
        new ApiError('protocol', '后端响应包含数据库字段 password_hash'),
      ),
    ).toBe('服务响应异常，请稍后重试。')
    expect(
      getErrorMessage(
        new ApiError('business', '数据库连接失败：postgres unavailable', {
          code: 5000,
        }),
      ),
    ).toBe('系统暂时无法完成操作，请稍后重试。')
  })

  it('将可处理的英文业务冲突转换为明确中文提示', () => {
    expect(
      getErrorMessage(
        new ApiError(
          'business',
          'generated sales draft is missing required business data',
          { code: 2001 },
        ),
      ),
    ).toBe('自动生成的销售单据缺少必填业务资料，请先编辑补全并保存后再核对。')

    expect(
      getErrorMessage(
        new ApiError(
          'business',
          'document attributes are incomplete; return to draft and save before continuing',
          { code: 3001 },
        ),
      ),
    ).toBe('单据资料不完整，请先退回草稿、补全并保存后再继续。')

    expect(
      getErrorMessage(
        new ApiError('business', 'inventory timeline would become negative', {
          code: 3001,
        }),
      ),
    ).toBe('库存不足，无法完成本次出库，请先补充库存。')

    expect(
      getErrorMessage(
        new ApiError('business', 'settlement-method reference is unavailable', {
          code: 3001,
        }),
      ),
    ).toBe('结算方式已失效，请重新选择后再提交。')

    expect(
      getErrorMessage(
        new ApiError('business', 'submitter cannot review the same version', {
          code: 3001,
        }),
      ),
    ).toBe('提交人与审核人不能为同一人，请由其他有审批权限的用户处理。')

    expect(
      getErrorMessage(
        new ApiError('business', 'system identity is managed internally', {
          code: 3001,
        }),
      ),
    ).toBe('系统用户和系统角色由系统维护，不能人工修改。')

    expect(
      getErrorMessage(new ApiError('business', 'role code is reserved')),
    ).toBe('该角色编码为系统保留编码，请使用其他编码。')
  })

  it('按业务错误码提供明确原因并隐藏未知内部细节', () => {
    expect(
      getErrorMessage(
        new ApiError('business', '密码错误，剩余重试次数 3。', {
          code: 1001,
        }),
      ),
    ).toBe('密码错误，剩余重试次数 3。')
    expect(
      getErrorMessage(
        new ApiError('business', 'invalid currency', { code: 2001 }),
      ),
    ).toBe('币种格式或取值不正确，请检查后重试。')
    expect(
      getErrorMessage(
        new ApiError('business', 'duplicate product', { code: 2001 }),
      ),
    ).toBe('产品重复，请删除重复项后重试。')
    expect(
      getErrorMessage(
        new ApiError('business', 'document changed', { code: 3001 }),
      ),
    ).toBe('单据已被其他操作修改，请刷新后重试。')
    expect(
      getErrorMessage(
        new ApiError('business', 'opaque internal condition', { code: 5000 }),
      ),
    ).toBe('系统暂时无法完成操作，请稍后重试。')
  })

  it('在动作失败反馈中保留错误码和请求标识', () => {
    expect(
      getDiagnosticErrorMessage(
        new ApiError('business', 'opaque internal condition', {
          code: 5000,
          requestId: 'REQ-5000',
        }),
      ),
    ).toBe(
      '系统暂时无法完成操作，请稍后重试。（错误码：5000；请求标识：REQ-5000）',
    )
  })
})
