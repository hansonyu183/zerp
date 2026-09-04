import type { ApprovalActor } from '@zerp/model'
import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { DB, JsonValue } from '../db/generated.ts'

type Executor = Kysely<DB> | Transaction<DB>

interface RptParameter {
  name: string
  label: string
  type: 'TEXT' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'DATE_RANGE' | 'ENUM' | 'REFERENCE'
  required: boolean
}

interface RptColumn {
  alias: string
  label: string
  order: number
  type: 'TEXT' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'DATETIME'
  width: number
  visible: boolean
  format: string
}

interface Definition {
  subjectId: string
  approvalEntryId: string
  code: string
  name: string
  sql: string
  parameters: RptParameter[]
  columns: RptColumn[]
}

export class RptApplicationError extends Error {
  readonly errorKey: string

  constructor(errorKey: string) {
    super(errorKey)
    this.name = 'RptApplicationError'
    this.errorKey = errorKey
  }
}

function requirePermission(actor: ApprovalActor, permission: string): void {
  if (actor.trusted !== true && !actor.permissions.includes(permission))
    throw new RptApplicationError('approval_invalid_action')
}

function json(value: unknown): JsonValue {
  return JSON.stringify(value) as unknown as JsonValue
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function assertReadOnlyStatement(statement: string): void {
  const normalized = statement.trim()
  if (
    !/^(select|with)\b/i.test(normalized) ||
    /;/.test(normalized) ||
    /\b(insert|update|delete|merge|copy|alter|create|drop|grant|revoke|call|do|vacuum|truncate)\b/i.test(normalized)
  ) throw new RptApplicationError('rpt_definition_invalid_sql')
}

function normalizeParameter(parameter: RptParameter, value: unknown): unknown {
  if (value === undefined || value === null) {
    if (parameter.required) throw new RptApplicationError('rpt_parameter_required')
    return null
  }
  if (parameter.type === 'INTEGER') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (parameter.type === 'DECIMAL') {
    if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (parameter.type === 'BOOLEAN') {
    if (typeof value !== 'boolean') throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (parameter.type === 'DATE') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (parameter.type === 'DATE_RANGE') {
    if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item)))
      throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (typeof value !== 'string') throw new RptApplicationError('rpt_parameter_invalid')
  return value
}

function bindStatement(definition: Definition, values: Record<string, unknown>): RawBuilder<unknown> {
  const parameters = new Map(definition.parameters.map((parameter) => [parameter.name, parameter]))
  const used = new Set<string>()
  const parts: RawBuilder<unknown>[] = []
  let offset = 0
  const pattern = /(?<!:):([A-Za-z][A-Za-z0-9_]*)/g
  for (const match of definition.sql.matchAll(pattern)) {
    parts.push(sql.raw(definition.sql.slice(offset, match.index)))
    const name = match[1]!
    const parameter = parameters.get(name)
    if (!parameter) throw new RptApplicationError('rpt_parameter_contract_mismatch')
    used.add(name)
    parts.push(sql`${normalizeParameter(parameter, values[name])}`)
    offset = (match.index ?? 0) + match[0].length
  }
  parts.push(sql.raw(definition.sql.slice(offset)))
  if (definition.parameters.some((parameter) => !used.has(parameter.name)))
    throw new RptApplicationError('rpt_parameter_contract_mismatch')
  const unknown = Object.keys(values).find((name) => !parameters.has(name))
  if (unknown) throw new RptApplicationError('rpt_parameter_unknown')
  return sql.join(parts, sql.raw(''))
}

export class RptService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async directory(actor: ApprovalActor) {
    const definitions = await this.enabledDefinitions(this.db)
    return definitions
      .filter((definition) => actor.trusted === true || actor.permissions.includes(`/rpt/${definition.code}/query`) || actor.permissions.includes(`/rpt/${definition.code}/export`))
      .map(({ subjectId, approvalEntryId, code, name, parameters, columns }) => ({ subjectId, approvalEntryId, code, name, parameters, columns }))
  }

  async query(
    code: string,
    input: { parameters: Record<string, unknown>; page: number; pageSize: number },
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, `/rpt/${code}/query`)
    if (input.page < 1 || input.pageSize < 1 || input.pageSize > 100)
      throw new RptApplicationError('rpt_pagination_invalid')
    const definition = await this.definitionByCode(this.db, code)
    const statement = bindStatement(definition, input.parameters)
    const offset = (input.page - 1) * input.pageSize
    const rows = await this.db.transaction().execute(async (tx) => {
      await sql`SET LOCAL TRANSACTION READ ONLY`.execute(tx)
      await sql`SET LOCAL statement_timeout = '10s'`.execute(tx)
      const result = await sql<Record<string, unknown>>`SELECT * FROM (${statement}) AS report_result LIMIT ${input.pageSize} OFFSET ${offset}`.execute(tx)
      this.assertColumns(definition, result.rows)
      return result.rows
    })
    await this.audit(definition, actor.id, 'QUERY', input.parameters, rows.length, requestId)
    return { approvalEntryId: definition.approvalEntryId, columns: definition.columns, rows, page: input.page, pageSize: input.pageSize }
  }

  async export(code: string, parameters: Record<string, unknown>, actor: ApprovalActor, requestId: string) {
    requirePermission(actor, `/rpt/${code}/export`)
    const definition = await this.definitionByCode(this.db, code)
    const statement = bindStatement(definition, parameters)
    const rows = await this.db.transaction().execute(async (tx) => {
      await sql`SET LOCAL TRANSACTION READ ONLY`.execute(tx)
      await sql`SET LOCAL statement_timeout = '30s'`.execute(tx)
      const result = await sql<Record<string, unknown>>`SELECT * FROM (${statement}) AS report_result LIMIT 100001`.execute(tx)
      if (result.rows.length > 100_000) throw new RptApplicationError('rpt_export_limit_exceeded')
      this.assertColumns(definition, result.rows)
      return result.rows
    })
    await this.audit(definition, actor.id, 'EXPORT', parameters, rows.length, requestId)
    return { approvalEntryId: definition.approvalEntryId, columns: definition.columns, rows }
  }

  async assertAllEnabled(): Promise<void> {
    const definitions = await this.enabledDefinitions(this.db, false)
    const failures: string[] = []
    for (const definition of definitions) {
      try {
        assertReadOnlyStatement(definition.sql)
        const sample = Object.fromEntries(definition.parameters.map((parameter) => [parameter.name, this.sampleValue(parameter)]))
        const statement = bindStatement(definition, sample)
        await this.db.transaction().execute(async (tx) => {
          await sql`SET LOCAL TRANSACTION READ ONLY`.execute(tx)
          await sql`SET LOCAL statement_timeout = '5s'`.execute(tx)
          await sql`EXPLAIN ${statement}`.execute(tx)
          const result = await sql<Record<string, unknown>>`SELECT * FROM (${statement}) AS report_result LIMIT 1`.execute(tx)
          this.assertColumns(definition, result.rows)
        })
      } catch (error) {
        failures.push(`${definition.code}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (failures.length > 0) throw new RptApplicationError(`rpt_validation_failed:${failures.join('|')}`)
  }

  private async definitionByCode(executor: Executor, code: string): Promise<Definition> {
    const definitions = await this.enabledDefinitions(executor)
    const definition = definitions.find((item) => item.code === code)
    if (!definition) throw new RptApplicationError('rpt_definition_not_executable')
    return definition
  }

  private async enabledDefinitions(executor: Executor, requireValid = true): Promise<Definition[]> {
    const rows = await sql<{
      subject_id: string; approval_entry_id: string; code: string; name: string;
      sql_text: string; parameters: JsonValue; columns: JsonValue; validity: string | null
    }>`
      SELECT s.id AS subject_id, e.id AS approval_entry_id, s.code, v.name,
        v.sql_text, v.parameters, v.columns, validity.status AS validity
      FROM dcl_subjects s
      JOIN LATERAL (
        SELECT * FROM approval_entries candidate
        WHERE candidate.domain = 'dcl' AND candidate.entity = 'rpt-definition'
          AND candidate.subject_id = s.id AND candidate.status = 'APPROVED'
        ORDER BY candidate.version_no DESC LIMIT 1
      ) e ON TRUE
      JOIN dcl_rpt_definition_versions v ON v.approval_entry_id = e.id AND v.enabled
      LEFT JOIN rpt_definition_validities validity ON validity.approval_entry_id = e.id
      WHERE s.entity = 'rpt-definition'
      ORDER BY s.code
    `.execute(executor)
    return rows.rows
      .filter((row) => !requireValid || row.validity === 'VALID')
      .map((row) => {
        if (!row.code) throw new RptApplicationError('rpt_definition_invalid_code')
        assertReadOnlyStatement(row.sql_text)
        return {
          subjectId: row.subject_id, approvalEntryId: row.approval_entry_id,
          code: row.code, name: row.name, sql: row.sql_text,
          parameters: array<RptParameter>(row.parameters), columns: array<RptColumn>(row.columns).sort((left, right) => left.order - right.order),
        }
      })
  }

  private assertColumns(definition: Definition, rows: Record<string, unknown>[]): void {
    if (rows.length === 0) return
    const actual = Object.keys(rows[0]!).sort()
    const expected = definition.columns.map((column) => column.alias).sort()
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new RptApplicationError('rpt_result_columns_mismatch')
  }

  private sampleValue(parameter: RptParameter): unknown {
    if (!parameter.required) return null
    if (parameter.type === 'INTEGER') return 0
    if (parameter.type === 'DECIMAL') return '0'
    if (parameter.type === 'BOOLEAN') return false
    if (parameter.type === 'DATE') return '2000-01-01'
    if (parameter.type === 'DATE_RANGE') return ['2000-01-01', '2000-01-01']
    return ''
  }

  private async audit(definition: Definition, actorId: string, action: 'QUERY' | 'EXPORT', parameters: Record<string, unknown>, rowCount: number, requestId: string) {
    await this.db.insertInto('rpt_execution_audits').values({
      id: ulid(), definition_subject_id: definition.subjectId,
      approval_entry_id: definition.approvalEntryId, actor_id: actorId, action,
      parameters: json(parameters), row_count: rowCount, request_id: requestId, created_at: new Date(),
    }).execute()
  }
}
