import {
  TargetDraftRepository,
  type TargetDraftRecord,
} from './draft-storage.ts'

export interface WarehouseDraftSnapshot {
  name: string
  address: string
  contactName: string
  contactPhone: string
  managerEmployeeId: string
  managerEmployeeApprovalEntryId: string
  managerEmployeeCode: string
  managerEmployeeName: string
  remark: string
  enabled: boolean
}

export interface WarehouseDraft extends TargetDraftRecord {
  entity: 'warehouse'
  draftId: string
  ownerUserId: string
  mode: 'NEW' | 'CHANGE'
  subjectId: string
  submissionId: string
  idempotencyKey: string
  expectedLatestApprovedSubmissionId: string | null
  expectedLatestApprovedRevision: string | null
  snapshot: WarehouseDraftSnapshot
  updatedAt: string
}

const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function createTargetId(): string {
  const values = crypto.getRandomValues(new Uint8Array(26))
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join(
    '',
  )
}

export function createWarehouseDraft(
  ownerUserId: string,
  initial?: Partial<WarehouseDraft>,
): WarehouseDraft {
  const submissionId = createTargetId()
  return {
    entity: 'warehouse',
    draftId: createTargetId(),
    ownerUserId,
    mode: 'NEW',
    subjectId: createTargetId(),
    submissionId,
    idempotencyKey: submissionId,
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    snapshot: {
      name: '',
      address: '',
      contactName: '',
      contactPhone: '',
      managerEmployeeId: '',
      managerEmployeeApprovalEntryId: '',
      managerEmployeeCode: '',
      managerEmployeeName: '',
      remark: '',
      enabled: true,
    },
    updatedAt: new Date().toISOString(),
    ...initial,
  }
}

export class WarehouseDraftRepository {
  private readonly drafts: TargetDraftRepository

  constructor(databaseName = 'zerp-target-drafts-v1') {
    this.drafts = new TargetDraftRepository(databaseName)
  }

  list(ownerUserId: string): Promise<WarehouseDraft[]> {
    return this.drafts.list(ownerUserId, 'warehouse')
  }

  save(draft: WarehouseDraft): Promise<void> {
    return this.drafts.save(draft)
  }

  delete(ownerUserId: string, draftId: string): Promise<void> {
    return this.drafts.delete(ownerUserId, 'warehouse', draftId)
  }
}
