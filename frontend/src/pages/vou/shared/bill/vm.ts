import { computed, onScopeDispose, reactive, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { apiClient, type ApiPostPath } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { localDate } from '@/utils/date'
import { useSessionStore } from '@/stores/session'
import {
  buildBillIssuePayload,
  buildBillDiscountPayload,
  buildBillMaturityPayload,
  buildBillPaymentPayload,
  buildBillReceiptPayload,
} from './payload'
import { validateBillVoucherForm } from './validation'
import type { BillVoucherConfig } from './config'
import { useVoucherArtifacts } from '../artifacts'
import { voucherEntityConfigs } from '../config'
import type {
  VoucherActionAvailability,
  VoucherDocumentData,
  VoucherDocumentView,
  VoucherStatus,
} from '@/components/voucher'

export interface BillReference {
  objectId: string
  versionId: string
  code: string
  name: string
  entity?: string
}
export type BillPurpose = 'PRIMARY' | 'CHANGE'
export type BillPositionType = 'ASSET' | 'LIABILITY'
export type BillDirection = 'IN' | 'OUT'
export interface BillLineDraft {
  key: string
  lineId?: string
  billId?: string
  positionType: BillPositionType
  direction: BillDirection
  purpose: BillPurpose
  billType: 'BANK_ACCEPTANCE' | 'COMMERCIAL_ACCEPTANCE' | 'CHECK' | 'OTHER'
  billNo: string
  medium: 'PAPER' | 'ELECTRONIC'
  currency: string
  faceAmount: string
  issueDate: string
  maturityDate: string
  drawer: string
  acceptor: string
  payee: string
  originatingParty?: BillReference
  annualRateBps: number
  interestDays?: number
  interestAmount?: string
  customerCostAmount?: string
  remark: string
}
export interface BillCashLineDraft {
  key: string
  lineId?: string
  billLineId?: string
  fundAccount: BillReference | null
  direction: BillDirection
  amountType: 'PRINCIPAL' | 'INTEREST' | 'FEE' | 'MARGIN' | 'OTHER'
  amount: string
  remark: string
}
export interface BillVoucherForm {
  businessDate: string
  currency: string
  remark: string
  customer: BillReference | null
  supplier: BillReference | null
  counterparty: BillReference | null
  interestMode: '' | 'BANK_DEDUCTED' | 'THIRD_PARTY_PAYABLE'
  interestParty: BillReference | null
  maturityType: '' | 'RECEIPT' | 'PAYMENT'
  handler: BillReference | null
  internalCostRateBps: number
  withRecourse: boolean
  billLines: BillLineDraft[]
  billCashLines: BillCashLineDraft[]
}
export interface BillListItem {
  documentId: string
  documentNo: string
  status: VoucherStatus
  revision: number
  businessDate: string
  currency: string
  amount: string
  updatedAt: string
  partyName?: string
}
type BillDocumentResponse = Omit<VoucherDocumentView, 'data'> & {
  data: VoucherDocumentData & BillVoucherForm
}
interface MutationResponse {
  documentId: string
  documentNo: string
  status: string
  revision: number
}
type VouQueryRequest = components['schemas']['VouQueryRequest']
type VouGetRequest = components['schemas']['VouGetRequest']
type VouCreateRequest = components['schemas']['VouCreateRequest']
type VouSaveRequest = components['schemas']['VouSaveRequest']
type VouRevisionRequest = components['schemas']['VouDocumentRevisionRequest']
type VouReverseRequest = components['schemas']['VouReverseRequest']
type BobQueryRequest = components['schemas']['BobQueryRequest']
type BobListPage = components['schemas']['BobListPage']
type LedBillQueryRequest = components['schemas']['LedBillQueryRequest']
type BillPaymentData = ReturnType<typeof buildBillPaymentPayload>
type BillIssueData = ReturnType<typeof buildBillIssuePayload>
type BillDiscountData = ReturnType<typeof buildBillDiscountPayload>
type BillMaturityData = ReturnType<typeof buildBillMaturityPayload>
type BillPaymentCreateRequest = { data: BillPaymentData }
type BillPaymentSaveRequest = {
  documentId: string
  revision: number
  data: BillPaymentData
}
type BillIssueCreateRequest = { data: BillIssueData }
type BillIssueSaveRequest = {
  documentId: string
  revision: number
  data: BillIssueData
}
type BillDiscountCreateRequest = { data: BillDiscountData }
type BillDiscountSaveRequest = {
  documentId: string
  revision: number
  data: BillDiscountData
}
type BillMaturityCreateRequest = { data: BillMaturityData }
type BillMaturitySaveRequest = {
  documentId: string
  revision: number
  data: BillMaturityData
}

function key() {
  return crypto.randomUUID()
}
function emptyLine(currency = 'CNY'): BillLineDraft {
  return {
    key: key(),
    positionType: 'ASSET',
    direction: 'IN',
    purpose: 'PRIMARY',
    billType: 'BANK_ACCEPTANCE',
    billNo: '',
    medium: 'ELECTRONIC',
    currency,
    faceAmount: '',
    issueDate: localDate(),
    maturityDate: localDate(),
    drawer: '',
    acceptor: '',
    payee: '',
    annualRateBps: 0,
    remark: '',
  }
}
function emptyCash(): BillCashLineDraft {
  return {
    key: key(),
    fundAccount: null,
    direction: 'IN',
    amountType: 'PRINCIPAL',
    amount: '',
    remark: '',
  }
}
function emptyForm(): BillVoucherForm {
  return {
    businessDate: localDate(),
    currency: 'CNY',
    remark: '',
    customer: null,
    supplier: null,
    counterparty: null,
    interestMode: '',
    maturityType: '',
    interestParty: null,
    handler: null,
    internalCostRateBps: 0,
    withRecourse: false,
    billLines: [emptyLine()],
    billCashLines: [],
  }
}

export function useBillVoucherViewModel(config: BillVoucherConfig) {
  const session = useSessionStore()
  const permission = (action: string) => `/vou/${config.entity}/${action}`
  const canQuery = computed(() => session.can(permission('query')))
  const requiresHeldBillAccess = ['payment', 'discount', 'maturity'].includes(
    config.mode,
  )
  const canSelectHeldBills = computed(() => session.can('/led/bill/query'))
  const hasRequiredHeldBillAccess = computed(
    () => !requiresHeldBillAccess || canSelectHeldBills.value,
  )
  const canCreate = computed(
    () => session.can(permission('create')) && hasRequiredHeldBillAccess.value,
  )
  const rows = ref<BillListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const keyword = ref('')
  const status = ref<string[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const workspaceOpen = ref(false)
  const editing = ref(false)
  const documentId = ref<string | null>(null)
  const documentNo = ref('')
  const revision = ref(0)
  const documentStatus = ref<VoucherStatus>('DRAFT')
  const documentView = ref<VoucherDocumentView | null>(null)
  const form = reactive<BillVoucherForm>(emptyForm())
  const customerOptions = ref<BillReference[]>([])
  const supplierOptions = ref<BillReference[]>([])
  const otherPartyOptions = ref<BillReference[]>([])
  const handlerOptions = ref<BillReference[]>([])
  const fundAccountOptions = ref<BillReference[]>([])
  const heldBillOptions = ref<BillLineDraft[]>([])
  const heldSelection = ref<string[]>([])
  const heldDialogOpen = ref(false)
  const actionAvailability = computed<VoucherActionAvailability>(() => ({
    get: session.can(permission('get')),
    save: session.can(permission('save')) && hasRequiredHeldBillAccess.value,
    check: session.can(permission('check')),
    uncheck: session.can(permission('uncheck')),
    approve: session.can(permission('approve')),
    unapprove: session.can(permission('unapprove')),
    delete: session.can(permission('delete')),
    shortCloseRequest: false,
    shortCloseCancel: false,
    shortCloseConfirm: false,
    shortCloseUnconfirm: false,
    audit: session.can(permission('audit-history')),
    attachmentInitiate: session.can(permission('attachment-initiate')),
    attachmentDownload: session.can(permission('attachment-download')),
    attachmentRemove: session.can(permission('attachment-remove')),
  }))
  let controller: AbortController | undefined
  let sequence = 0
  const artifacts = useVoucherArtifacts(
    voucherEntityConfigs[config.entity],
    documentView,
    actionAvailability,
    async (id) => {
      await openDocument({ documentId: id })
    },
  )
  async function query() {
    if (!canQuery.value) return
    controller?.abort()
    controller = new AbortController()
    const current = ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const request: VouQueryRequest = {
        page: page.value,
        pageSize: pageSize.value,
        filters: {
          ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
          ...(status.value.length
            ? { status: status.value as components['schemas']['VouStatus'][] }
            : {}),
        },
        sort: [{ field: 'documentNo', order: 'desc' }],
      }
      const result = await apiClient.post<
        components['schemas']['VouListPage'],
        VouQueryRequest
      >(`vou/${config.entity}/query` as ApiPostPath, request, {
        signal: controller.signal,
      })
      if (current !== sequence) return
      const pageResult = result.data
      rows.value = pageResult.items
      total.value = pageResult.total
    } catch (error) {
      if (current === sequence && !controller.signal.aborted)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (current === sequence) loading.value = false
    }
  }
  async function changePage(next: number) {
    if (
      next < 1 ||
      next > Math.ceil(total.value / pageSize.value) ||
      loading.value
    )
      return
    page.value = next
    await query()
  }
  function openCreate() {
    if (!canCreate.value) return
    Object.assign(form, emptyForm())
    if (config.mode === 'payment') form.billLines = []
    if (config.mode === 'discount') {
      form.billLines = []
      form.interestMode = 'BANK_DEDUCTED'
    }
    if (config.mode === 'issue') {
      form.interestMode = 'BANK_DEDUCTED'
      form.billLines = form.billLines.map((line) => ({
        ...line,
        positionType: 'LIABILITY',
        direction: 'IN',
        purpose: 'PRIMARY',
      }))
    }
    documentView.value = null
    documentId.value = null
    documentNo.value = ''
    revision.value = 0
    documentStatus.value = 'DRAFT'
    editing.value = true
    workspaceOpen.value = true
  }
  async function openDocument(
    row: Pick<BillListItem, 'documentId'>,
    edit = false,
  ) {
    if (!session.can(permission('get'))) return
    workspaceOpen.value = true
    loading.value = true
    try {
      const request: VouGetRequest = { documentId: row.documentId }
      const result = await apiClient.post<BillDocumentResponse, VouGetRequest>(
        `vou/${config.entity}/get` as ApiPostPath,
        request,
      )
      const data = result.data
      const billData = data.data
      documentId.value = data.documentId
      documentNo.value = data.documentNo
      revision.value = data.revision
      documentStatus.value = data.status
      Object.assign(form, {
        businessDate: billData.businessDate,
        currency: billData.currency,
        remark: billData.remark ?? '',
        customer: billData.counterparty ?? billData.customer ?? null,
        supplier: billData.supplier ?? null,
        counterparty: billData.counterparty ?? null,
        interestMode: billData.interestMode ?? '',
        maturityType: billData.maturityType ?? '',
        interestParty: billData.interestParty ?? null,
        handler: billData.handler ?? null,
        internalCostRateBps: billData.internalCostRateBps ?? 0,
        withRecourse: billData.withRecourse ?? false,
        billLines: (billData.billLines ?? []).map((line) => ({
          ...line,
          key: line.lineId || line.billId || key(),
          remark: line.remark ?? '',
        })),
        billCashLines: (billData.billCashLines ?? []).map((line) => ({
          ...line,
          key: line.lineId || key(),
          remark: line.remark ?? '',
        })),
      })
      documentView.value = data
      editing.value =
        edit && data.status === 'DRAFT' && actionAvailability.value.save
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }
  async function save(): Promise<boolean> {
    const validation = validateBillVoucherForm(
      form,
      config.maxBillLines,
      config.maxCashLines,
      config.mode,
    )
    if (validation) {
      errorMessage.value = validation
      return false
    }
    saving.value = true
    errorMessage.value = null
    try {
      const data =
        config.mode === 'payment'
          ? buildBillPaymentPayload(form)
          : config.mode === 'issue'
            ? buildBillIssuePayload(form)
            : config.mode === 'discount'
              ? buildBillDiscountPayload(form)
              : config.mode === 'maturity'
                ? buildBillMaturityPayload(form)
                : buildBillReceiptPayload(form)
      if (documentId.value) {
        const request =
          config.mode === 'payment'
            ? ({
                documentId: documentId.value,
                revision: revision.value,
                data,
              } as BillPaymentSaveRequest)
            : config.mode === 'issue'
              ? ({
                  documentId: documentId.value,
                  revision: revision.value,
                  data,
                } as BillIssueSaveRequest)
              : config.mode === 'discount'
                ? ({
                    documentId: documentId.value,
                    revision: revision.value,
                    data,
                  } as BillDiscountSaveRequest)
                : config.mode === 'maturity'
                  ? ({
                      documentId: documentId.value,
                      revision: revision.value,
                      data,
                    } as BillMaturitySaveRequest)
                  : ({
                      documentId: documentId.value,
                      revision: revision.value,
                      data,
                    } as VouSaveRequest)
        const result = await apiClient.post<
          MutationResponse,
          | VouSaveRequest
          | BillPaymentSaveRequest
          | BillIssueSaveRequest
          | BillDiscountSaveRequest
          | BillMaturitySaveRequest
        >(`vou/${config.entity}/save` as ApiPostPath, request)
        revision.value = result.data.revision
      } else {
        const request =
          config.mode === 'payment'
            ? ({ data } as BillPaymentCreateRequest)
            : config.mode === 'issue'
              ? ({ data } as BillIssueCreateRequest)
              : config.mode === 'discount'
                ? ({ data } as BillDiscountCreateRequest)
                : config.mode === 'maturity'
                  ? ({ data } as BillMaturityCreateRequest)
                  : ({ data } as VouCreateRequest)
        const result = await apiClient.post<
          MutationResponse,
          | VouCreateRequest
          | BillPaymentCreateRequest
          | BillIssueCreateRequest
          | BillDiscountCreateRequest
          | BillMaturityCreateRequest
        >(`vou/${config.entity}/create` as ApiPostPath, request)
        documentId.value = result.data.documentId
        documentNo.value = result.data.documentNo
        revision.value = result.data.revision
      }
      editing.value = false
      await Promise.all([
        query(),
        openDocument({ documentId: documentId.value }),
      ])
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }
  async function lifecycle(
    action: 'check' | 'uncheck' | 'approve' | 'unapprove',
    reason?: string,
  ) {
    if (!documentId.value) return
    actionLoading.value = action
    try {
      let result: { data: MutationResponse }
      if (action === 'uncheck' || action === 'unapprove') {
        const request: VouReverseRequest = {
          documentId: documentId.value,
          revision: revision.value,
          reason: reason ?? '',
        }
        result = await apiClient.post<MutationResponse, VouReverseRequest>(
          `vou/${config.entity}/${action}` as ApiPostPath,
          request,
        )
      } else {
        const request: VouRevisionRequest = {
          documentId: documentId.value,
          revision: revision.value,
        }
        result = await apiClient.post<MutationResponse, VouRevisionRequest>(
          `vou/${config.entity}/${action}` as ApiPostPath,
          request,
        )
      }
      revision.value = result.data.revision
      documentStatus.value = result.data.status as VoucherStatus
      if (documentView.value) {
        documentView.value.revision = result.data.revision
        documentView.value.status = result.data.status as VoucherStatus
      }
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      actionLoading.value = null
    }
  }
  async function deleteDraft(reason: string): Promise<boolean> {
    if (!documentId.value || !actionAvailability.value.delete) return false
    actionLoading.value = 'delete'
    try {
      const request: VouReverseRequest = {
        documentId: documentId.value,
        revision: revision.value,
        reason,
      }
      await apiClient.post<MutationResponse, VouReverseRequest>(
        `vou/${config.entity}/delete` as ApiPostPath,
        request,
      )
      workspaceOpen.value = false
      documentView.value = null
      await query()
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }
  let customerSequence = 0
  let supplierSequence = 0
  let otherPartySequence = 0
  let handlerSequence = 0
  let fundSequence = 0
  let heldSequence = 0
  let customerController: AbortController | undefined
  let supplierController: AbortController | undefined
  let otherPartyController: AbortController | undefined
  let handlerController: AbortController | undefined
  let fundController: AbortController | undefined
  let heldController: AbortController | undefined
  async function searchCustomer(value: string) {
    const current = ++customerSequence
    customerController?.abort()
    supplierController?.abort()
    otherPartyController?.abort()
    const requestController = new AbortController()
    customerController = requestController
    const result = await searchReferencesWithSignal(
      'customer',
      value,
      requestController.signal,
    )
    if (current === customerSequence && !requestController.signal.aborted)
      customerOptions.value = result
  }
  async function searchSupplier(value: string) {
    const current = ++supplierSequence
    supplierController?.abort()
    const requestController = new AbortController()
    supplierController = requestController
    const result = await searchReferencesWithSignal(
      'supplier',
      value,
      requestController.signal,
    )
    if (current === supplierSequence && !requestController.signal.aborted)
      supplierOptions.value = result
  }
  async function searchOtherParty(value: string) {
    const current = ++otherPartySequence
    otherPartyController?.abort()
    const requestController = new AbortController()
    otherPartyController = requestController
    const result = await searchReferencesWithSignal(
      'other-party',
      value,
      requestController.signal,
    )
    if (current === otherPartySequence && !requestController.signal.aborted)
      otherPartyOptions.value = result
  }
  async function searchHandler(value: string) {
    const current = ++handlerSequence
    handlerController?.abort()
    const requestController = new AbortController()
    handlerController = requestController
    const result = await searchReferencesWithSignal(
      'employee',
      value,
      requestController.signal,
    )
    if (current === handlerSequence && !requestController.signal.aborted)
      handlerOptions.value = result
  }
  async function searchFundAccount(value: string) {
    const current = ++fundSequence
    fundController?.abort()
    const requestController = new AbortController()
    fundController = requestController
    const result = await searchReferencesWithSignal(
      'fund-account',
      value,
      requestController.signal,
    )
    if (current === fundSequence && !requestController.signal.aborted)
      fundAccountOptions.value = result
  }
  async function searchReferencesWithSignal(
    entity:
      'customer' | 'supplier' | 'other-party' | 'employee' | 'fund-account',
    value: string,
    signal: AbortSignal,
  ) {
    const request: BobQueryRequest = {
      page: 1,
      pageSize: 20,
      filters: { keyword: value },
      sort: [{ field: 'code', order: 'asc' }],
    }
    try {
      const result = await apiClient.post<BobListPage, BobQueryRequest>(
        `bob/${entity}/query`,
        request,
        { signal },
      )
      return result.data.items.map((item) => ({
        objectId: item.objectId,
        versionId: item.currentVersion.versionId,
        entity: item.entity,
        code: item.code,
        name: String(item.currentVersion.summary.name ?? item.code),
      }))
    } catch {
      return []
    }
  }
  async function searchHeldBills(value: string) {
    if (!canSelectHeldBills.value) {
      heldBillOptions.value = []
      return
    }
    const current = ++heldSequence
    heldController?.abort()
    const requestController = new AbortController()
    heldController = requestController
    const request: LedBillQueryRequest = {
      page: 1,
      pageSize: 20,
      filters: {
        availability: config.mode === 'maturity' ? 'HELD' : 'AVAILABLE',
        positionType:
          config.mode === 'maturity' && form.maturityType === 'PAYMENT'
            ? 'LIABILITY'
            : 'ASSET',
        ...(value ? { billNo: value } : {}),
      },
      sort: [{ field: 'maturityDate', order: 'asc' }],
    }
    try {
      const result = await apiClient.postContract('led/bill/query', request, {
        signal: requestController.signal,
      })
      if (current !== heldSequence) return
      heldBillOptions.value = result.data.items.map((row) => ({
        key: row.billId,
        billId: row.billId,
        positionType: row.positionType,
        direction: 'OUT',
        purpose: 'CHANGE',
        billType: row.billType,
        billNo: row.billNo,
        medium: row.medium === 'PAPER' ? 'PAPER' : 'ELECTRONIC',
        currency: row.currency,
        faceAmount: row.faceAmount,
        issueDate: row.issueDate,
        maturityDate: row.maturityDate,
        drawer: row.drawer,
        acceptor: row.acceptor,
        payee: row.payee,
        originatingParty: row.originatingParty,
        annualRateBps: row.annualRateBps ?? 0,
        interestDays: row.interestDays,
        interestAmount: row.interestAmount,
        customerCostAmount: row.customerCostAmount,
        remark: '',
      }))
    } catch (error) {
      if (current === heldSequence && !requestController.signal.aborted)
        errorMessage.value = getErrorMessage(error)
    }
  }
  async function openHeldDialog() {
    if (!canSelectHeldBills.value) return
    heldSelection.value = form.billLines
      .map((line) => line.billId)
      .filter((billId): billId is string => Boolean(billId))
    heldDialogOpen.value = true
    await searchHeldBills('')
  }
  function changeMaturityType(value: '' | 'RECEIPT' | 'PAYMENT') {
    if (form.maturityType !== value) {
      form.billLines = []
      heldSelection.value = []
    }
    form.maturityType = value
    if (!value) return
    void searchHeldBills('')
  }
  function applyHeldSelection() {
    const selected = new Set(heldSelection.value)
    const currentByBillID = new Map(
      form.billLines
        .filter((line) => line.billId)
        .map((line) => [line.billId!, line]),
    )
    const optionByBillID = new Map(
      heldBillOptions.value
        .filter((line) => line.billId)
        .map((line) => [line.billId!, line]),
    )
    form.billLines = [...selected]
      .map(
        (billID) => optionByBillID.get(billID) ?? currentByBillID.get(billID),
      )
      .filter((line): line is BillLineDraft => Boolean(line))
      .slice(0, config.maxBillLines)
      .map((line) => ({
        ...line,
        purpose: 'PRIMARY' as const,
        direction: 'OUT' as const,
      }))
    if (config.mode === 'maturity' && form.maturityType === 'RECEIPT') {
      form.billLines = form.billLines.map((line) => ({
        ...line,
        positionType: 'ASSET' as const,
        direction: 'OUT' as const,
      }))
    }
    if (config.mode === 'maturity' && form.maturityType === 'PAYMENT') {
      form.billLines = form.billLines.map((line) => ({
        ...line,
        positionType: 'LIABILITY' as const,
        direction: 'OUT' as const,
      }))
    }
    heldDialogOpen.value = false
  }
  function addBillLine() {
    if (form.billLines.length < config.maxBillLines)
      form.billLines.push(emptyLine(form.currency))
  }
  function addCashLine() {
    if (form.billCashLines.length < config.maxCashLines)
      form.billCashLines.push(emptyCash())
  }
  onScopeDispose(() => {
    controller?.abort()
    customerController?.abort()
    supplierController?.abort()
    handlerController?.abort()
    fundController?.abort()
    heldController?.abort()
    otherPartyController?.abort()
  })
  return {
    config,
    canQuery,
    canCreate,
    canSelectHeldBills,
    rows,
    total,
    page,
    pageSize,
    keyword,
    status,
    loading,
    saving,
    actionLoading,
    errorMessage,
    workspaceOpen,
    editing,
    documentId,
    documentNo,
    revision,
    documentStatus,
    documentView,
    actionAvailability,
    form,
    customerOptions,
    supplierOptions,
    otherPartyOptions,
    handlerOptions,
    fundAccountOptions,
    heldBillOptions,
    heldSelection,
    heldDialogOpen,
    query,
    changePage,
    openCreate,
    openDocument,
    save,
    lifecycle,
    deleteDraft,
    addBillLine,
    addCashLine,
    searchCustomer,
    searchSupplier,
    searchOtherParty,
    searchHandler,
    searchFundAccount,
    searchHeldBills,
    openHeldDialog,
    changeMaturityType,
    applyHeldSelection,
    ...artifacts,
  }
}
