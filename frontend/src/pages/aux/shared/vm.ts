import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { apiClient, type AuxApiEntity } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import type { BusinessObjectField } from '@/components/business-object'
import { useSessionStore } from '@/stores/session'
import { formatReferenceLabel } from '@/utils/reference-label'
import type { AuxEntityConfig } from './config'

export type AuxListItem = components['schemas']['AuxObjectView']

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

  const path = <
    Action extends
      | 'query'
      | 'create'
      | 'save'
      | 'enable'
      | 'disable'
      | 'delete',
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
    item: Pick<AuxListItem, 'objectId' | 'code' | 'data'>,
    valueKind: 'objectId' | 'code',
  ): ReferenceOption {
    return {
      title: formatReferenceLabel({
        code: item.code,
        name: item.data.name,
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
        return [referenceOption(item, reference.value)]
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
    editing.value = row
    editorModel.value = {
      code: row.code,
      ...config.defaults(),
      ...row.data,
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
        await apiClient.postContract(path('save'), {
          objectId: editing.value.objectId,
          objectRevision: editing.value.objectRevision,
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
      await apiClient.postContract(path('delete'), {
        objectId: row.objectId,
        objectRevision: row.objectRevision,
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
    changeSort,
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
