import type { components } from '@/api/generated/schema'

export type VoucherEntity = components['schemas']['VouEntity']

export type VoucherStatus = components['schemas']['ApprovalStatus']

export interface VoucherReferenceInput {
  objectId: string
  approvalEntryId: string
}

export interface VoucherReference extends VoucherReferenceInput {
  entity: string
  code: string
  name: string
  unit?: string
  currency?: string
  plateNumber?: string
  carrierAffiliation?: {
    type: 'INTERNAL' | 'EXTERNAL'
    operatingEntityId?: string
    serviceRelationshipObjectId?: string
  }
  bulkLiquidCapable?: boolean
  behaviorProfile?: ProductBehaviorProfile
  defaultInputUnitId?: string
  pricingUnitId?: string
  unitConversions?: VoucherUnitConversion[]
}

export type ProductBehaviorProfile =
  'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING'

export interface VoucherUnitSnapshot {
  objectId: string
  approvalEntryId?: string
  code?: string
  name?: string
  symbol?: string
}

export interface VoucherUnitConversion {
  unit: VoucherUnitSnapshot
  factor: string
}

export interface VoucherProductLineDraft {
  key: string
  lineId?: string
  product: VoucherReference | null
  enteredQuantity: string
  enteredUnit: VoucherUnitSnapshot | null
  baseQuantity: string
  unitPrice: string
  settlementSurcharge: string
  purchaseUnitPrice: string
  deliverySpecificationType: 'PACKAGED' | 'BULK_LIQUID'
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
  enteredQuantity: string
  enteredUnit: VoucherUnitSnapshot | null
  baseQuantity: string
  bookBaseQuantity?: string
  differenceBaseQuantity?: string
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
  enteredUnitSymbol: string
  availableBaseQuantity: string
  outboundBaseQuantity: string
  baseQuantity: string
  signedBaseQuantity: string
  rejectedBaseQuantity: string
  lossBaseQuantity: string
  remark: string
}

export interface VoucherProductionMaterialDraft {
  key: string
  lineId?: string
  formulaLineNo: number
  formulaMaterial: VoucherReference
  formulaBaseQuantity: string
  suggestedBaseQuantity: string
  actualMaterial: VoucherReference | null
  actualEnteredQuantity: string
  actualEnteredUnit: VoucherUnitSnapshot | null
  actualBaseQuantity: string
  adjustmentReason: string
}

export interface VoucherProductionOutputDraft {
  key: string
  lineId?: string
  sourceOrderLineId: string
  product: VoucherReference | null
  enteredQuantity: string
  enteredUnit: VoucherUnitSnapshot | null
  baseQuantity: string
  lossRate: string
  formulaBaseQuantity: string
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
  counterpartyType:
    '' | 'customer' | 'supplier' | 'other-unit' | 'employee' | 'sales-partner'
  counterparty: VoucherReference | null
  settlementMethod: VoucherReference | null
  otherCategory: '' | 'COMMISSION' | 'INTERMEDIARY' | 'REBATE'
  employee: VoucherReference | null
  salesperson: VoucherReference | null
  purchaser: VoucherReference | null
  handler: VoucherReference | null
  warehouse: VoucherReference | null
  materialWarehouse: VoucherReference | null
  finishedWarehouse: VoucherReference | null
  carrier: VoucherReference | null
  vehicle: VoucherReference | null
  fundAccount: VoucherReference | null
  sourceName: string
  amount: string
  serviceContract: {
    capabilities: Array<'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER'>
    applicableFrom: string
    applicableTo: string
    terms: string
  }
  serviceAcceptance: {
    contractDocumentId: string
    serviceDate: string
    acceptanceDate: string
    settlementDirection: '' | 'PAYABLE' | 'RECEIVABLE'
    fulfillmentFact: string
    acceptanceFact: string
  }
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

export type VoucherReferenceView = components['schemas']['VouReferenceView']

export type VoucherProductLineView = components['schemas']['VouProductLineView']

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
  enteredQuantity: string
  enteredUnit: VoucherUnitSnapshot
  baseQuantity: string
  outboundBaseQuantity: string
  signedBaseQuantity: string
  rejectedBaseQuantity: string
  lossBaseQuantity: string
  unitPrice: string
  lineAmount: string
  remark?: string
  returnableBaseQuantity?: string
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
  enteredQuantity: string
  enteredUnit: VoucherUnitSnapshot
  baseQuantity: string
  bookBaseQuantity?: string
  differenceBaseQuantity?: string
  remark?: string
}

export interface VoucherProductionMaterialView {
  lineId: string
  lineNo: number
  formulaMaterial: VoucherReferenceView
  formulaBaseQuantity: string
  suggestedBaseQuantity: string
  actualMaterial: VoucherReferenceView
  actualEnteredQuantity: string
  actualEnteredUnit: VoucherUnitSnapshot
  actualBaseQuantity: string
  adjustmentReason?: string
}

