import type {
  VoucherAttachment,
  VoucherReference,
  VoucherReferenceView,
} from '@/components/voucher'
import type {
  WflAuditEvent,
  WflDocumentSummary,
  WflPage,
  WflProcessListRow,
  WflProcessStatus,
  WflStage,
} from '@/components/wfl'

export type IntermediaryWorkflowStatus =
  | 'DRAFT'
  | 'CHECKED'
  | 'APPROVED'
  | 'COMPLETED'
  | 'SHORT_CLOSE_REQUESTED'
  | 'SHORT_CLOSED'

export type IntermediaryStage =
  | 'ORDER'
  | 'PROCUREMENT'
  | 'RECEIPT'
  | 'DELIVERY'
  | 'SIGNOFF'
  | 'SHORT_CLOSE'

export type IntermediaryChildStage = Exclude<
  IntermediaryStage,
  'ORDER' | 'SHORT_CLOSE'
>

export type IntermediaryStageStatus =
  | 'DRAFT'
  | 'CHECKED'
  | 'ORDERED'
  | 'CONFIRMED'
  | 'EXECUTED'

export type IntermediaryContainerType = 'NONE' | 'SOLVENT' | 'RESIN'
export type IntermediaryContainerLedgerType = Exclude<
  IntermediaryContainerType,
  'NONE'
>

export interface IntermediaryProductReference extends VoucherReference {
  containerType?: IntermediaryContainerType
  quantityPerContainer?: string
}

export interface IntermediaryOrderLine {
  lineId: string
  lineNo: number
  product: VoucherReferenceView
  orderedQuantity: string
  unitPrice: string
  lineAmount: string
  containerType: IntermediaryContainerType
  quantityPerContainer?: string
  remark?: string
}

export interface IntermediaryOrderLineDraft {
  key: string
  lineId?: string
  product: IntermediaryProductReference | null
  orderedQuantity: string
  unitPrice: string
  containerType: IntermediaryContainerType
  quantityPerContainer: string
  remark: string
}

export interface IntermediaryOrderDraft {
  businessDate: string
  currency: string
  customer: VoucherReference | null
  salesperson: VoucherReference | null
  remark: string
  productLines: IntermediaryOrderLineDraft[]
}

export interface IntermediaryLineBalance {
  rootLineId: string
  orderedQuantity: string
  procurementQuantity?: string
  confirmedReceiptQuantity: string
  executedDeliveryQuantity: string
  signedQuantity: string
  rejectedQuantity: string
  lossQuantity: string
  availableToDeliverQuantity: string
  remainingToSignQuantity: string
}

export interface IntermediaryContainerBalanceItem {
  containerType: IntermediaryContainerLedgerType
  quantity: number
}

export interface IntermediaryBalances {
  lines: IntermediaryLineBalance[]
  containers: IntermediaryContainerBalanceItem[]
  hasUnfinishedChildren: boolean
}

export interface IntermediaryContainerBalance {
  solvent: number
  resin: number
}

export interface IntermediaryChildSummary {
  childId: string
  childNo: string
  stage: IntermediaryChildStage
  status: IntermediaryStageStatus
  revision: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  checkedAt?: string
  checkedBy?: string
  finalAt?: string
  finalBy?: string
  entity?:
    | 'procurement-order'
    | 'goods-receipt'
    | 'delivery-note'
    | 'signoff-note'
  parentDocumentId?: string
  businessDate?: string
  amount?: string
  attachments?: VoucherAttachment[]
}

export interface IntermediarySettlementSnapshot {
  objectId: string
  versionId: string
  code: string
  name: string
  ruleType: 'RELATIVE_DAYS' | 'MONTH_END' | 'FIXED_DAY'
  monthOffset: number
  dayOfMonth?: number
  dayOffset: number
  description?: string
}

