import type {
  VouAtomicDocument,
  WflManagedVoucherEntity,
} from '@/components/voucher'

export type WflProcessStatus =
  | 'DRAFT'
  | 'CHECKED'
  | 'APPROVED'
  | 'COMPLETED'
  | 'SHORT_CLOSE_REQUESTED'
  | 'SHORT_CLOSED'

export type WflStage =
  | 'CUSTOMER_ORDER'
  | 'PROCUREMENT'
  | 'RECEIPT'
  | 'DELIVERY'
  | 'SIGNOFF'

export type WflStagePrefix =
  | 'procurement'
  | 'receipt'
  | 'delivery'
  | 'signoff'

export type WflAction =
  | 'query'
  | 'get'
  | 'create'
  | 'save'
  | 'check'
  | 'uncheck'
  | 'approve'
  | 'unapprove'
  | 'audit-history'
  | 'short-close-request'
  | 'short-close-cancel'
  | 'short-close-confirm'
  | 'short-close-unconfirm'
  | `${WflStagePrefix}-create`
  | `${WflStagePrefix}-get`
  | `${WflStagePrefix}-save`
  | `${WflStagePrefix}-delete`
  | `${WflStagePrefix}-check`
  | `${WflStagePrefix}-uncheck`
  | 'procurement-place'
  | 'procurement-unplace'
  | 'receipt-confirm'
  | 'receipt-unconfirm'
  | 'delivery-execute'
  | 'delivery-unexecute'
  | 'signoff-confirm'
  | 'signoff-unconfirm'
  | `${WflStagePrefix}-attachment-initiate`
  | `${WflStagePrefix}-attachment-download`
  | `${WflStagePrefix}-attachment-remove`

export interface WflDocumentSummary<TData = unknown, TLine = unknown>
  extends VouAtomicDocument<TData, TLine> {
  entity: WflManagedVoucherEntity
  stage: WflStage
}

export interface WflProcessDefinition {
  processType: string
  title: string
  singularTitle: string
  statuses: Readonly<Record<string, string>>
  stages: readonly WflStageDefinition[]
}

export interface WflProcessListRow {
  processId: string
  documentNo: string
  businessDate: string
  partyName?: string
  status: string
  currentStage?: string
  amount: string
  currency: string
  updatedAt: string
}

export interface WflStageDefinition {
  stage: WflStage
  prefix?: WflStagePrefix
  entity: WflManagedVoucherEntity
  title: string
  icon: string
  repeatable: boolean
  semanticFinalStatus: string
  finalLabel: string
  createAction?: WflAction
  getAction: WflAction
  saveAction?: WflAction
  deleteAction?: WflAction
  checkAction: WflAction
  uncheckAction: WflAction
  finalAction: WflAction
  reverseFinalAction: WflAction
  attachments: boolean
}

export interface WflPage<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface WflQueryInput {
  page: number
  pageSize: number
  keyword?: string
  statuses?: string[]
}

export interface WflActionInput<TData = unknown> {
  processId: string
  processRevision: number
  documentId?: string
  documentRevision?: number
  data?: TData
  reason?: string
}

export interface WflMutationResult<TBalances = unknown> {
  processId: string
  processRevision: number
  workflowStatus: string
  documentId?: string
  documentNo?: string
  documentRevision?: number
  documentStatus?: string
  parentDocumentId?: string
  balances?: TBalances
}

export interface WflAttachmentInitiateInput {
  processId: string
  processRevision: number
  documentId: string
  documentRevision: number
  fileName: string
  contentType: string
  size: number
  sha256: string
}

export interface WflAttachmentDownloadInput {
  processId: string
  documentId: string
  fileId: string
}

export interface WflAttachmentRemoveInput {
  processId: string
  processRevision: number
  documentId: string
  documentRevision: number
  fileId: string
}

export type WflAttachmentInitiateAction =
  `${WflStagePrefix}-attachment-initiate`
export type WflAttachmentDownloadAction =
  `${WflStagePrefix}-attachment-download`
export type WflAttachmentRemoveAction =
  `${WflStagePrefix}-attachment-remove`

export interface WflAuditEvent {
  id: string
  eventType: string
  fromStatus?: string | null
  toStatus: string
  stage?: WflStage
  documentId?: string
  documentNo?: string
  documentStatus?: string
  actorId: string
  occurredAt: string
  reason?: string | null
  requestId: string
  summary?: unknown
}

export interface WflApiAdapter<TProcess, TBalances = unknown> {
  query(input: WflQueryInput, signal?: AbortSignal): Promise<{ data: WflPage<TProcess> }>
  get(processId: string, signal?: AbortSignal): Promise<{ data: TProcess }>
  mutate<TData = unknown>(
    action: WflAction,
    input: WflActionInput<TData>,
  ): Promise<{ data: WflMutationResult<TBalances> }>
  history(
    processId: string,
    page: number,
    pageSize: number,
    signal?: AbortSignal,
  ): Promise<{ data: WflPage<WflAuditEvent> }>
  initiateAttachment(
    action: WflAttachmentInitiateAction,
    input: WflAttachmentInitiateInput,
  ): Promise<{
    data: {
      processId: string
      processRevision: number
      documentId: string
      documentRevision: number
      fileId: string
      uploadUrl: string
      expiresAt: string
    }
  }>
  downloadAttachment(
    action: WflAttachmentDownloadAction,
    input: WflAttachmentDownloadInput,
  ): Promise<{ data: { downloadUrl: string; expiresAt: string } }>
  removeAttachment(
    action: WflAttachmentRemoveAction,
    input: WflAttachmentRemoveInput,
  ): Promise<{
    data: {
      processId: string
      processRevision: number
      documentId: string
      documentRevision: number
      documentStatus: string
    }
  }>
}
