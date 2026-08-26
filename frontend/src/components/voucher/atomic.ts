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
    status: view.approval.status,
    revision: view.approval.revision,
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
    createdAt: view.approval.createdAt,
    createdBy: view.approval.createdBy,
    updatedAt: view.approval.updatedAt,
    updatedBy: view.approval.updatedBy,
    approvedAt: view.approval.approvedAt ?? undefined,
    approvedBy: view.approval.approvedBy ?? undefined,
    parentDocumentId: view.parentDocumentId,
  }
}
