import { computed, onScopeDispose, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { salesPartnerApi } from './api'

export type SalesCapability = components['schemas']['SalesPartnerCapability']
export type SalesPartnerListItem = components['schemas']['SalesPartnerListItem']
export type SalesPartnerDetail = components['schemas']['SalesPartnerDetailView']
export type SalesPartnerReference = components['schemas']['ReferenceCandidate']
export type SalesPartnerLifecycleAction =
  'submit' | 'approve' | 'enable' | 'disable'

type PartyMode = 'new' | 'existing'
type PartyKind = components['schemas']['PartyKind']
type PartyListItem = components['schemas']['PartyListItem']
type SalesPartnerInput = components['schemas']['SalesPartnerInput']

interface NewPartyForm {
  kind: PartyKind
  legalName: string
  displayName: string
  taxNumber: string
}

function emptyData(): SalesPartnerInput {
  return {
    operatingEntityId: '',
    capabilities: [],
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    remark: '',
  }
}

function emptyNewParty(): NewPartyForm {
  return {
    kind: 'ORGANIZATION',
    legalName: '',
    displayName: '',
    taxNumber: '',
  }
}

function selectedVersion(
  detail: SalesPartnerDetail,
): components['schemas']['SalesPartnerVersionView'] | null {
  return detail.candidate ?? detail.effective
}

export function useSalesPartnerViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<SalesPartnerLifecycleAction | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const rows = ref<SalesPartnerListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const keywordDraft = ref('')
  const capabilityDraft = ref<SalesCapability | null>(null)
  const keyword = ref('')
  const capability = ref<SalesCapability | null>(null)
  const workspaceOpen = ref(false)
  const mode = ref<'create' | 'edit' | 'view'>('create')
  const detail = ref<SalesPartnerDetail | null>(null)
  const partyMode = ref<PartyMode>('new')
  const newParty = ref<NewPartyForm>(emptyNewParty())
  const selectedParty = ref<PartyListItem | null>(null)
  const partyOptions = ref<PartyListItem[]>([])
  const operatingEntity = ref<SalesPartnerReference | null>(null)
  const operatingOptions = ref<SalesPartnerReference[]>([])
  const data = ref<SalesPartnerInput>(emptyData())
  let active = true
  let querySequence = 0
  let detailSequence = 0
  let partySearchSequence = 0
  let operatingSearchSequence = 0

  const canQuery = computed(() => session.can('/bob/sales-partner/query'))
  const canOperatingQuery = computed(() =>
    session.can('/bob/operating-entity/query'),
  )
  const canCreateBase = computed(
    () =>
      canQuery.value &&
      canOperatingQuery.value &&
      session.can('/bob/sales-partner/create'),
  )
  const canCreateWithNewParty = computed(
    () => canCreateBase.value && session.can('/bob/party/create'),
  )
  const canCreateWithExistingParty = computed(
    () =>
      canCreateBase.value &&
      session.can('/bob/party/get') &&
      session.can('/bob/party/query'),
  )
  const canCreate = computed(
    () => canCreateWithNewParty.value || canCreateWithExistingParty.value,
  )
  const canView = computed(() => session.can('/bob/sales-partner/get'))
  const canSave = computed(
    () => canView.value && session.can('/bob/sales-partner/save'),
  )
  const editing = computed(() => mode.value !== 'view')
  const formValid = computed(() => {
    if (!operatingEntity.value) return false
    if (mode.value !== 'create')
      return Boolean(detail.value && selectedVersion(detail.value))
    return partyMode.value === 'new'
      ? canCreateWithNewParty.value && Boolean(newParty.value.legalName.trim())
      : canCreateWithExistingParty.value && Boolean(selectedParty.value)
  })

  function queryFilters(): components['schemas']['SalesPartnerQueryRequest']['filters'] {
    return {
      ...(keyword.value ? { keyword: keyword.value } : {}),
      ...(capability.value ? { capability: capability.value } : {}),
    }
  }

  async function query(): Promise<void> {
    if (!canQuery.value) return
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await salesPartnerApi.query({
        page: page.value,
        pageSize: 20,
        filters: queryFilters(),
        sort: [{ field: 'code', order: 'asc' }],
      })
      if (!active || sequence !== querySequence) return
      rows.value = result.data.items
      total.value = result.data.total
      page.value = result.data.page
    } catch (error) {
      if (!active || sequence !== querySequence) return
      rows.value = []
      total.value = 0
      errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && sequence === querySequence) loading.value = false
    }
  }

  async function submitFilters(): Promise<void> {
    keyword.value = keywordDraft.value.trim()
    capability.value = capabilityDraft.value
    page.value = 1
    await query()
  }

  async function resetFilters(): Promise<void> {
    keywordDraft.value = ''
    capabilityDraft.value = null
    await submitFilters()
  }

  async function changePage(value: number): Promise<void> {
    if (loading.value || value < 1 || value === page.value) return
    page.value = value
    await query()
  }

  function mergePartyOptions(loaded: PartyListItem[]): void {
    partyOptions.value = [selectedParty.value, ...loaded]
      .filter((item): item is PartyListItem => item !== null)
      .filter(
        (item, index, all) =>
          all.findIndex((candidate) => candidate.partyId === item.partyId) ===
          index,
      )
  }

  async function searchParties(search = ''): Promise<void> {
    if (!canCreateWithExistingParty.value) return
    const sequence = ++partySearchSequence
    try {
      const result = await salesPartnerApi.partyQuery({
        page: 1,
        pageSize: 20,
        filters: search.trim() ? { keyword: search.trim() } : {},
      })
      if (!active || sequence !== partySearchSequence) return
      mergePartyOptions(result.data.items)
    } catch (error) {
      if (!active || sequence !== partySearchSequence) return
      errorMessage.value = `主体加载失败：${getErrorMessage(error)}`
    }
  }

  function mergeOperatingOptions(loaded: SalesPartnerReference[]): void {
    operatingOptions.value = [operatingEntity.value, ...loaded]
      .filter((item): item is SalesPartnerReference => item !== null)
      .filter(
        (item, index, all) =>
          all.findIndex((candidate) => candidate.objectId === item.objectId) ===
          index,
      )
  }

  async function searchOperatingEntities(search = ''): Promise<void> {
    if (!canOperatingQuery.value) return
    const sequence = ++operatingSearchSequence
    try {
      const result = await salesPartnerApi.referenceQuery({
        entity: 'operating-entity',
        keyword: search.trim(),
      })
      if (!active || sequence !== operatingSearchSequence) return
      mergeOperatingOptions(result.data)
    } catch (error) {
      if (!active || sequence !== operatingSearchSequence) return
      errorMessage.value = `经营主体加载失败：${getErrorMessage(error)}`
    }
  }

  function openCreate(): void {
    if (!canCreate.value) return
    mode.value = 'create'
    detail.value = null
    data.value = emptyData()
    newParty.value = emptyNewParty()
    selectedParty.value = null
    partyOptions.value = []
    operatingEntity.value = null
    operatingOptions.value = []
    partyMode.value = canCreateWithNewParty.value ? 'new' : 'existing'
    workspaceOpen.value = true
    void searchOperatingEntities()
    if (partyMode.value === 'existing') void searchParties()
  }

  async function open(
    row: SalesPartnerListItem,
    requestedMode: 'edit' | 'view',
  ): Promise<void> {
    if (!canView.value || (requestedMode === 'edit' && !canSave.value)) return
    const sequence = ++detailSequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await salesPartnerApi.get({ objectId: row.objectId })
      if (!active || sequence !== detailSequence) return
      const version = selectedVersion(result.data)
      if (!version) {
        errorMessage.value = '销售合作关系缺少可编辑版本。'
        return
      }
      detail.value = result.data
      mode.value = requestedMode
      data.value = {
        ...version.data,
        operatingEntityId: result.data.operatingEntityId,
        capabilities: [...version.data.capabilities],
      }
      operatingEntity.value = {
        objectId: result.data.operatingEntityId,
        versionId: '',
        code: result.data.operatingEntityCode,
        name: result.data.operatingEntityName,
      }
      operatingOptions.value = [operatingEntity.value]
      workspaceOpen.value = true
    } catch (error) {
      if (!active || sequence !== detailSequence) return
      errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && sequence === detailSequence) loading.value = false
    }
  }

  function formData(): SalesPartnerInput {
    return {
      ...data.value,
      operatingEntityId: operatingEntity.value?.objectId ?? '',
      capabilities: [...data.value.capabilities],
      contactName: data.value.contactName?.trim() ?? '',
      contactPhone: data.value.contactPhone?.trim() ?? '',
      email: data.value.email?.trim() ?? '',
      address: data.value.address?.trim() ?? '',
      remark: data.value.remark?.trim() ?? '',
    }
  }

  async function save(): Promise<boolean> {
    if (!formValid.value || (mode.value !== 'create' && !canSave.value))
      return false
    saving.value = true
    errorMessage.value = null
    try {
      if (mode.value === 'create') {
        const request =
          partyMode.value === 'existing'
            ? { partyId: selectedParty.value!.partyId, data: formData() }
            : {
                newParty: {
                  kind: newParty.value.kind,
                  legalName: newParty.value.legalName.trim(),
                  displayName: newParty.value.displayName.trim(),
                  taxNumber: newParty.value.taxNumber.trim(),
                  strongIdentifiers: [],
                },
                data: formData(),
              }
        await salesPartnerApi.create(request)
      } else if (detail.value) {
        const version = selectedVersion(detail.value)
        if (!version) return false
        await salesPartnerApi.save({
          objectId: detail.value.objectId,
          versionId: version.version.versionId,
          revision: version.version.revision,
          data: formData(),
        })
      }
      successMessage.value =
        mode.value === 'create'
          ? '销售合作关系草稿已创建。'
          : '销售合作关系草稿已保存。'
      workspaceOpen.value = false
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  function rowVersion(row: SalesPartnerListItem) {
    return row.candidate ?? row.effective
  }

  function canRun(
    row: SalesPartnerListItem,
    action: SalesPartnerLifecycleAction,
  ): boolean {
    if (!session.can(`/bob/sales-partner/${action}`)) return false
    const version = rowVersion(row)
    if (!version) return false
    if (action === 'submit') return version.status === 'DRAFT'
    if (action === 'approve')
      return (
        version.status === 'PENDING' && version.submittedBy !== session.user?.id
      )
    if (action === 'enable') return row.effective !== null && !row.enabled
    return row.effective !== null && row.enabled
  }

  async function runLifecycle(
    row: SalesPartnerListItem,
    action: SalesPartnerLifecycleAction,
  ): Promise<void> {
    if (!canRun(row, action)) return
    const version = rowVersion(row)
    if (!version) return
    actionLoading.value = action
    errorMessage.value = null
    try {
      if (action === 'submit' || action === 'approve') {
        await salesPartnerApi[action]({
          objectId: row.objectId,
          versionId: version.versionId,
          revision: version.revision,
        })
      } else {
        await salesPartnerApi[action]({
          objectId: row.objectId,
          objectRevision: row.objectRevision,
        })
      }
      successMessage.value = '操作已完成。'
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      actionLoading.value = null
    }
  }

  onScopeDispose(() => {
    active = false
    querySequence += 1
    detailSequence += 1
    partySearchSequence += 1
    operatingSearchSequence += 1
  })

  return {
    loading,
    saving,
    actionLoading,
    errorMessage,
    successMessage,
    rows,
    total,
    page,
    keywordDraft,
    capabilityDraft,
    workspaceOpen,
    mode,
    detail,
    partyMode,
    newParty,
    selectedParty,
    partyOptions,
    operatingEntity,
    operatingOptions,
    data,
    canQuery,
    canOperatingQuery,
    canCreate,
    canCreateWithNewParty,
    canCreateWithExistingParty,
    canView,
    canSave,
    editing,
    formValid,
    canRun,
    query,
    submitFilters,
    resetFilters,
    changePage,
    searchParties,
    searchOperatingEntities,
    openCreate,
    open,
    save,
    runLifecycle,
  }
}
