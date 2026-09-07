import assert from 'node:assert/strict'
import test from 'node:test'

import type { ApprovalEntry } from '@zerp/model'

import {
  ApprovalPersistence,
  ApprovalPersistenceError,
} from '../../src/platform/approval.ts'
import {
  VersionedArchives,
  VersionedArchiveError,
} from '../../src/platform/versioned-archives.ts'

type EntryRow = {
  id: string
  domain: string
  entity: string
  subject_id: string
  version_no: number | null
  status: string
  revision: string
  submitted_by: string
  submitted_at: Date
  approved_by: string | null
  approved_at: Date | null
  rejected_by: string | null
  rejected_at: Date | null
  rejection_reason: string | null
  updated_by: string
  updated_at: Date
}

type EventRow = Record<string, unknown> & { action: string }
type Predicate = (row: Record<string, unknown>) => boolean

function matches(
  row: Record<string, unknown>,
  column: string,
  operator: string,
  value: unknown,
): boolean {
  const actual = row[column]
  if (operator === '=') return actual === value
  if (operator === '!=') return actual !== value
  if (operator === 'in') return (value as readonly unknown[]).includes(actual)
  throw new Error(`unsupported fake operator: ${operator}`)
}

class FakeSelect {
  private readonly predicates: Predicate[] = []
  private readonly orderings: Array<{ column: string; direction: string }> = []
  private readonly rows: Array<Record<string, unknown>>

  constructor(rows: Array<Record<string, unknown>>) {
    this.rows = rows
  }

  selectAll() {
    return this
  }

  select(_columns: unknown) {
    return this
  }

  where(column: string, operator: string, value: unknown) {
    this.predicates.push((row) => matches(row, column, operator, value))
    return this
  }

  orderBy(column: string, direction: string) {
    this.orderings.push({ column, direction })
    return this
  }

  forUpdate() {
    return this
  }

  async execute() {
    const result = this.rows.filter((row) =>
      this.predicates.every((predicate) => predicate(row)),
    )
    return result.toSorted((left, right) => {
      for (const ordering of this.orderings) {
        const a = left[ordering.column] as number
        const b = right[ordering.column] as number
        if (a === b) continue
        return (a < b ? -1 : 1) * (ordering.direction === 'desc' ? -1 : 1)
      }
      return 0
    })
  }

  async executeTakeFirst() {
    return (await this.execute())[0]
  }
}

class FakeMutation {
  private readonly predicates: Predicate[] = []
  private values: Record<string, unknown> = {}
  private readonly rows: Array<Record<string, unknown>>
  private readonly operation: 'update' | 'delete'

  constructor(
    rows: Array<Record<string, unknown>>,
    operation: 'update' | 'delete',
  ) {
    this.rows = rows
    this.operation = operation
  }

  set(values: Record<string, unknown>) {
    this.values = values
    return this
  }

  where(column: string, operator: string, value: unknown) {
    this.predicates.push((row) => matches(row, column, operator, value))
    return this
  }

  async executeTakeFirst() {
    const index = this.rows.findIndex((row) =>
      this.predicates.every((predicate) => predicate(row)),
    )
    if (index === -1)
      return this.operation === 'update'
        ? { numUpdatedRows: 0n }
        : { numDeletedRows: 0n }
    if (this.operation === 'update') {
      Object.assign(this.rows[index]!, this.values)
      return { numUpdatedRows: 1n }
    }
    this.rows.splice(index, 1)
    return { numDeletedRows: 1n }
  }
}

class FakeInsert {
  private value: Record<string, unknown> | undefined
  private readonly rows: Array<Record<string, unknown>>

  constructor(rows: Array<Record<string, unknown>>) {
    this.rows = rows
  }

  values(value: Record<string, unknown>) {
    this.value = value
    return this
  }

  async execute() {
    assert.ok(this.value)
    this.rows.push(this.value)
  }
}

class FakeTransaction {
  readonly entries: EntryRow[] = []
  readonly events: EventRow[] = []

  selectFrom(table: string) {
    if (table === 'approval_entries')
      return new FakeSelect(this.entries as Array<Record<string, unknown>>)
    assert.equal(table, 'approval_events')
    return new FakeSelect(this.events)
  }

  insertInto(table: string) {
    if (table === 'approval_entries')
      return new FakeInsert(this.entries as Array<Record<string, unknown>>)
    assert.equal(table, 'approval_events')
    return new FakeInsert(this.events)
  }

  updateTable(table: string) {
    assert.equal(table, 'approval_entries')
    return new FakeMutation(
      this.entries as Array<Record<string, unknown>>,
      'update',
    )
  }

  deleteFrom(table: string) {
    assert.equal(table, 'approval_entries')
    return new FakeMutation(
      this.entries as Array<Record<string, unknown>>,
      'delete',
    )
  }
}

const submittedAt = new Date('2026-09-07T00:00:00.000Z')

function approvedRow(versionNo: number): EntryRow {
  return {
    id: `submission-${versionNo}`,
    domain: 'bob',
    entity: 'supplier',
    subject_id: 'supplier-1',
    version_no: versionNo,
    status: 'APPROVED',
    revision: '2',
    submitted_by: 'submitter',
    submitted_at: submittedAt,
    approved_by: 'reviewer',
    approved_at: new Date('2026-09-07T01:00:00.000Z'),
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    updated_by: 'reviewer',
    updated_at: new Date('2026-09-07T01:00:00.000Z'),
  }
}

