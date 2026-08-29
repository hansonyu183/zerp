import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import type { ApprovalStatus } from '@/api/generated'

export type DclWflProcessDefinition =
  components['schemas']['DclWflProcessDefinitionView']
export type DclWflProcessDefinitionListItem =
  components['schemas']['DclWflProcessDefinitionListItem']
export type DclWflProcessDefinitionVersionView =
  components['schemas']['DclWflProcessDefinitionVersionView']
export type DclWflProcessDefinitionMutation =
  components['schemas']['DclWflProcessDefinitionMutation']
export type DclWflProcessDefinitionAuditEvent =
  components['schemas']['ApprovalEventView']
export type WflDefinitionTrialResult =
  components['schemas']['WflDefinitionTrialResult']
export type WflDefinitionDiagnostic =
  components['schemas']['WflDefinitionDiagnostic']
export type VouEntity = components['schemas']['VouEntity']

export async function queryDclWflProcessDefinitions(input: {
  keyword?: string
  status?: ApprovalStatus[]
  includeDisabled?: boolean
  page: number
  pageSize: number
}) {
  return apiClient.postContract('dcl/wfl-process-definition/query', {
    page: input.page,
    pageSize: input.pageSize,
    filters: {
      ...(input.keyword ? { keyword: input.keyword } : {}),
      ...(input.status?.length ? { status: input.status } : {}),
      ...(input.includeDisabled ? { includeDisabled: true } : {}),
    },
    sort: [{ field: 'code' as const, order: 'asc' as const }],
  })
}

export function getDclWflProcessDefinition(
  code: string,
  approvalEntryId?: string,
) {
  return apiClient.postContract('dcl/wfl-process-definition/get', {
    code,
    ...(approvalEntryId ? { approvalEntryId } : {}),
  })
}

export function createDclWflProcessDefinition(script: string) {
  return apiClient.postContract('dcl/wfl-process-definition/create', {
    script,
  })
}

export function saveDclWflProcessDefinition(input: {
  code: string
  approvalEntryId: string
  approvalRevision: number
  script: string
}) {
  return apiClient.postContract('dcl/wfl-process-definition/save', input)
}

export function submitDclWflProcessDefinition(
  definition: DclWflProcessDefinition,
) {
  return apiClient.postContract('dcl/wfl-process-definition/submit', {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
  })
}

export function unsubmitDclWflProcessDefinition(
  definition: DclWflProcessDefinition,
) {
  return apiClient.postContract('dcl/wfl-process-definition/unsubmit', {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
  })
}

export function rejectDclWflProcessDefinition(
  definition: DclWflProcessDefinition,
  reason: string,
) {
  return apiClient.postContract('dcl/wfl-process-definition/reject', {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
    reason,
  })
}

export function approveDclWflProcessDefinition(
  definition: DclWflProcessDefinition,
) {
  return apiClient.postContract('dcl/wfl-process-definition/approve', {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
  })
}

export function unapproveDclWflProcessDefinition(
  definition: DclWflProcessDefinition,
  reason: string,
) {
  return apiClient.postContract('dcl/wfl-process-definition/unapprove', {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
    reason,
  })
}

export function deleteDclWflProcessDefinitionVersion(
  definition: DclWflProcessDefinition,
) {
  return apiClient.postContract('dcl/wfl-process-definition/delete-version', {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
  })
}

export function createNextDclWflProcessDefinitionVersion(
  definition: DclWflProcessDefinition,
) {
  return apiClient.postContract('dcl/wfl-process-definition/create-next', {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
  })
}

export function setDclWflProcessDefinitionEnabled(
  definition: DclWflProcessDefinition,
  enabled: boolean,
) {
  const input = {
    code: definition.code,
    approvalEntryId: definition.approval.approvalEntryId,
    approvalRevision: definition.approval.revision,
  }
  return enabled
    ? apiClient.postContract('dcl/wfl-process-definition/enable', input)
    : apiClient.postContract('dcl/wfl-process-definition/disable', input)
}

export function getDclWflProcessDefinitionVersions(code: string) {
  return apiClient.postContract('dcl/wfl-process-definition/versions', {
    code,
    page: 1,
    pageSize: 100,
  })
}

export function getDclWflProcessDefinitionAuditHistory(code: string) {
  return apiClient.postContract('dcl/wfl-process-definition/audit-history', {
    code,
    page: 1,
    pageSize: 100,
  })
}

export function trialWflProcessDefinition(input: {
  definitionId: string
  approvalEntryId: string
  revision: number
  source: { entity: VouEntity; documentId: string }
}) {
  return apiClient.postContract('wfl/process-definition/trial', input)
}
