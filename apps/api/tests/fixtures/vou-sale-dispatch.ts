import { ulid } from 'ulid'
import type { VouService } from '../../src/vou/service.ts'

/** Normal approved dispatch chain for tests whose signoff must adopt a delivery. */
export async function approveSaleDispatch(
  vou: VouService,
  actor: Parameters<VouService['submit']>[3],
  reviewer: Parameters<VouService['review']>[3],
  input: {
    orderId: string
    lineId: string
    quantity: string
    businessDate: string
    currency: string
  },
  documentIds?: string[],
) {
  let parentId = input.orderId
  for (const entity of ['sale-outbound', 'sale-delivery'] as const) {
    const documentId = ulid(),
      submissionId = ulid()
    documentIds?.push(documentId)
    const pending = await vou.submit(
      entity,
      'submit-new',
      {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          businessDate: input.businessDate,
          currency: input.currency,
          attachments: [],
          parentEntity:
            entity === 'sale-outbound' ? 'sale-order' : 'sale-outbound',
          parentDocumentId: parentId,
          sourceLines: [
            { sourceLineId: input.lineId, baseQuantity: input.quantity },
          ],
        },
      },
      actor,
      'fixture-sale-dispatch',
    )
    await vou.review(
      entity,
      'approve',
      {
        documentId,
        submissionId,
        expectedRevision: pending.revision,
      },
      reviewer,
      'fixture-sale-dispatch',
    )
    parentId = documentId
  }
  return parentId
}
