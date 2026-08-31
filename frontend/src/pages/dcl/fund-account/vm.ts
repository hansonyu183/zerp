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
import { dclFundAccountConfig } from './config'
import {
  createDclFundAccount,
  deleteDclFundAccount,
  dclFundAccountData,
  dclFundAccountFormFromView,
  dclFundAccountHistoryPort,
  dclFundAccountLifecyclePort,
  getDclFundAccount,
  queryDclFundAccountOperatingEntities,
  queryDclFundAccounts,
  saveDclFundAccount,
} from './data'
import {
  dclFundAccountActiveVersion,
  type DclFundAccountAuditEvent,
  type DclFundAccountEditContext,
  type DclFundAccountForm,
  type DclFundAccountListItem,
  type DclFundAccountOperatingEntityOption,
  type DclFundAccountVersionView,
  type DclFundAccountView,
} from './types'

export function useDclFundAccountViewModel() {
  const session = useSessionStore()
  const config = dclFundAccountConfig
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<DclFundAccountListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const sort = ref<BusinessObjectSort>({ field: 'code', order: 'asc' })
  const filters = ref<Record<string, unknown>>(emptyFilters())
  const drawerOpen = ref(false)
  const editorMode = ref<'create' | 'edit' | 'view'>('view')
  const editorModel = ref<DclFundAccountForm>(config.emptyForm())
  const editorResetKey = ref(0)
  const editContext = ref<DclFundAccountEditContext | null>(null)
  const currentView = ref<DclFundAccountView | null>(null)
  const effectiveView = ref<DclFundAccountView | null>(null)
  const operatingEntityOptions = ref<DclFundAccountOperatingEntityOption[]>([])
  const operatingEntityLoading = ref(false)
  const operatingEntityError = ref<string | null>(null)
  let operatingEntityRequestSequence = 0
  let operatingEntitySearchTimer: ReturnType<typeof setTimeout> | undefined

  const {
    permission,
    actionAvailability: baseActionAvailability,
    actionBlockedReason,
  } = useDclDeclarationActionAvailability(
    'fund-account',
    (row: DclFundAccountListItem) => {
      const approval = dclFundAccountActiveVersion(row).approval
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
  const canQueryOperatingEntities = computed(() =>
    session.can('/bob/operating-entity/query'),
  )
  const canCreate = computed(
    () => session.can(permission('create')) && canQueryOperatingEntities.value,
  )
  const canEditFundAccount = computed(
    () => session.can(permission('save')) && canQueryOperatingEntities.value,
  )
  function actionAvailability(row: Readonly<DclFundAccountListItem>) {
    const availability = baseActionAvailability(row)
    if (availability.edit) availability.edit = canEditFundAccount.value
    return availability
  }
  function hasAnyAction(row: Readonly<DclFundAccountListItem>): boolean {
    return Object.values(actionAvailability(row)).some(Boolean)
  }
  const editorTitle = computed(() =>
    editorMode.value === 'create'
      ? '新增资金账户变更'
      : editorMode.value === 'edit'
        ? '编辑资金账户变更'
        : '资金账户变更详情',
  )
  const editorFields = computed(() =>
    config.fields.map((field): BusinessObjectField<DclFundAccountForm> => {
      if (field.key !== 'operatingEntityId') return field
      return {
        ...field,
        loading: operatingEntityLoading.value,
        options: operatingEntityOptions.value,
        disabled: Boolean(operatingEntityError.value),
        ...(operatingEntityError.value
          ? { hint: `经营主体加载失败：${operatingEntityError.value}` }
          : {}),
      }
    }),
  )
  const effectiveEditorModel = computed(() =>
    effectiveView.value
      ? dclFundAccountFormFromView(effectiveView.value)
      : config.emptyForm(),
  )
  const history = useDclDeclarationHistory<
    DclFundAccountListItem,
    DclFundAccountVersionView,
    DclFundAccountAuditEvent
  >(
    errorMessage,
    (row) => actionAvailability(row).versions,
    (row) => actionAvailability(row).audit,
    dclFundAccountHistoryPort,
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

  async function loadOperatingEntities(
    keyword: string,
    form: Readonly<DclFundAccountForm>,
  ): Promise<void> {
    if (!canQueryOperatingEntities.value) return
    const sequence = operatingEntityRequestSequence + 1
    operatingEntityRequestSequence = sequence
    operatingEntityLoading.value = true
    operatingEntityError.value = null
    try {
      const loaded = await queryDclFundAccountOperatingEntities(keyword.trim())
      if (operatingEntityRequestSequence !== sequence) return
      const selected = operatingEntityOptions.value.filter(
        (option) => option.value === form.operatingEntityId,
      )
      operatingEntityOptions.value = [...loaded, ...selected].filter(
        (option, index, all) =>
          all.findIndex((candidate) => candidate.value === option.value) ===
          index,
      )
      if (
        form.operatingEntityId &&
        !operatingEntityOptions.value.some(
          (option) => option.value === form.operatingEntityId,
        )
      ) {
        operatingEntityOptions.value.push({
          title: form.operatingEntityId,
          value: form.operatingEntityId,
        })
      }
    } catch (error) {
      if (operatingEntityRequestSequence === sequence)
        operatingEntityError.value = getErrorMessage(error)
    } finally {
      if (operatingEntityRequestSequence === sequence)
        operatingEntityLoading.value = false
    }
  }

  function preloadOperatingEntities(form: Readonly<DclFundAccountForm>): void {
    void loadOperatingEntities('', form)
  }

  function searchEditorReference(
    key: string,
    keyword: string,
    form: Readonly<DclFundAccountForm>,
  ): void {
    if (key !== 'operatingEntityId') return
    if (operatingEntitySearchTimer) clearTimeout(operatingEntitySearchTimer)
    operatingEntitySearchTimer = setTimeout(() => {
      operatingEntitySearchTimer = undefined
      void loadOperatingEntities(keyword, form)
    }, 300)
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      operatingEntityRequestSequence += 1
      if (operatingEntitySearchTimer) clearTimeout(operatingEntitySearchTimer)
    })
  }

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryDclFundAccounts({
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
    row: Pick<DclFundAccountListItem, 'objectId'>,
    approvalEntryId?: string,
  ): Promise<DclFundAccountView> {
    return getDclFundAccount(row.objectId, approvalEntryId)
  }

  async function loadEffectiveView(
    view: DclFundAccountView,
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
    preloadOperatingEntities(editorModel.value)
  }

  async function open(
    row: DclFundAccountListItem,
    mode: 'view' | 'edit',
    approvalEntryId?: string,
  ): Promise<void> {
    if (
      editorLoading.value ||
      (mode === 'view'
        ? !session.can(permission('get'))
        : !actionAvailability(row).edit)
    ) {
      return
    }
    editorMode.value = mode
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const view = await getObject(row, approvalEntryId)
      currentView.value = view
      await loadEffectiveView(
        view,
        row.latestApproved?.approval.approvalEntryId,
      )
      editContext.value =
        mode === 'edit'
          ? {
              objectId: row.objectId,
              approvalEntryId: view.approval.approvalEntryId,
              approvalRevision: view.approval.revision,
            }
          : null
      editorModel.value = dclFundAccountFormFromView(view)
      if (editorMode.value === 'edit')
        preloadOperatingEntities(editorModel.value)
      editorResetKey.value += 1
      drawerOpen.value = true
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

  const openView = (row: DclFundAccountListItem, approvalEntryId?: string) =>
    open(row, 'view', approvalEntryId)
  const openEdit = (row: DclFundAccountListItem) => open(row, 'edit')

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
        canEditFundAccount.value
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
      editorModel.value = dclFundAccountFormFromView(view)
      if (editable) preloadOperatingEntities(editorModel.value)
      editorResetKey.value += 1
      drawerOpen.value = true
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

  async function save(form: DclFundAccountForm): Promise<boolean> {
    if (saving.value || editorMode.value === 'view') return false
    if (
      editorMode.value === 'create'
        ? !canCreate.value
        : !canEditFundAccount.value
    ) {
      editorErrorMessage.value = '当前权限不足，无法保存资金账户变更。'
      return false
    }
    const data = dclFundAccountData(form)
    if (!data.name || !data.currency || !data.operatingEntityId) {
      editorErrorMessage.value = '请填写账户名称、币种和经营主体。'
      return false
    }
    saving.value = true
    editorErrorMessage.value = null
    try {
      if (editorMode.value === 'create') {
        await createDclFundAccount(data)
      } else {
        const context = editContext.value
        if (!context) throw new Error('未加载可编辑的资金账户变更版本。')
        await saveDclFundAccount({
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
      successMessage.value = '资金账户变更已保存。'
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
    row: DclFundAccountListItem,
    action: 'delete' | 'submit',
  ): Promise<boolean> {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${row.objectId}`
    errorMessage.value = null
    try {
      if (action === 'delete') {
        await deleteDclFundAccount(row)
      } else {
        await dclFundAccountLifecyclePort.run(row, 'submit', '')
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
    dclFundAccountLifecyclePort,
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
    canQueryOperatingEntities,
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
    searchEditorReference,
    save,
    deleteObject: (row: DclFundAccountListItem) => runRowAction(row, 'delete'),
    submitObject: (row: DclFundAccountListItem) => runRowAction(row, 'submit'),
    ...history,
    ...lifecycle,
  }
}
