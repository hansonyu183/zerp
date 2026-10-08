import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readVerifiedUpgradeInput } from '../../src/platform/upgrade-input.ts'

test('maintenance inputs bind release, complete recovery bytes and sealed baseline before upgrading', async () => {
  await mkdir(new URL('../../../../.scratch/', import.meta.url), {
    recursive: true,
  })
  const directory = await mkdtemp(
    new URL('../../../../.scratch/upgrade-input-', import.meta.url).pathname,
  )
  try {
    const database = `${directory}/database.dump`,
      attachments = `${directory}/attachments.tar`,
      backup = `${directory}/backup.json`,
      baseline = `${directory}/baseline.json`
    const databaseBytes = 'exclusive database recovery bytes',
      attachmentBytes = 'exclusive attachment recovery bytes'
    const sha256 = (value: string) =>
      createHash('sha256').update(value).digest('hex')
    await writeFile(database, databaseBytes)
    await writeFile(attachments, attachmentBytes)
    await writeFile(
      backup,
      JSON.stringify({
        sourceReleaseSha: 'a'.repeat(40),
        targetReleaseSha: 'b'.repeat(40),
        database: { path: database, sha256: sha256(databaseBytes) },
        attachments: { path: attachments, sha256: sha256(attachmentBytes) },
      }),
    )
    await writeFile(
      baseline,
      JSON.stringify({ baseline: 'c'.repeat(64), layout: 'LEGACY' }),
    )
    const input = {
      backupPath: backup,
      baselinePath: baseline,
      targetReleaseSha: 'b'.repeat(40),
      errorPrefix: 'purchase_inbound_scope_upgrade' as const,
    }
    assert.deepEqual(await readVerifiedUpgradeInput(input), {
      baseline: 'c'.repeat(64),
      sourceReleaseSha: 'a'.repeat(40),
      targetReleaseSha: 'b'.repeat(40),
    })
    await assert.rejects(
      readVerifiedUpgradeInput({ ...input, targetReleaseSha: 'd'.repeat(40) }),
      /release_mismatch/,
    )
    await writeFile(database, databaseBytes + '-drift')
    await assert.rejects(
      readVerifiedUpgradeInput(input),
      /backup_digest_mismatch/,
    )
    await writeFile(database, databaseBytes)
    await writeFile(attachments, attachmentBytes + '-drift')
    await assert.rejects(
      readVerifiedUpgradeInput(input),
      /backup_digest_mismatch/,
    )
    await writeFile(attachments, attachmentBytes)
    await writeFile(baseline, JSON.stringify({ baseline: 'unsealed' }))
    await assert.rejects(readVerifiedUpgradeInput(input))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
