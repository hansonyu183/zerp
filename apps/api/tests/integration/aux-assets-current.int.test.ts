import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { ulid } from 'ulid'
import { AuxApplicationError, AuxService } from '../../src/aux/service.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { modelBuildId } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { SessionService } from '../../src/app/session.ts'
import { hashPassword } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('AUX assets enforce revision, unique identities, adopted references and atomic warehouse disable blockers', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl),
    bootstrap = new TargetBootstrapService(db),
    aux = new AuxService(db)
  const suffix = randomBytes(6).toString('hex').toUpperCase()
  const password = randomBytes(24).toString('base64url')
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `assets-${suffix}`,
    passwordHash: await hashPassword(password),
  }
  const actor = {
    id: principal.userId,
    permissions: [
      'operating-entity',
      'warehouse',
      'fund-account',
      'vehicle',
      'dictionary-type',
      'dictionary-item',
    ].flatMap((entity) =>
      ['query', 'get', 'create', 'save', 'enable', 'disable', 'delete'].map(
        (action) => `/aux/${entity}/${action}`,
      ),
    ),
  }
  await bootstrap.createE2EPrincipal(principal, false, actor.permissions)
  const usageIds: string[] = []
  context.after(async () => {
    try {
      if (usageIds.length)
        await db
          .deleteFrom('dcl_warehouse_usage_facts')
          .where('id', 'in', usageIds)
          .execute()
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })
  const op = await aux.create(
    'operating-entity',
    {
      legalName: '资产主体',
      shortName: '主体',
      legalIdentifier: `ASSETS${suffix}`,
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
  const warehouseInput = {
    name: '测试仓库',
    address: '',
    contactName: '',
    contactPhone: '',
    managerEmployeeId: null,
    remark: '',
  }
  const warehouse = await aux.create('warehouse', warehouseInput, actor)
  for (const kind of [
    'INVENTORY',
    'DOCUMENT',
    'SOURCE',
    'REFERENCE',
  ] as const) {
    const id = ulid()
    usageIds.push(id)
    await db
      .insertInto('dcl_warehouse_usage_facts')
      .values({
        id,
        warehouse_id: warehouse.id,
        kind,
        entity: 'test',
        business_id: ulid(),
        business_code: 'TEST',
        quantity_micros: kind === 'INVENTORY' ? '1' : null,
        created_at: new Date(),
      })
      .execute()
  }
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    aux,
  })
  const login = await app.request('/session/auth/signin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-zerp-model-build': modelBuildId,
    },
    body: JSON.stringify({ code: principal.username, password }),
  })
  const session = await login.json()
  assert.equal(session.code, 0)
  const response = await app.request('/aux/warehouse/disable', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': session.data.csrfToken,
      cookie: login.headers.getSetCookie()[0]!,
    },
    body: JSON.stringify({ id: warehouse.id, revision: warehouse.revision }),
  })
  const envelope = await response.json()
  assert.equal(envelope.errorKey, 'warehouse_disable_blocked')
  assert.ok(envelope.requestId)
  assert.equal(envelope.data.inventory.length, 1)
  assert.equal(envelope.data.documents.length, 1)
  assert.equal(envelope.data.sources.length, 1)
  assert.equal(envelope.data.references.length, 1)
  const before = await aux.get('warehouse', { id: warehouse.id }, actor)
  await assert.rejects(
    aux.disable(
      'warehouse',
      { id: warehouse.id, revision: warehouse.revision },
      actor,
      'blocked',
    ),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'warehouse_disable_blocked' &&
      Object.values(error.data as Record<string, unknown[]>).every(
        (rows) => rows.length === 1,
      ),
  )
  assert.deepEqual(
    await aux.get('warehouse', { id: warehouse.id }, actor),
    before,
  )
  await db
    .deleteFrom('dcl_warehouse_usage_facts')
    .where('id', 'in', usageIds)
    .execute()
  const currentReferenceId = ulid()
  await db
    .insertInto('aux_reference_facts')
    .values({
      id: currentReferenceId,
      aux_object_id: warehouse.id,
      source: 'aux_current:warehouse:test',
    })
    .execute()
  await assert.rejects(
    aux.disable(
      'warehouse',
      { id: warehouse.id, revision: warehouse.revision },
      actor,
      'current-reference',
    ),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'warehouse_disable_blocked',
  )
  await db
    .deleteFrom('aux_reference_facts')
    .where('id', '=', currentReferenceId)
    .execute()
  const historyReferenceId = ulid()
  await db
    .insertInto('aux_reference_facts')
    .values({
      id: historyReferenceId,
      aux_object_id: warehouse.id,
      source: 'acc:journal:completed',
    })
    .execute()
  const disabled = await aux.disable(
    'warehouse',
    { id: warehouse.id, revision: warehouse.revision },
    actor,
    'disable',
  )
  await assert.rejects(
    aux.save(
      'warehouse',
      {
        id: warehouse.id,
        revision: warehouse.revision,
        ...warehouseInput,
        name: '过期覆盖',
      },
      actor,
    ),
    (error) =>
      error instanceof AuxApplicationError && error.errorKey === 'conflict',
  )
  const enabled = await aux.enable(
    'warehouse',
    { id: warehouse.id, revision: disabled.revision },
    actor,
    'enable',
  )
  await db
    .deleteFrom('aux_reference_facts')
    .where('id', '=', historyReferenceId)
    .execute()
  await aux.delete(
    'warehouse',
    { id: warehouse.id, revision: enabled.revision },
    actor,
  )
  const accountInput = {
    name: '测试账户',
    currency: 'CNY',
    accountName: '户名',
    bank: '银行',
    branch: '',
    accountNumber: `AC${suffix}`,
    operatingEntityId: op.id,
    remark: '',
  }
  const account = await aux.create('fund-account', accountInput, actor)
  await assert.rejects(
    aux.create('fund-account', accountInput, actor),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'fund_account_duplicate_account_number',
  )
  await assert.rejects(
    aux.delete('operating-entity', { id: op.id, revision: op.revision }, actor),
    (error) =>
      error instanceof AuxApplicationError && error.errorKey === 'conflict',
  )
  const dtype = await aux.create('dictionary-type', { name: '车型' }, actor)
  const vtype = await aux.create(
    'dictionary-item',
    { name: '货车', dictionaryTypeId: dtype.id, sortOrder: 0 },
    actor,
  )
  const vehicleInput = {
    name: '测试车辆',
    plateNumber: `京-${suffix.slice(0, 6)}`,
    vehicleTypeId: vtype.id,
    carrier: { kind: 'INTERNAL' as const, operatingEntityId: op.id },
    vin: `vin-${suffix}`,
    engineNumber: 'Engine-Abc',
    ratedLoadKg: 1000,
    bulkWaterCarrier: false,
    remark: '',
  }
  const vehicle = await aux.create('vehicle', vehicleInput, actor)
  const vehicleRead = await aux.get('vehicle', { id: vehicle.id }, actor)
  assert.equal(vehicleRead.plateNumber, vehicleInput.plateNumber)
  assert.equal(vehicleRead.vin, vehicleInput.vin.toUpperCase())
  assert.equal(vehicleRead.engineNumber, vehicleInput.engineNumber)
  await assert.rejects(
    aux.create('vehicle', vehicleInput, actor),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'vehicle_duplicate_plate_number',
  )
  await assert.rejects(
    aux.disable(
      'operating-entity',
      { id: op.id, revision: op.revision },
      actor,
      'carrier-owner',
    ),
    (error) =>
      error instanceof AuxApplicationError && error.errorKey === 'conflict',
  )
  await aux.delete(
    'vehicle',
    { id: vehicle.id, revision: vehicle.revision },
    actor,
  )
  await aux.delete(
    'fund-account',
    { id: account.id, revision: account.revision },
    actor,
  )
})
