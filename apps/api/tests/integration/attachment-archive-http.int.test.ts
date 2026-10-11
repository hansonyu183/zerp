import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

test('ordinary archive HTTP preserves empty, large and opaque originals with fixed identities and bounded capacity', async (context) => {
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
        ...['supplier', 'product'].flatMap((entity) => [
          ...[
            'attachment-stage',
            'attachment-read',
            'attachment-cleanup',
            'submission-get',
            'submit-new',
            'submit-change',
            'approve',
            'delete',
          ].map((action) => `/dcl/${entity}/${action}`),
          ...['get', 'versions', 'attachment-read'].map(
            (action) => `/bob/${entity}/${action}`,
          ),
        ]),
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
      const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
      if (!server.listening)
        await new Promise<void>((resolve) => server.once('listening', resolve))
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const origin = `http://127.0.0.1:${address.port}`
      // Receive the complete committed upstream response, then destroy the
      // client socket. Retrying must use the actual same stage/submit identity.
      const loss = createServer(async (request, response) => {
        try {
          const chunks: Buffer[] = []
          for await (const chunk of request) chunks.push(Buffer.from(chunk))
          const headers = Object.fromEntries(
            Object.entries(request.headers).filter(
              ([name, value]) =>
                name !== 'host' &&
                name !== 'connection' &&
                typeof value === 'string',
            ),
          ) as Record<string, string>
          const upstream = await fetch(origin + request.url!, {
            method: request.method,
            headers,
            body: Buffer.concat(chunks),
          })
          await upstream.arrayBuffer()
        } finally {
          response.destroy()
        }
      })
      await new Promise<void>((resolve) => loss.listen(0, '127.0.0.1', resolve))
      const lossAddress = loss.address()
      assert.ok(lossAddress && typeof lossAddress !== 'string')
      const lossOrigin = `http://127.0.0.1:${lossAddress.port}`
      context.after(async () => {
        loss.closeAllConnections()
        server.closeAllConnections()
        await Promise.all([
          new Promise<void>((resolve, reject) =>
            loss.close((error) => (error ? reject(error) : resolve())),
          ),
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
        ])
      })
      async function client(user: typeof submitter) {
        const response = await fetch(origin + '/session/auth/signin', {
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
          post: async (path: string, input: unknown, loseResponse = false) =>
            (
              await fetch((loseResponse ? lossOrigin : origin) + path, {
                method: 'POST',
                headers,
                body: JSON.stringify(input),
              })
            ).json(),
          download: (path: string) => fetch(origin + path, { headers }),
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
      const customer = f.salePayload.customer
      const empty = {
        ...stage(Buffer.alloc(0), '原空文件.et'),
        subjectId: customer.objectId,
      }
      const dcl = await owner.post('/dcl/customer/attachment-stage', empty)
      assert.equal(dcl.code, 0, dcl.errorKey)
      assert.equal(dcl.data.size, 0)
      assert.deepEqual(
        (await owner.post('/dcl/customer/attachment-stage', empty)).data.fileId,
        empty.fileId,
      )
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
      for (const entity of ['supplier', 'product'] as const) {
        const originalSubjectId =
          entity === 'supplier'
            ? f.supplierId
            : f.salePayload.productLines[0]!.product.objectId
        const subjectId = ulid()
        const current = await owner.post(`/bob/${entity}/get`, {
          objectId: originalSubjectId,
        })
        assert.equal(current.code, 0, current.errorKey)
        const baseline = await owner.post(`/dcl/${entity}/submission-get`, {
          subjectId: originalSubjectId,
          submissionId: current.data.sourceApprovalEntryId,
        })
        assert.equal(baseline.code, 0, baseline.errorKey)
        assert.deepEqual(baseline.data.snapshot.attachments, [])
        const content = Buffer.alloc(
          20 * 1024 * 1024,
          entity === 'supplier' ? 91 : 92,
        )
        const staged = { ...stage(content, ` 原${entity}文件.et `), subjectId }
        await assert.rejects(
          owner.post(`/dcl/${entity}/attachment-stage`, staged, true),
          /fetch failed/,
        )
        const firstStage = await owner.post(
          `/dcl/${entity}/attachment-stage`,
          staged,
        )
        assert.equal(firstStage.code, 0, firstStage.errorKey)
        assert.equal(firstStage.data.size, content.length)
        assert.deepEqual(
          (await owner.post(`/dcl/${entity}/attachment-stage`, staged)).data,
          firstStage.data,
        )
        assert.equal(
          (await peer.post(`/dcl/${entity}/attachment-stage`, staged)).errorKey,
          'archive_attachment_staging_conflict',
        )
        assert.equal(
          (
            await owner.post(`/dcl/${entity}/attachment-stage`, {
              ...staged,
              subjectId: ulid(),
            })
          ).errorKey,
          'archive_attachment_staging_conflict',
        )
        const other = entity === 'supplier' ? 'product' : 'supplier'
        assert.equal(
          (await owner.post(`/dcl/${other}/attachment-stage`, staged)).errorKey,
          'archive_attachment_staging_conflict',
        )
        assert.equal(
          (await denied.post(`/dcl/${entity}/attachment-stage`, staged))
            .errorKey,
          'forbidden',
        )
        const submissionId = ulid()
        const metadata = {
          id: staged.fileId,
          stagingId: staged.stagingId,
          fileName: staged.fileName,
          contentType: staged.mimeType,
          sizeBytes: staged.size,
          sha256: staged.digest,
        }
        const emptyArchive = {
          ...stage(Buffer.alloc(0), '原空文件.et'),
          subjectId,
        }
        assert.equal(
          (await owner.post(`/dcl/${entity}/attachment-stage`, emptyArchive))
            .code,
          0,
        )
        const emptyMeta = {
          id: emptyArchive.fileId,
          stagingId: emptyArchive.stagingId,
          fileName: emptyArchive.fileName,
          contentType: emptyArchive.mimeType,
          sizeBytes: emptyArchive.size,
          sha256: emptyArchive.digest,
        }
        const input = {
          subjectId,
          submissionId,
          idempotencyKey: submissionId,
          expectedLatestApprovedSubmissionId: null,
          expectedLatestApprovedRevision: null,
          snapshot: {
            ...baseline.data.snapshot,
            ...(entity === 'product'
              ? { name: '原件产品 ' + ulid(), barcode: '' }
              : { displayName: '原件供应商 ' + ulid() }),
            attachments: [metadata, emptyMeta],
          },
        }
        await assert.rejects(
          owner.post(`/dcl/${entity}/submit-new`, input, true),
          /fetch failed/,
        )
        const saved = await owner.post(`/dcl/${entity}/submit-new`, input)
        assert.equal(saved.code, 0, saved.errorKey)
        const replay = await owner.post(`/dcl/${entity}/submit-new`, input)
        assert.equal(replay.code, 0, replay.errorKey)
        assert.equal(replay.data.submissionId, saved.data.submissionId)
        assert.equal(
          (
            await peer.post(`/dcl/${entity}/approve`, {
              subjectId,
              submissionId,
              expectedRevision: saved.data.revision,
            })
          ).code,
          0,
        )
        const read = {
          source: 'submission',
          subjectId,
          submissionId,
          fileId: staged.fileId,
        }
        for (const [path, body] of [
          [`/dcl/${entity}/attachment-read`, read],
          [`/bob/${entity}/attachment-read`, read],
          [
            `/bob/${entity}/attachment-read`,
            { source: 'current', objectId: subjectId, fileId: staged.fileId },
          ],
        ] as const) {
          const result = await owner.post(path, body)
          assert.equal(result.code, 0, result.errorKey)
          assert.equal(result.data.fileName, staged.fileName)
          assert.equal(result.data.digest, staged.digest)
          assert.deepEqual(
            Buffer.from(result.data.contentBase64, 'base64'),
            content,
          )
        }
        const currentOnly = await client(
          await principal([
            `/bob/${entity}/attachment-read`,
            `/bob/${entity}/get`,
          ]),
        )
        const historyOnly = await client(
          await principal([
            `/bob/${entity}/attachment-read`,
            `/bob/${entity}/versions`,
          ]),
        )
        const fileOnly = await client(
          await principal([`/bob/${entity}/attachment-read`]),
        )
        const currentRead = {
          source: 'current',
          objectId: subjectId,
          fileId: emptyArchive.fileId,
        }
        const historicalRead = { ...read, fileId: emptyArchive.fileId }
        assert.equal(
          (
            await currentOnly.post(
              `/bob/${entity}/attachment-read`,
              currentRead,
            )
          ).code,
          0,
        )
        assert.equal(
          (
            await currentOnly.post(
              `/bob/${entity}/attachment-read`,
              historicalRead,
            )
          ).errorKey,
          'forbidden',
        )
        assert.equal(
          (
            await historyOnly.post(
              `/bob/${entity}/attachment-read`,
              historicalRead,
            )
          ).code,
          0,
        )
        assert.equal(
          (
            await historyOnly.post(
              `/bob/${entity}/attachment-read`,
              currentRead,
            )
          ).errorKey,
          'forbidden',
        )
        assert.equal(
          (await fileOnly.post(`/bob/${entity}/attachment-read`, currentRead))
            .errorKey,
          'forbidden',
        )
        assert.equal(
          (
            await fileOnly.post(
              `/bob/${entity}/attachment-read`,
              historicalRead,
            )
          ).errorKey,
          'forbidden',
        )
        const emptyRead = await owner.post(`/bob/${entity}/attachment-read`, {
          ...read,
          fileId: emptyArchive.fileId,
        })
        assert.equal(emptyRead.code, 0, emptyRead.errorKey)
        assert.equal(emptyRead.data.size, 0)
        assert.equal(emptyRead.data.contentBase64, '')
        assert.equal(emptyRead.data.digest, emptyArchive.digest)
        assert.equal(
          (await denied.post(`/bob/${entity}/attachment-read`, read)).errorKey,
          'forbidden',
        )
        assert.notEqual(
          (await owner.post(`/bob/${other}/attachment-read`, read)).code,
          0,
        )
        assert.notEqual(
          (
            await owner.post(`/bob/${entity}/attachment-read`, {
              ...read,
              subjectId: ulid(),
            })
          ).code,
          0,
        )
        assert.equal(
          (
            await owner.post(`/dcl/${other}/attachment-stage`, {
              ...stage(Buffer.alloc(0), '错误实体.et'),
              subjectId,
            })
          ).errorKey,
          'archive_attachment_staging_invalid',
        )
        const approved = await owner.post(`/dcl/${entity}/submission-get`, {
          subjectId,
          submissionId,
        })
        const nextId = ulid()
        const retained = {
          subjectId,
          submissionId: nextId,
          idempotencyKey: nextId,
          expectedLatestApprovedSubmissionId: submissionId,
          expectedLatestApprovedRevision: approved.data.revision,
          snapshot: approved.data.snapshot,
        }
        const next = await owner.post(`/dcl/${entity}/submit-change`, retained)
        assert.equal(next.code, 0, next.errorKey)
        assert.equal(
          (
            await peer.post(`/dcl/${entity}/approve`, {
              subjectId,
              submissionId: nextId,
              expectedRevision: next.data.revision,
            })
          ).code,
          0,
        )
        const historical = await owner.post(
          `/bob/${entity}/attachment-read`,
          read,
        )
        assert.equal(historical.code, 0, historical.errorKey)
        assert.deepEqual(
          Buffer.from(historical.data.contentBase64, 'base64'),
          content,
        )
        const versions = await owner.post(`/bob/${entity}/versions`, {
          subjectId,
        })
        assert.equal(versions.code, 0, versions.errorKey)
        assert.ok(
          versions.data.items.some(
            (item: { submissionId: string }) =>
              item.submissionId === submissionId,
          ),
        )
        const file = await db
          .selectFrom('dcl_archive_attachments')
          .select('storage_key')
          .where('approval_entry_id', '=', submissionId)
          .where('file_id', '=', staged.fileId)
          .executeTakeFirstOrThrow()
        assert.equal(
          file.storage_key,
          `permanent/dcl/${entity}/${submissionId}/${staged.fileId}`,
        )
        const reused = await db
          .selectFrom('dcl_archive_attachments')
          .select('storage_key')
          .where('approval_entry_id', '=', nextId)
          .where('file_id', '=', staged.fileId)
          .executeTakeFirstOrThrow()
        assert.equal(reused.storage_key, file.storage_key)
        const corrupted = Buffer.from(content)
        corrupted[0] = 0
        await writeFile(join(root, file.storage_key), corrupted)
        assert.equal(
          (await owner.post(`/bob/${entity}/attachment-read`, read)).errorKey,
          'archive_attachment_invalid_content',
        )
        await writeFile(join(root, file.storage_key), content)
        assert.equal(
          (await owner.post(`/bob/${entity}/attachment-read`, read)).code,
          0,
        )
        const expired = {
          ...stage(Buffer.alloc(0), '过期空文件.et'),
          subjectId,
        }
        assert.equal(
          (await owner.post(`/dcl/${entity}/attachment-stage`, expired)).code,
          0,
        )
        await db
          .updateTable('dcl_archive_attachment_staging')
          .set({ created_at: new Date(-1000), expires_at: new Date(0) })
          .where('id', '=', expired.stagingId)
          .execute()
        assert.equal(
          (await owner.post(`/dcl/${other}/attachment-cleanup`, {})).data
            .deleted,
          0,
        )
        assert.equal(
          (await owner.post(`/dcl/${entity}/attachment-cleanup`, {})).data
            .deleted,
          1,
        )
        assert.equal(
          (await owner.post(`/dcl/${entity}/attachment-cleanup`, {})).data
            .deleted,
          0,
        )
        const newFile = {
          ...stage(Buffer.from([0, 255]), '开放删除.et'),
          subjectId,
        }
        assert.equal(
          (await owner.post(`/dcl/${entity}/attachment-stage`, newFile)).code,
          0,
        )
        const newMeta = {
          id: newFile.fileId,
          stagingId: newFile.stagingId,
          fileName: newFile.fileName,
          contentType: newFile.mimeType,
          sizeBytes: newFile.size,
          sha256: newFile.digest,
        }
        const last = await owner.post(`/dcl/${entity}/submission-get`, {
          subjectId,
          submissionId: nextId,
        })
        const deleteId = ulid()
        const removable = await owner.post(`/dcl/${entity}/submit-change`, {
          ...retained,
          submissionId: deleteId,
          idempotencyKey: deleteId,
          expectedLatestApprovedSubmissionId: nextId,
          expectedLatestApprovedRevision: last.data.revision,
          snapshot: {
            ...last.data.snapshot,
            attachments: [...last.data.snapshot.attachments, newMeta],
          },
        })
        assert.equal(removable.code, 0, removable.errorKey)
        const newStorage = await db
          .selectFrom('dcl_archive_attachments')
          .select('storage_key')
          .where('approval_entry_id', '=', deleteId)
          .where('file_id', '=', newFile.fileId)
          .executeTakeFirstOrThrow()
        assert.equal(
          (
            await owner.post(`/dcl/${entity}/delete`, {
              subjectId,
              submissionId: deleteId,
              expectedRevision: removable.data.revision,
            })
          ).code,
          0,
        )
        await assert.rejects(store.read(newStorage.storage_key))
        assert.deepEqual(await store.read(file.storage_key), content)
        assert.equal(
          (await owner.post(`/bob/${entity}/attachment-read`, read)).code,
          0,
        )
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
