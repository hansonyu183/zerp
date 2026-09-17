import { upgradeDepartmentAccess } from '../../src/app/department-upgrade.ts'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import { createDatabase } from '../../src/db/database.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword } from '../../src/app/session.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'
import { AuxService } from '../../src/aux/service.ts'
import { BobService } from '../../src/bob/service.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'
import {
  inspectUnitCutover,
  migrateMeasurementUnits,
  UnitCutoverError,
} from '../../src/aux/unit-cutover.ts'

test('unit cutover blocks conflicting fixed factors, preserves historical decimal facts, and permits approval of an existing precise formula', async (context) => {
  assert.ok(process.env.TARGET_TEST_DATABASE_URL)
  const admin = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  const name = `units_442_${ulid().toLowerCase()}_test`
  await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin)
  const url = new URL(process.env.TARGET_TEST_DATABASE_URL)
  url.pathname = `/${name}`
  const db = createDatabase(url.toString())
  context.after(async () => {
    await db.destroy()
    await sql`DROP DATABASE ${sql.id(name)}`.execute(admin)
    await admin.destroy()
  })
  await sql
    .raw(
      await readFile(
        new URL('../fixtures/issue-442-before.sql', import.meta.url),
        'utf8',
      ),
    )
    .execute(db)
  await upgradeDepartmentAccess(db)
  const bootstrap = new TargetBootstrapService(db)
  await bootstrap.syncPermissionCatalog(await readTargetPermissionCatalog())
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `units-${ulid()}`,
    passwordHash: await hashPassword(randomBytes(24).toString('hex')),
  }
  await bootstrap.createE2EPrincipal(principal, true)
  const reviewer = {
    userId: ulid(),
    roleId: ulid(),
    username: `review-${ulid()}`,
    passwordHash: principal.passwordHash,
  }
  await bootstrap.createE2EPrincipal(reviewer, true)
  const actor = {
    id: reviewer.userId,
    permissions: [
      '/bob/product/get',
      '/dcl/product/submission-get',
      '/dcl/product/approve',
      '/aux/measurement-unit/get',
    ],
    trusted: true,
  }
  const unitId = ulid(),
    categoryId = ulid(),
    typeId = ulid()
  const unit = {
    id: unitId,
    code: 'UNT-0001',
    name: 'kg',
    symbol: 'kg',
    quantityScale: 6,
  }
  await sql`INSERT INTO aux_objects (id,entity,code,data,created_by,updated_by) VALUES (${unitId},'measurement-unit','UNT-0001',${JSON.stringify({ name: 'kg', symbol: 'kg', quantityScale: 6 })}::jsonb,${principal.userId},${principal.userId})`.execute(
    db,
  )
  const product = async (
    code: string,
    profile: 'RAW_MATERIAL' | 'STANDARD_FINISHED',
    formula: unknown,
    status: 'PENDING' | 'APPROVED',
  ) => {
    const id = ulid(),
      entryId = ulid(),
      now = new Date()
    await sql`INSERT INTO dcl_subjects (id,entity,code,created_at,created_by) VALUES (${id},'product',${code},${now},${principal.userId})`.execute(
      db,
    )
    await sql`INSERT INTO bob_objects (id) VALUES (${id})`.execute(db)
    await sql`INSERT INTO approval_entries (id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,approved_by,approved_at,updated_by,updated_at) VALUES (${entryId},'dcl','product',${id},1,${status},1,${principal.userId},${now},${status === 'APPROVED' ? reviewer.userId : null},${status === 'APPROVED' ? now : null},${principal.userId},${now})`.execute(
      db,
    )
    const snapshots = {
      productType: {
        id: typeId,
        code: 'PTY-0001',
        name: '类型',
        behaviorProfile: profile,
      },
      productCategory: { id: categoryId, code: 'PCT-0001', name: '分类' },
      pricingUnit: unit,
      defaultInputUnit: unit,
    }
    await sql`INSERT INTO dcl_product_versions (approval_entry_id,name,product_type_id,category_id,behavior_profile,pricing_unit_id,default_input_unit_id,source_snapshots,unit_conversions,default_packaging_snapshot,recyclable,fixed_formula) VALUES (${entryId},${code},${typeId},${categoryId},${profile},${unitId},${unitId},${JSON.stringify(snapshots)}::jsonb,${JSON.stringify([{ unit, factor: '1.000000' }])}::jsonb,${JSON.stringify({ defaultPackagingSpec: '200.000001' })}::jsonb,false,${formula === null ? null : JSON.stringify(formula)}::jsonb)`.execute(
      db,
    )
    return { id, entryId, code }
  }
  const raw = await product('PRD-0001', 'RAW_MATERIAL', null, 'APPROVED')
  const formula = {
    output: {
      enteredQuantity: '2.123456',
      enteredUnit: unit,
      baseQuantity: '3.000001',
    },
    components: [
      {
        material: {
          objectId: raw.id,
          approvalEntryId: raw.entryId,
          code: raw.code,
          name: raw.code,
        },
        quantity: {
          enteredQuantity: '1.234567',
          enteredUnit: unit,
          baseQuantity: '1.000001',
        },
        resolutionStatus: 'CURRENT',
        requiresConfirmation: false,
      },
    ],
  }
  const finished = await product(
    'PRD-0002',
    'STANDARD_FINISHED',
    formula,
    'PENDING',
  )
  const historicalEntryId = ulid(),
    historicalDocumentId = ulid(),
    historicalLineId = ulid()
  await sql`INSERT INTO approval_entries (id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,approved_by,approved_at,updated_by,updated_at) VALUES (${historicalEntryId},'vou','sale-order',${historicalDocumentId},NULL,'APPROVED',1,${principal.userId},now(),${reviewer.userId},now(),${principal.userId},now())`.execute(
    db,
  )
  await sql`INSERT INTO vou_product_line_snapshots (approval_entry_id,line_no,line_id,entered_quantity_micros,entered_unit_id,entered_unit_code,entered_unit_name,entered_unit_symbol,entered_unit_quantity_scale,base_quantity_micros,unit_price_minor,formula_source_type,formula_output_entered_quantity_micros,formula_output_entered_unit_id,formula_output_entered_unit_code,formula_output_entered_unit_name,formula_output_entered_unit_symbol,formula_output_entered_unit_quantity_scale,formula_output_base_quantity_micros) VALUES (${historicalEntryId},1,${historicalLineId},1234567,${unitId},'UNT-0001','历史 kg','kg',6,3000001,12345,'MANUAL',2123456,${unitId},'UNT-0001','历史 kg','kg',6,3000001)`.execute(
    db,
  )
  await sql`INSERT INTO vou_formula_component_snapshots (approval_entry_id,line_no,component_no,material_id,entered_quantity_micros,entered_unit_id,entered_unit_code,entered_unit_name,entered_unit_symbol,entered_unit_quantity_scale,base_quantity_micros) VALUES (${historicalEntryId},1,1,${raw.id},1234567,${unitId},'UNT-0001','历史 kg','kg',6,1000001)`.execute(
    db,
  )
  await sql`UPDATE dcl_product_versions SET source_snapshots=jsonb_set(source_snapshots,'{pricingUnit}',(source_snapshots->'pricingUnit') - 'symbol' - 'quantityScale') WHERE approval_entry_id=${raw.entryId}`.execute(
    db,
  )
  const malformed = await inspectUnitCutover(db, [
    { id: unitId, fixedFactor: '1' },
  ])
  assert.ok(
    malformed.blockers.some((row) => row.kind === 'INVALID_UNIT_SNAPSHOT'),
  )
  await assert.rejects(
    migrateMeasurementUnits(db, {
      baseline: malformed.baseline,
      decisions: [{ id: unitId, fixedFactor: '1' }],
      actorId: principal.userId,
      sourceReleaseSha: '1'.repeat(40),
      targetReleaseSha: '2'.repeat(40),
    }),
    (error) =>
      error instanceof UnitCutoverError &&
      error.reason === 'unit_cutover_review_required',
  )
  assert.deepEqual(
    await inspectUnitCutover(db, [{ id: unitId, fixedFactor: '1' }]),
    malformed,
  )
  await sql`UPDATE dcl_product_versions SET source_snapshots=jsonb_set(source_snapshots,'{pricingUnit}',${JSON.stringify(unit)}::jsonb) WHERE approval_entry_id=${raw.entryId}`.execute(
    db,
  )
  const conflicting = [{ id: unitId, fixedFactor: '1000' }]
  const conflict = await inspectUnitCutover(db, conflicting)
  assert.ok(
    conflict.blockers.some((row) => row.kind === 'FIXED_FACTOR_CONFLICT'),
  )
  await assert.rejects(
    () =>
      migrateMeasurementUnits(db, {
        baseline: conflict.baseline,
        decisions: conflicting,
        actorId: principal.userId,
        sourceReleaseSha: '1'.repeat(40),
        targetReleaseSha: '2'.repeat(40),
      }),
    (error) =>
      error instanceof UnitCutoverError &&
      error.reason === 'unit_cutover_review_required',
  )
  assert.deepEqual(await inspectUnitCutover(db, conflicting), conflict)
  const decisions = [{ id: unitId, fixedFactor: '1' }]
  const before = await inspectUnitCutover(db, decisions)
  assert.deepEqual(before.blockers, [])
  await assert.rejects(
    () =>
      migrateMeasurementUnits(db, {
        baseline: '0'.repeat(64),
        decisions,
        actorId: principal.userId,
        sourceReleaseSha: '1'.repeat(40),
        targetReleaseSha: '2'.repeat(40),
      }),
    (error) =>
      error instanceof UnitCutoverError &&
      error.reason === 'unit_cutover_baseline_changed',
  )
  await assert.rejects(() =>
    migrateMeasurementUnits(db, {
      baseline: before.baseline,
      decisions,
      actorId: principal.userId,
      sourceReleaseSha: '1'.repeat(40),
      targetReleaseSha: '2'.repeat(41),
    }),
  )
  assert.deepEqual(await inspectUnitCutover(db, decisions), before)
  const result = await migrateMeasurementUnits(db, {
    baseline: before.baseline,
    decisions,
    actorId: principal.userId,
    sourceReleaseSha: '1'.repeat(40),
    targetReleaseSha: '2'.repeat(40),
  })
  assert.equal(result.quantitiesPreserved, true)
  const historicalLine = await db
    .selectFrom('vou_product_line_snapshots')
    .selectAll()
    .where('approval_entry_id', '=', historicalEntryId)
    .executeTakeFirstOrThrow()
  assert.equal(historicalLine.entered_quantity_micros, '1234567')
  assert.equal(historicalLine.base_quantity_micros, '3000001')
  assert.equal(historicalLine.unit_price_minor, '12345')
  assert.equal(historicalLine.entered_unit_name, '历史 kg')
  assert.equal(historicalLine.entered_unit_fixed_factor, '1')
  assert.equal(historicalLine.formula_output_entered_quantity_micros, '2123456')
  const historicalComponent = await db
    .selectFrom('vou_formula_component_snapshots')
    .selectAll()
    .where('approval_entry_id', '=', historicalEntryId)
    .executeTakeFirstOrThrow()
  assert.equal(historicalComponent.entered_quantity_micros, '1234567')
  assert.equal(historicalComponent.base_quantity_micros, '1000001')
  assert.equal(historicalComponent.entered_unit_fixed_factor, '1')

  const current = await new AuxService(db).get(
    'measurement-unit',
    { id: unitId },
    actor,
  )
  assert.equal(current.fixedFactor, '1')
  assert.equal('symbol' in current, false)
  assert.equal('quantityScale' in current, false)
  const rawView = await new BobService(db).get('product', raw.id, actor)
  assert.deepEqual(rawView.data.unitConversions, [
    {
      unit: { id: unitId, code: 'UNT-0001', name: 'kg', fixedFactor: '1' },
      factor: null,
    },
  ])
  const archives = new DclArchiveService(db)
  const historical = await archives.get(
    'product',
    finished.id,
    actor,
    finished.entryId,
  )
  const adopted = historical.snapshot.fixedFormula as typeof formula
  assert.equal(adopted.output.enteredQuantity, '2.123456')
  assert.equal(adopted.output.baseQuantity, '3.000001')
  assert.equal(adopted.components[0]!.quantity.enteredQuantity, '1.234567')
  assert.equal(historical.snapshot.defaultPackagingSpec, '200.000001')
  const approved = await archives.review(
    'product',
    'approve',
    {
      subjectId: finished.id,
      submissionId: finished.entryId,
      expectedRevision: '1',
    },
    actor,
    ulid(),
  )
  assert.deepEqual(
    approved.snapshot.fixedFormula,
    historical.snapshot.fixedFormula,
  )
  await assert.rejects(
    () => inspectUnitCutover(db, decisions),
    (error) =>
      error instanceof UnitCutoverError &&
      error.reason === 'unit_cutover_source_schema_unsupported',
  )
})
