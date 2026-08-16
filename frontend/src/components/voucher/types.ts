export type VoucherEntity =
  | 'bill-receipt'
  | 'bill-payment'
  | 'bill-issue'
  | 'bill-discount'
  | 'bill-maturity'
  | 'sale-pricing'
  | 'sale-order'
  | 'sale-outbound'
  | 'sale-delivery'
  | 'sale-signoff'
  | 'sale-return'
  | 'order-production'
  | 'self-production'
  | 'inventory-count'
  | 'purchase-order'
  | 'purchase-inbound'
  | 'purchase-return'
  | 'purchase-inquiry'
  | 'sales-receipt'
  | 'purchase-refund'
  | 'other-receipt'
  | 'sales-refund'
  | 'purchase-payment'
  | 'other-payment'
  | 'employee-loan'
  | 'employee-repayment'
  | 'employee-loan-writeoff'
  | 'expense-reimbursement'
  | 'expense-payment'
  | 'other-income'
  | 'asset-acquisition'
  | 'asset-sale'
  | 'asset-liquidation'
  | 'intermediary-calculation'

export type VoucherStatus =
  | 'DRAFT'
  | 'CHECKED'
  | 'APPROVED'

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
  referenceUnitPrice?: string
  referenceDocumentId?: string
  referenceDocumentNo?: string
  referenceBusinessDate?: string
  priceDirty?: boolean
}

