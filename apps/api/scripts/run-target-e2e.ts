import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { argon2idAsync } from '@noble/hashes/argon2.js'
import { sql } from 'kysely'
import {
  vouEntities,
  vouEntityInputDescriptors,
  vouEntityPresentation,
  type VouEntity,
  type VouPayload,
  type VouPayloadFor,
} from '@zerp/model'
import pg from 'pg'

import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { AccService } from '../src/acc/service.ts'
import { AuxService } from '../src/aux/service.ts'
import { createDatabase } from '../src/db/database.ts'
import { ArchiveService, type ArchiveSnapshot } from '../src/dcl/archives.ts'
import { WarehouseService } from '../src/dcl/warehouse.ts'
import { PgRptDefinitionValidator } from '../src/rpt/service.ts'
import { VouService } from '../src/vou/service.ts'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl)
  throw new Error('TARGET_DATABASE_URL is required for target E2E')
if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test'))
  throw new Error('target E2E only accepts a disposable *_test database')

const suffix = randomBytes(8).toString('hex')
async function principal(kind: 'submitter' | 'reviewer', index: number) {
  const password = randomBytes(24).toString('base64url')
  const salt = randomBytes(16)
  const hash = Buffer.from(
    await argon2idAsync(password, salt, {
      m: 64 * 1024,
      t: 3,
      p: 2,
      dkLen: 32,
    }),
  ).toString('base64url')
  return {
    userId: `T${index}${suffix}`.toUpperCase().padEnd(26, '0').slice(0, 26),
    roleId: `R${index}${suffix}`.toUpperCase().padEnd(26, '0').slice(0, 26),
    username: `target-${kind}-${suffix}`,
    password,
    passwordHash: `$argon2id$v=19$m=65536,t=3,p=2$${salt.toString('base64url')}$${hash}`,
  }
}
const database = createDatabase(databaseUrl)
const bootstrap = new TargetBootstrapService(database)
const rptValidationPool = new pg.Pool({ connectionString: databaseUrl })
const rptValidator = new PgRptDefinitionValidator(rptValidationPool, database)
const archives = new ArchiveService(database, rptValidator)
const warehouse = new WarehouseService(database)
const acc = new AccService(database)
const aux = new AuxService(database)
const vou = new VouService(database, {
  acc,
  wfl: { async apply() {} },
})
const submitter = await principal('submitter', 1)
const reviewer = await principal('reviewer', 2)
const managerEmployeeId = `M${suffix}`
  .toUpperCase()
  .padEnd(26, '0')
  .slice(0, 26)
const managerApprovalEntryId = `A${suffix}`
  .toUpperCase()
  .padEnd(26, '0')
  .slice(0, 26)
const staleManagerApprovalEntryId = `S${suffix}`
  .toUpperCase()
  .padEnd(26, '0')
  .slice(0, 26)
const fixtureId = (prefix: string, index: number) =>
  `${prefix}${index}${suffix}`.toUpperCase().padEnd(26, '0').slice(0, 26)
const fixtureCode = (prefix: string) =>
  `${prefix}-${suffix.slice(0, 8)}`.toUpperCase()
const auxCode = (prefix: string) =>
  `${prefix}-${(Number.parseInt(suffix.slice(0, 8), 16) % 10_000)
    .toString()
    .padStart(4, '0')}`
const vouCode = (prefix: string) =>
  `${prefix}-${(Number.parseInt(suffix.slice(0, 8), 16) % 10_000)
    .toString()
    .padStart(4, '0')}`

