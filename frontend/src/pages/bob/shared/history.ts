import { ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type {
  BobAuditEvent,
  BobEntityConfig,
  BobListItem,
  BobVersionHistoryItem,
} from './types'

export function useBobHistory(
  config: BobEntityConfig,
  errorMessage: Ref<string | null>,
  canOpenVersions: (row: Readonly<BobListItem>) => boolean,
  canOpenAudit: (row: Readonly<BobListItem>) => boolean,
) {
  const versionsOpen = ref(false)
  const versionsLoading = ref(false)
  const versions = ref<BobVersionHistoryItem[]>([])
  const versionsPage = ref(1)
  const versionsPageSize = ref(20)
  const versionsTotal = ref(0)
  const historyObject = ref<BobListItem | null>(null)

  const auditOpen = ref(false)
  const auditLoading = ref(false)
  const auditEvents = ref<BobAuditEvent[]>([])
  const auditPage = ref(1)
  const auditPageSize = ref(20)
  const auditTotal = ref(0)

  async function loadVersions(): Promise<void> {
    const row = historyObject.value
    if (!row) return
    versionsLoading.value = true
    try {
      const { data } = await apiClient.postContract(
        `bob/${config.entity}/versions`,
        {
          objectId: row.objectId,
          page: versionsPage.value,
          pageSize: versionsPageSize.value,
        },
      )
      versions.value = data.items ?? []
      versionsTotal.value = data.total
      versionsPage.value = data.page
      versionsPageSize.value = data.pageSize
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      versionsLoading.value = false
    }
  }

  async function openVersions(row: BobListItem): Promise<void> {
    if (!canOpenVersions(row)) return
    historyObject.value = row
    versions.value = []
    versionsPage.value = 1
    versionsOpen.value = true
    await loadVersions()
  }

  async function changeVersionsPage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === versionsPage.value) return
    versionsPage.value = nextPage
    await loadVersions()
  }

  async function loadAudit(): Promise<void> {
    const row = historyObject.value
    if (!row) return
    auditLoading.value = true
    try {
      const { data } = await apiClient.postContract(
        `bob/${config.entity}/audit-history`,
        {
          objectId: row.objectId,
          page: auditPage.value,
          pageSize: auditPageSize.value,
        },
      )
      auditEvents.value = data.items ?? []
      auditTotal.value = data.total
      auditPage.value = data.page
      auditPageSize.value = data.pageSize
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      auditLoading.value = false
    }
  }

  async function openAudit(row: BobListItem): Promise<void> {
    if (!canOpenAudit(row)) return
    historyObject.value = row
    auditEvents.value = []
    auditPage.value = 1
    auditOpen.value = true
    await loadAudit()
  }

  async function changeAuditPage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === auditPage.value) return
    auditPage.value = nextPage
    await loadAudit()
  }

  return {
    versionsOpen,
    versionsLoading,
    versions,
    versionsPage,
    versionsPageSize,
    versionsTotal,
    historyObject,
    auditOpen,
    auditLoading,
    auditEvents,
    auditPage,
    auditPageSize,
    auditTotal,
    openVersions,
    changeVersionsPage,
    openAudit,
    changeAuditPage,
  }
}
