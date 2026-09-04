import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { userCreatableVouEntities } from '@zerp/model'
import { ulid } from 'ulid'

import { createDatabase } from '../../src/db/database.ts'
import { VouApplicationError, VouService } from '../../src/vou/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('all VOU types use immutable submissions, owned attachment staging, and the closed lifecycle', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const service = new VouService(db)
  const submitterId = ulid()
  const reviewerId = ulid()
  const submitter = { id: submitterId, permissions: [] as string[], trusted: true }
  const reviewer = { id: reviewerId, permissions: [] as string[], trusted: true }

  context.after(async () => {
    try {
      await db.deleteFrom('approval_events').where('domain', '=', 'vou').execute()
      await db.deleteFrom('vou_idempotency').execute()
      await db.deleteFrom('approval_entries').where('domain', '=', 'vou').execute()
      await db.deleteFrom('vou_attachment_staging').execute()
      await db.deleteFrom('vou_documents').execute()
      await db.deleteFrom('app_users').where('id', 'in', [submitterId, reviewerId]).execute()
    } finally {
      await db.destroy()
    }
  })
  await db.insertInto('app_users').values(
    [submitterId, reviewerId].map((id) => ({
      id,
      username: `vou-${id}`,
      display_name: 'VOU test actor',
      password_hash: 'unused',
      status: 'ENABLED' as const,
      password_changed_at: new Date(),
      password_change_required: false,
    })),
  ).execute()

  const content = Buffer.from('%PDF-1.7\nVOU attachment')
  const attachment = {
    stagingId: ulid(),
    fileId: ulid(),
    fileName: 'evidence.pdf',
    mimeType: 'application/pdf' as const,
    size: content.length,
    digest: createHash('sha256').update(content).digest('hex'),
    contentBase64: content.toString('base64'),
  }
  await service.stageAttachment(attachment, submitter)
  await assert.rejects(
    service.stageAttachment({ ...attachment, stagingId: ulid(), digest: '0'.repeat(64) }, submitter),
    (error: unknown) => error instanceof VouApplicationError && error.errorKey === 'vou_attachment_digest_invalid',
  )

  const views = []
  for (const [index, entity] of userCreatableVouEntities.entries()) {
    const documentId = ulid()
    const submissionId = ulid()
    const view = await service.submit(entity, 'submit-new', {
      documentId,
      submissionId,
      idempotencyKey: submissionId,
      expectedRevision: null,
      payload: {
        businessDate: '2026-09-04',
        currency: 'CNY',
        amount: `${index + 1}.00`,
        lines: [],
        attachments: index === 0 ? [{
          id: attachment.fileId,
          fileName: attachment.fileName,
          contentType: attachment.mimeType,
          sizeBytes: attachment.size,
          sha256: attachment.digest,
          stagingId: attachment.stagingId,
        }] : [],
      },
    }, submitter, `submit-${entity}`)
    assert.equal(view.status, 'PENDING', entity)
    views.push(view)
  }
  assert.equal(await db.selectFrom('vou_documents').select(({ fn }) => fn.countAll<string>().as('count')).executeTakeFirstOrThrow().then((row) => Number(row.count)), userCreatableVouEntities.length)
  assert.equal(await db.selectFrom('vou_attachment_staging').select(({ fn }) => fn.countAll<string>().as('count')).executeTakeFirstOrThrow().then((row) => Number(row.count)), 0)
  assert.equal(await db.selectFrom('vou_attachments').select(({ fn }) => fn.countAll<string>().as('count')).executeTakeFirstOrThrow().then((row) => Number(row.count)), 1)

  const first = views[0]!
  const rejected = await service.review(first.entity, 'reject', {
    documentId: first.documentId,
    submissionId: first.submissionId,
    expectedRevision: first.revision,
    reason: '资料需补充',
  }, reviewer, 'reject')
  assert.equal(rejected.status, 'REJECTED')
  const pending = await service.review(first.entity, 'unreject', {
    documentId: first.documentId,
    submissionId: first.submissionId,
    expectedRevision: rejected.revision,
  }, reviewer, 'unreject')
  assert.equal(pending.status, 'PENDING')
  const approved = await service.review(first.entity, 'approve', {
    documentId: first.documentId,
    submissionId: first.submissionId,
    expectedRevision: pending.revision,
  }, reviewer, 'approve')
  assert.equal(approved.status, 'APPROVED')
  const reopened = await service.review(first.entity, 'unapprove', {
    documentId: first.documentId,
    submissionId: first.submissionId,
    expectedRevision: approved.revision,
    reason: '冲销重办',
  }, reviewer, 'unapprove')
  assert.equal(reopened.status, 'PENDING')

  const retry = await service.submit(views[1]!.entity, 'submit-new', {
    documentId: views[1]!.documentId,
    submissionId: views[1]!.submissionId,
    idempotencyKey: views[1]!.submissionId,
    expectedRevision: null,
    payload: views[1]!.payload,
  }, submitter, `submit-${views[1]!.entity}`)
  assert.deepEqual(retry, views[1])
})
