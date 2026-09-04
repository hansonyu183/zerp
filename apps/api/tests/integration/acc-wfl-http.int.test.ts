import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { serve } from '@hono/node-server'
import { modelBuildId, type VouPayload } from '@zerp/model'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'
import { ulid } from 'ulid'

import { createApp } from '../../src/app.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { AccService } from '../../src/acc/service.ts'
import { AuxService } from '../../src/aux/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { ArchiveService } from '../../src/dcl/archives.ts'
import { WarehouseService } from '../../src/dcl/warehouse.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { VouService } from '../../src/vou/service.ts'
import { WflService, type WflVouPort } from '../../src/wfl/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

type Actor = { id: string; permissions: string[] }
type Session = { cookie: string; csrfToken: string }

const sourceOrderLineId = '01J00000000000000000000005'
const wflScript = `root = node(key="root", name="销售订单", entity="sale-order")\noutbound = node(key="outbound", name="销售出库", entity="sale-outbound")\ndelivery = node(key="delivery", name="销售送货", entity="sale-delivery")\nworkflow(code="http-flow", name="HTTP 流程", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sourceOrderLineId}","baseQuantity":"1"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sourceOrderLineId}","baseQuantity":"1"}]}))])`

function permissionParts(path: string) {
  const match = path.match(/^\/([^/]+)\/([^/]+)\/([^/]+)$/)
  assert.ok(match, `invalid permission path ${path}`)
  return { domain: match[1]!, entity: match[2]!, action: match[3]! }
}

async function seedPermissions(db: ReturnType<typeof createDatabase>, paths: string[]) {
  const existing = await db.selectFrom('app_permissions').select(['id', 'path']).where('path', 'in', paths).execute()
  const existingPaths = new Set(existing.map((item) => item.path))
  const created = paths.filter((path) => !existingPaths.has(path)).map((path) => ({ id: ulid(), path, ...permissionParts(path) }))
  if (created.length > 0) await db.insertInto('app_permissions').values(created.map((item) => ({ ...item, description: item.path, status: 'ENABLED' as const, menu_group: null, menu_order: null }))).execute()
  return { ids: [...existing.map((item) => item.id), ...created.map((item) => item.id)], createdIds: created.map((item) => item.id) }
}

async function createPrincipal(db: ReturnType<typeof createDatabase>, prefix: string, permissionIds: string[]) {
  const id = ulid(), roleId = ulid(), password = `Target!${randomBytes(18).toString('base64url')}`
  const username = `${prefix}-${randomBytes(8).toString('hex')}`
  await db.insertInto('app_users').values({
    id, username, display_name: prefix, password_hash: await hashPassword(password),
    status: 'ENABLED', password_changed_at: new Date(), password_change_required: false,
  }).execute()
  await db.insertInto('app_roles').values({ id: roleId, code: `${prefix}-${id}`, name: prefix, status: 'ENABLED' }).execute()
  await db.insertInto('app_role_permissions').values(permissionIds.map((permissionId) => ({ role_id: roleId, permission_id: permissionId }))).execute()
  await db.insertInto('app_user_roles').values({ user_id: id, role_id: roleId }).execute()
  return { id, roleId, username, password }
}

async function signin(origin: string, username: string, password: string): Promise<Session> {
  const response = await fetch(`${origin}/app/user/signin`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-zerp-model-build': modelBuildId, connection: 'close' },
    body: JSON.stringify({ username, password }),
  })
  assert.equal(response.status, 200)
  const payload = await response.json() as { code: number; data: { csrfToken: string } }
  assert.equal(payload.code, 0)
  return { cookie: response.headers.getSetCookie()[0] ?? '', csrfToken: payload.data.csrfToken }
}

function post(origin: string, session: Session, path: string, body: unknown, csrf = true) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-zerp-model-build': modelBuildId, connection: 'close', cookie: session.cookie,
      ...(csrf ? { 'x-csrf-token': session.csrfToken } : {}),
    },
    body: JSON.stringify(body),
  }).then(async (response) => {
    assert.equal(response.status, 200)
    return response.json() as Promise<{ code: number; errorKey: string; data: any; requestId: string }>
  })
}

