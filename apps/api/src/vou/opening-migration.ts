import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import { TargetBootstrapService } from '../app/bootstrap.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import type { AccOpeningInput } from '../acc/service.ts'
import { openingRequestHash } from './opening-input.ts'
import { VouOpeningService } from './opening-service.ts'

export class OpeningMigrationError extends Error {
  readonly blockers: Array<{ submissionId: string; reason: string }>
  constructor(blockers: Array<{ submissionId: string; reason: string }>) {
    super('Opening conversion blocked')
    this.blockers = blockers
  }
}

export class OpeningMigrationService {
  private readonly db: Kysely<DB>
  constructor(db: Kysely<DB>) {
    this.db = db
  }
  async migrate(catalog: readonly TargetPermissionCatalogEntry[]) {
    return this.db
      .transaction()
      .execute((tx) => this.migrateInTransaction(tx, catalog))
  }
  async migrateInTransaction(
    tx: Transaction<DB>,
    catalog: readonly TargetPermissionCatalogEntry[],
  ) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('vou:opening:migration',0))`.execute(
      tx,
    )
    await sql`LOCK TABLE approval_entries, approval_events, acc_opening_snapshots, acc_books, acc_book_access, vou_idempotency, app_permissions, app_role_permissions IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const invalid = await sql<{ id: string }>`
      SELECT e.id FROM approval_entries e LEFT JOIN acc_opening_snapshots s ON s.approval_entry_id=e.id
      WHERE e.entity='opening' AND e.domain IN ('acc','vou')
        AND (e.version_no IS NOT NULL OR s.approval_entry_id IS NULL OR e.subject_id <> s.book_id)
      UNION SELECT e.id FROM acc_opening_snapshots s JOIN approval_entries e ON e.id=s.approval_entry_id
        WHERE e.entity<>'opening' OR e.domain NOT IN ('acc','vou')
      UNION SELECT s.approval_entry_id FROM acc_opening_snapshots s
        WHERE (SELECT count(*) FROM acc_opening_snapshots other WHERE other.book_id=s.book_id)>1
    `.execute(tx)
    if (invalid.rows.length)
      throw new OpeningMigrationError(
        invalid.rows.map((row) => ({
          submissionId: row.id,
          reason: 'INVALID_OPENING_IDENTITY',
        })),
      )
    const entries = await tx
      .selectFrom('approval_entries as e')
      .innerJoin('acc_opening_snapshots as s', 's.approval_entry_id', 'e.id')
      .select([
        'e.id',
        'e.subject_id',
        'e.submitted_by',
        'e.submitted_at',
        's.payload',
      ])
      .where('e.domain', '=', 'acc')
      .where('e.entity', '=', 'opening')
      .execute()
    await tx
      .updateTable('approval_entries')
      .set({ domain: 'vou' })
      .where('domain', '=', 'acc')
      .where('entity', '=', 'opening')
      .execute()
    await tx
      .updateTable('approval_events')
      .set({ domain: 'vou' })
      .where('domain', '=', 'acc')
      .where('entity', '=', 'opening')
      .execute()
    const opening = new VouOpeningService(tx)
    for (const entry of entries) {
      const input = entry.payload as unknown as AccOpeningInput
      if (
        input.bookId !== entry.subject_id ||
        input.submissionId !== entry.id ||
        !input.idempotencyKey
      )
        throw new OpeningMigrationError([
          { submissionId: entry.id, reason: 'INVALID_SUBMISSION_INTENT' },
        ])
      const prior = await tx
        .selectFrom('vou_idempotency')
        .select('submission_id')
        .where('entity', '=', 'opening')
        .where('idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirst()
      if (prior)
        throw new OpeningMigrationError([
          { submissionId: entry.id, reason: 'DUPLICATE_IDEMPOTENCY_KEY' },
        ])
      const view = await opening.getOpening(input.bookId, {
        id: entry.submitted_by,
        permissions: [],
        trusted: true,
      })
      await tx
        .insertInto('vou_idempotency')
        .values({
          entity: 'opening',
          idempotency_key: input.idempotencyKey,
          request_hash: openingRequestHash(input, entry.submitted_by),
          document_id: input.bookId,
          submission_id: entry.id,
          response: view as unknown as DB['vou_idempotency']['response'],
          created_at: entry.submitted_at,
        })
        .execute()
    }
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS vou_opening_book_unique ON acc_opening_snapshots(book_id)`.execute(
      tx,
    )
    const actions = [
      'query',
      'submit-new',
      'approve',
      'reject',
      'unreject',
      'unapprove',
      'delete',
    ] as const
    const permissions = await new TargetBootstrapService(
      this.db,
    ).migratePermissionCatalogInTransaction(
      tx,
      catalog,
      actions.map((action) => ({
        from: `/acc/opening/${action}`,
        to:
          action === 'query'
            ? ['/vou/opening/query', '/vou/opening/get']
            : [`/vou/opening/${action}`],
      })),
    )
    return { convertedOpenings: entries.length, permissions }
  }
}
