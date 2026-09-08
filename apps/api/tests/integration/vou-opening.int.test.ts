import { AccService } from '../../src/acc/service.ts'
import { VouOpeningService } from '../../src/vou/opening-service.ts'
import { WorkbenchService } from '../../src/app/workbench.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { seedOpeningFixture } from '../fixtures/vou-opening.ts'
import { withWflDatabase } from './wfl-fixture.ts'
import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { modelBuildId } from '@zerp/model'

async function httpFixture(db: Parameters<typeof seedOpeningFixture>[0]) {
  const fixture = await seedOpeningFixture(db)
  const config = loadConfig({
    DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL,
    TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    acc: fixture.acc,
    opening: fixture.opening,
  })
  async function session(principal: typeof fixture.submitter) {
    const response = await app.request('/session/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ZERP-Model-Build': modelBuildId,
      },
      body: JSON.stringify({
        code: principal.username,
        password: principal.password,
      }),
    })
    const body = await response.json()
    assert.equal(body.code, 0)
    const cookie = response.headers.getSetCookie()[0]!
    return async (path: string, input: unknown) => {
      const response = await app.request(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ZERP-Model-Build': modelBuildId,
          'X-CSRF-Token': body.data.csrfToken,
          Cookie: cookie,
        },
        body: JSON.stringify(input),
      })
      if (response.status === 404) return { httpStatus: 404 }
      return response.json()
    }
  }
  return { ...fixture, session }
}

test('VOU zero opening is immutable, book scoped, approved by another operator and listed as a summary', async () => {
  await withWflDatabase(async (db) => {
    const f = await httpFixture(db)
    const post = await f.session(f.submitter)
    const review = await f.session(f.reviewer)
    const readOnly = await f.session(f.reader)
    const outsider = await f.session(f.outsider)
    const pending = await post('/vou/opening/submit-new', f.input)
    assert.equal(pending.code, 0)
    assert.equal(pending.data.approval.domain, 'vou')
    assert.equal(pending.data.approval.versionNo, null)
    assert.deepEqual(pending.data.payload.lines, [])
    const actionInput = {
      bookId: f.book.id,
      submissionId: f.input.submissionId,
      expectedRevision: '1',
    }
    assert.equal(
      (await post('/vou/opening/approve', actionInput)).errorKey,
      'approval_self_review_forbidden',
    )
    assert.equal(
      (await outsider('/vou/opening/get', { bookId: f.book.id })).errorKey,
      'acc_book_access_denied',
    )
    assert.deepEqual(
      (await readOnly('/vou/opening/get', { bookId: f.book.id })).data
        .availableApprovalActions,
      [],
    )
    assert.equal(
      (await readOnly('/vou/opening/approve', actionInput)).errorKey,
      'acc_book_access_denied',
    )
    const approved = await review('/vou/opening/approve', actionInput)
    assert.equal(approved.code, 0)
    assert.equal(approved.data.status, 'APPROVED')
    const page = await post('/vou/opening/query', {
      page: 1,
      pageSize: 20,
      bookId: f.book.id,
    })
    assert.equal(page.code, 0)
    assert.equal(page.data.total, 1)
    assert.equal(page.data.items[0].vouType, 'opening')
    assert.equal(page.data.items[0].handlerName, null)
    assert.ok(!('payload' in page.data.items[0]))
    assert.equal(
      (await post('/acc/opening/approve', actionInput)).httpStatus,
      404,
    )
    assert.equal(
      (
        await review('/vou/opening/unapprove', {
          ...actionInput,
          expectedRevision: '2',
          reason: '重新核对',
        })
      ).code,
      0,
    )
    assert.equal(
      (
        await post('/vou/opening/delete', {
          ...actionInput,
          expectedRevision: '3',
        })
      ).code,
      0,
    )
    assert.equal(
      (await post('/vou/opening/get', { bookId: f.book.id })).errorKey,
      'approval_not_found',
    )
    const audit = await review('/vou/opening/audit-history', {
      bookId: f.book.id,
    })
    assert.deepEqual(
      audit.data.map((row: { action: string }) => row.action),
      ['SUBMITTED', 'APPROVED', 'UNAPPROVED', 'DELETED'],
    )
  })
})

test('opening submission retry preserves one intent and rejects changed input or a different submitter', async () => {
  await withWflDatabase(async (db) => {
    const f = await httpFixture(db)
    const post = await f.session(f.submitter)
    const other = await f.session(f.reviewer)
    const pending = await post('/vou/opening/submit-new', f.input)
    assert.equal(pending.code, 0)
    assert.equal(
      (await post('/vou/opening/submit-new', f.input)).data.submissionId,
      f.input.submissionId,
    )
    const changed = {
      ...f.input,
      lines: [
        {
          subjectId: f.debit.id,
          currency: 'CNY',
          direction: 'DEBIT',
          amount: '12.30',
          dimensions: {},
        },
        {
          subjectId: f.credit.id,
          currency: 'CNY',
          direction: 'CREDIT',
          amount: '12.30',
          dimensions: {},
        },
      ],
    }
    assert.equal(
      (await post('/vou/opening/submit-new', changed)).errorKey,
      'vou_idempotency_conflict',
    )
    assert.equal(
      (await other('/vou/opening/submit-new', f.input)).errorKey,
      'vou_idempotency_conflict',
    )
    assert.equal(
      (await post('/vou/opening/get', { bookId: f.book.id })).data.payload.lines
        .length,
      0,
    )
  })
})

