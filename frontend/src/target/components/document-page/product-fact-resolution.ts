import { resolveTargetProduct, queryTargetBobOptions } from '../../api.ts'
import type { VouCandidate } from './VouReference.vue'
export async function resolveProductFact(choice: VouCandidate) {
  let approvalEntryId =
    'approvalEntryId' in choice ? choice.approvalEntryId : undefined
  // Book-balance rows and copied document products carry identity only.
  if (!approvalEntryId) {
    const candidates = await queryTargetBobOptions('product', {
      ids: [choice.objectId],
      enabled: 'true',
      keyword: '',
      page: '1',
      pageSize: '20',
    })
    const candidate = candidates.items.find(
      (item) => item.objectId === choice.objectId,
    )
    if (!candidate) throw new Error('产品已不可用，请重新选择。')
    approvalEntryId = candidate.sourceApprovalEntryId
  }
  const current = await resolveTargetProduct(choice.objectId, approvalEntryId)
  if (!current.enabled) throw new Error('产品已停用，请重新选择。')
  return current
}
