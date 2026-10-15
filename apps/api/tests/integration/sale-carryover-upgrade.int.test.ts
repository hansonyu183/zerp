import assert from 'node:assert/strict'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import { withWflDatabase } from './wfl-fixture.ts'
import {
  inspectSaleCarryoverUpgrade,
  upgradeSaleCarryover,
} from '../../src/vou/sale-carryover-upgrade.ts'

test('7353 sale structure maintenance preserves existing approved prior facts and every unrelated fact', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedOrderListFixture(db, 0, ['purchase-order'])
    const maintainer = {
      ...f.submitter,
      userId: ulid(),
      roleId: ulid(),
      username: 'sale-maint-' + ulid(),
    }
    const bootstrap = new TargetBootstrapService(db)
    await bootstrap.createE2EPrincipal(maintainer, true)
    const entry = ulid(),
      document = ulid()
    const saved = await f.vou.submit(
      'purchase-order',
      'submit-new',
      {
        documentId: document,
        submissionId: entry,
        idempotencyKey: entry,
        expectedRevision: null,
        payload: {
          ...f.purchase.payload,
          priorFact: {
            sourceClosed: false,
            sourceInstanceId: 'sale-maintenance-fixture',
            sourceSchema: 'fixture',
            sourceDocumentType: 'AA',
            sourceDocumentKey: 'original-aa',
            sourceDocumentNo: 'AA-ORIGINAL',
            capturedAt: f.purchase.payload.businessDate + 'T23:59:59.000Z',
            snapshotDigest: 'f'.repeat(64),
          },
        },
      },
      { id: f.submitter.userId, permissions: [], trusted: true },
      'sale-maintenance-original',
    )
    await f.vou.review(
      'purchase-order',
      'approve',
      {
        documentId: document,
        expectedRevision: saved.revision,
        submissionId: entry,
      },
      { id: f.reviewer.userId, permissions: [], trusted: true },
      'sale-maintenance-original-review',
    )
    const original = await f.vou.get('purchase-order', document, {
      id: f.submitter.userId,
      permissions: [],
      trusted: true,
    })
    await sql`ALTER TABLE vou_source_line_snapshots DROP COLUMN prior_stock_lines`.execute(
      db,
    )
    await sql`ALTER TABLE vou_signoff_line_snapshots DROP COLUMN prior_lost_quantity_micros, DROP COLUMN prior_amount_minor`.execute(
      db,
    )
    await sql`ALTER TABLE vou_prior_facts
      DROP CONSTRAINT vou_prior_facts_source_document_type_check,
      ADD CONSTRAINT vou_prior_facts_source_document_type_check CHECK (source_document_type IN ('AA','AD','AB','AE','AF','AH')),
      DROP CONSTRAINT vou_prior_facts_source_component_check,
      ADD CONSTRAINT vou_prior_facts_source_component_check CHECK (source_component IN ('PROCUREMENT','SERVICE'))`.execute(
      db,
    )
    const before = await inspectSaleCarryoverUpgrade(db)
    assert.equal(before.layout, 'SOURCE')
    assert.equal(before.priorFacts, 1)
    const input = {
      baseline: before.baseline,
      actorId: maintainer.userId,
      sourceReleaseSha: 'a'.repeat(40),
      targetReleaseSha: 'b'.repeat(40),
    }
    await assert.rejects(
      upgradeSaleCarryover(db, { ...input, actorId: f.submitter.userId }),
      /sale_carryover_upgrade_operator_required/,
    )
    assert.deepEqual(await inspectSaleCarryoverUpgrade(db), before)
    await bootstrap.createE2EPrincipal(
      {
        ...f.submitter,
        userId: ulid(),
        roleId: ulid(),
        username: 'sale-drift-' + ulid(),
      },
      false,
      ['/app/role/get'],
    )
    await assert.rejects(
      upgradeSaleCarryover(db, input),
      /sale_carryover_upgrade_baseline_changed/,
    )
    // A partial or altered layout cannot be mistaken for a supported baseline.
    await sql`ALTER TABLE vou_source_line_snapshots ADD COLUMN prior_stock_lines jsonb`.execute(
      db,
    )
    assert.equal((await inspectSaleCarryoverUpgrade(db)).layout, 'UNSUPPORTED')
    await assert.rejects(
      upgradeSaleCarryover(db, input),
      /source_layout_required/,
    )
    await sql`ALTER TABLE vou_source_line_snapshots DROP COLUMN prior_stock_lines`.execute(
      db,
    )
    const stable = await inspectSaleCarryoverUpgrade(db)
    const result = await upgradeSaleCarryover(db, {
      ...input,
      baseline: stable.baseline,
    })
    assert.equal(result.upgraded, true)
    assert.equal(result.priorFactsPreserved, 1)
    assert.equal(result.originalSalesBackfilled, false)
    assert.equal(result.publicTables, stable.publicTables)
    assert.equal((await inspectSaleCarryoverUpgrade(db)).layout, 'CURRENT')
    assert.deepEqual(
      await f.vou.get('purchase-order', document, {
        id: f.submitter.userId,
        permissions: [],
        trusted: true,
      }),
      original,
    )
    await assert.rejects(
      upgradeSaleCarryover(db, { ...input, baseline: result.afterBaseline }),
      /source_layout_required/,
    )
  })
})
