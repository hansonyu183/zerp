import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { apiClient, type AuxApiEntity } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import type { BusinessObjectField } from '@/components/business-object'
import { type ApprovalAction, visibleApprovalActions } from '@/shared/approval'
import { useSessionStore } from '@/stores/session'
import { formatReferenceLabel } from '@/utils/reference-label'
import type { AuxEntityConfig } from './config'

export type AuxVersion = components['schemas']['AuxVersionView']
export type AuxListItem = components['schemas']['AuxObjectView']
export type AuxAuditEvent = components['schemas']['ApprovalEventView']

export function auxListActiveVersion(
  item: Pick<AuxListItem, 'latestApproved' | 'openVersion'>,
): AuxVersion | null {
  return item.openVersion ?? item.latestApproved
}

interface ReferenceOption {
  title: string
  value: string
}

export function createAuxEntityViewModel(config: AuxEntityConfig) {
  const session = useSessionStore()
  const rows = ref<AuxListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const enabled = ref<boolean | null>(null)
  const filterValues = reactive<Record<string, string>>({})
  const sort = ref<{ field: 'code'; order: 'asc' | 'desc' }>({
    field: 'code',
    order: 'asc',
  })
  const loading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<ApprovalAction | null>(null)
  const errorMessage = ref<string | null>(null)
  const editorOpen = ref(false)
  const editorResetKey = ref(0)
  const editing = ref<AuxListItem | null>(null)
  const editorModel = ref<Record<string, unknown>>({
    code: '',
    ...config.defaults(),
  })
  const referenceOptions = reactive<Record<string, ReferenceOption[]>>({})
  const referenceLoading = reactive<Record<string, boolean>>({})
  const referenceSequences = new Map<string, number>()
  const referenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const canCreate = computed(() => session.can(`/aux/${config.entity}/create`))
  const canSave = computed(() => session.can(`/aux/${config.entity}/save`))
  const canEnable = computed(() => session.can(`/aux/${config.entity}/enable`))
  const canDisable = computed(() =>
    session.can(`/aux/${config.entity}/disable`),
  )
  const canDelete = computed(() => session.can(`/aux/${config.entity}/delete`))
  const canVersions = computed(() =>
    session.can(`/aux/${config.entity}/versions`),
  )
  const canAuditHistory = computed(() =>
    session.can(`/aux/${config.entity}/audit-history`),
  )
  const versionsOpen = ref(false)
  const versionsLoading = ref(false)
  const versions = ref<AuxVersion[]>([])
  const versionsPage = ref(1)
  const versionsPageSize = ref(20)
  const versionsTotal = ref(0)
  const historyObject = ref<AuxListItem | null>(null)
  const auditOpen = ref(false)
  const auditLoading = ref(false)
  const auditEvents = ref<AuxAuditEvent[]>([])
  const auditPage = ref(1)
  const auditPageSize = ref(20)
  const auditTotal = ref(0)
  const editorFields = computed<
    readonly BusinessObjectField<Record<string, unknown>>[]
  >(() => [
    ...(editing.value
      ? [
          {
            key: 'code',
            label: '编码',
            type: 'readonly',
            required: true,
          } as BusinessObjectField<Record<string, unknown>>,
        ]
      : []),
    ...config.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type:
        field.type === 'reference'
          ? ('autocomplete' as const)
          : (field.type ?? 'text'),
      required: field.required,
      clearable: !field.required,
      options: field.reference
        ? (referenceOptions[field.key] ?? [])
        : field.options,
      loading:
        field.type === 'reference' && Boolean(referenceLoading[field.key]),
      visible: field.visible
        ? (record: Readonly<Record<string, unknown>>) =>
            field.visible?.(record as Record<string, unknown>) ?? true
        : undefined,
    })),
  ])

  const path = <
    Action extends
      | 'query'
      | 'create'
      | 'save'
      | 'submit'
      | 'unsubmit'
      | 'approve'
      | 'reject'
      | 'unapprove'
      | 'enable'
      | 'disable'
      | 'delete'
      | 'versions'
      | 'audit-history',
  >(
    action: Action,
  ): `aux/${AuxApiEntity}/${Action}` => `aux/${config.entity}/${action}`

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const requestFilters: Record<string, unknown> = {}
      if (keyword.value.trim()) requestFilters.keyword = keyword.value.trim()
      if (enabled.value !== null) requestFilters.enabled = enabled.value
      for (const field of config.filters ?? []) {
        const value = filterValues[field.key]?.trim()
        if (value) requestFilters[field.key] = value
      }
      const result = await apiClient.postContract(path('query'), {
        page: page.value,
        pageSize: pageSize.value,
        filters: requestFilters,
        sort: [{ ...sort.value }],
      })
      rows.value = result.data.items
      total.value = result.data.total
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function search(): Promise<void> {
    page.value = 1
    await query()
  }

  async function resetFilters(): Promise<void> {
    keyword.value = ''
    enabled.value = null
    for (const field of config.filters ?? []) filterValues[field.key] = ''
    sort.value = { field: 'code', order: 'asc' }
    await search()
  }

  async function changeSort(value: {
    field: 'code'
    order: 'asc' | 'desc'
  }): Promise<void> {
    sort.value = value
    await search()
  }

  async function changePage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === page.value || loading.value) return
    page.value = nextPage
    await query()
  }

  function referenceOption(
    item: Pick<
      AuxListItem,
      'objectId' | 'code' | 'latestApproved' | 'openVersion'
    >,
    valueKind: 'objectId' | 'code',
  ): ReferenceOption | null {
    const version = auxListActiveVersion(item)
    if (!version) return null
    return {
      title: formatReferenceLabel({
        code: item.code,
        name: version.data.name,
      }),
      value: valueKind === 'code' ? item.code : item.objectId,
    }
  }

  async function selectedReferenceOption(
    field: (typeof config.fields)[number],
    selectedValue: string,
  ): Promise<ReferenceOption | null> {
    const reference = field.reference
    if (!reference || !selectedValue) return null
    if (reference.value === 'objectId') {
      const result = await apiClient.postContract(
        `aux/${reference.entity}/get`,
        { objectId: selectedValue },
      )
      return result.data ? referenceOption(result.data, reference.value) : null
    }
    const result = await apiClient.postContract(
      `aux/${reference.entity}/query`,
      {
        page: 1,
        pageSize: 20,
        filters: { keyword: selectedValue },
        sort: [{ field: 'code', order: 'asc' }],
      },
    )
    const selected = result.data.items.find(
      (item) => item.code === selectedValue,
    )
    return selected ? referenceOption(selected, reference.value) : null
  }

  async function loadReference(
    field: (typeof config.fields)[number],
    keyword: string,
  ): Promise<void> {
    const reference = field.reference
    if (!reference) return
    const sequence = (referenceSequences.get(field.key) ?? 0) + 1
    referenceSequences.set(field.key, sequence)
    referenceLoading[field.key] = true
    try {
      const result = await apiClient.postContract(
        `aux/${reference.entity}/query`,
        {
          page: 1,
          pageSize: 100,
          filters: {
            enabled: true,
            ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          },
          sort: [{ field: 'code', order: 'asc' }],
        },
      )
      const selectedValue = String(editorModel.value[field.key] ?? '')
      let selected = referenceOptions[field.key]?.find(
        (option) => option.value === selectedValue,
      )
      if (
        selectedValue &&
        !selected &&
        !result.data.items.some(
          (item) =>
            (reference.value === 'code' ? item.code : item.objectId) ===
            selectedValue,
        )
      ) {
        selected =
          (await selectedReferenceOption(field, selectedValue)) ?? undefined
      }
      if (referenceSequences.get(field.key) !== sequence) return
      const fetched = result.data.items.flatMap((item) => {
        if (item.objectId === editing.value?.objectId) return []
        const option = referenceOption(item, reference.value)
        return option ? [option] : []
      })
      referenceOptions[field.key] = selected
        ? [
            selected,
            ...fetched.filter((option) => option.value !== selected?.value),
          ]
        : fetched
    } catch (error) {
      if (referenceSequences.get(field.key) === sequence) {
        errorMessage.value = getErrorMessage(error)
      }
    } finally {
      if (referenceSequences.get(field.key) === sequence) {
        referenceLoading[field.key] = false
      }
    }
  }

  async function loadReferences(): Promise<void> {
    await Promise.all(
      config.fields
        .filter((field) => field.reference)
        .map((field) => loadReference(field, '')),
    )
  }

  function searchEditorReference(fieldKey: string, keyword: string): void {
    const field = config.fields.find((item) => item.key === fieldKey)
    if (!field?.reference) return
    const previous = referenceTimers.get(fieldKey)
    if (previous) clearTimeout(previous)
    referenceTimers.set(
      fieldKey,
      setTimeout(() => {
        referenceTimers.delete(fieldKey)
        void loadReference(field, keyword)
      }, 250),
    )
  }

  function openCreate(): void {
    if (!canCreate.value) return
    editing.value = null
    editorModel.value = {
      ...config.defaults(),
    }
    editorResetKey.value += 1
    editorOpen.value = true
    void loadReferences()
  }

  function openEdit(row: AuxListItem): void {
    if (!canSave.value) return
    const version = auxListActiveVersion(row)
    if (!version || version.approval.status === 'PENDING') return
    editing.value = row
    editorModel.value = {
      code: row.code,
      ...config.defaults(),
      ...version.data,
    }
    editorResetKey.value += 1
    editorOpen.value = true
    void loadReferences()
  }

  function approvalActions(row: AuxListItem): ApprovalAction[] {
    const version = auxListActiveVersion(row)
    if (!version || !session.user?.id) return []
    return visibleApprovalActions(version.approval, session.user.id, (action) =>
      session.can(`/aux/${config.entity}/${action}`),
    )
  }

  async function runApprovalAction(
    row: AuxListItem,
    action: ApprovalAction,
    reason = '',
  ): Promise<boolean> {
    const version = auxListActiveVersion(row)
    if (
      !version ||
      actionLoading.value ||
      !approvalActions(row).includes(action)
    ) {
      return false
    }
    const normalizedReason = reason.trim()
    if ((action === 'reject' || action === 'unapprove') && !normalizedReason) {
      errorMessage.value = '请填写操作原因。'
      return false
    }
    actionLoading.value = action
    errorMessage.value = null
    const base = {
      objectId: row.objectId,
      approvalEntryId: version.approval.approvalEntryId,
      approvalRevision: version.approval.revision,
    }
    try {
      if (action === 'reject' || action === 'unapprove') {
        await apiClient.postContract(path(action), {
          ...base,
          reason: normalizedReason,
        })
      } else {
        await apiClient.postContract(path(action), base)
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

  async function loadVersions(): Promise<void> {
    const object = historyObject.value
    if (!object) return
    versionsLoading.value = true
    try {
      const result = await apiClient.postContract(path('versions'), {
        objectId: object.objectId,
        page: versionsPage.value,
        pageSize: versionsPageSize.value,
      })
      versions.value = result.data.items
      versionsTotal.value = result.data.total
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      versionsLoading.value = false
    }
  }

  async function openVersions(row: AuxListItem): Promise<void> {
    if (!canVersions.value) return
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

  async function loadAuditHistory(): Promise<void> {
    const object = historyObject.value
    if (!object) return
    auditLoading.value = true
    try {
      const result = await apiClient.postContract(path('audit-history'), {
        objectId: object.objectId,
        page: auditPage.value,
        pageSize: auditPageSize.value,
      })
      auditEvents.value = result.data.items
      auditTotal.value = result.data.total
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      auditLoading.value = false
    }
  }

  async function openAuditHistory(row: AuxListItem): Promise<void> {
    if (!canAuditHistory.value) return
    historyObject.value = row
    auditEvents.value = []
    auditPage.value = 1
    auditOpen.value = true
    await loadAuditHistory()
  }

  async function changeAuditPage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === auditPage.value) return
    auditPage.value = nextPage
    await loadAuditHistory()
  }

  function closeEditor(): void {
    if (saving.value) return
    editorOpen.value = false
  }

  async function save(value: Record<string, unknown>): Promise<void> {
    if (editing.value ? !canSave.value : !canCreate.value) return
    saving.value = true
    errorMessage.value = null
    try {
      editorModel.value = structuredClone(value)
      const data = Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== 'code'),
      )
      if (editing.value) {
        const version = auxListActiveVersion(editing.value)
        if (!version) throw new Error('资料没有可编辑的开放版本或已批准版本。')
        await apiClient.postContract(path('save'), {
          objectId: editing.value.objectId,
          approvalEntryId: version.approval.approvalEntryId,
          approvalRevision: version.approval.revision,
          data,
        })
      } else {
        await apiClient.postContract(path('create'), {
          data: { ...data, name: String(value.name ?? '') },
        })
      }
      editorOpen.value = false
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  async function changeEnabled(row: AuxListItem): Promise<void> {
    if (row.enabled ? !canDisable.value : !canEnable.value) return
    errorMessage.value = null
    try {
      await apiClient.postContract(path(row.enabled ? 'disable' : 'enable'), {
        objectId: row.objectId,
        objectRevision: row.objectRevision,
      })
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  async function deleteObject(row: AuxListItem): Promise<void> {
    if (!canDelete.value) return
    errorMessage.value = null
    try {
      const version = auxListActiveVersion(row)
      if (!version) throw new Error('资料没有可删除的开放版本或已批准版本。')
      await apiClient.postContract(path('delete'), {
        objectId: row.objectId,
        approvalEntryId: version.approval.approvalEntryId,
        approvalRevision: version.approval.revision,
      })
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      for (const timer of referenceTimers.values()) clearTimeout(timer)
      referenceTimers.clear()
    })
  }

  return {
    config,
    rows,
    total,
    page,
    pageSize,
    keyword,
    enabled,
    filterValues,
    sort,
    loading,
    saving,
    actionLoading,
    errorMessage,
    editorOpen,
    editorResetKey,
    editing,
    editorModel,
    editorFields,
    referenceOptions,
    referenceLoading,
    canCreate,
    canSave,
    canEnable,
    canDisable,
    canDelete,
    canVersions,
    canAuditHistory,
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
    query,
    search,
    resetFilters,
    changeSort,
    changePage,
    openCreate,
    openEdit,
    approvalActions,
    runApprovalAction,
    openVersions,
    changeVersionsPage,
    openAuditHistory,
    changeAuditPage,
    closeEditor,
    searchEditorReference,
    save,
    changeEnabled,
    deleteObject,
  }
}

export type AuxEntityViewModel = ReturnType<typeof createAuxEntityViewModel>
