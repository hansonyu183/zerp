export type VoucherEntity =
  | 'sale-order'
  | 'purchase-order'
  | 'intermediary-sale-order'
  | 'receipt'
  | 'payment'
  | 'expense-reimbursement'
  | 'other-income'

export type VoucherStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'EXECUTED'

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
}

export interface VoucherProductLineDraft {
  key: string
  lineId?: string
  product: VoucherReference | null
  orderedQuantity: string
  unitPrice: string
  purchaseUnitPrice: string
  remark: string
}

export interface VoucherExpenseLineDraft {
  key: string
  lineId?: string
  category: string
  description: string
  amount: string
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
  fundAccount: VoucherReference | null
  sourceName: string
  amount: string
  productLines: VoucherProductLineDraft[]
  expenseLines: VoucherExpenseLineDraft[]
}

export interface VoucherReferenceView extends VoucherReferenceInput {
  entity: string
  code: string
  name: string
  unit?: string
  currency?: string
  plateNumber?: string
}

export interface VoucherProductLineView {
  lineId: string
  lineNo: number
  product: VoucherReferenceView
  orderedQuantity: string
  unitPrice: string
  purchaseUnitPrice?: string
  lineAmount: string
  remark?: string
  outboundQuantity?: string
  signedQuantity?: string
  rejectedQuantity?: string
  lossQuantity?: string
  inboundQuantity?: string
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
  ruleType: 'RELATIVE_DAYS' | 'MONTH_END' | 'FIXED_DAY'
  monthOffset: number
  dayOfMonth?: number
  dayOffset: number
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

export type WflManagedVoucherEntity =
  | 'customer-order'
  | 'procurement-order'
  | 'goods-receipt'
  | 'delivery-note'
  | 'signoff-note'

export type VouAtomicEntity = VoucherEntity | WflManagedVoucherEntity

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
  parentDocumentId?: string
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
  reviewedAt?: string
  reviewedBy?: string
  approvedAt?: string
  approvedBy?: string
  executedAt?: string
  executedBy?: string
}

export interface VoucherDocumentData {
  businessDate: string
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
  reviewedAt?: string
  reviewedBy?: string
  approvedAt?: string
  approvedBy?: string
  executedAt?: string
  executedBy?: string
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
export type VoucherExecutionKind = 'sale' | 'purchase' | 'confirm'

export interface VoucherEntityConfig {
  entity: VoucherEntity
  title: string
  icon: string
  order: number
  partyMode: 'customer' | 'supplier' | 'dual' | 'counterparty' | 'none'
  lineKind: VoucherLineKind
  executionKind: VoucherExecutionKind
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
  review: boolean
  unreview: boolean
  approve: boolean
  unapprove: boolean
  execute: boolean
  unexecute: boolean
  audit: boolean
  attachmentInitiate: boolean
  attachmentDownload: boolean
  attachmentRemove: boolean
}
