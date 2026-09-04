import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  auxRouteBinding,
  bobRouteBinding,
} from '../src/app/independent-contract.ts'
import {
  archiveCapabilityPermissionMetadata,
  archiveBlockerSchema,
  archiveReviewSchemas,
  archiveRouteSets,
  archiveSnapshotSchemas,
} from '../src/dcl/archive-contract.ts'
import { validateTargetRouteMetadata } from './target-artifacts.ts'

const generatedOpenApi = new URL(
  '../src/generated/openapi.json',
  import.meta.url,
)
const generatedCatalog = new URL(
  '../src/generated/target-permission-catalog.json',
  import.meta.url,
)

const userQuery = {
  method: 'post',
  path: '/app/user/query',
  permission: '/app/user/query',
  menu: { title: '用户管理', group: '系统管理', order: 10 },
} as const

test('target artifact gate rejects missing, duplicate, and extra route metadata', () => {
  assert.throws(
    () => validateTargetRouteMetadata(['POST /app/user/signin'], []),
    /missing=POST \/app\/user\/signin/,
  )
  assert.throws(
    () =>
      validateTargetRouteMetadata(
        ['POST /app/user/query'],
        [userQuery, userQuery],
      ),
    /duplicate target route metadata/,
  )
  assert.throws(
    () =>
      validateTargetRouteMetadata(
        ['POST /app/user/query'],
        [{ method: 'post', path: '/app/user/session' }],
      ),
    /missing=POST \/app\/user\/query extra=POST \/app\/user\/session/,
  )
})

test('target artifact gate emits one exact permission and menu catalog entry', () => {
  assert.deepEqual(
    validateTargetRouteMetadata(['POST /app/user/query'], [userQuery]),
    [
      {
        id: '01J4C89A32EE3460059789A73F',
        path: '/app/user/query',
        domain: 'app',
        entity: 'user',
        action: 'query',
        title: '用户管理',
        group: '系统管理',
        order: 10,
      },
    ],
  )
})

test('target artifact gate emits action permissions without creating duplicate menus', () => {
  assert.deepEqual(
    validateTargetRouteMetadata(
      ['POST /dcl/warehouse/approve'],
      [
        {
          method: 'post',
          path: '/dcl/warehouse/approve',
          permission: '/dcl/warehouse/approve',
          title: '批准仓库申报',
        },
      ],
    ),
    [
      {
        id: '01J9F8A0A4F06EBCAB84681A2E',
        path: '/dcl/warehouse/approve',
        domain: 'dcl',
        entity: 'warehouse',
        action: 'approve',
        title: '批准仓库申报',
        group: null,
        order: null,
      },
    ],
  )
})

test('target catalog emits a customer-subunit capability without inventing HTTP routes', () => {
  const catalog = validateTargetRouteMetadata(
    ['POST /dcl/customer/submit-new'],
    [
      {
        method: 'post',
        path: '/dcl/customer/submit-new',
        permission: '/dcl/customer/submit-new',
        title: '提交客户申报',
      },
    ],
    archiveCapabilityPermissionMetadata,
  )
  assert.ok(
    catalog.some((entry) => entry.path === '/dcl/customer/save-subunits'),
  )
  assert.throws(
    () =>
      validateTargetRouteMetadata(
        ['POST /dcl/customer/submit-new'],
        [
          {
            method: 'post',
            path: '/dcl/customer/submit-new',
            permission: '/dcl/customer/save-subunits',
            title: '错误的路由权限',
          },
        ],
        archiveCapabilityPermissionMetadata,
      ),
    /duplicate target permission paths/,
  )
})

test('archive wire contract closes review reason and reference semantics', () => {
  const review = {
    subjectId: '01J00000000000000000000001',
    submissionId: '01J00000000000000000000002',
    expectedRevision: '1',
  }
  assert.deepEqual(archiveReviewSchemas.withoutReason.parse(review), review)
  assert.throws(() =>
    archiveReviewSchemas.withoutReason.parse({ ...review, reason: 'x' }),
  )
  assert.throws(() => archiveReviewSchemas.withReason.parse(review))
  assert.deepEqual(
    archiveReviewSchemas.withReason.parse({ ...review, reason: '  reason  ' }),
    { ...review, reason: 'reason' },
  )
  const customer = archiveSnapshotSchemas.customer
  assert.throws(() =>
    customer.parse({
      identityKind: 'OTHER',
      legalName: '客户',
      displayName: '客户',
      legalIdentifier: 'C-1',
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
      enabled: true,
      subunits: [
        {
          intent: 'NEW',
          id: '01J00000000000000000000003',
          code: 'SUB-0001',
          name: '总部',
          contactName: '',
          address: '',
          customerType: '',
          settlementMethod: null,
          receiptMethod: '',
          transportMethod: '',
          pricePolicy: '',
          creditLimits: [],
          salesAttribution: null,
          internalReminder: '',
          defaultOrderRemark: '',
          attachments: [],
          enabled: true,
        },
      ],
    }),
  )
  assert.throws(() =>
    customer.parse({
      identityKind: 'OTHER',
      legalName: '客户',
      displayName: '客户',
      legalIdentifier: 'C-1',
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
      enabled: true,
      subunits: [
        {
          intent: 'EXISTING',
          id: '01J00000000000000000000003',
          code: 'SUB-0001',
          name: '总部',
          contactName: '',
          address: '',
          customerType: '',
          settlementMethod: {
            objectId: '01J00000000000000000000004',
            approvalEntryId: '01J00000000000000000000005',
            code: 'SET',
            name: '结算',
          },
          receiptMethod: '',
          transportMethod: '',
          pricePolicy: '',
          creditLimits: [],
          salesAttribution: null,
          internalReminder: '',
          defaultOrderRemark: '',
          attachments: [],
          enabled: true,
        },
      ],
    }),
  )
})

