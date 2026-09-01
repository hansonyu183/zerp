import { computed, ref } from 'vue'
import type { BusinessObjectSort } from '@/components/business-object'
import type { components } from '@/api/generated/schema'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { formatReferenceLabel } from '@/utils/reference-label'

export type TypedBusinessArchiveEntity =
  'employee' | 'supplier' | 'other-unit' | 'sales-partner'

type TypedListItem =
  | components['schemas']['BobEmployeeListItem']
  | components['schemas']['BobSupplierListItem']
  | components['schemas']['BobOtherUnitListItem']
  | components['schemas']['BobSalesPartnerListItem']
type TypedView =
  | components['schemas']['BobEmployeeCurrentView']
  | components['schemas']['BobSupplierCurrentView']
  | components['schemas']['BobOtherUnitCurrentView']
  | components['schemas']['BobSalesPartnerCurrentView']

type OperatingEntityOption = {
  value: string
  title: string
}

export function useTypedBusinessArchiveViewModel(
  entity: TypedBusinessArchiveEntity,
) {
  const session = useSessionStore()
  const supportsOperatingEntityFilter = entity !== 'employee'
  const rows = ref<TypedListItem[]>([])
  const currentView = ref<TypedView | null>(null)
  const loading = ref(false)
  const editorLoading = ref(false)
  const operatingEntityLoading = ref(false)
  const errorMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const operatingEntityErrorMessage = ref<string | null>(null)
  const page = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const keyword = ref('')
  const enabled = ref<boolean | ''>('')
  const operatingEntityId = ref('')
  const operatingEntityOptions = ref<OperatingEntityOption[]>([])
  const sort = ref<BusinessObjectSort>({ field: 'code', order: 'asc' })
  const drawerOpen = ref(false)
  const canView = computed(() => session.can(`/bob/${entity}/get`))

  function queryFilters(): components['schemas']['BobQueryRequest']['filters'] {
    return {
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      ...(enabled.value === '' ? {} : { enabled: enabled.value }),
      ...(supportsOperatingEntityFilter && operatingEntityId.value
        ? { operatingEntityId: operatingEntityId.value }
        : {}),
    }
  }

  async function query() {
    loading.value = true
    errorMessage.value = null
    try {
      const request = {
        page: page.value,
        pageSize: 20,
        filters: queryFilters(),
        sort: [{ field: 'code', order: 'asc' as const }],
      }
      const { data } =
        entity === 'employee'
          ? await apiClient.postContract('bob/employee/query', request)
          : entity === 'supplier'
            ? await apiClient.postContract('bob/supplier/query', request)
            : entity === 'other-unit'
              ? await apiClient.postContract('bob/other-unit/query', request)
              : await apiClient.postContract('bob/sales-partner/query', request)
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

  async function searchOperatingEntities(keyword: string): Promise<void> {
    if (!supportsOperatingEntityFilter) return
    operatingEntityLoading.value = true
    operatingEntityErrorMessage.value = null
    try {
      const { data } = await apiClient.postContract(
        'bob/operating-entity/query',
        {
          page: 1,
          pageSize: 20,
          filters: {
            enabled: true,
            ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          },
          sort: [{ field: 'code', order: 'asc' }],
        },
      )
      operatingEntityOptions.value = data.items.map((item) => ({
        value: item.objectId,
        title: formatReferenceLabel({ code: item.code, name: item.data.name }),
      }))
    } catch (error) {
      operatingEntityOptions.value = []
      operatingEntityErrorMessage.value = getErrorMessage(error)
    } finally {
      operatingEntityLoading.value = false
    }
  }

  async function search() {
    page.value = 1
    await query()
  }

  async function changePage(next: number) {
    if (next >= 1 && next !== page.value && !loading.value) {
      page.value = next
      await query()
    }
  }

  async function changeSort(next: BusinessObjectSort) {
    sort.value = next
    await search()
  }

  async function resetFilters() {
    keyword.value = ''
    enabled.value = ''
    operatingEntityId.value = ''
    sort.value = { field: 'code', order: 'asc' }
    await search()
  }

  async function openView(row: Pick<TypedListItem, 'objectId'>) {
    if (!canView.value || editorLoading.value) return
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const request = { objectId: row.objectId }
      const { data } =
        entity === 'employee'
          ? await apiClient.postContract('bob/employee/get', request)
          : entity === 'supplier'
            ? await apiClient.postContract('bob/supplier/get', request)
            : entity === 'other-unit'
              ? await apiClient.postContract('bob/other-unit/get', request)
              : await apiClient.postContract('bob/sales-partner/get', request)
      if (!data) throw new Error('当前有效资料不存在。')
      currentView.value = data
      drawerOpen.value = true
    } catch (error) {
      currentView.value = null
      drawerOpen.value = false
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }

  return {
    rows,
    currentView,
    loading,
    editorLoading,
    operatingEntityLoading,
    errorMessage,
    editorErrorMessage,
    operatingEntityErrorMessage,
    page,
    pageSize,
    total,
    keyword,
    enabled,
    operatingEntityId,
    operatingEntityOptions,
    sort,
    drawerOpen,
    canView,
    supportsOperatingEntityFilter,
    query,
    search,
    searchOperatingEntities,
    changePage,
    changeSort,
    resetFilters,
    openView,
    openById: (objectId: string) => openView({ objectId }),
    closeEditor: () => {
      drawerOpen.value = false
      currentView.value = null
      editorErrorMessage.value = null
    },
  }
}

export function archiveOperatingSnapshots(view: TypedView): string {
  const data = view.data
  return 'currentOperatingEntity' in data
    ? `${data.currentOperatingEntity.code} · ${data.currentOperatingEntity.name}`
    : data.operatingEntities
        .map((item) => `${item.code} · ${item.name}`)
        .join('、') || '—'
}