export interface VoucherPriceLineDraft {
  key: string
  lineId?: string
  product: VoucherReference | null
  unitPrice: string
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

export interface VoucherInventoryCountLineDraft {
  key: string
  lineId?: string
  product: VoucherReference | null
  actualQuantity: string
  bookQuantity?: string
  differenceQuantity?: string
  remark: string
}

export interface VoucherAssetLineDraft {
  key: string
  lineId?: string
  assetId: string
  assetNo: string
  assetName: string
  specification: string
  category: VoucherReference | null
  department: VoucherReference | null
  custodian: VoucherReference | null
  originalValue: string
  usefulLifeMonths: string
  residualRate: string
  location: string
  accumulatedDepreciation: string
  netValue: string
  saleAmount: string
  reason: string
  salvageIncome: string
  disposalExpense: string
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

export interface VoucherProductionMaterialDraft {
  key: string
  lineId?: string
  formulaLineNo: number
  formulaMaterial: VoucherReference
  formulaQuantity: string
  suggestedQuantity: string
  actualMaterial: VoucherReference | null
  actualQuantity: string
  adjustmentReason: string
}

export interface VoucherProductionOutputDraft {
  key: string
  lineId?: string
  sourceOrderLineId: string
  product: VoucherReference | null
  outputQuantity: string
  lossRate: string
  formulaBaseOutputQuantity: string
  remark: string
  materials: VoucherProductionMaterialDraft[]
  formulaLoading?: boolean
  formulaError?: string
}

export interface VoucherDraftForm {
  businessDate: string
  currency: string
  remark: string
  specialApproval: boolean
  intermediaryCalculation: IntermediaryCalculationInput | null
  returnReason: string
  returnKind: '' | 'REFUSAL' | 'AFTER_SALE'
  customer: VoucherReference | null
  supplier: VoucherReference | null
  counterpartyType: '' | 'customer' | 'supplier' | 'other-party' | 'employee'
  counterparty: VoucherReference | null
  otherCategory: '' | 'COMMISSION' | 'INTERMEDIARY' | 'REBATE'
  employee: VoucherReference | null
  salesperson: VoucherReference | null
  purchaser: VoucherReference | null
  handler: VoucherReference | null
  warehouse: VoucherReference | null
  materialWarehouse: VoucherReference | null
  finishedWarehouse: VoucherReference | null
  platform: VoucherReference | null
  vehicle: VoucherReference | null
  fundAccount: VoucherReference | null
  sourceName: string
  amount: string
  parentDocumentId: string
  parentDocumentNo: string
  productLines: VoucherProductLineDraft[]
  priceLines: VoucherPriceLineDraft[]
  expenseLines: VoucherExpenseLineDraft[]
  assetLines: VoucherAssetLineDraft[]
  salesChainLines: VoucherSalesChainLineDraft[]
  productionLines: VoucherProductionOutputDraft[]
  inventoryCountLines: VoucherInventoryCountLineDraft[]
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
  returnableQuantity?: string
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
  referenceUnitPrice?: string
  referenceDocumentId?: string
  referenceDocumentNo?: string
  referenceBusinessDate?: string
}

export interface VoucherPriceLineView {
  lineId: string
  lineNo: number
  product: VoucherReferenceView
  unitPrice: string
  remark?: string
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
  returnableQuantity?: string
}

export interface VoucherExpenseLineView {
  lineId: string
  lineNo: number
  category: string
  description: string
  amount: string
  remark?: string
}

export interface VoucherInventoryCountLineView {
  lineId: string
  lineNo: number
  product: VoucherReferenceView
  actualQuantity: string
  bookQuantity?: string
  differenceQuantity?: string
  remark?: string
}

export interface VoucherProductionMaterialView {
  lineId: string
  lineNo: number
  formulaMaterial: VoucherReferenceView
  formulaQuantity: string
  suggestedQuantity: string
  actualMaterial: VoucherReferenceView
  actualQuantity: string
  adjustmentReason?: string
}

export interface VoucherProductionOutputView {
  lineId: string
  lineNo: number
  sourceOrderLineId?: string
  product: VoucherReferenceView
  outputQuantity: string
  lossRate: string
  formulaBaseOutputQuantity: string
  remark?: string
  materials: VoucherProductionMaterialView[]
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
}

export interface VoucherDocumentData {
  businessDate: string
  dueDate?: string
  currency: string
  remark?: string
  returnReason?: string
  returnKind?: 'REFUSAL' | 'AFTER_SALE'
  specialApproval?: boolean
  intermediaryCalculation?: IntermediaryCalculationInput
  customer?: VoucherReferenceView
  supplier?: VoucherReferenceView
  counterparty?: VoucherReferenceView
  otherCategory?: 'COMMISSION' | 'INTERMEDIARY' | 'REBATE'
  employee?: VoucherReferenceView
  salesperson?: VoucherReferenceView
  purchaser?: VoucherReferenceView
  handler?: VoucherReferenceView
  warehouse?: VoucherReferenceView
  materialWarehouse?: VoucherReferenceView
  finishedWarehouse?: VoucherReferenceView
  fundAccount?: VoucherReferenceView
  contactName?: string
  contactPhone?: string
  deliveryAddress?: string
  settlementMethod?: SettlementMethodSnapshot
  customerSettlementMethod?: SettlementMethodSnapshot
  supplierSettlementMethod?: SettlementMethodSnapshot
  sourceName?: string
  productLines?: VoucherProductLineView[]
  priceLines?: VoucherPriceLineView[]
  expenseLines?: VoucherExpenseLineView[]
  assetAcquisitionLines?: VoucherAssetLineView[]
  assetSaleLines?: VoucherAssetLineView[]
  assetLiquidationLines?: VoucherAssetLineView[]
  outboundDate?: string
  signoffDate?: string
  inboundDate?: string
  platform?: VoucherReferenceView
  vehicle?: VoucherReferenceView
  differenceReason?: string
  signoffLines?: VoucherSaleSignoffLineView[]
  fulfillmentStatus?: 'OPEN' | 'FULFILLED'
  signedQuantity?: string
  inTransitQuantity?: string
  remainingQuantity?: string
  lines?: VoucherManagedLineView[]
  productionLines?: VoucherProductionOutputView[]
  inventoryCountLines?: VoucherInventoryCountLineView[]
  expectedSolventContainers?: number
  expectedResinContainers?: number
  returnedSolventContainers?: number
  returnedResinContainers?: number
  containerDifferenceReason?: string
}

export interface IntermediaryReference {
  objectId: string
  versionId: string
  entity: 'customer' | 'employee' | 'other-party' | 'product'
  code: string
  name: string
}

export interface IntermediarySourceLine {
  sourceSignoffLineId: string
  sourceKind: 'SALE' | 'RETURN_ADJUSTMENT'
  signoffDocumentId: string
  signoffDocumentNo: string
  signoffDate: string
  orderDocumentId: string
  orderDocumentNo: string
  orderDate: string
  dueDate: string
  collectionDate: string
  collectionDelayDays: number
  customer: IntermediaryReference
  salesperson: IntermediaryReference
  intermediary?: IntermediaryReference
  product: IntermediaryReference
  productKind: string
  signedQuantity: string
  pricingQuantity: string
  barrelQuantity: string
  unitPrice: string
  referenceUnitPrice: string
  settlementSurcharge: string
  rebateUnitPrice: string
  lineAmount: string
  settlementTermCode: string
  specialApproval: boolean
  returnDocumentNos?: string[]
  adjustmentEmployeeAmount: string
  adjustmentIntermediaryAmount: string
  adjustmentRebateAmount: string
}

export interface IntermediarySourceBill {
  billLineId: string
  receiptDocumentId: string
  receiptDocumentNo: string
  receiptDate: string
  customer: IntermediaryReference
  salesperson: IntermediaryReference
  billType: 'BANK_ACCEPTANCE' | 'COMMERCIAL_ACCEPTANCE' | 'CHECK' | 'OTHER'
  faceAmount: string
  issueDate: string
  maturityDate: string
  costDays: number
}

export interface IntermediaryCalculationSource {
  periodStart: string
  periodEnd: string
  currency: 'CNY'
  lines: IntermediarySourceLine[]
  bills: IntermediarySourceBill[]
}

export interface IntermediaryScriptSnapshot {
  scriptId: string
  revision: number
  name: string
  source: string
  hash: string
}

export interface IntermediaryResultLine {
  sourceSignoffLineId: string
  premiumUnitPrice: string
  barrelQuantity: string
  baseCommission: string
  premiumCommission: string
  lowPriceCommission: string
  marketMaintenanceSubsidy: string
  marketDevelopmentSubsidy: string
  billCost: string
  billLineIds: string[]
  employeeAmount: string
  intermediaryAmount: string
  rebateAmount: string
  note?: string
}

export interface IntermediarySummary {
  payee: IntermediaryReference
  category: 'COMMISSION' | 'INTERMEDIARY' | 'REBATE'
  amount: string
}

export interface IntermediaryCalculationResult {
  lines: IntermediaryResultLine[]
  summaries: IntermediarySummary[]
}

export interface IntermediaryCalculationInput {
  source: IntermediaryCalculationSource
  sourceHash: string
  script: IntermediaryScriptSnapshot
  result: IntermediaryCalculationResult
}

export interface VoucherAssetLineView {
  lineId: string
  assetId?: string
  assetNo?: string
  assetName: string
  specification?: string
  category?: VoucherReferenceView
  department?: VoucherReferenceView
  custodian?: VoucherReferenceView
  originalValue?: string
  usefulLifeMonths?: number
  residualRate?: string
  location?: string
  accumulatedDepreciation?: string
  netValue?: string
  saleAmount?: string
  reason?: string
  salvageIncome?: string
  disposalExpense?: string
  remark?: string
}

export interface VoucherManagedLineView {
  lineId: string
  lineNo?: number
  sourceLineId?: string
  sourceDocumentId?: string
  sourceDocumentNo?: string
  returnKind?: 'REFUSAL' | 'AFTER_SALE'
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
  parentEntity?: VoucherEntity
  parentDocumentId?: string
  parentDocumentNo?: string
}

export interface VoucherListRow {
  documentId: string
  entity: string
  documentNo: string
  status: VoucherStatus
  revision: number
  businessDate: string
  partyName?: string
  currency: string
  amount: string
  updatedAt: string
  salesSummary?: {
    unit: 'KG'
    excludedPackaging: boolean
    warehouseAvailable: boolean
    shortageQuantity?: string
    orderedQuantity: string
    outboundQuantity: string
    inTransitQuantity: string
    signedQuantity: string
    netSignedQuantity: string
  }
  purchaseSummary?: {
    unit: 'KG'
    excludedPackaging: boolean
    orderedQuantity: string
    inboundQuantity: string
    returnProcessingQuantity: string
    netInboundQuantity: string
  }
}

export interface VoucherListItem extends VoucherListRow {
  entity: VoucherEntity
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

export type VoucherLineKind =
  | 'product'
  | 'price'
  | 'expense'
  | 'inventory-count'
  | 'asset-acquisition'
  | 'asset-sale'
  | 'asset-liquidation'
  | 'bill'
  | 'none'
export interface VoucherLifecycleLabels {
  check: string
  uncheck: string
  approve: string
  unapprove: string
  checked: string
  approved: string
}

export type VoucherLifecycleAction =
  'check' | 'approve' | 'uncheck' | 'unapprove'

export interface VoucherEntityConfig {
  entity: VoucherEntity
  title: string
  icon: string
  order: number
  partyMode: 'customer' | 'supplier' | 'dual' | 'counterparty' | 'none'
  fixedCounterpartyType?: 'customer' | 'supplier' | 'other-party' | 'employee'
  lineKind: VoucherLineKind
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
  productionMode?: 'order' | 'self'
  generatedOnly?: boolean
}

export interface VoucherActionAvailability {
  get: boolean
  save: boolean
  check: boolean
  uncheck: boolean
  approve: boolean
  unapprove: boolean
  delete: boolean
  audit: boolean
  attachmentInitiate: boolean
  attachmentDownload: boolean
  attachmentRemove: boolean
}
import type {
  FormulaMaterialReference,
  ProductFormulaDraft,
} from '@/components/formula'
