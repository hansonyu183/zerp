import { createHash } from 'node:crypto'
import { readVouPersistence } from '../../vou/service.ts'
import { intermediarySourceHash } from '../../vou/intermediary-source.ts'
import { readFile } from 'node:fs/promises'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../../db/generated.ts'
import { AccService } from '../../acc/service.ts'
import { TargetBootstrapService } from '../../app/bootstrap.ts'
import type { TargetPermissionCatalogEntry } from '../../../scripts/target-artifacts.ts'
import {
  assignedId,
  canonical,
  digest,
  projectArchives,
  preserve,
  rows,
  str,
  type ConversionPlan,
  type Row,
  type Tables,
} from './plan.ts'
import { convertReferences } from './references.ts'
import { splitReceipts } from './receipts.ts'

type Executor = Kysely<DB> | Transaction<DB>
const shadow = 'customer_cutover_439_target'
const sourceSchema = 'customer_cutover_439_source'
const evidenceTable = 'dcl_customer_conversion_evidence'
interface Source {
  tables: Tables
  shape: Row[]
  ownership: Row[]
  grants: Row[]
  baseline: string
}
export class CustomerCutoverError extends Error {
  readonly reason: string
  readonly review: ConversionPlan['review']
  constructor(reason: string, review: ConversionPlan['review'] = []) {
    super(reason)
    this.name = 'CustomerCutoverError'
    this.reason = reason
    this.review = review
  }
}
async function source(db: Executor, schema = 'public'): Promise<Source> {
  const columns =
    await sql<Row>`SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema=${schema} ORDER BY table_name,ordinal_position`.execute(
      db,
    )
  const tables = await sql<{
    name: string
  }>`SELECT tablename AS name FROM pg_tables WHERE schemaname=${schema} ORDER BY tablename`.execute(
    db,
  )
  const ownership =
    await sql<Row>`SELECT c.relname AS name,pg_get_userbyid(c.relowner) AS owner,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relkind IN ('r','v') ORDER BY c.relname`.execute(
      db,
    )
  const grants =
    await sql<Row>`SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.table_privileges WHERE table_schema=${schema} ORDER BY table_name,grantee,privilege_type`.execute(
      db,
    )
  const content: Tables = {}
  for (const table of tables.rows) {
    const selected = columns.rows
      .filter((row) => row.table_name === table.name)
      .map((row) =>
        row.data_type === 'date'
          ? sql`${sql.id(str(row.column_name))}::text AS ${sql.id(str(row.column_name))}`
          : sql`${sql.id(str(row.column_name))}`,
      )
    content[table.name] = (
      await sql<Row>`SELECT ${sql.join(selected)} FROM ${sql.table(`${schema}.${table.name}`)}`.execute(
        db,
      )
    ).rows.sort((a, b) => canonical(a).localeCompare(canonical(b)))
  }
  const facts = Object.fromEntries(
    Object.entries(content).map(([table, data]) => [
      table,
      { count: data.length, digest: digest(data.map(canonical).sort()) },
    ]),
  )
  const metadata = {
    shape: columns.rows,
    ownership: ownership.rows,
    grants: grants.rows,
  }
  return {
    tables: content,
    ...metadata,
    baseline: digest({ facts, ...metadata }),
  }
}
function planConversion(input: Source) {
  if (
    !input.tables.dcl_customer_version_subunits ||
    !input.tables.dcl_customer_subunit_roots ||
    input.tables[evidenceTable]
  )
    throw new CustomerCutoverError('customer_cutover_source_schema_unsupported')
  const plan = projectArchives(input.tables)
  splitReceipts(plan)
  convertReferences(plan)
  // No old identifiers may remain in executable rules. Unknown forms require
  // review; an incomplete textual rewrite is never silently installed.
  for (const table of [
    'acc_mappings',
    'acc_mapping_history',
    'acc_mapping_vou_entities',
    'wfl_definition_versions',
    'rpt_definitions',
    'rpt_definition_history',
  ]) {
    for (const row of rows(plan.tables, table))
      if (
        /customerSubunit|CUSTOMER_SUBUNIT|customer-subunit|subunitAllocations|line\.subunit|subunit_id|subunit_roots|version_subunits/.test(
          canonical(row),
        )
      )
        plan.review.push({
          kind: 'EXECUTABLE_CUSTOMER_REFERENCE',
          table,
          identity: str(row.id ?? row.approval_entry_id ?? row.revision),
        })
  }
  for (const row of rows(input.tables, 'vou_intermediary_calculation_details'))
    preserve(plan, 'vou_intermediary_calculation_details', row)
  plan.review = [
    ...new Map(plan.review.map((item) => [canonical(item), item])).values(),
  ]
  return plan
}
export async function inspectCustomerCutover(db: Executor) {
  const original = await source(db)
  const plan = planConversion(original)
  return {
    baseline: original.baseline,
    customers: plan.customers,
    versions: plan.versions,
    receipts: plan.receipts,
    review: plan.review,
    ready: plan.review.length === 0,
  }
}
async function finance(
  db: Executor,
  schema: string,
  plan: ConversionPlan,
  phase: 'before' | 'after' = 'before',
) {
  const result = await sql<{
    book: string
    subject: string
    currency: string
    direction: string
    customer: string | null
    fund: string | null
    amount: string
    reversed: boolean
  }>`
    SELECT journal.book_id AS book,line.subject_id AS subject,journal.currency,line.direction,
      COALESCE(line.dimensions->>'CUSTOMER_SUBUNIT',line.dimensions->>'CUSTOMER') AS customer,
      line.dimensions->>'FUND_ACCOUNT' AS fund,journal.reversed_at IS NOT NULL AS reversed,SUM(line.amount)::text AS amount
    FROM ${sql.table(`${schema}.acc_journal_entries`)} journal JOIN ${sql.table(`${schema}.acc_journal_lines`)} line ON line.journal_entry_id=journal.id
    GROUP BY journal.book_id,line.subject_id,journal.currency,line.direction,customer,fund,reversed
  `.execute(db)
  const ledger = result.rows
    .map((row) => ({
      ...row,
      customer:
        row.customer && phase === 'before'
          ? (plan.customers.find((item) => item.oldSubunitId === row.customer)
              ?.customerId ?? row.customer)
          : row.customer,
    }))
    .sort((a, b) => canonical(a).localeCompare(canonical(b)))
  const money: Record<string, Row[]> = {}
  const headers = await sql<{
    name: string
  }>`SELECT table_name AS name FROM information_schema.columns WHERE table_schema=${schema} AND column_name='total_amount_minor' ORDER BY table_name`.execute(
    db,
  )
  for (const table of headers.rows) {
    const amounts = await sql<{
      document_id: string
      currency: string
      business_date: string
      amount: string
    }>`SELECT document_id,currency,business_date::text,total_amount_minor::text AS amount FROM ${sql.table(`${schema}.${table.name}`)}`.execute(
      db,
    )
    const grouped = new Map<
      string,
      {
        documentId: string
        currency: string
        businessDate: string
        amount: bigint
      }
    >()
    for (const row of amounts.rows) {
      const documentId =
        phase === 'after'
          ? (plan.receipts.find((item) => item.documentId === row.document_id)
              ?.oldDocumentId ?? row.document_id)
          : row.document_id
      const key = `${documentId}:${row.currency}:${row.business_date}`
      const existing = grouped.get(key)
      grouped.set(key, {
        documentId,
        currency: row.currency,
        businessDate: row.business_date,
        amount: (existing?.amount ?? 0n) + BigInt(row.amount),
      })
    }
    if (grouped.size)
      money[table.name] = [...grouped.values()]
        .map((row) => ({ ...row, amount: String(row.amount) }))
        .sort((a, b) => canonical(a).localeCompare(canonical(b)))
  }
  const containerQuantities: Record<string, Row[]> = {}
  for (const table of [
    'acc_container_entries',
    'acc_opening_container_balances',
  ]) {
    const quantity =
      table === 'acc_container_entries' ? 'quantity_delta' : 'quantity'
    const customer = phase === 'before' ? 'customer_subunit_id' : 'customer_id'
    const result =
      await sql<Row>`SELECT ${sql.id(customer)} AS customer,container_type,SUM(${sql.id(quantity)})::text AS quantity FROM ${sql.table(`${schema}.${table}`)} GROUP BY ${sql.id(customer)},container_type`.execute(
        db,
      )
    containerQuantities[table] = result.rows
      .map((row) => ({
        ...row,
        customer:
          phase === 'before'
            ? (plan.customers.find((item) => item.oldSubunitId === row.customer)
                ?.customerId ?? row.customer)
            : row.customer,
      }))
      .sort((a, b) => canonical(a).localeCompare(canonical(b)))
  }
  return { ledger, businessAmounts: money, containerQuantities }
}

