import type { ApprovalActor, ApprovalStatus } from './approval.ts'

export interface WarehouseManagerReference {
  employeeId: string
  approvalEntryId: string
  code: string
  displayName: string
}

export interface WarehouseData {
  name: string
  address: string
  contactName: string
  contactPhone: string
  manager?: WarehouseManagerReference
  remark: string
  enabled: boolean
}

export interface WarehouseSubmitCommand {
  action: 'submit-new' | 'submit-change'
  actor: ApprovalActor
  requestId: string
  occurredAt: string
  submissionId: string
  idempotencyKey: string
  subjectId: string
  expectedLatestApprovedSubmissionId: string | null
  expectedLatestApprovedRevision: string | null
  data: WarehouseData
}

export interface WarehouseVersionFact {
  entryId: string
  versionNo: number
  revision: string
  status: ApprovalStatus
}

export interface WarehouseSubjectFacts {
  exists: boolean
  history: readonly WarehouseVersionFact[]
}

export interface WarehouseManagerFact {
  employeeId: string
  latestApprovedEntryId: string
  code: string
  displayName: string
  enabled: boolean
}

export interface WarehouseSubmitFacts {
  subject: WarehouseSubjectFacts
  manager?: WarehouseManagerFact
}

export type WarehouseSubmitErrorKey =
  | 'approval_invalid_actor'
  | 'approval_invalid_action'
  | 'approval_no_approved_version'
  | 'approval_open_version_exists'
  | 'warehouse_invalid_data'
  | 'warehouse_invalid_history'
  | 'warehouse_reference_stale'
  | 'warehouse_reference_unavailable'
  | 'warehouse_stale_facts'
  | 'warehouse_submit_mode_mismatch'

export interface WarehouseReferenceBlocker {
  field: 'manager'
  objectId: string
  expectedApprovalEntryId: string
  currentApprovalEntryId?: string
}

export interface WarehouseSubmissionPlan {
  kind: 'warehouse-submit'
  mode: 'new' | 'change'
  createSubject: boolean
  allocateCode: boolean
  subjectId: string
  submissionId: string
  idempotencyKey: string
  versionNo: number
  approval: {
    status: 'PENDING'
    revision: '1'
    submitted: { actorId: string; occurredAt: string }
    event: {
      action: 'SUBMITTED'
      actorId: string
      requestId: string
      toStatus: 'PENDING'
      toRevision: '1'
    }
  }
  data: WarehouseData
}

export type WarehouseSubmitDecision =
  | { ok: true; plan: WarehouseSubmissionPlan }
  | {
      ok: false
      error: {
        errorKey: WarehouseSubmitErrorKey
        blockers?: WarehouseReferenceBlocker[]
      }
    }

export type WarehouseViewState =
  | { kind: 'ready'; mode: 'new' | 'change'; canSubmit: true }
  | {
      kind: 'blocked'
      canSubmit: false
      errorKey: WarehouseSubmitErrorKey
      blockers: WarehouseReferenceBlocker[]
    }

function trim(value: string): string {
  return value.trim()
}

function hasText(value: string): boolean {
  return trim(value).length > 0
}

function submitPermission(action: WarehouseSubmitCommand['action']): string {
  return `/dcl/warehouse/${action}`
}

function normalizeData(data: WarehouseData): WarehouseData | undefined {
  const name = trim(data.name)
  const address = trim(data.address)
  const contactName = trim(data.contactName)
  const contactPhone = trim(data.contactPhone)
  const remark = trim(data.remark)
  if (
    !name ||
    name.length > 200 ||
    address.length > 500 ||
    contactName.length > 100 ||
    contactPhone.length > 32 ||
    remark.length > 1000
  )
    return undefined
  const manager = data.manager
    ? {
        employeeId: trim(data.manager.employeeId),
        approvalEntryId: trim(data.manager.approvalEntryId),
        code: trim(data.manager.code),
        displayName: trim(data.manager.displayName),
      }
    : undefined
  if (
    manager &&
    (!manager.employeeId ||
      !manager.approvalEntryId ||
      !manager.code ||
      !manager.displayName)
  )
    return undefined
  return {
    name,
    address,
    contactName,
    contactPhone,
    ...(manager === undefined ? {} : { manager }),
    remark,
    enabled: data.enabled,
  }
}

function historyIsValid(history: readonly WarehouseVersionFact[]): boolean {
  const versionNumbers = new Set<number>()
  let openCount = 0
  for (const version of history) {
    if (
      !hasText(version.entryId) ||
      !Number.isInteger(version.versionNo) ||
      version.versionNo < 1 ||
      !/^[1-9]\d*$/.test(version.revision)
    )
      return false
    if (versionNumbers.has(version.versionNo)) return false
    versionNumbers.add(version.versionNo)
    if (version.status === 'PENDING' || version.status === 'REJECTED')
      openCount += 1
  }
  return openCount <= 1
}

function decisionError(
  errorKey: WarehouseSubmitErrorKey,
): WarehouseSubmitDecision {
  return { ok: false, error: { errorKey } }
}

