import { businessDate } from './business-date.ts'
import type {
  VouPayloadFor,
  VouAttachmentMetadata,
  VouVersionedReferenceInput,
} from '@zerp/model'
import type { VouCandidate } from './VouReference.vue'
import { snapshotEnums } from './snapshot-presentation.ts'
export const financialEntities = [
  'sales-receipt',
  'purchase-refund',
  'other-receipt',
  'sales-refund',
  'purchase-payment',
  'other-payment',
  'employee-loan',
  'employee-repayment',
  'employee-loan-writeoff',
  'expense-reimbursement',
  'other-income',
] as const
export type FinancialEntity = (typeof financialEntities)[number]
type Origin = 'CURRENT' | 'HISTORICAL'
export type FinancialPartyType =
  'customer-subunit' | 'supplier' | 'other-unit' | 'employee' | 'sales-partner'
const partyTypes: FinancialPartyType[] = [
  'customer-subunit',
  'supplier',
  'other-unit',
  'employee',
  'sales-partner',
]
export const financialPartyOptions = partyTypes.map((value) => ({
  title: snapshotEnums.counterpartyType![value]!,
  value,
}))
export const financialCategoryOptions = ['', 'COMMISSION', 'INTERMEDIARY'].map(
  (value) => ({
    title: value ? snapshotEnums.otherCategory![value]! : '不指定',
    value,
  }),
)
export type FinancialDraft = {
  entity: FinancialEntity
  businessDate: string
  currency: string
  remark: string
  amount: string
  party: VouCandidate | null
  partyOrigin: Origin
  counterpartyType: FinancialPartyType
  attachCounterparty: boolean
  otherCategory: '' | 'COMMISSION' | 'INTERMEDIARY'
  sourceName: string
  fundAccount: VouCandidate | null
  handler: VouCandidate | null
  operatingEntity: VouCandidate | null
  allocations: {
    id: string
    subunit: VouCandidate | null
    origin: Origin
    amount: string
  }[]
  expenses: {
    id: string
    category: string
    description: string
    amount: string
    remark: string
  }[]
  attachments: VouAttachmentMetadata[]
}
export function isExpense(entity: FinancialEntity) {
  return (
    entity === 'expense-reimbursement' || entity === 'employee-loan-writeoff'
  )
}
export function financialParty(draft: FinancialDraft): {
  entity: VouCandidate['entity']
  caption: string
} {
  if (draft.entity === 'sales-receipt')
    return { entity: 'customer', caption: '客户' }
  if (draft.entity === 'sales-refund')
    return { entity: 'customer-subunit', caption: '客户子单位' }
  if (draft.entity.startsWith('purchase-'))
    return { entity: 'supplier', caption: '供应商' }
  if (draft.entity.startsWith('employee-') || isExpense(draft.entity))
    return { entity: 'employee', caption: '员工' }
  return { entity: draft.counterpartyType, caption: '相对方' }
}
export function emptyFinancial(entity: FinancialEntity): FinancialDraft {
  return {
    entity,
    businessDate: businessDate(),
    currency: 'CNY',
    remark: '',
    amount: '',
    party: null,
    partyOrigin: 'CURRENT',
    counterpartyType: 'customer-subunit',
    attachCounterparty: false,
    otherCategory: '',
    sourceName: '',
    fundAccount: null,
    handler: null,
    operatingEntity: null,
    allocations: [],
    expenses: [],
    attachments: [],
  }
}
function money(value: string, signed = false): bigint {
  if (
    !(
      signed
        ? /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
        : /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
    ).test(value)
  )
    throw new Error('请填写有效金额，最多两位小数。')
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  return (
    (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))) *
    (negative ? -1n : 1n)
  )
}

