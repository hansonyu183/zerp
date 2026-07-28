import { apiClient, type ApiPostPath } from '@/api/client'
import type { ApiResult, PageRequest, PageResult } from '@/api/types'
import type {
  WflAction,
  WflActionInput,
  WflApiAdapter,
  WflAttachmentDownloadAction,
  WflAttachmentDownloadInput,
  WflAttachmentInitiateAction,
  WflAttachmentInitiateInput,
  WflAttachmentRemoveAction,
  WflAttachmentRemoveInput,
  WflMutationResult,
  WflStagePrefix,
} from '@/components/wfl'
import type {
  IntermediaryAuditEvent,
  IntermediaryAuditWire,
  IntermediaryBalances,
  IntermediaryBalancesWire,
  IntermediaryChildDetail,
  IntermediaryChildStage,
  IntermediaryChildSummary,
  IntermediaryDeliveryData,
  IntermediaryDeliveryDraft,
  IntermediaryDocumentWire,
  IntermediaryListItem,
  IntermediaryOrderDraft,
  IntermediaryProcessPage,
  IntermediaryProcessWire,
  IntermediaryProcurementData,
  IntermediaryProcurementDraft,
  IntermediaryReceiptData,
  IntermediaryReceiptDraft,
  IntermediarySignoffData,
  IntermediarySignoffDraft,
  IntermediaryStageLineWire,
  IntermediaryStageMutationRequest,
  IntermediaryStageMutationResult,
  IntermediaryWireDocument,
} from './types'

const base = 'wfl/intermediary-trade'

export type IntermediaryAction = WflAction
export type IntermediaryChildPrefix = WflStagePrefix

export const intermediaryActions = [
  'query',
  'get',
  'create',
  'save',
  'check',
  'uncheck',
  'approve',
  'unapprove',
  'audit-history',
  'short-close-request',
  'short-close-cancel',
  'short-close-confirm',
  'short-close-unconfirm',
  'procurement-create',
  'procurement-get',
  'procurement-save',
  'procurement-delete',
  'procurement-check',
  'procurement-uncheck',
  'procurement-place',
  'procurement-unplace',
  'receipt-create',
  'receipt-get',
  'receipt-save',
  'receipt-delete',
  'receipt-check',
  'receipt-uncheck',
  'receipt-confirm',
  'receipt-unconfirm',
  'delivery-create',
  'delivery-get',
  'delivery-save',
  'delivery-delete',
  'delivery-check',
  'delivery-uncheck',
  'delivery-execute',
  'delivery-unexecute',
  'signoff-create',
  'signoff-get',
  'signoff-save',
  'signoff-delete',
  'signoff-check',
  'signoff-uncheck',
  'signoff-confirm',
  'signoff-unconfirm',
  'procurement-attachment-initiate',
  'procurement-attachment-download',
  'procurement-attachment-remove',
  'receipt-attachment-initiate',
  'receipt-attachment-download',
  'receipt-attachment-remove',
  'delivery-attachment-initiate',
  'delivery-attachment-download',
  'delivery-attachment-remove',
  'signoff-attachment-initiate',
  'signoff-attachment-download',
  'signoff-attachment-remove',
] as const satisfies readonly IntermediaryAction[]

export function intermediaryActionPath(
  action: IntermediaryAction,
): ApiPostPath {
  return `${base}/${action}`
}

function post<TResponse, TRequest>(
  action: IntermediaryAction,
  request: TRequest,
  signal?: AbortSignal,
) {
  return apiClient.post<TResponse, TRequest>(
    intermediaryActionPath(action),
    request,
    { signal },
  )
}

export const intermediaryTradeApiAdapter: WflApiAdapter<
  IntermediaryProcessWire,
  IntermediaryBalancesWire
