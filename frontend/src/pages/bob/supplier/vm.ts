import { computed, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { supplierApi } from './api'
import { createSupplierForm } from './form'
import { supplierPayload, supplierSavePayload } from './payload'
import type {
  SupplierDetail,
  SupplierForm,
  SupplierAuditEvent,
  SupplierListItem,
  SupplierListVersion,
  SupplierPartyOption,
  SupplierReference,
  SupplierReferenceEntity,
  SupplierVersion,
  SupplierVersionHistoryItem,
} from './types'

export type SupplierLifecycleAction =
  | 'submit'
  | 'unsubmit'
  | 'approve'
  | 'reject'
  | 'unapprove'
  | 'enable'
  | 'disable'
  | 'delete'

interface SupplierFilters {
  status: string[]
  enabled: boolean | null
  defaultPurchaserEmployeeId: string
}

function emptyFilters(): SupplierFilters {
  return {
    status: [],
    enabled: null,
    defaultPurchaserEmployeeId: '',
  }
}

function reference(
  value:
    { sourceObjectId: string; code: string; name: string } | null | undefined,
  entity: SupplierReferenceEntity,
): SupplierReference | null {
  return value
    ? {
        objectId: value.sourceObjectId,
        approvalEntryId: '',
        code: value.code,
        name: value.name,
        entity,
      }
    : null
}

function listVersion(
  value: components['schemas']['SupplierListVersion'] | null,
): SupplierListVersion | null {
  return value ? { ...value } : null
}

function listItem(
  item: components['schemas']['SupplierListItem'],
): SupplierListItem {
  const latestApproved = listVersion(item.latestApproved)
  const openVersion = listVersion(item.openVersion)
  const current = openVersion ?? latestApproved
  return {
    objectId: item.objectId,
    code: item.code,
    objectRevision: item.objectRevision,
    enabled: item.enabled,
    status: current?.approval.status ?? '',
    name: item.partyDisplayName,
    hasCandidate: openVersion !== null,
    latestApproved,
    openVersion,
    approvalEntryId: current?.approval.approvalEntryId ?? '',
    approvalRevision: current?.approval.revision ?? 0,
    submittedBy: current?.approval.submittedBy ?? null,
  }
}

function versionFromWire(
  value: components['schemas']['SupplierVersionView'] | null,
  code: string,
): SupplierVersion | null {
  if (!value) return null
  const { approval, data } = value
  return {
    approvalEntryId: approval.approvalEntryId,
    versionNo: approval.versionNo,
    approvalRevision: approval.revision,
    status: approval.status,
    submittedBy: approval.submittedBy,
    data: {
      code,
      name: '',
      partyMode: 'new',
      selectedParty: null,
      partyKind: 'ORGANIZATION',
      taxNumber: '',
      identifierType: 'UNIFIED_SOCIAL_CREDIT_CODE',
      identifierValue: '',
      operatingEntity: null,
      contactName: data.contactName ?? '',
      contactPhone: data.contactPhone ?? '',
      email: data.email ?? '',
      address: data.address ?? '',
      remark: data.remark ?? '',
      settlementMethod: reference(data.settlementMethod, 'settlement-method'),
      defaultPurchaser: data.defaultPurchaserEmployeeId
        ? {
            objectId: data.defaultPurchaserEmployeeId,
            approvalEntryId: '',
            code: '',
            name: '',
            entity: 'employee',
          }
        : null,
    },
  }
}

export function useSupplierViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<SupplierLifecycleAction | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const rows = ref<SupplierListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const filters = ref<SupplierFilters>(emptyFilters())
  const workspaceOpen = ref(false)
  const mode = ref<'create' | 'edit' | 'view'>('create')
  const form = ref<SupplierForm>(createSupplierForm())
  const detail = ref<SupplierDetail | null>(null)
  const historicalApprovalEntryId = ref('')
  const historyObject = ref<SupplierListItem | null>(null)
  const versionsOpen = ref(false)
  const versionsLoading = ref(false)
  const versions = ref<SupplierVersionHistoryItem[]>([])
  const versionsPage = ref(1)
  const versionsPageSize = ref(20)
  const versionsTotal = ref(0)
  const auditOpen = ref(false)
  const auditLoading = ref(false)
  const auditEvents = ref<SupplierAuditEvent[]>([])
  const auditPage = ref(1)
  const auditPageSize = ref(20)
  const auditTotal = ref(0)
  const referenceOptions = ref<
    Record<
      'settlementMethod' | 'defaultPurchaser' | 'operatingEntity',
      SupplierReference[]
    >
  >({
    settlementMethod: [],
    defaultPurchaser: [],
    operatingEntity: [],
  })
  const partyOptions = ref<SupplierPartyOption[]>([])
  let querySequence = 0
  let partySearchSequence = 0
  let savedFormSignature = ''

  const requiredReferencePermissions = [
    '/bob/employee/query',
    '/bob/operating-entity/query',
    '/aux/settlement-method/query',
  ] as const
  const canQuery = computed(() => session.can('/bob/supplier/query'))
  const canCreateBase = computed(
    () =>
      session.can('/bob/supplier/create') &&
      session.can('/bob/supplier/get') &&
      requiredReferencePermissions.every((path) => session.can(path)),
  )
  const canCreateWithNewParty = computed(
    () => canCreateBase.value && session.can('/bob/party/create'),
  )
  const canCreateWithExistingParty = computed(
    () =>
      canCreateBase.value &&
      session.can('/bob/party/query') &&
      session.can('/bob/party/get'),
  )
  const canCreate = computed(
    () => canCreateWithNewParty.value || canCreateWithExistingParty.value,
  )
  const canEdit = computed(
    () =>
      session.can('/bob/supplier/get') &&
      session.can('/bob/supplier/save') &&
      requiredReferencePermissions.every((path) => session.can(path)),
  )
  const canView = computed(() => session.can('/bob/supplier/get'))
  const canOpenVersions = computed(
    () => canView.value && session.can('/bob/supplier/versions'),
  )
  const canOpenAudit = computed(
    () => canView.value && session.can('/bob/supplier/audit-history'),
  )

  const formErrors = computed(() => [
    ...(mode.value !== 'create' || form.value.partyMode === 'existing'
      ? []
      : form.value.name.trim()
        ? []
        : ['请输入主体名称。']),
    ...(mode.value !== 'create' || form.value.partyMode === 'new'
      ? []
      : form.value.selectedParty
        ? []
        : ['请选择已有主体。']),
    ...(form.value.operatingEntity ? [] : ['请选择经营主体。']),
  ])
  const isDirty = computed(
    () =>
      workspaceOpen.value && JSON.stringify(form.value) !== savedFormSignature,
  )

  function canLifecycle(action: SupplierLifecycleAction): boolean {
    return session.can(`/bob/supplier/${action}`)
  }

  function canLifecycleFor(
    row: SupplierListItem,
    action: SupplierLifecycleAction,
  ): boolean {
    if (!canLifecycle(action)) return false
    if (action === 'submit') return row.status === 'DRAFT'
    if (action === 'unsubmit') return row.status === 'PENDING'
    if (action === 'approve' || action === 'reject') {
      return (
        row.status === 'PENDING' &&
        row.submittedBy !== null &&
        row.submittedBy !== session.user?.id
      )
    }
    if (action === 'unapprove') return row.status === 'APPROVED'
    if (action === 'enable') return row.latestApproved !== null && !row.enabled
    if (action === 'disable') return row.latestApproved !== null && row.enabled
    return (
      row.status === 'DRAFT' || (row.hasCandidate && row.status === 'PENDING')
    )
  }

  function queryFilters(): components['schemas']['SupplierQueryRequest']['filters'] {
    const { status, enabled, defaultPurchaserEmployeeId } = filters.value
    return {
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      ...(status.length ? { status } : {}),
      ...(enabled === null ? {} : { enabled }),
      ...(defaultPurchaserEmployeeId ? { defaultPurchaserEmployeeId } : {}),
    }
  }

  async function query(): Promise<void> {
    if (!canQuery.value) return
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await supplierApi.query({
        page: page.value,
        pageSize: 20,
        filters: queryFilters(),
        sort: [{ field: 'code', order: 'asc' }],
      })
      if (sequence !== querySequence) return
      rows.value = result.data.items.map(listItem)
      total.value = result.data.total
      page.value = result.data.page
      pageSize.value = result.data.pageSize
    } catch (error) {
      if (sequence !== querySequence) return
      rows.value = []
      total.value = 0
      errorMessage.value = getErrorMessage(error)
    } finally {
      if (sequence === querySequence) loading.value = false
    }
  }

  async function search(): Promise<void> {
    page.value = 1
    await query()
  }
  async function changePage(value: number): Promise<void> {
    if (value < 1 || value === page.value || loading.value) return
    page.value = value
    await query()
  }
  async function resetFilters(): Promise<void> {
    keyword.value = ''
    filters.value = emptyFilters()
    await search()
  }

  async function loadReferenceOptions(
    key: 'settlementMethod' | 'defaultPurchaser' | 'operatingEntity',
    keyword = '',
  ): Promise<void> {
    try {
      const entity: SupplierReferenceEntity =
        key === 'settlementMethod'
          ? 'settlement-method'
          : key === 'operatingEntity'
            ? 'operating-entity'
            : 'employee'
      const loaded =
        key === 'settlementMethod'
          ? (
              await supplierApi.queryAuxReferences({
                entity: 'settlement-method',
                keyword: keyword.trim(),
              })
            ).data.map(
              (item) =>
                ({
                  objectId: item.objectId,
                  approvalEntryId: item.approvalEntryId,
                  code: item.code,
                  name: item.name,
                  entity: 'settlement-method',
                }) satisfies SupplierReference,
            )
          : (
              await supplierApi.queryBobReferences({
                entity:
                  key === 'operatingEntity' ? 'operating-entity' : 'employee',
                keyword: keyword.trim(),
              })
            ).data.map(
              (item) =>
                ({
                  objectId: item.objectId,
                  approvalEntryId: item.approvalEntryId,
                  code: item.code,
                  name: item.name,
                  entity,
                }) satisfies SupplierReference,
            )
      const selected = [
        form.value.settlementMethod,
        form.value.defaultPurchaser,
        form.value.operatingEntity,
        ...(key === 'defaultPurchaser'
          ? referenceOptions.value.defaultPurchaser.filter(
              (option) =>
                option.objectId === filters.value.defaultPurchaserEmployeeId,
            )
          : []),
      ].filter(
        (option): option is SupplierReference => option?.entity === entity,
      )
      referenceOptions.value[key] = [...selected, ...loaded].filter(
        (option, index, all) =>
          all.findIndex(
            (candidate) => candidate.objectId === option.objectId,
          ) === index,
      )
      if (
        key === 'defaultPurchaser' &&
        form.value.defaultPurchaser &&
        !form.value.defaultPurchaser.name
      ) {
        const resolved = referenceOptions.value.defaultPurchaser.find(
          (item) => item.objectId === form.value.defaultPurchaser?.objectId,
        )
        if (resolved) form.value.defaultPurchaser = { ...resolved }
      }
    } catch (error) {
      errorMessage.value = `基础资料加载失败：${getErrorMessage(error)}`
    }
  }

  async function searchParties(keyword = ''): Promise<void> {
    if (!canCreateWithExistingParty.value) return
    const sequence = ++partySearchSequence
    try {
      const result = await supplierApi.partyQuery({
        page: 1,
        pageSize: 20,
        filters: keyword.trim() ? { keyword: keyword.trim() } : {},
      })
      if (sequence !== partySearchSequence) return
      partyOptions.value = [form.value.selectedParty, ...result.data.items]
        .filter((item): item is SupplierPartyOption => item !== null)
        .filter(
          (item, index, all) =>
            all.findIndex((candidate) => candidate.partyId === item.partyId) ===
            index,
        )
    } catch (error) {
      if (sequence !== partySearchSequence) return
      errorMessage.value = `主体加载失败：${getErrorMessage(error)}`
    }
  }

  function preloadReferences(): void {
    void loadReferenceOptions('settlementMethod')
    void loadReferenceOptions('defaultPurchaser')
    void loadReferenceOptions('operatingEntity')
  }

  function keepSelectedReference(
    key: 'settlementMethod' | 'defaultPurchaser' | 'operatingEntity',
    value: SupplierReference | null,
  ): void {
    if (!value) return
    referenceOptions.value[key] = [
      value,
      ...referenceOptions.value[key].filter(
        (item) => item.objectId !== value.objectId,
      ),
    ]
  }

  function openCreate(): void {
    if (!canCreate.value) return
    mode.value = 'create'
    detail.value = null
    historicalApprovalEntryId.value = ''
    form.value = createSupplierForm()
    form.value.partyMode = canCreateWithNewParty.value ? 'new' : 'existing'
    partyOptions.value = []
    savedFormSignature = JSON.stringify(form.value)
    errorMessage.value = null
    workspaceOpen.value = true
    preloadReferences()
    if (form.value.partyMode === 'existing') void searchParties()
  }

  function applyDetail(
    raw: components['schemas']['SupplierDetailView'],
    row: SupplierListItem | undefined,
    nextMode: 'edit' | 'view',
    approvalEntryId = '',
    openWorkspace = true,
  ): void {
    const latestApproved = versionFromWire(raw.latestApproved, raw.code)
    const openVersion = versionFromWire(raw.openVersion, raw.code)
    if (latestApproved) {
      latestApproved.defaultPurchaserCode =
        row?.latestApproved?.defaultPurchaserCode
      latestApproved.defaultPurchaserName =
        row?.latestApproved?.defaultPurchaserName
    }
    if (openVersion) {
      openVersion.defaultPurchaserCode = row?.openVersion?.defaultPurchaserCode
      openVersion.defaultPurchaserName = row?.openVersion?.defaultPurchaserName
    }
    const selected = openVersion ?? latestApproved
    if (!selected) throw new Error('供应商没有可读取的版本。')
    detail.value = {
      objectId: raw.objectId,
      code: raw.code,
      objectRevision: raw.objectRevision,
      enabled: raw.enabled,
      partyId: raw.partyId,
      partyKind: raw.partyKind,
      partyDisplayName: raw.partyDisplayName,
      operatingEntityId: raw.operatingEntityId,
      operatingEntityCode: raw.operatingEntityCode,
      operatingEntityName: raw.operatingEntityName,
      latestApproved,
      openVersion,
    }
    form.value = {
      ...selected.data,
      name: raw.partyDisplayName,
      partyMode: 'existing',
      selectedParty: null,
      partyKind: raw.partyKind,
      taxNumber: '',
      identifierType: 'UNIFIED_SOCIAL_CREDIT_CODE',
      identifierValue: '',
      operatingEntity: {
        objectId: raw.operatingEntityId,
        approvalEntryId: '',
        code: raw.operatingEntityCode,
        name: raw.operatingEntityName,
        entity: 'operating-entity',
      },
      settlementMethod: selected.data.settlementMethod && {
        ...selected.data.settlementMethod,
      },
      defaultPurchaser: selected.data.defaultPurchaser && {
        ...selected.data.defaultPurchaser,
        code: selected.defaultPurchaserCode ?? '',
        name: selected.defaultPurchaserName ?? '',
      },
    }
    keepSelectedReference('settlementMethod', form.value.settlementMethod)
    keepSelectedReference('defaultPurchaser', form.value.defaultPurchaser)
    keepSelectedReference('operatingEntity', form.value.operatingEntity)
    if (nextMode === 'edit') preloadReferences()
    mode.value = nextMode
    historicalApprovalEntryId.value = approvalEntryId
    savedFormSignature = JSON.stringify(form.value)
    if (openWorkspace) workspaceOpen.value = true
  }

  async function loadDetail(
    objectId: string,
    row: SupplierListItem | undefined,
    approvalEntryId = '',
    nextMode: 'edit' | 'view' = 'edit',
    openWorkspace = true,
  ): Promise<void> {
    loading.value = true
    errorMessage.value = null
    try {
      const result = await supplierApi.get({
        objectId,
        ...(approvalEntryId ? { approvalEntryId } : {}),
      })
      const raw = result.data
      if (!raw) throw new Error('供应商不存在或已删除。')
      applyDetail(raw, row, nextMode, approvalEntryId, openWorkspace)
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function openEdit(row: SupplierListItem): Promise<void> {
    if (!canEdit.value) return
    await loadDetail(row.objectId, row)
  }

  async function openView(row: SupplierListItem): Promise<void> {
    if (!canView.value) return
    await loadDetail(row.objectId, row, '', 'view')
  }

  async function openHistoricalVersion(
    item: SupplierVersionHistoryItem,
  ): Promise<void> {
    const row = historyObject.value
    if (!row || !canView.value) return
    versionsOpen.value = false
    await loadDetail(row.objectId, row, item.approvalEntryId, 'view')
  }

  async function returnToCurrentVersion(): Promise<void> {
    const objectId = detail.value?.objectId
    if (!objectId || !canView.value) return
    const row = rows.value.find((item) => item.objectId === objectId)
    await loadDetail(objectId, row, '', canEdit.value ? 'edit' : 'view')
  }

  async function loadVersions(): Promise<void> {
    const row = historyObject.value
    if (!row) return
    versionsLoading.value = true
    try {
      const result = await supplierApi.versions({
        objectId: row.objectId,
        page: versionsPage.value,
        pageSize: versionsPageSize.value,
      })
      versions.value = result.data.items ?? []
      versionsTotal.value = result.data.total
      versionsPage.value = result.data.page
      versionsPageSize.value = result.data.pageSize
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      versionsLoading.value = false
    }
  }

  async function openVersions(row: SupplierListItem): Promise<void> {
    if (!canOpenVersions.value) return
    await loadDetail(row.objectId, row, '', 'view', false)
    if (errorMessage.value) return
    historyObject.value = row
    versions.value = []
    versionsPage.value = 1
    versionsOpen.value = true
    await loadVersions()
  }

  async function changeVersionsPage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === versionsPage.value) return
    versionsPage.value = nextPage
    await loadVersions()
  }

  async function loadAudit(): Promise<void> {
    const row = historyObject.value
    if (!row) return
    auditLoading.value = true
    try {
      const result = await supplierApi.auditHistory({
        objectId: row.objectId,
        page: auditPage.value,
        pageSize: auditPageSize.value,
      })
      auditEvents.value = result.data.items ?? []
      auditTotal.value = result.data.total
      auditPage.value = result.data.page
      auditPageSize.value = result.data.pageSize
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      auditLoading.value = false
    }
  }

  async function openAudit(row: SupplierListItem): Promise<void> {
    if (!canOpenAudit.value) return
    await loadDetail(row.objectId, row, '', 'view', false)
    if (errorMessage.value) return
    historyObject.value = row
    auditEvents.value = []
    auditPage.value = 1
    auditOpen.value = true
    await loadAudit()
  }

  async function changeAuditPage(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage === auditPage.value) return
    auditPage.value = nextPage
    await loadAudit()
  }

  function closeWorkspace(): void {
    if (saving.value) return
    if (
      isDirty.value &&
      typeof window !== 'undefined' &&
      !window.confirm('尚有未保存的供应商资料，确认放弃修改吗？')
    )
      return
    workspaceOpen.value = false
  }

  async function save(): Promise<boolean> {
    if (
      saving.value ||
      formErrors.value.length ||
      (mode.value === 'create' ? !canCreate.value : !canEdit.value)
    )
      return false
    saving.value = true
    errorMessage.value = null
    try {
      const data = supplierPayload(form.value)
      let objectId = detail.value?.objectId ?? ''
      if (mode.value === 'create') {
        const result = await supplierApi.create(
          form.value.partyMode === 'existing'
            ? {
                partyId: form.value.selectedParty!.partyId,
                data,
              }
            : {
                newParty: {
                  kind: form.value.partyKind,
                  legalName: form.value.name.trim(),
                  displayName: form.value.name.trim(),
                  taxNumber:
                    form.value.taxNumber.trim().toUpperCase() || undefined,
                  strongIdentifiers: form.value.identifierValue.trim()
                    ? [
                        {
                          type: form.value.identifierType,
                          value: form.value.identifierValue.trim(),
                        },
                      ]
                    : [],
                },
                data,
              },
        )
        objectId = result.data.objectId
      } else if (detail.value) {
        const editable = detail.value.openVersion ?? detail.value.latestApproved
        if (!editable) throw new Error('供应商没有可保存的版本。')
        const result = await supplierApi.save({
          objectId: detail.value.objectId,
          approvalEntryId: editable.approvalEntryId,
          approvalRevision: editable.approvalRevision,
          data: supplierSavePayload(form.value),
        })
        objectId = result.data.objectId
      }
      successMessage.value =
        mode.value === 'create' ? '供应商已创建。' : '供应商已保存。'
      await query()
      const row = rows.value.find((item) => item.objectId === objectId)
      await loadDetail(objectId, row, '', 'edit')
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function runLifecycle(
    row: SupplierListItem,
    action: SupplierLifecycleAction,
    reason = '',
  ): Promise<boolean> {
    if (actionLoading.value || !canLifecycleFor(row, action)) return false
    const normalizedReason = reason.trim()
    if (['reject', 'unapprove'].includes(action) && !normalizedReason) {
      errorMessage.value = '请填写操作原因。'
      return false
    }
    actionLoading.value = action
    errorMessage.value = null
    try {
      const baseApproval = {
        objectId: row.objectId,
        approvalEntryId: row.approvalEntryId,
        approvalRevision: row.approvalRevision,
      }
      if (action === 'enable' || action === 'disable')
        await supplierApi[action]({
          objectId: row.objectId,
          objectRevision: row.objectRevision,
        })
      else if (action === 'delete')
        await supplierApi.delete({
          ...baseApproval,
          objectRevision: row.objectRevision,
        })
      else if (action === 'unsubmit') await supplierApi.unsubmit(baseApproval)
      else if (action === 'reject')
        await supplierApi.reject({ ...baseApproval, reason: normalizedReason })
      else if (action === 'unapprove')
        await supplierApi.unapprove({
          ...baseApproval,
          reason: normalizedReason,
        })
      else if (action === 'approve') await supplierApi.approve(baseApproval)
      else await supplierApi.submit(baseApproval)
      await query()
      if (action === 'delete' && row.latestApproved === null) {
        if (detail.value?.objectId === row.objectId) {
          detail.value = null
          workspaceOpen.value = false
        }
      } else {
        const refreshed = rows.value.find(
          (item) => item.objectId === row.objectId,
        )
        await loadDetail(
          row.objectId,
          refreshed,
          '',
          canEdit.value ? 'edit' : 'view',
          workspaceOpen.value,
        )
      }
      successMessage.value = `${row.code} ${({ submit: '已提交审核', unsubmit: '已撤回提交', approve: '已审核通过', reject: '已审核驳回', unapprove: '已撤销批准', enable: '已启用', disable: '已禁用', delete: '候选版本已删除' } as const)[action]}。`
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  return {
    loading,
    saving,
    actionLoading,
    errorMessage,
    successMessage,
    rows,
    total,
    page,
    pageSize,
    keyword,
    filters,
    workspaceOpen,
    mode,
    form,
    detail,
    historicalApprovalEntryId,
    historyObject,
    versionsOpen,
    versionsLoading,
    versions,
    versionsPage,
    versionsPageSize,
    versionsTotal,
    auditOpen,
    auditLoading,
    auditEvents,
    auditPage,
    auditPageSize,
    auditTotal,
    referenceOptions,
    partyOptions,
    canQuery,
    canCreate,
    canCreateWithNewParty,
    canCreateWithExistingParty,
    canEdit,
    canView,
    canOpenVersions,
    canOpenAudit,
    formErrors,
    isDirty,
    canLifecycleFor,
    query,
    search,
    changePage,
    resetFilters,
    loadReferenceOptions,
    searchParties,
    openCreate,
    openEdit,
    openView,
    openHistoricalVersion,
    returnToCurrentVersion,
    openVersions,
    changeVersionsPage,
    openAudit,
    changeAuditPage,
    closeWorkspace,
    save,
    runLifecycle,
  }
}

export type SupplierViewModel = ReturnType<typeof useSupplierViewModel>
