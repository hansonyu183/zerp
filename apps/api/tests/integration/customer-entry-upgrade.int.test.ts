import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import { createDatabase } from '../../src/db/database.ts'

for (const legacyInstallation of [false, true])
  test(`customer entry upgrade CLI preserves unrelated facts and guards legacy installation=${legacyInstallation}`, async (context) => {
    assert.ok(process.env.TARGET_TEST_DATABASE_URL)
    const admin = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
    const name = `customer_entry_${ulid().toLowerCase()}_test`
    await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin)
    const url = new URL(process.env.TARGET_TEST_DATABASE_URL)
    url.pathname = `/${name}`
    const db = createDatabase(url.toString())
    const scratch = new URL(`../../../../.scratch/${name}/`, import.meta.url)
    await mkdir(scratch, { recursive: true, mode: 0o700 })
    context.after(async () => {
      await db.destroy()
      await sql`DROP DATABASE ${sql.id(name)}`.execute(admin)
      await admin.destroy()
      await rm(scratch, { recursive: true, force: true })
    })
    await sql
      .raw(
        await readFile(
          new URL('../../db/target-schema.sql', import.meta.url),
          'utf8',
        ),
      )
      .execute(db)
    await sql`ALTER TABLE dcl_customer_versions DROP COLUMN logistics_settlement_group, DROP COLUMN default_special_approval, DROP COLUMN default_outbound_warehouse, DROP COLUMN monthly_closing_day, ADD COLUMN customer_type_id text, ADD COLUMN customer_type_snapshot jsonb; ALTER TABLE vou_intermediary_source_line_snapshots ADD COLUMN customer_type_code text`.execute(
      db,
    )
    const id = ulid()
    await sql`INSERT INTO app_users(id,username,display_name,py,password_hash,status,password_changed_at) VALUES (${id},'fixture','升级测试','shengjiceshi','not-a-login-hash','ENABLED',now())`.execute(
      db,
    )
    await sql`INSERT INTO aux_objects(id,entity,code,data,enabled,revision,created_by,updated_by,created_at,updated_at) VALUES (${id},'dictionary-type','DIT-0001','{"name":"原字典"}'::jsonb,true,1,${id},${id},now(),now())`.execute(
      db,
    )
    const installation = await db
      .selectFrom('app_installation')
      .selectAll()
      .execute()
    if (legacyInstallation) await sql`DROP TABLE app_installation`.execute(db)
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        ['scripts/upgrade-customer-entry.ts', ...args],
        {
          cwd: new URL('../../', import.meta.url),
          encoding: 'utf8',
          env: {
            ...process.env,
            TARGET_DATABASE_URL: url.toString(),
            TARGET_DATABASE_SCOPE: 'isolated',
            ZERP_RELEASE_SHA: 'b'.repeat(40),
          },
        },
      )
    const baseline = run()
    assert.equal(baseline.status, 0, baseline.stderr)
    const baselinePath = new URL('baseline.json', scratch)
    const backupPath = new URL('backup.json', scratch)
    await writeFile(baselinePath, baseline.stdout, { mode: 0o600 })
    const bytes = Buffer.from('isolated upgrade recovery fixture')
    const artifact = new URL('artifact', scratch)
    await writeFile(artifact, bytes, { mode: 0o600 })
    const manifest = {
      sourceReleaseSha: 'a'.repeat(40),
      targetReleaseSha: 'b'.repeat(40),
      database: {
        path: artifact.pathname,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      attachments: {
        path: artifact.pathname,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    }
    await writeFile(backupPath, JSON.stringify(manifest), { mode: 0o600 })
    const apply = () =>
      run(
        '--apply',
        '--writers-frozen',
        '--baseline',
        baselinePath.pathname,
        '--backup',
        backupPath.pathname,
      )
    await writeFile(artifact, 'corrupted backup')
    assert.match(apply().stderr, /backup digest mismatch/)
    await writeFile(artifact, bytes)
    await sql`UPDATE aux_objects SET revision=revision+1 WHERE id=${id}`.execute(
      db,
    )
    assert.match(apply().stderr, /baseline changed/)
    await writeFile(baselinePath, run().stdout)
    const scriptId = ulid()
    await sql`INSERT INTO vou_intermediary_scripts(script_id,revision,name,source,hash,updated_by,updated_at) VALUES (${scriptId},1,'旧脚本','pass','hash',${id},now())`.execute(
      db,
    )
    await writeFile(baselinePath, run().stdout)
    assert.match(
      apply().stderr,
      /existing customer or calculation requires explicit conversion/,
    )
    await sql`DELETE FROM vou_intermediary_scripts WHERE script_id=${scriptId}`.execute(
      db,
    )
    await writeFile(baselinePath, run().stdout)
    const result = apply()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).upgraded, true)
    const upgradedInstallation = await db
      .selectFrom('app_installation')
      .selectAll()
      .execute()
    if (!legacyInstallation)
      assert.deepEqual(upgradedInstallation, installation)
    else assert.equal(upgradedInstallation.length, 1)
    const dictionary = await db
      .selectFrom('aux_objects')
      .select(['data', 'revision'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
    assert.equal((dictionary.data as { purpose: string }).purpose, 'GENERAL')
    assert.equal(dictionary.revision, '2')
    const columns = await sql<{
      column_name: string
    }>`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='dcl_customer_versions'`.execute(
      db,
    )
    assert.ok(
      columns.rows.some((row) => row.column_name === 'monthly_closing_day'),
    )
    assert.ok(
      !columns.rows.some((row) => row.column_name === 'customer_type_id'),
    )
  })
