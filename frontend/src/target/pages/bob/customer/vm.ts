import { ulid } from 'ulid'
import { normalizeCustomerData } from '@zerp/model'
import { computed, ref, toRaw, watch } from 'vue'

import {
  TargetApiError,
  approveTargetCustomer,
  deleteTargetCustomer,
  getTargetCustomer,
  getTargetCustomerSubmission,
  queryTargetAuxReferences,
  queryTargetEmployees,
  queryTargetSalesPartners,
  stageTargetCustomerAttachment,
  queryTargetOperatingEntities,
  queryTargetCustomers,
  queryTargetCustomerAuditHistory,
  queryTargetCustomerSubmissions,
  queryTargetCustomerVersions,
  rejectTargetCustomer,
  setTargetCustomerEnabled,
  submitChangeTargetCustomer,
  submitNewTargetCustomer,
  unapproveTargetCustomer,
  unrejectTargetCustomer,
} from '../../../api.ts'
import { defineListPage } from '../../../components/list-page/definition.ts'
import {
  ListActionRefreshRequiredError,
  ListActionUnresolvedError,
  useListPageViewModel,
  type ListAction,
  type ListSearchInput,
} from '../../../components/list-page/vm.ts'
import type { RowAction } from '../../../components/dynamic-fields/types.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { describeBobEnablementFailure } from '../archive/blockers.ts'
import { useArchiveSubmissionEditor } from '../archive/submission.ts'
import { useArchiveSubmissionLifecycle } from '../archive/lifecycle.ts'

type CustomerCurrent = Awaited<ReturnType<typeof queryTargetCustomers>>
export type CustomerListItem = CustomerCurrent['items'][number] & { id: string }
export type CustomerSnapshot = Awaited<
  ReturnType<typeof getTargetCustomerSubmission>
>['snapshot']

type StableOption = { id: string; code: string; name: string }
type AuxOption = Awaited<ReturnType<typeof queryTargetAuxReferences>>[number]
type SalesPartnerOption = Awaited<
  ReturnType<typeof queryTargetSalesPartners>
>['items'][number]
export const customerIdentityLabels = {
  MAINLAND_ENTERPRISE: '大陆企业',
  MAINLAND_INDIVIDUAL: '大陆自然人',
  OTHER: '其他',
} as const
export const customerAttributionLabels = {
  INTERNAL_EMPLOYEE: '内部员工',
  EXTERNAL_PART_TIME: '外部兼职销售',
  CHANNEL_PARTNER: '渠道商',
} as const
export const customerCostBasisLabels = {
  UNIT_PRICE: '按单价',
  ORDER_AMOUNT: '按订单金额',
} as const
export const identityOptions = Object.entries(customerIdentityLabels).map(
  ([value, title]) => ({ value, title }),
)
export const attributionOptions = Object.entries(customerAttributionLabels).map(
  ([value, title]) => ({ value, title }),
)
export const costBasisOptions = Object.entries(customerCostBasisLabels).map(
  ([value, title]) => ({ value, title }),
)
export const customerTextFields = [
  { key: 'legalName', label: '法定名称' },
  { key: 'displayName', label: '显示名称' },
  { key: 'legalIdentifier', label: '法定识别号' },
  { key: 'phone', label: '联系电话' },
  { key: 'email', label: '邮箱' },
  { key: 'address', label: '地址' },
  { key: 'invoiceTitle', label: '开票抬头' },
  { key: 'invoiceAddress', label: '开票地址' },
  { key: 'invoicePhone', label: '开票电话' },
  { key: 'invoiceBank', label: '开票开户行' },
  { key: 'invoiceAccount', label: '开票账号' },
] as const
export function newCustomerSubunit(): CustomerSnapshot['subunits'][number] {
  return {
    intent: 'NEW',
    id: ulid(),
    code: null,
    name: '',
    contactName: '',
    address: '',
    customerType: { id: '', code: '', name: '' },
    settlementMethod: null,
    paymentMethod: null,
    transportPolicy: {
      methodCode: 'DELIVERY',
      methodName: '送货',
      surcharge: '0.00',
    },
    pricingPolicy: {
      defaultPremiumUnitPrice: '0.00',
      defaultDiscountUnitPrice: '0.00',
      costItems: [],
      thirdPartyIntermediaryFixedUnitCost: '0.00',
      thirdPartyIntermediaryVariableUnitCost: '0.00',
    },
    creditLimits: [],
    primarySalesAttribution: {
      type: 'INTERNAL_EMPLOYEE',
      objectId: '',
      code: '',
      name: '',
    },
    internalReminder: '',
    defaultSalesOrderRemark: '',
    attachments: [],
    enabled: true,
  }
}
export function emptyCustomer(): CustomerSnapshot {
  return {
    identityKind: 'MAINLAND_ENTERPRISE',
    legalName: '',
    displayName: '',
    legalIdentifier: '',
    phone: '',
    email: '',
    address: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBank: '',
    invoiceAccount: '',
    remittanceProfiles: [],
    defaultOperatingEntity: null,
    identityAttachments: [],
    subunits: [newCustomerSubunit()],
  }
}
export function cloneCustomer(snapshot: CustomerSnapshot): CustomerSnapshot {
  const copy = structuredClone(snapshot)
  copy.identityAttachments = []
  copy.subunits = copy.subunits.map((item) => ({
    ...item,
    intent: 'NEW',
    id: ulid(),
    code: null,
    attachments: [],
  }))
  return copy
}

