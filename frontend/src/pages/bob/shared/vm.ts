import { computed, ref } from 'vue'
import type { BusinessObjectSort } from '@/components/business-object'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageRequest, type PageResult } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  comparableProductValue,
  productFormFields,
  productPayload,
} from './product-data'
import { useBobHistory } from './history'
import { useBobReferences } from './references'
import type {
  BobActionAvailability,
  BobEditContext,
  BobEntityConfig,
  BobForm,
  BobListItem,
  BobMutationResult,
  BobObjectView,
} from './types'

interface VersionRevisionRequest {
  objectId: string
  versionId: string
  revision: number
}

interface ReviewRequest extends VersionRevisionRequest {
  comment: string | null
}

function hasValue(value: unknown): boolean {
  return !(
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    value === false
  )
}

export function useBobEntityViewModel(config: BobEntityConfig) {
  const session = useSessionStore()
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
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

  const canCreate = computed(() => session.can(`/bob/${config.entity}/create`))
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

  function permission(action: string): string {
    return `/bob/${config.entity}/${action}`
  }

  function actionAvailability(
    row: Readonly<BobListItem>,
  ): BobActionAvailability {
    const status = row.currentVersion.status
    return {
      view: session.can(permission('get')),
      edit:
        ((status === 'DRAFT' || status === 'REJECTED') &&
          session.can(permission('get')) &&
          session.can(permission('save'))) ||
        (status === 'EFFECTIVE' &&
          session.can(permission('get')) &&
          session.can(permission('edit')) &&
          session.can(permission('save'))),
      delete:
        session.can(permission('delete')) &&
        status === 'DRAFT' &&
        row.currentVersion.version === 1 &&
        row.effectiveVersionId === null,
      submit:
        session.can(permission('submit')) &&
        (status === 'DRAFT' || status === 'REJECTED'),
      approve: session.can(permission('approve')) && status === 'PENDING',
      reject: session.can(permission('reject')) && status === 'PENDING',
      versions: session.can(permission('versions')),
      audit: session.can(permission('audit-history')),
    }
  }

  function hasAnyAction(row: Readonly<BobListItem>): boolean {
    return Object.values(actionAvailability(row)).some(Boolean)
  }

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
      if (hasValue(value)) result[field.key] = value
    }
    return result
  }

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<
        PageResult<BobListItem>,
        PageRequest
      >(`bob/${config.entity}/query`, {
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

  function normalizeForm(form: BobForm): BobForm {
    const uppercase = new Set(config.uppercaseKeys ?? [])
    const normalized: BobForm = { ...form }
    for (const [key, value] of Object.entries(normalized)) {
      if (typeof value !== 'string') continue
      const trimmed = value.trim()
      normalized[key] = uppercase.has(key) ? trimmed.toUpperCase() : trimmed
    }
    if (config.entity === 'fund-account') {
      const accountNumber = normalized.accountNumber
      if (typeof accountNumber === 'string') {
        normalized.accountNumber = accountNumber
          .replace(/[\s-]+/g, '')
          .toUpperCase()
      }
    }
    return normalized
  }

  function createData(form: BobForm): Record<string, unknown> {
    const normalized = normalizeForm(form)
    const allowedKeys = [...config.detailKeys]
    const data: Record<string, unknown> = {}
    for (const key of allowedKeys) {
      const value = normalized[key]
      if (
        !config.requiredKeys.includes(key) &&
        (value === '' || value === null)
      ) {
        continue
      }
      data[key] = value
    }
    if (config.entity === 'product') {
      Object.assign(data, productPayload(normalized))
    }
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) delete data[key]
    }
    return data
  }

  function saveData(form: BobForm): Record<string, unknown> {
    const normalized = normalizeForm(form)
    const data = Object.fromEntries(
      config.detailKeys.map((key) => [key, normalized[key]]),
    )
    if (config.entity === 'product') {
      Object.assign(data, productPayload(normalized))
    }
    return data
  }

  function formFromView(view: BobObjectView): BobForm {
    const form = config.emptyForm()
    form.code = view.code
    for (const key of config.detailKeys) {
      form[key] = view.data[key] ?? form[key] ?? ''
    }
    if (config.entity === 'product') {
      Object.assign(form, productFormFields(view.data))
    }
    return form
  }

  async function getObject(
    row: Pick<BobListItem, 'objectId'>,
    versionId?: string,
  ): Promise<BobObjectView> {
    const { data } = await apiClient.post<
      BobObjectView,
      { objectId: string; versionId?: string }
    >(`bob/${config.entity}/get`, {
      objectId: row.objectId,
      ...(versionId ? { versionId } : {}),
    })
    return data
  }

  function openCreate(): void {
    if (!canCreate.value) return
    editorMode.value = 'create'
    editorModel.value = config.emptyForm()
    editContext.value = null
    currentView.value = null
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
    drawerOpen.value = true
    try {
      const view = await getObject(row, versionId)
      currentView.value = view
      editorModel.value = formFromView(view)
      editorResetKey.value += 1
      await hydrateReferences(editorModel.value)
    } catch (error) {
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
    drawerOpen.value = true
    let beganEffectiveEdit = false
    try {
      let versionId = row.currentVersion.versionId
      let objectRevision = row.objectRevision
      let revision = row.currentVersion.revision
      if (row.currentVersion.status === 'EFFECTIVE') {
        const { data } = await apiClient.post<
          BobMutationResult,
          { objectId: string; objectRevision: number }
        >(`bob/${config.entity}/edit`, {
          objectId: row.objectId,
          objectRevision: row.objectRevision,
        })
        beganEffectiveEdit = true
        versionId = data.versionId
        objectRevision = data.objectRevision
        revision = data.revision
      }
      const view = await getObject(row, versionId)
      currentView.value = view
      editContext.value = {
        objectId: row.objectId,
        objectRevision,
        versionId,
        revision: view.version.revision ?? revision,
      }
      editorModel.value = formFromView(view)
      editorResetKey.value += 1
      preloadEditorReferences(editorModel.value)
      await hydrateReferences(editorModel.value)
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
      if (beganEffectiveEdit) await query()
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
  }

  async function save(form: BobForm): Promise<boolean> {
    if (saving.value || editorMode.value === 'view') return false
    const normalized = normalizeForm(form)
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
        const result = await apiClient.post<
          BobMutationResult,
          { data: Record<string, unknown> }
        >(`bob/${config.entity}/create`, { data: createData(form) })
        mutation = result.data
      } else {
        const context = editContext.value
        if (!context) throw new Error(`未加载可编辑的${config.title}版本。`)
        const result = await apiClient.post<
          BobMutationResult,
          VersionRevisionRequest & { data: Record<string, unknown> }
        >(`bob/${config.entity}/save`, {
          objectId: context.objectId,
          versionId: context.versionId,
          revision: context.revision,
          data: saveData(form),
        })
        mutation = result.data
      }
      if ((config.persistedKeys?.length ?? 0) > 0) {
        const persisted = await getObject(
          { objectId: mutation.objectId },
          mutation.versionId,
        )
        const normalized = normalizeForm(form)
        const missing = config.persistedKeys?.find(
          (key) =>
            JSON.stringify(
              comparableProductValue(key, persisted.data[key], true),
            ) !==
            JSON.stringify(comparableProductValue(key, normalized[key], false)),
        )
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
        await apiClient.post<
          null,
          {
            objectId: string
            objectRevision: number
            versionId: string
            revision: number
          }
        >(`bob/${config.entity}/delete`, {
          objectId: row.objectId,
          objectRevision: row.objectRevision,
          versionId: row.currentVersion.versionId,
          revision: row.currentVersion.revision,
        })
        if (rows.value.length === 1 && page.value > 1) page.value -= 1
      } else {
        await apiClient.post<BobMutationResult, VersionRevisionRequest>(
          `bob/${config.entity}/submit`,
          {
            objectId: row.objectId,
            versionId: row.currentVersion.versionId,
            revision: row.currentVersion.revision,
          },
        )
      }
      await query()
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

  async function review(
    row: BobListItem,
    action: 'approve' | 'reject',
    comment: string,
  ): Promise<boolean> {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    const normalizedComment = action === 'reject' ? comment.trim() : ''
    if (action === 'reject' && !normalizedComment) {
      errorMessage.value = '驳回意见不能为空。'
      return false
    }
    if (Array.from(normalizedComment).length > 1000) {
      errorMessage.value = '审核意见不能超过 1000 个字符。'
      return false
    }

    actionLoading.value = `${action}:${row.objectId}`
    errorMessage.value = null
    try {
      await apiClient.post<BobMutationResult, ReviewRequest>(
        `bob/${config.entity}/${action}`,
        {
          objectId: row.objectId,
          versionId: row.currentVersion.versionId,
          revision: row.currentVersion.revision,
          comment: normalizedComment || null,
        },
      )
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  return {
    config,
    loading,
    editorLoading,
    saving,
    actionLoading,
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
    hasAnyAction,
    query,
    search,
    changePage,
    changeSort,
    resetFilters,
    openCreate,
    openView,
    openEdit,
    closeEditor,
    save,
    deleteObject,
    submitObject,
    review,
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
