import assert from 'node:assert/strict'
import test from 'node:test'
import { sql, type Kysely } from 'kysely'
import { ulid } from 'ulid'
import type { DB } from '../../src/db/generated.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import { withWflDatabase } from './wfl-fixture.ts'
import {
  inspectPurchaseCarryoverUpgrade,
  upgradePurchaseCarryover,
  inspectPurchaseSourceClosureUpgrade,
  upgradePurchaseSourceClosure,
  inspectStandaloneReceiptUpgrade,
  upgradeStandaloneReceipts,
} from '../../src/vou/purchase-carryover-upgrade.ts'

const release = {
  sourceReleaseSha: '1'.repeat(40),
  targetReleaseSha: '2'.repeat(40),
}
async function oldFixture(db: Kysely<DB>, approvedReturn = false) {
  const f = await seedOrderListFixture(db, 0)
  const maintainer = {
    ...f.submitter,
    userId: ulid(),
    roleId: ulid(),
    username: `carry-upgrade-${ulid()}`,
  }
  await new TargetBootstrapService(db).createE2EPrincipal(maintainer, true)
  const original = await f.vou.get('purchase-order', f.purchase.documentId, {
    id: f.submitter.userId,
    permissions: [],
    trusted: true,
  })
  if (approvedReturn) {
    const actor = { id: f.submitter.userId, permissions: [], trusted: true },
      reviewer = { ...actor, id: f.reviewer.userId }
    const payload = f.purchase
      .payload as import('@zerp/model').VouPayloadFor<'purchase-order'>
    await f.vou.review(
      'purchase-order',
      'approve',
      {
        documentId: f.purchase.documentId,
        submissionId: f.purchase.submissionId,
        expectedRevision: f.purchase.revision,
      },
      reviewer,
      'legacy-return-source',
    )
    const save = async (
      entity: 'purchase-inbound' | 'purchase-return',
      body: import('@zerp/model').VouPayload,
    ) => {
      const documentId = ulid(),
        submissionId = ulid()
      const saved = await f.vou.submit(
        entity,
        'submit-new',
        {
          documentId,
          submissionId,
          idempotencyKey: submissionId,
          expectedRevision: null,
          payload: body,
        },
        actor,
        'legacy-return',
      )
      return f.vou.review(
        entity,
        'approve',
        { documentId, submissionId, expectedRevision: saved.revision },
        reviewer,
        'legacy-return',
      )
    }
    const base = {
      businessDate: payload.businessDate,
      currency: payload.currency,
      attachments: [],
      supplier: payload.supplier,
      warehouse: payload.warehouse,
      parentEntity: 'purchase-order' as const,
      parentDocumentId: f.purchase.documentId,
    }
    const inbound = await save('purchase-inbound', {
      ...base,
      sourceLines: [
        { sourceLineId: payload.productLines[0]!.lineId, baseQuantity: '1' },
      ],
    })
    await save('purchase-return', {
      ...base,
      returnReason: '真实正常路径形成的旧退货夹具',
      returnLines: [
        {
          sourceDocumentId: inbound.documentId,
          sourceLineId: payload.productLines[0]!.lineId,
          baseQuantity: '1',
        },
      ],
    })
  }
  await sql`DROP TABLE vou_prior_facts,vou_return_allocation_counters`.execute(
    db,
  )
  await sql`ALTER TABLE vou_source_line_snapshots DROP COLUMN prior_amount_minor`.execute(
    db,
  )
  await sql`ALTER TABLE vou_return_line_snapshots DROP COLUMN prior_amount_minor,DROP COLUMN allocation_sequence`.execute(
    db,
  )
  return { f, maintainer, original }
}
test('purchase structural upgrade preserves every original public row and rejects repeat apply', async () => {
  await withWflDatabase(async (db) => {
    const { f, maintainer, original } = await oldFixture(db)
    const before = await inspectPurchaseCarryoverUpgrade(db)
    assert.equal(before.layout, 'LEGACY')
    assert.equal(before.approvedPurchaseReturns, '0')
    const result = await upgradePurchaseCarryover(db, {
      ...release,
      baseline: before.baseline,
      actorId: maintainer.userId,
    })
    assert.equal(result.upgraded, true)
    assert.equal(result.originalPublicTables, before.publicTables)
    assert.equal((await inspectPurchaseCarryoverUpgrade(db)).layout, 'CURRENT')
    assert.deepEqual(
      await f.vou.get('purchase-order', f.purchase.documentId, {
        id: f.submitter.userId,
        permissions: [],
        trusted: true,
      }),
      original,
    )
    await assert.rejects(
      upgradePurchaseCarryover(db, {
        ...release,
        baseline: before.baseline,
        actorId: maintainer.userId,
      }),
      /legacy_layout_required/,
    )
  })
})
test('purchase structural upgrade refuses changed data and non-admins without partial DDL', async () => {
  await withWflDatabase(async (db) => {
    const { f, maintainer } = await oldFixture(db)
    const before = await inspectPurchaseCarryoverUpgrade(db)
    await assert.rejects(
      upgradePurchaseCarryover(db, {
        ...release,
        baseline: before.baseline,
        actorId: f.submitter.userId,
      }),
      /operator_required/,
    )
    assert.deepEqual(await inspectPurchaseCarryoverUpgrade(db), before)
    // Metadata maintenance changes the baseline even outside the two altered tables.
    await sql`UPDATE app_users SET display_name='changed maintenance baseline' WHERE id=${maintainer.userId}`.execute(
      db,
    )
    await assert.rejects(
      upgradePurchaseCarryover(db, {
        ...release,
        baseline: before.baseline,
        actorId: maintainer.userId,
      }),
      /baseline_changed/,
    )
    assert.equal((await inspectPurchaseCarryoverUpgrade(db)).layout, 'LEGACY')
    await sql`ALTER TABLE vou_source_line_snapshots ADD COLUMN unexpected_marker text`.execute(
      db,
    )
    const unsupported = await inspectPurchaseCarryoverUpgrade(db)
    assert.equal(unsupported.layout, 'UNSUPPORTED')
    assert.equal(unsupported.publicTables, null)
    await assert.rejects(
      upgradePurchaseCarryover(db, {
        ...release,
        baseline: unsupported.baseline,
        actorId: maintainer.userId,
      }),
      /legacy_layout_required/,
    )
  })
})
test('post-DDL purchase verification failure rolls back all new tables and columns', async () => {
  await withWflDatabase(async (db) => {
    const { maintainer } = await oldFixture(db)
    const before = await inspectPurchaseCarryoverUpgrade(db)
    // Inject a post-DDL reader failure at the Kysely seam.
    const broken = new Proxy(db, {
      get(target, key) {
        if (key === 'transaction')
          return () => ({
            execute: async (fn: (tx: typeof db) => Promise<unknown>) =>
              target.transaction().execute(async (tx) => {
                const proxy = new Proxy(tx, {
                  get(value, property) {
                    if (property === 'getExecutor')
                      return () => {
                        const executor = value.getExecutor()
                        return new Proxy(executor, {
                          get(e, key) {
                            if (key === 'executeQuery')
                              return (
                                ...args: Parameters<typeof e.executeQuery>
                              ) => {
                                if (
                                  /to_jsonb\(fact\).*prior_amount_minor/.test(
                                    args[0].sql,
                                  )
                                )
                                  throw new Error(
                                    'fixture post-ddl verification failure',
                                  )
                                return e.executeQuery(...args)
                              }
                            const method = Reflect.get(e, key, e)
                            return typeof method === 'function'
                              ? method.bind(e)
                              : method
                          },
                        })
                      }
                    const method = Reflect.get(value, property, value)
                    return typeof method === 'function'
                      ? method.bind(value)
                      : method
                  },
                })
                return fn(proxy as unknown as typeof db)
              }),
          })
        const method = Reflect.get(target, key, target)
        return typeof method === 'function' ? method.bind(target) : method
      },
    })
    await assert.rejects(
      upgradePurchaseCarryover(broken, {
        ...release,
        baseline: before.baseline,
        actorId: maintainer.userId,
      }),
      /fixture post-ddl verification failure/,
    )
    assert.deepEqual(await inspectPurchaseCarryoverUpgrade(db), before)
  })
})

