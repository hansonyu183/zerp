import type { Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type {
  BobActionAvailability,
  BobEntity,
  BobListItem,
  BobMutationResult,
} from './types'

interface VersionRevisionRequest {
  objectId: string
  versionId: string
  revision: number
}

interface ReviewRequest extends VersionRevisionRequest {
  comment: string
}

interface ReverseRequest extends VersionRevisionRequest {
  objectRevision: number
  reason: string
}

export function useBobLifecycleActions(
  entity: BobEntity,
  actionLoading: Ref<string | null>,
  errorMessage: Ref<string | null>,
  actionAvailability: (row: Readonly<BobListItem>) => BobActionAvailability,
  query: () => Promise<void>,
) {
  async function review(
    row: BobListItem,
    action: 'approve' | 'reject',
    comment: string,
  ): Promise<boolean> {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    const normalizedComment = action === 'reject' ? comment.trim() : ''
    if (action === 'reject' && !normalizedComment) {
      errorMessage.value = '驳回意见不能为空。'
      return false
    }
    if (Array.from(normalizedComment).length > 1000) {
      errorMessage.value = '审核意见不能超过 1000 个字符。'
      return false
    }

    actionLoading.value = `${action}:${row.objectId}`
    errorMessage.value = null
    try {
      const request: VersionRevisionRequest | ReviewRequest = {
        objectId: row.objectId,
        versionId: row.currentVersion.versionId,
        revision: row.currentVersion.revision,
        ...(action === 'reject' ? { comment: normalizedComment } : {}),
      }
      await apiClient.post<BobMutationResult, typeof request>(
        `bob/${entity}/${action}`,
        request,
      )
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  async function reverse(
    row: BobListItem,
    action: 'unsubmit' | 'unapprove',
    reason: string,
  ): Promise<boolean> {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    const normalizedReason = reason.trim()
    if (!normalizedReason) {
      errorMessage.value = '反向操作原因不能为空。'
      return false
    }
    if (Array.from(normalizedReason).length > 1000) {
      errorMessage.value = '反向操作原因不能超过 1000 个字符。'
      return false
    }
    actionLoading.value = `${action}:${row.objectId}`
    errorMessage.value = null
    try {
      await apiClient.post<BobMutationResult, ReverseRequest>(
        `bob/${entity}/${action}`,
        {
          objectId: row.objectId,
          objectRevision: row.objectRevision,
          versionId: row.currentVersion.versionId,
          revision: row.currentVersion.revision,
          reason: normalizedReason,
        },
      )
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  async function changeEnabled(row: BobListItem): Promise<boolean> {
    const action = row.enabled ? 'disable' : 'enable'
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${row.objectId}`
    errorMessage.value = null
    try {
      await apiClient.post<
        BobMutationResult,
        { objectId: string; objectRevision: number }
      >(`bob/${entity}/${action}`, {
        objectId: row.objectId,
        objectRevision: row.objectRevision,
      })
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  return { review, reverse, changeEnabled }
}