> = {
  query: (input, signal) =>
    post<IntermediaryProcessPage, typeof input>('query', input, signal),
  get: (processId, signal) =>
    post<IntermediaryProcessWire, { processId: string }>(
      'get',
      { processId },
      signal,
    ),
  mutate: <TData>(action: WflAction, input: WflActionInput<TData>) =>
    post<WflMutationResult<IntermediaryBalancesWire>, WflActionInput<TData>>(
      action,
      input,
    ),
  history: (processId, page, pageSize, signal) =>
    post<
      PageResult<IntermediaryAuditEvent>,
      { processId: string; page: number; pageSize: number }
    >('audit-history', { processId, page, pageSize }, signal),
  initiateAttachment: (
    action: WflAttachmentInitiateAction,
    input: WflAttachmentInitiateInput,
  ) =>
    post<
      {
        processId: string
        processRevision: number
        documentId: string
        documentRevision: number
        fileId: string
        uploadUrl: string
        expiresAt: string
      },
      WflAttachmentInitiateInput
    >(action, input),
  downloadAttachment: (
    action: WflAttachmentDownloadAction,
    input: WflAttachmentDownloadInput,
  ) =>
    post<
      { downloadUrl: string; expiresAt: string },
      WflAttachmentDownloadInput
    >(action, input),
  removeAttachment: (
    action: WflAttachmentRemoveAction,
    input: WflAttachmentRemoveInput,
  ) =>
    post<
      {
        processId: string
        processRevision: number
        documentId: string
        documentRevision: number
        documentStatus: string
      },
      WflAttachmentRemoveInput
    >(action, input),
}

function referenceInput(value: { objectId: string; versionId: string }) {
  return { objectId: value.objectId, versionId: value.versionId }
}

export function customerOrderData(draft: IntermediaryOrderDraft) {
  return {
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    customer: referenceInput(draft.customer!),
    ...(draft.salesperson
      ? { salesperson: referenceInput(draft.salesperson) }
      : {}),
    lines: draft.productLines.map((line) => ({
      product: referenceInput(line.product!),
      orderedQuantity: line.orderedQuantity,
      unitPrice: line.unitPrice,
      containerType: line.containerType,
      ...(line.containerType === 'NONE'
        ? {}
        : { quantityPerContainer: line.quantityPerContainer }),
      remark: line.remark,
    })),
  }
}

function mapBalances(value: IntermediaryBalancesWire): IntermediaryBalances {
  return {
    lines: value.lines.map((line) => ({
      rootLineId: line.customerLineId,
      orderedQuantity: line.orderedQuantity,
      ...(line.procurementQuantity === undefined
        ? {}
        : { procurementQuantity: line.procurementQuantity }),
      confirmedReceiptQuantity: line.receivedQuantity,
      executedDeliveryQuantity: line.deliveredQuantity,
      signedQuantity: line.signedQuantity,
      rejectedQuantity: line.rejectedQuantity,
      lossQuantity: line.lossQuantity,
      availableToDeliverQuantity: line.availableToDeliverQuantity,
      remainingToSignQuantity: line.remainingToSignQuantity,
    })),
    containers: [
      { containerType: 'SOLVENT', quantity: value.solventContainers },
      { containerType: 'RESIN', quantity: value.resinContainers },
    ],
    hasUnfinishedChildren: value.hasUnfinishedDocuments,
  }
}

function rootDocument(
  process: IntermediaryProcessWire,
): IntermediaryDocumentWire {
  const root = process.documents.find(
    (document) => document.stage === 'CUSTOMER_ORDER',
  )
  if (!root) throw new Error('流程响应缺少居间订单根单')
  return root
}

