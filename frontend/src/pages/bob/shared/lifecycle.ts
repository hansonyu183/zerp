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

export function bobSelfReviewBlocked(
  row: Readonly<BobListItem>,
  currentUserId: string | undefined,
): boolean {
  return (
    currentUserId !== undefined &&
    row.currentVersion.status === 'PENDING' &&
    row.currentVersion.submittedBy === currentUserId
  )
}

export function bobActionBlockedReason(
  row: Readonly<BobListItem>,
  currentUserId: string | undefined,
  canReview: boolean,
): string | null {
  return bobSelfReviewBlocked(row, currentUserId) && canReview
    ? '提交人不能审核自己提交的版本，请由其他审核人处理。'
    : null
}

export function bobActionAvailability(
  row: Readonly<BobListItem>,
  currentUserId: string | undefined,
  can: (action: string) => boolean,
): BobActionAvailability {
  const status = row.currentVersion.status
  const selfReview = bobSelfReviewBlocked(row, currentUserId)
  return {
    view: can('get'),
    edit: status === 'DRAFT' && can('get') && can('save'),
    delete:
      can('delete') &&
      status === 'DRAFT' &&
      row.currentVersion.version === 1 &&
      row.effectiveVersionId === null,
    submit: can('submit') && status === 'DRAFT',
    unsubmit: can('unsubmit') && status === 'PENDING',
    approve: can('approve') && status === 'PENDING' && !selfReview,
    unapprove: can('unapprove') && status === 'EFFECTIVE',
    reject: can('reject') && status === 'PENDING' && !selfReview,
    enable: can('enable') && status === 'EFFECTIVE' && !row.enabled,
    disable: can('disable') && status === 'EFFECTIVE' && row.enabled,
    versions: can('versions'),
    audit: can('audit-history'),
  }
}

export function bobLifecycleSuccessLabel(
  action:
    'approve' | 'reject' | 'unsubmit' | 'unapprove' | 'enable' | 'disable',
): string {
  return {
    approve: '已审核通过',
    reject: '已审核驳回',
    unsubmit: '已撤回提交',
    unapprove: '已撤销批准',
    enable: '已启用',
    disable: '已禁用',
  }[action]
}

export function useBobLifecycleActions(
  entity: BobEntity,
  actionLoading: Ref<string | null>,
  errorMessage: Ref<string | null>,
  actionAvailability: (row: Readonly<BobListItem>) => BobActionAvailability,
  query: () => Promise<void>,
  onSuccess: (
    row: BobListItem,
    action:
      'approve' | 'reject' | 'unsubmit' | 'unapprove' | 'enable' | 'disable',
  ) => void,
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
      onSuccess(row, action)
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
      onSuccess(row, action)
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
      onSuccess(row, action)
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
