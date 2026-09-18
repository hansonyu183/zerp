import {
  vouEntityPresentation,
  accBookTemplates,
  accSettlementPurposes,
  accSubjectDimensions,
} from '@zerp/model'
import { TargetApiError } from '../../api.ts'
const templates = {
  ENTERPRISE: '企业会计准则',
  SMALL_BUSINESS: '小企业会计准则',
  EMPTY: '空白科目表',
} as const
const purposes = {
  NONE: '无',
  RECEIVABLE: '应收',
  PREPAID: '预付',
  PAYABLE: '应付',
  ADVANCE_RECEIPT: '预收',
  OTHER: '其他往来',
} as const
const dimensions = {
  CUSTOMER: '客户',
  SUPPLIER: '供应商',
  OTHER_UNIT: '其他单位',
  EMPLOYEE: '员工',
  SALES_PARTNER: '销售合作方',
  DEPARTMENT: '部门',
  PRODUCT: '产品',
  WAREHOUSE: '仓库',
  FUND_ACCOUNT: '资金账户',
  ASSET: '资产',
  BILL: '票据',
} as const
export const bookTemplateOptions = accBookTemplates.map((value) => ({
  value,
  caption: templates[value],
}))
export const settlementPurposeOptions = accSettlementPurposes.map((value) => ({
  value,
  caption: purposes[value],
}))
export const subjectDimensionOptions = accSubjectDimensions.map((value) => ({
  value,
  caption: dimensions[value],
}))
export const balanceDirectionOptions = [
  { value: 'DEBIT', caption: '借方' },
  { value: 'CREDIT', caption: '贷方' },
] as const
const errors: Record<string, string> = {
  validation_failed: '输入内容不符合要求，请检查后重试。',
  forbidden: '当前账号没有操作权限。',
  unauthenticated: '会话已失效，请重新登录。',
  approval_invalid_action: '当前账号没有操作权限。',
  approval_stale_revision: '资料已被其他人修改，请重新查询后操作。',
  acc_book_not_found: '账簿不存在。',
  acc_book_access_denied: '没有此账簿的访问范围。',
  acc_book_access_user_not_found: '所选人员不存在或已停用，请检查人员范围。',
  acc_book_code_exhausted: '账簿编号已用尽。',
  acc_book_delete_blocked: '账簿仍有业务引用，无法删除。',
  acc_control_book_delete_forbidden: '控制账簿不可删除。',
  acc_subject_not_found: '科目不存在。',
  acc_subject_parent_invalid: '上级科目无效，不能跨账簿或形成循环。',
  acc_subject_frozen: '科目已有引用，冻结字段不可修改，停用后不可重新启用。',
  acc_subject_delete_blocked: '科目有子科目或业务引用，无法删除。',
  acc_subject_inventory_dimension_required:
    '库存数量核算必须同时选择产品和仓库维度。',
  acc_subject_settlement_dimension_required:
    '所选结算用途缺少对应的辅助核算维度。',
  acc_subject_template_parent_missing: '科目模板缺少上级科目。',
  acc_period_before_book_start: '该月份早于账簿开始月份。',
  acc_period_not_ended: '该月份尚未结束，不能锁定。',
  acc_period_already_locked: '该月份已经锁定。',
  acc_period_not_continuous: '必须从开始月份连续锁定。',
  acc_period_opening_not_approved: '期初尚未批准，请先完成期初审批。',
  acc_period_open_vou: '该月份仍有未批准单据。',
  acc_period_mapping_missing: '已批准单据缺少当前会计映射。',
  acc_period_negative_inventory: '存在负库存，不能锁定。',
  acc_period_unbalanced: '会计试算不平衡，不能锁定。',
  acc_period_intermediary_invalid: '居间计算未完成或校验失败，不能锁定。',
  acc_period_not_locked: '该月份尚未锁定。',
  acc_period_unlock_not_latest: '只能解锁最后一个已锁月份。',
  conflict: '资料状态或编码冲突，请检查后重新操作。',
  internal_error: '服务暂时不可用，请稍后重试。',
}
const blockerKinds: Record<string, string> = {
  MAPPING: '会计映射',
  SUBJECT: '会计科目',
  OPENING: '期初',
  JOURNAL: '会计凭证',
  CHILD_SUBJECT: '子科目',
  JOURNAL_LINE: '会计分录',
  TRIAL_BALANCE: '试算平衡',
  VOU: '业务单据',
  INVENTORY: '库存',
  INTERMEDIARY: '居间计算',
}
export function accErrorMessage(cause: unknown): string {
  if (!(cause instanceof TargetApiError)) return '网络请求失败，请稍后重试。'
  const message =
    errors[cause.errorKey] ?? '会计操作失败，请检查输入和业务状态。'
  const data = cause.data
  if (
    !data ||
    typeof data !== 'object' ||
    !('blockers' in data) ||
    !Array.isArray(data.blockers)
  )
    return message
  const details = data.blockers.map((item: unknown) => {
    if (!item || typeof item !== 'object') return '业务冲突'
    const value = item as Record<string, unknown>
    const kind =
      typeof value.kind === 'string'
        ? (blockerKinds[value.kind] ?? '业务冲突')
        : '业务冲突'
    const entity =
      typeof value.entity === 'string' &&
      Object.hasOwn(vouEntityPresentation, value.entity)
        ? vouEntityPresentation[
            value.entity as keyof typeof vouEntityPresentation
          ].label
        : undefined
    const identity = [
      value.documentNo,
      value.id,
      value.currency,
      value.month,
      entity,
      typeof value.warehouse_id === 'string'
        ? `仓库：${value.warehouse_id}`
        : undefined,
      typeof value.product_id === 'string'
        ? `产品：${value.product_id}`
        : undefined,
    ]
      .filter((value) => typeof value === 'string')
      .join(' · ')
    return identity ? `${kind}：${identity}` : kind
  })
  return details.length ? `${message} ${details.join('；')}` : message
}
