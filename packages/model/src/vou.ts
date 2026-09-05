import {
  decideApproval,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalTransitionPlan,
} from './approval.ts'
import type { SubmitAction } from './submission.ts'

export const vouEntities = [
  'sale-pricing',
  'sale-order',
  'sale-outbound',
  'sale-delivery',
  'sale-signoff',
  'sale-return',
  'purchase-order',
  'purchase-inbound',
  'purchase-return',
  'purchase-inquiry',
  'order-production',
  'self-production',
  'inventory-count',
  'sales-receipt',
  'purchase-refund',
  'other-receipt',
  'sales-refund',
  'purchase-payment',
  'other-payment',
  'employee-loan',
  'employee-repayment',
  'employee-loan-writeoff',
  'expense-reimbursement',
  'expense-payment',
  'other-income',
  'asset-acquisition',
  'asset-sale',
  'asset-liquidation',
  'bill-receipt',
  'bill-payment',
  'bill-issue',
  'bill-discount',
  'bill-maturity',
  'intermediary-calculation',
  'service-contract',
  'service-acceptance',
] as const

export type VouEntity = (typeof vouEntities)[number]

export const vouEntityPresentation: Readonly<
  Record<VouEntity, { label: string }>
> = {
  'sale-pricing': { label: '销售定价单' },
  'sale-order': { label: '销售订单' },
  'sale-outbound': { label: '销售出库单' },
  'sale-delivery': { label: '销售送货单' },
  'sale-signoff': { label: '销售签收单' },
  'sale-return': { label: '销售退货单' },
  'purchase-order': { label: '采购订单' },
  'purchase-inbound': { label: '采购入库单' },
  'purchase-return': { label: '采购退货单' },
  'purchase-inquiry': { label: '采购询价单' },
  'order-production': { label: '生产配货单' },
  'self-production': { label: '生产自制品单' },
  'inventory-count': { label: '库存盘点单' },
  'sales-receipt': { label: '销售收款单' },
  'purchase-refund': { label: '采购退款单' },
  'other-receipt': { label: '其他收款单' },
  'sales-refund': { label: '销售退款单' },
  'purchase-payment': { label: '采购付款单' },
  'other-payment': { label: '其他付款单' },
  'employee-loan': { label: '员工借款单' },
  'employee-repayment': { label: '员工还款单' },
  'employee-loan-writeoff': { label: '员工借款核销单' },
  'expense-reimbursement': { label: '费用报销单' },
  'expense-payment': { label: '费用付款单' },
  'other-income': { label: '其他收入单' },
  'asset-acquisition': { label: '资产购置单' },
  'asset-sale': { label: '资产出售单' },
  'asset-liquidation': { label: '资产清理单' },
  'bill-receipt': { label: '收票单' },
  'bill-payment': { label: '付票单' },
  'bill-issue': { label: '开票单' },
  'bill-discount': { label: '票据贴现单' },
  'bill-maturity': { label: '票据到期单' },
  'intermediary-calculation': { label: '居间计算单' },
  'service-contract': { label: '服务合同' },
  'service-acceptance': { label: '履约验收单' },
}

/** Three-letter, domain-authoritative document-number prefixes. */
export const vouDocumentPrefixes: Readonly<Record<VouEntity, string>> = {
  'sale-pricing': 'SPR',
  'sale-order': 'SOR',
  'sale-outbound': 'SOB',
  'sale-delivery': 'SDL',
  'sale-signoff': 'SSF',
  'sale-return': 'SRT',
  'purchase-inquiry': 'PIQ',
  'purchase-order': 'POR',
  'purchase-inbound': 'PIN',
  'purchase-return': 'PRT',
  'order-production': 'MTO',
  'self-production': 'MTS',
  'inventory-count': 'IVC',
  'sales-receipt': 'SRC',
  'sales-refund': 'SRF',
  'purchase-payment': 'PPY',
  'purchase-refund': 'PRF',
  'other-receipt': 'ORC',
  'other-payment': 'OPY',
  'employee-loan': 'ELN',
  'employee-repayment': 'ERP',
  'employee-loan-writeoff': 'ELW',
  'expense-reimbursement': 'EXR',
  'expense-payment': 'EXP',
  'other-income': 'OIN',
  'asset-acquisition': 'ACQ',
  'asset-sale': 'DSL',
  'asset-liquidation': 'LIQ',
  'bill-receipt': 'BRE',
  'bill-payment': 'BLP',
  'bill-issue': 'BLI',
  'bill-discount': 'BLD',
  'bill-maturity': 'BLM',
  'intermediary-calculation': 'ICL',
  'service-contract': 'SCT',
  'service-acceptance': 'SAC',
}

export const systemGeneratedVouEntities = [
  'sale-outbound',
  'sale-delivery',
  'sale-signoff',
  'expense-payment',
] as const satisfies readonly VouEntity[]

const systemGeneratedSet = new Set<VouEntity>(systemGeneratedVouEntities)

export const userCreatableVouEntities = vouEntities.filter(
  (entity) => !systemGeneratedSet.has(entity),
)

export type VouSelectionOrigin = 'CURRENT' | 'HISTORICAL'

/** Exact OpenAPI versioned-reference fields plus the smallest fact needed to
 * distinguish a current selection from a deliberately retained snapshot. */
export interface VouVersionedReferenceInput {
  objectId: string
  approvalEntryId: string
  selectionOrigin: VouSelectionOrigin
}

/** OpenAPI auxiliary/ACC object references never carry Approval versions. */
export interface VouObjectReferenceInput {
  objectId: string
}

export interface VouAttachmentMetadata {
  id: string
  fileName: string
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png'
  sizeBytes: number
  sha256: string
  stagingId: string
}

export interface VouQuantitySnapshotInput {
  enteredQuantity: string
  enteredUnit: VouObjectReferenceInput
  baseQuantity: string
}

export interface VouFormulaInput {
  output: VouQuantitySnapshotInput
  sourceType?: 'RAW_SELF' | 'PRODUCT_FIXED' | 'CUSTOMER_LATEST' | 'MANUAL'
  sourceDocumentId?: string
  sourceDocumentNo?: string
  components: readonly {
    material: VouObjectReferenceInput
    quantity: VouQuantitySnapshotInput
  }[]
}

export interface VouProductLineInput extends VouQuantitySnapshotInput {
  /** Locally allocated immutable line identity, inherited by fulfillment facts. */
  lineId: string
  product: VouObjectReferenceInput
  unitPrice: string
  settlementSurcharge?: string | null
  purchaseUnitPrice?: string
  remark?: string
  deliverySpecificationType?: 'PACKAGED' | 'BULK_LIQUID'
  containerType?: string | null
  quantityPerContainer?: string | null
  formula?: VouFormulaInput | null
}

export interface VouPriceLineInput {
  product: VouVersionedReferenceInput
  unitPrice: string
  remark?: string
}

export interface VouExpenseLineInput {
  category: string
  description: string
  amount: string
  remark?: string
}

export interface VouInventoryCountLineInput extends VouQuantitySnapshotInput {
  product: VouObjectReferenceInput
  remark?: string
}

export interface VouProductionOutputInput extends VouQuantitySnapshotInput {
  sourceOrderLineId?: string
  product?: VouObjectReferenceInput
  lossRate: string
  remark?: string
  materials: readonly {
    formulaLineNo: number
    actualMaterial: VouObjectReferenceInput
    actualEnteredQuantity: string
    actualEnteredUnit: VouObjectReferenceInput
    actualBaseQuantity: string
    adjustmentReason?: string
  }[]
}

export type VouBillLineInput =
  | {
      positionType: 'ASSET'
      direction: 'IN'
      purpose: 'PRIMARY'
      billType: 'BANK_ACCEPTANCE' | 'COMMERCIAL_ACCEPTANCE' | 'CHECK' | 'OTHER'
      billNo: string
      medium: 'PAPER' | 'ELECTRONIC'
      currency: string
      faceAmount: string
      issueDate: string
      maturityDate: string
      drawer: string
      acceptor: string
      payee: string
      annualRateBps: number
      remark?: string
    }
  | { billId: string; purpose: 'CHANGE'; remark?: string }
  | {
      billId: string
      purpose: 'PRIMARY'
      annualRateBps?: number
      remark?: string
    }
  | {
      positionType: 'LIABILITY'
      direction: 'IN'
      purpose: 'PRIMARY'
      billType: 'BANK_ACCEPTANCE' | 'COMMERCIAL_ACCEPTANCE' | 'CHECK' | 'OTHER'
      billNo: string
      medium: 'PAPER' | 'ELECTRONIC'
      currency: string
      faceAmount: string
      issueDate: string
      maturityDate: string
      drawer: string
      acceptor: string
      payee: string
      annualRateBps: number
      remark?: string
    }

export interface VouBillCashLineInput {
  billLineId?: string
  fundAccount: VouVersionedReferenceInput
  direction: 'IN' | 'OUT'
  amountType: 'PRINCIPAL' | 'INTEREST' | 'FEE' | 'MARGIN' | 'OTHER'
  amount: string
  remark?: string
}

