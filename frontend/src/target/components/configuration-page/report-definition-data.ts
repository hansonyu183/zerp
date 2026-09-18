import { ulid } from 'ulid'
import type { TargetReportSaveInput } from '../../api.ts'
import type { FormFields } from '../dynamic-fields/form-fields.ts'
export type ReportParameter = TargetReportSaveInput['parameters'][number]
export type ReportColumn = TargetReportSaveInput['columns'][number]
export const parameterTypes = {
  TEXT: '文本',
  INTEGER: '整数',
  DECIMAL: '小数',
  BOOLEAN: '是否',
  DATE: '日期',
  DATE_RANGE: '日期范围',
  ENUM: '枚举',
  REFERENCE: '资料引用',
} satisfies Record<ReportParameter['type'], string>
export const columnTypes = {
  TEXT: '文本',
  INTEGER: '整数',
  DECIMAL: '小数',
  BOOLEAN: '是否',
  DATE: '日期',
  DATETIME: '日期时间',
  ID: '标识',
} satisfies Record<ReportColumn['type'], string>
export const referenceTypes = {
  ACCOUNTING_BOOK: '会计账簿',
  ACCOUNT_SUBJECT: '会计科目',
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
  COUNTERPARTY: '往来单位',
} satisfies Record<NonNullable<ReportParameter['referenceType']>, string>
export const validityNames = { VALID: '有效', INVALID: '无效' }
export const reportOptions = (values: Record<string, string>) =>
  Object.entries(values).map(([value, caption]) => ({ value, caption }))
export const parameterFields = [
  { key: 'key', caption: '参数键', type: 'text' },
  { key: 'name', caption: '中文名称', type: 'text' },
  {
    key: 'type',
    caption: '类型',
    type: 'enum',
    options: reportOptions(parameterTypes),
  },
  { key: 'required', caption: '必填', type: 'boolean' },
] satisfies FormFields<ReportParameter>
export const columnFields = [
  { key: 'alias', caption: '列别名', type: 'text' },
  { key: 'name', caption: '中文名称', type: 'text' },
  { key: 'order', caption: '顺序', type: 'integer', min: 1 },
  {
    key: 'type',
    caption: '类型',
    type: 'enum',
    options: reportOptions(columnTypes),
  },
  { key: 'width', caption: '宽度', type: 'integer', min: 1 },
  { key: 'visible', caption: '可见', type: 'boolean' },
  { key: 'format', caption: '格式', type: 'text' },
  {
    key: 'drilldownEntity',
    caption: '下钻',
    type: 'enum',
    options: [
      { value: '', caption: '无下钻' },
      { value: 'VOU', caption: '业务单据' },
    ],
  },
] satisfies FormFields<ReportColumn>
export function emptyReport(): TargetReportSaveInput {
  return {
    subjectId: ulid(),
    expectedRevision: null,
    name: '',
    description: '',
    enabled: true,
    sql: '',
    parameters: [],
    columns: [],
  }
}
export const newParameter = (): ReportParameter => ({
  key: '',
  name: '',
  type: 'TEXT',
  required: false,
})
export const newColumn = (): ReportColumn => ({
  alias: '',
  name: '',
  type: 'TEXT',
  order: 1,
  width: 160,
  visible: true,
})
export const reportErrors: Record<string, string> = {
  rpt_permission_denied: '没有此操作权限。',
  rpt_revision_conflict: '定义已被修改，请保留输入并重新读取后处理。',
  rpt_definition_invalid_data:
    '定义验证失败，请检查 SQL、参数及结果列。原定义未改变。',
  rpt_definition_not_found: '报表定义不存在。',
}
