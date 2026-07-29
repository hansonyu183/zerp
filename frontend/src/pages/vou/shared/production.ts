import type { Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import {
  parseFixed,
  type VoucherDraftForm,
  type VoucherEntityConfig,
  type VoucherProductLineView,
  type VoucherProductionOutputDraft,
  type VoucherReference,
  type VoucherReferenceView,
} from '@/components/voucher'
import type { FormulaMaterialReference } from '@/components/formula'
import { inputReference } from './form'

interface FormulaView {
  baseOutputQuantity: string
  components: Array<{
    material: FormulaMaterialReference
    quantity: string
  }>
}

interface FormulaDefaultView {
  formula?: FormulaView
}

function formatMicros(value: bigint): string {
  const whole = value / 1_000_000n
  const fraction = String(value % 1_000_000n)
    .padStart(6, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

export function productionSuggestedQuantity(
  formulaQuantity: string,
  baseOutputQuantity: string,
  outputQuantity: string,
  lossRate: string,
): string | null {
  const formula = parseFixed(formulaQuantity, 6)
  const base = parseFixed(baseOutputQuantity, 6)
  const output = parseFixed(outputQuantity, 6)
  const loss = parseFixed(lossRate, 6, true)
  if (
    formula === null ||
    base === null ||
    output === null ||
    loss === null ||
    loss > 100_000_000n
  ) {
    return null
  }
  const numerator = formula * output * (100_000_000n + loss)
  const denominator = base * 100_000_000n
  let result = numerator / denominator
  if ((numerator % denominator) * 2n >= denominator) result += 1n
  return formatMicros(result)
}

function reference(
  value: FormulaMaterialReference | VoucherReferenceView,
): VoucherReference {
  return {
    ...value,
    entity: value.entity ?? 'product',
  }
}

export function productionLineFromFormula(
  product: VoucherReference,
  sourceOrderLineId: string,
  outputQuantity: string,
  formula: FormulaView,
): VoucherProductionOutputDraft {
  const line: VoucherProductionOutputDraft = {
    key: crypto.randomUUID(),
    sourceOrderLineId,
    product,
    outputQuantity,
    lossRate: '0',
    formulaBaseOutputQuantity: formula.baseOutputQuantity,
    remark: '',
    materials: formula.components.map((component, index) => ({
      key: crypto.randomUUID(),
      formulaLineNo: index + 1,
      formulaMaterial: reference(component.material),
      formulaQuantity: component.quantity,
      suggestedQuantity: '',
      actualMaterial: reference(component.material),
      actualQuantity: '',
      adjustmentReason: '',
    })),
  }
  recalculateProductionLine(line)
  return line
}

export function productionLineFromOrderLine(
  line: VoucherProductLineView,
): VoucherProductionOutputDraft | null {
  if (
    !line.formula ||
    !['STANDARD_FINISHED', 'CUSTOM_FINISHED'].includes(
      line.product.productKind ?? '',
    )
  ) {
    return null
  }
  return productionLineFromFormula(
    reference(line.product),
    line.lineId,
    line.orderedQuantity,
    line.formula,
  )
}

export function emptyProductionLine(): VoucherProductionOutputDraft {
  return {
    key: crypto.randomUUID(),
    sourceOrderLineId: '',
    product: null,
    outputQuantity: '',
    lossRate: '0',
    formulaBaseOutputQuantity: '',
    remark: '',
    materials: [],
  }
}

export function recalculateProductionLine(
  line: VoucherProductionOutputDraft,
): void {
  for (const material of line.materials) {
    const previous = material.suggestedQuantity
    const suggested =
      productionSuggestedQuantity(
        material.formulaQuantity,
        line.formulaBaseOutputQuantity,
        line.outputQuantity,
        line.lossRate,
      ) ?? ''
    material.suggestedQuantity = suggested
    if (!material.actualQuantity || material.actualQuantity === previous) {
      material.actualQuantity = suggested
    }
  }
}

export function useVoucherProduction(
  config: VoucherEntityConfig,
  form: Ref<VoucherDraftForm>,
) {
  const requestVersions = new Map<string, number>()

  async function changeProductionProduct(
    index: number,
    product: VoucherReference | null,
  ): Promise<void> {
    if (config.productionMode !== 'self') return
    const current = form.value.productionLines[index]
    if (!current) return
    const version = (requestVersions.get(current.key) ?? 0) + 1
    requestVersions.set(current.key, version)
    Object.assign(current, {
      product,
      formulaBaseOutputQuantity: '',
      materials: [],
      formulaError: '',
      formulaLoading: Boolean(product),
    })
    if (!product) return
    try {
      const { data } = await apiClient.post<
        FormulaDefaultView,
        { product: { objectId: string; versionId: string } }
      >('vou/self-production/formula-default', {
        product: inputReference(product)!,
      })
      const line = form.value.productionLines[index]
      if (
        !line ||
        line.key !== current.key ||
        requestVersions.get(current.key) !== version
      ) {
        return
      }
      if (!data.formula) {
        line.formulaError = '该标准成品未配置固定配方。'
        return
      }
      const replacement = productionLineFromFormula(
        product,
        '',
        line.outputQuantity,
        data.formula,
      )
      line.formulaBaseOutputQuantity = replacement.formulaBaseOutputQuantity
      line.materials = replacement.materials
    } catch (error) {
      const line = form.value.productionLines[index]
      if (
        line?.key === current.key &&
        requestVersions.get(current.key) === version
      ) {
        line.formulaError = getErrorMessage(error)
      }
    } finally {
      const line = form.value.productionLines[index]
      if (
        line?.key === current.key &&
        requestVersions.get(current.key) === version
      ) {
        line.formulaLoading = false
      }
    }
  }

  function addProductionLine(): void {
    form.value.productionLines.push(emptyProductionLine())
  }

  return {
    addProductionLine,
    changeProductionProduct,
    recalculateProductionLine,
  }
}
