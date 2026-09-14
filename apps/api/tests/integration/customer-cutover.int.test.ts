import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { sql } from 'kysely'
import pg from 'pg'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'
import { createDatabase } from '../../src/db/database.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { createApp } from '../../src/app.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { BobService } from '../../src/bob/service.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'
import { auxCurrentDataSchemas } from '../../src/app/aux-contract.ts'
import {
  AuxService,
  type AuxEntity,
  type AuxWriteData,
  type AuxObjectView,
} from '../../src/aux/service.ts'
import { VouService } from '../../src/vou/service.ts'
import { AccService } from '../../src/acc/service.ts'
import { RptService, PgRptDefinitionValidator } from '../../src/rpt/service.ts'
import {
  CustomerCutoverError,
  inspectCustomerCutover,
  migrateCustomers,
} from '../../src/dcl/customer-cutover/service.ts'

test('customer cutover projects all historical versions, shares tax, splits receipt balances once, and atomically restores a failed conversion', async (context) => {
  assert.ok(process.env.TARGET_TEST_DATABASE_URL)
  const admin = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  const name = `customer_439_${ulid().toLowerCase()}_test`
  await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin)
  const url = new URL(process.env.TARGET_TEST_DATABASE_URL)
  url.pathname = `/${name}`
  const db = createDatabase(url.toString())
  const pool = new pg.Pool({ connectionString: url.toString() })
  const rpt = new RptService(db, new PgRptDefinitionValidator(pool, db))
  context.after(async () => {
    await pool.end()
    await db.destroy()
    await sql`DROP DATABASE ${sql.id(name)}`.execute(admin)
    await admin.destroy()
  })
  await sql
    .raw(
      await readFile(
        new URL('../fixtures/issue-439-before.sql', import.meta.url),
        'utf8',
      ),
    )
    .execute(db)
  const catalog = await readTargetPermissionCatalog()
  const bootstrap = new TargetBootstrapService(db)
  const oldPermission = {
    id: ulid(),
    method: 'post' as const,
    path: '/dcl/customer/save-subunits',
    domain: 'dcl',
    entity: 'customer',
    action: 'save-subunits',
    title: '旧子单位维护',
  }
  await bootstrap.syncPermissionCatalog([...catalog, oldPermission])
  const password = randomBytes(24).toString('hex')
  const user = {
    userId: ulid(),
    roleId: ulid(),
    username: `migration-${ulid()}`,
    passwordHash: await hashPassword(password),
  }
  await bootstrap.createE2EPrincipal(user, true)
  const reviewerPassword = randomBytes(24).toString('hex')
  const reviewer = {
    userId: ulid(),
    roleId: ulid(),
    username: `reviewer-${ulid()}`,
    passwordHash: await hashPassword(reviewerPassword),
  }
  await bootstrap.createE2EPrincipal(reviewer, true)
  const onlyChild = {
    userId: ulid(),
    roleId: ulid(),
    username: `child-${ulid()}`,
    passwordHash: await hashPassword(randomBytes(24).toString('hex')),
  }
  await bootstrap.createE2EPrincipal(onlyChild, false, [oldPermission.path])
  const actor = {
    id: user.userId,
    permissions: catalog.map((row) => row.path),
    trusted: true,
  }
  const aux = new AuxService(db)
  const auxiliary = async <E extends AuxEntity>(
    entity: E,
    data: AuxWriteData<E>,
  ): Promise<AuxObjectView<E>> => {
    const created = await aux.create(entity, data, actor)
    return aux.get(entity, { id: created.id }, actor)
  }
  const operating = await auxiliary('operating-entity', {
    legalName: '我方正式名称',
    shortName: '我方',
    legalIdentifier: `F${user.userId.slice(-17)}`,
    registeredAddress: '',
    contactName: '',
    contactPhone: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBank: '',
    invoiceAccount: '',
    remark: '',
  })
  const category = await auxiliary('employee-category', {
    name: '员工类别',
    description: '',
  })
  const department = await auxiliary('department', {
    name: '业务部',
    parentId: '',
    description: '',
  })
  const position = await auxiliary('position', {
    name: '业务员',
    description: '',
  })
  const handler = await auxiliary('employee', {
    identityKind: 'PERSON',
    legalName: '经办人',
    displayName: '经办人',
    legalIdentifier: 'EMP-439',
    contactName: '',
    phone: '',
    address: '',
    employeeCategoryId: category.id,
    departmentId: department.id,
    positionId: position.id,
    employmentDate: '2026-01-01',
    workPhone: '',
    workEmail: '',
    operatingEntityId: operating.id,
    remark: '',
  })
  const fundObject = await auxiliary('fund-account', {
    name: '银行账户',
    currency: 'CNY',
    accountName: '我方',
    bank: '测试银行',
    branch: '',
    accountNumber: '0000439',
    operatingEntityId: operating.id,
    remark: '',
  })
  const root = ulid(),
    multi = ulid(),
    supplier = ulid(),
    singleChild = ulid(),
    first = ulid(),
    removed = ulid()
  const singleV1 = ulid(),
    singleV2 = ulid(),
    multiV1 = ulid(),
    multiV2 = ulid(),
    multiOpen = ulid(),
    supplierV1 = ulid()
  for (const [id, entity, code] of [
    [root, 'customer', 'CUS-0041'],
    [multi, 'customer', 'CUS-0042'],
    [supplier, 'supplier', 'SUP-0041'],
  ]) {
    await sql`INSERT INTO dcl_subjects(id,entity,code,created_at,created_by) VALUES (${id},${entity},${code},'2026-01-01',${user.userId})`.execute(
      db,
    )
    await sql`INSERT INTO bob_objects(id,enabled,revision) VALUES (${id},true,7)`.execute(
      db,
    )
  }
  for (const [id, subject, entity, version, status] of [
    [singleV1, root, 'customer', 1, 'APPROVED'],
    [singleV2, root, 'customer', 2, 'PENDING'],
    [multiV1, multi, 'customer', 1, 'APPROVED'],
    [multiV2, multi, 'customer', 2, 'APPROVED'],
    [multiOpen, multi, 'customer', 3, 'PENDING'],
    [supplierV1, supplier, 'supplier', 1, 'APPROVED'],
  ] as const) {
    await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,approved_by,approved_at,updated_by,updated_at) VALUES (${id},'dcl',${entity},${subject},${version},${status},3,${user.userId},'2026-01-01',${status === 'APPROVED' ? reviewer.userId : null},${status === 'APPROVED' ? '2026-01-02' : null},${user.userId},'2026-01-02')`.execute(
      db,
    )
    await sql`INSERT INTO approval_events(id,entry_id,domain,entity,subject_id,version_no,action,actor_id,request_id,created_at) VALUES (${ulid()},${id},'dcl',${entity},${subject},${version},'SUBMITTED',${user.userId},'source-audit','2026-01-01')`.execute(
      db,
    )
  }
  for (const [id, customer, code] of [
    [singleChild, root, 'SUB-0001'],
    [first, multi, 'SUB-0001'],
    [removed, multi, 'SUB-0002'],
  ])
    await sql`INSERT INTO dcl_customer_subunit_roots(subunit_id,customer_id,code) VALUES (${id},${customer},${code})`.execute(
      db,
    )
  const fileId = ulid()
  const attachment = {
    id: fileId,
    fileName: 'source.pdf',
    contentType: 'application/pdf',
    sizeBytes: 20,
    sha256: 'a'.repeat(64),
  }
  for (const [id, title] of [
    [singleV1, '单层前客户'],
    [singleV2, '待批客户名称'],
    [multiV1, '历史多单位'],
    [multiV2, '历史多单位'],
    [multiOpen, '待批多单位'],
  ])
    await sql`INSERT INTO dcl_customer_versions(approval_entry_id,kind,display_name,legal_name,legal_identifier,tax_attachments) VALUES (${id},'ORGANIZATION',${title},'共享税务正式名称',' hk shared 01 ',${JSON.stringify([attachment])}::jsonb)`.execute(
      db,
    )
  await sql`INSERT INTO dcl_supplier_versions(approval_entry_id,kind,display_name,legal_name,legal_identifier) VALUES (${supplierV1},'ORGANIZATION','共享供应商','共享税务正式名称','HKSHARED01')`.execute(
    db,
  )
  for (const [entry, child, name] of [
    [singleV1, singleChild, '总部'],
    [singleV2, singleChild, '总部'],
    [multiV1, first, '甲部'],
    [multiV1, removed, '乙部'],
    [multiV2, first, '甲部'],
    [multiOpen, first, '甲部'],
  ])
    await sql`INSERT INTO dcl_customer_version_subunits(customer_approval_entry_id,subunit_id,name,customer_type_id,customer_type_snapshot,credit_limits,enabled) VALUES (${entry},${child},${name},${ulid()},'{}','[{"currency":"CNY","amount":"999999999999.99"}]',true)`.execute(
      db,
    )
  for (const entry of [singleV1, singleV2, multiV1, multiV2, multiOpen])
    await sql`INSERT INTO dcl_customer_attachments(approval_entry_id,file_id,file_name,mime_type,size_bytes,digest,storage_key,created_at) VALUES (${entry},${fileId},'source.pdf','application/pdf',20,${'a'.repeat(64)},'fixture-source-attachment','2026-01-01')`.execute(
      db,
    )
  const receiptId = ulid(),
    receiptEntry = ulid(),
    book = ulid(),
    bank = ulid(),
    receivable = ulid(),
    journal = ulid(),
    fund = fundObject.id
  await sql`INSERT INTO vou_documents(id,entity,document_no,created_at,created_by) VALUES (${receiptId},'sales-receipt','SRC-20260103-0001','2026-01-03',${user.userId})`.execute(
    db,
  )
  await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,status,revision,submitted_by,submitted_at,approved_by,approved_at,updated_by,updated_at) VALUES (${receiptEntry},'vou','sales-receipt',${receiptId},'APPROVED',2,${user.userId},'2026-01-03',${reviewer.userId},'2026-01-04',${user.userId},'2026-01-04')`.execute(
    db,
  )
  await sql`INSERT INTO vou_sales_receipt_details(approval_entry_id,document_id,business_date,currency,total_amount_minor) VALUES (${receiptEntry},${receiptId},'2026-01-03','CNY',10000)`.execute(
    db,
  )
  for (const [line, child, amount] of [
    [1, first, 3000],
    [2, removed, 7000],
  ] as const) {
    await sql`INSERT INTO vou_amount_allocation_snapshots(approval_entry_id,line_no,amount_minor) VALUES (${receiptEntry},${line},${amount})`.execute(
      db,
    )
    await sql`INSERT INTO vou_reference_snapshots(approval_entry_id,field,line_no,object_id,approval_reference_id,selection_origin,reference_entity,reference_code,reference_name) VALUES (${receiptEntry},'subunit',${line},${child},${multiV1},'HISTORICAL','customer-subunit','SUB-0001','原分户')`.execute(
      db,
    )
  }
  await sql`INSERT INTO vou_reference_snapshots(approval_entry_id,field,object_id,approval_reference_id,selection_origin,reference_entity,reference_code,reference_name) VALUES (${receiptEntry},'customer',${multi},${multiV1},'HISTORICAL','customer','CUS-0042','历史多单位')`.execute(
    db,
  )
  for (const [field, entity, fact] of [
    ['operatingEntity', 'operating-entity', operating],
    ['fundAccount', 'fund-account', fundObject],
    ['handler', 'employee', handler],
  ] as const)
    await sql`INSERT INTO vou_reference_snapshots(approval_entry_id,field,object_id,reference_entity,reference_code,reference_name,aux_snapshot) VALUES (${receiptEntry},${field},${fact.id},${entity},${fact.code},${fact.name},${JSON.stringify(auxCurrentDataSchemas[entity].strip().parse(fact))}::jsonb)`.execute(
      db,
    )
  await sql`INSERT INTO acc_books(id,code,name,start_month,base_currency,control_book,created_at,created_by,updated_at,updated_by) VALUES (${book},'ACC-0001','迁移核算','2026-01','CNY',true,'2026-01-01',${user.userId},'2026-01-01',${user.userId})`.execute(
    db,
  )
  await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,status,revision,submitted_by,submitted_at,approved_by,approved_at,updated_by,updated_at) VALUES (${ulid()},'vou','opening',${book},'APPROVED',2,${user.userId},'2026-01-01',${reviewer.userId},'2026-01-01',${reviewer.userId},'2026-01-01')`.execute(
    db,
  )
  for (const [id, code, dimension] of [
    [bank, '1002', 'FUND_ACCOUNT'],
    [receivable, '1122', 'CUSTOMER_SUBUNIT'],
  ])
    await sql`INSERT INTO acc_subjects(id,book_id,code,name,balance_direction,enabled,required_dimensions,created_at,created_by,updated_at,updated_by) VALUES (${id},${book},${code},${code},'DEBIT',true,${JSON.stringify([dimension])}::jsonb,'2026-01-01',${user.userId},'2026-01-01',${user.userId})`.execute(
      db,
    )
  const mappingId = ulid()
  await sql`INSERT INTO acc_mapping_vou_entities(id,code,name,enabled) VALUES ('sales-receipt','sales-receipt','销售收款',true)`.execute(
    db,
  )
  const oldMapping = {
    defaultTemplateId: 'receipt',
    rules: [],
    templates: [
      {
        templateId: 'receipt',
        collection: null,
        lines: [
          {
            subjectSource: 'FIXED',
            subjectValue: bank,
            direction: 'DEBIT',
            amountField: 'amount',
            currencyField: 'currency',
            dimensions: { FUND_ACCOUNT: 'fundAccount.objectId' },
            quantityField: null,
          },
          {
            collection: 'subunitAllocations',
            subjectSource: 'FIXED',
            subjectValue: receivable,
            direction: 'CREDIT',
            amountField: 'line.amount',
            currencyField: 'currency',
            dimensions: { CUSTOMER_SUBUNIT: 'line.subunit.objectId' },
            quantityField: null,
          },
        ],
      },
    ],
  }
  await sql`INSERT INTO acc_mappings(id,book_id,vou_entity_id,vou_entity,book_snapshot,vou_entity_snapshot,default_result,mapping_definition,created_at,created_by,updated_at,updated_by) VALUES (${mappingId},${book},'sales-receipt','sales-receipt','{}','{"code":"sales-receipt"}','POST',${JSON.stringify(oldMapping)}::jsonb,'2026-01-01',${user.userId},'2026-01-01',${user.userId})`.execute(
    db,
  )
  await sql`INSERT INTO acc_journal_entries(id,book_id,vou_document_id,vou_approval_entry_id,business_date,currency,created_at) VALUES (${journal},${book},${receiptId},${receiptEntry},'2026-01-03','CNY','2026-01-04')`.execute(
    db,
  )
  for (const [subject, direction, amount, dimensions] of [
    [bank, 'DEBIT', '100.00', { FUND_ACCOUNT: fund }],
    [receivable, 'CREDIT', '30.00', { CUSTOMER_SUBUNIT: first }],
    [receivable, 'CREDIT', '70.00', { CUSTOMER_SUBUNIT: removed }],
  ])
    await sql`INSERT INTO acc_journal_lines(id,journal_entry_id,subject_id,direction,amount,dimensions) VALUES (${ulid()},${journal},${subject},${direction},${amount},${JSON.stringify(dimensions)}::jsonb)`.execute(
      db,
    )
  const definition = await rpt.save(
    {
      subjectId: ulid(),
      expectedRevision: null,
      name: '客户与银行迁移对账',
      description: '',
      enabled: true,
      sql: "SELECT coalesce(line.dimensions->>'CUSTOMER_SUBUNIT',line.dimensions->>'FUND_ACCOUNT') AS party,sum(CASE WHEN line.direction='DEBIT' THEN line.amount ELSE -line.amount END) AS balance FROM acc_journal_lines line JOIN acc_journal_entries journal ON journal.id=line.journal_entry_id WHERE journal.reversed_at IS NULL GROUP BY party ORDER BY party",
      parameters: [],
      columns: [
        {
          alias: 'party',
          name: '客户或资金账户',
          order: 1,
          type: 'TEXT',
          width: 200,
          visible: true,
        },
        {
          alias: 'balance',
          name: '余额',
          order: 2,
          type: 'DECIMAL',
          width: 150,
          visible: true,
        },
      ],
    },
    actor,
    'before-cutover-report',
  )
  const beforeReport = await rpt.query(
    definition.code,
    { parameters: {}, page: 1, pageSize: 100 },
    actor,
    'before-cutover-query',
  )
  assert.deepEqual(
    beforeReport.rows.map((row) => row.balance).sort(),
    ['-30.00000000', '-70.00000000', '100.00000000'].sort(),
  )
  const original = await inspectCustomerCutover(db)
  assert.deepEqual(original.review, [])
  assert.equal(original.customers.length, 3)
  assert.equal(original.versions.length, 6)
  assert.equal(original.receipts.length, 2)
  assert.equal(
    original.customers.find((row) => row.oldSubunitId === removed)!.enabled,
    false,
  )
  const input = {
    baseline: original.baseline,
    sourceReleaseSha: 'a'.repeat(40),
    targetReleaseSha: 'b'.repeat(40),
    actorId: user.userId,
  }
  await assert.rejects(
    migrateCustomers(db, { ...input, baseline: '0'.repeat(64) }, catalog),
    /baseline_changed/,
  )
  assert.deepEqual(await inspectCustomerCutover(db), original)
  await sql`UPDATE dcl_supplier_versions SET legal_name='同税号冲突名称' WHERE approval_entry_id=${supplierV1}`.execute(
    db,
  )
  const conflict = await inspectCustomerCutover(db)
  assert.equal(conflict.ready, false)
  assert.ok(conflict.review.some((row) => row.kind === 'TAX_CONTENT_CONFLICT'))
  await assert.rejects(
    migrateCustomers(db, { ...input, baseline: conflict.baseline }, catalog),
    (error) =>
      error instanceof CustomerCutoverError &&
      error.reason === 'customer_cutover_review_required',
  )
  assert.deepEqual(await inspectCustomerCutover(db), conflict)
  await sql`UPDATE dcl_supplier_versions SET legal_name='共享税务正式名称' WHERE approval_entry_id=${supplierV1}`.execute(
    db,
  )
  assert.deepEqual(await inspectCustomerCutover(db), original)
  await sql`UPDATE dcl_supplier_versions SET legal_identifier=NULL WHERE approval_entry_id=${supplierV1}`.execute(
    db,
  )
  assert.ok(
    (await inspectCustomerCutover(db)).review.some(
      (row) => row.kind === 'TAX_REQUIRED_INFORMATION',
    ),
  )
  await sql`UPDATE dcl_supplier_versions SET legal_identifier='HKSHARED01' WHERE approval_entry_id=${supplierV1}`.execute(
    db,
  )
  await sql`UPDATE dcl_customer_versions SET phone='111' WHERE approval_entry_id=${singleV1}`.execute(
    db,
  )
  await sql`UPDATE dcl_customer_version_subunits SET contact_phone='222' WHERE customer_approval_entry_id=${singleV1}`.execute(
    db,
  )
  assert.ok(
    (await inspectCustomerCutover(db)).review.some(
      (row) => row.kind === 'CUSTOMER_ATTRIBUTE_CONFLICT',
    ),
  )
  await sql`UPDATE dcl_customer_versions SET phone=NULL WHERE approval_entry_id=${singleV1}`.execute(
    db,
  )
  await sql`UPDATE dcl_customer_version_subunits SET contact_phone=NULL WHERE customer_approval_entry_id=${singleV1}`.execute(
    db,
  )
  const missingReference = ulid()
  await sql`UPDATE vou_reference_snapshots SET object_id=${missingReference} WHERE approval_entry_id=${receiptEntry} AND field='subunit' AND line_no=1`.execute(
    db,
  )
  assert.ok(
    (await inspectCustomerCutover(db)).review.some(
      (row) => row.kind === 'RECEIPT_ALLOCATION_UNMAPPABLE',
    ),
  )
  await sql`UPDATE vou_reference_snapshots SET object_id=${first} WHERE approval_entry_id=${receiptEntry} AND field='subunit' AND line_no=1`.execute(
    db,
  )
  assert.deepEqual(await inspectCustomerCutover(db), original)
  // A late import failure exercises rollback after the target schema was built.
  await assert.rejects(
    migrateCustomers(
      db,
      input,
      catalog.filter((row) => row.path !== '/bob/customer/get'),
    ),
    /authority_mismatch/,
  )
  assert.deepEqual(await inspectCustomerCutover(db), original)
  const report = await migrateCustomers(db, input, catalog)
  assert.equal(report.preserved, true)
  assert.equal(report.taxInformation, 1)
  const config = loadConfig({
    DATABASE_URL: url.toString(),
    TARGET_DATABASE_SCOPE: 'isolated',
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    bob: new BobService(db),
    dclArchives: new DclArchiveService(db),
    aux: new AuxService(db),
    vou: new VouService(db, {
      acc: new AccService(db),
      wfl: { async apply() {} },
    }),
    rpt,
  })
  const signin = await app.request('/session/auth/signin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
    },
    body: JSON.stringify({ code: user.username, password }),
  })
  const signed = await signin.json()
  assert.equal(signed.code, 0)
  const call = async (path: string, body: unknown) =>
    (
      await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zerp-model-build': modelBuildId,
          cookie: signin.headers.getSetCookie()[0]!,
          'x-csrf-token': signed.data.csrfToken,
        },
        body: JSON.stringify(body),
      })
    ).json()
  const single = await call('/bob/customer/get', { objectId: root })
  assert.equal(single.code, 0, single.errorKey)
  assert.equal(single.data.sourceApprovalEntryId, singleV1)
  assert.equal(single.data.code, 'CUS-0041')
  assert.equal(single.data.revision, '7')
  assert.equal(single.data.data.displayName, '单层前客户')
  assert.equal(single.data.data.attachments[0].id, fileId)
  assert.equal(single.data.data.taxInformation[0].taxNumber, 'HKSHARED01')
  assert.equal('subunits' in single.data.data, false)
  const pending = await call('/dcl/customer/submission-get', {
    subjectId: root,
    submissionId: singleV2,
  })
  assert.equal(pending.data.snapshot.displayName, '待批客户名称')
  for (const mapping of report.customers.filter(
    (row) => row.oldCustomerId === multi,
  )) {
    assert.notEqual(mapping.customerId, multi)
    const formal = await call('/bob/customer/get', {
      objectId: mapping.customerId,
    })
    assert.equal(formal.code, 0, formal.errorKey)
    assert.equal(formal.data.enabled, mapping.enabled)
    const history = await call('/bob/customer/versions', {
      subjectId: mapping.customerId,
    })
    assert.equal(history.code, 0, history.errorKey)
    assert.equal(
      history.data.items.length,
      mapping.oldSubunitId === removed ? 1 : 3,
    )
    assert.ok(
      history.data.items.every(
        (row: { submissionId: string }) =>
          ![multiV1, multiV2, multiOpen].includes(row.submissionId),
      ),
    )
  }
  const amounts: string[] = []
  for (const mapping of report.receipts) {
    const receipt = await call('/vou/sales-receipt/get', {
      documentId: mapping.documentId,
    })
    assert.equal(receipt.code, 0, receipt.errorKey)
    assert.equal(receipt.data.payload.customer.objectId, mapping.customerId)
    assert.equal('subunitAllocations' in receipt.data.payload, false)
    amounts.push(receipt.data.payload.amount)
  }
  assert.deepEqual(amounts.sort(), ['30.00', '70.00'])
  assert.deepEqual(
    report.financial.ledger.filter((row) => row.fund).map((row) => row.amount),
    ['100.00000000'],
  )
  const publicReport = await call(`/rpt/${definition.code}/query`, {
    parameters: {},
    page: 1,
    pageSize: 100,
  })
  assert.equal(publicReport.code, 0, publicReport.errorKey)
  const expectedRows = beforeReport.rows
    .map((row) => ({
      ...row,
      party:
        report.customers.find((mapping) => mapping.oldSubunitId === row.party)
          ?.customerId ?? row.party,
    }))
    .sort((a, b) => String(a.party).localeCompare(String(b.party)))
  assert.deepEqual(publicReport.data.rows, expectedRows)
  const reviewerSignin = await app.request('/session/auth/signin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
    },
    body: JSON.stringify({
      code: reviewer.username,
      password: reviewerPassword,
    }),
  })
  const reviewerSession = await reviewerSignin.json()
  assert.equal(reviewerSession.code, 0)
  const review = async (action: string, expectedRevision: string) =>
    (
      await app.request(`/vou/sales-receipt/${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zerp-model-build': modelBuildId,
          cookie: reviewerSignin.headers.getSetCookie()[0]!,
          'x-csrf-token': reviewerSession.data.csrfToken,
        },
        body: JSON.stringify({
          documentId: report.receipts.find((row) => row.amountMinor === '3000')!
            .documentId,
          submissionId: report.receipts.find(
            (row) => row.amountMinor === '3000',
          )!.entryId,
          expectedRevision,
          ...(action === 'unapprove' ? { reason: '验证只撤销本客户金额' } : {}),
        }),
      })
    ).json()
  const reversed = await review('unapprove', '2')
  assert.equal(reversed.code, 0, reversed.errorKey)
  const bankAfterReverse = await call(`/rpt/${definition.code}/query`, {
    parameters: {},
    page: 1,
    pageSize: 100,
  })
  assert.equal(
    bankAfterReverse.data.rows.find(
      (row: { party: string }) => row.party === fund,
    ).balance,
    '70.00000000',
  )
  const restored = await review('approve', reversed.data.revision)
  assert.equal(restored.code, 0, restored.errorKey)
  assert.deepEqual(
    (
      await call(`/rpt/${definition.code}/query`, {
        parameters: {},
        page: 1,
        pageSize: 100,
      })
    ).data.rows,
    expectedRows,
  )
  const childGrants = await db
    .selectFrom('app_role_permissions')
    .select('permission_id')
    .where('role_id', '=', onlyChild.roleId)
    .execute()
  assert.deepEqual(childGrants, [])
})
