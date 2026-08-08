import { computed, onScopeDispose, reactive, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { localDate } from '@/utils/date'

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
  type OriginatingPartyReference = {
    objectId: string
    versionId: string
    code: string
    name: string
    entity: 'customer' | 'supplier' | 'other-party'
  }
  const originatingPartyOptions = ref<OriginatingPartyReference[]>([])
  const selectedOriginatingParty = ref<OriginatingPartyReference | null>(null)
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
  let originatingPartyController: AbortController | undefined
  let originatingPartySequence = 0
  async function searchOriginatingParty(keyword: string) {
    const current = ++originatingPartySequence
    originatingPartyController?.abort()
    const requestController = new AbortController()
    originatingPartyController = requestController
    try {
      const request: components['schemas']['BobQueryRequest'] = {
        page: 1,
        pageSize: 20,
        filters: { keyword },
        sort: [{ field: 'code', order: 'asc' }],
      }
      const entities = ['customer', 'supplier', 'other-party'] as const
      const results = await Promise.all(
        entities.map(async (entity) => ({
          entity,
          result: await apiClient.post<
            components['schemas']['BobListPage'],
            components['schemas']['BobQueryRequest']
          >(`bob/${entity}/query`, request, {
            signal: requestController.signal,
          }),
        })),
      )
      if (
        current === originatingPartySequence &&
        !requestController.signal.aborted
      ) {
        originatingPartyOptions.value = results.flatMap(({ entity, result }) =>
          result.data.items.map((item) => ({
            objectId: item.objectId,
            versionId: item.effectiveVersionId ?? item.currentVersion.versionId,
            code: item.code,
            name: String(item.currentVersion.summary.name ?? item.code),
            entity,
          })),
        )
      }
    } catch (error) {
      if (
        current === originatingPartySequence &&
        !requestController.signal.aborted
      )
        errorMessage.value = getErrorMessage(error)
    }
  }
  function selectOriginatingParty(value: OriginatingPartyReference | null) {
    selectedOriginatingParty.value = value
    filters.originatingPartyType = value?.entity
    filters.originatingPartyObjectId = value?.objectId
  }
  function search() {
    page.value = 1
    void load()
  }
  function maturityShortcut(kind: '30d' | '7d' | 'today' | 'overdue') {
    const today = new Date()
    const end = new Date(today)
    end.setDate(end.getDate() + (kind === '30d' ? 30 : kind === '7d' ? 7 : 0))
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    filters.maturityDateFrom = kind === 'overdue' ? undefined : localDate(today)
    filters.maturityDateTo =
      kind === 'overdue' ? localDate(yesterday) : localDate(end)
    filters.availability = kind === 'overdue' ? 'MATURED' : undefined
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
    originatingPartyController?.abort()
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
    originatingPartyOptions,
    selectedOriginatingParty,
    load,
    search,
    maturityShortcut,
    changePage,
    searchOriginatingParty,
    selectOriginatingParty,
  }
}
