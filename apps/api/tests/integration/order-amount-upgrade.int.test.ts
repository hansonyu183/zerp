import assert from 'node:assert/strict'
import test from 'node:test'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'
import type { DB } from '../../src/db/generated.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import {
  inspectOrderAmountUpgrade,
  upgradeOrderAmounts,
} from '../../src/vou/order-amount-upgrade.ts'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'
import { orderQuote, intermediaryDecimal } from '@zerp/model'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { createDatabase } from '../../src/db/database.ts'
import { hashPassword } from '../../src/app/session.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

const productTable = 'vou_product_line_snapshots',
  sourceTable = 'vou_intermediary_source_line_snapshots'
async function legacyFixture(db: Kysely<DB>) {
  const f = await seedVouCatalogFixture(db)
  const maintainer = {
    ...f.submitter,
    userId: ulid(),
    roleId: ulid(),
    username: `upgrade-${ulid()}`,
  }
  await new TargetBootstrapService(db).createE2EPrincipal(maintainer, true)
  // Deliberate old-snapshot precision vectors on this rollback fixture only.
  await sql`UPDATE vou_product_line_snapshots SET unit_price_minor=9007199254740993 WHERE approval_entry_id=${f.purchase.submissionId}`.execute(
    db,
  )
  const columns = await sql<{
    column_name: string
    data_type: string
    is_nullable: string
  }>`SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name=${sourceTable} AND table_schema='public' ORDER BY ordinal_position`.execute(
    db,
  )
  const vector: Record<string, unknown> = {}
  for (const c of columns.rows)
    vector[c.column_name] =
      c.is_nullable === 'YES'
        ? null
        : c.data_type === 'date'
          ? '2026-09-09'
          : c.data_type === 'boolean'
            ? false
            : c.data_type === 'jsonb' || c.data_type === 'ARRAY'
              ? []
              : c.data_type === 'bigint' || c.data_type === 'integer'
                ? '0'
                : ''
  Object.assign(vector, {
    approval_entry_id: f.documents['intermediary-calculation'].submissionId,
    line_no: 1,
    source_signoff_line_id: 'historical-quote-vector',
    source_kind: 'SALE',
    unit_price_micros: '1234567890123450000',
  })
  await sql`INSERT INTO vou_intermediary_source_line_snapshots SELECT (jsonb_populate_record(NULL::vou_intermediary_source_line_snapshots, ${JSON.stringify(vector)}::jsonb)).*`.execute(
    db,
  )
  const checks = await sql<{
    conname: string
  }>`SELECT conname FROM pg_constraint WHERE conrelid='vou_product_line_snapshots'::regclass AND pg_get_constraintdef(oid) LIKE '%agreed_amount_minor%'`.execute(
    db,
  )
  for (const c of checks.rows)
    await sql`ALTER TABLE vou_product_line_snapshots DROP CONSTRAINT ${sql.id(c.conname)}`.execute(
      db,
    )
  await sql`ALTER TABLE vou_product_line_snapshots DROP COLUMN quoted_unit_price_micros,DROP COLUMN agreed_amount_minor,ALTER COLUMN unit_price_minor SET NOT NULL`.execute(
    db,
  )
  await sql`UPDATE vou_intermediary_source_line_snapshots SET unit_price_micros=unit_price_micros/10000`.execute(
    db,
  )
  await sql`ALTER TABLE vou_intermediary_source_line_snapshots RENAME COLUMN unit_price_micros TO unit_price_minor`.execute(
    db,
  )
  return { f, maintainer }
}
async function unrelatedFacts(db: Kysely<DB>) {
  const tables = await sql<{
    tablename: string
  }>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN (${productTable},${sourceTable}) ORDER BY tablename`.execute(
    db,
  )
  const facts = []
  for (const t of tables.rows)
    facts.push([
      t.tablename,
      (
        await sql<{
          facts: string
        }>`SELECT COALESCE(jsonb_agg(to_jsonb(fact) ORDER BY to_jsonb(fact)::text),'[]')::text AS facts FROM ${sql.table(t.tablename)} fact`.execute(
          db,
        )
      ).rows[0]!.facts,
    ])
  return facts
}
const release = {
  sourceReleaseSha: '1'.repeat(40),
  targetReleaseSha: '2'.repeat(40),
}

test('one-time amount CLI enforces frozen writers, backup bytes, release identity and exact baseline', async (context) => {
  const source = process.env.TARGET_TEST_DATABASE_URL!
  const owner = createDatabase(source)
  const databaseName = `amount_upgrade_${ulid().toLowerCase()}_test`
  await sql`CREATE DATABASE ${sql.id(databaseName)}`.execute(owner)
  const url = new URL(source)
  url.pathname = `/${databaseName}`
  const db = createDatabase(url.toString())
  const directory = new URL(
    `../../../../.scratch/amount-cli-${ulid()}/`,
    import.meta.url,
  )
  await mkdir(directory, { recursive: true, mode: 0o700 })
  context.after(async () => {
    await db.destroy()
    await sql`DROP DATABASE ${sql.id(databaseName)}`.execute(owner)
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
      username: `amount-${ulid()}`,
      passwordHash: await hashPassword(randomBytes(24).toString('hex')),
    },
    true,
  )
  const checks = await sql<{
    conname: string
  }>`SELECT conname FROM pg_constraint WHERE conrelid='vou_product_line_snapshots'::regclass AND pg_get_constraintdef(oid) LIKE '%agreed_amount_minor%'`.execute(
    db,
  )
  for (const c of checks.rows)
    await sql`ALTER TABLE vou_product_line_snapshots DROP CONSTRAINT ${sql.id(c.conname)}`.execute(
      db,
    )
  await sql`ALTER TABLE vou_product_line_snapshots DROP COLUMN agreed_amount_minor,DROP COLUMN quoted_unit_price_micros,ALTER COLUMN unit_price_minor SET NOT NULL`.execute(
    db,
  )
  await sql`ALTER TABLE vou_intermediary_source_line_snapshots RENAME COLUMN unit_price_micros TO unit_price_minor`.execute(
    db,
  )
  const before = await inspectOrderAmountUpgrade(db)
  const baselineFile = new URL('baseline.json', directory),
    backupFile = new URL('backup.json', directory)
  const databaseFile = new URL('database.guard-fixture', directory),
    attachmentFile = new URL('attachments.guard-fixture', directory)
  await writeFile(baselineFile, JSON.stringify(before), { mode: 0o600 })
  // Digest guard fixtures; real backup/restoration is exercised in the release operation.
  await writeFile(databaseFile, 'database guard fixture', { mode: 0o600 })
  await writeFile(attachmentFile, 'attachment guard fixture', { mode: 0o600 })
  const digest = (value: string) =>
    createHash('sha256').update(value).digest('hex')
  const manifest = {
    ...release,
    database: {
      path: databaseFile.pathname,
      sha256: digest('database guard fixture'),
    },
    attachments: {
      path: attachmentFile.pathname,
      sha256: digest('attachment guard fixture'),
    },
  }
  await writeFile(backupFile, JSON.stringify(manifest), { mode: 0o600 })
  const run = (...args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [
        new URL('../../scripts/upgrade-order-amounts.ts', import.meta.url)
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
  const arguments_ = [
    '--apply',
    '--baseline',
    baselineFile.pathname,
    '--backup',
    backupFile.pathname,
    '--actor-id',
    actorId,
  ]
  await assert.rejects(run(...arguments_), /inputs_required/)
  await writeFile(
    backupFile,
    JSON.stringify({ ...manifest, targetReleaseSha: '3'.repeat(40) }),
  )
  await assert.rejects(
    run(...arguments_, '--writers-frozen'),
    /release_mismatch/,
  )
  await writeFile(backupFile, JSON.stringify(manifest))
  await writeFile(databaseFile, 'tampered backup')
  await assert.rejects(
    run(...arguments_, '--writers-frozen'),
    /backup_digest_mismatch/,
  )
  await writeFile(databaseFile, 'database guard fixture')
  await writeFile(baselineFile, JSON.stringify({ baseline: '0'.repeat(64) }))
  await assert.rejects(
    run(...arguments_, '--writers-frozen'),
    /baseline_changed/,
  )
  assert.deepEqual(await inspectOrderAmountUpgrade(db), before)
  await writeFile(baselineFile, JSON.stringify(before))
  const result = await run(...arguments_, '--writers-frozen')
  assert.equal(JSON.parse(result.stdout).upgraded, true)
  assert.equal((await inspectOrderAmountUpgrade(db)).layout, 'CURRENT')
  await assert.rejects(
    run(...arguments_, '--writers-frozen'),
    /legacy_layout_required/,
  )
})

test('order amount upgrade keeps every old fact, exact bigint quotes and ordinary order reads', async () => {
  await withWflDatabase(async (db) => {
    const { f, maintainer } = await legacyFixture(db)
    const before = await inspectOrderAmountUpgrade(db)
    assert.equal(before.layout, 'LEGACY')
    const untouched = await unrelatedFacts(db)
    const result = await upgradeOrderAmounts(db, {
      baseline: before.baseline,
      actorId: maintainer.userId,
      ...release,
    })
    assert.equal(result.upgraded, true)
    assert.deepEqual(await unrelatedFacts(db), untouched)
    const quote = await sql<{
      quote: string
    }>`SELECT unit_price_micros::text AS quote FROM vou_intermediary_source_line_snapshots WHERE source_signoff_line_id='historical-quote-vector'`.execute(
      db,
    )
    assert.equal(quote.rows[0]!.quote, '1234567890123450000')
    assert.equal(
      orderQuote(intermediaryDecimal(BigInt(quote.rows[0]!.quote), 6)),
      '1234567890123.45',
    )
    const detail = await f.vou.get(
      'purchase-order',
      f.purchase.documentId,
      f.actor,
    )
    assert.equal(
      'productLines' in detail.payload &&
        detail.payload.productLines[0]!.unitPrice,
      '90071992547409.93',
    )
    assert.ok(
      'productLines' in detail.payload &&
        !('agreedAmount' in detail.payload.productLines[0]!),
    )
    const after = await inspectOrderAmountUpgrade(db)
    assert.equal(after.layout, 'CURRENT')
    await assert.rejects(
      upgradeOrderAmounts(db, {
        baseline: after.baseline,
        actorId: maintainer.userId,
        ...release,
      }),
      /legacy_layout_required/,
    )
  })
})

test('order amount upgrade rejects stale baselines, non-admins, overflow and mixed layouts atomically', async () => {
  await withWflDatabase(async (db) => {
    const { f, maintainer } = await legacyFixture(db)
    const before = await inspectOrderAmountUpgrade(db)
    await assert.rejects(
      upgradeOrderAmounts(db, {
        baseline: before.baseline,
        actorId: f.submitter.userId,
        ...release,
      }),
      /operator_required/,
    )
    await sql`UPDATE vou_product_line_snapshots SET remark='concurrent change' WHERE approval_entry_id=${f.purchase.submissionId}`.execute(
      db,
    )
    await assert.rejects(
      upgradeOrderAmounts(db, {
        baseline: before.baseline,
        actorId: maintainer.userId,
        ...release,
      }),
      /baseline_changed/,
    )
    await sql`UPDATE vou_intermediary_source_line_snapshots SET unit_price_minor=9223372036854775807`.execute(
      db,
    )
    const overflow = await inspectOrderAmountUpgrade(db)
    await assert.rejects(
      upgradeOrderAmounts(db, {
        baseline: overflow.baseline,
        actorId: maintainer.userId,
        ...release,
      }),
      /quote_overflow/,
    )
    assert.deepEqual(await inspectOrderAmountUpgrade(db), overflow)
    await sql`ALTER TABLE vou_product_line_snapshots ADD COLUMN agreed_amount_minor bigint`.execute(
      db,
    )
    const mixed = await inspectOrderAmountUpgrade(db)
    assert.equal(mixed.layout, 'UNSUPPORTED')
    assert.equal(mixed.productLines, null)
    await assert.rejects(
      upgradeOrderAmounts(db, {
        baseline: mixed.baseline,
        actorId: maintainer.userId,
        ...release,
      }),
      /legacy_layout_required/,
    )
    await sql`ALTER TABLE vou_product_line_snapshots DROP COLUMN agreed_amount_minor,ALTER COLUMN remark TYPE varchar(400)`.execute(
      db,
    )
    assert.equal((await inspectOrderAmountUpgrade(db)).layout, 'UNSUPPORTED')
  })
})

test('post-conversion verification failure rolls back both DDL and quote conversion', async () => {
  await withWflDatabase(async (db) => {
    const { maintainer } = await legacyFixture(db)
    const before = await inspectOrderAmountUpgrade(db)
    const failing = new Proxy(db, {
      get(target, key) {
        if (key === 'transaction')
          return () => ({
            execute: (fn: (tx: Transaction<DB>) => Promise<unknown>) =>
              target.transaction().execute((tx) =>
                fn(
                  new Proxy(tx, {
                    get(t, k) {
                      if (k === 'getExecutor')
                        return () => {
                          const executor = t.getExecutor()
                          return new Proxy(executor, {
                            get(e, property) {
                              if (property === 'executeQuery')
                                return (
                                  ...args: Parameters<
                                    typeof executor.executeQuery
                                  >
                                ) => {
                                  if (args[0].sql.includes('jsonb_set'))
                                    throw new Error(
                                      'independent readback unavailable',
                                    )
                                  return e.executeQuery(...args)
                                }
                              const value = Reflect.get(e, property, e)
                              return typeof value === 'function'
                                ? value.bind(e)
                                : value
                            },
                          })
                        }
                      const value = Reflect.get(t, k, t)
                      return typeof value === 'function' ? value.bind(t) : value
                    },
                  }),
                ),
              ),
          })
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    await assert.rejects(
      upgradeOrderAmounts(failing, {
        baseline: before.baseline,
        actorId: maintainer.userId,
        ...release,
      }),
      /readback unavailable/,
    )
    assert.deepEqual(await inspectOrderAmountUpgrade(db), before)
  })
})