function vouPostingSource(entity: VouEntity): {
  collection: string | null
  amountField: string
  fieldCatalog: { headerFields: string[]; lineFields: string[] }
} | null {
  const fields = vouEntityInputDescriptors[entity]
  const headerAmount = fields.find(
    (field) =>
      field.required &&
      (field.kind === 'decimal' || field.kind === 'integer'),
  )
  if (headerAmount)
    return {
      collection: null,
      amountField: headerAmount.key,
      fieldCatalog: {
        headerFields: ['currency', headerAmount.key],
        lineFields: [],
      },
  }
  for (const field of fields) {
    if (
      field.kind !== 'array' ||
      !field.required ||
      field.key === 'attachments'
    )
      continue
    const lineAmount = field.item?.find(
      (item) => item.kind === 'decimal' || item.kind === 'integer',
    )
    if (lineAmount)
      return {
        collection: field.key,
        amountField: `line.${lineAmount.key}`,
        fieldCatalog: {
          headerFields: ['currency'],
          lineFields: [`line.${lineAmount.key}`],
        },
      }
  }
  return null
}
const vouReferenceFacts = {
  references: [
    ['customer', 'customer', 'CUS', '目标客户'],
    ['supplier', 'supplier', 'SUP', '目标供应商'],
    ['operatingEntity', 'operating-entity', 'OPE', '目标经营主体'],
    ['employee', 'employee', 'EMP', '目标员工'],
    ['warehouse', 'warehouse', 'WHS', '目标仓库'],
    ['product', 'product', 'PRD', '目标产品'],
    ['otherUnit', 'other-unit', 'OTU', '目标其他单位'],
    ['fundAccount', 'fund-account', 'FAC', '目标资金账户'],
  ]
    .map(([key, entity, prefix, name], index) => ({
      key,
      entity: entity as
        | 'customer'
        | 'supplier'
        | 'operating-entity'
        | 'employee'
        | 'warehouse'
        | 'product'
        | 'other-unit'
        | 'fund-account'
        | 'customer-subunit',
      objectId: fixtureId('Q', index + 1),
      approvalEntryId: fixtureId('P', index + 1),
      code: vouCode(prefix),
      name,
    }))
    .concat([
      {
        key: 'customerSubunit',
        entity: 'customer-subunit' as const,
        objectId: fixtureId('U', 1),
        approvalEntryId: fixtureId('P', 1),
        code: 'SUB-0001',
        name: '目标客户默认结算单位',
      },
    ]),
}
const vouAccObjectFacts = {
  asset: {
    documentId: fixtureId('N', 1),
    submissionId: fixtureId('E', 1),
    objectId: '',
  },
  bill: {
    documentId: fixtureId('N', 2),
    submissionId: fixtureId('E', 2),
    objectId: '',
  },
}
const vouSourceFacts = {
  saleOrder: {
    documentId: fixtureId('W', 1),
    submissionId: fixtureId('W', 2),
    lineId: fixtureId('W', 3),
  },
  purchaseOrder: {
    documentId: fixtureId('Y', 1),
    submissionId: fixtureId('Y', 2),
    lineId: fixtureId('Y', 3),
  },
}
const archiveFacts = {
  createdBy: submitter.userId,
  auxObjects: [
    {
      id: fixtureId('X', 1),
      entity: 'dictionary-item' as const,
      code: auxCode('DIT'),
      data: { name: '目标厢式货车' },
    },
    {
      id: fixtureId('X', 2),
      entity: 'product-type' as const,
      code: auxCode('PTY'),
      data: { name: '目标产成品', behaviorProfile: 'STANDARD_FINISHED' },
    },
    {
      id: fixtureId('X', 3),
      entity: 'product-category' as const,
      code: auxCode('PCT'),
      data: { name: '目标商品分类' },
    },
    {
      id: fixtureId('X', 4),
      entity: 'measurement-unit' as const,
      code: auxCode('UNT'),
      data: { name: '目标件', quantityScale: 0 },
    },
    {
      id: fixtureId('X', 5),
      entity: 'employee-category' as const,
      code: auxCode('EMC'),
      data: { name: '目标正式员工' },
    },
    {
      id: fixtureId('X', 6),
      entity: 'department' as const,
      code: auxCode('DEP'),
      data: { name: '目标业务部' },
    },
    {
      id: fixtureId('X', 7),
      entity: 'position' as const,
      code: auxCode('POS'),
      data: { name: '目标业务员' },
    },
    {
      id: fixtureId('X', 8),
      entity: 'settlement-method' as const,
      code: auxCode('SET'),
      data: {
        name: '目标月结 30 天',
        termCode: 'MONTHLY_30',
        ruleType: 'MONTH_END',
        monthOffset: 1,
        dayOfMonth: 0,
        dayOffset: 0,
        defaultSalesSurcharge: '0.00',
        description: '',
      },
    },
  ],
  accounting: {
    book: {
      id: fixtureId('B', 1),
      code: fixtureCode('BOOK'),
      name: '目标账簿',
    },
    vouEntity: {
      id: 'sale-pricing',
      code: 'sale-pricing',
      name: vouEntityPresentation['sale-pricing'].label,
      fieldCatalog: vouPostingSource('sale-pricing')!.fieldCatalog,
    },
    vouEntities: vouEntities.map((entity) => ({
      id: entity,
      code: entity,
      name: vouEntityPresentation[entity].label,
      fieldCatalog: vouPostingSource(entity)?.fieldCatalog ?? {
        headerFields: ['currency'],
        lineFields: [],
      },
    })),
    subjects: [
      {
        id: fixtureId('C', 1),
        code: fixtureCode('1001'),
        name: '目标库存商品',
        leaf: true,
        requiredDimensions: [],
      },
      {
        id: fixtureId('C', 2),
        code: fixtureCode('6001'),
        name: '目标主营业务收入',
        leaf: true,
        requiredDimensions: [],
      },
    ],
  },
}
const accUiFacts: {
  book: { id: string; code: string; name: string; startMonth: string }
  subjects: Array<{
    id: string
    code: string
    name: string
    balanceDirection: 'DEBIT' | 'CREDIT'
    requiredDimensions: ('ASSET' | 'BILL')[]
  }>
} = {
  book: {
    id: fixtureId('K', 1),
    code: 'ACC-9001',
    name: '目标 ACC UI 账簿',
    startMonth: '2026-08',
  },
  subjects: [
    {
      id: fixtureId('K', 2),
      code: '1001',
      name: '目标现金',
      balanceDirection: 'DEBIT' as const,
      requiredDimensions: [],
    },
    {
      id: fixtureId('K', 3),
      code: '4001',
      name: '目标期初权益',
      balanceDirection: 'CREDIT' as const,
      requiredDimensions: [],
    },
    {
      id: fixtureId('K', 4),
      code: '1601',
      name: '目标固定资产',
      balanceDirection: 'DEBIT' as const,
      requiredDimensions: ['ASSET'],
    },
    {
      id: fixtureId('K', 5),
      code: '1121',
      name: '目标应收票据',
      balanceDirection: 'DEBIT' as const,
      requiredDimensions: ['BILL'],
    },
  ],
}
const accMappingUiFacts = {
  book: {
    id: fixtureId('Z', 1),
    code: 'ACC-9002',
    name: '目标映射维护账簿',
    startMonth: '2026-08',
  },
  subjects: [
    {
      id: fixtureId('Z', 2),
      code: '1001',
      name: '目标映射借方科目',
      balanceDirection: 'DEBIT' as const,
      requiredDimensions: [] as ('ASSET' | 'BILL')[],
    },
    {
      id: fixtureId('Z', 3),
      code: '6001',
      name: '目标映射贷方科目',
      balanceDirection: 'CREDIT' as const,
      requiredDimensions: [] as ('ASSET' | 'BILL')[],
    },
  ],
}
let e2eAssetCategory: { objectId: string; objectRevision: string } | undefined
let e2eDictionaryTypeId: string | undefined
const serviceActor = (id: string) => ({
  id,
  permissions: [] as string[],
  trusted: true as const,
})

