export { archiveEntityPresentation } from '@zerp/model'
import type { TargetArchiveEntity } from './api.ts'

export type ArchiveDraftMode = 'NEW' | 'CHANGE'

export interface ArchiveEntityPresentation {
  label: string
  draftLabel: string
}

/** The only target-facing Chinese presentation for archive wire enums. */
export const archiveWirePresentation = {
  carrier: { INTERNAL: '自有经营主体', EXTERNAL: '外部承运单位' },
  capability: {
    EXTERNAL_PART_TIME: '外部兼职销售',
    CHANNEL_PARTNER: '渠道合作方',
  },
  mappingResult: { POST: '记账', UN_POST: '不记账' },
  condition: {
    EQ: '等于',
    NE: '不等于',
    IN: '属于集合',
    NOT_IN: '不属于集合',
    IS_EMPTY: '为空',
    IS_NOT_EMPTY: '不为空',
  },
  direction: { DEBIT: '借方', CREDIT: '贷方' },
  subjectSource: { FIXED: '固定科目', FIELD: '从字段取科目' },
  reportType: {
    TEXT: '文本',
    INTEGER: '整数',
    DECIMAL: '小数',
    BOOLEAN: '是/否',
    DATE: '日期',
    DATE_RANGE: '日期范围',
    ENUM: '选项',
    REFERENCE: '资料引用',
    DATETIME: '日期时间',
  },
  productBehavior: {
    RAW_MATERIAL: '原材料',
    STANDARD_FINISHED: '标准成品',
    CUSTOM_FINISHED: '定制成品',
    PACKAGING: '包装物',
  },
  identity: {
    PERSON: '个人',
    ORGANIZATION: '机构',
    MAINLAND_ENTERPRISE: '大陆企业',
    MAINLAND_INDIVIDUAL: '大陆个人',
    OTHER: '其他',
  },
} as const

export function archiveSubmitPermission(
  entity: TargetArchiveEntity,
  mode: ArchiveDraftMode,
): string {
  return `/dcl/${entity}/${mode === 'NEW' ? 'submit-new' : 'submit-change'}`
}

export function archiveSubmitPermissions(
  entity: TargetArchiveEntity,
  mode: ArchiveDraftMode,
): string[] {
  return [
    archiveSubmitPermission(entity, mode),
    ...archiveReferencePermissions(entity),
    ...(entity === 'customer' && mode === 'NEW'
      ? ['/dcl/customer/save-subunits']
      : []),
  ]
}

/** Permissions needed to present every required server-authoritative candidate. */
export function archiveReferencePermissions(
  entity: TargetArchiveEntity,
): string[] {
  const aux = (...entities: string[]) => [
    '/aux/reference/query',
    ...entities.map((candidate) => `/aux/${candidate}/query`),
  ]
  switch (entity) {
    case 'vehicle':
      return [...aux('dictionary-item'), '/bob/reference/query']
    case 'fund-account':
      return ['/bob/reference/query']
    case 'product':
      return [...aux('product-type', 'product-category', 'measurement-unit')]
    case 'employee':
      return [
        ...aux('employee-category', 'department', 'position'),
        '/bob/reference/query',
      ]
    case 'supplier':
      return [...aux('settlement-method'), '/bob/reference/query']
    case 'customer':
      return [
        ...aux('dictionary-item', 'settlement-method', 'payment-method'),
        '/bob/reference/query',
      ]
    case 'other-unit':
      return [...aux('settlement-method'), '/bob/reference/query']
    case 'sales-partner':
      return ['/bob/reference/query']
    case 'acc-mapping':
      return ['/acc/mapping/catalog']
    case 'operating-entity':
    case 'rpt-definition':
      return []
  }
}

export function canSubmitArchive(
  permissions: readonly string[],
  entity: TargetArchiveEntity,
  mode: ArchiveDraftMode,
): boolean {
  return archiveSubmitPermissions(entity, mode).every((permission) =>
    permissions.includes(permission),
  )
}