export interface VouPayloadBase {
  businessDate: string
  currency: string
  remark?: string
  attachments: readonly VouAttachmentMetadata[]
  parentEntity?: VouEntity
  parentDocumentId?: string
}

type ProductPayload = VouPayloadBase & {
  productLines: readonly VouProductLineInput[]
}
type PricePayload = VouPayloadBase & {
  priceLines: readonly VouPriceLineInput[]
}
type AmountPayload = VouPayloadBase & {
  amount: string
  fundAccount: VouVersionedReferenceInput
  handler: VouVersionedReferenceInput
}
type SourcePayload = VouPayloadBase & {
  sourceLines: readonly {
    sourceLineId: string
    baseQuantity: string
    remark?: string
  }[]
}
type BillPayload = VouPayloadBase & {
  billLines: readonly VouBillLineInput[]
  billCashLines?: readonly VouBillCashLineInput[]
}

export interface VouIntermediaryReference {
  objectId: string
  approvalEntryId: string
  entity:
    'customer-subunit' | 'employee' | 'sales-partner' | 'other-unit' | 'product'
  code: string
  name: string
}

export interface VouIntermediaryCalculationInput {
  source: {
    periodStart: string
    periodEnd: string
    currency: 'CNY'
    lines: readonly {
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
      customer: VouIntermediaryReference
      salesperson: VouIntermediaryReference
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
      intermediary?: VouIntermediaryReference
      product: VouIntermediaryReference
      behaviorProfile:
        'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING'
      signedBaseQuantity: string
      pricingQuantity: string
      standardPieceQuantity: string
      unitPrice: string
      referenceUnitPrice: string
      settlementSurcharge: string
      lineAmount: string
      settlementTermCode: string
      specialApproval: boolean
      returnDocumentNos?: readonly string[]
      adjustmentEmployeeAmount: string
      adjustmentIntermediaryAmount: string
    }[]
    bills: readonly {
      billLineId: string
      receiptDocumentId: string
      receiptDocumentNo: string
      receiptDate: string
      customer: VouIntermediaryReference
      billType: 'BANK_ACCEPTANCE' | 'COMMERCIAL_ACCEPTANCE' | 'CHECK' | 'OTHER'
      faceAmount: string
      issueDate: string
      maturityDate: string
      costDays: number
    }[]
  }
  sourceHash: string
  script: {
    scriptId: string
    revision: number
    name: string
    source: string
    hash: string
  }
  result: {
    lines: readonly {
      sourceSignoffLineId: string
      premiumUnitPrice: string
      standardPieceQuantity: string
      baseCommission: string
      premiumCommission: string
      lowPriceCommission: string
      marketMaintenanceSubsidy: string
      marketDevelopmentSubsidy: string
      billCost: string
      billLineIds: readonly string[]
      employeeAmount: string
      intermediaryAmount: string
      note?: string
    }[]
    summaries: readonly {
      payee: VouIntermediaryReference
      category:
        'COMMISSION' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER' | 'INTERMEDIARY'
      amount: string
    }[]
  }
}

/** The 36 exact write shapes; the route entity discriminates the command. */
export interface VouPayloadShapes {
  'sale-pricing': PricePayload
  'sale-order': ProductPayload & {
    customerSubunit: VouVersionedReferenceInput
    operatingEntity: VouVersionedReferenceInput
    salesperson?: VouVersionedReferenceInput
    warehouse: VouVersionedReferenceInput
    creditOverrideReason?: string
  }
  'sale-outbound': SourcePayload
  'sale-delivery': SourcePayload & {
    carrier?: VouVersionedReferenceInput
    vehicle?: VouVersionedReferenceInput
  }
  'sale-signoff': VouPayloadBase & {
    customerSubunit: VouVersionedReferenceInput
    expectedSolventContainers: number
    expectedResinContainers: number
    returnedSolventContainers: number
    returnedResinContainers: number
    containerDifferenceReason?: string
    signoffLines: readonly {
      sourceLineId: string
      signedBaseQuantity: string
      rejectedBaseQuantity: string
      remark?: string
    }[]
  }
  'sale-return': VouPayloadBase & {
    warehouse: VouVersionedReferenceInput
    returnReason: string
    returnLines: readonly {
      sourceDocumentId: string
      sourceLineId: string
      baseQuantity: string
      remark?: string
    }[]
  }
  'purchase-inquiry': PricePayload & { supplier: VouVersionedReferenceInput }
  'purchase-order': ProductPayload & {
    supplier: VouVersionedReferenceInput
    purchaser?: VouVersionedReferenceInput
    warehouse: VouVersionedReferenceInput
  }
  'purchase-inbound': SourcePayload & {
    supplier: VouVersionedReferenceInput
    warehouse: VouVersionedReferenceInput
  }
  'purchase-return': VouPayloadBase & {
    supplier: VouVersionedReferenceInput
    warehouse: VouVersionedReferenceInput
    returnReason: string
    returnLines: readonly {
      sourceDocumentId: string
      sourceLineId: string
      baseQuantity: string
      remark?: string
    }[]
  }
  'order-production': VouPayloadBase & {
    materialWarehouse: VouVersionedReferenceInput
    finishedWarehouse: VouVersionedReferenceInput
    productionLines: readonly VouProductionOutputInput[]
  }
  'self-production': VouPayloadBase & {
    materialWarehouse: VouVersionedReferenceInput
    finishedWarehouse: VouVersionedReferenceInput
    productionLines: readonly VouProductionOutputInput[]
  }
  'inventory-count': VouPayloadBase & {
    warehouse: VouVersionedReferenceInput
    inventoryCountLines: readonly VouInventoryCountLineInput[]
  }
  'sales-receipt': AmountPayload & {
    customer: VouVersionedReferenceInput
    operatingEntity: VouVersionedReferenceInput
    subunitAllocations: readonly {
      subunit: VouVersionedReferenceInput
      amount: string
    }[]
  }
  'purchase-refund': AmountPayload & { supplier: VouVersionedReferenceInput }
  'other-receipt': AmountPayload & {
    counterparty: VouVersionedReferenceInput
    counterpartyType:
      | 'customer-subunit'
      | 'supplier'
      | 'other-unit'
      | 'employee'
      | 'sales-partner'
    otherCategory?: 'COMMISSION' | 'INTERMEDIARY'
  }
  'sales-refund': AmountPayload & { customer: VouVersionedReferenceInput }
  'purchase-payment': AmountPayload & { supplier: VouVersionedReferenceInput }
  'other-payment': AmountPayload & {
    counterparty: VouVersionedReferenceInput
    counterpartyType:
      | 'customer-subunit'
      | 'supplier'
      | 'other-unit'
      | 'employee'
      | 'sales-partner'
    otherCategory?: 'COMMISSION' | 'INTERMEDIARY'
  }
  'employee-loan': AmountPayload & { employee: VouVersionedReferenceInput }
  'employee-repayment': AmountPayload & { employee: VouVersionedReferenceInput }
  'employee-loan-writeoff': VouPayloadBase & {
    employee: VouVersionedReferenceInput
    expenseLines: readonly VouExpenseLineInput[]
  }
  'expense-reimbursement': VouPayloadBase & {
    employee: VouVersionedReferenceInput
    expenseLines: readonly VouExpenseLineInput[]
  }
  'expense-payment': AmountPayload & { employee: VouVersionedReferenceInput }
  'other-income': AmountPayload & {
    sourceName: string
    counterparty?: VouVersionedReferenceInput
    counterpartyType?: 'customer-subunit' | 'supplier'
  }
  'asset-acquisition': VouPayloadBase & {
    supplier: VouVersionedReferenceInput
    assetAcquisitionLines: readonly {
      assetName: string
      specification?: string
      category: VouObjectReferenceInput
      originalValue: string
      usefulLifeMonths: number
      residualRate: string
      department: VouObjectReferenceInput
      custodian?: VouVersionedReferenceInput
      location?: string
      remark?: string
    }[]
  }
  'asset-sale': VouPayloadBase & {
    counterparty: VouVersionedReferenceInput
    counterpartyType: 'customer-subunit' | 'other-unit'
    assetSaleLines: readonly {
      assetId: string
      saleAmount: string
      remark?: string
    }[]
  }
  'asset-liquidation': VouPayloadBase & {
    assetLiquidationLines: readonly {
      assetId: string
      reason: string
      salvageIncome: string
      disposalExpense: string
      remark?: string
    }[]
  }
  'bill-receipt': BillPayload & {
    customer: VouVersionedReferenceInput
    handler: VouVersionedReferenceInput
    internalCostRateBps?: number
  }
  'bill-payment': BillPayload & {
    supplier: VouVersionedReferenceInput
    handler: VouVersionedReferenceInput
  }
  'bill-issue': BillPayload & {
    supplier: VouObjectReferenceInput
    interestMode: 'BANK_DEDUCTED' | 'THIRD_PARTY_PAYABLE'
    interestParty?: VouVersionedReferenceInput
  }
  'bill-discount': BillPayload & {
    counterparty: VouVersionedReferenceInput
    counterpartyType: 'other-unit'
    interestMode: 'BANK_DEDUCTED' | 'THIRD_PARTY_PAYABLE'
    interestParty?: VouVersionedReferenceInput
    withRecourse?: boolean
  }
  'bill-maturity': BillPayload & {
    maturityType: 'RECEIPT' | 'PAYMENT'
    billCashLines: readonly VouBillCashLineInput[]
  }
  'intermediary-calculation': VouPayloadBase & {
    intermediaryCalculation: VouIntermediaryCalculationInput
  }
  'service-contract': VouPayloadBase & {
    counterparty: VouVersionedReferenceInput
    counterpartyType: 'other-unit' | 'sales-partner'
    employee: VouVersionedReferenceInput
    serviceContract: {
      capabilities?: readonly ('EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER')[]
      applicableFrom?: string
      applicableTo?: string
      terms?: string
    }
  }
  'service-acceptance': VouPayloadBase & {
    employee: VouVersionedReferenceInput
    serviceAcceptance: {
      contractDocumentId: string
      serviceDate: string
      acceptanceDate: string
      settlementDirection: 'PAYABLE' | 'RECEIVABLE'
      fulfillmentFact?: string
      acceptanceFact?: string
    }
  }
}