async function seedAuxFacts(aux: AuxService) {
  const actor = {
    id: submitter.userId,
    permissions: archiveFacts.auxObjects.flatMap((fact) => [
      `/aux/${fact.entity}/create`,
      `/aux/${fact.entity}/get`,
    ]),
    trusted: true as const,
  }
  const dictionaryType = await aux.create(
    'dictionary-type',
    { name: '目标车辆类型', description: '' },
    {
      ...actor,
      permissions: [...actor.permissions, '/aux/dictionary-type/create'],
    },
  )
  e2eDictionaryTypeId = dictionaryType.objectId
  for (const fact of archiveFacts.auxObjects) {
    const data =
      fact.entity === 'dictionary-item'
        ? {
            ...fact.data,
            dictionaryTypeId: dictionaryType.objectId,
            sortOrder: 0,
          }
        : fact.entity === 'product-category' || fact.entity === 'department'
          ? { ...fact.data, parentId: '', description: '' }
          : fact.entity === 'product-type'
            ? { ...fact.data, description: '' }
            : fact.entity === 'measurement-unit'
              ? { ...fact.data, symbol: '件' }
              : fact.entity === 'employee-category' ||
                  fact.entity === 'position'
                ? { ...fact.data, description: '' }
                : fact.data
    const created =
      fact.entity === 'settlement-method'
        ? await aux.ensureE2ESettlementMethod(data, actor)
        : await aux.create(fact.entity, data, actor)
    const stored = await aux.get(fact.entity, created.objectId, actor)
    fact.id = stored.objectId
    fact.code = stored.code
  }
}

function auxReference(entity: string) {
  const fact = archiveFacts.auxObjects.find((item) => item.entity === entity)
  if (!fact || typeof fact.data !== 'object' || fact.data === null)
    throw new Error(`missing ${entity} E2E auxiliary fact`)
  const data = fact.data as Record<string, unknown>
  const name = data.name
  if (typeof name !== 'string')
    throw new Error(`missing ${entity} E2E auxiliary fact name`)
  return { id: fact.id, code: fact.code, name, ...data }
}

async function deleteAccFixtureBooks(bookIds: readonly string[]) {
  await database.transaction().execute(async (transaction) => {
    const entries = await transaction
      .selectFrom('approval_entries')
      .select('id')
      .where('domain', '=', 'acc')
      .where('entity', '=', 'opening')
      .where('subject_id', 'in', bookIds)
      .execute()
    const entryIds = entries.map((entry) => entry.id)
    if (entryIds.length > 0) {
      await transaction
        .deleteFrom('acc_opening_container_balances')
        .where('opening_approval_entry_id', 'in', entryIds)
        .execute()
      await transaction
        .deleteFrom('acc_register_entries')
        .where('opening_approval_entry_id', 'in', entryIds)
        .execute()
      await transaction
        .deleteFrom('acc_journal_entries')
        .where('opening_approval_entry_id', 'in', entryIds)
        .execute()
      await transaction
        .deleteFrom('approval_events')
        .where('entry_id', 'in', entryIds)
        .execute()
      await transaction
        .deleteFrom('approval_entries')
        .where('id', 'in', entryIds)
        .execute()
    }
    await transaction
      .deleteFrom('approval_events')
      .where('domain', '=', 'acc')
      .where('entity', '=', 'opening')
      .where('subject_id', 'in', bookIds)
      .execute()
    await transaction
      .deleteFrom('acc_asset_book_values')
      .where('book_id', 'in', bookIds)
      .execute()
    await transaction
      .deleteFrom('acc_bill_book_values')
      .where('book_id', 'in', bookIds)
      .execute()
    await transaction
      .deleteFrom('acc_period_balances')
      .where('book_id', 'in', bookIds)
      .execute()
    await transaction
      .deleteFrom('acc_periods')
      .where('book_id', 'in', bookIds)
      .execute()
    await transaction
      .deleteFrom('acc_book_access')
      .where('book_id', 'in', bookIds)
      .execute()
    await transaction
      .deleteFrom('acc_subjects')
      .where('book_id', 'in', bookIds)
      .execute()
    await transaction
      .deleteFrom('acc_books')
      .where('id', 'in', bookIds)
      .execute()
  })
}

async function deleteE2ECatalogFacts() {
  await database.transaction().execute(async (transaction) => {
    await transaction
      .deleteFrom('dcl_warehouse_manager_reference_facts')
      .where('employee_id', '=', managerEmployeeId)
      .execute()
    await transaction
      .deleteFrom('dcl_acc_subject_facts')
      .where(
        'id',
        'in',
        [
          ...archiveFacts.accounting.subjects.map((subject) => subject.id),
          ...accUiFacts.subjects.map((subject) => subject.id),
        ],
      )
      .execute()
    await transaction
      .deleteFrom('dcl_acc_book_facts')
      .where('id', 'in', [archiveFacts.accounting.book.id, accUiFacts.book.id])
      .execute()
    await transaction
      .deleteFrom('aux_objects')
      .where('id', 'in', [
        ...archiveFacts.auxObjects.map((item) => item.id),
        ...(e2eDictionaryTypeId ? [e2eDictionaryTypeId] : []),
      ])
      .execute()
  })
}

async function seedArchiveReference(
  archives: ArchiveService,
  entity: Exclude<
    (typeof vouReferenceFacts.references)[number]['entity'],
    'warehouse' | 'customer-subunit'
  >,
  reference: {
    objectId: string
    approvalEntryId: string
    code: string
    name: string
  },
  snapshot: ArchiveSnapshot,
) {
  const pending = await archives.submit(
    entity,
    'submit-new',
    {
      subjectId: reference.objectId,
      submissionId: reference.approvalEntryId,
      idempotencyKey: reference.approvalEntryId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot,
    },
    serviceActor(submitter.userId),
    `e2e-${entity}-submit`,
  )
  const approved = await archives.review(
    entity,
    'approve',
    {
      subjectId: reference.objectId,
      submissionId: reference.approvalEntryId,
      expectedRevision: pending.revision,
    },
    serviceActor(reviewer.userId),
    `e2e-${entity}-approve`,
  )
  reference.code = approved.code ?? reference.code
}

