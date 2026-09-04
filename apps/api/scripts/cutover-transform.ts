import { createHash, randomUUID } from 'node:crypto'
import { link, open, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const mappedLegacyTables = new Set(['app_users', 'approval_entries', 'approval_events'])
const allowedStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED'])
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const mappedFactsInventorySql = await readFile(resolve(root, 'backend/db/cutovers/issue-366-mapped-facts-inventory.sql'), 'utf8')

type Arguments = {
  sourceDatabaseUrl: string
  targetDatabaseUrl: string
  inventoryReport: string
  archive: string
  output?: string
}

type ApprovalEntry = {
  id: string
  domain: string
  entity: string
  subject_id: string
  version_no: number | null
  status: string
  revision: string
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
  submitted_by: string | null
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
}

type AppUser = {
  id: string
  username: string
  display_name: string
  password_hash: string
  status: string
  failed_signin_count: number
  locked_until: string | null
  password_changed_at: string
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
  revision: string
  password_change_required: boolean
}

type InventoryReport = {
  kind?: unknown
  status?: unknown
  unresolvedCount?: unknown
  sourceChecksum?: unknown
  mappedFactsChecksum?: unknown
  evidenceChecksum?: unknown
  approvalStatusCounts?: unknown
  writerFreeze?: unknown
  pairedSnapshots?: unknown
}

function checksum(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function usage(): string {
  return [
    'usage: cutover-transform.ts --source-database-url <url> --target-database-url <url>',
    '  --inventory-report <inventory.json> --archive <approval-events.json> [--output <report.json>]',
  ].join('\n')
}

function argumentsFrom(argv: string[]): Arguments {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(usage())
    if (values.has(key)) throw new Error(`duplicate argument: ${key}`)
    values.set(key, value)
  }
  const required = [
    '--source-database-url', '--target-database-url', '--inventory-report', '--archive',
  ]
  for (const key of required) if (!values.has(key)) throw new Error(usage())
  for (const key of values.keys()) {
    if (!new Set([...required, '--output']).has(key)) throw new Error(`unknown argument: ${key}`)
  }
  return {
    sourceDatabaseUrl: values.get('--source-database-url')!,
    targetDatabaseUrl: values.get('--target-database-url')!,
    inventoryReport: values.get('--inventory-report')!,
    archive: values.get('--archive')!,
    output: values.get('--output'),
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function canonicalStatusCounts(entries: ApprovalEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of entries) counts[entry.status] = (counts[entry.status] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

function validateEntry(entry: ApprovalEntry): string | undefined {
  if (!allowedStatuses.has(entry.status)) return `UNSUPPORTED_APPROVAL_STATUS:${entry.id}`
  if (entry.subject_id.length > 26) return `SUBJECT_ID_TOO_LONG_FOR_TARGET:${entry.id}`
  if (!entry.submitted_by || !entry.submitted_at) return `SUBMISSION_METADATA_MISSING:${entry.id}`
  if (entry.status === 'APPROVED' && (!entry.approved_by || !entry.approved_at))
    return `APPROVAL_METADATA_MISSING:${entry.id}`
  if (entry.status === 'REJECTED' && (!entry.rejected_by || !entry.rejected_at || !entry.rejection_reason?.trim()))
    return `REJECTION_METADATA_MISSING:${entry.id}`
  return undefined
}

async function countSourceTables(pool: pg.Pool): Promise<Record<string, number>> {
  const tables = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  )
  const counts: Record<string, number> = {}
  for (const { table_name: table } of tables.rows) {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.${quoteIdentifier(table)}`,
    )
    counts[table] = Number(result.rows[0]!.count)
  }
  return counts
}

async function writeArchive(path: string, events: unknown[]): Promise<{ checksum: string; created: boolean }> {
  const serialized = `${JSON.stringify({
    kind: 'zerp-issue-366-read-only-approval-events', version: 1, events,
  })}\n`
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(serialized)
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    await link(temporary, path)
    return { checksum: checksum(serialized), created: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if ((await readFile(path, 'utf8')) !== serialized)
      throw new Error('approval event archive already exists with different contents')
    return { checksum: checksum(serialized), created: false }
  } finally {
    await rm(temporary, { force: true })
  }
}

function inventorySourceChecksum(inventory: InventoryReport): string {
  return checksum(JSON.stringify({
    approvalStatusCounts: inventory.approvalStatusCounts,
    mappedFactsChecksum: inventory.mappedFactsChecksum,
    evidenceChecksum: inventory.evidenceChecksum,
  }))
}

function inventoryEvidenceChecksum(inventory: InventoryReport): string {
  return checksum(JSON.stringify({
    writerFreeze: inventory.writerFreeze,
    pairedSnapshots: inventory.pairedSnapshots,
  }))
}

async function mappedFactsChecksum(pool: pg.Pool): Promise<string> {
  const result = await pool.query<{ facts: string }>(mappedFactsInventorySql)
  const serialized = result.rows[0]?.facts
  if (typeof serialized !== 'string') throw new Error('mapped facts inventory returned malformed output')
  return checksum(JSON.stringify(JSON.parse(serialized) as unknown))
}

async function main(): Promise<void> {
  const args = argumentsFrom(process.argv.slice(2))
  const inventory = JSON.parse(await readFile(args.inventoryReport, 'utf8')) as InventoryReport
  if (
    inventory.kind !== 'zerp-issue-366-cutover-inventory'
    || inventory.status !== 'READY_FOR_MAPPING_REVIEW'
    || inventory.unresolvedCount !== 0
    || typeof inventory.sourceChecksum !== 'string'
    || typeof inventory.mappedFactsChecksum !== 'string'
    || typeof inventory.evidenceChecksum !== 'string'
    || typeof inventory.approvalStatusCounts !== 'object'
    || inventory.approvalStatusCounts === null
    || typeof inventory.writerFreeze !== 'object'
    || inventory.writerFreeze === null
    || typeof inventory.pairedSnapshots !== 'object'
    || inventory.pairedSnapshots === null
    || inventoryEvidenceChecksum(inventory) !== inventory.evidenceChecksum
    || inventorySourceChecksum(inventory) !== inventory.sourceChecksum
  ) throw new Error('inventory report is not an accepted zero-unresolved cutover input')

  const source = new pg.Pool({ connectionString: args.sourceDatabaseUrl })
  const target = new pg.Pool({ connectionString: args.targetDatabaseUrl })
  try {
    const sourceTableCounts = await countSourceTables(source)
    const unmappedNonEmptyTables = Object.entries(sourceTableCounts)
      .filter(([table, count]) => count > 0 && !mappedLegacyTables.has(table))
      .map(([table, count]) => ({ table, count }))
    const rejectionColumns = new Set((await source.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'approval_entries'",
    )).rows.map(({ column_name }) => column_name))
    const rejectionSelect = (column: 'rejected_by' | 'rejected_at' | 'rejection_reason'): string =>
      rejectionColumns.has(column)
        ? `${column}${column === 'rejected_at' ? '::text' : ''}`
        : `NULL::varchar AS ${column}`
    const [usersResult, entriesResult] = await Promise.all([
      source.query<AppUser>(
        `SELECT id, username, display_name, password_hash, status, failed_signin_count,
                locked_until::text, password_changed_at::text, created_at::text, created_by,
                updated_at::text, updated_by, revision::text, password_change_required
         FROM public.app_users ORDER BY id`,
      ),
      source.query<ApprovalEntry>(
      `SELECT id, domain, entity, subject_id, version_no, status, revision::text,
              created_by, created_at::text, updated_by, updated_at::text,
              submitted_by, submitted_at::text, approved_by, approved_at::text,
              ${rejectionSelect('rejected_by')}, ${rejectionSelect('rejected_at')},
              ${rejectionSelect('rejection_reason')}
       FROM public.approval_entries ORDER BY id`,
      ),
    ])
    const users = usersResult.rows
    const entries = entriesResult.rows
    const entryFailures = entries.map(validateEntry).filter((value): value is string => value !== undefined)
    const currentStatusCounts = canonicalStatusCounts(entries)
    const currentMappedFactsChecksum = await mappedFactsChecksum(source)
    const failures = [
      ...(JSON.stringify(currentStatusCounts) === JSON.stringify(inventory.approvalStatusCounts)
        && currentMappedFactsChecksum === inventory.mappedFactsChecksum ? [] : ['INVENTORY_INPUT_DRIFT']),
      ...entryFailures,
      ...(unmappedNonEmptyTables.length > 0 ? ['UNMAPPED_NONEMPTY_LEGACY_TABLES'] : []),
    ].sort()

    if (failures.length > 0) {
      const report = {
        kind: 'zerp-issue-366-cutover-transform', version: 1, status: 'BLOCKED',
        gateFailures: failures, sourceTableCounts, unmappedNonEmptyTables,
        before: { count: entries.length, checksum: checksum(JSON.stringify(entries)) },
        transformed: { count: 0, checksum: checksum('[]') },
        archived: { count: 0, checksum: checksum('[]') },
        rejected: { count: entryFailures.length + unmappedNonEmptyTables.length, checksum: checksum(JSON.stringify(failures)) },
      }
      const serialized = `${JSON.stringify(report, null, 2)}\n`
      if (args.output) await writeFile(args.output, serialized)
      process.stdout.write(serialized)
      process.exitCode = 2
      return
    }

    const events = (await source.query<{ event: unknown }>(
      'SELECT to_jsonb(approval_events) AS event FROM public.approval_events ORDER BY created_at, id',
    )).rows.map(({ event }) => event)
    let archive: Awaited<ReturnType<typeof writeArchive>> | undefined
    let targetCommitted = false
    const client = await target.connect()
    let cutoverLockHeld = false
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
      await client.query('SELECT pg_advisory_lock(hashtext($1))', ['zerp-issue-366-cutover'])
      cutoverLockHeld = true
      archive = await writeArchive(args.archive, events)
      for (const user of users) {
        await client.query(
          `INSERT INTO app_users (
            id, username, display_name, password_hash, status, failed_signin_count,
            locked_until, password_changed_at, created_at, created_by,
            updated_at, updated_by, revision, password_change_required
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
          )`,
          [
            user.id, user.username, user.display_name, user.password_hash, user.status,
            user.failed_signin_count, user.locked_until, user.password_changed_at,
            user.created_at, user.created_by, user.updated_at, user.updated_by,
            user.revision, user.password_change_required,
          ],
        )
      }
      for (const entry of entries) {
        await client.query(
          `INSERT INTO approval_entries (
            id, domain, entity, subject_id, version_no, status, revision,
            submitted_by, submitted_at, approved_by, approved_at,
            rejected_by, rejected_at, rejection_reason, updated_by, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13, $14, $15, $16
          )`,
          [
            entry.id, entry.domain, entry.entity, entry.subject_id, entry.version_no,
            entry.status, entry.revision, entry.submitted_by, entry.submitted_at,
            entry.approved_by, entry.approved_at, entry.rejected_by, entry.rejected_at,
            entry.rejection_reason, entry.updated_by, entry.updated_at,
          ],
        )
      }
      const transformedResult = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM approval_entries WHERE id = ANY($1::varchar[])',
        [entries.map((entry) => entry.id)],
      )
      if (Number(transformedResult.rows[0]!.count) !== entries.length)
        throw new Error('target approval count did not reconcile')
      const transformedUsers = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM app_users WHERE id = ANY($1::varchar[])',
        [users.map((user) => user.id)],
      )
      if (Number(transformedUsers.rows[0]!.count) !== users.length)
        throw new Error('target user count did not reconcile')
      await client.query('COMMIT')
      targetCommitted = true
    } catch (error) {
      if (!targetCommitted && archive?.created) await rm(args.archive, { force: true }).catch(() => undefined)
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      if (cutoverLockHeld)
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['zerp-issue-366-cutover']).catch(() => undefined)
      client.release()
    }
    if (!archive) throw new Error('approval event archive was not prepared')
    const report = {
      kind: 'zerp-issue-366-cutover-transform', version: 1, status: 'COMPLETE',
      before: { count: entries.length, checksum: checksum(JSON.stringify(entries)) },
      transformed: { count: entries.length, checksum: checksum(JSON.stringify(entries)) },
      archived: { count: events.length, checksum: archive.checksum },
      rejected: { count: 0, checksum: checksum('[]') },
      sourceTableCounts, unmappedNonEmptyTables: [],
      inventoryEvidence: {
        writerFreeze: inventory.writerFreeze, pairedSnapshots: inventory.pairedSnapshots,
        evidenceChecksum: inventory.evidenceChecksum, mappedFactsChecksum: inventory.mappedFactsChecksum,
      },
    }
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    if (args.output) await writeFile(args.output, serialized)
    process.stdout.write(serialized)
  } finally {
    await Promise.all([source.end(), target.end()])
  }
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`cutover transform failed: ${message}\n`)
  process.exitCode = 1
}
