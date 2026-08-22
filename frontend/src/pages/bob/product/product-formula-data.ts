export interface FormulaUnitSnapshot {
  objectId: string
  versionId?: string
  code?: string
  name?: string
  symbol?: string
}

export interface FormulaQuantitySnapshotDraft {
  enteredQuantity: string
  enteredUnit: FormulaUnitSnapshot
  baseQuantity: string
}

export interface FormulaMaterialReference {
  objectId: string
  versionId: string
  code: string
  name: string
  behaviorProfile?: string
  defaultInputUnitId?: string
  unitConversions?: Array<{ unit: FormulaUnitSnapshot; factor: string }>
}

export interface ProductFormulaComponentDraft {
  key: string
  material: FormulaMaterialReference | null
  quantity: FormulaQuantitySnapshotDraft
  resolutionStatus: 'CURRENT' | 'UNRESOLVED'
  requiresConfirmation: boolean
}

export interface ProductFormulaDraft {
  output: FormulaQuantitySnapshotDraft
  components: ProductFormulaComponentDraft[]
}

interface ProductFormulaPayload {
  output: {
    enteredQuantity: string
    enteredUnit: { objectId: string }
    baseQuantity: string
  }
  components: Array<{
    material: { objectId: string; versionId: string }
    quantity: {
      enteredQuantity: string
      enteredUnit: { objectId: string }
      baseQuantity: string
    }
    resolutionStatus?: 'CURRENT' | 'UNRESOLVED'
    requiresConfirmation?: boolean
  }>
}

function quantityPayload(quantity: FormulaQuantitySnapshotDraft) {
  return {
    enteredQuantity: quantity.enteredQuantity.trim(),
    enteredUnit: { objectId: quantity.enteredUnit.objectId },
    baseQuantity: quantity.baseQuantity.trim(),
  }
}

export function productFormulaFromPayload(
  formula: ProductFormulaDraft | null | undefined,
): ProductFormulaDraft | null {
  if (!formula) return null
  return {
    output: {
      ...formula.output,
      enteredUnit: { ...formula.output.enteredUnit },
    },
    components: formula.components.map((component) => ({
      ...component,
      key: crypto.randomUUID(),
      material: component.material
        ? {
            ...component.material,
            unitConversions: component.material.unitConversions?.map(
              (conversion) => ({
                ...conversion,
                unit: { ...conversion.unit },
              }),
            ),
          }
        : null,
      quantity: {
        ...component.quantity,
        enteredUnit: { ...component.quantity.enteredUnit },
      },
      resolutionStatus: component.resolutionStatus ?? 'CURRENT',
      requiresConfirmation: component.requiresConfirmation ?? false,
    })),
  }
}

export function productFormulaPayload(
  formula: ProductFormulaDraft | null | undefined,
): ProductFormulaPayload | undefined {
  if (!formula) return undefined
  return {
    output: quantityPayload(formula.output),
    components: formula.components.map((component) => ({
      material: {
        objectId: component.material!.objectId,
        versionId: component.material!.versionId,
      },
      quantity: quantityPayload(component.quantity),
      ...(component.resolutionStatus === 'UNRESOLVED'
        ? { resolutionStatus: component.resolutionStatus }
        : {}),
      ...(component.requiresConfirmation ? { requiresConfirmation: true } : {}),
    })),
  }
}
