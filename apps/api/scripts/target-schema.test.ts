import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)

test('isolated target schema contains every target typed aggregate', async () => {
  const schema = await readFile(
    new URL('apps/api/db/target-schema.sql', root),
    'utf8',
  )
  const compose = await readFile(new URL('compose.target.yaml', root), 'utf8')
  const tables = [...schema.matchAll(/CREATE TABLE ([a-z0-9_]+)/g)].map(
    (match) => match[1],
  )
  assert.deepEqual(
    tables.filter((table) => !table.startsWith('vou_')),
    [
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
      'attachment_deletion_jobs',
      'dcl_warehouse_idempotency',
      'dcl_archive_idempotency',
      'dcl_customer_attachment_staging',
      'dcl_customer_attachments',
      'dcl_warehouse_reference_facts',
      'dcl_warehouse_usage_facts',
      'acc_books',
      'acc_book_access',
      'acc_subjects',
      'acc_opening_snapshots',
      'acc_periods',
      'acc_period_balances',
      'acc_journal_entries',
      'acc_journal_lines',
      'acc_inventory_entries',
      'acc_container_entries',
      'acc_asset_registers',
      'acc_asset_book_values',
      'acc_bill_registers',
      'acc_bill_book_values',
      'acc_register_entries',
      'acc_opening_container_balances',
      'wfl_definition_versions',
      'wfl_definition_runtime_states',
      'wfl_trials',
      'wfl_instances',
      'wfl_instance_nodes',
      'wfl_action_results',
      'wfl_runtime_audits',
      'rpt_execution_audits',
    ],
  )
  const vouDetails = [
    'sale-pricing',
    'sale-order',
    'sale-outbound',
    'sale-delivery',
    'sale-signoff',
    'sale-return',
    'purchase-order',
    'purchase-inbound',
    'purchase-return',
    'purchase-inquiry',
    'order-production',
    'self-production',
    'inventory-count',
    'sales-receipt',
    'purchase-refund',
    'other-receipt',
    'sales-refund',
    'purchase-payment',
    'other-payment',
    'employee-loan',
    'employee-repayment',
    'employee-loan-writeoff',
    'expense-reimbursement',
    'expense-payment',
    'other-income',
    'asset-acquisition',
    'asset-sale',
    'asset-liquidation',
    'bill-receipt',
    'bill-payment',
    'bill-issue',
    'bill-discount',
    'bill-maturity',
    'intermediary-calculation',
    'service-contract',
    'service-acceptance',
  ].map((entity) => `vou_${entity.replaceAll('-', '_')}_details`)
  for (const table of vouDetails) assert.ok(tables.includes(table), table)
  for (const table of [
    'vou_reference_snapshots',
    'vou_product_line_snapshots',
    'vou_price_line_snapshots',
    'vou_source_line_snapshots',
    'vou_expense_line_snapshots',
    'vou_bill_line_snapshots',
  ])
    assert.ok(tables.includes(table), table)
  for (const legacy of [
    'vou_document_payloads',
    'vou_document_detail_facts',
    'vou_document_line_facts',
    'vou_document_reference_facts',
  ])
    assert.ok(!tables.includes(legacy), legacy)
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
  assert.doesNotMatch(schema, /approval_entries[\s\S]*domain IN/)
  assert.doesNotMatch(schema, /approval_entries[\s\S]*domain = 'vou'/)
  const vouDocumentsDefinition = schema
    .slice(schema.indexOf('CREATE TABLE vou_documents'))
    .slice(
      0,
      schema.slice(schema.indexOf('CREATE TABLE vou_documents')).indexOf(');'),
    )
  assert.match(vouDocumentsDefinition, /entity varchar\(64\) NOT NULL/)
  assert.doesNotMatch(vouDocumentsDefinition, /CHECK \(entity IN/)
  assert.match(
    schema,
    /wfl_instances[\s\S]*approval_entry_id varchar\(26\) NOT NULL/,
  )
  assert.match(schema, /rpt_execution_audits/)
  assert.doesNotMatch(schema, /CREATE (?:FUNCTION|TRIGGER|PROCEDURE)/i)
  assert.match(schema, /'acc-mapping'/)
  assert.match(schema, /dcl_acc_mapping_versions/)
  assert.match(
    schema,
    /acc_journal_entries[\s\S]*source_kind varchar\(32\) NOT NULL DEFAULT 'VOU'/,
  )
  assert.match(schema, /acc_journal_entries_opening_source_unique/)
  assert.match(schema, /acc_register_entries_opening_source_unique/)
  assert.match(
    schema,
    /acc_period_balances[\s\S]*opening_balance numeric\(24, 8\) NOT NULL/,
  )
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
