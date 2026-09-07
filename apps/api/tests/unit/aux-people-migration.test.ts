import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  auxPeopleEntityForHistoricalVouReference,
  auxPeoplePermissionMappings,
  convertAuxPeopleHistoricalData,
  planAuxPeopleSources,
  preserveLegacyAuxAssetPermissionCatalog,
  requiresAuxPeoplePermissionMigration,
  type AuxPeopleSourceEntry,
} from '../../src/aux/migration.ts'

const entry = (
  overrides: Partial<AuxPeopleSourceEntry>,
): AuxPeopleSourceEntry => ({
  id: '01J00000000000000000000000',
  subjectId: '01J10000000000000000000000',
  entity: 'operating-entity',
  versionNo: 1,
  status: 'APPROVED',
  ...overrides,
})

test('AUX people migration chooses the highest approved version and an only open V1', () => {
  const result = planAuxPeopleSources([
    entry({ id: 'approved-v1', versionNo: 1 }),
    entry({ id: 'approved-v2', versionNo: 2 }),
    entry({
      id: 'employee-v1',
      subjectId: 'employee-subject',
      entity: 'employee',
      status: 'PENDING',
      versionNo: 1,
    }),
  ])

  assert.deepEqual(result, {
    ok: true,
    sources: [
      {
        subjectId: '01J10000000000000000000000',
        entity: 'operating-entity',
        entryId: 'approved-v2',
        source: 'HIGHEST_APPROVED',
      },
      {
        subjectId: 'employee-subject',
        entity: 'employee',
        entryId: 'employee-v1',
        source: 'OPEN_V1',
      },
    ],
  })
})

test('AUX people migration blocks an open candidate beside approved history', () => {
  const result = planAuxPeopleSources([
    entry({ id: 'approved-v1', versionNo: 1 }),
    entry({ id: 'candidate-v2', versionNo: 2, status: 'REJECTED' }),
  ])

  assert.deepEqual(result, {
    ok: false,
    blockers: [
      {
        kind: 'UNRESOLVED_CANDIDATE',
        entity: 'operating-entity',
        subjectId: '01J10000000000000000000000',
        approvedEntryId: 'approved-v1',
        candidateEntryId: 'candidate-v2',
      },
    ],
  })
})

test('AUX people migration blocks a non-V1 candidate without current approved content', () => {
  const result = planAuxPeopleSources([
    entry({ id: 'candidate-v2', versionNo: 2, status: 'PENDING' }),
  ])

  assert.deepEqual(result, {
    ok: false,
    blockers: [
      {
        kind: 'UNRESOLVED_CANDIDATE',
        entity: 'operating-entity',
        subjectId: '01J10000000000000000000000',
        approvedEntryId: null,
        candidateEntryId: 'candidate-v2',
      },
    ],
  })
})

test('AUX people migration blocks multiple open candidates instead of choosing one', () => {
  const result = planAuxPeopleSources([
    entry({ id: 'rejected-v1', versionNo: 1, status: 'REJECTED' }),
    entry({ id: 'pending-v2', versionNo: 2, status: 'PENDING' }),
  ])

  assert.deepEqual(result, {
    ok: false,
    blockers: [
      {
        kind: 'UNRESOLVED_CANDIDATE',
        entity: 'operating-entity',
        subjectId: '01J10000000000000000000000',
        approvedEntryId: null,
        candidateEntryId: 'rejected-v1',
      },
    ],
  })
})

test('AUX people permission migration maps only confirmed authority', () => {
  assert.deepEqual(auxPeoplePermissionMappings, [
    {
      from: '/bob/operating-entity/query',
      to: ['/aux/operating-entity/query'],
    },
    {
      from: '/dcl/operating-entity/query',
      to: ['/aux/operating-entity/query'],
    },
    {
      from: '/bob/operating-entity/get',
      to: ['/aux/operating-entity/get'],
    },
    {
      from: '/dcl/operating-entity/get',
      to: ['/aux/operating-entity/get'],
    },
    {
      from: '/dcl/operating-entity/submit-new',
      to: ['/aux/operating-entity/create'],
    },
    {
      from: '/dcl/operating-entity/submit-change',
      to: [
        '/aux/operating-entity/save',
        '/aux/operating-entity/enable',
        '/aux/operating-entity/disable',
      ],
    },
    { from: '/bob/employee/query', to: ['/aux/employee/query'] },
    { from: '/dcl/employee/query', to: ['/aux/employee/query'] },
    { from: '/bob/employee/get', to: ['/aux/employee/get'] },
    { from: '/dcl/employee/get', to: ['/aux/employee/get'] },
    { from: '/dcl/employee/submit-new', to: ['/aux/employee/create'] },
    {
      from: '/dcl/employee/submit-change',
      to: [
        '/aux/employee/save',
        '/aux/employee/enable',
        '/aux/employee/disable',
      ],
    },
  ])

  assert.ok(
    !auxPeoplePermissionMappings.some(({ from }) =>
      /\/(approve|reject|unapprove|unreject|versions|audit-history|delete)$/.test(
        from,
      ),
    ),
  )
})