async function seedVouReferences(
  archives: ArchiveService,
  warehouse: WarehouseService,
) {
  const reference = (key: string) => {
    const found = vouReferenceFacts.references.find((item) => item.key === key)
    if (!found) throw new Error(`missing ${key} E2E VOU reference`)
    return found
  }
  const operatingEntity = reference('operatingEntity')
  await seedArchiveReference(archives, 'operating-entity', operatingEntity, {
    legalName: '目标经营主体有限公司',
    legalIdentifier: `91${suffix.toUpperCase()}`,
    registeredAddress: '上海市',
    contactName: '目标联系人',
    contactPhone: '13800000000',
    invoiceTitle: '目标经营主体有限公司',
    invoiceAddress: '上海市',
    invoicePhone: '021-10000000',
    invoiceBank: '目标银行',
    invoiceAccount: '6222000000000000',
    remark: '',
    enabled: true,
  })
  const operatingEntityReference = {
    objectId: operatingEntity.objectId,
    approvalEntryId: operatingEntity.approvalEntryId,
    code: operatingEntity.code,
    name: operatingEntity.name,
  }
  const manager = {
    key: 'manager',
    entity: 'employee' as const,
    objectId: managerEmployeeId,
    approvalEntryId: managerApprovalEntryId,
    code: 'EMP-E2E',
    name: '目标负责人',
  }
  await seedArchiveReference(archives, 'employee', manager, {
    identityKind: 'PERSON',
    legalName: '目标负责人',
    displayName: manager.name,
    legalIdentifier: `MGR-${suffix}`,
    contactName: '',
    phone: '',
    address: '',
    employeeCategory: auxReference('employee-category'),
    department: auxReference('department'),
    position: auxReference('position'),
    employmentDate: '2026-08-01',
    workPhone: '',
    workEmail: '',
    operatingEntity: operatingEntityReference,
    remark: '',
    enabled: true,
  })
  const warehouseReference = reference('warehouse')
  const warehousePending = await warehouse.submit(
    'submit-new',
    {
      subjectId: warehouseReference.objectId,
      submissionId: warehouseReference.approvalEntryId,
      idempotencyKey: warehouseReference.approvalEntryId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot: {
        name: warehouseReference.name,
        address: '上海市',
        contactName: '目标仓管员',
        contactPhone: '13800000000',
        managerEmployeeId: manager.objectId,
        managerEmployeeApprovalEntryId: manager.approvalEntryId,
        managerEmployeeCode: manager.code,
        managerEmployeeName: manager.name,
        remark: '',
        enabled: true,
      },
    },
    serviceActor(submitter.userId),
    'e2e-warehouse-submit',
  )
  const warehouseApproved = await warehouse.review(
    'approve',
    {
      subjectId: warehouseReference.objectId,
      submissionId: warehouseReference.approvalEntryId,
      expectedRevision: warehousePending.revision,
    },
    serviceActor(reviewer.userId),
    'e2e-warehouse-approve',
  )
  warehouseReference.code = warehouseApproved.code

  const customerSubunit = reference('customerSubunit')
  await seedArchiveReference(archives, 'customer', reference('customer'), {
    identityKind: 'OTHER',
    legalName: '目标客户',
    displayName: '目标客户',
    legalIdentifier: `CUS-${suffix}`,
    phone: '',
    email: '',
    address: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBank: '',
    invoiceAccount: '',
    remittanceProfiles: [],
    defaultOperatingEntity: null,
    identityAttachments: [],
    subunits: [
      {
        id: customerSubunit.objectId,
        intent: 'NEW',
        code: null,
        name: '目标客户默认结算单位',
        contactName: '',
        address: '',
        customerType: '',
        settlementMethod: auxReference('settlement-method'),
        receiptMethod: '',
        transportMethod: '',
        pricePolicy: '',
        creditLimits: [{ currency: 'CNY', amount: '1000000.00' }],
        salesAttribution: null,
        internalReminder: '',
        defaultOrderRemark: '',
        attachments: [],
        enabled: true,
      },
    ],
    enabled: true,
  })
  const storedSubunit = await database
    .selectFrom('dcl_customer_subunit_roots')
    .select('code')
    .where('subunit_id', '=', customerSubunit.objectId)
    .executeTakeFirstOrThrow()
  customerSubunit.code = storedSubunit.code
  await seedArchiveReference(archives, 'supplier', reference('supplier'), {
    identityKind: 'ORGANIZATION',
    legalName: '目标供应商',
    displayName: '目标供应商',
    legalIdentifier: `SUP-${suffix}`,
    contactName: '',
    phone: '',
    address: '',
    operatingEntities: [],
    defaultOperatingEntityId: null,
    settlementMethod: auxReference('settlement-method'),
    defaultPurchaser: null,
    remark: '',
    enabled: true,
  })
  await seedArchiveReference(archives, 'other-unit', reference('otherUnit'), {
    identityKind: 'ORGANIZATION',
    legalName: '目标其他单位',
    displayName: '目标其他单位',
    legalIdentifier: `OTU-${suffix}`,
    contactName: '',
    phone: '',
    address: '',
    operatingEntities: [],
    defaultOperatingEntityId: null,
    settlementMethod: null,
    remark: '',
    enabled: true,
  })
  await seedArchiveReference(
    archives,
    'fund-account',
    reference('fundAccount'),
    {
      name: '目标资金账户',
      currency: 'CNY',
      accountName: '目标经营主体有限公司',
      bank: '目标银行',
      branch: '',
      accountNumber: `FAC${suffix}`,
      operatingEntity: operatingEntityReference,
      remark: '',
      enabled: true,
    },
  )
  await seedArchiveReference(archives, 'product', reference('product'), {
    name: '目标产品',
    barcode: `PRD-${suffix}`,
    specification: '',
    model: '',
    productType: auxReference('product-type'),
    productCategory: auxReference('product-category'),
    pricingUnit: auxReference('measurement-unit'),
    defaultInputUnit: auxReference('measurement-unit'),
    defaultPackageSpec: '',
    recyclable: false,
    remark: '',
    enabled: true,
  })
  await seedArchiveReference(archives, 'employee', reference('employee'), {
    identityKind: 'PERSON',
    legalName: '目标员工',
    displayName: '目标员工',
    legalIdentifier: `EMP-${suffix}`,
    contactName: '',
    phone: '',
    address: '',
    employeeCategory: auxReference('employee-category'),
    department: auxReference('department'),
    position: auxReference('position'),
    employmentDate: '2026-08-01',
    workPhone: '',
    workEmail: '',
    operatingEntity: operatingEntityReference,
    remark: '',
    enabled: true,
  })
}

