import type { VouPayloadFor, VouPriorLineOrigin } from '@zerp/model'
import type { VouCandidate } from './VouReference.vue'
import { businessDate } from './business-date.ts'
import {
  cloneProductLines,
  productLinesPayload,
  type OrderLine,
} from './order-data.ts'
import { priorFactPayload, type PriorFactDraft } from './prior-fact-data.ts'

export type IndependentReceiptDraft = {
  entity: 'purchase-inbound'
  businessDate: string
  currency: string
  remark: string
  supplier: VouCandidate | null
  selectionOrigin: 'CURRENT' | 'HISTORICAL'
  warehouse: VouCandidate | null
  priorFact: PriorFactDraft | null
  lines: (OrderLine & { origin: Omit<VouPriorLineOrigin, 'lineId'> })[]
  attachments: import('@zerp/model').VouAttachmentMetadata[]
}
export function emptyIndependentReceipt(): IndependentReceiptDraft {
  return {
    entity: 'purchase-inbound',
    businessDate: businessDate(),
    currency: 'CNY',
    remark: '',
    supplier: null,
    selectionOrigin: 'CURRENT',
    warehouse: null,
    priorFact: null,
    lines: [],
    attachments: [],
  }
}
export function independentReceiptPayload(
  draft: IndependentReceiptDraft,
): VouPayloadFor<'purchase-inbound'> {
  if (!draft.priorFact)
    throw new Error('独立收货必须明确登记此前事实；新业务请选择采购订单来源。')
  if (
    !draft.supplier ||
    !('approvalEntryId' in draft.supplier) ||
    !draft.supplier.approvalEntryId ||
    !draft.warehouse
  )
    throw new Error('请选择供应商与仓库。')
  const productLines = productLinesPayload(draft.lines)
  const priorLineOrigins = draft.lines.map((line, index) => {
    if (!line.agreedAmount?.trim())
      throw new Error(`商品行第 ${index + 1} 行：填写真实实际金额。`)
    if (!Object.values(line.origin).every((value) => value.trim()))
      throw new Error(`商品行第 ${index + 1} 行：填写完整原单据行关联。`)
    return { lineId: line.lineId, ...line.origin }
  })
  return {
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    attachments: draft.attachments,
    supplier: {
      objectId: draft.supplier.objectId,
      approvalEntryId: draft.supplier.approvalEntryId,
      selectionOrigin: draft.selectionOrigin,
    },
    warehouse: { objectId: draft.warehouse.objectId },
    priorFact: priorFactPayload(draft.priorFact),
    productLines,
    priorLineOrigins,
  }
}
export function cloneIndependentReceipt(
  payload: Extract<
    VouPayloadFor<'purchase-inbound'>,
    { productLines: readonly unknown[] }
  >,
  lineIds: readonly string[],
): IndependentReceiptDraft {
  return {
    ...emptyIndependentReceipt(),
    businessDate: payload.businessDate,
    currency: payload.currency,
    remark: payload.remark ?? '',
    selectionOrigin: 'HISTORICAL',
    supplier: {
      entity: 'supplier',
      objectId: payload.supplier.objectId,
      approvalEntryId: payload.supplier.approvalEntryId,
      code: '',
      name: '已采用供应商',
    },
    warehouse: {
      entity: 'warehouse',
      objectId: payload.warehouse.objectId,
      code: payload.warehouse.code ?? '',
      name: payload.warehouse.name ?? '已采用仓库',
    },
    lines: cloneProductLines(payload.productLines, lineIds).map((line) => ({
      ...line,
      origin: {
        sourceDocumentType: '',
        sourceDocumentKey: '',
        sourceLineKey: '',
      },
    })),
  }
}
