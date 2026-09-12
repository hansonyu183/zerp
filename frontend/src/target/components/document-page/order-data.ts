import { businessDate } from './business-date.ts'
import type {
  TargetOrderEntity,
  TargetOrderInput,
  resolveTargetProduct,
} from '../../api.ts'
import type { ProductSnapshot } from '../version-page/product-data.ts'
import type { VouCandidate } from './VouReference.vue'
import type {
  VouProductLineInput,
  VouPaymentMethodSelectionInput,
} from '@zerp/model'
export type OrderProduct = Awaited<ReturnType<typeof resolveTargetProduct>>
export type OrderLine = {
  lineId: string
  product: VouCandidate | null
  current: OrderProduct | null
  enteredQuantity: string
  unitId: string
  baseQuantity: string
  unitPrice: string
  settlementSurcharge: string | null
  remark: string
  formula: VouProductLineInput['formula']
  formulaDraft: ProductSnapshot['fixedFormula']
  deliverySpecificationType: 'PACKAGED' | 'BULK_LIQUID'
  quantityPerContainer: string
  containerType: string
}
export type OrderDraft = {
  entity: TargetOrderEntity
  businessDate: string
  currency: string
  remark: string
  counterparty: VouCandidate | null
  selectionOrigin: 'CURRENT' | 'HISTORICAL'
  warehouse: VouCandidate | null
  employee: VouCandidate | null
  operatingEntity: VouCandidate | null
  paymentMethod: VouPaymentMethodSelectionInput | null
  lines: OrderLine[]
  attachments: import('@zerp/model').VouAttachmentMetadata[]
  creditOverrideReason: string
  specialApproval: boolean
}
export function emptyOrder(entity: TargetOrderEntity): OrderDraft {
  return {
    entity,
    businessDate: businessDate(),
    currency: 'CNY',
    remark: '',
    counterparty: null,
    selectionOrigin: 'CURRENT',
    warehouse: null,
    employee: null,
    operatingEntity: null,
    paymentMethod: null,
    lines: [],
    attachments: [],
    creditOverrideReason: '',
    specialApproval: false,
  }
}
export function unitSnapshot(
  unit: NonNullable<OrderProduct['data']>['defaultInputUnit'],
) {
  return {
    objectId: unit.id,
    code: unit.code,
    name: unit.name,
    symbol: unit.symbol,
    quantityScale: unit.quantityScale,
  }
}
export function orderPayload(
  draft: OrderDraft,
): TargetOrderInput<TargetOrderEntity>['payload'] {
  if (
    !draft.counterparty ||
    !('approvalEntryId' in draft.counterparty) ||
    !draft.counterparty.approvalEntryId ||
    !draft.warehouse?.objectId
  )
    throw new Error('请选择相对方与仓库。')
  if (!draft.lines.length) throw new Error('至少添加一条商品行。')
  const productLines = draft.lines.map((line, index): VouProductLineInput => {
    const unit = line.current?.data.unitConversions.find(
      (item) => item.unit.id === line.unitId,
    )?.unit
    if (!line.product || !line.current || !unit)
      throw new Error(`商品行第 ${index + 1} 行：请选择可用产品及其单位。`)
    for (const value of [line.enteredQuantity, line.baseQuantity])
      if (!/^\d+(?:\.\d{1,6})?$/.test(value) || !/[1-9]/.test(value))
        throw new Error(
          `商品行第 ${index + 1} 行：填写正数数量，最多六位小数。`,
        )
    if (
      (line.enteredQuantity.split('.')[1] ?? '').replace(/0+$/, '').length >
      unit.quantityScale
    )
      throw new Error(`商品行第 ${index + 1} 行：录入数量超出单位精度。`)
    if (!/^\d+(?:\.\d{1,2})?$/.test(line.unitPrice))
      throw new Error(`商品行第 ${index + 1} 行：填写基础单价，最多两位小数。`)
    if (
      line.formulaDraft?.components.some(
        (item) =>
          item.requiresConfirmation || item.resolutionStatus !== 'CURRENT',
      )
    )
      throw new Error(
        `商品行第 ${index + 1} 行：配方原料尚未确认，请重新选择。`,
      )
    const sale = draft.entity === 'sale-order',
      packaging = line.current.data.productType.behaviorProfile === 'PACKAGING'
    if (sale && !packaging && !line.formula?.components.length)
      throw new Error(`商品行第 ${index + 1} 行：非包装产品必须填写完整配方。`)
    return {
      lineId: line.lineId,
      product: { objectId: line.product.objectId },
      enteredQuantity: line.enteredQuantity,
      enteredUnit: unitSnapshot(unit),
      baseQuantity: line.baseQuantity,
      unitPrice: line.unitPrice,
      remark: line.remark,
      ...(sale
        ? {
            settlementSurcharge: packaging ? '0.00' : line.settlementSurcharge,
            formula: packaging ? null : line.formula,
            deliverySpecificationType: line.deliverySpecificationType,
            quantityPerContainer: line.quantityPerContainer || null,
            containerType: line.containerType || null,
          }
        : {}),
    }
  })
  const common = {
    businessDate: draft.businessDate,
    currency: draft.currency,
    remark: draft.remark,
    attachments: draft.attachments,
    warehouse: { objectId: draft.warehouse.objectId },
    productLines,
  }
  const reference = {
    objectId: draft.counterparty.objectId,
    approvalEntryId: draft.counterparty.approvalEntryId,
    selectionOrigin: draft.selectionOrigin,
  }
  if (draft.entity === 'purchase-order')
    return {
      ...common,
      supplier: reference,
      ...(draft.employee
        ? { purchaser: { objectId: draft.employee.objectId } }
        : {}),
    }
  if (!draft.operatingEntity) throw new Error('请选择经营主体。')
  return {
    ...common,
    customerSubunit: reference,
    ...(draft.specialApproval ? { specialApproval: true } : {}),
    operatingEntity: { objectId: draft.operatingEntity.objectId },
    paymentMethod: draft.paymentMethod,
    ...(draft.employee
      ? { salesperson: { objectId: draft.employee.objectId } }
      : {}),
    ...(draft.creditOverrideReason.trim()
      ? { creditOverrideReason: draft.creditOverrideReason.trim() }
      : {}),
  }
}

