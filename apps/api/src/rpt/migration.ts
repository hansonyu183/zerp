import { readFile } from 'node:fs/promises'
import { sql, type Kysely, type Transaction } from 'kysely'
import {
  assertRptDefinitionContract,
  type RptColumn,
  type RptParameter,
} from './service.ts'
import type { DB, JsonValue } from '../db/generated.ts'
import { TargetBootstrapService } from '../app/bootstrap.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'

export class RptMigrationError extends Error {
  readonly blockers: Array<{ subjectId: string; reason: string }>
  constructor(blockers: Array<{ subjectId: string; reason: string }>) {
    super('RPT definition migration blocked')
    this.blockers = blockers
  }
}

export class RptMigrationService {
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
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('rpt:definition:migration',0))`.execute(
      tx,
    )
    const state = await sql<{
      source: string | null
      target: string | null
    }>`SELECT to_regclass('dcl_rpt_definition_versions')::text source, to_regclass('rpt_definitions')::text target`.execute(
      tx,
    )
    if (!state.rows[0]?.source || state.rows[0].target)
      throw new RptMigrationError([
        { subjectId: '', reason: 'SOURCE_MISSING_OR_TARGET_ALREADY_EXISTS' },
      ])
    await sql`LOCK TABLE dcl_subjects,dcl_rpt_definition_versions,rpt_definition_validities,approval_entries,approval_events,archive_code_counters,archive_idempotency,rpt_execution_audits,app_permissions,app_role_permissions IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const invalid = await sql<{ subject_id: string }>`
      SELECT s.id subject_id FROM dcl_subjects s WHERE s.entity='rpt-definition' AND (
        s.code IS NULL OR NOT EXISTS(SELECT 1 FROM approval_entries e WHERE e.domain='dcl' AND e.entity='rpt-definition' AND e.subject_id=s.id)
        OR EXISTS(SELECT 1 FROM approval_entries e WHERE e.domain='dcl' AND e.entity='rpt-definition' AND e.subject_id=s.id AND (e.version_no IS NULL OR NOT EXISTS(SELECT 1 FROM dcl_rpt_definition_versions v WHERE v.approval_entry_id=e.id)))
      )
      UNION SELECT e.subject_id FROM approval_entries e WHERE e.domain='dcl' AND e.entity='rpt-definition' GROUP BY e.subject_id
        HAVING count(*) FILTER(WHERE status<>'APPROVED')>0 AND NOT(count(*)=1 AND max(version_no)=1 AND max(status) IN ('PENDING','REJECTED'))
      UNION SELECT e.subject_id FROM dcl_rpt_definition_versions v JOIN approval_entries e ON e.id=v.approval_entry_id
        WHERE e.domain<>'dcl' OR e.entity<>'rpt-definition' OR NOT EXISTS(SELECT 1 FROM dcl_subjects s WHERE s.id=e.subject_id AND s.entity='rpt-definition')
    `.execute(tx)
    if (invalid.rows.length)
      throw new RptMigrationError(
        invalid.rows.map((row) => ({
          subjectId: row.subject_id,
          reason: 'UNRESOLVED_CANDIDATE_OR_INVALID_HISTORY',
        })),
      )
    const schema = await readFile(
      new URL('../../db/target-schema.sql', import.meta.url),
      'utf8',
    )
    await sql
      .raw(
        schema.slice(
          schema.indexOf('CREATE TABLE rpt_code_counter ('),
          schema.indexOf('-- Read-only pre-conversion evidence.'),
        ),
      )
      .execute(tx)
    const definitions = await sql<{
      id: string
      code: string
      name: string
      description: string
      enabled: boolean
      sql_text: string
      parameters: JsonValue
      columns: JsonValue
      status: string
      validity: string | null
      diagnostic: string | null
      created_at: Date
      created_by: string
      updated_at: Date
      updated_by: string
    }>`
      SELECT DISTINCT ON(s.id) s.id,s.code,v.name,v.description,v.enabled,v.sql_text,v.parameters,v.columns,
        e.status,valid.status validity,valid.diagnostic,s.created_at,s.created_by,e.updated_at,e.updated_by
      FROM dcl_subjects s JOIN approval_entries e ON e.subject_id=s.id AND e.domain='dcl' AND e.entity='rpt-definition'
      JOIN dcl_rpt_definition_versions v ON v.approval_entry_id=e.id
      LEFT JOIN rpt_definition_validities valid ON valid.approval_entry_id=e.id
      WHERE s.entity='rpt-definition' ORDER BY s.id,(e.status='APPROVED') DESC,e.version_no DESC
    `.execute(tx)
    for (const { status, ...row } of definitions.rows) {
      let validity =
        status === 'APPROVED' && row.validity === 'VALID' ? 'VALID' : 'INVALID'
      let diagnostic =
        status !== 'APPROVED'
          ? 'Unresolved initial definition requires validated save'
          : row.diagnostic
      try {
        assertRptDefinitionContract({
          subjectId: row.id,
          code: row.code,
          revision: '1',
          name: row.name,
          sql: row.sql_text,
          parameters: row.parameters as unknown as RptParameter[],
          columns: row.columns as unknown as RptColumn[],
        })
      } catch {
        validity = 'INVALID'
        diagnostic =
          'Current parameter or column contract requires validated correction'
      }
      await tx
        .insertInto('rpt_definitions')
        .values({
          ...row,
          parameters: JSON.stringify(row.parameters),
          columns: JSON.stringify(row.columns),
          revision: 1,
          validity,
          diagnostic,
        })
        .execute()
    }
    await sql`UPDATE rpt_code_counter SET next_value=greatest(
      coalesce((SELECT next_value FROM archive_code_counters WHERE entity='rpt-definition'),1),
      coalesce((SELECT max(substring(code FROM 5)::integer)+1 FROM rpt_definitions),1))`.execute(
      tx,
    )
    await sql`DELETE FROM archive_code_counters WHERE entity='rpt-definition'`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_rpt_definition_versions RENAME TO rpt_definition_history`.execute(
      tx,
    )
    await sql`ALTER TABLE rpt_definition_validities RENAME TO rpt_definition_validity_history`.execute(
      tx,
    )
    await sql`ALTER TABLE rpt_execution_audits DROP CONSTRAINT rpt_execution_audits_definition_subject_id_fkey,
      ADD CONSTRAINT rpt_execution_audits_definition_subject_id_fkey FOREIGN KEY(definition_subject_id) REFERENCES rpt_definitions(id),
      ALTER COLUMN approval_entry_id DROP NOT NULL, ADD COLUMN definition_revision bigint`.execute(
      tx,
    )
    const permissions = await new TargetBootstrapService(
      this.db,
    ).migratePermissionCatalogInTransaction(
      tx,
      catalog,
      ['query', 'get'].map((action) => ({
        from: `/dcl/rpt-definition/${action}`,
        to: ['/rpt/definition/get'],
      })),
    )
    // Preserve grants and all pre-conversion audits. Invalid current definitions cannot execute.
    await sql`UPDATE app_permissions p SET status='DISABLED' FROM rpt_definitions d
      WHERE p.domain='rpt' AND p.entity=d.code AND p.action IN ('query','export') AND (NOT d.enabled OR d.validity='INVALID')`.execute(
      tx,
    )
    const count = await tx
      .selectFrom('rpt_definitions')
      .select(tx.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    return { migrated: Number(count.count), permissions }
  }
}
