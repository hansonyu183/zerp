import type { Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import {
  parseFixed,
  type VoucherDraftForm,
  type VoucherEntityConfig,
  type VoucherProductLineView,
  type ProductBehaviorProfile,
  type VoucherProductionOutputDraft,
  type VoucherReference,
  type VoucherReferenceView,
} from '@/components/voucher'
import type { FormulaMaterialReference } from '@/components/formula'
import { inputReference } from './form'

interface FormulaView {
  output: { baseQuantity: string }
  components: Array<{
    material: FormulaMaterialReference
    quantity: { baseQuantity: string }
  }>
}

function formatMicros(value: bigint): string {
  const whole = value / 1_000_000n
  const fraction = String(value % 1_000_000n)
    .padStart(6, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

export function productionSuggestedQuantity(
  formulaBaseQuantity: string,
  formulaOutputBaseQuantity: string,
  outputBaseQuantity: string,
  lossRate: string,
): string | null {
  const formula = parseFixed(formulaBaseQuantity, 6)
  const base = parseFixed(formulaOutputBaseQuantity, 6)
  const output = parseFixed(outputBaseQuantity, 6)
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
  const { behaviorProfile: rawBehaviorProfile, ...referenceValue } = value
  const behaviorProfile = productBehaviorProfile(rawBehaviorProfile)
  return {
    ...referenceValue,
    entity: value.entity ?? 'product',
    ...(behaviorProfile ? { behaviorProfile } : {}),
  }
}

function productBehaviorProfile(
  value: string | undefined,
): ProductBehaviorProfile | undefined {
  return value === 'RAW_MATERIAL' ||
    value === 'STANDARD_FINISHED' ||
    value === 'CUSTOM_FINISHED' ||
    value === 'PACKAGING'
    ? value
    : undefined
}

function resolvedFormula(
  formula: VoucherProductLineView['formula'],
): FormulaView | null {
  if (!formula || formula.components.some((component) => !component.material)) {
    return null
  }
  return {
    output: formula.output,
    components: formula.components.map((component) => ({
      material: component.material!,
      quantity: component.quantity,
    })),
  }
}

function defaultInputUnit(
  product: VoucherReference,
): VoucherProductionOutputDraft['enteredUnit'] {
  return (
    product.unitConversions?.find(
      (conversion) => conversion.unit.objectId === product.defaultInputUnitId,
    )?.unit ?? null
  )
}

export function productionLineFromFormula(
  product: VoucherReference,
  sourceOrderLineId: string,
  baseQuantity: string,
  formula: FormulaView,
  entryAudit?: Pick<
    VoucherProductionOutputDraft,
    'enteredQuantity' | 'enteredUnit'
  >,
): VoucherProductionOutputDraft {
  const line: VoucherProductionOutputDraft = {
    key: crypto.randomUUID(),
    sourceOrderLineId,
    product,
    enteredQuantity: entryAudit?.enteredQuantity ?? baseQuantity,
    enteredUnit: entryAudit?.enteredUnit ?? defaultInputUnit(product),
    baseQuantity,
    lossRate: '0',
    formulaBaseQuantity: formula.output.baseQuantity,
    remark: '',
    materials: formula.components.map((component, index) => ({
      key: crypto.randomUUID(),
      formulaLineNo: index + 1,
      formulaMaterial: reference(component.material),
      formulaBaseQuantity: component.quantity.baseQuantity,
      suggestedBaseQuantity: '',
      actualMaterial: reference(component.material),
      actualEnteredQuantity: '',
      actualEnteredUnit: null,
      actualBaseQuantity: '',
      adjustmentReason: '',
    })),
  }
  recalculateProductionLine(line)
  return line
}

export function productionLineFromOrderLine(
  line: VoucherProductLineView,
): VoucherProductionOutputDraft | null {
  const formula = resolvedFormula(line.formula)
  if (!formula || line.product.behaviorProfile !== 'STANDARD_FINISHED') {
    return null
  }
  return productionLineFromFormula(
    reference(line.product),
    line.lineId,
    line.baseQuantity,
    formula,
    {
      enteredQuantity: line.enteredQuantity,
      enteredUnit: line.enteredUnit,
    },
  )
}

export function emptyProductionLine(): VoucherProductionOutputDraft {
  return {
    key: crypto.randomUUID(),
    sourceOrderLineId: '',
    product: null,
    enteredQuantity: '',
    enteredUnit: null,
    baseQuantity: '',
    lossRate: '0',
    formulaBaseQuantity: '',
    remark: '',
    materials: [],
  }
}

export function recalculateProductionLine(
  line: VoucherProductionOutputDraft,
): void {
  for (const material of line.materials) {
    const previous = material.suggestedBaseQuantity
    const suggested =
      productionSuggestedQuantity(
        material.formulaBaseQuantity,
        line.formulaBaseQuantity,
        line.baseQuantity,
        line.lossRate,
      ) ?? ''
    material.suggestedBaseQuantity = suggested
    if (
      !material.actualBaseQuantity ||
      material.actualBaseQuantity === previous
    ) {
      material.actualBaseQuantity = suggested
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
      enteredUnit: product ? defaultInputUnit(product) : null,
      formulaBaseQuantity: '',
      materials: [],
      formulaError: '',
      formulaLoading: Boolean(product),
    })
    if (!product) return
    try {
      const { data } = await apiClient.postContract('vou/self-production/formula-default', {
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
        line.baseQuantity,
        data.formula,
      )
      line.formulaBaseQuantity = replacement.formulaBaseQuantity
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
