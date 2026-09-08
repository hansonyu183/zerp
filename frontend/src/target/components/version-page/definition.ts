import type { EditField, EditFields } from '../direct-page/definition.ts'
import type { ArchiveAuditEvent, ArchiveSubmission } from './metadata.ts'
import type { ArchiveSubmissionCommand } from './metadata.ts'

import type * as api from '../../api.ts'
import type { WflData } from './wfl-data.ts'
export type VersionSnapshots = {
  'bob/supplier': api.TargetSupplierSubmitInput['snapshot']
  'bob/other-unit': api.TargetOtherUnitSubmitInput['snapshot']
  'bob/sales-partner': api.TargetSalesPartnerSubmitInput['snapshot']
  'bob/customer': api.TargetCustomerSubmitInput['snapshot']
  'bob/product': api.TargetProductSubmitInput['snapshot']
  'wfl/process-definition': WflData
}
export type VersionResource = keyof VersionSnapshots

export type VersionQuery = { keyword: string; page: number; pageSize: number }
export type VersionCurrent<T> = {
  objectId: string
  code: string
  name: string
  revision?: string
  sourceApprovalEntryId?: string
  enabled: boolean
  data: T
}
export type VersionSubmission<T> = Omit<
  ArchiveSubmission,
  'snapshot' | 'entity' | 'versionNo' | 'submittedAt'
> & {
  entity: VersionResource extends `${string}/${infer E}` ? E : never
  versionNo: number | null
  submittedAt?: string
  snapshot: T
  enabled?: boolean
  runtimeRevision?: string | null
  availableRuntimeActions?: readonly ('enable' | 'disable')[]
}
export type VersionSubmissionItem<T> = {
  subjectId: string
  code: string | null
  latestApproved: Omit<VersionSubmission<T>, 'snapshot'> | null
  openCandidate: Omit<VersionSubmission<T>, 'snapshot'> | null
}
export type VersionReview = {
  subjectId: string
  submissionId: string
  expectedRevision: string
}
export type VersionAdapter<T> = {
  empty: () => T
  clone: (snapshot: T) => T
  validate: (snapshot: T) => string | null
  query: (
    token: string,
    input: VersionQuery,
  ) => Promise<{ items: readonly VersionCurrent<T>[]; total: number }>
  current: (token: string, id: string) => Promise<VersionCurrent<T>>
  submissions: (
    token: string,
    input: VersionQuery,
  ) => Promise<{ items: readonly VersionSubmissionItem<T>[]; total: number }>
  submission: (
    token: string,
    input: { subjectId: string; submissionId: string },
  ) => Promise<VersionSubmission<T>>
  versions: (
    token: string,
    id: string,
  ) => Promise<{ items: readonly VersionSubmission<T>[] }>
  audit: (token: string, id: string) => Promise<readonly ArchiveAuditEvent[]>
  submitNew: (
    token: string,
    input: ArchiveSubmissionCommand<T>,
  ) => Promise<unknown>
  submitChange: (
    token: string,
    input: ArchiveSubmissionCommand<T>,
  ) => Promise<unknown>
  approve: (
    token: string,
    input: VersionReview,
  ) => Promise<VersionSubmission<T>>
  reject: (
    token: string,
    input: VersionReview & { reason: string },
  ) => Promise<VersionSubmission<T>>
  unreject: (
    token: string,
    input: VersionReview,
  ) => Promise<VersionSubmission<T>>
  unapprove: (
    token: string,
    input: VersionReview & { reason: string },
  ) => Promise<VersionSubmission<T>>
  delete: (token: string, input: VersionReview) => Promise<unknown>
  setEnabled?: (
    token: string,
    item: VersionCurrent<T> & { revision: string },
    enabled: boolean,
  ) => Promise<unknown>
  setVersionEnabled?: (
    token: string,
    item: VersionSubmission<T>,
    enabled: boolean,
  ) => Promise<VersionSubmission<T>>
}
export type VersionDefinition = {
  kind: 'version'
  resource: VersionResource
  fields: readonly EditField[]
  adapter: VersionAdapter<Record<string, unknown>>
}
export function defineVersionPage<R extends VersionResource>(definition: {
  resource: R
  fields: EditFields<VersionSnapshots[R]>
  adapter: VersionAdapter<VersionSnapshots[R]>
}): VersionDefinition {
  // Each registered snapshot and its fields/adapter are checked together before registry erasure.
  return { kind: 'version', ...definition } as unknown as VersionDefinition
}
