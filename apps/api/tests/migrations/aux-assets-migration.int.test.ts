import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { sql } from 'kysely'
import { ulid } from 'ulid'

import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import {
  AuxAssetMigrationBlockedError,
  AuxAssetMigrationService,
} from '../../src/aux/migration-assets.ts'
import { AuxService } from '../../src/aux/service.ts'
import { createDatabase } from '../../src/db/database.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

function approval(
  id: string,
  domain: string,
  entity: string,
  subjectId: string,
  versionNo: number | null,
  status: 'PENDING' | 'APPROVED',
  actorId: string,
) {
  const now = new Date('2026-09-07T02:03:04.000Z')
  return {
    id,
    domain,
    entity,
    subject_id: subjectId,
    version_no: versionNo,
    status,
    revision: 1,
    submitted_by: actorId,
    submitted_at: now,
    ...(status === 'APPROVED'
      ? { approved_by: actorId, approved_at: now }
      : {}),
    updated_by: actorId,
    updated_at: now,
  }
}

test('AUX asset migration preserves current identity, exact VOU snapshots, references, and grants', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const desired = await readTargetPermissionCatalog()
  const suffix = (randomBytes(2).readUInt16BE() % 10_000)
    .toString()
    .padStart(4, '0')
  const actorId = ulid()
  const roleId = ulid()
  const employeeId = ulid()
  const operatingEntityId = ulid()
  const vehicleTypeId = ulid()
  const warehouseId = ulid()
  const vehicleId = ulid()
  const fundAccountId = ulid()
  const warehouseEntryId = ulid()
  const vehicleEntryId = ulid()
  const fundAccountEntryId = ulid()
  const vouEntryId = ulid()
  const warehouseReferenceId = ulid()
  const warehouseUsageId = ulid()
  const currentIds = [warehouseId, vehicleId, fundAccountId]
  const dependencyIds = [employeeId, operatingEntityId, vehicleTypeId]

  context.after(async () => {
    try {
      await db
        .deleteFrom('aux_reference_facts')
        .where('aux_object_id', 'in', [...currentIds, ...dependencyIds])
        .execute()
      await db
        .deleteFrom('dcl_warehouse_reference_facts')
        .where('id', '=', warehouseReferenceId)
        .execute()
      await db
        .deleteFrom('dcl_warehouse_usage_facts')
        .where('id', '=', warehouseUsageId)
        .execute()
      await db
        .deleteFrom('app_audit_events')
        .where('actor_user_id', '=', actorId)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', '=', vouEntryId)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', [
          warehouseEntryId,
          vehicleEntryId,
          fundAccountEntryId,
        ])
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', 'in', currentIds)
        .execute()
      await db.deleteFrom('aux_objects').where('id', 'in', currentIds).execute()
      await db
        .deleteFrom('aux_objects')
        .where('id', 'in', dependencyIds)
        .execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
      await bootstrap.migratePermissionCatalog(desired)
      await db.deleteFrom('app_users').where('id', '=', actorId).execute()
    } finally {
      await db.destroy()
    }
  })

  await db
    .insertInto('app_users')
    .values({
      id: actorId,
      username: `asset-migration-${actorId.toLowerCase()}`,
      display_name: 'AUX asset migration fixture',
      py: 'auxassetmigrationfixture',
      password_hash: 'not-used',
      status: 'ENABLED',
      password_changed_at: new Date(),
    })
    .execute()
  const now = new Date('2026-09-07T01:00:00.000Z')
  await db
    .insertInto('aux_objects')
    .values([
      {
        id: employeeId,
        entity: 'employee',
        code: `EMP-${suffix}`,
        data: {
          identityKind: 'PERSON',
          legalName: '负责人',
          displayName: '负责人',
          legalIdentifier: `31000000000000${suffix}`,
          contactName: '',
          phone: '',
          address: '',
          employeeCategory: { id: ulid(), code: 'ECT-0001', name: '类别' },
          department: { id: ulid(), code: 'DEP-0001', name: '部门' },
          position: { id: ulid(), code: 'POS-0001', name: '岗位' },
          employmentDate: '2020-01-01',
          workPhone: '',
          workEmail: '',
          operatingEntity: {
            id: operatingEntityId,
            code: `OPE-${suffix}`,
            name: '测试主体',
          },
          remark: '',
        },
        enabled: true,
        created_at: now,
        created_by: actorId,
        updated_at: now,
        updated_by: actorId,
      },
      {
        id: operatingEntityId,
        entity: 'operating-entity',
        code: `OPE-${suffix}`,
        data: {
          legalName: '测试主体',
          shortName: '主体',
          legalIdentifier: `91310000MA1A12${suffix}`,
          registeredAddress: '',
          contactName: '',
          contactPhone: '',
          invoiceTitle: '',
          invoiceAddress: '',
          invoicePhone: '',
          invoiceBank: '',
          invoiceAccount: '',
          remark: '',
        },
        enabled: true,
        created_at: now,
        created_by: actorId,
        updated_at: now,
        updated_by: actorId,
      },
      {
        id: vehicleTypeId,
        entity: 'dictionary-item',
        code: `DIT-${suffix}`,
        data: {
          name: '罐车',
          dictionaryTypeId: ulid(),
          dictionaryTypeCode: 'VEHICLE_TYPE',
          dictionaryTypeName: '车型',
          sortOrder: 1,
        },
        enabled: true,
        created_at: now,
        created_by: actorId,
        updated_at: now,
        updated_by: actorId,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values([
      {
        id: warehouseId,
        entity: 'warehouse',
        code: `WHS-${suffix}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: vehicleId,
        entity: 'vehicle',
        code: `VEH-${suffix}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: fundAccountId,
        entity: 'fund-account',
        code: `FAC-${suffix}`,
        created_at: now,
        created_by: actorId,
      },
    ])
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      approval(
        warehouseEntryId,
        'dcl',
        'warehouse',
        warehouseId,
        1,
        'APPROVED',
        actorId,
      ),
      approval(
        vehicleEntryId,
        'dcl',
        'vehicle',
        vehicleId,
        1,
        'APPROVED',
        actorId,
      ),
      approval(
        fundAccountEntryId,
        'dcl',
        'fund-account',
        fundAccountId,
        1,
        'APPROVED',
        actorId,
      ),
      approval(
        vouEntryId,
        'vou',
        'sale-delivery',
        ulid(),
        null,
        'PENDING',
        actorId,
      ),
    ])
    .execute()
  await db
    .insertInto('dcl_warehouse_versions')
    .values({
      approval_entry_id: warehouseEntryId,
      name: '一号仓',
      address: '旧地址',
      contact_name: '仓管',
      contact_phone: '021-10000000',
      manager_employee_id: employeeId,
      manager_employee_code: `EMP-${suffix}`,
      manager_employee_name: '历史负责人',
      remark: '仓库备注',
      enabled: true,
    })
    .execute()
  const internalCarrier = {
    kind: 'INTERNAL',
    operatingEntityId,
    code: `OPE-${suffix}`,
    name: '历史主体',
  }
  await db
    .insertInto('dcl_vehicle_versions')
    .values({
      approval_entry_id: vehicleEntryId,
      name: '一号车',
      plate_number: '沪A12345',
      vehicle_type_object_id: vehicleTypeId,
      vehicle_type_snapshot: JSON.stringify({
        id: vehicleTypeId,
        code: `DIT-${suffix}`,
        name: '历史车型',
      }),
      carrier_affiliation_type: 'INTERNAL',
      carrier_operating_entity_id: operatingEntityId,
      carrier_operating_entity_code: `OPE-${suffix}`,
      carrier_operating_entity_name: '历史主体',
      carrier_snapshot: JSON.stringify(internalCarrier),
      vin: `VIN${suffix}`,
      engine_number: `ENGINE${suffix}`,
      rated_load_micros: 12_500_000,
      bulk_liquid_capable: true,
      remark: '车辆备注',
      enabled: false,
    })
    .execute()
  await db
    .insertInto('dcl_fund_account_versions')
    .values({
      approval_entry_id: fundAccountEntryId,
      name: '基本户',
      currency: 'CNY',
      account_name: '测试主体',
      account_number: `CN-${suffix}`,
      bank_name: '测试银行',
      branch_name: '测试支行',
      operating_entity_id: operatingEntityId,
      operating_entity_code: `OPE-${suffix}`,
      operating_entity_name: '历史主体',
      operating_entity_snapshot: JSON.stringify({
        objectId: operatingEntityId,
        code: `OPE-${suffix}`,
        name: '历史主体',
      }),
      remark: '账户备注',
      enabled: true,
    })
    .execute()
  await sql`
    INSERT INTO vou_reference_snapshots(
      approval_entry_id, field, line_no, item_no, object_id,
      approval_reference_id, selection_origin, reference_entity,
      reference_code, reference_name
    ) VALUES
      (${vouEntryId}, 'materialWarehouse', 0, 0, ${warehouseId},
        ${warehouseEntryId}, 'CURRENT', 'warehouse', ${`WHS-${suffix}`}, '历史仓库'),
      (${vouEntryId}, 'vehicle', 0, 0, ${vehicleId},
        ${vehicleEntryId}, 'CURRENT', 'vehicle', ${`VEH-${suffix}`}, '历史车辆'),
      (${vouEntryId}, 'fundAccount', 1, 0, ${fundAccountId},
        ${fundAccountEntryId}, 'CURRENT', 'fund-account', ${`FAC-${suffix}`}, '历史账户')
  `.execute(db)
  await db
    .insertInto('dcl_warehouse_reference_facts')
    .values({
      id: warehouseReferenceId,
      warehouse_id: warehouseId,
      approval_entry_id: warehouseEntryId,
      domain: 'vou',
      entity: 'sale-order',
      business_id: vouEntryId,
      business_code: `SO-${suffix}`,
    })
    .execute()
  await db
    .insertInto('dcl_warehouse_usage_facts')
    .values({
      id: warehouseUsageId,
      warehouse_id: warehouseId,
      kind: 'INVENTORY',
      entity: 'product',
      business_id: ulid(),
      business_code: `PRD-${suffix}`,
      quantity_micros: 1000000,
      created_at: now,
    })
    .execute()
  const existingLegacyPermission = await db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/dcl/vehicle/submit-change')
    .executeTakeFirst()
  const legacyPermissionId = existingLegacyPermission?.id ?? ulid()
  if (!existingLegacyPermission)
    await db
      .insertInto('app_permissions')
      .values({
        id: legacyPermissionId,
        path: '/dcl/vehicle/submit-change',
        domain: 'dcl',
        entity: 'vehicle',
        action: 'submit-change',
        description: '旧车辆变更',
        status: 'ENABLED',
      })
      .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `asset-migration-${roleId.toLowerCase()}`,
      name: 'AUX asset migration role',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values({ role_id: roleId, permission_id: legacyPermissionId })
    .execute()

  const report = await new AuxAssetMigrationService(
    db,
    new AuxService(db),
  ).migrate(desired)
  assert.deepEqual(
    {
      warehouses: report.warehouses,
      vehicles: report.vehicles,
      fundAccounts: report.fundAccounts,
      openV1Sources: report.openV1Sources,
      vouReferenceSnapshots: report.vouReferenceSnapshots,
    },
    {
      warehouses: 1,
      vehicles: 1,
      fundAccounts: 1,
      openV1Sources: 0,
      vouReferenceSnapshots: 3,
    },
  )
  assert.deepEqual(
    await db
      .selectFrom('aux_objects')
      .select(['id', 'entity', 'code', 'enabled'])
      .where('id', 'in', currentIds)
      .orderBy('entity')
      .execute(),
    [
      {
        id: fundAccountId,
        entity: 'fund-account',
        code: `FAC-${suffix}`,
        enabled: true,
      },
      {
        id: vehicleId,
        entity: 'vehicle',
        code: `VEH-${suffix}`,
        enabled: false,
      },
      {
        id: warehouseId,
        entity: 'warehouse',
        code: `WHS-${suffix}`,
        enabled: true,
      },
    ],
  )
  const snapshots = await sql<{
    field: string
    approval_reference_id: string
    aux_snapshot: unknown
  }>`
    SELECT field, approval_reference_id, aux_snapshot
    FROM vou_reference_snapshots
    WHERE approval_entry_id = ${vouEntryId}
    ORDER BY field
  `.execute(db)
  assert.deepEqual(
    snapshots.rows.map((row) => [row.field, row.approval_reference_id]),
    [
      ['fundAccount', fundAccountEntryId],
      ['materialWarehouse', warehouseEntryId],
      ['vehicle', vehicleEntryId],
    ],
  )
  assert.ok(snapshots.rows.every((row) => row.aux_snapshot !== null))
  const sources = await db
    .selectFrom('aux_reference_facts')
    .select(['aux_object_id', 'source'])
    .where('aux_object_id', 'in', currentIds)
    .execute()
  assert.ok(
    sources.some(
      (fact) =>
        fact.aux_object_id === warehouseId &&
        fact.source === `dcl:warehouse-usage:${warehouseUsageId}`,
    ),
  )
  assert.ok(
    sources.some(
      (fact) =>
        fact.aux_object_id === fundAccountId &&
        fact.source === `vou:${vouEntryId}:fundAccount:1:0`,
    ),
  )
  const migratedPaths = await db
    .selectFrom('app_role_permissions as grant')
    .innerJoin(
      'app_permissions as permission',
      'permission.id',
      'grant.permission_id',
    )
    .select('permission.path')
    .where('grant.role_id', '=', roleId)
    .orderBy('permission.path')
    .execute()
  assert.deepEqual(
    migratedPaths.map((permission) => permission.path),
    ['/aux/vehicle/disable', '/aux/vehicle/enable', '/aux/vehicle/save'],
  )
})

