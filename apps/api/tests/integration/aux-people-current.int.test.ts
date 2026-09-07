import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { ulid } from 'ulid'

import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword } from '../../src/app/session.ts'
import {
  AuxApplicationError,
  AuxService,
  type AuxSaveInput,
} from '../../src/aux/service.ts'
import { createDatabase } from '../../src/db/database.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('AUX current operating entities and employees freeze adopted references, protect physical deletion, and audit direct writes', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = randomBytes(6).toString('hex').toUpperCase()
  const operatingLegalIdentifier = `OPE${suffix}000`
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `aux-people-${suffix.toLowerCase()}`,
    passwordHash: await hashPassword(`AuxPeople!${suffix}`),
  }
  const actor = {
    id: principal.userId,
    permissions: [
      ...(['operating-entity', 'employee'] as const).flatMap((entity) =>
        ['query', 'get', 'create', 'save', 'enable', 'disable', 'delete'].map(
          (action) => `/aux/${entity}/${action}`,
        ),
      ),
      ...(['employee-category', 'department', 'position'] as const).flatMap(
        (entity) => [`/aux/${entity}/create`],
      ),
    ],
  }
  const service = new AuxService(db)
  await bootstrap.createE2EPrincipal(principal, false, [
    '/aux/operating-entity/query',
  ])
  context.after(async () => {
    try {
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })

  const operatingEntity = await service.create(
    'operating-entity',
    {
      legalName: `测试经营主体${suffix}`,
      shortName: '测试主体',
      legalIdentifier: operatingLegalIdentifier,
      registeredAddress: '上海市',
      contactName: '张三',
      contactPhone: '13800000000',
      invoiceTitle: `测试经营主体${suffix}`,
      invoiceAddress: '上海市',
      invoicePhone: '13800000000',
      invoiceBank: '测试银行',
      invoiceAccount: '123456',
      remark: '',
    },
    actor,
    'create-operating-entity',
  )
  const [employeeCategory, department, position] = await Promise.all([
    service.create('employee-category', { name: `人员类别${suffix}` }, actor),
    service.create('department', { name: `部门${suffix}` }, actor),
    service.create('position', { name: `岗位${suffix}` }, actor),
  ])
  const employee = await service.create(
    'employee',
    {
      identityKind: 'PERSON',
      legalName: `张三${suffix}`,
      displayName: `张三${suffix}`,
      legalIdentifier: `EMP${suffix}`,
      contactName: `张三${suffix}`,
      phone: '13800000000',
      address: '上海市',
      employeeCategoryId: employeeCategory.id,
      departmentId: department.id,
      positionId: position.id,
      employmentDate: '2026-09-07',
      workPhone: '021-00000000',
      workEmail: 'zhangsan@example.com',
      operatingEntityId: operatingEntity.id,
      remark: '',
    },
    actor,
    'create-employee',
  )
  const operatingEntityBeforeChange = await service.get(
    'operating-entity',
    { id: operatingEntity.id },
    actor,
  )
  const employeeBeforeEntityChange = await service.get(
    'employee',
    { id: employee.id },
    actor,
  )
  assert.deepEqual(employeeBeforeEntityChange.operatingEntity, {
    id: operatingEntity.id,
    code: operatingEntityBeforeChange.code,
    name: `测试经营主体${suffix}`,
  })

  const operatingEntityDetail = await service.get(
    'operating-entity',
    { id: operatingEntity.id },
    actor,
  )
  await service.save(
    'operating-entity',
    {
      id: operatingEntityDetail.id,
      revision: operatingEntityDetail.revision,
      legalName: `改名经营主体${suffix}`,
      shortName: operatingEntityDetail.shortName,
      legalIdentifier: operatingEntityDetail.legalIdentifier,
      registeredAddress: operatingEntityDetail.registeredAddress,
      contactName: operatingEntityDetail.contactName,
      contactPhone: operatingEntityDetail.contactPhone,
      invoiceTitle: operatingEntityDetail.invoiceTitle,
      invoiceAddress: operatingEntityDetail.invoiceAddress,
      invoicePhone: operatingEntityDetail.invoicePhone,
      invoiceBank: operatingEntityDetail.invoiceBank,
      invoiceAccount: operatingEntityDetail.invoiceAccount,
      remark: operatingEntityDetail.remark,
    },
    actor,
    'save-operating-entity',
  )
  assert.equal(
    (await service.get('employee', { id: employee.id }, actor)).operatingEntity
      .name,
    `测试经营主体${suffix}`,
  )

  await assert.rejects(
    () =>
      service.delete(
        'operating-entity',
        { id: operatingEntity.id, revision: '2' },
        actor,
        'delete-operating-entity',
      ),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'conflict' &&
      Array.isArray((error.data as { blockers?: unknown[] }).blockers),
  )
  await assert.rejects(
    () =>
      service.save(
        'operating-entity',
        {
          id: operatingEntity.id,
          revision: '1',
          legalName: '陈旧修订',
          shortName: '',
          legalIdentifier: operatingLegalIdentifier,
          registeredAddress: '',
          contactName: '',
          contactPhone: '',
          invoiceTitle: '',
          invoiceAddress: '',
          invoicePhone: '',
          invoiceBank: '',
          invoiceAccount: '',
          remark: '',
        } as AuxSaveInput<'operating-entity'>,
        actor,
      ),
    (error) =>
      error instanceof AuxApplicationError && error.errorKey === 'conflict',
  )
  const audits = await db
    .selectFrom('app_audit_events')
    .select(['event_type', 'target_id'])
    .where('actor_user_id', '=', principal.userId)
    .execute()
  assert.deepEqual(
    audits
      .filter((audit) => audit.target_id === operatingEntity.id)
      .map((audit) => audit.event_type)
      .sort(),
    ['AUX_OPERATING_ENTITY_CREATED', 'AUX_OPERATING_ENTITY_SAVED'],
  )
  const employeeCurrent = await service.get(
    'employee',
    { id: employee.id },
    actor,
  )
  const disabledEmployee = await service.disable(
    'employee',
    { id: employee.id, revision: employeeCurrent.revision },
    actor,
    'disable-employee',
  )
  const enabledEmployee = await service.enable(
    'employee',
    { id: employee.id, revision: disabledEmployee.revision },
    actor,
    'enable-employee',
  )
  assert.equal(enabledEmployee.enabled, true)
  assert.deepEqual(
    (await service.get('employee', { id: employee.id }, actor)).operatingEntity,
    employeeCurrent.operatingEntity,
  )
})