async function seedSaleOrderReferences(
  archives: ArchiveService,
  warehouse: WarehouseService,
  aux: AuxService,
  actorId: string,
  reviewerId: string,
) {
  const actor = {
    id: actorId,
    permissions: [
      '/aux/measurement-unit/create', '/aux/measurement-unit/get',
      '/aux/product-type/create', '/aux/product-type/get',
      '/aux/product-category/create', '/aux/product-category/get',
      '/aux/employee-category/create', '/aux/employee-category/get',
      '/aux/department/create', '/aux/department/get',
      '/aux/position/create', '/aux/position/get',
    ],
    trusted: true,
  }
  const auxiliary = async (entity: Parameters<AuxService['create']>[0], data: unknown) => {
    const created = await aux.create(entity, data, actor)
    const fact = await aux.get(entity, created.objectId, actor)
    return { id: fact.objectId, code: fact.code, name: String(fact.data.name), ...fact.data }
  }
  const [unit, productType, productCategory, employeeCategory, department, position] = await Promise.all([
    auxiliary('measurement-unit', { name: '件', symbol: '件', quantityScale: 0 }),
    auxiliary('product-type', { name: 'HTTP 产品类型', behaviorProfile: 'STANDARD_FINISHED', description: '' }),
    auxiliary('product-category', { name: 'HTTP 产品分类', parentId: null, description: '' }),
    auxiliary('employee-category', { name: 'HTTP 员工分类', description: '' }),
    auxiliary('department', { name: 'HTTP 部门', parentId: null, description: '' }),
    auxiliary('position', { name: 'HTTP 岗位', description: '' }),
  ])
  const submit = async (entity: Parameters<ArchiveService['submit']>[0], snapshot: Record<string, unknown>) => {
    const objectId = ulid(), approvalEntryId = ulid()
    const pending = await archives.submit(entity, 'submit-new', {
      subjectId: objectId, submissionId: approvalEntryId, idempotencyKey: approvalEntryId,
      expectedLatestApprovedSubmissionId: null, expectedLatestApprovedRevision: null, snapshot,
    }, actor, `wfl-http-${entity}-submit`)
    const approved = await archives.review(entity, 'approve', {
      subjectId: objectId, submissionId: approvalEntryId, expectedRevision: pending.revision,
    }, { ...actor, id: reviewerId }, `wfl-http-${entity}-approve`)
    return { objectId, approvalEntryId, code: approved.code!, name: String(snapshot.name ?? snapshot.displayName ?? snapshot.legalName) }
  }
  const operatingEntity = await submit('operating-entity', {
    legalName: 'HTTP 经营主体', legalIdentifier: '91310000MA1K123456', registeredAddress: '', contactName: '', contactPhone: '',
    invoiceTitle: '', invoiceAddress: '', invoicePhone: '', invoiceBank: '', invoiceAccount: '', remark: '', enabled: true,
  })
  const customerSubunitId = ulid()
  const customer = await submit('customer', {
    identityKind: 'OTHER', legalName: 'HTTP 客户', displayName: 'HTTP 客户', legalIdentifier: 'HTTP-CUS', phone: '', email: '', address: '',
    invoiceTitle: '', invoiceAddress: '', invoicePhone: '', invoiceBank: '', invoiceAccount: '', remittanceProfiles: [], defaultOperatingEntity: null,
    identityAttachments: [], subunits: [{ id: customerSubunitId, intent: 'NEW', code: null, name: 'HTTP 客户子单位', contactName: '', address: '', customerType: '', settlementMethod: null, receiptMethod: '', transportMethod: '', pricePolicy: '', creditLimits: [], salesAttribution: null, internalReminder: '', defaultOrderRemark: '', attachments: [], enabled: true }], enabled: true,
  })
  const employee = await submit('employee', {
    identityKind: 'PERSON', legalName: 'HTTP 销售员', displayName: 'HTTP 销售员', legalIdentifier: 'HTTP-EMP', contactName: '', phone: '', address: '',
    employeeCategory, department, position, employmentDate: '2026-09-04', workPhone: '', workEmail: '',
    operatingEntity: { objectId: operatingEntity.objectId, approvalEntryId: operatingEntity.approvalEntryId, code: operatingEntity.code, name: operatingEntity.name }, remark: '', enabled: true,
  })
  const product = await submit('product', {
    name: 'HTTP 产品', barcode: '', specification: '', model: '', productType, productCategory, pricingUnit: unit, defaultInputUnit: unit,
    defaultPackageSpec: '', recyclable: false, remark: '', enabled: true,
  })
  const warehouseSubjectId = ulid(), warehouseEntryId = ulid()
  const warehousePending = await warehouse.submit('submit-new', {
    subjectId: warehouseSubjectId, submissionId: warehouseEntryId, idempotencyKey: warehouseEntryId,
    expectedLatestApprovedSubmissionId: null, expectedLatestApprovedRevision: null,
    snapshot: { name: 'HTTP 仓库', address: '', contactName: '', contactPhone: '', managerEmployeeId: null, managerEmployeeApprovalEntryId: null, managerEmployeeCode: null, managerEmployeeName: null, remark: '', enabled: true },
  }, actor, 'wfl-http-warehouse-submit')
  const warehouseApproved = await warehouse.review('approve', {
    subjectId: warehouseSubjectId, submissionId: warehouseEntryId, expectedRevision: warehousePending.revision,
  }, { ...actor, id: reviewerId }, 'wfl-http-warehouse-approve')
  const facts = [
    { entity: 'customer-subunit', field: 'customer-subunit', objectId: customerSubunitId, approvalEntryId: customer.approvalEntryId },
    { entity: 'employee', field: 'salesperson', objectId: employee.objectId, approvalEntryId: employee.approvalEntryId },
    { entity: 'warehouse', field: 'warehouse', objectId: warehouseSubjectId, approvalEntryId: warehouseEntryId },
    { entity: 'product', field: 'product', objectId: product.objectId, approvalEntryId: product.approvalEntryId },
  ] as const
  return {
    facts,
    unitId: unit.id,
    auxiliaryIds: [unit.id, productType.id, productCategory.id, employeeCategory.id, department.id, position.id],
    archiveSubjectIds: [operatingEntity.objectId, customer.objectId, employee.objectId, product.objectId],
    archiveApprovalEntryIds: [operatingEntity.approvalEntryId, customer.approvalEntryId, employee.approvalEntryId, product.approvalEntryId],
    warehouseSubjectId,
    warehouseEntryId,
    warehouseCode: warehouseApproved.code,
  }
}

