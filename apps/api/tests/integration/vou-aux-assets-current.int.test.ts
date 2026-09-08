import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import { AuxService } from '../../src/aux/service.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'
import { VouService, VouApplicationError } from '../../src/vou/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('VOU adopts current fund accounts authoritatively and preserves their history after editing or disabling', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = randomBytes(6).toString('hex').toUpperCase()
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `asset-vou-${suffix.toLowerCase()}`,
    passwordHash: await hashPassword(randomBytes(24).toString('base64url')),
  }
  const entities = [
    'operating-entity',
    'employee',
    'employee-category',
    'department',
    'position',
    'fund-account',
  ]
  const actor = {
    id: principal.userId,
    permissions: entities.flatMap((entity) =>
      ['create', 'get', 'save', 'disable'].map(
        (action) => `/aux/${entity}/${action}`,
      ),
    ),
    trusted: true,
  }
  const aux = new AuxService(db)
  const vou = new VouService(db, {
    acc: { async apply() {} },
    wfl: { async apply() {} },
  })
  await bootstrap.createE2EPrincipal(principal, false, [
    '/aux/operating-entity/query',
  ])
  context.after(async () => {
    try {
      await sql`DELETE FROM vou_idempotency WHERE document_id IN (SELECT id FROM vou_documents WHERE created_by=${actor.id})`.execute(
        db,
      )
      await sql`DELETE FROM approval_events WHERE actor_id=${actor.id}`.execute(
        db,
      )
      await sql`DELETE FROM approval_entries WHERE domain='vou' AND submitted_by=${actor.id}`.execute(
        db,
      )
      await sql`DELETE FROM vou_documents WHERE created_by=${actor.id}`.execute(
        db,
      )
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })
  const operatingEntity = await aux.create(
    'operating-entity',
    {
      legalName: `主体${suffix}`,
      shortName: '主体',
      legalIdentifier: `OPTEST${suffix}`,
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
    actor,
  )
  const employeeCategory = await aux.create(
    'employee-category',
    { name: `类别${suffix}` },
    actor,
  )
  const department = await aux.create(
    'department',
    { name: `部门${suffix}` },
    actor,
  )
  const position = await aux.create(
    'position',
    { name: `岗位${suffix}` },
    actor,
  )
  const employee = await aux.create(
    'employee',
    {
      identityKind: 'PERSON',
      legalName: '张三',
      displayName: '张三',
      legalIdentifier: `EMP${suffix}`,
      contactName: '',
      phone: '',
      address: '',
      employeeCategoryId: employeeCategory.id,
      departmentId: department.id,
      positionId: position.id,
      employmentDate: '2026-09-07',
      workPhone: '',
      workEmail: '',
      operatingEntityId: operatingEntity.id,
      remark: '',
    },
    actor,
  )
  const accountInput = {
    name: '采用时账户',
    currency: 'CNY',
    accountName: '原户名',
    bank: '原银行',
    branch: '原支行',
    accountNumber: `AC${suffix}`,
    operatingEntityId: operatingEntity.id,
    remark: '原备注',
  }
  const account = await aux.create('fund-account', accountInput, actor)
  const accountDetail = await aux.get('fund-account', { id: account.id }, actor)
  const submissionId = ulid()
  const input = {
    documentId: ulid(),
    submissionId,
    idempotencyKey: submissionId,
    expectedRevision: null,
    payload: {
      businessDate: '2026-09-07',
      currency: 'CNY',
      attachments: [],
      employee: { objectId: employee.id },
      handler: { objectId: employee.id },
      fundAccount: { objectId: account.id, code: 'FORGED', name: '伪造账户' },
      amount: '12.00',
    },
  }
  const submitted = await vou.submit(
    'employee-loan',
    'submit-new',
    input,
    actor,
    'asset-adopt',
  )
  const adopted = (
    submitted.payload as {
      fundAccount: {
        code: string
        name: string
        snapshot: { name: string; bank: string; accountNumber: string }
      }
    }
  ).fundAccount
  assert.equal(adopted.code, accountDetail.code)
  assert.equal(adopted.name, '采用时账户')
  assert.equal(adopted.snapshot.bank, '原银行')
  assert.equal(adopted.snapshot.accountNumber, `AC${suffix}`)
  assert.ok(!('approvalEntryId' in adopted))
  const saved = await aux.save(
    'fund-account',
    {
      id: account.id,
      revision: account.revision,
      ...accountInput,
      name: '修改后账户',
      bank: '新银行',
    },
    actor,
  )
  assert.deepEqual(
    (await vou.get('employee-loan', input.documentId, actor)).payload,
    submitted.payload,
  )
  const mismatchId = ulid()
  const mismatch = {
    ...input,
    documentId: ulid(),
    submissionId: mismatchId,
    idempotencyKey: mismatchId,
    payload: { ...input.payload, currency: 'USD' },
  }
  await assert.rejects(
    vou.submit(
      'employee-loan',
      'submit-new',
      mismatch,
      actor,
      'asset-currency',
    ),
    (error) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_reference_unavailable',
  )
  await assert.rejects(
    vou.get('employee-loan', mismatch.documentId, actor),
    (error) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_not_found',
  )
  await aux.disable(
    'fund-account',
    { id: account.id, revision: saved.revision },
    actor,
    'asset-disable',
  )
  assert.deepEqual(
    (await vou.get('employee-loan', input.documentId, actor)).payload,
    submitted.payload,
  )
  assert.deepEqual(
    (
      await vou.submit(
        'employee-loan',
        'submit-new',
        input,
        actor,
        'asset-retry',
      )
    ).payload,
    submitted.payload,
  )
  const disabledId = ulid()
  await assert.rejects(
    vou.submit(
      'employee-loan',
      'submit-new',
      {
        ...input,
        documentId: ulid(),
        submissionId: disabledId,
        idempotencyKey: disabledId,
      },
      actor,
      'asset-disabled',
    ),
    (error) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_reference_unavailable',
  )
})
