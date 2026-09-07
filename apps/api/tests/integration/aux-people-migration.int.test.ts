import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { sql } from 'kysely'
import { ulid } from 'ulid'

import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { AuxService } from '../../src/aux/service.ts'
import {
  AuxPeopleMigrationBlockedError,
  AuxPeopleMigrationService,
} from '../../src/aux/migration.ts'
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
  const now = new Date('2026-09-07T01:02:03.000Z')
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

test('AUX people migration imports current facts and preserves DCL, VOU, and ACC history', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const desired = await readTargetPermissionCatalog()
  const suffix = (randomBytes(2).readUInt16BE() % 10_000)
    .toString()
    .padStart(4, '0')
  const actorId = ulid()
  const roleId = ulid()
  const legacyPermissionId = ulid()
  const operatingEntityId = ulid()
  const operatingEntityEntryId = ulid()
  const employeeId = ulid()
  const employeeEntryId = ulid()
  const employeeCategoryId = ulid()
  const departmentId = ulid()
  const positionId = ulid()
  const vouEntryId = ulid()
  const openingEntryId = ulid()
  const bookId = ulid()
  const billId = ulid()
  const registerId = ulid()
  const subjectId = ulid()
  const journalId = ulid()
  const journalLineId = ulid()
  const allAuxIds = [
    operatingEntityId,
    employeeId,
    employeeCategoryId,
    departmentId,
    positionId,
  ]
  const countersBefore = await db
    .selectFrom('object_number_counters')
    .selectAll()
    .where('domain', '=', 'aux')
    .where('entity', 'in', ['operating-entity', 'employee'])
    .execute()

  context.after(async () => {
    try {
      await db
        .deleteFrom('aux_reference_facts')
        .where('aux_object_id', 'in', allAuxIds)
        .execute()
      await db
        .deleteFrom('app_audit_events')
        .where('actor_user_id', '=', actorId)
        .execute()
      await db
        .deleteFrom('acc_register_entries')
        .where('id', '=', registerId)
        .execute()
      await db
        .deleteFrom('acc_journal_entries')
        .where('id', '=', journalId)
        .execute()
      await db.deleteFrom('acc_subjects').where('id', '=', subjectId).execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', [vouEntryId, openingEntryId])
        .execute()
      await db.deleteFrom('acc_books').where('id', '=', bookId).execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', [employeeEntryId, operatingEntityEntryId])
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', 'in', [employeeId, operatingEntityId])
        .execute()
      await db.deleteFrom('aux_objects').where('id', 'in', allAuxIds).execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
      await bootstrap.migratePermissionCatalog(desired)
      await db
        .deleteFrom('object_number_counters')
        .where('domain', '=', 'aux')
        .where('entity', 'in', ['operating-entity', 'employee'])
        .execute()
      if (countersBefore.length > 0)
        await db
          .insertInto('object_number_counters')
          .values(countersBefore)
          .execute()
      await db.deleteFrom('app_users').where('id', '=', actorId).execute()
    } finally {
      await db.destroy()
    }
  })

  await db
    .insertInto('app_users')
    .values({
      id: actorId,
      username: `aux-migration-${actorId.toLowerCase()}`,
      display_name: 'AUX migration fixture',
      py: 'auxmigrationfixture',
      password_hash: 'not-used',
      status: 'ENABLED',
      password_changed_at: new Date(),
    })
    .execute()
  await db
    .insertInto('aux_objects')
    .values([
      {
        id: employeeCategoryId,
        entity: 'employee-category',
        code: `ECT-${suffix}`,
        data: JSON.stringify({ name: '旧员工类别', description: '' }),
        enabled: true,
        created_by: actorId,
        updated_by: actorId,
      },
      {
        id: departmentId,
        entity: 'department',
        code: `DEP-${suffix}`,
        data: JSON.stringify({ name: '旧部门', parentId: '', description: '' }),
        enabled: true,
        created_by: actorId,
        updated_by: actorId,
      },
      {
        id: positionId,
        entity: 'position',
        code: `POS-${suffix}`,
        data: JSON.stringify({ name: '旧岗位', description: '' }),
        enabled: true,
        created_by: actorId,
        updated_by: actorId,
      },
    ])
    .execute()
  const createdAt = new Date('2026-01-02T03:04:05.000Z')
  await db
    .insertInto('dcl_subjects')
    .values([
      {
        id: operatingEntityId,
        entity: 'operating-entity',
        code: `OPE-${suffix}`,
        created_at: createdAt,
        created_by: actorId,
      },
      {
        id: employeeId,
        entity: 'employee',
        code: `EMP-${suffix}`,
        created_at: createdAt,
        created_by: actorId,
      },
    ])
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      approval(
        operatingEntityEntryId,
        'dcl',
        'operating-entity',
        operatingEntityId,
        1,
        'APPROVED',
        actorId,
      ),
      approval(
        employeeEntryId,
        'dcl',
        'employee',
        employeeId,
        1,
        'PENDING',
        actorId,
      ),
      approval(vouEntryId, 'vou', 'sale-order', ulid(), 1, 'APPROVED', actorId),
      approval(
        openingEntryId,
        'acc',
        'opening',
        bookId,
        null,
        'APPROVED',
        actorId,
      ),
    ])
    .execute()
  const operatingEntityData = {
    legalName: '历史经营主体',
    shortName: '历史主体',
    legalIdentifier: `91310000MA1K${suffix}56`,
    registeredAddress: '历史注册地址',
    contactName: '历史联系人',
    contactPhone: '13800000000',
    invoiceTitle: '历史开票抬头',
    invoiceAddress: '历史开票地址',
    invoicePhone: '021-00000000',
    invoiceBank: '历史银行',
    invoiceAccount: '123456',
    remark: '历史备注',
  }
  await db
    .insertInto('dcl_operating_entity_versions')
    .values({
      approval_entry_id: operatingEntityEntryId,
      legal_name: operatingEntityData.legalName,
      short_name: operatingEntityData.shortName,
      legal_identifier: operatingEntityData.legalIdentifier,
      registered_address: operatingEntityData.registeredAddress,
      contact_name: operatingEntityData.contactName,
      contact_phone: operatingEntityData.contactPhone,
      invoice_title: operatingEntityData.invoiceTitle,
      invoice_address: operatingEntityData.invoiceAddress,
      invoice_phone: operatingEntityData.invoicePhone,
      invoice_bank: operatingEntityData.invoiceBank,
      invoice_account: operatingEntityData.invoiceAccount,
      remark: operatingEntityData.remark,
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_employee_versions')
    .values({
      approval_entry_id: employeeEntryId,
      display_name: '历史员工',
      legal_name: '历史员工',
      legal_identifier: `EMPLOYEE${suffix}`,
      employee_category_id: employeeCategoryId,
      department_id: departmentId,
      position_id: positionId,
      operating_entity_id: operatingEntityId,
      operating_entity_approval_entry_id: operatingEntityEntryId,
      operating_entity_code: `OPE-${suffix}`,
      operating_entity_name: operatingEntityData.legalName,
      work_phone: '021-11111111',
      work_email: 'history@example.com',
      hired_on: '2020-01-02',
      remark: '员工备注',
      source_snapshots: JSON.stringify({
        identityKind: 'PERSON',
        contactName: '历史员工',
        phone: '13900000000',
        address: '历史地址',
        employeeCategory: {
          id: employeeCategoryId,
          code: `ECT-${suffix}`,
          name: '旧员工类别',
        },
        department: {
          id: departmentId,
          code: `DEP-${suffix}`,
          name: '旧部门',
        },
        position: {
          id: positionId,
          code: `POS-${suffix}`,
          name: '旧岗位',
        },
      }),
      enabled: false,
    })
    .execute()
  await sql`INSERT INTO vou_reference_snapshots(
      approval_entry_id, field, line_no, item_no, object_id,
      approval_reference_id, selection_origin, reference_entity,
      reference_code, reference_name
    ) VALUES (
      ${vouEntryId}, 'operatingEntity', 0, 0, ${operatingEntityId},
      ${operatingEntityEntryId}, 'CURRENT', 'operating-entity',
      ${`OPE-${suffix}`}, ${operatingEntityData.legalName}
    )`.execute(db)
  await db
    .insertInto('acc_books')
    .values({
      id: bookId,
      code: `ACC-${suffix}`,
      name: '迁移测试账簿',
      description: '',
      start_month: '2026-01',
      base_currency: 'CNY',
      control_book: false,
      created_at: createdAt,
      created_by: actorId,
      updated_at: createdAt,
      updated_by: actorId,
    })
    .execute()
  await db
    .insertInto('acc_subjects')
    .values({
      id: subjectId,
      book_id: bookId,
      code: `SUB-${suffix}`,
      name: '迁移测试科目',
      balance_direction: 'DEBIT',
      enabled: true,
      required_dimensions: JSON.stringify(['EMPLOYEE']),
      inventory_quantity: false,
      settlement_purpose: 'NONE',
      created_at: createdAt,
      created_by: actorId,
      updated_at: createdAt,
      updated_by: actorId,
    })
    .execute()
  await db
    .insertInto('acc_journal_entries')
    .values({
      id: journalId,
      book_id: bookId,
      source_kind: 'COST_SETTLEMENT',
      business_date: '2026-01-02',
      currency: 'CNY',
      created_at: createdAt,
    })
    .execute()
  await db
    .insertInto('acc_journal_lines')
    .values({
      id: journalLineId,
      journal_entry_id: journalId,
      subject_id: subjectId,
      direction: 'DEBIT',
      amount: '0',
      dimensions: JSON.stringify({ EMPLOYEE: employeeId }),
    })
    .execute()
  const oldBill = {
    billId,
    originatingCounterparty: {
      entity: 'operating-entity',
      objectId: operatingEntityId,
      approvalEntryId: operatingEntityEntryId,
      code: `OPE-${suffix}`,
      name: operatingEntityData.legalName,
    },
  }
  await db
    .insertInto('acc_opening_snapshots')
    .values({
      approval_entry_id: openingEntryId,
      book_id: bookId,
      payload: JSON.stringify({
        lines: [{ dimensions: { EMPLOYEE: employeeId } }],
        bills: [oldBill],
      }),
    })
    .execute()
  await db
    .insertInto('acc_register_entries')
    .values({
      id: registerId,
      register_kind: 'BILL',
      object_id: billId,
      source_kind: 'OPENING',
      opening_approval_entry_id: openingEntryId,
      payload: JSON.stringify(oldBill),
      created_at: createdAt,
    })
    .execute()
  await db
    .insertInto('app_permissions')
    .values({
      id: legacyPermissionId,
      path: '/dcl/employee/submit-change',
      domain: 'dcl',
      entity: 'employee',
      action: 'submit-change',
      description: '旧员工变更',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `aux-migration-${roleId.toLowerCase()}`,
      name: 'AUX migration role',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values({ role_id: roleId, permission_id: legacyPermissionId })
    .execute()

  const historicalBefore = await db
    .selectFrom('vou_reference_snapshots')
    .select([
      'object_id',
      'approval_reference_id',
      'selection_origin',
      'reference_entity',
      'reference_code',
      'reference_name',
    ])
    .where('approval_entry_id', '=', vouEntryId)
    .executeTakeFirstOrThrow()
  const report = await new AuxPeopleMigrationService(
    db,
    new AuxService(db),
  ).migrate(desired)

  assert.equal(report.operatingEntities, 1)
  assert.equal(report.employees, 1)
  assert.equal(report.openV1Sources, 1)
  assert.equal(report.vouReferenceSnapshots, 1)
  assert.deepEqual(
    await db
      .selectFrom('aux_objects')
      .select(['id', 'entity', 'code', 'enabled'])
      .where('id', 'in', [operatingEntityId, employeeId])
      .orderBy('entity')
      .execute(),
    [
      {
        id: employeeId,
        entity: 'employee',
        code: `EMP-${suffix}`,
        enabled: false,
      },
      {
        id: operatingEntityId,
        entity: 'operating-entity',
        code: `OPE-${suffix}`,
        enabled: true,
      },
    ],
  )
  const historicalAfter = await sql<{
    object_id: string
    approval_reference_id: string
    selection_origin: string
    reference_entity: string
    reference_code: string
    reference_name: string
    aux_snapshot: unknown
  }>`SELECT object_id, approval_reference_id, selection_origin,
      reference_entity, reference_code, reference_name, aux_snapshot
    FROM vou_reference_snapshots
    WHERE approval_entry_id = ${vouEntryId}`.execute(db)
  assert.deepEqual(
    {
      ...historicalAfter.rows[0],
      aux_snapshot: undefined,
    },
    { ...historicalBefore, aux_snapshot: undefined },
  )
  assert.deepEqual(historicalAfter.rows[0]!.aux_snapshot, operatingEntityData)
  const sources = await db
    .selectFrom('aux_reference_facts')
    .select(['aux_object_id', 'source'])
    .where('aux_object_id', 'in', [operatingEntityId, employeeId])
    .orderBy('source')
    .execute()
  assert.ok(
    sources.some(
      (fact) =>
        fact.aux_object_id === employeeId &&
        fact.source ===
          `acc:opening:${openingEntryId}:line:1:dimension:EMPLOYEE`,
    ),
  )
  assert.equal(
    sources.filter(
      (fact) =>
        fact.source ===
        `acc:opening:${openingEntryId}:bill:${billId}:originating-counterparty`,
    ).length,
    1,
  )
  assert.ok(
    sources.some(
      (fact) =>
        fact.aux_object_id === employeeId &&
        fact.source ===
          `acc:journal:${journalId}:line:${journalLineId}:dimension:EMPLOYEE`,
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
    ['/aux/employee/disable', '/aux/employee/enable', '/aux/employee/save'],
  )
})

test('AUX people migration blocker rolls back current data, audit, and permission changes', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const desired = await readTargetPermissionCatalog()
  const bootstrap = new TargetBootstrapService(db)
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
      username: `aux-blocker-${actorId.toLowerCase()}`,
      display_name: 'AUX blocker fixture',
      py: 'auxblockerfixture',
      password_hash: 'not-used',
      status: 'ENABLED',
      password_changed_at: new Date(),
    })
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values({
      id: subjectId,
      entity: 'operating-entity',
      code: 'OPE-9999',
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
        'operating-entity',
        subjectId,
        1,
        'APPROVED',
        actorId,
      ),
      approval(
        candidateEntryId,
        'dcl',
        'operating-entity',
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
      path: '/dcl/operating-entity/submit-new',
      domain: 'dcl',
      entity: 'operating-entity',
      action: 'submit-new',
      description: '旧经营主体新建',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `aux-blocker-${roleId.toLowerCase()}`,
      name: 'AUX blocker role',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values({ role_id: roleId, permission_id: permissionId })
    .execute()

  await assert.rejects(
    new AuxPeopleMigrationService(db, new AuxService(db)).migrate(desired),
    (error: unknown) =>
      error instanceof AuxPeopleMigrationBlockedError &&
      error.blockers.some(
        (blocker) =>
          blocker.kind === 'UNRESOLVED_CANDIDATE' &&
          blocker.subjectId === subjectId &&
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
