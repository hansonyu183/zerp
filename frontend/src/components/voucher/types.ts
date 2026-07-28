export type VoucherEntity =
  | 'sale-order'
  | 'sale-outbound'
  | 'sale-delivery'
  | 'sale-signoff'
  | 'purchase-order'
  | 'purchase-inbound'
  | 'receipt'
  | 'payment'
  | 'expense-reimbursement'
  | 'other-income'

export type VoucherStatus =
  | 'DRAFT'
  | 'CHECKED'
  | 'APPROVED'
  | 'FINALIZED'
  | 'ORDERED'
  | 'CONFIRMED'
  | 'EXECUTED'

export interface VoucherReferenceInput {
  objectId: string
  versionId: string
}

export interface VoucherReference extends VoucherReferenceInput {
  entity: string
  code: string
  name: string
  unit?: string
  currency?: string
  plateNumber?: string
  supplierType?: string
  platformObjectId?: string
  productKind?: string
  pricingQuantityPerInventoryUnit?: string
}

export interface VoucherProductLineDraft {
  key: string
  lineId?: string
  product: VoucherReference | null
  orderedQuantity: string
  unitPrice: string
  settlementSurcharge: string
  purchaseUnitPrice: string
  remark: string
  formula: ProductFormulaDraft | null
  formulaLoading?: boolean
  formulaError?: string
}

export interface VoucherExpenseLineDraft {
  key: string
  lineId?: string
  category: string
  description: string
  amount: string
  remark: string
}

export interface VoucherSalesChainLineDraft {
  key: string
  sourceLineId: string
  productCode: string
  productName: string
  productUnit: string
  availableQuantity: string
  outboundQuantity: string
  quantity: string
  signedQuantity: string
  rejectedQuantity: string
  lossQuantity: string
  remark: string
}

export interface VoucherDraftForm {
  businessDate: string
  currency: string
  remark: string
  customer: VoucherReference | null
  supplier: VoucherReference | null
  counterpartyType: '' | 'customer' | 'supplier'
  counterparty: VoucherReference | null
  employee: VoucherReference | null
  salesperson: VoucherReference | null
  purchaser: VoucherReference | null
  handler: VoucherReference | null
  warehouse: VoucherReference | null
  platform: VoucherReference | null
  vehicle: VoucherReference | null
  fundAccount: VoucherReference | null
  sourceName: string
  amount: string
  parentDocumentId: string
  parentDocumentNo: string
  productLines: VoucherProductLineDraft[]
  expenseLines: VoucherExpenseLineDraft[]
  salesChainLines: VoucherSalesChainLineDraft[]
}

export interface VoucherReferenceView extends VoucherReferenceInput {
  entity: string
  code: string
  name: string
  unit?: string
  currency?: string
  plateNumber?: string
  productKind?: string
  pricingQuantityPerInventoryUnit?: string
}

export interface VoucherProductLineView {
  lineId: string
  lineNo: number
  product: VoucherReferenceView
  orderedQuantity: string
  unitPrice: string
  baseUnitPrice?: string
  settlementSurcharge?: string
  purchaseUnitPrice?: string
  lineAmount: string
  remark?: string
  outboundQuantity?: string
  signedQuantity?: string
  rejectedQuantity?: string
  lossQuantity?: string
  inboundQuantity?: string
  sourceLineId?: string
  quantity?: string
  availableQuantity?: string
  formula?: {
    baseOutputQuantity: string
    sourceType?: string
    sourceDocumentId?: string
    sourceDocumentNo?: string
    components: Array<{
      material: FormulaMaterialReference
      quantity: string
    }>
  }
}

export interface VoucherSaleSignoffLineView {
  lineId: string
  lineNo: number
  sourceLineId: string
  product: VoucherReferenceView
  outboundQuantity: string
  signedQuantity: string
  rejectedQuantity: string
  lossQuantity: string
  unitPrice: string
  lineAmount: string
  remark?: string
}

export interface VoucherExpenseLineView {
  lineId: string
  lineNo: number
  category: string
  description: string
  amount: string
  remark?: string
}

export interface SettlementMethodSnapshot {
  objectId: string
  versionId: string
  code: string
  name: string
  ruleType: 'DUE_DAYS' | 'MONTH_END' | 'RELATIVE_DAYS' | 'FIXED_DAY'
  monthOffset: number
  dayOfMonth?: number
  dayOffset: number
  dueDays?: number
  cutoffDay?: number
  defaultSalesSurcharge?: string
  description?: string
}

export interface VoucherAttachment {
  fileId: string
  fileName: string
  contentType: string
  size: number
  sha256: string
  status: 'PENDING' | 'READY'
  storedAt?: string
  createdAt: string
  createdBy: string
}

export type VouAtomicEntity = VoucherEntity

export interface VouAtomicDocument<
  TData = unknown,
  TLine = unknown,
  TStatus extends string = string,
> {
  documentId: string
  documentNo: string
  entity: VouAtomicEntity
  status: TStatus
  revision: number
  parentEntity?: VoucherEntity
  parentDocumentId?: string
  parentDocumentNo?: string
  businessDate: string
  currency: string
  amount: string
  data?: TData
  lines?: TLine[]
  attachments: VoucherAttachment[]
  createdAt: string
  createdBy: string
  updatedAt?: string
  updatedBy?: string
  checkedAt?: string
  checkedBy?: string
  reviewedAt?: string
  reviewedBy?: string
  approvedAt?: string
  approvedBy?: string
  finalizedAt?: string
  finalizedBy?: string
  executedAt?: string
  executedBy?: string
}

