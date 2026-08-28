import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type {
  BusinessObjectField,
  BusinessObjectSort,
} from '@/components/business-object'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  dclDeclarationLifecycleSuccessLabel,
  useDclDeclarationActionAvailability,
  useDclDeclarationHistory,
  useDclDeclarationLifecycle,
} from '../shared/declaration'
import { dclSupplierConfig } from './config'
import {
  createDclSupplier,
  dclSupplierData,
  dclSupplierFormFromView,
  dclSupplierHistoryPort,
  dclSupplierLifecyclePort,
  deleteDclSupplier,
  getDclSupplier,
  queryDclSuppliers,
  querySupplierParties,
  querySupplierReference,
  saveDclSupplier,
} from './data'
import { dclSupplierActiveVersion } from './types'
import type {
  DclSupplierAuditEvent,
  DclSupplierEditContext,
  DclSupplierForm,
  DclSupplierListItem,
  DclSupplierReferenceOption,
  DclSupplierVersionView,
  DclSupplierView,
} from './types'

type ReferenceKey =
  | 'partyId'
  | 'operatingEntityId'
  | 'settlementMethodId'
  | 'defaultPurchaserEmployeeId'
const referenceEntity: Record<
  Exclude<ReferenceKey, 'partyId'>,
  Parameters<typeof querySupplierReference>[0]
> = {
  operatingEntityId: 'operating-entity',
  settlementMethodId: 'settlement-method',
  defaultPurchaserEmployeeId: 'employee',
}

