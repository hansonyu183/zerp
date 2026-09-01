import { describe, expect, it } from 'vitest'
import {
  ApiError,
  getDiagnosticErrorMessage,
  getErrorMessage,
  sanitizeUserMessage,
} from '@/api/types'

describe('API user messages', () => {
  it('按稳定 errorKey 映射业务提示，不读取英文 message', () => {
    expect(
      getErrorMessage(
        new ApiError('business', 'diagnostic text may change', {
          code: 3001,
          errorKey: 'role_changed',
        }),
      ),
    ).toBe('角色已被其他操作修改，请刷新后重试。')
  })

  it('为结构化 blocker 和资源不足返回明确提示', () => {
    expect(
      getErrorMessage(
        new ApiError('business', 'warehouse cannot be disabled', {
          code: 3001,
          errorKey: 'warehouse_disable_blocked',
        }),
      ),
    ).toBe('仓库仍有库存、待处理业务或有效引用，暂时不能停用。')
    expect(
      getErrorMessage(
        new ApiError('business', 'any diagnostic', {
          code: 3001,
          errorKey: 'inventory_insufficient',
        }),
      ),
    ).toBe('库存不足，无法完成本次操作，请先补充库存。')
  })

  it.each([
    [
      'bob_unapprove_blocked',
      '该主体仍被已批准的业务关系引用，不能撤销最后一个批准版本。',
    ],
    [
      'vou_settlement_term_required',
      '订单必须具有明确账期，请先维护结算方式。',
    ],
  ])('映射 Issue #315 稳定错误 %s', (errorKey, message) => {
    expect(
      getErrorMessage(
        new ApiError('business', 'unstable backend diagnostic', {
          code: 3001,
          errorKey,
        }),
      ),
    ).toBe(message)
  })

  it.each([
    [
      'vehicle_identifier_conflict',
      '车牌号或 VIN 已被其他车辆占用，请修改后重试。',
    ],
    [
      'vehicle_type_reference_unavailable',
      '车型资料不存在、已失效或不属于车辆类型字典。',
    ],
    ['vehicle_type_reference_stale', '车型资料已更新，请重新选择并保存。'],
    ['vehicle_carrier_reference_stale', '承运方资料已更新，请重新选择并保存。'],
    ['approval_stale_revision', '当前版本已被其他操作修改，请刷新后重试。'],
  ])('映射车辆申报稳定错误 %s', (errorKey, message) => {
    expect(
      getErrorMessage(
        new ApiError('business', 'unstable backend diagnostic', {
          code: 3001,
          errorKey,
        }),
      ),
    ).toBe(message)
  })

  it('未知 errorKey 使用清理请求标识后的后端可读说明', () => {
    expect(
      getErrorMessage(
        new ApiError('business', '请先维护新增业务条件（requestId: req-2）', {
          code: 2001,
          errorKey: 'future_validation_rule',
        }),
      ),
    ).toBe('请先维护新增业务条件')

    expect(
      getErrorMessage(
        new ApiError('business', 'requestId: req-2', {
          code: 2001,
          errorKey: 'future_validation_rule',
        }),
      ),
    ).toBe('输入内容不符合要求，请检查必填项、格式和取值范围。')
  })

  it('非业务错误使用固定提示并清理请求标识', () => {
    expect(getErrorMessage(new ApiError('protocol', 'invalid payload'))).toBe(
      '服务响应异常，请稍后重试。',
    )
    expect(sanitizeUserMessage('操作失败 requestId: req-2')).toBe('操作失败')
  })

  it('诊断提示保留错误码、errorKey 和 requestId', () => {
    expect(
      getDiagnosticErrorMessage(
        new ApiError('business', 'internal server error', {
          code: 5000,
          errorKey: 'internal_error',
          requestId: 'REQ-5000',
        }),
      ),
    ).toBe(
      '系统暂时无法完成操作，请稍后重试。（错误码：5000；错误标识：internal_error；请求标识：REQ-5000）',
    )
  })
})
