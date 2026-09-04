import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { ulid } from 'ulid'

const adminDatabaseUrl = process.env.TARGET_TEST_DATABASE_URL
const root = new URL('../../../../', import.meta.url)
const targetSchema = await readFile(new URL('apps/api/db/target-schema.sql', root), 'utf8')
const inventoryScript = new URL('apps/api/scripts/cutover-inventory.ts', root)
const transformScript = new URL('apps/api/scripts/cutover-transform.ts', root)

type TemporaryDatabases = {
  sourceName: string
  targetName: string
  sourceUrl: string
  targetUrl: string
  remove: () => Promise<void>
}

type CliResult = { code: number | null; stdout: string; stderr: string }

type SourceUser = {
  id: string; username: string; display_name: string; password_hash: string
  status: string; failed_signin_count: number; locked_until: Date | null
  password_changed_at: Date; created_at: Date; created_by: string | null
  updated_at: Date; updated_by: string | null; revision: string
  password_change_required: boolean
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function databaseUrlFor(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

async function createTemporaryDatabases(): Promise<TemporaryDatabases> {
  assert.ok(adminDatabaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const suffix = randomBytes(8).toString('hex')
  const sourceName = `zerp_cutover_source_${suffix}`
  const targetName = `zerp_cutover_target_${suffix}`
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl })
  await admin.query(`CREATE DATABASE ${quoteIdentifier(sourceName)}`)
  await admin.query(`CREATE DATABASE ${quoteIdentifier(targetName)}`)
  const sourceUrl = databaseUrlFor(adminDatabaseUrl, sourceName)
  const targetUrl = databaseUrlFor(adminDatabaseUrl, targetName)
  const source = new pg.Pool({ connectionString: sourceUrl })
  const target = new pg.Pool({ connectionString: targetUrl })
  await Promise.all([
    source.query(`
      CREATE TABLE app_users (
        id varchar(26) PRIMARY KEY, username varchar(64) NOT NULL,
        display_name varchar(128) NOT NULL, password_hash text NOT NULL,
        status varchar(16) NOT NULL, failed_signin_count integer NOT NULL,
        locked_until timestamptz, password_changed_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL, created_by varchar(26),
        updated_at timestamptz NOT NULL, updated_by varchar(26),
        revision bigint NOT NULL, password_change_required boolean NOT NULL
      );
      CREATE TABLE approval_entries (
        id varchar(26) PRIMARY KEY, domain varchar(32) NOT NULL,
        entity varchar(64) NOT NULL, subject_id varchar(26) NOT NULL,
        version_no integer, status varchar(16) NOT NULL, revision bigint NOT NULL,
        created_by varchar(26) NOT NULL, created_at timestamptz NOT NULL,
        updated_by varchar(26) NOT NULL, updated_at timestamptz NOT NULL,
        submitted_by varchar(26), submitted_at timestamptz,
        approved_by varchar(26), approved_at timestamptz,
        rejected_by varchar(26), rejected_at timestamptz, rejection_reason varchar(1000)
      );
      CREATE TABLE approval_events (
        id varchar(26) PRIMARY KEY, entry_id varchar(26) NOT NULL,
        action varchar(32) NOT NULL, created_at timestamptz NOT NULL
      );
    `),
    target.query(targetSchema),
  ])
  await Promise.all([source.end(), target.end()])
  return {
    sourceName,
    targetName,
    sourceUrl,
    targetUrl,
    async remove() {
      try {
        for (const databaseName of [sourceName, targetName]) {
          await admin.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [databaseName],
          )
          await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`)
        }
      } finally {
        await admin.end()
      }
    },
  }
}

async function runCli(
  script: URL,
  args: string[],
  nodeArguments: string[] = [],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CliResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeArguments, script.pathname, ...args], { env: environment })
    let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000
  for (;;) {
    try {
      await readFile(path)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`)
    await delay(10)
  }
}

async function inventoryArguments(directory: string, sourceUrl: string): Promise<string[]> {
  const timestamp = '2026-09-05T00:00:00.000Z'
  const freezeEvidenceId = 'freeze-fixture'
  const checksum = 'a'.repeat(64)
  await Promise.all([
    writeFile(join(directory, 'freeze.json'), JSON.stringify({
      id: freezeEvidenceId, observedAt: timestamp,
      writers: Object.fromEntries(['api', 'wfl', 'scheduler', 'operator'].map((writer) => [writer, {
        frozen: true, evidenceId: `${writer}-fixture`, observedAt: timestamp,
      }])),
    })),
    writeFile(join(directory, 'db.json'), JSON.stringify({
      identifier: 'database-fixture', capturedAt: timestamp, checksum, freezeEvidenceId,
    })),
    writeFile(join(directory, 'attachments.json'), JSON.stringify({
      identifier: 'attachments-fixture', capturedAt: timestamp, checksum, freezeEvidenceId,
    })),
  ])
  return [
    'inventory', '--database-url', sourceUrl,
    '--writer-freeze-evidence', join(directory, 'freeze.json'),
    '--database-snapshot', join(directory, 'db.json'),
    '--attachment-snapshot', join(directory, 'attachments.json'),
    '--output', join(directory, 'inventory.json'),
  ]
}

async function seedThreeStateApprovalFacts(sourceUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: sourceUrl })
  const now = '2026-09-05T00:00:00.000Z'
  const submitter = ulid()
  const reviewer = ulid()
  try {
    await pool.query(
      `INSERT INTO app_users VALUES
       ($1, 'cutover-submitter', 'Cutover Submitter', 'hash', 'ENABLED', 0, NULL, $3, $3, NULL, $3, NULL, 1, false),
       ($2, 'cutover-reviewer', 'Cutover Reviewer', 'hash', 'ENABLED', 0, NULL, $3, $3, NULL, $3, NULL, 1, false)`,
      [submitter, reviewer, now],
    )
    const entries = [
      [ulid(), ulid(), 'PENDING', null, null, null],
      [ulid(), ulid(), 'APPROVED', reviewer, now, null],
      [ulid(), ulid(), 'REJECTED', null, null, reviewer],
    ]
    for (const [id, subjectId, status, approvedBy, approvedAt, rejectedBy] of entries) {
      await pool.query(
        `INSERT INTO approval_entries (
          id, domain, entity, subject_id, version_no, status, revision,
          created_by, created_at, updated_by, updated_at, submitted_by, submitted_at,
          approved_by, approved_at, rejected_by, rejected_at, rejection_reason
        ) VALUES ($1, 'dcl', 'warehouse', $2, 1, $3, 1, $4, $5, $4, $5, $4, $5, $6, $7, $8,
          CASE WHEN $8::varchar IS NULL THEN NULL ELSE $5::timestamptz END,
          CASE WHEN $8::varchar IS NULL THEN NULL ELSE 'fixture rejection' END)`,
        [id, subjectId, status, submitter, now, approvedBy, approvedAt, rejectedBy],
      )
      await pool.query(
        'INSERT INTO approval_events VALUES ($1, $2, $3, $4)',
        [ulid(), id, status, now],
      )
    }
  } finally {
    await pool.end()
  }
}

