import { computed, ref } from 'vue'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'

export type BobCustomerAccountListItem =
  components['schemas']['BobCustomerAccountListItem']
export type BobCustomerAccountCurrentView =
  components['schemas']['BobCustomerAccountCurrentView']

export function useBobCustomerAccountViewModel() {
  const session = useSessionStore()
  const rows = ref<BobCustomerAccountListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const enabled = ref<boolean | null>(null)
  const customerRelationshipId = ref('')
  const loading = ref(false)
  const editorLoading = ref(false)
  const errorMessage = ref<string | null>(null)
  const drawerOpen = ref(false)
  const currentView = ref<BobCustomerAccountCurrentView | null>(null)
  const canView = computed(() => session.can('/bob/customer-account/get'))

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract(
        'bob/customer-account/query',
        {
          page: page.value,
          pageSize: 20,
          filters: {
            ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
            ...(enabled.value === null ? {} : { enabled: enabled.value }),
            ...(customerRelationshipId.value.trim()
              ? {
                  customerRelationshipId: customerRelationshipId.value.trim(),
                }
              : {}),
          },
          sort: [{ field: 'code', order: 'asc' }],
        },
      )
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
      const { data } = await apiClient.postContract(
        'bob/customer-account/get',
        { objectId },
      )
      if (!data) throw new Error('客户结算子账户当前档案不存在。')
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
    customerRelationshipId,
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
