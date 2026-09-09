import { snapshotCaptions } from '../document-page/snapshot-presentation.ts'
import type { TargetMappingSaveInput } from '../../api.ts'
export const mappingResults = { POST: '记账', UN_POST: '不记账' } as const
export const mappingOperators = {
  EQ: '等于',
  NE: '不等于',
  IN: '属于',
  NOT_IN: '不属于',
  IS_EMPTY: '为空',
  IS_NOT_EMPTY: '不为空',
} as const
export const mappingDirections = { DEBIT: '借方', CREDIT: '贷方' } as const
export const mappingSubjectSources = {
  FIXED: '固定科目',
  FIELD: '单据字段',
} as const
export const mappingDimensions = {
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
} as const
export const options = (labels: Readonly<Record<string, string>>) =>
  Object.entries(labels).map(([value, title]) => ({ value, title }))
export const errors: Record<string, string> = {
  forbidden: '没有此操作权限。',
  acc_book_access_denied: '没有此账簿的访问权限。',
  not_found: '该单据类型尚未配置映射。',
  acc_mapping_stale_revision: '映射已被其他人修改，请重新打开后编辑。',
  acc_mapping_invalid_data: '映射配置无效，请检查条件、模板、科目与维度。',
  acc_mapping_book_unavailable: '账簿不可用。',
  acc_mapping_vou_entity_unavailable: '单据类型不可用。',
  validation_failed: '输入格式不正确，请检查必填项。',
}
export function emptyMapping(): TargetMappingSaveInput {
  return {
    bookId: '',
    vouEntity: '',
    expectedRevision: null,
    defaultResult: 'UN_POST',
    definition: {
      defaultTemplateId: null,
      rules: [],
      templates: [],
      assetConfiguration: null,
    },
  }
}
export function newMappingLine(): TargetMappingSaveInput['definition']['templates'][number]['lines'][number] {
  return {
    subjectSource: 'FIXED',
    subjectValue: '',
    direction: 'DEBIT',
    amountField: '',
    currencyField: 'currency',
    dimensions: {},
    quantityField: null,
    costCounterpartSubjectId: null,
    costCounterpartDimensions: {},
  }
}
export function mappingFieldOptions(fields: readonly string[]) {
  const captions: Record<string, string> = {
    'line.productId': '库存变动产品',
    'line.warehouseId': '库存变动仓库',
    'line.quantity': '有符号库存数量',
    'line.amount': '明细金额',
    inventoryMovements: '库存数量变动',
    incomingBills: '流入票据',
    outgoingBills: '流出票据',
    incomingBillCash: '资金流入',
    outgoingBillCash: '资金流出',
    'line.billId': '票据',
    'line.assetId': '资产',
    'line.faceAmount': '票面金额',
    'line.fundAccount.objectId': '资金账户',
    'billTotals.primaryAmount': '主票金额合计',
    'billTotals.changeAmount': '找零票金额合计',
    'billTotals.netSettlementAmount': '净结算金额',
    'billTotals.interestAmount': '第三方应付利息',
    'billTotals.discountExpenseAmount': '贴现费用',
    'billTotals.discountIncomeAmount': '贴现收益',
    'line.currency': '记账币种',
  }
  return fields.map((value) => ({
    title:
      captions[value] ??
      value
        .split('.')
        .map((part) =>
          part === 'line' ? '明细' : (snapshotCaptions[part] ?? '未知字段'),
        )
        .join(' · '),
    value,
  }))
}

export function sameMapping(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameMapping(v, b[i]))
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const left = a as Record<string, unknown>,
      right = b as Record<string, unknown>
    const keys = Object.keys(left).filter((k) => left[k] !== undefined)
    return (
      keys.length ===
        Object.keys(right).filter((k) => right[k] !== undefined).length &&
      keys.every((k) => sameMapping(left[k], right[k]))
    )
  }
  return false
}