test('cutover transform maps fixture Approval three-state facts, archives events, and reconciles target counts', async (context) => {
  const databases = await createTemporaryDatabases()
  const directory = await mkdtemp(join(tmpdir(), 'zerp-cutover-transform-'))
  context.after(async () => { await Promise.all([databases.remove(), rm(directory, { recursive: true, force: true })]) })
  await seedThreeStateApprovalFacts(databases.sourceUrl)
  const inventory = await runCli(inventoryScript, await inventoryArguments(directory, databases.sourceUrl))
  assert.equal(inventory.code, 0, inventory.stderr)

  const transform = await runCli(transformScript, [
    '--source-database-url', databases.sourceUrl, '--target-database-url', databases.targetUrl,
    '--inventory-report', join(directory, 'inventory.json'), '--archive', join(directory, 'archive.json'),
    '--output', join(directory, 'transform.json'),
  ])
  assert.equal(transform.code, 0, transform.stderr)
  const report = JSON.parse(await readFile(join(directory, 'transform.json'), 'utf8')) as {
    status: string; transformed: { count: number; checksum: string }; archived: { count: number; checksum: string }
  }
  assert.equal(report.status, 'COMPLETE')
  assert.equal(report.transformed.count, 3)
  assert.equal(report.archived.count, 3)
  assert.match(report.transformed.checksum, /^[a-f0-9]{64}$/)
  assert.match(report.archived.checksum, /^[a-f0-9]{64}$/)
  const archive = JSON.parse(await readFile(join(directory, 'archive.json'), 'utf8')) as { events: unknown[] }
  assert.equal(archive.events.length, 3)
  const target = new pg.Pool({ connectionString: databases.targetUrl })
  try {
    const transformed = await target.query<{ status: string; rejection_reason: string | null }>(
      `SELECT status, rejection_reason
       FROM approval_entries
       ORDER BY CASE status WHEN 'PENDING' THEN 1 WHEN 'APPROVED' THEN 2 ELSE 3 END`,
    )
    assert.deepEqual(transformed.rows, [
      { status: 'PENDING', rejection_reason: null },
      { status: 'APPROVED', rejection_reason: null },
      { status: 'REJECTED', rejection_reason: 'fixture rejection' },
    ])
  } finally {
    await target.end()
  }
})