export function canCloneArchive(
  permissions: readonly string[],
  entity: TargetArchiveEntity,
  mode: ArchiveDraftMode,
): boolean {
  return (
    permissions.includes(`/dcl/${entity}/get`) &&
    canSubmitArchive(permissions, entity, mode)
  )
}

export type ArchiveFieldKind =
  'text' | 'number' | 'boolean' | 'identity-kind' | 'mapping-result'

export interface ArchiveField {
  key: string
  label: string
  kind: ArchiveFieldKind
}

interface ArchiveEditorPresentation {
  fields: readonly ArchiveField[]
}

const identityFields: readonly ArchiveField[] = [
  { key: 'legalName', label: '法定名称', kind: 'text' },
  { key: 'displayName', label: '显示名称', kind: 'text' },
  { key: 'legalIdentifier', label: '法定识别号', kind: 'text' },
  { key: 'contactName', label: '联系人', kind: 'text' },
  { key: 'phone', label: '联系电话', kind: 'text' },
  { key: 'address', label: '地址', kind: 'text' },
  { key: 'remark', label: '备注', kind: 'text' },
  { key: 'enabled', label: '启用', kind: 'boolean' },
]

const archiveEditorPresentation: Record<
  TargetArchiveEntity,
  ArchiveEditorPresentation
> = {
  'operating-entity': {
    fields: [
      { key: 'legalName', label: '法定名称', kind: 'text' },
      { key: 'shortName', label: '简称', kind: 'text' },
      { key: 'legalIdentifier', label: '统一社会信用代码', kind: 'text' },
      { key: 'registeredAddress', label: '注册地址', kind: 'text' },
      { key: 'contactName', label: '联系人', kind: 'text' },
      { key: 'contactPhone', label: '联系电话', kind: 'text' },
      { key: 'invoiceTitle', label: '发票抬头', kind: 'text' },
      { key: 'invoiceAddress', label: '开票地址', kind: 'text' },
      { key: 'invoicePhone', label: '开票电话', kind: 'text' },
      { key: 'invoiceBank', label: '开户行', kind: 'text' },
      { key: 'invoiceAccount', label: '银行账号', kind: 'text' },
      { key: 'remark', label: '备注', kind: 'text' },
      { key: 'enabled', label: '启用', kind: 'boolean' },
    ],
  },
  vehicle: {
    fields: [
      { key: 'name', label: '车辆名称', kind: 'text' },
      { key: 'plateNumber', label: '车牌号', kind: 'text' },
      { key: 'vin', label: '车架号', kind: 'text' },
      { key: 'engineNumber', label: '发动机号', kind: 'text' },
      { key: 'ratedLoadKg', label: '额定载重（千克）', kind: 'number' },
      { key: 'bulkWaterCarrier', label: '散装水运输', kind: 'boolean' },
      { key: 'remark', label: '备注', kind: 'text' },
      { key: 'enabled', label: '启用', kind: 'boolean' },
    ],
  },
  'fund-account': {
    fields: [
      { key: 'name', label: '账户名称', kind: 'text' },
      { key: 'currency', label: '币种', kind: 'text' },
      { key: 'accountName', label: '户名', kind: 'text' },
      { key: 'bank', label: '开户银行', kind: 'text' },
      { key: 'branch', label: '开户支行', kind: 'text' },
      { key: 'accountNumber', label: '账号', kind: 'text' },
      { key: 'remark', label: '备注', kind: 'text' },
      { key: 'enabled', label: '启用', kind: 'boolean' },
    ],
  },
  product: {
    fields: [
      { key: 'name', label: '产品名称', kind: 'text' },
      { key: 'barcode', label: '条码', kind: 'text' },
      { key: 'specification', label: '规格', kind: 'text' },
      { key: 'model', label: '型号', kind: 'text' },
      { key: 'defaultPackagingSpec', label: '默认包装规格', kind: 'text' },
      { key: 'recyclable', label: '可回收', kind: 'boolean' },
      { key: 'remark', label: '备注', kind: 'text' },
      { key: 'enabled', label: '启用', kind: 'boolean' },
    ],
  },
  employee: {
    fields: [
      { key: 'identityKind', label: '身份类型', kind: 'identity-kind' },
      ...identityFields.filter((field) => field.key !== 'remark'),
      { key: 'employmentDate', label: '入职日期', kind: 'text' },
      { key: 'workPhone', label: '工作电话', kind: 'text' },
      { key: 'workEmail', label: '工作邮箱', kind: 'text' },
      { key: 'remark', label: '备注', kind: 'text' },
    ],
  },
  supplier: {
    fields: [
      { key: 'identityKind', label: '身份类型', kind: 'identity-kind' },
      ...identityFields,
    ],
  },
  customer: {
    fields: [
      { key: 'identityKind', label: '客户身份类型', kind: 'identity-kind' },
      { key: 'legalName', label: '法定名称', kind: 'text' },
      { key: 'displayName', label: '显示名称', kind: 'text' },
      { key: 'legalIdentifier', label: '法定识别号', kind: 'text' },
      { key: 'phone', label: '联系电话', kind: 'text' },
      { key: 'email', label: '电子邮箱', kind: 'text' },
      { key: 'address', label: '地址', kind: 'text' },
      { key: 'invoiceTitle', label: '发票抬头', kind: 'text' },
      { key: 'invoiceAddress', label: '开票地址', kind: 'text' },
      { key: 'invoicePhone', label: '开票电话', kind: 'text' },
      { key: 'invoiceBank', label: '开户行', kind: 'text' },
      { key: 'invoiceAccount', label: '银行账号', kind: 'text' },
      { key: 'enabled', label: '启用', kind: 'boolean' },
    ],
  },
  'other-unit': {
    fields: [
      { key: 'identityKind', label: '身份类型', kind: 'identity-kind' },
      ...identityFields,
    ],
  },
  'sales-partner': {
    fields: [
      { key: 'identityKind', label: '身份类型', kind: 'identity-kind' },
      ...identityFields,
    ],
  },
  'acc-mapping': {
    fields: [
      {
        key: 'defaultResult',
        label: '默认记账结果',
        kind: 'mapping-result',
      },
    ],
  },
  'rpt-definition': {
    fields: [
      { key: 'name', label: '报表名称', kind: 'text' },
      { key: 'description', label: '说明', kind: 'text' },
      { key: 'enabled', label: '启用', kind: 'boolean' },
      { key: 'sql', label: '只读查询语句', kind: 'text' },
    ],
  },
}