/**
 * Builds the domain-specific Warehouse submission plan from current facts.
 * The caller supplies all server-derived facts; this function does not choose
 * a replacement reference or read a database.
 */
export function prepareWarehouseSubmit(
  command: WarehouseSubmitCommand,
  facts: WarehouseSubmitFacts,
): WarehouseSubmitDecision {
  if (!hasText(command.actor.id)) return decisionError('approval_invalid_actor')
  if (
    command.actor.trusted !== true &&
    !command.actor.permissions.includes(submitPermission(command.action))
  )
    return decisionError('approval_invalid_action')
  if (
    !hasText(command.requestId) ||
    !hasText(command.occurredAt) ||
    !hasText(command.submissionId) ||
    !hasText(command.idempotencyKey) ||
    !hasText(command.subjectId) ||
    trim(command.submissionId) !== trim(command.idempotencyKey)
  )
    return decisionError('warehouse_invalid_data')

  const data = normalizeData(command.data)
  if (!data) return decisionError('warehouse_invalid_data')
  if (!historyIsValid(facts.subject.history))
    return decisionError('warehouse_invalid_history')

  const approved = facts.subject.history.filter(
    (version) => version.status === 'APPROVED',
  )
  const open = facts.subject.history.find(
    (version) => version.status === 'PENDING' || version.status === 'REJECTED',
  )
  const mode = facts.subject.exists ? 'change' : 'new'
  const expectedAction = mode === 'new' ? 'submit-new' : 'submit-change'
  if (command.action !== expectedAction)
    return decisionError('warehouse_submit_mode_mismatch')
  if (!facts.subject.exists && facts.subject.history.length !== 0)
    return decisionError('warehouse_invalid_history')
  if (facts.subject.exists && approved.length === 0)
    return decisionError('approval_no_approved_version')
  if (open) return decisionError('approval_open_version_exists')

  const latestApproved = approved.reduce<WarehouseVersionFact | undefined>(
    (latest, version) =>
      latest === undefined || version.versionNo > latest.versionNo
        ? version
        : latest,
    undefined,
  )
  if (
    mode === 'new' &&
    (command.expectedLatestApprovedSubmissionId !== null ||
      command.expectedLatestApprovedRevision !== null)
  )
    return decisionError('warehouse_stale_facts')
  if (
    mode === 'change' &&
    (latestApproved === undefined ||
      command.expectedLatestApprovedSubmissionId !== latestApproved.entryId ||
      command.expectedLatestApprovedRevision !== latestApproved.revision)
  )
    return decisionError('warehouse_stale_facts')

  let plannedData = data
  if (data.manager) {
    const manager = facts.manager
    if (
      !manager ||
      manager.employeeId !== data.manager.employeeId ||
      !manager.enabled
    )
      return {
        ok: false,
        error: {
          errorKey: 'warehouse_reference_unavailable',
          blockers: [
            {
              field: 'manager',
              objectId: data.manager.employeeId,
              expectedApprovalEntryId: data.manager.approvalEntryId,
              ...(manager
                ? { currentApprovalEntryId: manager.latestApprovedEntryId }
                : {}),
            },
          ],
        },
      }
    if (manager.latestApprovedEntryId !== data.manager.approvalEntryId)
      return {
        ok: false,
        error: {
          errorKey: 'warehouse_reference_stale',
          blockers: [
            {
              field: 'manager',
              objectId: data.manager.employeeId,
              expectedApprovalEntryId: data.manager.approvalEntryId,
              currentApprovalEntryId: manager.latestApprovedEntryId,
            },
          ],
        },
      }
    if (!hasText(manager.code) || !hasText(manager.displayName))
      return decisionError('warehouse_reference_unavailable')
    plannedData = {
      ...data,
      manager: {
        ...data.manager,
        code: trim(manager.code),
        displayName: trim(manager.displayName),
      },
    }
  }

  const versionNo =
    latestApproved === undefined ? 1 : latestApproved.versionNo + 1
  return {
    ok: true,
    plan: {
      kind: 'warehouse-submit',
      mode,
      createSubject: mode === 'new',
      allocateCode: mode === 'new',
      subjectId: trim(command.subjectId),
      submissionId: trim(command.submissionId),
      idempotencyKey: trim(command.idempotencyKey),
      versionNo,
      approval: {
        status: 'PENDING',
        revision: '1',
        submitted: {
          actorId: trim(command.actor.id),
          occurredAt: trim(command.occurredAt),
        },
        event: {
          action: 'SUBMITTED',
          actorId: trim(command.actor.id),
          requestId: trim(command.requestId),
          toStatus: 'PENDING',
          toRevision: '1',
        },
      },
      data: plannedData,
    },
  }
}

export function projectWarehouseViewState(
  command: WarehouseSubmitCommand,
  facts: WarehouseSubmitFacts,
): WarehouseViewState {
  const decision = prepareWarehouseSubmit(command, facts)
  if (decision.ok)
    return { kind: 'ready', mode: decision.plan.mode, canSubmit: true }
  return {
    kind: 'blocked',
    canSubmit: false,
    errorKey: decision.error.errorKey,
    blockers: decision.error.blockers ?? [],
  }
}
