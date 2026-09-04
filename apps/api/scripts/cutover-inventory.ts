import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const executeFile = promisify(execFile)
const allowedApprovalStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED'])
const requiredWriters = ['api', 'wfl', 'scheduler', 'operator'] as const
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const statusInventorySql = resolve(
  root,
  'backend/db/cutovers/issue-366-approval-status-inventory.sql',
)
const mappedFactsInventorySql = resolve(root, 'backend/db/cutovers/issue-366-mapped-facts-inventory.sql')

type Snapshot = {
  identifier?: unknown
  capturedAt?: unknown
  checksum?: unknown
  freezeEvidenceId?: unknown
}

type FreezeEvidence = {
  id?: unknown
  observedAt?: unknown
  writers?: unknown
}

type WriterEvidence = {
  frozen?: unknown
  evidenceId?: unknown
  observedAt?: unknown
}

type ParsedArguments = {
  databaseUrl: string
  writerFreezeEvidence: string
  databaseSnapshot: string
  attachmentSnapshot: string
  output?: string
}

function usage(): string {
  return [
    'usage: cutover-inventory.ts inventory --database-url <url>',
    '  --writer-freeze-evidence <freeze.json>',
    '  --database-snapshot <database-snapshot.json>',
    '  --attachment-snapshot <attachment-snapshot.json> [--output <report.json>]',
  ].join('\n')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return nonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

function isChecksum(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function parseArguments(argv: string[]): ParsedArguments {
  if (argv[0] !== 'inventory') throw new Error(usage())
  const values = new Map<string, string>()
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw new Error(usage())
    if (values.has(key)) throw new Error(`duplicate argument: ${key}`)
    values.set(key, value)
  }
  const required = [
    '--database-url', '--writer-freeze-evidence', '--database-snapshot', '--attachment-snapshot',
  ]
  for (const key of required) if (!values.has(key)) throw new Error(usage())
  const known = new Set([...required, '--output'])
  for (const key of values.keys()) if (!known.has(key)) throw new Error(`unknown argument: ${key}`)
  return {
    databaseUrl: values.get('--database-url')!,
    writerFreezeEvidence: values.get('--writer-freeze-evidence')!,
    databaseSnapshot: values.get('--database-snapshot')!,
    attachmentSnapshot: values.get('--attachment-snapshot')!,
    output: values.get('--output'),
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

function validateEvidence(
  freeze: unknown,
  database: unknown,
  attachments: unknown,
): string[] {
  const failures: string[] = []
  if (!isObject(freeze)) return ['WRITER_FREEZE_EVIDENCE_INVALID']
  const freezeEvidence = freeze as FreezeEvidence
  if (!nonEmptyString(freezeEvidence.id) || !isTimestamp(freezeEvidence.observedAt))
    failures.push('WRITER_FREEZE_EVIDENCE_INVALID')
  if (!isObject(freezeEvidence.writers)) {
    failures.push('WRITER_FREEZE_EVIDENCE_INVALID')
  } else {
    for (const writer of requiredWriters) {
      const evidence = freezeEvidence.writers[writer]
      if (!isObject(evidence)) {
        failures.push(`WRITER_NOT_FROZEN:${writer}`)
        continue
      }
      const writerEvidence = evidence as WriterEvidence
      if (
        writerEvidence.frozen !== true
        || !nonEmptyString(writerEvidence.evidenceId)
        || !isTimestamp(writerEvidence.observedAt)
      ) failures.push(`WRITER_NOT_FROZEN:${writer}`)
    }
  }

  for (const [kind, snapshot] of [['DATABASE', database], ['ATTACHMENTS', attachments]] as const) {
    if (!isObject(snapshot)) {
      failures.push(`${kind}_SNAPSHOT_INVALID`)
      continue
    }
    const value = snapshot as Snapshot
    if (!nonEmptyString(value.identifier) || !isTimestamp(value.capturedAt) || !isChecksum(value.checksum))
      failures.push(`${kind}_SNAPSHOT_INVALID`)
    if (value.freezeEvidenceId !== freezeEvidence.id)
      failures.push(`${kind}_SNAPSHOT_FREEZE_DRIFT`)
  }
  return failures
}

async function queryApprovalStatuses(databaseUrl: string): Promise<Record<string, number>> {
  const { stdout } = await executeFile('psql', [
    '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align',
    '--field-separator=\t', '--dbname', databaseUrl, '--file', statusInventorySql,
  ], { maxBuffer: 1024 * 1024 })
  const counts: Record<string, number> = {}
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const [status, count, ...rest] = line.split('\t')
    if (!status || !count || rest.length > 0 || !/^[0-9]+$/.test(count))
      throw new Error('approval status inventory returned malformed output')
    counts[status] = Number(count)
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

async function queryMappedFactsChecksum(databaseUrl: string): Promise<string> {
  const { stdout } = await executeFile('psql', [
    '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align',
    '--dbname', databaseUrl, '--file', mappedFactsInventorySql,
  ], { maxBuffer: 64 * 1024 * 1024 })
  const serialized = stdout.trim()
  if (!serialized) throw new Error('mapped facts inventory returned empty output')
  return sha256(JSON.stringify(JSON.parse(serialized) as unknown))
}

function snapshotReport(snapshot: unknown): Record<string, string | undefined> {
  const value = snapshot as Snapshot
  return {
    identifier: typeof value.identifier === 'string' ? value.identifier : undefined,
    capturedAt: typeof value.capturedAt === 'string' ? value.capturedAt : undefined,
    checksum: typeof value.checksum === 'string' ? value.checksum : undefined,
    freezeEvidenceId: typeof value.freezeEvidenceId === 'string' ? value.freezeEvidenceId : undefined,
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const [freeze, database, attachments] = await Promise.all([
    readJson(args.writerFreezeEvidence),
    readJson(args.databaseSnapshot),
    readJson(args.attachmentSnapshot),
  ])
  const gateFailures = validateEvidence(freeze, database, attachments)
  let approvalStatusCounts: Record<string, number> = {}
  let mappedFactsChecksum: string | undefined
  if (gateFailures.length === 0) {
    [approvalStatusCounts, mappedFactsChecksum] = await Promise.all([
      queryApprovalStatuses(args.databaseUrl), queryMappedFactsChecksum(args.databaseUrl),
    ])
  }
  const invalidApprovalStatuses = Object.keys(approvalStatusCounts)
    .filter((status) => !allowedApprovalStatuses.has(status))
  const unresolvedDraftCount = approvalStatusCounts.DRAFT ?? 0
  const rejectedApprovalCount = approvalStatusCounts.REJECTED ?? 0
  const unresolvedCount = unresolvedDraftCount
  if (unresolvedDraftCount > 0) gateFailures.push('LEGACY_DRAFTS_PRESENT')
  if (invalidApprovalStatuses.length > 0) gateFailures.push('UNSUPPORTED_APPROVAL_STATUS_PRESENT')

  const writerFreeze = {
    evidenceId: isObject(freeze) && typeof freeze.id === 'string' ? freeze.id : undefined,
    observedAt: isObject(freeze) && typeof freeze.observedAt === 'string' ? freeze.observedAt : undefined,
  }
  const pairedSnapshots = {
    database: snapshotReport(database), attachments: snapshotReport(attachments),
  }
  const evidenceChecksum = sha256(JSON.stringify({ writerFreeze, pairedSnapshots }))
  const report = {
    kind: 'zerp-issue-366-cutover-inventory',
    version: 1,
    status: gateFailures.length === 0 ? 'READY_FOR_MAPPING_REVIEW' : 'BLOCKED',
    writerFreeze,
    pairedSnapshots,
    approvalStatusCounts,
    invalidApprovalStatuses,
    unresolvedDraftCount,
    rejectedApprovalCount,
    unresolvedCount,
    mappedFactsChecksum,
    evidenceChecksum,
    sourceChecksum: sha256(JSON.stringify({ approvalStatusCounts, mappedFactsChecksum, evidenceChecksum })),
    gateFailures: [...new Set(gateFailures)].sort(),
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (args.output) await writeFile(args.output, serialized)
  process.stdout.write(serialized)
  if (report.status === 'BLOCKED') process.exitCode = 2
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`cutover inventory failed: ${message}\n`)
  process.exitCode = 1
}
