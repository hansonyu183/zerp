import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { apiClient } from '@/api/client'
import {
  approveBusinessObject,
  rejectBusinessObject,
  submitBusinessObject,
  unsubmitBusinessObject,
} from '@/api/bob'
import { isDclDeclarationEntity } from '@/pages/dcl/shared/declaration'
import { runDclOperatingEntityAction } from '@/pages/dcl/operating-entity/data'
import { runDclWarehouseAction } from '@/pages/dcl/warehouse/data'
import { runDclVehicleAction } from '@/pages/dcl/vehicle/data'
import { runDclFundAccountAction } from '@/pages/dcl/fund-account/data'
import { runDclProductAction } from '@/pages/dcl/product/data'
import { getDiagnosticErrorMessage, getErrorMessage } from '@/api/types'
import { approveVoucher, submitVoucher, unsubmitVoucher } from '@/api/vou'

export type WorkbenchCategory = components['schemas']['WorkbenchCategory']
export type WorkbenchAction = components['schemas']['WorkbenchAction']
export type WorkbenchPendingStage =
  components['schemas']['WorkbenchPendingStage']
export type WorkbenchObjectItem = components['schemas']['WorkbenchObjectItem']
export type WorkbenchDocumentItem =
  components['schemas']['WorkbenchDocumentItem']
export type WorkbenchItem = WorkbenchObjectItem | WorkbenchDocumentItem
export type WorkbenchConfirmationAction = Extract<
  WorkbenchAction,
  'reject' | 'unsubmit'
>

export function workbenchItemPath(item: WorkbenchItem): string {
  if (item.category === 'VOU') return `/vou/${item.entity}`
  return isDclDeclarationEntity(item.entity)
    ? `/dcl/${item.entity}`
    : `/bob/${item.entity}`
}

interface WorkbenchListState {
  rows: WorkbenchItem[]
  total: number
  page: number
  pageSize: number
  keyword: string
  entities: string[]
  pendingStages: WorkbenchPendingStage[]
  appliedKeyword: string
  appliedEntities: string[]
  appliedPendingStages: WorkbenchPendingStage[]
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
    appliedKeyword: '',
    appliedEntities: [],
    appliedPendingStages: [],
    loading: false,
    loaded: false,
    errorMessage: null,
  }
}

