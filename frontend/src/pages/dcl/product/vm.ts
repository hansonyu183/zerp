import { computed, ref } from 'vue'
import type { BusinessObjectSort } from '@/components/business-object'
import { getErrorMessage } from '@/api/types'
import { useBobReferences } from '@/pages/bob/shared/references'
import { useSessionStore } from '@/stores/session'
import {
  dclDeclarationLifecycleSuccessLabel,
  useDclDeclarationActionAvailability,
  useDclDeclarationHistory,
  useDclDeclarationLifecycle,
} from '../shared/declaration'
import { dclProductConfig } from './config'
import { validateDclProductConfiguration } from './product-data'
import {
  createDclProduct,
  dclProductCreateData,
  dclProductFormFromView,
  dclProductHistoryPort,
  dclProductLifecyclePort,
  dclProductSaveData,
  deleteDclProduct,
  getDclProduct,
  queryDclProducts,
  saveDclProduct,
} from './data'
import { dclProductActiveVersion } from './types'
import type {
  DclProductAuditEvent,
  DclProductForm,
  DclProductListItem,
  DclProductVersionView,
  DclProductView,
} from './types'

export function useDclProductViewModel() {
  const session = useSessionStore()
  const config = dclProductConfig
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<DclProductListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const sort = ref<BusinessObjectSort>({ field: 'code', order: 'asc' })
  const filters = ref<Record<string, unknown>>(emptyFilters())
  const drawerOpen = ref(false)
  const editorMode = ref<'create' | 'edit' | 'view'>('view')
  const editorModel = ref<DclProductForm>(config.emptyForm())
  const editorResetKey = ref(0)
  const editContext = ref<{
    objectId: string
    approvalEntryId: string
    approvalRevision: number
  } | null>(null)
  const currentView = ref<DclProductView | null>(null)
  const effectiveView = ref<DclProductView | null>(null)
  const canLoadEditorReferences = computed(() =>
    [
      '/aux/product-type/query',
      '/aux/measurement-unit/query',
      '/aux/product-category/query',
    ].every((path) => session.can(path)),
  )
  const canCreate = computed(
    () => session.can('/dcl/product/create') && canLoadEditorReferences.value,
  )
  const canEdit = computed(
    () => session.can('/dcl/product/save') && canLoadEditorReferences.value,
  )
  const editorTitle = computed(() =>
    editorMode.value === 'create'
      ? '新增产品申报'
      : editorMode.value === 'edit'
        ? '编辑产品申报'
        : '产品申报详情',
  )
  const {
    editorFields,
    hydrateReferences,
    preloadEditorReferences,
    searchEditorReference,
    searchFilterReference,
    filterReferenceOptions,
    filterReferenceLoading,
    filterReferenceError,
  } = useBobReferences(config, editorMode, filters)
  const {
    permission,
    actionAvailability: baseActionAvailability,
    actionBlockedReason,
  } = useDclDeclarationActionAvailability(
    'product',
    (row: DclProductListItem) => {
      const approval = dclProductActiveVersion(row).approval
      return {
        status: approval.status,
        versionNo: approval.versionNo,
        submittedBy: approval.submittedBy,
        enabled: row.enabled,
        hasOpenVersion: row.openVersion !== null,
        hasLatestApproved: row.latestApproved !== null,
      }
    },
    () => session.user?.id,
    (path) => session.can(path),
  )
  function actionAvailability(row: Readonly<DclProductListItem>) {
    const availability = baseActionAvailability(row)
    if (availability.edit) availability.edit = canEdit.value
    return availability
  }
  function hasAnyAction(row: Readonly<DclProductListItem>): boolean {
    return Object.values(actionAvailability(row)).some(Boolean)
  }
  const history = useDclDeclarationHistory<
    DclProductListItem,
    DclProductVersionView,
    DclProductAuditEvent
  >(
    errorMessage,
    (row) => actionAvailability(row).versions,
    (row) => actionAvailability(row).audit,
    dclProductHistoryPort,
  )

  function emptyFilters(): Record<string, unknown> {
    return Object.fromEntries(
      config.filters.map((field) => [field.key, field.multiple ? [] : '']),
    )
  }

  function buildQueryFilters(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    if (keyword.value.trim()) result.keyword = keyword.value.trim()
    for (const field of config.filters) {
      const value = filters.value[field.key]
      if (value !== '' && (!Array.isArray(value) || value.length)) {
        result[field.key] = value
      }
    }
    return result
  }

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryDclProducts({
        page: page.value,
        pageSize: pageSize.value,
        filters: buildQueryFilters(),
        sort: [{ ...sort.value }],
      })
      rows.value = result.items
      total.value = result.total
      page.value = result.page
      pageSize.value = result.pageSize
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

  async function changeSort(value: BusinessObjectSort): Promise<void> {
    sort.value = value
    await search()
  }

  async function resetFilters(): Promise<void> {
    keyword.value = ''
    filters.value = emptyFilters()
    sort.value = { field: 'code', order: 'asc' }
    await search()
  }

  async function loadEffectiveView(
    view: DclProductView,
    latestApprovedEntryId?: string,
  ): Promise<void> {
    effectiveView.value =
      view.approval.status !== 'APPROVED' && latestApprovedEntryId
        ? await getDclProduct(view.objectId, latestApprovedEntryId)
        : null
  }

  function openCreate(): void {
    if (!canCreate.value) return
    editorMode.value = 'create'
    editorModel.value = config.emptyForm()
    editContext.value = null
    currentView.value = null
    effectiveView.value = null
    editorErrorMessage.value = null
    editorResetKey.value += 1
    drawerOpen.value = true
    preloadEditorReferences(editorModel.value)
  }

  async function open(
    row: DclProductListItem,
    mode: 'view' | 'edit',
    approvalEntryId?: string,
  ): Promise<void> {
    if (
      editorLoading.value ||
      (mode === 'view'
        ? !session.can(permission('get'))
        : !actionAvailability(row).edit)
    )
      return
    editorMode.value = mode
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const view = await getDclProduct(row.objectId, approvalEntryId)
      currentView.value = view
      await loadEffectiveView(
        view,
        row.latestApproved?.approval.approvalEntryId,
      )
      editContext.value =
        mode === 'edit'
          ? {
              objectId: view.objectId,
              approvalEntryId: view.approval.approvalEntryId,
              approvalRevision: view.approval.revision,
            }
          : null
      editorModel.value = dclProductFormFromView(view)
      editorResetKey.value += 1
      drawerOpen.value = true
      if (mode === 'edit') preloadEditorReferences(editorModel.value)
      await hydrateReferences(editorModel.value)
    } catch (error) {
      drawerOpen.value = false
      currentView.value = null
      effectiveView.value = null
      editContext.value = null
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }

  const openView = (row: DclProductListItem, approvalEntryId?: string) =>
    open(row, 'view', approvalEntryId)
  const openEdit = (row: DclProductListItem) => open(row, 'edit')

  async function openById(
    objectId: string,
    requestedMode: 'view' | 'edit',
  ): Promise<void> {
    if (!session.can(permission('get')) || editorLoading.value) return
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const view = await getDclProduct(objectId)
      const editable =
        requestedMode === 'edit' &&
        (view.approval.status === 'DRAFT' ||
          view.approval.status === 'APPROVED') &&
        canEdit.value
      editorMode.value = editable ? 'edit' : 'view'
      currentView.value = view
      effectiveView.value = null
      editContext.value = editable
        ? {
            objectId: view.objectId,
            approvalEntryId: view.approval.approvalEntryId,
            approvalRevision: view.approval.revision,
          }
        : null
      editorModel.value = dclProductFormFromView(view)
      editorResetKey.value += 1
      drawerOpen.value = true
      if (editable) preloadEditorReferences(editorModel.value)
      await hydrateReferences(editorModel.value)
    } catch (error) {
      drawerOpen.value = false
      currentView.value = null
      effectiveView.value = null
      editContext.value = null
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }

  function closeEditor(): void {
    if (saving.value) return
    drawerOpen.value = false
    editorErrorMessage.value = null
    editContext.value = null
    currentView.value = null
    effectiveView.value = null
  }

  async function save(form: DclProductForm): Promise<boolean> {
    if (saving.value || editorMode.value === 'view') return false
    if (editorMode.value === 'create' ? !canCreate.value : !canEdit.value) {
      editorErrorMessage.value = '当前权限不足，无法保存产品申报。'
      return false
    }
    const data =
      editorMode.value === 'create'
        ? dclProductCreateData(form)
        : dclProductSaveData(form)
    if (!data.name?.trim()) {
      editorErrorMessage.value = '请输入产品名称。'
      return false
    }
    saving.value = true
    editorErrorMessage.value = null
    try {
      if (editorMode.value === 'create') {
        await createDclProduct(data)
      } else {
        const context = editContext.value
        if (!context) throw new Error('未加载可编辑的产品申报版本。')
        await saveDclProduct({
          objectId: context.objectId,
          approvalEntryId: context.approvalEntryId,
          approvalRevision: context.approvalRevision,
          enabled: currentView.value?.enabled ?? true,
          data,
        })
      }
      drawerOpen.value = false
      editContext.value = null
      currentView.value = null
      successMessage.value = '产品申报已保存。'
      await query()
      return true
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function checkCompleteness(row: DclProductListItem): Promise<boolean> {
    try {
      const issues = validateDclProductConfiguration(
        (await getDclProduct(row.objectId)).data,
      )
      if (issues.length === 0) return true
      errorMessage.value = `产品资料检查未通过：${issues.join('；')}`
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
    return false
  }

  async function submitObject(row: DclProductListItem): Promise<boolean> {
    if (!actionAvailability(row).submit || actionLoading.value) return false
    if (!(await checkCompleteness(row))) return false
    actionLoading.value = `submit:${row.objectId}`
    try {
      await dclProductLifecyclePort.run(row, 'submit', '')
      await query()
      successMessage.value = `${row.code} 已提交审核。`
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  async function deleteObject(row: DclProductListItem): Promise<boolean> {
    if (!actionAvailability(row).delete || actionLoading.value) return false
    actionLoading.value = `delete:${row.objectId}`
    try {
      await deleteDclProduct(row)
      if (rows.value.length === 1 && page.value > 1) page.value -= 1
      await query()
      successMessage.value = `${row.code} 已删除。`
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  const lifecycle = useDclDeclarationLifecycle(
    actionLoading,
    errorMessage,
    (row: DclProductListItem) => row.objectId,
    (row: DclProductListItem) => row.enabled,
    actionAvailability,
    dclProductLifecyclePort,
    query,
    (row, action) => {
      if (currentView.value?.objectId === row.objectId) closeEditor()
      successMessage.value = `${row.code} ${dclDeclarationLifecycleSuccessLabel(action)}。`
    },
  )

  async function review(
    row: DclProductListItem,
    action: 'approve' | 'reject',
    comment: string,
  ): Promise<boolean> {
    if (action === 'approve' && !(await checkCompleteness(row))) return false
    return lifecycle.review(row, action, comment)
  }

  return {
    config,
    loading,
    editorLoading,
    saving,
    actionLoading,
    errorMessage,
    successMessage,
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
    effectiveView,
    canCreate,
    editorTitle,
    editorFields,
    actionAvailability,
    actionBlockedReason,
    hasAnyAction,
    query,
    search,
    changePage,
    changeSort,
    resetFilters,
    openCreate,
    openView,
    openEdit,
    openById,
    closeEditor,
    save,
    deleteObject,
    submitObject,
    review,
    reverse: lifecycle.reverse,
    changeEnabled: lifecycle.changeEnabled,
    requestChangeEnabled: lifecycle.changeEnabled,
    searchEditorReference,
    searchFilterReference,
    filterReferenceOptions,
    filterReferenceLoading,
    filterReferenceError,
    ...history,
  }
}

export type DclProductViewModel = ReturnType<typeof useDclProductViewModel>