async function seedAccFacts(acc: AccService) {
  const submitterActor = serviceActor(submitter.userId)
  const createBook = async (
    book: { id: string; name: string; startMonth: string },
    subjectRows: readonly {
      id: string
      code: string
      name: string
      balanceDirection: 'DEBIT' | 'CREDIT'
      requiredDimensions: ('ASSET' | 'BILL')[]
    }[],
  ) => {
    const created = await acc.createBook(
      {
        id: book.id,
        name: book.name,
        description: 'Target E2E ACC fixture',
        startMonth: book.startMonth,
        baseCurrency: 'CNY',
      },
      submitterActor,
    )
    await acc.grantBookAccess(book.id, reviewer.userId, submitterActor)
    for (const subject of subjectRows) {
      await acc.createSubject(
        {
          id: subject.id,
          bookId: book.id,
          code: subject.code,
          name: subject.name,
          parentId: null,
          balanceDirection: subject.balanceDirection,
          enabled: true,
          requiredDimensions: subject.requiredDimensions,
          inventoryQuantity: false,
          settlementPurpose: 'NONE',
        },
        submitterActor,
      )
    }
    return created
  }

  const effectBook = await createBook(
    { ...archiveFacts.accounting.book, startMonth: '2026-08' },
    archiveFacts.accounting.subjects.map((subject) => ({
      ...subject,
      balanceDirection: 'DEBIT' as const,
      requiredDimensions: [] as ('ASSET' | 'BILL')[],
    })),
  )
  archiveFacts.accounting.book.code = effectBook.code
  await acc.publishMappingCatalog(effectBook.id, submitterActor)
  const uiBook = await createBook(accUiFacts.book, accUiFacts.subjects)
  accUiFacts.book.code = uiBook.code
  await acc.publishMappingCatalog(uiBook.id, submitterActor)
  const mappingUiBook = await createBook(
    accMappingUiFacts.book,
    accMappingUiFacts.subjects,
  )
  accMappingUiFacts.book.code = mappingUiBook.code
  await acc.publishMappingCatalog(mappingUiBook.id, submitterActor)
}

async function seedApprovedOpeningAndMappings() {
  const submitterActor = {
    id: submitter.userId,
    permissions: ['/acc/opening/submit-new', '/dcl/acc-mapping/submit-new'],
  }
  const reviewerActor = {
    id: reviewer.userId,
    permissions: ['/acc/opening/approve', '/dcl/acc-mapping/approve'],
  }
  const submissionId = fixtureId('O', 1)
  const pending = await acc.submitOpening(
    {
      bookId: archiveFacts.accounting.book.id,
      submissionId,
      idempotencyKey: submissionId,
      lines: [],
      assets: [],
      bills: [],
      containers: [],
    },
    submitterActor,
    'e2e-acc-opening-submit',
  )
  await acc.reviewOpening(
    'approve',
    {
      bookId: archiveFacts.accounting.book.id,
      submissionId,
      expectedRevision: pending.approval.revision,
    },
    reviewerActor,
    'e2e-acc-opening-approve',
  )

  const mappedBooks = [
    {
      book: archiveFacts.accounting.book,
      subjects: archiveFacts.accounting.subjects,
    },
    { book: accUiFacts.book, subjects: accUiFacts.subjects },
  ]
  for (const [bookIndex, mappedBook] of mappedBooks.entries()) {
    for (const [index, vouEntity] of archiveFacts.accounting.vouEntities.entries()) {
    const mappingIndex = bookIndex * archiveFacts.accounting.vouEntities.length + index + 1
    const subjectId = fixtureId('G', mappingIndex)
    const mappingSubmissionId = fixtureId('H', mappingIndex)
    const posting = vouPostingSource(vouEntity.code as VouEntity)
    const [debitSubject, creditSubject] = mappedBook.subjects
    if (!debitSubject || !creditSubject)
      throw new Error('target E2E effect book requires two posting subjects')
    const mapping = await archives.submit(
      'acc-mapping',
      'submit-new',
      {
        subjectId,
        submissionId: mappingSubmissionId,
        idempotencyKey: mappingSubmissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          book: {
            id: mappedBook.book.id,
            code: mappedBook.book.code,
            name: mappedBook.book.name,
          },
          vouEntity: {
            id: vouEntity.id,
            code: vouEntity.code,
            name: vouEntity.name,
          },
          defaultResult: posting ? 'POST' : 'UN_POST',
          definition: {
            defaultTemplateId: posting ? 'e2e-effect' : null,
            rules: [],
            templates: posting ? [
              {
                templateId: 'e2e-effect',
                collection: posting.collection,
                lines: [
                  {
                    subjectSource: 'FIXED',
                    subjectValue: debitSubject.id,
                    direction: 'DEBIT',
                    amountField: posting.amountField,
                    currencyField: 'currency',
                    dimensions: {},
                    quantityField: null,
                    costCounterpartSubjectId: null,
                    costCounterpartDimensions: {},
                  },
                  {
                    subjectSource: 'FIXED',
                    subjectValue: creditSubject.id,
                    direction: 'CREDIT',
                    amountField: posting.amountField,
                    currencyField: 'currency',
                    dimensions: {},
                    quantityField: null,
                    costCounterpartSubjectId: null,
                    costCounterpartDimensions: {},
                  },
                ],
              },
            ] : [],
            assetConfiguration:
              bookIndex === 1 && vouEntity.code === 'asset-acquisition'
                ? {
                    assetSubjectId: accUiFacts.subjects[0]!.id,
                    assetDimensions: {},
                    accumulatedDepreciationSubjectId: accUiFacts.subjects[1]!.id,
                    accumulatedDepreciationDimensions: {},
                    depreciationExpenseSubjectId: accUiFacts.subjects[1]!.id,
                    depreciationExpenseDimensions: {},
                  }
                : null,
          },
        },
      },
      submitterActor,
      `e2e-acc-mapping-${vouEntity.code}-submit`,
    )
    await archives.review(
      'acc-mapping',
      'approve',
      {
        subjectId,
        submissionId: mappingSubmissionId,
        expectedRevision: mapping.revision,
      },
      reviewerActor,
      `e2e-acc-mapping-${vouEntity.code}-approve`,
    )
    }
  }
}

