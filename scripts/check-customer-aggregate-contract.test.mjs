import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

function seededReportBlock(schema, name) {
  const start = schema.indexOf(`true, '${name}', '系统预置报表'`)
  const nextReport = schema.indexOf(
    'INSERT INTO public.dcl_rpt_definition_versions',
    start + 1,
  )
  const end =
    nextReport === -1
      ? schema.indexOf(
          'INSERT INTO public.rpt_definition_validities',
          start + 1,
        )
      : nextReport
  assert.notEqual(start, -1, `missing seeded ${name} report`)
  assert.notEqual(end, -1, `missing end of seeded ${name} report`)
  return schema.slice(start, end)
}

function assertNoPartyTerminology(report) {
  assert.doesNotMatch(report, /\bparty_id\b|\bWINDOW party\b|\bOVER party\b/)
}

test('Customer is the only public lifecycle and current-read boundary for its subunits', async () => {
  const [openapi, dclSchema, bobSchema, bobReadQueries] = await Promise.all([
    readFile(new URL('contracts/openapi/openapi.yaml', root), 'utf8'),
    readFile(new URL('contracts/openapi/schemas/dcl.yaml', root), 'utf8'),
    readFile(new URL('contracts/openapi/schemas/bob.yaml', root), 'utf8'),
    readFile(new URL('backend/db/queries/bob_dcl_read.sql', root), 'utf8'),
  ])

  assert.doesNotMatch(openapi, /'\/(?:dcl|bob)\/customer-subunit\//)
  assert.doesNotMatch(
    dclSchema,
    /'DclCustomerSubunit(?:Create|Save|Version|Review|Get|History|Query|Mutation|View|List|Audit)/,
  )
  assert.doesNotMatch(
    bobSchema,
    /'BobCustomerSubunit(?:Query|Get|Current|List)/,
  )
  assert.match(dclSchema, /'DclCustomerInput'/)
  assert.match(dclSchema, /'subunits':[\s\S]*DclCustomerSubunitInput/)
  assert.match(dclSchema, /'subunitId'/)
  assert.doesNotMatch(dclSchema, /'isDefault'/)
  assert.match(openapi, /'\/dcl\/customer\/save-subunits'/)
  assert.match(
    bobReadQueries,
    /GetBobEmbeddedCustomerSubunitCurrentReference[\s\S]*WHERE[\s\S]*customer\.enabled AND line\.enabled/,
  )
  assert.match(
    bobReadQueries,
    /ListBobEmbeddedCustomerSubunitReferenceCandidates[\s\S]*JOIN dcl_customer_versions customer[\s\S]*WHERE customer\.enabled\s+AND line\.enabled/,
  )
  assert.doesNotMatch(
    `${dclSchema}\n${bobSchema}`,
    /customer-account|CustomerAccount|CUSTOMER_ACCOUNT/,
  )
})

test('Customer snapshots and seeded reports use the embedded subunit model', async () => {
  const [
    schema,
    rptQueries,
    rptService,
    rptOpenAPI,
    rptViewModel,
    e2eSetup,
    accOpenAPI,
    customerForm,
  ] = await Promise.all([
    readFile(new URL('backend/db/schema.sql', root), 'utf8'),
    readFile(new URL('backend/db/queries/rpt.sql', root), 'utf8'),
    readFile(new URL('backend/internal/domains/rpt/service.go', root), 'utf8'),
    readFile(new URL('contracts/openapi/schemas/rpt.yaml', root), 'utf8'),
    readFile(new URL('frontend/src/pages/rpt/vm.ts', root), 'utf8'),
    readFile(new URL('frontend/tests/e2e/wfl-global-setup.ts', root), 'utf8'),
    readFile(new URL('contracts/openapi/schemas/acc.yaml', root), 'utf8'),
    readFile(
      new URL('frontend/src/pages/dcl/customer/CustomerForm.vue', root),
      'utf8',
    ),
  ])
  const customerAgingReport = seededReportBlock(schema, '客户应收预收账龄')
  const supplierAgingReport = seededReportBlock(schema, '供应商应付预付账龄')
  const employeeLoansReport = seededReportBlock(schema, '员工借款')
  const containersReport = seededReportBlock(schema, '空桶')

  assert.match(schema, /dcl_customer_versions_data_shape_ck/)
  assert.match(schema, /dcl_customer_version_subunits_data_shape_ck/)
  assert.doesNotMatch(schema, /\bis_default\b|dcl_customer_account/)
  assert.doesNotMatch(schema, /implicitSubunitId/)
  assert.match(customerAgingReport, /e\.dimension_references/)
  assert.match(customerAgingReport, /AS customer_subunit_code/)
  assert.match(customerAgingReport, /AS customer_subunit_name/)
  assert.doesNotMatch(customerAgingReport, /JOIN dcl_customer/)
  assert.match(customerAgingReport, /AS customer_subunit_id/)
  assert.match(customerAgingReport, /WINDOW customer_subunit AS/)
  assert.match(customerAgingReport, /"key": "customerSubunitId"/)
  assertNoPartyTerminology(customerAgingReport)
  assert.match(supplierAgingReport, /AS supplier_id/)
  assert.match(supplierAgingReport, /WINDOW supplier AS/)
  assertNoPartyTerminology(supplierAgingReport)
  assert.match(employeeLoansReport, /AS employee_id/)
  assert.match(employeeLoansReport, /WINDOW employee AS/)
  assertNoPartyTerminology(employeeLoansReport)
  assert.match(containersReport, /e\.customer_subunit_id=\$2/)
  assert.match(containersReport, /"key": "customerSubunitId"/)
  assert.doesNotMatch(containersReport, /"key": "customerId"/)
  for (const alias of [
    'customer_subunit_id',
    'customer_id',
    'customer_approval_entry_id',
    'customer_subunit_code',
    'customer_subunit_name',
  ]) {
    assert.match(containersReport, new RegExp(`"alias": "${alias}"`))
  }
  assert.doesNotMatch(containersReport, /JOIN dcl_customer/)
  assert.doesNotMatch(
    schema,
    /dcl_subjects (?:p|customer) ON (?:p|customer)\.id=(?:x\.party_id|m\.customer_id) AND (?:p|customer)\.entity=''customer-subunit''/,
  )
  assert.match(rptQueries, /-- name: RptListCustomerSubunitReferences :many/)
  assert.match(rptQueries, /FROM dcl_customer_subunit_roots root/)
  assert.match(
    rptQueries,
    /JOIN dcl_subjects customer_root ON customer_root\.id=root\.customer_id AND customer_root\.entity='customer'/,
  )
  assert.match(
    rptQueries,
    /JOIN dcl_customer_versions customer ON customer\.approval_entry_id=entry\.id AND customer\.enabled/,
  )
  assert.match(
    rptQueries,
    /JOIN dcl_customer_version_subunits line ON line\.customer_approval_entry_id=entry\.id AND line\.subunit_id=root\.subunit_id/,
  )
  assert.match(rptQueries, /WHERE line\.enabled/)
  assert.match(e2eSetup, /collection: 'subunitAllocations'/)
  assert.match(e2eSetup, /CUSTOMER_SUBUNIT: 'subunit\.objectId'/)
  assert.doesNotMatch(e2eSetup, /CUSTOMER_SUBUNIT: 'account\.objectId'/)
  const openingContainerInput = accOpenAPI.slice(
    accOpenAPI.indexOf("'OpeningContainerInput':"),
    accOpenAPI.indexOf("'SaveAccountingOpeningRequest':"),
  )
  assert.match(
    openingContainerInput,
    /'subunit': \{ '\$ref': '#\/BusinessArchiveDimensionReference' \}/,
  )
  assert.doesNotMatch(openingContainerInput, /'customerId'/)
  assert.match(
    schema,
    /CREATE TABLE public\.acc_container_entries \([\s\S]*customer_subunit_id[\s\S]*customer_approval_entry_id[\s\S]*customer_subunit_code[\s\S]*customer_subunit_name/,
  )
  assert.match(customerForm, /responsive-table/)
  assert.match(customerForm, /data-label="编码"/)
  assert.match(customerForm, /ListRowActions/)
  const customerSubunitReferencesStart = rptQueries.indexOf(
    '-- name: RptListCustomerSubunitReferences :many',
  )
  const customerSubunitReferencesEnd = rptQueries.indexOf(
    '-- name: RptListBOBReferences :many',
    customerSubunitReferencesStart,
  )
  assert.notEqual(customerSubunitReferencesStart, -1)
  assert.notEqual(customerSubunitReferencesEnd, -1)
  const customerSubunitReferences = rptQueries.slice(
    customerSubunitReferencesStart,
    customerSubunitReferencesEnd,
  )
  assert.match(
    customerSubunitReferences,
    /customer_root\.code AS customer_code/,
  )
  assert.match(customerSubunitReferences, /coalesce\(nullif\(/)
  assert.match(customerSubunitReferences, /customer\.data->>'displayName'/)
  assert.match(customerSubunitReferences, /customer\.data->>'legalName'/)
  for (const field of ['code', 'name', 'customer_code', 'customer_name']) {
    assert.match(
      customerSubunitReferences,
      new RegExp(`reference\\.${field} ILIKE`),
    )
  }
  assert.match(
    customerSubunitReferences,
    /sqlc\.arg\(selected_id\)::text<>'' AND reference\.id=sqlc\.arg\(selected_id\)/,
  )
  const genericReferencesStart = rptQueries.indexOf(
    '-- name: RptListBOBReferences :many',
  )
  const genericReferencesEnd = rptQueries.indexOf(
    '-- RPT owns runtime validity',
    genericReferencesStart,
  )
  assert.notEqual(genericReferencesStart, -1)
  assert.notEqual(genericReferencesEnd, -1)
  const genericReferences = rptQueries.slice(
    genericReferencesStart,
    genericReferencesEnd,
  )
  assert.doesNotMatch(genericReferences, /'customer-subunit'/)
  assert.match(
    rptService,
    /case ReferenceTypeCustomerSubunit:[\s\S]*RptListCustomerSubunitReferences/,
  )
  assert.match(
    rptService,
    /customerCode, codeErr := requiredSubjectCode\(r\.CustomerCode\)[\s\S]*CustomerCode: customerCode/,
  )
  assert.doesNotMatch(rptService, /CustomerCode: value\(r\.CustomerCode\)/)
  assert.match(rptOpenAPI, /RptCustomerSubunitReference:/)
  assert.match(
    rptOpenAPI,
    /required: \[id, code, name, customerCode, customerName\]/,
  )
  assert.match(rptViewModel, /customerSubunit\.customerCode/)
  assert.match(rptViewModel, /customerSubunit\.customerName/)
})
