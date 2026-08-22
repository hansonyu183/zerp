import { computed, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { partyApi } from './api'

type PartyListItem = components['schemas']['PartyListItem']
type PartyView = components['schemas']['PartyView']
type PartyKind = components['schemas']['PartyKind']
type PartyIdentifier = components['schemas']['PartyIdentifier']
type PartyMergePreflightResult =
  components['schemas']['PartyMergePreflightResult']

export interface PartyForm {
  kind: PartyKind
  legalName: string
  displayName: string
  taxNumber: string
  strongIdentifiers: PartyIdentifier[]
  phone: string
  email: string
  address: string
}

const emptyForm = (): PartyForm => ({
  kind: 'ORGANIZATION',
  legalName: '',
  displayName: '',
  taxNumber: '',
  strongIdentifiers: [],
  phone: '',
  email: '',
  address: '',
})

export function usePartyViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const rows = ref<PartyListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const keywordDraft = ref('')
  const kindDraft = ref<PartyKind | ''>('')
  const mergedDraft = ref(false)
  const keyword = ref('')
  const kind = ref<PartyKind | ''>('')
  const merged = ref(false)
  const detail = ref<PartyView | null>(null)
  const form = ref<PartyForm>(emptyForm())
  const editorOpen = ref(false)
  const mergeOpen = ref(false)
  const mergeTargetKeyword = ref('')
  const mergeTargetRows = ref<PartyListItem[]>([])
  const mergeTarget = ref<PartyListItem | null>(null)
  const mergePreflight = ref<PartyMergePreflightResult | null>(null)
  const mergeResolutions = ref<Record<string, string>>({})
  let savedSignature = ''

  const canQuery = computed(() => session.can('/bob/party/query'))
  const canGet = computed(() => session.can('/bob/party/get'))
  const canSave = computed(() => session.can('/bob/party/save'))
  const canModify = computed(
    () => canSave.value && !detail.value?.mergedIntoPartyId,
  )
  const canMerge = computed(
    () =>
      session.can('/bob/party/merge-preflight') &&
      session.can('/bob/party/merge-confirm'),
  )
  const isDirty = computed(
    () => editorOpen.value && JSON.stringify(form.value) !== savedSignature,
  )

  async function query(): Promise<void> {
    if (!canQuery.value) return
    loading.value = true
    errorMessage.value = null
    try {
      const result = await partyApi.query({
        page: page.value,
        pageSize: 20,
        filters: {
          ...(keyword.value ? { keyword: keyword.value } : {}),
          ...(kind.value ? { kind: kind.value } : {}),
          ...(merged.value ? { merged: true } : {}),
        },
      })
      rows.value = result.data.items
      total.value = result.data.total
      page.value = result.data.page
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
    merged.value = mergedDraft.value
    page.value = 1
    await query()
  }

  async function resetFilters(): Promise<void> {
    keywordDraft.value = ''
    kindDraft.value = ''
    mergedDraft.value = false
    await submitFilters()
  }

  async function open(row: PartyListItem): Promise<void> {
    if (!canGet.value) return
    loading.value = true
    errorMessage.value = null
    try {
      const result = await partyApi.get({ partyId: row.partyId })
      detail.value = result.data
      form.value = {
        kind: result.data.kind,
        legalName: result.data.legalName,
        displayName: result.data.displayName,
        taxNumber: result.data.taxNumber ?? '',
        strongIdentifiers: result.data.strongIdentifiers.map((identifier) => ({
          ...identifier,
        })),
        phone: result.data.phone ?? '',
        email: result.data.email ?? '',
        address: result.data.address ?? '',
      }
      savedSignature = JSON.stringify(form.value)
      editorOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function impactMessage(): string {
    const visible = detail.value?.relationships ?? []
    const suffix = visible.length
      ? `\n当前可见的受影响关系：${visible.map((item) => `${item.code} · ${item.operatingEntityName}`).join('、')}`
      : ''
    return `主体资料修改会影响之后全部业务关系中的显示与引用，历史单据快照不会改变。${suffix}`
  }

  async function save(): Promise<boolean> {
    if (!detail.value || !canModify.value || !form.value.legalName.trim())
      return false
    saving.value = true
    errorMessage.value = null
    try {
      const result = await partyApi.save({
        partyId: detail.value.partyId,
        revision: detail.value.revision,
        data: {
          kind: form.value.kind,
          legalName: form.value.legalName.trim(),
          displayName: form.value.displayName.trim(),
          taxNumber: form.value.taxNumber.trim(),
          strongIdentifiers: form.value.strongIdentifiers.map((identifier) => ({
            type: identifier.type,
            value: identifier.value.trim(),
          })),
          phone: form.value.phone.trim(),
          email: form.value.email.trim(),
          address: form.value.address.trim(),
        },
      })
      detail.value = {
        ...result.data,
        relationships: detail.value.relationships,
      }
      savedSignature = JSON.stringify(form.value)
      successMessage.value = '主体资料已保存。'
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  function close(): boolean {
    if (isDirty.value && !window.confirm('尚有未保存修改，确认关闭？'))
      return false
    editorOpen.value = false
    detail.value = null
    return true
  }

  function canOpenRelationship(
    entity: components['schemas']['PartyRelationshipCard']['entity'],
  ): boolean {
    return session.can(`/bob/${entity}/get`)
  }

  function addIdentifier(): void {
    if (!canModify.value) return
    form.value.strongIdentifiers.push({
      type:
        form.value.kind === 'PERSON'
          ? 'PERSON_ID'
          : 'UNIFIED_SOCIAL_CREDIT_CODE',
      value: '',
    })
  }

  function removeIdentifier(index: number): void {
    if (!canModify.value) return
    form.value.strongIdentifiers.splice(index, 1)
  }

  function resetMergePreflight(): void {
    mergePreflight.value = null
    mergeResolutions.value = {}
  }

  function openMerge(): void {
    if (!detail.value || detail.value.mergedIntoPartyId || !canMerge.value)
      return
    mergeTargetKeyword.value = ''
    mergeTargetRows.value = []
    mergeTarget.value = null
    resetMergePreflight()
    mergeOpen.value = true
  }

  function closeMerge(): void {
    mergeOpen.value = false
    mergeTarget.value = null
    resetMergePreflight()
  }

  async function searchMergeTargets(): Promise<void> {
    if (!detail.value || !canQuery.value) return
    loading.value = true
    errorMessage.value = null
    try {
      const result = await partyApi.query({
        page: 1,
        pageSize: 20,
        filters: {
          ...(mergeTargetKeyword.value.trim()
            ? { keyword: mergeTargetKeyword.value.trim() }
            : {}),
          kind: detail.value.kind,
        },
      })
      mergeTargetRows.value = result.data.items.filter(
        (item) => item.partyId !== detail.value?.partyId,
      )
      if (
        mergeTarget.value &&
        !mergeTargetRows.value.some(
          (item) => item.partyId === mergeTarget.value?.partyId,
        )
      ) {
        mergeTarget.value = null
        resetMergePreflight()
      }
    } catch (error) {
      mergeTargetRows.value = []
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function selectMergeTarget(partyId: string | null): void {
    mergeTarget.value =
      mergeTargetRows.value.find((item) => item.partyId === partyId) ?? null
    resetMergePreflight()
  }

  async function preflightMerge(): Promise<boolean> {
    if (!detail.value || !mergeTarget.value || !canMerge.value) return false
    saving.value = true
    errorMessage.value = null
    try {
      const result = await partyApi.mergePreflight({
        sourcePartyId: detail.value.partyId,
        targetPartyId: mergeTarget.value.partyId,
        sourceRevision: detail.value.revision,
        targetRevision: mergeTarget.value.revision,
      })
      mergePreflight.value = result.data
      mergeResolutions.value = {}
      return result.data.canMerge
    } catch (error) {
      resetMergePreflight()
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function confirmMerge(): Promise<boolean> {
    const source = detail.value
    const target = mergeTarget.value
    const preflight = mergePreflight.value
    if (
      !source ||
      !target ||
      !preflight?.canMerge ||
      !preflight.preflightId ||
      !canMerge.value
    )
      return false
    const conflictResolutions = preflight.relationshipConflicts.map(
      (conflict) => ({
        relationshipType: conflict.relationshipType,
        operatingEntityId: conflict.operatingEntityId,
        retainObjectId:
          mergeResolutions.value[
            `${conflict.relationshipType}\u0000${conflict.operatingEntityId}`
          ] ?? '',
      }),
    )
    if (conflictResolutions.some((resolution) => !resolution.retainObjectId)) {
      errorMessage.value = '请为每个关系冲突明确选择保留关系。'
      return false
    }
    saving.value = true
    errorMessage.value = null
    try {
      const result = await partyApi.mergeConfirm({
        preflightId: preflight.preflightId,
        sourcePartyId: preflight.sourcePartyId,
        targetPartyId: preflight.targetPartyId,
        sourceRevision: preflight.sourceRevision,
        targetRevision: preflight.targetRevision,
        conflictResolutions,
      })
      successMessage.value = `主体已合并，转移 ${result.data.transferredRelationships} 条关系，合并 ${result.data.mergedRelationships} 条冲突关系。`
      mergeOpen.value = false
      editorOpen.value = false
      detail.value = null
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  return {
    loading,
    saving,
    errorMessage,
    successMessage,
    rows,
    total,
    page,
    keywordDraft,
    kindDraft,
    mergedDraft,
    detail,
    form,
    editorOpen,
    canQuery,
    canGet,
    canSave,
    canModify,
    canMerge,
    isDirty,
    query,
    submitFilters,
    resetFilters,
    open,
    save,
    close,
    canOpenRelationship,
    impactMessage,
    addIdentifier,
    removeIdentifier,
    mergeOpen,
    mergeTargetKeyword,
    mergeTargetRows,
    mergeTarget,
    mergePreflight,
    mergeResolutions,
    openMerge,
    closeMerge,
    searchMergeTargets,
    selectMergeTarget,
    preflightMerge,
    confirmMerge,
  }
}

export type PartyViewModel = ReturnType<typeof usePartyViewModel>
