import { computed, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageRequest, type PageResult } from '@/api/types'

export interface CustomerRow {
  id: string
  code?: string
  name?: string
  status?: string
  updatedAt?: string
}

const statusText: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  REJECTED: '已驳回',
  EFFECTIVE: '有效',
  INVALID: '已失效',
}

export function useCustomerViewModel() {
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  const rows = ref<CustomerRow[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')

  const hasRows = computed(() => rows.value.length > 0)

  function getStatusText(status?: string): string {
    return status ? statusText[status] ?? status : '未标记'
  }

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null

    try {
      const { data } = await apiClient.post<PageResult<CustomerRow>, PageRequest>(
        'bob/customer/query',
        {
          page: page.value,
          pageSize: pageSize.value,
          filters: keyword.value.trim() ? { keyword: keyword.value.trim() } : {},
          sort: [{ field: 'updatedAt', order: 'desc' }],
        },
      )

      rows.value = Array.isArray(data.items) ? data.items : []
      total.value = typeof data.total === 'number' ? data.total : rows.value.length
      page.value = typeof data.page === 'number' ? data.page : page.value
      pageSize.value = typeof data.pageSize === 'number' ? data.pageSize : pageSize.value
    } catch (error) {
      rows.value = []
      total.value = 0
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    errorMessage,
    rows,
    total,
    page,
    pageSize,
    keyword,
    hasRows,
    getStatusText,
    query,
  }
}