export interface VoucherProductionOutputView {
  lineId: string
  lineNo: number
  sourceOrderLineId?: string
  product: VoucherReferenceView
  enteredQuantity: string
  enteredUnit: VoucherUnitSnapshot
  baseQuantity: string
  lossRate: string
  formulaBaseQuantity: string
  remark?: string
  materials: VoucherProductionMaterialView[]
}

export interface SettlementMethodSnapshot {
  objectId: string
  approvalEntryId: string
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

export type VoucherAttachment = components['schemas']['VouAttachmentView']

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
  serviceContract?: {
    counterparty: VoucherReferenceView
    partyId: string
    partyName: string
    operatingEntity: VoucherReferenceView
    handler: VoucherReferenceView
    settlementMethod?: SettlementMethodSnapshot
    capabilities?: Array<'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER'>
    applicableFrom?: string
    applicableTo?: string
    terms?: string
  }
  serviceAcceptance?: {
    contractDocumentId: string
    serviceDate: string
    acceptanceDate: string
    settlementDirection: 'PAYABLE' | 'RECEIVABLE'
    fulfillmentFact?: string
    acceptanceFact?: string
  }
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
  carrierType?: 'INTERNAL' | 'EXTERNAL'
  carrierOperatingEntity?: VoucherReferenceView
  carrier?: VoucherReferenceView
  vehicle?: VoucherReferenceView
  vehicleBulkLiquidCapable?: boolean
  differenceReason?: string
  signoffLines?: VoucherSaleSignoffLineView[]
  fulfillmentStatus?: 'OPEN' | 'FULFILLED'
  signedBaseQuantity?: string
  inTransitBaseQuantity?: string
  remainingBaseQuantity?: string
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
  approvalEntryId: string
  entity:
    'customer-account' | 'employee' | 'sales-partner' | 'other-unit' | 'product'
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
  salesAttributionType:
    'INTERNAL_EMPLOYEE' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER'
  salesContractStatus: 'NOT_REQUIRED' | 'MISSING' | 'APPLICABLE'
  salesContract?: {
    documentId: string
    revision: number
    applicableFrom: string
    applicableTo?: string
    terms: string
  }
  intermediary?: IntermediaryReference
  product: IntermediaryReference
  behaviorProfile: ProductBehaviorProfile
  signedBaseQuantity: string
  pricingQuantity: string
  standardPieceQuantity: string
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
  standardPieceQuantity: string
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
  category:
    | 'COMMISSION'
    | 'EXTERNAL_PART_TIME'
    | 'CHANNEL_PARTNER'
    | 'INTERMEDIARY'
    | 'REBATE'
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
  enteredQuantity?: string
  enteredUnit?: VoucherUnitSnapshot
  baseQuantity?: string
  signedBaseQuantity?: string
  rejectedBaseQuantity?: string
  lossBaseQuantity?: string
  unitPrice?: string
  lineAmount?: string
  remark?: string
}

export type VoucherDocumentView = components['schemas']['VouDocumentView']

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
    warehouseAvailable: boolean
    shortageQuantity?: string
    orderedBaseQuantity: string
    outboundBaseQuantity: string
    inTransitBaseQuantity: string
    signedBaseQuantity: string
    netSignedBaseQuantity: string
  }
  purchaseSummary?: {
    orderedBaseQuantity: string
    inboundBaseQuantity: string
    returnProcessingBaseQuantity: string
    netInboundBaseQuantity: string
  }
}

export interface VoucherListItem extends VoucherListRow {
  entity: VoucherEntity
}

export type VoucherMutationResult = components['schemas']['VouMutationResult']

export type VoucherAuditEvent = components['schemas']['ApprovalEventView']

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
  submit: string
  unsubmit: string
  approve: string
  unapprove: string
  pending: string
  approved: string
}

export type VoucherLifecycleAction =
  'submit' | 'approve' | 'unsubmit' | 'unapprove'

export interface VoucherEntityConfig {
  entity: VoucherEntity
  title: string
  icon: string
  order: number
  partyMode: 'customer' | 'supplier' | 'dual' | 'counterparty' | 'none'
  fixedCounterpartyType?:
    'customer' | 'supplier' | 'other-unit' | 'employee' | 'sales-partner'
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
  submit: boolean
  unsubmit: boolean
  approve: boolean
  unapprove: boolean
  delete: boolean
  audit: boolean
  attachmentInitiate: boolean
  attachmentDownload: boolean
  attachmentRemove: boolean
}
import type { ProductFormulaDraft } from '@/components/formula'
