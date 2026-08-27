import { computed, onScopeDispose, ref, watch } from 'vue'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { otherUnitApi } from './api'
import type { OtherUnitStatus, OtherUnitView } from './types'

type PartyListItem = components['schemas']['PartyListItem']
type PartyKind = components['schemas']['PartyKind']

interface ReferenceOption {
  objectId: string
  approvalEntryId: string
  code: string
  name: string
  title: string
}

export interface OtherUnitForm {
  partyMode: 'EXISTING' | 'NEW'
  partyId: string
  partyKind: PartyKind
  legalName: string
  displayName: string
  taxNumber: string
  identifierType: 'PERSON_ID' | 'UNIFIED_SOCIAL_CREDIT_CODE'
  identifierValue: string
  operatingEntityId: string
  contactName: string
  contactPhone: string
  email: string
  address: string
  settlementMethodId: string
  remark: string
}

const emptyForm = (): OtherUnitForm => ({
  partyMode: 'NEW',
  partyId: '',
  partyKind: 'ORGANIZATION',
  legalName: '',
  displayName: '',
  taxNumber: '',
  identifierType: 'UNIFIED_SOCIAL_CREDIT_CODE',
  identifierValue: '',
  operatingEntityId: '',
  contactName: '',
  contactPhone: '',
  email: '',
  address: '',
  settlementMethodId: '',
  remark: '',
})

export type OtherUnitLifecycleAction =
  | 'submit'
  | 'unsubmit'
  | 'approve'
  | 'reject'
  | 'unapprove'
  | 'enable'
  | 'disable'
  | 'delete'

