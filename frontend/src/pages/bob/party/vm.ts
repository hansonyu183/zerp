import { computed, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { partyApi } from './api'

type PartyKind = components['schemas']['PartyKind']
type PartyListItem = components['schemas']['PartyListItem']
type PartyView = components['schemas']['PartyView']

export function usePartyViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  const rows = ref<PartyListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const keywordDraft = ref('')
  const kindDraft = ref<PartyKind | ''>('')
  const keyword = ref('')
  const kind = ref<PartyKind | ''>('')
  const detail = ref<PartyView | null>(null)
  const detailOpen = ref(false)

  const canQuery = computed(() => session.can('/bob/party/query'))
  const canGet = computed(() => session.can('/bob/party/get'))

  async function query(): Promise<void> {
    if (!canQuery.value) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await partyApi.query({
        page: page.value,
        pageSize: 20,
        filters: {
          ...(keyword.value ? { keyword: keyword.value } : {}),
          ...(kind.value ? { kind: kind.value } : {}),
        },
      })
      rows.value = data.items ?? []
      total.value = data.total
      page.value = data.page
    } catch (error) {
      rows.value = []
      total.value = 0
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function submitFilters(): Promise<void> {
    keyword.value = keywordDraft.value.trim()
    kind.value = kindDraft.value
    page.value = 1
    await query()
  }

  async function resetFilters(): Promise<void> {
    keywordDraft.value = ''
    kindDraft.value = ''
    await submitFilters()
  }

  async function open(row: PartyListItem): Promise<void> {
    if (!canGet.value || loading.value) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await partyApi.get({ partyId: row.partyId })
      detail.value = data
      detailOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function close(): void {
    detailOpen.value = false
    detail.value = null
  }

  function canOpenRelationship(
    entity: components['schemas']['PartyRelationshipCard']['entity'],
  ): boolean {
    return session.can(`/bob/${entity}/get`)
  }

  return {
    loading,
    errorMessage,
    rows,
    total,
    page,
    keywordDraft,
    kindDraft,
    detail,
    detailOpen,
    canQuery,
    canGet,
    query,
    submitFilters,
    resetFilters,
    open,
    close,
    canOpenRelationship,
  }
}

export type PartyViewModel = ReturnType<typeof usePartyViewModel>
