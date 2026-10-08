import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const artifact = z
  .object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
const backupManifest = z
  .object({
    sourceReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
    targetReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
    database: artifact,
    attachments: artifact,
  })
  .strict()

/** Validate sealed recovery bytes before a domain-owned maintenance transaction. */
export async function readVerifiedUpgradeInput(input: {
  backupPath: string
  baselinePath: string
  targetReleaseSha: string | undefined
  errorPrefix: 'purchase_carryover_upgrade' | 'purchase_inbound_scope_upgrade'
}) {
  const backup = backupManifest.parse(
    JSON.parse(await readFile(input.backupPath, 'utf8')),
  )
  if (input.targetReleaseSha !== backup.targetReleaseSha)
    throw new Error(`${input.errorPrefix}_release_mismatch`)
  for (const file of [backup.database, backup.attachments]) {
    const hash = createHash('sha256')
    for await (const part of createReadStream(file.path)) hash.update(part)
    if (hash.digest('hex') !== file.sha256)
      throw new Error(`${input.errorPrefix}_backup_digest_mismatch`)
  }
  const baseline = z
    .object({ baseline: z.string().regex(/^[a-f0-9]{64}$/) })
    .passthrough()
    .parse(JSON.parse(await readFile(input.baselinePath, 'utf8')))
  return {
    baseline: baseline.baseline,
    sourceReleaseSha: backup.sourceReleaseSha,
    targetReleaseSha: backup.targetReleaseSha,
  }
}