export interface IntermediaryWorkflowDocument {
  processId: string
  rootDocumentId: string
  documentId: string
  documentNo: string
  workflowStatus: IntermediaryWorkflowStatus
  rootRevision: number
  documentRevision: number
  businessDate: string
  currency: string
  amount: string
  customer: VoucherReferenceView
  salesperson: VoucherReferenceView
  customerSettlementMethod?: IntermediarySettlementSnapshot
  contactName?: string
  contactPhone?: string
  deliveryAddress?: string
  productLines: IntermediaryOrderLine[]
  balances: IntermediaryBalances
  children: IntermediaryChildSummary[]
  attachments: VoucherAttachment[]
  checkedBy?: string
  checkedAt?: string
  approvedBy?: string
  approvedAt?: string
  completedAt?: string
  remark?: string
  updatedAt: string
}

export interface IntermediaryListItem extends WflProcessListRow {}

export interface IntermediaryStageMutationRequest<T = never> {
  processId?: string
  processRevision?: number
  documentId: string
  rootRevision: number
  childId?: string
  childRevision?: number
  data?: T
  reason?: string
}

export interface IntermediaryStageMutationResult {
  documentId: string
  documentNo: string
  status: string
  revision: number
  rootRevision?: number
  workflowStatus?: string
  childId?: string
  childNo?: string
  childRevision?: number
  childStatus?: IntermediaryStageStatus
  balances?: IntermediaryBalances
}

export interface IntermediaryProcurementDraft {
  purchaseDate: string
  supplier: VoucherReference | null
  purchaser: VoucherReference | null
  lines: Array<{
    rootLineId: string
    quantity: string
    unitPrice: string
    remark: string
  }>
  remark: string
}

export interface IntermediaryReceiptDraft {
  receiptDate: string
  lines: Array<{
    rootLineId: string
    quantity: string
    remark: string
  }>
  remark: string
}

export interface IntermediaryDeliveryDraft {
  deliveryDate: string
  platform: VoucherReference | null
  vehicle: VoucherReference | null
  lines: Array<{
    rootLineId: string
    quantity: string
    remark: string
  }>
  remark: string
}

export interface IntermediarySignoffDraft {
  deliveryChildId: string
  signoffDate: string
  lines: Array<{
    rootLineId: string
    signedQuantity: string
    rejectedQuantity: string
    remark: string
  }>
  returnedSolventContainers: number
  returnedResinContainers: number
  containerDifferenceReason: string
  remark: string
}

export type IntermediaryStageDraft =
  | IntermediaryProcurementDraft
  | IntermediaryReceiptDraft
  | IntermediaryDeliveryDraft
  | IntermediarySignoffDraft

export interface IntermediaryProcurementData {
  purchaseDate: string
  supplier: VoucherReferenceView
  purchaser: VoucherReferenceView
  remark?: string
}

export interface IntermediaryReceiptData {
  receiptDate: string
  remark?: string
}

export interface IntermediaryDeliveryData {
  deliveryDate: string
  platform: VoucherReferenceView
  vehicle: VoucherReferenceView
  expectedSolventContainers: number
  expectedResinContainers: number
  remark?: string
}

export interface IntermediarySignoffData {
  deliveryChildId: string
  signoffDate: string
  returnedSolventContainers: number
  returnedResinContainers: number
  containerDifferenceReason?: string
  remark?: string
}

export interface IntermediaryProcurementLineView {
  rootLineId: string
  quantity: string
  unitPrice?: string
  lineAmount?: string
  remark?: string
}

export interface IntermediaryQuantityLineView {
  rootLineId: string
  quantity: string
  remark?: string
}

export interface IntermediarySignoffLineView {
  rootLineId: string
  signedQuantity: string
  rejectedQuantity: string
  lossQuantity: string
  remark?: string
}

export interface IntermediaryChildDetail {
  documentId: string
  child: IntermediaryChildSummary
  data:
    | IntermediaryProcurementData
    | IntermediaryReceiptData
    | IntermediaryDeliveryData
    | IntermediarySignoffData
  lines: Array<
    | IntermediaryProcurementLineView
    | IntermediaryQuantityLineView
    | IntermediarySignoffLineView
  >
  balances: IntermediaryBalances
  attachments: VoucherAttachment[]
}