test('AUX asset migration blocker rolls back current rows, snapshots, audits, and grants', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const desired = await readTargetPermissionCatalog()
  const actorId = ulid()
  const subjectId = ulid()
  const approvedEntryId = ulid()
  const candidateEntryId = ulid()
  const roleId = ulid()
  const permissionId = ulid()

  context.after(async () => {
    try {
      await db
        .deleteFrom('app_audit_events')
        .where('actor_user_id', '=', actorId)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', [candidateEntryId, approvedEntryId])
        .execute()
      await db.deleteFrom('dcl_subjects').where('id', '=', subjectId).execute()
      await db.deleteFrom('aux_objects').where('id', '=', subjectId).execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
      await bootstrap.migratePermissionCatalog(desired)
      await db.deleteFrom('app_users').where('id', '=', actorId).execute()
    } finally {
      await db.destroy()
    }
  })
  await db
    .insertInto('app_users')
    .values({
      id: actorId,
      username: `asset-blocker-${actorId.toLowerCase()}`,
      display_name: 'AUX asset blocker fixture',
      py: 'auxassetblockerfixture',
      password_hash: 'not-used',
      status: 'ENABLED',
      password_changed_at: new Date(),
    })
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values({
      id: subjectId,
      entity: 'warehouse',
      code: 'WHS-9999',
      created_at: new Date(),
      created_by: actorId,
    })
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      approval(
        approvedEntryId,
        'dcl',
        'warehouse',
        subjectId,
        1,
        'APPROVED',
        actorId,
      ),
      approval(
        candidateEntryId,
        'dcl',
        'warehouse',
        subjectId,
        2,
        'PENDING',
        actorId,
      ),
    ])
    .execute()
  await db
    .insertInto('app_permissions')
    .values({
      id: permissionId,
      path: '/dcl/warehouse/submit-new',
      domain: 'dcl',
      entity: 'warehouse',
      action: 'submit-new',
      description: '旧仓库新建',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `asset-blocker-${roleId.toLowerCase()}`,
      name: 'AUX asset blocker role',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values({ role_id: roleId, permission_id: permissionId })
    .execute()

  await assert.rejects(
    new AuxAssetMigrationService(db, new AuxService(db)).migrate(desired),
    (error: unknown) =>
      error instanceof AuxAssetMigrationBlockedError &&
      error.blockers.some(
        (blocker) =>
          blocker.kind === 'UNRESOLVED_CANDIDATE' &&
          blocker.candidateEntryId === candidateEntryId,
      ),
  )
  assert.equal(
    await db
      .selectFrom('aux_objects')
      .select('id')
      .where('id', '=', subjectId)
      .executeTakeFirst(),
    undefined,
  )
  assert.equal(
    await db
      .selectFrom('app_audit_events')
      .select('id')
      .where('target_id', '=', subjectId)
      .executeTakeFirst(),
    undefined,
  )
  assert.deepEqual(
    await db
      .selectFrom('app_role_permissions')
      .select(['role_id', 'permission_id'])
      .where('role_id', '=', roleId)
      .execute(),
    [{ role_id: roleId, permission_id: permissionId }],
  )
})