test('archive query contract uses the fixed page shell and entity-specific filters', () => {
  const input = {
    page: 1,
    pageSize: 20,
    filters: { keyword: 'water', status: 'APPROVED', enabled: true },
  }
  const operatingEntity =
    archiveRouteSets['operating-entity'].query.request.body.content[
      'application/json'
    ].schema
  assert.deepEqual(operatingEntity.parse(input), input)
  assert.throws(() =>
    operatingEntity.parse({
      ...input,
      filters: {
        ...input.filters,
        productTypeId: '01J00000000000000000000001',
      },
    }),
  )

  const product =
    archiveRouteSets.product.query.request.body.content['application/json']
      .schema
  assert.deepEqual(
    product.parse({
      ...input,
      filters: {
        productTypeId: '01J00000000000000000000001',
        productCategoryId: '01J00000000000000000000002',
      },
    }),
    {
      ...input,
      filters: {
        productTypeId: '01J00000000000000000000001',
        productCategoryId: '01J00000000000000000000002',
      },
    },
  )
  assert.throws(() => product.parse({ ...input, pageSize: 10 }))

  const mapping =
    archiveRouteSets['acc-mapping'].query.request.body.content[
      'application/json'
    ].schema
  assert.deepEqual(
    mapping.parse({
      ...input,
      filters: { bookId: '01J00000000000000000000001', vouEntity: 'SALE' },
    }),
    {
      ...input,
      filters: { bookId: '01J00000000000000000000001', vouEntity: 'SALE' },
    },
  )
})

test('archive failures expose only typed DCL and ACC blockers', () => {
  assert.deepEqual(
    archiveBlockerSchema.parse({
      kind: 'DCL_APPROVAL_REFERENCE',
      entity: 'vehicle',
      subjectId: '01J00000000000000000000001',
      submissionId: '01J00000000000000000000002',
      field: 'carrier',
      approvalEntryId: '01J00000000000000000000003',
    }),
    {
      kind: 'DCL_APPROVAL_REFERENCE',
      entity: 'vehicle',
      subjectId: '01J00000000000000000000001',
      submissionId: '01J00000000000000000000002',
      field: 'carrier',
      approvalEntryId: '01J00000000000000000000003',
    },
  )
  assert.deepEqual(
    archiveBlockerSchema.parse({
      kind: 'ACC_MAPPING_REFERENCE',
      mappingApprovalEntryId: '01J00000000000000000000003',
      documentType: 'VOUCHER',
      documentId: 'vou-1',
    }),
    {
      kind: 'ACC_MAPPING_REFERENCE',
      mappingApprovalEntryId: '01J00000000000000000000003',
      documentType: 'VOUCHER',
      documentId: 'vou-1',
    },
  )
  assert.throws(() =>
    archiveBlockerSchema.parse({
      entity: 'vehicle',
      field: 'carrier',
    }),
  )
})

test('only RPT get accepts an explicit owned approval entry', () => {
  const request = {
    subjectId: '01J00000000000000000000001',
    approvalEntryId: '01J00000000000000000000002',
  }
  const rptGet =
    archiveRouteSets['rpt-definition'].get.request.body.content[
      'application/json'
    ].schema
  assert.deepEqual(rptGet.parse(request), request)
  const productGet =
    archiveRouteSets.product.get.request.body.content['application/json'].schema
  assert.throws(() => productGet.parse(request))
})

test('independent route bindings carry the exact registered permission', () => {
  assert.deepEqual(auxRouteBinding('department', 'create'), {
    entity: 'department',
    action: 'create',
    permission: '/aux/department/create',
  })
  assert.deepEqual(bobRouteBinding('employee', 'get'), {
    entity: 'employee',
    action: 'get',
    permission: '/bob/employee/get',
  })
})

