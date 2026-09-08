import { readFile } from 'node:fs/promises'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { AccMappingData } from '@zerp/model'
import type { DB, JsonValue } from '../db/generated.ts'
import { TargetBootstrapService } from '../app/bootstrap.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import { syncMappingSubjectUsages } from './mapping-catalog.ts'

export class AccMappingMigrationError extends Error {
  readonly blockers: Array<{ subjectId: string; reason: string }>
  constructor(blockers: Array<{ subjectId: string; reason: string }>) {
    super('ACC mapping migration blocked')
    this.blockers = blockers
  }
}

export class AccMappingMigrationService {
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
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('acc:mapping:migration',0))`.execute(
      tx,
    )
    const state = await sql<{
      source: string | null
      target: string | null
    }>`SELECT to_regclass('dcl_acc_mapping_versions')::text source, to_regclass('acc_mappings')::text target`.execute(
      tx,
    )
    if (!state.rows[0]?.source || state.rows[0].target)
      throw new AccMappingMigrationError([
        { subjectId: '', reason: 'SOURCE_MISSING_OR_TARGET_ALREADY_EXISTS' },
      ])
    await sql`LOCK TABLE dcl_subjects,dcl_acc_mapping_versions,dcl_acc_mapping_subject_usages,dcl_acc_mapping_reference_facts,approval_entries,approval_events,archive_idempotency,acc_books,acc_subjects,app_permissions,app_role_permissions IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const invalid = await sql<{ subject_id: string }>`
      SELECT s.id subject_id FROM dcl_subjects s WHERE s.entity='acc-mapping' AND (
        NOT EXISTS(SELECT 1 FROM approval_entries e WHERE e.subject_id=s.id AND e.domain='dcl' AND e.entity='acc-mapping')
        OR EXISTS(SELECT 1 FROM approval_entries e WHERE e.subject_id=s.id AND e.domain='dcl' AND e.entity='acc-mapping' AND (e.version_no IS NULL OR NOT EXISTS(SELECT 1 FROM dcl_acc_mapping_versions v WHERE v.approval_entry_id=e.id)))
      )
      UNION SELECT e.subject_id FROM approval_entries e WHERE e.domain='dcl' AND e.entity='acc-mapping' GROUP BY e.subject_id
        HAVING count(*) FILTER(WHERE status<>'APPROVED')>0 AND NOT(count(*)=1 AND max(version_no)=1 AND max(status) IN ('PENDING','REJECTED'))
      UNION SELECT e.subject_id FROM dcl_acc_mapping_versions v JOIN approval_entries e ON e.id=v.approval_entry_id
        WHERE e.domain<>'dcl' OR e.entity<>'acc-mapping' OR NOT EXISTS(SELECT 1 FROM dcl_subjects s WHERE s.id=e.subject_id AND s.entity='acc-mapping')
    `.execute(tx)
    if (invalid.rows.length)
      throw new AccMappingMigrationError(
        invalid.rows.map((row) => ({
          subjectId: row.subject_id,
          reason: 'UNRESOLVED_CANDIDATE_OR_INVALID_HISTORY',
        })),
      )
    const rows = await sql<{
      subject_id: string
      book_id: string
      vou_entity_id: string
      book_snapshot: JsonValue
      vou_entity_snapshot: JsonValue
      default_result: 'POST' | 'UN_POST'
      mapping_definition: JsonValue
      created_at: Date
      created_by: string
    }>`
      SELECT DISTINCT ON(s.id) s.id subject_id,s.created_at,s.created_by,v.book_id,v.vou_entity_id,v.book_snapshot,v.vou_entity_snapshot,v.default_result,v.mapping_definition
      FROM dcl_subjects s JOIN approval_entries e ON e.subject_id=s.id AND e.domain='dcl' AND e.entity='acc-mapping'
      JOIN dcl_acc_mapping_versions v ON v.approval_entry_id=e.id WHERE s.entity='acc-mapping'
      ORDER BY s.id,(e.status='APPROVED') DESC,e.version_no DESC
    `.execute(tx)
    const keys = new Set<string>()
    for (const row of rows.rows) {
      const vouEntity =
        row.vou_entity_snapshot as unknown as AccMappingData['vouEntity']
      const key = `${row.book_id}:${vouEntity.code}`
      const book = await tx
        .selectFrom('acc_books')
        .select('id')
        .where('id', '=', row.book_id)
        .executeTakeFirst()
      if (!book || keys.has(key))
        throw new AccMappingMigrationError([
          {
            subjectId: row.subject_id,
            reason: 'BOOK_MISSING_OR_DUPLICATE_IDENTITY',
          },
        ])
      keys.add(key)
    }
    await sql`ALTER TABLE dcl_acc_vou_entity_facts RENAME TO acc_mapping_vou_entities`.execute(
      tx,
    )
    const schema = await readFile(
      new URL('../../db/target-schema.sql', import.meta.url),
      'utf8',
    )
    const start = schema.indexOf('CREATE TABLE acc_mappings (')
    const end = schema.indexOf('CREATE TABLE acc_opening_snapshots', start)
    await sql.raw(schema.slice(start, end)).execute(tx)
    for (const row of rows.rows) {
      const data: AccMappingData = {
        book: row.book_snapshot as unknown as AccMappingData['book'],
        vouEntity:
          row.vou_entity_snapshot as unknown as AccMappingData['vouEntity'],
        defaultResult: row.default_result,
        definition:
          row.mapping_definition as unknown as AccMappingData['definition'],
      }
      await sql`INSERT INTO acc_mappings(id,book_id,vou_entity_id,vou_entity,book_snapshot,vou_entity_snapshot,default_result,mapping_definition,revision,created_at,created_by,updated_at,updated_by)
        VALUES(${row.subject_id},${row.book_id},${row.vou_entity_id},${data.vouEntity.code},${JSON.stringify(data.book)}::jsonb,${JSON.stringify(data.vouEntity)}::jsonb,${data.defaultResult},${JSON.stringify(data.definition)}::jsonb,1,${row.created_at},${row.created_by},${row.created_at},${row.created_by})`.execute(
        tx,
      )
      await syncMappingSubjectUsages(tx, row.subject_id, data)
    }
    await sql`ALTER TABLE dcl_acc_mapping_versions RENAME TO acc_mapping_history`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_acc_mapping_reference_facts RENAME TO acc_mapping_legacy_reference_facts`.execute(
      tx,
    )
    await sql`DROP TABLE dcl_acc_mapping_subject_usages`.execute(tx)
    await sql`DROP TABLE dcl_acc_subject_facts,dcl_acc_book_facts`.execute(tx)
    await sql`ALTER TABLE acc_journal_entries ADD COLUMN mapping_id varchar(26) REFERENCES acc_mappings(id), ADD COLUMN mapping_revision bigint`.execute(
      tx,
    )
    // Historical subjects and Approval entries remain read-only audit evidence.
    // Removed lifecycle grants are retired; save is a new explicitly granted capability.
    const permissions = await new TargetBootstrapService(
      this.db,
    ).migratePermissionCatalogInTransaction(
      tx,
      catalog,
      ['query', 'get'].map((action) => ({
        from: `/dcl/acc-mapping/${action}`,
        to: [`/acc/mapping/${action}`],
      })),
    )
    return { migrated: rows.rows.length, permissions }
  }
}