function mapChild(
  document: IntermediaryDocumentWire,
): IntermediaryChildSummary {
  return {
    childId: document.documentId,
    childNo: document.documentNo,
    stage: document.stage as IntermediaryChildStage,
    status: document.status as IntermediaryChildSummary['status'],
    revision: document.revision,
    createdAt: document.createdAt,
    createdBy: document.createdBy,
    updatedAt: document.approvedAt ?? document.reviewedAt ?? document.createdAt,
    updatedBy: document.approvedBy ?? document.reviewedBy ?? document.createdBy,
    checkedAt: document.reviewedAt,
    checkedBy: document.reviewedBy,
    finalAt: document.approvedAt,
    finalBy: document.approvedBy,
    entity: document.entity as IntermediaryChildSummary['entity'],
    parentDocumentId: document.parentDocumentId,
    businessDate: document.businessDate,
    currency: document.currency,
    amount: document.amount,
    attachments: document.attachments,
  }
}

function mapProcess(
  process: IntermediaryProcessWire,
): IntermediaryWireDocument {
  const root = rootDocument(process)
  const data = root.data ?? {}
  return {
    processId: process.processId,
    rootDocumentId: process.rootDocumentId,
    documentId: root.documentId,
    documentNo: root.documentNo,
    status: root.status,
    revision: root.revision,
    amount: root.amount,
    data: {
      businessDate: root.businessDate,
      currency: root.currency,
      remark: data.remark,
      customer: data.customer,
      salesperson: data.salesperson,
      contactName: data.contactName,
      contactPhone: data.contactPhone,
      deliveryAddress: data.deliveryAddress,
      customerSettlementMethod: data.settlementMethod,
      productLines: (root.lines ?? []) as never,
    },
    attachments: root.attachments,
    updatedAt: process.updatedAt,
    approvedAt: root.approvedAt,
    approvedBy: root.approvedBy,
    workflowStatus: process.status,
    rootRevision: process.revision,
    balances: mapBalances(process.balances),
    children: process.documents
      .filter((document) => document.stage !== 'CUSTOMER_ORDER')
      .map(mapChild),
    checkedAt: root.reviewedAt,
    checkedBy: root.reviewedBy,
  }
}

function mapListItem(process: IntermediaryProcessWire): IntermediaryListItem {
  const root = rootDocument(process)
  return {
    processId: process.processId,
    documentNo: process.rootDocumentNo,
    status: process.status,
    businessDate: root.businessDate,
    partyName: root.data?.customer?.name,
    currency: root.currency,
    amount: root.amount,
    updatedAt: process.updatedAt,
    currentStage: process.currentStage,
  }
}

function normalizeMutation(
  value: WflMutationResult<IntermediaryBalancesWire>,
): IntermediaryStageMutationResult {
  return {
    documentId: value.processId,
    documentNo: value.documentNo ?? '',
    status: value.workflowStatus,
    revision: value.processRevision,
    rootRevision: value.processRevision,
    workflowStatus: value.workflowStatus,
    childId: value.documentId,
    childNo: value.documentNo,
    childRevision: value.documentRevision,
    childStatus:
      value.documentStatus as IntermediaryStageMutationResult['childStatus'],
    balances: value.balances ? mapBalances(value.balances) : undefined,
  }
}

function mutationInput<T>(
  request: IntermediaryStageMutationRequest<T>,
  data = request.data,
): WflActionInput<T> {
  return {
    processId: request.processId ?? request.documentId,
    processRevision: request.processRevision ?? request.rootRevision,
    ...(request.childId ? { documentId: request.childId } : {}),
    ...(request.childRevision
      ? { documentRevision: request.childRevision }
      : {}),
    ...(data === undefined ? {} : { data }),
    ...(request.reason ? { reason: request.reason } : {}),
  }
}

function mutation(
  action: IntermediaryAction,
  request: IntermediaryStageMutationRequest<unknown>,
) {
  return post<
    WflMutationResult<IntermediaryBalancesWire>,
    WflActionInput<unknown>
  >(action, mutationInput(request)).then((result) => ({
    ...result,
    data: normalizeMutation(result.data),
  }))
}

