import { computed, ref } from 'vue'
import type { BusinessObjectSort } from '@/components/business-object'
import type { components } from '@/api/generated/schema'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'

export type SupplierListItem = components['schemas']['BobListItem']
export type SupplierDetailView = components['schemas']['BobObjectView']

export function useSupplierViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const editorLoading = ref(false)
  const errorMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<SupplierListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const sort = ref<BusinessObjectSort>({ field: 'code', order: 'asc' })
  const enabled = ref<boolean | ''>('')
  const drawerOpen = ref(false)
  const currentView = ref<SupplierDetailView | null>(null)
  const canView = computed(() => session.can('/bob/supplier/get'))
  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract('bob/supplier/query', {
        page: page.value,
        pageSize: 20,
        filters: {
          ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
          ...(enabled.value === '' ? {} : { enabled: enabled.value }),
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
  async function changePage(next: number): Promise<void> {
    if (next >= 1 && next !== page.value && !loading.value) {
      page.value = next
      await query()
    }
  }
  async function resetFilters(): Promise<void> {
    keyword.value = ''
    enabled.value = ''
    sort.value = { field: 'code', order: 'asc' }
    await search()
  }
  async function changeSort(value: BusinessObjectSort): Promise<void> {
    sort.value = value
    await search()
  }
  async function openView(
    row: Pick<SupplierListItem, 'objectId'>,
  ): Promise<void> {
    if (!canView.value || editorLoading.value) return
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const { data } = await apiClient.postContract('bob/supplier/get', {
        objectId: row.objectId,
      })
      if (!data) throw new Error('供应商当前档案不存在。')
      currentView.value = data
      drawerOpen.value = true
    } catch (error) {
      drawerOpen.value = false
      currentView.value = null
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }
  async function openById(objectId: string): Promise<void> {
    await openView({ objectId })
  }
  function closeEditor(): void {
    drawerOpen.value = false
    currentView.value = null
    editorErrorMessage.value = null
  }
  return {
    loading,
    editorLoading,
    errorMessage,
    editorErrorMessage,
    rows,
    total,
    page,
    pageSize,
    keyword,
    sort,
    enabled,
    drawerOpen,
    currentView,
    canView,
    query,
    search,
    changePage,
    changeSort,
    resetFilters,
    openView,
    openById,
    closeEditor,
  }
}
