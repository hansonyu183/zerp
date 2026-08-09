import type { Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getDiagnosticErrorMessage } from '@/api/types'
import type {
  VoucherDocumentView,
  VoucherEntityConfig,
  VoucherLifecycleAction,
  VoucherListItem,
  VoucherMutationResult,
  VoucherStatus,
} from '@/components/voucher'

const lifecycleStatuses: Record<VoucherLifecycleAction, VoucherStatus> = {
  check: 'DRAFT',
  uncheck: 'CHECKED',
  approve: 'CHECKED',
  unapprove: 'APPROVED',
}

export function lifecycleActionSuccessLabel(
  action: VoucherLifecycleAction,
): string {
  return {
    check: '已核对',
    uncheck: '已反核对',
    approve: '已批准',
    unapprove: '已反批准',
  }[action]
}

export async function postVoucherLifecycleAction(
  config: VoucherEntityConfig,
  action: VoucherLifecycleAction,
  documentId: string,
  revision: number,
  reason?: string,
): Promise<VoucherMutationResult> {
  const { data } = await apiClient.post<
    VoucherMutationResult,
    Record<string, unknown>
  >(`vou/${config.entity}/${action}`, {
    documentId,
    revision,
    ...(reason ? { reason } : {}),
  })
  return data
}

export function canRunListLifecycleAction(
  config: VoucherEntityConfig,
  row: VoucherListItem,
  action: VoucherLifecycleAction,
  can: (permission: string) => boolean,
): boolean {
  return (
    (row.status === lifecycleStatuses[action] ||
      (action === 'unapprove' && row.status === 'FINALIZED')) &&
    can(`/vou/${config.entity}/${action}`)
  )
}

interface ListLifecycleContext {
  config: VoucherEntityConfig
  rows: Ref<VoucherListItem[]>
  documentView: Ref<VoucherDocumentView | null>
  actionLoading: Ref<string | null>
  errorMessage: Ref<string | null>
  successMessage: Ref<string | null>
  canRun: (row: VoucherListItem, action: VoucherLifecycleAction) => boolean
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
  if (!context.canRun(row, action)) return false
  context.actionLoading.value = `${action}:${row.documentId}`
  context.errorMessage.value = null
  try {
    const data = await postVoucherLifecycleAction(
      context.config,
      action,
      row.documentId,
      row.revision,
      reason,
    )
    context.rows.value = context.rows.value.map((item) =>
      item.documentId === row.documentId
        ? { ...item, status: data.status, revision: data.revision }
        : item,
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
    void Promise.allSettled([
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
