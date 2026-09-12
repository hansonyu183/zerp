import { createHash } from 'node:crypto'
import type { z } from '@hono/zod-openapi'
import { definitionInput } from './contract.ts'
import type { ApprovalActor } from '@zerp/model'
import {
  sql,
  type Kysely,
  type RawBuilder,
  type Transaction,
  type Selectable,
} from 'kysely'
import type pg from 'pg'
import { ulid } from 'ulid'

import type { DB, JsonValue, RptDefinitions } from '../db/generated.ts'

type Executor = Kysely<DB> | Transaction<DB>

export interface RptParameter {
  key: string
  name: string
  type:
    | 'TEXT'
    | 'INTEGER'
    | 'DECIMAL'
    | 'BOOLEAN'
    | 'DATE'
    | 'DATE_RANGE'
    | 'ENUM'
    | 'REFERENCE'
  required: boolean
  defaultValue?: unknown
  enumValues?: readonly string[]
  enumCaptions?: Record<string, string>
  referenceType?: RptReferenceType
}

export interface RptColumn {
  alias: string
  name: string
  order: number
  type: 'TEXT' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'DATETIME' | 'ID'
  width: number
  visible: boolean
  format?: string
  drilldownEntity?: 'VOU'
}

export type RptReferenceType =
  | 'ACCOUNTING_BOOK'
  | 'ACCOUNT_SUBJECT'
  | 'CUSTOMER_SUBUNIT'
  | 'SUPPLIER'
  | 'OTHER_UNIT'
  | 'EMPLOYEE'
  | 'SALES_PARTNER'
  | 'DEPARTMENT'
  | 'PRODUCT'
  | 'WAREHOUSE'
  | 'FUND_ACCOUNT'
  | 'ASSET'
  | 'BILL'
  | 'COUNTERPARTY'

export interface RptDefinition {
  subjectId: string
  revision: string
  code: string
  name: string
  sql: string
  parameters: RptParameter[]
  columns: RptColumn[]
}

type RptReferencePage = {
  items: Array<Record<string, string>>
  total: number
  page: number
  pageSize: number
}

export interface RptDefinitionValidator {
  validate(definition: RptDefinition): Promise<void>
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
    throw new RptApplicationError('rpt_permission_denied')
}

function json(value: unknown): JsonValue {
  return JSON.stringify(value) as unknown as JsonValue
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function projectRptPage<Row>(
  fetchedRows: readonly Row[],
  pageSize: number,
): { rows: Row[]; hasMore: boolean } {
  return {
    rows: fetchedRows.slice(0, pageSize),
    hasMore: fetchedRows.length > pageSize,
  }
}

export function assertRptReadOnlyStatement(statement: string): void {
  const normalized = statement.trim()
  if (
    !/^(select|with)\b/i.test(normalized) ||
    /;/.test(normalized) ||
    /\b(insert|update|delete|merge|copy|alter|create|drop|grant|revoke|call|do|vacuum|truncate)\b/i.test(
      normalized,
    )
  )
    throw new RptApplicationError('rpt_definition_invalid_sql')
}

function isDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

function isStableId(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value)
}