test('target OpenAPI contains the complete issue 363 APP, AUX, and BOB inventory', async () => {
  const document = JSON.parse(await readFile(generatedOpenApi, 'utf8')) as {
    paths: Record<string, unknown>
  }
  const paths = new Set(Object.keys(document.paths))
  const appPaths = [
    '/app/branding/get',
    '/app/menu/activate',
    '/app/menu/get',
    '/app/menu/reset-business',
    '/app/menu/save-business',
    '/app/permission/get',
    '/app/permission/query',
    '/app/role/create',
    '/app/role/disable',
    '/app/role/enable',
    '/app/role/get',
    '/app/role/query',
    '/app/role/save',
    '/app/system-parameter/get',
    '/app/system-parameter/query',
    '/app/system-parameter/reset',
    '/app/system-parameter/save',
    '/app/user/change-password',
    '/app/user/create',
    '/app/user/disable',
    '/app/user/enable',
    '/app/user/get',
    '/app/user/profile',
    '/app/user/query',
    '/app/user/reset-password',
    '/app/user/save',
    '/app/user/session',
    '/app/user/signin',
    '/app/user/signout',
  ]
  const auxEntities = [
    'product-category',
    'product-type',
    'employee-category',
    'department',
    'position',
    'settlement-method',
    'payment-method',
    'dictionary-type',
    'dictionary-item',
    'measurement-unit',
    'income-expense-type',
    'asset-category',
  ]
  const auxPaths = auxEntities.flatMap((entity) =>
    ['query', 'get', 'save', 'enable', 'disable', 'create', 'delete']
      .filter(
        (action) =>
          entity !== 'settlement-method' ||
          (action !== 'create' && action !== 'delete'),
      )
      .map((action) => `/aux/${entity}/${action}`),
  )
  auxPaths.push('/aux/reference/query')
  const bobPaths = [
    'customer',
    'supplier',
    'employee',
    'other-unit',
    'sales-partner',
    'product',
    'warehouse',
    'vehicle',
    'fund-account',
    'operating-entity',
  ].flatMap((entity) => [`/bob/${entity}/query`, `/bob/${entity}/get`])
  bobPaths.push('/bob/reference/query')

  for (const path of [...appPaths, ...auxPaths, ...bobPaths])
    assert.ok(paths.has(path), `missing issue #363 target path ${path}`)
  assert.ok(!paths.has('/app/workbench/query'), 'APP Workbench belongs to #366')
})

test('target OpenAPI contains every issue 364 DCL lifecycle route', async () => {
  const document = JSON.parse(await readFile(generatedOpenApi, 'utf8')) as {
    paths: Record<string, unknown>
  }
  const paths = new Set(Object.keys(document.paths))
  const entities = [
    'operating-entity',
    'vehicle',
    'fund-account',
    'product',
    'employee',
    'supplier',
    'customer',
    'other-unit',
    'sales-partner',
    'acc-mapping',
    'rpt-definition',
  ]
  const actions = [
    'query',
    'get',
    'versions',
    'audit-history',
    'submit-new',
    'submit-change',
    'approve',
    'reject',
    'unreject',
    'unapprove',
    'delete',
  ]
  for (const entity of entities)
    for (const action of actions)
      assert.ok(
        paths.has(`/dcl/${entity}/${action}`),
        `missing issue #364 target path /dcl/${entity}/${action}`,
      )
  assert.ok(paths.has('/dcl/customer/attachment-stage'))
  assert.ok(paths.has('/dcl/customer/attachment-cleanup'))
  for (const legacy of ['create', 'save', 'submit', 'unsubmit'])
    for (const entity of entities)
      assert.ok(
        !paths.has(`/dcl/${entity}/${legacy}`),
        `obsolete issue #364 path /dcl/${entity}/${legacy}`,
      )
})

test('archive query exposes summaries only and RPT get admits one owned version', async () => {
  const document = JSON.parse(await readFile(generatedOpenApi, 'utf8')) as {
    paths: Record<
      string,
      {
        post: {
          requestBody: { content: { 'application/json': { schema: unknown } } }
          responses: {
            200: { content: { 'application/json': { schema: unknown } } }
          }
        }
      }
    >
  }
  const querySchema =
    document.paths['/dcl/operating-entity/query']!.post.responses[200].content[
      'application/json'
    ].schema
  assert.doesNotMatch(JSON.stringify(querySchema), /"snapshot"/)

  const rptGetSchema =
    document.paths['/dcl/rpt-definition/get']!.post.requestBody.content[
      'application/json'
    ].schema
  assert.match(JSON.stringify(rptGetSchema), /"approvalEntryId"/)
  const productGetSchema =
    document.paths['/dcl/product/get']!.post.requestBody.content[
      'application/json'
    ].schema
  assert.doesNotMatch(JSON.stringify(productGetSchema), /"approvalEntryId"/)
})

test('target OpenAPI exposes typed ACC mapping current-read permissions', async () => {
  const document = JSON.parse(await readFile(generatedOpenApi, 'utf8')) as {
    paths: Record<string, unknown>
  }
  for (const path of [
    '/acc/mapping/query',
    '/acc/mapping/get',
    '/acc/mapping/catalog',
  ])
    assert.ok(document.paths[path])
  const catalog = JSON.parse(
    await readFile(generatedCatalog, 'utf8'),
  ) as Array<{
    path: string
  }>
  for (const path of [
    '/acc/mapping/query',
    '/acc/mapping/get',
    '/acc/mapping/catalog',
  ])
    assert.ok(catalog.some((entry) => entry.path === path))
})
