import type {
  VoucherDocumentView,
  VoucherDraftForm,
  VoucherEntityConfig,
  VoucherReference,
  VoucherReferenceInput,
  VoucherReferenceView,
} from '@/components/voucher'
import { localDate } from '@/utils/date'
import { formulaFromPayload, type FormulaPayload } from '@/components/formula'

export interface DraftPayload {
  businessDate: string
  currency?: string
  remark?: string
  returnReason?: string
  customer?: VoucherReferenceInput
  supplier?: VoucherReferenceInput
  counterpartyType?: string
  counterparty?: VoucherReferenceInput
  employee?: VoucherReferenceInput
  salesperson?: VoucherReferenceInput
  purchaser?: VoucherReferenceInput
  handler?: VoucherReferenceInput
  warehouse?: VoucherReferenceInput
  materialWarehouse?: VoucherReferenceInput
  finishedWarehouse?: VoucherReferenceInput
  platform?: VoucherReferenceInput
  vehicle?: VoucherReferenceInput
  fundAccount?: VoucherReferenceInput
  sourceName?: string
  amount?: string
  productLines?: Array<{
    product: VoucherReferenceInput
    orderedQuantity: string
    unitPrice: string
    settlementSurcharge?: string
    purchaseUnitPrice?: string
    remark?: string
    formula?: FormulaPayload
  }>
  priceLines?: Array<{
    product: VoucherReferenceInput
    unitPrice: string
    remark?: string
  }>
  expenseLines?: Array<{
    category: string
    description: string
    amount: string
    remark?: string
  }>
  sourceLines?: Array<{
    sourceLineId: string
    quantity: string
    remark?: string
  }>
  signoffLines?: Array<{
    sourceLineId: string
    signedQuantity: string
    rejectedQuantity: string
    remark?: string
  }>
  returnLines?: Array<{
    sourceLineId: string
    quantity: string
    remark?: string
  }>
  productionLines?: Array<{
    sourceOrderLineId?: string
    product?: VoucherReferenceInput
    outputQuantity: string
    lossRate: string
    remark?: string
    materials: Array<{
      formulaLineNo: number
      actualMaterial: VoucherReferenceInput
      actualQuantity: string
      adjustmentReason?: string
    }>
  }>
}

export function emptyForm(config: VoucherEntityConfig): VoucherDraftForm {
  return {
    businessDate: localDate(),
    currency: config.productionMode ? '' : 'CNY',
    remark: '',
    returnReason: '',
    returnKind: '',
    customer: null,
    supplier: null,
    counterpartyType: config.partyMode === 'counterparty' ? 'customer' : '',
    counterparty: null,
    employee: null,
    salesperson: null,
    purchaser: null,
    handler: null,
    warehouse: null,
    materialWarehouse: null,
    finishedWarehouse: null,
    platform: null,
    vehicle: null,
    fundAccount: null,
    sourceName: '',
    amount: '',
    parentDocumentId: '',
    parentDocumentNo: '',
    productLines:
      config.lineKind === 'product'
        ? [
            {
              key: crypto.randomUUID(),
              product: null,
              orderedQuantity: '',
              unitPrice: '',
              settlementSurcharge: '',
              purchaseUnitPrice: '',
              remark: '',
              formula: null,
            },
          ]
        : [],
    priceLines:
      config.lineKind === 'price'
        ? [
            {
              key: crypto.randomUUID(),
              product: null,
              unitPrice: '',
              remark: '',
            },
          ]
        : [],
    expenseLines:
      config.lineKind === 'expense'
        ? [
            {
              key: crypto.randomUUID(),
              category: '',
              description: '',
              amount: '',
              remark: '',
            },
          ]
        : [],
    salesChainLines: [],
    productionLines: [],
  }
}

export function inputReference(
  reference: VoucherReference | VoucherReferenceView | null | undefined,
): VoucherReferenceInput | undefined {
  return reference
    ? { objectId: reference.objectId, versionId: reference.versionId }
    : undefined
}

function formReference(
  reference: VoucherReferenceView | undefined,
): VoucherReference | null {
  return reference ? { ...reference } : null
}

