import type { VouEntity, VouPayload } from '@zerp/model'

import { TargetDraftRepository, type LocalDraftAttachment, type TargetDraftRecord } from './draft-storage.ts'

export interface VouDraft extends TargetDraftRecord {
  entity: VouEntity
  documentId: string
  submissionId: string
  stableRevision: string | null
  payload: Omit<VouPayload, 'attachments'>
}

export class VouDraftRepository {
  private readonly storage: TargetDraftRepository

  constructor(storage = new TargetDraftRepository()) {
    this.storage = storage
  }

  list(ownerUserId: string, entity: VouEntity) {
    return this.storage.list<VouDraft>(ownerUserId, entity)
  }

  save(draft: VouDraft) {
    return this.storage.save(draft)
  }

  delete(draft: VouDraft) {
    return this.storage.delete(draft.ownerUserId, draft.entity, draft.draftId)
  }

  attachments(draft: VouDraft) {
    return this.storage.listAttachments(draft)
  }

  saveAttachment(draft: VouDraft, attachment: LocalDraftAttachment) {
    return this.storage.saveAttachment(draft, attachment)
  }
}

/** ACC Opening is an Approval-only submission; unfinished editing never leaves IndexedDB. */
export interface OpeningDraft extends TargetDraftRecord {
  entity: 'acc-opening'
  bookId: string
  submissionId: string
  lines: Array<{
    subjectId: string
    currency: string
    direction: 'DEBIT' | 'CREDIT'
    amount: string
    dimensions: Record<string, string>
  }>
  assets: unknown[]
  bills: unknown[]
  containers: unknown[]
}

/** DCL WFL definition candidates are browser drafts until the first submit. */
export interface WflDefinitionDraft extends TargetDraftRecord {
  entity: 'wfl-process-definition'
  subjectId: string
  submissionId: string
  expectedLatestApprovedSubmissionId: string | null
  expectedLatestApprovedRevision: string | null
  script: string
  trialDocument: { entity: VouEntity; documentId: string }
  /** A successful browser trial is invalid once any Draft input changes. */
  trialSucceeded: boolean
}

export class TargetWorkflowDraftRepository {
  private readonly storage: TargetDraftRepository

  constructor(storage = new TargetDraftRepository()) {
    this.storage = storage
  }

  listOpenings(ownerUserId: string, bookId: string) {
    return this.storage
      .list<OpeningDraft>(ownerUserId, 'acc-opening')
      .then((drafts) => drafts.filter((draft) => draft.bookId === bookId))
  }

  listDefinitions(ownerUserId: string) {
    return this.storage.list<WflDefinitionDraft>(
      ownerUserId,
      'wfl-process-definition',
    )
  }

  save(draft: OpeningDraft | WflDefinitionDraft) {
    return this.storage.save(draft)
  }

  delete(draft: OpeningDraft | WflDefinitionDraft) {
    return this.storage.delete(draft.ownerUserId, draft.entity, draft.draftId)
  }
}
