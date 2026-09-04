import type { ApprovalActor } from '@zerp/model'
import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely'
import type pg from 'pg'
import { ulid } from 'ulid'

import type { DB, JsonValue } from '../db/generated.ts'

type Executor = Kysely<DB> | Transaction<DB>

export interface RptParameter {
  key: string
  name: string
  type: 'TEXT' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'DATE_RANGE' | 'ENUM' | 'REFERENCE'
  required: boolean
  defaultValue?: unknown
  enumValues?: readonly string[]
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
  | 'ACCOUNTING_BOOK' | 'ACCOUNT_SUBJECT' | 'CUSTOMER_SUBUNIT' | 'SUPPLIER'
  | 'OTHER_UNIT' | 'EMPLOYEE' | 'SALES_PARTNER' | 'DEPARTMENT' | 'PRODUCT'
  | 'WAREHOUSE' | 'FUND_ACCOUNT' | 'ASSET' | 'BILL' | 'COUNTERPARTY'

export interface RptDefinition {
  subjectId: string
  approvalEntryId: string
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
    throw new RptApplicationError('approval_invalid_action')
}

function json(value: unknown): JsonValue {
  return JSON.stringify(value) as unknown as JsonValue
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

export function assertRptReadOnlyStatement(statement: string): void {
  const normalized = statement.trim()
  if (
    !/^(select|with)\b/i.test(normalized) ||
    /;/.test(normalized) ||
    /\b(insert|update|delete|merge|copy|alter|create|drop|grant|revoke|call|do|vacuum|truncate)\b/i.test(normalized)
  ) throw new RptApplicationError('rpt_definition_invalid_sql')
}

function isDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function isStableId(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value)
}

function normalizeRptParameterValue(parameter: RptParameter, value: unknown): unknown {
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
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !isDate(value)) throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (parameter.type === 'DATE_RANGE') {
    if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item) || !isDate(item)) || value[0]! > value[1]!)
      throw new RptApplicationError('rpt_parameter_invalid')
    return value
  }
  if (parameter.type !== 'TEXT' && parameter.type !== 'ENUM' && parameter.type !== 'REFERENCE') throw new RptApplicationError('rpt_parameter_invalid')
  if (typeof value !== 'string') throw new RptApplicationError('rpt_parameter_invalid')
  if (parameter.type === 'ENUM' && !parameter.enumValues?.includes(value)) throw new RptApplicationError('rpt_parameter_invalid')
  if (parameter.type === 'REFERENCE' && !isStableId(value)) throw new RptApplicationError('rpt_parameter_invalid')
  return value
}

export function normalizeRptParameter(parameter: RptParameter, value: unknown): unknown {
  return normalizeRptParameterValue(
    parameter,
    value === undefined && parameter.defaultValue !== undefined ? parameter.defaultValue : value,
  )
}

