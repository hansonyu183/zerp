import { computed, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageResult } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import type {
  ClosingHistoryItem,
  ClosingMutationResult,
  ClosingView,
} from './types'

function localDate(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function lastCompletedMonthEnd(now = new Date()): string {
  return localDate(new Date(now.getFullYear(), now.getMonth(), 0))
}

export function useOpeningViewModel() {
  const session = useSessionStore()
  const canGet = computed(() => session.can('/led/closing/get'))
  const canClose = computed(() => session.can('/led/closing/close'))
  const canUnclose = computed(() => session.can('/led/closing/unclose'))
  const canHistory = computed(() => session.can('/led/closing/history'))
  const closing = ref<ClosingView | null>(null)
  const closingDate = ref(lastCompletedMonthEnd())
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const uncloseDialog = ref(false)
  const uncloseReason = ref('')
  const historyItems = ref<ClosingHistoryItem[]>([])
  const historyPage = ref(1)
  const historyPageSize = ref(20)
  const historyTotal = ref(0)
  const historyLoading = ref(false)
  const historyLoaded = ref(false)
  const historyPageCount = computed(() =>
    Math.max(1, Math.ceil(historyTotal.value / historyPageSize.value)),
  )

  async function load(): Promise<void> {
    if (!canGet.value) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<ClosingView>('led/closing/get', {})
      closing.value = data
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function close(): Promise<boolean> {
    if (!closing.value || !canClose.value || !closingDate.value) return false
    saving.value = true
    errorMessage.value = null
    successMessage.value = null
    try {
      const { data } = await apiClient.post<
        ClosingMutationResult,
        { revision: number; closingDate: string }
      >('led/closing/close', {
        revision: closing.value.revision,
        closingDate: closingDate.value,
      })
      closing.value.revision = data.revision
      successMessage.value = `已完成 ${closingDate.value} 月末结账。`
      await load()
      if (historyLoaded.value) await loadHistory()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function unclose(): Promise<boolean> {
    if (!closing.value || !canUnclose.value) return false
    const reason = uncloseReason.value.trim()
    if (!reason || [...reason].length > 1000) {
      errorMessage.value = '反结账原因必填且不得超过 1000 字。'
      return false
    }
    saving.value = true
    errorMessage.value = null
    successMessage.value = null
    try {
      await apiClient.post<
        ClosingMutationResult,
        { revision: number; reason: string }
      >('led/closing/unclose', {
        revision: closing.value.revision,
        reason,
      })
      successMessage.value = '已反结最近一期。'
      uncloseDialog.value = false
      uncloseReason.value = ''
      await load()
      if (historyLoaded.value) await loadHistory()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function loadHistory(): Promise<void> {
    if (!canHistory.value) return
    historyLoading.value = true
    try {
      const { data } = await apiClient.post<
        PageResult<ClosingHistoryItem>,
        { page: number; pageSize: number }
      >('led/closing/history', {
        page: historyPage.value,
        pageSize: historyPageSize.value,
      })
      historyItems.value = data.items
      historyTotal.value = data.total
      historyLoaded.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      historyLoading.value = false
    }
  }

  async function changeHistoryPage(page: number): Promise<void> {
    if (page < 1 || page > historyPageCount.value) return
    historyPage.value = page
    await loadHistory()
  }

  return {
    canGet,
    canClose,
    canUnclose,
    canHistory,
    closing,
    closingDate,
    loading,
    saving,
    errorMessage,
    successMessage,
    uncloseDialog,
    uncloseReason,
    historyItems,
    historyPage,
    historyTotal,
    historyLoading,
    historyLoaded,
    historyPageCount,
    load,
    close,
    unclose,
    loadHistory,
    changeHistoryPage,
  }
}
