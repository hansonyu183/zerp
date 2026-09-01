import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function source(path) {
  return readFile(new URL(path, root), 'utf8')
}

async function assertMissing(path) {
  await assert.rejects(access(new URL(path, root)))
}

test('retired Party and standalone customer-account public surfaces are absent', async () => {
  const [openapi, dcl, bob, schema, dclQueries, bobQueries] = await Promise.all(
    [
      source('contracts/openapi/openapi.yaml'),
      source('contracts/openapi/schemas/dcl.yaml'),
      source('contracts/openapi/schemas/bob.yaml'),
      source('backend/db/schema.sql'),
      source('backend/db/queries/dcl.sql'),
      source('backend/db/queries/bob_dcl_read.sql'),
    ],
  )

  assert.doesNotMatch(openapi, /\/(?:dcl|bob)\/party\//)
  assert.doesNotMatch(openapi, /\/dcl\/customer-account\//)
  assert.doesNotMatch(dcl, /'DclParty|'DclRelationship|'PartyIdentity/)
  assert.doesNotMatch(bob, /'Party(?:Query|Get|List|View|Identity)/)
  assert.doesNotMatch(
    schema,
    /dcl_part(?:y|ies)|dcl_(?:supplier|employment|service|sales)_relationships/,
  )
  assert.doesNotMatch(
    dclQueries,
    /dcl_part(?:y|ies)|dcl_(?:supplier|employment|service|sales)_relationships/,
  )
  assert.doesNotMatch(dclQueries, /GetDCLRelationshipIdentity/)
  assert.doesNotMatch(
    bobQueries,
    /dcl_part(?:y|ies)|dcl_(?:supplier|employment|service|sales)_relationships/,
  )

  await Promise.all([
    assertMissing('backend/internal/domains/dcl/party.go'),
    assertMissing('backend/internal/domains/dcl/party_handler.go'),
    assertMissing('backend/internal/domains/dcl/party_merge.go'),
    assertMissing('frontend/src/pages/dcl/party/Party.vue'),
    assertMissing('frontend/src/pages/bob/party/Party.vue'),
  ])
})

test('service contracts expose only typed archive counterparties', async () => {
  const [vou, schema, queries] = await Promise.all([
    source('contracts/openapi/schemas/vou.yaml'),
    source('backend/db/schema.sql'),
    source('backend/db/queries/vou_service_contracts.sql'),
  ])
  const start = vou.indexOf("  'VouServiceContractView':")
  const end = vou.indexOf("  'VouServiceAcceptanceView':", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const view = vou.slice(start, end)

  assert.match(view, /'counterparty'/)
  assert.doesNotMatch(view, /'partyId'|'partyName'/)

  const tableStart = schema.indexOf(
    'CREATE TABLE public.vou_service_contract_details',
  )
  const tableEnd = schema.indexOf('\n);', tableStart)
  assert.notEqual(tableStart, -1)
  assert.notEqual(tableEnd, -1)
  const table = schema.slice(tableStart, tableEnd)
  assert.doesNotMatch(table, /\bparty_id\b|\bparty_name\b/)
  assert.doesNotMatch(queries, /\bparty_id\b|\bparty_name\b/)
})

test('VOU list and bill-source contracts use counterparty names only', async () => {
  const vou = await source('contracts/openapi/schemas/vou.yaml')
  assert.match(vou, /'counterpartyObjectId'/)
  assert.match(vou, /'counterpartyName'/)
  assert.match(vou, /'originatingCounterparty'/)
  assert.doesNotMatch(vou, /'partyObjectId'|'partyName'|'originatingParty'/)
})

test('WFL instances retain typed counterparty snapshots without Party fields', async () => {
  const [wfl, schema, queries] = await Promise.all([
    source('contracts/openapi/schemas/wfl.yaml'),
    source('backend/db/schema.sql'),
    source('backend/db/queries/wfl.sql'),
  ])

  for (const field of [
    'counterparty',
    'entity',
    'objectId',
    'approvalEntryId',
    'code',
    'name',
  ]) {
    assert.match(wfl, new RegExp(`'${field}'`))
  }
  assert.doesNotMatch(wfl, /'partyObjectId'|'partyCode'|'partyName'/)
  assert.doesNotMatch(
    queries,
    /\bparty_object_id\b|\bparty_code\b|\bparty_name\b/,
  )

  const start = schema.indexOf('CREATE TABLE public.wfl_definition_instances')
  const end = schema.indexOf('\n);', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const table = schema.slice(start, end)
  for (const field of [
    'counterparty_entity',
    'counterparty_object_id',
    'counterparty_approval_entry_id',
    'counterparty_code',
    'counterparty_name',
  ]) {
    assert.match(table, new RegExp(`\\b${field}\\b`))
  }
  assert.doesNotMatch(
    table,
    /\bparty_object_id\b|\bparty_code\b|\bparty_name\b/,
  )
})

test('APP workbench and RPT bill references use counterparty wire terms', async () => {
  const [app, appQueries, rpt, rptQueries, schema] = await Promise.all([
    source('contracts/openapi/schemas/app.yaml'),
    source('backend/db/queries/app_workbench.sql'),
    source('contracts/openapi/schemas/rpt.yaml'),
    source('backend/db/queries/rpt.sql'),
    source('backend/db/schema.sql'),
  ])

  assert.match(app, /'counterpartyName'/)
  assert.doesNotMatch(app, /'partyName'/)
  assert.doesNotMatch(appQueries, /\bparty_name\b/)

  assert.match(rpt, /COUNTERPARTY/)
  assert.match(rpt, /RptCounterpartyReference/)
  assert.doesNotMatch(rpt, /OTHER_PARTY/)
  assert.doesNotMatch(rptQueries, /OriginParty|\bparties\b/)

  const start = schema.indexOf("true, '票据', '系统预置报表'")
  const end = schema.indexOf(
    'INSERT INTO public.dcl_rpt_definition_versions',
    start + 1,
  )
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const billsReport = schema.slice(start, end)
  assert.match(billsReport, /counterpartyObjectId/)
  assert.match(billsReport, /COUNTERPARTY/)
  assert.doesNotMatch(billsReport, /partyId|OTHER_PARTY|\bparty_id\b/)
})

test('VOU customer-account snapshots retain the root customer id', async () => {
  const schema = await source('backend/db/schema.sql')
  for (const tableName of [
    'vou_sale_order_details',
    'vou_sale_outbound_details',
    'vou_sale_delivery_details',
    'vou_sale_signoff_details',
    'vou_sale_return_details',
  ]) {
    const start = schema.indexOf(`CREATE TABLE public.${tableName}`)
    const end = schema.indexOf('\n);', start)
    assert.notEqual(start, -1)
    assert.notEqual(end, -1)
    assert.match(
      schema.slice(start, end),
      /customer_id character varying\(26\) NOT NULL/,
    )
  }

  for (const tableName of [
    'vou_asset_sale_details',
    'vou_bill_details',
    'vou_other_income_details',
    'vou_payment_details',
    'vou_receipt_details',
  ]) {
    const start = schema.indexOf(`CREATE TABLE public.${tableName}`)
    const end = schema.indexOf('\n);', start)
    assert.notEqual(start, -1)
    assert.notEqual(end, -1)
    assert.match(
      schema.slice(start, end),
      /counterparty_customer_id character varying\(26\)/,
    )
  }
})

test('ACC uses closed typed archive dimension wire values', async () => {
  const [acc, schema] = await Promise.all([
    source('contracts/openapi/schemas/acc.yaml'),
    source('backend/db/schema.sql'),
  ])
  const start = acc.indexOf("  'SubjectDimension':")
  const end = acc.indexOf("  'SettlementPurpose':", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const dimensions = acc.slice(start, end)

  for (const value of [
    'CUSTOMER_ACCOUNT',
    'SUPPLIER',
    'OTHER_UNIT',
    'EMPLOYEE',
    'SALES_PARTNER',
  ]) {
    assert.match(dimensions, new RegExp(`'${value}'`))
  }
  assert.doesNotMatch(
    dimensions,
    /SUPPLIER_RELATIONSHIP|SERVICE_RELATIONSHIP|EMPLOYMENT_RELATIONSHIP|SALES_RELATIONSHIP/,
  )
  assert.doesNotMatch(
    schema,
    /SUPPLIER_RELATIONSHIP|SERVICE_RELATIONSHIP|EMPLOYMENT_RELATIONSHIP|SALES_RELATIONSHIP/,
  )
})

test('ACC derived facts retain typed dimension snapshots and customer roots', async () => {
  const [schema, queries, events] = await Promise.all([
    source('backend/db/schema.sql'),
    source('backend/db/queries/acc.sql'),
    source('backend/internal/events/dclapproval/events.go'),
  ])
  for (const field of [
    'asset_dimension_references',
    'accumulated_dimension_references',
    'expense_dimension_references',
    'cost_counterpart_dimension_references',
  ]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`))
    assert.match(queries, new RegExp(`\\b${field}\\b`))
  }
  assert.equal(
    schema.match(/origin_counterparty_customer_id character varying\(26\)/g)
      ?.length,
    2,
  )
  assert.doesNotMatch(events, /PartyPayload|PartyTopic|dcl\.party\.approval/)
})

test('ACC voucher lines retain exact typed archive reference snapshots', async () => {
  const schema = await source('backend/db/schema.sql')
  const start = schema.indexOf('CREATE TABLE public.acc_voucher_lines')
  const end = schema.indexOf('\n);', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const table = schema.slice(start, end)

  assert.match(table, /dimension_references jsonb/)
  assert.match(table, /acc_voucher_lines_dimension_references_check/)
})
