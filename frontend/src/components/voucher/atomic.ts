import type {
  VouAtomicDocument,
  VoucherDocumentData,
  VoucherDocumentView,
  VoucherExpenseLineView,
  VoucherManagedLineView,
  VoucherProductLineView,
  VoucherStatus,
} from './types'

export type VoucherAtomicDocument = VouAtomicDocument<
  VoucherDocumentData,
  VoucherProductLineView | VoucherExpenseLineView | VoucherManagedLineView,
  VoucherStatus
>

export function toVouAtomicDocument(
  view: VoucherDocumentView,
): VoucherAtomicDocument {
  return {
    documentId: view.documentId,
    documentNo: view.documentNo,
    entity: view.entity,
    status: view.status,
    revision: view.revision,
    businessDate: view.data.businessDate,
    currency: view.data.currency,
    amount: view.amount,
    data: view.data,
    lines: [
      ...(view.data.productLines ?? []),
      ...(view.data.expenseLines ?? []),
      ...(view.data.lines ?? []),
    ],
    attachments: view.attachments,
    createdAt: view.createdAt,
    createdBy: view.createdBy,
    updatedAt: view.updatedAt,
    updatedBy: view.updatedBy,
    checkedAt: view.checkedAt,
    checkedBy: view.checkedBy,
    approvedAt: view.approvedAt,
    approvedBy: view.approvedBy,
    finalizedAt: view.finalizedAt,
    finalizedBy: view.finalizedBy,
    parentDocumentId: view.parentDocumentId,
  }
}
