import { computed, ref } from 'vue'
import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  dclDeclarationLifecycleSuccessLabel,
  useDclDeclarationActionAvailability,
  useDclDeclarationHistory,
  useDclDeclarationLifecycle,
} from '../shared/declaration'
import { dclOperatingEntityConfig } from './config'
import {
  dclOperatingEntityData,
  dclOperatingEntityFormFromView,
  dclOperatingEntityHistoryPort,
  dclOperatingEntityLifecyclePort,
  getDclOperatingEntity,
  queryDclOperatingEntities,
} from './data'
import {
  dclOperatingEntityActiveVersion,
  type DclOperatingEntityAuditEvent,
  type DclOperatingEntityEditContext,
  type DclOperatingEntityForm,
  type DclOperatingEntityListItem,
  type DclOperatingEntityVersionView,
  type DclOperatingEntityView,
} from './types'

type DclOperatingEntityMutation =
  components['schemas']['DclOperatingEntityMutation']

export function useDclOperatingEntityViewModel() {
  const session = useSessionStore()
  const config = dclOperatingEntityConfig
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<DclOperatingEntityListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const sort = ref<BusinessObjectSort>({ field: 'code', order: 'asc' })
  const filters = ref<Record<string, unknown>>(emptyFilters())
  const drawerOpen = ref(false)
  const editorMode = ref<'create' | 'edit' | 'view'>('view')
  const editorModel = ref<DclOperatingEntityForm>(config.emptyForm())
  const editorResetKey = ref(0)
  const editContext = ref<DclOperatingEntityEditContext | null>(null)
  const currentView = ref<DclOperatingEntityView | null>(null)
  const effectiveView = ref<DclOperatingEntityView | null>(null)

  const { permission, actionAvailability, actionBlockedReason, hasAnyAction } =
    useDclDeclarationActionAvailability(
      'operating-entity',
      operatingEntityActionState,
      () => session.user?.id,
      (path) => session.can(path),
    )
  const canCreate = computed(() => session.can(permission('create')))
  const editorTitle = computed(() => {
    if (editorMode.value === 'create') return '新增经营主体变更'
    if (editorMode.value === 'edit') return '编辑经营主体变更'
    return '经营主体变更详情'
  })
  const editorFields = computed(() => config.fields)
  const effectiveEditorModel = computed(() =>
    effectiveView.value
      ? dclOperatingEntityFormFromView(effectiveView.value)
      : config.emptyForm(),
  )

  const history = useDclDeclarationHistory<
    DclOperatingEntityListItem,
    DclOperatingEntityVersionView,
    DclOperatingEntityAuditEvent
  >(
    errorMessage,
    (row) => actionAvailability(row).versions,
    (row) => actionAvailability(row).audit,
    dclOperatingEntityHistoryPort,
  )

  function emptyFilters(): Record<string, unknown> {
    return Object.fromEntries(
      config.filters.map((field) => [field.key, field.multiple ? [] : '']),
    )
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
      const result = await queryDclOperatingEntities({
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

  async function getObject(
    row: Pick<DclOperatingEntityListItem, 'objectId'>,
    approvalEntryId?: string,
  ): Promise<DclOperatingEntityView> {
    return getDclOperatingEntity(row.objectId, approvalEntryId)
  }

  async function loadEffectiveView(
    view: DclOperatingEntityView,
    latestApprovedEntryId?: string,
  ): Promise<void> {
    effectiveView.value =
      view.approval.status !== 'APPROVED' && latestApprovedEntryId
        ? await getObject(view, latestApprovedEntryId)
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
  }

  async function openView(
    row: DclOperatingEntityListItem,
    approvalEntryId?: string,
  ): Promise<void> {
    if (!session.can(permission('get')) || editorLoading.value) return
    editorMode.value = 'view'
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const view = await getObject(row, approvalEntryId)
      currentView.value = view
      await loadEffectiveView(
        view,
        row.latestApproved?.approval.approvalEntryId,
      )
      editorModel.value = dclOperatingEntityFormFromView(view)
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

  async function openEdit(row: DclOperatingEntityListItem): Promise<void> {
    if (!actionAvailability(row).edit || editorLoading.value) return
    editorMode.value = 'edit'
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const approvalEntryId =
        dclOperatingEntityActiveVersion(row).approval.approvalEntryId
      const view = await getObject(row, approvalEntryId)
      currentView.value = view
      await loadEffectiveView(
        view,
        row.latestApproved?.approval.approvalEntryId,
      )
      editContext.value = {
        objectId: row.objectId,
        approvalEntryId,
        approvalRevision: view.approval.revision,
      }
      editorModel.value = dclOperatingEntityFormFromView(view)
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

  async function openById(
    objectId: string,
    requestedMode: 'view' | 'edit',
  ): Promise<void> {
    if (!session.can(permission('get')) || editorLoading.value) return
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const view = await getObject({ objectId })
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
      editorModel.value = dclOperatingEntityFormFromView(view)
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

  function closeEditor(): void {
    if (saving.value) return
    drawerOpen.value = false
    editorErrorMessage.value = null
    editContext.value = null
    currentView.value = null
    effectiveView.value = null
  }

  async function save(form: DclOperatingEntityForm): Promise<boolean> {
    if (saving.value || editorMode.value === 'view') return false
    const normalized = normalizeForm(form)
    if (!hasValue(normalized.name)) {
      editorErrorMessage.value = '请输入法定公司名称。'
      return false
    }
    saving.value = true
    editorErrorMessage.value = null
    try {
      let mutation: DclOperatingEntityMutation
      if (editorMode.value === 'create') {
        const result = await apiClient.postContract(
          'dcl/operating-entity/create',
          { data: dclOperatingEntityData(normalized) },
        )
        mutation = result.data
      } else {
        const context = editContext.value
        if (!context) throw new Error('未加载可编辑的经营主体变更版本。')
        const result = await apiClient.postContract(
          'dcl/operating-entity/save',
          {
            objectId: context.objectId,
            approvalEntryId: context.approvalEntryId,
            approvalRevision: context.approvalRevision,
            enabled: currentView.value?.enabled ?? true,
            data: dclOperatingEntityData(normalized),
          },
        )
        mutation = result.data
      }
      drawerOpen.value = false
      editContext.value = null
      currentView.value = null
      successMessage.value = '经营主体变更已保存。'
      await query()
      return Boolean(mutation.objectId)
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function runRowAction(
    row: DclOperatingEntityListItem,
    action: 'delete' | 'submit',
  ): Promise<boolean> {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${row.objectId}`
    errorMessage.value = null
    try {
      const version = dclOperatingEntityActiveVersion(row).approval
      const request = {
        objectId: row.objectId,
        approvalEntryId: version.approvalEntryId,
        approvalRevision: version.revision,
      }
      if (action === 'delete') {
        await apiClient.postContract('dcl/operating-entity/delete', request)
      } else {
        await dclOperatingEntityLifecyclePort.run(row, 'submit', '')
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
    (row) => row.objectId,
    (row) => row.enabled,
    actionAvailability,
    dclOperatingEntityLifecyclePort,
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
    ...history,
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
    deleteObject: (row: DclOperatingEntityListItem) =>
      runRowAction(row, 'delete'),
    submitObject: (row: DclOperatingEntityListItem) =>
      runRowAction(row, 'submit'),
    review: lifecycle.review,
    reverse: lifecycle.reverse,
    changeEnabled: lifecycle.changeEnabled,
    requestChangeEnabled: lifecycle.changeEnabled,
  }
}

function operatingEntityActionState(row: Readonly<DclOperatingEntityListItem>) {
  const version = dclOperatingEntityActiveVersion(row).approval
  return {
    status: version.status,
    versionNo: version.versionNo,
    submittedBy: version.submittedBy,
    enabled: row.enabled,
    hasOpenVersion: row.openVersion !== null,
    hasLatestApproved: row.latestApproved !== null,
  }
}

function hasValue(value: unknown): boolean {
  return !(
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function normalizeForm(form: DclOperatingEntityForm): DclOperatingEntityForm {
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    shortName: form.shortName.trim(),
    taxNumber: form.taxNumber.trim().toUpperCase(),
    address: form.address.trim(),
    phone: form.phone.trim(),
    remark: form.remark.trim(),
  }
}

export type DclOperatingEntityViewModel = ReturnType<
  typeof useDclOperatingEntityViewModel
>