test('target schema keeps one AUX current root and allows new stable-reference snapshots', async () => {
  const schema = await readFile(
    new URL('../../db/target-schema.sql', import.meta.url),
    'utf8',
  )
  const auxObjects = schema.slice(
    schema.indexOf('CREATE TABLE aux_objects'),
    schema.indexOf('CREATE TABLE aux_reference_facts'),
  )
  assert.match(auxObjects, /'operating-entity', 'employee'/)
  assert.doesNotMatch(
    schema,
    /CREATE TABLE aux_(?:operating_entities|employees)/,
  )
  for (const table of [
    'dcl_supplier_version_operating_entities',
    'dcl_other_unit_version_operating_entities',
    'dcl_sales_partner_version_operating_entities',
  ]) {
    const definition = schema.slice(
      schema.indexOf(`CREATE TABLE ${table}`),
      schema.indexOf(');', schema.indexOf(`CREATE TABLE ${table}`)),
    )
    assert.match(
      definition,
      /operating_entity_approval_entry_id varchar\(26\),/,
    )
    assert.doesNotMatch(
      definition,
      /operating_entity_approval_entry_id varchar\(26\) NOT NULL/,
    )
  }
  const vouReferences = schema.slice(
    schema.indexOf('CREATE TABLE vou_reference_snapshots'),
    schema.indexOf(
      ');',
      schema.indexOf('CREATE TABLE vou_reference_snapshots'),
    ),
  )
  assert.match(
    vouReferences,
    /aux_snapshot jsonb CHECK \(aux_snapshot IS NULL OR jsonb_typeof\(aux_snapshot\) = 'object'\)/,
  )
})

test('ordinary catalog sync cannot erase legacy people grants before mapped migration', () => {
  assert.equal(
    requiresAuxPeoplePermissionMigration(
      ['/dcl/employee/submit-change'],
      ['/aux/employee/save', '/aux/employee/enable', '/aux/employee/disable'],
    ),
    true,
  )
  assert.equal(
    requiresAuxPeoplePermissionMigration(
      ['/aux/employee/save'],
      ['/aux/employee/save', '/aux/employee/enable', '/aux/employee/disable'],
    ),
    false,
  )
})

test('people migration keeps legacy asset permissions for the following atomic conversion', () => {
  const target = [
    {
      id: 'target',
      path: '/aux/warehouse/query',
      domain: 'aux',
      entity: 'warehouse',
      action: 'query',
      title: '查询仓库',
    },
  ]
  assert.deepEqual(
    preserveLegacyAuxAssetPermissionCatalog(target, [
      {
        id: 'legacy-asset',
        path: '/dcl/warehouse/submit-change',
        domain: 'dcl',
        entity: 'warehouse',
        action: 'submit-change',
        description: '旧仓库变更',
      },
      {
        id: 'unrelated',
        path: '/dcl/product/submit-change',
        domain: 'dcl',
        entity: 'product',
        action: 'submit-change',
        description: '产品变更',
      },
    ]),
    [
      target[0],
      {
        id: 'legacy-asset',
        path: '/dcl/warehouse/submit-change',
        domain: 'dcl',
        entity: 'warehouse',
        action: 'submit-change',
        title: '旧仓库变更',
      },
    ],
  )
})

test('historical employee conversion preserves all four adopted reference snapshots', () => {
  const data = convertAuxPeopleHistoricalData({
    entity: 'employee',
    row: {
      display_name: '张三',
      legal_name: '张三',
      legal_identifier: '310000000000000001',
      employee_category_id: '01J10000000000000000000001',
      department_id: '01J10000000000000000000002',
      position_id: '01J10000000000000000000003',
      operating_entity_id: '01J10000000000000000000004',
      operating_entity_code: 'OPE-0001',
      operating_entity_name: '旧主体名称',
      work_phone: null,
      work_email: 'zhangsan@example.com',
      hired_on: new Date('2020-01-02T00:00:00.000Z'),
      remark: null,
      source_snapshots: {
        identityKind: 'PERSON',
        contactName: '张三',
        phone: '13800000000',
        address: '旧地址',
        employeeCategory: {
          id: '01J10000000000000000000001',
          code: 'ECA-0001',
          name: '旧人员类别',
        },
        department: {
          id: '01J10000000000000000000002',
          code: 'DEP-0001',
          name: '旧部门',
        },
        position: {
          id: '01J10000000000000000000003',
          code: 'POS-0001',
          name: '旧岗位',
        },
      },
      enabled: true,
    },
  })

  assert.deepEqual(data.employeeCategory, {
    id: '01J10000000000000000000001',
    code: 'ECA-0001',
    name: '旧人员类别',
  })
  assert.deepEqual(data.department, {
    id: '01J10000000000000000000002',
    code: 'DEP-0001',
    name: '旧部门',
  })
  assert.deepEqual(data.position, {
    id: '01J10000000000000000000003',
    code: 'POS-0001',
    name: '旧岗位',
  })
  assert.deepEqual(data.operatingEntity, {
    id: '01J10000000000000000000004',
    code: 'OPE-0001',
    name: '旧主体名称',
  })
  assert.equal(data.employmentDate, '2020-01-02')
})

test('historical VOU people references use only the closed field/entity mapping', () => {
  assert.equal(
    auxPeopleEntityForHistoricalVouReference('operatingEntity', null),
    'operating-entity',
  )
  for (const field of [
    'employee',
    'handler',
    'salesperson',
    'purchaser',
    'custodian',
    'lines[0].employee',
  ])
    assert.equal(
      auxPeopleEntityForHistoricalVouReference(field, null),
      'employee',
    )
  assert.equal(
    auxPeopleEntityForHistoricalVouReference('counterparty', 'employee'),
    'employee',
  )
  assert.equal(
    auxPeopleEntityForHistoricalVouReference('counterparty', 'supplier'),
    null,
  )
  assert.throws(() =>
    auxPeopleEntityForHistoricalVouReference('operatingEntity', 'employee'),
  )
})
