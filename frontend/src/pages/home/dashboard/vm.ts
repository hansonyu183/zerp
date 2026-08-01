import { computed, reactive, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { apiClient } from '@/api/client'
import {
  approveBusinessObject,
  rejectBusinessObject,
  submitBusinessObject,
} from '@/api/bob'
import { getErrorMessage, type PageResult } from '@/api/types'
import { approveVoucher, checkVoucher, finalizeVoucher } from '@/api/vou'

export type WorkbenchCategory = components['schemas']['WorkbenchCategory']
export type WorkbenchAction = components['schemas']['WorkbenchAction']
export type WorkbenchPendingStage =
  components['schemas']['WorkbenchPendingStage']
export type WorkbenchObjectItem = components['schemas']['WorkbenchObjectItem']
export type WorkbenchDocumentItem =
  components['schemas']['WorkbenchDocumentItem']
export type WorkbenchItem = WorkbenchObjectItem | WorkbenchDocumentItem

interface WorkbenchListState {
  rows: WorkbenchItem[]
  total: number
  page: number
  pageSize: number
  keyword: string
  entities: string[]
  pendingStages: WorkbenchPendingStage[]
  loading: boolean
  loaded: boolean
  errorMessage: string | null
}

function emptyState(): WorkbenchListState {
  return {
    rows: [],
    total: 0,
    page: 1,
    pageSize: 20,
    keyword: '',
    entities: [],
    pendingStages: [],
    loading: false,
    loaded: false,
    errorMessage: null,
  }
}

export function useDashboardViewModel() {
  const activeCategory = ref<WorkbenchCategory>('BOB')
  const states = reactive<Record<WorkbenchCategory, WorkbenchListState>>({
    BOB: emptyState(),
    VOU: emptyState(),
  })
  const actionLoading = ref<string | null>(null)
  const activeState = computed(() => states[activeCategory.value])

  async function query(
    category: WorkbenchCategory = activeCategory.value,
    resetPage = false,
  ): Promise<void> {
    const state = states[category]
    if (resetPage) state.page = 1
    state.loading = true
    state.errorMessage = null
    try {
      const { data } = await apiClient.post<
        PageResult<WorkbenchItem>,
        components['schemas']['WorkbenchQueryRequest']
      >('app/workbench/query', {
        category,
        ...(state.keyword.trim() ? { keyword: state.keyword.trim() } : {}),
        ...(state.entities.length ? { entities: state.entities } : {}),
        ...(state.pendingStages.length
          ? { pendingStages: state.pendingStages }
          : {}),
        page: state.page,
        pageSize: state.pageSize,
      })
      state.rows = data.items ?? []
      state.total = data.total ?? 0
      state.page = data.page ?? state.page
      state.pageSize = data.pageSize ?? state.pageSize
      state.loaded = true
    } catch (error) {
      state.rows = []
      state.total = 0
      state.errorMessage = getErrorMessage(error)
    } finally {
      state.loading = false
    }
  }

  async function selectCategory(category: WorkbenchCategory): Promise<void> {
    activeCategory.value = category
    if (!states[category].loaded) await query(category)
  }

  async function changePage(page: number): Promise<void> {
    const state = activeState.value
    if (page < 1 || page === state.page || state.loading) return
    state.page = page
    await query()
  }

  async function resetFilters(): Promise<void> {
    const state = activeState.value
    state.keyword = ''
    state.entities = []
    state.pendingStages = []
    await query(activeCategory.value, true)
  }

  async function runAction(
    item: WorkbenchItem,
    action: Exclude<WorkbenchAction, 'view' | 'edit'>,
    comment = '',
  ): Promise<boolean> {
    if (!item.availableActions.includes(action) || actionLoading.value) {
      return false
    }
    const category = item.category
    const state = states[category]
    actionLoading.value = `${action}:${item.category === 'BOB' ? item.objectId : item.documentId}`
    state.errorMessage = null
    try {
      if (item.category === 'BOB') {
        const request = {
          objectId: item.objectId,
          versionId: item.versionId,
          revision: item.revision,
        }
        if (action === 'submit') {
          await submitBusinessObject(item.entity, request)
        } else if (action === 'approve') {
          await approveBusinessObject(item.entity, request)
        } else if (action === 'reject') {
          await rejectBusinessObject(item.entity, {
            ...request,
            comment: comment.trim(),
          })
        }
      } else {
        const request = {
          documentId: item.documentId,
          revision: item.revision,
        }
        if (action === 'check') {
          await checkVoucher(item.entity, request)
        } else if (action === 'approve') {
          await approveVoucher(item.entity, request)
        } else if (action === 'finalize') {
          await finalizeVoucher(item.entity, request)
        }
      }
      if (state.rows.length === 1 && state.page > 1) state.page -= 1
      await query(category)
      return true
    } catch (error) {
      const message = getErrorMessage(error)
      await query(category)
      state.errorMessage = message
      return false
    } finally {
      actionLoading.value = null
    }
  }

  return {
    activeCategory,
    states,
    activeState,
    actionLoading,
    query,
    selectCategory,
    changePage,
    resetFilters,
    runAction,
  }
}

export type DashboardViewModel = ReturnType<typeof useDashboardViewModel>
