import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
} from 'vue'
import { apiClient } from '@/api/client'
import {
  ApiError,
  getErrorMessage,
  type PageRequest,
  type PageResult,
} from '@/api/types'
import { isMoney, isQuantity, parseFixed } from '@/components/voucher/decimal'
import type {
  VoucherAttachment,
  VoucherReference,
} from '@/components/voucher'
import { useSessionStore } from '@/stores/session'
import {
  calculateContainerBalanceAfter,
  calculateExpectedContainers,
  calculateLoss,
} from './calculations'
import {
  intermediaryActionPath,
  intermediaryWorkflowApi,
  type IntermediaryAction,
  type IntermediaryChildPrefix,
} from './api'
import type {
  IntermediaryAuditEvent,
  IntermediaryBalances,
  IntermediaryChildDetail,
  IntermediaryChildStage,
  IntermediaryChildSummary,
  IntermediaryContainerBalance,
  IntermediaryDeliveryData,
  IntermediaryDeliveryDraft,
  IntermediaryListItem,
  IntermediaryOrderDraft,
  IntermediaryProductReference,
  IntermediaryProcurementData,
  IntermediaryProcurementDraft,
  IntermediaryProcurementLineView,
  IntermediaryQuantityLineView,
  IntermediaryReceiptData,
  IntermediaryReceiptDraft,
  IntermediarySignoffData,
  IntermediarySignoffDraft,
  IntermediarySignoffLineView,
  IntermediaryStageDraft,
  IntermediaryWireDocument,
  IntermediaryWorkflowDocument,
} from './types'

interface ReferenceState {
  options: IntermediaryProductReference[]
  loading: boolean
  error: string | null
  sequence: number
}

interface ReferenceQueryItem {
  objectId: string
  code: string
  effectiveVersionId: string | null
  currentVersion: {
    versionId: string
    status: string
    summary: {
      name: string
      unit?: string
      supplierType?: string
      plateNumber?: string
      platformObjectId?: string
      containerType?: 'NONE' | 'SOLVENT' | 'RESIN'
      quantityPerContainer?: string
    }
  }
}

const emptyBalances = (): IntermediaryBalances => ({
  lines: [],
  containers: [
    { containerType: 'SOLVENT', quantity: 0 },
    { containerType: 'RESIN', quantity: 0 },
  ],
  hasUnfinishedChildren: false,
})

function today(): string {
  const value = new Date()
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
}

function emptyOrder(): IntermediaryOrderDraft {
  return {
    businessDate: today(),
    currency: 'CNY',
    customer: null,
    salesperson: null,
    remark: '',
    productLines: [],
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function childPrefix(stage: IntermediaryChildStage): IntermediaryChildPrefix {
  return stage.toLowerCase() as IntermediaryChildPrefix
}

function toDocument(value: IntermediaryWireDocument): IntermediaryWorkflowDocument {
  if (!value.data.customer || !value.data.salesperson) {
    throw new Error('流程根单缺少客户或业务员快照。')
  }
  return {
    processId: value.processId,
    rootDocumentId: value.rootDocumentId,
    documentId: value.documentId,
    documentNo: value.documentNo,
    workflowStatus:
      value.workflowStatus as IntermediaryWorkflowDocument['workflowStatus'],
    rootRevision: value.rootRevision || value.revision,
    documentRevision: value.revision,
    businessDate: value.data.businessDate,
    currency: value.data.currency,
    amount: value.amount,
    customer: value.data.customer,
    salesperson: value.data.salesperson,
    customerSettlementMethod: value.data.customerSettlementMethod,
    contactName: value.data.contactName,
    contactPhone: value.data.contactPhone,
    deliveryAddress: value.data.deliveryAddress,
    productLines: value.data.productLines ?? [],
    balances: value.balances ?? emptyBalances(),
    children: value.children ?? [],
    attachments: value.attachments ?? [],
    checkedBy: value.checkedBy,
    checkedAt: value.checkedAt,
    approvedBy: value.approvedBy,
    approvedAt: value.approvedAt,
    completedAt: value.completedAt,
    remark: value.data.remark,
    updatedAt: value.updatedAt,
  }
}

function orderFromDocument(
  value: IntermediaryWorkflowDocument,
): IntermediaryOrderDraft {
  return {
    businessDate: value.businessDate,
    currency: value.currency,
    customer: { ...value.customer },
    salesperson: { ...value.salesperson },
    remark: value.remark ?? '',
    productLines: value.productLines.map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      product: {
        ...line.product,
        containerType: line.containerType,
        quantityPerContainer: line.quantityPerContainer,
      },
      orderedQuantity: line.orderedQuantity,
      unitPrice: line.unitPrice,
      containerType: line.containerType || 'NONE',
      quantityPerContainer: line.quantityPerContainer ?? '',
      remark: line.remark ?? '',
    })),
  }
}

function containerBalance(
  balances?: IntermediaryBalances,
): IntermediaryContainerBalance {
  return {
    solvent:
      balances?.containers.find((item) => item.containerType === 'SOLVENT')
        ?.quantity ?? 0,
    resin:
      balances?.containers.find((item) => item.containerType === 'RESIN')
        ?.quantity ?? 0,
  }
}

