import {
  calculateLineAmount,
  isMoney,
  isQuantity,
  sumMoney,
  type VoucherDraftForm,
  type VoucherEntityConfig,
} from '@/components/voucher'
import { validateSalesChainDraft } from './sales-chain'

export function validateVoucherDraft(
  config: VoucherEntityConfig,
  value: VoucherDraftForm,
): string | null {
  if (!value.businessDate) return '请选择业务日期。'
  if (!/^[A-Z]{3}$/.test(value.currency.trim().toUpperCase())) {
    return '币种必须是三位大写字母。'
  }
  if (Array.from(value.remark).length > 1000) return '备注不能超过 1000 字。'
  if (config.partyMode === 'customer' && !value.customer) return '请选择客户。'
  if (config.partyMode === 'supplier' && !value.supplier)
    return '请选择供应商。'
  if (config.partyMode === 'dual' && (!value.customer || !value.supplier)) {
    return '请选择客户和供应商。'
  }
  if (
    config.partyMode === 'counterparty' &&
    config.entity !== 'other-income' &&
    (!value.counterpartyType || !value.counterparty)
  ) {
    return '请选择往来方类型和往来方。'
  }
  if (value.counterparty && !value.counterpartyType) return '请选择往来方类型。'
  if (config.usesEmployee && !value.employee) return '请选择员工。'
  if (config.usesWarehouse && !value.warehouse) return '请选择仓库。'
  if (config.usesFundAccount && !value.fundAccount) return '请选择资金账户。'
  if (config.usesHandler && !value.handler) return '请选择经办人。'
  if (
    config.usesSourceName &&
    (!value.sourceName.trim() ||
      Array.from(value.sourceName.trim()).length > 200)
  ) {
    return '来源名称必填且不能超过 200 字。'
  }
  const salesChainError = validateSalesChainDraft(config, value)
  if (salesChainError) return salesChainError
  if (config.directAmount && !isMoney(value.amount)) return '金额格式不正确。'
  if (config.lineKind === 'product') {
    if (value.productLines.length < 1 || value.productLines.length > 200) {
      return '产品明细必须包含 1 到 200 行。'
    }
    const seen = new Set<string>()
    const lineAmounts: string[] = []
    for (const [index, line] of value.productLines.entries()) {
      if (
        !line.product ||
        !isQuantity(line.orderedQuantity) ||
        !isMoney(line.unitPrice)
      )
        return `第 ${index + 1} 行 · 产品/数量/单价：请完整填写有效值。`
      if (
        config.entity === 'intermediary-sale-order' &&
        !isMoney(line.purchaseUnitPrice)
      ) {
        return `第 ${index + 1} 行 · 采购单价：格式不正确。`
      }
      const lineAmount = calculateLineAmount(
        line.orderedQuantity,
        line.unitPrice,
      )
      if (!lineAmount) return `第 ${index + 1} 行 · 金额：超出允许范围。`
      lineAmounts.push(lineAmount)
      if (Array.from(line.remark).length > 1000)
        return `第 ${index + 1} 行 · 备注：不能超过 1000 字。`
      const key = `${line.product.objectId}/${line.product.versionId}`
      if (seen.has(key)) return `第 ${index + 1} 行 · 产品：不能重复添加。`
      seen.add(key)
    }
    if (!sumMoney(lineAmounts)) return '单据总金额超出允许范围。'
  }
  if (config.lineKind === 'expense') {
    if (value.expenseLines.length < 1 || value.expenseLines.length > 200) {
      return '费用明细必须包含 1 到 200 行。'
    }
    for (const [index, line] of value.expenseLines.entries()) {
      if (
        !line.category.trim() ||
        Array.from(line.category.trim()).length > 100 ||
        !line.description.trim() ||
        Array.from(line.description.trim()).length > 500 ||
        !isMoney(line.amount) ||
        Array.from(line.remark).length > 1000
      ) {
        return `第 ${index + 1} 行 · 费用明细：请完整填写有效值。`
      }
    }
    if (!sumMoney(value.expenseLines.map((line) => line.amount))) {
      return '单据总金额超出允许范围。'
    }
  }
  return null
}