test('opening rejects non-leaf subjects, extra dimensions and per-currency imbalance before publishing a submission', async () => {
  await withWflDatabase(async (db) => {
    const f = await httpFixture(db)
    const post = await f.session(f.submitter)
    const lines = [
      {
        subjectId: f.debit.id,
        currency: 'CNY',
        direction: 'DEBIT',
        amount: '12.30',
        dimensions: {},
      },
      {
        subjectId: f.credit.id,
        currency: 'CNY',
        direction: 'CREDIT',
        amount: '12.30',
        dimensions: {},
      },
    ]
    assert.equal(
      (
        await post('/vou/opening/submit-new', {
          ...f.input,
          lines: [lines[0], { ...lines[1], currency: 'USD' }],
        })
      ).errorKey,
      'acc_opening_unbalanced',
    )
    assert.equal(
      (
        await post('/vou/opening/submit-new', {
          ...f.input,
          lines: [{ ...lines[0], dimensions: { ASSET: f.debit.id } }, lines[1]],
        })
      ).errorKey,
      'acc_opening_dimension_required',
    )
    await f.acc.createSubject(
      {
        ...f.debit,
        id: f.input.submissionId,
        code: '100101',
        parentId: f.debit.id,
        name: '末级借方',
      },
      { ...f.submitter.actor, trusted: true },
    )
    assert.equal(
      (await post('/vou/opening/submit-new', { ...f.input, lines })).errorKey,
      'acc_opening_subject_invalid',
    )
    assert.equal(
      (await post('/vou/opening/get', { bookId: f.book.id })).errorKey,
      'approval_not_found',
    )
  })
})

test('opening workbench visibility and actions retain the independent book access scope', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedOpeningFixture(db)
    await f.opening.submitOpening(
      f.input,
      f.submitter.actor,
      'workbench-opening',
    )
    const workbench = new WorkbenchService(db)
    const request = {
      page: 1,
      pageSize: 20 as const,
      filters: { entity: 'opening' },
    }
    assert.equal((await workbench.query(request, f.outsider.actor)).total, 0)
    const reader = await workbench.query(request, f.reader.actor)
    assert.equal(reader.total, 1)
    assert.deepEqual(reader.items[0]?.availableActions, ['view'])
    const reviewer = await workbench.query(request, f.reviewer.actor)
    assert.deepEqual(reviewer.items[0]?.availableActions, [
      'view',
      'reject',
      'approve',
    ])
  })
})

test('a late ACC failure rolls back the VOU approval, audit and already written OPENING facts', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedOpeningFixture(db)
    class FailingAcc extends AccService {
      override async persistOpeningFacts(
        ...args: Parameters<AccService['persistOpeningFacts']>
      ) {
        await super.persistOpeningFacts(...args)
        throw new Error('injected late persistence failure')
      }
    }
    const input = {
      ...f.input,
      lines: [
        {
          subjectId: f.debit.id,
          currency: 'CNY',
          direction: 'DEBIT' as const,
          amount: '12.30',
          dimensions: {},
        },
        {
          subjectId: f.credit.id,
          currency: 'CNY',
          direction: 'CREDIT' as const,
          amount: '12.30',
          dimensions: {},
        },
      ],
    }
    await f.opening.submitOpening(input, f.submitter.actor, 'rollback-submit')
    const service = new VouOpeningService(db, new FailingAcc(db))
    await assert.rejects(
      service.reviewOpening(
        'approve',
        {
          bookId: f.book.id,
          submissionId: f.input.submissionId,
          expectedRevision: '1',
        },
        f.reviewer.actor,
        'rollback-review',
      ),
      /injected late/,
    )
    const detail = await f.opening.getOpening(f.book.id, f.reviewer.actor)
    assert.equal(detail.status, 'PENDING')
    assert.equal(detail.revision, '1')
    assert.equal(
      (await f.opening.auditOpening(f.book.id, f.reviewer.actor)).length,
      1,
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_journal_entries')
        .select('id')
        .where('book_id', '=', f.book.id)
        .execute(),
      [],
    )
    await f.opening.reviewOpening(
      'approve',
      {
        bookId: f.book.id,
        submissionId: f.input.submissionId,
        expectedRevision: '1',
      },
      f.reviewer.actor,
      'successful-review',
    )
    const journals = await db
      .selectFrom('acc_journal_entries')
      .select('source_kind')
      .where('book_id', '=', f.book.id)
      .execute()
    assert.deepEqual(
      journals.map((row) => row.source_kind),
      ['OPENING'],
    )
  })
})