export function useDashboardViewModel() {
  const activeCategory = ref<WorkbenchCategory>('VOU')
  const states = reactive<Record<WorkbenchCategory, WorkbenchListState>>({
    BOB: emptyState(),
    VOU: emptyState(),
  })
  const actionLoading = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const confirmationTarget = ref<WorkbenchItem | null>(null)
  const confirmationAction = ref<WorkbenchConfirmationAction | null>(null)
  const confirmationComment = ref('')
  const activeState = computed(() => states[activeCategory.value])
  const requestSequences: Record<WorkbenchCategory, number> = { BOB: 0, VOU: 0 }
  let disposed = false

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
    })
  }

  async function query(
    category: WorkbenchCategory = activeCategory.value,
  ): Promise<boolean> {
    return queryCurrent(category)
  }

  async function queryCurrent(
    category: WorkbenchCategory,
    correctedPage = false,
  ): Promise<boolean> {
    const state = states[category]
    const requestId = ++requestSequences[category]
    const requestPage = state.page
    const keyword = state.appliedKeyword
    const entities = [...state.appliedEntities]
    const pendingStages = [...state.appliedPendingStages]
    state.loading = true
    state.errorMessage = null
    try {
      const { data } = await apiClient.postContract('app/workbench/query', {
        category,
        ...(keyword ? { keyword } : {}),
        ...(entities.length ? { entities } : {}),
        ...(pendingStages.length ? { pendingStages } : {}),
        page: requestPage,
        pageSize: 20,
      })
      if (disposed || requestId !== requestSequences[category]) return false

      const total = data.total ?? 0
      const lastPage = Math.max(1, Math.ceil(total / 20))
      const responsePage = data.page ?? requestPage
      state.total = total
      state.pageSize = 20
      if (responsePage > lastPage && !correctedPage) {
        state.page = lastPage
        return queryCurrent(category, true)
      }
      state.rows = data.items ?? []
      state.page = total === 0 ? 1 : Math.min(responsePage, lastPage)
      state.loaded = true
      return true
    } catch (error) {
      if (disposed || requestId !== requestSequences[category]) return false
      state.errorMessage = getErrorMessage(error)
      return false
    } finally {
      if (!disposed && requestId === requestSequences[category]) {
        state.loading = false
      }
    }
  }

  async function applyFilters(
    category: WorkbenchCategory = activeCategory.value,
  ): Promise<boolean> {
    const state = states[category]
    state.appliedKeyword = state.keyword.trim()
    state.appliedEntities = [...state.entities]
    state.appliedPendingStages = [...state.pendingStages]
    state.page = 1
    return queryCurrent(category)
  }

  async function selectCategory(category: WorkbenchCategory): Promise<void> {
    activeCategory.value = category
    await query(category)
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
    state.appliedKeyword = ''
    state.appliedEntities = []
    state.appliedPendingStages = []
    state.page = 1
    await queryCurrent(activeCategory.value)
  }

  async function runAction(
    item: WorkbenchItem,
    action: Exclude<WorkbenchAction, 'view' | 'edit'>,
    comment = '',
  ): Promise<boolean> {
    if (!item.availableActions.includes(action) || actionLoading.value) {
      return false
    }
    if (
      (action === 'reject' ||
        (item.category === 'BOB' && action === 'unsubmit')) &&
      !comment.trim()
    ) {
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
          approvalEntryId: item.versionId,
          approvalRevision: item.revision,
        }
        if (item.entity === 'operating-entity') {
          await runDclOperatingEntityAction(action, request, comment.trim())
        } else if (item.entity === 'warehouse') {
          await runDclWarehouseAction(action, request, comment.trim())
        } else if (item.entity === 'vehicle') {
          await runDclVehicleAction(action, request, comment.trim())
        } else if (item.entity === 'fund-account') {
          await runDclFundAccountAction(action, request, comment.trim())
        } else if (item.entity === 'product') {
          await runDclProductAction(action, request, comment.trim())
        } else if (action === 'submit') {
          await submitBusinessObject(item.entity, request)
        } else if (action === 'unsubmit') {
          await unsubmitBusinessObject(item.entity, request)
        } else if (action === 'approve') {
          await approveBusinessObject(item.entity, request)
        } else if (action === 'reject') {
          await rejectBusinessObject(item.entity, {
            ...request,
            reason: comment.trim(),
          })
        }
      } else {
        const request = {
          documentId: item.documentId,
          revision: item.revision,
        }
        if (action === 'submit') {
          await submitVoucher(item.entity, request)
        } else if (action === 'unsubmit') {
          await unsubmitVoucher(item.entity, request)
        } else if (action === 'approve') {
          await approveVoucher(item.entity, request)
        }
      }
      const refreshed = await query(category)
      if (!refreshed) return false
      const identity = item.category === 'BOB' ? item.code : item.documentNo
      const label = {
        submit: '已提交审核',
        unsubmit: '已撤回提交',
        approve: item.category === 'BOB' ? '已审核通过' : '已批准',
        reject: '已审核驳回',
      }[action]
      successMessage.value = `${identity} ${label}。`
      return true
    } catch (error) {
      const message = getDiagnosticErrorMessage(error)
      await query(category)
      state.errorMessage = message
      return false
    } finally {
      actionLoading.value = null
    }
  }

  function requestConfirmation(
    item: WorkbenchItem,
    action: WorkbenchConfirmationAction,
  ): boolean {
    const supported =
      (item.category === 'BOB' &&
        (action === 'reject' || action === 'unsubmit')) ||
      (item.category === 'VOU' && action === 'unsubmit')
    if (!supported || !item.availableActions.includes(action)) return false
    confirmationTarget.value = item
    confirmationAction.value = action
    confirmationComment.value = ''
    return true
  }

  function cancelConfirmation(): void {
    confirmationTarget.value = null
    confirmationAction.value = null
    confirmationComment.value = ''
  }

  async function confirmAction(): Promise<boolean> {
    const target = confirmationTarget.value
    const action = confirmationAction.value
    if (!target || !action) return false
    const succeeded = await runAction(target, action, confirmationComment.value)
    if (succeeded) cancelConfirmation()
    return succeeded
  }

  return {
    activeCategory,
    states,
    activeState,
    actionLoading,
    successMessage,
    confirmationTarget,
    confirmationAction,
    confirmationComment,
    query,
    applyFilters,
    selectCategory,
    changePage,
    resetFilters,
    runAction,
    requestConfirmation,
    cancelConfirmation,
    confirmAction,
  }
}

export type DashboardViewModel = ReturnType<typeof useDashboardViewModel>