export type VouPayloadByEntity = {
  [Entity in VouEntity]: { entity: Entity; payload: VouPayloadShapes[Entity] }
}[VouEntity]

export type VouPayloadFor<Entity extends VouEntity> = VouPayloadShapes[Entity]
export type VouPayload = VouPayloadByEntity['payload']

interface VouSubmissionCommandBase {
  action: SubmitAction
  documentId: string
  submissionId: string
  idempotencyKey: string
  expectedRevision: string | null
}

/** Closed discriminated command accepted at the VOU submission seam. */
export type VouSubmissionCommand = VouSubmissionCommandBase & VouPayloadByEntity

export interface VouSubmissionFacts {
  actor: ApprovalActor
  documentExists: boolean
  currentSubmissionId: string | null
  currentRevision: string | null
  referencesValid: boolean
  periodOpen: boolean
  trustedSystemActor: boolean
}

export type VouSubmissionErrorKey =
  | 'approval_invalid_action'
  | 'vou_invalid_command'
  | 'vou_invalid_payload'
  | 'vou_submit_mode_mismatch'
  | 'vou_submission_exists'
  | 'vou_stale_revision'
  | 'vou_reference_unavailable'
  | 'vou_period_locked'
  | 'vou_trusted_actor_required'

export interface VouSubmissionPlan {
  entity: VouEntity
  mode: 'new' | 'change'
  documentId: string
  submissionId: string
  idempotencyKey: string
  status: 'PENDING'
  revision: '1'
  payload: Readonly<VouPayload>
}

export type VouSubmissionDecision =
  | { ok: true; plan: VouSubmissionPlan }
  | { ok: false; errorKey: VouSubmissionErrorKey }

export type VouBlocker = {
  kind:
    | 'DOWNSTREAM_DOCUMENT'
    | 'ACCOUNTING_PERIOD'
    | 'WORKFLOW_ACTION'
    | 'ATTACHMENT'
  id: string
}

export type VouAccountingEffect = {
  kind: 'NONE' | 'POST' | 'REVERSE'
  bookIds: readonly string[]
}

export type VouInventoryEffect = {
  kind: 'NONE' | 'INBOUND' | 'OUTBOUND' | 'COUNT' | 'REVERSE'
  lineCount: number
}

export type VouWorkflowEffect = {
  kind: 'NONE' | 'START_OR_CONTINUE' | 'REVERSE'
}

export interface VouApprovalFacts {
  irreversibleBlockers: readonly VouBlocker[]
  accounting: VouAccountingEffect
  inventory: VouInventoryEffect
  workflow: VouWorkflowEffect
}

export type VouEffectPlan =
  | { domain: 'acc'; plan: VouAccountingEffect }
  | { domain: 'inventory'; plan: VouInventoryEffect }
  | { domain: 'wfl'; plan: VouWorkflowEffect }

export type VouApprovalDecision =
  | {
      ok: true
      plan: {
        approval: ApprovalTransitionPlan
        effects: VouEffectPlan[]
      }
    }
  | {
      ok: false
      errorKey: string
      blockers?: readonly VouBlocker[]
    }

function text(value: string): string {
  return value.trim()
}

export interface VouPayloadReferenceFact {
  /** Stable payload location, e.g. `priceLines[0].product`. */
  field: string
  /** Exact entity the approved reference must belong to. */
  candidateEntity: VouReferenceCandidateEntity
  reference: VouVersionedReferenceInput
}

/**
 * Walks the closed payload tree and collects only exact, known versioned
 * reference shapes. Intermediary calculation snapshots predate
 * `selectionOrigin`; they are immutable historical facts, so their exact
 * approved version is normalized to `HISTORICAL` for the shared validator.
 */
export function vouPayloadReferences(
  payload: VouPayload,
): readonly VouPayloadReferenceFact[] {
  const result: VouPayloadReferenceFact[] = []
  const visit = (value: unknown, path: string, field: string): void => {
    if (isVersionedReference(value)) {
      result.push({
        field: path,
        candidateEntity: versionedReferenceCandidateEntity(
          field,
          path,
          payload,
        ),
        reference: value,
      })
      return
    }
    if (isIntermediaryReference(value)) {
      result.push({
        field: path,
        candidateEntity: value.entity,
        reference: {
          objectId: value.objectId,
          approvalEntryId: value.approvalEntryId,
          selectionOrigin: 'HISTORICAL',
        },
      })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, field))
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value))
      visit(child, path ? `${path}.${key}` : key, key)
  }
  visit(payload, '', '')
  return result
}

function versionedReferenceCandidateEntity(
  field: string,
  path: string,
  payload: VouPayload,
): VouReferenceCandidateEntity {
  if (field === 'counterparty') {
    const counterpartyType = (payload as unknown as Record<string, unknown>)[
      'counterpartyType'
    ]
    if (
      typeof counterpartyType === 'string' &&
      counterpartyCandidates.some((candidate) => candidate === counterpartyType)
    )
      return counterpartyType as VouReferenceCandidateEntity
    throw new Error(
      `Cannot derive VOU reference candidate at ${path}: counterpartyType is required`,
    )
  }
  const candidates =
    headerReferenceCandidates[field] ?? lineReferenceCandidates[field]
  if (candidates?.length === 1) return candidates[0]
  throw new Error(
    `Cannot derive VOU reference candidate at ${path}: field ${field} is not uniquely typed`,
  )
}

function decimal(value: string, scale: number): boolean {
  const match = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(
    value.startsWith('-') ? value.slice(1) : value,
  )
  return match !== null && (match[1]?.length ?? 0) <= scale
}

function isVersionedReference(
  value: unknown,
): value is VouVersionedReferenceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const reference = value as Record<string, unknown>
  return (
    typeof reference.objectId === 'string' &&
    reference.objectId.length === 26 &&
    typeof reference.approvalEntryId === 'string' &&
    reference.approvalEntryId.length === 26 &&
    (reference.selectionOrigin === 'CURRENT' ||
      reference.selectionOrigin === 'HISTORICAL') &&
    Object.keys(reference).every(
      (key) =>
        key === 'objectId' ||
        key === 'approvalEntryId' ||
        key === 'selectionOrigin',
    )
  )
}

function isIntermediaryReference(
  value: unknown,
): value is VouIntermediaryReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const reference = value as Record<string, unknown>
  return (
    typeof reference.objectId === 'string' &&
    typeof reference.approvalEntryId === 'string' &&
    (reference.entity === 'customer-subunit' ||
      reference.entity === 'employee' ||
      reference.entity === 'sales-partner' ||
      reference.entity === 'other-unit' ||
      reference.entity === 'product') &&
    typeof reference.code === 'string' &&
    typeof reference.name === 'string' &&
    Object.keys(reference).every(
      (key) =>
        key === 'objectId' ||
        key === 'approvalEntryId' ||
        key === 'entity' ||
        key === 'code' ||
        key === 'name',
    )
  )
}

