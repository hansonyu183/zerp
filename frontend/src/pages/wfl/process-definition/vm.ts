import { computed, onMounted, ref } from 'vue'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'

export type DefinitionNode = components['schemas']['WflDefinitionNode']
export type DefinitionEdge = components['schemas']['WflDefinitionEdge']
export type DefinitionView = components['schemas']['WflDefinitionView']
export type DefinitionListItem =
  components['schemas']['WflDefinitionListItem']

export function useProcessDefinitionViewModel() {
  const session = useSessionStore()
  const definitions = ref<DefinitionListItem[]>([])
  const selected = ref<DefinitionView | null>(null)
  const keyword = ref('')
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  const viewerOpen = ref(false)

  const can = (action: string) =>
    session.can(`/wfl/process-definition/${action}`)

  const nodeMap = computed(
    () =>
      new Map((selected.value?.nodes ?? []).map((node) => [node.key, node])),
  )

  async function query(): Promise<void> {
    if (!can('query')) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract('wfl/process-definition/query', {
        page: 1,
        pageSize: 100,
        ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      })
      definitions.value = data.items ?? []
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function resetFilters(): void {
    keyword.value = ''
    void query()
  }

  async function open(item: DefinitionListItem): Promise<void> {
    if (!can('get')) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract('wfl/process-definition/get', {
        definitionId: item.definitionId,
      })
      selected.value = data
      viewerOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  onMounted(() => void query())

  return {
    definitions,
    selected,
    keyword,
    loading,
    errorMessage,
    viewerOpen,
    nodeMap,
    can,
    query,
    resetFilters,
    open,
  }
}
