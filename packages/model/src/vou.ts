import {
  decideApproval,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalTransitionPlan,
} from './approval.ts'
import type { SubmitAction } from './submission.ts'

export const vouEntities = [
  'sale-pricing',
  'sale-order',
  'sale-outbound',
  'sale-delivery',
  'sale-signoff',
  'sale-return',
  'purchase-order',
  'purchase-inbound',
  'purchase-return',
  'purchase-inquiry',
  'order-production',
  'self-production',
  'inventory-count',
  'sales-receipt',
  'purchase-refund',
  'other-receipt',
  'sales-refund',
  'purchase-payment',
  'other-payment',
  'employee-loan',
  'employee-repayment',
  'employee-loan-writeoff',
  'expense-reimbursement',
  'expense-payment',
  'other-income',
  'asset-acquisition',
  'asset-sale',
  'asset-liquidation',
  'bill-receipt',
  'bill-payment',
  'bill-issue',
  'bill-discount',
  'bill-maturity',
  'intermediary-calculation',
  'service-contract',
  'service-acceptance',
] as const

export type VouEntity = (typeof vouEntities)[number]

export const systemGeneratedVouEntities = [
  'sale-outbound',
  'sale-delivery',
  'sale-signoff',
  'expense-payment',
] as const satisfies readonly VouEntity[]

const systemGeneratedSet = new Set<VouEntity>(systemGeneratedVouEntities)

export const userCreatableVouEntities = vouEntities.filter(
  (entity) => !systemGeneratedSet.has(entity),
)

export interface VouAttachmentMetadata {
  id: string
  fileName: string
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png'
  sizeBytes: number
  sha256: string
  stagingId: string
}

export interface VouPayload {
  businessDate: string
  currency: string
  amount: string
  lines: readonly unknown[]
  attachments: readonly VouAttachmentMetadata[]
  parentEntity?: VouEntity
  parentDocumentId?: string
  [key: string]: unknown
}

export interface VouSubmissionCommand {
  action: SubmitAction
  entity: VouEntity
  documentId: string
  submissionId: string
  idempotencyKey: string
  expectedRevision: string | null
  payload: VouPayload
}

export interface VouSubmissionFacts {
  actor: ApprovalActor
  documentExists: boolean
  currentSubmissionId: string | null
  currentRevision: string | null
  referencesValid: boolean
  periodOpen: boolean
  trustedSystemActor: boolean
}

export type VouSubmissionErrorKey =
  | 'approval_invalid_action'
  | 'vou_invalid_command'
  | 'vou_invalid_payload'
  | 'vou_submit_mode_mismatch'
  | 'vou_submission_exists'
  | 'vou_stale_revision'
  | 'vou_reference_unavailable'
  | 'vou_period_locked'
  | 'vou_trusted_actor_required'

export interface VouSubmissionPlan {
  entity: VouEntity
  mode: 'new' | 'change'
  documentId: string
  submissionId: string
  idempotencyKey: string
  status: 'PENDING'
  revision: '1'
  payload: Readonly<VouPayload>
}

export type VouSubmissionDecision =
  | { ok: true; plan: VouSubmissionPlan }
  | { ok: false; errorKey: VouSubmissionErrorKey }

export type VouBlocker = {
  kind:
    | 'DOWNSTREAM_DOCUMENT'
    | 'ACCOUNTING_PERIOD'
    | 'WORKFLOW_ACTION'
    | 'ATTACHMENT'
  id: string
}

export type VouAccountingEffect = {
  kind: 'NONE' | 'POST' | 'REVERSE'
  bookIds: readonly string[]
}

export type VouInventoryEffect = {
  kind: 'NONE' | 'INBOUND' | 'OUTBOUND' | 'COUNT' | 'REVERSE'
  lineCount: number
}

export type VouWorkflowEffect = {
  kind: 'NONE' | 'START_OR_CONTINUE' | 'REVERSE'
}

export interface VouApprovalFacts {
  irreversibleBlockers: readonly VouBlocker[]
  accounting: VouAccountingEffect
  inventory: VouInventoryEffect
  workflow: VouWorkflowEffect
}

export type VouEffectPlan =
  | { domain: 'acc'; plan: VouAccountingEffect }
  | { domain: 'inventory'; plan: VouInventoryEffect }
  | { domain: 'wfl'; plan: VouWorkflowEffect }

