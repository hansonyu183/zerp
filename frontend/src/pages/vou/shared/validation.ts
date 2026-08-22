import {
  calculatePricedLineAmount,
  addMoney,
  isMoney,
  isQuantity,
  parseFixed,
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
  if (Array.from(value.remark).length > 1000) return '备注不能超过 1000 字。'
  if (config.entity === 'intermediary-calculation') {
    const [year, month] = value.businessDate.split('-').map(Number)
    const monthEnd = new Date(Date.UTC(year ?? 0, month ?? 0, 0))
      .toISOString()
      .slice(0, 10)
    if (value.businessDate !== monthEnd) return '业务日期必须是期间月末。'
    if (!value.intermediaryCalculation) return '请先执行居间计算。'
    if (value.intermediaryCalculation.source.periodEnd !== value.businessDate) {
      return '计算稿期间与业务日期不一致，请重新计算。'
    }
  }
  if (config.entity === 'service-contract') {
    if (!value.counterparty || !value.handler) {
      return '请选择合同相对方和经办人。'
    }
    if (
      value.counterpartyType !== 'other-unit' &&
      value.counterpartyType !== 'sales-partner'
    ) {
      return '请选择服务关系或销售合作关系。'
    }
    if (value.counterpartyType === 'sales-partner') {
      if (
        value.serviceContract.capabilities.length === 0 ||
        !value.serviceContract.applicableFrom
      ) {
        return '销售合作合同必须选择能力和适用开始日期。'
      }
      if (
        value.serviceContract.applicableTo &&
        value.serviceContract.applicableTo <
          value.serviceContract.applicableFrom
      ) {
        return '适用结束日期不能早于开始日期。'
      }
    }
    if (Array.from(value.serviceContract.terms).length > 10000) {
      return '合同条款不能超过 10000 字。'
    }
  }
  if (config.entity === 'service-acceptance') {
    const detail = value.serviceAcceptance
    if (
      !detail.contractDocumentId.trim() ||
      !detail.serviceDate ||
      !detail.acceptanceDate ||
      !detail.settlementDirection
    ) {
      return '请完整填写合同、履约日期、验收日期和结算方向。'
    }
    if (detail.acceptanceDate < detail.serviceDate) {
      return '验收日期不能早于履约日期。'
    }
    if (
      Array.from(detail.fulfillmentFact).length > 10000 ||
      Array.from(detail.acceptanceFact).length > 10000
    ) {
      return '履约或验收事实不能超过 10000 字。'
    }
  }
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
    return config.fixedCounterpartyType === 'employee'
      ? '请选择借款员工。'
      : '请选择往来方类型和往来方。'
  }
  if (value.counterparty && !value.counterpartyType) return '请选择往来方类型。'
  if (config.usesEmployee && !value.employee) return '请选择员工。'
  if (config.usesWarehouse && !value.warehouse) return '请选择仓库。'
  if (
    config.productionMode &&
    (!value.materialWarehouse || !value.finishedWarehouse)
  ) {
    return '请选择材料仓库和成品仓库。'
  }
  if (
    (config.entity === 'sale-return' || config.entity === 'purchase-return') &&
    (!value.returnReason.trim() ||
      Array.from(value.returnReason.trim()).length > 1000)
  ) {
    return '退货原因必填且不能超过 1000 字。'
  }
  if (
    (config.entity === 'sale-return' || config.entity === 'purchase-return') &&
    (config.entity === 'purchase-return' || value.returnKind !== 'REFUSAL') &&
    (value.salesChainLines.length === 0 ||
      value.salesChainLines.some(
        (line) => !line.sourceLineId || !isQuantity(line.quantity),
      ))
  ) {
    return '请选择有效的签收明细并填写退货数量。'
  }
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
  if (config.productionMode) {
    if (
      value.productionLines.length < 1 ||
      value.productionLines.length > 200
    ) {
      return '生产明细必须包含 1 到 200 行。'
    }
    const seen = new Set<string>()
    for (const [index, line] of value.productionLines.entries()) {
      const lossRate = parseFixed(line.lossRate, 6, true)
      if (
        !line.product ||
        !isQuantity(line.outputQuantity) ||
        lossRate === null ||
        lossRate > 100_000_000n ||
        !isQuantity(line.formulaBaseOutputQuantity) ||
        line.materials.length < 1
      ) {
        return `第 ${index + 1} 行 · 生产明细：请填写有效的产品、产量、损耗比例和配方。`
      }
      if (config.productionMode === 'order' && !line.sourceOrderLineId) {
        return `第 ${index + 1} 行 · 来源订单行无效。`
      }
      const key =
        config.productionMode === 'order'
          ? line.sourceOrderLineId
          : line.product.objectId
      if (seen.has(key)) return `第 ${index + 1} 行 · 成品不能重复。`
      seen.add(key)
      for (const [materialIndex, material] of line.materials.entries()) {
        const adjusted =
          material.actualMaterial?.objectId !==
            material.formulaMaterial.objectId ||
          material.actualMaterial?.versionId !==
            material.formulaMaterial.versionId ||
          material.actualQuantity.trim() !== material.suggestedQuantity.trim()
        if (
          !material.actualMaterial ||
          !isQuantity(material.actualQuantity) ||
          (adjusted && !material.adjustmentReason.trim())
        ) {
          return `第 ${index + 1} 行 · 材料 ${materialIndex + 1}：请填写有效的实际材料、用量；发生替换或调整时必须说明原因。`
        }
      }
    }
  }
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
        !isMoney(line.unitPrice, true) ||
        ((line.settlementSurcharge ?? '') !== '' &&
          !isMoney(line.settlementSurcharge ?? '', true))
      )
        return `第 ${index + 1} 行 · 产品/数量/单价：请完整填写有效值。`
      const lineAmount = calculatePricedLineAmount(
        line.orderedQuantity,
        addMoney(line.unitPrice, line.settlementSurcharge) ?? '',
        line.product.pricingQuantityPerInventoryUnit ?? '1',
      )
      if (!lineAmount) return `第 ${index + 1} 行 · 金额：超出允许范围。`
      lineAmounts.push(lineAmount)
      if (Array.from(line.remark).length > 1000)
        return `第 ${index + 1} 行 · 备注：不能超过 1000 字。`
      const key = `${line.product.objectId}/${line.product.versionId}`
      if (seen.has(key)) return `第 ${index + 1} 行 · 产品：不能重复添加。`
      seen.add(key)
      if (
        config.entity === 'sale-order' &&
        line.product.productKind !== 'PACKAGING'
      ) {
        if (
          !line.formula ||
          !isQuantity(line.formula.baseOutputQuantity) ||
          line.formula.components.length === 0 ||
          line.formula.components.some(
            (component) =>
              !component.material || !isQuantity(component.quantity),
          )
        ) {
          return `第 ${index + 1} 行 · 配方：请完整填写基准产量和原材料用量。`
        }
        const materialIds = line.formula.components.map(
          (component) => component.material!.objectId,
        )
        if (new Set(materialIds).size !== materialIds.length) {
          return `第 ${index + 1} 行 · 配方：原材料不能重复。`
        }
      }
    }
    if (!sumMoney(lineAmounts)) return '单据总金额超出允许范围。'
  }
  if (config.lineKind === 'price') {
    if (value.priceLines.length < 1 || value.priceLines.length > 200) {
      return '价格明细必须包含 1 到 200 行。'
    }
    const seen = new Set<string>()
    for (const [index, line] of value.priceLines.entries()) {
      if (!line.product || !isMoney(line.unitPrice, true)) {
        return `第 ${index + 1} 行 · 产品/单价：请完整填写有效值。`
      }
      if (seen.has(line.product.objectId)) {
        return `第 ${index + 1} 行 · 产品：不能重复添加。`
      }
      seen.add(line.product.objectId)
      if (Array.from(line.remark).length > 1000) {
        return `第 ${index + 1} 行 · 备注：不能超过 1000 字。`
      }
    }
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
  if (config.lineKind === 'inventory-count') {
    if (
      value.inventoryCountLines.length < 1 ||
      value.inventoryCountLines.length > 200
    ) {
      return '盘点明细必须包含 1 到 200 行。'
    }
    const seen = new Set<string>()
    for (const [index, line] of value.inventoryCountLines.entries()) {
      if (!line.product || !isQuantity(line.actualQuantity, true)) {
        return `第 ${index + 1} 行 · 产品/实盘数量：请完整填写有效值。`
      }
      if (seen.has(line.product.objectId)) {
        return `第 ${index + 1} 行 · 产品：不能重复添加。`
      }
      seen.add(line.product.objectId)
      if (Array.from(line.remark).length > 1000) {
        return `第 ${index + 1} 行 · 备注：不能超过 1000 字。`
      }
    }
  }
  if (config.lineKind.startsWith('asset-')) {
    if (value.assetLines.length < 1 || value.assetLines.length > 500) {
      return '资产明细不能为空。'
    }
    const seen = new Set<string>()
    for (const [index, line] of value.assetLines.entries()) {
      if (config.lineKind === 'asset-acquisition') {
        const months = Number(line.usefulLifeMonths)
        const rate = parseFixed(line.residualRate, 2, true)
        if (
          !line.assetName.trim() ||
          !line.category ||
          !line.department ||
          !isMoney(line.originalValue) ||
          !Number.isInteger(months) ||
          months < 1 ||
          months > 1200 ||
          rate === null ||
          rate < 0n ||
          rate >= 10_000n
        ) {
          return `第 ${index + 1} 行 · 资产名称、类别、原值、期限、残值率和部门必须有效。`
        }
      } else if (!line.assetId) {
        return `第 ${index + 1} 行 · 请选择资产。`
      }
      if (line.assetId && seen.has(line.assetId))
        return `第 ${index + 1} 行 · 资产不能重复。`
      if (line.assetId) seen.add(line.assetId)
      if (config.lineKind === 'asset-sale' && !isMoney(line.saleAmount, true)) {
        return `第 ${index + 1} 行 · 出让金额格式不正确。`
      }
      if (
        config.lineKind === 'asset-liquidation' &&
        (!line.reason.trim() ||
          !isMoney(line.salvageIncome, true) ||
          !isMoney(line.disposalExpense, true))
      ) {
        return `第 ${index + 1} 行 · 请填写清算原因及有效的残值收入、处置费用。`
      }
    }
  }
  return null
}