function current(
  candidate: VouCandidate | null,
  entity: VouCandidate['entity'],
  caption: string,
) {
  if (!candidate || candidate.entity !== entity)
    throw new Error(`请选择${caption}。`)
  return { objectId: candidate.objectId }
}
function versioned(
  candidate: VouCandidate | null,
  entity: VouCandidate['entity'],
  origin: Origin,
  caption: string,
): VouVersionedReferenceInput {
  const ref = current(candidate, entity, caption)
  if (
    !candidate ||
    !('approvalEntryId' in candidate) ||
    !candidate.approvalEntryId
  )
    throw new Error(`请选择有效${caption}。`)
  return {
    ...ref,
    approvalEntryId: candidate.approvalEntryId,
    selectionOrigin: origin,
  }
}
export function financialPayload(
  draft: FinancialDraft,
): VouPayloadFor<FinancialEntity> {
  const base = {
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    attachments: draft.attachments,
  }
  if (isExpense(draft.entity)) {
    if (!draft.expenses.length || draft.expenses.length > 200)
      throw new Error('请填写一至两百条费用明细。')
    return {
      ...base,
      employee: current(draft.party, 'employee', '员工'),
      expenseLines: draft.expenses.map(
        ({ category, description, amount, remark }) => {
          if (!category.trim() || !description.trim())
            throw new Error('请填写费用类别与说明。')
          money(amount, true)
          return { category, description, amount, remark }
        },
      ),
    }
  }
  const total = money(draft.amount)
  const amount = {
    ...base,
    amount: draft.amount,
    fundAccount: current(draft.fundAccount, 'fund-account', '资金账户'),
    handler: current(draft.handler, 'employee', '经办人'),
  }
  switch (draft.entity) {
    case 'sales-receipt': {
      const customer = versioned(
        draft.party,
        'customer',
        draft.partyOrigin,
        '客户',
      )
      if (!draft.allocations.length || draft.allocations.length > 200)
        throw new Error('请填写一至两百条分摊明细。')
      const subunitAllocations = draft.allocations.map((row) => {
        if (
          row.subunit &&
          'customerId' in row.subunit &&
          row.subunit.customerId !== customer.objectId
        )
          throw new Error('分摊子单位必须属于所选客户。')
        return {
          subunit: versioned(
            row.subunit,
            'customer-subunit',
            row.origin,
            '客户子单位',
          ),
          amount: row.amount,
        }
      })
      if (
        subunitAllocations.reduce((sum, row) => sum + money(row.amount), 0n) !==
        total
      )
        throw new Error('分摊合计必须等于来款金额。')
      return {
        ...amount,
        customer,
        operatingEntity: current(
          draft.operatingEntity,
          'operating-entity',
          '经营主体',
        ),
        subunitAllocations,
      }
    }
    case 'sales-refund':
      return {
        ...amount,
        customer: versioned(
          draft.party,
          'customer-subunit',
          draft.partyOrigin,
          '客户子单位',
        ),
      }
    case 'purchase-payment':
    case 'purchase-refund':
      return {
        ...amount,
        supplier: versioned(
          draft.party,
          'supplier',
          draft.partyOrigin,
          '供应商',
        ),
      }
    case 'employee-loan':
    case 'employee-repayment':
      return { ...amount, employee: current(draft.party, 'employee', '员工') }
    case 'other-income': {
      if (!draft.sourceName.trim()) throw new Error('请填写来源名称。')
      if (!draft.attachCounterparty)
        return { ...amount, sourceName: draft.sourceName }
      if (
        draft.counterpartyType !== 'customer-subunit' &&
        draft.counterpartyType !== 'supplier'
      )
        throw new Error('其他收入只能关联客户子单位或供应商。')
      return {
        ...amount,
        sourceName: draft.sourceName,
        counterpartyType: draft.counterpartyType,
        counterparty: versioned(
          draft.party,
          draft.counterpartyType,
          draft.partyOrigin,
          '相对方',
        ),
      }
    }
    case 'other-receipt':
    case 'other-payment': {
      const category = draft.otherCategory
        ? { otherCategory: draft.otherCategory }
        : {}
      return draft.counterpartyType === 'employee'
        ? {
            ...amount,
            ...category,
            counterpartyType: 'employee',
            counterparty: current(draft.party, 'employee', '员工'),
          }
        : {
            ...amount,
            ...category,
            counterpartyType: draft.counterpartyType,
            counterparty: versioned(
              draft.party,
              draft.counterpartyType,
              draft.partyOrigin,
              '相对方',
            ),
          }
    }
    default:
      throw new Error('不支持的资金单据。')
  }
}
function candidate(
  entity: VouCandidate['entity'],
  ref: {
    objectId: string
    approvalEntryId?: string
    code?: string
    name?: string
  },
): VouCandidate {
  return {
    entity,
    objectId: ref.objectId,
    approvalEntryId: ref.approvalEntryId,
    code: ref.code ?? '',
    name: ref.name ?? '已采用资料',
  } as VouCandidate
}
export function cloneFinancial(
  entity: FinancialEntity,
  payload: VouPayloadFor<FinancialEntity>,
  ids: readonly string[],
): FinancialDraft {
  const draft = emptyFinancial(entity)
  Object.assign(draft, {
    businessDate: payload.businessDate,
    currency: payload.currency,
    remark: payload.remark ?? '',
    partyOrigin: 'HISTORICAL',
  })
  if ('amount' in payload) {
    draft.amount = payload.amount
    draft.fundAccount = candidate('fund-account', payload.fundAccount)
    draft.handler = candidate('employee', payload.handler)
  }
  if ('counterpartyType' in payload && payload.counterpartyType)
    draft.counterpartyType = payload.counterpartyType
  const party =
    'employee' in payload
      ? payload.employee
      : 'supplier' in payload
        ? payload.supplier
        : 'customer' in payload
          ? payload.customer
          : 'counterparty' in payload
            ? payload.counterparty
            : null
  if (party) draft.party = candidate(financialParty(draft).entity, party)
  if ('sourceName' in payload) {
    draft.sourceName = payload.sourceName
    draft.attachCounterparty = Boolean(payload.counterparty)
  }
  if ('otherCategory' in payload)
    draft.otherCategory = payload.otherCategory ?? ''
  if ('operatingEntity' in payload)
    draft.operatingEntity = candidate(
      'operating-entity',
      payload.operatingEntity,
    )
  if ('subunitAllocations' in payload)
    draft.allocations = payload.subunitAllocations.map((row, index) => ({
      id: ids[index]!,
      subunit: candidate('customer-subunit', row.subunit),
      origin: 'HISTORICAL',
      amount: row.amount,
    }))
  if ('expenseLines' in payload)
    draft.expenses = payload.expenseLines.map((row, index) => ({
      id: ids[index]!,
      ...row,
      remark: row.remark ?? '',
    }))
  return draft
}
