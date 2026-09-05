import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Schema } from 'hono'
import {
  vouEntities,
  vouEntityPresentation,
  userCreatableVouEntities,
  vouReferenceCandidateEntities,
  vouSourceLineSourceEntities,
  vouSourceLineTargetEntities,
  type VouPayload,
} from '@zerp/model'

import type { TargetRouteEnvironment } from '../app/contract.ts'

const entityParameter = z.object({ entity: z.enum(vouEntities) })
const identity = z.object({ documentId: z.string().length(26) }).strict()
const referenceCandidateEntity = z.enum(vouReferenceCandidateEntities)
const referenceQuery = z
  .object({
    entity: referenceCandidateEntity,
    keyword: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
const referenceCandidateBase = {
  objectId: z.string(),
  approvalEntryId: z.string().optional(),
  code: z.string(),
  name: z.string(),
}
const referenceCandidate = z.discriminatedUnion('entity', [
  z
    .object({
      ...referenceCandidateBase,
      entity: z.literal('customer-subunit'),
      customerId: z.string().length(26),
      approvalEntryId: z.string().length(26),
    })
    .strict(),
  z
    .object({
      ...referenceCandidateBase,
      entity: referenceCandidateEntity.exclude(['customer-subunit']),
    })
    .strict(),
])
const sourceLineQuery = z
  .object({
    targetEntity: z.enum(vouSourceLineTargetEntities),
    page: z.number().int().positive(),
    pageSize: z.literal(20),
    keyword: z.string().trim().min(1).max(200).optional(),
    sourceDocumentId: z.string().length(26).optional(),
  })
  .strict()
const objectReference = z.object({ objectId: z.string().length(26) }).strict()
// selectionOrigin is the one target-only fact: OpenAPI already owns the IDs,
// while the target must retain whether they were selected now or inherited.
const versionedReference = z
  .object({
    objectId: z.string().length(26),
    approvalEntryId: z.string().length(26),
    selectionOrigin: z.enum(['CURRENT', 'HISTORICAL']),
  })
  .strict()
const decimal = (scale: number) =>
  z.string().regex(new RegExp(`^-?(?:0|[1-9]\\d*)(?:\\.\\d{1,${scale}})?$`))
const money = decimal(2)
const quantity = decimal(6)
const containerCount = z.number().int().min(0).max(2_147_483_647)
const attachment = z
  .object({
    id: z.string().length(26),
    fileName: z.string().min(1).max(255),
    contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    sizeBytes: z.number().int().positive().max(10_485_760),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    stagingId: z.string().length(26),
  })
  .strict()
const basePayload = {
  businessDate: z.string().date(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  remark: z.string().max(1000).optional(),
  attachments: z.array(attachment).max(10),
  parentEntity: z.enum(vouEntities).optional(),
  parentDocumentId: z.string().length(26).optional(),
}
const payload = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object({ ...basePayload, ...shape }).strict()
const quantitySnapshot = z
  .object({
    enteredQuantity: quantity,
    enteredUnit: objectReference,
    baseQuantity: quantity,
  })
  .strict()
const formula = z
  .object({
    output: quantitySnapshot,
    sourceType: z
      .enum(['RAW_SELF', 'PRODUCT_FIXED', 'CUSTOMER_LATEST', 'MANUAL'])
      .optional(),
    sourceDocumentId: z.string().optional(),
    sourceDocumentNo: z.string().optional(),
    components: z
      .array(
        z
          .object({ material: objectReference, quantity: quantitySnapshot })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
const productLine = quantitySnapshot
  .extend({
    lineId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    product: objectReference,
    unitPrice: money,
    settlementSurcharge: money.nullable().optional(),
    purchaseUnitPrice: money.optional(),
    remark: z.string().max(1000).optional(),
    deliverySpecificationType: z.enum(['PACKAGED', 'BULK_LIQUID']).optional(),
    containerType: z.string().nullable().optional(),
    quantityPerContainer: quantity.nullable().optional(),
    formula: formula.nullable().optional(),
  })
  .strict()
const priceLine = z
  .object({
    product: versionedReference,
    unitPrice: money,
    remark: z.string().max(1000).optional(),
  })
  .strict()
const expenseLine = z
  .object({
    category: z.string().min(1).max(200),
    description: z.string().min(1).max(1000),
    amount: money,
    remark: z.string().max(1000).optional(),
  })
  .strict()
const sourceLine = z
  .object({
    sourceLineId: z.string().min(1),
    baseQuantity: quantity,
    remark: z.string().max(1000).optional(),
  })
  .strict()
const returnLine = sourceLine
  .extend({ sourceDocumentId: z.string().length(26) })
  .strict()
const signoffLine = z
  .object({
    sourceLineId: z.string().min(1),
    signedBaseQuantity: quantity,
    rejectedBaseQuantity: quantity,
    remark: z.string().max(1000).optional(),
  })
  .strict()
const inventoryLine = quantitySnapshot
  .extend({ product: objectReference, remark: z.string().max(1000).optional() })
  .strict()
const productionLine = quantitySnapshot
  .extend({
    sourceOrderLineId: z.string().optional(),
    product: objectReference.optional(),
    lossRate: quantity,
    remark: z.string().max(1000).optional(),
    materials: z
      .array(
        z
          .object({
            formulaLineNo: z.number().int().min(1).max(200),
            actualMaterial: objectReference,
            actualEnteredQuantity: quantity,
            actualEnteredUnit: objectReference,
            actualBaseQuantity: quantity,
            adjustmentReason: z.string().max(1000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
const billPrimary = z
  .object({
    positionType: z.literal('ASSET'),
    direction: z.literal('IN'),
    purpose: z.literal('PRIMARY'),
    billType: z.enum([
      'BANK_ACCEPTANCE',
      'COMMERCIAL_ACCEPTANCE',
      'CHECK',
      'OTHER',
    ]),
    billNo: z.string().min(1).max(200),
    medium: z.enum(['PAPER', 'ELECTRONIC']),
    currency: z.string().length(3),
    faceAmount: money,
    issueDate: z.string().date(),
    maturityDate: z.string().date(),
    drawer: z.string().min(1).max(200),
    acceptor: z.string().min(1).max(200),
    payee: z.string().min(1).max(200),
    annualRateBps: z.number().int().min(0).max(100000),
    remark: z.string().max(1000).optional(),
  })
  .strict()
const billLiability = billPrimary
  .extend({ positionType: z.literal('LIABILITY') })
  .strict()
const billLine = z.union([
  billPrimary,
  billLiability,
  z
    .object({
      billId: z.string().min(1),
      purpose: z.literal('CHANGE'),
      remark: z.string().max(1000).optional(),
    })
    .strict(),
  z
    .object({
      billId: z.string().min(1),
      purpose: z.literal('PRIMARY'),
      annualRateBps: z.number().int().min(0).max(100000).optional(),
      remark: z.string().max(1000).optional(),
    })
    .strict(),
])
const billCashLine = z
  .object({
    billLineId: z.string().optional(),
    fundAccount: versionedReference,
    direction: z.enum(['IN', 'OUT']),
    amountType: z.enum(['PRINCIPAL', 'INTEREST', 'FEE', 'MARGIN', 'OTHER']),
    amount: money,
    remark: z.string().max(1000).optional(),
  })
  .strict()
const amountFacts = {
  amount: money,
  fundAccount: versionedReference,
  handler: versionedReference,
}
const intermediaryReference = z
  .object({
    objectId: z.string().min(1),
    approvalEntryId: z.string().min(1),
    entity: z.enum([
      'customer-subunit',
      'employee',
      'sales-partner',
      'other-unit',
      'product',
    ]),
    code: z.string().min(1),
    name: z.string().min(1),
  })
  .strict()
const intermediarySourceLine = z
  .object({
    sourceSignoffLineId: z.string().min(1),
    sourceKind: z.enum(['SALE', 'RETURN_ADJUSTMENT']),
    signoffDocumentId: z.string().min(1),
    signoffDocumentNo: z.string().min(1),
    signoffDate: z.string().date(),
    orderDocumentId: z.string().min(1),
    orderDocumentNo: z.string().min(1),
    orderDate: z.string().date(),
    dueDate: z.string().date(),
    collectionDate: z.string().date(),
    collectionDelayDays: z.number().int().min(0),
    customer: intermediaryReference,
    salesperson: intermediaryReference,
    salesAttributionType: z.enum([
      'INTERNAL_EMPLOYEE',
      'EXTERNAL_PART_TIME',
      'CHANNEL_PARTNER',
    ]),
    salesContractStatus: z.enum(['NOT_REQUIRED', 'MISSING', 'APPLICABLE']),
    salesContract: z
      .object({
        documentId: z.string().min(1),
        revision: z.number().int().min(1),
        applicableFrom: z.string().date(),
        applicableTo: z.string().date().optional(),
        terms: z.string(),
      })
      .strict()
      .optional(),
    intermediary: intermediaryReference.optional(),
    product: intermediaryReference,
    behaviorProfile: z.enum([
      'RAW_MATERIAL',
      'STANDARD_FINISHED',
      'CUSTOM_FINISHED',
      'PACKAGING',
    ]),
    signedBaseQuantity: quantity,
    pricingQuantity: quantity,
    standardPieceQuantity: quantity,
    unitPrice: money,
    referenceUnitPrice: money,
    settlementSurcharge: money,
    lineAmount: money,
    settlementTermCode: z.string(),
    specialApproval: z.boolean(),
    returnDocumentNos: z.array(z.string()).optional(),
    adjustmentEmployeeAmount: money,
    adjustmentIntermediaryAmount: money,
  })
  .strict()
const intermediarySourceBill = z
  .object({
    billLineId: z.string().min(1),
    receiptDocumentId: z.string().min(1),
    receiptDocumentNo: z.string().min(1),
    receiptDate: z.string().date(),
    customer: intermediaryReference,
    billType: z.enum([
      'BANK_ACCEPTANCE',
      'COMMERCIAL_ACCEPTANCE',
      'CHECK',
      'OTHER',
    ]),
    faceAmount: money,
    issueDate: z.string().date(),
    maturityDate: z.string().date(),
    costDays: z.number().int().min(0),
  })
  .strict()
const intermediaryResultLine = z
  .object({
    sourceSignoffLineId: z.string().min(1),
    premiumUnitPrice: money,
    standardPieceQuantity: quantity,
    baseCommission: money,
    premiumCommission: money,
    lowPriceCommission: money,
    marketMaintenanceSubsidy: money,
    marketDevelopmentSubsidy: money,
    billCost: money,
    billLineIds: z.array(z.string()).min(0),
    employeeAmount: money,
    intermediaryAmount: money,
    note: z.string().max(1000).optional(),
  })
  .strict()
const intermediaryCalculation = z
  .object({
    source: z
      .object({
        periodStart: z.string().date(),
        periodEnd: z.string().date(),
        currency: z.literal('CNY'),
        lines: z.array(intermediarySourceLine),
        bills: z.array(intermediarySourceBill),
      })
      .strict(),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    script: z
      .object({
        scriptId: z.string().min(1),
        revision: z.number().int().min(1),
        name: z.string().min(1),
        source: z.string(),
        hash: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    result: z
      .object({
        lines: z.array(intermediaryResultLine),
        summaries: z.array(
          z
            .object({
              payee: intermediaryReference,
              category: z.enum([
                'COMMISSION',
                'EXTERNAL_PART_TIME',
                'CHANNEL_PARTNER',
                'INTERMEDIARY',
              ]),
              amount: money,
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()

export const vouPayloadSchemaByEntity = {
  'sale-pricing': payload({ priceLines: z.array(priceLine).min(1).max(200) }),
  'sale-order': payload({
    customerSubunit: versionedReference,
    operatingEntity: versionedReference,
    salesperson: versionedReference.optional(),
    warehouse: versionedReference,
    productLines: z.array(productLine).min(1).max(200),
    creditOverrideReason: z.string().trim().min(1).max(1000).optional(),
  }),
  'sale-outbound': payload({
    sourceLines: z.array(sourceLine).min(1).max(200),
  }),
  'sale-delivery': payload({
    sourceLines: z.array(sourceLine).min(1).max(200),
    carrier: versionedReference.optional(),
    vehicle: versionedReference.optional(),
  }),
  'sale-signoff': payload({
    customerSubunit: versionedReference,
    expectedSolventContainers: containerCount,
    expectedResinContainers: containerCount,
    returnedSolventContainers: containerCount,
    returnedResinContainers: containerCount,
    containerDifferenceReason: z.string().min(1).max(1000).optional(),
    signoffLines: z.array(signoffLine).min(1).max(200),
  }),
  'sale-return': payload({
    warehouse: versionedReference,
    returnReason: z.string().min(1).max(1000),
    returnLines: z.array(returnLine).min(1).max(200),
  }),
  'purchase-inquiry': payload({
    supplier: versionedReference,
    priceLines: z.array(priceLine).min(1).max(200),
  }),
  'purchase-order': payload({
    supplier: versionedReference,
    purchaser: versionedReference.optional(),
    warehouse: versionedReference,
    productLines: z.array(productLine).min(1).max(200),
  }),
  'purchase-inbound': payload({
    supplier: versionedReference,
    warehouse: versionedReference,
    sourceLines: z.array(sourceLine).min(1).max(200),
  }),
  'purchase-return': payload({
    supplier: versionedReference,
    warehouse: versionedReference,
    returnReason: z.string().min(1).max(1000),
    returnLines: z.array(returnLine).min(1).max(200),
  }),
  'order-production': payload({
    materialWarehouse: versionedReference,
    finishedWarehouse: versionedReference,
    productionLines: z.array(productionLine).min(1).max(200),
  }),
  'self-production': payload({
    materialWarehouse: versionedReference,
    finishedWarehouse: versionedReference,
    productionLines: z.array(productionLine).min(1).max(200),
  }),
  'inventory-count': payload({
    warehouse: versionedReference,
    inventoryCountLines: z.array(inventoryLine).min(1).max(200),
  }),
  'sales-receipt': payload({
    ...amountFacts,
    customer: versionedReference,
    operatingEntity: versionedReference,
    subunitAllocations: z
      .array(z.object({ subunit: versionedReference, amount: money }).strict())
      .min(1)
      .max(200),
  }),
  'purchase-refund': payload({ ...amountFacts, supplier: versionedReference }),
  'other-receipt': payload({
    ...amountFacts,
    counterparty: versionedReference,
    counterpartyType: z.enum([
      'customer-subunit',
      'supplier',
      'other-unit',
      'employee',
      'sales-partner',
    ]),
    otherCategory: z.enum(['COMMISSION', 'INTERMEDIARY']).optional(),
  }),
  'sales-refund': payload({ ...amountFacts, customer: versionedReference }),
  'purchase-payment': payload({ ...amountFacts, supplier: versionedReference }),
  'other-payment': payload({
    ...amountFacts,
    counterparty: versionedReference,
    counterpartyType: z.enum([
      'customer-subunit',
      'supplier',
      'other-unit',
      'employee',
      'sales-partner',
    ]),
    otherCategory: z.enum(['COMMISSION', 'INTERMEDIARY']).optional(),
  }),
  'employee-loan': payload({ ...amountFacts, employee: versionedReference }),
  'employee-repayment': payload({
    ...amountFacts,
    employee: versionedReference,
  }),
  'employee-loan-writeoff': payload({
    employee: versionedReference,
    expenseLines: z.array(expenseLine).min(1).max(200),
  }),
  'expense-reimbursement': payload({
    employee: versionedReference,
    expenseLines: z.array(expenseLine).min(1).max(200),
  }),
  'expense-payment': payload({ ...amountFacts, employee: versionedReference }),
  'other-income': payload({
    ...amountFacts,
    sourceName: z.string().min(1).max(200),
    counterparty: versionedReference.optional(),
    counterpartyType: z.enum(['customer-subunit', 'supplier']).optional(),
  }),
  'asset-acquisition': payload({
    supplier: versionedReference,
    assetAcquisitionLines: z
      .array(
        z
          .object({
            assetName: z.string().min(1).max(200),
            specification: z.string().max(200).optional(),
            category: objectReference,
            originalValue: money,
            usefulLifeMonths: z.number().int().min(1).max(1200),
            residualRate: quantity,
            department: objectReference,
            custodian: versionedReference.optional(),
            location: z.string().max(200).optional(),
            remark: z.string().max(1000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  }),
  'asset-sale': payload({
    counterparty: versionedReference,
    counterpartyType: z.enum(['customer-subunit', 'other-unit']),
    assetSaleLines: z
      .array(
        z
          .object({
            assetId: z.string().min(1),
            saleAmount: money,
            remark: z.string().max(1000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  }),
  'asset-liquidation': payload({
    assetLiquidationLines: z
      .array(
        z
          .object({
            assetId: z.string().min(1),
            reason: z.string().min(1).max(1000),
            salvageIncome: money,
            disposalExpense: money,
            remark: z.string().max(1000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  }),
  'bill-receipt': payload({
    customer: versionedReference,
    handler: versionedReference,
    internalCostRateBps: z.number().int().min(0).max(100000).optional(),
    billLines: z.array(billLine).min(1).max(20),
    billCashLines: z.array(billCashLine).max(20).optional(),
  }),
  'bill-payment': payload({
    supplier: versionedReference,
    handler: versionedReference,
    billLines: z.array(billLine).min(1).max(20),
    billCashLines: z.array(billCashLine).max(20).optional(),
  }),
  'bill-issue': payload({
    supplier: objectReference,
    interestMode: z.enum(['BANK_DEDUCTED', 'THIRD_PARTY_PAYABLE']),
    interestParty: versionedReference.optional(),
    billLines: z.array(billLine).min(1).max(20),
    billCashLines: z.array(billCashLine).max(20).optional(),
  }),
  'bill-discount': payload({
    counterparty: versionedReference,
    counterpartyType: z.literal('other-unit'),
    interestMode: z.enum(['BANK_DEDUCTED', 'THIRD_PARTY_PAYABLE']),
    interestParty: versionedReference.optional(),
    withRecourse: z.boolean().optional(),
    billLines: z.array(billLine).min(1).max(20),
    billCashLines: z.array(billCashLine).max(20).optional(),
  }),
  'bill-maturity': payload({
    maturityType: z.enum(['RECEIPT', 'PAYMENT']),
    billLines: z.array(billLine).min(1).max(20),
    billCashLines: z.array(billCashLine).min(1).max(20),
  }),
  'intermediary-calculation': payload({ intermediaryCalculation }),
  'service-contract': payload({
    counterparty: versionedReference,
    counterpartyType: z.enum(['other-unit', 'sales-partner']),
    employee: versionedReference,
    serviceContract: z
      .object({
        capabilities: z
          .array(z.enum(['EXTERNAL_PART_TIME', 'CHANNEL_PARTNER']))
          .optional(),
        applicableFrom: z.string().date().optional(),
        applicableTo: z.string().date().optional(),
        terms: z.string().max(10000).optional(),
      })
      .strict(),
  }),
  'service-acceptance': payload({
    employee: versionedReference,
    serviceAcceptance: z
      .object({
        contractDocumentId: z.string().min(1),
        serviceDate: z.string().date(),
        acceptanceDate: z.string().date(),
        settlementDirection: z.enum(['PAYABLE', 'RECEIVABLE']),
        fulfillmentFact: z.string().max(10000).optional(),
        acceptanceFact: z.string().max(10000).optional(),
      })
      .strict(),
  }),
} as const

const payloadUnion = z.union(
  Object.values(vouPayloadSchemaByEntity) as unknown as [
    z.ZodType,
    z.ZodType,
    ...z.ZodType[],
  ],
) as z.ZodType<VouPayload>
export const vouSubmitRequestSchema = z
  .object({
    documentId: z.string().length(26),
    submissionId: z.string().length(26),
    idempotencyKey: z.string().min(1).max(128),
    expectedRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .nullable(),
    payload: payloadUnion,
  })
  .strict()
const review = z
  .object({
    documentId: z.string().length(26),
    submissionId: z.string().length(26),
    expectedRevision: z.string().regex(/^[1-9]\d*$/),
  })
  .strict()
const reviewReason = review
  .extend({ reason: z.string().trim().min(1).max(1000) })
  .strict()
const attachmentRead = identity
  .extend({
    submissionId: z.string().length(26),
    fileId: z.string().length(26),
  })
  .strict()
const stage = z
  .object({
    stagingId: z.string().length(26),
    fileId: z.string().length(26),
    fileName: z.string().min(1).max(255),
    mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    size: z.number().int().positive().max(10_485_760),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    contentBase64: z.string().min(1),
  })
  .strict()
const approvalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED'])
const approvalAction = z.enum(['reject', 'approve', 'unreject', 'unapprove'])
const vouView = z
  .object({
    entity: z.enum(vouEntities),
    documentId: z.string().length(26),
    documentNo: z.string().min(1),
    stableRevision: z.string().regex(/^[1-9]\d*$/),
    submissionId: z.string().length(26),
    status: approvalStatus,
    revision: z.string().regex(/^[1-9]\d*$/),
    submittedBy: z.string().length(26),
    submittedAt: z.string().datetime(),
    approvedBy: z.string().length(26).nullable(),
    approvedAt: z.string().datetime().nullable(),
    rejectedBy: z.string().length(26).nullable(),
    rejectedAt: z.string().datetime().nullable(),
    rejectionReason: z.string().nullable(),
    payload: payloadUnion,
    availableApprovalActions: z.array(approvalAction),
    canDelete: z.boolean(),
  })
  .strict()
const auditEvent = z
  .object({
    id: z.string().length(26),
    submissionId: z.string().length(26),
    action: z.enum([
      'SUBMITTED',
      'APPROVED',
      'REJECTED',
      'UNREJECTED',
      'UNAPPROVED',
      'DELETED',
    ]),
    fromStatus: approvalStatus.nullable(),
    toStatus: approvalStatus.nullable(),
    fromRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .nullable(),
    toRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .nullable(),
    actorId: z.string().length(26),
    reason: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict()
const queryFilters = z
  .object({
    keyword: z.string().trim().min(1).max(200).optional(),
    status: z.array(approvalStatus).min(1).max(3).optional(),
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    counterpartyObjectId: z.string().length(26).optional(),
  })
  .strict()
const querySort = z
  .object({
    field: z.enum([
      'updatedAt',
      'documentNo',
      'businessDate',
      'status',
      'amount',
    ]),
    order: z.enum(['asc', 'desc']),
  })
  .strict()
export const vouQueryRequestSchema = z
  .object({
    page: z.number().int().positive(),
    pageSize: z.literal(20),
    filters: queryFilters.optional(),
    sort: z.array(querySort).min(1).max(1).optional(),
  })
  .strict()
const vouPage = z
  .object({
    items: z.array(vouView),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.literal(20),
  })
  .strict()
const deleteResult = z
  .object({
    documentId: z.string().length(26),
    submissionId: z.string().length(26),
    deleted: z.literal(true),
  })
  .strict()
const stageResult = z
  .object({
    stagingId: z.string().length(26),
    fileId: z.string().length(26),
    fileName: z.string().min(1).max(255),
    mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    size: z.number().int().positive().max(10_485_760),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    expiresAt: z.string().datetime(),
  })
  .strict()
const attachmentContent = z
  .object({
    downloadUrl: z.string().url(),
    expiresAt: z.string().datetime(),
  })
  .strict()

export const vouAttachmentDownloadRoute = createRoute({
  method: 'get',
  path: '/vou/attachment-download/{token}',
  request: { params: z.object({ token: z.string().min(40).max(128) }) },
  responses: {
    200: {
      description: 'One-time VOU attachment download',
      content: {
        'application/pdf': {
          schema: z.string().openapi({ format: 'binary' }),
        },
        'image/jpeg': {
          schema: z.string().openapi({ format: 'binary' }),
        },
        'image/png': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
    404: { description: 'Expired or consumed download token' },
  },
})
const failureEnvelope = z
  .object({
    code: z.number().int().min(1),
    errorKey: z.string().min(1),
    message: z.string(),
    data: z.unknown().nullable(),
    requestId: z.string(),
  })
  .strict()
function envelope<Data extends z.ZodType>(data: Data) {
  return z.union([
    z
      .object({
        code: z.literal(0),
        errorKey: z.literal(''),
        message: z.literal('ok'),
        data,
        requestId: z.string(),
      })
      .strict(),
    failureEnvelope,
  ])
}

const sourceLineCandidate = z
  .object({
    sourceDocumentId: z.string().length(26),
    sourceDocumentNo: z.string().min(1),
    sourceEntity: z.enum(vouSourceLineSourceEntities),
    rootDocumentId: z.string().length(26),
    rootEntity: z.enum(['sale-order', 'purchase-order']),
    businessDate: z.string().date(),
    sourceLineId: z.string().min(1),
    product: z
      .object({
        objectId: z.string().length(26),
        code: z.string(),
        name: z.string(),
      })
      .strict(),
    availableBaseQuantity: quantity,
  })
  .strict()

function route<
  Action extends string,
  Request extends z.ZodType,
  Response extends z.ZodType,
>(action: Action, request: Request, response: Response) {
  return createRoute({
    method: 'post',
    path: `/vou/{entity}/${action}`,
    request: {
      params: entityParameter,
      body: { content: { 'application/json': { schema: request } } },
    },
    responses: {
      200: {
        description: `VOU ${action}`,
        content: { 'application/json': { schema: envelope(response) } },
      },
    },
  })
}

export const vouRouteSet = {
  reference: createRoute({
    method: 'post',
    path: '/vou/reference/query',
    request: {
      body: { content: { 'application/json': { schema: referenceQuery } } },
    },
    responses: {
      200: {
        description: 'VOU reference candidates',
        content: {
          'application/json': {
            schema: envelope(
              z.object({
                items: z.array(referenceCandidate),
              }),
            ),
          },
        },
      },
    },
  }),
  'source-line': createRoute({
    method: 'post',
    path: '/vou/source-line/query',
    request: {
      body: { content: { 'application/json': { schema: sourceLineQuery } } },
    },
    responses: {
      200: {
        description: 'VOU eligible source-line candidates',
        content: {
          'application/json': {
            schema: envelope(
              z
                .object({
                  items: z.array(sourceLineCandidate),
                  total: z.number().int().nonnegative(),
                  page: z.number().int().positive(),
                  pageSize: z.literal(20),
                })
                .strict(),
            ),
          },
        },
      },
    },
  }),
  query: route('query', vouQueryRequestSchema, vouPage),
  get: route('get', identity, vouView),
  'audit-history': route('audit-history', identity, z.array(auditEvent)),
  'submit-new': route('submit-new', vouSubmitRequestSchema, vouView),
  'submit-change': route('submit-change', vouSubmitRequestSchema, vouView),
  approve: route('approve', review, vouView),
  reject: route('reject', reviewReason, vouView),
  unreject: route('unreject', review, vouView),
  unapprove: route('unapprove', reviewReason, vouView),
  delete: route('delete', review, deleteResult),
  'attachment-stage': route('attachment-stage', stage, stageResult),
  'attachment-read': route(
    'attachment-read',
    attachmentRead,
    attachmentContent,
  ),
  'attachment-cleanup': route(
    'attachment-cleanup',
    z.object({}).strict(),
    z.number().int().nonnegative(),
  ),
} as const

export const vouRouteMetadata = [
  ...Object.keys(vouRouteSet).map((action) => ({
    method: 'post',
    path:
      action === 'reference'
        ? '/vou/reference/query'
        : action === 'source-line'
          ? '/vou/source-line/query'
          : `/vou/{entity}/${action}`,
    title: `VOU ${action}`,
  })),
  {
    method: 'get',
    path: '/vou/attachment-download/{token}',
    title: 'VOU attachment-download',
  },
]

const publicActions = [
  'query',
  'get',
  'audit-history',
  'approve',
  'reject',
  'unreject',
  'unapprove',
  'delete',
  'attachment-stage',
  'attachment-read',
  'attachment-cleanup',
] as const
export const vouCapabilityPermissionMetadata = [
  { permission: '/vou/reference/query', title: 'VOU reference query' },
  { permission: '/vou/source-line/query', title: 'VOU source-line query' },
  {
    permission: '/vou/sale-order/approve-over-credit-limit',
    title: 'VOU sale-order approve over credit limit',
  },
  ...vouEntities.flatMap((entity) =>
    publicActions.map((action) => ({
      permission: `/vou/${entity}/${action}`,
      title:
        action === 'query'
          ? vouEntityPresentation[entity].label
          : `${entity} ${action}`,
    })),
  ),
  ...userCreatableVouEntities.flatMap((entity) =>
    ['submit-new', 'submit-change'].map((action) => ({
      permission: `/vou/${entity}/${action}`,
      title: `${entity} ${action}`,
    })),
  ),
]

export type VouRouteAction = keyof typeof vouRouteSet | 'attachment-download'
export type VouRouteHandler = (
  action: VouRouteAction,
  context: any,
) => Promise<Response>

export function registerVouRoutes<
  AppSchema extends Schema,
  BasePath extends string,
>(
  app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>,
  handler: VouRouteHandler,
) {
  const reference = app.openapi(
    vouRouteSet.reference,
    (c) => handler('reference', c) as never,
  )
  const sourceLine = reference.openapi(
    vouRouteSet['source-line'],
    (c) => handler('source-line', c) as never,
  )
  const query = sourceLine.openapi(
    vouRouteSet.query,
    (c) => handler('query', c) as never,
  )
  const get = query.openapi(vouRouteSet.get, (c) => handler('get', c) as never)
  const audit = get.openapi(
    vouRouteSet['audit-history'],
    (c) => handler('audit-history', c) as never,
  )
  const submitNew = audit.openapi(
    vouRouteSet['submit-new'],
    (c) => handler('submit-new', c) as never,
  )
  const submitChange = submitNew.openapi(
    vouRouteSet['submit-change'],
    (c) => handler('submit-change', c) as never,
  )
  const approve = submitChange.openapi(
    vouRouteSet.approve,
    (c) => handler('approve', c) as never,
  )
  const reject = approve.openapi(
    vouRouteSet.reject,
    (c) => handler('reject', c) as never,
  )
  const unreject = reject.openapi(
    vouRouteSet.unreject,
    (c) => handler('unreject', c) as never,
  )
  const unapprove = unreject.openapi(
    vouRouteSet.unapprove,
    (c) => handler('unapprove', c) as never,
  )
  const remove = unapprove.openapi(
    vouRouteSet.delete,
    (c) => handler('delete', c) as never,
  )
  const staged = remove.openapi(
    vouRouteSet['attachment-stage'],
    (c) => handler('attachment-stage', c) as never,
  )
  const readable = staged.openapi(
    vouRouteSet['attachment-read'],
    (c) => handler('attachment-read', c) as never,
  )
  const download = readable.openapi(
    vouAttachmentDownloadRoute,
    (c) => handler('attachment-download', c) as never,
  )
  return download.openapi(
    vouRouteSet['attachment-cleanup'],
    (c) => handler('attachment-cleanup', c) as never,
  )
}
