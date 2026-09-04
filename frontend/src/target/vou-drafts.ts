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