function canonicalPayload<Entity extends VouEntity>(
  entity: Entity,
  value: VouPayloadShapes[Entity],
): Readonly<VouPayloadShapes[Entity]> | undefined {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value.businessDate) ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    !Array.isArray(value.attachments)
  )
    return undefined
  const required = payloadRequiredFields[entity]
  if (required.some((field) => !(field in value))) return undefined
  const allowed = new Set([
    ...payloadBaseFields,
    ...payloadAllowedFields[entity],
  ])
  if (!Object.keys(value).every((field) => allowed.has(field))) return undefined
  if (
    'amount' in value &&
    (!decimal(value.amount, 2) || value.amount.startsWith('-'))
  )
    return undefined
  if (
    entity === 'asset-sale' &&
    (value as unknown as Record<string, unknown>).counterpartyType !==
      'customer-subunit' &&
    (value as unknown as Record<string, unknown>).counterpartyType !==
      'other-unit'
  )
    return undefined
  if (
    'productLines' in value &&
    !value.productLines.every(
      (line) =>
        /^[0-9A-HJKMNP-TV-Z]{26}$/.test(line.lineId) &&
        decimal(line.enteredQuantity, 6) &&
        decimal(line.baseQuantity, 6) &&
        decimal(line.unitPrice, 2),
    )
  )
    return undefined
  if (
    'inventoryCountLines' in value &&
    !value.inventoryCountLines.every(
      (line) =>
        decimal(line.enteredQuantity, 6) && decimal(line.baseQuantity, 6),
    )
  )
    return undefined
  if (
    'priceLines' in value &&
    !value.priceLines.every((line) => decimal(line.unitPrice, 2))
  )
    return undefined
  if (
    'expenseLines' in value &&
    !value.expenseLines.every((line) => decimal(line.amount, 2))
  )
    return undefined
  try {
    return Object.freeze(structuredClone(value))
  } catch {
    return undefined
  }
}

const payloadBaseFields = [
  'businessDate',
  'currency',
  'remark',
  'attachments',
  'parentEntity',
  'parentDocumentId',
] as const
const payloadAllowedFields: Readonly<Record<VouEntity, readonly string[]>> = {
  'sale-pricing': ['priceLines'],
  'sale-order': [
    'customerSubunit',
    'operatingEntity',
    'salesperson',
    'warehouse',
    'productLines',
    'creditOverrideReason',
  ],
  'sale-outbound': ['sourceLines'],
  'sale-delivery': ['sourceLines', 'carrier', 'vehicle'],
  'sale-signoff': [
    'customerSubunit',
    'expectedSolventContainers',
    'expectedResinContainers',
    'returnedSolventContainers',
    'returnedResinContainers',
    'containerDifferenceReason',
    'signoffLines',
  ],
  'sale-return': ['warehouse', 'returnReason', 'returnLines'],
  'purchase-inquiry': ['supplier', 'priceLines'],
  'purchase-order': ['supplier', 'purchaser', 'warehouse', 'productLines'],
  'purchase-inbound': ['supplier', 'warehouse', 'sourceLines'],
  'purchase-return': ['supplier', 'warehouse', 'returnReason', 'returnLines'],
  'order-production': [
    'materialWarehouse',
    'finishedWarehouse',
    'productionLines',
  ],
  'self-production': [
    'materialWarehouse',
    'finishedWarehouse',
    'productionLines',
  ],
  'inventory-count': ['warehouse', 'inventoryCountLines'],
  'sales-receipt': [
    'customer',
    'operatingEntity',
    'fundAccount',
    'handler',
    'amount',
    'subunitAllocations',
  ],
  'purchase-refund': ['supplier', 'fundAccount', 'handler', 'amount'],
  'other-receipt': [
    'counterparty',
    'counterpartyType',
    'otherCategory',
    'fundAccount',
    'handler',
    'amount',
  ],
  'sales-refund': ['customer', 'fundAccount', 'handler', 'amount'],
  'purchase-payment': ['supplier', 'fundAccount', 'handler', 'amount'],
  'other-payment': [
    'counterparty',
    'counterpartyType',
    'otherCategory',
    'fundAccount',
    'handler',
    'amount',
  ],
  'employee-loan': ['employee', 'fundAccount', 'handler', 'amount'],
  'employee-repayment': ['employee', 'fundAccount', 'handler', 'amount'],
  'employee-loan-writeoff': ['employee', 'expenseLines'],
  'expense-reimbursement': ['employee', 'expenseLines'],
  'expense-payment': ['employee', 'fundAccount', 'handler', 'amount'],
  'other-income': [
    'sourceName',
    'counterparty',
    'counterpartyType',
    'fundAccount',
    'handler',
    'amount',
  ],
  'asset-acquisition': ['supplier', 'assetAcquisitionLines'],
  'asset-sale': ['counterparty', 'counterpartyType', 'assetSaleLines'],
  'asset-liquidation': ['assetLiquidationLines'],
  'bill-receipt': [
    'customer',
    'handler',
    'internalCostRateBps',
    'billLines',
    'billCashLines',
  ],
  'bill-payment': ['supplier', 'handler', 'billLines', 'billCashLines'],
  'bill-issue': [
    'supplier',
    'interestMode',
    'interestParty',
    'billLines',
    'billCashLines',
  ],
  'bill-discount': [
    'counterparty',
    'counterpartyType',
    'interestMode',
    'interestParty',
    'withRecourse',
    'billLines',
    'billCashLines',
  ],
  'bill-maturity': ['maturityType', 'billLines', 'billCashLines'],
  'intermediary-calculation': ['intermediaryCalculation'],
  'service-contract': [
    'counterparty',
    'counterpartyType',
    'employee',
    'serviceContract',
  ],
  'service-acceptance': ['employee', 'serviceAcceptance'],
}
const payloadRequiredFields: Readonly<Record<VouEntity, readonly string[]>> =
  Object.fromEntries(
    Object.entries(payloadAllowedFields).map(([entity, fields]) => [
      entity,
      fields.filter(
        (field) =>
          !(
            [
              'salesperson',
              'purchaser',
              'carrier',
              'vehicle',
              'otherCategory',
              'internalCostRateBps',
              'interestParty',
              'withRecourse',
              'containerDifferenceReason',
              'creditOverrideReason',
            ].includes(field) ||
            (field === 'billCashLines' && entity !== 'bill-maturity') ||
            ((field === 'counterparty' || field === 'counterpartyType') &&
              entity === 'other-income')
          ),
      ),
    ]),
  ) as unknown as Readonly<Record<VouEntity, readonly string[]>>

export type VouLineKind =
  | 'product'
  | 'price'
  | 'source'
  | 'signoff'
  | 'return'
  | 'production'
  | 'inventory-count'
  | 'subunit-allocation'
  | 'expense'
  | 'asset-acquisition'
  | 'asset-sale'
  | 'asset-liquidation'
  | 'bill'
  | 'bill-cash'
export type VouLineFieldDescriptor = Readonly<{
  key: string
  required: boolean
  reference?: 'versioned' | 'object'
  referenceEntity?: VouReferenceCandidateEntity
  allowedEntities?: readonly VouReferenceCandidateEntity[]
}>

export const vouReferenceCandidateEntities = [
  'customer',
  'supplier',
  'operating-entity',
  'employee',
  'warehouse',
  'customer-subunit',
  'other-unit',
  'vehicle',
  'fund-account',
  'sales-partner',
  'product',
  'service-contract',
  'asset',
  'bill',
  'settlement-method',
  'measurement-unit',
  'asset-category',
  'department',
] as const
export type VouReferenceCandidateEntity =
  (typeof vouReferenceCandidateEntities)[number]

export const vouSourceLineTargetEntities = [
  'sale-return',
  'purchase-inbound',
  'purchase-return',
  'order-production',
] as const satisfies readonly VouEntity[]
export type VouSourceLineTargetEntity =
  (typeof vouSourceLineTargetEntities)[number]

export const vouSourceLineSourceEntities = [
  'sale-signoff',
  'purchase-order',
  'purchase-inbound',
  'sale-order',
] as const satisfies readonly VouEntity[]
export type VouSourceLineSourceEntity =
  (typeof vouSourceLineSourceEntities)[number]

export type VouSourceLineCandidate = Readonly<{
  sourceDocumentId: string
  sourceDocumentNo: string
  sourceEntity: VouSourceLineSourceEntity
  rootDocumentId: string
  rootEntity: 'sale-order' | 'purchase-order'
  businessDate: string
  sourceLineId: string
  product: Readonly<{
    objectId: string
    code: string
    name: string
  }>
  availableBaseQuantity: string
}>
export type VouEntityFieldDescriptor = Readonly<{
  headerReferences: readonly Readonly<{
    key: string
    reference: 'versioned' | 'object'
    required: boolean
    referenceEntity?: VouReferenceCandidateEntity
    allowedEntities?: readonly VouReferenceCandidateEntity[]
  }>[]
  scalars: readonly Readonly<{ key: string; required: boolean }>[]
  collections: readonly Readonly<{ key: string; lineKind: VouLineKind }>[]
}>

const versionedReferenceFields = new Set([
  'customer',
  'customerSubunit',
  'supplier',
  'operatingEntity',
  'salesperson',
  'purchaser',
  'handler',
  'employee',
  'warehouse',
  'materialWarehouse',
  'finishedWarehouse',
  'carrier',
  'vehicle',
  'fundAccount',
  'counterparty',
  'interestParty',
])
const counterpartyCandidates = [
  'customer-subunit',
  'supplier',
  'other-unit',
  'employee',
  'sales-partner',
] as const satisfies readonly VouReferenceCandidateEntity[]
const headerReferenceCandidates: Readonly<
  Record<string, readonly VouReferenceCandidateEntity[]>
