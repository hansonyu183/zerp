import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

function schemaBlock(source, name, nextName) {
  const start = source.indexOf(`  '${name}':`)
  assert.notEqual(start, -1, `${name} must exist`)
  const end = nextName
    ? source.indexOf(`  '${nextName}':`, start)
    : source.length
  assert.notEqual(end, -1, `${nextName} must follow ${name}`)
  return source.slice(start, end)
}

test('typed business archive DCL contracts own identity and operating-entity facts', async () => {
  const dcl = await readFile(
    new URL('contracts/openapi/schemas/dcl.yaml', root),
    'utf8',
  )
  const common = await readFile(
    new URL('contracts/openapi/schemas/common.yaml', root),
    'utf8',
  )
  const customerIdentityKind = schemaBlock(
    common,
    'CustomerIdentityKind',
    'IdRequest',
  )
  const enumValues = customerIdentityKind.match(/'enum': \[([^\]]+)\]/s)
  assert.ok(enumValues, 'CustomerIdentityKind must declare an enum')
  assert.deepEqual(
    [...enumValues[1].matchAll(/'([^']+)'/g)].map((match) => match[1]),
    ['MAINLAND_ENTERPRISE', 'MAINLAND_INDIVIDUAL', 'OTHER'],
  )

  const cases = [
    ['DclCustomerRootInput', 'DclCustomerInput', ['defaultOperatingEntityId']],
    ['DclEmployeeInput', 'DclEmployeeData', ['currentOperatingEntityId']],
    [
      'DclSupplierInput',
      'DclSupplierData',
      ['operatingEntityIds', 'defaultOperatingEntityId'],
    ],
    [
      'DclOtherUnitInput',
      'DclOtherUnitData',
      ['operatingEntityIds', 'defaultOperatingEntityId'],
    ],
    [
      'DclSalesPartnerInput',
      'DclSalesPartnerData',
      ['operatingEntityIds', 'defaultOperatingEntityId'],
    ],
  ]

  for (const [inputName, nextName, operatingFields] of cases) {
    const block = schemaBlock(dcl, inputName, nextName)
    for (const field of ['kind', 'legalName', 'legalIdentifier', 'enabled']) {
      assert.match(
        block,
        new RegExp(`'${field}'\\s*:\\s*\\{`),
        `${inputName} must own ${field}`,
      )
    }
    for (const field of operatingFields) {
      assert.match(
        block,
        new RegExp(`'${field}'`),
        `${inputName} must own ${field}`,
      )
    }
    assert.equal(
      (block.match(/'legalIdentifier'\s*:\s*\{/g) || []).length,
      1,
      `${inputName} must expose one legalIdentifier field`,
    )
    for (const retiredField of ['strong' + 'Identifiers', 'tax' + 'Number']) {
      assert.doesNotMatch(
        block,
        new RegExp(`'${retiredField}'`),
        `${inputName} must not expose ${retiredField}`,
      )
    }
  }

  const operatingEntity = schemaBlock(
    dcl,
    'DclOperatingEntityData',
    'DclOperatingEntityCreateRequest',
  )
  assert.match(operatingEntity, /'taxNumber'\s*:/)

  for (const [requestName, nextName] of [
    ['DclEmployeeCreateRequest', 'DclEmployeeSaveRequest'],
    ['DclSupplierCreateRequest', 'DclSupplierSaveRequest'],
    ['DclOtherUnitCreateRequest', 'DclOtherUnitSaveRequest'],
    ['DclSalesPartnerCreateRequest', 'DclSalesPartnerSaveRequest'],
  ]) {
    const block = schemaBlock(dcl, requestName, nextName)
    assert.doesNotMatch(block, /'partyId'|'newParty'|'operatingEntityId'/)
    assert.match(block, /'data'/)
  }

  for (const [listName, nextName, operatingSummary] of [
    ['DclEmployeeListItem', 'DclEmployeeQueryPage', 'currentOperatingEntity'],
    ['DclSupplierListItem', 'DclSupplierQueryPage', 'defaultOperatingEntity'],
    ['DclOtherUnitListItem', 'DclOtherUnitQueryPage', 'defaultOperatingEntity'],
    [
      'DclSalesPartnerListItem',
      'DclSalesPartnerQueryPage',
      'defaultOperatingEntity',
    ],
  ]) {
    const block = schemaBlock(dcl, listName, nextName)
    for (const field of [
      'displayName',
      operatingSummary,
      'availableApprovalActions',
      'latestApproved',
      'openVersion',
      'updatedAt',
    ]) {
      assert.match(
        block,
        new RegExp(`'${field}'`),
        `${listName} must retain ${field}`,
      )
    }
    assert.doesNotMatch(block, /'partyId'|'partyKind'|'partyDisplayName'/)
  }
})