async function rekeyDerivedFacts(tx: Transaction<DB>) {
  const calculations = await tx
    .selectFrom('vou_intermediary_calculation_details')
    .select(['approval_entry_id', 'document_id'])
    .execute()
  for (const row of calculations) {
    const document = await readVouPersistence(tx, {
      documentId: row.document_id,
    })
    if (!('intermediaryCalculation' in document.payload))
      throw new CustomerCutoverError(
        'customer_cutover_intermediary_snapshot_invalid',
      )
    const frozen = document.payload.intermediaryCalculation
    await tx
      .updateTable('vou_intermediary_calculation_details')
      .set({
        source_hash: intermediarySourceHash(frozen.source),
        script_hash: createHash('sha256')
          .update(frozen.script.source)
          .digest('hex'),
      })
      .where('approval_entry_id', '=', row.approval_entry_id)
      .execute()
  }
  for (const script of await tx
    .selectFrom('vou_intermediary_scripts')
    .select(['script_id', 'source'])
    .execute())
    await tx
      .updateTable('vou_intermediary_scripts')
      .set({ hash: createHash('sha256').update(script.source).digest('hex') })
      .where('script_id', '=', script.script_id)
      .execute()
  const definitions = await tx
    .selectFrom('wfl_definition_versions')
    .selectAll()
    .execute()
  if (definitions.length) {
    const { createNodeWflStarlark } = await import('@zerp/wfl-starlark/node')
    const runtime = await createNodeWflStarlark()
    for (const definition of definitions) {
      const result = await runtime.run({
        source: definition.script,
        operation: 'compile',
      })
      if (
        !result.ok ||
        canonical(result.graph) !== canonical(definition.compiled_graph)
      )
        throw new CustomerCutoverError(
          'customer_cutover_wfl_compile_mismatch',
          [
            {
              kind: 'WFL_COMPILE_MISMATCH',
              table: 'wfl_definition_versions',
              identity: definition.approval_entry_id,
            },
          ],
        )
    }
  }
}
async function validateTarget(tx: Transaction<DB>, plan: ConversionPlan) {
  const imbalanced =
    await sql<Row>`SELECT journal.id FROM acc_journal_entries journal JOIN acc_journal_lines line ON line.journal_entry_id=journal.id GROUP BY journal.id HAVING SUM(CASE WHEN line.direction='DEBIT' THEN line.amount ELSE -line.amount END)<>0`.execute(
      tx,
    )
  if (imbalanced.rows.length)
    throw new CustomerCutoverError(
      'customer_cutover_journal_unbalanced',
      imbalanced.rows.map((row) => ({
        kind: 'JOURNAL_UNBALANCED',
        table: 'acc_journal_entries',
        identity: str(row.id),
      })),
    )
  const missing =
    await sql<Row>`SELECT reference.approval_entry_id FROM vou_reference_snapshots reference LEFT JOIN approval_entries entry ON entry.id=reference.approval_reference_id LEFT JOIN dcl_customer_versions version ON version.approval_entry_id=entry.id WHERE reference.reference_entity='customer' AND (entry.id IS NULL OR entry.subject_id<>reference.object_id OR version.approval_entry_id IS NULL)`.execute(
      tx,
    )
  if (missing.rows.length)
    throw new CustomerCutoverError(
      'customer_cutover_customer_reference_mismatch',
    )
  const legacy =
    await sql<Row>`SELECT id FROM app_permissions WHERE path LIKE '%/customer/save-subunits'`.execute(
      tx,
    )
  if (legacy.rows.length)
    throw new CustomerCutoverError('customer_cutover_legacy_permission')
  const actual = await sql<{
    count: string
  }>`SELECT count(*)::text AS count FROM dcl_customer_versions`.execute(tx)
  if (Number(actual.rows[0]!.count) !== plan.versions.length)
    throw new CustomerCutoverError('customer_cutover_version_count_mismatch')
}
async function assertSchemaBoundary(tx: Transaction<DB>) {
  const dependencies =
    await sql<Row>`SELECT conname FROM pg_constraint WHERE contype='f' AND ((conrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')) <> (confrelid IN (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')))`.execute(
      tx,
    )
  const unsupported =
    await sql<Row>`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' UNION ALL SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('S','m','f')`.execute(
      tx,
    )
  const externalViews =
    await sql<Row>`SELECT view.relname FROM pg_depend dependency JOIN pg_rewrite rewrite ON rewrite.oid=dependency.objid JOIN pg_class view ON view.oid=rewrite.ev_class JOIN pg_namespace outside ON outside.oid=view.relnamespace JOIN pg_class referenced ON referenced.oid=dependency.refobjid JOIN pg_namespace inside ON inside.oid=referenced.relnamespace WHERE inside.nspname='public' AND outside.nspname<>'public'`.execute(
      tx,
    )
  const unknownViews =
    await sql<Row>`SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname<>'bob_archive_objects'`.execute(
      tx,
    )
  if (
    externalViews.rows.length ||
    unknownViews.rows.length ||
    dependencies.rows.length ||
    unsupported.rows.length
  )
    throw new CustomerCutoverError(
      'customer_cutover_external_schema_dependency',
    )
}
/** Offline, backed-up one-shot domain conversion. A transaction-local shadow
 * schema makes the complete target reviewable before the single atomic swap.
 * A failed import, reconciliation or catalog update rolls back DDL and facts. */