export const customerPaths = {
  query: '/bob/customer/query',
  get: '/bob/customer/get',
  enable: '/bob/customer/enable',
  disable: '/bob/customer/disable',
  submitNew: '/bob/customer/submit-new',
  submitChange: '/bob/customer/submit-change',
  submissionQuery: '/bob/customer/submission-query',
  submissionGet: '/bob/customer/submission-get',
  versions: '/bob/customer/versions',
  audit: '/bob/customer/audit-history',
  approve: '/bob/customer/approve',
  reject: '/bob/customer/reject',
  unreject: '/bob/customer/unreject',
  unapprove: '/bob/customer/unapprove',
  delete: '/bob/customer/delete',
  subunits: '/bob/customer/save-subunits',
  attachment: '/bob/customer/attachment-stage',
} as const

export const customerListPage = defineListPage<CustomerListItem>({
  title: '客户',
  createLabel: '新增客户',
  columns: [
    { key: 'code', type: 'text', caption: '编码' },
    { key: 'name', type: 'text', caption: '名称' },
    {
      key: 'enabled',
      type: 'boolean',
      caption: '状态',
      trueCaption: '启用',
      falseCaption: '停用',
    },
    { key: '$actions', type: 'actions', caption: '操作' },
  ],
  filters: [{ key: 'keyword', type: 'text', caption: '编码、拼音或名称' }],
})

