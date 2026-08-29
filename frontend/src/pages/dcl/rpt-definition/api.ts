import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import type { ApprovalStatus } from '@/api/generated'

export type RptDefinition = components['schemas']['DclRptDefinitionView']
export type RptDefinitionListItem =
  components['schemas']['DclRptDefinitionListItem']
export type RptDefinitionVersion =
  components['schemas']['DclRptDefinitionVersionView']
export type RptDefinitionData = components['schemas']['RptVersionData']
export type RptDefinitionAuditEvent =
  components['schemas']['ApprovalEventView']

export async function queryRptDefinitions(input: {
  keyword?: string
  status?: ApprovalStatus[]
  includeDisabled?: boolean
  page: number
  pageSize: number
}) {
  return apiClient.postContract('dcl/rpt-definition/query', {
    page: input.page,
    pageSize: input.pageSize,
    filters: {
      ...(input.keyword ? { keyword: input.keyword } : {}),
      ...(input.status?.length ? { status: input.status } : {}),
      ...(input.includeDisabled ? { includeDisabled: true } : {}),
    },
    sort: [{ field: 'code', order: 'asc' }],
  })
}

export function getRptDefinition(code: string, approvalEntryId?: string) {
  return apiClient.postContract('dcl/rpt-definition/get', {
    code,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
}

export function createRptDefinition(input: {
  name: string
  description: string
  enabled: boolean
  data: RptDefinitionData
}) {
  return apiClient.postContract('dcl/rpt-definition/create', input)
}

export function saveRptDefinition(input: RptDefinition) {
  return apiClient.postContract('dcl/rpt-definition/save', {
    code: input.code,
    approvalEntryId: input.approval.approvalEntryId,
    approvalRevision: input.approval.revision,
    name: input.name,
    description: input.description,
    enabled: input.enabled,
    data: input.data,
  })
}

export function runRptDefinitionVersionAction(
  action: 'submit' | 'approve' | 'create-next',
  definition: RptDefinition,
  validationParameters: Record<string, unknown> = {},
) {
  const input = {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
    ...(action === 'submit' || action === 'approve'
      ? { validationParameters }
      : {}),
  }
  if (action === 'submit')
    return apiClient.postContract('dcl/rpt-definition/submit', input)
  if (action === 'approve')
    return apiClient.postContract('dcl/rpt-definition/approve', input)
  return apiClient.postContract('dcl/rpt-definition/create-next', input)
}

export function runRptDefinitionReviewAction(
  action: 'unsubmit' | 'reject' | 'unapprove',
  definition: RptDefinition,
  reason: string,
) {
  const input = {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
    reason: reason || null,
  }
  if (action === 'unsubmit')
    return apiClient.postContract('dcl/rpt-definition/unsubmit', input)
  if (action === 'reject')
    return apiClient.postContract('dcl/rpt-definition/reject', input)
  return apiClient.postContract('dcl/rpt-definition/unapprove', input)
}

export function deleteRptDefinitionVersion(definition: RptDefinition) {
  return apiClient.postContract('dcl/rpt-definition/delete-version', {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
  })
}

export function setRptDefinitionEnabled(
  definition: RptDefinition,
  enabled: boolean,
) {
  const input = {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
  }
  return enabled
    ? apiClient.postContract('dcl/rpt-definition/enable', input)
    : apiClient.postContract('dcl/rpt-definition/disable', input)
}

export function getRptDefinitionVersions(code: string) {
  return apiClient.postContract('dcl/rpt-definition/versions', {
    code,
    page: 1,
    pageSize: 100,
  })
}

export function getRptDefinitionAuditHistory(code: string) {
  return apiClient.postContract('dcl/rpt-definition/audit-history', {
    code,
    page: 1,
    pageSize: 100,
  })
}
