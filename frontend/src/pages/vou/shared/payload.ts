import type {
  VoucherDraftForm,
  VoucherEntityConfig,
} from '@/components/voucher'
import { inputReference, type DraftPayload } from './form'
import { appendSalesChainPayload } from './sales-chain'
import { formulaPayload } from '@/components/formula'

export function buildVoucherDraftPayload(
  config: VoucherEntityConfig,
  value: VoucherDraftForm,
  existingDocument: boolean,
  personnelDirty: ReadonlySet<string>,
): DraftPayload {
  const payload: DraftPayload = {
    businessDate:
      config.lineKind === 'asset-depreciation'
        ? depreciationMonthEnd(value.depreciationMonth)
        : value.businessDate,
    ...(config.productionMode
      ? {}
      : { currency: value.currency.trim().toUpperCase() || 'CNY' }),
    ...(value.remark.trim() ? { remark: value.remark.trim() } : {}),
  }
  if (config.entity === 'sale-order') {
    payload.specialApproval = value.specialApproval
  }
  if (config.entity === 'intermediary-calculation') {
    payload.intermediaryCalculation = value.intermediaryCalculation
  }
  if (config.partyMode === 'customer' || config.partyMode === 'dual') {
    payload.customer = inputReference(value.customer)
  }
  if (config.partyMode === 'supplier' || config.partyMode === 'dual') {
    payload.supplier = inputReference(value.supplier)
  }
  if (config.partyMode === 'counterparty' && value.counterparty) {
    if (!config.fixedCounterpartyType) {
      payload.counterpartyType = value.counterpartyType
    }
    payload.counterparty = inputReference(value.counterparty)
  }
  if (config.usesEmployee) payload.employee = inputReference(value.employee)
  if (
    config.usesSalesperson &&
    (!existingDocument || personnelDirty.has('salesperson'))
  ) {
    payload.salesperson = inputReference(value.salesperson)
  }
  if (
    config.usesPurchaser &&
    (!existingDocument || personnelDirty.has('purchaser'))
  ) {
    payload.purchaser = inputReference(value.purchaser)
  }
  if (config.usesHandler) payload.handler = inputReference(value.handler)
  if (config.usesWarehouse) {
    payload.warehouse = inputReference(value.warehouse)
  }
  if (config.productionMode) {
    payload.materialWarehouse = inputReference(value.materialWarehouse)
    payload.finishedWarehouse = inputReference(value.finishedWarehouse)
    payload.productionLines = value.productionLines.map((line) => ({
      ...(config.productionMode === 'order'
        ? { sourceOrderLineId: line.sourceOrderLineId }
        : { product: inputReference(line.product)! }),
      outputQuantity: line.outputQuantity.trim(),
      lossRate: line.lossRate.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
      materials: line.materials.map((material) => ({
        formulaLineNo: material.formulaLineNo,
        actualMaterial: inputReference(material.actualMaterial)!,
        actualQuantity: material.actualQuantity.trim(),
        ...(material.adjustmentReason.trim()
          ? { adjustmentReason: material.adjustmentReason.trim() }
          : {}),
      })),
    }))
  }
  if (config.entity === 'sale-delivery') {
    payload.platform = inputReference(value.platform)
    payload.vehicle = inputReference(value.vehicle)
  }
  if (config.usesFundAccount) {
    payload.fundAccount = inputReference(value.fundAccount)
  }
  if (config.usesSourceName) payload.sourceName = value.sourceName.trim()
  if (config.entity === 'sale-return' || config.entity === 'purchase-return') {
    payload.returnReason = value.returnReason.trim()
    if (value.returnKind !== 'REFUSAL') {
      payload.returnLines = value.salesChainLines.map((line) => ({
        sourceLineId: line.sourceLineId,
        quantity: line.quantity.trim(),
        ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
      }))
    }
  }
  if (config.directAmount) payload.amount = value.amount.trim()
  if (config.lineKind === 'product') {
    payload.productLines = value.productLines.map((line) => ({
      product: inputReference(line.product)!,
      orderedQuantity: line.orderedQuantity.trim(),
      unitPrice: line.unitPrice.trim(),
      ...(config.entity === 'sale-order' &&
      (line.settlementSurcharge ?? '').trim()
        ? { settlementSurcharge: (line.settlementSurcharge ?? '').trim() }
        : {}),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
      ...(config.entity === 'sale-order' && line.formula
        ? { formula: formulaPayload(line.formula) }
        : {}),
    }))
  }
  if (config.lineKind === 'price') {
    payload.priceLines = value.priceLines.map((line) => ({
      product: inputReference(line.product)!,
      unitPrice: line.unitPrice.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
  if (config.lineKind === 'expense') {
    payload.expenseLines = value.expenseLines.map((line) => ({
      category: line.category.trim(),
      description: line.description.trim(),
      amount: line.amount.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
  if (config.lineKind === 'inventory-count') {
    payload.inventoryCountLines = value.inventoryCountLines.map((line) => ({
      product: inputReference(line.product)!,
      actualQuantity: line.actualQuantity.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
  if (config.lineKind === 'asset-acquisition') {
    payload.assetAcquisitionLines = value.assetLines.map((line) => ({
      assetName: line.assetName.trim(),
      ...(line.specification.trim()
        ? { specification: line.specification.trim() }
        : {}),
      category: inputReference(line.category)!,
      originalValue: line.originalValue.trim(),
      usefulLifeMonths: Number(line.usefulLifeMonths),
      residualRate: line.residualRate.trim(),
      department: inputReference(line.department)!,
      ...(line.custodian ? { custodian: inputReference(line.custodian) } : {}),
      ...(line.location.trim() ? { location: line.location.trim() } : {}),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
  if (config.lineKind === 'asset-depreciation') {
    payload.depreciationMonth = value.depreciationMonth
    payload.assetDepreciationLines = value.assetLines.map((line) => ({
      assetId: line.assetId,
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
  if (config.lineKind === 'asset-sale') {
    payload.assetSaleLines = value.assetLines.map((line) => ({
      assetId: line.assetId,
      saleAmount: line.saleAmount.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
  if (config.lineKind === 'asset-liquidation') {
    payload.assetLiquidationLines = value.assetLines.map((line) => ({
      assetId: line.assetId,
      reason: line.reason.trim(),
      salvageIncome: line.salvageIncome.trim(),
      disposalExpense: line.disposalExpense.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
  appendSalesChainPayload(config, value, payload)
  return payload
}

function depreciationMonthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  if (!year || !monthNumber) return ''
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
}
