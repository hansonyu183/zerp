import { computed, reactive, ref } from 'vue'
import { apiClient, type ApiPostPath } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type { BusinessObjectField } from '@/components/business-object'
import { useSessionStore } from '@/stores/session'
import { generateObjectCode } from '@/utils/object-code'
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
  const referenceOptions = reactive<
    Record<string, { title: string; value: string }[]>
  >({})
  const referenceLoading = ref(false)

  const canCreate = computed(() => session.can(`/aux/${config.entity}/create`))
  const editorFields = computed<
    readonly BusinessObjectField<Record<string, unknown>>[]
  >(() => [
    {
      key: 'code',
      label: '编码',
      type: 'readonly',
      required: true,
    },
    ...config.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type === 'reference'
        ? 'autocomplete' as const
        : field.type ?? 'text',
      required: field.required,
      clearable: !field.required,
      options: field.reference
        ? referenceOptions[field.key] ?? []
        : field.options,
      loading: field.type === 'reference' && referenceLoading.value,
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

  async function loadReferences(): Promise<void> {
    const fields = config.fields.filter((field) => field.reference)
    if (!fields.length) return
    referenceLoading.value = true
    try {
      await Promise.all(
        fields.map(async (field) => {
          const reference = field.reference
          if (!reference) return
          const result = await apiClient.post<AuxPage>(
            `aux/${reference.entity}/query` as ApiPostPath,
            {
              page: 1,
              pageSize: 200,
              filters: { enabled: true },
              sort: [{ field: 'code', order: 'asc' }],
            } as never,
          )
          referenceOptions[field.key] = result.data.items
            .filter((item) => item.objectId !== editing.value?.objectId)
            .map((item) => ({
              title: `${item.code} · ${String(item.currentVersion.data.name ?? '')}`,
              value: reference.value === 'code' ? item.code : item.objectId,
            }))
        }),
      )
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      referenceLoading.value = false
    }
  }

  function openCreate(): void {
    editing.value = null
    editorModel.value = {
      code: generateObjectCode('aux', config.entity),
      ...config.defaults(),
    }
    editorResetKey.value += 1
    editorOpen.value = true
    void loadReferences()
  }

  function openEdit(row: AuxListItem): void {
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
    saving.value = true
    errorMessage.value = null
    try {
      editorModel.value = structuredClone(value)
      const { code, ...data } = value
      if (editing.value) {
        await apiClient.post(path('save'), {
          objectId: editing.value.objectId,
          revision: editing.value.objectRevision,
          code: String(code),
          data,
        })
      } else {
        await apiClient.post(path('create'), {
          data: { code: String(code), ...data },
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
    query,
    search,
    resetFilters,
    changePage,
    openCreate,
    openEdit,
    closeEditor,
    save,
    changeEnabled,
    deleteObject,
  }
}

export type AuxEntityViewModel = ReturnType<typeof createAuxEntityViewModel>
