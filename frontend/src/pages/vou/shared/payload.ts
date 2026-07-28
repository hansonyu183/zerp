import type {
  VoucherDraftForm,
  VoucherEntityConfig,
} from '@/components/voucher'
import { inputReference, type DraftPayload } from './form'
import { appendSalesChainPayload } from './sales-chain'

export function buildVoucherDraftPayload(
  config: VoucherEntityConfig,
  value: VoucherDraftForm,
  existingDocument: boolean,
  personnelDirty: ReadonlySet<string>,
): DraftPayload {
  const payload: DraftPayload = {
    businessDate: value.businessDate,
    currency: value.currency.trim().toUpperCase() || 'CNY',
    ...(value.remark.trim() ? { remark: value.remark.trim() } : {}),
  }
  if (config.partyMode === 'customer' || config.partyMode === 'dual') {
    payload.customer = inputReference(value.customer)
  }
  if (config.partyMode === 'supplier' || config.partyMode === 'dual') {
    payload.supplier = inputReference(value.supplier)
  }
  if (config.partyMode === 'counterparty' && value.counterparty) {
    payload.counterpartyType = value.counterpartyType
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
  if (config.entity === 'sale-delivery') {
    payload.platform = inputReference(value.platform)
    payload.vehicle = inputReference(value.vehicle)
  }
  if (config.usesFundAccount) {
    payload.fundAccount = inputReference(value.fundAccount)
  }
  if (config.usesSourceName) payload.sourceName = value.sourceName.trim()
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
  appendSalesChainPayload(config, value, payload)
  return payload
}
