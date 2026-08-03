import { computed, onScopeDispose, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageResult } from '@/api/types'
import { useSessionStore } from '@/stores/session'

export interface AssetReference {
  name: string
  code: string
}

export interface Asset {
  assetId: string
  assetNo: string
  assetName: string
  specification?: string
  category: AssetReference
  department: AssetReference
  custodian?: AssetReference
  location?: string
  acquisitionDate: string
  depreciationStartMonth: string
  originalValue: string
  residualValue: string
  usefulLifeMonths: number
  accumulatedDepreciation: string
  netValue: string
  lastDepreciationMonth?: string
  status: string
  remark?: string
}

export interface AssetHistory {
  id: string
  entryType: string
  sourceDocumentNo: string
  effectiveDate: string
  amount: string
  statusFrom?: string
  statusTo?: string
}

export interface AssetDetail {
  asset: Asset
  history: AssetHistory[]
}

interface AssetQueryRequest {
  page: number
  pageSize: number
  filters: { keyword: string; status: string[] }
}

export const assetStatusOptions = [
  { title: '在用', value: 'ACTIVE' },
  { title: '已出让', value: 'SOLD' },
  { title: '已清算', value: 'RETIRED' },
]

export function useAssetLedgerViewModel() {
  const session = useSessionStore()
  const canQuery = computed(() => session.can('/led/asset/query'))
  const canGet = computed(() => session.can('/led/asset/get'))
  const rows = ref<Asset[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const status = ref<string[]>([])
  const loading = ref(false)
  const errorMessage = ref('')
  const detail = ref<AssetDetail | null>(null)
  const detailOpen = ref(false)
  const pageCount = computed(() =>
    Math.max(1, Math.ceil(total.value / pageSize.value)),
  )
  let controller: AbortController | undefined
  let requestSequence = 0

  function statusLabel(value: string): string {
    return (
      assetStatusOptions.find((item) => item.value === value)?.title ?? value
    )
  }

  async function load(): Promise<void> {
    if (!canQuery.value) return
    controller?.abort()
    controller = new AbortController()
    const sequence = ++requestSequence
    loading.value = true
    errorMessage.value = ''
    try {
      const { data } = await apiClient.post<
        PageResult<Asset>,
        AssetQueryRequest
      >(
        'led/asset/query',
        {
          page: page.value,
          pageSize: pageSize.value,
          filters: { keyword: keyword.value.trim(), status: status.value },
        },
        { signal: controller.signal },
      )
      if (sequence !== requestSequence) return
      rows.value = data.items
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

  async function open(row: Asset): Promise<void> {
    if (!canGet.value) return
    loading.value = true
    errorMessage.value = ''
    try {
      const { data } = await apiClient.post<AssetDetail, { assetId: string }>(
        'led/asset/get',
        { assetId: row.assetId },
      )
      detail.value = data
      detailOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function search(): void {
    page.value = 1
    void load()
  }

  function updatePage(value: number): void {
    if (value < 1 || value > pageCount.value || value === page.value) return
    page.value = value
    void load()
  }

  function updatePageSize(value: number): void {
    pageSize.value = value
    page.value = 1
    void load()
  }

  onScopeDispose(() => controller?.abort())

  return {
    canQuery,
    canGet,
    rows,
    total,
    page,
    pageSize,
    keyword,
    status,
    loading,
    errorMessage,
    detail,
    detailOpen,
    pageCount,
    statusLabel,
    load,
    open,
    search,
    updatePage,
    updatePageSize,
  }
}
