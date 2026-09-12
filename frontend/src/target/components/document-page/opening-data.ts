import type { AccSubjectDimension } from '@zerp/model'
import type * as api from '../../api.ts'
export type OpeningDraft = Omit<
  api.TargetOpeningInput,
  'submissionId' | 'idempotencyKey'
>
export function emptyOpening(): OpeningDraft {
  return { bookId: '', lines: [], assets: [], bills: [], containers: [] }
}
export const directions = { DEBIT: '借方', CREDIT: '贷方' } as const
export const dimensions: Record<AccSubjectDimension, string> = {
  CUSTOMER_SUBUNIT: '客户子单位',
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
}
export const billPositions = {
  ASSET: '资产票据',
  LIABILITY: '负债票据',
} as const
export const billMedia = { PAPER: '纸质', ELECTRONIC: '电子' } as const
export const containerTypes = { SOLVENT: '溶剂桶', RESIN: '树脂桶' } as const
export const counterpartyTypes = {
  customer: '客户',
  supplier: '供应商',
  'other-unit': '其他单位',
  'sales-partner': '销售合作方',
  employee: '员工',
  'operating-entity': '经营主体',
} as const
export const options = (captions: Readonly<Record<string, string>>) =>
  Object.entries(captions).map(([value, title]) => ({ value, title }))
type ReferenceEntity = api.TargetReferenceEntity
export const dimensionSources: Record<AccSubjectDimension, ReferenceEntity> = {
  CUSTOMER_SUBUNIT: 'customer-subunit',
  SUPPLIER: 'supplier',
  OTHER_UNIT: 'other-unit',
  EMPLOYEE: 'employee',
  SALES_PARTNER: 'sales-partner',
  DEPARTMENT: 'department',
  PRODUCT: 'product',
  WAREHOUSE: 'warehouse',
  FUND_ACCOUNT: 'fund-account',
  ASSET: 'asset',
  BILL: 'bill',
}
