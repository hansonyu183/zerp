import type { Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getDiagnosticErrorMessage } from '@/api/types'
import type {
  VoucherDocumentView,
  VoucherEntityConfig,
  VoucherLifecycleAction,
  VoucherListItem,
  VoucherMutationResult,
} from '@/components/voucher'
import { approvalActionPresentation } from '@/shared/approval'

export function lifecycleActionSuccessLabel(
  action: VoucherLifecycleAction,
): string {
  return approvalActionPresentation[action].successLabel
}

export async function postVoucherLifecycleAction(
  config: VoucherEntityConfig,
  action: VoucherLifecycleAction,
  documentId: string,
  revision: number,
  reason?: string,
): Promise<VoucherMutationResult> {
  const response =
    action === 'reject' || action === 'unapprove'
      ? await apiClient.postContract(`vou/${config.entity}/${action}`, {
          documentId,
          revision,
          reason: reason ?? '',
        })
      : await apiClient.postContract(`vou/${config.entity}/${action}`, {
          documentId,
          revision,
        })
  const { data } = response
  return data
}

interface ListLifecycleContext {
  config: VoucherEntityConfig
  rows: Ref<VoucherListItem[]>
  documentView: Ref<VoucherDocumentView | null>
  actionLoading: Ref<string | null>
  errorMessage: Ref<string | null>
  successMessage: Ref<string | null>
  query: () => Promise<void>
  loadDocument: (documentId: string) => Promise<void>
  loadAudit: (page: number) => Promise<void>
}

export async function runListLifecycleAction(
  context: ListLifecycleContext,
  row: VoucherListItem,
  action: VoucherLifecycleAction,
  reason?: string,
): Promise<boolean> {
  if (!row.availableApprovalActions.includes(action)) return false
  context.actionLoading.value = `${action}:${row.documentId}`
  context.errorMessage.value = null
  try {
    await postVoucherLifecycleAction(
      context.config,
      action,
      row.documentId,
      row.revision,
      reason,
    )
    if (context.documentView.value?.documentId === row.documentId) {
      await context.loadDocument(row.documentId)
    }
    context.successMessage.value = `${row.documentNo} ${lifecycleActionSuccessLabel(action)}。`
    return true
  } catch (error) {
    context.errorMessage.value = getDiagnosticErrorMessage(error)
    return false
  } finally {
    context.actionLoading.value = null
    await Promise.allSettled([
      context.query(),
      context.documentView.value?.documentId === row.documentId
        ? context.loadAudit(1)
        : Promise.resolve(),
    ])
  }
}

export function createListLifecycleAction(context: ListLifecycleContext) {
  return (
    row: VoucherListItem,
    action: VoucherLifecycleAction,
    reason?: string,
  ) => runListLifecycleAction(context, row, action, reason)
}