export async function migrateCustomers(
  db: Kysely<DB>,
  input: {
    baseline: string
    sourceReleaseSha: string
    targetReleaseSha: string
    actorId: string
  },
  catalog: readonly TargetPermissionCatalogEntry[],
) {
  const schemaSql = await readFile(
    new URL('../../../db/target-schema.sql', import.meta.url),
    'utf8',
  )
  const orderedTables = [
    ...schemaSql.matchAll(/CREATE TABLE ([a-z_]+)\s*\(/g),
  ].map((match) => match[1]!)
  return db.transaction().execute(async (tx) => {
    const names = await sql<{
      name: string
    }>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`.execute(
      tx,
    )
    await sql`LOCK TABLE ${sql.join(names.rows.map((row) => sql.table(`public.${row.name}`)))} IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    await assertSchemaBoundary(tx)
    const original = await source(tx)
    if (original.baseline !== input.baseline)
      throw new CustomerCutoverError('customer_cutover_baseline_changed')
    const operator = rows(original.tables, 'app_users').find(
      (row) => row.id === input.actorId && row.status === 'ENABLED',
    )
    const adminRoles = new Set(
      rows(original.tables, 'app_roles')
        .filter((row) => row.code === 'superadmin')
        .map((row) => row.id),
    )
    if (
      !operator ||
      !rows(original.tables, 'app_user_roles').some(
        (row) => row.user_id === input.actorId && adminRoles.has(row.role_id),
      )
    )
      throw new CustomerCutoverError('customer_cutover_operator_required')
    const plan = planConversion(original)
    if (plan.review.length)
      throw new CustomerCutoverError(
        'customer_cutover_review_required',
        plan.review,
      )
    if (
      Object.keys(plan.tables).some((table) => !orderedTables.includes(table))
    )
      throw new CustomerCutoverError('customer_cutover_unmanaged_table')
    const before = await finance(tx, 'public', plan)
    const now = new Date()
    for (const session of rows(plan.tables, 'app_sessions'))
      if (session.revoked_at == null) {
        session.revoked_at = now
        session.revoked_reason = 'customer_tax_cutover'
      }
    for (const tax of rows(plan.tables, 'aux_objects').filter(
      (row) =>
        row.entity === 'tax-information' &&
        !rows(original.tables, 'aux_objects').some((old) => old.id === row.id),
    )) {
      tax.created_by = input.actorId
      tax.updated_by = input.actorId
      tax.created_at = now
      tax.updated_at = now
      rows(plan.tables, 'app_audit_events').push({
        id: assignedId(`tax-audit:${input.baseline}:${tax.id}`),
        event_type: 'AUX_TAX_INFORMATION_CREATE',
        actor_user_id: input.actorId,
        target_type: 'tax-information',
        target_id: tax.id,
        result: 'SUCCESS',
        request_id: input.baseline,
        summary: {
          domain: 'aux',
          entity: 'tax-information',
          action: 'CREATE',
          revision: '1',
          conversionBaseline: input.baseline,
        },
        created_at: now,
        created_by: input.actorId,
      })
    }
    // Download tokens are disposable capabilities tied to the revoked sessions.
    plan.tables.vou_attachment_download_tokens = []
    const report = {
      ...input,
      customers: plan.customers,
      versions: plan.versions,
      receipts: plan.receipts,
      financial: before,
      originalEvidenceDigest: digest(plan.evidence),
    }
    plan.tables[evidenceTable] = [
      {
        baseline: input.baseline,
        source_release_sha: input.sourceReleaseSha,
        target_release_sha: input.targetReleaseSha,
        actor_user_id: input.actorId,
        created_at: now,
        report,
        originals: plan.evidence,
      },
    ]
    await sql`CREATE SCHEMA ${sql.id(shadow)}`.execute(tx)
    await sql`SET LOCAL search_path TO ${sql.id(shadow)}`.execute(tx)
    await sql.raw(schemaSql).execute(tx)
    await sql`TRUNCATE ${sql.join(orderedTables.map((table) => sql.table(`${shadow}.${table}`)))} CASCADE`.execute(
      tx,
    )
    for (const table of orderedTables) {
      const data = rows(plan.tables, table)
      if (!data.length) continue
      const columns = (
        await sql<{
          name: string
        }>`SELECT column_name AS name FROM information_schema.columns WHERE table_schema=${shadow} AND table_name=${table}`.execute(
          tx,
        )
      ).rows.map((row) => row.name)
      if (
        data.some((row) =>
          Object.keys(row).some((key) => !columns.includes(key)),
        )
      )
        throw new CustomerCutoverError('customer_cutover_unconverted_column', [
          { kind: 'UNCONVERTED_COLUMN', table, identity: '' },
        ])
      // Insert a table in one statement so self-references can point to any row.
      await sql`INSERT INTO ${sql.table(`${shadow}.${table}`)} SELECT * FROM json_populate_recordset(NULL::${sql.table(`${shadow}.${table}`)},${JSON.stringify(data)}::json)`.execute(
        tx,
      )
    }
    await sql`UPDATE acc_period_balances SET dimension_key=dimensions::text`.execute(
      tx,
    )
    await new TargetBootstrapService(db).syncPermissionCatalogInTransaction(
      tx,
      catalog,
    )
    const actualGrants = (
      await sql<{
        role_id: string
        path: string
      }>`SELECT rp.role_id,permission.path FROM app_role_permissions rp JOIN app_permissions permission ON permission.id=rp.permission_id`.execute(
        tx,
      )
    ).rows
    for (const role of rows(original.tables, 'app_roles')) {
      const oldPaths = rows(original.tables, 'app_role_permissions')
        .filter((row) => row.role_id === role.id)
        .map(
          (row) =>
            rows(original.tables, 'app_permissions').find(
              (permission) => permission.id === row.permission_id,
            )?.path,
        )
        .filter((path) => path && !/\/customer\/save-subunits$/.test(str(path)))
        .map(str)
        .sort()
      const newPaths = actualGrants
        .filter((row) => row.role_id === role.id)
        .map((row) => row.path)
        .sort()
      if (
        oldPaths.some((path) => !newPaths.includes(path)) ||
        (role.code !== 'superadmin' &&
          canonical(oldPaths) !== canonical(newPaths))
      )
        throw new CustomerCutoverError('customer_cutover_authority_mismatch')
    }
    await new AccService(db).syncVouEntityCatalogInTransaction(tx)
    await rekeyDerivedFacts(tx)
    await validateTarget(tx, plan)
    const after = await finance(tx, shadow, plan, 'after')
    if (canonical(before) !== canonical(after))
      throw new CustomerCutoverError('customer_cutover_financial_mismatch')
    // Restore existing table/view ownership and explicit grants before swapping.
    for (const owner of original.ownership.filter(
      (row) =>
        orderedTables.includes(str(row.name)) ||
        row.name === 'bob_archive_objects',
    ))
      await sql`ALTER ${sql.raw(owner.relkind === 'v' ? 'VIEW' : 'TABLE')} ${sql.table(`${shadow}.${owner.name}`)} OWNER TO ${sql.id(str(owner.owner))}`.execute(
        tx,
      )
    for (const grant of original.grants.filter(
      (row) =>
        orderedTables.includes(str(row.table_name)) ||
        row.table_name === 'bob_archive_objects',
    )) {
      if (
        ![
          'SELECT',
          'INSERT',
          'UPDATE',
          'DELETE',
          'TRUNCATE',
          'REFERENCES',
          'TRIGGER',
          'MAINTAIN',
        ].includes(str(grant.privilege_type))
      )
        throw new CustomerCutoverError('customer_cutover_unknown_privilege')
      await sql`GRANT ${sql.raw(str(grant.privilege_type))} ON ${sql.table(`${shadow}.${grant.table_name}`)} TO ${grant.grantee === 'PUBLIC' ? sql.raw('PUBLIC') : sql.id(str(grant.grantee))} ${sql.raw(grant.is_grantable === 'YES' ? 'WITH GRANT OPTION' : '')}`.execute(
        tx,
      )
    }
    const schemaOwner = (
      await sql<{
        owner: string
      }>`SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='public'`.execute(
        tx,
      )
    ).rows[0]!.owner
    const schemaGrants = await sql<{
      grantee: string
      privilege_type: string
      is_grantable: boolean
    }>`SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='public'`.execute(
      tx,
    )
    await sql`ALTER SCHEMA ${sql.id(shadow)} OWNER TO ${sql.id(schemaOwner)}`.execute(
      tx,
    )
    for (const grant of schemaGrants.rows) {
      if (!['USAGE', 'CREATE'].includes(grant.privilege_type))
        throw new CustomerCutoverError('customer_cutover_unknown_privilege')
      await sql`GRANT ${sql.raw(grant.privilege_type)} ON SCHEMA ${sql.id(shadow)} TO ${grant.grantee === 'PUBLIC' ? sql.raw('PUBLIC') : sql.id(grant.grantee)} ${sql.raw(grant.is_grantable ? 'WITH GRANT OPTION' : '')}`.execute(
        tx,
      )
    }
    await sql`ALTER SCHEMA public RENAME TO ${sql.id(sourceSchema)}`.execute(tx)
    await sql`ALTER SCHEMA ${sql.id(shadow)} RENAME TO public`.execute(tx)
    await sql`SET LOCAL search_path TO public`.execute(tx)
    await validateTarget(tx, plan)
    await sql`DROP SCHEMA ${sql.id(sourceSchema)} CASCADE`.execute(tx)
    return {
      ...report,
      preserved: true as const,
      customerVersions: plan.versions.length,
      taxInformation: rows(plan.tables, 'aux_objects').filter(
        (row) => row.entity === 'tax-information',
      ).length,
    }
  })
}
