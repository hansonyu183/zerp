import { readFile } from 'node:fs/promises'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import { TargetBootstrapService } from '../app/bootstrap.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'

/** One-time identity and grant conversion; every existing version and runtime row keeps its ID. */
export class WflMigrationService {
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
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('wfl:definitions',0))`.execute(
      tx,
    )
    const state = await sql<{
      target: string | null
    }>`SELECT to_regclass('wfl_definitions')::text target`.execute(tx)
    if (state.rows[0]?.target) throw new Error('WFL target already exists')
    await sql`LOCK TABLE dcl_subjects,approval_entries,approval_events,wfl_definition_versions,wfl_definition_runtime_states,wfl_instances,archive_idempotency,app_permissions,app_role_permissions IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const invalid = await sql<{
      id: string
    }>`SELECT e.id FROM approval_entries e WHERE e.domain='dcl' AND e.entity='wfl-process-definition' AND (
      e.version_no IS NULL OR NOT EXISTS(SELECT 1 FROM dcl_subjects s WHERE s.id=e.subject_id AND s.entity=e.entity)
      OR NOT EXISTS(SELECT 1 FROM wfl_definition_versions v WHERE v.approval_entry_id=e.id))`.execute(
      tx,
    )
    if (invalid.rows.length)
      throw new Error('WFL history is incomplete; conversion blocked')
    const schema = await readFile(
      new URL('../../db/target-schema.sql', import.meta.url),
      'utf8',
    )
    await sql
      .raw(
        schema.slice(
          schema.indexOf('CREATE TABLE wfl_definitions ('),
          schema.indexOf('CREATE TABLE wfl_definition_versions ('),
        ),
      )
      .execute(tx)
    await sql`INSERT INTO wfl_definitions(id,entity,code,created_at,created_by)
      SELECT id,'process-definition',code,created_at,created_by FROM dcl_subjects WHERE entity='wfl-process-definition'`.execute(
      tx,
    )
    await sql`ALTER TABLE wfl_definition_runtime_states DROP CONSTRAINT wfl_definition_runtime_states_subject_id_fkey,
      ADD CONSTRAINT wfl_definition_runtime_states_subject_id_fkey FOREIGN KEY(subject_id) REFERENCES wfl_definitions(id) ON DELETE CASCADE`.execute(
      tx,
    )
    await sql`ALTER TABLE wfl_instances DROP CONSTRAINT wfl_instances_definition_subject_id_fkey,
      ADD CONSTRAINT wfl_instances_definition_subject_id_fkey FOREIGN KEY(definition_subject_id) REFERENCES wfl_definitions(id)`.execute(
      tx,
    )
    await sql`UPDATE approval_entries SET domain='wfl',entity='process-definition' WHERE domain='dcl' AND entity='wfl-process-definition'`.execute(
      tx,
    )
    await sql`UPDATE approval_events SET domain='wfl',entity='process-definition' WHERE domain='dcl' AND entity='wfl-process-definition'`.execute(
      tx,
    )
    await sql`DELETE FROM dcl_subjects WHERE entity='wfl-process-definition'`.execute(
      tx,
    )
    const actions = [
      'submit-new',
      'submit-change',
      'approve',
      'reject',
      'unreject',
      'unapprove',
      'versions',
      'audit-history',
      'delete',
      'enable',
      'disable',
    ]
    const permissions = await new TargetBootstrapService(
      this.db,
    ).migratePermissionCatalogInTransaction(tx, catalog, [
      ...actions.map((action) => ({
        from: `/dcl/wfl-process-definition/${action}`,
        to: [`/wfl/process-definition/${action}`],
      })),
      {
        from: '/dcl/wfl-process-definition/query',
        to: ['/wfl/process-definition/submission-query'],
      },
      {
        from: '/dcl/wfl-process-definition/get',
        to: ['/wfl/process-definition/submission-get'],
      },
    ])
    return { permissions }
  }
}
