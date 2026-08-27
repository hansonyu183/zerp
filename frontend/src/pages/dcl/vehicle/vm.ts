import { computed, ref } from 'vue'
import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  dclDeclarationLifecycleSuccessLabel,
  useDclDeclarationActionAvailability,
  useDclDeclarationHistory,
  useDclDeclarationLifecycle,
} from '../shared/declaration'
import { dclVehicleConfig } from './config'
import {
  dclVehicleData,
  dclVehicleFormFromView,
  dclVehicleHistoryPort,
  getDclVehicle,
  queryDclVehicles,
  runDclVehicleLifecycle,
} from './data'
import {
  dclVehicleActiveVersion,
  type DclVehicleEditContext,
  type DclVehicleForm,
  type DclVehicleListItem,
  type DclVehicleView,
} from './types'
import { useDclVehicleReferences } from './references'

export function useDclVehicleViewModel() {
  const session = useSessionStore()
  const config = dclVehicleConfig
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<DclVehicleListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const sort = ref<BusinessObjectSort>({ field: 'code', order: 'asc' })
  const filters = ref<Record<string, unknown>>({ status: [], enabled: '' })
  const drawerOpen = ref(false)
  const editorMode = ref<'create' | 'edit' | 'view'>('view')
  const editorModel = ref<DclVehicleForm>(dclVehicleConfig.emptyForm())
  const editorResetKey = ref(0)
  const currentView = ref<DclVehicleView | null>(null)
  const effectiveView = ref<DclVehicleView | null>(null)
  const editContext = ref<DclVehicleEditContext | null>(null)
  const {
    permission,
    actionAvailability: baseActionAvailability,
    actionBlockedReason,
  } =
    useDclDeclarationActionAvailability(
      'vehicle',
      (row: DclVehicleListItem) => {
        const version = dclVehicleActiveVersion(row).approval
        return {
          status: version.status,
          versionNo: version.versionNo,
          submittedBy: version.submittedBy,
          enabled: row.enabled,
          hasOpenVersion: row.openVersion !== null,
          hasLatestApproved: row.latestApproved !== null,
        }
      },
      () => session.user?.id,
      (path) => session.can(path),
    )
  const references = useDclVehicleReferences(config)
  const canCreate = computed(
    () =>
      session.can(permission('create')) &&
      session.can('/aux/dictionary-item/query') &&
      session.can('/bob/operating-entity/query'),
  )
  function actionAvailability(row: Readonly<DclVehicleListItem>) {
    const availability = baseActionAvailability(row)
    if (availability.edit) {
      const carrierType = dclVehicleActiveVersion(row).data.carrierAffiliation.type
      availability.edit =
        session.can('/aux/dictionary-item/query') &&
        session.can(
          carrierType === 'INTERNAL'
            ? '/bob/operating-entity/query'
            : '/bob/other-unit/query',
        )
    }
    return availability
  }
  function hasAnyAction(row: Readonly<DclVehicleListItem>): boolean {
    return Object.values(actionAvailability(row)).some(Boolean)
  }
  const editorTitle = computed(() =>
    editorMode.value === 'create'
      ? '新增车辆申报'
      : editorMode.value === 'edit'
        ? '编辑车辆申报'
        : '车辆申报详情',
  )
  const history = useDclDeclarationHistory(
    errorMessage,
    (row: DclVehicleListItem) => actionAvailability(row).versions,
    (row: DclVehicleListItem) => actionAvailability(row).audit,
    dclVehicleHistoryPort,
  )
  const editorFields = references.editorFields
  const effectiveEditorModel = computed(() =>
    effectiveView.value
      ? dclVehicleFormFromView(effectiveView.value)
      : config.emptyForm(),
  )

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const currentFilters: Record<string, unknown> = {}
      if (keyword.value.trim()) currentFilters.keyword = keyword.value.trim()
      for (const [key, value] of Object.entries(filters.value))
        if (value !== '' && (!Array.isArray(value) || value.length))
          currentFilters[key] = value
      const result = await queryDclVehicles({
        page: page.value,
        pageSize: pageSize.value,
        filters: currentFilters,
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
  async function search() {
    page.value = 1
    await query()
  }
  async function changePage(next: number) {
    if (next > 0 && next !== page.value && !loading.value) {
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
    filters.value = { status: [], enabled: '' }
    sort.value = { field: 'code', order: 'asc' }
    await search()
  }

  function openCreate() {
    if (!canCreate.value) return
    editorMode.value = 'create'
    editorModel.value = dclVehicleConfig.emptyForm()
    currentView.value = null
    effectiveView.value = null
    editContext.value = null
    editorErrorMessage.value = null
    editorResetKey.value += 1
    drawerOpen.value = true
    references.preloadReferences(editorModel.value)
  }
  async function openView(
    row: DclVehicleListItem,
    approvalEntryId?: string,
  ) {
    await open(row, 'view', approvalEntryId)
  }
  async function openEdit(row: DclVehicleListItem) {
    await open(row, 'edit')
  }
  async function open(
    row: DclVehicleListItem,
    mode: 'view' | 'edit',
    requestedApprovalEntryId?: string,
  ) {
    if (!session.can(permission('get')) || editorLoading.value) return
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const approvalEntryId =
        requestedApprovalEntryId ??
        (mode === 'edit'
          ? dclVehicleActiveVersion(row).approval.approvalEntryId
          : undefined)
      const view = await getDclVehicle(row.objectId, approvalEntryId)
      editorMode.value =
        mode === 'edit' && actionAvailability(row).edit ? 'edit' : 'view'
      currentView.value = view
      effectiveView.value =
        view.approval.status !== 'APPROVED' &&
        row.latestApproved?.approval.approvalEntryId
          ? await getDclVehicle(
              row.objectId,
              row.latestApproved.approval.approvalEntryId,
            )
          : null
      editContext.value =
        editorMode.value === 'edit'
          ? {
              objectId: view.objectId,
              approvalEntryId: view.approval.approvalEntryId,
              approvalRevision: view.approval.revision,
            }
          : null
      editorModel.value = dclVehicleFormFromView(view)
      references.preloadReferences(editorModel.value)
      editorResetKey.value += 1
      drawerOpen.value = true
    } catch (error) {
      drawerOpen.value = false
      currentView.value = null
      effectiveView.value = null
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }
  async function openById(
    objectId: string,
    requestedMode: 'view' | 'edit',
  ): Promise<void> {
    if (!session.can(permission('get')) || editorLoading.value) return
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const view = await getDclVehicle(objectId)
      const editable =
        requestedMode === 'edit' &&
        view.approval.status === 'DRAFT' &&
        session.can(permission('save'))
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
      editorModel.value = dclVehicleFormFromView(view)
      references.preloadReferences(editorModel.value)
      editorResetKey.value += 1
      drawerOpen.value = true
    } catch (error) {
      drawerOpen.value = false
      editContext.value = null
      currentView.value = null
      effectiveView.value = null
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }
  function closeEditor() {
    if (!saving.value) {
      drawerOpen.value = false
      currentView.value = null
      effectiveView.value = null
      editContext.value = null
    }
  }
  async function save(form: DclVehicleForm): Promise<boolean> {
    if (saving.value || editorMode.value === 'view') return false
    if (
      !form.name.trim() ||
      !form.plateNumber.trim() ||
      !form.vehicleType.trim() ||
      (form.carrierType === 'INTERNAL'
        ? !form.carrierOperatingEntityId.trim()
        : !form.carrierServiceRelationshipObjectId.trim())
    ) {
      editorErrorMessage.value = '请完整填写车辆名称、车牌、车型和承运归属。'
      return false
    }
    saving.value = true
    editorErrorMessage.value = null
    try {
      const data = dclVehicleData(form)
      if (editorMode.value === 'create') {
        await apiClient.postContract('dcl/vehicle/create', { data })
      } else {
        const context = editContext.value
        if (!context) throw new Error('未加载可编辑的车辆申报版本。')
        await apiClient.postContract('dcl/vehicle/save', {
          ...context,
          enabled: currentView.value?.enabled ?? true,
          data,
        })
      }
      drawerOpen.value = false
      currentView.value = null
      effectiveView.value = null
      editContext.value = null
      successMessage.value = '车辆申报已保存。'
      await query()
      return true
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }
  async function runRowAction(
    row: DclVehicleListItem,
    action: 'delete' | 'submit',
  ): Promise<boolean> {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${row.objectId}`
    errorMessage.value = null
    try {
      if (action === 'delete') {
        const approval = dclVehicleActiveVersion(row).approval
        await apiClient.postContract('dcl/vehicle/delete', {
          objectId: row.objectId,
          approvalEntryId: approval.approvalEntryId,
          approvalRevision: approval.revision,
        })
      } else {
        await runDclVehicleLifecycle(row, 'submit', '')
      }
      if (action === 'delete' && rows.value.length === 1 && page.value > 1) {
        page.value -= 1
      }
      await query()
      if (currentView.value?.objectId === row.objectId) closeEditor()
      successMessage.value =
        action === 'delete'
          ? `${row.code} 已删除。`
          : `${row.code} 已提交审核。`
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
    (row: DclVehicleListItem) => row.objectId,
    (row) => row.enabled,
    actionAvailability,
    {
      run: runDclVehicleLifecycle,
      changeEnabled: async (row) => {
        const view = await getDclVehicle(
          row.objectId,
          row.latestApproved?.approval.approvalEntryId,
        )
        await apiClient.postContract('dcl/vehicle/save', {
          objectId: view.objectId,
          approvalEntryId: view.approval.approvalEntryId,
          approvalRevision: view.approval.revision,
          enabled: !row.enabled,
          data: view.data,
        })
      },
    },
    query,
    (row, action) => {
      if (currentView.value?.objectId === row.objectId) closeEditor()
      successMessage.value = `${row.code} ${dclDeclarationLifecycleSuccessLabel(action)}。`
    },
  )
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
    effectiveEditorModel,
    searchEditorReference: references.searchEditorReference,
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
    deleteObject: (row: DclVehicleListItem) => runRowAction(row, 'delete'),
    submitObject: (row: DclVehicleListItem) => runRowAction(row, 'submit'),
    ...history,
    ...lifecycle,
  }
}
