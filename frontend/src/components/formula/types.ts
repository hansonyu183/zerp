export interface FormulaUnitSnapshot {
  objectId: string
  versionId?: string
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
  versionId: string
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
  sourceType?: string
  sourceDocumentId?: string
  sourceDocumentNo?: string
  components: FormulaComponentDraft[]
}

export interface FormulaPayload {
  output: {
    enteredQuantity: string
    enteredUnit: { objectId: string }
    baseQuantity: string
  }
  sourceType?: string
  sourceDocumentId?: string
  sourceDocumentNo?: string
  components: Array<{
    material: { objectId: string }
    quantity: {
      enteredQuantity: string
      enteredUnit: { objectId: string }
      baseQuantity: string
    }
  }>
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
    sourceType: formula.sourceType,
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
    ...(formula.sourceType ? { sourceType: formula.sourceType } : {}),
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