> = {
  customer: ['customer'],
  customerSubunit: ['customer-subunit'],
  supplier: ['supplier'],
  operatingEntity: ['operating-entity'],
  salesperson: ['employee'],
  purchaser: ['employee'],
  handler: ['employee'],
  employee: ['employee'],
  warehouse: ['warehouse'],
  materialWarehouse: ['warehouse'],
  finishedWarehouse: ['warehouse'],
  carrier: ['other-unit'],
  vehicle: ['vehicle'],
  fundAccount: ['fund-account'],
  counterparty: counterpartyCandidates,
  interestParty: ['other-unit'],
  settlementMethod: ['settlement-method'],
}

function headerReferenceCandidatesForEntity(
  entity: VouEntity,
  key: string,
): readonly VouReferenceCandidateEntity[] {
  if (key === 'counterparty' && entity === 'bill-discount')
    return ['other-unit']
  if (key === 'counterparty' && entity === 'asset-sale')
    return ['customer-subunit', 'other-unit']
  if (key === 'counterparty' && entity === 'service-contract')
    return ['other-unit', 'sales-partner']
  return headerReferenceCandidates[key] ?? []
}
const lineReferenceCandidates: Readonly<
  Record<string, readonly VouReferenceCandidateEntity[]>
> = {
  product: ['product'],
  enteredUnit: ['measurement-unit'],
  actualMaterial: ['product'],
  actualEnteredUnit: ['measurement-unit'],
  material: ['product'],
  category: ['asset-category'],
  department: ['department'],
  custodian: ['employee'],
  subunit: ['customer-subunit'],
  fundAccount: ['fund-account'],
  assetId: ['asset'],
  billId: ['bill'],
}
const intermediaryReferenceCandidates = [
  'customer-subunit',
  'employee',
  'sales-partner',
  'other-unit',
  'product',
] as const satisfies readonly VouReferenceCandidateEntity[]

function referenceCandidateMetadata(
  key: string,
): Pick<VouLineFieldDescriptor, 'referenceEntity' | 'allowedEntities'> {
  const allowedEntities = lineReferenceCandidates[key] ?? []
  return {
    referenceEntity:
      allowedEntities.length === 1 ? allowedEntities[0] : undefined,
    allowedEntities,
  }
}
const collectionKinds = {
  productLines: 'product',
  priceLines: 'price',
  sourceLines: 'source',
  signoffLines: 'signoff',
  returnLines: 'return',
  productionLines: 'production',
  inventoryCountLines: 'inventory-count',
  subunitAllocations: 'subunit-allocation',
  expenseLines: 'expense',
  assetAcquisitionLines: 'asset-acquisition',
  assetSaleLines: 'asset-sale',
  assetLiquidationLines: 'asset-liquidation',
  billLines: 'bill',
  billCashLines: 'bill-cash',
} as const satisfies Readonly<Record<string, VouLineKind>>

/** Readonly browser form metadata derived from the same field map as validation. */
export const vouEntityFieldDescriptors: Readonly<
  Record<VouEntity, VouEntityFieldDescriptor>
> = Object.fromEntries(
  vouEntities.map((entity) => {
    const required = new Set(payloadRequiredFields[entity])
    const fields = payloadAllowedFields[entity]
    return [
      entity,
      Object.freeze({
        headerReferences: Object.freeze(
          fields
            .filter(
              (key) =>
                versionedReferenceFields.has(key) || key === 'settlementMethod',
            )
            .map((key) => {
              const allowedEntities = headerReferenceCandidatesForEntity(
                entity,
                key,
              )
              return Object.freeze({
                key,
                reference:
                  key === 'settlementMethod' ||
                  (entity === 'bill-issue' && key === 'supplier')
                    ? ('object' as const)
                    : ('versioned' as const),
                required: required.has(key),
                referenceEntity:
                  allowedEntities.length === 1 ? allowedEntities[0] : undefined,
                allowedEntities,
              })
            }),
        ),
        scalars: Object.freeze(
          fields
            .filter(
              (key) =>
                !versionedReferenceFields.has(key) &&
                key !== 'settlementMethod' &&
                !(key in collectionKinds),
            )
            .map((key) => Object.freeze({ key, required: required.has(key) })),
        ),
        collections: Object.freeze(
          fields
            .filter(
              (key): key is keyof typeof collectionKinds =>
                key in collectionKinds,
            )
            .map((key) =>
              Object.freeze({ key, lineKind: collectionKinds[key] }),
            ),
        ),
      }),
    ]
  }),
) as Readonly<Record<VouEntity, VouEntityFieldDescriptor>>

/** Exact inner fields, including which values use versioned or object references. */
export const vouLineFieldDescriptors: Readonly<
  Record<VouLineKind, readonly VouLineFieldDescriptor[]>
> = {
  product: [
    {
      key: 'product',
      required: true,
      reference: 'object',
      ...referenceCandidateMetadata('product'),
    },
    { key: 'enteredQuantity', required: true },
    {
      key: 'enteredUnit',
      required: true,
      reference: 'object',
      ...referenceCandidateMetadata('enteredUnit'),
    },
    { key: 'baseQuantity', required: true },
    { key: 'unitPrice', required: true },
    { key: 'settlementSurcharge', required: false },
    { key: 'purchaseUnitPrice', required: false },
    { key: 'remark', required: false },
    { key: 'deliverySpecificationType', required: false },
    { key: 'containerType', required: false },
    { key: 'quantityPerContainer', required: false },
    { key: 'formula', required: false },
  ],
  price: [
    {
      key: 'product',
      required: true,
      reference: 'versioned',
      ...referenceCandidateMetadata('product'),
    },
    { key: 'unitPrice', required: true },
    { key: 'remark', required: false },
  ],
  source: [
    { key: 'sourceLineId', required: true },
    { key: 'baseQuantity', required: true },
    { key: 'remark', required: false },
  ],
  signoff: [
    { key: 'sourceLineId', required: true },
    { key: 'signedBaseQuantity', required: true },
    { key: 'rejectedBaseQuantity', required: true },
    { key: 'remark', required: false },
  ],
  return: [
    { key: 'sourceDocumentId', required: true },
    { key: 'sourceLineId', required: true },
    { key: 'baseQuantity', required: true },
    { key: 'remark', required: false },
  ],
  production: [
    { key: 'sourceOrderLineId', required: false },
    {
      key: 'product',
      required: false,
      reference: 'object',
      ...referenceCandidateMetadata('product'),
    },
    { key: 'enteredQuantity', required: true },
    {
      key: 'enteredUnit',
      required: true,
      reference: 'object',
      ...referenceCandidateMetadata('enteredUnit'),
    },
    { key: 'baseQuantity', required: true },
    { key: 'lossRate', required: true },
    { key: 'remark', required: false },
    { key: 'materials', required: true },
  ],
  'inventory-count': [
    {
      key: 'product',
      required: true,
      reference: 'object',
      ...referenceCandidateMetadata('product'),
    },
    { key: 'enteredQuantity', required: true },
    {
      key: 'enteredUnit',
      required: true,
      reference: 'object',
      ...referenceCandidateMetadata('enteredUnit'),
    },
    { key: 'baseQuantity', required: true },
    { key: 'remark', required: false },
  ],
  'subunit-allocation': [
    {
      key: 'subunit',
      required: true,
      reference: 'versioned',
      ...referenceCandidateMetadata('subunit'),
    },
    { key: 'amount', required: true },
  ],
  expense: [
    { key: 'category', required: true },
    { key: 'description', required: true },
    { key: 'amount', required: true },
    { key: 'remark', required: false },
  ],
  'asset-acquisition': [
    { key: 'assetName', required: true },
    { key: 'specification', required: false },
    {
      key: 'category',
      required: true,
      reference: 'object',
      ...referenceCandidateMetadata('category'),
    },
    { key: 'originalValue', required: true },
    { key: 'usefulLifeMonths', required: true },
    { key: 'residualRate', required: true },
    {
      key: 'department',
      required: true,
      reference: 'object',
      ...referenceCandidateMetadata('department'),
    },
    {
      key: 'custodian',
      required: false,
      reference: 'versioned',
      ...referenceCandidateMetadata('custodian'),
    },
    { key: 'location', required: false },
    { key: 'remark', required: false },
  ],
  'asset-sale': [
    {
      key: 'assetId',
      required: true,
      ...referenceCandidateMetadata('assetId'),
    },
    { key: 'saleAmount', required: true },
    { key: 'remark', required: false },
  ],
  'asset-liquidation': [
    {
      key: 'assetId',
      required: true,
      ...referenceCandidateMetadata('assetId'),
    },
    { key: 'reason', required: true },
    { key: 'salvageIncome', required: true },
    { key: 'disposalExpense', required: true },
    { key: 'remark', required: false },
  ],
  bill: [
    { key: 'billId', required: false, ...referenceCandidateMetadata('billId') },
    { key: 'positionType', required: false },
    { key: 'direction', required: false },
    { key: 'purpose', required: true },
    { key: 'billType', required: false },
    { key: 'billNo', required: false },
    { key: 'medium', required: false },
    { key: 'currency', required: false },
    { key: 'faceAmount', required: false },
    { key: 'issueDate', required: false },
    { key: 'maturityDate', required: false },
    { key: 'drawer', required: false },
    { key: 'acceptor', required: false },
    { key: 'payee', required: false },
    { key: 'annualRateBps', required: false },
    { key: 'remark', required: false },
  ],
  'bill-cash': [
    { key: 'billLineId', required: false },
    {
      key: 'fundAccount',
      required: true,
      reference: 'versioned',
      ...referenceCandidateMetadata('fundAccount'),
    },
    { key: 'direction', required: true },
    { key: 'amountType', required: true },
    { key: 'amount', required: true },
    { key: 'remark', required: false },
  ],
}