async function seedApprovedSourceOrders() {
  const product = vouReferenceFacts.references.find(
    (reference) => reference.key === 'product',
  )!
  const customerSubunit = vouReferenceFacts.references.find(
    (reference) => reference.key === 'customerSubunit',
  )!
  const supplier = vouReferenceFacts.references.find(
    (reference) => reference.key === 'supplier',
  )!
  const warehouseReference = vouReferenceFacts.references.find(
    (reference) => reference.key === 'warehouse',
  )!
  const unit = auxReference('measurement-unit')
  const warehouseSnapshot = {
    objectId: warehouseReference.objectId,
    approvalEntryId: warehouseReference.approvalEntryId,
    selectionOrigin: 'HISTORICAL' as const,
  }
  const productLine = (lineId: string) => ({
    lineId,
    product: { objectId: product.objectId },
    enteredQuantity: '10',
    enteredUnit: { objectId: unit.id },
    baseQuantity: '10',
    unitPrice: '12.50',
  })
  const orders = [
    {
      entity: 'sale-order' as const,
      facts: vouSourceFacts.saleOrder,
      payload: {
        businessDate: '2026-08-01',
        currency: 'CNY',
        attachments: [],
        customerSubunit: {
          objectId: customerSubunit.objectId,
          approvalEntryId: customerSubunit.approvalEntryId,
          selectionOrigin: 'HISTORICAL' as const,
        },
        warehouse: warehouseSnapshot,
        productLines: [productLine(vouSourceFacts.saleOrder.lineId)],
      },
    },
    {
      entity: 'purchase-order' as const,
      facts: vouSourceFacts.purchaseOrder,
      payload: {
        businessDate: '2026-08-01',
        currency: 'CNY',
        attachments: [],
        supplier: {
          objectId: supplier.objectId,
          approvalEntryId: supplier.approvalEntryId,
          selectionOrigin: 'HISTORICAL' as const,
        },
        warehouse: warehouseSnapshot,
        productLines: [productLine(vouSourceFacts.purchaseOrder.lineId)],
      },
    },
  ]
  for (const order of orders) {
    const pending = await vou.submit(
      order.entity,
      'submit-new',
      {
        documentId: order.facts.documentId,
        submissionId: order.facts.submissionId,
        idempotencyKey: order.facts.submissionId,
        expectedRevision: null,
        payload: order.payload,
      },
      serviceActor(submitter.userId),
      `e2e-${order.entity}-source-submit`,
    )
    await vou.review(
      order.entity,
      'approve',
      {
        documentId: pending.documentId,
        submissionId: pending.submissionId,
        expectedRevision: pending.revision,
      },
      serviceActor(reviewer.userId),
      `e2e-${order.entity}-source-approve`,
    )
  }
}

