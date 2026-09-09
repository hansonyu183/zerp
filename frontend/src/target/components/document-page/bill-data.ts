import type {
  VouAttachmentMetadata,
  VouBillLineInput,
  VouBillCashLineInput,
  VouPayloadFor,
} from '@zerp/model'
import type { VouCandidate } from './VouReference.vue'
import { snapshotEnums } from './snapshot-presentation.ts'
export const billEntities = [
  'bill-receipt',
  'bill-payment',
  'bill-issue',
  'bill-discount',
  'bill-maturity',
] as const
export type BillEntity = (typeof billEntities)[number]
type NewBill = Extract<VouBillLineInput, { positionType: 'ASSET' }>
export type BillLine = Omit<
  NewBill,
  'annualRateBps' | 'positionType' | 'direction' | 'purpose'
> & {
  id: string
  bill: VouCandidate | null
  purpose: 'PRIMARY' | 'CHANGE'
  annualRateBps: string
}
export type CashLine = Omit<VouBillCashLineInput, 'fundAccount'> & {
  id: string
  fundAccount: VouCandidate | null
}
export type BillDraft = {
  entity: BillEntity
  businessDate: string
  currency: string
  remark: string
  party: VouCandidate | null
  origin: 'CURRENT' | 'HISTORICAL'
  handler: VouCandidate | null
  interestMode: 'BANK_DEDUCTED' | 'THIRD_PARTY_PAYABLE'
  interestParty: VouCandidate | null
  interestOrigin: 'CURRENT' | 'HISTORICAL'
  internalCostRateBps: string
  withRecourse: boolean
  maturityType: 'RECEIPT' | 'PAYMENT'
  lines: BillLine[]
  cash: CashLine[]
  attachments: VouAttachmentMetadata[]
}
export function billOptions(key: string) {
  return Object.entries(snapshotEnums[key] ?? {}).map(([value, title]) => ({
    value,
    title,
  }))
}
export function emptyBill(entity: BillEntity): BillDraft {
  return {
    entity,
    businessDate: new Date().toISOString().slice(0, 10),
    currency: 'CNY',
    remark: '',
    party: null,
    origin: 'CURRENT',
    handler: null,
    interestMode: 'BANK_DEDUCTED',
    interestParty: null,
    interestOrigin: 'CURRENT',
    internalCostRateBps: '',
    withRecourse: false,
    maturityType: 'RECEIPT',
    lines: [],
    cash: [],
    attachments: [],
  }
}
export function emptyBillLine(id: string, currency: string): BillLine {
  return {
    id,
    bill: null,
    purpose: 'PRIMARY',
    billType: 'BANK_ACCEPTANCE',
    billNo: '',
    medium: 'ELECTRONIC',
    currency,
    faceAmount: '',
    issueDate: '',
    maturityDate: '',
    drawer: '',
    acceptor: '',
    payee: '',
    annualRateBps: '0',
    remark: '',
  }
}
export function emptyCashLine(id: string, draft: BillDraft): CashLine {
  return {
    id,
    fundAccount: null,
    direction:
      draft.entity === 'bill-issue' ||
      draft.entity === 'bill-payment' ||
      (draft.entity === 'bill-maturity' && draft.maturityType === 'PAYMENT')
        ? 'OUT'
        : 'IN',
    amountType: 'PRINCIPAL',
    amount: '',
    remark: '',
  }
}
function rate(value: string) {
  if (!/^\d+$/.test(value) || Number(value) > 100000)
    throw new Error('利率应为零至十万的整数基点。')
  return Number(value)
}
function money(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value))
    throw new Error('请填写有效金额，最多两位小数。')
  return value
}
function versioned(
  candidate: VouCandidate | null,
  entity: 'customer-subunit' | 'supplier' | 'other-unit',
  origin: BillDraft['origin'],
) {
  if (candidate?.entity !== entity || !candidate.approvalEntryId)
    throw new Error('请选择有效往来方。')
  return {
    objectId: candidate.objectId,
    approvalEntryId: candidate.approvalEntryId,
    selectionOrigin: origin,
  }
}
export function billPayload(draft: BillDraft): VouPayloadFor<BillEntity> {
  if (!draft.lines.length || draft.lines.length > 20 || draft.cash.length > 20)
    throw new Error('每单需要一至二十张票据，资金行最多二十条。')
  const references = draft.lines.flatMap((line) =>
    line.bill ? [line.bill.objectId] : [],
  )
  if (new Set(references).size !== references.length)
    throw new Error('同一票据不能重复选择。')
  const billLines: VouBillLineInput[] = draft.lines.map(
    (line): VouBillLineInput => {
      const newBill =
        draft.entity === 'bill-issue' ||
        (draft.entity === 'bill-receipt' && line.purpose === 'PRIMARY')
      if (!newBill) {
        if (line.bill?.entity !== 'bill') throw new Error('请选择可用票据。')
        if (draft.entity === 'bill-receipt')
          return {
            billId: line.bill.objectId,
            purpose: 'CHANGE',
            remark: line.remark,
          }
        return {
          billId: line.bill.objectId,
          purpose: 'PRIMARY',
          ...(draft.entity === 'bill-discount'
            ? { annualRateBps: rate(line.annualRateBps) }
            : {}),
          remark: line.remark,
        }
      }
      if (
        !line.billNo.trim() ||
        !line.issueDate ||
        !line.maturityDate ||
        !line.drawer.trim() ||
        !line.acceptor.trim() ||
        !line.payee.trim()
      )
        throw new Error('请完整填写票据固定资料。')
      if (line.maturityDate < line.issueDate)
        throw new Error('到期日期不能早于出票日期。')
      return {
        positionType: draft.entity === 'bill-issue' ? 'LIABILITY' : 'ASSET',
        direction: 'IN',
        purpose: 'PRIMARY',
        billType: line.billType,
        billNo: line.billNo,
        medium: line.medium,
        currency: line.currency,
        faceAmount: money(line.faceAmount),
        issueDate: line.issueDate,
        maturityDate: line.maturityDate,
        drawer: line.drawer,
        acceptor: line.acceptor,
        payee: line.payee,
        annualRateBps: rate(line.annualRateBps),
        remark: line.remark,
      }
    },
  )
  const billCashLines = draft.cash.map((line) => {
    if (line.fundAccount?.entity !== 'fund-account')
      throw new Error('请选择现金资金账户。')
    if (
      draft.entity === 'bill-maturity' &&
      line.direction !== (draft.maturityType === 'RECEIPT' ? 'IN' : 'OUT')
    )
      throw new Error('资金方向必须与到期类型一致。')
    return {
      fundAccount: { objectId: line.fundAccount.objectId },
      direction: line.direction,
      amountType: line.amountType,
      amount: money(line.amount),
      remark: line.remark,
    }
  })
  const base = {
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    attachments: draft.attachments,
    billLines,
    billCashLines,
  }
  if (draft.entity === 'bill-maturity') {
    if (!billCashLines.length) throw new Error('到期单至少需要一条真实现金行。')
    return { ...base, maturityType: draft.maturityType }
  }
  if (draft.entity === 'bill-receipt' || draft.entity === 'bill-payment') {
    if (draft.handler?.entity !== 'employee') throw new Error('请选择经办人。')
    const handler = { objectId: draft.handler.objectId }
    return draft.entity === 'bill-receipt'
      ? {
          ...base,
          handler,
          customerSubunit: versioned(
            draft.party,
            'customer-subunit',
            draft.origin,
          ),
          ...(draft.internalCostRateBps !== ''
            ? { internalCostRateBps: rate(draft.internalCostRateBps) }
            : {}),
        }
      : {
          ...base,
          handler,
          supplier: versioned(draft.party, 'supplier', draft.origin),
        }
  }
  const interest = {
    interestMode: draft.interestMode,
    ...(draft.interestMode === 'THIRD_PARTY_PAYABLE'
      ? {
          interestParty: versioned(
            draft.interestParty,
            'other-unit',
            draft.interestOrigin,
          ),
        }
      : {}),
  }
  if (draft.entity === 'bill-issue') {
    if (draft.party?.entity !== 'supplier') throw new Error('请选择供应商。')
    return {
      ...base,
      ...interest,
      supplier: { objectId: draft.party.objectId },
    }
  }
  return {
    ...base,
    ...interest,
    counterpartyType: 'other-unit',
    counterparty: versioned(draft.party, 'other-unit', draft.origin),
    withRecourse: draft.withRecourse,
  }
}
function candidate(
  entity: VouCandidate['entity'],
  reference: {
    objectId: string
    approvalEntryId?: string
    code?: string
    name?: string
  },
): VouCandidate {
  return {
    ...reference,
    entity,
    code: reference.code ?? '',
    name: reference.name ?? '已采用资料',
  } as VouCandidate
}
export function cloneBill(
  entity: BillEntity,
  payload: VouPayloadFor<BillEntity>,
  nextId: () => string,
): BillDraft {
  const draft = emptyBill(entity)
  Object.assign(draft, {
    businessDate: payload.businessDate,
    currency: payload.currency,
    remark: payload.remark ?? '',
    origin: 'HISTORICAL',
    interestOrigin: 'HISTORICAL',
  })
  if ('customerSubunit' in payload)
    draft.party = candidate('customer-subunit', payload.customerSubunit)
  if ('supplier' in payload)
    draft.party = candidate('supplier', payload.supplier)
  if ('counterparty' in payload)
    draft.party = candidate('other-unit', payload.counterparty)
  if ('handler' in payload)
    draft.handler = candidate('employee', payload.handler)
  if ('internalCostRateBps' in payload)
    draft.internalCostRateBps = String(payload.internalCostRateBps ?? '')
  if ('interestMode' in payload) {
    draft.interestMode = payload.interestMode
    draft.interestParty = payload.interestParty
      ? candidate('other-unit', payload.interestParty)
      : null
  }
  if ('withRecourse' in payload)
    draft.withRecourse = payload.withRecourse ?? false
  if ('maturityType' in payload) draft.maturityType = payload.maturityType
  draft.lines = payload.billLines.map((line) => ({
    ...emptyBillLine(nextId(), payload.currency),
    ...(!('positionType' in line)
      ? { bill: candidate('bill', { objectId: line.billId }) }
      : line),
    purpose: line.purpose,
    annualRateBps:
      'annualRateBps' in line ? String(line.annualRateBps ?? 0) : '0',
    remark: line.remark ?? '',
  }))
  draft.cash = (payload.billCashLines ?? []).map((line) => ({
    ...line,
    id: nextId(),
    fundAccount: candidate('fund-account', line.fundAccount),
  }))
  return draft
}
