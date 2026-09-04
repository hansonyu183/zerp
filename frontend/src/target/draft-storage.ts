/**
 * Browser-only persistence mechanics for target Drafts.  This module knows
 * about ownership, aggregate namespaces and attachment bytes, but deliberately
 * does not know an aggregate's snapshot shape or submission rules.
 */
export interface TargetDraftRecord {
  entity: string
  draftId: string
  ownerUserId: string
  updatedAt: string
}

export interface LocalDraftAttachment {
  attachmentId: string
  fileName: string
  mimeType: string
  size: number
  digest: string
  blob: Blob
  /** Omitted means the customer's identity/tax attachment; otherwise a customer subunit. */
  subunitId?: string
}

interface StoredDraft<T extends TargetDraftRecord> {
  key: string
  draft: T
}

interface StoredAttachment {
  key: string
  draftKey: string
  attachment: LocalDraftAttachment
}

const databaseVersion = 2
const draftsStore = 'target-drafts'
const attachmentsStore = 'target-draft-attachments'

export class TargetDraftRepository {
  private readonly databaseName: string

  constructor(databaseName = 'zerp-target-drafts-v1') {
    this.databaseName = databaseName
  }

  async list<T extends TargetDraftRecord>(
    ownerUserId: string,
    entity: T['entity'],
  ): Promise<T[]> {
    const database = await this.open()
    try {
      const transaction = database.transaction(draftsStore, 'readonly')
      const rows = await requestResult<StoredDraft<T>[]>(
        transaction.objectStore(draftsStore).getAll(),
      )
      await transactionDone(transaction)
      return rows
        .filter((row) => row.draft.ownerUserId === ownerUserId)
        .filter((row) => row.draft.entity === entity)
        .map((row) => structuredClone(row.draft))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    } finally {
      database.close()
    }
  }

  async save<T extends TargetDraftRecord>(draft: T): Promise<void> {
    const database = await this.open()
    try {
      const transaction = database.transaction(draftsStore, 'readwrite')
      transaction.objectStore(draftsStore).put({
        key: this.draftKey(draft.ownerUserId, draft.entity, draft.draftId),
        // Vue wraps records rendered by v-for in Proxies. IndexedDB and
        // structuredClone reject Proxy values, while Draft bodies are JSON by
        // contract and attachment bytes live in their own store.
        draft: JSON.parse(JSON.stringify(draft)) as T,
      } satisfies StoredDraft<T>)
      await transactionDone(transaction)
    } finally {
      database.close()
    }
  }

  async delete(
    ownerUserId: string,
    entity: string,
    draftId: string,
  ): Promise<void> {
    const database = await this.open()
    try {
      const draftKey = this.draftKey(ownerUserId, entity, draftId)
      const transaction = database.transaction(
        [draftsStore, attachmentsStore],
        'readwrite',
      )
      transaction.objectStore(draftsStore).delete(draftKey)
      const attachmentStore = transaction.objectStore(attachmentsStore)
      const attachments = await requestResult<StoredAttachment[]>(
        attachmentStore.getAll(),
      )
      for (const attachment of attachments)
        if (attachment.draftKey === draftKey)
          attachmentStore.delete(attachment.key)
      await transactionDone(transaction)
    } finally {
      database.close()
    }
  }

  /** Copies mechanics-owned attachment bytes after the aggregate created its new Draft. */
  async cloneAttachments(
    source: TargetDraftRecord,
    destination: TargetDraftRecord,
  ): Promise<void> {
    const database = await this.open()
    try {
      const sourceKey = this.draftKey(
        source.ownerUserId,
        source.entity,
        source.draftId,
      )
      const destinationKey = this.draftKey(
        destination.ownerUserId,
        destination.entity,
        destination.draftId,
      )
      const transaction = database.transaction(attachmentsStore, 'readwrite')
      const store = transaction.objectStore(attachmentsStore)
      const attachments = await requestResult<StoredAttachment[]>(
        store.getAll(),
      )
      for (const stored of attachments) {
        if (stored.draftKey !== sourceKey) continue
        const attachment = copyAttachment(stored.attachment)
        store.put({
          key: this.attachmentKey(destinationKey, attachment.attachmentId),
          draftKey: destinationKey,
          attachment,
        } satisfies StoredAttachment)
      }
      await transactionDone(transaction)
    } finally {
      database.close()
    }
  }

  async saveAttachment(
    draft: TargetDraftRecord,
    attachment: LocalDraftAttachment,
  ): Promise<void> {
    const database = await this.open()
    try {
      const transaction = database.transaction(attachmentsStore, 'readwrite')
      const draftKey = this.draftKey(
        draft.ownerUserId,
        draft.entity,
        draft.draftId,
      )
      transaction.objectStore(attachmentsStore).put({
        key: this.attachmentKey(draftKey, attachment.attachmentId),
        draftKey,
        attachment: copyAttachment(attachment),
      } satisfies StoredAttachment)
      await transactionDone(transaction)
    } finally {
      database.close()
    }
  }

  async listAttachments(
    draft: TargetDraftRecord,
  ): Promise<LocalDraftAttachment[]> {
    const database = await this.open()
    try {
      const draftKey = this.draftKey(
        draft.ownerUserId,
        draft.entity,
        draft.draftId,
      )
      const transaction = database.transaction(attachmentsStore, 'readonly')
      const attachments = await requestResult<StoredAttachment[]>(
        transaction.objectStore(attachmentsStore).getAll(),
      )
      await transactionDone(transaction)
      return attachments
        .filter((attachment) => attachment.draftKey === draftKey)
        .map((attachment) => copyAttachment(attachment.attachment))
    } finally {
      database.close()
    }
  }

  private draftKey(
    ownerUserId: string,
    entity: string,
    draftId: string,
  ): string {
    return `${entity}:${ownerUserId}:${draftId}`
  }

  private attachmentKey(draftKey: string, attachmentId: string): string {
    return `${draftKey}:${attachmentId}`
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, databaseVersion)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(draftsStore))
          request.result.createObjectStore(draftsStore, { keyPath: 'key' })
        if (!request.result.objectStoreNames.contains(attachmentsStore))
          request.result.createObjectStore(attachmentsStore, { keyPath: 'key' })
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

function copyAttachment(
  attachment: LocalDraftAttachment,
): LocalDraftAttachment {
  // Blob is immutable. Keeping its byte handle avoids a second eager browser
  // copy while IndexedDB still persists the Blob itself atomically.
  return { ...attachment, blob: attachment.blob }
}
