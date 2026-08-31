import { computed, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { ApiError, getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { approvalActionPresentation } from '@/shared/approval'
import { dclPartyApi } from './api'

type PartyKind = components['schemas']['PartyKind']
type PartyIdentifier = components['schemas']['PartyIdentifier']
type DclPartyData = components['schemas']['DclPartyData']
type DclPartyListItem = components['schemas']['DclPartyListItem']
type DclPartyView = components['schemas']['DclPartyView']
type DclPartyVersionView = components['schemas']['DclPartyVersionView']
type ApprovalEventView = components['schemas']['ApprovalEventView']
type PartyAction =
  'delete' | 'submit' | 'unsubmit' | 'approve' | 'reject' | 'unapprove'

const partyReferenceEntityLabels: Readonly<Record<string, string>> = {
  customer: '客户',
  supplier: '供应商',
  employee: '员工',
  'other-unit': '其他往来单位',
  'sales-partner': '销售合作方',
}

function partyActionErrorMessage(error: unknown): string {
  const base = getErrorMessage(error)
  if (
    !(error instanceof ApiError) ||
    error.errorKey !== 'bob_unapprove_blocked'
  ) {
    return base
  }
  const details = error.details as
    components['schemas']['DclPartyUnapproveBlockers'] | undefined
  if (!details || !Array.isArray(details.references)) return base
  const references = details.references
    .filter(
      (reference) =>
        reference.field === 'partyId' &&
        Number.isInteger(reference.count) &&
        reference.count > 0,
    )
    .map(
      (reference) =>
        `${partyReferenceEntityLabels[reference.entity] ?? reference.entity} ${reference.count} 条`,
    )
  return references.length ? `${base}引用：${references.join('、')}。` : base
}

export type PartyForm = {
  kind: PartyKind
  legalName: string
  displayName: string
  taxNumber: string
  strongIdentifiers: PartyIdentifier[]
  phone: string
  email: string
  address: string
}

function formFromData(data: DclPartyData): PartyForm {
  return {
    kind: data.kind,
    legalName: data.legalName,
    displayName: data.displayName ?? '',
    taxNumber: data.taxNumber ?? '',
    strongIdentifiers: data.strongIdentifiers.map((item) => ({ ...item })),
    phone: data.phone ?? '',
    email: data.email ?? '',
    address: data.address ?? '',
  }
}

function dataFromForm(form: PartyForm): DclPartyData {
  const optional = (value: string): string | undefined =>
    value.trim() || undefined
  return {
    kind: form.kind,
    legalName: form.legalName.trim(),
    ...(optional(form.displayName)
      ? { displayName: optional(form.displayName) }
      : {}),
    ...(optional(form.taxNumber)
      ? { taxNumber: optional(form.taxNumber) }
      : {}),
    strongIdentifiers: form.strongIdentifiers
      .filter((item) => item.value.trim())
      .map((item) => ({ type: item.type, value: item.value.trim() })),
    ...(optional(form.phone) ? { phone: optional(form.phone) } : {}),
    ...(optional(form.email) ? { email: optional(form.email) } : {}),
    ...(optional(form.address) ? { address: optional(form.address) } : {}),
  }
}

function activeVersion(item: DclPartyListItem): DclPartyVersionView | null {
  return item.openVersion ?? item.latestApproved
}

export function useDclPartyViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const editorLoading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const editorErrorMessage = ref<string | null>(null)
  const rows = ref<DclPartyListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const keywordDraft = ref('')
  const kindDraft = ref<PartyKind | ''>('')
  const mergedDraft = ref(false)
  const keyword = ref('')
  const kind = ref<PartyKind | ''>('')
  const merged = ref(false)
  const drawerOpen = ref(false)
  const editorMode = ref<'view' | 'edit'>('view')
  const currentView = ref<DclPartyView | null>(null)
  const effectiveView = ref<DclPartyView | null>(null)
  const form = ref<PartyForm | null>(null)
  const mergeOpen = ref(false)
  const mergeTargetKeyword = ref('')
  const mergeTargetRows = ref<DclPartyListItem[]>([])
  const mergeTarget = ref<DclPartyListItem | null>(null)
  const mergePreflight = ref<
    components['schemas']['DclPartyMergePreflightResult'] | null
  >(null)
  const mergeResolutions = ref<Record<string, string>>({})
  const versionsOpen = ref(false)
  const versions = ref<DclPartyVersionView[]>([])
  const versionsLoading = ref(false)
  const versionsPage = ref(1)
  const versionsTotal = ref(0)
  const auditOpen = ref(false)
  const auditEvents = ref<ApprovalEventView[]>([])
  const auditLoading = ref(false)
  const auditPage = ref(1)
  const auditTotal = ref(0)
  const historyParty = ref<DclPartyListItem | null>(null)

  const canQuery = computed(() => session.can('/dcl/party/query'))
  const canGet = computed(() => session.can('/dcl/party/get'))
  const canMerge = computed(
    () =>
      session.can('/dcl/party/merge-preflight') &&
      session.can('/dcl/party/merge-confirm') &&
      canQuery.value,
  )
  const canEditCurrent = computed(
    () =>
      currentView.value !== null &&
      ['DRAFT', 'APPROVED'].includes(currentView.value.approval.status) &&
      session.can('/dcl/party/get') &&
      session.can('/dcl/party/save'),
  )

  function permissions(row: DclPartyListItem) {
    const approval = activeVersion(row)?.approval
    if (!approval)
      return {
        view: false,
        edit: false,
        delete: false,
        submit: false,
        unsubmit: false,
        approve: false,
        reject: false,
        unapprove: false,
        versions: false,
        audit: false,
      }
    return {
      view: canGet.value,
      edit:
        canGet.value &&
        session.can('/dcl/party/save') &&
        (approval.status === 'DRAFT' || approval.status === 'APPROVED'),
      delete:
        session.can('/dcl/party/delete') &&
        approval.status === 'DRAFT' &&
        approval.versionNo > 1 &&
        row.latestApproved !== null,
      submit: row.availableApprovalActions.includes('submit'),
      unsubmit: row.availableApprovalActions.includes('unsubmit'),
      approve: row.availableApprovalActions.includes('approve'),
      reject: row.availableApprovalActions.includes('reject'),
      unapprove: row.availableApprovalActions.includes('unapprove'),
      versions: session.can('/dcl/party/versions'),
      audit: session.can('/dcl/party/audit-history'),
    }
  }

  async function query(): Promise<void> {
    if (!canQuery.value) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await dclPartyApi.query({
        page: page.value,
        pageSize: 20,
        filters: {
          ...(keyword.value ? { keyword: keyword.value } : {}),
          ...(kind.value ? { kind: kind.value } : {}),
          ...(merged.value ? { merged: true } : {}),
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

  async function open(
    row: DclPartyListItem,
    mode: 'view' | 'edit',
    approvalEntryId?: string,
  ): Promise<void> {
    if (
      editorLoading.value ||
      (mode === 'view' ? !canGet.value : !permissions(row).edit)
    )
      return
    editorLoading.value = true
    editorErrorMessage.value = null
    try {
      const entryId =
        approvalEntryId ??
        (mode === 'edit'
          ? activeVersion(row)?.approval.approvalEntryId
          : undefined)
      const { data } = await dclPartyApi.get({
        partyId: row.partyId,
        ...(entryId ? { approvalEntryId: entryId } : {}),
      })
      currentView.value = data
      form.value = formFromData(data.data)
      effectiveView.value =
        data.approval.status !== 'APPROVED' &&
        row.latestApproved?.approval.approvalEntryId
          ? (
              await dclPartyApi.get({
                partyId: row.partyId,
                approvalEntryId: row.latestApproved.approval.approvalEntryId,
              })
            ).data
          : null
      editorMode.value =
        mode === 'edit' && canEditCurrent.value ? 'edit' : 'view'
      drawerOpen.value = true
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
      currentView.value = null
      effectiveView.value = null
      form.value = null
    } finally {
      editorLoading.value = false
    }
  }

  async function openById(
    partyId: string,
    mode: 'view' | 'edit',
  ): Promise<void> {
    if (!canGet.value || editorLoading.value) return
    editorLoading.value = true
    try {
      const { data } = await dclPartyApi.get({ partyId })
      currentView.value = data
      form.value = formFromData(data.data)
      effectiveView.value = null
      editorMode.value =
        mode === 'edit' && canEditCurrent.value ? 'edit' : 'view'
      drawerOpen.value = true
    } catch (error) {
      editorErrorMessage.value = getErrorMessage(error)
    } finally {
      editorLoading.value = false
    }
  }

  async function refreshAfterSaveFailure(): Promise<void> {
    const view = currentView.value
    const mode = editorMode.value
    await query()
    if (view) await openById(view.partyId, mode)
  }

  function closeEditor(): void {
    if (saving.value) return
    drawerOpen.value = false
    currentView.value = null
    effectiveView.value = null
    form.value = null
    editorErrorMessage.value = null
  }
  function addIdentifier(): void {
    if (canEditCurrent.value && form.value)
      form.value.strongIdentifiers.push({
        type:
          form.value.kind === 'PERSON'
            ? 'PERSON_ID'
            : 'UNIFIED_SOCIAL_CREDIT_CODE',
        value: '',
      })
  }
  function removeIdentifier(index: number): void {
    if (canEditCurrent.value && form.value)
      form.value.strongIdentifiers.splice(index, 1)
  }

  async function save(): Promise<boolean> {
    const view = currentView.value
    const value = form.value
    if (!view || !value || !canEditCurrent.value || !value.legalName.trim())
      return false
    saving.value = true
    editorErrorMessage.value = null
    try {
      await dclPartyApi.save({
        partyId: view.partyId,
        approvalEntryId: view.approval.approvalEntryId,
        approvalRevision: view.approval.revision,
        data: dataFromForm(value),
      })
      closeEditor()
      successMessage.value = '主体变更已保存。'
      await query()
      return true
    } catch (error) {
      const message = getErrorMessage(error)
      await refreshAfterSaveFailure()
      editorErrorMessage.value = message
      return false
    } finally {
      saving.value = false
    }
  }

  async function runAction(
    row: DclPartyListItem,
    action: PartyAction,
    reason = '',
  ): Promise<boolean> {
    if (!permissions(row)[action] || actionLoading.value) return false
    const approval = activeVersion(row)?.approval
    if (!approval) return false
    const reasonRequired =
      action !== 'delete' && approvalActionPresentation[action].reasonRequired
    const normalizedReason = reasonRequired ? reason.trim() : ''
    if (reasonRequired && !normalizedReason) {
      errorMessage.value = '原因不能为空。'
      return false
    }
    actionLoading.value = `${action}:${row.partyId}`
    errorMessage.value = null
    const request = {
      partyId: row.partyId,
      approvalEntryId: approval.approvalEntryId,
      approvalRevision: approval.revision,
    }
    try {
      if (action === 'delete') await dclPartyApi.delete(request)
      else if (action === 'submit') await dclPartyApi.submit(request)
      else if (action === 'approve') await dclPartyApi.approve(request)
      else if (action === 'unsubmit') await dclPartyApi.unsubmit(request)
      else if (action === 'reject')
        await dclPartyApi.reject({ ...request, reason: normalizedReason })
      else await dclPartyApi.unapprove({ ...request, reason: normalizedReason })
      await query()
      successMessage.value = {
        delete: '主体变更草稿已删除。',
        submit: `主体变更${approvalActionPresentation.submit.successLabel}。`,
        unsubmit: `主体变更${approvalActionPresentation.unsubmit.successLabel}。`,
        approve: `主体变更${approvalActionPresentation.approve.successLabel}。`,
        reject: `主体变更${approvalActionPresentation.reject.successLabel}。`,
        unapprove: `主体变更${approvalActionPresentation.unapprove.successLabel}。`,
      }[action]
      return true
    } catch (error) {
      const message = partyActionErrorMessage(error)
      await query()
      errorMessage.value = message
      return false
    } finally {
      actionLoading.value = null
    }
  }

  function conflictKey(
    conflict: components['schemas']['DclPartyMergeRelationshipConflict'],
  ): string {
    return `${conflict.relationshipType}\u0000${conflict.operatingEntityId}`
  }
  function openMerge(): void {
    if (!currentView.value || !canMerge.value) return
    mergeOpen.value = true
    mergeTargetKeyword.value = ''
    mergeTargetRows.value = []
    mergeTarget.value = null
    mergePreflight.value = null
    mergeResolutions.value = {}
  }
  function closeMerge(): void {
    mergeOpen.value = false
    mergeTarget.value = null
    mergePreflight.value = null
    mergeResolutions.value = {}
  }
  async function searchMergeTargets(): Promise<void> {
    const source = currentView.value
    if (!source || !canMerge.value) return
    try {
      const { data } = await dclPartyApi.query({
        page: 1,
        pageSize: 20,
        filters: {
          keyword: mergeTargetKeyword.value.trim() || undefined,
          kind: source.data.kind,
        },
      })
      mergeTargetRows.value = (data.items ?? []).filter(
        (row) => row.partyId !== source.partyId,
      )
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }
  function selectMergeTarget(partyId: string | null): void {
    mergeTarget.value =
      mergeTargetRows.value.find((row) => row.partyId === partyId) ?? null
    mergePreflight.value = null
    mergeResolutions.value = {}
  }
  async function preflightMerge(): Promise<boolean> {
    const source = currentView.value
    const target = mergeTarget.value
    const targetVersion = target && activeVersion(target)
    if (!source || !target || !targetVersion || !canMerge.value) return false
    saving.value = true
    errorMessage.value = null
    try {
      const { data } = await dclPartyApi.mergePreflight({
        sourcePartyId: source.partyId,
        targetPartyId: target.partyId,
        sourceApprovalEntryId: source.approval.approvalEntryId,
        targetApprovalEntryId: targetVersion.approval.approvalEntryId,
        sourceApprovalRevision: source.approval.revision,
        targetApprovalRevision: targetVersion.approval.revision,
      })
      mergePreflight.value = data
      mergeResolutions.value = {}
      return data.canMerge
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }
  async function confirmMerge(): Promise<boolean> {
    const preflight = mergePreflight.value
    if (!preflight?.canMerge || !preflight.preflightId || !canMerge.value)
      return false
    const conflictResolutions = preflight.relationshipConflicts.map(
      (conflict) => ({
        relationshipType: conflict.relationshipType,
        operatingEntityId: conflict.operatingEntityId,
        retainObjectId: mergeResolutions.value[conflictKey(conflict)] ?? '',
      }),
    )
    if (conflictResolutions.some((item) => !item.retainObjectId)) {
      errorMessage.value = '请为每个关系冲突明确选择保留关系。'
      return false
    }
    saving.value = true
    try {
      const { data } = await dclPartyApi.mergeConfirm({
        preflightId: preflight.preflightId,
        conflictResolutions,
      })
      closeMerge()
      closeEditor()
      await query()
      successMessage.value = `主体已合并，转移 ${data.transferredRelationships} 条关系，合并 ${data.mergedRelationships} 条冲突关系。`
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function openVersions(row: DclPartyListItem): Promise<void> {
    if (!permissions(row).versions) return
    historyParty.value = row
    versionsOpen.value = true
    versionsPage.value = 1
    await loadVersions()
  }
  async function openHistoryVersion(approvalEntryId: string): Promise<void> {
    const party = historyParty.value
    if (!party) return
    versionsOpen.value = false
    await open(party, 'view', approvalEntryId)
  }
  async function loadVersions(): Promise<void> {
    if (!historyParty.value) return
    versionsLoading.value = true
    try {
      const { data } = await dclPartyApi.versions({
        partyId: historyParty.value.partyId,
        page: versionsPage.value,
        pageSize: 20,
      })
      versions.value = data.items ?? []
      versionsTotal.value = data.total
      versionsPage.value = data.page
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      versionsLoading.value = false
    }
  }
  async function openAudit(row: DclPartyListItem): Promise<void> {
    if (!permissions(row).audit) return
    historyParty.value = row
    auditOpen.value = true
    auditPage.value = 1
    await loadAudit()
  }
  async function loadAudit(): Promise<void> {
    if (!historyParty.value) return
    auditLoading.value = true
    try {
      const { data } = await dclPartyApi.audit({
        partyId: historyParty.value.partyId,
        page: auditPage.value,
        pageSize: 20,
      })
      auditEvents.value = data.items ?? []
      auditTotal.value = data.total
      auditPage.value = data.page
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      auditLoading.value = false
    }
  }

  return {
    loading,
    editorLoading,
    saving,
    actionLoading,
    errorMessage,
    successMessage,
    editorErrorMessage,
    rows,
    total,
    page,
    keywordDraft,
    kindDraft,
    mergedDraft,
    drawerOpen,
    editorMode,
    currentView,
    effectiveView,
    form,
    canQuery,
    canGet,
    canEditCurrent,
    canMerge,
    permissions,
    query,
    submitFilters,
    resetFilters,
    open,
    openById,
    closeEditor,
    addIdentifier,
    removeIdentifier,
    save,
    runAction,
    mergeOpen,
    mergeTargetKeyword,
    mergeTargetRows,
    mergeTarget,
    mergePreflight,
    mergeResolutions,
    conflictKey,
    openMerge,
    closeMerge,
    searchMergeTargets,
    selectMergeTarget,
    preflightMerge,
    confirmMerge,
    versionsOpen,
    versions,
    versionsLoading,
    versionsPage,
    versionsTotal,
    openVersions,
    openHistoryVersion,
    loadVersions,
    auditOpen,
    auditEvents,
    auditLoading,
    auditPage,
    auditTotal,
    openAudit,
    loadAudit,
  }
}