function saleOrderPayload(references: Awaited<ReturnType<typeof seedSaleOrderReferences>>): VouPayload {
  const reference = (field: 'customer-subunit' | 'salesperson' | 'warehouse' | 'product') => {
    const fact = references.facts.find((item) => item.field === field)!
    return { objectId: fact.objectId, approvalEntryId: fact.approvalEntryId, selectionOrigin: 'CURRENT' as const }
  }
  const product = references.facts.find((item) => item.field === 'product')!
  return {
    businessDate: '2026-09-04', currency: 'CNY', attachments: [],
    customerSubunit: reference('customer-subunit'), salesperson: reference('salesperson'), warehouse: reference('warehouse'),
    productLines: [{
      lineId: sourceOrderLineId,
      product: { objectId: product.objectId }, enteredQuantity: '1',
      enteredUnit: { objectId: references.unitId }, baseQuantity: '1', unitPrice: '1.00',
    }],
  } as unknown as VouPayload
}

test('ACC HTTP routes enforce session, CSRF, permissions, envelope, opening and period facts', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const config = loadConfig({ DATABASE_URL: databaseUrl })
  const acc = new AccService(db)
  const app = createApp({ database: { ping: async () => undefined }, session: new SessionService(db, config), config, acc })
  let listening: (() => void) | undefined
  const started = new Promise<void>((resolve) => { listening = resolve })
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => listening?.())
  await started
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const paths = [
    '/acc/book/create', '/acc/book/query', '/acc/subject/create', '/acc/opening/submit-new', '/acc/opening/approve',
    '/acc/period/lock', '/acc/period/query', '/acc/period/unlock',
  ]
  const users: Array<{ id: string; roleId: string }> = []
  const books: string[] = []
  const permissionFixture = await seedPermissions(db, paths)
  context.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    try {
      if (books.length > 0) {
        const journalIds = (await db.selectFrom('acc_journal_entries').select('id').where('book_id', 'in', books).execute()).map((row) => row.id)
        if (journalIds.length > 0) await db.deleteFrom('acc_journal_lines').where('journal_entry_id', 'in', journalIds).execute()
        await db.deleteFrom('acc_journal_entries').where('book_id', 'in', books).execute()
        await db.deleteFrom('acc_period_balances').where('book_id', 'in', books).execute()
        await db.deleteFrom('acc_periods').where('book_id', 'in', books).execute()
      }
      await db.deleteFrom('approval_events').where('domain', '=', 'acc').execute()
      await db.deleteFrom('approval_entries').where('domain', '=', 'acc').execute()
      if (books.length > 0) {
        await db.deleteFrom('acc_subjects').where('book_id', 'in', books).execute()
        await db.deleteFrom('acc_books').where('id', 'in', books).execute()
      }
      if (users.length > 0) {
        await db.deleteFrom('app_sessions').where('user_id', 'in', users.map((user) => user.id)).execute()
        await db.deleteFrom('app_user_roles').where('user_id', 'in', users.map((user) => user.id)).execute()
        await db.deleteFrom('app_role_permissions').where('role_id', 'in', users.map((user) => user.roleId)).execute()
        await db.deleteFrom('app_roles').where('id', 'in', users.map((user) => user.roleId)).execute()
        await db.deleteFrom('app_users').where('id', 'in', users.map((user) => user.id)).execute()
      }
      if (permissionFixture.createdIds.length > 0)
        await db.deleteFrom('app_permissions').where('id', 'in', permissionFixture.createdIds).execute()
    } finally { await db.destroy() }
  })
  const submitter = await createPrincipal(db, 'acc-submit', permissionFixture.ids)
  const reviewer = await createPrincipal(db, 'acc-review', permissionFixture.ids)
  users.push(submitter, reviewer)
  const submitterSession = await signin(origin, submitter.username, submitter.password)
  const reviewerSession = await signin(origin, reviewer.username, reviewer.password)
  const bookId = ulid()
  books.push(bookId)
  const csrfFailure = await post(origin, submitterSession, '/acc/book/create', { id: bookId, name: 'HTTP 账簿', description: '', startMonth: '2026-08', baseCurrency: 'CNY' }, false)
  assert.equal(csrfFailure.errorKey, 'forbidden')
  const created = await post(origin, submitterSession, '/acc/book/create', { id: bookId, name: 'HTTP 账簿', description: '', startMonth: '2026-08', baseCurrency: 'CNY' })
  assert.equal(created.code, 0)
  assert.ok(created.requestId)
  assert.equal((await post(origin, submitterSession, '/acc/book/query', {})).data[0].id, bookId)
  const malformedOpening = await post(origin, submitterSession, '/acc/opening/submit-new', {
    bookId, submissionId: ulid(), idempotencyKey: ulid(), lines: [], assets: [{}], bills: [], containers: [],
  })
  assert.equal(malformedOpening.errorKey, 'validation_failed')
  const submissionId = ulid()
  const pending = await post(origin, submitterSession, '/acc/opening/submit-new', { bookId, submissionId, idempotencyKey: submissionId, lines: [], assets: [], bills: [], containers: [] })
  assert.equal(pending.data.approval.status, 'PENDING')
  const reviewWithoutScope = await post(origin, reviewerSession, '/acc/opening/approve', { bookId, submissionId, expectedRevision: pending.data.approval.revision })
  assert.equal(reviewWithoutScope.errorKey, 'acc_book_access_denied')
  await acc.grantBookAccess(bookId, reviewer.id, {
    id: submitter.id,
    permissions: ['/acc/book/save'],
  })
  const approved = await post(origin, reviewerSession, '/acc/opening/approve', { bookId, submissionId, expectedRevision: pending.data.approval.revision })
  assert.equal(approved.data.approval.status, 'APPROVED')
  const locked = await post(origin, reviewerSession, '/acc/period/lock', { bookId, month: '2026-08', expectedRevision: null })
  assert.equal(locked.code, 0)
  assert.equal(locked.data.locked, true)
  const periods = await post(origin, reviewerSession, '/acc/period/query', { bookId })
  assert.equal(periods.data[0].month, '2026-08')
  const unlocked = await post(origin, reviewerSession, '/acc/period/unlock', { bookId, month: '2026-08', expectedRevision: locked.data.revision })
  assert.equal(unlocked.data.locked, false)
})