function customerLineByStageSource(
  process: IntermediaryProcessWire,
  stage: IntermediaryChildStage,
  sourceLineId: string,
): string {
  if (stage === 'PROCUREMENT' || stage === 'DELIVERY') return sourceLineId
  if (stage === 'RECEIPT') {
    const procurement = process.documents.find(
      (document) => document.stage === 'PROCUREMENT',
    )
    const line = (
      procurement?.lines as IntermediaryStageLineWire[] | undefined
    )?.find((candidate) => candidate.lineId === sourceLineId)
    return line?.sourceLineId ?? sourceLineId
  }
  const deliveries = process.documents.filter(
    (document) => document.stage === 'DELIVERY',
  )
  for (const delivery of deliveries) {
    const line = (
      delivery.lines as IntermediaryStageLineWire[] | undefined
    )?.find((candidate) => candidate.lineId === sourceLineId)
    if (line) return line.sourceLineId
  }
  return sourceLineId
}

function mapStageDetail(
  process: IntermediaryProcessWire,
  document: IntermediaryDocumentWire,
): IntermediaryChildDetail {
  const data = document.data ?? {}
  let normalizedData:
    | IntermediaryProcurementData
    | IntermediaryReceiptData
    | IntermediaryDeliveryData
    | IntermediarySignoffData
  if (document.stage === 'PROCUREMENT') {
    normalizedData = {
      purchaseDate: document.businessDate,
      supplier: data.supplier!,
      purchaser: data.purchaser!,
      ...(Object.hasOwn(data, 'remark') ? { remark: data.remark } : {}),
    }
  } else if (document.stage === 'RECEIPT') {
    normalizedData = {
      receiptDate: document.businessDate,
      ...(Object.hasOwn(data, 'remark') ? { remark: data.remark } : {}),
    }
  } else if (document.stage === 'DELIVERY') {
    normalizedData = {
      deliveryDate: document.businessDate,
      platform: data.platform!,
      vehicle: data.vehicle!,
      expectedSolventContainers: data.expectedSolventContainers ?? 0,
      expectedResinContainers: data.expectedResinContainers ?? 0,
      ...(Object.hasOwn(data, 'remark') ? { remark: data.remark } : {}),
    }
  } else {
    normalizedData = {
      deliveryChildId: document.parentDocumentId ?? '',
      signoffDate: document.businessDate,
      returnedSolventContainers: data.returnedSolventContainers ?? 0,
      returnedResinContainers: data.returnedResinContainers ?? 0,
      containerDifferenceReason: data.containerDifferenceReason,
      ...(Object.hasOwn(data, 'remark') ? { remark: data.remark } : {}),
    }
  }
  const stage = document.stage as IntermediaryChildStage
  const lines = (document.lines ?? []).map((line) => {
    const value = line as IntermediaryStageLineWire
    const rootLineId = customerLineByStageSource(
      process,
      stage,
      value.sourceLineId,
    )
    if (stage === 'SIGNOFF') {
      return {
        rootLineId,
        signedQuantity: value.signedQuantity ?? '0',
        rejectedQuantity: value.rejectedQuantity ?? '0',
        lossQuantity: value.lossQuantity ?? '0',
        remark: value.remark,
      }
    }
    return {
      rootLineId,
      quantity: value.quantity ?? '0',
      unitPrice: value.unitPrice,
      lineAmount: value.lineAmount,
      remark: value.remark,
    }
  })
  return {
    documentId: process.processId,
    child: mapChild(document),
    data: normalizedData,
    lines,
    balances: mapBalances(process.balances),
    attachments: document.attachments,
  }
}

async function processWire(
  processId: string,
): Promise<IntermediaryProcessWire> {
  return (
    await post<IntermediaryProcessWire, { processId: string }>('get', {
      processId,
    })
  ).data
}

