import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
} from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageRequest, type PageResult } from '@/api/types'
import type { BusinessObjectFieldOption } from '@/components/business-object'
import { useSessionStore } from '@/stores/session'
import type {
  BobActionAvailability,
  BobAuditEvent,
  BobEditContext,
  BobEntityConfig,
  BobFilterField,
  BobForm,
  BobListItem,
  BobMutationResult,
  BobObjectView,
  BobReferenceConfig,
  BobVersionHistoryItem,
  ReferenceQueryItem,
} from './types'

interface ReferenceState {
  options: BusinessObjectFieldOption<string>[]
  loading: boolean
  errorMessage: string | null
  requestSequence: number
}

interface VersionRevisionRequest {
  objectId: string
  versionId: string
  revision: number
}

interface ReviewRequest extends VersionRevisionRequest {
  comment: string | null
}

interface HistoryRequest {
  objectId: string
  page: number
  pageSize: number
}

function createReferenceState(): ReferenceState {
  return {
    options: [],
    loading: false,
    errorMessage: null,
    requestSequence: 0,
  }
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

  const versionsOpen = ref(false)
  const versionsLoading = ref(false)
  const versions = ref<BobVersionHistoryItem[]>([])
  const versionsPage = ref(1)
  const versionsPageSize = ref(20)
  const versionsTotal = ref(0)
  const historyObject = ref<BobListItem | null>(null)

  const auditOpen = ref(false)
  const auditLoading = ref(false)
  const auditEvents = ref<BobAuditEvent[]>([])
  const auditPage = ref(1)
  const auditPageSize = ref(20)
  const auditTotal = ref(0)

  const referenceStates = reactive<Record<string, ReferenceState>>({})
  const searchTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function referenceState(key: string): ReferenceState {
    if (!referenceStates[key]) referenceStates[key] = createReferenceState()
    return referenceStates[key]
  }

  for (const key of Object.keys(config.references ?? {})) {
    referenceState(`editor:${key}`)
  }
  for (const field of config.filters) {
    if (field.reference) referenceState(`filter:${field.key}`)
  }

  const canCreate = computed(
    () => session.can(`/bob/${config.entity}/create`),
  )
  const editorTitle = computed(() => {
    if (editorMode.value === 'create') return `新增${config.title}`
    if (editorMode.value === 'edit') return `编辑${config.title}`
    return `${config.title}详情`
  })
  const referenceOptions = computed(() =>
    Object.fromEntries(
      Object.keys(config.references ?? {}).map((key) => [
        key,
        referenceState(`editor:${key}`).options,
      ]),
    ),
  )
  const referenceLoading = computed(() =>
    Object.fromEntries(
      Object.keys(config.references ?? {}).map((key) => [
        key,
        referenceState(`editor:${key}`).loading,
      ]),
    ),
  )
  const referenceErrors = computed(() =>
    Object.fromEntries(
      Object.keys(config.references ?? {}).map((key) => [
        key,
        referenceState(`editor:${key}`).errorMessage,
      ]),
    ),
  )
  const editorFields = computed(() =>
    config.fields({
      mode: editorMode.value,
      referenceOptions: referenceOptions.value,
      referenceLoading: referenceLoading.value,
      referenceErrors: referenceErrors.value,
    }),
  )

  function permission(action: string): string {
    return `/bob/${config.entity}/${action}`
  }

  function actionAvailability(row: Readonly<BobListItem>): BobActionAvailability {
    const status = row.currentVersion.status
    return {
      view: session.can(permission('get')),
      edit: (
        (status === 'DRAFT' || status === 'REJECTED') &&
        session.can(permission('get')) &&
        session.can(permission('save'))
      ) || (
        status === 'EFFECTIVE' &&
        session.can(permission('get')) &&
        session.can(permission('edit')) &&
        session.can(permission('save'))
      ),
      delete:
        session.can(permission('delete')) &&
        status === 'DRAFT' &&
        row.currentVersion.version === 1 &&
        row.effectiveVersionId === null,
      submit:
        session.can(permission('submit')) &&
        (status === 'DRAFT' || status === 'REJECTED'),
      approve:
        session.can(permission('approve')) && status === 'PENDING',
      reject:
        session.can(permission('reject')) && status === 'PENDING',
      versions: session.can(permission('versions')),
      audit: session.can(permission('audit-history')),
    }
  }

  function hasAnyAction(row: Readonly<BobListItem>): boolean {
    return Object.values(actionAvailability(row)).some(Boolean)
  }

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
        sort: [{ field: 'updatedAt', order: 'desc' }],
      })
      rows.value = Array.isArray(data.items) ? data.items : []
      total.value = typeof data.total === 'number' ? data.total : rows.value.length
      page.value = typeof data.page === 'number' ? data.page : page.value
      pageSize.value = typeof data.pageSize === 'number'
        ? data.pageSize
        : pageSize.value
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
        normalized.accountNumber = accountNumber.replace(/[\s-]+/g, '').toUpperCase()
      }
    }
    return normalized
  }

  function createData(form: BobForm): Record<string, unknown> {
    const normalized = normalizeForm(form)
    const allowedKeys = ['code', ...config.detailKeys]
    const data: Record<string, unknown> = {}
    for (const key of allowedKeys) {
      const value = normalized[key]
      if (!config.requiredKeys.includes(key) && (value === '' || value === null)) {
        continue
      }
      data[key] = value
    }
    return data
  }

  function saveData(form: BobForm): Record<string, unknown> {
    const normalized = normalizeForm(form)
    return Object.fromEntries(config.detailKeys.map((key) => [key, normalized[key]]))
  }

  function formFromView(view: BobObjectView): BobForm {
    const form = config.emptyForm()
    form.code = view.code
    for (const key of config.detailKeys) {
      form[key] = view.data[key] ?? form[key] ?? ''
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

  async function hydrateReferences(form: Readonly<BobForm>): Promise<void> {
    await Promise.all(
      Object.entries(config.references ?? {}).map(async ([key, reference]) => {
        const value = form[key]
        if (typeof value !== 'string' || !value) return
        const state = referenceState(`editor:${key}`)
        if (state.options.some((option) => option.value === value)) return

        const getPermission = `/bob/${reference.entity}/get`
        if (!session.can(getPermission)) {
          state.options = [...state.options, { title: value, value }]
          return
        }
        try {
          const { data } = await apiClient.post<
            BobObjectView,
            { objectId: string }
          >(`bob/${reference.entity}/get`, { objectId: value })
          state.options = [
            ...state.options.filter((option) => option.value !== value),
            { title: `${data.code} · ${data.data.name}`, value },
          ]
        } catch {
          state.options = [...state.options, { title: value, value }]
        }
      }),
    )
  }

  function resolveReferenceFilters(
    reference: BobReferenceConfig,
    form: Readonly<BobForm>,
  ): Record<string, unknown> {
    const filters = typeof reference.filters === 'function'
      ? reference.filters(form)
      : reference.filters ?? {}
    return Object.fromEntries(
      Object.entries(filters).filter(([, value]) => hasValue(value)),
    )
  }

  async function loadReference(
    stateKey: string,
    reference: BobReferenceConfig,
    keywordValue: string,
    form: Readonly<BobForm>,
  ): Promise<void> {
    const state = referenceState(stateKey)
    const queryPermission = `/bob/${reference.entity}/query`
    if (!session.can(queryPermission)) {
      state.errorMessage = `缺少${reference.label}查询权限。`
      return
    }

    const sequence = state.requestSequence + 1
    state.requestSequence = sequence
    state.loading = true
    state.errorMessage = null
    try {
      const keywordFilter = keywordValue.trim()
      const { data } = await apiClient.post<
        PageResult<ReferenceQueryItem>,
        PageRequest
      >(`bob/${reference.entity}/query`, {
        page: 1,
        pageSize: 20,
        filters: {
          ...resolveReferenceFilters(reference, form),
          ...(keywordFilter ? { keyword: keywordFilter } : {}),
          status: ['EFFECTIVE'],
        },
        sort: [{ field: 'name', order: 'asc' }],
      })
      if (state.requestSequence !== sequence) return
      const selected = state.options.filter((option) =>
        Object.values(form).includes(option.value))
      state.options = [
        ...selected,
        ...(data.items ?? []).map((item) => ({
          title: `${item.code} · ${item.currentVersion.summary.name}`,
          value: item.objectId,
        })),
      ].filter((option, index, all) =>
        all.findIndex((candidate) => candidate.value === option.value) === index
      )
    } catch (error) {
      if (state.requestSequence === sequence) {
        state.errorMessage = `${reference.label}加载失败：${getErrorMessage(error)}`
      }
    } finally {
      if (state.requestSequence === sequence) state.loading = false
    }
  }

  function scheduleReference(
    stateKey: string,
    reference: BobReferenceConfig,
    keywordValue: string,
    form: Readonly<BobForm>,
  ): void {
    const previous = searchTimers.get(stateKey)
    if (previous) clearTimeout(previous)
    searchTimers.set(
      stateKey,
      setTimeout(() => {
        searchTimers.delete(stateKey)
        void loadReference(stateKey, reference, keywordValue, form)
      }, 300),
    )
  }

  function searchEditorReference(
    key: string,
    keywordValue: string,
    form: Readonly<BobForm>,
  ): void {
    const reference = config.references?.[key]
    if (!reference) return
    scheduleReference(`editor:${key}`, reference, keywordValue, form)
  }

  function filterField(key: string): BobFilterField | undefined {
    return config.filters.find((field) => field.key === key)
  }

  function searchFilterReference(key: string, keywordValue: string): void {
    const field = filterField(key)
    if (!field?.reference) return
    scheduleReference(
      `filter:${key}`,
      field.reference,
      keywordValue,
      filters.value as BobForm,
    )
  }

  function filterReferenceOptions(key: string) {
    return referenceState(`filter:${key}`).options
  }

  function filterReferenceLoading(key: string): boolean {
    return referenceState(`filter:${key}`).loading
  }

  function filterReferenceError(key: string): string | null {
    return referenceState(`filter:${key}`).errorMessage
  }

  function preloadEditorReferences(form: Readonly<BobForm>): void {
    for (const [key, reference] of Object.entries(config.references ?? {})) {
      void loadReference(`editor:${key}`, reference, '', form)
    }
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

  async function openView(
    row: BobListItem,
    versionId?: string,
  ): Promise<void> {
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
        >(
          `bob/${config.entity}/create`,
          { data: createData(form) },
        )
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
          (key) => (persisted.data[key] ?? '') !== (normalized[key] ?? ''),
        )
        if (missing) {
          const label = editorFields.value.find(
            (field) => field.key === missing,
          )?.label ?? missing
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
        await apiClient.post<null, {
          objectId: string
          objectRevision: number
          versionId: string
          revision: number
        }>(`bob/${config.entity}/delete`, {
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
    const normalizedComment = comment.trim()
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

  async function loadVersions(): Promise<void> {
    const row = historyObject.value
    if (!row) return
    versionsLoading.value = true
    try {
      const { data } = await apiClient.post<
        PageResult<BobVersionHistoryItem>,
        HistoryRequest
      >(`bob/${config.entity}/versions`, {
        objectId: row.objectId,
        page: versionsPage.value,
        pageSize: versionsPageSize.value,
      })
      versions.value = data.items ?? []
      versionsTotal.value = data.total
      versionsPage.value = data.page
      versionsPageSize.value = data.pageSize
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      versionsLoading.value = false
    }
  }

  async function openVersions(row: BobListItem): Promise<void> {
    if (!actionAvailability(row).versions) return
    historyObject.value = row
    versions.value = []
    versionsPage.value = 1
    versionsOpen.value = true
    await loadVersions()
  }

  async function changeVersionsPage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === versionsPage.value) return
    versionsPage.value = nextPage
    await loadVersions()
  }

  async function loadAudit(): Promise<void> {
    const row = historyObject.value
    if (!row) return
    auditLoading.value = true
    try {
      const { data } = await apiClient.post<
        PageResult<BobAuditEvent>,
        HistoryRequest
      >(`bob/${config.entity}/audit-history`, {
        objectId: row.objectId,
        page: auditPage.value,
        pageSize: auditPageSize.value,
      })
      auditEvents.value = data.items ?? []
      auditTotal.value = data.total
      auditPage.value = data.page
      auditPageSize.value = data.pageSize
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      auditLoading.value = false
    }
  }

  async function openAudit(row: BobListItem): Promise<void> {
    if (!actionAvailability(row).audit) return
    historyObject.value = row
    auditEvents.value = []
    auditPage.value = 1
    auditOpen.value = true
    await loadAudit()
  }

  async function changeAuditPage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === auditPage.value) return
    auditPage.value = nextPage
    await loadAudit()
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      for (const timer of searchTimers.values()) clearTimeout(timer)
      searchTimers.clear()
    })
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