test('purchase CLI checks frozen writers, backup bytes, release and baseline before schema mutation', async (context) => {
  const { createDatabase } = await import('../../src/db/database.ts')
  const { mkdir, readFile, writeFile, rm } = await import('node:fs/promises')
  const { createHash, randomBytes } = await import('node:crypto')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { hashPassword } = await import('../../src/app/session.ts')
  const { readTargetPermissionCatalog } =
    await import('../../scripts/target-artifacts.ts')
  const owner = createDatabase(process.env.TARGET_TEST_DATABASE_URL!)
  const name = `purchase_cli_${ulid().toLowerCase()}_test`
  await sql`CREATE DATABASE ${sql.id(name)}`.execute(owner)
  const url = new URL(process.env.TARGET_TEST_DATABASE_URL!)
  url.pathname = `/${name}`
  const db = createDatabase(url.toString())
  const directory = new URL(
    `../../../../.scratch/purchase-cli-${ulid()}/`,
    import.meta.url,
  )
  await mkdir(directory, { recursive: true, mode: 0o700 })
  context.after(async () => {
    await db.destroy()
    await sql`DROP DATABASE ${sql.id(name)}`.execute(owner)
    await owner.destroy()
    await rm(directory, { recursive: true, force: true })
  })
  await sql
    .raw(
      await readFile(
        new URL('../../db/target-schema.sql', import.meta.url),
        'utf8',
      ),
    )
    .execute(db)
  const bootstrap = new TargetBootstrapService(db)
  await bootstrap.syncPermissionCatalog(await readTargetPermissionCatalog())
  const actorId = ulid()
  await bootstrap.createE2EPrincipal(
    {
      userId: actorId,
      roleId: ulid(),
      username: `purchase-cli-${ulid()}`,
      passwordHash: await hashPassword(randomBytes(24).toString('hex')),
    },
    true,
  )
  await sql`DROP TABLE vou_prior_facts,vou_return_allocation_counters`.execute(
    db,
  )
  await sql`ALTER TABLE vou_source_line_snapshots DROP COLUMN prior_amount_minor`.execute(
    db,
  )
  await sql`ALTER TABLE vou_return_line_snapshots DROP COLUMN prior_amount_minor,DROP COLUMN allocation_sequence`.execute(
    db,
  )
  const before = await inspectPurchaseCarryoverUpgrade(db)
  const baselineFile = new URL('baseline.json', directory),
    backupFile = new URL('backup.json', directory)
  const databaseFile = new URL('database.guard-fixture', directory),
    attachmentFile = new URL('attachments.guard-fixture', directory)
  await writeFile(baselineFile, JSON.stringify(before), { mode: 0o600 })
  // Guard vectors only: actual dump/restore proof is required in the release operation.
  await writeFile(databaseFile, 'database guard fixture', { mode: 0o600 })
  await writeFile(attachmentFile, 'attachment guard fixture', { mode: 0o600 })
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex')
  const manifest = {
    ...release,
    database: {
      path: databaseFile.pathname,
      sha256: hash('database guard fixture'),
    },
    attachments: {
      path: attachmentFile.pathname,
      sha256: hash('attachment guard fixture'),
    },
  }
  await writeFile(backupFile, JSON.stringify(manifest), { mode: 0o600 })
  const run = (...args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [
        new URL('../../scripts/upgrade-purchase-carryover.ts', import.meta.url)
          .pathname,
        ...args,
      ],
      {
        env: {
          ...process.env,
          TARGET_DATABASE_URL: url.toString(),
          TARGET_DATABASE_SCOPE: 'isolated',
          ZERP_RELEASE_SHA: release.targetReleaseSha,
        },
      },
    )
  const args = [
    '--apply',
    '--baseline',
    baselineFile.pathname,
    '--backup',
    backupFile.pathname,
    '--actor-id',
    actorId,
  ]
  await assert.rejects(run(...args), /inputs_required/)
  await writeFile(
    backupFile,
    JSON.stringify({ ...manifest, targetReleaseSha: '3'.repeat(40) }),
  )
  await assert.rejects(run(...args, '--writers-frozen'), /release_mismatch/)
  await writeFile(backupFile, JSON.stringify(manifest))
  await writeFile(databaseFile, 'tampered')
  await assert.rejects(
    run(...args, '--writers-frozen'),
    /backup_digest_mismatch/,
  )
  await writeFile(databaseFile, 'database guard fixture')
  await writeFile(baselineFile, JSON.stringify({ baseline: '0'.repeat(64) }))
  await assert.rejects(run(...args, '--writers-frozen'), /baseline_changed/)
  assert.deepEqual(await inspectPurchaseCarryoverUpgrade(db), before)
  await writeFile(baselineFile, JSON.stringify(before))
  const result = JSON.parse((await run(...args, '--writers-frozen')).stdout)
  assert.equal(result.upgraded, true)
  assert.equal(result.newTablesEmpty, true)
})