async function verifyTrustedSystemVouLifecycle() {
  const reference = (key: string) => {
    const found = vouReferenceFacts.references.find((item) => item.key === key)
    if (!found) throw new Error(`missing ${key} trusted VOU reference`)
    return {
      objectId: found.objectId,
      approvalEntryId: found.approvalEntryId,
      selectionOrigin: 'CURRENT' as const,
    }
  }
  const sourceLines = [{
    sourceLineId: vouSourceFacts.saleOrder.lineId,
    baseQuantity: '1.000000',
  }]
  const cases: Array<{ entity: VouEntity; payload: VouPayload }> = [
    {
      entity: 'sale-outbound',
      payload: {
        businessDate: '2026-09-04', currency: 'CNY', attachments: [], sourceLines,
      } satisfies VouPayloadFor<'sale-outbound'>,
    },
    {
      entity: 'sale-delivery',
      payload: {
        businessDate: '2026-09-04', currency: 'CNY', attachments: [], sourceLines,
      } satisfies VouPayloadFor<'sale-delivery'>,
    },
    {
      entity: 'sale-signoff',
      payload: {
        businessDate: '2026-09-04', currency: 'CNY', attachments: [],
        parentEntity: 'sale-order',
        parentDocumentId: vouSourceFacts.saleOrder.documentId,
        customerSubunit: reference('customerSubunit'),
        expectedSolventContainers: 1,
        expectedResinContainers: 0,
        returnedSolventContainers: 0,
        returnedResinContainers: 0,
        signoffLines: [{
          sourceLineId: vouSourceFacts.saleOrder.lineId,
          signedBaseQuantity: '1.000000',
          rejectedBaseQuantity: '0.000000',
        }],
      } satisfies VouPayloadFor<'sale-signoff'>,
    },
    {
      entity: 'expense-payment',
      payload: {
        businessDate: '2026-09-04', currency: 'CNY', attachments: [],
        employee: reference('employee'),
        fundAccount: reference('fundAccount'),
        handler: reference('employee'),
        amount: '0.00',
      } satisfies VouPayloadFor<'expense-payment'>,
    },
  ]
  for (const [index, item] of cases.entries()) {
    const documentId = fixtureId('J', index + 1)
    const submissionId = fixtureId('L', index + 1)
    const pending = await vou.submit(
      item.entity,
      'submit-new',
      {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: item.payload,
      },
      serviceActor(submitter.userId),
      `e2e-trusted-${item.entity}-submit`,
    )
    const approved = await vou.review(
      item.entity,
      'approve',
      { documentId, submissionId, expectedRevision: pending.revision },
      serviceActor(reviewer.userId),
      `e2e-trusted-${item.entity}-approve`,
    )
    const journalCount = await database.selectFrom('acc_journal_entries')
      .select('id').where('vou_approval_entry_id', '=', submissionId).execute()
    if (journalCount.length !== 1)
      throw new Error(`${item.entity} trusted approve did not post exactly once`)
    if (item.entity === 'sale-signoff') {
      const containers = await database.selectFrom('acc_container_entries')
        .select('id').where('vou_approval_entry_id', '=', submissionId).execute()
      if (containers.length !== 1)
        throw new Error('trusted sale-signoff did not persist its container effect')
    }
    const unapproved = await vou.review(
      item.entity,
      'unapprove',
      { documentId, submissionId, expectedRevision: approved.revision, reason: 'trusted lifecycle reversal' },
      serviceActor(reviewer.userId),
      `e2e-trusted-${item.entity}-unapprove`,
    )
    if (unapproved.status !== 'PENDING')
      throw new Error(`${item.entity} trusted unapprove did not return to PENDING`)
    const remaining = await Promise.all([
      database.selectFrom('acc_journal_entries').select('id').where('vou_approval_entry_id', '=', submissionId).execute(),
      database.selectFrom('acc_register_entries').select('id').where('vou_approval_entry_id', '=', submissionId).execute(),
      database.selectFrom('acc_container_entries').select('id').where('vou_approval_entry_id', '=', submissionId).execute(),
    ])
    if (remaining.some((rows) => rows.length !== 0))
      throw new Error(`${item.entity} trusted reversal left an ACC effect`)
    const actions = (await vou.auditHistory(item.entity, documentId, serviceActor(submitter.userId))).map((event) => event.action)
    if (!['SUBMITTED', 'APPROVED', 'UNAPPROVED'].every((action) => actions.includes(action)))
      throw new Error(`${item.entity} trusted lifecycle audit is incomplete`)
  }
}

