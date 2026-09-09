import { businessDate } from './business-date.ts'
import {
  productionSuggestedQuantity,
  type VouFormulaInput,
  type VouPayloadFor,
  type VouAttachmentMetadata,
  type ProductUnitSnapshot,
} from '@zerp/model'
import type { VouCandidate } from './VouReference.vue'
import type { SourceLineChoice } from './SourceLinePicker.vue'
export type ProductionEntity = 'order-production' | 'self-production'
export type ProductionMaterial = {
  formulaLineNo: number
  actual: VouCandidate | null
  unitId: string
  units: ProductUnitSnapshot[]
  enteredQuantity: string
  baseQuantity: string
  adjustmentReason: string
  edited: boolean
}
export type ProductionLine = {
  id: string
  source: SourceLineChoice | null
  product: VouCandidate | null
  formula: VouFormulaInput | null
  enteredQuantity: string
  baseQuantity: string
  lossRate: string
  remark: string
  materials: ProductionMaterial[]
}
export type ProductionDraft = {
  entity: ProductionEntity
  businessDate: string
  remark: string
  materialWarehouse: VouCandidate | null
  finishedWarehouse: VouCandidate | null
  lines: ProductionLine[]
  attachments: VouAttachmentMetadata[]
}
export function emptyProduction(entity: ProductionEntity): ProductionDraft {
  return {
    entity,
    businessDate: businessDate(),
    remark: '',
    materialWarehouse: null,
    finishedWarehouse: null,
    lines: [],
    attachments: [],
  }
}
export function emptyProductionLine(id: string): ProductionLine {
  return {
    id,
    source: null,
    product: null,
    formula: null,
    enteredQuantity: '',
    baseQuantity: '',
    lossRate: '0',
    remark: '',
    materials: [],
  }
}
export function productionMaterials(
  formula: VouFormulaInput,
): ProductionMaterial[] {
  return formula.components.map((row, index) => ({
    formulaLineNo: index + 1,
    actual: {
      entity: 'product',
      objectId: row.material.objectId,
      code: '',
      name: '原配方材料',
    },
    unitId: row.quantity.enteredUnit.objectId,
    units: [
      {
        id: row.quantity.enteredUnit.objectId,
        code: row.quantity.enteredUnit.code,
        name: row.quantity.enteredUnit.name,
        symbol: row.quantity.enteredUnit.symbol,
        quantityScale: row.quantity.enteredUnit.quantityScale,
      },
    ],
    enteredQuantity: row.quantity.enteredQuantity,
    baseQuantity: row.quantity.baseQuantity,
    adjustmentReason: '',
    edited: false,
  }))
}
export function suggestedMaterial(
  line: ProductionLine,
  material: ProductionMaterial,
): string {
  const original = line.formula?.components[material.formulaLineNo - 1]
  if (!original || !line.formula) return ''
  try {
    return productionSuggestedQuantity(
      original.quantity.baseQuantity,
      line.formula.output.baseQuantity,
      line.baseQuantity,
      line.lossRate,
    )
  } catch {
    return ''
  }
}
export function refreshProductionMaterials(
  line: ProductionLine,
): ProductionMaterial[] {
  return line.materials.map((row) => {
    if (row.edited || !line.formula) return row
    const original = line.formula.components[row.formulaLineNo - 1]
    if (!original) return row
    try {
      return {
        ...row,
        baseQuantity: suggestedMaterial(line, row),
        enteredQuantity: productionSuggestedQuantity(
          original.quantity.enteredQuantity,
          line.formula.output.baseQuantity,
          line.baseQuantity,
          line.lossRate,
        ),
      }
    } catch {
      return row
    }
  })
}
export function productionPayload(
  draft: ProductionDraft,
): VouPayloadFor<ProductionEntity> {
  if (!draft.materialWarehouse || !draft.finishedWarehouse)
    throw new Error('请选择材料仓库和成品仓库。')
  if (!draft.lines.length || draft.lines.length > 200)
    throw new Error('请填写一至两百条成品行。')
  const decimal = (value: string) => /^\d+(?:\.\d{1,6})?$/.test(value)
  const positive = (value: string) => decimal(value) && /[1-9]/.test(value)
  const productionLines = draft.lines.map((row) => {
    if (!row.formula || !row.product)
      throw new Error('请选择成品及其可用配方。')
    if (
      !positive(row.enteredQuantity) ||
      !positive(row.baseQuantity) ||
      !decimal(row.lossRate)
    )
      throw new Error('请填写有效成品数量与损耗百分比。')
    if (draft.entity === 'order-production' && !row.source)
      throw new Error('请选择订单来源行。')
    return {
      ...(row.source ? { sourceOrderLineId: row.source.sourceLineId } : {}),
      product: { objectId: row.product.objectId },
      enteredQuantity: row.enteredQuantity,
      enteredUnit: { objectId: row.formula.output.enteredUnit.objectId },
      baseQuantity: row.baseQuantity,
      lossRate: row.lossRate,
      remark: row.remark,
      materials: row.materials.map((material) => {
        const original = row.formula!.components[material.formulaLineNo - 1],
          suggested = suggestedMaterial(row, material)
        if (
          !material.actual ||
          !material.unitId ||
          !positive(material.baseQuantity) ||
          !positive(material.enteredQuantity) ||
          !suggested
        )
          throw new Error('请填写有效材料、单位与实际领料数量。')
        const normalize = (value: string) => {
          const [a, b = ''] = value.split('.')
          return BigInt(a!) * 1000000n + BigInt(b.padEnd(6, '0'))
        }
        if (
          (material.actual.objectId !== original?.material.objectId ||
            normalize(material.baseQuantity) !== normalize(suggested)) &&
          !material.adjustmentReason.trim()
        )
          throw new Error('替换材料或调整数量必须填写调整原因。')
        return {
          formulaLineNo: material.formulaLineNo,
          actualMaterial: { objectId: material.actual.objectId },
          actualEnteredQuantity: material.enteredQuantity,
          actualEnteredUnit: { objectId: material.unitId },
          actualBaseQuantity: material.baseQuantity,
          adjustmentReason: material.adjustmentReason,
        }
      }),
    }
  })
  const roots = new Set(draft.lines.map((row) => row.source?.rootDocumentId))
  if (draft.entity === 'order-production' && roots.size !== 1)
    throw new Error('生产配货只能选择同一销售订单的来源行。')
  return {
    businessDate: draft.businessDate,
    currency: '',
    remark: draft.remark,
    attachments: draft.attachments,
    materialWarehouse: { objectId: draft.materialWarehouse.objectId },
    finishedWarehouse: { objectId: draft.finishedWarehouse.objectId },
    ...(draft.entity === 'order-production'
      ? {
          parentEntity: 'sale-order' as const,
          parentDocumentId: draft.lines[0]!.source!.rootDocumentId,
        }
      : {}),
    productionLines,
  }
}
export function cloneProduction(
  entity: ProductionEntity,
  payload: VouPayloadFor<ProductionEntity>,
  ids: readonly string[],
): ProductionDraft {
  const warehouse = (
    value: typeof payload.materialWarehouse,
  ): VouCandidate => ({
    entity: 'warehouse',
    objectId: value.objectId,
    code: value.code ?? '',
    name: value.name ?? '已采用仓库',
  })
  return {
    ...emptyProduction(entity),
    businessDate: payload.businessDate,
    remark: payload.remark ?? '',
    materialWarehouse: warehouse(payload.materialWarehouse),
    finishedWarehouse: warehouse(payload.finishedWarehouse),
    lines: payload.productionLines.map((row, index) => ({
      id: ids[index]!,
      source:
        entity === 'order-production' &&
        payload.parentDocumentId &&
        row.sourceOrderLineId
          ? {
              sourceDocumentId: payload.parentDocumentId,
              sourceLineId: row.sourceOrderLineId,
              rootEntity: 'sale-order',
              rootDocumentId: payload.parentDocumentId,
            }
          : null,
      product: row.product
        ? {
            entity: 'product',
            objectId: row.product.objectId,
            code: '',
            name: '已采用成品',
          }
        : null,
      formula: row.formulaSnapshot ?? null,
      enteredQuantity: row.enteredQuantity,
      baseQuantity: row.baseQuantity,
      lossRate: row.lossRate,
      remark: row.remark ?? '',
      materials: row.materials.map((material) => {
        const original =
          row.formulaSnapshot?.components[material.formulaLineNo - 1]
        const unit = original?.quantity.enteredUnit
        return {
          formulaLineNo: material.formulaLineNo,
          actual: {
            entity: 'product',
            objectId: material.actualMaterial.objectId,
            code: '',
            name: '已采用材料',
          },
          unitId: material.actualEnteredUnit.objectId,
          units: unit
            ? [
                {
                  id: material.actualEnteredUnit.objectId,
                  code: '',
                  name: '已采用单位',
                  symbol: unit.symbol,
                  quantityScale: unit.quantityScale,
                },
              ]
            : [],
          enteredQuantity: material.actualEnteredQuantity,
          baseQuantity: material.actualBaseQuantity,
          adjustmentReason: material.adjustmentReason ?? '',
          edited: true,
        }
      }),
    })),
  }
}
