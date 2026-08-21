import { computed, ref } from 'vue'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { downloadBlob } from '@/utils/download'
import { customerApi } from './api'
import {
  createCustomerForm,
  creditLimitErrors,
  pricingPolicyErrors,
} from './form'
import { customerCreatePayload } from './payload'
import type {
  CustomerDetail,
  CustomerAttachment,
  CustomerForm,
  CustomerListItem,
  CustomerReference,
  CustomerReferenceKey,
} from './types'

export type CustomerLifecycleAction =
  | 'submit'
  | 'unsubmit'
  | 'approve'
  | 'reject'
  | 'enable'
  | 'disable'
  | 'delete'

interface CustomerFilters {
  status: string[]
  customerType: string
  operatingEntityId: string
  salesAttributionType: string
  salesAttributionSubjectId: string
}

function emptyFilters(): CustomerFilters {
  return {
    status: [],
    customerType: '',
    operatingEntityId: '',
    salesAttributionType: '',
    salesAttributionSubjectId: '',
  }
}

type CustomerWireListItem = components['schemas']['CustomerListItem']

function listItem(item: CustomerWireListItem): CustomerListItem {
  const effective = item.effective
  const candidate = item.candidate
  const current = candidate ?? effective
  return {
    objectId: item.objectId,
    code: item.code,
    name:
      effective?.name ?? candidate?.name ?? '',
    enabled: item.enabled,
    status: current?.status ?? '',
    customerType:
      effective?.customerTypeCode ?? candidate?.customerTypeCode ?? '',
    hasCandidate: candidate !== null,
    objectRevision: item.objectRevision,
    versionId: current?.versionId ?? '',
    revision: current?.revision ?? 0,
    submittedBy: current?.submittedBy ?? null,
  }
}

