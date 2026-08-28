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
import { dclEmployeeConfig } from './config'
import {
  createDclEmployee,
  dclEmployeeData,
  dclEmployeeFormFromView,
  dclEmployeeHistoryPort,
  dclEmployeeLifecyclePort,
  deleteDclEmployee,
  getDclEmployee,
  queryDclEmployees,
  queryEmployeeParties,
  queryEmployeeReference,
  saveDclEmployee,
} from './data'
import { dclEmployeeActiveVersion } from './types'
import type {
  DclEmployeeAuditEvent,
  DclEmployeeEditContext,
  DclEmployeeForm,
  DclEmployeeListItem,
  DclEmployeeReferenceOption,
  DclEmployeeVersionView,
  DclEmployeeView,
} from './types'

type ReferenceKey =
  | 'partyId'
  | 'operatingEntityId'
  | 'employeeCategoryId'
  | 'departmentId'
  | 'positionId'

const referenceEntity: Record<
  Exclude<ReferenceKey, 'partyId'>,
  Parameters<typeof queryEmployeeReference>[0]
> = {
  operatingEntityId: 'operating-entity',
  employeeCategoryId: 'employee-category',
  departmentId: 'department',
  positionId: 'position',
}

export function useDclEmployeeViewModel() {
  const session = useSessionStore()
  const config = dclEmployeeConfig
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<DclEmployeeListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const sort = ref<BusinessObjectSort>({ field: 'code', order: 'asc' })
  const filters = ref<Record<string, unknown>>(emptyFilters())
  const drawerOpen = ref(false)
  const editorMode = ref<'create' | 'edit' | 'view'>('view')
  const editorModel = ref<DclEmployeeForm>(config.emptyForm())
  const editorResetKey = ref(0)
  const editContext = ref<DclEmployeeEditContext | null>(null)
  const currentView = ref<DclEmployeeView | null>(null)
  const referenceOptions = ref<
    Record<ReferenceKey, DclEmployeeReferenceOption[]>
  >({
    partyId: [],
    operatingEntityId: [],
    employeeCategoryId: [],
    departmentId: [],
    positionId: [],
  })
  const referenceLoading = ref<Record<ReferenceKey, boolean>>({
    partyId: false,
    operatingEntityId: false,
    employeeCategoryId: false,
    departmentId: false,
    positionId: false,
  })
  const referenceError = ref<Record<ReferenceKey, string | null>>({
    partyId: null,
    operatingEntityId: null,
    employeeCategoryId: null,
    departmentId: null,
    positionId: null,
  })
  const sequences = new Map<ReferenceKey, number>()
  const timers = new Map<ReferenceKey, ReturnType<typeof setTimeout>>()

  const { permission, actionAvailability, actionBlockedReason } =
    useDclDeclarationActionAvailability(
      'employee',
      (row: DclEmployeeListItem) => {
        const approval = dclEmployeeActiveVersion(row).approval
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
      session.can('/aux/employee-category/query') &&
      session.can('/aux/department/query') &&
      session.can('/aux/position/query'),
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
      ? '新增人员申报'
      : editorMode.value === 'edit'
        ? '编辑人员申报'
        : '人员申报详情',
  )
  const editorFields = computed<
    readonly BusinessObjectField<DclEmployeeForm>[]
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
    DclEmployeeListItem,
    DclEmployeeVersionView,
    DclEmployeeAuditEvent
  >(
    errorMessage,
    (row) => actionAvailability(row).versions,
    (row) => actionAvailability(row).audit,
    dclEmployeeHistoryPort,
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
    options: DclEmployeeReferenceOption[],
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
    ) {
      referenceOptions.value[key].push({ value: selected, title: selected })
    }
  }

  async function loadReference(key: ReferenceKey, keyword = ''): Promise<void> {
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
          ? await queryEmployeeParties(keyword.trim())
          : await queryEmployeeReference(referenceEntity[key], keyword.trim())
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

  function searchEditorReference(key: string, keyword: string): void {
    if (!Object.hasOwn(referenceOptions.value, key)) return
    const referenceKey = key as ReferenceKey
    const timer = timers.get(referenceKey)
    if (timer) clearTimeout(timer)
    timers.set(
      referenceKey,
      setTimeout(() => {
        timers.delete(referenceKey)
        void loadReference(referenceKey, keyword)
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
      const result = await queryDclEmployees({
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
    if (nextPage >= 1 && nextPage !== page.value && !loading.value) {
      page.value = nextPage
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

  function hydrateViewReferences(view: DclEmployeeView): void {
    referenceOptions.value.partyId = [
      { value: view.partyId, title: view.partyDisplayName },
    ]
    referenceOptions.value.operatingEntityId = [
      {
        value: view.operatingEntityId,
        title: `${view.operatingEntityCode} · ${view.operatingEntityName}`,
      },
    ]
    referenceOptions.value.employeeCategoryId = view.data.employeeCategoryId
      ? [
          {
            value: view.data.employeeCategoryId,
            title:
              `${view.data.employeeCategoryCode ?? ''} · ${view.data.employeeCategoryName ?? ''}`.replace(
                /^ · | · $/g,
                '',
              ),
          },
        ]
      : []
    referenceOptions.value.departmentId = view.data.departmentId
      ? [
          {
            value: view.data.departmentId,
            title:
              `${view.data.departmentCode ?? ''} · ${view.data.departmentName ?? ''}`.replace(
                /^ · | · $/g,
                '',
              ),
          },
        ]
      : []
    referenceOptions.value.positionId = view.data.positionId
      ? [
          {
            value: view.data.positionId,
            title:
              `${view.data.positionCode ?? ''} · ${view.data.positionName ?? ''}`.replace(
                /^ · | · $/g,
                '',
              ),
          },
        ]
      : []
  }

  async function open(
    row: DclEmployeeListItem,
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
      const view = await getDclEmployee(row.objectId, approvalEntryId)
      currentView.value = view
      editContext.value =
        mode === 'edit'
          ? {
              objectId: row.objectId,
              approvalEntryId: view.approval.approvalEntryId,
              approvalRevision: view.approval.revision,
            }
          : null
      editorModel.value = dclEmployeeFormFromView(view)
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

  const openView = (row: DclEmployeeListItem, approvalEntryId?: string) =>
    open(row, 'view', approvalEntryId)
  const openEdit = (row: DclEmployeeListItem) => open(row, 'edit')
  async function openById(
    objectId: string,
    mode: 'view' | 'edit',
  ): Promise<void> {
    if (!session.can(permission('get'))) return
    const stub = { objectId } as DclEmployeeListItem
    if (mode === 'edit') return open(stub, 'view')
    await open(stub, 'view')
  }
  function closeEditor(): void {
    if (!saving.value) {
      drawerOpen.value = false
      editContext.value = null
      currentView.value = null
      editorErrorMessage.value = null
    }
  }

  async function save(form: DclEmployeeForm): Promise<boolean> {
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
      if (editorMode.value === 'create') await createDclEmployee(form)
      else {
        const context = editContext.value
        if (!context) throw new Error('未加载可编辑的人员申报版本。')
        await saveDclEmployee({
          ...context,
          enabled: currentView.value?.enabled ?? true,
          data: dclEmployeeData(form),
        })
      }
      closeEditor()
      successMessage.value = '人员申报已保存。'
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
    row: DclEmployeeListItem,
    action: 'delete' | 'submit',
  ): Promise<boolean> {
    if (!actionAvailability(row)[action] || actionLoading.value) return false
    actionLoading.value = `${action}:${row.objectId}`
    try {
      if (action === 'delete') await deleteDclEmployee(row)
      else await dclEmployeeLifecyclePort.run(row, 'submit', '')
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
    (row: DclEmployeeListItem) => row.objectId,
    (row) => row.enabled,
    actionAvailability,
    dclEmployeeLifecyclePort,
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
    hasAnyAction: (row: DclEmployeeListItem) =>
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
    deleteObject: (row: DclEmployeeListItem) => runRowAction(row, 'delete'),
    submitObject: (row: DclEmployeeListItem) => runRowAction(row, 'submit'),
    ...history,
    ...lifecycle,
  }
}