export type VouInputKind =
  | 'text'
  | 'decimal'
  | 'integer'
  | 'date'
  | 'boolean'
  | 'enum'
  | 'object'
  | 'array'

export type VouInputFieldDescriptor = Readonly<{
  key: string
  kind: VouInputKind
  required: boolean
  enumValues?: readonly string[]
  referenceEntity?: VouReferenceCandidateEntity
  allowedEntities?: readonly VouReferenceCandidateEntity[]
  fields?: readonly VouInputFieldDescriptor[]
  item?: readonly VouInputFieldDescriptor[]
  variants?: readonly VouInputVariantDescriptor[]
}>

export type VouInputVariantDescriptor = Readonly<{
  /** Stable, entity-local line shape identifier for a discriminated union. */
  id: string
  discriminators: Readonly<Record<string, string>>
  fields: readonly VouInputFieldDescriptor[]
}>

const selectionFields: readonly VouInputFieldDescriptor[] = Object.freeze([
  { key: 'objectId', kind: 'text', required: true },
  { key: 'approvalEntryId', kind: 'text', required: true },
  {
    key: 'selectionOrigin',
    kind: 'enum',
    required: true,
    enumValues: ['CURRENT', 'HISTORICAL'],
  },
])
const objectReferenceFields: readonly VouInputFieldDescriptor[] = Object.freeze(
  [{ key: 'objectId', kind: 'text', required: true }],
)
const enumValues: Readonly<Record<string, readonly string[]>> = {
  currency: ['CNY'],
  counterpartyType: [
    'customer-subunit',
    'supplier',
    'other-unit',
    'employee',
    'sales-partner',
  ],
  otherCategory: ['COMMISSION', 'INTERMEDIARY'],
  interestMode: ['BANK_DEDUCTED', 'THIRD_PARTY_PAYABLE'],
  maturityType: ['RECEIPT', 'PAYMENT'],
  deliverySpecificationType: ['PACKAGED', 'BULK_LIQUID'],
  sourceType: ['RAW_SELF', 'PRODUCT_FIXED', 'CUSTOMER_LATEST', 'MANUAL'],
  direction: ['IN', 'OUT'],
  amountType: ['PRINCIPAL', 'INTEREST', 'FEE', 'MARGIN', 'OTHER'],
  purpose: ['PRIMARY', 'CHANGE'],
  positionType: ['ASSET', 'LIABILITY'],
  billType: ['BANK_ACCEPTANCE', 'COMMERCIAL_ACCEPTANCE', 'CHECK', 'OTHER'],
  medium: ['PAPER', 'ELECTRONIC'],
  settlementDirection: ['PAYABLE', 'RECEIVABLE'],
  sourceKind: ['SALE', 'RETURN_ADJUSTMENT'],
  salesAttributionType: [
    'INTERNAL_EMPLOYEE',
    'EXTERNAL_PART_TIME',
    'CHANNEL_PARTNER',
  ],
  salesContractStatus: ['NOT_REQUIRED', 'MISSING', 'APPLICABLE'],
  behaviorProfile: [
    'RAW_MATERIAL',
    'STANDARD_FINISHED',
    'CUSTOM_FINISHED',
    'PACKAGING',
  ],
  intermediarySummaryCategory: [
    'COMMISSION',
    'EXTERNAL_PART_TIME',
    'CHANNEL_PARTNER',
    'INTERMEDIARY',
  ],
}
const dateFields = new Set([
  'businessDate',
  'serviceDate',
  'acceptanceDate',
  'applicableFrom',
  'applicableTo',
  'issueDate',
  'maturityDate',
  'periodStart',
  'periodEnd',
  'signoffDate',
  'orderDate',
  'dueDate',
  'collectionDate',
  'receiptDate',
])
const integerFields = new Set([
  'formulaLineNo',
  'annualRateBps',
  'internalCostRateBps',
  'usefulLifeMonths',
  'revision',
  'collectionDelayDays',
  'costDays',
  'expectedSolventContainers',
  'expectedResinContainers',
  'returnedSolventContainers',
  'returnedResinContainers',
])
const decimalFields = new Set([
  'amount',
  'enteredQuantity',
  'baseQuantity',
  'unitPrice',
  'settlementSurcharge',
  'purchaseUnitPrice',
  'quantityPerContainer',
  'lossRate',
  'actualEnteredQuantity',
  'actualBaseQuantity',
  'originalValue',
  'residualRate',
  'saleAmount',
  'salvageIncome',
  'disposalExpense',
  'faceAmount',
  'signedBaseQuantity',
  'pricingQuantity',
  'rejectedBaseQuantity',
  'standardPieceQuantity',
  'referenceUnitPrice',
  'lineAmount',
  'adjustmentEmployeeAmount',
  'adjustmentIntermediaryAmount',
  'premiumUnitPrice',
  'baseCommission',
  'premiumCommission',
  'lowPriceCommission',
  'marketMaintenanceSubsidy',
  'marketDevelopmentSubsidy',
  'billCost',
  'employeeAmount',
  'intermediaryAmount',
])
const booleanFields = new Set(['specialApproval', 'withRecourse'])

function scalarDescriptor(
  key: string,
  required: boolean,
): VouInputFieldDescriptor {
  if (key in enumValues)
    return { key, kind: 'enum', required, enumValues: enumValues[key] }
  if (dateFields.has(key)) return { key, kind: 'date', required }
  if (integerFields.has(key)) return { key, kind: 'integer', required }
  if (decimalFields.has(key)) return { key, kind: 'decimal', required }
  if (booleanFields.has(key)) return { key, kind: 'boolean', required }
  return { key, kind: 'text', required }
}

function fixedEnumDescriptor(
  key: string,
  value: string,
  required = true,
): VouInputFieldDescriptor {
  return { key, kind: 'enum', required, enumValues: [value] }
}

const billIdField = (): VouInputFieldDescriptor => ({
  ...scalarDescriptor('billId', true),
  ...referenceCandidateMetadata('billId'),
})
const billPrimaryFields = (
  positionType: 'ASSET' | 'LIABILITY',
): readonly VouInputFieldDescriptor[] => [
  fixedEnumDescriptor('positionType', positionType),
  fixedEnumDescriptor('direction', 'IN'),
  fixedEnumDescriptor('purpose', 'PRIMARY'),
  scalarDescriptor('billType', true),
  scalarDescriptor('billNo', true),
  scalarDescriptor('medium', true),
  scalarDescriptor('currency', true),
  scalarDescriptor('faceAmount', true),
  scalarDescriptor('issueDate', true),
  scalarDescriptor('maturityDate', true),
  scalarDescriptor('drawer', true),
  scalarDescriptor('acceptor', true),
  scalarDescriptor('payee', true),
  scalarDescriptor('annualRateBps', true),
  scalarDescriptor('remark', false),
]
const billLineVariantsByEntity: Readonly<
  Partial<Record<VouEntity, readonly VouInputVariantDescriptor[]>>
> = {
  'bill-receipt': [
    {
      id: 'asset-primary',
      discriminators: {
        positionType: 'ASSET',
        direction: 'IN',
        purpose: 'PRIMARY',
      },
      fields: billPrimaryFields('ASSET'),
    },
    {
      id: 'change',
      discriminators: { purpose: 'CHANGE' },
      fields: [
        billIdField(),
        fixedEnumDescriptor('purpose', 'CHANGE'),
        scalarDescriptor('remark', false),
      ],
    },
  ],
  'bill-payment': [
    {
      id: 'payment-primary',
      discriminators: { purpose: 'PRIMARY' },
      fields: [
        billIdField(),
        fixedEnumDescriptor('purpose', 'PRIMARY'),
        scalarDescriptor('remark', false),
      ],
    },
  ],
  'bill-issue': [
    {
      id: 'liability-primary',
      discriminators: {
        positionType: 'LIABILITY',
        direction: 'IN',
        purpose: 'PRIMARY',
      },
      fields: billPrimaryFields('LIABILITY'),
    },
  ],
  'bill-discount': [
    {
      id: 'discount-primary',
      discriminators: { purpose: 'PRIMARY' },
      fields: [
        billIdField(),
        fixedEnumDescriptor('purpose', 'PRIMARY'),
        scalarDescriptor('annualRateBps', true),
        scalarDescriptor('remark', false),
      ],
    },
  ],
  'bill-maturity': [
    {
      id: 'maturity-primary',
      discriminators: { purpose: 'PRIMARY' },
      fields: [
        billIdField(),
        fixedEnumDescriptor('purpose', 'PRIMARY'),
        scalarDescriptor('remark', false),
      ],
    },
  ],
}

