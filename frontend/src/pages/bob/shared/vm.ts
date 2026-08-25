import { computed, ref } from 'vue'
import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { comparableProductValue } from './product-data'
import {
  bobCreateData,
  bobFormFromView,
  bobSaveData,
  hasValue,
  normalizeBobForm,
} from './form-data'
import { useBobHistory } from './history'
import { bobLifecycleSuccessLabel, useBobLifecycleActions } from './lifecycle'
import { useBobReferences } from './references'
import {
  canLoadBobEditorReferences,
  useBobProductApproval,
} from './product-approval'
import type {
  BobEditContext,
  BobEntityConfig,
  BobForm,
  BobListItem,
  BobMutationResult,
  BobObjectView,
} from './types'
import { bobListActiveVersion } from './types'
import { useBobActionAvailability } from './action-availability'

export function useBobEntityViewModel(config: BobEntityConfig) {
  const session = useSessionStore()
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<BobListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const sort = ref<BusinessObjectSort>({
    field: 'code',
    order: 'asc',
  })
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
  const editContext = ref<BobEditContext | null>(null)
  const currentView = ref<BobObjectView | null>(null)
  const effectiveView = ref<BobObjectView | null>(null)

  const canLoadEditorReferences = computed(() =>
    canLoadBobEditorReferences(config.entity, (path) => session.can(path)),
  )
  const canCreate = computed(
    () =>
      session.can(`/bob/${config.entity}/create`) &&
      canLoadEditorReferences.value,
  )
  const editorTitle = computed(() => {
    if (editorMode.value === 'create') return `新增${config.title}`
    if (editorMode.value === 'edit') return `编辑${config.title}`
    return `${config.title}详情`
  })
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

  const { permission, actionAvailability, actionBlockedReason, hasAnyAction } =
    useBobActionAvailability(
      config.entity,
      () => session.user?.id,
      (path) => session.can(path),
      () => canLoadEditorReferences.value,
    )

  const {
    versionsOpen,
    versionsLoading,
    versions,
    versionsPage,
    versionsPageSize,
    versionsTotal,
    historyObject,
    auditOpen,
    auditLoading,
    auditEvents,
    auditPage,
    auditPageSize,
    auditTotal,
    openVersions,
    changeVersionsPage,
    openAudit,
    changeAuditPage,
  } = useBobHistory(
    config,
    errorMessage,
    (row) => actionAvailability(row).versions,
    (row) => actionAvailability(row).audit,
  )

  function buildQueryFilters(): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const query = keyword.value.trim()
    if (query) result.keyword = query

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
      const { data } = await apiClient.postContract(`bob/${config.entity}/query`, {
        page: page.value,
        pageSize: pageSize.value,
        filters: buildQueryFilters(),
        sort: [{ ...sort.value }],
      })
      rows.value = Array.isArray(data.items) ? data.items : []
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
    versionId?: string,
  ): Promise<BobObjectView> {
    const { data } = await apiClient.postContract(`bob/${config.entity}/get`, {
      objectId: row.objectId,
      ...(versionId ? { versionId } : {}),
    })
    return data
  }

  async function loadEffectiveView(view: BobObjectView): Promise<void> {
    effectiveView.value = null
    if (
      !view.effectiveVersionId ||
      view.effectiveVersionId === view.version.versionId
    ) {
      return
    }
    effectiveView.value = await getObject(
      { objectId: view.objectId },
      view.effectiveVersionId,
    )
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

  async function openView(row: BobListItem, versionId?: string): Promise<void> {
    if (!session.can(permission('get')) || editorLoading.value) return
    editorMode.value = 'view'
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const view = await getObject(row, versionId)
      currentView.value = view
      await loadEffectiveView(view)
      editorModel.value = bobFormFromView(config, view)
      editorResetKey.value += 1
      drawerOpen.value = true
      await hydrateReferences(editorModel.value)
    } catch (error) {
      drawerOpen.value = false
      currentView.value = null
      effectiveView.value = null
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }

  async function openEdit(row: BobListItem): Promise<void> {
    if (!actionAvailability(row).edit || editorLoading.value) return
    editorMode.value = 'edit'
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const versionId = bobListActiveVersion(row).versionId
      const view = await getObject(row, versionId)
      currentView.value = view
      await loadEffectiveView(view)
      editContext.value = {
        objectId: row.objectId,
        objectRevision: row.objectRevision,
        versionId,
        revision: view.version.revision ?? bobListActiveVersion(row).revision,
      }
      editorModel.value = bobFormFromView(config, view)
      editorResetKey.value += 1
      drawerOpen.value = true
      preloadEditorReferences(editorModel.value)
      await hydrateReferences(editorModel.value)
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
        (view.version.status === 'DRAFT' ||
          (config.entity === 'product' &&
            view.version.status === 'EFFECTIVE')) &&
        session.can(permission('save')) &&
        canLoadEditorReferences.value
      editorMode.value = editable ? 'edit' : 'view'
      currentView.value = view
      await loadEffectiveView(view)
      editContext.value = editable
        ? {
            objectId: view.objectId,
            objectRevision: view.objectRevision,
            versionId: view.version.versionId,
            revision: view.version.revision,
          }
        : null
      editorModel.value = bobFormFromView(config, view)
      editorResetKey.value += 1
      drawerOpen.value = true
      if (editable) preloadEditorReferences(editorModel.value)
      await hydrateReferences(editorModel.value)
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

  async function save(form: BobForm): Promise<boolean> {
    if (saving.value || editorMode.value === 'view') return false
    const normalized = normalizeBobForm(config, form)
    const missingRequiredKey = config.requiredKeys.find(
      (key) => !hasValue(normalized[key]),
    )
    if (missingRequiredKey) {
      const field = editorFields.value.find(
        (candidate) => candidate.key === missingRequiredKey,
      )
      editorErrorMessage.value = `请输入${field?.label ?? missingRequiredKey}。`
      return false
    }
    saving.value = true
    editorErrorMessage.value = null
    try {
      let mutation: BobMutationResult
      if (editorMode.value === 'create') {
        const result = await apiClient.postContract(`bob/${config.entity}/create`, { data: bobCreateData(config, form) })
        mutation = result.data
      } else {
        const context = editContext.value
        if (!context) throw new Error(`未加载可编辑的${config.title}版本。`)
        const result = await apiClient.postContract(`bob/${config.entity}/save`, {
          objectId: context.objectId,
          versionId: context.versionId,
          revision: context.revision,
          data: bobSaveData(config, form),
        })
        mutation = result.data
      }
      if ((config.persistedKeys?.length ?? 0) > 0) {
        const persisted = await getObject(
          { objectId: mutation.objectId },
          mutation.versionId,
        )
        const normalized = normalizeBobForm(config, form)
        const persistedData = Object.fromEntries(
          Object.entries(persisted.data),
        )
        const missing = config.persistedKeys?.find((key) => {
          if (
            config.entity === 'product' &&
            key === 'formula' &&
            normalized.formulaDirty !== true
          ) {
            return false
          }
          return (
            JSON.stringify(
              comparableProductValue(key, persistedData[key], true),
            ) !==
            JSON.stringify(comparableProductValue(key, normalized[key], false))
          )
        })
        if (missing) {
          const label =
            editorFields.value.find((field) => field.key === missing)?.label ??
            missing
          throw new Error(`后端尚未保存${label}，请确认 V2 契约已经部署。`)
        }
      }
      drawerOpen.value = false
      editContext.value = null
      currentView.value = null
      successMessage.value = `${config.title}已保存。`
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
    row: BobListItem,
    action: 'delete' | 'submit',
  ): Promise<boolean> {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${row.objectId}`
    errorMessage.value = null
    try {
      if (action === 'delete') {
        await apiClient.postContract(`bob/${config.entity}/delete`, {
          objectId: row.objectId,
          objectRevision: row.objectRevision,
          versionId: bobListActiveVersion(row).versionId,
          revision: bobListActiveVersion(row).revision,
        })
        if (rows.value.length === 1 && page.value > 1) page.value -= 1
      } else {
        if (!(await checkProductCompleteness(row))) return false
        await apiClient.postContract(
          `bob/${config.entity}/submit`,
          {
            objectId: row.objectId,
            versionId: bobListActiveVersion(row).versionId,
            revision: bobListActiveVersion(row).revision,
          },
        )
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

  async function deleteObject(row: BobListItem): Promise<boolean> {
    return runRowAction(row, 'delete')
  }

  async function submitObject(row: BobListItem): Promise<boolean> {
    return runRowAction(row, 'submit')
  }

  const {
    review: runLifecycleReview,
    reverse,
    changeEnabled,
  } = useBobLifecycleActions(
    config.entity,
    actionLoading,
    errorMessage,
    actionAvailability,
    query,
    (row, action) => {
      if (currentView.value?.objectId === row.objectId) closeEditor()
      successMessage.value = `${row.code} ${bobLifecycleSuccessLabel(action)}。`
    },
  )

  const { checkProductCompleteness, review } = useBobProductApproval(
    config.entity,
    errorMessage,
    getObject,
    runLifecycleReview,
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
    versionsOpen,
    versionsLoading,
    versions,
    versionsPage,
    versionsPageSize,
    versionsTotal,
    historyObject,
    auditOpen,
    auditLoading,
    auditEvents,
    auditPage,
    auditPageSize,
    auditTotal,
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
    reverse,
    changeEnabled,
    requestChangeEnabled: changeEnabled,
    searchEditorReference,
    searchFilterReference,
    filterReferenceOptions,
    filterReferenceLoading,
    filterReferenceError,
    openVersions,
    changeVersionsPage,
    openAudit,
    changeAuditPage,
  }
}

export type BobEntityViewModel = ReturnType<typeof useBobEntityViewModel>
