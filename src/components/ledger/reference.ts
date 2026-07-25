import { reactive } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageResult } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import type {
  LedgerReference,
  LedgerReferenceSearch,
  LedgerReferenceSource,
} from './types'

interface ReferenceListItem {
  objectId: string
  code: string
  effectiveVersionId: string | null
  currentVersion: {
    versionId: string
    status: string
    summary: Record<string, unknown> & { name?: string }
  }
}

export function createLedgerReferenceSearch(
  sources: readonly LedgerReferenceSource[],
  selected: () => readonly (LedgerReference | null)[] = () => [],
): LedgerReferenceSearch {
  const session = useSessionStore()
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let sequence = 0

  const state = reactive<LedgerReferenceSearch>({
    options: [],
    loading: false,
    errorMessage: null,
    search,
    dispose,
  })

  function search(keyword: string): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void load(keyword)
    }, 250)
  }

  async function load(keyword: string): Promise<void> {
    const missing = sources.find(
      (source) => !session.can(`/bob/${source.entity}/query`),
    )
    if (missing) {
      state.errorMessage = `缺少 ${missing.entity} 查询权限。`
      return
    }

    controller?.abort()
    controller = new AbortController()
    const current = ++sequence
    state.loading = true
    state.errorMessage = null
    try {
      const pages = await Promise.all(sources.map(async (source) => {
        const { data } = await apiClient.post<
          PageResult<ReferenceListItem>,
          {
            page: number
            pageSize: number
            filters: Record<string, unknown>
            sort: Array<{ field: string; order: 'asc' }>
          }
        >(`bob/${source.entity}/query`, {
          page: 1,
          pageSize: 20,
          filters: {
            status: ['EFFECTIVE'],
            ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
            ...(source.filters ?? {}),
          },
          sort: [{ field: 'name', order: 'asc' }],
        }, { signal: controller?.signal })
        return (data.items ?? []).flatMap((item): LedgerReference[] => {
          const versionId =
            item.effectiveVersionId ?? item.currentVersion.versionId
          const name = item.currentVersion.summary.name
          if (
            item.currentVersion.status !== 'EFFECTIVE' ||
            !versionId ||
            typeof name !== 'string'
          ) return []
          return [{
            objectId: item.objectId,
            versionId,
            entity: source.entity,
            code: item.code,
            name,
            ...(typeof item.currentVersion.summary.unit === 'string'
              ? { unit: item.currentVersion.summary.unit }
              : {}),
            ...(typeof item.currentVersion.summary.currency === 'string'
              ? { currency: item.currentVersion.summary.currency }
              : {}),
          }]
        })
      }))
      if (sequence !== current) return
      const preserved = selected().filter(
        (item): item is LedgerReference => Boolean(item),
      )
      state.options = [...preserved, ...pages.flat()].filter(
        (item, index, all) =>
          all.findIndex((candidate) =>
            candidate.objectId === item.objectId &&
            candidate.versionId === item.versionId
          ) === index,
      )
    } catch (error) {
      if (sequence === current && !controller?.signal.aborted) {
        state.errorMessage = `业务对象加载失败：${getErrorMessage(error)}`
      }
    } finally {
      if (sequence === current) state.loading = false
    }
  }

  function dispose(): void {
    if (timer) clearTimeout(timer)
    controller?.abort()
  }

  return state
}