async function seedVouAccObjects() {
  const auxActor = {
    id: submitter.userId,
    permissions: ['/aux/asset-category/create', '/aux/asset-category/delete'],
  }
  const assetCategory = await aux.create(
    'asset-category',
    {
      name: '目标资产类别',
      defaultUsefulLifeMonths: 60,
      defaultResidualRate: '0.00',
      description: '',
    },
    auxActor,
  )
  e2eAssetCategory = assetCategory
  const supplier = vouReferenceFacts.references.find(
    (reference) => reference.key === 'supplier',
  )!
  const department = auxReference('department')
  const asset = await vou.submit(
    'asset-acquisition',
    'submit-new',
    {
      documentId: vouAccObjectFacts.asset.documentId,
      submissionId: vouAccObjectFacts.asset.submissionId,
      idempotencyKey: vouAccObjectFacts.asset.submissionId,
      expectedRevision: null,
      payload: {
        businessDate: '2026-08-01',
        currency: 'CNY',
        attachments: [],
        supplier: {
          objectId: supplier.objectId,
          approvalEntryId: supplier.approvalEntryId,
          selectionOrigin: 'HISTORICAL',
        },
        assetAcquisitionLines: [
          {
            assetName: '目标资产',
            category: { objectId: assetCategory.objectId },
            originalValue: '100.00',
            usefulLifeMonths: 60,
            residualRate: '0.000000',
            department: { objectId: department.id },
          },
        ],
      },
    },
    serviceActor(submitter.userId),
    'e2e-asset-acquisition-submit',
  )
  await vou.review(
    'asset-acquisition',
    'approve',
    {
      documentId: asset.documentId,
      submissionId: asset.submissionId,
      expectedRevision: asset.revision,
    },
    serviceActor(reviewer.userId),
    'e2e-asset-acquisition-approve',
  )
  const bill = await vou.submit(
    'bill-issue',
    'submit-new',
    {
      documentId: vouAccObjectFacts.bill.documentId,
      submissionId: vouAccObjectFacts.bill.submissionId,
      idempotencyKey: vouAccObjectFacts.bill.submissionId,
      expectedRevision: null,
      payload: {
        businessDate: '2026-08-01',
        currency: 'CNY',
        attachments: [],
        supplier: { objectId: supplier.objectId },
        interestMode: 'BANK_DEDUCTED',
        billLines: [
          {
            positionType: 'ASSET',
            direction: 'IN',
            purpose: 'PRIMARY',
            billType: 'CHECK',
            billNo: `BIL-${suffix.slice(0, 8).toUpperCase()}`,
            medium: 'PAPER',
            currency: 'CNY',
            faceAmount: '100.00',
            issueDate: '2026-08-01',
            maturityDate: '2026-09-01',
            drawer: '目标出票人',
            acceptor: '目标承兑人',
            payee: '目标收款人',
            annualRateBps: 0,
          },
        ],
      },
    },
    serviceActor(submitter.userId),
    'e2e-bill-issue-submit',
  )
  await vou.review(
    'bill-issue',
    'approve',
    {
      documentId: bill.documentId,
      submissionId: bill.submissionId,
      expectedRevision: bill.revision,
    },
    serviceActor(reviewer.userId),
    'e2e-bill-issue-approve',
  )
  const [assets, bills] = await Promise.all([
    vou.queryReferenceCandidates(
      { entity: 'asset' },
      serviceActor(submitter.userId),
    ),
    vou.queryReferenceCandidates(
      { entity: 'bill' },
      serviceActor(submitter.userId),
    ),
  ])
  if (assets.items.length !== 1 || bills.items.length !== 1)
    throw new Error(
      'E2E VOU register fixture did not create exactly one asset and bill',
    )
  vouAccObjectFacts.asset.objectId = assets.items[0]!.objectId
  vouAccObjectFacts.bill.objectId = bills.items[0]!.objectId
}
try {
  await bootstrap.createE2EPrincipal(submitter)
  await bootstrap.createE2EPrincipal(reviewer)
  await seedAuxFacts(aux)
  await seedAccFacts(acc)
  await seedVouReferences(archives, warehouse)
  await seedVouAccObjects()
  await seedApprovedOpeningAndMappings()
  await seedApprovedSourceOrders()
  await verifyTrustedSystemVouLifecycle()

  const result = spawnSync('pnpm', ['--dir', 'frontend', 'test:target'], {
    cwd: resolve(import.meta.dirname, '../../..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      TARGET_E2E_USERNAME: submitter.username,
      TARGET_E2E_PASSWORD: submitter.password,
      TARGET_E2E_REVIEWER_USERNAME: reviewer.username,
      TARGET_E2E_REVIEWER_PASSWORD: reviewer.password,
      TARGET_E2E_MANAGER_EMPLOYEE_ID: managerEmployeeId,
      TARGET_E2E_MANAGER_APPROVAL_ENTRY_ID: managerApprovalEntryId,
      TARGET_E2E_STALE_MANAGER_APPROVAL_ENTRY_ID: staleManagerApprovalEntryId,
      TARGET_E2E_AUX_FACTS_JSON: JSON.stringify([
        ...archiveFacts.auxObjects,
        {
          id: e2eAssetCategory!.objectId,
          entity: 'asset-category',
          code: 'AST-E2E',
          data: { name: '目标资产类别' },
        },
      ]),
      TARGET_E2E_ACC_FACTS_JSON: JSON.stringify({
        book: accMappingUiFacts.book,
        vouEntity: archiveFacts.accounting.vouEntity,
      }),
      TARGET_E2E_VOU_REFERENCE_FACTS_JSON: JSON.stringify(
        Object.fromEntries(
          vouReferenceFacts.references.map((reference) => [
            reference.key,
            {
              entity: reference.entity,
              objectId: reference.objectId,
              approvalEntryId: reference.approvalEntryId,
              code: reference.code,
              name: reference.name,
            },
          ]),
        ),
      ),
      TARGET_E2E_VOU_ACC_OBJECT_FACTS_JSON: JSON.stringify({
        asset: { entity: 'asset', objectId: vouAccObjectFacts.asset.objectId },
        bill: { entity: 'bill', objectId: vouAccObjectFacts.bill.objectId },
      }),
      TARGET_E2E_VOU_SOURCE_FACTS_JSON: JSON.stringify(vouSourceFacts),
      TARGET_E2E_ACC_UI_FACTS_JSON: JSON.stringify(accUiFacts),
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  await sql`
    DELETE FROM acc_journal_entries
    WHERE vou_approval_entry_id IN (
      SELECT entry.id
      FROM approval_entries AS entry
      JOIN vou_documents AS document ON document.id = entry.subject_id
      WHERE entry.domain = 'vou' AND document.created_by = ${submitter.userId}
    )
  `.execute(database)
  try {
    let opening = await acc.getOpening(accUiFacts.book.id, serviceActor(submitter.userId))
    if (opening.approval.status === 'APPROVED')
      opening = await acc.reviewOpening(
        'unapprove',
        {
          bookId: opening.bookId,
          submissionId: opening.submissionId,
          expectedRevision: opening.approval.revision,
          reason: 'target E2E cleanup',
        },
        serviceActor(reviewer.userId),
        'e2e-acc-opening-cleanup-unapprove',
      )
    if (opening.approval.status === 'REJECTED')
      opening = await acc.reviewOpening(
        'unreject',
        {
          bookId: opening.bookId,
          submissionId: opening.submissionId,
          expectedRevision: opening.approval.revision,
        },
        serviceActor(reviewer.userId),
        'e2e-acc-opening-cleanup-unreject',
      )
    await acc.deleteOpening(
      {
        bookId: opening.bookId,
        submissionId: opening.submissionId,
        expectedRevision: opening.approval.revision,
      },
      serviceActor(submitter.userId),
      'e2e-acc-opening-cleanup-delete',
    )
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'approval_not_found')
      throw error
  }
  await bootstrap.deleteE2EWarehouseFixtures(submitter.userId)
  await deleteAccFixtureBooks([
    archiveFacts.accounting.book.id,
    accUiFacts.book.id,
    accMappingUiFacts.book.id,
  ])
  if (e2eAssetCategory) {
    await aux.delete(
      'asset-category',
      e2eAssetCategory.objectId,
      e2eAssetCategory.objectRevision,
      {
        id: submitter.userId,
        permissions: ['/aux/asset-category/delete'],
      },
    )
  }
  await deleteE2ECatalogFacts()
  await bootstrap.deleteE2EPrincipal(reviewer)
  await bootstrap.deleteE2EPrincipal(submitter)
  await rptValidationPool.end()
  await database.destroy()
}
