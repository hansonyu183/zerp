import { apiClient } from '@/api/client'
import type { PageRequest, PageResult } from '@/api/types'
import type {
  IntermediaryAuditEvent,
  IntermediaryChildDetail,
  IntermediaryDeliveryDraft,
  IntermediaryListItem,
  IntermediaryOrderDraft,
  IntermediaryProcurementDraft,
  IntermediaryReceiptDraft,
  IntermediarySignoffDraft,
  IntermediaryStageMutationRequest,
  IntermediaryStageMutationResult,
  IntermediaryWireDocument,
} from './types'

const base = 'vou/intermediary-sale-order'

export const intermediaryActionPaths = {
  query: `${base}/query`,
  get: `${base}/get`,
  create: `${base}/create`,
  save: `${base}/save`,
  check: `${base}/check`,
  uncheck: `${base}/uncheck`,
  approve: `${base}/approve`,
  unapprove: `${base}/unapprove`,
  auditHistory: `${base}/audit-history`,
  attachmentInitiate: `${base}/attachment-initiate`,
  attachmentDownload: `${base}/attachment-download`,
  attachmentRemove: `${base}/attachment-remove`,
  shortCloseRequest: `${base}/short-close-request`,
  shortCloseCancel: `${base}/short-close-cancel`,
  shortCloseConfirm: `${base}/short-close-confirm`,
  shortCloseUnconfirm: `${base}/short-close-unconfirm`,
  procurementCreate: `${base}/procurement-create`,
  procurementGet: `${base}/procurement-get`,
  procurementSave: `${base}/procurement-save`,
  procurementDelete: `${base}/procurement-delete`,
  procurementCheck: `${base}/procurement-check`,
  procurementUncheck: `${base}/procurement-uncheck`,
  procurementPlace: `${base}/procurement-place`,
  procurementUnplace: `${base}/procurement-unplace`,
  receiptCreate: `${base}/receipt-create`,
  receiptGet: `${base}/receipt-get`,
  receiptSave: `${base}/receipt-save`,
  receiptDelete: `${base}/receipt-delete`,
  receiptCheck: `${base}/receipt-check`,
  receiptUncheck: `${base}/receipt-uncheck`,
  receiptConfirm: `${base}/receipt-confirm`,
  receiptUnconfirm: `${base}/receipt-unconfirm`,
  deliveryCreate: `${base}/delivery-create`,
  deliveryGet: `${base}/delivery-get`,
  deliverySave: `${base}/delivery-save`,
  deliveryDelete: `${base}/delivery-delete`,
  deliveryCheck: `${base}/delivery-check`,
  deliveryUncheck: `${base}/delivery-uncheck`,
  deliveryExecute: `${base}/delivery-execute`,
  deliveryUnexecute: `${base}/delivery-unexecute`,
  signoffCreate: `${base}/signoff-create`,
  signoffGet: `${base}/signoff-get`,
  signoffSave: `${base}/signoff-save`,
  signoffDelete: `${base}/signoff-delete`,
  signoffCheck: `${base}/signoff-check`,
  signoffUncheck: `${base}/signoff-uncheck`,
  signoffConfirm: `${base}/signoff-confirm`,
  signoffUnconfirm: `${base}/signoff-unconfirm`,
  procurementAttachmentInitiate: `${base}/procurement-attachment-initiate`,
  procurementAttachmentDownload: `${base}/procurement-attachment-download`,
  procurementAttachmentRemove: `${base}/procurement-attachment-remove`,
  receiptAttachmentInitiate: `${base}/receipt-attachment-initiate`,
  receiptAttachmentDownload: `${base}/receipt-attachment-download`,
  receiptAttachmentRemove: `${base}/receipt-attachment-remove`,
  deliveryAttachmentInitiate: `${base}/delivery-attachment-initiate`,
  deliveryAttachmentDownload: `${base}/delivery-attachment-download`,
  deliveryAttachmentRemove: `${base}/delivery-attachment-remove`,
  signoffAttachmentInitiate: `${base}/signoff-attachment-initiate`,
  signoffAttachmentDownload: `${base}/signoff-attachment-download`,
  signoffAttachmentRemove: `${base}/signoff-attachment-remove`,
} as const

export type IntermediaryAction = keyof typeof intermediaryActionPaths
export type IntermediaryChildPrefix =
  | 'procurement'
  | 'receipt'
  | 'delivery'
  | 'signoff'

function post<TResponse, TRequest>(
  action: IntermediaryAction,
  request: TRequest,
  signal?: AbortSignal,
) {
  return apiClient.post<TResponse, TRequest>(
    intermediaryActionPaths[action],
    request,
    { signal },
  )
}