export function useOtherUnitViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const saving = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const rows = ref<OtherUnitView[]>([])
  const total = ref(0)
  const page = ref(1)
  const keywordDraft = ref('')
  const statusDraft = ref<OtherUnitStatus[]>([])
  const operatingDraft = ref('')
  const keyword = ref('')
  const status = ref<OtherUnitStatus[]>([])
  const operatingEntityId = ref('')
  const editorOpen = ref(false)
  const mode = ref<'create' | 'edit' | 'view'>('create')
  const detail = ref<OtherUnitView | null>(null)
  const form = ref<OtherUnitForm>(emptyForm())
  const partyOptions = ref<PartyListItem[]>([])
  const operatingOptions = ref<ReferenceOption[]>([])
  const settlementOptions = ref<ReferenceOption[]>([])
  let savedSignature = ''
  let suggestionTimer: ReturnType<typeof setTimeout> | undefined
  let active = true
  let partySearchSequence = 0
  let operatingSearchSequence = 0
  let settlementSearchSequence = 0

  const canQuery = computed(() => session.can('/bob/other-unit/query'))
  const canOperatingQuery = computed(() =>
    session.can('/bob/operating-entity/query'),
  )
  const canSettlementQuery = computed(() =>
    session.can('/aux/settlement-method/query'),
  )
  const canCreateBase = computed(
    () =>
      session.can('/bob/other-unit/create') &&
      canOperatingQuery.value &&
      canSettlementQuery.value,
  )
  const canCreateWithNewParty = computed(
    () => canCreateBase.value && session.can('/dcl/party/create'),
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
  const canGet = computed(() => session.can('/bob/other-unit/get'))
  const canSave = computed(
    () => session.can('/bob/other-unit/save') && canSettlementQuery.value,
  )
  const editable = computed(() => mode.value !== 'view')
  const isDirty = computed(
    () =>
      editorOpen.value &&
      editable.value &&
      JSON.stringify(form.value) !== savedSignature,
  )
  const formValid = computed(
    () =>
      Boolean(form.value.operatingEntityId) &&
      (mode.value !== 'create' ||
        (form.value.partyMode === 'EXISTING'
          ? canCreateWithExistingParty.value && Boolean(form.value.partyId)
          : canCreateWithNewParty.value &&
            Boolean(form.value.legalName.trim()))),
  )

  function can(action: OtherUnitLifecycleAction): boolean {
    return session.can(`/bob/other-unit/${action}`)
  }

  function canRun(
    row: OtherUnitView,
    action: OtherUnitLifecycleAction,
  ): boolean {
    if (!can(action)) return false
    if (action === 'submit') return row.approval.status === 'DRAFT'
    if (action === 'unsubmit') return row.approval.status === 'PENDING'
    if (action === 'approve' || action === 'reject')
      return row.approval.status === 'PENDING'
    if (action === 'unapprove') return row.approval.status === 'APPROVED'
    if (action === 'enable')
      return row.approval.status === 'APPROVED' && !row.enabled
    if (action === 'disable')
      return row.approval.status === 'APPROVED' && row.enabled
    return row.approval.status === 'DRAFT' || row.approval.status === 'PENDING'
  }

  async function query(): Promise<void> {
    if (!canQuery.value) return
    loading.value = true
    errorMessage.value = null
    try {
      const result = await otherUnitApi.query({
        page: page.value,
        pageSize: 20,
        filters: {
          ...(keyword.value ? { keyword: keyword.value } : {}),
          ...(status.value.length ? { status: status.value } : {}),
          ...(operatingEntityId.value
            ? { operatingEntityId: operatingEntityId.value }
            : {}),
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
    status.value = [...statusDraft.value]
    operatingEntityId.value = operatingDraft.value
    page.value = 1
    await query()
  }

  async function resetFilters(): Promise<void> {
    keywordDraft.value = ''
    statusDraft.value = []
    operatingDraft.value = ''
    await submitFilters()
  }

  async function searchParties(value: string): Promise<void> {
    if (!session.can('/bob/party/query')) return
    const sequence = ++partySearchSequence
    try {
      const result = await otherUnitApi.partyQuery({
        page: 1,
        pageSize: 20,
        filters: value.trim() ? { keyword: value.trim() } : {},
      })
      if (!active || sequence !== partySearchSequence) return
      const selected = partyOptions.value.find(
        (option) => option.partyId === form.value.partyId,
      )
      partyOptions.value = [selected, ...result.data.items]
        .filter((option): option is PartyListItem => Boolean(option))
        .filter(
          (option, index, all) =>
            all.findIndex((item) => item.partyId === option.partyId) === index,
        )
    } catch (error) {
      if (!active || sequence !== partySearchSequence) return
      errorMessage.value = getErrorMessage(error)
    }
  }

  function reuseSuggestedParty(party: PartyListItem): void {
    form.value.partyMode = 'EXISTING'
    form.value.partyId = party.partyId
  }

  watch(
    () => [form.value.partyMode, form.value.legalName, form.value.displayName],
    () => {
      if (suggestionTimer) clearTimeout(suggestionTimer)
      if (mode.value !== 'create' || form.value.partyMode !== 'NEW') return
      const keyword = [form.value.legalName, form.value.displayName].find(
        (value) => value.trim().length >= 2,
      )
      if (!keyword) {
        partyOptions.value = []
        return
      }
      suggestionTimer = setTimeout(() => void searchParties(keyword), 300)
    },
  )
  onScopeDispose(() => {
    active = false
    partySearchSequence += 1
    operatingSearchSequence += 1
    settlementSearchSequence += 1
    if (suggestionTimer) clearTimeout(suggestionTimer)
  })

  async function searchOperatingEntities(value: string): Promise<void> {
    if (!canOperatingQuery.value) return
    const sequence = ++operatingSearchSequence
    try {
      const result = await otherUnitApi.operatingQuery({
        page: 1,
        pageSize: 20,
        filters: value.trim() ? { keyword: value.trim() } : {},
        sort: [{ field: 'code', order: 'asc' }],
      })
      if (!active || sequence !== operatingSearchSequence) return
      const loaded = result.data.items.flatMap((item) => {
        const version = item.latestApproved
        if (!version) return []
        const name = String(version.summary.name ?? '')
        return {
          objectId: item.objectId,
          approvalEntryId: version.approval.approvalEntryId,
          code: item.code,
          name,
          title: `${item.code} · ${name}`,
        }
      })
      const selected = operatingOptions.value.find(
        (option) => option.objectId === form.value.operatingEntityId,
      )
      operatingOptions.value = [selected, ...loaded]
        .filter((option): option is ReferenceOption => Boolean(option))
        .filter(
          (option, index, all) =>
            all.findIndex((item) => item.objectId === option.objectId) ===
            index,
        )
    } catch (error) {
      if (!active || sequence !== operatingSearchSequence) return
      errorMessage.value = getErrorMessage(error)
    }
  }

  async function searchSettlementMethods(value: string): Promise<void> {
    if (!canSettlementQuery.value) return
    const sequence = ++settlementSearchSequence
    try {
      const result = await otherUnitApi.settlementQuery({
        entity: 'settlement-method',
        keyword: value.trim(),
      })
      if (!active || sequence !== settlementSearchSequence) return
      const loaded = result.data.map((item) => ({
        objectId: item.objectId,
        approvalEntryId: item.approvalEntryId,
        code: item.code,
        name: item.name,
        title: `${item.code} · ${item.name}`,
      }))
      const selected = settlementOptions.value.find(
        (option) => option.objectId === form.value.settlementMethodId,
      )
      settlementOptions.value = [selected, ...loaded]
        .filter((option): option is ReferenceOption => Boolean(option))
        .filter(
          (option, index, all) =>
            all.findIndex((item) => item.objectId === option.objectId) ===
            index,
        )
    } catch (error) {
      if (!active || sequence !== settlementSearchSequence) return
      errorMessage.value = getErrorMessage(error)
    }
  }

  function openCreate(): void {
    if (!canCreate.value) return
    mode.value = 'create'
    detail.value = null
    form.value = emptyForm()
    if (!canCreateWithNewParty.value) form.value.partyMode = 'EXISTING'
    savedSignature = JSON.stringify(form.value)
    editorOpen.value = true
    void searchOperatingEntities('')
    void searchSettlementMethods('')
  }

  async function open(
    row: OtherUnitView,
    requestedMode: 'edit' | 'view',
  ): Promise<void> {
    await openById(row.objectId, requestedMode)
  }

  async function openById(
    objectId: string,
    requestedMode: 'edit' | 'view',
  ): Promise<void> {
    if (!canGet.value) return
    loading.value = true
    try {
      const result = await otherUnitApi.get({ objectId })
      detail.value = result.data
      mode.value = requestedMode
      form.value = {
        ...emptyForm(),
        partyMode: 'EXISTING',
        partyId: result.data.partyId,
        partyKind: result.data.partyKind,
        displayName: result.data.partyDisplayName,
        operatingEntityId: result.data.operatingEntityId,
        contactName: result.data.data.contactName ?? '',
        contactPhone: result.data.data.contactPhone ?? '',
        email: result.data.data.email ?? '',
        address: result.data.data.address ?? '',
        settlementMethodId: result.data.data.settlementMethodId ?? '',
        remark: result.data.data.remark ?? '',
      }
      operatingOptions.value = [
        {
          objectId: result.data.operatingEntityId,
          approvalEntryId: '',
          code: result.data.operatingEntityCode,
          name: result.data.operatingEntityName,
          title: `${result.data.operatingEntityCode} · ${result.data.operatingEntityName}`,
        },
      ]
      settlementOptions.value = result.data.data.settlementMethodId
        ? [
            {
              objectId: result.data.data.settlementMethodId,
              approvalEntryId: '',
              code: result.data.data.settlementMethodCode ?? '',
              name: result.data.data.settlementMethodName ?? '',
              title: `${result.data.data.settlementMethodCode ?? ''} · ${result.data.data.settlementMethodName ?? ''}`,
            },
          ]
        : []
      savedSignature = JSON.stringify(form.value)
      editorOpen.value = true
      void searchSettlementMethods('')
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function save(): Promise<boolean> {
    if (!formValid.value) return false
    saving.value = true
    errorMessage.value = null
    try {
      if (mode.value === 'create') {
        const party =
          form.value.partyMode === 'EXISTING'
            ? { partyId: form.value.partyId }
            : {
                newParty: {
                  kind: form.value.partyKind,
                  legalName: form.value.legalName.trim(),
                  displayName: form.value.displayName.trim(),
                  taxNumber: form.value.taxNumber.trim(),
                  strongIdentifiers: form.value.identifierValue.trim()
                    ? [
                        {
                          type: form.value.identifierType,
                          value: form.value.identifierValue.trim(),
                        },
                      ]
                    : [],
                },
              }
        await otherUnitApi.create({
          ...party,
          data: {
            operatingEntityId: form.value.operatingEntityId,
            contactName: form.value.contactName.trim(),
            contactPhone: form.value.contactPhone.trim(),
            email: form.value.email.trim(),
            address: form.value.address.trim(),
            settlementMethodId: form.value.settlementMethodId.trim(),
            remark: form.value.remark.trim(),
          },
        })
      } else if (detail.value) {
        await otherUnitApi.save({
          objectId: detail.value.objectId,
          approvalEntryId: detail.value.approval.approvalEntryId,
          approvalRevision: detail.value.approval.revision,
          data: {
            contactName: form.value.contactName.trim(),
            contactPhone: form.value.contactPhone.trim(),
            email: form.value.email.trim(),
            address: form.value.address.trim(),
            settlementMethodId: form.value.settlementMethodId.trim(),
            remark: form.value.remark.trim(),
          },
        })
      }
      successMessage.value =
        mode.value === 'create'
          ? '其他单位草稿已创建。'
          : '其他单位草稿已保存。'
      editorOpen.value = false
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function runLifecycle(
    row: OtherUnitView,
    action: OtherUnitLifecycleAction,
    reason = '',
  ): Promise<void> {
    if (!canRun(row, action)) return
    loading.value = true
    errorMessage.value = null
    try {
      if (action === 'delete') {
        await otherUnitApi.delete({
          objectId: row.objectId,
          objectRevision: row.objectRevision,
          approvalEntryId: row.approval.approvalEntryId,
          approvalRevision: row.approval.revision,
        })
      } else if (action === 'submit' || action === 'approve') {
        await otherUnitApi[action]({
          objectId: row.objectId,
          approvalEntryId: row.approval.approvalEntryId,
          approvalRevision: row.approval.revision,
        })
      } else if (action === 'unsubmit') {
        await otherUnitApi.unsubmit({
          objectId: row.objectId,
          approvalEntryId: row.approval.approvalEntryId,
          approvalRevision: row.approval.revision,
        })
      } else if (action === 'reject' || action === 'unapprove') {
        await otherUnitApi[action]({
          objectId: row.objectId,
          approvalEntryId: row.approval.approvalEntryId,
          approvalRevision: row.approval.revision,
          reason,
        })
      } else {
        await otherUnitApi[action]({
          objectId: row.objectId,
          objectRevision: row.objectRevision,
        })
      }
      successMessage.value = '操作已完成。'
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function close(): boolean {
    if (isDirty.value && !window.confirm('尚有未保存修改，确认关闭？'))
      return false
    editorOpen.value = false
    return true
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
    statusDraft,
    operatingDraft,
    editorOpen,
    mode,
    detail,
    form,
    partyOptions,
    operatingOptions,
    settlementOptions,
    canQuery,
    canOperatingQuery,
    canSettlementQuery,
    canCreate,
    canCreateWithNewParty,
    canCreateWithExistingParty,
    canGet,
    canSave,
    editable,
    isDirty,
    formValid,
    canRun,
    query,
    submitFilters,
    resetFilters,
    searchParties,
    reuseSuggestedParty,
    searchOperatingEntities,
    searchSettlementMethods,
    openCreate,
    open,
    openById,
    save,
    runLifecycle,
    close,
  }
}

export type OtherUnitViewModel = ReturnType<typeof useOtherUnitViewModel>
