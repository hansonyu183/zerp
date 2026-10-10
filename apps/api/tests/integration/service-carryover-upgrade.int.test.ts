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
import { DclArchiveService } from '../../src/dcl/archives.ts'
import { precedingAttachmentArchiveChecks } from '../fixtures/attachment-archive-before.ts'

async function verifySupportedUpgrade(
  maintained: boolean,
  serviceSource = false,
) {
  await withCommittedPurchaseDatabase(async (db) => {
    await precedingAttachmentArchiveChecks(db)
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
    if (serviceSource) {
      const actor = { id: f.submitter.userId, permissions: [], trusted: true },
        reviewer = { ...actor, id: f.reviewer.userId }
      const bob = new DclArchiveService(db),
        partyId = ulid(),
        partyEntry = ulid()
      const party = await bob.submit(
        'other-unit',
        'submit-new',
        {
          subjectId: partyId,
          submissionId: partyEntry,
          idempotencyKey: partyEntry,
          expectedLatestApprovedSubmissionId: null,
          expectedLatestApprovedRevision: null,
          snapshot: {
            identityKind: 'ORGANIZATION',
            legalName: '维护测试服务单位',
            displayName: '维护测试服务单位',
            legalIdentifier: '',
            contactName: '',
            phone: '',
            address: '',
            operatingEntities: [],
            defaultOperatingEntityId: null,
            remark: '',
            settlementMethod: null,
          },
        },
        actor,
        'service-upgrade-fixture',
      )
      await bob.review(
        'other-unit',
        'approve',
        {
          subjectId: partyId,
          submissionId: partyEntry,
          expectedRevision: party.revision,
        },
        reviewer,
        'service-upgrade-fixture',
      )
      const line = {
        lineId: ulid(),
        serviceName: '既有服务',
        enteredQuantity: '1',
        enteredUnit: f.references.unitSnapshot,
        baseQuantity: '1',
        baseUnit: f.references.unitSnapshot,
        agreedAmount: '12.30',
      }
      const entryId = ulid()
      const contract = await f.vou.submit(
        'service-contract',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: entryId,
          idempotencyKey: entryId,
          expectedRevision: null,
          payload: {
            businessDate: payload.businessDate,
            currency: 'CNY',
            attachments: [],
            employee: payload.purchaser!,
            counterpartyType: 'other-unit',
            counterparty: {
              objectId: partyId,
              approvalEntryId: partyEntry,
              selectionOrigin: 'CURRENT',
            },
            serviceLines: [line],
            serviceContract: { terms: '保留旧服务事实' },
          },
        },
        actor,
        'service-upgrade-fixture',
      )
      await f.vou.review(
        'service-contract',
        'approve',
        {
          documentId: contract.documentId,
          submissionId: entryId,
          expectedRevision: contract.revision,
        },
        reviewer,
        'service-upgrade-fixture',
      )
      const acceptanceEntry = ulid()
      await f.vou.submit(
        'service-acceptance',
        'submit-new',
        {
          documentId: ulid(),
          submissionId: acceptanceEntry,
          idempotencyKey: acceptanceEntry,
          expectedRevision: null,
          payload: {
            businessDate: payload.businessDate,
            currency: 'CNY',
            attachments: [],
            employee: payload.purchaser!,
            amount: '12.30',
            serviceLines: [
              { ...line, lineId: ulid(), contractLineId: line.lineId },
            ],
            serviceAcceptance: {
              contractDocumentId: contract.documentId,
              serviceDate: payload.businessDate,
              acceptanceDate: payload.businessDate,
              settlementDirection: 'PAYABLE',
            },
          },
        },
        actor,
        'service-upgrade-fixture',
      )
      await sql`UPDATE app_role_permissions SET service_contexts=array_remove(service_contexts,'SUPPLIER')`.execute(
        db,
      )
      await sql`ALTER TABLE app_role_permissions DROP CONSTRAINT app_role_permissions_service_contexts_check, ADD CONSTRAINT app_role_permissions_service_contexts_check CHECK (service_contexts <@ ARRAY['OTHER_UNIT','SALES_PARTNER','PRIOR_AA','PRIOR_AD','CONTRACT','PRIOR_AB','PRIOR_AE','PRIOR_AH']::text[])`.execute(
        db,
      )
    } else {
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
    }
    if (maintained) {
      await sql`ALTER TABLE vou_intermediary_source_line_snapshots RENAME CONSTRAINT vou_intermediary_source_line_snapsho_unit_price_micros_not_null TO vou_intermediary_source_line_snapshot_unit_price_minor_not_null`.execute(
        db,
      )
      await sql`ALTER TABLE vou_product_line_snapshots RENAME CONSTRAINT vou_product_line_snapshots_check TO vou_product_line_pricing_shape`.execute(
        db,
      )
      await sql`ALTER TABLE vou_product_line_snapshots RENAME CONSTRAINT vou_product_line_snapshots_check1 TO vou_product_line_snapshots_check`.execute(
        db,
      )
    }
    await sql`ALTER TABLE vou_prior_facts RENAME CONSTRAINT vou_prior_facts_source_closed_not_null TO unexpected_constraint`.execute(
      db,
    )
    assert.equal(
      (await inspectServiceCarryoverUpgrade(db)).layout,
      'UNSUPPORTED',
    )
    await sql`ALTER TABLE vou_prior_facts RENAME CONSTRAINT unexpected_constraint TO vou_prior_facts_source_closed_not_null`.execute(
      db,
    )
    const baseline = await inspectServiceCarryoverUpgrade(db)
    assert.equal(baseline.layout, 'SOURCE')
    assert.equal(baseline.publicTables, serviceSource ? 149 : 147)
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
    assert.equal(upgraded.originalPublicTables, serviceSource ? 149 : 147)
    assert.equal(upgraded.originalPriorFactsPreserved, 1)
    assert.equal(upgraded.originalGrantsPreserved, baseline.grants)
    assert.equal(
      upgraded.existingServiceContexts,
      serviceSource ? 'PRESERVED' : 'ORDINARY_ONLY',
    )
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
    assert.equal(
      (
        await sql`SELECT 1 FROM app_role_permissions WHERE 'SUPPLIER'=ANY(service_contexts) LIMIT 1`.execute(
          db,
        )
      ).rows.length,
      0,
    )
    if (serviceSource)
      assert.equal(
        (
          await db
            .selectFrom('vou_service_line_snapshots')
            .selectAll()
            .execute()
        ).length,
        2,
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
    if (!serviceSource)
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
}

for (const maintained of [false, true])
  for (const serviceSource of [false, true]) {
    test(`supported ${serviceSource ? 149 : 147}-table service upgrade (${maintained ? 'maintained' : 'fresh'} layout) preserves original facts, credentials and scopes and rejects drift and repeat apply`, async () => {
      await verifySupportedUpgrade(maintained, serviceSource)
    })
  }