export function orderFormula(
  value: ProductSnapshot['fixedFormula'],
  source: NonNullable<VouProductLineInput['formula']>['sourceType'] = 'MANUAL',
): VouProductLineInput['formula'] {
  if (!value) return null
  return {
    sourceType: source,
    output: {
      ...value.output,
      enteredUnit: unitSnapshot(value.output.enteredUnit),
    },
    components: value.components.map((item) => ({
      material: { objectId: item.material.objectId },
      quantity: {
        ...item.quantity,
        enteredUnit: unitSnapshot(item.quantity.enteredUnit),
      },
    })),
  }
}
export function cloneOrder(
  entity: TargetOrderEntity,
  payload: TargetOrderInput<TargetOrderEntity>['payload'],
  lineIds: readonly string[],
): OrderDraft {
  const sales = 'customerSubunit' in payload
  const ref = sales ? payload.customerSubunit : payload.supplier
  const employee = sales ? payload.salesperson : payload.purchaser
  return {
    ...emptyOrder(entity),
    businessDate: payload.businessDate,
    currency: payload.currency,
    remark: payload.remark ?? '',
    counterparty: {
      entity: sales ? 'customer-subunit' : 'supplier',
      objectId: ref.objectId,
      approvalEntryId: ref.approvalEntryId,
      code: '',
      name: sales ? '已采用客户子单位' : '已采用供应商',
      ...(sales
        ? { customerId: '', paymentMethod: payload.paymentMethod }
        : {}),
    } as VouCandidate,
    selectionOrigin: 'HISTORICAL',
    warehouse: {
      entity: 'warehouse',
      objectId: payload.warehouse.objectId,
      code: payload.warehouse.code ?? '',
      name: payload.warehouse.name ?? '已采用仓库',
    },
    employee: employee
      ? {
          entity: 'employee',
          objectId: employee.objectId,
          code: employee.code ?? '',
          name: employee.name ?? '已采用员工',
        }
      : null,
    operatingEntity: sales
      ? {
          entity: 'operating-entity',
          objectId: payload.operatingEntity.objectId,
          code: payload.operatingEntity.code ?? '',
          name: payload.operatingEntity.name ?? '已采用经营主体',
        }
      : null,
    paymentMethod: sales ? payload.paymentMethod : null,
    creditOverrideReason: sales ? (payload.creditOverrideReason ?? '') : '',
    specialApproval: sales ? (payload.specialApproval ?? false) : false,
    lines: payload.productLines.map((line, index) => ({
      lineId: lineIds[index]!,
      product: {
        entity: 'product',
        objectId: line.product.objectId,
        code: '',
        name: '重新采用产品',
      },
      current: null,
      enteredQuantity: line.enteredQuantity,
      unitId: line.enteredUnit.objectId,
      baseQuantity: line.baseQuantity,
      unitPrice: line.unitPrice,
      settlementSurcharge: line.settlementSurcharge ?? null,
      remark: line.remark ?? '',
      formula: line.formula ?? null,
      formulaDraft: null,
      deliverySpecificationType: line.deliverySpecificationType ?? 'PACKAGED',
      quantityPerContainer: line.quantityPerContainer ?? '',
      containerType: line.containerType ?? '',
    })),
  }
}

export function formulaDraftFromWire(
  value: NonNullable<VouProductLineInput['formula']>,
): NonNullable<ProductSnapshot['fixedFormula']> {
  const quantity = (input: typeof value.output) => ({
    ...input,
    enteredUnit: {
      id: input.enteredUnit.objectId,
      code: input.enteredUnit.code,
      name: input.enteredUnit.name,
      symbol: input.enteredUnit.symbol,
      quantityScale: input.enteredUnit.quantityScale,
    },
  })
  return {
    output: quantity(value.output),
    components: value.components.map((item) => ({
      material: {
        objectId: item.material.objectId,
        approvalEntryId: '',
        code: '',
        name: '',
      },
      quantity: quantity(item.quantity),
      resolutionStatus: 'UNRESOLVED',
      requiresConfirmation: true,
    })),
  }
}