function bindStatement(definition: RptDefinition, values: Record<string, unknown>, onBind?: (parameter: RptParameter) => void): RawBuilder<unknown> {
  const parameters = new Map(definition.parameters.map((parameter) => [parameter.key, parameter]))
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

function assertDefinitionContract(definition: RptDefinition): void {
  const parameterNames = new Set<string>()
  const referenceTypes: readonly RptReferenceType[] = [
    'ACCOUNTING_BOOK', 'ACCOUNT_SUBJECT', 'CUSTOMER_SUBUNIT', 'SUPPLIER', 'OTHER_UNIT',
    'EMPLOYEE', 'SALES_PARTNER', 'DEPARTMENT', 'PRODUCT', 'WAREHOUSE', 'FUND_ACCOUNT',
    'ASSET', 'BILL', 'COUNTERPARTY',
  ]
  if (definition.parameters.some((parameter) =>
    !/^[a-z][a-zA-Z0-9]{0,63}$/.test(parameter.key) ||
    !parameter.name || parameter.name.length > 100 ||
    !['TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATE_RANGE', 'ENUM', 'REFERENCE'].includes(parameter.type) ||
    parameterNames.has(parameter.key) || !parameterNames.add(parameter.key) ||
    (parameter.type === 'ENUM' && (!parameter.enumValues || parameter.enumValues.length === 0 || parameter.enumValues.some((value) => !value || value.length > 200) || new Set(parameter.enumValues).size !== parameter.enumValues.length)) ||
    (parameter.type !== 'ENUM' && parameter.enumValues !== undefined) ||
    (parameter.type === 'REFERENCE' && !referenceTypes.includes(parameter.referenceType as RptReferenceType)) ||
    (parameter.type !== 'REFERENCE' && parameter.referenceType !== undefined)
  ))
    throw new RptApplicationError('rpt_parameter_contract_mismatch')
  for (const parameter of definition.parameters) {
    if (parameter.defaultValue !== undefined) {
      try { normalizeRptParameterValue(parameter, parameter.defaultValue) }
      catch { throw new RptApplicationError('rpt_parameter_contract_mismatch') }
    }
  }
  const columns = definition.columns.slice().sort((left, right) => left.order - right.order)
  const aliases = new Set<string>(), orders = new Set<number>()
  if (columns.length === 0 || columns.some((column) =>
    !/^[a-z][a-z0-9_]{0,62}[a-z0-9]$/.test(column.alias) ||
    !column.name || column.name.length > 100 ||
    !Number.isInteger(column.order) || column.order < 1 ||
    !['TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME', 'ID'].includes(column.type) ||
    !Number.isInteger(column.width) || column.width < 60 || column.width > 1000 ||
    typeof column.visible !== 'boolean' ||
    (column.format !== undefined && column.format.length > 100) ||
    (column.drilldownEntity !== undefined && column.drilldownEntity !== 'VOU') ||
    aliases.has(column.alias) || orders.has(column.order) || !aliases.add(column.alias) || !orders.add(column.order)
  ))
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
  if (parameter.type === 'DATE_RANGE') return "ARRAY[DATE '2000-01-01', DATE '2000-01-01']"
  if (parameter.type === 'REFERENCE') return "'00000000000000000000000000'"
  return "''"
}

function assertColumnMetadata(definition: RptDefinition, fields: readonly pg.FieldDef[]): void {
  const expected = definition.columns.slice().sort((left, right) => left.order - right.order)
  if (fields.length !== expected.length || fields.some((field, index) => field.name !== expected[index]!.alias))
    throw new RptApplicationError('rpt_result_columns_mismatch')
  const typeOids: Record<RptColumn['type'], readonly number[]> = {
    TEXT: [25, 1042, 1043], INTEGER: [20, 21, 23], DECIMAL: [1700], BOOLEAN: [16], DATE: [1082], DATETIME: [1114, 1184], ID: [25, 1042, 1043],
  }
  if (fields.some((field, index) => !typeOids[expected[index]!.type].includes(field.dataTypeID)))
    throw new RptApplicationError('rpt_result_column_type_mismatch')
}

/** Call inside a read-only transaction: Kysely discards node-postgres RowDescription fields, so approval/release use this pg-client seam for empty-result contracts. */
export async function validateRptDefinition(client: pg.PoolClient, executor: Executor, definition: RptDefinition): Promise<void> {
  assertRptReadOnlyStatement(definition.sql)
  assertDefinitionContract(definition)
  const parameters: RptParameter[] = []
  const statement = bindStatement(definition, Object.fromEntries(definition.parameters.map((parameter) => [parameter.key, sampleValue(parameter)])), (parameter) => parameters.push(parameter))
  const compiled = statement.compile(executor)
  const preparedName = `rpt_validation_${ulid().toLowerCase()}`
  const signature = parameters.length > 0 ? ` (${parameters.map(postgresParameterType).join(', ')})` : ''
  const invocation = parameters.length > 0 ? `(${parameters.map(sampleLiteral).join(', ')})` : ''
  await client.query('SAVEPOINT rpt_definition_validation')
  try {
    await client.query(`PREPARE ${preparedName}${signature} AS SELECT * FROM (${compiled.sql}) AS rpt_validation_result LIMIT 1`)
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
    } finally { client.release() }
  }
}

export class RptService {
  private readonly db: Kysely<DB>
  private readonly validator: RptDefinitionValidator