function mapPage(page: CustomerCurrent) {
  return {
    ...page,
    items: page.items.map((item) => ({ ...item, id: item.objectId })),
  }
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function useCustomerManagementViewModel() {
  const session = useTargetSession()
  const can = (path: string) => session.can(path)
  const csrf = () => {
    if (!session.csrfToken) throw new Error('请重新登录。')
    return session.csrfToken
  }
  const operatingEntityOptions = ref<StableOption[]>([])
  const purchaserOptions = ref<StableOption[]>([])
  const settlementOptions = ref<AuxOption[]>([])
  const paymentOptions = ref<AuxOption[]>([])
  const customerTypeOptions = ref<AuxOption[]>([])
  const salesPartnerOptions = ref<SalesPartnerOption[]>([])
  const attachmentUploads = ref(0)
  const attachmentFiles = new Map<string, { file: File; stagingId: string }>()
  type CustomerDetail = Awaited<ReturnType<typeof getTargetCustomer>>
  const currentDetail = ref<CustomerDetail | null>(null)
  const detailOpen = ref(false)
  const detailLoading = ref(false)
  const detailError = ref<string | null>(null)
  const referenceLoads = ref(0)
  const referenceLoading = computed(() => referenceLoads.value > 0)
  const editorOpeningId = ref<string | null>(null)
  let referenceRequest = 0
  let detailRequest = 0
  let disposed = false

  const editor = useArchiveSubmissionEditor<CustomerSnapshot>({
    createSnapshot: emptyCustomer,
    validate: (snapshot) =>
      normalizeCustomerData(snapshot)
        ? null
        : '客户资料或子单位资料不完整，请检查身份、业务归属、金额与附件。',
    canSubmitNew: () =>
      can(customerPaths.submitNew) &&
      can(customerPaths.subunits) &&
      attachmentUploads.value === 0,
    canSubmitChange: () =>
      can(customerPaths.submitChange) && attachmentUploads.value === 0,
    canGet: () => can(customerPaths.submissionGet),
    get: (input) => getTargetCustomerSubmission(csrf(), input),
    versions: (subjectId) => queryTargetCustomerVersions(csrf(), subjectId),
    submitNew: async (input) => {
      await stageAttachments(input.snapshot)
      return submitNewTargetCustomer(csrf(), input)
    },
    submitChange: async (input) => {
      await stageAttachments(input.snapshot)
      return submitChangeTargetCustomer(csrf(), input)
    },
  })

  const isCurrentEditorOpening = (request: number, generation: number) =>
    !disposed &&
    request === referenceRequest &&
    generation === session.generation &&
    editor.open.value

  function loadOptions<T>(
    read: () => Promise<T[]>,
    apply: (values: T[]) => void,
    request: number,
    generation: number,
  ): void {
    referenceLoads.value += 1
    void read()
      .then((values) => {
        if (isCurrentEditorOpening(request, generation)) apply(values)
      })
      .catch((cause) => {
        if (isCurrentEditorOpening(request, generation))
          editor.error.value = messageOf(cause, '引用选项加载失败。')
      })
      .finally(() => {
        if (!disposed && request === referenceRequest)
          referenceLoads.value = Math.max(0, referenceLoads.value - 1)
      })
  }
  function loadAllCurrent(
    query: typeof queryTargetOperatingEntities | typeof queryTargetEmployees,
  ): Promise<StableOption[]> {
    return (async () => {
      const items: StableOption[] = []
      let page = 1
      let read = 0
      let total = Number.POSITIVE_INFINITY
      while (read < total) {
        const result = await query(csrf(), { keyword: '', page, pageSize: 20 })
        read += result.items.length
        items.push(
          ...result.items
            .filter((item) => item.enabled)
            .map((item) => ({
              id: item.id,
              code: item.code,
              name: item.name,
            })),
        )
        total = result.total
        if (result.items.length === 0) break
        page += 1
      }
      return items
    })()
  }
  function loadReferences(): void {
    const request = ++referenceRequest
    const generation = session.generation
    if (can('/aux/operating-entity/query'))
      loadOptions(
        () => loadAllCurrent(queryTargetOperatingEntities),
        (items) => {
          operatingEntityOptions.value = items
        },
        request,
        generation,
      )
    if (can('/aux/employee/query'))
      loadOptions(
        () => loadAllCurrent(queryTargetEmployees),
        (items) => {
          purchaserOptions.value = items
        },
        request,
        generation,
      )
    if (can('/bob/sales-partner/query'))
      loadOptions(
        async () => {
          const items: SalesPartnerOption[] = []
          let page = 1,
            total = Infinity
          while (
            items.length < total &&
            isCurrentEditorOpening(request, generation)
          ) {
            const result = await queryTargetSalesPartners(csrf(), {
              page,
              pageSize: 100,
              filters: { enabled: true },
            })
            items.push(...result.items)
            total = result.total
            if (!result.items.length) break
            page += 1
          }
          return items
        },
        (items) => {
          salesPartnerOptions.value = items
        },
        request,
        generation,
      )
    if (can('/aux/reference/query')) {
      loadOptions(
        () => queryTargetAuxReferences(csrf(), { entity: 'settlement-method' }),
        (items) => {
          settlementOptions.value = items
        },
        request,
        generation,
      )
      loadOptions(
        () => queryTargetAuxReferences(csrf(), { entity: 'payment-method' }),
        (items) => {
          paymentOptions.value = items
        },
        request,
        generation,
      )
      loadOptions(
        () => queryTargetAuxReferences(csrf(), { entity: 'dictionary-item' }),
        (items) => {
          customerTypeOptions.value = items
        },
        request,
        generation,
      )
    }
  }
  function invalidateEditor(): void {
    referenceRequest += 1
    referenceLoads.value = 0
    operatingEntityOptions.value = []
    purchaserOptions.value = []
    settlementOptions.value = []
    paymentOptions.value = []
    customerTypeOptions.value = []
    salesPartnerOptions.value = []
    attachmentUploads.value = 0
    attachmentFiles.clear()
  }
  function canCreate(): boolean {
    return can(customerPaths.submitNew) && can(customerPaths.subunits)
  }
  function canClone(): boolean {
    return can(customerPaths.submitNew) && can(customerPaths.subunits)
  }
  function canChange(): boolean {
    return can(customerPaths.submitChange) && can(customerPaths.versions)
  }
  async function openDetail(item: CustomerListItem): Promise<void> {
    if (!can(customerPaths.get)) return
    const request = ++detailRequest
    const generation = session.generation
    detailOpen.value = true
    detailLoading.value = true
    detailError.value = null
    currentDetail.value = null
    try {
      const result = await getTargetCustomer(csrf(), item.objectId)
      if (
        !disposed &&
        request === detailRequest &&
        generation === session.generation
      )
        currentDetail.value = result
    } catch (cause) {
      if (
        !disposed &&
        request === detailRequest &&
        generation === session.generation
      )
        detailError.value = messageOf(cause, '正式资料读取失败。')
    } finally {
      if (
        !disposed &&
        request === detailRequest &&
        generation === session.generation
      )
        detailLoading.value = false
    }
  }
  function closeDetail(): void {
    detailRequest += 1
    detailOpen.value = false
    detailLoading.value = false
    detailError.value = null
    currentDetail.value = null
  }
  function openCreate(): void {
    if (!canCreate()) return
    invalidateEditor()
    editor.openCreate()
    loadReferences()
  }
  function openHistoricalClone(snapshot: CustomerSnapshot): void {
    if (!canCreate()) return
    invalidateEditor()
    editor.openClone(cloneCustomer(toRaw(snapshot)))
    loadReferences()
  }
  function openClone(item: CustomerListItem): void {
    if (!canClone()) return
    openHistoricalClone(item.data)
  }
  async function openChange(item: CustomerListItem): Promise<void> {
    if (!canChange() || editorOpeningId.value) return
    editorOpeningId.value = item.id
    invalidateEditor()
    try {
      await editor.openChange(item.objectId)
      if (!editor.open.value) return
      loadReferences()
    } finally {
      if (!disposed) editorOpeningId.value = null
    }
  }
  function closeEditor(): void {
    if (editor.saving.value) return
    invalidateEditor()
    editor.close()
  }
  function canEditSubunits(): boolean {
    return can(customerPaths.subunits)
  }
  function setDefaultOperatingEntity(id: string | null): void {
    const option = operatingEntityOptions.value.find((item) => item.id === id)
    editor.draft.value.defaultOperatingEntity = option
      ? { objectId: option.id, code: option.code, name: option.name }
      : null
  }
  function addSubunit(): void {
    if (canEditSubunits())
      editor.draft.value.subunits.push(newCustomerSubunit())
  }
  function removeSubunit(index: number): void {
    if (canEditSubunits()) editor.draft.value.subunits.splice(index, 1)
  }
  function setCustomerType(index: number, id: string | null): void {
    const item = customerTypeOptions.value.find((item) => item.objectId === id)
    const sub = editor.draft.value.subunits[index]
    if (sub && canEditSubunits())
      sub.customerType = item
        ? { id: item.objectId, code: item.code, name: item.name }
        : { id: '', code: '', name: '' }
  }
  function setSettlementMethod(index: number, id: string | null): void {
    const item = settlementOptions.value.find((item) => item.objectId === id)
    const sub = editor.draft.value.subunits[index]
    if (!sub || !canEditSubunits()) return
    if (!item) {
      sub.settlementMethod = null
      return
    }
    if (
      !item.termCode ||
      !item.ruleType ||
      item.monthOffset === undefined ||
      item.dayOfMonth === undefined ||
      item.dayOffset === undefined ||
      item.defaultSalesSurcharge === undefined
    ) {
      editor.error.value = '结算方式缺少完整规则，请检查资料。'
      return
    }
    sub.settlementMethod = {
      id: item.objectId,
      code: item.code,
      name: item.name,
      termCode: item.termCode,
      ruleType: item.ruleType,
      monthOffset: item.monthOffset,
      dayOfMonth: item.dayOfMonth,
      dayOffset: item.dayOffset,
      defaultSalesSurcharge: item.defaultSalesSurcharge,
    }
  }
  function setPaymentMethod(index: number, id: string | null): void {
    const item = paymentOptions.value.find((item) => item.objectId === id)
    const sub = editor.draft.value.subunits[index]
    if (!sub || !canEditSubunits()) return
    if (!item) {
      sub.paymentMethod = null
      return
    }
    if (item.defaultSalesSurcharge === undefined) {
      editor.error.value = '收款方式缺少销售加价，请检查资料。'
      return
    }
    sub.paymentMethod = {
      id: item.objectId,
      code: item.code,
      name: item.name,
      defaultSalesSurcharge: item.defaultSalesSurcharge,
    }
  }
  function setAttributionType(
    index: number,
    type: CustomerSnapshot['subunits'][number]['primarySalesAttribution']['type'],
  ): void {
    const sub = editor.draft.value.subunits[index]
    if (!sub || !canEditSubunits()) return
    sub.primarySalesAttribution =
      type === 'INTERNAL_EMPLOYEE'
        ? { type, objectId: '', code: '', name: '' }
        : { type, objectId: '', code: '', name: '', approvalEntryId: '' }
  }
  function attributionCandidates(
    index: number,
  ): { title: string; value: string }[] {
    const type =
      editor.draft.value.subunits[index]?.primarySalesAttribution.type
    return type === 'INTERNAL_EMPLOYEE'
      ? purchaserOptions.value.map((item) => ({
          value: item.id,
          title: `${item.code} · ${item.name}`,
        }))
      : salesPartnerOptions.value
          .filter((item) => type && item.data.capabilities.includes(type))
          .map((item) => ({
            value: item.objectId,
            title: `${item.code} · ${item.name}`,
          }))
  }
  function setAttribution(index: number, id: string | null): void {
    const sub = editor.draft.value.subunits[index]
    if (!sub || !canEditSubunits()) return
    const type = sub.primarySalesAttribution.type
    if (type === 'INTERNAL_EMPLOYEE') {
      const item = purchaserOptions.value.find((item) => item.id === id)
      sub.primarySalesAttribution = {
        type,
        objectId: item?.id ?? '',
        code: item?.code ?? '',
        name: item?.name ?? '',
      }
    } else {
      const item = salesPartnerOptions.value.find(
        (item) => item.objectId === id && item.data.capabilities.includes(type),
      )
      sub.primarySalesAttribution = {
        type,
        objectId: item?.objectId ?? '',
        code: item?.code ?? '',
        name: item?.name ?? '',
        approvalEntryId: item?.sourceApprovalEntryId ?? '',
      }
    }
  }
  function setCostBasis(
    subunitIndex: number,
    index: number,
    basis: 'UNIT_PRICE' | 'ORDER_AMOUNT',
  ): void {
    const sub = editor.draft.value.subunits[subunitIndex],
      item = sub?.pricingPolicy.costItems[index]
    if (!item || !sub || !canEditSubunits()) return
    sub.pricingPolicy.costItems[index] =
      basis === 'UNIT_PRICE'
        ? { name: item.name, calculationBasis: basis, unitPrice: '0.01' }
        : { name: item.name, calculationBasis: basis, orderAmount: '0.01' }
  }
  async function addAttachment(
    files: File | readonly File[] | null,
    subunitIndex?: number,
  ): Promise<void> {
    const file = Array.isArray(files) ? files[0] : files
    if (
      !(file instanceof File) ||
      !can(customerPaths.attachment) ||
      (subunitIndex !== undefined && !canEditSubunits())
    )
      return
    if (
      !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) ||
      file.size < 1 ||
      file.size > 10485760
    ) {
      editor.error.value = '附件仅支持 10 MB 以内的 PDF、JPEG 或 PNG。'
      return
    }
    const request = referenceRequest,
      generation = session.generation
    const subunitId =
      subunitIndex === undefined
        ? null
        : editor.draft.value.subunits[subunitIndex]?.id
    attachmentUploads.value += 1
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (value) => value.toString(16).padStart(2, '0'),
      ).join('')
      if (!isCurrentEditorOpening(request, generation)) return
      const id = ulid()
      attachmentFiles.set(id, { file, stagingId: ulid() })
      const attachment = {
        id,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        sha256: digest,
      }
      if (subunitId === null)
        editor.draft.value.identityAttachments.push(attachment)
      else
        editor.draft.value.subunits
          .find((item) => item.id === subunitId)
          ?.attachments.push(attachment)
    } catch (cause) {
      if (isCurrentEditorOpening(request, generation))
        editor.error.value = messageOf(cause, '附件读取失败。')
    } finally {
      if (isCurrentEditorOpening(request, generation))
        attachmentUploads.value = Math.max(0, attachmentUploads.value - 1)
    }
  }

  async function stageAttachments(snapshot: CustomerSnapshot): Promise<void> {
    const attachments = [
      ...snapshot.identityAttachments,
      ...snapshot.subunits.flatMap((subunit) => subunit.attachments),
    ]
    for (const attachment of attachments) {
      const local = attachmentFiles.get(attachment.id)
      if (!local || attachment.stagingId) continue
      const bytes = new Uint8Array(await local.file.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const result = await stageTargetCustomerAttachment(csrf(), {
        stagingId: local.stagingId,
        fileId: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.contentType as
          'application/pdf' | 'image/jpeg' | 'image/png',
        size: attachment.sizeBytes,
        digest: attachment.sha256,
        contentBase64: btoa(binary),
      })
      attachment.stagingId = result.stagingId
    }
  }

  async function toggle(
    item: CustomerListItem,
    enabled: boolean,
  ): Promise<'changed'> {
    const generation = session.generation
    try {
      await setTargetCustomerEnabled(
        csrf(),
        { objectId: item.objectId, expectedRevision: item.revision },
        enabled,
      )
      return 'changed'
    } catch (cause) {
      if (disposed || generation !== session.generation) throw cause
      const message = describeBobEnablementFailure(cause)
      if (message) throw new Error(message, { cause })
      if (
        cause instanceof TargetApiError &&
        cause.errorKey !== 'invalid_response'
      )
        throw new ListActionRefreshRequiredError(
          messageOf(cause, enabled ? '客户启用失败。' : '客户停用失败。'),
        )
      if (can(customerPaths.get)) {
        try {
          await getTargetCustomer(csrf(), item.objectId)
        } catch {
          /* result remains unknown */
        }
      }
      throw new ListActionUnresolvedError(
        '请求结果未知；已停止再次提交，请刷新后核实。',
      )
    }
  }
  const list = useListPageViewModel<CustomerListItem>({
    ...(can(customerPaths.query)
      ? {
          onSearch: async (input: ListSearchInput) =>
            mapPage(
              await queryTargetCustomers(csrf(), {
                page: input.page,
                pageSize: input.pageSize,
                filters: input.keyword ? { keyword: input.keyword } : {},
              }),
            ),
        }
      : {}),
    ...(can(customerPaths.enable)
      ? { onEnable: (item: CustomerListItem) => toggle(item, true) }
      : {}),
    ...(can(customerPaths.disable)
      ? { onDisable: (item: CustomerListItem) => toggle(item, false) }
      : {}),
    onCanAction: (item, action: ListAction) =>
      Boolean(item) &&
      (action === 'enable'
        ? !item!.enabled && can(customerPaths.enable)
        : action === 'disable'
          ? item!.enabled && can(customerPaths.disable)
          : false),
  })
  function rowActions(item: CustomerListItem): readonly RowAction[] {
    const pending =
      list.isRowPending(item.id) || editorOpeningId.value === item.id
    const disabled = pending || list.isRowBlocked(item.id)
    return [
      ...(can(customerPaths.get)
        ? [
            {
              key: 'detail',
              caption: '查看',
              disabled,
              loading: editorOpeningId.value === item.id,
            },
          ]
        : []),
      ...(canClone()
        ? [
            {
              key: 'clone',
              caption: '克隆',
              disabled,
              loading: editorOpeningId.value === item.id,
            },
          ]
        : []),
      ...(canChange()
        ? [
            {
              key: 'change',
              caption: '提交变更',
              disabled,
              loading: editorOpeningId.value === item.id,
            },
          ]
        : []),
      ...(list.canAction('enable', item)
        ? [
            {
              key: 'enable',
              caption: '启用',
              color: 'success' as const,
              disabled,
              loading: pending,
            },
          ]
        : []),
      ...(list.canAction('disable', item)
        ? [
            {
              key: 'disable',
              caption: '停用',
              color: 'warning' as const,
              disabled,
              loading: pending,
            },
          ]
        : []),
    ]
  }
  function runRowAction(action: string, item: CustomerListItem): void {
    if (action === 'detail') void openDetail(item)
    else if (action === 'clone') openClone(item)
    else if (action === 'change') void openChange(item)
    else if (action === 'enable') void list.enable(item)
    else if (action === 'disable') void list.disable(item)
  }

  type CustomerSubmission = Awaited<
    ReturnType<typeof getTargetCustomerSubmission>
  >
  const submissions = useArchiveSubmissionLifecycle<CustomerSubmission>({
    canQuery: () => can(customerPaths.submissionQuery),
    canGet: () => can(customerPaths.submissionGet),
    canVersions: () => can(customerPaths.versions),
    canAudit: () => can(customerPaths.audit),
    canAction: (action) => can(customerPaths[action]),
    query: ({ page, keyword }) =>
      queryTargetCustomerSubmissions(csrf(), {
        page,
        pageSize: 20,
        filters: keyword ? { keyword } : {},
      }),
    get: (input) => getTargetCustomerSubmission(csrf(), input),
    versions: (id) => queryTargetCustomerVersions(csrf(), id),
    auditHistory: (id) => queryTargetCustomerAuditHistory(csrf(), id),
    approve: (input) => approveTargetCustomer(csrf(), input),
    reject: (input) => rejectTargetCustomer(csrf(), input),
    unreject: (input) => unrejectTargetCustomer(csrf(), input),
    unapprove: (input) => unapproveTargetCustomer(csrf(), input),
    delete: (input) => deleteTargetCustomer(csrf(), input),
    onChanged: async () => {
      await list.refresh()
    },
  })
  async function submit(): Promise<void> {
    if ((await editor.submit()) === 'changed') {
      attachmentFiles.clear()
      await list.refresh()
    }
  }
  async function verifyEditorOutcome(): Promise<void> {
    if ((await editor.verifyOutcome()) === 'changed') await list.refresh()
  }
  const stopSessionWatch = watch(
    () => session.generation,
    () => {
      if (disposed) return
      editor.dispose()
      submissions.dispose()
      invalidateEditor()
      closeDetail()
      list.dispose()
    },
    { flush: 'sync' },
  )
  function dispose(): void {
    if (disposed) return
    disposed = true
    stopSessionWatch()
    closeDetail()
    invalidateEditor()
    list.dispose()
    editor.dispose()
    submissions.dispose()
  }
  return {
    list,
    editor,
    submissions,
    operatingEntityOptions,
    purchaserOptions,
    settlementOptions,
    referenceLoading,
    currentDetail,
    detailOpen,
    detailLoading,
    detailError,
    openDetail,
    closeDetail,
    canCreate,
    canClone,
    canChange,
    canViewSubmissions: () => can(customerPaths.submissionQuery),
    openCreate,
    openClone,
    openHistoricalClone,
    openChange,
    closeEditor,
    submit,
    verifyEditorOutcome,
    canEditSubunits,
    canStageAttachment: () => can(customerPaths.attachment),
    setDefaultOperatingEntity,
    addSubunit,
    removeSubunit,
    setCustomerType,
    setPaymentMethod,
    setAttributionType,
    setAttribution,
    attributionCandidates,
    setCostBasis,
    addAttachment,
    attachmentUploads,
    paymentOptions,
    customerTypeOptions,
    salesPartnerOptions,
    setSettlementMethod,
    rowActions,
    runRowAction,
    dispose,
  }
}
