import type { Transaction } from 'kysely'

import type { DB } from '../db/generated.ts'
import type { ApprovalTransitionPlan, VouEntity, VouPayload } from '@zerp/model'

export interface ApprovalApplicationPlan {
  kind: 'approval'
  transition?: ApprovalTransitionPlan
  entity?: VouEntity
  documentId?: string
}

export interface VouApplicationPlan {
  kind: 'vou'
  action?: 'approve' | 'unapprove'
  documentId?: string
}

export interface AccApplicationPlan {
  kind: 'acc'
  action?: 'approve' | 'unapprove'
  entity?: VouEntity
  documentId?: string
  documentNo?: string
  approvalEntryId?: string
  approvalRevision?: string
  payload?: VouPayload
  occurredAt?: string
}

export interface WflApplicationPlan {
  kind: 'wfl'
  action?: 'approve' | 'unapprove'
  entity?: VouEntity
  documentId?: string
  approvalEntryId?: string
  payload?: VouPayload
  actorId?: string
  occurredAt?: string
}

export interface RptApplicationPlan {
  kind: 'rpt'
  approvalEntryId?: string
}

export interface PlanExecutor<T> {
  apply(transaction: Transaction<DB>, plan: T): Promise<void>
}

export interface ApplicationPlanBundle {
  approval?: ApprovalApplicationPlan
  vou?: VouApplicationPlan
  acc?: AccApplicationPlan
  wfl?: WflApplicationPlan
  rpt?: RptApplicationPlan
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
    if (plans.approval)
      await this.executors.approval.apply(transaction, plans.approval)
    if (plans.vou) await this.executors.vou.apply(transaction, plans.vou)
    if (plans.acc) await this.executors.acc.apply(transaction, plans.acc)
    if (plans.wfl) await this.executors.wfl.apply(transaction, plans.wfl)
    if (plans.rpt) await this.executors.rpt.apply(transaction, plans.rpt)
  }
}