export type VouApprovalDecision =
  | {
      ok: true
      plan: {
        approval: ApprovalTransitionPlan
        effects: VouEffectPlan[]
      }
    }
  | {
      ok: false
      errorKey: string
      blockers?: readonly VouBlocker[]
    }

function text(value: string): string {
  return value.trim()
}

function canonicalPayload(value: VouPayload): Readonly<VouPayload> | undefined {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value.businessDate) ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.amount) ||
    !Array.isArray(value.lines) ||
    !Array.isArray(value.attachments)
  )
    return undefined
  try {
    return Object.freeze(structuredClone(value))
  } catch {
    return undefined
  }
}

/**
 * Decides the persistence plan for a browser-local or trusted system VOU.
 * It intentionally contains no I/O and persists no server-side Draft state.
 */
export function prepareVouSubmission(
  command: VouSubmissionCommand,
  facts: VouSubmissionFacts,
): VouSubmissionDecision {
  const mode = facts.documentExists ? 'change' : 'new'
  if (command.action !== `submit-${mode}`)
    return { ok: false, errorKey: 'vou_submit_mode_mismatch' }
  if (
    !text(command.documentId) ||
    !text(command.submissionId) ||
    !text(command.idempotencyKey) ||
    command.submissionId !== command.idempotencyKey
  )
    return { ok: false, errorKey: 'vou_invalid_command' }
  if (
    systemGeneratedSet.has(command.entity) &&
    facts.trustedSystemActor !== true
  )
    return { ok: false, errorKey: 'vou_trusted_actor_required' }
  if (
    facts.actor.trusted !== true &&
    facts.trustedSystemActor !== true &&
    !facts.actor.permissions.includes(`/vou/${command.entity}/${command.action}`)
  )
    return { ok: false, errorKey: 'approval_invalid_action' }
  if (facts.currentSubmissionId !== null)
    return { ok: false, errorKey: 'vou_submission_exists' }
  if (
    (mode === 'new' &&
      (command.expectedRevision !== null || facts.currentRevision !== null)) ||
    (mode === 'change' &&
      (command.expectedRevision === null ||
        command.expectedRevision !== facts.currentRevision))
  )
    return { ok: false, errorKey: 'vou_stale_revision' }
  if (!facts.referencesValid)
    return { ok: false, errorKey: 'vou_reference_unavailable' }
  if (!facts.periodOpen)
    return { ok: false, errorKey: 'vou_period_locked' }
  const payload = canonicalPayload(command.payload)
  if (!payload) return { ok: false, errorKey: 'vou_invalid_payload' }

  return {
    ok: true,
    plan: {
      entity: command.entity,
      mode,
      documentId: text(command.documentId),
      submissionId: text(command.submissionId),
      idempotencyKey: text(command.idempotencyKey),
      status: 'PENDING',
      revision: '1',
      payload,
    },
  }
}

function effectPlans(facts: VouApprovalFacts): VouEffectPlan[] {
  const effects: VouEffectPlan[] = []
  if (facts.accounting.kind !== 'NONE')
    effects.push({ domain: 'acc', plan: facts.accounting })
  if (facts.inventory.kind !== 'NONE')
    effects.push({ domain: 'inventory', plan: facts.inventory })
  if (facts.workflow.kind !== 'NONE')
    effects.push({ domain: 'wfl', plan: facts.workflow })
  return effects
}

/** Returns one Approval transition and its domain-specific transactional plans. */
export function prepareVouApproval(
  action: ApprovalAction,
  entry: ApprovalEntry,
  actor: ApprovalActor,
  facts: VouApprovalFacts,
  reason: string | undefined,
  occurrence: { occurredAt: string; requestId: string },
): VouApprovalDecision {
  if (action === 'unapprove' && facts.irreversibleBlockers.length > 0)
    return {
      ok: false,
      errorKey: 'vou_unapprove_blocked',
      blockers: facts.irreversibleBlockers,
    }
  const approval = decideApproval({
    action,
    entry,
    actor,
    expectedRevision: entry.revision,
    occurredAt: occurrence.occurredAt,
    requestId: occurrence.requestId,
    ...(reason === undefined ? {} : { reason }),
  })
  if (!approval.ok)
    return { ok: false, errorKey: approval.error.errorKey }
  return {
    ok: true,
    plan: {
      approval: approval.plan,
      effects:
        action === 'approve' || action === 'unapprove'
          ? effectPlans(facts)
          : [],
    },
  }
}
