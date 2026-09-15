import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import { AccService } from '../acc/service.ts'

type Executor = Kysely<DB> | Transaction<DB>
type Row = Record<string, unknown>
type Tables = Record<string, Row[]>
export interface UnitCutoverDecision {
  id: string
  fixedFactor: string | null
}
interface Blocker {
  kind: string
  table: string
  identity: string
}
const evidenceTable = 'aux_measurement_unit_conversion_evidence'
const targets = {
  aux_objects: { keys: ['id'], json: ['data'] },
  dcl_product_versions: {
    keys: ['approval_entry_id'],
    json: ['source_snapshots', 'unit_conversions', 'fixed_formula'],
  },
  vou_product_line_snapshots: {
    keys: ['approval_entry_id', 'line_no'],
    json: [],
  },
  vou_formula_component_snapshots: {
    keys: ['approval_entry_id', 'line_no', 'component_no'],
    json: [],
  },
  vou_production_line_snapshots: {
    keys: ['approval_entry_id', 'line_no'],
    json: ['formula_snapshot'],
  },
  archive_idempotency: {
    keys: ['entity', 'idempotency_key'],
    json: ['response'],
  },
  vou_idempotency: { keys: ['entity', 'idempotency_key'], json: ['response'] },
  vou_reference_snapshots: {
    keys: ['approval_entry_id', 'field', 'line_no', 'item_no'],
    json: ['aux_snapshot'],
  },
} as const
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}
function digest(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
function decimal(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value) ||
    !/[1-9]/.test(value)
  )
    return undefined
  return value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '')
    : value
}
function record(value: unknown): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {}
}
export class UnitCutoverError extends Error {
  readonly reason: string
  readonly blockers: readonly Blocker[]
  constructor(reason: string, blockers: readonly Blocker[] = []) {
    super(reason)
    this.reason = reason
    this.blockers = blockers
  }
}
async function source(db: Executor) {
  const names = await sql<{
    name: string
  }>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`.execute(
    db,
  )
  const shape =
    await sql<Row>`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`.execute(
      db,
    )
  const tables: Tables = {}
  for (const { name } of names.rows)
    tables[name] = (
      await sql<Row>`SELECT * FROM ${sql.table(name)}`.execute(db)
    ).rows.sort((a, b) => canonical(a).localeCompare(canonical(b)))
  return { tables, shape: shape.rows }
}
function plan(
  input: Awaited<ReturnType<typeof source>>,
  decisions: readonly UnitCutoverDecision[],
) {
  if (
    input.tables[evidenceTable] ||
    !input.shape.some(
      (row) =>
        row.table_name === 'vou_product_line_snapshots' &&
        row.column_name === 'entered_unit_symbol',
    )
  )
    throw new UnitCutoverError('unit_cutover_source_schema_unsupported')
  const blockers: Blocker[] = []
  const units = (input.tables.aux_objects ?? []).filter(
    (row) => row.entity === 'measurement-unit',
  )
  const fixed = new Map<string, string | null>()
  for (const decision of decisions) {
    if (
      fixed.has(decision.id) ||
      !units.some((row) => row.id === decision.id) ||
      (decision.fixedFactor !== null && !decimal(decision.fixedFactor))
    )
      blockers.push({
        kind: 'INVALID_UNIT_DECISION',
        table: 'aux_objects',
        identity: decision.id,
      })
    fixed.set(decision.id, decision.fixedFactor)
  }
  for (const unit of units)
    if (!fixed.has(String(unit.id)))
      blockers.push({
        kind: 'UNIT_DECISION_REQUIRED',
        table: 'aux_objects',
        identity: String(unit.id),
      })
  const convert = (
    value: unknown,
    table: string,
    identity: string,
    unitExpected = false,
  ): unknown => {
    if (Array.isArray(value))
      return value.map((item) => convert(item, table, identity))
    if (!value || typeof value !== 'object') {
      if (unitExpected)
        blockers.push({ kind: 'INVALID_UNIT_SNAPSHOT', table, identity })
      return value
    }
    const row = record(value)
    if (
      unitExpected ||
      'symbol' in row ||
      'quantityScale' in row ||
      fixed.has(String(row.id ?? row.objectId ?? ''))
    ) {
      const id = String(row.id ?? row.objectId ?? '')
      if (
        !id ||
        !fixed.has(id) ||
        typeof row.symbol !== 'string' ||
        !row.symbol.trim() ||
        !Number.isInteger(row.quantityScale) ||
        !row.code ||
        !row.name
      ) {
        blockers.push({ kind: 'INVALID_UNIT_SNAPSHOT', table, identity })
        return value
      }
      const { symbol: _symbol, quantityScale: _scale, ...rest } = row
      return { ...rest, fixedFactor: fixed.get(id)! }
    }
    const result = Object.fromEntries(
      Object.entries(row).map(([key, entry]) => [
        key,
        convert(
          entry,
          table,
          identity,
          ['unit', 'enteredUnit', 'pricingUnit', 'defaultInputUnit'].includes(
            key,
          ),
        ),
      ]),
    )
    if ('unit' in result && 'factor' in result) {
      const unit = record(result.unit)
      if (unit.fixedFactor !== null) {
        if (
          !decimal(result.factor) ||
          decimal(result.factor) !== decimal(unit.fixedFactor)
        )
          blockers.push({ kind: 'FIXED_FACTOR_CONFLICT', table, identity })
        result.factor = null
      }
    }
    return result
  }
  const tables: Tables = {}
  for (const [name, target] of Object.entries(targets)) {
    tables[name] = (input.tables[name] ?? []).map((original) => {
      const row = { ...original },
        identity = target.keys.map((key) => String(row[key])).join(':')
      if (name === 'aux_objects') {
        if (row.entity !== 'measurement-unit') return row
        const data = record(row.data)
        if (
          typeof data.name !== 'string' ||
          !data.name.trim() ||
          typeof data.symbol !== 'string' ||
          !Number.isInteger(data.quantityScale) ||
          Object.keys(data).some(
            (key) => !['name', 'symbol', 'quantityScale'].includes(key),
          )
        )
          blockers.push({ kind: 'INVALID_CURRENT_UNIT', table: name, identity })
        row.data = {
          name: data.name,
          fixedFactor: fixed.get(String(row.id)) ?? null,
        }
      } else {
        if (name === 'dcl_product_versions') {
          const snapshots = record(row.source_snapshots)
          for (const key of ['pricingUnit', 'defaultInputUnit'])
            if (!(key in snapshots))
              blockers.push({
                kind: 'INVALID_UNIT_SNAPSHOT',
                table: name,
                identity,
              })
          if (
            !Array.isArray(row.unit_conversions) ||
            row.unit_conversions.length === 0
          )
            blockers.push({
              kind: 'INVALID_UNIT_SNAPSHOT',
              table: name,
              identity,
            })
        }
        for (const key of target.json)
          row[key] = convert(row[key], name, identity)
      }
      if (
        name === 'vou_product_line_snapshots' ||
        name === 'vou_formula_component_snapshots'
      ) {
        for (const prefix of name === 'vou_product_line_snapshots'
          ? ['entered_unit', 'formula_output_entered_unit']
          : ['entered_unit']) {
          const id = row[`${prefix}_id`]
          if (id !== null && !fixed.has(String(id)))
            blockers.push({ kind: 'MISSING_UNIT', table: name, identity })
          row[`${prefix}_fixed_factor`] =
            id === null ? null : (fixed.get(String(id)) ?? null)
          delete row[`${prefix}_symbol`]
          delete row[`${prefix}_quantity_scale`]
        }
      }
      return row
    })
  }
  for (const name of [
    'acc_mappings',
    'acc_mapping_history',
    'wfl_definition_versions',
    'rpt_definitions',
    'rpt_definition_history',
  ]) {
    for (const row of input.tables[name] ?? [])
      if (
        /quantityScale|(?:enteredUnit|pricingUnit|defaultInputUnit)\s*\.\s*symbol/.test(
          canonical(row),
        )
      )
        blockers.push({
          kind: 'EXECUTABLE_UNIT_RULE',
          table: name,
          identity: String(row.id ?? row.approval_entry_id ?? row.revision),
        })
  }
  return {
    tables,
    blockers,
    units: units.map((row) => ({
      id: String(row.id),
      name: record(row.data).name,
      fixedFactor: fixed.get(String(row.id)),
    })),
  }
}
export async function inspectUnitCutover(
  db: Executor,
  decisions: readonly UnitCutoverDecision[] = [],
) {
  const original = await source(db),
    projected = plan(original, decisions)
  return {
    baseline: digest({ original, decisions }),
    units: projected.units,
    blockers: projected.blockers,
    rows: Object.fromEntries(
      Object.entries(projected.tables).map(([name, rows]) => [
        name,
        rows.length,
      ]),
    ),
  }
}
export async function migrateMeasurementUnits(
  db: Kysely<DB>,
  input: {
    baseline: string
    decisions: readonly UnitCutoverDecision[]
    actorId: string
    sourceReleaseSha: string
    targetReleaseSha: string
  },
) {
  const schema = await readFile(
    new URL('../../db/target-schema.sql', import.meta.url),
    'utf8',
  )
  return db.transaction().execute(async (tx) => {
    const names = await sql<{
      name: string
    }>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`.execute(
      tx,
    )
    await sql`LOCK TABLE ${sql.join(names.rows.map((row) => sql.table(row.name)))} IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const original = await source(tx)
    if (digest({ original, decisions: input.decisions }) !== input.baseline)
      throw new UnitCutoverError('unit_cutover_baseline_changed')
    const user = (original.tables.app_users ?? []).find(
      (row) => row.id === input.actorId && row.status === 'ENABLED',
    )
    const roles = new Set(
      (original.tables.app_roles ?? [])
        .filter((row) => row.code === 'superadmin')
        .map((row) => row.id),
    )
    if (
      !user ||
      !(original.tables.app_user_roles ?? []).some(
        (row) => row.user_id === input.actorId && roles.has(row.role_id),
      )
    )
      throw new UnitCutoverError('unit_cutover_operator_required')
    const projected = plan(original, input.decisions)
    if (projected.blockers.length)
      throw new UnitCutoverError(
        'unit_cutover_review_required',
        projected.blockers,
      )
    for (const name of [
      'vou_product_line_snapshots',
      'vou_formula_component_snapshots',
    ]) {
      for (const prefix of name === 'vou_product_line_snapshots'
        ? ['entered_unit', 'formula_output_entered_unit']
        : ['entered_unit']) {
        await sql`ALTER TABLE ${sql.table(name)} ADD COLUMN ${sql.id(`${prefix}_fixed_factor`)} text, DROP COLUMN ${sql.id(`${prefix}_symbol`)}, DROP COLUMN ${sql.id(`${prefix}_quantity_scale`)}`.execute(
          tx,
        )
      }
    }
    const productDefinition = schema.slice(
      schema.indexOf('CREATE TABLE vou_product_line_snapshots ('),
      schema.indexOf('CREATE TABLE vou_formula_component_snapshots ('),
    )
    const shapeCheck = productDefinition
      .slice(
        productDefinition.indexOf('    CHECK ('),
        productDefinition.lastIndexOf('\n);'),
      )
      .trim()
    await sql`ALTER TABLE vou_product_line_snapshots ADD ${sql.raw(shapeCheck)}`.execute(
      tx,
    )
    for (const [name, target] of Object.entries(targets)) {
      for (const row of projected.tables[name]!) {
        const originalRow = original.tables[name]!.find((candidate) =>
          target.keys.every((key) => candidate[key] === row[key]),
        )!
        const keys = Object.keys(row).filter(
          (key) =>
            !target.keys.includes(key as never) &&
            canonical(row[key]) !== canonical(originalRow[key]),
        )
        if (!keys.length) continue
        await sql`UPDATE ${sql.table(name)} SET ${sql.join(keys.map((key) => (target.json.includes(key as never) ? sql`${sql.id(key)}=${JSON.stringify(row[key])}::jsonb` : sql`${sql.id(key)}=${row[key]}`)))} WHERE ${sql.join(
          target.keys.map((key) => sql`${sql.id(key)}=${row[key]}`),
          sql` AND `,
        )}`.execute(tx)
      }
    }
    const reread = await source(tx)
    for (const [name, rows] of Object.entries(original.tables)) {
      const expected = projected.tables[name] ?? rows
      if (
        digest(expected.map(canonical).sort()) !==
        digest(reread.tables[name]!.map(canonical).sort())
      )
        throw new UnitCutoverError('unit_cutover_fact_drift', [
          { kind: 'READBACK_MISMATCH', table: name, identity: '' },
        ])
    }
    // The system-owned field catalog is refreshed through its domain service.
    await new AccService(db).syncVouEntityCatalogInTransaction(tx)
    const evidenceStart = schema.indexOf(`CREATE TABLE ${evidenceTable} (`)
    await sql
      .raw(schema.slice(evidenceStart, schema.indexOf(';', evidenceStart) + 1))
      .execute(tx)
    const report = {
      baseline: input.baseline,
      units: projected.units,
      quantitiesPreserved: true,
      rows: Object.fromEntries(
        Object.entries(projected.tables).map(([name, rows]) => [
          name,
          rows.length,
        ]),
      ),
    }
    await sql`INSERT INTO ${sql.table(evidenceTable)} (baseline,source_release_sha,target_release_sha,actor_user_id,created_at,report,originals) VALUES (${input.baseline},${input.sourceReleaseSha},${input.targetReleaseSha},${input.actorId},${new Date()},${JSON.stringify(report)}::jsonb,${JSON.stringify(Object.fromEntries(Object.keys(targets).map((name) => [name, original.tables[name]])))}::jsonb)`.execute(
      tx,
    )
    return report
  })
}