function normalizeRptParameterValue(
  parameter: RptParameter,
  value: unknown,
): unknown {
  if (value === undefined || value === null) {
    if (parameter.required)
      throw new RptApplicationError('rpt_parameter_required')
    return null
  }
  if (parameter.type === 'INTEGER') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value))
      throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (parameter.type === 'DECIMAL') {
    if (
      typeof value !== 'string' ||
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    )
      throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (parameter.type === 'BOOLEAN') {
    if (typeof value !== 'boolean')
      throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (parameter.type === 'DATE') {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !isDate(value)
    )
      throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (parameter.type === 'DATE_RANGE') {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value.some(
        (item) =>
          typeof item !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(item) ||
          !isDate(item),
      ) ||
      value[0]! > value[1]!
    )
      throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (
    parameter.type !== 'TEXT' &&
    parameter.type !== 'ENUM' &&
    parameter.type !== 'REFERENCE'
  )
    throw new RptApplicationError('rpt_parameter_invalid')
  if (typeof value !== 'string')
    throw new RptApplicationError('rpt_parameter_invalid')
  if (parameter.type === 'ENUM' && !parameter.enumValues?.includes(value))
    throw new RptApplicationError('rpt_parameter_invalid')
  if (parameter.type === 'REFERENCE' && !isStableId(value))
    throw new RptApplicationError('rpt_parameter_invalid')
  return value
}

export function normalizeRptParameter(
  parameter: RptParameter,
  value: unknown,
): unknown {
  return normalizeRptParameterValue(
    parameter,
    value === undefined && parameter.defaultValue !== undefined
      ? parameter.defaultValue
      : value,
  )
}

function bindStatement(
  definition: RptDefinition,
  values: Record<string, unknown>,
  onBind?: (parameter: RptParameter) => void,
): RawBuilder<unknown> {
  const parameters = new Map(
    definition.parameters.map((parameter) => [parameter.key, parameter]),
  )
  const used = new Set<string>()
  const parts: RawBuilder<unknown>[] = []
  let offset = 0
  const pattern = /(?<!:):([A-Za-z][A-Za-z0-9_]*)/g
  for (const match of definition.sql.matchAll(pattern)) {
    parts.push(sql.raw(definition.sql.slice(offset, match.index)))
    const name = match[1]!
    const parameter = parameters.get(name)
    if (!parameter)
      throw new RptApplicationError('rpt_parameter_contract_mismatch')
    used.add(name)
    onBind?.(parameter)
    parts.push(sql`${normalizeRptParameter(parameter, values[name])}`)
    offset = (match.index ?? 0) + match[0].length
  }
  parts.push(sql.raw(definition.sql.slice(offset)))
  if (definition.parameters.some((parameter) => !used.has(parameter.key)))
    throw new RptApplicationError('rpt_parameter_contract_mismatch')
  const unknown = Object.keys(values).find((name) => !parameters.has(name))
  if (unknown) throw new RptApplicationError('rpt_parameter_unknown')
  return sql.join(parts, sql.raw(''))
}

export function assertRptDefinitionContract(definition: RptDefinition): void {
  const parameterNames = new Set<string>()
  const referenceTypes: readonly RptReferenceType[] = [
    'ACCOUNTING_BOOK',
    'ACCOUNT_SUBJECT',
    'CUSTOMER_SUBUNIT',
    'SUPPLIER',
    'OTHER_UNIT',
    'EMPLOYEE',
    'SALES_PARTNER',
    'DEPARTMENT',
    'PRODUCT',
    'WAREHOUSE',
    'FUND_ACCOUNT',
    'ASSET',
    'BILL',
    'COUNTERPARTY',
  ]
  if (
    definition.parameters.some(
      (parameter) =>
        !/^[a-z][a-zA-Z0-9]{0,63}$/.test(parameter.key) ||
        !parameter.name ||
        parameter.name.length > 100 ||
        ![
          'TEXT',
          'INTEGER',
          'DECIMAL',
          'BOOLEAN',
          'DATE',
          'DATE_RANGE',
          'ENUM',
          'REFERENCE',
        ].includes(parameter.type) ||
        parameterNames.has(parameter.key) ||
        !parameterNames.add(parameter.key) ||
        (parameter.type === 'ENUM' &&
          (!parameter.enumValues ||
            parameter.enumValues.length === 0 ||
            !parameter.enumCaptions ||
            parameter.enumValues.some(
              (value) => !parameter.enumCaptions?.[value]?.trim(),
            ) ||
            Object.keys(parameter.enumCaptions).some(
              (value) => !parameter.enumValues?.includes(value),
            ) ||
            parameter.enumValues.some(
              (value) => !value || value.length > 200,
            ) ||
            new Set(parameter.enumValues).size !==
              parameter.enumValues.length)) ||
        (parameter.type !== 'ENUM' && parameter.enumValues !== undefined) ||
        (parameter.type === 'REFERENCE' &&
          !referenceTypes.includes(
            parameter.referenceType as RptReferenceType,
          )) ||
        (parameter.type !== 'REFERENCE' &&
          parameter.referenceType !== undefined),
    )
  )
    throw new RptApplicationError('rpt_parameter_contract_mismatch')
  for (const parameter of definition.parameters) {
    if (parameter.defaultValue !== undefined) {
      try {
        normalizeRptParameterValue(parameter, parameter.defaultValue)
      } catch {
        throw new RptApplicationError('rpt_parameter_contract_mismatch')
      }
    }
  }
  const columns = definition.columns
    .slice()
    .sort((left, right) => left.order - right.order)
  const aliases = new Set<string>(),
    orders = new Set<number>()
  if (
    columns.length === 0 ||
    columns.some(
      (column) =>
        !/^[a-z][a-z0-9_]{0,62}[a-z0-9]$/.test(column.alias) ||
        !column.name ||
        column.name.length > 100 ||
        !Number.isInteger(column.order) ||
        column.order < 1 ||
        ![
          'TEXT',
          'INTEGER',
          'DECIMAL',
          'BOOLEAN',
          'DATE',
          'DATETIME',
          'ID',
        ].includes(column.type) ||
        !Number.isInteger(column.width) ||
        column.width < 60 ||
        column.width > 1000 ||
        typeof column.visible !== 'boolean' ||
        (column.format !== undefined && column.format.length > 100) ||
        (column.drilldownEntity !== undefined &&
          column.drilldownEntity !== 'VOU') ||
        aliases.has(column.alias) ||
        orders.has(column.order) ||
        !aliases.add(column.alias) ||
        !orders.add(column.order),
    )
  )
    throw new RptApplicationError('rpt_result_columns_mismatch')
}

function sampleValue(parameter: RptParameter): unknown {
  if (!parameter.required) return null
  if (parameter.type === 'INTEGER') return 0
  if (parameter.type === 'DECIMAL') return '0'
  if (parameter.type === 'BOOLEAN') return false
  if (parameter.type === 'DATE') return '2000-01-01'
  if (parameter.type === 'DATE_RANGE') return ['2000-01-01', '2000-01-01']
  if (parameter.type === 'ENUM') return parameter.enumValues![0]
  return parameter.type === 'REFERENCE' ? '00000000000000000000000000' : ''
}

function postgresParameterType(parameter: RptParameter): string {
  if (parameter.type === 'INTEGER') return 'bigint'
  if (parameter.type === 'DECIMAL') return 'numeric'
  if (parameter.type === 'BOOLEAN') return 'boolean'
  if (parameter.type === 'DATE') return 'date'
  if (parameter.type === 'DATE_RANGE') return 'date[]'
  return 'text'
}

function sampleLiteral(parameter: RptParameter): string {
  if (!parameter.required) return 'NULL'
  if (parameter.type === 'INTEGER' || parameter.type === 'DECIMAL') return '0'
  if (parameter.type === 'BOOLEAN') return 'FALSE'
  if (parameter.type === 'DATE') return "DATE '2000-01-01'"
  if (parameter.type === 'DATE_RANGE')
    return "ARRAY[DATE '2000-01-01', DATE '2000-01-01']"
  if (parameter.type === 'REFERENCE') return "'00000000000000000000000000'"
  return "''"
}

function assertColumnMetadata(
  definition: RptDefinition,
  fields: readonly pg.FieldDef[],
): void {
  const expected = definition.columns
    .slice()
    .sort((left, right) => left.order - right.order)
  if (
    fields.length !== expected.length ||
    fields.some((field, index) => field.name !== expected[index]!.alias)
  )
    throw new RptApplicationError('rpt_result_columns_mismatch')
  const typeOids: Record<RptColumn['type'], readonly number[]> = {
    TEXT: [25, 1042, 1043],
    INTEGER: [20, 21, 23],
    DECIMAL: [1700],
    BOOLEAN: [16],
    DATE: [1082],
    DATETIME: [1114, 1184],
    ID: [25, 1042, 1043],
  }
  if (
    fields.some(
      (field, index) =>
        !typeOids[expected[index]!.type].includes(field.dataTypeID),
    )
  )
    throw new RptApplicationError('rpt_result_column_type_mismatch')
}

/** Call inside a read-only transaction: Kysely discards node-postgres RowDescription fields, so approval/release use this pg-client seam for empty-result contracts. */
export async function validateRptDefinition(
  client: pg.PoolClient,
  executor: Executor,
  definition: RptDefinition,
): Promise<void> {
  assertRptReadOnlyStatement(definition.sql)
  assertRptDefinitionContract(definition)
  const parameters: RptParameter[] = []
  const statement = bindStatement(
    definition,
    Object.fromEntries(
      definition.parameters.map((parameter) => [
        parameter.key,
        sampleValue(parameter),
      ]),
    ),
    (parameter) => parameters.push(parameter),
  )
  const compiled = statement.compile(executor)
  const preparedName = `rpt_validation_${ulid().toLowerCase()}`
  const signature =
    parameters.length > 0
      ? ` (${parameters.map(postgresParameterType).join(', ')})`
      : ''
  const invocation =
    parameters.length > 0 ? `(${parameters.map(sampleLiteral).join(', ')})` : ''
  await client.query('SAVEPOINT rpt_definition_validation')
  try {
    await client.query(
      `PREPARE ${preparedName}${signature} AS SELECT * FROM (${compiled.sql}) AS rpt_validation_result LIMIT 1`,
    )
    await client.query(`EXPLAIN EXECUTE ${preparedName}${invocation}`)
    const result = await client.query(`EXECUTE ${preparedName}${invocation}`)
    assertColumnMetadata(definition, result.fields)
    await client.query(`DEALLOCATE ${preparedName}`)
    await client.query('RELEASE SAVEPOINT rpt_definition_validation')
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT rpt_definition_validation')
    await client.query('RELEASE SAVEPOINT rpt_definition_validation')
    throw error
  }
}

export class PgRptDefinitionValidator implements RptDefinitionValidator {
  private readonly pool: pg.Pool
  private readonly executor: Kysely<DB>

  constructor(pool: pg.Pool, executor: Kysely<DB>) {
    this.pool = pool
    this.executor = executor
  }

  async validate(definition: RptDefinition): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN READ ONLY')
      await client.query("SET LOCAL statement_timeout = '5s'")
      await validateRptDefinition(client, this.executor, definition)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }
}

