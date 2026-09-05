import { ref } from 'vue'

import {
  getTargetSystemParameter,
  queryTargetSystemParameters,
  resetTargetSystemParameter,
  saveTargetSystemParameter,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'

type ParameterPage = Awaited<ReturnType<typeof queryTargetSystemParameters>>
type ParameterDetail = Awaited<ReturnType<typeof getTargetSystemParameter>>

export function useSystemParameterViewModel() {
  const session = useTargetSession()
  const search = ref('')
  const items = ref<ParameterPage['items']>([])
  const detail = ref<ParameterDetail | null>(null)
  const configuredValue = ref('')
  const editorOpen = ref(false)
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }

  async function query(nextPage = page.value): Promise<void> {
    loading.value = true
    try {
      const result = await queryTargetSystemParameters(csrf(), {
        page: nextPage,
        pageSize: 20,
        ...(search.value.trim()
          ? { filters: { search: search.value.trim() } }
          : {}),
        sort: [{ field: 'parameterKey', order: 'asc' }],
      })
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '系统参数查询失败。'
    } finally {
      loading.value = false
    }
  }

  async function openEdit(key: string): Promise<void> {
    editorOpen.value = true
    try {
      const current = await getTargetSystemParameter(csrf(), key)
      detail.value = current
      configuredValue.value = current.configuredValue
      error.value = null
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '系统参数加载失败。'
    }
  }

  async function readBack(key: string): Promise<void> {
    const current = await getTargetSystemParameter(csrf(), key)
    detail.value = current
    configuredValue.value = current.configuredValue
  }

  async function save(): Promise<void> {
    if (!detail.value || saving.value) return
    saving.value = true
    try {
      await saveTargetSystemParameter(csrf(), {
        key: detail.value.parameterKey,
        configuredValue: configuredValue.value,
        revision: Number(detail.value.revision),
      })
      await readBack(detail.value.parameterKey)
      await query(page.value)
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '系统参数保存失败。'
    } finally {
      saving.value = false
    }
  }

  async function reset(): Promise<void> {
    if (!detail.value || saving.value) return
    saving.value = true
    try {
      await resetTargetSystemParameter(csrf(), {
        key: detail.value.parameterKey,
        revision: Number(detail.value.revision),
      })
      await readBack(detail.value.parameterKey)
      await query(page.value)
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '系统参数重置失败。'
    } finally {
      saving.value = false
    }
  }

  return {
    search,
    items,
    detail,
    configuredValue,
    editorOpen,
    total,
    page,
    loading,
    saving,
    error,
    query,
    openEdit,
    save,
    reset,
  }
}
