export interface FormulaUnitSnapshot {
  objectId: string
  approvalEntryId?: string
  code?: string
  name?: string
  symbol?: string
}

export interface FormulaUnitConversion {
  unit: FormulaUnitSnapshot
  factor: string
}

export interface FormulaMaterialReference {
  objectId: string
  approvalEntryId: string
  entity?: string
  code: string
  name: string
  unit?: string
  behaviorProfile?: string
  defaultInputUnitId?: string
  unitConversions?: FormulaUnitConversion[]
}

export interface FormulaQuantitySnapshotDraft {
  enteredQuantity: string
  enteredUnit: FormulaUnitSnapshot | null
  baseQuantity: string
}

export interface FormulaComponentDraft {
  key: string
  material: FormulaMaterialReference | null
  quantity: FormulaQuantitySnapshotDraft
}

export interface ProductFormulaDraft {
  output: FormulaQuantitySnapshotDraft
  sourceType?: components['schemas']['VouFormulaInput']['sourceType'] | ''
  sourceDocumentId?: string
  sourceDocumentNo?: string
  components: FormulaComponentDraft[]
}

export type FormulaPayload = components['schemas']['VouFormulaInput']

function formulaSourceType(
  value: string | undefined,
): FormulaPayload['sourceType'] {
  return value === 'RAW_SELF' ||
    value === 'PRODUCT_FIXED' ||
    value === 'CUSTOMER_LATEST' ||
    value === 'MANUAL'
    ? value
    : undefined
}

export function formulaFromPayload(
  formula:
    | {
        output: FormulaQuantitySnapshotDraft
        sourceType?: string
        sourceDocumentId?: string
        sourceDocumentNo?: string
        components: Array<{
          material: FormulaMaterialReference | null
          quantity: FormulaQuantitySnapshotDraft
        }>
      }
    | null
    | undefined,
): ProductFormulaDraft | null {
  if (!formula) return null
  return {
    output: structuredClone(formula.output),
    sourceType: formulaSourceType(formula.sourceType),
    sourceDocumentId: formula.sourceDocumentId,
    sourceDocumentNo: formula.sourceDocumentNo,
    components: formula.components.map((component) => ({
      key: crypto.randomUUID(),
      material: component.material ? { ...component.material } : null,
      quantity: structuredClone(component.quantity),
    })),
  }
}

export function formulaPayload(
  formula: ProductFormulaDraft | null | undefined,
): FormulaPayload | undefined {
  if (!formula?.output.enteredUnit) return undefined
  return {
    output: {
      enteredQuantity: formula.output.enteredQuantity.trim(),
      enteredUnit: { objectId: formula.output.enteredUnit.objectId },
      baseQuantity: formula.output.baseQuantity.trim(),
    },
    ...(formulaSourceType(formula.sourceType)
      ? { sourceType: formulaSourceType(formula.sourceType) }
      : {}),
    ...(formula.sourceDocumentId
      ? { sourceDocumentId: formula.sourceDocumentId }
      : {}),
    ...(formula.sourceDocumentNo
      ? { sourceDocumentNo: formula.sourceDocumentNo }
      : {}),
    components: formula.components.map((component) => ({
      material: { objectId: component.material!.objectId },
      quantity: {
        enteredQuantity: component.quantity.enteredQuantity.trim(),
        enteredUnit: { objectId: component.quantity.enteredUnit!.objectId },
        baseQuantity: component.quantity.baseQuantity.trim(),
      },
    })),
  }
}
import type { components } from '@/api/generated/schema'