test('purchase structural upgrade refuses existing approved refunds without inventing their allocation order', async () => {
  await withWflDatabase(async (db) => {
    const { maintainer } = await oldFixture(db, true)
    const before = await inspectPurchaseCarryoverUpgrade(db)
    assert.equal(before.layout, 'LEGACY')
    assert.equal(before.approvedPurchaseReturns, '1')
    await assert.rejects(
      upgradePurchaseCarryover(db, {
        ...release,
        baseline: before.baseline,
        actorId: maintainer.userId,
      }),
      /existing_refunds_require_review/,
    )
    assert.deepEqual(await inspectPurchaseCarryoverUpgrade(db), before)
  })
})

async function currentUpgradedFixture(db: Kysely<DB>) {
  const fixture = await oldFixture(db)
  const before = await inspectPurchaseCarryoverUpgrade(db)
  await upgradePurchaseCarryover(db, {
    ...release,
    baseline: before.baseline,
    actorId: fixture.maintainer.userId,
  })
  return fixture
}
test('source closure upgrade preserves the prior-capable installation and refuses a repeat', async () => {
  await withWflDatabase(async (db) => {
    const { f, maintainer, original } = await currentUpgradedFixture(db)
    await sql`ALTER TABLE vou_prior_facts DROP COLUMN source_closed`.execute(db)
    const before = await inspectPurchaseSourceClosureUpgrade(db)
    assert.equal(before.layout, 'LEGACY')
    assert.equal(before.priorFacts, 0)
    await assert.rejects(
      upgradePurchaseSourceClosure(db, {
        ...release,
        baseline: before.baseline,
        actorId: f.submitter.userId,
      }),
      /operator_required/,
    )
    assert.deepEqual(await inspectPurchaseSourceClosureUpgrade(db), before)
    const result = await upgradePurchaseSourceClosure(db, {
      ...release,
      baseline: before.baseline,
      actorId: maintainer.userId,
    })
    assert.equal(result.upgraded, true)
    assert.equal(result.originalPublicTables, before.publicTables)
    assert.equal(
      (await inspectPurchaseSourceClosureUpgrade(db)).layout,
      'CURRENT',
    )
    assert.deepEqual(
      await f.vou.get('purchase-order', f.purchase.documentId, {
        id: f.submitter.userId,
        permissions: [],
        trusted: true,
      }),
      original,
    )
    await assert.rejects(
      upgradePurchaseSourceClosure(db, {
        ...release,
        baseline: before.baseline,
        actorId: maintainer.userId,
      }),
      /legacy_layout_required/,
    )
  })
})
test('source closure upgrade refuses to invent the state of an existing prior record', async () => {
  await withWflDatabase(async (db) => {
    const { f, maintainer } = await currentUpgradedFixture(db)
    const payload = f.purchase
      .payload as import('@zerp/model').VouPayloadFor<'purchase-order'>
    const entry = ulid()
    await f.vou.submit(
      'purchase-order',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: entry,
        idempotencyKey: entry,
        expectedRevision: null,
        payload: {
          ...payload,
          priorFact: {
            sourceClosed: true,
            sourceInstanceId: 'old-fixture',
            sourceSchema: 'old',
            sourceDocumentType: 'AA',
            sourceDocumentKey: 'old-order',
            sourceDocumentNo: 'AA-OLD',
            capturedAt: payload.businessDate + 'T23:59:59.000Z',
            snapshotDigest: 'f'.repeat(64),
          },
        },
      },
      { id: f.submitter.userId, permissions: [], trusted: true },
      'legacy-prior-source',
    )
    await sql`ALTER TABLE vou_prior_facts DROP COLUMN source_closed`.execute(db)
    const before = await inspectPurchaseSourceClosureUpgrade(db)
    assert.equal(before.priorFacts, 1)
    await assert.rejects(
      upgradePurchaseSourceClosure(db, {
        ...release,
        baseline: before.baseline,
        actorId: maintainer.userId,
      }),
      /existing_prior_state_requires_review/,
    )
    assert.deepEqual(await inspectPurchaseSourceClosureUpgrade(db), before)
  })
})