test('cutover transform rejects a nonempty unmapped business table before target writes', async (context) => {
  const databases = await createTemporaryDatabases()
  const directory = await mkdtemp(join(tmpdir(), 'zerp-cutover-transform-'))
  context.after(async () => { await Promise.all([databases.remove(), rm(directory, { recursive: true, force: true })]) })
  await seedThreeStateApprovalFacts(databases.sourceUrl)
  const source = new pg.Pool({ connectionString: databases.sourceUrl })
  try {
    await source.query('CREATE TABLE vou_documents (id varchar(26) PRIMARY KEY)')
    await source.query('INSERT INTO vou_documents VALUES ($1)', [ulid()])
  } finally {
    await source.end()
  }
  const inventory = await runCli(inventoryScript, await inventoryArguments(directory, databases.sourceUrl))
  assert.equal(inventory.code, 0, inventory.stderr)
  const transform = await runCli(transformScript, [
    '--source-database-url', databases.sourceUrl, '--target-database-url', databases.targetUrl,
    '--inventory-report', join(directory, 'inventory.json'), '--archive', join(directory, 'archive.json'),
    '--output', join(directory, 'transform.json'),
  ])
  assert.equal(transform.code, 2, transform.stderr)
  const report = JSON.parse(await readFile(join(directory, 'transform.json'), 'utf8')) as {
    status: string; unmappedNonEmptyTables: Array<{ table: string; count: number }>
  }
  assert.equal(report.status, 'BLOCKED')
  assert.deepEqual(report.unmappedNonEmptyTables, [{ table: 'vou_documents', count: 1 }])
  const target = new pg.Pool({ connectionString: databases.targetUrl })
  try {
    assert.equal(Number((await target.query<{ count: string }>('SELECT count(*)::text AS count FROM approval_entries')).rows[0]!.count), 0)
    assert.equal(Number((await target.query<{ count: string }>('SELECT count(*)::text AS count FROM app_users')).rows[0]!.count), 0)
  } finally {
    await target.end()
  }
})

test('cutover transform rejects mapped-fact drift after inventory before any archive or target write', async (context) => {
  const databases = await createTemporaryDatabases()
  const directory = await mkdtemp(join(tmpdir(), 'zerp-cutover-transform-'))
  context.after(async () => { await Promise.all([databases.remove(), rm(directory, { recursive: true, force: true })]) })
  await seedThreeStateApprovalFacts(databases.sourceUrl)
  const inventory = await runCli(inventoryScript, await inventoryArguments(directory, databases.sourceUrl))
  assert.equal(inventory.code, 0, inventory.stderr)
  const source = new pg.Pool({ connectionString: databases.sourceUrl })
  try {
    await source.query("UPDATE app_users SET display_name = 'Changed after inventory' WHERE username = 'cutover-reviewer'")
  } finally {
    await source.end()
  }
  const archivePath = join(directory, 'archive.json')
  const transform = await runCli(transformScript, [
    '--source-database-url', databases.sourceUrl, '--target-database-url', databases.targetUrl,
    '--inventory-report', join(directory, 'inventory.json'), '--archive', archivePath,
    '--output', join(directory, 'transform.json'),
  ])
  assert.equal(transform.code, 2, transform.stderr)
  const report = JSON.parse(await readFile(join(directory, 'transform.json'), 'utf8')) as { gateFailures: string[] }
  assert.ok(report.gateFailures.includes('INVENTORY_INPUT_DRIFT'))
  await assert.rejects(readFile(archivePath), /ENOENT/)
})