async function receiptData(processId: string, draft: IntermediaryReceiptDraft) {
  const process = await processWire(processId)
  const procurementSummary = process.documents.find(
    (document) => document.stage === 'PROCUREMENT',
  )
  if (!procurementSummary) throw new Error('流程缺少居间采购，不能创建居间收货。')
  const procurement = (
    await post<
      IntermediaryDocumentWire,
      { processId: string; documentId: string }
    >('procurement-get', {
      processId,
      documentId: procurementSummary.documentId,
    })
  ).data
  const procurementLines =
    (procurement.lines as IntermediaryStageLineWire[] | undefined) ?? []
  return {
    businessDate: draft.receiptDate,
    lines: draft.lines.map((line) => {
      const source = procurementLines.find(
        (candidate) => candidate.sourceLineId === line.rootLineId,
      )
      if (!source) throw new Error('采购行已经变化，请刷新流程后重试。')
      return {
        sourceLineId: source.lineId,
        quantity: line.quantity,
        remark: line.remark,
      }
    }),
    remark: draft.remark,
  }
}

async function signoffData(processId: string, draft: IntermediarySignoffDraft) {
  const delivery = (
    await post<
      IntermediaryDocumentWire,
      { processId: string; documentId: string }
    >('delivery-get', {
      processId,
      documentId: draft.deliveryChildId,
    })
  ).data
  const deliveryLines =
    (delivery.lines as IntermediaryStageLineWire[] | undefined) ?? []
  return {
    businessDate: draft.signoffDate,
    lines: draft.lines.map((line) => {
      const source = deliveryLines.find(
        (candidate) => candidate.sourceLineId === line.rootLineId,
      )
      if (!source) throw new Error('送货行已经变化，请刷新流程后重试。')
      return {
        sourceLineId: source.lineId,
        signedQuantity: line.signedQuantity,
        rejectedQuantity: line.rejectedQuantity,
        remark: line.remark,
      }
    }),
    returnedSolventContainers: draft.returnedSolventContainers,
    returnedResinContainers: draft.returnedResinContainers,
    containerDifferenceReason: draft.containerDifferenceReason,
    remark: draft.remark,
  }
}

