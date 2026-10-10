import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import { modelBuildId, type VouPayloadFor } from '@zerp/model'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { SessionService, hashPassword } from '../../src/app/session.ts'
import { createApp } from '../../src/app.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { AttachmentStore } from '../../src/platform/attachment-store.ts'
import { AccService } from '../../src/acc/service.ts'
import { WflService } from '../../src/wfl/service.ts'
import { VouService } from '../../src/vou/service.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'
import { BobService } from '../../src/bob/service.ts'
import { withCommittedPurchaseDatabase } from '../fixtures/vou-purchase-http.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'

test('ordinary archive HTTP preserves empty, large and opaque originals with fixed identities and bounded capacity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zerp-original-files-'))
  try {
    await withCommittedPurchaseDatabase(async (db) => {
      const f = await seedOrderListFixture(db, 0, ['service-contract'])
      const paths = [
        ...[
          'submit-new',
          'get',
          'approve',
          'attachment-stage',
          'attachment-read',
        ].map((action) => `/vou/service-contract/${action}`),
        '/dcl/customer/attachment-stage',
        ...[
          'submission-get',
          'submit-change',
          'approve',
          'attachment-read',
        ].map((action) => `/dcl/customer/${action}`),
        ...['get', 'versions', 'attachment-read'].map(
          (action) => `/bob/customer/${action}`,
        ),
      ]
      const password = randomBytes(24).toString('base64url')
      const passwordHash = await hashPassword(password)
      const bootstrap = new TargetBootstrapService(db)
      async function principal(permissions: string[]) {
        const user = {
          userId: ulid(),
          roleId: ulid(),
          username: 'original-file-' + ulid(),
          passwordHash,
        }
        await bootstrap.createE2EPrincipal(user, false, permissions)
        return user
      }
      const submitter = await principal(paths),
        reviewer = await principal(paths),
        outsider = await principal(['/vou/service-contract/get'])
      const store = new AttachmentStore(root)
      let vou: VouService
      const wfl = new WflService(db, await createNodeWflStarlark(), {
        createChild: (...args) => vou.createChild(...args),
        approveChild: (...args) => vou.approveChild(...args),
        rejectChild: (...args) => vou.rejectChild(...args),
        retryChild: (...args) => vou.retryChild(...args),
        cancelChild: (...args) => vou.cancelChild(...args),
      })
      vou = new VouService(
        db,
        { acc: new AccService(db), wfl },
        { attachmentStore: store },
      )
      const config = loadConfig({
        DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
        APP_SESSION_COOKIE_SECURE: 'false',
      })
      const app = createApp({
        config,
        session: new SessionService(db, config),
        vou,
        dclArchives: new DclArchiveService(db, { attachmentStore: store }),
        bob: new BobService(db),
      })
      async function client(user: typeof submitter) {
        const response = await app.request('/session/auth/signin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ZERP-Model-Build': modelBuildId,
          },
          body: JSON.stringify({ code: user.username, password }),
        })
        const auth = await response.json()
        assert.equal(auth.code, 0)
        const headers = {
          'Content-Type': 'application/json',
          'X-ZERP-Model-Build': modelBuildId,
          'X-CSRF-Token': auth.data.csrfToken,
          cookie: response.headers.getSetCookie()[0]!,
        }
        return {
          post: async (path: string, input: unknown) =>
            (
              await app.request(path, {
                method: 'POST',
                headers,
                body: JSON.stringify(input),
              })
            ).json(),
          download: (path: string) => app.request(path, { headers }),
        }
      }
      const owner = await client(submitter),
        peer = await client(reviewer),
        denied = await client(outsider)
      const stage = (content: Buffer, fileName: string) => ({
        stagingId: ulid(),
        fileId: ulid(),
        fileName,
        mimeType: 'application/octet-stream',
        size: content.length,
        digest: createHash('sha256').update(content).digest('hex'),
        contentBase64: content.toString('base64'),
      })
      const empty = stage(Buffer.alloc(0), '原空文件.et')
      const dcl = await owner.post('/dcl/customer/attachment-stage', empty)
      assert.equal(dcl.code, 0, dcl.errorKey)
      assert.equal(dcl.data.size, 0)
      assert.deepEqual(
        (await owner.post('/dcl/customer/attachment-stage', empty)).data.fileId,
        empty.fileId,
      )
      const customer = f.salePayload.customer
      const original = await owner.post('/dcl/customer/submission-get', {
        subjectId: customer.objectId,
        submissionId: customer.approvalEntryId,
      })
      assert.equal(original.code, 0, original.errorKey)
      const customerEntry = ulid()
      const customerFile = {
        id: empty.fileId,
        stagingId: empty.stagingId,
        fileName: empty.fileName,
        contentType: empty.mimeType,
        sizeBytes: empty.size,
        sha256: empty.digest,
      }
      const changed = await owner.post('/dcl/customer/submit-change', {
        subjectId: customer.objectId,
        submissionId: customerEntry,
        idempotencyKey: customerEntry,
        expectedLatestApprovedSubmissionId: customer.approvalEntryId,
        expectedLatestApprovedRevision: original.data.revision,
        snapshot: { ...original.data.snapshot, attachments: [customerFile] },
      })
      assert.equal(changed.code, 0, changed.errorKey)
      assert.equal(
        (
          await peer.post('/dcl/customer/approve', {
            subjectId: customer.objectId,
            submissionId: customerEntry,
            expectedRevision: changed.data.revision,
          })
        ).code,
        0,
      )
      for (const [path, read] of [
        [
          '/bob/customer/attachment-read',
          {
            source: 'current',
            objectId: customer.objectId,
            fileId: empty.fileId,
          },
        ],
        [
          '/bob/customer/attachment-read',
          {
            source: 'submission',
            subjectId: customer.objectId,
            submissionId: customerEntry,
            fileId: empty.fileId,
          },
        ],
        [
          '/dcl/customer/attachment-read',
          {
            source: 'submission',
            subjectId: customer.objectId,
            submissionId: customerEntry,
            fileId: empty.fileId,
          },
        ],
      ] as const) {
        const file = await owner.post(path, read)
        assert.equal(file.code, 0, file.errorKey)
        assert.equal(file.data.mimeType, 'application/octet-stream')
        assert.equal(file.data.fileName, empty.fileName)
        assert.equal(file.data.size, 0)
        assert.equal(file.data.digest, empty.digest)
        assert.equal(file.data.contentBase64, '')
      }
      const staged: ReturnType<typeof stage>[] = []
      for (let index = 0; index < 20; index++) {
        const content =
          index === 0
            ? Buffer.alloc(0)
            : index === 1
              ? Buffer.alloc(20 * 1024 * 1024, 173)
              : Buffer.from([255, 216, 0, index])
        const input = stage(content, `原文件${index}.xlsx`)
        const saved = await owner.post(
          '/vou/service-contract/attachment-stage',
          input,
        )
        assert.equal(saved.code, 0, saved.errorKey)
        assert.equal(saved.data.size, content.length)
        staged.push(input)
      }
      assert.equal(
        (await owner.post('/vou/service-contract/attachment-stage', staged[0]))
          .code,
        0,
      )
      assert.equal(
        (await peer.post('/vou/service-contract/attachment-stage', staged[0]))
          .errorKey,
        'vou_attachment_staging_conflict',
      )
      assert.equal(
        (
          await owner.post('/vou/service-contract/attachment-stage', {
            ...staged[0],
            fileName: '改名.et',
          })
        ).errorKey,
        'vou_attachment_staging_conflict',
      )
      assert.equal(
        (
          await owner.post('/vou/service-contract/attachment-stage', {
            ...stage(Buffer.from([255, 216, 0, 1]), '损坏照片.jpg'),
            mimeType: 'image/jpeg',
          })
        ).errorKey,
        'vou_attachment_type_invalid',
      )
      assert.equal(
        (
          await owner.post(
            '/vou/service-contract/attachment-stage',
            stage(Buffer.alloc(20 * 1024 * 1024 + 1), '过大.rar'),
          )
        ).errorKey,
        'validation_failed',
      )
      const entry = ulid()
      const supplier = (f.purchase.payload as VouPayloadFor<'purchase-order'>)
        .supplier
      const payload = {
        businessDate: '2025-09-08',
        currency: 'CNY',
        employee: f.salePayload.salesperson,
        counterpartyType: 'supplier',
        counterparty: {
          objectId: supplier.objectId,
          approvalEntryId: supplier.approvalEntryId,
          selectionOrigin: 'CURRENT',
        },
        priorFact: {
          sourceClosed: false,
          sourceInstanceId: 'archive-http-fixture',
          sourceSchema: 'fixture_archive',
          sourceDocumentType: 'AD',
          sourceDocumentKey: entry,
          sourceDocumentNo: 'AD-original-files',
          capturedAt: '2026-10-10T00:00:00.123456Z',
          snapshotDigest: 'a'.repeat(64),
        },
        serviceLines: [
          {
            lineId: ulid(),
            sourceLineKey: '1',
            serviceName: '原始档案测试',
            enteredQuantity: '1',
            baseQuantity: '1',
            enteredUnit: f.references.unitSnapshot,
            baseUnit: f.references.unitSnapshot,
            agreedAmount: '1.23',
          },
        ],
        serviceContract: { requiresPrepayment: true },
        attachments: staged.map((input) => ({
          id: input.fileId,
          stagingId: input.stagingId,
          fileName: input.fileName,
          contentType: input.mimeType,
          sizeBytes: input.size,
          sha256: input.digest,
        })),
      }
      const input = {
        documentId: ulid(),
        submissionId: entry,
        idempotencyKey: entry,
        expectedRevision: null,
        payload,
      }
      const counts = async () =>
        (
          await sql`SELECT (SELECT count(*) FROM acc_journal_entries) AS ledger, (SELECT count(*) FROM acc_inventory_entries) AS inventory`.execute(
            db,
          )
        ).rows[0]
      const before = await counts()
      const over = await owner.post('/vou/service-contract/submit-new', {
        ...input,
        payload: {
          ...payload,
          attachments: [...payload.attachments, payload.attachments[0]],
        },
      })
      assert.equal(over.errorKey, 'validation_failed')
      const saved = await owner.post('/vou/service-contract/submit-new', input)
      assert.equal(saved.code, 0, saved.errorKey)
      const approved = await peer.post('/vou/service-contract/approve', {
        documentId: input.documentId,
        submissionId: entry,
        expectedRevision: saved.data.revision,
      })
      assert.equal(approved.code, 0, approved.errorKey)
      assert.equal(approved.data.payload.attachments.length, 20)
      for (const file of staged) {
        const read = {
          documentId: input.documentId,
          submissionId: entry,
          fileId: file.fileId,
        }
        assert.equal(
          (await denied.post('/vou/service-contract/attachment-read', read))
            .errorKey,
          'approval_invalid_action',
        )
        const issued = await owner.post(
          '/vou/service-contract/attachment-read',
          read,
        )
        assert.equal(issued.code, 0, issued.errorKey)
        const downloaded = await owner.download(
          new URL(issued.data.downloadUrl).pathname,
        )
        assert.equal(downloaded.status, 200)
        assert.equal(
          downloaded.headers.get('Content-Type'),
          'application/octet-stream',
        )
        assert.match(
          downloaded.headers.get('Content-Disposition')!,
          /^attachment;/,
        )
        assert.equal(
          downloaded.headers.get('X-Content-Type-Options'),
          'nosniff',
        )
        assert.deepEqual(
          Buffer.from(await downloaded.arrayBuffer()),
          Buffer.from(file.contentBase64, 'base64'),
        )
        assert.equal(
          (await owner.download(new URL(issued.data.downloadUrl).pathname))
            .status,
          404,
        )
      }
      assert.deepEqual(await counts(), before)
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
