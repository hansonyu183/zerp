import { isMoney, isQuantity, parseFixed } from '@/components/voucher/decimal'
import { calculateExpectedContainers, calculateLoss } from './calculations'
import { formatQuantity, remaining } from './model'
import type {
  IntermediaryChildDetail,
  IntermediaryChildStage,
  IntermediaryContainerBalance,
  IntermediaryDeliveryDraft,
  IntermediaryOrderDraft,
  IntermediaryProcurementDraft,
  IntermediaryQuantityLineView,
  IntermediaryReceiptDraft,
  IntermediarySignoffDraft,
  IntermediarySignoffLineView,
  IntermediaryStageDraft,
  IntermediaryWorkflowDocument,
} from './types'

export function validateOrderDraft(form: IntermediaryOrderDraft): string | null {
  if (!form.customer) return '请选择客户。'
  if (!form.businessDate) return '请选择订购日期。'
  if (!/^[A-Z]{3}$/.test(form.currency)) return '币种必须为三位大写字母。'
  if (form.productLines.length < 1 || form.productLines.length > 200) {
    return '产品明细必须为 1–200 行。'
  }
  const seen = new Set<string>()
  for (const line of form.productLines) {
    if (!line.product) return '请选择每一行的产品。'
    const key = `${line.product.objectId}/${line.product.versionId}`
    if (seen.has(key)) return '同一产品不能重复添加。'
    seen.add(key)
    if (!isQuantity(line.orderedQuantity)) return '订购数量格式不正确。'
    if (!isMoney(line.unitPrice)) return '销售单价格式不正确。'
    if (
      line.containerType !== 'NONE' &&
      !isQuantity(line.quantityPerContainer)
    ) {
      return '桶装产品必须填写大于零的每桶产品量。'
    }
    if (Array.from(line.remark).length > 1000) {
      return '行备注不能超过 1000 字。'
    }
  }
  return Array.from(form.remark).length <= 1000
    ? null
    : '备注不能超过 1000 字。'
}

export function deliveredQuantity(
  stage: IntermediaryChildStage,
  detail: IntermediaryChildDetail | null,
  rootLineId: string,
): string {
  if (stage === 'SIGNOFF' && detail?.child.stage === 'DELIVERY') {
    return (
      detail.lines as IntermediaryQuantityLineView[]
    ).find((line) => line.rootLineId === rootLineId)?.quantity ?? '0'
  }
  if (stage === 'SIGNOFF' && detail?.child.stage === 'SIGNOFF') {
    const balance = detail.balances.lines.find(
      (line) => line.rootLineId === rootLineId,
    )
    const signed = (
      detail.lines as IntermediarySignoffLineView[]
    ).find((line) => line.rootLineId === rootLineId)
    const total =
      (parseFixed(signed?.signedQuantity ?? '0', 6, true) ?? 0n) +
      (parseFixed(signed?.rejectedQuantity ?? '0', 6, true) ?? 0n) +
      (parseFixed(signed?.lossQuantity ?? '0', 6, true) ?? 0n)
    return total > 0n
      ? formatQuantity(total)
      : balance?.remainingToSignQuantity ?? '0'
  }
  return '0'
}

export function signoffLoss(
  stage: IntermediaryChildStage,
  detail: IntermediaryChildDetail | null,
  draft: IntermediarySignoffDraft | null,
  index: number,
): string | null {
  const line = draft?.lines[index]
  if (!line) return null
  return calculateLoss(
    deliveredQuantity(stage, detail, line.rootLineId),
    line.signedQuantity,
    line.rejectedQuantity,
  )
}

interface StageValidationInput {
  stage: IntermediaryChildStage
  draft: IntermediaryStageDraft | null
  document: IntermediaryWorkflowDocument | null
  detail: IntermediaryChildDetail | null
  signoffExpectedContainers: IntermediaryContainerBalance
}

