export interface FormulaMaterialReference {
  objectId: string
  versionId: string
  entity?: string
  code: string
  name: string
  unit?: string
  productKind?: string
}

export interface FormulaComponentDraft {
  key: string
  material: FormulaMaterialReference | null
  quantity: string
}

export interface ProductFormulaDraft {
  baseOutputQuantity: string
  sourceType?: string
  sourceDocumentId?: string
  sourceDocumentNo?: string
  components: FormulaComponentDraft[]
}

export interface FormulaPayload {
  baseOutputQuantity: string
  sourceType?: string
  sourceDocumentId?: string
  sourceDocumentNo?: string
  components: Array<{
    material: {
      objectId: string
      versionId: string
    }
    quantity: string
  }>
}

export function formulaFromPayload(
  formula:
    | {
        baseOutputQuantity: string
        sourceType?: string
        sourceDocumentId?: string
        sourceDocumentNo?: string
        components: Array<{
          material: FormulaMaterialReference
          quantity: string
        }>
      }
    | null
    | undefined,
): ProductFormulaDraft | null {
  if (!formula) return null
  return {
    baseOutputQuantity: formula.baseOutputQuantity,
    sourceType: formula.sourceType,
    sourceDocumentId: formula.sourceDocumentId,
    sourceDocumentNo: formula.sourceDocumentNo,
    components: formula.components.map((component) => ({
      key: crypto.randomUUID(),
      material: { ...component.material },
      quantity: component.quantity,
    })),
  }
}

export function formulaPayload(
  formula: ProductFormulaDraft | null | undefined,
): FormulaPayload | undefined {
  if (!formula) return undefined
  return {
    baseOutputQuantity: formula.baseOutputQuantity.trim(),
    ...(formula.sourceType ? { sourceType: formula.sourceType } : {}),
    ...(formula.sourceDocumentId
      ? { sourceDocumentId: formula.sourceDocumentId }
      : {}),
    ...(formula.sourceDocumentNo
      ? { sourceDocumentNo: formula.sourceDocumentNo }
      : {}),
    components: formula.components.map((component) => ({
      material: {
        objectId: component.material!.objectId,
        versionId: component.material!.versionId,
      },
      quantity: component.quantity.trim(),
    })),
  }
}