export interface IntermediaryAuditEvent extends WflAuditEvent {
  childId?: string
  childNo?: string
  childStatus?: string
}

export interface IntermediaryWireDocument {
  processId: string
  rootDocumentId: string
  documentId: string
  documentNo: string
  status: string
  revision: number
  amount: string
  data: {
    businessDate: string
    currency: string
    remark?: string
    customer?: VoucherReferenceView
    salesperson?: VoucherReferenceView
    contactName?: string
    contactPhone?: string
    deliveryAddress?: string
    customerSettlementMethod?: IntermediarySettlementSnapshot
    productLines?: IntermediaryOrderLine[]
  }
  attachments: VoucherAttachment[]
  updatedAt: string
  approvedAt?: string
  approvedBy?: string
  workflowStatus?: string
  rootRevision?: number
  balances?: IntermediaryBalances
  children?: IntermediaryChildSummary[]
  checkedAt?: string
  checkedBy?: string
  completedAt?: string
}

export interface IntermediaryReferenceWire extends VoucherReferenceView {
  ruleType?: 'RELATIVE_DAYS' | 'MONTH_END' | 'FIXED_DAY'
  monthOffset?: number
  dayOfMonth?: number
  dayOffset?: number
}

export interface IntermediaryCustomerLineWire {
  lineId: string
  lineNo: number
  product: VoucherReferenceView
  orderedQuantity: string
  unitPrice: string
  lineAmount: string
  containerType: IntermediaryContainerType
  quantityPerContainer?: string
  remark?: string
}

export interface IntermediaryStageLineWire {
  lineId: string
  sourceLineId: string
  quantity?: string
  unitPrice?: string
  lineAmount?: string
  signedQuantity?: string
  rejectedQuantity?: string
  lossQuantity?: string
  remark?: string
}

export interface IntermediaryDocumentWire
  extends Omit<WflDocumentSummary<Record<string, unknown>, IntermediaryStageLineWire>, 'lines' | 'stage'> {
  stage: WflStage
  data?: {
    currency?: string
    remark?: string
    customer?: VoucherReferenceView
    salesperson?: VoucherReferenceView
    supplier?: VoucherReferenceView
    purchaser?: VoucherReferenceView
    platform?: VoucherReferenceView
    vehicle?: VoucherReferenceView
    contactName?: string
    contactPhone?: string
    deliveryAddress?: string
    settlementMethod?: IntermediarySettlementSnapshot
    returnedSolventContainers?: number
    returnedResinContainers?: number
    expectedSolventContainers?: number
    expectedResinContainers?: number
    containerDifferenceReason?: string
  }
  lines?: IntermediaryCustomerLineWire[] | IntermediaryStageLineWire[]
}

export interface IntermediaryLineBalanceWire {
  customerLineId: string
  orderedQuantity: string
  procurementQuantity?: string
  receivedQuantity: string
  deliveredQuantity: string
  signedQuantity: string
  rejectedQuantity: string
  lossQuantity: string
  availableToDeliverQuantity: string
  remainingToSignQuantity: string
}

export interface IntermediaryBalancesWire {
  lines: IntermediaryLineBalanceWire[]
  solventContainers: number
  resinContainers: number
  hasUnfinishedDocuments: boolean
}

export interface IntermediaryProcessWire {
  processId: string
  processType: 'INTERMEDIARY_TRADE'
  definitionVersion: 1
  status: WflProcessStatus
  revision: number
  rootDocumentId: string
  rootDocumentNo: string
  currentStage: WflStage | ''
  documents: IntermediaryDocumentWire[]
  balances: IntermediaryBalancesWire
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export type IntermediaryProcessPage = WflPage<IntermediaryProcessWire>
export type IntermediaryAuditWire = WflAuditEvent

export interface IntermediaryProcessRow extends WflProcessListRow {
  rootDocumentId: string
}