test('Approval persistence creates, transitions with CAS, audits, and deletes on the caller transaction', async () => {
  const tx = new FakeTransaction()
  const approval = new ApprovalPersistence()
  const created = await approval.create(tx as never, {
    entryId: 'submission-1',
    domain: 'bob',
    entity: 'supplier',
    subjectId: 'supplier-1',
    versionNo: 1,
    actorId: 'submitter',
    occurredAt: submittedAt,
    requestId: 'submit-request',
  })

  assert.equal(created.status, 'PENDING')
  assert.equal(created.revision, '1')
  assert.deepEqual(
    tx.events.map((event) => event.action),
    ['SUBMITTED'],
  )

  const transitioned = await approval.transition(tx as never, {
    entry: created,
    action: 'reject',
    actor: { id: 'reviewer', permissions: ['/bob/supplier/reject'] },
    expectedRevision: '1',
    occurredAt: new Date('2026-09-07T02:00:00.000Z'),
    requestId: 'review-request',
    reason: '资料不完整',
  })

  assert.equal(transitioned.status, 'REJECTED')
  assert.equal(transitioned.revision, '2')
  assert.deepEqual(
    tx.events.map((event) => event.action),
    ['SUBMITTED', 'REJECTED'],
  )

  await approval.delete(tx as never, {
    entry: transitioned,
    actor: { id: 'submitter', permissions: ['/bob/supplier/delete'] },
    expectedRevision: '2',
    occurredAt: new Date('2026-09-07T03:00:00.000Z'),
    requestId: 'delete-request',
  })
  assert.equal(tx.entries.length, 0)
  assert.deepEqual(
    tx.events.map((event) => event.action),
    ['SUBMITTED', 'REJECTED', 'DELETED'],
  )
  assert.deepEqual(
    (
      await approval.auditHistory(tx as never, {
        domain: 'bob',
        entity: 'supplier',
        subjectId: 'supplier-1',
      })
    ).map((event) => event.action),
    ['SUBMITTED', 'REJECTED', 'DELETED'],
  )
})

test('Approval persistence reports a failed CAS and does not append its audit event', async () => {
  const tx = new FakeTransaction()
  tx.entries.push(approvedRow(1))
  const approval = new ApprovalPersistence()
  const staleEntry: ApprovalEntry = {
    ...(await approval.load(
      tx as never,
      {
        entryId: 'submission-1',
        domain: 'bob',
        entity: 'supplier',
        subjectId: 'supplier-1',
      },
      true,
    )),
    revision: '1',
  }

  await assert.rejects(
    approval.transition(tx as never, {
      entry: staleEntry,
      action: 'unapprove',
      actor: { id: 'reviewer', permissions: ['/bob/supplier/unapprove'] },
      expectedRevision: '1',
      occurredAt: new Date('2026-09-07T02:00:00.000Z'),
      requestId: 'stale-request',
      reason: '重新审核',
    }),
    (error: unknown) =>
      error instanceof ApprovalPersistenceError &&
      error.errorKey === 'approval_stale_revision',
  )
  assert.equal(tx.events.length, 0)
})

test('Versioned archives select exact, open, latest approved and prepare the next version for any domain', async () => {
  const tx = new FakeTransaction()
  tx.entries.push(approvedRow(1), {
    ...approvedRow(2),
    id: 'submission-2',
    status: 'REJECTED',
    revision: '3',
    approved_by: null,
    approved_at: null,
    rejected_by: 'reviewer',
    rejected_at: new Date('2026-09-07T02:00:00.000Z'),
    rejection_reason: '修改资料',
  })
  const versions = new VersionedArchives()
  const scope = {
    domain: 'bob',
    entity: 'supplier',
    subjectId: 'supplier-1',
  } as const

  assert.equal(
    (await versions.latestApproved(tx as never, scope))?.id,
    'submission-1',
  )
  assert.equal((await versions.open(tx as never, scope))?.id, 'submission-2')
  assert.equal(
    (await versions.exact(tx as never, scope, 'submission-2'))?.versionNo,
    2,
  )
  assert.deepEqual(
    (await versions.history(tx as never, scope)).map((entry) => entry.id),
    ['submission-2', 'submission-1'],
  )

  await assert.rejects(
    versions.prepareSubmission(tx as never, scope, true, {
      action: 'submit-change',
      actor: { id: 'submitter', permissions: ['/bob/supplier/submit-change'] },
      requestId: 'request-2',
      occurredAt: '2026-09-07T03:00:00.000Z',
      submissionId: 'submission-3',
      idempotencyKey: 'submission-3',
      subjectId: 'supplier-1',
      expectedLatestApprovedSubmissionId: 'submission-1',
      expectedLatestApprovedRevision: '2',
    }),
    (error: unknown) =>
      error instanceof VersionedArchiveError &&
      error.errorKey === 'approval_open_version_exists',
  )

  tx.entries.splice(1, 1)
  const next = await versions.prepareSubmission(tx as never, scope, true, {
    action: 'submit-change',
    actor: { id: 'submitter', permissions: ['/bob/supplier/submit-change'] },
    requestId: 'request-3',
    occurredAt: '2026-09-07T03:00:00.000Z',
    submissionId: 'submission-2',
    idempotencyKey: 'submission-2',
    subjectId: 'supplier-1',
    expectedLatestApprovedSubmissionId: 'submission-1',
    expectedLatestApprovedRevision: '2',
  })
  assert.equal(next.versionNo, 2)

  const wfl = await versions.prepareSubmission(
    tx as never,
    { domain: 'wfl', entity: 'process-definition', subjectId: 'definition-1' },
    false,
    {
      action: 'submit-new',
      actor: {
        id: 'author',
        permissions: ['/wfl/process-definition/submit-new'],
      },
      requestId: 'wfl-request',
      occurredAt: '2026-09-07T03:00:00.000Z',
      submissionId: 'definition-submission-1',
      idempotencyKey: 'definition-submission-1',
      subjectId: 'definition-1',
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
    },
  )
  assert.equal(wfl.versionNo, 1)
})
