import { computed, ref } from 'vue'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'

export type BobCustomerListItem = components['schemas']['BobCustomerListItem']
export type BobCustomerCurrentView =
  components['schemas']['BobCustomerCurrentView']

export function useBobCustomerViewModel() {
  const session = useSessionStore()
  const rows = ref<BobCustomerListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const enabled = ref<boolean | null>(null)
  const loading = ref(false)
  const editorLoading = ref(false)
  const errorMessage = ref<string | null>(null)
  const drawerOpen = ref(false)
  const currentView = ref<BobCustomerCurrentView | null>(null)
  const canView = computed(() => session.can('/bob/customer/get'))

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract('bob/customer/query', {
        page: page.value,
        pageSize: 20,
        filters: {
          ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
          ...(enabled.value === null ? {} : { enabled: enabled.value }),
        },
        sort: [{ field: 'code', order: 'asc' }],
      })
      rows.value = data.items
      total.value = data.total
      page.value = data.page
      pageSize.value = data.pageSize
    } catch (error) {
      rows.value = []
      total.value = 0
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function search(): Promise<void> {
    page.value = 1
    await query()
  }

  async function changePage(value: number): Promise<void> {
    page.value = value
    await query()
  }

  async function openById(objectId: string): Promise<void> {
    editorLoading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract('bob/customer/get', {
        objectId,
      })
      if (!data) throw new Error('客户关系当前档案不存在。')
      currentView.value = data
      drawerOpen.value = true
    } catch (error) {
      currentView.value = null
      drawerOpen.value = false
      errorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }

  return {
    rows,
    total,
    page,
    pageSize,
    keyword,
    enabled,
    loading,
    editorLoading,
    errorMessage,
    drawerOpen,
    currentView,
    canView,
    query,
    search,
    changePage,
    openById,
  }
}
