import type { Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import {
  dclOperatingEntityActiveVersion,
  type DclOperatingEntityActionAvailability,
  type DclOperatingEntityListItem,
} from './types'

type LifecycleAction =
  'approve' | 'reject' | 'unsubmit' | 'unapprove' | 'enable' | 'disable'

export function dclOperatingEntityLifecycleSuccessLabel(
  action: LifecycleAction,
): string {
  return {
    approve: '已审核通过',
    reject: '已审核驳回',
    unsubmit: '已撤回提交',
    unapprove: '已撤销批准',
    enable: '已生成启用草稿',
    disable: '已生成禁用草稿',
  }[action]
}

export function useDclOperatingEntityLifecycle(
  actionLoading: Ref<string | null>,
  errorMessage: Ref<string | null>,
  actionAvailability: (
    row: Readonly<DclOperatingEntityListItem>,
  ) => DclOperatingEntityActionAvailability,
  query: () => Promise<void>,
  onSuccess: (row: DclOperatingEntityListItem, action: LifecycleAction) => void,
) {
  async function review(
    row: DclOperatingEntityListItem,
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
      const version = dclOperatingEntityActiveVersion(row).approval
      const request = {
        objectId: row.objectId,
        approvalEntryId: version.approvalEntryId,
        approvalRevision: version.revision,
      }
      if (action === 'reject') {
        await apiClient.postContract('dcl/operating-entity/reject', {
          ...request,
          reason: normalizedComment,
        })
      } else {
        await apiClient.postContract('dcl/operating-entity/approve', request)
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
    row: DclOperatingEntityListItem,
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
      const version = dclOperatingEntityActiveVersion(row).approval
      await apiClient.postContract(`dcl/operating-entity/${action}`, {
        objectId: row.objectId,
        approvalEntryId: version.approvalEntryId,
        approvalRevision: version.revision,
        reason: normalizedReason,
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

  async function changeEnabled(
    row: DclOperatingEntityListItem,
  ): Promise<boolean> {
    const action = row.enabled ? 'disable' : 'enable'
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${row.objectId}`
    errorMessage.value = null
    try {
      const approved = row.latestApproved
      if (!approved) {
        throw new Error('经营主体没有可用于变更启停状态的已批准版本。')
      }
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
