import { TargetApiError } from '../../api.ts'

type Blocker = {
  kind: string
  entity?: string
  objectId?: string
  domain?: string
  approvalEntryId?: string
}

function blockersOf(cause: unknown): readonly Blocker[] {
  if (!(cause instanceof TargetApiError) || !cause.data) return []
  if (typeof cause.data !== 'object' || !('blockers' in cause.data)) return []
  const blockers = (cause.data as { blockers?: unknown }).blockers
  return Array.isArray(blockers)
    ? blockers.filter(
        (item): item is Blocker =>
          Boolean(item) && typeof item === 'object' && 'kind' in item,
      )
    : []
}

export function describeBobEnablementFailure(cause: unknown): string | null {
  if (
    cause instanceof TargetApiError &&
    cause.errorKey === 'customer_enabled_subunit_required'
  )
    return '客户至少需要一个启用子单位；请先提交并批准子单位变更。'
  const blockers = blockersOf(cause)
  if (!blockers.length) return null
  const descriptions = blockers.map((blocker) => {
    if (
      blocker.kind === 'AUX_CURRENT_REFERENCE' &&
      blocker.entity === 'vehicle'
    )
      return `启用车辆（${blocker.objectId ?? '未知对象'}）`
    return blocker.objectId ? `引用对象（${blocker.objectId}）` : '引用对象'
  })
  return `无法变更启停状态，仍有${descriptions.join('、')}正在使用该档案。`
}

const archiveErrorLabels = {
  forbidden: '当前账号没有执行此操作的权限。',
  unauthenticated: '会话已失效，请重新登录。',
  validation_failed: '输入格式不正确，请检查必填项。',
  approval_invalid_action: '当前操作不可用，请重新读取。',
  approval_invalid_actor: '提交人与审批人必须分离。',
  approval_stale_revision: '资料已变化，请重新读取。',
  approval_not_found: '提交版本不存在或已删除。',
  approval_invalid_transition: '当前状态不允许此操作。',
  approval_open_version_exists: '已有待处理提交，请先处理。',
  approval_not_latest_approved: '只能操作最高已批准版本。',
  approval_strong_reference_exists: '该版本仍有有效引用，不能反批准。',
  archive_stale_facts: '正式版本已变化，请重新读取。',
  archive_conflict: '档案状态已变化，请重新读取。',
  archive_idempotency_conflict: '此提交标识已被其他内容使用。',
  archive_reference_unavailable: '所选引用当前不可用，请重新选择。',
  customer_attachment_not_found: '附件不存在或不属于此版本。',

  customer_enabled_subunit_required:
    '启用客户至少需要一个启用子单位，当前不能回落到该版本。',
  customer_invalid_data:
    '客户资料或子单位资料不符合规则；启用客户至少需要一个启用子单位。',
  customer_reference_unavailable:
    '客户类型、经营主体或业务归属当前不可用，请检查选择。',
  customer_reference_stale: '销售合作方已有新版本，请重新选择。',
  customer_duplicate_legal_identifier: '法定识别号已被其他客户占用。',
  customer_subunit_conflict: '子单位身份或编码冲突，请重新打开客户资料。',
  customer_attachment_invalid_content: '附件内容与文件类型不一致。',
  customer_attachment_staging_conflict: '附件暂存请求冲突，请重新添加附件。',
  customer_attachment_staging_invalid: '附件暂存已失效，请重新添加附件。',
  product_invalid_data: '产品资料不完整或数量、配方不符合规则。',
  product_reference_unavailable: '所选产品资料或原料当前不可用，请检查选择。',
  product_reference_stale: '原料已有新版本，请重新打开表单确认原料。',
  product_duplicate_barcode: '条码已被其他产品的正式版本或提交件占用。',
} as const

export function describeBobArchiveFailure(cause: unknown): string | null {
  if (!(cause instanceof TargetApiError)) return null
  const products = blockersOf(cause).filter(
    (item) =>
      item.kind === 'PRODUCT_REFERENCE' || item.kind === 'CUSTOMER_REFERENCE',
  )
  if (products.length)
    return `无法反批准，仍被${products.map((item) => `${item.domain === 'bob' ? '产品配方' : item.domain === 'acc' ? '会计期初' : '正式单据'}（${item.objectId}）`).join('、')}引用。`
  if (cause.errorKey in archiveErrorLabels)
    return archiveErrorLabels[cause.errorKey as keyof typeof archiveErrorLabels]
  return null
}
