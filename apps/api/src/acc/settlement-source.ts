import { purchaseReturnSettlementAmounts } from '../vou/invoice.ts'
import {
  intermediaryDecimal,
  orderLineAmountMinor,
  type VouEntity,
  type VouPayload,
  type VouPayloadFor,
} from '@zerp/model'
import type { Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import { readVouPersistence } from '../vou/service.ts'
import { AccApplicationError } from './service.ts'

export const settlementMovementEntities: readonly string[] = [
  'sale-signoff',
  'purchase-inbound',
  'purchase-return',
]
export const settlementMovementFields = [
  'line.sourceLineId',
  'line.productId',
  'line.counterpartyId',
  'line.quantity',
  'line.amount',
  'line.currency',
]

/** Posting amounts come from the adopted immutable order, never current prices. */
export async function sourceSettlementMovements(
  tx: Transaction<DB>,
  entity: VouEntity,
  payload: VouPayload,
  documentId: string,
) {
  const sale = entity === 'sale-signoff'
  if (!settlementMovementEntities.includes(entity)) return []
  const lines =
    'signoffLines' in payload
      ? payload.signoffLines.map((line) => ({
          sourceLineId: line.sourceLineId,
          quantity: line.signedBaseQuantity,
        }))
      : 'sourceLines' in payload
        ? payload.sourceLines.map((line) => ({
            sourceLineId: line.sourceLineId,
            quantity: line.baseQuantity,
          }))
        : 'returnLines' in payload
          ? payload.returnLines.map((line) => ({
              sourceLineId: line.sourceLineId,
              quantity: line.baseQuantity,
            }))
          : []
  let id = payload.parentDocumentId
  const seen = new Set<string>()
  let order:
    VouPayloadFor<'sale-order'> | VouPayloadFor<'purchase-order'> | undefined
  while (id && !seen.has(id)) {
    seen.add(id)
    const source = await readVouPersistence(tx, { documentId: id })
    if (source.entity === (sale ? 'sale-order' : 'purchase-order')) {
      order = source.payload as typeof order
      break
    }
    id = source.payload.parentDocumentId
  }
  if (!order) throw new AccApplicationError('acc_period_cost_source_missing')
  const counterpartyId =
    'customer' in order ? order.customer.objectId : order.supplier.objectId
  const refunds =
    entity === 'purchase-return' && 'returnLines' in payload
      ? await purchaseReturnSettlementAmounts(
          tx,
          documentId,
          payload as VouPayloadFor<'purchase-return'>,
        )
      : undefined
  return lines.map((line, index) => {
    const product = order.productLines.find(
      (candidate) => candidate.lineId === line.sourceLineId,
    )
    if (!product)
      throw new AccApplicationError('acc_period_cost_source_missing')
    return {
      sourceLineId: line.sourceLineId,
      productId: product.product.objectId,
      counterpartyId,
      quantity: line.quantity,
      amount: refunds
        ? refunds[index]!
        : intermediaryDecimal(
            orderLineAmountMinor(product, line.quantity, 'HALF_UP'),
          ),
      currency: payload.currency,
    }
  })
}
