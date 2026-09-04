import type { Transaction } from 'kysely'

import type { DB } from '../db/generated.ts'
import type { ApprovalTransitionPlan, VouEntity, VouPayload } from '@zerp/model'

export interface ApprovalApplicationPlan {
  kind: 'approval'
  action: 'APPLY'
  transition: ApprovalTransitionPlan
  entity: VouEntity
  documentId: string
}

export type VouApplicationPlan =
  | { kind: 'vou'; action: 'NONE' }
  | { kind: 'vou'; action: 'approve' | 'unapprove'; documentId: string }

export type AccApplicationPlan =
  | { kind: 'acc'; action: 'NONE' }
  | {
      kind: 'acc'
      action: 'approve' | 'unapprove'
      entity: VouEntity
      documentId: string
      documentNo: string
      approvalEntryId: string
      approvalRevision: string
      payload: VouPayload
      occurredAt: string
    }

export type WflApplicationPlan =
  | { kind: 'wfl'; action: 'NONE' }
  | {
      kind: 'wfl'
      action: 'approve' | 'unapprove'
      entity: VouEntity
      documentId: string
      approvalEntryId: string
      payload: VouPayload
      actorId: string
      occurredAt: string
    }

export interface RptApplicationPlan {
  kind: 'rpt'
  action: 'NONE'
}

export interface PlanExecutor<T> {
  apply(transaction: Transaction<DB>, plan: T): Promise<void>
}

export interface ApplicationPlanBundle {
  approval: ApprovalApplicationPlan
  vou: VouApplicationPlan
  acc: AccApplicationPlan
  wfl: WflApplicationPlan
  rpt: RptApplicationPlan
}

export interface ApplicationPlanExecutors {
  approval: PlanExecutor<ApprovalApplicationPlan>
  vou: PlanExecutor<VouApplicationPlan>
  acc: PlanExecutor<AccApplicationPlan>
  wfl: PlanExecutor<WflApplicationPlan>
  rpt: PlanExecutor<RptApplicationPlan>
}

/**
 * The one cross-domain persistence seam. Callers acquire locks and invoke
 * typed plans in this fixed order on the same Kysely transaction:
 * Approval -> VOU -> ACC -> WFL -> RPT.
 */
export class ApplicationTransactionCoordinator {
  private readonly executors: ApplicationPlanExecutors

  constructor(executors: ApplicationPlanExecutors) {
    this.executors = executors
  }

  async execute(
    transaction: Transaction<DB>,
    plans: ApplicationPlanBundle,
  ): Promise<void> {
    await this.executors.approval.apply(transaction, plans.approval)
    await this.executors.vou.apply(transaction, plans.vou)
    await this.executors.acc.apply(transaction, plans.acc)
    await this.executors.wfl.apply(transaction, plans.wfl)
    await this.executors.rpt.apply(transaction, plans.rpt)
  }
}
