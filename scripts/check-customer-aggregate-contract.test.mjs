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

test('Customer is the only public lifecycle and current-read boundary for its accounts', async () => {
  const [openapi, dclSchema, bobSchema] = await Promise.all([
    readFile(new URL('contracts/openapi/openapi.yaml', root), 'utf8'),
    readFile(new URL('contracts/openapi/schemas/dcl.yaml', root), 'utf8'),
    readFile(new URL('contracts/openapi/schemas/bob.yaml', root), 'utf8'),
  ])

  assert.doesNotMatch(openapi, /'\/(?:dcl|bob)\/customer-account\//)
  assert.doesNotMatch(
    dclSchema,
    /'DclCustomerAccount(?:Create|Save|Version|Review|Get|History|Query|Mutation|View|List|Audit)/,
  )
  assert.doesNotMatch(
    bobSchema,
    /'BobCustomerAccount(?:Query|Get|Current|List)/,
  )
  assert.match(dclSchema, /'DclCustomerInput'/)
  assert.match(dclSchema, /'accounts':[\s\S]*DclCustomerAccountInput/)
  assert.match(dclSchema, /'accountId'/)
  assert.match(dclSchema, /'isDefault'/)
})

test('Customer snapshots and seeded reports use the embedded account model', async () => {
  const [schema, rptQueries, rptService, rptOpenAPI, rptViewModel] =
    await Promise.all([
      readFile(new URL('backend/db/schema.sql', root), 'utf8'),
      readFile(new URL('backend/db/queries/rpt.sql', root), 'utf8'),
      readFile(
        new URL('backend/internal/domains/rpt/service.go', root),
        'utf8',
      ),
      readFile(new URL('contracts/openapi/schemas/rpt.yaml', root), 'utf8'),
      readFile(new URL('frontend/src/pages/rpt/vm.ts', root), 'utf8'),
    ])
  const customerAgingReport = seededReportBlock(schema, '客户应收预收账龄')
  const supplierAgingReport = seededReportBlock(schema, '供应商应付预付账龄')
  const employeeLoansReport = seededReportBlock(schema, '员工借款')

  assert.match(schema, /dcl_customer_versions_data_shape_ck/)
  assert.match(schema, /dcl_customer_version_accounts_data_shape_ck/)
  assert.match(
    customerAgingReport,
    /LEFT JOIN dcl_customer_account_roots account ON account\.account_id=x\.customer_account_id/,
  )
  assert.match(customerAgingReport, /AS customer_account_id/)
  assert.match(customerAgingReport, /WINDOW customer_account AS/)
  assert.match(customerAgingReport, /"key": "customerAccountId"/)
  assertNoPartyTerminology(customerAgingReport)
  assert.match(supplierAgingReport, /AS supplier_id/)
  assert.match(supplierAgingReport, /WINDOW supplier AS/)
  assertNoPartyTerminology(supplierAgingReport)
  assert.match(employeeLoansReport, /AS employee_id/)
  assert.match(employeeLoansReport, /WINDOW employee AS/)
  assertNoPartyTerminology(employeeLoansReport)
  assert.match(
    schema,
    /LEFT JOIN dcl_customer_account_roots account ON account\.account_id=m\.customer_id/,
  )
  assert.doesNotMatch(
    schema,
    /dcl_subjects (?:p|customer) ON (?:p|customer)\.id=(?:x\.party_id|m\.customer_id) AND (?:p|customer)\.entity=''customer-account''/,
  )
  assert.match(rptQueries, /-- name: RptListCustomerAccountReferences :many/)
  assert.match(rptQueries, /FROM dcl_customer_account_roots root/)
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
    /JOIN dcl_customer_version_accounts line ON line\.customer_approval_entry_id=entry\.id AND line\.account_id=root\.account_id/,
  )
  assert.match(rptQueries, /WHERE line\.enabled/)
  const customerAccountReferencesStart = rptQueries.indexOf(
    '-- name: RptListCustomerAccountReferences :many',
  )
  const customerAccountReferencesEnd = rptQueries.indexOf(
    '-- name: RptListBOBReferences :many',
    customerAccountReferencesStart,
  )
  assert.notEqual(customerAccountReferencesStart, -1)
  assert.notEqual(customerAccountReferencesEnd, -1)
  const customerAccountReferences = rptQueries.slice(
    customerAccountReferencesStart,
    customerAccountReferencesEnd,
  )
  assert.match(
    customerAccountReferences,
    /customer_root\.code AS customer_code/,
  )
  assert.match(customerAccountReferences, /coalesce\(nullif\(/)
  assert.match(customerAccountReferences, /customer\.data->>'displayName'/)
  assert.match(customerAccountReferences, /customer\.data->>'legalName'/)
  for (const field of ['code', 'name', 'customer_code', 'customer_name']) {
    assert.match(
      customerAccountReferences,
      new RegExp(`reference\\.${field} ILIKE`),
    )
  }
  assert.match(
    customerAccountReferences,
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
  assert.doesNotMatch(genericReferences, /'customer-account'/)
  assert.match(
    rptService,
    /case ReferenceTypeCustomerAccount:[\s\S]*RptListCustomerAccountReferences/,
  )
  assert.match(rptService, /CustomerCode: value\(r\.CustomerCode\)/)
  assert.match(rptOpenAPI, /RptCustomerAccountReference:/)
  assert.match(
    rptOpenAPI,
    /required: \[id, code, name, customerCode, customerName\]/,
  )
  assert.match(rptViewModel, /customerAccount\.customerCode/)
  assert.match(rptViewModel, /customerAccount\.customerName/)
})
