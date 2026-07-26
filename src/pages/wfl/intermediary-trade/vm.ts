import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
} from 'vue'
import {
  getErrorMessage,
  type PageRequest,
} from '@/api/types'
import { parseFixed } from '@/components/voucher/decimal'
import type { VoucherReference } from '@/components/voucher'
import { useSessionStore } from '@/stores/session'
import { localDate } from '@/utils/date'
import {
  calculateContainerBalanceAfter,
  calculateExpectedContainers,
} from './calculations'
import {
  intermediaryActionPath,
  intermediaryWorkflowApi,
  type IntermediaryAction,
} from './api'
import { useIntermediaryAudit } from './audit'
import { useIntermediaryAttachments } from './attachments'
import {
  deliveryDraftFromDetail,
  procurementDraftFromDetail,
  receiptDraftFromDetail,
  signoffDraftFromDelivery,
  signoffDraftFromDetail,
} from './drafts'
import type {
  IntermediaryChildDetail,
  IntermediaryChildStage,
  IntermediaryChildSummary,
  IntermediaryContainerBalance,
  IntermediaryDeliveryData,
  IntermediaryDeliveryDraft,
  IntermediaryListItem,
  IntermediaryOrderDraft,
  IntermediaryProcurementDraft,
  IntermediaryReceiptDraft,
  IntermediarySignoffDraft,
  IntermediarySignoffData,
  IntermediaryStageDraft,
  IntermediaryWorkflowDocument,
} from './types'
import { useIntermediaryReferences } from './references'
import {
  childPrefix,
  clone,
  containerBalance,
  emptyOrder,
  orderFromDocument,
  remaining,
  toDocument,
  workflowErrorMessage,
} from './model'
import {
  deliveredQuantity as calculateDeliveredQuantity,
  signoffLoss as calculateSignoffLoss,
  validateOrderDraft,
  validateStageDraft,
} from './validation'

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

  const {
    auditEvents,
    auditLoading,
    auditError,
    auditPage,
    auditPageSize,
    auditTotal,
    resetAudit,
    loadAudit,
  } = useIntermediaryAudit(document, () => can('audit-history'))
  const {
    childAttachmentLoading,
    childAttachmentError,
    uploadChildAttachments,
    downloadChildAttachment,
    removeChildAttachment,
  } = useIntermediaryAttachments({
    document,
    stageChild,
    stageDetail,
    stageEditing,
    can,
    childPrefix,
    getChild,
    loadDocument,
    loadAudit,
    errorMessage: workflowErrorMessage,
  })

  const {
    searchReference,
    referenceOptions,
    referenceLoading,
    referenceError,
  } = useIntermediaryReferences(stageDraft)

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
  const stageStateEditable = computed(
    () =>
      !stageChild.value ||
      stageChild.value.status === 'DRAFT',
  )
  const stageSaveVisible = computed(
    () =>
      Boolean(stageDraft.value) &&
      stageStateEditable.value &&
      can(stageSaveAction()),
  )
  const stageSaveBlockedReason = computed(() => {
    if (!stageSaveVisible.value) return null
    if (stageEditing.value === 'RECEIPT' && !can('procurement-get')) {
      return '保存收货单需要采购详情权限。当前表单仅供查看。'
    }
    if (stageEditing.value === 'SIGNOFF' && !can('delivery-get')) {
      return '保存签收单需要送货详情权限。当前表单仅供查看。'
    }
    return null
  })
  const stageEditable = computed(
    () => stageSaveVisible.value && !stageSaveBlockedReason.value,
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

  function can(action: IntermediaryAction): boolean {
    return session.can(`/${intermediaryActionPath(action)}`)
  }

  function canFinalize(action: IntermediaryAction, checkedBy?: string): boolean {
    return can(action) && Boolean(checkedBy) && checkedBy !== currentUserId.value
  }

  function stageSaveAction(): IntermediaryAction {
    const operation = stageChild.value ? 'save' : 'create'
    return `${stageEditing.value.toLowerCase()}-${operation}` as IntermediaryAction
  }

  function canSaveStage(): boolean {
    return stageSaveVisible.value && stageEditable.value
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
    resetAudit()
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
    if (target !== document.value?.processId) {
      activeStep.value = 1
      resetAudit()
    }
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
    return validateOrderDraft(orderDraft.value)
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
          receiptDate: localDate(),
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
          deliveryDate: localDate(),
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
    return calculateDeliveredQuantity(
      stageEditing.value,
      stageDetail.value,
      rootLineId,
    )
  }

  function signoffLoss(index: number): string | null {
    return calculateSignoffLoss(
      stageEditing.value,
      stageDetail.value,
      stageDraft.value as IntermediarySignoffDraft | null,
      index,
    )
  }

  function validateStage(): string | null {
    return validateStageDraft({
      stage: stageEditing.value,
      draft: stageDraft.value,
      document: document.value,
      detail: stageDetail.value,
      signoffExpectedContainers: signoffExpectedContainers.value,
    })
  }
  async function saveStage(): Promise<boolean> {
    if (!canSaveStage()) {
      stageDialogError.value =
        stageSaveBlockedReason.value ??
        '当前账号没有保存本阶段草稿的权限。'
      return false
    }
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

  function changeActiveStep(next: number): void {
    activeStep.value = next
    if (next === 6) void loadAudit(1)
  }

  function closeWorkspace(): void {
    if (childAttachmentLoading.value) return
    workspaceOpen.value = false
    stageDialogOpen.value = false
    activeStep.value = 1
    resetAudit()
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
    stageSaveVisible,
    stageSaveBlockedReason,
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
    canSaveStage,
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
    changeActiveStep,
    closeWorkspace,
    closeStageDialog,
  }
}

export type IntermediaryWorkflowViewModel = ReturnType<
  typeof useIntermediaryWorkflowViewModel
>
