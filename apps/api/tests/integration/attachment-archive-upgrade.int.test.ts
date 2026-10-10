import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { sql, type Transaction } from 'kysely'
import type { DB } from '../../src/db/generated.ts'
import { ulid } from 'ulid'
import type { VouPayloadFor } from '@zerp/model'
import { VouService } from '../../src/vou/service.ts'
import { AttachmentStore } from '../../src/platform/attachment-store.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import {
  inspectAttachmentArchiveUpgrade,
  upgradeAttachmentArchive,
} from '../../src/platform/attachment-archive-upgrade.ts'
import { withCommittedPurchaseDatabase } from '../fixtures/vou-purchase-http.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import {
  precedingAttachmentArchiveChecks,
  precedingMaintainedConstraintNames,
} from '../fixtures/attachment-archive-before.ts'

for (const maintained of [false, true])
  test(`ordinary archive upgrade preserves populated ${maintained ? 'maintained' : 'initialized'} facts and file keys atomically`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'zerp-archive-upgrade-'))
    try {
      await withCommittedPurchaseDatabase(async (db) => {
        await precedingAttachmentArchiveChecks(db)
        if (maintained) await precedingMaintainedConstraintNames(db)
        const f = await seedOrderListFixture(db, 0, ['purchase-order'])
        const operator = {
          ...f.submitter,
          userId: ulid(),
          roleId: ulid(),
          username: 'archive-maintenance-' + ulid(),
        }
        await new TargetBootstrapService(db).createE2EPrincipal(operator, true)
        const actor = {
          id: f.submitter.userId,
          permissions: ['/vou/purchase-order/attachment-stage'],
          trusted: true,
        }
        const store = new AttachmentStore(root)
        const vou = new VouService(
          db,
          { acc: { async apply() {} }, wfl: { async apply() {} } },
          { attachmentStore: store },
        )
        const content = Buffer.from('%PDF-1.7 原始归档')
        const file = {
          stagingId: ulid(),
          fileId: ulid(),
          fileName: '原合同.pdf',
          mimeType: 'application/pdf' as const,
          size: content.length,
          digest: createHash('sha256').update(content).digest('hex'),
          contentBase64: content.toString('base64'),
        }
        await vou.stageAttachment('purchase-order', file, actor)
        const submissionId = ulid()
        const saved = await vou.submit(
          'purchase-order',
          'submit-new',
          {
            documentId: ulid(),
            submissionId,
            idempotencyKey: submissionId,
            expectedRevision: null,
            payload: {
              ...(f.purchase.payload as VouPayloadFor<'purchase-order'>),
              attachments: [
                {
                  id: file.fileId,
                  stagingId: file.stagingId,
                  fileName: file.fileName,
                  contentType: file.mimeType,
                  sizeBytes: file.size,
                  sha256: file.digest,
                },
              ],
            },
          },
          actor,
          'fixture-archive-upgrade',
        )
        const adopted = await db
          .selectFrom('vou_attachments')
          .selectAll()
          .where('approval_entry_id', '=', saved.submissionId)
          .executeTakeFirstOrThrow()
        assert.deepEqual(await store.read(adopted.storage_key), content)
        const initial = await inspectAttachmentArchiveUpgrade(db)
        assert.equal(initial.layout, 'SOURCE')
        assert.equal(initial.publicTables, 149)
        const input = {
          baseline: initial.baseline,
          actorId: operator.userId,
          sourceReleaseSha: 'a'.repeat(40),
          targetReleaseSha: 'b'.repeat(40),
          writersFrozen: true as const,
        }
        await assert.rejects(
          upgradeAttachmentArchive(db, { ...input, baseline: 'c'.repeat(64) }),
          /baseline_changed/,
        )
        await assert.rejects(
          upgradeAttachmentArchive(db, {
            ...input,
            actorId: f.submitter.userId,
          }),
          /operator_required/,
        )
        await assert.rejects(
          upgradeAttachmentArchive(db, { ...input, writersFrozen: false }),
          /writers_must_be_frozen/,
        )
        await sql`ALTER TABLE vou_attachments RENAME CONSTRAINT vou_attachments_size_bytes_check TO unexpected_constraint`.execute(
          db,
        )
        assert.equal(
          (await inspectAttachmentArchiveUpgrade(db)).layout,
          'UNSUPPORTED',
        )
        await assert.rejects(
          upgradeAttachmentArchive(db, input),
          /source_layout_required/,
        )
        await sql`ALTER TABLE vou_attachments RENAME CONSTRAINT unexpected_constraint TO vou_attachments_size_bytes_check`.execute(
          db,
        )
        assert.deepEqual(await inspectAttachmentArchiveUpgrade(db), initial)
        // An external failure immediately before commit must roll back the actual
        // upgrade's DDL, not merely a hand-written copy of those statements.
        const abortBeforeCommit = new Proxy(db, {
          get(target, key) {
            if (key === 'transaction')
              return () =>
                new Proxy(target.transaction(), {
                  get(builder, member) {
                    if (member === 'execute')
                      return (run: (tx: Transaction<DB>) => Promise<unknown>) =>
                        builder.execute(async (tx) => {
                          await run(tx)
                          throw new Error('fixture commit failure')
                        })

                    const value = Reflect.get(builder, member)
                    return typeof value === 'function'
                      ? value.bind(builder)
                      : value
                  },
                })
            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
        await assert.rejects(
          upgradeAttachmentArchive(abortBeforeCommit, input),
          /fixture commit failure/,
        )
        assert.deepEqual(await inspectAttachmentArchiveUpgrade(db), initial)
        const result = await upgradeAttachmentArchive(db, input)
        assert.equal(result.originalPublicTables, 149)
        assert.equal(result.originalFactsDigest, initial.factsDigest)
        assert.equal(
          (await inspectAttachmentArchiveUpgrade(db)).layout,
          'CURRENT',
        )
        assert.deepEqual(
          await db
            .selectFrom('vou_attachments')
            .selectAll()
            .where('approval_entry_id', '=', saved.submissionId)
            .executeTakeFirstOrThrow(),
          adopted,
        )
        assert.deepEqual(await store.read(adopted.storage_key), content)
        await assert.rejects(
          upgradeAttachmentArchive(db, input),
          /source_layout_required/,
        )
        const empty = {
          ...file,
          stagingId: ulid(),
          fileId: ulid(),
          fileName: '原空文件.et',
          mimeType: 'application/octet-stream' as const,
          size: 0,
          digest: createHash('sha256').update(Buffer.alloc(0)).digest('hex'),
          contentBase64: '',
        }
        assert.equal(
          (await vou.stageAttachment('purchase-order', empty, actor)).size,
          0,
        )
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

test('archive maintenance CLI validates frozen writers, paired bytes and exact release before touching schema', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zerp-archive-cli-'))
  try {
    await withCommittedPurchaseDatabase(async (db) => {
      await precedingAttachmentArchiveChecks(db)
      const f = await seedOrderListFixture(db, 0, ['purchase-order'])
      const operator = {
        ...f.submitter,
        userId: ulid(),
        roleId: ulid(),
        username: 'archive-cli-' + ulid(),
      }
      await new TargetBootstrapService(db).createE2EPrincipal(operator, true)
      const initial = await inspectAttachmentArchiveUpgrade(db)
      const url = new URL(process.env.TARGET_TEST_DATABASE_URL!)
      const name = (
        await sql<{
          name: string
        }>`SELECT current_database() AS name`.execute(db)
      ).rows[0]!.name
      url.pathname = '/' + name
      const baselinePath = join(root, 'baseline.json'),
        backupPath = join(root, 'backup.json'),
        database = join(root, 'database.dump'),
        attachments = join(root, 'attachments.tar')
      // Input guard vectors only; these bytes are not a dump/restore proof.
      await writeFile(database, 'fixture database recovery guard')
      await writeFile(attachments, 'fixture attachment recovery guard')
      await writeFile(baselinePath, JSON.stringify(initial))
      const manifest = {
        sourceReleaseSha: 'a'.repeat(40),
        targetReleaseSha: 'b'.repeat(40),
        database: {
          path: database,
          sha256: createHash('sha256')
            .update('fixture database recovery guard')
            .digest('hex'),
        },
        attachments: {
          path: attachments,
          sha256: createHash('sha256')
            .update('fixture attachment recovery guard')
            .digest('hex'),
        },
      }
      await writeFile(backupPath, JSON.stringify(manifest))
      const run = (args: string[], release = manifest.targetReleaseSha) =>
        spawnSync(
          process.execPath,
          ['scripts/upgrade-attachment-archive.ts', ...args],
          {
            cwd: new URL('../../', import.meta.url),
            encoding: 'utf8',
            env: {
              ...process.env,
              TARGET_DATABASE_URL: url.toString(),
              TARGET_DATABASE_SCOPE: 'isolated',
              ZERP_RELEASE_SHA: release,
            },
          },
        )
      const args = [
        '--apply',
        '--baseline',
        baselinePath,
        '--backup',
        backupPath,
        '--actor-id',
        operator.userId,
      ]
      assert.match(run(args).stderr, /inputs_required/)
      args.push('--writers-frozen')
      assert.match(run(args, 'c'.repeat(40)).stderr, /release_mismatch/)
      await writeFile(attachments, 'corrupted recovery guard')
      assert.match(run(args).stderr, /backup_digest_mismatch/)
      assert.deepEqual(await inspectAttachmentArchiveUpgrade(db), initial)
      await writeFile(attachments, 'fixture attachment recovery guard')
      const applied = run(args)
      assert.equal(applied.status, 0, applied.stderr)
      assert.equal(
        JSON.parse(applied.stdout).originalFactsDigest,
        initial.factsDigest,
      )
      assert.equal(
        (await inspectAttachmentArchiveUpgrade(db)).layout,
        'CURRENT',
      )
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
