import type {
  VoucherAuxiliaryReference,
  VoucherDocumentView,
  VoucherDraftForm,
  VoucherEntityConfig,
  VoucherReference,
  VoucherReferenceInput,
  VoucherReferenceView,
} from '@/components/voucher'
import type { components } from '@/api/generated/schema'
import { localDate } from '@/utils/date'
import { formulaFromPayload } from '@/components/formula'
import { emptyServiceDetails, serviceDetailsFromDocument } from './service-form'
export type { DraftPayload } from './draft-payload'

export function emptyForm(config: VoucherEntityConfig): VoucherDraftForm {
  return {
    businessDate: localDate(),
    currency: config.productionMode ? '' : 'CNY',
    remark: '',
    specialApproval: false,
    intermediaryCalculation: null,
    returnReason: '',
    returnKind: '',
    customer: null,
    operatingEntity: null,
    supplier: null,
    counterpartyType:
      config.partyMode === 'counterparty'
        ? (config.fixedCounterpartyType ?? 'customer')
        : '',
    counterparty: null,
    settlementMethod: null,
    otherCategory: '',
    employee: null,
    salesperson: null,
    purchaser: null,
    handler: null,
    warehouse: null,
    materialWarehouse: null,
    finishedWarehouse: null,
    carrier: null,
    vehicle: null,
    fundAccount: null,
    sourceName: '',
    amount: '',
    accountAllocations: [],
    ...emptyServiceDetails(),
    parentDocumentId: '',
    parentDocumentNo: '',
    productLines:
      config.lineKind === 'product'
        ? [
            {
              key: crypto.randomUUID(),
              product: null,
              enteredQuantity: '',
              enteredUnit: null,
              baseQuantity: '',
              unitPrice: '',
              settlementSurcharge: '',
              purchaseUnitPrice: '',
              deliverySpecificationType: 'PACKAGED',
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
    assetLines: config.lineKind.startsWith('asset-')
      ? config.lineKind === 'asset-acquisition'
        ? [emptyAssetLine()]
        : []
      : [],
    salesChainLines: [],
    productionLines: [],
    inventoryCountLines:
      config.lineKind === 'inventory-count'
        ? [
            {
              key: crypto.randomUUID(),
              product: null,
              enteredQuantity: '',
              enteredUnit: null,
              baseQuantity: '',
              remark: '',
            },
          ]
        : [],
  }
}

export function emptyAssetLine() {
  return {
    key: crypto.randomUUID(),
    lineId: undefined,
    assetId: '',
    assetNo: '',
    assetName: '',
    specification: '',
    category: null,
    department: null,
    custodian: null,
    originalValue: '',
    usefulLifeMonths: '',
    residualRate: '',
    location: '',
    accumulatedDepreciation: '',
    netValue: '',
    saleAmount: '',
    reason: '',
    salvageIncome: '0.00',
    disposalExpense: '0.00',
    remark: '',
  }
}

export function inputReference(
  reference: VoucherReference | VoucherReferenceView | null | undefined,
): VoucherReferenceInput | undefined {
  return reference
    ? {
        objectId: reference.objectId,
        approvalEntryId: reference.approvalEntryId,
      }
    : undefined
}

export function inputAuxiliaryReference(
  reference: { objectId: string } | null | undefined,
): { objectId: string } | undefined {
  return reference ? { objectId: reference.objectId } : undefined
}

export function inputProductReference(
  reference: VoucherReference | VoucherReferenceView | null | undefined,
): { objectId: string } | undefined {
  return reference ? { objectId: reference.objectId } : undefined
}

function formReference(
  reference: VoucherReferenceView | undefined,
): VoucherReference | null {
  return reference ? { ...reference } : null
}

function formAuxiliaryReference(
  reference: components['schemas']['VouAuxiliaryReferenceView'] | undefined,
): VoucherAuxiliaryReference | null {
  return reference ? { ...reference } : null
}

function formCounterpartyType(
  reference: VoucherReferenceView | undefined,
): VoucherDraftForm['counterpartyType'] {
  switch (reference?.entity) {
    case 'customer-account':
      return 'customer'
    case 'customer':
    case 'supplier':
    case 'other-unit':
    case 'employee':
    case 'sales-partner':
      return reference.entity
    default:
      return ''
  }
}

export function formFromDocument(
  document: VoucherDocumentView,
): VoucherDraftForm {
  const data = document.data
  return {
    businessDate: data.businessDate,
    currency: data.currency,
    remark: data.remark ?? '',
    specialApproval: data.specialApproval ?? false,
    intermediaryCalculation: data.intermediaryCalculation ?? null,
    returnReason: data.returnReason ?? '',
    returnKind: data.returnKind ?? '',
    customer: formReference(data.customer),
    operatingEntity: formReference(data.operatingEntity),
    supplier: formReference(data.supplier),
    counterpartyType: formCounterpartyType(data.counterparty),
    counterparty: formReference(data.counterparty),
    settlementMethod: data.settlementMethod
      ? { ...data.settlementMethod, entity: 'settlement-method' }
      : null,
    otherCategory: data.otherCategory ?? '',
    employee: formReference(data.employee),
    salesperson: formReference(data.salesperson),
    purchaser: formReference(data.purchaser),
    handler: formReference(data.handler),
    warehouse: formReference(data.warehouse),
    materialWarehouse: formReference(data.materialWarehouse),
    finishedWarehouse: formReference(data.finishedWarehouse),
    carrier: formReference(data.carrier),
    vehicle: data.vehicle
      ? {
          ...formReference(data.vehicle)!,
          ...(data.carrierType
            ? {
                carrierAffiliation:
                  data.carrierType === 'INTERNAL'
                    ? {
                        type: 'INTERNAL' as const,
                        operatingEntityId:
                          data.carrierOperatingEntity?.objectId,
                      }
                    : {
                        type: 'EXTERNAL' as const,
                        otherUnitObjectId: data.carrier?.objectId,
                      },
              }
            : {}),
          bulkLiquidCapable: data.vehicleBulkLiquidCapable ?? false,
        }
      : null,
    fundAccount: formReference(data.fundAccount),
    sourceName: data.sourceName ?? '',
    amount: document.amount,
    accountAllocations: (data.accountAllocations ?? []).map((line) => ({
      key: crypto.randomUUID(),
      account: formReference(line.account),
      amount: line.amount,
    })),
    ...serviceDetailsFromDocument(data),
    parentDocumentId: document.parentDocumentId ?? '',
    parentDocumentNo: document.parentDocumentNo ?? '',
    productLines: (data.productLines ?? []).map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      product: formReference(line.product),
      enteredQuantity: line.enteredQuantity,
      enteredUnit: { ...line.enteredUnit },
      baseQuantity: line.baseQuantity,
      unitPrice: line.baseUnitPrice ?? line.unitPrice,
      settlementSurcharge: line.settlementSurcharge ?? '',
      purchaseUnitPrice: line.purchaseUnitPrice ?? '',
      deliverySpecificationType: line.deliverySpecificationType ?? 'PACKAGED',
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
    assetLines: [
      ...(data.assetAcquisitionLines ?? []),
      ...(data.assetSaleLines ?? []),
      ...(data.assetLiquidationLines ?? []),
    ].map((line) => ({
      ...emptyAssetLine(),
      key: line.lineId,
      lineId: line.lineId,
      assetId: line.assetId ?? '',
      assetNo: line.assetNo ?? '',
      assetName: line.assetName,
      specification: line.specification ?? '',
      category: formAuxiliaryReference(line.category),
      department: formAuxiliaryReference(line.department),
      custodian: formReference(line.custodian),
      originalValue: line.originalValue ?? '',
      usefulLifeMonths: String(line.usefulLifeMonths ?? ''),
      residualRate: line.residualRate ?? '',
      location: line.location ?? '',
      accumulatedDepreciation: line.accumulatedDepreciation ?? '',
      netValue: line.netValue ?? '',
      saleAmount: line.saleAmount ?? '',
      reason: line.reason ?? '',
      salvageIncome: line.salvageIncome ?? '0.00',
      disposalExpense: line.disposalExpense ?? '0.00',
      remark: line.remark ?? '',
    })),
    salesChainLines:
      document.entity === 'sale-signoff'
        ? (data.signoffLines ?? []).map((line) => ({
            key: line.lineId,
            sourceLineId: line.sourceLineId,
            productCode: line.product.code,
            productName: line.product.name,
            enteredUnitSymbol: line.enteredUnit.symbol ?? '',
            availableBaseQuantity: '',
            outboundBaseQuantity: line.outboundBaseQuantity,
            baseQuantity: '',
            signedBaseQuantity: line.signedBaseQuantity,
            rejectedBaseQuantity: line.rejectedBaseQuantity,
            lossBaseQuantity: line.lossBaseQuantity,
            remark: line.remark ?? '',
          }))
        : document.entity === 'sale-outbound'
          ? (data.productLines ?? []).map((line) => ({
              key: line.lineId,
              sourceLineId: line.sourceLineId ?? line.lineId,
              productCode: line.product.code,
              productName: line.product.name,
              enteredUnitSymbol: line.enteredUnit.symbol ?? '',
              availableBaseQuantity:
                line.availableBaseQuantity ?? line.baseQuantity,
              outboundBaseQuantity: '',
              baseQuantity: line.availableBaseQuantity ?? line.baseQuantity,
              signedBaseQuantity: '',
              rejectedBaseQuantity: '',
              lossBaseQuantity: '',
              remark: line.remark ?? '',
            }))
          : document.entity === 'sale-return' ||
              document.entity === 'purchase-return'
            ? (data.lines ?? []).map((line) => ({
                key: line.lineId,
                sourceLineId: line.sourceLineId ?? '',
                productCode: line.product?.code ?? '',
                productName: line.product?.name ?? '',
                enteredUnitSymbol: line.enteredUnit?.symbol ?? '',
                availableBaseQuantity: '',
                outboundBaseQuantity: '',
                baseQuantity: line.baseQuantity ?? '',
                signedBaseQuantity: '',
                rejectedBaseQuantity: '',
                lossBaseQuantity: '',
                remark: line.remark ?? '',
              }))
            : [],
    productionLines: (data.productionLines ?? []).map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      sourceOrderLineId: line.sourceOrderLineId ?? '',
      product: formReference(line.product),
      enteredQuantity: line.enteredQuantity,
      enteredUnit: { ...line.enteredUnit },
      baseQuantity: line.baseQuantity,
      lossRate: line.lossRate,
      formulaBaseQuantity: line.formulaBaseQuantity,
      remark: line.remark ?? '',
      materials: line.materials.map((material) => ({
        key: material.lineId,
        lineId: material.lineId,
        formulaLineNo: material.lineNo,
        formulaMaterial: { ...material.formulaMaterial },
        formulaBaseQuantity: material.formulaBaseQuantity,
        suggestedBaseQuantity: material.suggestedBaseQuantity,
        actualMaterial: formReference(material.actualMaterial),
        actualEnteredQuantity: material.actualEnteredQuantity,
        actualEnteredUnit: { ...material.actualEnteredUnit },
        actualBaseQuantity: material.actualBaseQuantity,
        adjustmentReason: material.adjustmentReason ?? '',
      })),
    })),
    inventoryCountLines: (data.inventoryCountLines ?? []).map((line) => ({
      key: line.lineId,
      lineId: line.lineId,
      product: formReference(line.product),
      enteredQuantity: line.enteredQuantity,
      enteredUnit: { ...line.enteredUnit },
      baseQuantity: line.baseQuantity,
      bookBaseQuantity: line.bookBaseQuantity,
      differenceBaseQuantity: line.differenceBaseQuantity,
      remark: line.remark ?? '',
    })),
  }
}

export function snapshot(value: VoucherDraftForm): string {
  return JSON.stringify(value)
}
