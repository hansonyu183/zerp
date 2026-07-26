import {
  getCurrentScope,
  onScopeDispose,
  ref,
  type Ref,
} from 'vue'
import { getErrorMessage } from '@/api/types'
import { intermediaryWorkflowApi } from './api'
import type {
  IntermediaryAuditEvent,
  IntermediaryWorkflowDocument,
} from './types'

export function useIntermediaryAudit(
  document: Ref<IntermediaryWorkflowDocument | null>,
  canLoad: () => boolean,
) {
  const auditEvents = ref<IntermediaryAuditEvent[]>([])
  const auditLoading = ref(false)
  const auditError = ref<string | null>(null)
  const auditPage = ref(1)
  const auditPageSize = ref(20)
  const auditTotal = ref(0)
  const auditController = ref<AbortController | null>(null)

  function resetAudit(): void {
    auditController.value?.abort()
    auditController.value = null
    auditEvents.value = []
    auditLoading.value = false
    auditError.value = null
    auditPage.value = 1
    auditTotal.value = 0
  }

  async function loadAudit(nextPage = auditPage.value): Promise<void> {
    if (!document.value || !canLoad()) return
    auditController.value?.abort()
    const controller = new AbortController()
    const processId = document.value.processId
    auditController.value = controller
    auditPage.value = nextPage
    auditLoading.value = true
    auditError.value = null
    try {
      const { data } = await intermediaryWorkflowApi.audit(
        {
          processId,
          page: nextPage,
          pageSize: auditPageSize.value,
        },
        controller.signal,
      )
      if (
        controller.signal.aborted ||
        document.value?.processId !== processId
      ) {
        return
      }
      auditEvents.value = data.items ?? []
      auditTotal.value = data.total
      auditPage.value = data.page
      auditPageSize.value = data.pageSize
    } catch (error) {
      if (!controller.signal.aborted) {
        auditError.value = getErrorMessage(error)
      }
    } finally {
      if (auditController.value === controller) {
        auditController.value = null
        auditLoading.value = false
      }
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => auditController.value?.abort())
  }

  return {
    auditEvents,
    auditLoading,
    auditError,
    auditPage,
    auditPageSize,
    auditTotal,
    resetAudit,
    loadAudit,
  }
}
