import { afterEach, describe, expect, it } from 'vitest'
import { reactive } from 'vue'

import {
  TargetDraftRepository,
  type LocalDraftAttachment,
  type TargetDraftRecord,
} from '../../../src/target/draft-storage.ts'

interface ExampleDraft extends TargetDraftRecord {
  entity: 'customer' | 'vehicle'
  name: string
}

describe('TargetDraftRepository', () => {
  const originalIndexedDb = globalThis.indexedDB

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: originalIndexedDb,
    })
  })

  it('keeps multiple Drafts isolated by owner and aggregate namespace', async () => {
    installIndexedDb()
    const repository = new TargetDraftRepository('draft-isolation')
    const customer = draft('customer', 'owner-a', 'draft-customer', 'Customer')
    const vehicle = draft('vehicle', 'owner-a', 'draft-vehicle', 'Vehicle')
    const otherOwner = draft('customer', 'owner-b', 'draft-other', 'Other')

    await repository.save(customer)
    await repository.save(vehicle)
    await repository.save(otherOwner)

    await expect(repository.list('owner-a', 'customer')).resolves.toEqual([
      customer,
    ])
    await expect(repository.list('owner-a', 'vehicle')).resolves.toEqual([
      vehicle,
    ])
    await expect(repository.list('owner-b', 'customer')).resolves.toEqual([
      otherOwner,
    ])
  })

  it('retains local bytes across clone, and removes them only with the local Draft', async () => {
    installIndexedDb()
    const repository = new TargetDraftRepository('draft-attachments')
    const source = draft('customer', 'owner-a', 'source', 'Source')
    const clone = draft('customer', 'owner-a', 'clone', 'Clone')
    const attachment: LocalDraftAttachment = {
      attachmentId: 'attachment-1',
      fileName: 'identity.pdf',
      mimeType: 'application/pdf',
      size: 5,
      digest: 'sha256:known',
      blob: new Blob(['bytes'], { type: 'application/pdf' }),
    }

    await repository.save(source)
    await repository.saveAttachment(source, attachment)
    await repository.save(clone)
    await repository.cloneAttachments(source, clone)

    const cloned = await repository.listAttachments(clone)
    expect(cloned).toHaveLength(1)
    expect(cloned[0]!.blob).toMatchObject({
      size: 5,
      type: 'application/pdf',
    })
    expect(cloned[0]).toMatchObject({
      attachmentId: 'attachment-1',
      digest: 'sha256:known',
    })

    // A failed submit has no repository delete operation, so retryable local
    // Draft + bytes remain.  Explicit local delete clears both atomically.
    await expect(repository.listAttachments(source)).resolves.toHaveLength(1)
    await repository.delete(source.ownerUserId, source.entity, source.draftId)
    await expect(
      repository.list(source.ownerUserId, source.entity),
    ).resolves.toEqual([clone])
    await expect(repository.listAttachments(source)).resolves.toEqual([])
    await expect(repository.listAttachments(clone)).resolves.toHaveLength(1)
  })

  it('persists Vue reactive Drafts as plain IndexedDB records', async () => {
    installIndexedDb()
    const repository = new TargetDraftRepository('draft-reactive')
    const reactiveDraft = reactive(
      draft('vehicle', 'owner-a', 'reactive', 'Reactive Vehicle'),
    )

    await repository.save(reactiveDraft)

    await expect(repository.list('owner-a', 'vehicle')).resolves.toEqual([
      draft('vehicle', 'owner-a', 'reactive', 'Reactive Vehicle'),
    ])
  })
})

function draft(
  entity: ExampleDraft['entity'],
  ownerUserId: string,
  draftId: string,
  name: string,
): ExampleDraft {
  return {
    entity,
    ownerUserId,
    draftId,
    name,
    updatedAt: '2026-09-04T00:00:00.000Z',
  }
}

function installIndexedDb() {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: new MemoryIndexedDb(),
  })
}

class MemoryIndexedDb {
  private readonly databases = new Map<string, MemoryDatabase>()

  open(name: string, _version: number) {
    const request = new MemoryRequest<MemoryDatabase>()
    const database = this.databases.get(name) ?? new MemoryDatabase()
    const upgrading = !this.databases.has(name)
    this.databases.set(name, database)
    queueMicrotask(() => {
      request.result = database
      if (upgrading)
        request.onupgradeneeded?.call(request as never, {} as never)
      request.onsuccess?.call(request as never, {} as never)
    })
    return request
  }
}

class MemoryDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  }
  private readonly stores = new Map<string, Map<string, unknown>>()

  createObjectStore(name: string) {
    this.stores.set(name, new Map())
    return {} as IDBObjectStore
  }

  transaction(
    names: string | string[],
    _mode: IDBTransactionMode,
  ): IDBTransaction {
    return new MemoryTransaction(
      Array.isArray(names) ? names : [names],
      this.stores,
    ) as unknown as IDBTransaction
  }

  close() {}
}

class MemoryTransaction {
  oncomplete: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onabort: ((event: Event) => void) | null = null

  constructor(
    private readonly names: string[],
    private readonly stores: Map<string, Map<string, unknown>>,
  ) {
    setTimeout(() => this.oncomplete?.({} as Event), 0)
  }

  objectStore(name: string): IDBObjectStore {
    if (!this.names.includes(name)) throw new Error(`unknown store ${name}`)
    const values = this.stores.get(name)
    if (!values) throw new Error(`missing store ${name}`)
    return new MemoryObjectStore(values) as unknown as IDBObjectStore
  }
}

class MemoryObjectStore {
  constructor(private readonly values: Map<string, unknown>) {}

  getAll() {
    return MemoryRequest.success([...this.values.values()])
  }

  put(value: { key: string }) {
    this.values.set(value.key, value)
    return MemoryRequest.success(value.key)
  }

  delete(key: string) {
    this.values.delete(key)
    return MemoryRequest.success(undefined)
  }
}

class MemoryRequest<T> {
  result!: T
  error: DOMException | null = null
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onupgradeneeded: ((event: Event) => void) | null = null

  static success<T>(value: T): MemoryRequest<T> {
    const request = new MemoryRequest<T>()
    queueMicrotask(() => {
      request.result = value
      request.onsuccess?.({} as Event)
    })
    return request
  }
}