export function useCustomerViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<CustomerLifecycleAction | null>(null)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const rows = ref<CustomerListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const filters = ref<CustomerFilters>(emptyFilters())
  const workspaceOpen = ref(false)
  const mode = ref<'create' | 'view' | 'edit'>('create')
  const form = ref<CustomerForm>(createCustomerForm())
  const detail = ref<CustomerDetail | null>(null)
  const selectedGroupId = ref('')
  const taxMatchLoading = ref(false)
  const attachmentLoading = ref(false)
  const selectedDocumentCategoryId = ref('')
  const taxMatches = ref<components['schemas']['CustomerTaxMatch'][]>([])
  const referenceOptions = ref<Record<CustomerReferenceKey, CustomerReference[]>>({
    operatingEntity: [],
    settlementMethod: [],
    paymentMethod: [],
    customerType: [],
    documentCategory: [],
    employee: [],
    otherParty: [],
  })
  let querySequence = 0
  let savedFormSignature = ''

  const requiredReferencePermissions = [
    '/bob/operating-entity/query',
    '/bob/employee/query',
    '/bob/other-unit/query',
    '/aux/settlement-method/query',
    '/aux/payment-method/query',
    '/aux/dictionary-item/query',
  ] as const
  const canQuery = computed(() => session.can('/bob/customer/query'))
  const canCreate = computed(
    () =>
      session.can('/bob/customer/create') &&
      requiredReferencePermissions.every((path) => session.can(path)),
  )
  const canEdit = computed(
    () =>
      session.can('/bob/customer/get') &&
      session.can('/bob/customer/save') &&
      requiredReferencePermissions.every((path) => session.can(path)),
  )
  const canAttachmentInitiate = computed(() =>
    session.can('/bob/customer/attachment-initiate'),
  )
  const canAttachmentDownload = computed(() =>
    session.can('/bob/customer/attachment-download'),
  )
  const canAttachmentRemove = computed(() =>
    session.can('/bob/customer/attachment-remove'),
  )

  function canLifecycle(action: CustomerLifecycleAction): boolean {
    return session.can(`/bob/customer/${action}`)
  }

  function canLifecycleFor(
    row: CustomerListItem,
    action: CustomerLifecycleAction,
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
    if (action === 'enable') {
      return row.status === 'EFFECTIVE' && !row.hasCandidate && !row.enabled
    }
    if (action === 'disable') {
      return row.status === 'EFFECTIVE' && !row.hasCandidate && row.enabled
    }
    return (
      row.status === 'DRAFT' ||
      (row.hasCandidate && row.status === 'PENDING')
    )
  }

  const formErrors = computed(() => [
    ...(form.value.group.companyName.trim() ? [] : ['请输入集团公司名称。']),
    ...(form.value.account.name.trim() ? [] : ['请输入客户名称。']),
    ...(form.value.account.primarySalesAttribution.subject
      ? []
      : ['请选择主要业务归属主体。']),
    ...pricingPolicyErrors(form.value.account.pricingPolicy),
    ...creditLimitErrors(form.value.account.creditLimits),
  ])
  const isDirty = computed(
    () => workspaceOpen.value && JSON.stringify(form.value) !== savedFormSignature,
  )

  function queryFilters(): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries({
        keyword: keyword.value.trim(),
        ...filters.value,
      }).filter(([, value]) =>
        Array.isArray(value) ? value.length > 0 : value !== '',
      ),
    )
  }

  async function query(): Promise<void> {
    if (!canQuery.value) return
    const sequence = ++querySequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await customerApi.query({
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

  const referenceConfigs: Readonly<Record<CustomerReferenceKey, CustomerReference['entity']>> = {
    operatingEntity: 'operating-entity',
    settlementMethod: 'settlement-method',
    paymentMethod: 'payment-method',
    customerType: 'dictionary-item',
    documentCategory: 'dictionary-item',
    employee: 'employee',
    otherParty: 'other-unit',
  }

  async function loadReferenceOptions(
    key: CustomerReferenceKey,
    searchKeyword = '',
  ): Promise<void> {
    const entity = referenceConfigs[key]
    try {
      const isBob = entity === 'operating-entity' || entity === 'employee' || entity === 'other-unit'
      const result = isBob
        ? await customerApi.queryBobReferences({ entity, keyword: searchKeyword.trim() })
        : await customerApi.queryAuxReferences({
            entity,
            keyword: searchKeyword.trim(),
            ...(key === 'customerType' ? { dictionaryTypeCode: 'DCT-0001' } : {}),
            ...(key === 'documentCategory'
              ? { dictionaryTypeCode: 'DCT-0003' }
              : {}),
          })
      const loaded = result.data.map((item) => ({ ...item, entity }) satisfies CustomerReference)
      const selected = referenceOptions.value[key].filter((option) =>
        [
          form.value.account.operatingEntity,
          form.value.account.settlementMethod,
          form.value.account.paymentMethod,
          form.value.account.primarySalesAttribution.subject,
        ].some((value) => value?.objectId === option.objectId),
      )
      referenceOptions.value[key] = [...selected, ...loaded].filter(
        (option, index, all) =>
          all.findIndex((candidate) => candidate.objectId === option.objectId) ===
          index,
      )
    } catch (error) {
      errorMessage.value = `基础资料加载失败：${getErrorMessage(error)}`
    }
  }

  function preloadReferences(): void {
    for (const key of Object.keys(referenceConfigs) as CustomerReferenceKey[]) {
      void loadReferenceOptions(key)
    }
  }

  function keepSelectedReference(
    key: CustomerReferenceKey,
    reference: CustomerReference | null,
  ): void {
    if (!reference) return
    referenceOptions.value[key] = [
      reference,
      ...referenceOptions.value[key].filter(
        (option) => option.objectId !== reference.objectId,
      ),
    ]
  }

  function changeSalesAttributionType(value: unknown): void {
    if (
      value !== 'INTERNAL_EMPLOYEE' &&
      value !== 'EXTERNAL_PART_TIME' &&
      value !== 'DEALER'
    )
      return
    if (form.value.account.primarySalesAttribution.type === value) return
    form.value.account.primarySalesAttribution = { type: value, subject: null }
    void loadReferenceOptions(
      value === 'INTERNAL_EMPLOYEE' ? 'employee' : 'otherParty',
    )
  }

  function openCreate(): void {
    if (!canCreate.value) return
    mode.value = 'create'
    detail.value = null
    selectedGroupId.value = ''
    taxMatches.value = []
    form.value = createCustomerForm()
    savedFormSignature = JSON.stringify(form.value)
    errorMessage.value = null
    workspaceOpen.value = true
    preloadReferences()
  }

  async function checkTaxMatches(): Promise<void> {
    const taxNumber = form.value.group.taxNumber.trim()
    taxMatches.value = []
    selectedGroupId.value = ''
    if (!taxNumber || taxMatchLoading.value || !canCreate.value) return
    taxMatchLoading.value = true
    try {
      const result = await customerApi.taxMatch({ taxNumber })
      taxMatches.value = result.data
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      taxMatchLoading.value = false
    }
  }

  function applyTaxMatch(match: components['schemas']['CustomerTaxMatch']): void {
    selectedGroupId.value = match.sourceEntity === 'customer-group' ? match.objectId : ''
    form.value.group.companyName = match.companyName
    form.value.group.shortName = match.shortName
    form.value.group.taxNumber = match.taxNumber
    form.value.group.invoiceTitle = match.invoiceTitle
    form.value.group.invoiceAddress = match.invoiceAddress
    form.value.group.invoicePhone = match.invoicePhone
    taxMatches.value = []
  }

  async function openEdit(row: CustomerListItem): Promise<void> {
    if (!canEdit.value) return
    loading.value = true
    errorMessage.value = null
    try {
      const result = await customerApi.get({ objectId: row.objectId })
      const raw = result.data
      const group = raw.group
      const groupData = group.data
      const version = raw.candidate ?? raw.effective
      if (!version) throw new Error('客户没有可读取的版本。')
      const meta = version.version
      const account = version.data
      const reference = (key: string, entity: CustomerReference['entity']) => {
        const value = account[key as 'operatingEntity']
        if (!value) return null
        return {
          objectId: value.sourceObjectId,
          versionId: '',
          code: value.code,
          name: value.name,
          entity,
        } satisfies CustomerReference
      }
      const attribution = account.primarySalesAttribution
      form.value = {
        group: {
          companyName: groupData.companyName,
          shortName: groupData.shortName ?? '',
          taxNumber: groupData.taxNumber ?? '',
          invoiceTitle: groupData.invoiceTitle ?? '',
          invoiceAddress: groupData.invoiceAddress ?? '',
          invoicePhone: groupData.invoicePhone ?? '',
          bankAccounts: groupData.bankAccounts,
        },
        account: {
          ...createCustomerForm().account,
          code: row.code,
          name: account.name,
          customerTypeCode: account.customerTypeCode,
          shortName: account.shortName ?? '',
          contactName: account.contactName ?? '',
          contactPhone: account.contactPhone ?? '',
          email: account.email ?? '',
          address: account.address ?? '',
          operatingEntity: reference('operatingEntity', 'operating-entity'),
          settlementMethod: reference('settlementMethod', 'settlement-method'),
          paymentMethod: reference('paymentMethod', 'payment-method'),
          defaultTransportMethodCode:
            account.defaultTransportMethodCode ?? '',
          defaultTransportMethodName:
            account.defaultTransportMethodName ?? '',
          transportSurcharge: account.transportSurcharge ?? '0.00',
          pricingPolicy: account.pricingPolicy,
          creditLimits: account.creditLimits,
          primarySalesAttribution: {
            type: attribution.type,
            subject:
              attribution.subjectObjectId
                ? {
                    objectId: attribution.subjectObjectId,
                    versionId: attribution.subjectVersionId,
                    code: attribution.subjectCode,
                    name: attribution.subjectName,
                    entity:
                      attribution.type === 'INTERNAL_EMPLOYEE'
                        ? 'employee'
                        : 'other-unit',
                  }
                : null,
          },
          internalReminder: account.internalReminder ?? '',
          defaultSalesOrderRemark: account.defaultSalesOrderRemark ?? '',
        },
      }
      detail.value = {
        objectId: row.objectId,
        code: row.code,
        objectRevision: raw.objectRevision,
        versionId: meta.versionId,
        revision: meta.revision,
        group: {
          ...form.value.group,
          groupId: group.groupId,
          revision: group.revision,
          attachments: group.attachments,
        },
        versionStatus: meta.status,
        accountAttachments: version.attachments,
        effectiveAccount: null,
        candidateAccount: null,
      }
      keepSelectedReference('operatingEntity', form.value.account.operatingEntity)
      keepSelectedReference('settlementMethod', form.value.account.settlementMethod)
      keepSelectedReference('paymentMethod', form.value.account.paymentMethod)
      keepSelectedReference(
        form.value.account.primarySalesAttribution.type === 'INTERNAL_EMPLOYEE'
          ? 'employee'
          : 'otherParty',
        form.value.account.primarySalesAttribution.subject,
      )
      preloadReferences()
      mode.value = 'edit'
      savedFormSignature = JSON.stringify(form.value)
      workspaceOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function closeWorkspace(): void {
    if (saving.value) return
    if (
      isDirty.value &&
      typeof window !== 'undefined' &&
      !window.confirm('尚有未保存的客户资料，确认放弃修改吗？')
    )
      return
    workspaceOpen.value = false
  }

  async function save(): Promise<boolean> {
    if (
      saving.value ||
      formErrors.value.length > 0 ||
      (mode.value === 'create' ? !canCreate.value : !canEdit.value)
    )
      return false
    saving.value = true
    errorMessage.value = null
    try {
      const payload = customerCreatePayload(form.value)
      if (mode.value === 'create') {
        await customerApi.create(
          selectedGroupId.value
            ? { groupId: selectedGroupId.value, data: payload.data }
            : payload,
        )
      } else if (detail.value) {
        if (!('group' in payload)) throw new Error('客户集团资料缺失。')
        await customerApi.save({
            objectId: detail.value.objectId,
            versionId: detail.value.versionId,
            revision: detail.value.revision,
            groupRevision: detail.value.group.revision,
            group: payload.group,
            data: payload.data,
        })
      }
      workspaceOpen.value = false
      savedFormSignature = JSON.stringify(form.value)
      successMessage.value =
        mode.value === 'create' ? '客户已创建。' : '客户已保存。'
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function sha256(file: File): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      await file.arrayBuffer(),
    )
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  async function refreshAttachments(): Promise<void> {
    const current = detail.value
    if (!current) return
    const result = await customerApi.get({ objectId: current.objectId })
    const raw = result.data
    const version = raw.candidate ?? raw.effective
    current.group.revision = raw.group.revision
    current.group.attachments = raw.group.attachments
    if (version) {
      current.versionId = version.version.versionId
      current.revision = version.version.revision
      current.versionStatus = version.version.status
      current.accountAttachments = version.attachments
    }
  }

  async function uploadAttachments(
    scope: 'GROUP' | 'ACCOUNT',
    files: File[],
  ): Promise<void> {
    const current = detail.value
    if (
      !current ||
      !canAttachmentInitiate.value ||
      !selectedDocumentCategoryId.value ||
      files.length === 0 ||
      attachmentLoading.value ||
      (scope === 'ACCOUNT' && current.versionStatus !== 'DRAFT')
    )
      return
    attachmentLoading.value = true
    errorMessage.value = null
    try {
      for (const file of files) {
        const ownerId =
          scope === 'GROUP' ? current.group.groupId : current.versionId
        const revision =
          scope === 'GROUP' ? current.group.revision : current.revision
        const initiated = await customerApi.attachmentInitiate({
          scope,
          ownerId,
          revision,
          categoryObjectId: selectedDocumentCategoryId.value,
          fileName: file.name,
          contentType: file.type as
            | 'application/pdf'
            | 'image/jpeg'
            | 'image/png',
          size: file.size,
          sha256: await sha256(file),
        })
        if (scope === 'GROUP') current.group.revision = initiated.data.revision
        else current.revision = initiated.data.revision
        await apiClient.uploadCustomerAttachment(initiated.data.uploadUrl, file)
      }
      await refreshAttachments()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      attachmentLoading.value = false
    }
  }

  async function downloadAttachment(
    scope: 'GROUP' | 'ACCOUNT',
    attachment: CustomerAttachment,
  ): Promise<void> {
    const current = detail.value
    if (!current || !canAttachmentDownload.value || attachmentLoading.value)
      return
    attachmentLoading.value = true
    errorMessage.value = null
    try {
      const result = await customerApi.attachmentDownload({
        scope,
        ownerId: scope === 'GROUP' ? current.group.groupId : current.versionId,
        fileId: attachment.fileId,
      })
      downloadBlob(
        await apiClient.fetchCustomerAttachment(result.data.downloadUrl),
        attachment.fileName,
      )
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      attachmentLoading.value = false
    }
  }

  async function removeAttachment(
    scope: 'GROUP' | 'ACCOUNT',
    attachment: CustomerAttachment,
  ): Promise<void> {
    const current = detail.value
    if (
      !current ||
      !canAttachmentRemove.value ||
      attachmentLoading.value ||
      (scope === 'ACCOUNT' && current.versionStatus !== 'DRAFT')
    )
      return
    attachmentLoading.value = true
    errorMessage.value = null
    try {
      const result = await customerApi.attachmentRemove({
        scope,
        ownerId: scope === 'GROUP' ? current.group.groupId : current.versionId,
        revision:
          scope === 'GROUP' ? current.group.revision : current.revision,
        fileId: attachment.fileId,
      })
      if (scope === 'GROUP') current.group.revision = result.data.revision
      else current.revision = result.data.revision
      await refreshAttachments()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      attachmentLoading.value = false
    }
  }

  async function runLifecycle(
    row: CustomerListItem,
    action: CustomerLifecycleAction,
    reason = '',
  ): Promise<boolean> {
    if (actionLoading.value || !canLifecycleFor(row, action)) return false
    const normalizedReason = reason.trim()
    if (
      (action === 'reject' || action === 'unsubmit') &&
      !normalizedReason
    ) {
      errorMessage.value = '请填写操作原因。'
      return false
    }
    actionLoading.value = action
    errorMessage.value = null
    try {
      const baseVersion = {
        objectId: row.objectId,
        versionId: row.versionId,
        revision: row.revision,
      }
      const reverse = {
        ...baseVersion,
        objectRevision: row.objectRevision,
        reason: normalizedReason,
      }
      if (action === 'enable' || action === 'disable') {
        await customerApi[action]({ objectId: row.objectId, objectRevision: row.objectRevision })
      } else if (action === 'delete') {
        await customerApi.delete({ ...baseVersion, objectRevision: row.objectRevision })
      } else if (action === 'unsubmit') {
        await customerApi.unsubmit(reverse)
      } else if (action === 'reject') {
        await customerApi.reject({ ...baseVersion, comment: normalizedReason })
      } else if (action === 'approve') {
        await customerApi.approve(baseVersion)
      } else {
        await customerApi.submit(baseVersion)
      }
      await query()
      successMessage.value = `${row.code} ${{
        submit: '已提交审核',
        unsubmit: '已撤回提交',
        approve: '已审核通过',
        reject: '已审核驳回',
        enable: '已启用',
        disable: '已禁用',
        delete: '候选版本已删除',
      }[action]}。`
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
    selectedGroupId,
    taxMatchLoading,
    attachmentLoading,
    selectedDocumentCategoryId,
    taxMatches,
    referenceOptions,
    canQuery,
    canCreate,
    canEdit,
    canAttachmentInitiate,
    canAttachmentDownload,
    canAttachmentRemove,
    canLifecycle,
    canLifecycleFor,
    loadReferenceOptions,
    changeSalesAttributionType,
    formErrors,
    isDirty,
    query,
    search,
    changePage,
    resetFilters,
    openCreate,
    checkTaxMatches,
    applyTaxMatch,
    openEdit,
    closeWorkspace,
    save,
    uploadAttachments,
    downloadAttachment,
    removeAttachment,
    runLifecycle,
  }
}

export type CustomerViewModel = ReturnType<typeof useCustomerViewModel>