export function formFromDocument(
  document: VoucherDocumentView,
): VoucherDraftForm {
  const data = document.data
  return {
    businessDate: data.businessDate,
    currency: data.currency,
    remark: data.remark ?? '',
    returnReason: data.returnReason ?? '',
    returnKind: data.returnKind ?? '',
    customer: formReference(data.customer),
    supplier: formReference(data.supplier),
    counterpartyType:
      data.counterparty?.entity === 'supplier'
        ? 'supplier'
        : data.counterparty
          ? 'customer'
          : '',
    counterparty: formReference(data.counterparty),
    employee: formReference(data.employee),
    salesperson: formReference(data.salesperson),
    purchaser: formReference(data.purchaser),
    handler: formReference(data.handler),
    warehouse: formReference(data.warehouse),
    materialWarehouse: formReference(data.materialWarehouse),
    finishedWarehouse: formReference(data.finishedWarehouse),
    platform: formReference(data.platform),
    vehicle: formReference(data.vehicle),
    fundAccount: formReference(data.fundAccount),
    sourceName: data.sourceName ?? '',
    amount: document.amount,
    parentDocumentId: document.parentDocumentId ?? '',
    parentDocumentNo: document.parentDocumentNo ?? '',
    productLines: (data.productLines ?? []).map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      product: formReference(line.product),
      orderedQuantity: line.orderedQuantity,
      unitPrice: line.baseUnitPrice ?? line.unitPrice,
      settlementSurcharge: line.settlementSurcharge ?? '',
      purchaseUnitPrice: line.purchaseUnitPrice ?? '',
      remark: line.remark ?? '',
      formula: formulaFromPayload(line.formula),
      referenceUnitPrice: line.referenceUnitPrice ?? '0.00',
      referenceDocumentId: line.referenceDocumentId,
      referenceDocumentNo: line.referenceDocumentNo,
      referenceBusinessDate: line.referenceBusinessDate,
      priceDirty: false,
    })),
    priceLines: (data.priceLines ?? []).map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      product: formReference(line.product),
      unitPrice: line.unitPrice,
      remark: line.remark ?? '',
    })),
    expenseLines: (data.expenseLines ?? []).map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      category: line.category,
      description: line.description,
      amount: line.amount,
      remark: line.remark ?? '',
    })),
    salesChainLines:
      document.entity === 'sale-signoff'
        ? (data.signoffLines ?? []).map((line) => ({
            key: line.lineId,
            sourceLineId: line.sourceLineId,
            productCode: line.product.code,
            productName: line.product.name,
            productUnit: line.product.unit ?? '',
            availableQuantity: '',
            outboundQuantity: line.outboundQuantity,
            quantity: '',
            signedQuantity: line.signedQuantity,
            rejectedQuantity: line.rejectedQuantity,
            lossQuantity: line.lossQuantity,
            remark: line.remark ?? '',
          }))
        : document.entity === 'sale-outbound'
          ? (data.productLines ?? []).map((line) => ({
              key: line.lineId,
              sourceLineId: line.sourceLineId ?? line.lineId,
              productCode: line.product.code,
              productName: line.product.name,
              productUnit: line.product.unit ?? '',
              availableQuantity: line.quantity ?? line.orderedQuantity,
              outboundQuantity: '',
              quantity: line.quantity ?? line.orderedQuantity,
              signedQuantity: '',
              rejectedQuantity: '',
              lossQuantity: '',
              remark: line.remark ?? '',
            }))
          : document.entity === 'sale-return' ||
              document.entity === 'purchase-return'
            ? (data.lines ?? []).map((line) => ({
                key: line.lineId,
                sourceLineId: line.sourceLineId ?? '',
                productCode: line.product?.code ?? '',
                productName: line.product?.name ?? '',
                productUnit: line.product?.unit ?? '',
                availableQuantity: '',
                outboundQuantity: '',
                quantity: line.quantity ?? '',
                signedQuantity: '',
                rejectedQuantity: '',
                lossQuantity: '',
                remark: line.remark ?? '',
              }))
            : [],
    productionLines: (data.productionLines ?? []).map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      sourceOrderLineId: line.sourceOrderLineId ?? '',
      product: formReference(line.product),
      outputQuantity: line.outputQuantity,
      lossRate: line.lossRate,
      formulaBaseOutputQuantity: line.formulaBaseOutputQuantity,
      remark: line.remark ?? '',
      materials: line.materials.map((material) => ({
        key: material.lineId,
        lineId: material.lineId,
        formulaLineNo: material.lineNo,
        formulaMaterial: { ...material.formulaMaterial },
        formulaQuantity: material.formulaQuantity,
        suggestedQuantity: material.suggestedQuantity,
        actualMaterial: formReference(material.actualMaterial),
        actualQuantity: material.actualQuantity,
        adjustmentReason: material.adjustmentReason ?? '',
      })),
    })),
  }
}

export function snapshot(value: VoucherDraftForm): string {
  return JSON.stringify(value)
}
