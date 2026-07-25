import type {
  VouAtomicDocument,
  VoucherDocumentData,
  VoucherDocumentView,
  VoucherExpenseLineView,
  VoucherProductLineView,
  VoucherStatus,
} from './types'

export type VoucherAtomicDocument = VouAtomicDocument<
  VoucherDocumentData,
  VoucherProductLineView | VoucherExpenseLineView,
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
    amount: view.amount,
    data: view.data,
    lines: [
      ...(view.data.productLines ?? []),
      ...(view.data.expenseLines ?? []),
    ],
    attachments: view.attachments,
    createdAt: view.createdAt,
    createdBy: view.createdBy,
    updatedAt: view.updatedAt,
    updatedBy: view.updatedBy,
    reviewedAt: view.reviewedAt,
    reviewedBy: view.reviewedBy,
    approvedAt: view.approvedAt,
    approvedBy: view.approvedBy,
    executedAt: view.executedAt,
    executedBy: view.executedBy,
  }
}