function formatQuantity(micros: bigint): string {
  const whole = micros / 1_000_000n
  const fraction = (micros % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function remaining(totalValue: string, usedValue: string): string {
  const total = parseFixed(totalValue, 6, true)
  const used = parseFixed(usedValue, 6, true)
  if (total === null || used === null || used >= total) return '0'
  return formatQuantity(total - used)
}

function workflowErrorMessage(error: unknown): string {
  const message = getErrorMessage(error)
  return error instanceof ApiError && error.code === 3001
    ? `${message} 请重新加载流程后重试。`
    : message
}

export function useIntermediaryWorkflowViewModel() {
  const session = useSessionStore()
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  const rows = ref<IntermediaryListItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const filters = reactive({
    keyword: '',
    statuses: [] as string[],
  })
  const selectedParty = ref<VoucherReference | null>(null)
  const queryController = ref<AbortController | null>(null)

  const workspaceOpen = ref(false)
  const workspaceLoading = ref(false)
  const workspaceError = ref<string | null>(null)
  const document = ref<IntermediaryWorkflowDocument | null>(null)
  const activeStep = ref(1)
  const orderEditing = ref(false)
  const orderDraft = ref<IntermediaryOrderDraft>(emptyOrder())
  const orderDirty = ref(false)
  const actionLoading = ref<string | null>(null)

  const stageDialogOpen = ref(false)
  const stageDialogError = ref<string | null>(null)
  const stageEditing = ref<IntermediaryChildStage>('PROCUREMENT')
  const stageChild = ref<IntermediaryChildSummary | null>(null)
  const stageDetail = ref<IntermediaryChildDetail | null>(null)
  const sourceDeliveryDetail = ref<IntermediaryChildDetail | null>(null)
  const stageDraft = ref<IntermediaryStageDraft | null>(null)
  const stageSnapshot = ref('')

  const reverseDialogOpen = ref(false)
  const reverseAction = ref<IntermediaryAction>('uncheck')
  const reverseChild = ref<IntermediaryChildSummary | null>(null)
  const reverseReason = ref('')
  const shortCloseDialogOpen = ref(false)
  const shortCloseReason = ref('')

  const childAttachmentLoading = ref(false)
  const childAttachmentError = ref<string | null>(null)

  const auditEvents = ref<IntermediaryAuditEvent[]>([])
  const auditLoading = ref(false)
  const auditError = ref<string | null>(null)
  const auditPage = ref(1)
  const auditPageSize = ref(20)
  const auditTotal = ref(0)

  const referenceStates = reactive<Record<string, ReferenceState>>({})
  const referenceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const procurement = computed(
    () =>
      document.value?.children.find(
        (item) => item.stage === 'PROCUREMENT',
      ) ?? null,
  )
  const receipts = computed(
    () =>
      document.value?.children.filter((item) => item.stage === 'RECEIPT') ?? [],
  )
  const deliveries = computed(
    () =>
      document.value?.children.filter((item) => item.stage === 'DELIVERY') ?? [],
  )
  const signoffs = computed(
    () =>
      document.value?.children.filter((item) => item.stage === 'SIGNOFF') ?? [],
  )
  const canQuery = computed(() => can('query'))
  const canCreate = computed(() => can('create'))
  const currentUserId = computed(() => session.user?.id ?? '')
  const rootContainerBalance = computed(() =>
    containerBalance(document.value?.balances),
  )
  const stageEditable = computed(
    () =>
      !stageChild.value ||
      stageChild.value.status === 'DRAFT',
  )
  const workspaceDirty = computed(
    () =>
      orderDirty.value ||
      (
        stageDialogOpen.value &&
        JSON.stringify(stageDraft.value) !== stageSnapshot.value
      ),
  )
  const expectedContainers = computed(() => {
    if (stageEditing.value !== 'DELIVERY' || !stageDraft.value || !document.value) {
      return { solvent: 0, resin: 0 }
    }
    const draft = stageDraft.value as IntermediaryDeliveryDraft
    return (
      calculateExpectedContainers(
        draft.lines.map((line) => {
          const rootLine = document.value!.productLines.find(
            (item) => item.lineId === line.rootLineId,
          )
          return {
            quantity: line.quantity,
            containerType: rootLine?.containerType ?? 'NONE',
            quantityPerContainer: rootLine?.quantityPerContainer,
          }
        }),
      ) ?? { solvent: 0, resin: 0 }
    )
  })
  const signoffExpectedContainers = computed<IntermediaryContainerBalance>(() => {
    const detail =
      stageDetail.value?.child.stage === 'DELIVERY'
        ? stageDetail.value
        : sourceDeliveryDetail.value
    const data = detail?.data as IntermediaryDeliveryData | undefined
    return {
      solvent: data?.expectedSolventContainers ?? 0,
      resin: data?.expectedResinContainers ?? 0,
    }
  })
  const signoffBalanceAfter = computed(() => {
    const draft = stageDraft.value as IntermediarySignoffDraft | null
    if (!draft) return rootContainerBalance.value
    return calculateContainerBalanceAfter(
      rootContainerBalance.value,
      signoffExpectedContainers.value,
      {
        solvent: draft.returnedSolventContainers,
        resin: draft.returnedResinContainers,
      },
    )
  })
  const canCreateReceipt = computed(() => {
    if (document.value?.workflowStatus !== 'APPROVED') return false
    if (!can('procurement-get')) return false
    if (procurement.value?.status !== 'ORDERED') return false
    return document.value.balances.lines.some((line) => {
      const ordered = parseFixed(line.procurementQuantity ?? '', 6, true)
      const received = parseFixed(line.confirmedReceiptQuantity, 6, true)
      return ordered !== null && received !== null && ordered > received
    })
  })
  const canCreateDelivery = computed(() => {
    if (document.value?.workflowStatus !== 'APPROVED') return false
    return document.value.balances.lines.some(
      (line) =>
        (parseFixed(line.availableToDeliverQuantity, 6, true) ?? 0n) > 0n,
    )
  })

  function referenceState(key: string): ReferenceState {
    if (!referenceStates[key]) {
      referenceStates[key] = {
        options: [],
        loading: false,
        error: null,
        sequence: 0,
      }
    }
    return referenceStates[key]
  }

  function can(action: IntermediaryAction): boolean {
    return session.can(`/${intermediaryActionPath(action)}`)
  }

  function canFinalize(action: IntermediaryAction, checkedBy?: string): boolean {
    return can(action) && Boolean(checkedBy) && checkedBy !== currentUserId.value
  }

  function queryFilters(): Record<string, unknown> {
    return {
      ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
      ...(filters.statuses.length ? { statuses: filters.statuses } : {}),
    }
  }

  async function query(): Promise<void> {
    if (!canQuery.value) {
      errorMessage.value = '当前账号没有查询居间订单的权限。'
      return
    }
    queryController.value?.abort()
    const controller = new AbortController()
    queryController.value = controller
    loading.value = true
    errorMessage.value = null
    try {
      const request: PageRequest = {
        page: page.value,
        pageSize: pageSize.value,
        filters: queryFilters(),
      }
      const { data } = await intermediaryWorkflowApi.query(
        request,
        controller.signal,
      )
      if (controller.signal.aborted) return
      rows.value = data.items ?? []
      total.value = data.total
      page.value = data.page
      pageSize.value = data.pageSize
    } catch (error) {
      if (!controller.signal.aborted) {
        rows.value = []
        total.value = 0
        errorMessage.value = getErrorMessage(error)
      }
    } finally {
      if (queryController.value === controller) {
        queryController.value = null
        loading.value = false
      }
    }
  }

  async function search(): Promise<void> {
    page.value = 1
    await query()
  }

  async function resetFilters(): Promise<void> {
    filters.keyword = ''
    filters.statuses = []
    selectedParty.value = null
    await search()
  }

  async function changePage(next: number): Promise<void> {
    if (next < 1 || next === page.value || loading.value) return
    page.value = next
    await query()
  }

  function preloadOrderReferences(): void {
    for (const key of ['customer', 'salesperson', 'product']) {
      searchReference(key, '')
    }
  }

  function openCreate(): void {
    if (!canCreate.value) return
    document.value = null
    orderDraft.value = emptyOrder()
    orderEditing.value = true
    orderDirty.value = false
    workspaceError.value = null
    workspaceOpen.value = true
    activeStep.value = 1
    preloadOrderReferences()
  }

  async function openDocument(row: IntermediaryListItem): Promise<void> {
    if (!can('get')) return
    workspaceOpen.value = true
    await loadDocument(row.processId)
  }

  async function loadDocument(processId?: string): Promise<void> {
    const target = processId ?? document.value?.processId
    if (!target || workspaceLoading.value) return
    workspaceLoading.value = true
    workspaceError.value = null
    try {
      const { data } = await intermediaryWorkflowApi.get(target)
      document.value = toDocument(data)
      orderDraft.value = orderFromDocument(document.value)
      orderEditing.value = false
      orderDirty.value = false
    } catch (error) {
      workspaceError.value = workflowErrorMessage(error)
    } finally {
      workspaceLoading.value = false
    }
  }

  function validateOrder(): string | null {
    const form = orderDraft.value
    if (!form.customer) return '请选择客户。'
    if (!form.businessDate) return '请选择订购日期。'
    if (!/^[A-Z]{3}$/.test(form.currency)) return '币种必须为三位大写字母。'
    if (form.productLines.length < 1 || form.productLines.length > 200) {
      return '产品明细必须为 1–200 行。'
    }
    const seen = new Set<string>()
    for (const line of form.productLines) {
      if (!line.product) return '请选择每一行的产品。'
      const key = `${line.product.objectId}/${line.product.versionId}`
      if (seen.has(key)) return '同一产品不能重复添加。'
      seen.add(key)
      if (!isQuantity(line.orderedQuantity)) return '订购数量格式不正确。'
      if (!isMoney(line.unitPrice)) return '销售单价格式不正确。'
      if (
        line.containerType !== 'NONE' &&
        !isQuantity(line.quantityPerContainer)
      ) {
        return '桶装产品必须填写大于零的每桶产品量。'
      }
      if (Array.from(line.remark).length > 1000) {
        return '行备注不能超过 1000 字。'
      }
    }
    return Array.from(form.remark).length <= 1000
      ? null
      : '备注不能超过 1000 字。'
  }

  async function saveOrder(): Promise<boolean> {
    const validation = validateOrder()
    if (validation) {
      workspaceError.value = validation
      return false
    }
    actionLoading.value = 'save'
    workspaceError.value = null
    try {
      const result = document.value
        ? await intermediaryWorkflowApi.save({
            processId: document.value.processId,
            processRevision: document.value.rootRevision,
            documentId: document.value.documentId,
            documentRevision: document.value.documentRevision,
            data: clone(orderDraft.value),
          })
        : await intermediaryWorkflowApi.create(clone(orderDraft.value))
      await loadDocument(result.data.documentId)
      await query()
      return true
    } catch (error) {
      workspaceError.value = workflowErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  function startOrderEditing(): void {
    if (document.value?.workflowStatus !== 'DRAFT') return
    orderDraft.value = orderFromDocument(document.value)
    orderEditing.value = true
    preloadOrderReferences()
  }

  function cancelOrderEditing(): void {
    if (document.value) orderDraft.value = orderFromDocument(document.value)
    orderEditing.value = false
    orderDirty.value = false
  }

  async function runRootAction(action: IntermediaryAction): Promise<boolean> {
    if (!document.value || !can(action) || actionLoading.value) return false
    if (action === 'approve' && !canFinalize(action, document.value.checkedBy)) {
      return false
    }
    actionLoading.value = action
    workspaceError.value = null
    try {
      await intermediaryWorkflowApi.mutate(action, {
        processId: document.value.processId,
        processRevision: document.value.rootRevision,
        documentId: document.value.processId,
        rootRevision: document.value.rootRevision,
        childId: document.value.rootDocumentId,
        childRevision: document.value.documentRevision,
      })
      await loadDocument()
      await query()
      return true
    } catch (error) {
      workspaceError.value = workflowErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  async function getChild(
    stage: IntermediaryChildStage,
    child?: IntermediaryChildSummary,
  ): Promise<IntermediaryChildDetail> {
    if (!document.value) throw new Error('请先打开居间订单。')
    const { data } = await intermediaryWorkflowApi.getChild(
      childPrefix(stage),
      {
        processId: document.value.processId,
        documentId: child?.childId ?? '',
      },
    )
    return data
  }

  function procurementDraftFromDetail(
    detail: IntermediaryChildDetail,
  ): IntermediaryProcurementDraft {
    const data = detail.data as IntermediaryProcurementData
    return {
      purchaseDate: data.purchaseDate,
      supplier: { ...data.supplier },
      purchaser: { ...data.purchaser },
      lines: (detail.lines as IntermediaryProcurementLineView[]).map((line) => ({
        rootLineId: line.rootLineId,
        quantity: line.quantity,
        unitPrice: line.unitPrice ?? '',
        remark: line.remark ?? '',
      })),
      remark: data.remark ?? '',
    }
  }

  function receiptDraftFromDetail(
    detail: IntermediaryChildDetail,
  ): IntermediaryReceiptDraft {
    const data = detail.data as IntermediaryReceiptData
    return {
      receiptDate: data.receiptDate,
      lines: (detail.lines as IntermediaryQuantityLineView[]).map((line) => ({
        rootLineId: line.rootLineId,
        quantity: line.quantity,
        remark: line.remark ?? '',
      })),
      remark: data.remark ?? '',
    }
  }

  function deliveryDraftFromDetail(
    detail: IntermediaryChildDetail,
  ): IntermediaryDeliveryDraft {
    const data = detail.data as IntermediaryDeliveryData
    return {
      deliveryDate: data.deliveryDate,
      platform: { ...data.platform },
      vehicle: { ...data.vehicle },
      lines: (detail.lines as IntermediaryQuantityLineView[]).map((line) => ({
        rootLineId: line.rootLineId,
        quantity: line.quantity,
        remark: line.remark ?? '',
      })),
      remark: data.remark ?? '',
    }
  }

  function signoffDraftFromDetail(
    detail: IntermediaryChildDetail,
  ): IntermediarySignoffDraft {
    const data = detail.data as IntermediarySignoffData
    return {
      deliveryChildId: data.deliveryChildId,
      signoffDate: data.signoffDate,
      lines: (detail.lines as IntermediarySignoffLineView[]).map((line) => ({
        rootLineId: line.rootLineId,
        signedQuantity: line.signedQuantity,
        rejectedQuantity: line.rejectedQuantity,
        remark: line.remark ?? '',
      })),
      returnedSolventContainers: data.returnedSolventContainers,
      returnedResinContainers: data.returnedResinContainers,
      containerDifferenceReason: data.containerDifferenceReason ?? '',
      remark: data.remark ?? '',
    }
  }

  function signoffDraftFromDelivery(
    detail: IntermediaryChildDetail,
  ): IntermediarySignoffDraft {
    const data = detail.data as IntermediaryDeliveryData
    return {
      deliveryChildId: detail.child.childId,
      signoffDate: today(),
      lines: (detail.lines as IntermediaryQuantityLineView[]).map((line) => ({
        rootLineId: line.rootLineId,
        signedQuantity: line.quantity,
        rejectedQuantity: '0',
        remark: '',
      })),
      returnedSolventContainers: data.expectedSolventContainers,
      returnedResinContainers: data.expectedResinContainers,
      containerDifferenceReason: '',
      remark: '',
    }
  }

  async function openStage(
    stage: IntermediaryChildStage,
    child?: IntermediaryChildSummary,
    sourceDelivery?: IntermediaryChildSummary,
  ): Promise<void> {
    if (!document.value) return
    const prefix = childPrefix(stage)
    if (child && !can(`${prefix}-get` as IntermediaryAction)) return
    if (
      sourceDelivery &&
      (!can('signoff-create') || !can('delivery-get'))
    ) {
      return
    }
    stageEditing.value = stage
    stageChild.value = child ?? null
    stageDetail.value = null
    sourceDeliveryDetail.value = null
    stageDialogError.value = null
    childAttachmentError.value = null
    actionLoading.value = `${stage.toLowerCase()}-load`
    try {
      if (child) {
        stageDetail.value = await getChild(stage, child)
        if (stage === 'PROCUREMENT') {
          stageDraft.value = procurementDraftFromDetail(stageDetail.value)
        } else if (stage === 'RECEIPT') {
          stageDraft.value = receiptDraftFromDetail(stageDetail.value)
        } else if (stage === 'DELIVERY') {
          stageDraft.value = deliveryDraftFromDetail(stageDetail.value)
        } else {
          stageDraft.value = signoffDraftFromDetail(stageDetail.value)
          const signoffData = stageDetail.value.data as IntermediarySignoffData
          const source = document.value.children.find(
            (item) =>
              item.stage === 'DELIVERY' &&
              item.childId === signoffData.deliveryChildId,
          )
          if (source && can('delivery-get')) {
            sourceDeliveryDetail.value = await getChild('DELIVERY', source)
          }
        }
      } else if (stage === 'PROCUREMENT') {
        stageDraft.value = {
          purchaseDate: document.value.businessDate,
          supplier: null,
          purchaser: null,
          lines: document.value.productLines.map((line) => ({
            rootLineId: line.lineId,
            quantity: line.orderedQuantity,
            unitPrice: '',
            remark: '',
          })),
          remark: '',
        }
        searchReference('supplier', '')
        searchReference('purchaser', '')
      } else if (stage === 'RECEIPT') {
        stageDraft.value = {
          receiptDate: today(),
          lines: document.value.balances.lines.map((line) => ({
            rootLineId: line.rootLineId,
            quantity: remaining(
              line.procurementQuantity ?? '0',
              line.confirmedReceiptQuantity,
            ),
            remark: '',
          })),
          remark: '',
        }
      } else if (stage === 'DELIVERY') {
        stageDraft.value = {
          deliveryDate: today(),
          platform: null,
          vehicle: null,
          lines: document.value.balances.lines.map((line) => ({
            rootLineId: line.rootLineId,
            quantity: line.availableToDeliverQuantity,
            remark: '',
          })),
          remark: '',
        }
        searchReference('platform', '')
      } else if (sourceDelivery) {
        stageDetail.value = await getChild('DELIVERY', sourceDelivery)
        sourceDeliveryDetail.value = stageDetail.value
        stageDraft.value = signoffDraftFromDelivery(stageDetail.value)
      } else {
        throw new Error('请选择需要签收的送货子单。')
      }
      stageSnapshot.value = JSON.stringify(stageDraft.value)
      stageDialogOpen.value = true
    } catch (error) {
      workspaceError.value = getErrorMessage(error)
    } finally {
      actionLoading.value = null
    }
  }

  function deliveredQuantity(rootLineId: string): string {
    if (
      stageEditing.value === 'SIGNOFF' &&
      stageDetail.value?.child.stage === 'DELIVERY'
    ) {
      return (
        stageDetail.value.lines as IntermediaryQuantityLineView[]
      ).find((line) => line.rootLineId === rootLineId)?.quantity ?? '0'
    }
    if (
      stageEditing.value === 'SIGNOFF' &&
      stageDetail.value?.child.stage === 'SIGNOFF'
    ) {
      const balance = stageDetail.value.balances.lines.find(
        (line) => line.rootLineId === rootLineId,
      )
      const signed = (
        stageDetail.value.lines as IntermediarySignoffLineView[]
      ).find((line) => line.rootLineId === rootLineId)
      const total =
        (parseFixed(signed?.signedQuantity ?? '0', 6, true) ?? 0n) +
        (parseFixed(signed?.rejectedQuantity ?? '0', 6, true) ?? 0n) +
        (parseFixed(signed?.lossQuantity ?? '0', 6, true) ?? 0n)
      return total > 0n
        ? formatQuantity(total)
        : balance?.remainingToSignQuantity ?? '0'
    }
    return '0'
  }

  function signoffLoss(index: number): string | null {
    const draft = stageDraft.value as IntermediarySignoffDraft | null
    const line = draft?.lines[index]
    if (!line) return null
    return calculateLoss(
      deliveredQuantity(line.rootLineId),
      line.signedQuantity,
      line.rejectedQuantity,
    )
  }

  function validateStage(): string | null {
    const draft = stageDraft.value
    if (!draft) return '未加载子单草稿。'
    if (stageEditing.value === 'PROCUREMENT') {
      const value = draft as IntermediaryProcurementDraft
      if (!value.purchaseDate) return '请选择采购日期。'
      if (!value.supplier) return '请选择普通供应商。'
      let positive = false
      for (const line of value.lines) {
        const quantity = parseFixed(line.quantity, 6, true)
        const ordered = parseFixed(
          document.value?.productLines.find(
            (item) => item.lineId === line.rootLineId,
          )?.orderedQuantity ?? '',
          6,
          true,
        )
        if (quantity === null || ordered === null || quantity > ordered) {
          return '采购数量格式不正确或超过客户订购数量。'
        }
        if (quantity > 0n) {
          positive = true
          if (!isMoney(line.unitPrice)) return '采购单价格式不正确。'
        }
      }
      if (!positive) return '至少一行采购数量必须大于零。'
    } else if (stageEditing.value === 'RECEIPT') {
      const value = draft as IntermediaryReceiptDraft
      if (!value.receiptDate) return '请选择收货日期。'
      let positive = false
      for (const line of value.lines) {
        const quantity = parseFixed(line.quantity, 6, true)
        const balance = document.value?.balances.lines.find(
          (item) => item.rootLineId === line.rootLineId,
        )
        const remainingValue = balance?.procurementQuantity
          ? parseFixed(
              remaining(
                balance.procurementQuantity,
                balance.confirmedReceiptQuantity,
              ),
              6,
              true,
            )
          : null
        if (
          quantity === null ||
          (remainingValue !== null && quantity > remainingValue)
        ) {
          return '本次实收数量格式不正确或超过剩余采购数量。'
        }
        if (quantity > 0n) positive = true
      }
      if (!positive) return '至少一行实收数量必须大于零。'
    } else if (stageEditing.value === 'DELIVERY') {
      const value = draft as IntermediaryDeliveryDraft
      if (!value.deliveryDate) return '请选择送货日期。'
      if (!value.platform || !value.vehicle) {
        return '请选择物流平台和送货车辆。'
      }
      if (
        value.vehicle.platformObjectId &&
        value.vehicle.platformObjectId !== value.platform.objectId
      ) {
        return '送货车辆不属于所选物流平台。'
      }
      let positive = false
      for (const line of value.lines) {
        const quantity = parseFixed(line.quantity, 6, true)
        const available = parseFixed(
          document.value?.balances.lines.find(
            (item) => item.rootLineId === line.rootLineId,
          )?.availableToDeliverQuantity ?? '',
          6,
          true,
        )
        if (quantity === null || available === null || quantity > available) {
          return '本次送货数量格式不正确或超过当前可送数量。'
        }
        if (quantity > 0n) positive = true
      }
      if (!positive) return '至少一行送货数量必须大于零。'
      if (!calculateExpectedContainers(
        value.lines.map((line) => {
          const rootLine = document.value?.productLines.find(
            (item) => item.lineId === line.rootLineId,
          )
          return {
            quantity: line.quantity,
            containerType: rootLine?.containerType ?? 'NONE',
            quantityPerContainer: rootLine?.quantityPerContainer,
          }
        }),
      )) {
        return '无法根据包装快照计算应回收桶数。'
      }
    } else {
      const value = draft as IntermediarySignoffDraft
      if (!value.signoffDate) return '请选择签收日期。'
      for (const [index] of value.lines.entries()) {
        if (signoffLoss(index) === null) {
          return '签收数和拒收数格式不正确或超过送货数。'
        }
      }
      if (
        !Number.isInteger(value.returnedSolventContainers) ||
        value.returnedSolventContainers < 0 ||
        !Number.isInteger(value.returnedResinContainers) ||
        value.returnedResinContainers < 0
      ) {
        return '实收桶数必须为非负整数。'
      }
      const expected = signoffExpectedContainers.value
      if (
        (value.returnedSolventContainers < expected.solvent ||
          value.returnedResinContainers < expected.resin) &&
        !value.containerDifferenceReason.trim()
      ) {
        return '本次空桶少收时必须填写差异原因。'
      }
    }
    return Array.from(draft.remark).length <= 1000
      ? null
      : '备注不能超过 1000 字。'
  }

  async function saveStage(): Promise<boolean> {
    const validation = validateStage()
    if (validation) {
      stageDialogError.value = validation
      return false
    }
    if (!document.value || !stageDraft.value) return false
    actionLoading.value = `${stageEditing.value.toLowerCase()}-save`
    stageDialogError.value = null
    const child = stageChild.value
    const common = {
      processId: document.value.processId,
      processRevision: document.value.rootRevision,
      documentId: document.value.processId,
      rootRevision: document.value.rootRevision,
      ...(child
        ? { childId: child.childId, childRevision: child.revision }
        : {}),
    }
    try {
      let result
      if (stageEditing.value === 'PROCUREMENT') {
        result = await intermediaryWorkflowApi.saveProcurement(
          child ? 'procurement-save' : 'procurement-create',
          {
            ...common,
            data: clone(stageDraft.value as IntermediaryProcurementDraft),
          },
        )
      } else if (stageEditing.value === 'RECEIPT') {
        result = await intermediaryWorkflowApi.saveReceipt(
          child ? 'receipt-save' : 'receipt-create',
          {
            ...common,
            data: clone(stageDraft.value as IntermediaryReceiptDraft),
          },
        )
      } else if (stageEditing.value === 'DELIVERY') {
        result = await intermediaryWorkflowApi.saveDelivery(
          child ? 'delivery-save' : 'delivery-create',
          {
            ...common,
            data: clone(stageDraft.value as IntermediaryDeliveryDraft),
          },
        )
      } else {
        result = await intermediaryWorkflowApi.saveSignoff(
          child ? 'signoff-save' : 'signoff-create',
          {
            ...common,
            data: clone(stageDraft.value as IntermediarySignoffDraft),
          },
        )
      }
      await loadDocument()
      await query()
      const childID = result.data.childId ?? child?.childId
      const nextChild = document.value?.children.find(
        (item) => item.childId === childID,
      )
      const getAction =
        `${childPrefix(stageEditing.value)}-get` as IntermediaryAction
      if (nextChild && can(getAction)) {
        await openStage(stageEditing.value, nextChild)
      } else {
        stageDialogOpen.value = false
      }
      return true
    } catch (error) {
      stageDialogError.value = workflowErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  async function runChildAction(
    action: IntermediaryAction,
    child: IntermediaryChildSummary,
  ): Promise<boolean> {
    if (!document.value || !can(action) || actionLoading.value) return false
    if (
      [
        'procurement-place',
        'receipt-confirm',
        'delivery-execute',
        'signoff-confirm',
      ].includes(action) &&
      !canFinalize(action, child.checkedBy)
    ) {
      return false
    }
    actionLoading.value = `${action}:${child.childId}`
    workspaceError.value = null
    try {
      await intermediaryWorkflowApi.mutate(action, {
        processId: document.value.processId,
        processRevision: document.value.rootRevision,
        documentId: document.value.processId,
        rootRevision: document.value.rootRevision,
        childId: child.childId,
        childRevision: child.revision,
      })
      await loadDocument()
      await query()
      return true
    } catch (error) {
      workspaceError.value = workflowErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  function openReverse(
    action: IntermediaryAction,
    child?: IntermediaryChildSummary,
  ): void {
    reverseAction.value = action
    reverseChild.value = child ?? null
    reverseReason.value = ''
    reverseDialogOpen.value = true
  }

  async function confirmReverse(): Promise<void> {
    const reason = reverseReason.value.trim()
    if (!document.value || reason.length < 1 || Array.from(reason).length > 1000) {
      workspaceError.value = '原因必须为 1–1000 字。'
      return
    }
    actionLoading.value = reverseAction.value
    try {
      const child = reverseChild.value
      await intermediaryWorkflowApi.mutate(reverseAction.value, {
        processId: document.value.processId,
        processRevision: document.value.rootRevision,
        documentId: document.value.processId,
        rootRevision: document.value.rootRevision,
        ...(child
          ? { childId: child.childId, childRevision: child.revision }
          : {}),
        reason,
      })
      reverseDialogOpen.value = false
      stageDialogOpen.value = false
      await loadDocument()
      await query()
    } catch (error) {
      workspaceError.value = workflowErrorMessage(error)
    } finally {
      actionLoading.value = null
    }
  }

  async function requestShortClose(): Promise<void> {
    const reason = shortCloseReason.value.trim()
    if (!document.value || reason.length < 1 || Array.from(reason).length > 1000) {
      workspaceError.value = '短结原因必须为 1–1000 字。'
      return
    }
    actionLoading.value = 'short-close-request'
    try {
      await intermediaryWorkflowApi.mutate('short-close-request', {
        processId: document.value.processId,
        processRevision: document.value.rootRevision,
        documentId: document.value.processId,
        rootRevision: document.value.rootRevision,
        reason,
      })
      shortCloseDialogOpen.value = false
      await loadDocument()
      await query()
    } catch (error) {
      workspaceError.value = workflowErrorMessage(error)
    } finally {
      actionLoading.value = null
    }
  }

  async function sha256(file: File): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  async function reloadStageDetail(): Promise<void> {
    if (!document.value || !stageChild.value) return
    const current = document.value.children.find(
      (item) => item.childId === stageChild.value?.childId,
    )
    if (!current) return
    stageChild.value = current
    stageDetail.value = await getChild(stageEditing.value, current)
    stageSnapshot.value = JSON.stringify(stageDraft.value)
  }

  async function uploadChildAttachments(files: File[]): Promise<void> {
    if (
      !document.value ||
      !stageChild.value ||
      stageChild.value.status !== 'DRAFT'
    ) {
      return
    }
    const prefix = childPrefix(stageEditing.value)
    const action = `${prefix}-attachment-initiate` as IntermediaryAction
    if (!can(action)) return
    childAttachmentLoading.value = true
    childAttachmentError.value = null
    try {
      for (const file of files) {
        const initiated =
          await intermediaryWorkflowApi.initiateChildAttachment(prefix, {
            processId: document.value.processId,
            processRevision: document.value.rootRevision,
            documentId: stageChild.value.childId,
            documentRevision: stageChild.value.revision,
            fileName: file.name,
            contentType: file.type,
            size: file.size,
            sha256: await sha256(file),
          })
        document.value.rootRevision = initiated.data.processRevision
        stageChild.value.revision = initiated.data.documentRevision
        try {
          await apiClient.uploadAttachment(initiated.data.uploadUrl, file)
        } catch (error) {
          await loadDocument()
          await reloadStageDetail()
          throw error
        }
        await loadDocument()
        await reloadStageDetail()
      }
      await loadAudit(1)
    } catch (error) {
      childAttachmentError.value = workflowErrorMessage(error)
    } finally {
      childAttachmentLoading.value = false
    }
  }

  async function downloadChildAttachment(
    attachment: VoucherAttachment,
  ): Promise<void> {
    if (!document.value || !stageChild.value) return
    const prefix = childPrefix(stageEditing.value)
    const action = `${prefix}-attachment-download` as IntermediaryAction
    if (!can(action)) return
    childAttachmentLoading.value = true
    childAttachmentError.value = null
    try {
      const { data } =
        await intermediaryWorkflowApi.getChildAttachmentDownload(prefix, {
          processId: document.value.processId,
          documentId: stageChild.value.childId,
          fileId: attachment.fileId,
        })
      await downloadBlob(data.downloadUrl, attachment.fileName)
    } catch (error) {
      childAttachmentError.value = workflowErrorMessage(error)
    } finally {
      childAttachmentLoading.value = false
    }
  }

  async function removeChildAttachment(
    attachment: VoucherAttachment,
  ): Promise<void> {
    if (
      !document.value ||
      !stageChild.value ||
      stageChild.value.status !== 'DRAFT'
    ) {
      return
    }
    const prefix = childPrefix(stageEditing.value)
    const action = `${prefix}-attachment-remove` as IntermediaryAction
    if (!can(action)) return
    childAttachmentLoading.value = true
    childAttachmentError.value = null
    try {
      await intermediaryWorkflowApi.removeChildAttachment(prefix, {
        processId: document.value.processId,
        processRevision: document.value.rootRevision,
        documentId: stageChild.value.childId,
        documentRevision: stageChild.value.revision,
        fileId: attachment.fileId,
      })
      await Promise.all([loadDocument(), loadAudit(1)])
      await reloadStageDetail()
    } catch (error) {
      childAttachmentError.value = workflowErrorMessage(error)
    } finally {
      childAttachmentLoading.value = false
    }
  }

  async function downloadBlob(url: string, fileName: string): Promise<void> {
    const blob = await apiClient.fetchAttachment(url)
    const objectURL = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = objectURL
    anchor.download = fileName
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(objectURL), 0)
  }

  function referenceOptions(key: string): IntermediaryProductReference[] {
    return referenceState(key).options
  }

  function referenceLoading(key: string): boolean {
    return referenceState(key).loading
  }

  function referenceError(key: string): string | null {
    return referenceState(key).error
  }

  function referenceEntity(key: string): string {
    if (key === 'customer' || key === 'filterCustomer') return 'customer'
    if (key === 'supplier' || key === 'platform') return 'supplier'
    if (key === 'product') return 'product'
    if (key === 'vehicle') return 'vehicle'
    return 'employee'
  }

  function referenceFilters(key: string): Record<string, unknown> {
    if (key === 'supplier') return { supplierType: 'GENERAL' }
    if (key === 'platform') return { supplierType: 'LOGISTICS_PLATFORM' }
    return {}
  }

  function searchReference(key: string, keyword: string): void {
    const timer = referenceTimers.get(key)
    if (timer) clearTimeout(timer)
    referenceTimers.set(
      key,
      setTimeout(() => {
        referenceTimers.delete(key)
        void loadReference(key, keyword)
      }, keyword ? 250 : 0),
    )
  }

  async function loadReference(key: string, keyword: string): Promise<void> {
    const state = referenceState(key)
    const entity = referenceEntity(key)
    if (!session.can(`/bob/${entity}/query`)) {
      state.error = `缺少${entity}查询权限。`
      return
    }
    const sequence = ++state.sequence
    state.loading = true
    state.error = null
    try {
      const { data } = await apiClient.post<
        PageResult<ReferenceQueryItem>,
        PageRequest
      >(`bob/${entity}/query`, {
        page: 1,
        pageSize: 20,
        filters: {
          status: ['EFFECTIVE'],
          ...referenceFilters(key),
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        },
        sort: [{ field: 'name', order: 'asc' }],
      })
      if (sequence !== state.sequence) return
      const selectedPlatform =
        key === 'vehicle'
          ? (stageDraft.value as IntermediaryDeliveryDraft | null)?.platform
          : null
      state.options = (data.items ?? [])
        .filter(
          (item) =>
            item.currentVersion.status === 'EFFECTIVE' &&
            item.effectiveVersionId === item.currentVersion.versionId &&
            (
              !selectedPlatform ||
              item.currentVersion.summary.platformObjectId ===
                selectedPlatform.objectId
            ),
        )
        .map((item) => ({
          objectId: item.objectId,
          versionId: item.currentVersion.versionId,
          entity,
          code: item.code,
          name: item.currentVersion.summary.name,
          unit: item.currentVersion.summary.unit,
          supplierType: item.currentVersion.summary.supplierType,
          plateNumber: item.currentVersion.summary.plateNumber,
          platformObjectId: item.currentVersion.summary.platformObjectId,
          containerType: item.currentVersion.summary.containerType,
          quantityPerContainer:
            item.currentVersion.summary.quantityPerContainer,
        }))
    } catch (error) {
      if (sequence === state.sequence) state.error = getErrorMessage(error)
    } finally {
      if (sequence === state.sequence) state.loading = false
    }
  }

  async function loadAudit(nextPage = auditPage.value): Promise<void> {
    if (!document.value || !can('audit-history')) return
    auditPage.value = nextPage
    auditLoading.value = true
    auditError.value = null
    try {
      const { data } = await intermediaryWorkflowApi.audit({
        processId: document.value.processId,
        page: nextPage,
        pageSize: auditPageSize.value,
      })
      auditEvents.value = data.items ?? []
      auditTotal.value = data.total
      auditPage.value = data.page
      auditPageSize.value = data.pageSize
    } catch (error) {
      auditError.value = getErrorMessage(error)
    } finally {
      auditLoading.value = false
    }
  }

  function closeWorkspace(): void {
    if (childAttachmentLoading.value) return
    workspaceOpen.value = false
    stageDialogOpen.value = false
  }

  function closeStageDialog(): void {
    const dirty = JSON.stringify(stageDraft.value) !== stageSnapshot.value
    if (dirty && !window.confirm('子单存在未保存修改，确认关闭？')) return
    stageDialogOpen.value = false
    stageSnapshot.value = ''
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      queryController.value?.abort()
      for (const timer of referenceTimers.values()) clearTimeout(timer)
    })
  }

  return {
    loading,
    errorMessage,
    rows,
    total,
    page,
    pageSize,
    filters,
    selectedParty,
    workspaceOpen,
    workspaceLoading,
    workspaceError,
    document,
    activeStep,
    orderEditing,
    orderDraft,
    orderDirty,
    actionLoading,
    stageDialogOpen,
    stageDialogError,
    stageEditing,
    stageChild,
    stageDetail,
    stageDraft,
    stageEditable,
    workspaceDirty,
    expectedContainers,
    signoffExpectedContainers,
    signoffBalanceAfter,
    rootContainerBalance,
    procurement,
    receipts,
    deliveries,
    signoffs,
    canCreateReceipt,
    canCreateDelivery,
    reverseDialogOpen,
    reverseAction,
    reverseReason,
    shortCloseDialogOpen,
    shortCloseReason,
    childAttachmentLoading,
    childAttachmentError,
    auditEvents,
    auditLoading,
    auditError,
    auditPage,
    auditPageSize,
    auditTotal,
    canQuery,
    canCreate,
    currentUserId,
    can,
    canFinalize,
    query,
    search,
    resetFilters,
    changePage,
    openCreate,
    openDocument,
    loadDocument,
    saveOrder,
    startOrderEditing,
    cancelOrderEditing,
    runRootAction,
    openStage,
    saveStage,
    runChildAction,
    openReverse,
    confirmReverse,
    requestShortClose,
    deliveredQuantity,
    signoffLoss,
    uploadChildAttachments,
    downloadChildAttachment,
    removeChildAttachment,
    searchReference,
    referenceOptions,
    referenceLoading,
    referenceError,
    loadAudit,
    closeWorkspace,
    closeStageDialog,
  }
}

export type IntermediaryWorkflowViewModel = ReturnType<
  typeof useIntermediaryWorkflowViewModel
>
