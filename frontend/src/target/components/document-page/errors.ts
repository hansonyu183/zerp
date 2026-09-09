import { TargetApiError } from '../../api.ts'
import { openingErrorCaptions } from './opening-errors.ts'
import { snapshotCaptions } from './snapshot-presentation.ts'
const errorCaptions: Record<string, string> = {
  vou_intermediary_month_required: '该月缺少已批准的居间计算单。',
  vou_intermediary_month_end_required: '业务日期必须为自然月最后一天。',
  vou_intermediary_before_book_start: '计算月份不能早于控制账簿启用月。',
  vou_intermediary_source_basis_missing:
    '来源订单缺少必要的计算快照，请检查来源单据。',
  vou_intermediary_source_invalid: '来源事实存在冲突，请检查签收与退货单据。',
  vou_intermediary_source_changed: '计算来源已变化，请重新计算。',
  vou_intermediary_script_required: '请先维护并保存可用的计算脚本。',
  vou_intermediary_script_changed: '计算脚本已变化，请重新计算。',
  vou_intermediary_month_exists: '该月已有居间计算单，请处理现有单据。',
  vou_intermediary_result_invalid:
    '脚本结果的明细、金额或收款方汇总不符合来源事实。',
  vou_script_stale_revision: '脚本已被修改，请重新读取后再保存。',
  acc_period_intermediary_invalid:
    '结账需要各月已批准且来源仍有效的居间计算单。',
  forbidden: '没有此操作权限。',
  validation_failed: '输入格式不正确。',
  vou_invalid_payload: '请检查必填内容、金额及数量。',
  vou_allocation_total_mismatch: '分摊合计必须等于来款金额。',
  funds_insufficient: '资金余额不足，或反批准会使历史资金余额为负。',
  vou_not_found: '单据不存在。',
  approval_invalid_actor: '提交人与审批人必须分离。',
  approval_invalid_action: '没有此审批权限。',
  approval_invalid_transition: '当前状态不允许此操作。',
  approval_stale_revision: '单据已变化，请重新打开。',
  approval_reason_required: '请填写操作原因。',
  approval_self_review_forbidden: '不能审批自己提交的单据。',
  approval_invalid_request: '审批请求不完整，请重新打开单据。',
  approval_invalid_preparation: '审批准备失败，请重新打开单据。',
  approval_reason_not_allowed: '此审批动作不接受原因。',
  approval_not_found: '提交记录不存在。',
  vou_reference_unavailable: '采用的业务引用不可用，请先处理相关资料。',
  vou_period_locked: '会计期间已锁定，不能执行此操作。',
  vou_credit_limit_exceeded: '超过客户信用限额。',
  acc_control_book_unavailable: '控制账簿不可用，请检查会计配置。',
  vou_document_entity_mismatch: '单据类型与请求不一致。',
  vou_attachment_not_found: '附件不存在。',
  vou_attachment_download_not_found: '附件下载链接已失效，请重新获取。',
  vou_source_line_unavailable: '来源单据行不可用。',
  vou_source_line_quantity_exceeded: '数量超过来源可用数量。',
  vou_settlement_insufficient: '结算余额不足。',
  ...openingErrorCaptions,
  vou_delete_blocked: '单据仍有业务引用，不能删除。',
}

export function documentError(cause: unknown): string {
  if (!(cause instanceof TargetApiError))
    return cause instanceof Error ? cause.message : '操作失败。'
  const caption =
    errorCaptions[cause.errorKey] ??
    '操作未完成，请检查单据状态与相关业务限制。'
  const data = cause.data
  if (
    !data ||
    typeof data !== 'object' ||
    !('blockers' in data) ||
    !Array.isArray(data.blockers)
  )
    return caption
  const details = data.blockers
    .map((item: unknown) => {
      if (!item || typeof item !== 'object') return ''
      const value = item as Record<string, unknown>
      const field =
        typeof value.field === 'string'
          ? value.field.replace(
              /([A-Za-z]+)|\[(\d+)\]/g,
              (_match, key: string | undefined, row: string | undefined) =>
                key
                  ? (snapshotCaptions[key] ?? '相关字段')
                  : `第 ${Number(row) + 1} 行`,
            )
          : ''
      const identity =
        typeof value.documentNo === 'string'
          ? value.documentNo
          : typeof value.documentId === 'string'
            ? value.documentId
            : ''
      return [field, identity].filter(Boolean).join('：')
    })
    .filter(Boolean)
  return details.length ? `${caption} ${details.join('；')}` : caption
}
