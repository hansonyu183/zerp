import { computed, ref } from 'vue'

import {
  getTargetWflCurrentDefinition,
  queryTargetWflCurrentDefinitions,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'

type DefinitionPage = Awaited<
  ReturnType<typeof queryTargetWflCurrentDefinitions>
>
export type WflCurrentDefinition = DefinitionPage['items'][number]

export interface WflDefinitionQueryInput {
  page: number
  pageSize: 20
  keyword?: string
}

export interface WflProcessDefinitionContext {
  csrfToken: string
  permissions: readonly string[]
}

export interface WflProcessDefinitionPorts {
  query(
    csrfToken: string,
    input: WflDefinitionQueryInput,
  ): Promise<DefinitionPage>
  get(csrfToken: string, code: string): Promise<WflCurrentDefinition>
}

export function createWflProcessDefinitionViewModel(
  context: WflProcessDefinitionContext,
  ports: WflProcessDefinitionPorts,
) {
  const items = ref<WflCurrentDefinition[]>([])
  const total = ref(0)
  const page = ref(1)
  const keyword = ref('')
  const selected = ref<WflCurrentDefinition | null>(null)
  const viewerOpen = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let queryVersion = 0

  const canQuery = computed(() =>
    context.permissions.includes('/wfl/process-definition/query'),
  )
  const canGet = computed(() =>
    context.permissions.includes('/wfl/process-definition/get'),
  )

  async function query(nextPage = page.value): Promise<void> {
    if (!canQuery.value) return
    const version = ++queryVersion
    loading.value = true
    const search = keyword.value.trim()
    try {
      const result = await ports.query(context.csrfToken, {
        page: nextPage,
        pageSize: 20,
        ...(search ? { keyword: search } : {}),
      })
      if (version !== queryVersion) return
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, '流程定义查询失败。')
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function open(item: WflCurrentDefinition): Promise<void> {
    if (!canGet.value) {
      error.value = '没有权限查看流程定义详情。'
      return
    }
    loading.value = true
    try {
      selected.value = await ports.get(context.csrfToken, item.code)
      viewerOpen.value = true
      error.value = null
    } catch (cause) {
      error.value = errorMessage(cause, '流程定义详情加载失败。')
    } finally {
      loading.value = false
    }
  }

  return {
    items,
    total,
    page,
    keyword,
    selected,
    viewerOpen,
    loading,
    error,
    canQuery,
    canGet,
    query,
    open,
  }
}

export function useWflProcessDefinitionViewModel() {
  const session = useTargetSession()
  if (!session.csrfToken)
    throw new Error('WFL definition page requires an authenticated session.')
  return createWflProcessDefinitionViewModel(
    { csrfToken: session.csrfToken, permissions: session.permissions },
    {
      query: queryTargetWflCurrentDefinitions,
      get: getTargetWflCurrentDefinition,
    },
  )
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