async function standaloneLegacyFixture(db: Kysely<DB>) {
  const f = await seedOrderListFixture(db, 0)
  const maintainer = {
    ...f.submitter,
    userId: ulid(),
    roleId: ulid(),
    username: `standalone-upgrade-${ulid()}`,
  }
  await new TargetBootstrapService(db).createE2EPrincipal(maintainer, true)
  const entryId = ulid(),
    documentId = ulid()
  const payload = f.purchase
    .payload as import('@zerp/model').VouPayloadFor<'purchase-order'>
  await f.vou.submit(
    'purchase-order',
    'submit-new',
    {
      documentId,
      submissionId: entryId,
      idempotencyKey: entryId,
      expectedRevision: null,
      payload: {
        ...payload,
        priorFact: {
          sourceClosed: true,
          sourceInstanceId: 'fixture',
          sourceSchema: 'fixture',
          sourceDocumentType: 'AA',
          sourceDocumentKey: 'preserved',
          sourceDocumentNo: 'AA-PRESERVED',
          capturedAt: payload.businessDate + 'T23:59:59.123456Z',
          snapshotDigest: 'a'.repeat(64),
        },
      },
    },
    { id: f.submitter.userId, permissions: [], trusted: true },
    'standalone-upgrade',
  )
  await f.vou.review(
    'purchase-order',
    'approve',
    { documentId, submissionId: entryId, expectedRevision: '1' },
    { id: f.reviewer.userId, permissions: [], trusted: true },
    'standalone-upgrade',
  )
  const original = await f.vou.get('purchase-order', documentId, {
    id: f.submitter.userId,
    permissions: [],
    trusted: true,
  })
  await sql`DROP TABLE vou_prior_receipt_line_origins`.execute(db)
  await sql`ALTER TABLE vou_prior_facts DROP CONSTRAINT vou_prior_facts_source_document_type_check, ADD CONSTRAINT vou_prior_facts_source_document_type_check CHECK (source_document_type IN ('AA', 'AD', 'AB', 'AF'))`.execute(
    db,
  )
  return { f, maintainer, original }
}
test('standalone receipt upgrade preserves populated prior facts and rejects drift, unauthorised actors and repeat apply', async () => {
  await withWflDatabase(async (db) => {
    const { f, maintainer, original } = await standaloneLegacyFixture(db)
    const before = await inspectStandaloneReceiptUpgrade(db)
    assert.equal(before.layout, 'LEGACY')
    assert.equal(before.priorFacts, 1)
    await assert.rejects(
      upgradeStandaloneReceipts(db, {
        ...release,
        baseline: before.baseline,
        actorId: f.submitter.userId,
      }),
      /operator_required/,
    )
    assert.deepEqual(await inspectStandaloneReceiptUpgrade(db), before)
    await assert.rejects(
      upgradeStandaloneReceipts(db, {
        ...release,
        baseline: '0'.repeat(64),
        actorId: maintainer.userId,
      }),
      /baseline_changed/,
    )
    assert.deepEqual(await inspectStandaloneReceiptUpgrade(db), before)
    const result = await upgradeStandaloneReceipts(db, {
      ...release,
      baseline: before.baseline,
      actorId: maintainer.userId,
    })
    assert.equal(result.priorFactsPreserved, 1)
    assert.equal(result.newOriginTableEmpty, true)
    assert.equal((await inspectStandaloneReceiptUpgrade(db)).layout, 'CURRENT')
    assert.deepEqual(
      await f.vou.get('purchase-order', original.documentId, {
        id: f.submitter.userId,
        permissions: [],
        trusted: true,
      }),
      original,
    )
    await assert.rejects(
      upgradeStandaloneReceipts(db, {
        ...release,
        baseline: before.baseline,
        actorId: maintainer.userId,
      }),
      /legacy_layout_required/,
    )
  })
})
