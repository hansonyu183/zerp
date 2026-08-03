import { computed, getCurrentScope, onScopeDispose, reactive, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageRequest, type PageResult } from '@/api/types'
import {
  type VoucherActionAvailability,
  type VoucherDocumentView,
  type VoucherDraftForm,
  type VoucherEntity,
  type VoucherEntityConfig,
  type VoucherExecutionForm,
  type VoucherLifecycleAction,
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
import { buildVoucherDraftPayload } from './payload'
import { useVoucherSalesChain } from './sales-chain'
import { validateVoucherDraft } from './validation'
import { useVoucherFormula } from './formula'
import { canRunListLifecycleAction } from './lifecycle'
import { useVoucherProduction } from './production'
import { useVoucherPricing } from './pricing'
import { createVoucherReferenceChangeHandler } from './reference-change'
import { createReturnSourceInitializer } from './return-source'
import { useVoucherActionAvailability } from './action-availability'

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
  const sort = ref<VoucherSort>({ field: 'documentNo', order: 'desc' })
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
  const {
    changeLineProduct: changeFormulaLineProduct,
    resolveLineFormula,
    refreshCustomFormulas,
    updateLineFormula,
  } = useVoucherFormula(config, form)
  const { changeLineProduct, refreshPriceReferences } = useVoucherPricing(
    config,
    form,
    changeFormulaLineProduct,
    editing,
    workspaceLoading,
    (error) => (workspaceError.value = getErrorMessage(error)),
  )
  const {
    addProductionLine,
    changeProductionProduct,
    recalculateProductionLine,
  } = useVoucherProduction(config, form)
  const initialForm = ref(snapshot(form.value))
  const personnelDirty = new Set<string>()
  const markReferenceChanged = createVoucherReferenceChangeHandler(
    config,
    form,
    personnelDirty,
    refreshCustomFormulas,
    refreshPriceReferences,
  )

  const executionOpen = ref(false)
  const executionError = ref<string | null>(null)
  const {
    sourceOptions,
    sourceLoading,
    sourceError,
    clearSourceDocuments,
    searchSourceDocuments,
    selectSourceDocument,
  } = useVoucherSalesChain(config, form)

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
  const initializeReturnFromSources = createReturnSourceInitializer({
    entity: config.entity,
    canCreate: () => canCreate.value,
    openCreate,
    applyDraft: (draft) => {
      Object.assign(form.value, draft)
      initialForm.value = snapshot(form.value)
    },
    setLoading: (value) => (workspaceLoading.value = value),
    setError: (message) => (workspaceError.value = message),
  })
  const actionAvailability = useVoucherActionAvailability(
    config,
    documentView,
    session.can,
  )
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
    () =>
      workspaceLoading.value ||
      saving.value ||
      Boolean(actionLoading.value) ||
      attachmentLoading.value,
  )

  const permission = (action: string) => `/vou/${config.entity}/${action}`
  const canView = () => session.can(permission('get'))

  function canEdit(row: VoucherListItem): boolean {
    return (
      row.status === 'DRAFT' &&
      session.can(permission('get')) &&
      session.can(permission('save'))
    )
  }

  function canLifecycleAction(
    row: VoucherListItem,
    action: VoucherLifecycleAction,
  ): boolean {
    return canRunListLifecycleAction(config, row, action, session.can)
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
      >(
        `vou/${config.entity}/query`,
        {
          page: page.value,
          pageSize: pageSize.value,
          filters: {
            ...(filters.keyword.trim()
              ? { keyword: filters.keyword.trim() }
              : {}),
            ...(filters.status.length ? { status: [...filters.status] } : {}),
            ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
            ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
            ...(selectedParty.value
              ? { partyObjectId: selectedParty.value.objectId }
              : {}),
          },
          sort: [{ ...sort.value }],
        },
        { signal: controller.signal },
      )
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
    sort.value = { field: 'documentNo', order: 'desc' }
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
    if (config.parentEntity) void searchSourceDocuments('')
  }

  async function openDocument(
    row: Pick<VoucherListItem, 'documentId'>,
    edit = false,
  ): Promise<void> {
    if (!canView()) return
    workspaceOpen.value = true
    workspaceLoading.value = true
    workspaceError.value = null
    try {
      await loadDocument(row.documentId)
      const editable = documentView.value?.status === 'DRAFT'
      editing.value = edit && editable && session.can(permission('save'))
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
    if (data.parentDocumentId && data.parentDocumentNo) {
      sourceOptions.value = [
        {
          documentId: data.parentDocumentId,
          entity: data.parentEntity ?? config.parentEntity ?? config.entity,
          documentNo: data.parentDocumentNo,
          status: 'FINALIZED',
          revision: 0,
          businessDate: data.data.businessDate,
          currency: data.data.currency,
          amount: data.amount,
          updatedAt: data.updatedAt,
        },
        ...sourceOptions.value.filter(
          (item) => item.documentId !== data.parentDocumentId,
        ),
      ]
    }
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
    if (
      documentView.value?.status !== 'DRAFT' ||
      !actionAvailability.value.save
    )
      return
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
    clearSourceDocuments()
  }

  async function save(): Promise<boolean> {
    const validation = validateVoucherDraft(config, form.value)
    if (validation) {
      workspaceError.value = validation
      return false
    }
    saving.value = true
    workspaceError.value = null
    try {
      const payload = buildVoucherDraftPayload(
        config,
        form.value,
        Boolean(documentView.value),
        personnelDirty,
      )
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
          {
            parentEntity?: VoucherEntity
            parentDocumentId?: string
            data: DraftPayload
          }
        >(`vou/${config.entity}/create`, {
          ...(config.parentEntity && form.value.parentDocumentId
            ? {
                parentEntity: config.parentEntity,
                parentDocumentId: form.value.parentDocumentId,
              }
            : {}),
          data: payload,
        })
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
    action: VoucherLifecycleAction,
    reason?: string,
  ): Promise<void> {
    const current = documentView.value
    if (!current || !actionAvailability.value[action]) return
    if (action === 'finalize' && config.finalizationKind !== 'direct') {
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

  async function lifecycleActionFromList(
    row: VoucherListItem,
    action: VoucherLifecycleAction,
    reason?: string,
  ): Promise<boolean> {
    if (!canLifecycleAction(row, action)) return false
    actionLoading.value = `${action}:${row.documentId}`
    errorMessage.value = null
    try {
      await apiClient.post<VoucherMutationResult, Record<string, unknown>>(
        `vou/${config.entity}/${action}`,
        {
          documentId: row.documentId,
          revision: row.revision,
          ...(reason ? { reason } : {}),
        },
      )
      await query()
      if (documentView.value?.documentId === row.documentId) {
        await loadDocument(row.documentId)
        if (actionAvailability.value.audit) await loadAudit(1)
      }
      return true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
    } finally {
      actionLoading.value = null
    }
  }

  async function finalize(execution: VoucherExecutionForm): Promise<void> {
    const current = documentView.value
    if (!current || !actionAvailability.value.finalize) return
    actionLoading.value = 'finalize'
    executionError.value = null
    try {
      await apiClient.post<VoucherMutationResult, Record<string, unknown>>(
        `vou/${config.entity}/finalize`,
        {
          documentId: current.documentId,
          revision: current.revision,
          ...(config.finalizationKind === 'sale'
            ? {
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
              }
            : {}),
          ...(config.finalizationKind === 'purchase'
            ? {
                inboundDate: execution.inboundDate,
                ...(execution.differenceReason.trim()
                  ? { differenceReason: execution.differenceReason.trim() }
                  : {}),
                purchaseLines: execution.purchaseLines.map((line) => ({
                  lineId: line.lineId,
                  inboundQuantity: line.inboundQuantity,
                })),
              }
            : {}),
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

  async function secondaryAction(
    action:
      | 'delete'
      | 'short-close-request'
      | 'short-close-cancel'
      | 'short-close-confirm'
      | 'short-close-unconfirm',
    reason?: string,
  ): Promise<void> {
    const current = documentView.value
    if (!current) return
    const availabilityKey = {
      delete: 'delete',
      'short-close-request': 'shortCloseRequest',
      'short-close-cancel': 'shortCloseCancel',
      'short-close-confirm': 'shortCloseConfirm',
      'short-close-unconfirm': 'shortCloseUnconfirm',
    }[action] as keyof VoucherActionAvailability
    if (!actionAvailability.value[availabilityKey]) return
    if (action !== 'delete') return
    actionLoading.value = action
    workspaceError.value = null
    try {
      await apiClient.post<VoucherMutationResult, Record<string, unknown>>(
        `vou/${config.entity}/delete`,
        {
          documentId: current.documentId,
          revision: current.revision,
          ...(reason ? { reason } : {}),
        },
      )
      if (action === 'delete') {
        closeWorkspace()
      } else {
        await loadDocument(current.documentId)
        await loadAudit(1)
      }
      await query()
    } catch (error) {
      workspaceError.value = getErrorMessage(error)
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
    canLifecycleAction,
    query,
    search,
    changePage,
    resetFilters,
    openCreate,
    initializeReturnFromSources,
    openDocument,
    loadDocument,
    reloadDocument,
    startEditing,
    cancelEditing,
    closeWorkspace,
    markReferenceChanged,
    changeLineProduct,
    resolveLineFormula,
    updateLineFormula,
    addProductionLine,
    changeProductionProduct,
    recalculateProductionLine,
    save,
    lifecycleAction,
    lifecycleActionFromList,
    finalize,
    secondaryAction,
    uploadAttachments,
    downloadAttachment,
    removeAttachment,
    loadAudit,
    referenceOptions,
    referenceLoading,
    referenceError,
    searchReference,
    sourceOptions,
    sourceLoading,
    sourceError,
    searchSourceDocuments,
    selectSourceDocument,
  }
}

export type VoucherEntityViewModel = ReturnType<
  typeof useVoucherEntityViewModel
>
