import { upgradeDepartmentAccess } from '../../src/app/department-upgrade.ts'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import test from 'node:test'
import { sql } from 'kysely'
import pg from 'pg'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'
import { createDatabase } from '../../src/db/database.ts'
import {
  loadConfig,
  assertTargetDatabaseBoundary,
} from '../../src/platform/config.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { ManagementService } from '../../src/app/management.ts'
import { SessionService, SessionError } from '../../src/app/session.ts'
import { DepartmentRoleService } from '../../src/app/department-roles.ts'
import { WorkbenchService } from '../../src/app/workbench.ts'
import { BobService } from '../../src/bob/service.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'
import { VouService } from '../../src/vou/service.ts'
import { AccService } from '../../src/acc/service.ts'
import { RptService, PgRptDefinitionValidator } from '../../src/rpt/service.ts'
import { departmentReports } from '../../src/rpt/department-reports.ts'
import { AttachmentStore } from '../../src/platform/attachment-store.ts'
import { createApp } from '../../src/app.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'

test('department roles enforce current customer ownership at real HTTP and report seams', async (context) => {
  const source = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(source)
  assertTargetDatabaseBoundary(source, 'isolated')
  const suffix = randomBytes(6).toString('hex')
  const databaseName = `customer_scope_${suffix}_test`
  const owner = createDatabase(source)
  const url = new URL(source)
  url.pathname = `/${databaseName}`
  const db = createDatabase(url.toString())
  const pool = new pg.Pool({ connectionString: url.toString() })
  const attachmentRoot = new URL(
    `../../../../.scratch/customer-scope-${suffix}/`,
    import.meta.url,
  ).pathname
  context.after(async () => {
    await pool.end()
    await db.destroy()
    await sql
      .raw(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
      .execute(owner)
    await owner.destroy()
    await rm(attachmentRoot, { recursive: true, force: true })
  })
  await sql.raw(`CREATE DATABASE "${databaseName}"`).execute(owner)
  await sql
    .raw(
      await readFile(
        new URL('../../db/target-schema.sql', import.meta.url),
        'utf8',
      ),
    )
    .execute(db)
  // Rehearse the deployed schema upgrade and reject unreviewed role baselines atomically.
  await sql`ALTER TABLE app_users DROP COLUMN employee_id`.execute(db)
  await sql`ALTER TABLE app_roles DROP COLUMN customer_scope`.execute(db)
  await sql`DROP TABLE app_seed_runs`.execute(db)
  await sql`ALTER TABLE vou_attachment_download_tokens DROP COLUMN owner_user_id`.execute(
    db,
  )
  const conflictRole = ulid()
  await sql`INSERT INTO app_roles (id, code, name, status) VALUES (${conflictRole}, 'unreviewed', 'unreviewed', 'ENABLED')`.execute(
    db,
  )
  await assert.rejects(upgradeDepartmentAccess(db), /administrator-only/)
  await sql`DELETE FROM app_roles WHERE id = ${conflictRole}`.execute(db)
  assert.equal(await upgradeDepartmentAccess(db), 'created')
  assert.equal(await upgradeDepartmentAccess(db), 'unchanged')
  const bootstrap = new TargetBootstrapService(db)
  await bootstrap.syncPermissionCatalog(await readTargetPermissionCatalog())
  const password = `Initial!Aa1${suffix}`
  await bootstrap.initializeAdministrators(
    ['scope-admin', 'scope-reviewer'].map((username) => ({
      username,
      displayName: username,
      password,
    })),
    12,
  )
  const config = loadConfig({
    DATABASE_URL: url.toString(),
    TARGET_DATABASE_SCOPE: 'isolated',
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const sessions = new SessionService(db, config)
  const adminSession = await sessions.signin('scope-admin', password)
  const admin = adminSession.principal
  const reviewer = (await sessions.signin('scope-reviewer', password)).principal
  const adminActor = { id: admin.user.id, permissions: admin.apiPaths }
  const reviewerActor = { id: reviewer.user.id, permissions: reviewer.apiPaths }
  const management = new ManagementService(db, { passwordMinLength: 12 })
  const rpt = new RptService(db, new PgRptDefinitionValidator(pool, db))
  await rpt.initializeDepartmentReports(adminActor)
  // A late role failure must roll back all earlier roles and the completion marker.
  await sql`ALTER TABLE app_roles ADD CONSTRAINT scope_seed_failure CHECK (name <> '人事主管')`.execute(
    db,
  )
  await assert.rejects(new DepartmentRoleService(db).initialize())
  assert.equal(
    (await db.selectFrom('app_roles').select('id').execute()).length,
    1,
  )
  assert.equal(
    await db
      .selectFrom('app_seed_runs')
      .select('key')
      .where('key', '=', 'department-roles-v1')
      .executeTakeFirst(),
    undefined,
  )
  await sql`ALTER TABLE app_roles DROP CONSTRAINT scope_seed_failure`.execute(
    db,
  )
  assert.deepEqual(
    (
      await Promise.all([
        new DepartmentRoleService(db).initialize(),
        new DepartmentRoleService(db).initialize(),
      ])
    ).sort(),
    ['created', 'unchanged'],
  )
  const roles = await db.selectFrom('app_roles').selectAll().execute()
  const roleId = (name: string) => roles.find((role) => role.name === name)!.id
  const first = await seedOrderListFixture(db, 1)
  const second = await seedOrderListFixture(db, 1)
  const firstCustomer = first.salePayload.customer.objectId
  const secondCustomer = second.salePayload.customer.objectId
  const bob = new BobService(db),
    dcl = new DclArchiveService(db)
  const vou = new VouService(
    db,
    {
      acc: {
        async apply() {},
        async partyBalance() {
          return 0n
        },
        async customerCreditOccupancy() {
          return 0n
        },
      },
      wfl: { async apply() {} },
    },
    { attachmentStore: new AttachmentStore(attachmentRoot) },
  )
  const workbench = new WorkbenchService(db)
  const app = createApp({
    config,
    session: sessions,
    management,
    bob,
    dclArchives: dcl,
    vou,
    rpt,
    workbench,
  })
  async function user(
    code: string,
    employeeId: string | null,
    names = ['业务员'],
  ) {
    const createdResponse = await app.request('/app/user/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zerp-model-build': modelBuildId,
        'x-csrf-token': admin.csrfToken,
        cookie: `${config.sessionCookieName}=${adminSession.token}`,
      },
      body: JSON.stringify({
        code,
        name: code,
        employeeId,
        password,
        roleIds: names.map(roleId),
      }),
    })
    const created = await createdResponse.json()
    assert.equal(created.code, 0, created.errorKey)
    const row = created.data as { id: string; employeeId: string | null }
    assert.equal(row.employeeId, employeeId)
    const initial = await sessions.signin(code, password)
    const nextPassword = `Changed!Aa2${suffix}`
    await sessions.changePassword(
      initial.principal,
      { currentPassword: password, newPassword: nextPassword },
      'scope-password',
    )
    const signed = await sessions.signin(code, nextPassword)
    const actor = { id: row.id, permissions: signed.principal.apiPaths }
    const headers = {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': signed.principal.csrfToken,
      cookie: `${config.sessionCookieName}=${signed.token}`,
    }
    const request = async (path: string, body?: unknown) => {
      const response = await app.request(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const result = await response.json()
      return result
    }
    return { row, signed, actor, request }
  }
  const one = await user('scope-one', first.salePayload.salesperson!.objectId)
  const two = await user('scope-two', second.salePayload.salesperson!.objectId)
  const unbound = await user('scope-unbound', null)
  const mixed = await user(
    'scope-mixed',
    first.salePayload.salesperson!.objectId,
    ['业务员', '客服'],
  )
  const candidateReport = await rpt.save(
    {
      subjectId: ulid(),
      expectedRevision: null,
      name: '客户候选验证',
      description: '',
      enabled: true,
      sql: 'SELECT :customer::text AS customer_id',
      parameters: [
        {
          key: 'customer',
          name: '客户',
          type: 'REFERENCE',
          referenceType: 'CUSTOMER',
          required: true,
        },
      ],
      columns: [
        {
          alias: 'customer_id',
          name: '客户',
          type: 'ID',
          order: 1,
          width: 160,
          visible: true,
        },
      ],
    },
    adminActor,
    'scope-reference',
  )
  const candidatePage = await rpt.referenceQuery(
    candidateReport.code,
    { parameterKey: 'customer', page: 1, pageSize: 20 },
    one.actor,
  )
  assert.deepEqual(
    candidatePage.items.map((item) => item.id),
    [firstCustomer],
  )
  const pageInput = { page: 1, pageSize: 20 }
  const oneCustomers = await one.request('/bob/customer/query', pageInput)
  assert.equal(oneCustomers.code, 0, oneCustomers.errorKey)
  assert.deepEqual(
    oneCustomers.data.items.map((item: { objectId: string }) => item.objectId),
    [firstCustomer],
  )
  assert.equal(
    (await two.request('/bob/customer/query', pageInput)).data.total,
    1,
  )
  assert.equal(
    (await unbound.request('/bob/customer/query', pageInput)).data.total,
    0,
  )
  assert.equal(
    (await mixed.request('/bob/customer/query', pageInput)).data.total,
    2,
  )
  assert.equal(
    (await one.request('/bob/customer/get', { objectId: secondCustomer }))
      .errorKey,
    'forbidden',
  )
  assert.equal(
    (await one.request('/bob/customer/versions', { subjectId: secondCustomer }))
      .errorKey,
    'forbidden',
  )
  assert.equal(
    (
      await one.request('/bob/customer/audit-history', {
        subjectId: secondCustomer,
      })
    ).errorKey,
    'forbidden',
  )
  const options = await one.request('/bob/customer/options?page=1&pageSize=20')
  assert.equal(options.code, 0, options.errorKey)
  assert.deepEqual(
    options.data.items.map((item: { objectId: string }) => item.objectId),
    [firstCustomer],
  )
  const foreignOption = await one.request(
    `/bob/customer/options?page=1&pageSize=20&ids=${secondCustomer}`,
  )
  assert.equal(foreignOption.data.total, 0)
  const orders = await one.request('/vou/sale-order/query', pageInput)
  assert.equal(orders.code, 0, orders.errorKey)
  assert.deepEqual(
    orders.data.items.map((item: { documentId: string }) => item.documentId),
    [first.sales[0]!.documentId],
  )
  assert.equal(
    (
      await one.request('/vou/sale-order/get', {
        documentId: second.sales[0]!.documentId,
      })
    ).errorKey,
    'forbidden',
  )
  assert.equal(
    (
      await one.request('/vou/sale-order/audit-history', {
        documentId: second.sales[0]!.documentId,
      })
    ).errorKey,
    'forbidden',
  )
  assert.equal(
    (
      await one.request(
        `/vou/sale-order/options?page=1&pageSize=20&ids=${second.sales[0]!.documentId}`,
      )
    ).data.total,
    0,
  )
  const forbiddenSubmitId = ulid()
  assert.equal(
    (
      await one.request('/vou/sale-order/submit-new', {
        documentId: ulid(),
        submissionId: forbiddenSubmitId,
        idempotencyKey: forbiddenSubmitId,
        expectedRevision: null,
        payload: second.salePayload,
      })
    ).errorKey,
    'forbidden',
  )
  // A legitimate own order and its attachment remain visible only within the current range.
  const content = Buffer.from('%PDF-1.7 customer scope fixture')
  const file = {
    stagingId: ulid(),
    fileId: ulid(),
    fileName: 'scope.pdf',
    mimeType: 'application/pdf' as const,
    size: content.length,
    digest: createHash('sha256').update(content).digest('hex'),
  }
  await vou.stageAttachment(
    'sale-order',
    { ...file, contentBase64: content.toString('base64') },
    one.actor,
  )
  const submissionId = ulid()
  const ownOrder = await vou.submit(
    'sale-order',
    'submit-new',
    {
      documentId: ulid(),
      submissionId,
      idempotencyKey: submissionId,
      expectedRevision: null,
      payload: {
        ...first.salePayload,
        attachments: [
          {
            id: file.fileId,
            stagingId: file.stagingId,
            fileName: file.fileName,
            contentType: file.mimeType,
            sizeBytes: file.size,
            sha256: file.digest,
          },
        ],
      },
    },
    one.actor,
    'scope-submit',
  )
  const token = await vou.issueAttachmentDownload(
    'sale-order',
    {
      documentId: ownOrder.documentId,
      submissionId: ownOrder.submissionId,
      fileId: file.fileId,
    },
    one.actor,
  )
  await assert.rejects(
    vou.issueAttachmentDownload(
      'sale-order',
      {
        documentId: ownOrder.documentId,
        submissionId: ownOrder.submissionId,
        fileId: file.fileId,
      },
      two.actor,
    ),
    SessionError,
  )
  const adminToken = await vou.issueAttachmentDownload(
    'sale-order',
    {
      documentId: ownOrder.documentId,
      submissionId: ownOrder.submissionId,
      fileId: file.fileId,
    },
    adminActor,
  )
  await db
    .updateTable('app_permissions')
    .set({ status: 'DISABLED' })
    .where('path', '=', '/vou/sale-order/attachment-read')
    .execute()
  await assert.rejects(vou.consumeAttachmentDownload(adminToken.token), {
    errorKey: 'vou_attachment_download_not_found',
  })
  await db
    .updateTable('app_permissions')
    .set({ status: 'ENABLED' })
    .where('path', '=', '/vou/sale-order/attachment-read')
    .execute()
  const pending = await one.request('/app/workbench/query', pageInput)
  assert.ok(
    pending.data.items.every(
      (item: { subjectOrDocumentId: string }) =>
        item.subjectOrDocumentId !== second.sales[0]!.documentId,
    ),
  )
  // Managers and customer-service supervisors independently approve orders, while submission owners cannot self-approve.
  const manager = await user('scope-manager', null, ['业务经理'])
  const supervisor = await user('scope-supervisor', null, ['客服主管'])
  await vou.review(
    'sale-order',
    'approve',
    {
      documentId: ownOrder.documentId,
      submissionId: ownOrder.submissionId,
      expectedRevision: ownOrder.revision,
    },
    manager.actor,
    'scope-approve',
  )
  await vou.review(
    'sale-order',
    'approve',
    {
      documentId: second.sales[0]!.documentId,
      submissionId: second.sales[0]!.submissionId,
      expectedRevision: second.sales[0]!.revision,
    },
    supervisor.actor,
    'scope-approve',
  )
  const reports = await db
    .selectFrom('rpt_definitions')
    .select(['id', 'code'])
    .execute()
  const salesCode = reports.find(
    (row) =>
      row.id ===
      departmentReports.find((report) => report.key === 'customer-sales')!
        .subjectId,
  )!.code
  const salesParameters = { dates: ['2026-09-01', '2026-09-30'] }
  const ownReport = await one.request(`/rpt/${salesCode}/query`, {
    parameters: salesParameters,
    page: 1,
    pageSize: 20,
  })
  assert.equal(ownReport.code, 0, ownReport.errorKey)
  assert.equal(ownReport.data.rows.length, 1)
  assert.equal(ownReport.data.rows[0].document_id, ownOrder.documentId)
  const exported = await one.request(`/rpt/${salesCode}/export`, {
    parameters: salesParameters,
  })
  assert.deepEqual(exported.data.rows, ownReport.data.rows)
  assert.equal(
    (
      await one.request(`/rpt/${salesCode}/query`, {
        parameters: {
          ...salesParameters,
          authorizedCustomerIds: [secondCustomer],
        },
        page: 1,
        pageSize: 20,
      })
    ).errorKey,
    'rpt_parameter_unknown',
  )
  // Seeded customer balance filters journal facts before grouping.
  const book = await new AccService(db).createBook(
    {
      id: ulid(),
      name: '范围核算',
      description: '',
      startMonth: '2026-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    },
    adminActor,
  )
  const subject = await new AccService(db).createSubject(
    {
      id: ulid(),
      bookId: book.id,
      code: '1131',
      name: '应收',
      enabled: true,
      parentId: null,
      balanceDirection: 'DEBIT',
      requiredDimensions: ['CUSTOMER'],
      inventoryQuantity: false,
      settlementPurpose: 'RECEIVABLE',
    },
    adminActor,
  )
  for (const [customerId, amount] of [
    [firstCustomer, '100.00'],
    [secondCustomer, '900.00'],
  ]) {
    const journalId = ulid()
    await db
      .insertInto('acc_journal_entries')
      .values({
        id: journalId,
        book_id: book.id,
        source_kind: 'COST_SETTLEMENT',
        business_date: '2026-09-10',
        currency: 'CNY',
        created_at: new Date(),
      })
      .execute()
    await db
      .insertInto('acc_journal_lines')
      .values({
        id: ulid(),
        journal_entry_id: journalId,
        subject_id: subject.id,
        direction: 'DEBIT',
        amount: amount!,
        dimensions: JSON.stringify({ CUSTOMER: customerId }),
      })
      .execute()
  }
  const balanceCode = reports.find(
    (row) =>
      row.id ===
      departmentReports.find((report) => report.key === 'customer-balance')!
        .subjectId,
  )!.code
  assert.equal(
    (
      await one.request(`/rpt/${balanceCode}/query`, {
        parameters: { bookId: book.id, asOfDate: '2026-09-30' },
        page: 1,
        pageSize: 20,
      })
    ).errorKey,
    'forbidden',
  )
  await db
    .insertInto('acc_book_access')
    .values({
      book_id: book.id,
      user_id: one.row.id,
      can_query: true,
      can_operate: false,
    })
    .execute()
  const balance = await one.request(`/rpt/${balanceCode}/query`, {
    parameters: { bookId: book.id, asOfDate: '2026-09-30' },
    page: 1,
    pageSize: 20,
  })
  assert.equal(balance.code, 0, balance.errorKey)
  assert.equal(balance.data.rows.length, 1)
  assert.equal(Number(balance.data.rows[0].receivable), 100)
  // Approved reassignment transfers all customer history, and invalidates already issued attachment access.
  const current = await dcl.get('customer', firstCustomer, adminActor)
  const changeId = ulid()
  const changed = await dcl.submit(
    'customer',
    'submit-change',
    {
      subjectId: firstCustomer,
      submissionId: changeId,
      idempotencyKey: changeId,
      expectedLatestApprovedSubmissionId: current.submissionId,
      expectedLatestApprovedRevision: current.revision,
      snapshot: {
        ...current.snapshot,
        primarySalesAttribution: {
          type: 'INTERNAL_EMPLOYEE',
          objectId: second.salePayload.salesperson!.objectId,
        },
      },
    },
    adminActor,
    'scope-transfer',
  )
  await dcl.review(
    'customer',
    'approve',
    {
      subjectId: firstCustomer,
      submissionId: changed.submissionId,
      expectedRevision: changed.revision,
    },
    reviewerActor,
    'scope-transfer',
  )
  assert.equal(
    (await one.request('/bob/customer/query', pageInput)).data.total,
    0,
  )
  assert.equal(
    (await two.request('/bob/customer/query', pageInput)).data.total,
    2,
  )
  assert.equal(
    (await one.request('/vou/sale-order/query', pageInput)).data.total,
    0,
  )
  assert.equal(
    (
      await two.request('/vou/sale-order/get', {
        documentId: ownOrder.documentId,
      })
    ).code,
    0,
  )
  await assert.rejects(vou.consumeAttachmentDownload(token.token), SessionError)
  assert.equal(
    (
      await one.request(`/rpt/${balanceCode}/query`, {
        parameters: { bookId: book.id, asOfDate: '2026-09-30' },
        page: 1,
        pageSize: 20,
      })
    ).data.rows.length,
    0,
  )
  // Grant management actions explicitly to isolate scope ceilings from action denial.
  const managementPermissions = await db
    .selectFrom('app_permissions')
    .select(['id', 'path'])
    .where('path', 'in', [
      '/app/user/get',
      '/app/user/save',
      '/app/role/create',
    ])
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values(
      managementPermissions.map((permission) => ({
        role_id: roleId('业务员'),
        permission_id: permission.id,
      })),
    )
    .execute()
  const self = await one.request('/app/user/get', { id: one.row.id })
  assert.equal(self.code, 0)
  assert.equal(
    (
      await one.request('/app/user/save', {
        id: one.row.id,
        name: self.data.name,
        revision: self.data.revision,
        employeeId: second.salePayload.salesperson!.objectId,
        roleIds: self.data.roles.map((role: { id: string }) => role.id),
      })
    ).errorKey,
    'forbidden',
  )
  assert.equal(
    (
      await one.request('/app/role/create', {
        name: '越界范围',
        description: null,
        permissionIds: [managementPermissions[0]!.id],
        customerScope: 'ALL',
      })
    ).errorKey,
    'forbidden',
  )
  assert.equal(
    (
      await one.request('/app/role/create', {
        name: '本人范围',
        description: null,
        permissionIds: [managementPermissions[0]!.id],
        customerScope: 'OWN',
      })
    ).code,
    0,
  )
  const serviceRole = await management.getRole(roleId('客服'), admin)
  await management.setRoleStatus(
    { id: serviceRole.id, revision: serviceRole.revision },
    'DISABLED',
    admin,
    'scope-disable',
  )
  assert.equal(
    (await mixed.request('/bob/customer/query', pageInput)).data.total,
    0,
  )
  const before = await db
    .selectFrom('app_roles')
    .selectAll()
    .orderBy('id')
    .execute()
  assert.equal(await new DepartmentRoleService(db).initialize(), 'unchanged')
  assert.deepEqual(
    await db.selectFrom('app_roles').selectAll().orderBy('id').execute(),
    before,
  )
})
