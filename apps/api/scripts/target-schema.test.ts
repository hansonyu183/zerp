import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)

test('isolated target schema contains every issue 364 typed DCL aggregate', async () => {
  const schema = await readFile(
    new URL('apps/api/db/target-schema.sql', root),
    'utf8',
  )
  const compose = await readFile(new URL('compose.target.yaml', root), 'utf8')
  const tables = [...schema.matchAll(/CREATE TABLE ([a-z0-9_]+)/g)].map(
    (match) => match[1],
  )
  assert.deepEqual(tables, [
    'app_users',
    'app_user_profiles',
    'app_permissions',
    'app_roles',
    'app_role_permissions',
    'app_user_roles',
    'app_sessions',
    'app_audit_events',
    'app_role_code_counters',
    'app_system_parameters',
    'app_menu_settings',
    'app_business_menu_items',
    'object_number_counters',
    'aux_objects',
    'aux_reference_facts',
    'dcl_code_counters',
    'dcl_subjects',
    'approval_entries',
    'dcl_customer_versions',
    'dcl_customer_subunit_roots',
    'dcl_customer_version_subunits',
    'dcl_supplier_versions',
    'dcl_supplier_version_operating_entities',
    'dcl_other_unit_versions',
    'dcl_other_unit_version_operating_entities',
    'dcl_employee_versions',
    'dcl_sales_partner_versions',
    'dcl_sales_partner_version_operating_entities',
    'dcl_product_versions',
    'dcl_warehouse_versions',
    'dcl_vehicle_versions',
    'dcl_fund_account_versions',
    'dcl_operating_entity_versions',
    'dcl_acc_mapping_versions',
    'dcl_rpt_definition_versions',
    'rpt_definition_validities',
    'dcl_acc_book_facts',
    'dcl_acc_vou_entity_facts',
    'dcl_acc_subject_facts',
    'dcl_acc_mapping_subject_usages',
    'dcl_acc_mapping_reference_facts',
    'approval_events',
    'dcl_warehouse_idempotency',
    'dcl_archive_idempotency',
    'dcl_customer_attachment_staging',
    'dcl_customer_attachments',
    'dcl_warehouse_manager_reference_facts',
    'dcl_warehouse_reference_facts',
    'dcl_warehouse_usage_facts',
  ])
  assert.doesNotMatch(schema, /\bbob_current_objects\b/)
  assert.doesNotMatch(schema, /\bbob_customer_subunits\b/)
  for (const [entity, prefix] of [
    ['customer', 'CUS'],
    ['supplier', 'SUP'],
    ['other-unit', 'OTU'],
    ['employee', 'EMP'],
    ['sales-partner', 'SLP'],
    ['product', 'PRD'],
    ['warehouse', 'WHS'],
    ['vehicle', 'VEH'],
    ['fund-account', 'FAC'],
    ['operating-entity', 'OPE'],
  ])
    assert.match(
      schema,
      new RegExp(
        `entity = '${entity}' AND code ~ '\\^${prefix}-\\[0-9\\]\\{4\\}\\$'`,
      ),
    )
  assert.match(
    schema,
    /entity = 'rpt-definition' AND code ~ '\^rpt-\[0-9\]\{6\}\$'/,
  )
  assert.match(schema, /status IN \('PENDING', 'APPROVED', 'REJECTED'\)/)
  assert.match(schema, /'acc-mapping'/)
  assert.match(schema, /dcl_acc_mapping_versions/)
  assert.match(schema, /dcl_rpt_definition_versions/)
  assert.match(schema, /status IN \('VALID', 'INVALID'\)/)
  assert.match(
    schema,
    /dcl_acc_vou_entity_facts[\s\S]*field_catalog jsonb NOT NULL/,
  )
  assert.match(
    schema,
    /dcl_acc_subject_facts[\s\S]*required_dimensions jsonb NOT NULL/,
  )
  assert.doesNotMatch(schema, /current_(?:version|approval)_?(?:id|entry)/i)
  for (const legacy of ['DRAFT', 'WITHDRAWN', 'REVOKED', 'UNSUBMITTED'])
    assert.doesNotMatch(schema, new RegExp(`\\b${legacy}\\b`))
  assert.match(compose, /apps\/api\/db\/target-schema\.sql/)
  assert.doesNotMatch(compose, /backend\/db\/schema\.sql/)
})

test('production compose remains on the live Go topology', async () => {
  const liveCompose = await readFile(new URL('compose.yaml', root), 'utf8')
  const productionCompose = await readFile(
    new URL('compose.production.yaml', root),
    'utf8',
  )
  const productionTopology = `${liveCompose}\n${productionCompose}`

  assert.match(productionTopology, /context: backend/)
  assert.match(productionTopology, /backend\/db\/schema\.sql/)
  assert.doesNotMatch(productionTopology, /target-api|apps\/api|18082/)
})

test('target frontend consumes only the inferred Hono client', async () => {
  const source = await readFile(
    new URL('frontend/src/target/api.ts', root),
    'utf8',
  )

  assert.match(source, /createTargetApiClient/)
  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /['"]\/(?:app|aux|bob)\//)
})