test('typed business archive current reads expose no Party relationship identity', async () => {
  const bob = await readFile(
    new URL('contracts/openapi/schemas/bob.yaml', root),
    'utf8',
  )

  for (const [name, nextName, dataName] of [
    ['BobEmployeeCurrentView', 'BobEmployeeListItem', 'DclEmployeeData'],
    ['BobSupplierCurrentView', 'BobSupplierListItem', 'DclSupplierData'],
    ['BobOtherUnitCurrentView', 'BobOtherUnitListItem', 'DclOtherUnitData'],
    [
      'BobSalesPartnerCurrentView',
      'BobSalesPartnerListItem',
      'DclSalesPartnerData',
    ],
  ]) {
    const block = schemaBlock(bob, name, nextName)
    assert.match(
      block,
      new RegExp(`'data': \\{ '\\$ref': './dcl.yaml#/${dataName}' \\}`),
    )
    assert.doesNotMatch(
      block,
      /'partyId'|'partyKind'|'partyDisplayName'|'relationshipId'/,
    )
  }
})

test('typed business archive snapshots persist identity without Party roots', async () => {
  const schema = await readFile(new URL('backend/db/schema.sql', root), 'utf8')

  for (const [table, nextTable] of [
    ['dcl_employee_versions', 'dcl_other_unit_versions'],
    ['dcl_other_unit_versions', 'dcl_sales_partner_versions'],
    ['dcl_sales_partner_versions', 'dcl_supplier_versions'],
    ['dcl_supplier_versions', 'dcl_customer_versions'],
    ['dcl_customer_versions', 'dcl_customer_subunit_roots'],
  ]) {
    const start = schema.indexOf(`CREATE TABLE public.${table}`)
    const end = schema.indexOf(`CREATE TABLE public.${nextTable}`, start)
    assert.notEqual(start, -1, `${table} must exist`)
    assert.notEqual(end, -1, `${nextTable} must follow ${table}`)
    const block = schema.slice(start, end)
    for (const column of ['kind', 'legal_identifier']) {
      assert.match(
        block,
        new RegExp(`\\b${column}\\b`),
        `${table} must own ${column}`,
      )
    }
    if (table !== 'dcl_customer_versions') {
      assert.match(block, /\blegal_name\b/, `${table} must own legal_name`)
    }
    assert.doesNotMatch(block, /\bparty_id\b/)
  }

  assert.doesNotMatch(schema, /CREATE TABLE public\.dcl_party/)

  const retiredVersionIdentifierTable = 'version' + '_identifiers'
  assert.doesNotMatch(
    schema,
    new RegExp(
      `CREATE TABLE public\\.dcl_[a-z_]+_${retiredVersionIdentifierTable}`,
    ),
  )

  for (const entity of [
    'employee',
    'supplier',
    'other_unit',
    'sales_partner',
    'customer',
  ]) {
    const legalIdentifierClaimsTable = 'legal_' + 'identifier_claims'
    assert.match(
      schema,
      new RegExp(
        `CREATE TABLE public\\.dcl_${entity}_${legalIdentifierClaimsTable}`,
      ),
      `${entity} must enforce legal identifier claims`,
    )
  }

  for (const entity of ['supplier', 'other_unit', 'sales_partner']) {
    assert.match(
      schema,
      new RegExp(
        `CREATE TABLE public\\.dcl_${entity}_version_operating_entities`,
      ),
      `${entity} versions must own their operating-entity set`,
    )
  }
})