test('cutover transform rejects a snapshot manifest changed after the inventory evidence was sealed', async (context) => {
  const databases = await createTemporaryDatabases()
  const directory = await mkdtemp(join(tmpdir(), 'zerp-cutover-transform-'))
  context.after(async () => { await Promise.all([databases.remove(), rm(directory, { recursive: true, force: true })]) })
  await seedThreeStateApprovalFacts(databases.sourceUrl)
  const inventoryPath = join(directory, 'inventory.json')
  const inventory = await runCli(inventoryScript, await inventoryArguments(directory, databases.sourceUrl))
  assert.equal(inventory.code, 0, inventory.stderr)
  const report = JSON.parse(await readFile(inventoryPath, 'utf8')) as {
    pairedSnapshots: { attachments: { identifier: string } }
  }
  report.pairedSnapshots.attachments.identifier = 'tampered-after-inventory'
  await writeFile(inventoryPath, JSON.stringify(report))
  const archivePath = join(directory, 'archive.json')
  const transform = await runCli(transformScript, [
    '--source-database-url', databases.sourceUrl, '--target-database-url', databases.targetUrl,
    '--inventory-report', inventoryPath, '--archive', archivePath,
    '--output', join(directory, 'transform.json'),
  ])
  assert.equal(transform.code, 1)
  assert.match(transform.stderr, /inventory report is not an accepted/)
  await assert.rejects(readFile(archivePath), /ENOENT/)
})

