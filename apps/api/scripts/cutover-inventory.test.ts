import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)
const script = new URL('apps/api/scripts/cutover-inventory.ts', root)

type CommandResult = { code: number | null; stderr: string }

async function runCutoverCli(
  directory: string,
  statuses: string[],
  output: string,
): Promise<CommandResult> {
  const psql = join(directory, 'psql')
  await writeFile(
    psql,
    `#!/bin/sh
case "$*" in
  *issue-366-mapped-facts-inventory.sql*) printf '%s\\n' '{"users":[],"approvals":[],"events":[]}' ;;
  *) ${statuses.map((status) => `printf '%s\\t%s\\n' '${status}' 1`).join('\n  ')} ;;
esac
`,
  )
  await chmod(psql, 0o755)

  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        script.pathname,
        'inventory',
        '--database-url',
        'postgres://operator@localhost/zerp',
        '--writer-freeze-evidence',
        join(directory, 'freeze.json'),
        '--database-snapshot',
        join(directory, 'database.json'),
        '--attachment-snapshot',
        join(directory, 'attachments.json'),
        '--output',
        output,
      ],
      { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } },
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

async function writeEvidence(directory: string): Promise<void> {
  const timestamp = '2026-09-05T00:00:00.000Z'
  const checksum = 'a'.repeat(64)
  const freezeEvidenceId = 'freeze-20260905-0001'
  await Promise.all([
    writeFile(join(directory, 'freeze.json'), JSON.stringify({
      id: freezeEvidenceId,
      observedAt: timestamp,
      writers: Object.fromEntries(
        ['api', 'wfl', 'scheduler', 'operator'].map((writer) => [writer, {
          frozen: true,
          evidenceId: `${writer}-freeze-proof`,
          observedAt: timestamp,
        }]),
      ),
    })),
    writeFile(join(directory, 'database.json'), JSON.stringify({
      identifier: 'db-snapshot-001', capturedAt: timestamp, checksum, freezeEvidenceId,
    })),
    writeFile(join(directory, 'attachments.json'), JSON.stringify({
      identifier: 'attachments-snapshot-001', capturedAt: timestamp, checksum, freezeEvidenceId,
    })),
  ])
}

test('operator inventory fails closed and emits a report for legacy Draft or unsupported Approval status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zerp-cutover-'))
  const output = join(directory, 'inventory.json')
  try {
    await writeEvidence(directory)
    const result = await runCutoverCli(directory, ['APPROVED', 'DRAFT', 'WITHDRAWN'], output)

    assert.equal(result.code, 2, result.stderr)
    const report = JSON.parse(await readFile(output, 'utf8')) as {
      status: string
      approvalStatusCounts: Record<string, number>
      invalidApprovalStatuses: string[]
      unresolvedDraftCount: number
      unresolvedCount: number
    }
    assert.equal(report.status, 'BLOCKED')
    assert.deepEqual(report.approvalStatusCounts, {
      APPROVED: 1,
      DRAFT: 1,
      WITHDRAWN: 1,
    })
    assert.deepEqual(report.invalidApprovalStatuses, ['DRAFT', 'WITHDRAWN'])
    assert.equal(report.unresolvedDraftCount, 1)
    assert.equal(report.unresolvedCount, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('operator inventory accepts a frozen, paired snapshot with target Approval statuses only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zerp-cutover-'))
  const output = join(directory, 'inventory.json')
  try {
    await writeEvidence(directory)
    const result = await runCutoverCli(directory, ['PENDING', 'APPROVED', 'REJECTED'], output)

    assert.equal(result.code, 0, result.stderr)
    const report = JSON.parse(await readFile(output, 'utf8')) as {
      status: string
      sourceChecksum: string
      mappedFactsChecksum: string
      evidenceChecksum: string
      pairedSnapshots: { database: { identifier: string }; attachments: { identifier: string } }
    }
    assert.equal(report.status, 'READY_FOR_MAPPING_REVIEW')
    assert.match(report.sourceChecksum, /^[a-f0-9]{64}$/)
    assert.match(report.mappedFactsChecksum, /^[a-f0-9]{64}$/)
    assert.match(report.evidenceChecksum, /^[a-f0-9]{64}$/)
    assert.equal(report.pairedSnapshots.database.identifier, 'db-snapshot-001')
    assert.equal(report.pairedSnapshots.attachments.identifier, 'attachments-snapshot-001')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
