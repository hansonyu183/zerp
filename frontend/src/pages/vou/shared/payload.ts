import type {
  VoucherDraftForm,
  VoucherEntityConfig,
} from '@/components/voucher'
import {
  inputAuxiliaryReference,
  inputProductReference,
  inputReference,
  type DraftPayload,
} from './form'
import { appendSalesChainPayload } from './sales-chain'
import { formulaPayload } from '@/components/formula'

export function buildVoucherDraftPayload(
  config: VoucherEntityConfig,
  value: VoucherDraftForm,
  existingDocument: boolean,
  personnelDirty: ReadonlySet<string>,
): DraftPayload {
  const payload: DraftPayload = {
    businessDate: value.businessDate,
    ...(config.productionMode
      ? {}
      : { currency: value.currency.trim().toUpperCase() || 'CNY' }),
    ...(value.remark.trim() ? { remark: value.remark.trim() } : {}),
  }
  const counterpartyType =
    value.counterpartyType === 'customer'
      ? 'customer-account'
      : value.counterpartyType || undefined
  if (config.entity === 'sale-order') {
    payload.specialApproval = value.specialApproval
  }
  if (config.entity === 'intermediary-calculation') {
    if (value.intermediaryCalculation) {
      payload.intermediaryCalculation = value.intermediaryCalculation
    }
  }
  if (config.entity === 'service-contract') {
    payload.counterpartyType = counterpartyType
    payload.counterparty = inputReference(value.counterparty)
    payload.handler = inputReference(value.handler)
    payload.settlementMethod = inputAuxiliaryReference(value.settlementMethod)
    payload.serviceContract = {
      ...(value.serviceContract.capabilities.length
        ? { capabilities: [...value.serviceContract.capabilities] }
        : {}),
      ...(value.serviceContract.applicableFrom
        ? { applicableFrom: value.serviceContract.applicableFrom }
        : {}),
      ...(value.serviceContract.applicableTo
        ? { applicableTo: value.serviceContract.applicableTo }
        : {}),
      ...(value.serviceContract.terms.trim()
        ? { terms: value.serviceContract.terms.trim() }
        : {}),
    }
  }
  if (config.entity === 'service-acceptance') {
    if (!value.serviceAcceptance.settlementDirection) {
      throw new Error('请选择结算方向。')
    }
    payload.amount = value.amount.trim()
    payload.serviceAcceptance = {
      contractDocumentId: value.serviceAcceptance.contractDocumentId.trim(),
      serviceDate: value.serviceAcceptance.serviceDate,
      acceptanceDate: value.serviceAcceptance.acceptanceDate,
      settlementDirection: value.serviceAcceptance.settlementDirection,
      fulfillmentFact: value.serviceAcceptance.fulfillmentFact.trim(),
      acceptanceFact: value.serviceAcceptance.acceptanceFact.trim(),
    }
  }
  if (config.partyMode === 'customer' || config.partyMode === 'dual') {
    payload.customer = inputReference(value.customer)
  }
  if (config.usesOperatingEntity) {
    payload.operatingEntity = inputReference(value.operatingEntity)
  }
  if (config.partyMode === 'supplier' || config.partyMode === 'dual') {
    payload.supplier = inputReference(value.supplier)
  }
  if (
    config.entity !== 'service-contract' &&
    config.partyMode === 'counterparty' &&
    value.counterparty
  ) {
    if (!config.fixedCounterpartyType) {
      payload.counterpartyType = counterpartyType
    }
    payload.counterparty = inputReference(value.counterparty)
  }
  if (
    (config.entity === 'other-receipt' || config.entity === 'other-payment') &&
    value.otherCategory
  ) {
    payload.otherCategory = value.otherCategory
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
  if (config.usesHandler && config.entity !== 'service-contract') {
    payload.handler = inputReference(value.handler)
  }
  if (config.usesWarehouse) {
    payload.warehouse = inputReference(value.warehouse)
  }
  if (config.productionMode) {
    payload.materialWarehouse = inputReference(value.materialWarehouse)
    payload.finishedWarehouse = inputReference(value.finishedWarehouse)
    payload.productionLines = value.productionLines.map((line) => ({
      ...(config.productionMode === 'order'
        ? { sourceOrderLineId: line.sourceOrderLineId }
        : { product: inputProductReference(line.product)! }),
      enteredQuantity: line.enteredQuantity.trim(),
      enteredUnit: { objectId: line.enteredUnit!.objectId },
      baseQuantity: line.baseQuantity.trim(),
      lossRate: line.lossRate.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
      materials: line.materials.map((material) => ({
        formulaLineNo: material.formulaLineNo,
        actualMaterial: inputProductReference(material.actualMaterial)!,
        actualEnteredQuantity: material.actualEnteredQuantity.trim(),
        actualEnteredUnit: { objectId: material.actualEnteredUnit!.objectId },
        actualBaseQuantity: material.actualBaseQuantity.trim(),
        ...(material.adjustmentReason.trim()
          ? { adjustmentReason: material.adjustmentReason.trim() }
          : {}),
      })),
    }))
  }
  if (config.entity === 'sale-delivery') {
    if (value.vehicle?.carrierAffiliation?.type === 'EXTERNAL') {
      payload.carrier = inputReference(value.carrier)
    }
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
        baseQuantity: line.baseQuantity.trim(),
        ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
      }))
    }
  }
  if (config.directAmount && config.entity !== 'service-acceptance') {
    payload.amount = value.amount.trim()
  }
  if (config.usesAccountAllocations) {
    payload.accountAllocations = value.accountAllocations.map((line) => ({
      account: inputReference(line.account)!,
      amount: line.amount.trim(),
    }))
  }
  if (config.lineKind === 'product') {
    payload.productLines = value.productLines.map((line) => ({
      product: inputProductReference(line.product)!,
      enteredQuantity: line.enteredQuantity.trim(),
      enteredUnit: { objectId: line.enteredUnit!.objectId },
      baseQuantity: line.baseQuantity.trim(),
      unitPrice: line.unitPrice.trim(),
      ...(config.entity === 'sale-order' &&
      (line.settlementSurcharge ?? '').trim()
        ? { settlementSurcharge: (line.settlementSurcharge ?? '').trim() }
        : {}),
      ...(config.entity === 'sale-order'
        ? { deliverySpecificationType: line.deliverySpecificationType }
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
      product: inputProductReference(line.product)!,
      enteredQuantity: line.enteredQuantity.trim(),
      enteredUnit: { objectId: line.enteredUnit!.objectId },
      baseQuantity: line.baseQuantity.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
  if (config.lineKind === 'asset-acquisition') {
    payload.assetAcquisitionLines = value.assetLines.map((line) => ({
      ...(line.lineId ? { lineId: line.lineId } : {}),
      assetName: line.assetName.trim(),
      ...(line.specification.trim()
        ? { specification: line.specification.trim() }
        : {}),
      category: inputAuxiliaryReference(line.category)!,
      originalValue: line.originalValue.trim(),
      usefulLifeMonths: Number(line.usefulLifeMonths),
      residualRate: line.residualRate.trim(),
      department: inputAuxiliaryReference(line.department)!,
      ...(line.custodian ? { custodian: inputReference(line.custodian) } : {}),
      ...(line.location.trim() ? { location: line.location.trim() } : {}),
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
