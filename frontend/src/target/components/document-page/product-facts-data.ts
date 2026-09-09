import { businessDate } from './business-date.ts'
import type { VouPayloadFor, VouAttachmentMetadata } from '@zerp/model'
import type { VouCandidate } from './VouReference.vue'
import { type OrderProduct } from './order-data.ts'
export type ProductFactsEntity =
  'purchase-inquiry' | 'inventory-count' | 'sale-pricing'
export type ProductFactLine = {
  id: string
  product: VouCandidate | null
  current: OrderProduct | null
  unitId: string
  enteredQuantity: string
  baseQuantity: string
  unitPrice: string
  remark: string
}
export type ProductFactsDraft = {
  entity: ProductFactsEntity
  businessDate: string
  currency: string
  remark: string
  supplier: VouCandidate | null
  selectionOrigin: 'CURRENT' | 'HISTORICAL'
  warehouse: VouCandidate | null
  lines: ProductFactLine[]
  attachments: VouAttachmentMetadata[]
}
export function emptyProductFacts(
  entity: ProductFactsEntity,
): ProductFactsDraft {
  return {
    entity,
    businessDate: businessDate(),
    currency: 'CNY',
    remark: '',
    supplier: null,
    selectionOrigin: 'CURRENT',
    warehouse: null,
    lines: [],
    attachments: [],
  }
}
export function productFactsPayload(
  draft: ProductFactsDraft,
): VouPayloadFor<ProductFactsEntity> {
  if (!draft.lines.length || draft.lines.length > 200)
    throw new Error('请填写一至两百条商品行。')
  if (
    new Set(draft.lines.map((line) => line.product?.objectId)).size !==
    draft.lines.length
  )
    throw new Error('商品行不得重复。')
  const base = {
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    attachments: draft.attachments,
  }
  if (draft.entity !== 'inventory-count') {
    const supplier = draft.supplier
    if (
      draft.entity === 'purchase-inquiry' &&
      (!supplier ||
        !('approvalEntryId' in supplier) ||
        !supplier.approvalEntryId)
    )
      throw new Error('请选择供应商。')
    return {
      ...base,
      ...(draft.entity === 'purchase-inquiry' &&
      supplier &&
      'approvalEntryId' in supplier
        ? {
            supplier: {
              objectId: supplier.objectId,
              approvalEntryId: supplier.approvalEntryId!,
              selectionOrigin: draft.selectionOrigin,
            },
          }
        : {}),
      priceLines: draft.lines.map((line) => {
        const product = line.product
        if (
          !product ||
          !('approvalEntryId' in product) ||
          !product.approvalEntryId
        )
          throw new Error('请选择产品。')
        if (
          !/^\d+(?:\.\d{1,2})?$/.test(line.unitPrice) ||
          !/[1-9]/.test(line.unitPrice)
        )
          throw new Error('单价必须大于零，最多两位小数。')
        return {
          product: {
            objectId: product.objectId,
            approvalEntryId: product.approvalEntryId,
            selectionOrigin: draft.selectionOrigin,
          },
          unitPrice: line.unitPrice,
          remark: line.remark,
        }
      }),
    }
  }
  if (!draft.warehouse) throw new Error('请选择仓库。')
  return {
    ...base,
    currency: 'CNY',
    warehouse: { objectId: draft.warehouse.objectId },
    inventoryCountLines: draft.lines.map((line) => {
      const unit = line.current?.data.unitConversions.find(
        (item) => item.unit.id === line.unitId,
      )?.unit
      if (!line.product || !unit) throw new Error('请选择产品及其单位。')
      if (
        ![line.enteredQuantity, line.baseQuantity].every((value) =>
          /^\d+(?:\.\d{1,6})?$/.test(value),
        )
      )
        throw new Error('实盘数量不得为负，最多六位小数。')
      if (
        (line.enteredQuantity.split('.')[1] ?? '').replace(/0+$/, '').length >
        unit.quantityScale
      )
        throw new Error('实盘数量超出单位精度。')
      return {
        product: { objectId: line.product.objectId },
        enteredQuantity: line.enteredQuantity,
        enteredUnit: { objectId: unit.id },
        baseQuantity: line.baseQuantity,
        remark: line.remark,
      }
    }),
  }
}
export function cloneProductFacts(
  entity: ProductFactsEntity,
  payload: VouPayloadFor<ProductFactsEntity>,
  ids: readonly string[],
): ProductFactsDraft {
  return {
    ...emptyProductFacts(entity),
    businessDate: payload.businessDate,
    currency: payload.currency,
    remark: payload.remark ?? '',
    selectionOrigin: 'HISTORICAL',
    supplier:
      'supplier' in payload
        ? {
            entity: 'supplier',
            objectId: payload.supplier.objectId,
            approvalEntryId: payload.supplier.approvalEntryId,
            code: '',
            name: '已采用供应商',
          }
        : null,
    warehouse:
      'warehouse' in payload
        ? {
            entity: 'warehouse',
            objectId: payload.warehouse.objectId,
            code: payload.warehouse.code ?? '',
            name: payload.warehouse.name ?? '已采用仓库',
          }
        : null,
    lines: ('priceLines' in payload
      ? payload.priceLines
      : payload.inventoryCountLines
    ).map((row, index) => ({
      id: ids[index]!,
      product: {
        entity: 'product',
        objectId: row.product.objectId,
        ...('approvalEntryId' in row.product
          ? { approvalEntryId: row.product.approvalEntryId }
          : {}),
        code: '',
        name: '已采用产品',
      },
      current: null,
      unitId: 'enteredUnit' in row ? row.enteredUnit.objectId : '',
      enteredQuantity: 'enteredQuantity' in row ? row.enteredQuantity : '',
      baseQuantity: 'baseQuantity' in row ? row.baseQuantity : '',
      unitPrice: 'unitPrice' in row ? row.unitPrice : '',
      remark: row.remark ?? '',
    })),
  }
}
