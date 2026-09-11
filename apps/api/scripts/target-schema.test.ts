import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)

test('target schema preserves typed voucher storage and persistence boundaries', async () => {
  const schema = await readFile(
    new URL('apps/api/db/target-schema.sql', root),
    'utf8',
  )
  const compose = await readFile(new URL('compose.target.yaml', root), 'utf8')
  const tables = [...schema.matchAll(/CREATE TABLE ([a-z0-9_]+)/g)].map(
    (match) => match[1],
  )
  assert.doesNotMatch(
    schema,
    /\b(?:menu_group|menu_order|app_menu_settings|app_business_menu_items)\b/,
    'permission facts and the target schema must not retain menu-template state',
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
  assert.match(
    schema,
    /bob_subjects_customer_code_ck CHECK \(entity <> 'customer' OR code ~ '\^CUS-/,
  )
  for (const [entity, prefix] of [
    ['supplier', 'SUP'],
    ['other-unit', 'OTU'],
    ['employee', 'EMP'],
    ['sales-partner', 'SLP'],
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
  assert.match(schema, /acc_mapping_history/)
  assert.match(
    schema,
    /acc_journal_entries[\s\S]*source_kind varchar\(32\) NOT NULL DEFAULT 'VOU'/,
  )
  assert.match(schema, /acc_journal_entries_opening_source_unique/)
  assert.match(schema, /acc_register_entries_opening_source_unique/)
  const globalRegister = schema.slice(
    schema.indexOf('CREATE TABLE acc_register_entries ('),
    schema.indexOf('CREATE UNIQUE INDEX acc_register_entries'),
  )
  assert.doesNotMatch(
    globalRegister,
    /mapping_id|mapping_revision/,
    'global object effects are independent of per-book accounting mappings',
  )
  assert.match(
    schema,
    /acc_period_balances[\s\S]*opening_balance numeric\(24, 8\) NOT NULL/,
  )
  assert.match(schema, /rpt_definitions/)
  assert.match(schema, /status IN \('VALID', 'INVALID'\)/)
  assert.match(
    schema,
    /acc_mapping_vou_entities[\s\S]*field_catalog jsonb NOT NULL/,
  )
  assert.match(schema, /acc_subjects[\s\S]*required_dimensions jsonb NOT NULL/)
  assert.doesNotMatch(schema, /current_(?:version|approval)_?(?:id|entry)/i)
  assert.match(compose, /apps\/api\/db\/target-schema\.sql/)
})

test('production compose runs the Hono topology after catalog and online-test seeding', async () => {
  const compose = await readFile(new URL('compose.yaml', root), 'utf8')
  const productionCompose = await readFile(
    new URL('compose.production.yaml', root),
    'utf8',
  )
  const webDockerfile = await readFile(
    new URL('frontend/Dockerfile.target', root),
    'utf8',
  )
  const apiPackage = await readFile(
    new URL('apps/api/package.json', root),
    'utf8',
  )
  const productionTopology = `${compose}\n${productionCompose}`

  assert.match(productionTopology, /dockerfile: apps\/api\/Dockerfile/)
  assert.match(productionTopology, /apps\/api\/db\/target-schema\.sql/)
  assert.match(productionTopology, /catalog-sync/)
  assert.match(productionTopology, /pnpm', 'sync:catalog/)
  assert.match(productionTopology, /online-test-seed/)
  assert.match(productionTopology, /pnpm', 'seed:online-test/)
  assert.match(
    productionTopology,
    /APP_TEST_ADMIN_PASSWORD_FILE: \/run\/secrets\/test-admin-password/,
  )
  assert.match(
    productionTopology,
    /APP_TESTER_PASSWORD_FILE: \/run\/secrets\/tester-password/,
  )
  assert.match(
    productionTopology,
    /test-admin-password:[\s\S]*file: \$\{APP_TEST_ADMIN_PASSWORD_FILE:\?set APP_TEST_ADMIN_PASSWORD_FILE\}/,
  )
  assert.match(
    productionTopology,
    /tester-password:[\s\S]*file: \$\{APP_TESTER_PASSWORD_FILE:\?set APP_TESTER_PASSWORD_FILE\}/,
  )
  assert.match(
    apiPackage,
    /"seed:online-test": "node scripts\/seed-online-test-users\.ts"/,
  )
  assert.doesNotMatch(apiPackage, /bootstrap:admin/)
  assert.match(productionTopology, /TARGET_DATABASE_SCOPE: production/)
  assert.match(productionTopology, /frontend\/Dockerfile\.target/)
  assert.match(
    webDockerfile,
    /FROM nginx:[\s\S]*ARG VITE_TARGET_API_BASE_URL[\s\S]*ENV ZERP_API_BROWSER_URL=\$VITE_TARGET_API_BASE_URL/,
  )
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
