import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { apiClient, type ApiPostPath } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type { BusinessObjectField } from '@/components/business-object'
import { useSessionStore } from '@/stores/session'
import type { AuxEntityConfig } from './config'

export interface AuxVersion {
  versionId: string
  version: number
  data: Record<string, unknown>
  createdAt: string
  createdBy: string
}

export interface AuxListItem {
  objectId: string
  entity: string
  code: string
  enabled: boolean
  objectRevision: number
  currentVersion: AuxVersion
  updatedAt: string
  updatedBy: string
}

interface AuxPage {
  items: AuxListItem[]
  total: number
  page: number
  pageSize: number
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
  const loading = ref(false)
  const saving = ref(false)
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

  const path = (action: string) =>
    `aux/${config.entity}/${action}` as ApiPostPath

  async function query(): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const filters: Record<string, unknown> = {}
      if (keyword.value.trim()) filters.keyword = keyword.value.trim()
      if (enabled.value !== null) filters.enabled = enabled.value
      const result = await apiClient.post<AuxPage>(path('query'), {
        page: page.value,
        pageSize: pageSize.value,
        filters,
        sort: [{ field: 'updatedAt', order: 'desc' }],
      } as never)
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
    await search()
  }

  async function changePage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === page.value || loading.value) return
    page.value = nextPage
    await query()
  }

  function referenceOption(
    item: Pick<AuxListItem, 'objectId' | 'code' | 'currentVersion'>,
    valueKind: 'objectId' | 'code',
  ): ReferenceOption {
    return {
      title: `${item.code} · ${String(item.currentVersion.data.name ?? '')}`,
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
      const result = await apiClient.post<AuxListItem>(
        `aux/${reference.entity}/get` as ApiPostPath,
        { objectId: selectedValue } as never,
      )
      return referenceOption(result.data, reference.value)
    }
    const result = await apiClient.post<AuxPage>(
      `aux/${reference.entity}/query` as ApiPostPath,
      {
        page: 1,
        pageSize: 20,
        filters: { keyword: selectedValue },
        sort: [{ field: 'code', order: 'asc' }],
      } as never,
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
      const result = await apiClient.post<AuxPage>(
        `aux/${reference.entity}/query` as ApiPostPath,
        {
          page: 1,
          pageSize: 100,
          filters: {
            enabled: true,
            ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          },
          sort: [{ field: 'code', order: 'asc' }],
        } as never,
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
      const fetched = result.data.items
        .filter((item) => item.objectId !== editing.value?.objectId)
        .map((item) => referenceOption(item, reference.value))
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
    editing.value = row
    editorModel.value = {
      code: row.code,
      ...config.defaults(),
      ...row.currentVersion.data,
    }
    editorResetKey.value += 1
    editorOpen.value = true
    void loadReferences()
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
        await apiClient.post(path('save'), {
          objectId: editing.value.objectId,
          revision: editing.value.objectRevision,
          data,
        })
      } else {
        await apiClient.post(path('create'), {
          data,
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
      await apiClient.post(path(row.enabled ? 'disable' : 'enable'), {
        objectId: row.objectId,
        revision: row.objectRevision,
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
      await apiClient.post(path('delete'), {
        objectId: row.objectId,
        revision: row.objectRevision,
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
    loading,
    saving,
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
    query,
    search,
    resetFilters,
    changePage,
    openCreate,
    openEdit,
    closeEditor,
    searchEditorReference,
    save,
    changeEnabled,
    deleteObject,
  }
}

export type AuxEntityViewModel = ReturnType<typeof createAuxEntityViewModel>
