import type {
  TargetSupplierSubmitInput,
  getTargetSupplierSubmission,
  queryTargetSupplierAuditHistory,
} from '../../api.ts'
export type ArchiveSubmission = Pick<
  Awaited<ReturnType<typeof getTargetSupplierSubmission>>,
  | 'entity'
  | 'subjectId'
  | 'submissionId'
  | 'versionNo'
  | 'status'
  | 'revision'
  | 'submittedAt'
  | 'snapshot'
  | 'availableApprovalActions'
  | 'canDelete'
>
export type ArchiveApprovalAction =
  ArchiveSubmission['availableApprovalActions'][number]
export type ArchiveReviewAction = ArchiveApprovalAction | 'delete'
export type ArchiveAuditEvent = Awaited<
  ReturnType<typeof queryTargetSupplierAuditHistory>
>[number]
export type ArchiveSubmissionCommand<T> = Omit<
  TargetSupplierSubmitInput,
  'snapshot'
> & { snapshot: T }
export const archiveAuditActionPresentation = {
  SUBMITTED: '已提交',
  REJECTED: '已驳回',
  UNREJECTED: '已恢复审核',
  APPROVED: '已批准',
  UNAPPROVED: '已反批准',
  DELETED: '已删除',
} as const