test('cutover transform removes a newly-created archive after target rollback and permits a clean retry', async (context) => {
  const databases = await createTemporaryDatabases()
  const directory = await mkdtemp(join(tmpdir(), 'zerp-cutover-transform-'))
  context.after(async () => { await Promise.all([databases.remove(), rm(directory, { recursive: true, force: true })]) })
  await seedThreeStateApprovalFacts(databases.sourceUrl)
  const inventory = await runCli(inventoryScript, await inventoryArguments(directory, databases.sourceUrl))
  assert.equal(inventory.code, 0, inventory.stderr)
  const source = new pg.Pool({ connectionString: databases.sourceUrl })
  const target = new pg.Pool({ connectionString: databases.targetUrl })
  try {
    const user = (await source.query<SourceUser>('SELECT * FROM app_users ORDER BY id LIMIT 1')).rows[0]!
    await target.query(
      `INSERT INTO app_users (id, username, display_name, password_hash, status, failed_signin_count, locked_until, password_changed_at, created_at, created_by, updated_at, updated_by, revision, password_change_required) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [user.id, user.username, user.display_name, user.password_hash, user.status, user.failed_signin_count, user.locked_until, user.password_changed_at, user.created_at, user.created_by, user.updated_at, user.updated_by, user.revision, user.password_change_required],
    )
    const archivePath = join(directory, 'archive.json')
    const args = [
      '--source-database-url', databases.sourceUrl, '--target-database-url', databases.targetUrl,
      '--inventory-report', join(directory, 'inventory.json'), '--archive', archivePath,
      '--output', join(directory, 'transform.json'),
    ]
    const failed = await runCli(transformScript, args)
    assert.equal(failed.code, 1)
    await assert.rejects(readFile(archivePath), /ENOENT/)
    await target.query('DELETE FROM app_users')
    const retried = await runCli(transformScript, args)
    assert.equal(retried.code, 0, retried.stderr)
    assert.equal((JSON.parse(await readFile(archivePath, 'utf8')) as { events: unknown[] }).events.length, 3)
  } finally {
    await Promise.all([source.end(), target.end()])
  }
})

test('a failed cutover executor cleans its archive before releasing its session lock to a waiting executor', async (context) => {
  const databases = await createTemporaryDatabases()
  const directory = await mkdtemp(join(tmpdir(), 'zerp-cutover-transform-'))
  context.after(async () => {
    await Promise.all([
      databases.remove(),
      rm(directory, { recursive: true, force: true }),
    ])
  })
  await seedThreeStateApprovalFacts(databases.sourceUrl)
  const inventory = await runCli(
    inventoryScript,
    await inventoryArguments(directory, databases.sourceUrl),
  )
  assert.equal(inventory.code, 0, inventory.stderr)

  const target = new pg.Pool({ connectionString: databases.targetUrl })
  try {
    await target.query(`
      CREATE SEQUENCE cutover_fail_once;
      CREATE FUNCTION fail_first_cutover_executor() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF nextval('cutover_fail_once') = 1 THEN
          PERFORM pg_sleep(0.5);
          RAISE EXCEPTION 'intentional first cutover executor failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_first_cutover_executor
      BEFORE INSERT ON app_users
      FOR EACH ROW EXECUTE FUNCTION fail_first_cutover_executor();
    `)
    const archivePath = join(directory, 'archive.json')
    const cleanupStartedPath = join(directory, 'archive-cleanup-started')
    const cleanupReleasePath = join(directory, 'archive-cleanup-release')
    const loaderPath = join(directory, 'pause-archive-cleanup-loader.mjs')
    await writeFile(
      loaderPath,
      `
      export async function resolve(specifier, context, nextResolve) {
        if (specifier === 'node:fs/promises') return { url: 'cutover-test:fs-promises', shortCircuit: true }
        return nextResolve(specifier, context)
      }

      export async function load(url, context, nextLoad) {
        if (url !== 'cutover-test:fs-promises') return nextLoad(url, context)
        return {
          format: 'module', shortCircuit: true,
          source: \`
            import { createRequire } from 'node:module'
            const fs = createRequire(process.cwd() + '/cutover-test-loader.cjs')('node:fs/promises')
            export const link = fs.link
            export const open = fs.open
            export const readFile = fs.readFile
            export const writeFile = fs.writeFile
            export async function rm(path, options) {
              if (path === process.env.CUTOVER_TEST_ARCHIVE_PATH) {
                await fs.writeFile(process.env.CUTOVER_TEST_ARCHIVE_CLEANUP_STARTED, 'ready')
                for (;;) {
                  try {
                    await fs.readFile(process.env.CUTOVER_TEST_ARCHIVE_CLEANUP_RELEASE)
                    break
                  } catch (error) {
                    if (error?.code !== 'ENOENT') throw error
                  }
                  await new Promise((resolve) => setTimeout(resolve, 10))
                }
              }
              return fs.rm(path, options)
            }
          \`,
        }
      }
    `,
    )
    const args = [
      '--source-database-url',
      databases.sourceUrl,
      '--target-database-url',
      databases.targetUrl,
      '--inventory-report',
      join(directory, 'inventory.json'),
      '--archive',
      archivePath,
    ]
    const first = runCli(
      transformScript,
      [...args, '--output', join(directory, 'first-transform.json')],
      [`--experimental-loader=${loaderPath}`],
      {
        ...process.env,
        CUTOVER_TEST_ARCHIVE_PATH: archivePath,
        CUTOVER_TEST_ARCHIVE_CLEANUP_STARTED: cleanupStartedPath,
        CUTOVER_TEST_ARCHIVE_CLEANUP_RELEASE: cleanupReleasePath,
      },
    )
    let second: Promise<CliResult> | undefined
    try {
      await waitForFile(archivePath)
      second = runCli(transformScript, [
        ...args,
        '--output',
        join(directory, 'second-transform.json'),
      ])
      await waitForFile(cleanupStartedPath)
      const secondSettledBeforeCleanup = await Promise.race([
        second,
        delay(100).then(() => undefined),
      ])
      assert.equal(secondSettledBeforeCleanup, undefined)
    } finally {
      await writeFile(cleanupReleasePath, 'release')
    }
    const [failed, succeeded] = await Promise.all([first, second!])
    assert.equal(failed.code, 1, failed.stderr)
    assert.equal(succeeded.code, 0, succeeded.stderr)
    assert.equal(
      (JSON.parse(await readFile(archivePath, 'utf8')) as { events: unknown[] })
        .events.length,
      3,
    )
  } finally {
    await target.end()
  }
})