export interface VoucherDocumentData {
  businessDate: string
  dueDate?: string
  currency: string
  remark?: string
  customer?: VoucherReferenceView
  supplier?: VoucherReferenceView
  counterparty?: VoucherReferenceView
  employee?: VoucherReferenceView
  salesperson?: VoucherReferenceView
  purchaser?: VoucherReferenceView
  handler?: VoucherReferenceView
  warehouse?: VoucherReferenceView
  fundAccount?: VoucherReferenceView
  contactName?: string
  contactPhone?: string
  deliveryAddress?: string
  settlementMethod?: SettlementMethodSnapshot
  customerSettlementMethod?: SettlementMethodSnapshot
  supplierSettlementMethod?: SettlementMethodSnapshot
  sourceName?: string
  productLines?: VoucherProductLineView[]
  expenseLines?: VoucherExpenseLineView[]
  outboundDate?: string
  signoffDate?: string
  inboundDate?: string
  platform?: VoucherReferenceView
  vehicle?: VoucherReferenceView
  differenceReason?: string
  signoffLines?: VoucherSaleSignoffLineView[]
  fulfillmentStatus?:
    'OPEN' | 'FULFILLED' | 'SHORT_CLOSE_REQUESTED' | 'SHORT_CLOSED'
  signedQuantity?: string
  inTransitQuantity?: string
  remainingQuantity?: string
  shortCloseRequestedBy?: string
  shortCloseReason?: string
  lines?: VoucherManagedLineView[]
  expectedSolventContainers?: number
  expectedResinContainers?: number
  returnedSolventContainers?: number
  returnedResinContainers?: number
  containerDifferenceReason?: string
}

export interface VoucherManagedLineView {
  lineId: string
  lineNo?: number
  sourceLineId?: string
  product?: VoucherReferenceView
  quantity?: string
  orderedQuantity?: string
  signedQuantity?: string
  rejectedQuantity?: string
  lossQuantity?: string
  unitPrice?: string
  lineAmount?: string
  containerType?: 'NONE' | 'SOLVENT' | 'RESIN'
  quantityPerContainer?: string
  remark?: string
}

export interface VoucherDocumentView {
  documentId: string
  entity: VoucherEntity
  documentNo: string
  status: VoucherStatus
  revision: number
  amount: string
  data: VoucherDocumentData
  attachments: VoucherAttachment[]
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  checkedAt?: string
  checkedBy?: string
  approvedAt?: string
  approvedBy?: string
  finalizedAt?: string
  finalizedBy?: string
  parentEntity?: VoucherEntity
  parentDocumentId?: string
  parentDocumentNo?: string
}

export interface VoucherListItem {
  documentId: string
  entity: VoucherEntity
  documentNo: string
  status: VoucherStatus
  revision: number
  businessDate: string
  partyName?: string
  currency: string
  amount: string
  updatedAt: string
}

export interface VoucherMutationResult {
  documentId: string
  documentNo: string
  status: VoucherStatus
  revision: number
}

export interface VoucherAuditEvent {
  id: string
  eventType: string
  fromStatus: VoucherStatus | null
  toStatus: VoucherStatus
  actorId: string
  occurredAt: string
  reason: string | null
  requestId: string
  summary: unknown
}

export interface VoucherQueryFilters {
  keyword: string
  status: VoucherStatus[]
  dateFrom: string
  dateTo: string
  partyObjectId: string
}

export interface VoucherSort {
  field: 'updatedAt' | 'documentNo' | 'businessDate' | 'status' | 'amount'
  order: 'asc' | 'desc'
}

export interface VoucherExecutionSaleLine {
  lineId: string
  orderedQuantity: string
  outboundQuantity: string
  signedQuantity: string
  rejectedQuantity: string
  lossQuantity: string
}

export interface VoucherExecutionPurchaseLine {
  lineId: string
  orderedQuantity: string
  inboundQuantity: string
}

export interface VoucherExecutionForm {
  outboundDate: string
  signoffDate: string
  inboundDate: string
  platform: VoucherReference | null
  vehicle: VoucherReference | null
  differenceReason: string
  saleLines: VoucherExecutionSaleLine[]
  purchaseLines: VoucherExecutionPurchaseLine[]
}

export type VoucherLineKind = 'product' | 'expense' | 'none'
export type VoucherFinalizationKind = 'direct' | 'sale' | 'purchase'

export interface VoucherLifecycleLabels {
  check: string
  uncheck: string
  approve: string
  unapprove: string
  finalize: string
  unfinalize: string
  checked: string
  finalized: string
}

export interface VoucherEntityConfig {
  entity: VoucherEntity
  title: string
  icon: string
  order: number
  partyMode: 'customer' | 'supplier' | 'dual' | 'counterparty' | 'none'
  lineKind: VoucherLineKind
  finalizationKind: VoucherFinalizationKind
  lifecycleLabels?: Partial<VoucherLifecycleLabels>
  parentEntity?: VoucherEntity
  usesSalesperson?: boolean
  usesPurchaser?: boolean
  usesWarehouse?: boolean
  usesFundAccount?: boolean
  usesHandler?: boolean
  usesEmployee?: boolean
  usesSourceName?: boolean
  directAmount?: boolean
}

export interface VoucherActionAvailability {
  get: boolean
  save: boolean
  check: boolean
  uncheck: boolean
  approve: boolean
  unapprove: boolean
  finalize: boolean
  unfinalize: boolean
  delete: boolean
  shortCloseRequest: boolean
  shortCloseCancel: boolean
  shortCloseConfirm: boolean
  shortCloseUnconfirm: boolean
  audit: boolean
  attachmentInitiate: boolean
  attachmentDownload: boolean
  attachmentRemove: boolean
}
import type {
  FormulaMaterialReference,
  ProductFormulaDraft,
} from '@/components/formula'
