import { computed, onScopeDispose, reactive, ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { localDate } from '@/utils/date'
import { useSessionStore } from '@/stores/session'
import { buildBillReceiptPayload } from './payload'
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
  handler: BillReference | null
  internalCostRateBps: number
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
interface ReferencePage {
  items: BillReference[]
  total: number
  page: number
  pageSize: number
}

type VouQueryRequest = components['schemas']['VouQueryRequest']
type VouGetRequest = components['schemas']['VouGetRequest']
type VouCreateRequest = components['schemas']['VouCreateRequest']
type VouSaveRequest = components['schemas']['VouSaveRequest']
type VouRevisionRequest = components['schemas']['VouDocumentRevisionRequest']
type VouReverseRequest = components['schemas']['VouReverseRequest']
type VouFinalizeRequest = components['schemas']['VouFinalizeRequest']
type BobQueryRequest = components['schemas']['BobQueryRequest']
type LedBillQueryRequest = components['schemas']['LedBillQueryRequest']

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
    handler: null,
    internalCostRateBps: 0,
    billLines: [emptyLine()],
    billCashLines: [],
  }
}

export function useBillVoucherViewModel(config: BillVoucherConfig) {
  const session = useSessionStore()
  const permission = (action: string) => `/vou/${config.entity}/${action}`
  const canQuery = computed(() => session.can(permission('query')))
  const canCreate = computed(() => session.can(permission('create')))
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
  const handlerOptions = ref<BillReference[]>([])
  const fundAccountOptions = ref<BillReference[]>([])
  const heldBillOptions = ref<BillLineDraft[]>([])
  const actionAvailability = computed<VoucherActionAvailability>(() => ({
    get: session.can(permission('get')),
    save: session.can(permission('save')),
    check: session.can(permission('check')),
    uncheck: session.can(permission('uncheck')),
    approve: session.can(permission('approve')),
    unapprove: session.can(permission('unapprove')),
    finalize: session.can(permission('finalize')),
    unfinalize: session.can(permission('unfinalize')),
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
      const result = await apiClient.postContract(
        `vou/${config.entity}/query`,
        request,
        { signal: controller.signal },
      )
      if (current !== sequence) return
      rows.value = result.data.items
      total.value = result.data.total
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
        `vou/${config.entity}/get`,
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
        handler: billData.handler ?? null,
        internalCostRateBps: billData.internalCostRateBps ?? 0,
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
        edit && data.status === 'DRAFT' && session.can(permission('save'))
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
    )
    if (validation) {
      errorMessage.value = validation
      return false
    }
    saving.value = true
    errorMessage.value = null
    try {
      const data = buildBillReceiptPayload(form)
      if (documentId.value) {
        const request: VouSaveRequest = {
          documentId: documentId.value,
          revision: revision.value,
          data,
        }
        const result = await apiClient.post<MutationResponse, VouSaveRequest>(
          `vou/${config.entity}/save`,
          request,
        )
        revision.value = result.data.revision
      } else {
        const request: VouCreateRequest = { data }
        const result = await apiClient.post<MutationResponse, VouCreateRequest>(
          `vou/${config.entity}/create`,
          request,
        )
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
    action:
      'check' | 'uncheck' | 'approve' | 'unapprove' | 'finalize' | 'unfinalize',
    reason?: string,
  ) {
    if (!documentId.value) return
    actionLoading.value = action
    try {
      let result: { data: MutationResponse }
      if (action === 'finalize') {
        const request: VouFinalizeRequest = {
          documentId: documentId.value,
          revision: revision.value,
        }
        result = await apiClient.post<MutationResponse, VouFinalizeRequest>(
          `vou/${config.entity}/finalize`,
          request,
        )
      } else if (
        action === 'unfinalize' ||
        action === 'uncheck' ||
        action === 'unapprove'
      ) {
        const request: VouReverseRequest = {
          documentId: documentId.value,
          revision: revision.value,
          reason: reason ?? '',
        }
        result = await apiClient.post<MutationResponse, VouReverseRequest>(
          `vou/${config.entity}/${action}`,
          request,
        )
      } else {
        const request: VouRevisionRequest = {
          documentId: documentId.value,
          revision: revision.value,
        }
        result = await apiClient.post<MutationResponse, VouRevisionRequest>(
          `vou/${config.entity}/${action}`,
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
        `vou/${config.entity}/delete`,
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
  let handlerSequence = 0
  let fundSequence = 0
  let heldSequence = 0
  let customerController: AbortController | undefined
  let handlerController: AbortController | undefined
  let fundController: AbortController | undefined
  let heldController: AbortController | undefined
  async function searchCustomer(value: string) {
    const current = ++customerSequence
    customerController?.abort()
    customerController = new AbortController()
    const result = await searchReferencesWithSignal(
      'customer',
      value,
      customerController.signal,
    )
    if (current === customerSequence) customerOptions.value = result
  }
  async function searchHandler(value: string) {
    const current = ++handlerSequence
    handlerController?.abort()
    handlerController = new AbortController()
    const result = await searchReferencesWithSignal(
      'employee',
      value,
      handlerController.signal,
    )
    if (current === handlerSequence) handlerOptions.value = result
  }
  async function searchFundAccount(value: string) {
    const current = ++fundSequence
    fundController?.abort()
    fundController = new AbortController()
    const result = await searchReferencesWithSignal(
      'fund-account',
      value,
      fundController.signal,
    )
    if (current === fundSequence) fundAccountOptions.value = result
  }
  async function searchReferencesWithSignal(
    entity: 'customer' | 'employee' | 'fund-account',
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
      const result = await apiClient.post<ReferencePage, BobQueryRequest>(
        `bob/${entity}/query`,
        request,
        { signal },
      )
      return result.data.items
    } catch {
      return []
    }
  }
  async function searchHeldBills(value: string) {
    const current = ++heldSequence
    heldController?.abort()
    heldController = new AbortController()
    const request: LedBillQueryRequest = {
      page: 1,
      pageSize: 20,
      filters: {
        availability: 'AVAILABLE',
        positionType: 'ASSET',
        ...(value ? { billNo: value } : {}),
      },
      sort: [{ field: 'maturityDate', order: 'asc' }],
    }
    try {
      const result = await apiClient.postContract('led/bill/query', request, {
        signal: heldController.signal,
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
        annualRateBps: row.annualRateBps ?? 0,
        interestDays: row.interestDays,
        interestAmount: row.interestAmount,
        customerCostAmount: row.customerCostAmount,
        remark: '',
      }))
    } catch (error) {
      if (!heldController.signal.aborted)
        errorMessage.value = getErrorMessage(error)
    }
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
    handlerController?.abort()
    fundController?.abort()
    heldController?.abort()
  })
  return {
    config,
    canQuery,
    canCreate,
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
    handlerOptions,
    fundAccountOptions,
    heldBillOptions,
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
    searchHandler,
    searchFundAccount,
    searchHeldBills,
    ...artifacts,
  }
}