function intermediaryReferenceDescriptor(
  key: string,
  required: boolean,
  allowedEntities: readonly VouReferenceCandidateEntity[],
): VouInputFieldDescriptor {
  return {
    key,
    kind: 'object',
    required,
    fields: [
      { key: 'objectId', kind: 'text', required: true },
      { key: 'approvalEntryId', kind: 'text', required: true },
      {
        key: 'entity',
        kind: 'enum',
        required: true,
        enumValues: intermediaryReferenceCandidates,
      },
      { key: 'code', kind: 'text', required: true },
      { key: 'name', kind: 'text', required: true },
    ],
    referenceEntity:
      allowedEntities.length === 1 ? allowedEntities[0] : undefined,
    allowedEntities,
  }
}

const quantityFields: readonly VouInputFieldDescriptor[] = Object.freeze([
  { key: 'enteredQuantity', kind: 'decimal', required: true },
  {
    key: 'enteredUnit',
    kind: 'object',
    required: true,
    fields: objectReferenceFields,
    ...referenceCandidateMetadata('enteredUnit'),
  },
  { key: 'baseQuantity', kind: 'decimal', required: true },
])
const formulaFields: readonly VouInputFieldDescriptor[] = Object.freeze([
  { key: 'output', kind: 'object', required: true, fields: quantityFields },
  scalarDescriptor('sourceType', false),
  scalarDescriptor('sourceDocumentId', false),
  scalarDescriptor('sourceDocumentNo', false),
  {
    key: 'components',
    kind: 'array',
    required: true,
    item: [
      {
        key: 'material',
        kind: 'object',
        required: true,
        fields: objectReferenceFields,
        ...referenceCandidateMetadata('material'),
      },
      {
        key: 'quantity',
        kind: 'object',
        required: true,
        fields: quantityFields,
      },
    ],
  },
])
const materialsFields: readonly VouInputFieldDescriptor[] = Object.freeze([
  scalarDescriptor('formulaLineNo', true),
  {
    key: 'actualMaterial',
    kind: 'object',
    required: true,
    fields: objectReferenceFields,
    ...referenceCandidateMetadata('actualMaterial'),
  },
  scalarDescriptor('actualEnteredQuantity', true),
  {
    key: 'actualEnteredUnit',
    kind: 'object',
    required: true,
    fields: objectReferenceFields,
    ...referenceCandidateMetadata('actualEnteredUnit'),
  },
  scalarDescriptor('actualBaseQuantity', true),
  scalarDescriptor('adjustmentReason', false),
])
const intermediarySourceLineFields: readonly VouInputFieldDescriptor[] =
  Object.freeze([
    scalarDescriptor('sourceSignoffLineId', true),
    scalarDescriptor('sourceKind', true),
    scalarDescriptor('signoffDocumentId', true),
    scalarDescriptor('signoffDocumentNo', true),
    scalarDescriptor('signoffDate', true),
    scalarDescriptor('orderDocumentId', true),
    scalarDescriptor('orderDocumentNo', true),
    scalarDescriptor('orderDate', true),
    scalarDescriptor('dueDate', true),
    scalarDescriptor('collectionDate', true),
    scalarDescriptor('collectionDelayDays', true),
    intermediaryReferenceDescriptor('customer', true, ['customer-subunit']),
    intermediaryReferenceDescriptor('salesperson', true, [
      'employee',
      'sales-partner',
    ]),
    scalarDescriptor('salesAttributionType', true),
    scalarDescriptor('salesContractStatus', true),
    {
      key: 'salesContract',
      kind: 'object',
      required: false,
      fields: [
        scalarDescriptor('documentId', true),
        scalarDescriptor('revision', true),
        scalarDescriptor('applicableFrom', true),
        scalarDescriptor('applicableTo', false),
        scalarDescriptor('terms', true),
      ],
    },
    intermediaryReferenceDescriptor('intermediary', false, ['other-unit']),
    intermediaryReferenceDescriptor('product', true, ['product']),
    scalarDescriptor('behaviorProfile', true),
    scalarDescriptor('signedBaseQuantity', true),
    scalarDescriptor('pricingQuantity', true),
    scalarDescriptor('standardPieceQuantity', true),
    scalarDescriptor('unitPrice', true),
    scalarDescriptor('referenceUnitPrice', true),
    scalarDescriptor('settlementSurcharge', true),
    scalarDescriptor('lineAmount', true),
    scalarDescriptor('settlementTermCode', true),
    scalarDescriptor('specialApproval', true),
    { key: 'returnDocumentNos', kind: 'array', required: false, item: [] },
    scalarDescriptor('adjustmentEmployeeAmount', true),
    scalarDescriptor('adjustmentIntermediaryAmount', true),
  ])
const intermediarySourceBillFields: readonly VouInputFieldDescriptor[] =
  Object.freeze([
    scalarDescriptor('billLineId', true),
    scalarDescriptor('receiptDocumentId', true),
    scalarDescriptor('receiptDocumentNo', true),
    scalarDescriptor('receiptDate', true),
    intermediaryReferenceDescriptor('customer', true, ['customer-subunit']),
    scalarDescriptor('billType', true),
    scalarDescriptor('faceAmount', true),
    scalarDescriptor('issueDate', true),
    scalarDescriptor('maturityDate', true),
    scalarDescriptor('costDays', true),
  ])
const intermediaryResultLineFields: readonly VouInputFieldDescriptor[] =
  Object.freeze([
    scalarDescriptor('sourceSignoffLineId', true),
    scalarDescriptor('premiumUnitPrice', true),
    scalarDescriptor('standardPieceQuantity', true),
    scalarDescriptor('baseCommission', true),
    scalarDescriptor('premiumCommission', true),
    scalarDescriptor('lowPriceCommission', true),
    scalarDescriptor('marketMaintenanceSubsidy', true),
    scalarDescriptor('marketDevelopmentSubsidy', true),
    scalarDescriptor('billCost', true),
    { key: 'billLineIds', kind: 'array', required: true, item: [] },
    scalarDescriptor('employeeAmount', true),
    scalarDescriptor('intermediaryAmount', true),
    scalarDescriptor('note', false),
  ])
const intermediarySummaryFields: readonly VouInputFieldDescriptor[] =
  Object.freeze([
    intermediaryReferenceDescriptor('payee', true, [
      'employee',
      'sales-partner',
      'other-unit',
    ]),
    {
      key: 'category',
      kind: 'enum',
      required: true,
      enumValues: [
        'COMMISSION',
        'EXTERNAL_PART_TIME',
        'CHANNEL_PARTNER',
        'INTERMEDIARY',
      ],
    },
    scalarDescriptor('amount', true),
  ])
const nestedObjects: Readonly<
  Record<string, readonly VouInputFieldDescriptor[]>
> = {
  formula: formulaFields,
  materials: materialsFields,
  serviceContract: [
    {
      key: 'capabilities',
      kind: 'array',
      required: false,
      item: [
        {
          key: 'value',
          kind: 'enum',
          required: true,
          enumValues: ['EXTERNAL_PART_TIME', 'CHANNEL_PARTNER'],
        },
      ],
    },
    scalarDescriptor('applicableFrom', false),
    scalarDescriptor('applicableTo', false),
    scalarDescriptor('terms', false),
  ],
  serviceAcceptance: [
    scalarDescriptor('contractDocumentId', true),
    scalarDescriptor('serviceDate', true),
    scalarDescriptor('acceptanceDate', true),
    scalarDescriptor('settlementDirection', true),
    scalarDescriptor('fulfillmentFact', false),
    scalarDescriptor('acceptanceFact', false),
  ],
  intermediaryCalculation: [
    {
      key: 'source',
      kind: 'object',
      required: true,
      fields: [
        scalarDescriptor('periodStart', true),
        scalarDescriptor('periodEnd', true),
        { key: 'currency', kind: 'enum', required: true, enumValues: ['CNY'] },
        {
          key: 'lines',
          kind: 'array',
          required: true,
          item: intermediarySourceLineFields,
        },
        {
          key: 'bills',
          kind: 'array',
          required: true,
          item: intermediarySourceBillFields,
        },
      ],
    },
    scalarDescriptor('sourceHash', true),
    {
      key: 'script',
      kind: 'object',
      required: true,
      fields: [
        scalarDescriptor('scriptId', true),
        scalarDescriptor('revision', true),
        scalarDescriptor('name', true),
        scalarDescriptor('source', true),
        scalarDescriptor('hash', true),
      ],
    },
    {
      key: 'result',
      kind: 'object',
      required: true,
      fields: [
        {
          key: 'lines',
          kind: 'array',
          required: true,
          item: intermediaryResultLineFields,
        },
        {
          key: 'summaries',
          kind: 'array',
          required: true,
          item: intermediarySummaryFields,
        },
      ],
    },
  ],
}

