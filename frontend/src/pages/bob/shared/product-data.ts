import {
  productFormulaFromPayload,
  productFormulaPayload,
  type ProductFormulaDraft,
} from '../product/product-formula-data'
import { parseFixed } from '@/components/voucher/decimal'

export interface ProductUnitConversionDraft {
  unit: {
    objectId: string
    versionId?: string
    code?: string
    name?: string
    symbol?: string
  }
  factor: string
}

function conversionPayload(value: unknown): ProductUnitConversionDraft[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const conversion = item as Partial<ProductUnitConversionDraft>
    const objectId = conversion.unit?.objectId?.trim()
    const factor = conversion.factor?.trim()
    return objectId && factor
      ? [{ unit: { objectId }, factor }]
      : []
  })
}

function comparableConversionPayload(
  value: unknown,
): ProductUnitConversionDraft[] {
  return conversionPayload(value)
    .map((conversion) => {
      return {
        ...conversion,
        factor: comparableMicros(conversion.factor),
      }
    })
    .sort((left, right) =>
      left.unit.objectId.localeCompare(right.unit.objectId),
    )
}

function comparableMicros(value: string): string {
  const parsed = parseFixed(value, 6)
  return parsed === null ? value : formatMicros(parsed)
}

function comparableFormulaValue(
  value: unknown,
  fromServer: boolean,
): unknown {
  const payload = productFormulaPayload(
    fromServer
      ? productFormulaFromPayload(
          value as Parameters<typeof productFormulaFromPayload>[0],
        )
      : (value as ProductFormulaDraft | null),
  )
  if (!payload) return ''
  const normalizeQuantity = (quantity: {
    enteredQuantity: string
    enteredUnit: { objectId: string }
    baseQuantity: string
  }) => ({
    ...quantity,
    enteredQuantity: comparableMicros(quantity.enteredQuantity),
    baseQuantity: comparableMicros(quantity.baseQuantity),
  })
  return {
    ...payload,
    output: normalizeQuantity(payload.output),
    components: payload.components.map((component) => ({
      ...component,
      quantity: normalizeQuantity(component.quantity),
    })),
  }
}

export function productPayload(
  source: Record<string, unknown>,
): Record<string, unknown> {
  return {
    unitConversions: conversionPayload(source.unitConversions),
    formula: productFormulaPayload(source.formula as ProductFormulaDraft | null),
  }
}

export function productFormFields(
  source: Record<string, unknown>,
): Record<string, unknown> {
  return {
    unitConversions: Array.isArray(source.unitConversions)
      ? structuredClone(source.unitConversions)
      : [],
    formula: productFormulaFromPayload(
      source.formula as Parameters<typeof productFormulaFromPayload>[0],
    ),
  }
}

export function comparableProductValue(
  key: string,
  value: unknown,
  fromServer: boolean,
): unknown {
  if (key === 'formula') return comparableFormulaValue(value, fromServer)
  if (key === 'unitConversions') return comparableConversionPayload(value)
  if (key === 'defaultPackagingSpec' && typeof value === 'string') {
    return comparableMicros(value)
  }
  return value ?? ''
}

function formatMicros(value: bigint): string {
  const whole = value / 1_000_000n
  const fraction = String(value % 1_000_000n)
    .padStart(6, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

export function suggestBaseQuantity(
  enteredQuantity: string,
  factor: string,
): string {
  const entered = parseFixed(enteredQuantity, 6)
  const conversion = parseFixed(factor, 6)
  if (entered === null || conversion === null) return ''
  const product = entered * conversion
  const divisor = 1_000_000n
  let micros = product / divisor
  if ((product % divisor) * 2n >= divisor) micros += 1n
  return formatMicros(micros)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function validateProductConfiguration(
  product: Readonly<Record<string, unknown>>,
): string[] {
  const issues: string[] = []
  const behaviorProfile = stringValue(product.behaviorProfile)
  const conversions = conversionPayload(product.unitConversions)
  const conversionIds = new Set(
    conversions.map((conversion) => conversion.unit.objectId),
  )
  const defaultInputUnitId = stringValue(product.defaultInputUnitId)
  const pricingUnitId = stringValue(product.pricingUnitId)
  const defaultPackagingSpec = stringValue(product.defaultPackagingSpec)

  if (!stringValue(product.productTypeId)) issues.push('请选择产品类型。')
  if (conversions.length === 0) issues.push('请至少维护一项单位换算。')
  if (!defaultInputUnitId) issues.push('请选择默认录入单位。')
  else if (!conversionIds.has(defaultInputUnitId))
    issues.push('默认录入单位必须来自单位换算。')
  if (!pricingUnitId) issues.push('请选择计价单位。')
  else if (!conversionIds.has(pricingUnitId))
    issues.push('计价单位必须来自单位换算。')

  if (behaviorProfile === 'PACKAGING') {
    if (defaultPackagingSpec) issues.push('包装物不能设置默认包装规格。')
    if (defaultInputUnitId && pricingUnitId !== defaultInputUnitId) {
      issues.push('包装物的计价单位必须与默认录入单位一致。')
    }
  } else if (behaviorProfile && !defaultPackagingSpec) {
    issues.push('请输入默认包装规格。')
  }

  if (behaviorProfile === 'STANDARD_FINISHED' && !product.formula) {
    issues.push('请维护固定配方。')
  } else if (
    behaviorProfile &&
    behaviorProfile !== 'STANDARD_FINISHED' &&
    product.formula
  ) {
    issues.push('当前产品行为模板不能设置固定配方。')
  }
  return issues
}
