import { apiClient } from '@/api/client'
import type { DclDeclarationWireAction } from '../shared/declaration'

export type DclRelationshipEntity = 'other-unit' | 'sales-partner'

export async function runDclRelationshipAction(
  entity: DclRelationshipEntity,
  action: DclDeclarationWireAction,
  request: {
    objectId: string
    approvalEntryId: string
    approvalRevision: number
  },
  reason: string,
): Promise<void> {
  if (action === 'reject' || action === 'unapprove') {
    await apiClient.postContract(`dcl/${entity}/${action}`, {
      ...request,
      reason,
    })
  } else {
    await apiClient.postContract(`dcl/${entity}/${action}`, request)
  }
}