export function validateStageDraft(input: StageValidationInput): string | null {
  const { stage, draft, document, detail, signoffExpectedContainers } = input
  if (!draft) return '未加载子单草稿。'
  if (stage === 'PROCUREMENT') {
    const value = draft as IntermediaryProcurementDraft
    if (!value.purchaseDate) return '请选择采购日期。'
    if (!value.supplier) return '请选择普通供应商。'
    let positive = false
    for (const line of value.lines) {
      const quantity = parseFixed(line.quantity, 6, true)
      const ordered = parseFixed(
        document?.productLines.find(
          (item) => item.lineId === line.rootLineId,
        )?.orderedQuantity ?? '',
        6,
        true,
      )
      if (quantity === null || ordered === null || quantity > ordered) {
        return '采购数量格式不正确或超过客户订购数量。'
      }
      if (quantity > 0n) {
        positive = true
        if (!isMoney(line.unitPrice)) return '采购单价格式不正确。'
      }
    }
    if (!positive) return '至少一行采购数量必须大于零。'
  } else if (stage === 'RECEIPT') {
    const value = draft as IntermediaryReceiptDraft
    if (!value.receiptDate) return '请选择收货日期。'
    let positive = false
    for (const line of value.lines) {
      const quantity = parseFixed(line.quantity, 6, true)
      const balance = document?.balances.lines.find(
        (item) => item.rootLineId === line.rootLineId,
      )
      const remainingValue = balance?.procurementQuantity
        ? parseFixed(
            remaining(
              balance.procurementQuantity,
              balance.confirmedReceiptQuantity,
            ),
            6,
            true,
          )
        : null
      if (
        quantity === null ||
        (remainingValue !== null && quantity > remainingValue)
      ) {
        return '本次实收数量格式不正确或超过剩余采购数量。'
      }
      if (quantity > 0n) positive = true
    }
    if (!positive) return '至少一行实收数量必须大于零。'
  } else if (stage === 'DELIVERY') {
    const value = draft as IntermediaryDeliveryDraft
    if (!value.deliveryDate) return '请选择送货日期。'
    if (!value.platform || !value.vehicle) return '请选择物流平台和送货车辆。'
    if (
      value.vehicle.platformObjectId &&
      value.vehicle.platformObjectId !== value.platform.objectId
    ) {
      return '送货车辆不属于所选物流平台。'
    }
    let positive = false
    for (const line of value.lines) {
      const quantity = parseFixed(line.quantity, 6, true)
      const available = parseFixed(
        document?.balances.lines.find(
          (item) => item.rootLineId === line.rootLineId,
        )?.availableToDeliverQuantity ?? '',
        6,
        true,
      )
      if (quantity === null || available === null || quantity > available) {
        return '本次送货数量格式不正确或超过当前可送数量。'
      }
      if (quantity > 0n) positive = true
    }
    if (!positive) return '至少一行送货数量必须大于零。'
    if (!calculateExpectedContainers(
      value.lines.map((line) => {
        const rootLine = document?.productLines.find(
          (item) => item.lineId === line.rootLineId,
        )
        return {
          quantity: line.quantity,
          containerType: rootLine?.containerType ?? 'NONE',
          quantityPerContainer: rootLine?.quantityPerContainer,
        }
      }),
    )) {
      return '无法根据包装快照计算应回收桶数。'
    }
  } else {
    const value = draft as IntermediarySignoffDraft
    if (!value.signoffDate) return '请选择签收日期。'
    for (const [index] of value.lines.entries()) {
      if (signoffLoss(stage, detail, value, index) === null) {
        return '签收数和拒收数格式不正确或超过送货数。'
      }
    }
    if (
      !Number.isInteger(value.returnedSolventContainers) ||
      value.returnedSolventContainers < 0 ||
      !Number.isInteger(value.returnedResinContainers) ||
      value.returnedResinContainers < 0
    ) {
      return '实收桶数必须为非负整数。'
    }
    if (
      (value.returnedSolventContainers < signoffExpectedContainers.solvent ||
        value.returnedResinContainers < signoffExpectedContainers.resin) &&
      !value.containerDifferenceReason.trim()
    ) {
      return '本次空桶少收时必须填写差异原因。'
    }
  }
  return Array.from(draft.remark).length <= 1000
    ? null
    : '备注不能超过 1000 字。'
}