export class RptService {
  private readonly db: Kysely<DB>
  private readonly validator: RptDefinitionValidator

  constructor(db: Kysely<DB>, validator: RptDefinitionValidator) {
    this.db = db
    this.validator = validator
  }

  async get(subjectId: string, actor: ApprovalActor) {
    requirePermission(actor, '/rpt/definition/get')
    const row = await this.db
      .selectFrom('rpt_definitions')
      .selectAll()
      .where('id', '=', subjectId)
      .executeTakeFirst()
    if (!row) throw new RptApplicationError('rpt_definition_not_found')
    return this.projectDefinition(row)
  }

  async save(
    input: z.infer<typeof definitionInput>,
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, '/rpt/definition/save')
    const parsed = definitionInput.safeParse(input)
    if (!parsed.success)
      throw new RptApplicationError('rpt_definition_invalid_data')
    input = parsed.data
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('rpt:definition:save',0))`.execute(
        tx,
      )
      const existing = await tx
        .selectFrom('rpt_definitions')
        .selectAll()
        .where('id', '=', input.subjectId)
        .forUpdate()
        .executeTakeFirst()
      if (
        (existing ? String(existing.revision) : null) !== input.expectedRevision
      )
        throw new RptApplicationError('rpt_revision_conflict')
      let code = existing?.code
      if (!code) {
        const counter = await sql<{
          value: string
        }>`UPDATE rpt_code_counter SET next_value=next_value+1 WHERE key='definition' RETURNING (next_value-1)::text value`.execute(
          tx,
        )
        code = `rpt-${counter.rows[0]!.value.padStart(6, '0')}`
        if (!/^rpt-[0-9]{6}$/.test(code))
          throw new RptApplicationError('rpt_code_exhausted')
      }
      const revision = String(BigInt(existing?.revision ?? 0) + 1n)
      const definition = { ...input, code, revision }
      try {
        await this.validator.validate(definition)
      } catch {
        throw new RptApplicationError('rpt_definition_invalid_data')
      }
      const now = new Date()
      const values = {
        name: input.name,
        description: input.description,
        enabled: input.enabled,
        sql_text: input.sql,
        parameters: json(input.parameters),
        columns: json(input.columns),
        revision,
        validity: 'VALID',
        diagnostic: null,
        updated_at: now,
        updated_by: actor.id,
      }
      const row = existing
        ? await tx
            .updateTable('rpt_definitions')
            .set(values)
            .where('id', '=', input.subjectId)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await tx
            .insertInto('rpt_definitions')
            .values({
              ...values,
              id: input.subjectId,
              code,
              created_at: now,
              created_by: actor.id,
            })
            .returningAll()
            .executeTakeFirstOrThrow()
      await tx
        .insertInto('rpt_definition_audits')
        .values({
          id: ulid(),
          definition_id: row.id,
          revision,
          actor_id: actor.id,
          request_id: requestId,
          created_at: now,
        })
        .execute()
      await this.syncPermissions(tx, row.code, row.name, row.enabled, actor.id)
      return this.projectDefinition(row)
    })
  }

  private deterministic(error: unknown): boolean {
    return (
      (error instanceof RptApplicationError &&
        [
          'rpt_definition_invalid_sql',
          'rpt_parameter_contract_mismatch',
          'rpt_result_columns_mismatch',
          'rpt_result_column_type_mismatch',
        ].includes(error.errorKey)) ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        [
          '42P01',
          '42703',
          '42883',
          '42804',
          '42P18',
          '42601',
          '42704',
        ].includes(String(error.code)))
    )
  }

  private async invalidate(definition: RptDefinition, error: unknown) {
    if (!this.deterministic(error)) return
    await this.db.transaction().execute(async (tx) => {
      const row = await tx
        .updateTable('rpt_definitions')
        .set({
          validity: 'INVALID',
          diagnostic:
            error instanceof Error ? error.message : 'Invalid definition',
        })
        .where('id', '=', definition.subjectId)
        .where('revision', '=', definition.revision)
        .returningAll()
        .executeTakeFirst()
      if (row)
        await this.syncPermissions(
          tx,
          row.code,
          row.name,
          false,
          row.updated_by,
        )
    })
  }

  async syncPermissions(
    tx: Transaction<DB>,
    code: string,
    name: string,
    enabled: boolean,
    actorId: string,
  ) {
    for (const action of ['query', 'export']) {
      const path = `/rpt/${code}/${action}`
      const status = enabled ? ('ENABLED' as const) : ('DISABLED' as const)
      await tx
        .insertInto('app_permissions')
        .values({
          id: `01J${createHash('sha256').update(path).digest('hex').slice(0, 23).toUpperCase()}`,
          path,
          domain: 'rpt',
          entity: code,
          action,
          description: name,
          status,
          created_by: actorId,
          updated_by: actorId,
        })
        .onConflict((c) =>
          c.column('path').doUpdateSet({
            description: name,
            status,
            updated_by: actorId,
            updated_at: new Date(),
          }),
        )
        .execute()
    }
  }

  async directory(actor: ApprovalActor) {
    const definitions = await this.enabledDefinitions(this.db)
    return definitions
      .filter(
        (definition) =>
          actor.trusted === true ||
          actor.permissions.includes(`/rpt/${definition.code}/query`) ||
          actor.permissions.includes(`/rpt/${definition.code}/export`),
      )
      .map(({ subjectId, revision, code, name, parameters, columns }) => ({
        subjectId,
        revision,
        code,
        name,
        parameters,
        columns,
      }))
  }

  async query(
    code: string,
    input: {
      parameters: Record<string, unknown>
      page: number
      pageSize: number
    },
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, `/rpt/${code}/query`)
    if (input.page < 1 || input.pageSize < 1 || input.pageSize > 100)
      throw new RptApplicationError('rpt_pagination_invalid')
    const definition = await this.definitionByCode(this.db, code)
    const statement = bindStatement(definition, input.parameters)
    const offset = (input.page - 1) * input.pageSize
    const fetchedRows = await this.db
      .transaction()
      .execute(async (tx) => {
        await sql`SET LOCAL TRANSACTION READ ONLY`.execute(tx)
        await sql`SET LOCAL statement_timeout = '10s'`.execute(tx)
        await sql`SET LOCAL lock_timeout = '1s'`.execute(tx)
        await sql`SET LOCAL idle_in_transaction_session_timeout = '15s'`.execute(
          tx,
        )
        await this.assertReferenceParameters(tx, definition, input.parameters)
        const result = await sql<
          Record<string, unknown>
        >`SELECT * FROM (${statement}) AS report_result LIMIT ${input.pageSize + 1} OFFSET ${offset}`.execute(
          tx,
        )
        this.assertRows(definition, result.rows)
        return this.wireRows(definition, result.rows)
      })
      .catch(async (error) => {
        await this.invalidate(definition, error)
        throw error instanceof RptApplicationError
          ? error
          : new RptApplicationError('rpt_execution_failed')
      })
    const { rows, hasMore } = projectRptPage(fetchedRows, input.pageSize)
    await this.audit(
      definition,
      actor.id,
      'QUERY',
      input.parameters,
      rows.length,
      requestId,
    )
    return {
      revision: definition.revision,
      columns: definition.columns,
      rows,
      page: input.page,
      pageSize: input.pageSize,
      hasMore,
    }
  }

  async export(
    code: string,
    parameters: Record<string, unknown>,
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, `/rpt/${code}/export`)
    const definition = await this.definitionByCode(this.db, code)
    const statement = bindStatement(definition, parameters)
    const rows = await this.db
      .transaction()
      .execute(async (tx) => {
        await sql`SET LOCAL TRANSACTION READ ONLY`.execute(tx)
        await sql`SET LOCAL statement_timeout = '30s'`.execute(tx)
        await sql`SET LOCAL lock_timeout = '1s'`.execute(tx)
        await sql`SET LOCAL idle_in_transaction_session_timeout = '35s'`.execute(
          tx,
        )
        await this.assertReferenceParameters(tx, definition, parameters)
        const result = await sql<
          Record<string, unknown>
        >`SELECT * FROM (${statement}) AS report_result LIMIT 100001`.execute(
          tx,
        )
        if (result.rows.length > 100_000)
          throw new RptApplicationError('rpt_export_limit_exceeded')
        this.assertRows(definition, result.rows)
        return this.wireRows(definition, result.rows)
      })
      .catch(async (error) => {
        await this.invalidate(definition, error)
        throw error instanceof RptApplicationError
          ? error
          : new RptApplicationError('rpt_execution_failed')
      })
    await this.audit(
      definition,
      actor.id,
      'EXPORT',
      parameters,
      rows.length,
      requestId,
    )
    return {
      revision: definition.revision,
      columns: definition.columns,
      rows,
    }
  }

  async referenceQuery(
    code: string,
    input: {
      parameterKey: string
      keyword?: string
      selectedId?: string
      page: number
      pageSize: number
    },
  ): Promise<RptReferencePage> {
    if (
      !/^[a-z][a-zA-Z0-9]{0,63}$/.test(input.parameterKey) ||
      input.page < 1 ||
      input.pageSize < 1 ||
      input.pageSize > 50
    )
      throw new RptApplicationError('rpt_reference_query_invalid')
    if (input.keyword !== undefined && input.keyword.length > 200)
      throw new RptApplicationError('rpt_reference_query_invalid')
    if (input.selectedId !== undefined && input.selectedId.length > 64)
      throw new RptApplicationError('rpt_reference_query_invalid')
    const definition = await this.enabledDefinitionByCode(this.db, code)
    try {
      await this.validator.validate(definition)
    } catch (error) {
      throw this.definitionValidationError(error)
    }
    const parameter = definition.parameters.find(
      (item) => item.key === input.parameterKey,
    )
    if (
      !parameter ||
      parameter.type !== 'REFERENCE' ||
      !parameter.referenceType
    )
      throw new RptApplicationError('rpt_reference_parameter_invalid')
    if (
      parameter.referenceType === 'ASSET' ||
      parameter.referenceType === 'BILL'
    )
      await this.ensureRegisterReferenceIsUnique(
        this.db,
        parameter.referenceType,
      )
    const source = this.referenceSource(parameter.referenceType)
    if (!source) throw new RptApplicationError('rpt_reference_unavailable')
    const keyword = input.keyword?.trim()
    const selectedId = input.selectedId?.trim()
    const filter = selectedId
      ? sql`id = ${selectedId}`
      : keyword
        ? sql`(code ILIKE ${`%${keyword}%`} OR name ILIKE ${`%${keyword}%`})`
        : sql`TRUE`
    const offset = (input.page - 1) * input.pageSize
    const page = await this.db.transaction().execute(async (tx) => {
      await sql`SET LOCAL TRANSACTION READ ONLY`.execute(tx)
      await sql`SET LOCAL statement_timeout = '10s'`.execute(tx)
      await sql`SET LOCAL lock_timeout = '1s'`.execute(tx)
      await sql`SET LOCAL idle_in_transaction_session_timeout = '15s'`.execute(
        tx,
      )
      const [items, total] = await Promise.all([
        sql<
          Record<string, string>
        >`SELECT * FROM (${sql.raw(source)}) AS reference_candidate WHERE ${filter} ORDER BY code, id LIMIT ${input.pageSize} OFFSET ${offset}`.execute(
          tx,
        ),
        sql<{
          total: string
        }>`SELECT count(*)::text AS total FROM (${sql.raw(source)}) AS reference_candidate WHERE ${filter}`.execute(
          tx,
        ),
      ])
      return {
        items: this.projectReferenceItems(parameter.referenceType!, items.rows),
        total: Number(total.rows[0]?.total ?? 0),
      }
    })
    return { ...page, page: input.page, pageSize: input.pageSize }
  }

  async assertAllEnabled(): Promise<void> {
    const definitions = await this.enabledDefinitions(this.db, false)
    const failures: string[] = []
    for (const definition of definitions) {
      try {
        await this.validator.validate(definition)
        if (definition.validity !== 'VALID')
          throw new RptApplicationError('rpt_definition_not_executable')
      } catch (error) {
        await this.invalidate(definition, error)
        failures.push(
          `${definition.code}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    if (failures.length > 0)
      throw new RptApplicationError(
        `rpt_validation_failed:${failures.join('|')}`,
      )
  }

  private async enabledDefinitionByCode(
    executor: Executor,
    code: string,
  ): Promise<RptDefinition> {
    const definitions = await this.enabledDefinitions(executor)
    const definition = definitions.find((item) => item.code === code)
    if (!definition)
      throw new RptApplicationError('rpt_definition_not_executable')
    return definition
  }

  private async definitionByCode(
    executor: Executor,
    code: string,
  ): Promise<RptDefinition> {
    const definition = await this.enabledDefinitionByCode(executor, code)
    try {
      await this.validator.validate(definition)
    } catch (error) {
      await this.invalidate(definition, error)
      throw this.definitionValidationError(error)
    }
    return definition
  }

  private definitionValidationError(error: unknown) {
    return new RptApplicationError(
      this.deterministic(error)
        ? 'rpt_definition_not_executable'
        : 'rpt_execution_failed',
    )
  }

  private referenceSource(referenceType: RptReferenceType): string | undefined {
    const currentBob = (entity: string, table: string, name: string) => `
      SELECT subject.id, subject.code, ${name} AS name
      FROM bob_subjects subject
      JOIN LATERAL (
        SELECT id FROM approval_entries entry
        WHERE entry.domain = 'bob' AND entry.entity = '${entity}'
          AND entry.subject_id = subject.id AND entry.status = 'APPROVED'
        ORDER BY entry.version_no DESC LIMIT 1
      ) approval ON TRUE
      JOIN ${table} version ON version.approval_entry_id = approval.id
      WHERE subject.entity = '${entity}' AND subject.enabled`
    switch (referenceType) {
      case 'ACCOUNTING_BOOK':
        return `SELECT id, code, name FROM acc_books`
      case 'ACCOUNT_SUBJECT':
        return `SELECT id, code, name FROM acc_subjects WHERE enabled`
      case 'CUSTOMER_SUBUNIT':
        return `
        SELECT root.subunit_id AS id, root.code, subunit.name,
          subject.code AS customer_code, customer.display_name AS customer_name
        FROM bob_subjects subject
        JOIN LATERAL (
          SELECT id FROM approval_entries entry
          WHERE entry.domain = 'bob' AND entry.entity = 'customer'
            AND entry.subject_id = subject.id AND entry.status = 'APPROVED'
          ORDER BY entry.version_no DESC LIMIT 1
        ) approval ON TRUE
        JOIN bob_customer_versions customer ON customer.approval_entry_id = approval.id AND subject.enabled
        JOIN bob_customer_version_subunits subunit ON subunit.customer_approval_entry_id = approval.id AND subunit.enabled
        JOIN bob_customer_subunit_roots root ON root.subunit_id = subunit.subunit_id
        WHERE subject.entity = 'customer'`
      case 'SUPPLIER':
        return currentBob(
          'supplier',
          'bob_supplier_versions',
          'version.display_name',
        )
      case 'OTHER_UNIT':
        return currentBob(
          'other-unit',
          'bob_other_unit_versions',
          'version.display_name',
        )
      case 'EMPLOYEE':
        return `SELECT id, code, data->>'displayName' AS name
          FROM aux_objects WHERE entity = 'employee' AND enabled`
      case 'SALES_PARTNER':
        return currentBob(
          'sales-partner',
          'bob_sales_partner_versions',
          'version.display_name',
        )
      case 'DEPARTMENT':
        return `SELECT id, code, data->>'name' AS name FROM aux_objects WHERE entity = 'department' AND enabled`
      case 'PRODUCT':
        return currentBob('product', 'bob_product_versions', 'version.name')
      case 'WAREHOUSE':
        return `SELECT id, code, data->>'name' AS name FROM aux_objects WHERE entity='warehouse' AND enabled`
      case 'FUND_ACCOUNT':
        return `SELECT id, code, data->>'name' AS name FROM aux_objects WHERE entity='fund-account' AND enabled`
      case 'ASSET':
        return `
        SELECT object_id AS id, payload->>'assetNo' AS code, payload->>'name' AS name
        FROM acc_register_entries
        WHERE register_kind = 'ASSET' AND reversed_at IS NULL
          AND btrim(coalesce(payload->>'assetNo', '')) <> ''
          AND btrim(coalesce(payload->>'name', '')) <> ''`
      case 'BILL':
        return `
        SELECT object_id AS id, payload->>'billNo' AS code, payload->>'billNo' AS name
        FROM acc_register_entries
        WHERE register_kind = 'BILL' AND reversed_at IS NULL
          AND btrim(coalesce(payload->>'billNo', '')) <> ''`
      case 'COUNTERPARTY':
        return `
        SELECT root.subunit_id AS id, root.code, subunit.name,
          'customer-subunit'::varchar AS entity, root.subunit_id AS object_id, approval.id AS approval_entry_id
        FROM bob_subjects subject
        JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'bob' AND entry.entity = 'customer' AND entry.subject_id = subject.id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
        JOIN bob_customer_versions customer ON customer.approval_entry_id = approval.id AND subject.enabled
        JOIN bob_customer_version_subunits subunit ON subunit.customer_approval_entry_id = approval.id AND subunit.enabled
        JOIN bob_customer_subunit_roots root ON root.subunit_id = subunit.subunit_id
        WHERE subject.entity = 'customer'
        UNION ALL
        SELECT subject.id, subject.code, version.display_name AS name, subject.entity, subject.id AS object_id, approval.id AS approval_entry_id
        FROM bob_subjects subject
        JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'bob' AND entry.entity = subject.entity AND entry.subject_id = subject.id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
        JOIN bob_supplier_versions version ON subject.entity = 'supplier' AND version.approval_entry_id = approval.id
        WHERE subject.enabled
        UNION ALL
        SELECT subject.id, subject.code, version.display_name AS name, subject.entity, subject.id AS object_id, approval.id AS approval_entry_id
        FROM bob_subjects subject
        JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'bob' AND entry.entity = subject.entity AND entry.subject_id = subject.id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
        JOIN bob_other_unit_versions version ON subject.entity = 'other-unit' AND version.approval_entry_id = approval.id
        WHERE subject.enabled
        UNION ALL
        SELECT employee.id, employee.code, employee.data->>'displayName' AS name,
          'employee'::varchar AS entity, employee.id AS object_id,
          NULL::varchar AS approval_entry_id
        FROM aux_objects employee
        WHERE employee.entity = 'employee' AND employee.enabled
        UNION ALL
        SELECT subject.id, subject.code, version.display_name AS name, subject.entity, subject.id AS object_id, approval.id AS approval_entry_id
        FROM bob_subjects subject
        JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'bob' AND entry.entity = subject.entity AND entry.subject_id = subject.id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
        JOIN bob_sales_partner_versions version ON subject.entity = 'sales-partner' AND version.approval_entry_id = approval.id
        WHERE subject.enabled`
    }
  }

  private projectReferenceItems(
    referenceType: RptReferenceType,
    rows: Array<Record<string, string>>,
  ): Array<Record<string, string>> {
    if (referenceType === 'CUSTOMER_SUBUNIT')
      return rows.map(({ customer_code, customer_name, ...item }) => ({
        ...item,
        customerCode: customer_code!,
        customerName: customer_name!,
      }))
    if (referenceType === 'COUNTERPARTY')
      return rows.map(({ id: _id, object_id, approval_entry_id, ...item }) => ({
        ...item,
        objectId: object_id!,
        ...(approval_entry_id ? { approvalEntryId: approval_entry_id } : {}),
      }))
    return rows
  }

  private async assertReferenceParameters(
    executor: Executor,
    definition: RptDefinition,
    values: Record<string, unknown>,
  ): Promise<void> {
    for (const parameter of definition.parameters) {
      if (parameter.type !== 'REFERENCE' || !parameter.referenceType) continue
      const value = normalizeRptParameter(parameter, values[parameter.key])
      if (value === null) continue
      if (
        parameter.referenceType === 'ASSET' ||
        parameter.referenceType === 'BILL'
      )
        await this.ensureRegisterReferenceIsUnique(
          executor,
          parameter.referenceType,
        )
      const source = this.referenceSource(parameter.referenceType)
      if (!source) throw new RptApplicationError('rpt_reference_unavailable')
      const found = await sql<{
        found: boolean
      }>`SELECT EXISTS(SELECT 1 FROM (${sql.raw(source)}) AS reference_candidate WHERE id = ${value}) AS found`.execute(
        executor,
      )
      if (found.rows[0]?.found !== true)
        throw new RptApplicationError('rpt_reference_invalid')
    }
  }

  private async ensureRegisterReferenceIsUnique(
    executor: Executor,
    referenceType: 'ASSET' | 'BILL',
  ): Promise<void> {
    const duplicate = await sql<{ object_id: string }>`
      SELECT object_id FROM acc_register_entries
      WHERE register_kind = ${referenceType} AND reversed_at IS NULL
      GROUP BY object_id HAVING count(*) > 1 LIMIT 1
    `.execute(executor)
    if (duplicate.rows.length > 0)
      throw new RptApplicationError('rpt_reference_ambiguous')
  }

  private async enabledDefinitions(executor: Executor, requireValid = true) {
    const rows = await executor
      .selectFrom('rpt_definitions')
      .selectAll()
      .where('enabled', '=', true)
      .orderBy('code')
      .execute()
    return rows
      .filter((row) => !requireValid || row.validity === 'VALID')
      .map((row) => this.projectDefinition(row))
  }

  private projectDefinition(row: Selectable<RptDefinitions>) {
    return {
      subjectId: row.id as string,
      revision: String(row.revision),
      code: row.code as string,
      name: row.name as string,
      description: row.description as string,
      enabled: row.enabled as boolean,
      sql: row.sql_text as string,
      parameters: array<RptParameter>(row.parameters),
      columns: array<RptColumn>(row.columns).sort((a, b) => a.order - b.order),
      validity: row.validity as 'VALID' | 'INVALID',
    }
  }

  private wireRows(definition: RptDefinition, rows: Record<string, unknown>[]) {
    return rows.map((row) =>
      Object.fromEntries(
        definition.columns.map((column) => {
          let value = row[column.alias]
          if (value instanceof Date) {
            if (column.type === 'DATE')
              value = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
            else if (column.type === 'DATETIME') value = value.toISOString()
          }
          return [column.alias, value]
        }),
      ),
    )
  }

  private assertRows(
    definition: RptDefinition,
    rows: Record<string, unknown>[],
  ): void {
    if (rows.length === 0) return
    const actual = Object.keys(rows[0]!).sort()
    const expected = definition.columns.map((column) => column.alias).sort()
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new RptApplicationError('rpt_result_columns_mismatch')
  }

  private async audit(
    definition: RptDefinition,
    actorId: string,
    action: 'QUERY' | 'EXPORT',
    parameters: Record<string, unknown>,
    rowCount: number,
    requestId: string,
  ) {
    await this.db
      .insertInto('rpt_execution_audits')
      .values({
        id: ulid(),
        definition_subject_id: definition.subjectId,
        approval_entry_id: null,
        definition_revision: definition.revision,
        actor_id: actorId,
        action,
        parameters: json(parameters),
        row_count: rowCount,
        request_id: requestId,
        created_at: new Date(),
      })
      .execute()
  }
}