export function useDclSupplierViewModel() {
  const session = useSessionStore()
  const config = dclSupplierConfig
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<DclSupplierListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const sort = ref<BusinessObjectSort>({ field: 'code', order: 'asc' })
  const filters = ref<Record<string, unknown>>(emptyFilters())
  const drawerOpen = ref(false)
  const editorMode = ref<'create' | 'edit' | 'view'>('view')
  const editorModel = ref<DclSupplierForm>(config.emptyForm())
  const editorResetKey = ref(0)
  const editContext = ref<DclSupplierEditContext | null>(null)
  const currentView = ref<DclSupplierView | null>(null)
  const referenceOptions = ref<
    Record<ReferenceKey, DclSupplierReferenceOption[]>
  >({
    partyId: [],
    operatingEntityId: [],
    settlementMethodId: [],
    defaultPurchaserEmployeeId: [],
  })
  const referenceLoading = ref<Record<ReferenceKey, boolean>>({
    partyId: false,
    operatingEntityId: false,
    settlementMethodId: false,
    defaultPurchaserEmployeeId: false,
  })
  const referenceError = ref<Record<ReferenceKey, string | null>>({
    partyId: null,
    operatingEntityId: null,
    settlementMethodId: null,
    defaultPurchaserEmployeeId: null,
  })
  const sequences = new Map<ReferenceKey, number>()
  const timers = new Map<ReferenceKey, ReturnType<typeof setTimeout>>()
  const { permission, actionAvailability, actionBlockedReason } =
    useDclDeclarationActionAvailability(
      'supplier',
      (row: DclSupplierListItem) => {
        const approval = dclSupplierActiveVersion(row).approval
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
  const canReferences = computed(
    () =>
      session.can('/bob/operating-entity/query') &&
      session.can('/aux/reference/query') &&
      session.can('/bob/reference/query'),
  )
  const canCreate = computed(
    () =>
      session.can(permission('create')) &&
      canReferences.value &&
      (session.can('/bob/party/query') || session.can('/dcl/party/create')),
  )
  const canEdit = computed(
    () => session.can(permission('save')) && canReferences.value,
  )
  const editorTitle = computed(() =>
    editorMode.value === 'create'
      ? '新增供应商申报'
      : editorMode.value === 'edit'
        ? '编辑供应商申报'
        : '供应商申报详情',
  )
  const editorFields = computed<
    readonly BusinessObjectField<DclSupplierForm>[]
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
    DclSupplierListItem,
    DclSupplierVersionView,
    DclSupplierAuditEvent
  >(
    errorMessage,
    (row) => actionAvailability(row).versions,
    (row) => actionAvailability(row).audit,
    dclSupplierHistoryPort,
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
    options: DclSupplierReferenceOption[],
  ): void {
    const selected = editorModel.value[key]
    const old = referenceOptions.value[key].filter(
      (option) => option.value === selected,
    )
    referenceOptions.value[key] = [...options, ...old].filter(
      (option, index, all) =>
        all.findIndex((candidate) => candidate.value === option.value) ===
        index,
    )
    if (
      selected &&
      !referenceOptions.value[key].some((option) => option.value === selected)
    )
      referenceOptions.value[key].push({ value: selected, title: selected })
  }
  async function loadReference(key: ReferenceKey, search = ''): Promise<void> {
    if (
      key === 'partyId'
        ? !session.can('/bob/party/query')
        : !canReferences.value
    )
      return
    const sequence = (sequences.get(key) ?? 0) + 1
    sequences.set(key, sequence)
    referenceLoading.value[key] = true
    referenceError.value[key] = null
    try {
      const options =
        key === 'partyId'
          ? await querySupplierParties(search.trim())
          : await querySupplierReference(referenceEntity[key], search.trim())
      if (sequences.get(key) === sequence) mergeSelected(key, options)
    } catch (error) {
      if (sequences.get(key) === sequence)
        referenceError.value[key] = getErrorMessage(error)
    } finally {
      if (sequences.get(key) === sequence) referenceLoading.value[key] = false
    }
  }
  function preloadReferences(): void {
    for (const key of Object.keys(referenceOptions.value) as ReferenceKey[])
      void loadReference(key)
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
      const result = await queryDclSuppliers({
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
  function hydrateViewReferences(view: DclSupplierView): void {
    referenceOptions.value.partyId = [
      { value: view.partyId, title: view.partyDisplayName },
    ]
    referenceOptions.value.operatingEntityId = [
      {
        value: view.operatingEntityId,
        title: `${view.operatingEntityCode} · ${view.operatingEntityName}`,
      },
    ]
    referenceOptions.value.settlementMethodId = view.data.settlementMethod
      ? [
          {
            value:
              view.data.settlementMethodId ??
              view.data.settlementMethod.sourceObjectId,
            title: `${view.data.settlementMethod.code} · ${view.data.settlementMethod.name}`,
          },
        ]
      : []
    referenceOptions.value.defaultPurchaserEmployeeId = view.data
      .defaultPurchaser
      ? [
          {
            value:
              view.data.defaultPurchaserEmployeeId ??
              view.data.defaultPurchaser.sourceObjectId,
            title: `${view.data.defaultPurchaser.code} · ${view.data.defaultPurchaser.name}`,
          },
        ]
      : []
  }
  async function open(
    row: DclSupplierListItem,
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
      const view = await getDclSupplier(row.objectId, approvalEntryId)
      currentView.value = view
      editContext.value =
        mode === 'edit'
          ? {
              objectId: row.objectId,
              approvalEntryId: view.approval.approvalEntryId,
              approvalRevision: view.approval.revision,
            }
          : null
      editorModel.value = dclSupplierFormFromView(view)
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
  const openView = (row: DclSupplierListItem, approvalEntryId?: string) =>
    open(row, 'view', approvalEntryId)
  const openEdit = (row: DclSupplierListItem) => open(row, 'edit')
  async function openById(
    objectId: string,
    _mode: 'view' | 'edit',
  ): Promise<void> {
    if (session.can(permission('get')))
      await open({ objectId } as DclSupplierListItem, 'view')
  }
  function closeEditor(): void {
    if (!saving.value) {
      drawerOpen.value = false
      editContext.value = null
      currentView.value = null
      editorErrorMessage.value = null
    }
  }
  async function save(form: DclSupplierForm): Promise<boolean> {
    if (saving.value || editorMode.value === 'view') return false
    if (
      (editorMode.value === 'create' ? !canCreate.value : !canEdit.value) ||
      !form.operatingEntityId.trim() ||
      (editorMode.value === 'create' &&
        (form.partyMode === 'EXISTING'
          ? !form.partyId.trim()
          : !form.legalName.trim()))
    ) {
      editorErrorMessage.value = '请选择经营主体，并完整填写主体资料。'
      return false
    }
    saving.value = true
    editorErrorMessage.value = null
    try {
      if (editorMode.value === 'create') await createDclSupplier(form)
      else {
        const context = editContext.value
        if (!context) throw new Error('未加载可编辑的供应商申报版本。')
        await saveDclSupplier({
          ...context,
          enabled: currentView.value?.enabled ?? true,
          data: dclSupplierData(form),
        })
      }
      closeEditor()
      successMessage.value = '供应商申报已保存。'
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
    row: DclSupplierListItem,
    action: 'delete' | 'submit',
  ): Promise<boolean> {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${row.objectId}`
    try {
      if (action === 'delete') await deleteDclSupplier(row)
      else await dclSupplierLifecyclePort.run(row, 'submit', '')
      await query()
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
    (row: DclSupplierListItem) => row.objectId,
    (row) => row.enabled,
    actionAvailability,
    dclSupplierLifecyclePort,
    query,
    (row, action) => {
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
    canCreate,
    canEdit,
    editorTitle,
    editorFields,
    actionAvailability,
    actionBlockedReason,
    hasAnyAction: (row: DclSupplierListItem) =>
      Object.values(actionAvailability(row)).some(Boolean),
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
    deleteObject: (row: DclSupplierListItem) => runRowAction(row, 'delete'),
    submitObject: (row: DclSupplierListItem) => runRowAction(row, 'submit'),
    ...history,
    ...lifecycle,
  }
}
