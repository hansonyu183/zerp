import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

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
  const schema = await readFile(new URL('backend/db/schema.sql', root), 'utf8')

  assert.match(schema, /dcl_customer_versions_data_shape_ck/)
  assert.match(schema, /dcl_customer_version_accounts_data_shape_ck/)
  assert.match(
    schema,
    /LEFT JOIN dcl_customer_account_roots account ON account\.account_id=x\.party_id/,
  )
  assert.match(
    schema,
    /LEFT JOIN dcl_customer_account_roots account ON account\.account_id=m\.customer_id/,
  )
  assert.doesNotMatch(
    schema,
    /dcl_subjects (?:p|customer) ON (?:p|customer)\.id=(?:x\.party_id|m\.customer_id) AND (?:p|customer)\.entity=''customer-account''/,
  )
})