function lineInputFields(
  kind: VouLineKind,
  entity: VouEntity,
): readonly VouInputFieldDescriptor[] {
  const variants =
    kind === 'bill' ? billLineVariantsByEntity[entity] : undefined
  if (variants) return variants[0]?.fields ?? []
  return Object.freeze(
    vouLineFieldDescriptors[kind].map((field): VouInputFieldDescriptor => {
      if (field.reference)
        return {
          key: field.key,
          kind: 'object',
          required: field.required,
          fields:
            field.reference === 'versioned'
              ? selectionFields
              : objectReferenceFields,
          referenceEntity: field.referenceEntity,
          allowedEntities: field.allowedEntities,
        }
      if (field.key in nestedObjects)
        return {
          key: field.key,
          kind: field.key === 'materials' ? 'array' : 'object',
          required: field.required,
          ...(field.key === 'materials'
            ? { item: nestedObjects[field.key] }
            : { fields: nestedObjects[field.key] }),
        }
      const scalar = scalarDescriptor(field.key, field.required)
      return field.allowedEntities
        ? {
            ...scalar,
            referenceEntity: field.referenceEntity,
            allowedEntities: field.allowedEntities,
          }
        : scalar
    }),
  )
}

/** Complete recursive form tree. It is derived from entity and line descriptors, not a third wire schema. */
export const vouEntityInputDescriptors: Readonly<
  Record<VouEntity, readonly VouInputFieldDescriptor[]>
> = Object.fromEntries(
  vouEntities.map((entity) => {
    const descriptor = vouEntityFieldDescriptors[entity]
    const required = new Set(payloadRequiredFields[entity])
    const fields: VouInputFieldDescriptor[] = [
      scalarDescriptor('businessDate', true),
      scalarDescriptor('currency', true),
      scalarDescriptor('remark', false),
      { key: 'attachments', kind: 'array', required: true, item: [] },
      scalarDescriptor('parentEntity', false),
      scalarDescriptor('parentDocumentId', false),
    ]
    for (const reference of descriptor.headerReferences)
      fields.push({
        key: reference.key,
        kind: 'object',
        required: reference.required,
        fields:
          reference.reference === 'versioned'
            ? selectionFields
            : objectReferenceFields,
        referenceEntity: reference.referenceEntity,
        allowedEntities: reference.allowedEntities,
      })
    for (const scalar of descriptor.scalars) {
      if (scalar.key in nestedObjects)
        fields.push({
          key: scalar.key,
          kind: 'object',
          required: scalar.required,
          fields: nestedObjects[scalar.key],
        })
      else if (scalar.key === 'counterpartyType' && entity === 'bill-discount')
        fields.push(fixedEnumDescriptor('counterpartyType', 'other-unit'))
      else if (
        scalar.key === 'counterpartyType' &&
        entity === 'service-contract'
      )
        fields.push({
          key: 'counterpartyType',
          kind: 'enum',
          required: true,
          enumValues: ['other-unit', 'sales-partner'],
        })
      else fields.push(scalarDescriptor(scalar.key, scalar.required))
    }
    for (const collection of descriptor.collections)
      fields.push({
        key: collection.key,
        kind: 'array',
        required: required.has(collection.key),
        item: lineInputFields(collection.lineKind, entity),
        ...(collection.lineKind === 'bill'
          ? { variants: billLineVariantsByEntity[entity] }
          : {}),
      })
    return [entity, Object.freeze(fields)]
  }),
) as Readonly<Record<VouEntity, readonly VouInputFieldDescriptor[]>>

function emptyValue(field: VouInputFieldDescriptor): unknown {
  switch (field.kind) {
    case 'decimal':
      return '0.00'
    case 'integer':
      return 0
    case 'date':
      return '2026-01-01'
    case 'boolean':
      return false
    case 'enum':
      return field.enumValues?.[0] ?? ''
    case 'object':
      return Object.fromEntries(
        (field.fields ?? [])
          .filter((child) => child.required)
          .map((child) => [child.key, emptyValue(child)]),
      )
    case 'array':
      return field.required && (field.item?.length ?? 0) > 0
        ? [
            Object.fromEntries(
              (field.item ?? [])
                .filter((child) => child.required)
                .map((child) => [child.key, emptyValue(child)]),
            ),
          ]
        : []
    default:
      return ''
  }
}

/** Creates a structurally complete local Draft; callers replace empty selections/text before submit. */
export function createVouDraftPayload<Entity extends VouEntity>(
  entity: Entity,
  lineIdFactory: () => string = () => '',
): VouPayloadFor<Entity> {
  const draft = Object.fromEntries(
    vouEntityInputDescriptors[entity]
      .filter((field) => field.required)
      .map((field) => [field.key, emptyValue(field)]),
  ) as unknown as VouPayloadFor<Entity>
  if ('productLines' in draft)
    return {
      ...draft,
      productLines: draft.productLines.map((line) => ({
        ...line,
        lineId: lineIdFactory(),
      })),
    } as VouPayloadFor<Entity>
  return draft
}

/**
 * Decides the persistence plan for a browser-local or trusted system VOU.
 * It intentionally contains no I/O and persists no server-side Draft state.
 */
export function prepareVouSubmission(
  command: VouSubmissionCommand,
  facts: VouSubmissionFacts,
): VouSubmissionDecision {
  const mode = facts.documentExists ? 'change' : 'new'
  if (command.action !== `submit-${mode}`)
    return { ok: false, errorKey: 'vou_submit_mode_mismatch' }
  if (
    !text(command.documentId) ||
    !text(command.submissionId) ||
    !text(command.idempotencyKey) ||
    command.submissionId !== command.idempotencyKey
  )
    return { ok: false, errorKey: 'vou_invalid_command' }
  if (
    systemGeneratedSet.has(command.entity) &&
    facts.trustedSystemActor !== true
  )
    return { ok: false, errorKey: 'vou_trusted_actor_required' }
  if (
    facts.actor.trusted !== true &&
    facts.trustedSystemActor !== true &&
    !facts.actor.permissions.includes(
      `/vou/${command.entity}/${command.action}`,
    )
  )
    return { ok: false, errorKey: 'approval_invalid_action' }
  if (facts.currentSubmissionId !== null)
    return { ok: false, errorKey: 'vou_submission_exists' }
  if (
    (mode === 'new' &&
      (command.expectedRevision !== null || facts.currentRevision !== null)) ||
    (mode === 'change' &&
      (command.expectedRevision === null ||
        command.expectedRevision !== facts.currentRevision))
  )
    return { ok: false, errorKey: 'vou_stale_revision' }
  if (!facts.referencesValid)
    return { ok: false, errorKey: 'vou_reference_unavailable' }
  if (!facts.periodOpen) return { ok: false, errorKey: 'vou_period_locked' }
  const payload = canonicalPayload(command.entity, command.payload)
  if (!payload) return { ok: false, errorKey: 'vou_invalid_payload' }

  return {
    ok: true,
    plan: {
      entity: command.entity,
      mode,
      documentId: text(command.documentId),
      submissionId: text(command.submissionId),
      idempotencyKey: text(command.idempotencyKey),
      status: 'PENDING',
      revision: '1',
      payload,
    },
  }
}

function effectPlans(facts: VouApprovalFacts): VouEffectPlan[] {
  const effects: VouEffectPlan[] = []
  if (facts.accounting.kind !== 'NONE')
    effects.push({ domain: 'acc', plan: facts.accounting })
  if (facts.inventory.kind !== 'NONE')
    effects.push({ domain: 'inventory', plan: facts.inventory })
  if (facts.workflow.kind !== 'NONE')
    effects.push({ domain: 'wfl', plan: facts.workflow })
  return effects
}

/** Returns one Approval transition and its domain-specific transactional plans. */
export function prepareVouApproval(
  action: ApprovalAction,
  entry: ApprovalEntry,
  actor: ApprovalActor,
  facts: VouApprovalFacts,
  reason: string | undefined,
  occurrence: { occurredAt: string; requestId: string },
): VouApprovalDecision {
  if (action === 'unapprove' && facts.irreversibleBlockers.length > 0)
    return {
      ok: false,
      errorKey: 'vou_unapprove_blocked',
      blockers: facts.irreversibleBlockers,
    }
  const approval = decideApproval({
    action,
    entry,
    actor,
    expectedRevision: entry.revision,
    occurredAt: occurrence.occurredAt,
    requestId: occurrence.requestId,
    ...(reason === undefined ? {} : { reason }),
  })
  if (!approval.ok) return { ok: false, errorKey: approval.error.errorKey }
  return {
    ok: true,
    plan: {
      approval: approval.plan,
      effects:
        action === 'approve' || action === 'unapprove'
          ? effectPlans(facts)
          : [],
    },
  }
}
