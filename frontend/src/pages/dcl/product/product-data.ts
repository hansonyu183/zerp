import type { DclProductInput } from './types'
import {
  productFormulaFromPayload,
  productFormulaPayload,
  type ProductFormulaDraft,
} from '@/pages/bob/product/product-formula-data'
import { parseFixed } from '@/components/voucher/decimal'

export type ProductUnitConversionDraft = {
  unit: {
    objectId: string
    approvalEntryId?: string
    code?: string
    name?: string
    symbol?: string
  }
  factor: string
}

export function suggestBaseQuantity(
  enteredQuantity: string,
  factor: string,
): string {
  const entered = parseFixed(enteredQuantity, 6)
  const conversion = parseFixed(factor, 6)
  if (entered === null || conversion === null) return ''
  const micros = (entered * conversion + 500_000n) / 1_000_000n
  const whole = micros / 1_000_000n
  const fraction = String(micros % 1_000_000n)
    .padStart(6, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function unitConversions(value: unknown): ProductUnitConversionDraft[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const candidate = item as Partial<ProductUnitConversionDraft>
    const objectId = trimmed(candidate.unit?.objectId)
    const factor = trimmed(candidate.factor)
    return objectId && factor ? [{ unit: { objectId }, factor }] : []
  })
}

export function dclProductFormFields(source: {
  unitConversions?: unknown
  formula?: unknown
}): Record<string, unknown> {
  return {
    unitConversions: Array.isArray(source.unitConversions)
      ? structuredClone(source.unitConversions)
      : [],
    formula: productFormulaFromPayload(
      source.formula as Parameters<typeof productFormulaFromPayload>[0],
    ),
  }
}

export function dclProductInput(
  source: Record<string, unknown>,
  _mode: 'create' | 'save',
): DclProductInput {
  const optional = [
    'productTypeId',
    'defaultInputUnitId',
    'pricingUnitId',
    'categoryId',
    'specification',
    'model',
    'barcode',
    'remark',
    'defaultPackagingSpec',
  ] as const
  const input: Record<string, unknown> = {
    name: trimmed(source.name),
    unitConversions: unitConversions(source.unitConversions),
    returnable: Boolean(source.returnable),
    // DCL save is a full snapshot, including an untouched fixed formula.
    formula:
      productFormulaPayload(source.formula as ProductFormulaDraft | null) ??
      null,
  }
  for (const key of optional) {
    const value = trimmed(source[key])
    input[key] = value || null
  }
  if (input.barcode) input.barcode = String(input.barcode).toUpperCase()
  return input as DclProductInput
}

export function validateDclProductConfiguration(
  product: Readonly<Record<string, unknown>>,
): string[] {
  const issues: string[] = []
  const profile = trimmed(product.behaviorProfile)
  const conversions = unitConversions(product.unitConversions)
  const units = new Set(conversions.map((item) => item.unit.objectId))
  const inputUnit = trimmed(product.defaultInputUnitId)
  const pricingUnit = trimmed(product.pricingUnitId)
  const packagingSpec = trimmed(product.defaultPackagingSpec)
  if (!trimmed(product.productTypeId)) issues.push('请选择产品类型。')
  if (!conversions.length) issues.push('请至少维护一项单位换算。')
  if (!inputUnit) issues.push('请选择默认录入单位。')
  else if (!units.has(inputUnit)) issues.push('默认录入单位必须来自单位换算。')
  if (!pricingUnit) issues.push('请选择计价单位。')
  else if (!units.has(pricingUnit)) issues.push('计价单位必须来自单位换算。')
  if (profile === 'PACKAGING') {
    if (packagingSpec) issues.push('包装物不能设置默认包装规格。')
    if (inputUnit && pricingUnit !== inputUnit)
      issues.push('包装物的计价单位必须与默认录入单位一致。')
  } else if (profile && !packagingSpec) {
    issues.push('请输入默认包装规格。')
  }
  if (profile === 'STANDARD_FINISHED' && !product.formula)
    issues.push('请维护固定配方。')
  if (profile && profile !== 'STANDARD_FINISHED' && product.formula)
    issues.push('当前产品行为模板不能设置固定配方。')
  return issues
}
