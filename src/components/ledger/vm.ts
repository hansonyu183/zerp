import { computed, onScopeDispose, reactive, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageResult } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { localDate } from '@/utils/date'
import { createLedgerReferenceSearch } from './reference'
import type {
  LedgerBalanceFilters,
  LedgerEntityConfig,
  LedgerMode,
  LedgerQueryFilters,
  LedgerRecord,
  LedgerSort,
} from './types'

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

export function useLedgerViewModel(config: LedgerEntityConfig) {
  const session = useSessionStore()
  const today = localDate()
  const canQuery = computed(() =>
    session.can(`/led/${config.entity}/query`))
  const canBalance = computed(() =>
    session.can(`/led/${config.entity}/balance`))
  const mode = ref<LedgerMode>(canQuery.value ? 'entries' : 'balances')
  const rows = ref<LedgerRecord[]>([])
  const page = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  const sort = reactive<LedgerSort>({
    field: 'effectiveDate',
    order: 'desc',
  })
  const queryFilters = reactive<LedgerQueryFilters>({
    dateFrom: monthStart(today),
    dateTo: today,
    object: null,
    sourceEntity: '',
    documentNo: '',
    direction: [],
  })
  const balanceFilters = reactive<LedgerBalanceFilters>({
    asOfDate: today,
    object: null,
  })
  const references = createLedgerReferenceSearch(
    config.referenceSources,
    () => [queryFilters.object, balanceFilters.object],
  )
  let controller: AbortController | undefined
  let requestSequence = 0

  const columns = computed(() =>
    mode.value === 'entries' ? config.entryColumns : config.balanceColumns)
  const pageCount = computed(() =>
    Math.max(1, Math.ceil(total.value / pageSize.value)))

  async function load(): Promise<void> {
    if (
      (mode.value === 'entries' && !canQuery.value) ||
      (mode.value === 'balances' && !canBalance.value)
    ) return
    if (mode.value === 'entries') {
      if (!queryFilters.dateFrom || !queryFilters.dateTo) {
        errorMessage.value = '请选择完整的流水日期范围。'
        return
      }
      if (queryFilters.dateTo < queryFilters.dateFrom) {
        errorMessage.value = '结束日期不能早于开始日期。'
        return
      }
    } else if (!balanceFilters.asOfDate) {
      errorMessage.value = '请选择余额截止日期。'
      return
    }

    controller?.abort()
    controller = new AbortController()
    const sequence = ++requestSequence
    loading.value = true
    errorMessage.value = null
    try {
      const body = mode.value === 'entries'
        ? {
            page: page.value,
            pageSize: pageSize.value,
            filters: {
              dateFrom: queryFilters.dateFrom,
              dateTo: queryFilters.dateTo,
              ...(queryFilters.object
                ? { objectId: queryFilters.object.objectId }
                : {}),
              ...(queryFilters.sourceEntity
                ? { sourceEntity: queryFilters.sourceEntity }
                : {}),
              ...(queryFilters.documentNo.trim()
                ? { documentNo: queryFilters.documentNo.trim() }
                : {}),
              direction: [...queryFilters.direction],
            },
            sort: [{ ...sort }],
          }
        : {
            page: page.value,
            pageSize: pageSize.value,
            filters: {
              asOfDate: balanceFilters.asOfDate,
              ...(balanceFilters.object
                ? { objectId: balanceFilters.object.objectId }
                : {}),
            },
          }
      const action = mode.value === 'entries' ? 'query' : 'balance'
      const { data } = await apiClient.post<
        PageResult<LedgerRecord>,
        typeof body
      >(`led/${config.entity}/${action}`, body, {
        signal: controller.signal,
      })
      if (sequence !== requestSequence) return
      rows.value = data.items ?? []
      total.value = data.total
      page.value = data.page
      pageSize.value = data.pageSize
    } catch (error) {
      if (sequence === requestSequence && !controller.signal.aborted) {
        rows.value = []
        total.value = 0
        errorMessage.value = getErrorMessage(error)
      }
    } finally {
      if (sequence === requestSequence) loading.value = false
    }
  }

  function search(): void {
    page.value = 1
    void load()
  }

  function changePage(value: number): void {
    if (value < 1 || value > pageCount.value || value === page.value) return
    page.value = value
    void load()
  }

  function changeMode(value: LedgerMode): void {
    if (
      value === mode.value ||
      (value === 'entries' && !canQuery.value) ||
      (value === 'balances' && !canBalance.value)
    ) return
    mode.value = value
    page.value = 1
    rows.value = []
    total.value = 0
    void load()
  }

  function resetFilters(): void {
    if (mode.value === 'entries') {
      queryFilters.dateFrom = monthStart(today)
      queryFilters.dateTo = today
      queryFilters.object = null
      queryFilters.sourceEntity = ''
      queryFilters.documentNo = ''
      queryFilters.direction = []
      sort.field = 'effectiveDate'
      sort.order = 'desc'
    } else {
      balanceFilters.asOfDate = today
      balanceFilters.object = null
    }
    search()
  }

  onScopeDispose(() => {
    controller?.abort()
    references.dispose()
  })

  return {
    config,
    canQuery,
    canBalance,
    mode,
    rows,
    page,
    pageSize,
    total,
    loading,
    errorMessage,
    sort,
    queryFilters,
    balanceFilters,
    references,
    columns,
    pageCount,
    load,
    search,
    changePage,
    changeMode,
    resetFilters,
  }
}