function orderData(draft: IntermediaryOrderDraft) {
  const referenceInput = (value: { objectId: string; versionId: string }) => ({
    objectId: value.objectId,
    versionId: value.versionId,
  })
  return {
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    customer: referenceInput(draft.customer!),
    ...(draft.salesperson
      ? { salesperson: referenceInput(draft.salesperson) }
      : {}),
    productLines: draft.productLines.map((line) => ({
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

function procurementData(draft: IntermediaryProcurementDraft) {
  return {
    purchaseDate: draft.purchaseDate,
    supplier: {
      objectId: draft.supplier!.objectId,
      versionId: draft.supplier!.versionId,
    },
    ...(draft.purchaser
      ? {
          purchaser: {
            objectId: draft.purchaser.objectId,
            versionId: draft.purchaser.versionId,
          },
        }
      : {}),
    lines: draft.lines.map((line) => ({ ...line })),
    remark: draft.remark,
  }
}

function deliveryData(draft: IntermediaryDeliveryDraft) {
  return {
    deliveryDate: draft.deliveryDate,
    platform: {
      objectId: draft.platform!.objectId,
      versionId: draft.platform!.versionId,
    },
    vehicle: {
      objectId: draft.vehicle!.objectId,
      versionId: draft.vehicle!.versionId,
    },
    lines: draft.lines.map((line) => ({ ...line })),
    remark: draft.remark,
  }
}

export const intermediaryWorkflowApi = {
  query: (request: PageRequest, signal?: AbortSignal) =>
    post<PageResult<IntermediaryListItem>, PageRequest>('query', request, signal),
  get: (documentId: string, signal?: AbortSignal) =>
    post<IntermediaryWireDocument, { documentId: string }>(
      'get',
      { documentId },
      signal,
    ),
  create: (draft: IntermediaryOrderDraft) =>
    post<
      IntermediaryStageMutationResult,
      { workflowVersion: 2; data: ReturnType<typeof orderData> }
    >('create', { workflowVersion: 2, data: orderData(draft) }),
  save: (request: {
    documentId: string
    rootRevision: number
    data: IntermediaryOrderDraft
  }) =>
    post<
      IntermediaryStageMutationResult,
      {
        documentId: string
        rootRevision: number
        workflowVersion: 2
        data: ReturnType<typeof orderData>
      }
    >('save', {
      documentId: request.documentId,
      rootRevision: request.rootRevision,
      workflowVersion: 2,
      data: orderData(request.data),
    }),
  mutate: (
    action: IntermediaryAction,
    request: IntermediaryStageMutationRequest<unknown>,
  ) => post<IntermediaryStageMutationResult, typeof request>(action, request),
  getChild: (
    prefix: IntermediaryChildPrefix,
    request: { documentId: string; childId?: string },
  ) =>
    post<IntermediaryChildDetail, typeof request>(
      `${prefix}Get` as IntermediaryAction,
      request,
    ),
  saveProcurement: (
    action: 'procurementCreate' | 'procurementSave',
    request: IntermediaryStageMutationRequest<IntermediaryProcurementDraft>,
  ) =>
    post<
      IntermediaryStageMutationResult,
      Omit<typeof request, 'data'> & {
        data: ReturnType<typeof procurementData>
      }
    >(action, { ...request, data: procurementData(request.data!) }),
  saveReceipt: (
    action: 'receiptCreate' | 'receiptSave',
    request: IntermediaryStageMutationRequest<IntermediaryReceiptDraft>,
  ) => post<IntermediaryStageMutationResult, typeof request>(action, request),
  saveDelivery: (
    action: 'deliveryCreate' | 'deliverySave',
    request: IntermediaryStageMutationRequest<IntermediaryDeliveryDraft>,
  ) =>
    post<
      IntermediaryStageMutationResult,
      Omit<typeof request, 'data'> & {
        data: ReturnType<typeof deliveryData>
      }
    >(action, { ...request, data: deliveryData(request.data!) }),
  saveSignoff: (
    action: 'signoffCreate' | 'signoffSave',
    request: IntermediaryStageMutationRequest<IntermediarySignoffDraft>,
  ) => post<IntermediaryStageMutationResult, typeof request>(action, request),
  audit: (
    request: { documentId: string; page: number; pageSize: number },
    signal?: AbortSignal,
  ) =>
    post<PageResult<IntermediaryAuditEvent>, typeof request>(
      'auditHistory',
      request,
      signal,
    ),
  initiateRootAttachment: (request: {
    documentId: string
    revision: number
    fileName: string
    contentType: string
    size: number
    sha256: string
  }) =>
    post<
      {
        fileId: string
        uploadUrl: string
        expiresAt: string
        revision: number
        rootRevision?: number
      },
      typeof request
    >('attachmentInitiate', request),
  getRootAttachmentDownload: (request: {
    documentId: string
    fileId: string
  }) =>
    post<{ downloadUrl: string; expiresAt: string }, typeof request>(
      'attachmentDownload',
      request,
    ),
  removeRootAttachment: (request: {
    documentId: string
    revision: number
    fileId: string
  }) =>
    post<IntermediaryStageMutationResult, typeof request>(
      'attachmentRemove',
      request,
    ),
  initiateChildAttachment: (
    prefix: IntermediaryChildPrefix,
    request: {
      documentId: string
      rootRevision: number
      childId: string
      childRevision: number
      fileName: string
      contentType: string
      size: number
      sha256: string
    },
  ) =>
    post<
      {
        fileId: string
        uploadUrl: string
        expiresAt: string
        revision: number
        rootRevision: number
        childRevision: number
      },
      typeof request
    >(`${prefix}AttachmentInitiate` as IntermediaryAction, request),
  getChildAttachmentDownload: (
    prefix: IntermediaryChildPrefix,
    request: { documentId: string; childId: string; fileId: string },
  ) =>
    post<{ downloadUrl: string; expiresAt: string }, typeof request>(
      `${prefix}AttachmentDownload` as IntermediaryAction,
      request,
    ),
  removeChildAttachment: (
    prefix: IntermediaryChildPrefix,
    request: {
      documentId: string
      rootRevision: number
      childId: string
      childRevision: number
      fileId: string
    },
  ) =>
    post<IntermediaryStageMutationResult, typeof request>(
      `${prefix}AttachmentRemove` as IntermediaryAction,
      request,
    ),
}
