import { computed, ref } from 'vue'
import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { bobFormFromView, hasValue } from './form-data'
import { useBobReferences } from './references'
import type {
  BobEntityConfig,
  BobForm,
  BobListItem,
  BobObjectView,
} from './types'

export function useBobEntityViewModel(config: BobEntityConfig) {
  const session = useSessionStore()
  const loading = ref(false)
  const editorLoading = ref(false)
  const errorMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<BobListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const sort = ref<BusinessObjectSort>({ field: 'code', order: 'asc' })
  const filters = ref<Record<string, unknown>>(
    Object.fromEntries(
      config.filters.map((field) => [
        field.key,
        field.multiple ? [] : field.type === 'switch' ? false : '',
      ]),
    ),
  )
  const drawerOpen = ref(false)
  const editorMode = ref<'create' | 'edit' | 'view'>('view')
  const editorModel = ref<BobForm>(config.emptyForm())
  const editorResetKey = ref(0)
  const currentView = ref<BobObjectView | null>(null)
  const editorTitle = computed(() => `${config.title}详情`)
  const {
    editorFields,
    hydrateReferences,
    searchEditorReference,
    searchFilterReference,
    filterReferenceOptions,
    filterReferenceLoading,
    filterReferenceError,
  } = useBobReferences(config, editorMode, filters)

  function canView(): boolean {
    return session.can(`/bob/${config.entity}/get`)
  }

  function buildQueryFilters(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const queryValue = keyword.value.trim()
    if (queryValue) result.keyword = queryValue
    for (const field of config.filters) {
      const value = filters.value[field.key]
      if (
        hasValue(value) ||
        (field.key === 'enabled' && typeof value === 'boolean')
      ) {
        result[field.key] = value
      }
    }
    return result
  }

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract(
        `bob/${config.entity}/query`,
        {
          page: page.value,
          pageSize: pageSize.value,
          filters: buildQueryFilters(),
          sort: [{ ...sort.value }],
        },
      )
      rows.value = (Array.isArray(data.items) ? data.items : []) as BobListItem[]
      total.value =
        typeof data.total === 'number' ? data.total : rows.value.length
      page.value = typeof data.page === 'number' ? data.page : page.value
      pageSize.value =
        typeof data.pageSize === 'number' ? data.pageSize : pageSize.value
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

  async function changePage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === page.value || loading.value) return
    page.value = nextPage
    await query()
  }

  async function resetFilters(): Promise<void> {
    keyword.value = ''
    filters.value = Object.fromEntries(
      config.filters.map((field) => [
        field.key,
        field.multiple ? [] : field.type === 'switch' ? false : '',
      ]),
    )
    sort.value = { field: 'code', order: 'asc' }
    await search()
  }

  async function changeSort(value: BusinessObjectSort): Promise<void> {
    sort.value = value
    await search()
  }

  async function getObject(
    row: Pick<BobListItem, 'objectId'>,
  ): Promise<BobObjectView> {
    const { data } = await apiClient.postContract(`bob/${config.entity}/get`, {
      objectId: row.objectId,
    })
    return data as BobObjectView
  }

  async function openView(row: Pick<BobListItem, 'objectId'>): Promise<void> {
    if (!canView() || editorLoading.value) return
    editorMode.value = 'view'
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const view = await getObject(row)
      currentView.value = view
      editorModel.value = bobFormFromView(config, view)
      editorResetKey.value += 1
      drawerOpen.value = true
      await hydrateReferences(editorModel.value)
    } catch (error) {
      drawerOpen.value = false
      currentView.value = null
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }

  async function openById(
    objectId: string,
    _requestedMode: 'view' | 'edit',
  ): Promise<void> {
    await openView({ objectId })
  }

  function closeEditor(): void {
    drawerOpen.value = false
    editorErrorMessage.value = null
    currentView.value = null
  }

  return {
    config,
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
    filters,
    drawerOpen,
    editorMode,
    editorModel,
    editorResetKey,
    currentView,
    editorTitle,
    editorFields,
    canView,
    query,
    search,
    changePage,
    changeSort,
    resetFilters,
    openView,
    openById,
    closeEditor,
    searchEditorReference,
    searchFilterReference,
    filterReferenceOptions,
    filterReferenceLoading,
    filterReferenceError,
  }
}

export type BobEntityViewModel = ReturnType<typeof useBobEntityViewModel>
