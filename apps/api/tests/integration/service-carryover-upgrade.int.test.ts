import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import { withCommittedPurchaseDatabase } from '../fixtures/vou-purchase-http.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import {
  inspectServiceCarryoverUpgrade,
  upgradeServiceCarryover,
} from '../../src/vou/service-carryover-upgrade.ts'
import type { VouPayloadFor } from '@zerp/model'

test('supported service upgrade preserves filled procurement facts and credentials, grants only old ordinary service types and rejects drift and repeat apply', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const f = await seedOrderListFixture(db, 0, [
      'purchase-order',
      'service-contract',
      'service-acceptance',
    ])
    const operator = {
      ...f.submitter,
      userId: ulid(),
      roleId: ulid(),
      username: 'service-upgrade-' + ulid(),
    }
    await new TargetBootstrapService(db).createE2EPrincipal(operator, true)
    const payload = f.purchase.payload as VouPayloadFor<'purchase-order'>
    const priorEntry = ulid(),
      priorDocument = ulid()
    await f.vou.submit(
      'purchase-order',
      'submit-new',
      {
        documentId: priorDocument,
        submissionId: priorEntry,
        idempotencyKey: priorEntry,
        expectedRevision: null,
        payload: {
          ...payload,
          priorFact: {
            sourceClosed: false,
            sourceInstanceId: 'upgrade-fixture',
            sourceSchema: 'fixture',
            sourceDocumentType: 'AA',
            sourceDocumentKey: 'preserved-source',
            sourceDocumentNo: 'AA-preserved',
            capturedAt: payload.businessDate + 'T23:59:59.123456Z',
            snapshotDigest: 'a'.repeat(64),
          },
        },
      },
      { id: f.submitter.userId, permissions: [], trusted: true },
      'service-upgrade-fixture',
    )
    // Reproduce the exact preceding deployed structural baseline, with actual populated rows.
    await sql`DROP TABLE vou_prior_service_line_origins`.execute(db)
    await sql`DROP TABLE vou_service_line_snapshots`.execute(db)
    await sql`ALTER TABLE app_role_permissions DROP COLUMN service_contexts`.execute(
      db,
    )
    await sql`ALTER TABLE vou_service_contract_details DROP COLUMN requires_prepayment`.execute(
      db,
    )
    const unique = (
      await sql<{
        conname: string
      }>`SELECT conname FROM pg_constraint WHERE conrelid='public.vou_prior_facts'::regclass AND contype='u'`.execute(
        db,
      )
    ).rows
    await sql`ALTER TABLE vou_prior_facts DROP CONSTRAINT ${sql.id(unique[0]!.conname)},DROP COLUMN source_component,ADD UNIQUE(source_instance_id,source_schema,source_document_type,source_document_key),DROP CONSTRAINT vou_prior_facts_source_document_type_check,ADD CONSTRAINT vou_prior_facts_source_document_type_check CHECK(source_document_type IN('AA','AD','AB','AF','AH'))`.execute(
      db,
    )
    const baseline = await inspectServiceCarryoverUpgrade(db)
    assert.equal(baseline.layout, 'SOURCE')
    assert.equal(baseline.publicTables, 147)
    assert.equal(baseline.priorFacts, 1)
    const input = {
      baseline: baseline.baseline,
      actorId: operator.userId,
      sourceReleaseSha: 'a'.repeat(40),
      targetReleaseSha: 'b'.repeat(40),
    }
    await assert.rejects(
      upgradeServiceCarryover(db, { ...input, baseline: 'c'.repeat(64) }),
      /baseline_changed/,
    )
    await assert.rejects(
      upgradeServiceCarryover(db, { ...input, actorId: f.submitter.userId }),
      /operator_required/,
    )
    assert.deepEqual(await inspectServiceCarryoverUpgrade(db), baseline)
    const upgraded = await upgradeServiceCarryover(db, input)
    assert.equal(upgraded.originalPublicTables, 147)
    assert.equal(upgraded.originalPriorFactsPreserved, 1)
    assert.equal(upgraded.originalGrantsPreserved, baseline.grants)
    assert.equal(upgraded.existingServiceContexts, 'ORDINARY_ONLY')
    assert.equal((await inspectServiceCarryoverUpgrade(db)).publicTables, 149)
    assert.equal(
      (
        await db
          .selectFrom('vou_prior_facts')
          .select('source_component')
          .where('approval_entry_id', '=', priorEntry)
          .executeTakeFirstOrThrow()
      ).source_component,
      'PROCUREMENT',
    )
    const contexts = await db
      .selectFrom('app_role_permissions as grant')
      .innerJoin(
        'app_permissions as permission',
        'permission.id',
        'grant.permission_id',
      )
      .select(['permission.entity', 'grant.service_contexts'])
      .where('permission.domain', '=', 'vou')
      .where('permission.entity', 'in', [
        'service-contract',
        'service-acceptance',
      ])
      .execute()
    assert.ok(contexts.length > 0)
    for (const row of contexts)
      assert.deepEqual(
        row.service_contexts,
        row.entity === 'service-contract'
          ? ['OTHER_UNIT', 'SALES_PARTNER']
          : ['CONTRACT'],
      )
    await assert.rejects(
      upgradeServiceCarryover(db, input),
      /source_layout_required/,
    )
  })
})
