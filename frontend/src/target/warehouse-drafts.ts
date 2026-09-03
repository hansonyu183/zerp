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

export interface WarehouseDraft {
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

interface StoredDraft extends WarehouseDraft {
  key: string
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
  private readonly databaseName: string

  constructor(databaseName = 'zerp-target-drafts-v1') {
    this.databaseName = databaseName
  }

  async list(ownerUserId: string): Promise<WarehouseDraft[]> {
    const database = await this.open()
    try {
      const transaction = database.transaction('warehouse-drafts', 'readonly')
      const request = transaction
        .objectStore('warehouse-drafts')
        .getAll(IDBKeyRange.bound(`${ownerUserId}:`, `${ownerUserId}:\uffff`))
      const rows = await requestResult<StoredDraft[]>(request)
      await transactionDone(transaction)
      return rows
        .map(({ key: _key, ...draft }) => draft)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    } finally {
      database.close()
    }
  }

  async save(draft: WarehouseDraft): Promise<void> {
    const database = await this.open()
    try {
      const transaction = database.transaction('warehouse-drafts', 'readwrite')
      const storedDraft: StoredDraft = {
        ...draft,
        snapshot: { ...draft.snapshot },
        key: this.key(draft.ownerUserId, draft.draftId),
      }
      transaction.objectStore('warehouse-drafts').put(storedDraft)
      await transactionDone(transaction)
    } finally {
      database.close()
    }
  }

  async delete(ownerUserId: string, draftId: string): Promise<void> {
    const database = await this.open()
    try {
      const transaction = database.transaction('warehouse-drafts', 'readwrite')
      transaction
        .objectStore('warehouse-drafts')
        .delete(this.key(ownerUserId, draftId))
      await transactionDone(transaction)
    } finally {
      database.close()
    }
  }

  private key(ownerUserId: string, draftId: string): string {
    return `${ownerUserId}:${draftId}`
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('warehouse-drafts'))
          request.result.createObjectStore('warehouse-drafts', {
            keyPath: 'key',
          })
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