export function archiveEditorFields(entity: TargetArchiveEntity) {
  return archiveEditorPresentation[entity].fields
}

export function archiveReadOnlySummary(
  entity: TargetArchiveEntity,
  snapshot: unknown,
): Array<{ label: string; value: string }> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return []
  const record = snapshot as Record<string, unknown>
  return archiveEditorFields(entity)
    .map((field) => ({
      label: field.label,
      value: archiveSummaryValue(field, record[field.key]),
    }))
    .filter((field) => field.value !== '')
}

function archiveSummaryValue(field: ArchiveField, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (field.kind === 'boolean') return value ? '是' : '否'
  if (field.kind === 'identity-kind' && typeof value === 'string')
    return (
      archiveWirePresentation.identity[
        value as keyof typeof archiveWirePresentation.identity
      ] ?? '未识别身份类型'
    )
  if (field.kind === 'mapping-result' && typeof value === 'string')
    return (
      archiveWirePresentation.mappingResult[
        value as keyof typeof archiveWirePresentation.mappingResult
      ] ?? '未识别记账结果'
    )
  if (typeof value === 'string' || typeof value === 'number')
    return String(value)
  if (Array.isArray(value)) return `已配置 ${value.length} 项`
  if (typeof value === 'object') {
    const reference = value as { code?: unknown; name?: unknown }
    if (
      typeof reference.code === 'string' &&
      typeof reference.name === 'string'
    )
      return `${reference.code} · ${reference.name}`
    return '已配置'
  }
  return ''
}