test('WFL definition, current, trial, instance and six actions cross the authenticated HTTP seam', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const config = loadConfig({ DATABASE_URL: databaseUrl })
  const runtime = await createNodeWflStarlark()
  const acc = new AccService(db)
  const aux = new AuxService(db)
  const archives = new ArchiveService(db, { async validate() {} })
  const warehouse = new WarehouseService(db)
  let vou!: VouService
  const port: WflVouPort = {
    createChild: (...args) => vou.createChild(...args), approveChild: (...args) => vou.approveChild(...args),
    rejectChild: (...args) => vou.rejectChild(...args), retryChild: (...args) => vou.retryChild(...args), cancelChild: (...args) => vou.cancelChild(...args),
  }
  const wfl = new WflService(db, runtime, port)
  vou = new VouService(db, { acc, wfl })
  const errors: unknown[] = []
  const app = createApp({ database: { ping: async () => undefined }, session: new SessionService(db, config), config, vou, acc, wfl, archives, aux, warehouse, logger: { info() {}, error(entry) { errors.push(entry) } } })
  let listening: (() => void) | undefined
  const started = new Promise<void>((resolve) => { listening = resolve })
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => listening?.())
  await started
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const wflPaths = [
    '/dcl/wfl-process-definition/submit-new', '/dcl/wfl-process-definition/query', '/dcl/wfl-process-definition/get',
    '/dcl/wfl-process-definition/approve', '/dcl/wfl-process-definition/reject', '/dcl/wfl-process-definition/unreject',
    '/dcl/wfl-process-definition/unapprove', '/dcl/wfl-process-definition/enable', '/wfl/process-definition/trial',
    '/wfl/process-definition/query', '/wfl/process-definition/get', '/wfl/process-instance/query',
    '/wfl/process-instance/get', '/wfl/process-instance/audit-history', '/wfl/process-instance/open-document',
    '/wfl/process-instance/create-child', '/wfl/process-instance/approve-child', '/wfl/process-instance/reject-child',
    '/wfl/process-instance/retry-child', '/wfl/process-instance/cancel-child',
  ]
  const permissionFixture = await seedPermissions(db, wflPaths)
  const users: Array<{ id: string; roleId: string }> = []
  let refs: Awaited<ReturnType<typeof seedSaleOrderReferences>> | undefined
  let subjectId: string | undefined
  let documentIds: string[] = []
  context.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    try {
      if (subjectId) {
        const instances = await db.selectFrom('wfl_instances').select('id').where('definition_subject_id', '=', subjectId).execute()
        if (instances.length > 0)
          await db.deleteFrom('wfl_instances').where('id', 'in', instances.map((item) => item.id)).execute()
        await db.deleteFrom('approval_events').where('subject_id', '=', subjectId).execute()
        await db.deleteFrom('approval_entries').where('subject_id', '=', subjectId).execute()
        await db.deleteFrom('dcl_subjects').where('id', '=', subjectId).execute()
      }
      if (documentIds.length > 0) {
        await db.deleteFrom('vou_idempotency').where('document_id', 'in', documentIds).execute()
        await db.deleteFrom('approval_events').where('subject_id', 'in', documentIds).execute()
        await db.deleteFrom('approval_entries').where('subject_id', 'in', documentIds).execute()
        await db.deleteFrom('vou_documents').where('id', 'in', documentIds).execute()
      }
      if (refs) {
        await db.deleteFrom('dcl_archive_idempotency').where('subject_id', 'in', refs.archiveSubjectIds).execute()
        await db.deleteFrom('dcl_warehouse_idempotency').where('subject_id', '=', refs.warehouseSubjectId).execute()
        await db.deleteFrom('approval_events').where('entry_id', 'in', [...refs.archiveApprovalEntryIds, refs.warehouseEntryId]).execute()
        await db.deleteFrom('approval_entries').where('id', 'in', [...refs.archiveApprovalEntryIds, refs.warehouseEntryId]).execute()
        await db.deleteFrom('dcl_subjects').where('id', 'in', refs.archiveSubjectIds).execute()
        await db.deleteFrom('dcl_subjects').where('id', 'in', [...refs.archiveSubjectIds, refs.warehouseSubjectId]).execute()
        await db.deleteFrom('aux_objects').where('id', 'in', refs.auxiliaryIds).execute()
      }
      if (users.length > 0) {
        await db.deleteFrom('app_sessions').where('user_id', 'in', users.map((user) => user.id)).execute()
        await db.deleteFrom('app_user_roles').where('user_id', 'in', users.map((user) => user.id)).execute()
        await db.deleteFrom('app_role_permissions').where('role_id', 'in', users.map((user) => user.roleId)).execute()
        await db.deleteFrom('app_roles').where('id', 'in', users.map((user) => user.roleId)).execute()
        await db.deleteFrom('app_users').where('id', 'in', users.map((user) => user.id)).execute()
      }
      if (permissionFixture.createdIds.length > 0)
        await db.deleteFrom('app_permissions').where('id', 'in', permissionFixture.createdIds).execute()
    } finally { await db.destroy() }
  })
  const allPermissionIds = (await db.selectFrom('app_permissions').select('id').execute()).map((item) => item.id)
  const allPermissions = (await db.selectFrom('app_permissions').select('path').execute()).map((item) => item.path)
  const submitter = await createPrincipal(db, 'wfl-submit', allPermissionIds)
  const reviewer = await createPrincipal(db, 'wfl-review', allPermissionIds)
  users.push(submitter, reviewer)
  const submitterSession = await signin(origin, submitter.username, submitter.password)
  const reviewerSession = await signin(origin, reviewer.username, reviewer.password)
  const submitterActor: Actor = { id: submitter.id, permissions: allPermissions }
  const reviewerActor: Actor = { id: reviewer.id, permissions: allPermissions }
  refs = await seedSaleOrderReferences(archives, warehouse, aux, submitter.id, reviewer.id)
  const rootDocumentId = ulid(), rootSubmissionId = ulid()
  documentIds = [rootDocumentId]
  await vou.submit('sale-order', 'submit-new', { documentId: rootDocumentId, submissionId: rootSubmissionId, idempotencyKey: rootSubmissionId, expectedRevision: null, payload: saleOrderPayload(refs) }, submitterActor, 'wfl-http-root-submit')
  subjectId = ulid()
  const definitionEntryId = ulid()
  const beforeTrial = await db.selectFrom('vou_documents').select((builder) => builder.fn.countAll<string>().as('count')).executeTakeFirstOrThrow()
  const pending = await post(origin, submitterSession, '/dcl/wfl-process-definition/submit-new', { subjectId, submissionId: definitionEntryId, idempotencyKey: definitionEntryId, expectedLatestApprovedSubmissionId: null, expectedLatestApprovedRevision: null, script: wflScript, trialDocument: { entity: 'sale-order', documentId: rootDocumentId } })
  assert.equal(pending.data.status, 'PENDING')
  assert.equal((await post(origin, submitterSession, '/dcl/wfl-process-definition/query', {})).data[0].openCandidate.submissionId, definitionEntryId)
  const trial = await post(origin, submitterSession, '/wfl/process-definition/trial', { approvalEntryId: definitionEntryId, document: { entity: 'sale-order', documentId: rootDocumentId } })
  assert.equal(trial.data.graph.code, 'http-flow')
  const afterTrial = await db.selectFrom('vou_documents').select((builder) => builder.fn.countAll<string>().as('count')).executeTakeFirstOrThrow()
  assert.equal(afterTrial.count, beforeTrial.count)
  const rejected = await post(origin, reviewerSession, '/dcl/wfl-process-definition/reject', { subjectId, submissionId: definitionEntryId, expectedRevision: pending.data.revision, reason: 'HTTP 审核驳回' })
  assert.equal(rejected.data.status, 'REJECTED')
  const reopened = await post(origin, reviewerSession, '/dcl/wfl-process-definition/unreject', { subjectId, submissionId: definitionEntryId, expectedRevision: rejected.data.revision })
  assert.equal(reopened.data.status, 'PENDING')
  const approved = await post(origin, reviewerSession, '/dcl/wfl-process-definition/approve', { subjectId, submissionId: definitionEntryId, expectedRevision: reopened.data.revision })
  assert.equal(approved.data.status, 'APPROVED')
  const enabled = await post(origin, reviewerSession, '/dcl/wfl-process-definition/enable', { subjectId, approvalEntryId: definitionEntryId, expectedApprovalRevision: approved.data.revision, expectedRuntimeRevision: null })
  assert.equal(enabled.data.enabled, true)
  assert.equal((await post(origin, reviewerSession, '/wfl/process-definition/query', { page: 1, pageSize: 20 })).data.items[0].approvalEntryId, definitionEntryId)
  assert.equal((await post(origin, reviewerSession, '/wfl/process-definition/get', { code: 'http-flow' })).data.approvalEntryId, definitionEntryId)
  await vou.review('sale-order', 'approve', { documentId: rootDocumentId, submissionId: rootSubmissionId, expectedRevision: '1' }, reviewerActor, 'wfl-http-root-approve')
  const blockedUnapprove = await post(origin, reviewerSession, '/dcl/wfl-process-definition/unapprove', { subjectId, submissionId: definitionEntryId, expectedRevision: approved.data.revision, reason: 'HTTP 实例 blocker' })
  assert.equal(blockedUnapprove.errorKey, 'wfl_definition_in_use')
  let instance = (await post(origin, submitterSession, '/wfl/process-instance/query', { page: 1, pageSize: 20, code: 'http-flow' })).data.items[0]
  assert.equal(instance.approvalEntryId, definitionEntryId)
  const root = instance.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'root')
  assert.ok(root)
  await post(origin, reviewerSession, '/wfl/process-instance/action', { processId: instance.processId, nodeId: root.nodeId, action: 'OPEN_DOCUMENT' })
  const createdOutbound = await post(origin, submitterSession, '/wfl/process-instance/action', { processId: instance.processId, nodeId: root.nodeId, action: 'CREATE_CHILD', targetNodeKey: 'outbound', requestKey: 'http-wfl-request-0001' })
  assert.equal(createdOutbound.errorKey, '', JSON.stringify(errors))
  instance = createdOutbound.data
  const outbound = instance.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'outbound')
  assert.ok(outbound)
  documentIds.push(outbound.documentId)
  instance = (await post(origin, reviewerSession, '/wfl/process-instance/action', { processId: instance.processId, nodeId: outbound.nodeId, action: 'APPROVE_CHILD', expectedRevision: outbound.revision })).data
  const approvedOutbound = instance.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'outbound')
  instance = (await post(origin, submitterSession, '/wfl/process-instance/action', { processId: instance.processId, nodeId: approvedOutbound.nodeId, action: 'CREATE_CHILD', targetNodeKey: 'delivery', requestKey: 'http-wfl-request-0002' })).data
  let delivery = instance.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'delivery')
  assert.ok(delivery)
  documentIds.push(delivery.documentId)
  instance = (await post(origin, reviewerSession, '/wfl/process-instance/action', { processId: instance.processId, nodeId: delivery.nodeId, action: 'REJECT_CHILD', expectedRevision: delivery.revision, reason: 'HTTP 驳回' })).data
  delivery = instance.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'delivery')
  instance = (await post(origin, reviewerSession, '/wfl/process-instance/action', { processId: instance.processId, nodeId: delivery.nodeId, action: 'RETRY_CHILD', expectedRevision: delivery.revision })).data
  delivery = instance.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'delivery')
  instance = (await post(origin, reviewerSession, '/wfl/process-instance/action', { processId: instance.processId, nodeId: delivery.nodeId, action: 'REJECT_CHILD', expectedRevision: delivery.revision, reason: 'HTTP 取消前驳回' })).data
  delivery = instance.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'delivery')
  const cancelled = await post(origin, submitterSession, '/wfl/process-instance/action', { processId: instance.processId, nodeId: delivery.nodeId, action: 'CANCEL_CHILD', expectedRevision: delivery.revision })
  assert.equal(cancelled.errorKey, '', JSON.stringify(errors))
  const audit = await post(origin, submitterSession, '/wfl/process-instance/audit-history', { processId: instance.processId })
  assert.deepEqual(audit.data.map((item: { action: string }) => item.action).filter((action: string) => ['OPEN_DOCUMENT', 'CREATE_CHILD', 'APPROVE_CHILD', 'REJECT_CHILD', 'RETRY_CHILD', 'CANCEL_CHILD'].includes(action)), ['OPEN_DOCUMENT', 'CREATE_CHILD', 'APPROVE_CHILD', 'CREATE_CHILD', 'REJECT_CHILD', 'RETRY_CHILD', 'REJECT_CHILD', 'CANCEL_CHILD'])
})
