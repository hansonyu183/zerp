import type { Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type {
  BobActionAvailability,
  BobEntityConfig,
  BobListItem,
} from './types'
import {
  bobApprovalDomain,
  bobListActiveVersion,
  bobWriteEntity,
} from './types'

interface VersionRevisionRequest {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
}

interface ReviewRequest extends VersionRevisionRequest {
  reason: string | null
}

export function bobSelfReviewBlocked(
  row: Readonly<BobListItem>,
  currentUserId: string | undefined,
): boolean {
  return (
    currentUserId !== undefined &&
    bobListActiveVersion(row).approval.status === 'PENDING' &&
    bobListActiveVersion(row).approval.submittedBy === currentUserId
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
  const version = bobListActiveVersion(row)
  const status = version.approval.status
  const selfReview = bobSelfReviewBlocked(row, currentUserId)
  return {
    view: can('get'),
    edit:
      (status === 'DRAFT' || status === 'APPROVED') &&
      can('get') &&
      can('save'),
    delete:
      can('delete') &&
      status === 'DRAFT' &&
      version.approval.versionNo === 1 &&
      row.latestApproved === null,
    submit: can('submit') && status === 'DRAFT',
    unsubmit: can('unsubmit') && status === 'PENDING',
    approve: can('approve') && status === 'PENDING' && !selfReview,
    unapprove: can('unapprove') && status === 'APPROVED',
    reject: can('reject') && status === 'PENDING' && !selfReview,
    enable: can('enable') && row.latestApproved !== null && !row.enabled,
    disable: can('disable') && row.latestApproved !== null && row.enabled,
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
  config: BobEntityConfig,
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
      const request: VersionRevisionRequest = {
        objectId: row.objectId,
        approvalEntryId: bobListActiveVersion(row).approval.approvalEntryId,
        approvalRevision: bobListActiveVersion(row).approval.revision,
      }
      if (action === 'reject') {
        const reviewRequest = {
          ...request,
          reason: normalizedComment,
        } satisfies ReviewRequest
        if (bobApprovalDomain(config) === 'dcl') {
          await apiClient.postContract(
            'dcl/operating-entity/reject',
            reviewRequest,
          )
        } else {
          await apiClient.postContract(
            `bob/${bobWriteEntity(config)}/reject`,
            reviewRequest,
          )
        }
      } else {
        if (bobApprovalDomain(config) === 'dcl') {
          await apiClient.postContract('dcl/operating-entity/approve', request)
        } else {
          await apiClient.postContract(
            `bob/${bobWriteEntity(config)}/approve`,
            request,
          )
        }
      }
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
      const request = {
        objectId: row.objectId,
        approvalEntryId: bobListActiveVersion(row).approval.approvalEntryId,
        approvalRevision: bobListActiveVersion(row).approval.revision,
        reason: normalizedReason,
      }
      if (bobApprovalDomain(config) === 'dcl') {
        if (action === 'unsubmit') {
          await apiClient.postContract('dcl/operating-entity/unsubmit', request)
        } else {
          await apiClient.postContract(
            'dcl/operating-entity/unapprove',
            request,
          )
        }
      } else {
        await apiClient.postContract(
          `bob/${bobWriteEntity(config)}/${action}`,
          request,
        )
      }
      onSuccess(row, action)
      void query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  async function changeEnabled(
    row: BobListItem,
    handleError?: (error: unknown) => boolean,
  ): Promise<boolean> {
    const action = row.enabled ? 'disable' : 'enable'
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${row.objectId}`
    errorMessage.value = null
    try {
      if (bobApprovalDomain(config) === 'dcl') {
        const approved = row.latestApproved
        if (!approved)
          throw new Error('经营主体没有可用于变更启停状态的已批准版本。')
        const { data: view } = await apiClient.postContract(
          'dcl/operating-entity/get',
          {
            objectId: row.objectId,
            approvalEntryId: approved.approval.approvalEntryId,
          },
        )
        await apiClient.postContract('dcl/operating-entity/save', {
          objectId: row.objectId,
          approvalEntryId: view.approval.approvalEntryId,
          approvalRevision: view.approval.revision,
          enabled: !row.enabled,
          data: view.data,
        })
      } else {
        await apiClient.postContract(
          `bob/${bobWriteEntity(config)}/${action}`,
          {
            objectId: row.objectId,
            objectRevision: row.objectRevision,
          },
        )
      }
      await query()
      onSuccess(row, action)
      return true
    } catch (error) {
      if (!handleError?.(error)) errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  return { review, reverse, changeEnabled }
}