export const intermediaryWorkflowApi = {
  query: async (request: PageRequest, signal?: AbortSignal) => {
    const filters = request.filters ?? {}
    const input = {
      page: request.page,
      pageSize: request.pageSize,
      ...(filters.keyword ? { keyword: String(filters.keyword) } : {}),
      ...(Array.isArray(filters.statuses) && filters.statuses.length
        ? { statuses: filters.statuses as string[] }
        : {}),
    }
    const result = await post<IntermediaryProcessPage, typeof input>(
      'query',
      input,
      signal,
    )
    return {
      ...result,
      data: {
        ...result.data,
        items: result.data.items.map(mapListItem),
      } satisfies PageResult<IntermediaryListItem>,
    }
  },
  get: async (processId: string, signal?: AbortSignal) => {
    const result = await post<IntermediaryProcessWire, { processId: string }>(
      'get',
      { processId },
      signal,
    )
    return { ...result, data: mapProcess(result.data) }
  },
  getProcess: (processId: string, signal?: AbortSignal) =>
    post<IntermediaryProcessWire, { processId: string }>(
      'get',
      { processId },
      signal,
    ),
  create: (draft: IntermediaryOrderDraft) =>
    post<
      WflMutationResult<IntermediaryBalancesWire>,
      { data: ReturnType<typeof customerOrderData> }
    >('create', { data: customerOrderData(draft) }).then((result) => ({
      ...result,
      data: normalizeMutation(result.data),
    })),
  save: (request: {
    processId: string
    processRevision: number
    documentId: string
    documentRevision: number
    data: IntermediaryOrderDraft
  }) =>
    post<
      WflMutationResult<IntermediaryBalancesWire>,
      {
        processId: string
        processRevision: number
        documentId: string
        documentRevision: number
        data: ReturnType<typeof customerOrderData>
      }
    >('save', {
      ...request,
      data: customerOrderData(request.data),
    }).then((result) => ({ ...result, data: normalizeMutation(result.data) })),
  mutate: mutation,
  getChild: async (
    prefix: IntermediaryChildPrefix,
    request: { processId: string; documentId: string },
  ) => {
    const [stageResult, processResult] = await Promise.all([
      post<IntermediaryDocumentWire, typeof request>(`${prefix}-get`, request),
      post<IntermediaryProcessWire, { processId: string }>('get', {
        processId: request.processId,
      }),
    ])
    return {
      ...stageResult,
      data: mapStageDetail(processResult.data, stageResult.data),
    }
  },
  saveProcurement: (
    action: 'procurement-create' | 'procurement-save',
    request: IntermediaryStageMutationRequest<IntermediaryProcurementDraft>,
  ) => {
    const draft = request.data!
    const data = {
      businessDate: draft.purchaseDate,
      supplier: referenceInput(draft.supplier!),
      ...(draft.purchaser
        ? { purchaser: referenceInput(draft.purchaser) }
        : {}),
      lines: draft.lines.map((line) => ({
        sourceLineId: line.rootLineId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        remark: line.remark,
      })),
      remark: draft.remark,
    }
    return mutation(action, { ...request, data } as never)
  },
  saveReceipt: async (
    action: 'receipt-create' | 'receipt-save',
    request: IntermediaryStageMutationRequest<IntermediaryReceiptDraft>,
  ) =>
    mutation(action, {
      ...request,
      data: await receiptData(
        request.processId ?? request.documentId,
        request.data!,
      ),
    } as never),
  saveDelivery: (
    action: 'delivery-create' | 'delivery-save',
    request: IntermediaryStageMutationRequest<IntermediaryDeliveryDraft>,
  ) => {
    const draft = request.data!
    return mutation(action, {
      ...request,
      data: {
        businessDate: draft.deliveryDate,
        platform: referenceInput(draft.platform!),
        vehicle: referenceInput(draft.vehicle!),
        lines: draft.lines.map((line) => ({
          sourceLineId: line.rootLineId,
          quantity: line.quantity,
          remark: line.remark,
        })),
        remark: draft.remark,
      },
    } as never)
  },
  saveSignoff: async (
    action: 'signoff-create' | 'signoff-save',
    request: IntermediaryStageMutationRequest<IntermediarySignoffDraft>,
  ) =>
    mutation(action, {
      ...request,
      data: await signoffData(
        request.processId ?? request.documentId,
        request.data!,
      ),
    } as never),
  audit: async (
    request: { processId: string; page: number; pageSize: number },
    signal?: AbortSignal,
  ) => {
    const result = await post<
      PageResult<IntermediaryAuditWire>,
      typeof request
    >('audit-history', request, signal)
    return {
      ...result,
      data: result.data as PageResult<IntermediaryAuditEvent>,
    }
  },
  initiateChildAttachment: (
    prefix: IntermediaryChildPrefix,
    request: {
      processId: string
      processRevision: number
      documentId: string
      documentRevision: number
      fileName: string
      contentType: string
      size: number
      sha256: string
    },
  ) =>
    post<
      {
        processId: string
        processRevision: number
        documentId: string
        documentRevision: number
        fileId: string
        uploadUrl: string
        expiresAt: string
      },
      typeof request
    >(`${prefix}-attachment-initiate`, request),
  getChildAttachmentDownload: (
    prefix: IntermediaryChildPrefix,
    request: { processId: string; documentId: string; fileId: string },
  ) =>
    post<{ downloadUrl: string; expiresAt: string }, typeof request>(
      `${prefix}-attachment-download`,
      request,
    ),
  removeChildAttachment: (
    prefix: IntermediaryChildPrefix,
    request: {
      processId: string
      processRevision: number
      documentId: string
      documentRevision: number
      fileId: string
    },
  ) =>
    post<
      {
        processId: string
        processRevision: number
        documentId: string
        documentRevision: number
        documentStatus: string
      },
      typeof request
    >(`${prefix}-attachment-remove`, request),
}

export type IntermediaryApi = typeof intermediaryWorkflowApi
export type IntermediaryApiResult<T> = ApiResult<T>
