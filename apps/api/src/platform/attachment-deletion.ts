import { sql, type Kysely, type Transaction } from 'kysely'

import type { DB } from '../db/generated.ts'
import { AttachmentStore } from './attachment-store.ts'

export async function enqueueAttachmentDeletions(
  transaction: Transaction<DB>,
  storageKeys: readonly string[],
): Promise<void> {
  for (const storageKey of new Set(storageKeys))
    await transaction
      .insertInto('attachment_deletion_jobs')
      .values({ storage_key: storageKey, created_at: new Date() })
      .onConflict((conflict) => conflict.column('storage_key').doNothing())
      .execute()
}

export async function lockAttachmentStorageKey(
  transaction: Transaction<DB>,
  storageKey: string,
): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`attachment:delete:${storageKey}`}, 0))`.execute(
    transaction,
  )
}

export async function cancelAttachmentDeletion(
  transaction: Transaction<DB>,
  storageKey: string,
): Promise<void> {
  await transaction
    .deleteFrom('attachment_deletion_jobs')
    .where('storage_key', '=', storageKey)
    .execute()
}

/**
 * Removes committed, unreferenced blobs. The job row is deleted in the same
 * transaction as the physical attempt: a filesystem or commit failure leaves
 * an idempotent retry marker instead of weakening a business transaction.
 */
export async function drainAttachmentDeletions(
  db: Kysely<DB>,
  attachmentStore: AttachmentStore,
  requestedKeys?: readonly string[],
): Promise<number> {
  let query = db
    .selectFrom('attachment_deletion_jobs')
    .select('storage_key')
    .orderBy('created_at', 'asc')
  if (requestedKeys) {
    const keys = [...new Set(requestedKeys)]
    if (keys.length === 0) return 0
    query = query.where('storage_key', 'in', keys)
  }
  const jobs = await query.execute()
  let deleted = 0
  for (const job of jobs) {
    try {
      const removed = await db.transaction().execute(async (transaction) => {
        await lockAttachmentStorageKey(transaction, job.storage_key)
        const current = await transaction
          .selectFrom('attachment_deletion_jobs')
          .select('storage_key')
          .where('storage_key', '=', job.storage_key)
          .forUpdate()
          .executeTakeFirst()
        if (!current) return false
        const reference = await sql<{ referenced: boolean }>`
          SELECT EXISTS (
            SELECT 1 FROM dcl_customer_attachment_staging WHERE storage_key = ${current.storage_key}
            UNION ALL
            SELECT 1 FROM dcl_customer_attachments WHERE storage_key = ${current.storage_key}
            UNION ALL
            SELECT 1 FROM vou_attachment_staging WHERE storage_key = ${current.storage_key}
            UNION ALL
            SELECT 1 FROM vou_attachments WHERE storage_key = ${current.storage_key}
          ) AS referenced
        `.execute(transaction)
        if (reference.rows[0]?.referenced) {
          await cancelAttachmentDeletion(transaction, current.storage_key)
          return false
        }
        await attachmentStore.remove(current.storage_key)
        await transaction
          .deleteFrom('attachment_deletion_jobs')
          .where('storage_key', '=', current.storage_key)
          .executeTakeFirstOrThrow()
        return true
      })
      if (removed) deleted += 1
    } catch {
      // The committed job is the retry contract. Other jobs remain independent.
    }
  }
  return deleted
}
