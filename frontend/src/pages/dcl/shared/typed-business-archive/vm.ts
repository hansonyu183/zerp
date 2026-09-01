import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type {
  BusinessObjectField,
  BusinessObjectSort,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  dclDeclarationLifecycleSuccessLabel,
  useDclDeclarationActionAvailability,
  useDclDeclarationHistory,
  useDclDeclarationLifecycle,
} from '../declaration'
import { dclRelationshipConfig } from './config'
import {
  createDclRelationship,
  dclRelationshipData,
  dclRelationshipFormFromView,
  dclRelationshipHistoryPort,
  dclRelationshipLifecyclePort,
  deleteDclRelationship,
  getDclRelationship,
  queryDclRelationships,
  queryRelationshipReference,
  saveDclRelationship,
} from './data'
import { dclRelationshipActiveVersion } from './types'
import type {
  DclRelationshipAuditEvent,
  DclRelationshipEditContext,
  DclRelationshipEntity,
  DclRelationshipForm,
  DclRelationshipListItem,
  DclRelationshipReferenceOption,
  DclRelationshipVersionView,
  DclRelationshipView,
} from './types'

type ReferenceKey =
  | 'operatingEntityIds'
  | 'defaultOperatingEntityId'
  | 'settlementMethodId'

export function useDclRelationshipViewModel(entity: DclRelationshipEntity) {
  const session = useSessionStore()
  const config = dclRelationshipConfig(entity)
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<DclRelationshipListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const sort = ref<BusinessObjectSort>({ field: 'code', order: 'asc' })
  const filters = ref<Record<string, unknown>>(emptyFilters())
  const drawerOpen = ref(false)
  const editorMode = ref<'create' | 'edit' | 'view'>('view')
  const editorModel = ref<DclRelationshipForm>(config.emptyForm())
  const editorResetKey = ref(0)
  const editContext = ref<DclRelationshipEditContext | null>(null)
  const currentView = ref<DclRelationshipView | null>(null)
  const referenceOptions = ref<
    Record<ReferenceKey, DclRelationshipReferenceOption[]>
  >({ operatingEntityIds: [], defaultOperatingEntityId: [], settlementMethodId: [] })
  const referenceLoading = ref<Record<ReferenceKey, boolean>>({
    operatingEntityIds: false,
    defaultOperatingEntityId: false,
    settlementMethodId: false,
  })
  const referenceError = ref<Record<ReferenceKey, string | null>>({
    operatingEntityIds: null,
    defaultOperatingEntityId: null,
    settlementMethodId: null,
  })
  const sequences = new Map<ReferenceKey, number>()
  const timers = new Map<ReferenceKey, ReturnType<typeof setTimeout>>()
  const { permission, actionAvailability } =
    useDclDeclarationActionAvailability<DclRelationshipListItem>(
      entity,
      (row: DclRelationshipListItem) => {
        const approval = dclRelationshipActiveVersion(row).approval
        return {
          status: approval.status,
          versionNo: approval.versionNo,
          availableApprovalActions: row.availableApprovalActions,
          enabled: dclRelationshipActiveVersion(row).data.enabled,
          hasOpenVersion: row.openVersion !== null,
          hasLatestApproved: row.latestApproved !== null,
        }
      },
      (path) => session.can(path),
    )
  const canReferences = computed(
    () =>
      session.can('/bob/operating-entity/query') &&
      (entity === 'sales-partner' ||
        session.can('/aux/settlement-method/query')),
  )
  const canCreate = computed(
    () =>
      session.can(permission('create')) &&
      canReferences.value,
  )
  const canEdit = computed(
    () => session.can(permission('save')) && canReferences.value,
  )
  const entityLabel = entity === 'other-unit' ? '其他单位' : '销售合作方'
  const editorTitle = computed(() =>
    editorMode.value === 'create'
      ? `新增${entityLabel}变更`
      : editorMode.value === 'edit'
        ? `编辑${entityLabel}变更`
        : `${entityLabel}变更详情`,
  )
  const editorFields = computed<
    readonly BusinessObjectField<DclRelationshipForm>[]
  >(() =>
    config.fields.map((field) => {
      if (!Object.hasOwn(referenceOptions.value, field.key)) return field
      const key = field.key as ReferenceKey
      const error = referenceError.value[key]
      return {
        ...field,
        options: referenceOptions.value[key],
        loading: referenceLoading.value[key],
        disabled: Boolean(error),
        ...(error ? { hint: `候选加载失败：${error}` } : {}),
      }
    }),
  )
  const history = useDclDeclarationHistory<
    DclRelationshipListItem,
    DclRelationshipVersionView,
    DclRelationshipAuditEvent
  >(
    errorMessage,
    (row) => actionAvailability(row).versions,
    (row) => actionAvailability(row).audit,
    dclRelationshipHistoryPort(entity),
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
      if (value !== '' && (!Array.isArray(value) || value.length))
        result[field.key] = value
    }
    return result
  }
  function mergeSelected(
    key: ReferenceKey,
    options: DclRelationshipReferenceOption[],
  ): void {
    const selected = editorModel.value[key]
    const selectedValues = Array.isArray(selected) ? selected : [selected]
    const old = referenceOptions.value[key].filter(
      (option) => selectedValues.includes(option.value),
    )
    referenceOptions.value[key] = [...options, ...old].filter(
      (option, index, all) =>
        all.findIndex((candidate) => candidate.value === option.value) ===
        index,
    )
    if (
      selectedValues.length &&
      selectedValues.some((value) => !referenceOptions.value[key].some((option) => option.value === value))
    )
      for (const value of selectedValues)
        if (!referenceOptions.value[key].some((option) => option.value === value))
          referenceOptions.value[key].push({ value, title: value })
  }
  async function loadReference(key: ReferenceKey, search = ''): Promise<void> {
    if (
      ((key === 'operatingEntityIds' || key === 'defaultOperatingEntityId') &&
        !session.can('/bob/operating-entity/query')) ||
      (key === 'settlementMethodId' &&
        (entity !== 'other-unit' ||
          !session.can('/aux/settlement-method/query')))
    )
      return
    const sequence = (sequences.get(key) ?? 0) + 1
    sequences.set(key, sequence)
    referenceLoading.value[key] = true
    referenceError.value[key] = null
    try {
      const options = await queryRelationshipReference(
        key === 'settlementMethodId' ? 'settlement-method' : 'operating-entity',
        search.trim(),
      )
      if (sequences.get(key) === sequence) mergeSelected(key, options)
    } catch (error) {
      if (sequences.get(key) === sequence)
        referenceError.value[key] = getErrorMessage(error)
    } finally {
      if (sequences.get(key) === sequence) referenceLoading.value[key] = false
    }
  }
  function preloadReferences(): void {
    void loadReference('operatingEntityIds')
    void loadReference('defaultOperatingEntityId')
    if (entity === 'other-unit') void loadReference('settlementMethodId')
  }
  function searchEditorReference(key: string, search: string): void {
    if (!Object.hasOwn(referenceOptions.value, key)) return
    const referenceKey = key as ReferenceKey
    const previous = timers.get(referenceKey)
    if (previous) clearTimeout(previous)
    timers.set(
      referenceKey,
      setTimeout(() => {
        timers.delete(referenceKey)
        void loadReference(referenceKey, search)
      }, 250),
    )
  }
  if (getCurrentScope())
    onScopeDispose(() => {
      for (const key of Object.keys(referenceOptions.value) as ReferenceKey[])
        sequences.set(key, (sequences.get(key) ?? 0) + 1)
      for (const timer of timers.values()) clearTimeout(timer)
    })

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryDclRelationships(entity, {
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
  async function changePage(next: number): Promise<void> {
    if (next >= 1 && next !== page.value && !loading.value) {
      page.value = next
      await query()
    }
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
  function openCreate(): void {
    if (!canCreate.value) return
    editorMode.value = 'create'
    editorModel.value = config.emptyForm()
    editContext.value = null
    currentView.value = null
    editorErrorMessage.value = null
    editorResetKey.value += 1
    drawerOpen.value = true
    preloadReferences()
  }
  function hydrateViewReferences(view: DclRelationshipView): void {
    referenceOptions.value.operatingEntityIds = view.data.operatingEntities.map((item) => ({ value: item.sourceObjectId, title: `${item.code} · ${item.name}` }))
    const defaultOperatingEntity = view.data.operatingEntities.find((item) => item.sourceObjectId === view.data.defaultOperatingEntityId)
    referenceOptions.value.defaultOperatingEntityId = defaultOperatingEntity ? [{ value: defaultOperatingEntity.sourceObjectId, title: `${defaultOperatingEntity.code} · ${defaultOperatingEntity.name}` }] : []
    const form = dclRelationshipFormFromView(entity, view)
    referenceOptions.value.settlementMethodId = form.settlementMethodId
      ? [
          {
            value: form.settlementMethodId,
            title:
              'settlementMethodCode' in view.data &&
              view.data.settlementMethodCode
                ? `${view.data.settlementMethodCode} · ${view.data.settlementMethodName ?? ''}`
                : form.settlementMethodId,
          },
        ]
      : []
  }
  async function open(
    row: DclRelationshipListItem,
    mode: 'view' | 'edit',
    approvalEntryId?: string,
  ): Promise<void> {
    if (
      editorLoading.value ||
      (mode === 'view'
        ? !session.can(permission('get'))
        : !actionAvailability(row).edit || !canEdit.value)
    )
      return
    editorMode.value = mode
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const view = await getDclRelationship(
        entity,
        row.objectId,
        approvalEntryId,
      )
      currentView.value = view
      editContext.value =
        mode === 'edit'
          ? {
              objectId: row.objectId,
              approvalEntryId: view.approval.approvalEntryId,
              approvalRevision: view.approval.revision,
            }
          : null
      editorModel.value = dclRelationshipFormFromView(entity, view)
      hydrateViewReferences(view)
      if (mode === 'edit') preloadReferences()
      editorResetKey.value += 1
      drawerOpen.value = true
    } catch (error) {
      drawerOpen.value = false
      currentView.value = null
      editContext.value = null
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }
  const openView = (row: DclRelationshipListItem, approvalEntryId?: string) =>
    open(row, 'view', approvalEntryId)
  const openEdit = (row: DclRelationshipListItem) => open(row, 'edit')
  async function openById(
    objectId: string,
    mode: 'view' | 'edit',
  ): Promise<void> {
    if (!session.can(permission('get'))) return
    editorLoading.value = true
    try {
      const view = await getDclRelationship(entity, objectId)
      const editable =
        mode === 'edit' &&
        canEdit.value &&
        (view.approval.status === 'DRAFT' ||
          view.approval.status === 'APPROVED')
      editorMode.value = editable ? 'edit' : 'view'
      currentView.value = view
      editContext.value = editable
        ? {
            objectId,
            approvalEntryId: view.approval.approvalEntryId,
            approvalRevision: view.approval.revision,
          }
        : null
      editorModel.value = dclRelationshipFormFromView(entity, view)
      hydrateViewReferences(view)
      if (editable) preloadReferences()
      editorResetKey.value += 1
      drawerOpen.value = true
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }
  async function refreshAfterSaveFailure(): Promise<void> {
    const view = currentView.value
    const mode = editorMode.value
    await query()
    if (view && mode !== 'create') await openById(view.objectId, mode)
  }
  function closeEditor(): void {
    if (!saving.value) {
      drawerOpen.value = false
      editContext.value = null
      currentView.value = null
      editorErrorMessage.value = null
    }
  }
  async function save(form: DclRelationshipForm): Promise<boolean> {
    if (saving.value || editorMode.value === 'view') return false
    if (
      (editorMode.value === 'create' ? !canCreate.value : !canEdit.value) ||
      !form.operatingEntityIds.length ||
      !form.defaultOperatingEntityId.trim() ||
      !form.legalName.trim()
    ) {
      editorErrorMessage.value = '请选择适用和默认经营主体，并完整填写身份资料。'
      return false
    }
    saving.value = true
    editorErrorMessage.value = null
    try {
      if (editorMode.value === 'create')
        await createDclRelationship(entity, form)
      else {
        const context = editContext.value
        if (!context) throw new Error('未加载可编辑的业务档案版本。')
        await saveDclRelationship(entity, {
          ...context,
          data: dclRelationshipData(entity, form),
        })
      }
      closeEditor()
      successMessage.value = `${entityLabel}变更已保存。`
      await query()
      return true
    } catch (error) {
      const message = getErrorMessage(error)
      await refreshAfterSaveFailure()
      editorErrorMessage.value = message
      return false
    } finally {
      saving.value = false
    }
  }
  async function runRowAction(
    row: DclRelationshipListItem,
    action: 'delete' | 'submit',
  ): Promise<boolean> {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${row.objectId}`
    try {
      if (action === 'delete') await deleteDclRelationship(entity, row)
      else await dclRelationshipLifecyclePort(entity).run(row, 'submit', '')
      await query()
      successMessage.value =
        action === 'delete' ? `${row.code} 已删除。` : `${row.code} 已提交。`
      return true
    } catch (error) {
      const message = getErrorMessage(error)
      await query()
      errorMessage.value = message
      return false
    } finally {
      actionLoading.value = null
    }
  }
  const lifecycle = useDclDeclarationLifecycle(
    actionLoading,
    errorMessage,
    (row: DclRelationshipListItem) => row.objectId,
    (row) => dclRelationshipActiveVersion(row).data.enabled,
    actionAvailability,
    dclRelationshipLifecyclePort(entity),
    query,
    (row, action) => {
      successMessage.value = `${row.code} ${dclDeclarationLifecycleSuccessLabel(action)}。`
    },
  )
  function versionSummary(version: DclRelationshipVersionView): string {
    if (entity === 'sales-partner') {
      const data = version.data as components['schemas']['DclSalesPartnerInput']
      return data.capabilities?.join('、') || '未设置能力'
    }
    const data = version.data as components['schemas']['DclOtherUnitData']
    return data.settlementMethodName
      ? `${data.settlementMethodCode ?? ''} · ${data.settlementMethodName}`
      : '未设置结算方式'
  }
  return {
    entity,
    entityLabel,
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
    canCreate,
    canEdit,
    editorTitle,
    editorFields,
    actionAvailability,
    hasAnyAction: (row: DclRelationshipListItem) =>
      Object.values(actionAvailability(row)).some(Boolean),
    versionSummary,
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
    searchEditorReference,
    save,
    deleteObject: (row: DclRelationshipListItem) => runRowAction(row, 'delete'),
    submitObject: (row: DclRelationshipListItem) => runRowAction(row, 'submit'),
    ...history,
    ...lifecycle,
  }
}
