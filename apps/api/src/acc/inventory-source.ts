import { isIndependentPriorReceipt, priorFact } from '../vou/prior-fact.ts'
import {
  orderLineAmountMinor,
  intermediaryDecimal,
  type VouEntity,
  type VouPayload,
  type VouPayloadFor,
} from '@zerp/model'
import type { Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import { decimalToFixed, readVouPersistence } from '../vou/service.ts'
import { AccApplicationError } from './service.ts'

export const sourceInventoryEntities: readonly string[] = [
  'sale-outbound',
  'sale-signoff',
  'sale-return',
  'purchase-inbound',
  'purchase-return',
]

/** Resolve the adopted source chain; this is not a lookup of current product prices. */
export async function sourceInventoryMovements(
  tx: Transaction<DB>,
  entity: VouEntity,
  payload: VouPayload,
) {
  const sale =
    entity === 'sale-outbound' ||
    entity === 'sale-return' ||
    entity === 'sale-signoff'
  const rejectedSignoff = entity === 'sale-signoff'
  const isReturn = entity === 'sale-return' || entity === 'purchase-return'
  if (
    (rejectedSignoff && !('signoffLines' in payload)) ||
    (!rejectedSignoff &&
      ((!isReturn && !('sourceLines' in payload)) ||
        (isReturn && !('returnLines' in payload))))
  )
    throw new AccApplicationError('acc_period_cost_source_missing')
  const lines: readonly {
    sourceLineId: string
    baseQuantity: string
    sourceDocumentId?: string
  }[] =
    'signoffLines' in payload
      ? payload.signoffLines.flatMap((line) => {
          const quantity = decimalToFixed(line.rejectedBaseQuantity, 6)
          if (quantity === null || quantity < 0n)
            throw new AccApplicationError('acc_period_cost_source_missing')
          return quantity === 0n
            ? []
            : [
                {
                  sourceLineId: line.sourceLineId,
                  baseQuantity: line.rejectedBaseQuantity,
                },
              ]
        })
      : 'returnLines' in payload
        ? payload.returnLines
        : 'sourceLines' in payload
          ? payload.sourceLines
          : []
  const cache = new Map<
    string,
    Awaited<ReturnType<typeof readVouPersistence>>
  >()
  const read = async (id: string) => {
    let value = cache.get(id)
    if (!value) {
      value = await readVouPersistence(tx, { documentId: id })
      cache.set(id, value)
    }
    return value
  }
  const movements = []
  for (const line of lines) {
    let sourceDocumentId = line.sourceDocumentId ?? payload.parentDocumentId
    let outboundId: string | null = null
    const seen = new Set<string>()
    let order:
      | VouPayloadFor<'sale-order'>
      | VouPayloadFor<'purchase-order'>
      | Extract<
          VouPayloadFor<'purchase-inbound'>,
          { productLines: readonly unknown[] }
        >
      | undefined
    while (sourceDocumentId && !seen.has(sourceDocumentId)) {
      seen.add(sourceDocumentId)
      const source = await read(sourceDocumentId)
      if (source.entity === 'sale-outbound') {
        outboundId = source.documentId
        // Prior customer quantities do not prove physical products, warehouse or original cost.
        if ((isReturn || rejectedSignoff) && priorFact(source.payload))
          throw new AccApplicationError('acc_period_cost_source_missing', [
            { kind: 'VOU', entity: 'sale-outbound', id: source.documentId },
          ])
      }
      if (
        source.entity === (sale ? 'sale-order' : 'purchase-order') ||
        (entity === 'purchase-return' &&
          isIndependentPriorReceipt(source.entity, source.payload))
      ) {
        order = source.payload as typeof order
        break
      }
      sourceDocumentId = source.payload.parentDocumentId
    }
    const product = order?.productLines.find(
      (candidate) => candidate.lineId === line.sourceLineId,
    )
    if (
      !order ||
      !product ||
      ((entity === 'sale-return' || rejectedSignoff) && !outboundId)
    )
      throw new AccApplicationError('acc_period_cost_source_missing', [
        { kind: 'VOU', id: sourceDocumentId, entity },
      ])
    const warehouseId =
      'warehouse' in payload
        ? payload.warehouse.objectId
        : order.warehouse.objectId
    const amount =
      entity === 'purchase-inbound'
        ? intermediaryDecimal(
            orderLineAmountMinor(product, line.baseQuantity, 'HALF_UP'),
          )
        : '0.00'
    movements.push({
      productId: product.product.objectId,
      warehouseId,
      quantity:
        entity === 'sale-outbound' || entity === 'purchase-return'
          ? `-${line.baseQuantity}`
          : line.baseQuantity,
      amount,
      currency: payload.currency,
      sourceLineId: line.sourceLineId,
      costSourceDocumentId:
        entity === 'sale-return' || rejectedSignoff ? outboundId : null,
    })
  }
  return movements
}
