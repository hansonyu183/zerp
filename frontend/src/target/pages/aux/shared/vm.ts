import { computed, reactive, ref } from 'vue'

import {
  createTargetAux,
  deleteTargetAux,
  getTargetAux,
  queryTargetAux,
  saveTargetAux,
  setTargetAuxEnabled,
  type TargetAuxCreateInput,
  type TargetAuxEntity,
  type TargetAuxQueryInput,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { auxEntityConfigs } from './config.ts'

type AuxPage = Awaited<ReturnType<typeof queryTargetAux>>
type AuxDetail = Awaited<ReturnType<typeof getTargetAux>>

export function useAuxMaintenanceViewModel(entity: TargetAuxEntity) {
  const session = useTargetSession()
  const config = auxEntityConfigs[entity]
  const filters = reactive({
    keyword: '',
    enabled: '' as '' | 'true' | 'false',
  })
  const items = ref<AuxPage['items']>([])
  const detail = ref<AuxDetail | null>(null)
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const editorOpen = ref(false)
  const editorMode = ref<'create' | 'edit'>('create')
  const editorData = reactive<Record<string, string | number>>({
    ...config.defaults,
  })
  const relationOptions = reactive<
    Record<string, Array<{ title: string; value: string }>>
  >({})
  let queryVersion = 0

  const canCreate = computed(
    () => config.canCreate && session.can(`/aux/${entity}/create`),
  )
  const canDelete = computed(
    () => config.canDelete && session.can(`/aux/${entity}/delete`),
  )
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const errorMessage = (cause: unknown, fallback: string) =>
    cause instanceof Error && cause.message ? cause.message : fallback

  function queryInput(nextPage: number, pageSize = 20): TargetAuxQueryInput {
    const selected = {
      ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
      ...(filters.enabled ? { enabled: filters.enabled === 'true' } : {}),
    }
    return {
      page: nextPage,
      pageSize,
      ...(Object.keys(selected).length ? { filters: selected } : {}),
      sort: [{ field: 'code', order: 'asc' }],
    }
  }

  async function query(nextPage = page.value): Promise<void> {
    const version = ++queryVersion
    loading.value = true
    try {
      const result = await queryTargetAux(csrf(), entity, queryInput(nextPage))
      if (version !== queryVersion) return
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, `${config.title}查询失败。`)
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function loadRelations(currentId?: string): Promise<void> {
    const targets = [
      ...new Set(
        config.fields
          .map((field) => field.relationEntity)
          .filter((value) => value !== undefined),
      ),
    ]
    await Promise.all(
      targets.map(async (target) => {
        const result = await queryTargetAux(csrf(), target, {
          page: 1,
          pageSize: 100,
          filters: { enabled: true },
          sort: [{ field: 'name', order: 'asc' }],
        })
        relationOptions[target] = result.items
          .filter((item) => item.objectId !== currentId)
          .map((item) => ({
            title: `${item.code} · ${String(item.data.name ?? '')}`,
            value: item.objectId,
          }))
      }),
    )
  }

  function applyDetail(current: AuxDetail): void {
    detail.value = current
    for (const field of config.fields) {
      const value = current.data[field.key]
      editorData[field.key] =
        typeof value === 'number' || typeof value === 'string' ? value : ''
    }
  }

  function openCreate(): void {
    detail.value = null
    Object.keys(editorData).forEach((key) => delete editorData[key])
    Object.assign(editorData, config.defaults)
    editorMode.value = 'create'
    editorOpen.value = true
    error.value = null
    void loadRelations().catch((cause) => {
      error.value = errorMessage(cause, '关联选项加载失败。')
    })
  }

  async function openEdit(objectId: string): Promise<void> {
    editorMode.value = 'edit'
    editorOpen.value = true
    loading.value = true
    error.value = null
    try {
      const [current] = await Promise.all([
        getTargetAux(csrf(), entity, objectId),
        loadRelations(objectId),
      ])
      applyDetail(current)
    } catch (cause) {
      error.value = errorMessage(cause, `${config.title}详情加载失败。`)
    } finally {
      loading.value = false
    }
  }

  function dataForSave(): TargetAuxCreateInput['data'] {
    const data: Record<string, unknown> = {}
    for (const field of config.fields) {
      const value = editorData[field.key]
      data[field.key] = field.kind === 'integer' ? Number(value) : value
    }
    return { ...data, name: String(data.name ?? '').trim() }
  }

  async function readBack(objectId: string): Promise<void> {
    applyDetail(await getTargetAux(csrf(), entity, objectId))
  }

  async function save(): Promise<void> {
    if (saving.value) return
    saving.value = true
    error.value = null
    try {
      if (editorMode.value === 'create') {
        if (entity === 'settlement-method')
          throw new Error('结算方式不允许新增。')
        const created = await createTargetAux(csrf(), entity, {
          data: dataForSave(),
        })
        editorMode.value = 'edit'
        await readBack(created.objectId)
      } else if (detail.value) {
        await saveTargetAux(csrf(), entity, {
          objectId: detail.value.objectId,
          objectRevision: Number(detail.value.objectRevision),
          data: dataForSave(),
        })
        await readBack(detail.value.objectId)
      }
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, `${config.title}保存失败。`)
    } finally {
      saving.value = false
    }
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    if (!detail.value || saving.value) return
    saving.value = true
    try {
      await setTargetAuxEnabled(
        csrf(),
        entity,
        {
          objectId: detail.value.objectId,
          objectRevision: Number(detail.value.objectRevision),
        },
        enabled,
      )
      await readBack(detail.value.objectId)
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(
        cause,
        `${config.title}${enabled ? '启用' : '停用'}失败。`,
      )
    } finally {
      saving.value = false
    }
  }

  async function remove(): Promise<void> {
    if (!detail.value || entity === 'settlement-method' || saving.value) return
    saving.value = true
    try {
      await deleteTargetAux(csrf(), entity, {
        objectId: detail.value.objectId,
        objectRevision: Number(detail.value.objectRevision),
      })
      editorOpen.value = false
      detail.value = null
      await query(1)
    } catch (cause) {
      error.value = errorMessage(
        cause,
        `${config.title}删除失败，请检查引用阻断。`,
      )
    } finally {
      saving.value = false
    }
  }

  return {
    entity,
    config,
    filters,
    items,
    detail,
    total,
    page,
    loading,
    saving,
    error,
    editorOpen,
    editorMode,
    editorData,
    relationOptions,
    canCreate,
    canDelete,
    query,
    openCreate,
    openEdit,
    save,
    setEnabled,
    remove,
  }
}