  constructor(db: Kysely<DB>, validator: RptDefinitionValidator) {
    this.db = db
    this.validator = validator
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
      await sql`SET LOCAL lock_timeout = '1s'`.execute(tx)
      await sql`SET LOCAL idle_in_transaction_session_timeout = '15s'`.execute(tx)
      await this.assertReferenceParameters(tx, definition, input.parameters)
      const result = await sql<Record<string, unknown>>`SELECT * FROM (${statement}) AS report_result LIMIT ${input.pageSize} OFFSET ${offset}`.execute(tx)
      this.assertRows(definition, result.rows)
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
      await sql`SET LOCAL lock_timeout = '1s'`.execute(tx)
      await sql`SET LOCAL idle_in_transaction_session_timeout = '35s'`.execute(tx)
      await this.assertReferenceParameters(tx, definition, parameters)
      const result = await sql<Record<string, unknown>>`SELECT * FROM (${statement}) AS report_result LIMIT 100001`.execute(tx)
      if (result.rows.length > 100_000) throw new RptApplicationError('rpt_export_limit_exceeded')
      this.assertRows(definition, result.rows)
      return result.rows
    })
    await this.audit(definition, actor.id, 'EXPORT', parameters, rows.length, requestId)
    return { approvalEntryId: definition.approvalEntryId, columns: definition.columns, rows }
  }

  async referenceQuery(
    code: string,
    input: { parameterKey: string; keyword?: string; selectedId?: string; page: number; pageSize: number },
    actor: ApprovalActor,
  ): Promise<RptReferencePage> {
    requirePermission(actor, `/rpt/${code}/query`)
    if (!/^[a-z][a-zA-Z0-9]{0,63}$/.test(input.parameterKey) || input.page < 1 || input.pageSize < 1 || input.pageSize > 50)
      throw new RptApplicationError('rpt_reference_query_invalid')
    if (input.keyword !== undefined && input.keyword.length > 200)
      throw new RptApplicationError('rpt_reference_query_invalid')
    if (input.selectedId !== undefined && input.selectedId.length > 64)
      throw new RptApplicationError('rpt_reference_query_invalid')
    const definition = await this.definitionByCode(this.db, code)
    const parameter = definition.parameters.find((item) => item.key === input.parameterKey)
    if (!parameter || parameter.type !== 'REFERENCE' || !parameter.referenceType)
      throw new RptApplicationError('rpt_reference_parameter_invalid')
    if (parameter.referenceType === 'ASSET' || parameter.referenceType === 'BILL')
      await this.ensureRegisterReferenceIsUnique(this.db, parameter.referenceType)
    const source = this.referenceSource(parameter.referenceType)
    if (!source) throw new RptApplicationError('rpt_reference_unavailable')
    const keyword = input.keyword?.trim()
    const selectedId = input.selectedId?.trim()
    const filter = keyword
      ? sql`(code ILIKE ${`%${keyword}%`} OR name ILIKE ${`%${keyword}%`})${selectedId ? sql` OR id = ${selectedId}` : sql``}`
      : selectedId ? sql`id = ${selectedId} OR TRUE` : sql`TRUE`
    const offset = (input.page - 1) * input.pageSize
    const page = await this.db.transaction().execute(async (tx) => {
      await sql`SET LOCAL TRANSACTION READ ONLY`.execute(tx)
      await sql`SET LOCAL statement_timeout = '10s'`.execute(tx)
      await sql`SET LOCAL lock_timeout = '1s'`.execute(tx)
      await sql`SET LOCAL idle_in_transaction_session_timeout = '15s'`.execute(tx)
      const [items, total] = await Promise.all([
        sql<Record<string, string>>`SELECT * FROM (${sql.raw(source)}) AS reference_candidate WHERE ${filter} ORDER BY code, id LIMIT ${input.pageSize} OFFSET ${offset}`.execute(tx),
        sql<{ total: string }>`SELECT count(*)::text AS total FROM (${sql.raw(source)}) AS reference_candidate WHERE ${filter}`.execute(tx),
      ])
      return { items: this.projectReferenceItems(parameter.referenceType!, items.rows), total: Number(total.rows[0]?.total ?? 0) }
    })
    return { ...page, page: input.page, pageSize: input.pageSize }
  }

  async assertAllEnabled(): Promise<void> {
    const definitions = await this.enabledDefinitions(this.db, false)
    const failures: string[] = []
    for (const definition of definitions) {
      try {
        await this.validator.validate(definition)
      } catch (error) {
        failures.push(`${definition.code}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (failures.length > 0) throw new RptApplicationError(`rpt_validation_failed:${failures.join('|')}`)
  }

  private async definitionByCode(executor: Executor, code: string): Promise<RptDefinition> {
    const definitions = await this.enabledDefinitions(executor)
    const definition = definitions.find((item) => item.code === code)
    if (!definition) throw new RptApplicationError('rpt_definition_not_executable')
    assertRptReadOnlyStatement(definition.sql)
    assertDefinitionContract(definition)
    return definition
  }

  private referenceSource(referenceType: RptReferenceType): string | undefined {
    const currentDcl = (entity: string, table: string, name: string) => `
      SELECT subject.id, subject.code, ${name} AS name
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT id FROM approval_entries entry
        WHERE entry.domain = 'dcl' AND entry.entity = '${entity}'
          AND entry.subject_id = subject.id AND entry.status = 'APPROVED'
        ORDER BY entry.version_no DESC LIMIT 1
      ) approval ON TRUE
      JOIN ${table} version ON version.approval_entry_id = approval.id AND version.enabled
      WHERE subject.entity = '${entity}'`
    switch (referenceType) {
      case 'ACCOUNTING_BOOK': return `SELECT id, code, name FROM acc_books`
      case 'ACCOUNT_SUBJECT': return `SELECT id, code, name FROM acc_subjects WHERE enabled`
      case 'CUSTOMER_SUBUNIT': return `
        SELECT root.subunit_id AS id, root.code, subunit.name,
          subject.code AS customer_code, customer.display_name AS customer_name
        FROM dcl_subjects subject
        JOIN LATERAL (
          SELECT id FROM approval_entries entry
          WHERE entry.domain = 'dcl' AND entry.entity = 'customer'
            AND entry.subject_id = subject.id AND entry.status = 'APPROVED'
          ORDER BY entry.version_no DESC LIMIT 1
        ) approval ON TRUE
        JOIN dcl_customer_versions customer ON customer.approval_entry_id = approval.id AND customer.enabled
        JOIN dcl_customer_version_subunits subunit ON subunit.customer_approval_entry_id = approval.id AND subunit.enabled
        JOIN dcl_customer_subunit_roots root ON root.subunit_id = subunit.subunit_id
        WHERE subject.entity = 'customer'`
      case 'SUPPLIER': return currentDcl('supplier', 'dcl_supplier_versions', 'version.display_name')
      case 'OTHER_UNIT': return currentDcl('other-unit', 'dcl_other_unit_versions', 'version.display_name')
      case 'EMPLOYEE': return currentDcl('employee', 'dcl_employee_versions', 'version.display_name')
      case 'SALES_PARTNER': return currentDcl('sales-partner', 'dcl_sales_partner_versions', 'version.display_name')
      case 'DEPARTMENT': return `SELECT id, code, data->>'name' AS name FROM aux_objects WHERE entity = 'department' AND enabled`
      case 'PRODUCT': return currentDcl('product', 'dcl_product_versions', 'version.name')
      case 'WAREHOUSE': return currentDcl('warehouse', 'dcl_warehouse_versions', 'version.name')
      case 'FUND_ACCOUNT': return currentDcl('fund-account', 'dcl_fund_account_versions', 'version.name')
      case 'ASSET': return `
        SELECT object_id AS id, payload->>'assetNo' AS code, payload->>'name' AS name
        FROM acc_register_entries
        WHERE register_kind = 'ASSET' AND reversed_at IS NULL
          AND btrim(coalesce(payload->>'assetNo', '')) <> ''
          AND btrim(coalesce(payload->>'name', '')) <> ''`
      case 'BILL': return `
        SELECT object_id AS id, payload->>'billNo' AS code, payload->>'billNo' AS name
        FROM acc_register_entries
        WHERE register_kind = 'BILL' AND reversed_at IS NULL
          AND btrim(coalesce(payload->>'billNo', '')) <> ''`
      case 'COUNTERPARTY': return `
        SELECT root.subunit_id AS id, root.code, subunit.name,
          'customer-subunit'::varchar AS entity, root.subunit_id AS object_id, approval.id AS approval_entry_id
        FROM dcl_subjects subject
        JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'dcl' AND entry.entity = 'customer' AND entry.subject_id = subject.id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
        JOIN dcl_customer_versions customer ON customer.approval_entry_id = approval.id AND customer.enabled
        JOIN dcl_customer_version_subunits subunit ON subunit.customer_approval_entry_id = approval.id AND subunit.enabled
        JOIN dcl_customer_subunit_roots root ON root.subunit_id = subunit.subunit_id
        WHERE subject.entity = 'customer'
        UNION ALL
        SELECT subject.id, subject.code, version.display_name AS name, subject.entity, subject.id AS object_id, approval.id AS approval_entry_id
        FROM dcl_subjects subject
        JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'dcl' AND entry.entity = subject.entity AND entry.subject_id = subject.id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
        JOIN dcl_supplier_versions version ON subject.entity = 'supplier' AND version.approval_entry_id = approval.id AND version.enabled
        UNION ALL
        SELECT subject.id, subject.code, version.display_name AS name, subject.entity, subject.id AS object_id, approval.id AS approval_entry_id
        FROM dcl_subjects subject
        JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'dcl' AND entry.entity = subject.entity AND entry.subject_id = subject.id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
        JOIN dcl_other_unit_versions version ON subject.entity = 'other-unit' AND version.approval_entry_id = approval.id AND version.enabled
        UNION ALL
        SELECT subject.id, subject.code, version.display_name AS name, subject.entity, subject.id AS object_id, approval.id AS approval_entry_id
        FROM dcl_subjects subject
        JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'dcl' AND entry.entity = subject.entity AND entry.subject_id = subject.id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
        JOIN dcl_employee_versions version ON subject.entity = 'employee' AND version.approval_entry_id = approval.id AND version.enabled
        UNION ALL
        SELECT subject.id, subject.code, version.display_name AS name, subject.entity, subject.id AS object_id, approval.id AS approval_entry_id
        FROM dcl_subjects subject
        JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'dcl' AND entry.entity = subject.entity AND entry.subject_id = subject.id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
        JOIN dcl_sales_partner_versions version ON subject.entity = 'sales-partner' AND version.approval_entry_id = approval.id AND version.enabled`
    }
  }

  private projectReferenceItems(referenceType: RptReferenceType, rows: Array<Record<string, string>>): Array<Record<string, string>> {
    if (referenceType === 'CUSTOMER_SUBUNIT') return rows.map(({ customer_code, customer_name, ...item }) => ({
      ...item, customerCode: customer_code!, customerName: customer_name!,
    }))
    if (referenceType === 'COUNTERPARTY') return rows.map(({ id: _id, object_id, approval_entry_id, ...item }) => ({
      ...item, objectId: object_id!, approvalEntryId: approval_entry_id!,
    }))
    return rows
  }

  private async assertReferenceParameters(executor: Executor, definition: RptDefinition, values: Record<string, unknown>): Promise<void> {
    for (const parameter of definition.parameters) {
      if (parameter.type !== 'REFERENCE' || !parameter.referenceType) continue
      const value = normalizeRptParameter(parameter, values[parameter.key])
      if (value === null) continue
      if (parameter.referenceType === 'ASSET' || parameter.referenceType === 'BILL')
        await this.ensureRegisterReferenceIsUnique(executor, parameter.referenceType)
      const source = this.referenceSource(parameter.referenceType)
      if (!source) throw new RptApplicationError('rpt_reference_unavailable')
      const found = await sql<{ found: boolean }>`SELECT EXISTS(SELECT 1 FROM (${sql.raw(source)}) AS reference_candidate WHERE id = ${value}) AS found`.execute(executor)
      if (found.rows[0]?.found !== true) throw new RptApplicationError('rpt_reference_invalid')
    }
  }

  private async ensureRegisterReferenceIsUnique(executor: Executor, referenceType: 'ASSET' | 'BILL'): Promise<void> {
    const duplicate = await sql<{ object_id: string }>`
      SELECT object_id FROM acc_register_entries
      WHERE register_kind = ${referenceType} AND reversed_at IS NULL
      GROUP BY object_id HAVING count(*) > 1 LIMIT 1
    `.execute(executor)
    if (duplicate.rows.length > 0) throw new RptApplicationError('rpt_reference_ambiguous')
  }

  private async enabledDefinitions(executor: Executor, requireValid = true): Promise<RptDefinition[]> {
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
        return {
          subjectId: row.subject_id, approvalEntryId: row.approval_entry_id,
          code: row.code, name: row.name, sql: row.sql_text,
          parameters: array<RptParameter>(row.parameters), columns: array<RptColumn>(row.columns).sort((left, right) => left.order - right.order),
        }
      })
  }

  private assertRows(definition: RptDefinition, rows: Record<string, unknown>[]): void {
    if (rows.length === 0) return
    const actual = Object.keys(rows[0]!).sort()
    const expected = definition.columns.map((column) => column.alias).sort()
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new RptApplicationError('rpt_result_columns_mismatch')
  }

  private async audit(definition: RptDefinition, actorId: string, action: 'QUERY' | 'EXPORT', parameters: Record<string, unknown>, rowCount: number, requestId: string) {
    await this.db.insertInto('rpt_execution_audits').values({
      id: ulid(), definition_subject_id: definition.subjectId,
      approval_entry_id: definition.approvalEntryId, actor_id: actorId, action,
      parameters: json(parameters), row_count: rowCount, request_id: requestId, created_at: new Date(),
    }).execute()
  }
}
