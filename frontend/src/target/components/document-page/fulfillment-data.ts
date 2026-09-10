import { businessDate } from './business-date.ts'
import type { VouPayloadFor } from '@zerp/model'
import type { SourceLineChoice } from './SourceLinePicker.vue'
import type { VouCandidate } from './VouReference.vue'
import type { FormFields } from '../dynamic-fields/form-fields.ts'
export type FulfillmentEntity =
  'purchase-inbound' | 'sale-return' | 'purchase-return'
export type FulfillmentDraft = {
  entity: FulfillmentEntity
  businessDate: string
  currency: string
  remark: string
  selectionOrigin: 'CURRENT' | 'HISTORICAL'
  supplier: VouCandidate | null
  warehouse: VouCandidate | null
  returnReason: string
  lines: {
    id: string
    source: SourceLineChoice | null
    baseQuantity: string
    remark: string
  }[]
  attachments: import('@zerp/model').VouAttachmentMetadata[]
}
export const fulfillmentFields = [
  { key: 'businessDate', type: 'date', caption: '业务日期', required: true },
  { key: 'currency', type: 'text', caption: '币种', required: true },
  { key: 'remark', type: 'textarea', caption: '备注' },
] as const satisfies FormFields<FulfillmentDraft>
export function emptyFulfillment(entity: FulfillmentEntity): FulfillmentDraft {
  return {
    entity,
    businessDate: businessDate(),
    currency: 'CNY',
    remark: '',
    selectionOrigin: 'CURRENT',
    supplier: null,
    warehouse: null,
    returnReason: '',
    lines: [],
    attachments: [],
  }
}
export function fulfillmentPayload(
  draft: FulfillmentDraft,
): VouPayloadFor<FulfillmentEntity> {
  if (!draft.warehouse) throw new Error('请选择仓库。')
  if (!draft.lines.length) throw new Error('至少添加一条来源行。')
  const lines = draft.lines.map((line, index) => {
    if (!line.source) throw new Error(`第 ${index + 1} 行：请选择来源行。`)
    if (
      !/^\d+(?:\.\d{1,6})?$/.test(line.baseQuantity) ||
      !/[1-9]/.test(line.baseQuantity)
    )
      throw new Error(`第 ${index + 1} 行：填写正数基准数量，最多六位小数。`)
    return {
      source: line.source,
      baseQuantity: line.baseQuantity,
      remark: line.remark,
    }
  })
  const root = lines[0]!.source
  if (
    lines.some(
      ({ source }) =>
        source.rootEntity !== root.rootEntity ||
        source.rootDocumentId !== root.rootDocumentId,
    )
  )
    throw new Error('来源行必须属于同一根订单，请显式移除不匹配的行。')
  const base = {
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    attachments: draft.attachments,
    warehouse: { objectId: draft.warehouse.objectId },
    parentEntity: root.rootEntity,
    parentDocumentId: root.rootDocumentId,
  }
  if (draft.entity === 'sale-return') {
    if (!draft.returnReason.trim()) throw new Error('请填写退货原因。')
    return {
      ...base,
      returnReason: draft.returnReason.trim(),
      returnLines: lines.map(({ source, ...line }) => ({
        ...line,
        sourceDocumentId: source.sourceDocumentId,
        sourceLineId: source.sourceLineId,
      })),
    }
  }
  const supplier = draft.supplier
  if (
    !supplier ||
    !('approvalEntryId' in supplier) ||
    !supplier.approvalEntryId
  )
    throw new Error('请选择供应商。')
  const adopted = {
    objectId: supplier.objectId,
    approvalEntryId: supplier.approvalEntryId,
    selectionOrigin: draft.selectionOrigin,
  }
  if (draft.entity === 'purchase-inbound')
    return {
      ...base,
      supplier: adopted,
      sourceLines: lines.map(({ source, ...line }) => ({
        ...line,
        sourceLineId: source.sourceLineId,
      })),
    }
  if (!draft.returnReason.trim()) throw new Error('请填写退货原因。')
  return {
    ...base,
    supplier: adopted,
    returnReason: draft.returnReason.trim(),
    returnLines: lines.map(({ source, ...line }) => ({
      ...line,
      sourceDocumentId: source.sourceDocumentId,
      sourceLineId: source.sourceLineId,
    })),
  }
}

export function cloneFulfillment(
  entity: FulfillmentEntity,
  payload: VouPayloadFor<FulfillmentEntity>,
  lineIds: readonly string[],
): FulfillmentDraft {
  const supplier = 'supplier' in payload ? payload.supplier : null
  const lines =
    'sourceLines' in payload ? payload.sourceLines : payload.returnLines
  return {
    ...emptyFulfillment(entity),
    businessDate: payload.businessDate,
    currency: payload.currency,
    remark: payload.remark ?? '',
    selectionOrigin: 'HISTORICAL',
    supplier: supplier
      ? {
          entity: 'supplier',
          objectId: supplier.objectId,
          approvalEntryId: supplier.approvalEntryId,
          code: '',
          name: '已采用供应商',
        }
      : null,
    warehouse: {
      entity: 'warehouse',
      objectId: payload.warehouse.objectId,
      code: payload.warehouse.code ?? '',
      name: payload.warehouse.name ?? '已采用仓库',
    },
    returnReason: 'returnReason' in payload ? payload.returnReason : '',
    lines: lines.map((line, index) => ({
      id: lineIds[index]!,
      baseQuantity: line.baseQuantity,
      remark: line.remark ?? '',
      source:
        (payload.parentEntity === 'sale-order' ||
          payload.parentEntity === 'purchase-order') &&
        payload.parentDocumentId
          ? {
              rootEntity: payload.parentEntity,
              rootDocumentId: payload.parentDocumentId,
              sourceDocumentId:
                'sourceDocumentId' in line &&
                typeof line.sourceDocumentId === 'string'
                  ? line.sourceDocumentId
                  : payload.parentDocumentId,
              sourceLineId: line.sourceLineId,
            }
          : null,
    })),
  }
}
