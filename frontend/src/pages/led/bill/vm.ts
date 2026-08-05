import { computed, onScopeDispose, reactive, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'

type Request = components['schemas']['LedBillQueryRequest']
type Row = components['schemas']['LedBillListItem']
export function useBillLedgerViewModel() {
  const session = useSessionStore()
  const canQuery = computed(() => session.can('/led/bill/query'))
  const rows = ref<Row[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  const customerOptions = ref<
    Array<{
      objectId: string
      versionId: string
      code: string
      name: string
      entity?: string
    }>
  >([])
  const filters = reactive<Request['filters']>({})
  const sort = reactive<Request['sort'][number]>({
    field: 'maturityDate',
    order: 'asc',
  })
  let controller: AbortController | undefined
  let loadSequence = 0
  async function load() {
    if (!canQuery.value) return
    const current = ++loadSequence
    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    loading.value = true
    errorMessage.value = null
    const request: Request = {
      page: page.value,
      pageSize: pageSize.value,
      filters,
      sort: [sort],
    }
    try {
      const result = await apiClient.postContract('led/bill/query', request, {
        signal: requestController.signal,
      })
      if (current !== loadSequence || requestController.signal.aborted) return
      rows.value = result.data.items
      total.value = result.data.total
    } catch (error) {
      if (current === loadSequence && !requestController.signal.aborted)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (current === loadSequence) loading.value = false
    }
  }
  let customerController: AbortController | undefined
  let customerSequence = 0
  async function searchCustomer(keyword: string) {
    const current = ++customerSequence
    customerController?.abort()
    const requestController = new AbortController()
    customerController = requestController
    try {
      const request: components['schemas']['BobQueryRequest'] = {
        page: 1,
        pageSize: 20,
        filters: { keyword },
        sort: [{ field: 'code', order: 'asc' }],
      }
      const result = await apiClient.post<
        components['schemas']['BobListPage'],
        components['schemas']['BobQueryRequest']
      >('bob/customer/query', request, { signal: requestController.signal })
      if (current === customerSequence && !requestController.signal.aborted) {
        customerOptions.value = result.data.items.map((item) => ({
          objectId: item.objectId,
          versionId: item.effectiveVersionId ?? item.currentVersion.versionId,
          code: item.code,
          name: String(item.currentVersion.summary.name ?? item.code),
          entity: item.entity,
        }))
      }
    } catch (error) {
      if (current === customerSequence && !requestController.signal.aborted)
        errorMessage.value = getErrorMessage(error)
    }
  }
  function search() {
    page.value = 1
    void load()
  }
  function maturityShortcut(kind: '30d' | '7d' | 'today' | 'overdue') {
    const today = new Date()
    const iso = (date: Date) => date.toISOString().slice(0, 10)
    const end = new Date(today)
    end.setUTCDate(
      end.getUTCDate() + (kind === '30d' ? 30 : kind === '7d' ? 7 : 0),
    )
    filters.maturityDateFrom = kind === 'overdue' ? undefined : iso(today)
    filters.maturityDateTo =
      kind === 'overdue'
        ? iso(new Date(today.getTime() - 86_400_000))
        : iso(end)
    if (kind === 'overdue') filters.availability = 'MATURED'
    search()
  }
  function changePage(value: number) {
    if (value > 0 && value <= Math.ceil(total.value / pageSize.value)) {
      page.value = value
      void load()
    }
  }
  onScopeDispose(() => {
    controller?.abort()
    customerController?.abort()
  })
  return {
    canQuery,
    rows,
    total,
    page,
    pageSize,
    loading,
    errorMessage,
    filters,
    sort,
    customerOptions,
    load,
    search,
    maturityShortcut,
    changePage,
    searchCustomer,
  }
}
