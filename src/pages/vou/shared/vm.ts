import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
} from 'vue'
import { apiClient } from '@/api/client'
import {
  getErrorMessage,
  type PageRequest,
  type PageResult,
} from '@/api/types'
import {
  calculateLineAmount,
  isMoney,
  isQuantity,
  sumMoney,
  type VoucherActionAvailability,
  type VoucherDocumentView,
  type VoucherDraftForm,
  type VoucherEntityConfig,
  type VoucherExecutionForm,
  type VoucherListItem,
  type VoucherMutationResult,
  type VoucherQueryFilters,
  type VoucherReference,
  type VoucherSort,
} from '@/components/voucher'
import { useSessionStore } from '@/stores/session'
import { useVoucherArtifacts } from './artifacts'
import {
  emptyForm,
  formFromDocument,
  inputReference,
  snapshot,
  type DraftPayload,
} from './form'
import { useVoucherReferences } from './references'

const PERSONNEL_KEYS = new Set(['salesperson', 'purchaser'])

export function useVoucherEntityViewModel(config: VoucherEntityConfig) {
  const session = useSessionStore()
  const rows = ref<VoucherListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const filters = reactive<VoucherQueryFilters>({
    keyword: '',
    status: [],
    dateFrom: '',
    dateTo: '',
    partyObjectId: '',
  })
  const sort = ref<VoucherSort>({ field: 'updatedAt', order: 'desc' })
  const selectedParty = ref<VoucherReference | null>(null)
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  let querySequence = 0
  let queryController: AbortController | null = null

  const workspaceOpen = ref(false)
  const workspaceLoading = ref(false)
  const editing = ref(false)
  const saving = ref(false)
  const actionLoading = ref<string | null>(null)
  const workspaceError = ref<string | null>(null)
  const documentView = ref<VoucherDocumentView | null>(null)
  const form = ref<VoucherDraftForm>(emptyForm(config))
  const initialForm = ref(snapshot(form.value))
  const personnelDirty = new Set<string>()

  const executionOpen = ref(false)
  const executionError = ref<string | null>(null)

  const {
    referenceOptions,
    referenceLoading,
    referenceError,
    searchReference,
    clearReferenceSearches,
  } = useVoucherReferences(config, form)

  const dirty = computed(
    () => editing.value && snapshot(form.value) !== initialForm.value,
  )
  const canQuery = computed(() => session.can(permission('query')))
  const canCreate = computed(() => session.can(permission('create')))
  const actionAvailability = computed<VoucherActionAvailability>(() => {
    const status = documentView.value?.status
    return {
      get: session.can(permission('get')),
      save: status === 'DRAFT' && session.can(permission('save')),
      review: status === 'DRAFT' && session.can(permission('review')),
      unreview: status === 'REVIEWED' && session.can(permission('unreview')),
      approve: status === 'REVIEWED' && session.can(permission('approve')),
      unapprove: status === 'APPROVED' && session.can(permission('unapprove')),
      execute: status === 'APPROVED' && session.can(permission('execute')),
      unexecute: status === 'EXECUTED' && session.can(permission('unexecute')),
      audit: Boolean(documentView.value) && session.can(permission('audit-history')),
      attachmentInitiate:
        status === 'DRAFT' && session.can(permission('attachment-initiate')),
      attachmentDownload:
        Boolean(documentView.value) && session.can(permission('attachment-download')),
      attachmentRemove:
        status === 'DRAFT' && session.can(permission('attachment-remove')),
    }
  })
  const {
    attachmentLoading,
    attachmentError,
    auditEvents,
    auditPage,
    auditPageSize,
    auditTotal,
    auditLoading,
    auditError,
    uploadAttachments,
    downloadAttachment,
    removeAttachment,
    loadAudit,
  } = useVoucherArtifacts(
    config,
    documentView,
    actionAvailability,
    loadDocument,
  )
  const busy = computed(
    () => workspaceLoading.value || saving.value ||
      Boolean(actionLoading.value) || attachmentLoading.value,
  )

  function permission(action: string): string {
    return `/vou/${config.entity}/${action}`
  }

  function canView(): boolean {
    return session.can(permission('get'))
  }

  function canEdit(row: VoucherListItem): boolean {
    return row.status === 'DRAFT' &&
      session.can(permission('get')) &&
      session.can(permission('save'))
  }

  async function query(): Promise<void> {
    if (!canQuery.value) {
      rows.value = []
      total.value = 0
      errorMessage.value = '当前账号没有查询此类单据的权限。'
      return
    }
    const sequence = ++querySequence
    queryController?.abort()
    const controller = new AbortController()
    queryController = controller
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<
        PageResult<VoucherListItem>,
        PageRequest
      >(`vou/${config.entity}/query`, {
        page: page.value,
        pageSize: pageSize.value,
        filters: {
          ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
          ...(filters.status.length ? { status: [...filters.status] } : {}),
          ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
          ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
          ...(selectedParty.value
            ? { partyObjectId: selectedParty.value.objectId }
            : {}),
        },
        sort: [{ ...sort.value }],
      }, { signal: controller.signal })
      if (sequence !== querySequence) return
      rows.value = data.items ?? []
      total.value = data.total ?? 0
      page.value = data.page ?? page.value
      pageSize.value = data.pageSize ?? pageSize.value
    } catch (error) {
      if (sequence !== querySequence) return
      rows.value = []
      total.value = 0
      errorMessage.value = getErrorMessage(error)
    } finally {
      if (sequence === querySequence) loading.value = false
      if (queryController === controller) queryController = null
    }
  }

  async function search(): Promise<void> {
    page.value = 1
    await query()
  }

  async function changePage(next: number): Promise<void> {
    if (next < 1 || loading.value) return
    page.value = next
    await query()
  }

  async function resetFilters(): Promise<void> {
    Object.assign(filters, {
      keyword: '',
      status: [],
      dateFrom: '',
      dateTo: '',
      partyObjectId: '',
    })
    selectedParty.value = null
    sort.value = { field: 'updatedAt', order: 'desc' }
    await search()
  }

  function openCreate(): void {
    if (!canCreate.value) return
    documentView.value = null
    form.value = emptyForm(config)
    initialForm.value = snapshot(form.value)
    personnelDirty.clear()
    editing.value = true
    workspaceError.value = null
    attachmentError.value = null
    auditEvents.value = []
    workspaceOpen.value = true
  }

  async function openDocument(row: VoucherListItem, edit = false): Promise<void> {
    if (!canView()) return
    workspaceOpen.value = true
    workspaceLoading.value = true
    workspaceError.value = null
    try {
      await loadDocument(row.documentId)
      editing.value = edit && documentView.value?.status === 'DRAFT'
      if (actionAvailability.value.audit) void loadAudit(1)
    } catch (error) {
      workspaceError.value = getErrorMessage(error)
    } finally {
      workspaceLoading.value = false
    }
  }

  async function loadDocument(documentId?: string): Promise<void> {
    const id = documentId ?? documentView.value?.documentId
    if (!id) return
    const { data } = await apiClient.post<
      VoucherDocumentView,
      { documentId: string }
    >(`vou/${config.entity}/get`, { documentId: id })
    documentView.value = data
    form.value = formFromDocument(data)
    initialForm.value = snapshot(form.value)
    personnelDirty.clear()
  }

  async function reloadDocument(): Promise<void> {
    if (!documentView.value) return
    workspaceLoading.value = true
    workspaceError.value = null
    try {
      await loadDocument()
    } catch (error) {
      workspaceError.value = getErrorMessage(error)
    } finally {
      workspaceLoading.value = false
    }
  }

  function startEditing(): void {
    if (documentView.value?.status !== 'DRAFT' ||
      !actionAvailability.value.save) return
    editing.value = true
    initialForm.value = snapshot(form.value)
  }

  function cancelEditing(): void {
    if (documentView.value) form.value = formFromDocument(documentView.value)
    editing.value = false
    initialForm.value = snapshot(form.value)
    personnelDirty.clear()
  }

  function closeWorkspace(): void {
    workspaceOpen.value = false
    documentView.value = null
    editing.value = false
    workspaceError.value = null
    executionOpen.value = false
    personnelDirty.clear()
    clearReferenceSearches()
  }

  function markReferenceChanged(key: keyof VoucherDraftForm): void {
    if (PERSONNEL_KEYS.has(key)) personnelDirty.add(key)
    if (key === 'fundAccount') {
      form.value.currency = form.value.fundAccount?.currency ?? ''
    }
    if (key === 'counterpartyType') form.value.counterparty = null
  }

  function validateDraft(): string | null {
    const value = form.value
    if (!value.businessDate) return '请选择业务日期。'
    if (!/^[A-Z]{3}$/.test(value.currency.trim().toUpperCase())) {
      return '币种必须是三位大写字母。'
    }
    if (Array.from(value.remark).length > 1000) return '备注不能超过 1000 字。'
    if (config.partyMode === 'customer' && !value.customer) return '请选择客户。'
    if (config.partyMode === 'supplier' && !value.supplier) return '请选择供应商。'
    if (config.partyMode === 'dual' && (!value.customer || !value.supplier)) {
      return '请选择客户和供应商。'
    }
    if (
      config.partyMode === 'counterparty' &&
      config.entity !== 'other-income' &&
      (!value.counterpartyType || !value.counterparty)
    ) {
      return '请选择往来方类型和往来方。'
    }
    if (value.counterparty && !value.counterpartyType) return '请选择往来方类型。'
    if (config.usesEmployee && !value.employee) return '请选择员工。'
    if (config.usesWarehouse && !value.warehouse) return '请选择仓库。'
    if (config.usesFundAccount && !value.fundAccount) return '请选择资金账户。'
    if (config.usesHandler && !value.handler) return '请选择经办人。'
    if (config.usesSourceName &&
      (!value.sourceName.trim() || Array.from(value.sourceName.trim()).length > 200)) {
      return '来源名称必填且不能超过 200 字。'
    }
    if (config.directAmount && !isMoney(value.amount)) return '金额格式不正确。'
    if (config.lineKind === 'product') {
      if (value.productLines.length < 1 || value.productLines.length > 200) {
        return '产品明细必须包含 1 到 200 行。'
      }
      const seen = new Set<string>()
      const lineAmounts: string[] = []
      for (const line of value.productLines) {
        if (!line.product || !isQuantity(line.orderedQuantity) ||
          !isMoney(line.unitPrice)) return '请完整填写有效的产品、数量和单价。'
        if (config.entity === 'intermediary-sale-order' &&
          !isMoney(line.purchaseUnitPrice)) {
          return '请完整填写有效的采购单价。'
        }
        const lineAmount = calculateLineAmount(
          line.orderedQuantity,
          line.unitPrice,
        )
        if (!lineAmount) return '产品行金额超出允许范围。'
        lineAmounts.push(lineAmount)
        if (Array.from(line.remark).length > 1000) return '产品行备注不能超过 1000 字。'
        const key = `${line.product.objectId}/${line.product.versionId}`
        if (seen.has(key)) return '同一产品不能重复添加。'
        seen.add(key)
      }
      if (!sumMoney(lineAmounts)) return '单据总金额超出允许范围。'
    }
    if (config.lineKind === 'expense') {
      if (value.expenseLines.length < 1 || value.expenseLines.length > 200) {
        return '费用明细必须包含 1 到 200 行。'
      }
      for (const line of value.expenseLines) {
        if (!line.category.trim() || Array.from(line.category.trim()).length > 100 ||
          !line.description.trim() ||
          Array.from(line.description.trim()).length > 500 ||
          !isMoney(line.amount) || Array.from(line.remark).length > 1000) {
          return '请完整填写有效的费用明细。'
        }
      }
      if (!sumMoney(value.expenseLines.map((line) => line.amount))) {
        return '单据总金额超出允许范围。'
      }
    }
    return null
  }

  function buildDraftPayload(): DraftPayload {
    const value = form.value
    const payload: DraftPayload = {
      businessDate: value.businessDate,
      currency: value.currency.trim().toUpperCase(),
      ...(value.remark.trim() ? { remark: value.remark.trim() } : {}),
    }
    if (config.partyMode === 'customer' || config.partyMode === 'dual') {
      payload.customer = inputReference(value.customer)
    }
    if (config.partyMode === 'supplier' || config.partyMode === 'dual') {
      payload.supplier = inputReference(value.supplier)
    }
    if (config.partyMode === 'counterparty' && value.counterparty) {
      payload.counterpartyType = value.counterpartyType
      payload.counterparty = inputReference(value.counterparty)
    }
    if (config.usesEmployee) payload.employee = inputReference(value.employee)
    if (config.usesSalesperson &&
      (!documentView.value || personnelDirty.has('salesperson'))) {
      payload.salesperson = inputReference(value.salesperson)
    }
    if (config.usesPurchaser &&
      (!documentView.value || personnelDirty.has('purchaser'))) {
      payload.purchaser = inputReference(value.purchaser)
    }
    if (config.usesHandler) payload.handler = inputReference(value.handler)
    if (config.usesWarehouse) payload.warehouse = inputReference(value.warehouse)
    if (config.usesFundAccount) payload.fundAccount = inputReference(value.fundAccount)
    if (config.usesSourceName) payload.sourceName = value.sourceName.trim()
    if (config.directAmount) payload.amount = value.amount.trim()
    if (config.lineKind === 'product') {
      payload.productLines = value.productLines.map((line) => ({
        product: inputReference(line.product)!,
        orderedQuantity: line.orderedQuantity.trim(),
        unitPrice: line.unitPrice.trim(),
        ...(config.entity === 'intermediary-sale-order'
          ? { purchaseUnitPrice: line.purchaseUnitPrice.trim() }
          : {}),
        ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
      }))
    }
    if (config.lineKind === 'expense') {
      payload.expenseLines = value.expenseLines.map((line) => ({
        category: line.category.trim(),
        description: line.description.trim(),
        amount: line.amount.trim(),
        ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
      }))
    }
    return payload
  }

  async function save(): Promise<boolean> {
    const validation = validateDraft()
    if (validation) {
      workspaceError.value = validation
      return false
    }
    saving.value = true
    workspaceError.value = null
    try {
      const payload = buildDraftPayload()
      let result: VoucherMutationResult
      if (documentView.value) {
        const response = await apiClient.post<
          VoucherMutationResult,
          { documentId: string; revision: number; data: DraftPayload }
        >(`vou/${config.entity}/save`, {
          documentId: documentView.value.documentId,
          revision: documentView.value.revision,
          data: payload,
        })
        result = response.data
      } else {
        const response = await apiClient.post<
          VoucherMutationResult,
          { data: DraftPayload }
        >(`vou/${config.entity}/create`, { data: payload })
        result = response.data
      }
      await loadDocument(result.documentId)
      editing.value = true
      await query()
      return true
    } catch (error) {
      workspaceError.value = getErrorMessage(error)
      return false
    } finally {
      saving.value = false
    }
  }

  async function lifecycleAction(
    action: 'review' | 'approve' | 'execute' |
      'unreview' | 'unapprove' | 'unexecute',
    reason?: string,
  ): Promise<void> {
    const current = documentView.value
    if (!current || !actionAvailability.value[action]) return
    if (action === 'execute') {
      executionError.value = null
      executionOpen.value = true
      return
    }
    actionLoading.value = action
    workspaceError.value = null
    try {
      await apiClient.post<VoucherMutationResult, Record<string, unknown>>(
        `vou/${config.entity}/${action}`,
        {
          documentId: current.documentId,
          revision: current.revision,
          ...(reason ? { reason } : {}),
        },
      )
      await loadDocument(current.documentId)
      editing.value = false
      await Promise.all([query(), loadAudit(1)])
    } catch (error) {
      workspaceError.value = getErrorMessage(error)
    } finally {
      actionLoading.value = null
    }
  }

  async function execute(execution: VoucherExecutionForm): Promise<void> {
    const current = documentView.value
    if (!current || !actionAvailability.value.execute) return
    actionLoading.value = 'execute'
    executionError.value = null
    try {
      await apiClient.post<VoucherMutationResult, Record<string, unknown>>(
        `vou/${config.entity}/execute`,
        {
          documentId: current.documentId,
          revision: current.revision,
          ...(config.executionKind === 'sale' ? {
            outboundDate: execution.outboundDate,
            signoffDate: execution.signoffDate,
            platform: inputReference(execution.platform),
            vehicle: inputReference(execution.vehicle),
            ...(execution.differenceReason.trim()
              ? { differenceReason: execution.differenceReason.trim() }
              : {}),
            saleLines: execution.saleLines.map((line) => ({
              lineId: line.lineId,
              outboundQuantity: line.outboundQuantity,
              signedQuantity: line.signedQuantity,
              rejectedQuantity: line.rejectedQuantity,
              lossQuantity: line.lossQuantity,
            })),
          } : {}),
          ...(config.executionKind === 'purchase' ? {
            inboundDate: execution.inboundDate,
            ...(execution.differenceReason.trim()
              ? { differenceReason: execution.differenceReason.trim() }
              : {}),
            purchaseLines: execution.purchaseLines.map((line) => ({
              lineId: line.lineId,
              inboundQuantity: line.inboundQuantity,
            })),
          } : {}),
        },
      )
      executionOpen.value = false
      await loadDocument(current.documentId)
      await Promise.all([query(), loadAudit(1)])
    } catch (error) {
      executionError.value = getErrorMessage(error)
    } finally {
      actionLoading.value = null
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      querySequence += 1
      queryController?.abort()
    })
  }

  return {
    config,
    rows,
    total,
    page,
    pageSize,
    filters,
    sort,
    selectedParty,
    loading,
    errorMessage,
    workspaceOpen,
    workspaceLoading,
    editing,
    saving,
    actionLoading,
    workspaceError,
    documentView,
    form,
    dirty,
    busy,
    canCreate,
    canQuery,
    actionAvailability,
    executionOpen,
    executionError,
    attachmentLoading,
    attachmentError,
    auditEvents,
    auditPage,
    auditPageSize,
    auditTotal,
    auditLoading,
    auditError,
    canView,
    canEdit,
    query,
    search,
    changePage,
    resetFilters,
    openCreate,
    openDocument,
    loadDocument,
    reloadDocument,
    startEditing,
    cancelEditing,
    closeWorkspace,
    markReferenceChanged,
    save,
    lifecycleAction,
    execute,
    uploadAttachments,
    downloadAttachment,
    removeAttachment,
    loadAudit,
    referenceOptions,
    referenceLoading,
    referenceError,
    searchReference,
  }
}

export type VoucherEntityViewModel = ReturnType<typeof useVoucherEntityViewModel>
