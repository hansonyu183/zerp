import type { PermissionPathMapping } from '../app/bootstrap.ts'

export const customerPermissionMappings: readonly PermissionPathMapping[] = [
  'query',
  'get',
  'versions',
  'audit-history',
  'submit-new',
  'submit-change',
  'approve',
  'reject',
  'unreject',
  'unapprove',
  'delete',
  'save-subunits',
  'attachment-stage',
  'attachment-cleanup',
].map((action) => ({
  from: `/dcl/customer/${action}`,
  to: [
    `/bob/customer/${action === 'query' ? 'submission-query' : action === 'get' ? 'submission-get' : action}`,
  ],
}))
