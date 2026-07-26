import { localDate } from '@/utils/date'
import type {
  IntermediaryChildDetail,
  IntermediaryDeliveryData,
  IntermediaryDeliveryDraft,
  IntermediaryProcurementData,
  IntermediaryProcurementDraft,
  IntermediaryProcurementLineView,
  IntermediaryQuantityLineView,
  IntermediaryReceiptData,
  IntermediaryReceiptDraft,
  IntermediarySignoffData,
  IntermediarySignoffDraft,
  IntermediarySignoffLineView,
} from './types'

export function procurementDraftFromDetail(
  detail: IntermediaryChildDetail,
): IntermediaryProcurementDraft {
  const data = detail.data as IntermediaryProcurementData
  return {
    purchaseDate: data.purchaseDate,
    supplier: { ...data.supplier },
    purchaser: { ...data.purchaser },
    lines: (detail.lines as IntermediaryProcurementLineView[]).map((line) => ({
      rootLineId: line.rootLineId,
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? '',
      remark: line.remark ?? '',
    })),
    remark: data.remark ?? '',
  }
}

export function receiptDraftFromDetail(
  detail: IntermediaryChildDetail,
): IntermediaryReceiptDraft {
  const data = detail.data as IntermediaryReceiptData
  return {
    receiptDate: data.receiptDate,
    lines: (detail.lines as IntermediaryQuantityLineView[]).map((line) => ({
      rootLineId: line.rootLineId,
      quantity: line.quantity,
      remark: line.remark ?? '',
    })),
    remark: data.remark ?? '',
  }
}

export function deliveryDraftFromDetail(
  detail: IntermediaryChildDetail,
): IntermediaryDeliveryDraft {
  const data = detail.data as IntermediaryDeliveryData
  return {
    deliveryDate: data.deliveryDate,
    platform: { ...data.platform },
    vehicle: { ...data.vehicle },
    lines: (detail.lines as IntermediaryQuantityLineView[]).map((line) => ({
      rootLineId: line.rootLineId,
      quantity: line.quantity,
      remark: line.remark ?? '',
    })),
    remark: data.remark ?? '',
  }
}

export function signoffDraftFromDetail(
  detail: IntermediaryChildDetail,
): IntermediarySignoffDraft {
  const data = detail.data as IntermediarySignoffData
  return {
    deliveryChildId: data.deliveryChildId,
    signoffDate: data.signoffDate,
    lines: (detail.lines as IntermediarySignoffLineView[]).map((line) => ({
      rootLineId: line.rootLineId,
      signedQuantity: line.signedQuantity,
      rejectedQuantity: line.rejectedQuantity,
      remark: line.remark ?? '',
    })),
    returnedSolventContainers: data.returnedSolventContainers,
    returnedResinContainers: data.returnedResinContainers,
    containerDifferenceReason: data.containerDifferenceReason ?? '',
    remark: data.remark ?? '',
  }
}

export function signoffDraftFromDelivery(
  detail: IntermediaryChildDetail,
): IntermediarySignoffDraft {
  const data = detail.data as IntermediaryDeliveryData
  return {
    deliveryChildId: detail.child.childId,
    signoffDate: localDate(),
    lines: (detail.lines as IntermediaryQuantityLineView[]).map((line) => ({
      rootLineId: line.rootLineId,
      signedQuantity: line.quantity,
      rejectedQuantity: '0',
      remark: '',
    })),
    returnedSolventContainers: data.expectedSolventContainers,
    returnedResinContainers: data.expectedResinContainers,
    containerDifferenceReason: '',
    remark: '',
  }
}
