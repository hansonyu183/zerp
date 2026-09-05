import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import type { DB } from '../db/generated.ts'

const auxiliaryWriteLockKey = '25408967740052824'

export const auxEntities = [
  'product-category',
  'product-type',
  'employee-category',
  'department',
  'position',
  'settlement-method',
  'payment-method',
  'dictionary-type',
  'dictionary-item',
  'measurement-unit',
  'income-expense-type',
  'asset-category',
] as const

export type AuxEntity = (typeof auxEntities)[number]
export type AuxActor = { id: string; permissions: readonly string[] }
export type AuxData = Record<string, unknown>

export interface AuxObjectView {
  objectId: string
  entity: AuxEntity
  code: string
  enabled: boolean
  objectRevision: string
  data: AuxData
  updatedAt: string
  updatedBy: string
}

export interface AuxMutationResult {
  objectId: string
  objectRevision: string
  enabled: boolean
}

export interface AuxQueryInput {
  page: number
  pageSize: number
  filters?: {
    keyword?: string
    enabled?: boolean
    behaviorProfile?: string
    parentId?: string
    rootOnly?: boolean
    dictionaryTypeCode?: string
    direction?: string
  }
  sort?: Array<{ field: 'updatedAt' | 'code' | 'name'; order: 'asc' | 'desc' }>
}

export interface AuxReferenceQueryInput {
  entity:
    | 'settlement-method'
    | 'payment-method'
    | 'dictionary-item'
    | 'product-type'
    | 'product-category'
    | 'employee-category'
    | 'department'
    | 'position'
    | 'measurement-unit'
  keyword?: string
  dictionaryTypeCode?: string
}

export interface AuxReferenceCandidate {
  objectId: string
  code: string
  name: string
  behaviorProfile?:
    'RAW_MATERIAL' | 'STANDARD_FINISHED' | 'CUSTOM_FINISHED' | 'PACKAGING'
  quantityScale?: number
  symbol?: string
  termCode?:
    | 'PREPAID'
    | 'CASH_ON_DELIVERY'
    | 'ARRIVAL_3'
    | 'ARRIVAL_5'
    | 'ARRIVAL_7'
    | 'ARRIVAL_15'
    | 'ARRIVAL_30'
    | 'MONTHLY_CURRENT'
    | 'MONTHLY_30'
    | 'MONTHLY_60'
    | 'MONTHLY_90'
  ruleType?: 'RELATIVE_DAYS' | 'MONTH_END'
  monthOffset?: number
  dayOfMonth?: number
  dayOffset?: number
  defaultSalesSurcharge?: string
}

export class AuxApplicationError extends Error {
  readonly errorKey:
    'validation_failed' | 'conflict' | 'forbidden' | 'internal_error'
  readonly data: unknown

  constructor(errorKey: AuxApplicationError['errorKey'], data: unknown = null) {
    super(errorKey)
    this.name = 'AuxApplicationError'
    this.errorKey = errorKey
    this.data = data
  }
}

interface StoredAuxObject {
  id: string
  entity: string
  code: string
  enabled: boolean
  revision: string | number | bigint
  data: unknown
  updated_at: Date | string
  updated_by: string
}

const codePrefixes: Record<AuxEntity, string> = {
  'product-category': 'PCT',
  'product-type': 'PTP',
  'employee-category': 'ECT',
  department: 'DEP',
  position: 'POS',
  'settlement-method': 'STM',
  'payment-method': 'PMT',
  'dictionary-type': 'DCT',
  'dictionary-item': 'DIT',
  'measurement-unit': 'UNT',
  'income-expense-type': 'IET',
  'asset-category': 'ACT',
}

function applicationError(
  errorKey: AuxApplicationError['errorKey'],
  data: unknown = null,
): never {
  throw new AuxApplicationError(errorKey, data)
}

function isEntity(value: string): value is AuxEntity {
  return (auxEntities as readonly string[]).includes(value)
}

function assertEntity(value: string): asserts value is AuxEntity {
  if (!isEntity(value)) applicationError('validation_failed')
}

function assertPermission(actor: AuxActor, permission: string): void {
  if (!actor.permissions.includes(permission)) applicationError('forbidden')
}

type RevisionInput = string | number

function revision(value: string | number | bigint): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1)
      applicationError('validation_failed')
    return BigInt(value)
  }
  if (!/^\d+$/.test(String(value)) || BigInt(value) < 1n)
    applicationError('validation_failed')
  return BigInt(value)
}

function objectRevision(value: string | number | bigint): string {
  return String(revision(value))
}

function dateTime(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

function asRecord(value: unknown): AuxData {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      applicationError('internal_error')
    }
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object')
    applicationError('internal_error')
  return { ...value } as AuxData
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') applicationError('validation_failed')
  const normalized = value.trim()
  if (normalized.length === 0 || [...normalized].length > 200)
    applicationError('validation_failed')
  return normalized
}

function optionalString(value: unknown, maxLength = 1000): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || [...value].length > maxLength)
    applicationError('validation_failed')
  return value.trim()
}

function optionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value))
    applicationError('validation_failed')
  return value
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  )
    applicationError('validation_failed')
  return value
}

function money(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value.trim())
  )
    applicationError('validation_failed')
  return value.trim()
}

function fixedMoney(value: unknown): string {
  const normalized = money(value)
  const [whole, fraction = ''] = normalized.split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
}

const settlementTermCodes = [
  'PREPAID',
  'CASH_ON_DELIVERY',
  'ARRIVAL_3',
  'ARRIVAL_5',
  'ARRIVAL_7',
  'ARRIVAL_15',
  'ARRIVAL_30',
  'MONTHLY_CURRENT',
  'MONTHLY_30',
  'MONTHLY_60',
  'MONTHLY_90',
] as const

function settlementTermCode(
  value: unknown,
): (typeof settlementTermCodes)[number] {
  return (
    settlementTermCodes.find((candidate) => candidate === value) ??
    applicationError('validation_failed')
  )
}

function settlementRuleType(value: unknown): 'RELATIVE_DAYS' | 'MONTH_END' {
  if (value !== 'RELATIVE_DAYS' && value !== 'MONTH_END')
    applicationError('validation_failed')
  return value
}

function percentage(value: unknown): string {
  const normalized = money(value)
  if (Number(normalized) > 99.99) applicationError('validation_failed')
  return normalized
}

function only(data: AuxData, keys: readonly string[]): void {
  if (Object.keys(data).some((key) => !keys.includes(key)))
    applicationError('validation_failed')
}

function parentData(
  name: string,
  parentId: string | null,
  description: string,
): AuxData {
  return { name, parentId: parentId ?? '', description }
}

function normaliseData(entity: AuxEntity, source: unknown): AuxData {
  const data = asRecord(source)
  const name = requiredString(data.name)
  switch (entity) {
    case 'product-category':
    case 'department':
      only(data, ['name', 'parentId', 'description'])
      return parentData(
        name,
        optionalId(data.parentId),
        optionalString(data.description),
      )
    case 'product-type': {
      only(data, ['name', 'behaviorProfile', 'description'])
      const behaviorProfile = data.behaviorProfile
      if (
        ![
          'RAW_MATERIAL',
          'STANDARD_FINISHED',
          'CUSTOM_FINISHED',
          'PACKAGING',
        ].includes(String(behaviorProfile))
      )
        applicationError('validation_failed')
      return {
        name,
        behaviorProfile: String(behaviorProfile),
        description: optionalString(data.description),
      }
    }
    case 'employee-category':
    case 'position':
    case 'dictionary-type':
      only(data, ['name', 'description'])
      return { name, description: optionalString(data.description) }
    case 'asset-category':
      only(data, [
        'name',
        'defaultUsefulLifeMonths',
        'defaultResidualRate',
        'description',
      ])
      return {
        name,
        defaultUsefulLifeMonths: integer(data.defaultUsefulLifeMonths, 1, 1200),
        defaultResidualRate: percentage(data.defaultResidualRate),
        description: optionalString(data.description),
      }
    case 'dictionary-item':
      only(data, ['name', 'dictionaryTypeId', 'sortOrder'])
      return {
        name,
        dictionaryTypeId:
          optionalId(data.dictionaryTypeId) ??
          applicationError('validation_failed'),
        sortOrder: integer(data.sortOrder, -2_147_483_648, 2_147_483_647),
      }
    case 'measurement-unit':
      only(data, ['name', 'symbol', 'quantityScale'])
      return {
        name,
        symbol:
          optionalString(data.symbol, 64) ||
          applicationError('validation_failed'),
        quantityScale: integer(data.quantityScale, 0, 6),
      }
    case 'settlement-method': {
      only(data, [
        'name',
        'termCode',
        'ruleType',
        'monthOffset',
        'dayOfMonth',
        'dayOffset',
        'defaultSalesSurcharge',
        'description',
      ])
      const termCode = String(data.termCode)
      if (
        ![
          'PREPAID',
          'CASH_ON_DELIVERY',
          'ARRIVAL_3',
          'ARRIVAL_5',
          'ARRIVAL_7',
          'ARRIVAL_15',
          'ARRIVAL_30',
          'MONTHLY_CURRENT',
          'MONTHLY_30',
          'MONTHLY_60',
          'MONTHLY_90',
        ].includes(termCode)
      )
        applicationError('validation_failed')
      const ruleType = String(data.ruleType)
      if (!['RELATIVE_DAYS', 'MONTH_END'].includes(ruleType))
        applicationError('validation_failed')
      return {
        name,
        termCode,
        ruleType,
        monthOffset: integer(data.monthOffset, 0, 3),
        dayOfMonth: integer(data.dayOfMonth, 0, 31),
        dayOffset: integer(data.dayOffset, 0, 30),
        defaultSalesSurcharge: money(data.defaultSalesSurcharge),
        description: optionalString(data.description),
      }
    }
    case 'payment-method':
      only(data, ['name', 'defaultSalesSurcharge', 'description'])
      return {
        name,
        defaultSalesSurcharge: money(data.defaultSalesSurcharge),
        description: optionalString(data.description),
      }
    case 'income-expense-type': {
      only(data, ['name', 'direction', 'parentId', 'description'])
      const direction = String(data.direction).toUpperCase()
      if (direction !== 'INCOME' && direction !== 'EXPENSE')
        applicationError('validation_failed')
      return {
        ...parentData(
          name,
          optionalId(data.parentId),
          optionalString(data.description),
        ),
        direction,
      }
    }
  }
}

/**
 * Dictionary items persist their resolved dictionary identity beside the
 * client-supplied fields.  Reference reads still validate the invariant
 * fields, without treating those server-derived fields as client input.
 */
function normaliseReferenceData(entity: AuxEntity, source: unknown): AuxData {
  if (entity !== 'dictionary-item') return normaliseData(entity, source)
  const data = asRecord(source)
  return normaliseData(entity, {
    name: data.name,
    dictionaryTypeId: data.dictionaryTypeId,
    sortOrder: data.sortOrder,
  })
}

function parseRow(row: StoredAuxObject): AuxObjectView {
  assertEntity(row.entity)
  return {
    objectId: row.id,
    entity: row.entity,
    code: row.code,
    enabled: row.enabled,
    objectRevision: objectRevision(row.revision),
    data: asRecord(row.data),
    updatedAt: dateTime(row.updated_at),
    updatedBy: row.updated_by,
  }
}

export class AuxService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async query(
    entity: AuxEntity,
    input: AuxQueryInput,
    actor: AuxActor,
  ): Promise<{
    items: AuxObjectView[]
    total: number
    page: number
    pageSize: number
  }> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/query`)
    if (
      !Number.isInteger(input.page) ||
      !Number.isInteger(input.pageSize) ||
      input.page < 1 ||
      input.pageSize < 1 ||
      input.pageSize > 200 ||
      (input.sort?.length ?? 0) > 1
    )
      applicationError('validation_failed')
    const filter = input.filters ?? {}
    if (
      filter.behaviorProfile !== undefined &&
      (entity !== 'product-type' ||
        ![
          'RAW_MATERIAL',
          'STANDARD_FINISHED',
          'CUSTOM_FINISHED',
          'PACKAGING',
        ].includes(filter.behaviorProfile))
    )
      applicationError('validation_failed')
    if (
      filter.direction !== undefined &&
      (entity !== 'income-expense-type' ||
        !['INCOME', 'EXPENSE'].includes(filter.direction))
    )
      applicationError('validation_failed')
    const where = [sql`entity = ${entity}`]
    if (filter.keyword?.trim()) {
      const keyword = `%${filter.keyword.trim()}%`
      where.push(
        sql`(code ILIKE ${keyword} OR COALESCE(data->>'name', '') ILIKE ${keyword})`,
      )
    }
    if (filter.enabled !== undefined)
      where.push(sql`enabled = ${filter.enabled}`)
    if (filter.behaviorProfile)
      where.push(sql`data->>'behaviorProfile' = ${filter.behaviorProfile}`)
    if (filter.parentId) where.push(sql`data->>'parentId' = ${filter.parentId}`)
    if (filter.rootOnly) where.push(sql`COALESCE(data->>'parentId', '') = ''`)
    if (filter.dictionaryTypeCode)
      where.push(
        sql`data->>'dictionaryTypeCode' = ${filter.dictionaryTypeCode}`,
      )
    if (filter.direction)
      where.push(sql`data->>'direction' = ${filter.direction}`)
    const order = input.sort?.[0]
    const sortField =
      order?.field === 'code'
        ? sql.raw('code')
        : order?.field === 'name'
          ? sql.raw("COALESCE(data->>'name', '')")
          : sql.raw('updated_at')
    const sortOrder = order?.order === 'asc' ? sql.raw('ASC') : sql.raw('DESC')
    const offset = (input.page - 1) * input.pageSize
    const [count, rows] = await Promise.all([
      sql<{
        total: string | number
      }>`SELECT count(*)::bigint AS total FROM aux_objects WHERE ${sql.join(where, sql` AND `)}`.execute(
        this.db,
      ),
      sql<StoredAuxObject>`SELECT id, entity, code, enabled, revision, data, updated_at, updated_by FROM aux_objects WHERE ${sql.join(where, sql` AND `)} ORDER BY ${sortField} ${sortOrder}, id ${sortOrder} LIMIT ${input.pageSize} OFFSET ${offset}`.execute(
        this.db,
      ),
    ])
    return {
      items: rows.rows.map(parseRow),
      total: Number(count.rows[0]?.total ?? 0),
      page: input.page,
      pageSize: input.pageSize,
    }
  }

  async get(
    entity: AuxEntity,
    objectId: string,
    actor: AuxActor,
  ): Promise<AuxObjectView> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/get`)
    optionalId(objectId) ?? applicationError('validation_failed')
    const result =
      await sql<StoredAuxObject>`SELECT id, entity, code, enabled, revision, data, updated_at, updated_by FROM aux_objects WHERE id = ${objectId} AND entity = ${entity}`.execute(
        this.db,
      )
    const row = result.rows[0]
    if (!row) applicationError('validation_failed')
    return parseRow(row)
  }

  async create(
    entity: AuxEntity,
    data: unknown,
    actor: AuxActor,
  ): Promise<AuxMutationResult> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/create`)
    if (entity === 'settlement-method') applicationError('validation_failed')
    return this.db.transaction().execute(async (transaction) => {
      await this.lock(transaction)
      const normalised = await this.validateData(
        transaction,
        entity,
        null,
        data,
      )
      const counter = await sql<{
        last_value: number
      }>`INSERT INTO object_number_counters(domain, entity, last_value) VALUES ('aux', ${entity}, 1) ON CONFLICT (domain, entity) DO UPDATE SET last_value = object_number_counters.last_value + 1 WHERE object_number_counters.last_value < 9999 RETURNING last_value`.execute(
        transaction,
      )
      const number = counter.rows[0]?.last_value
      if (!number) applicationError('conflict')
      const objectId = ulid()
      await sql`INSERT INTO aux_objects(id, entity, code, enabled, revision, data, created_by, updated_by) VALUES (${objectId}, ${entity}, ${`${codePrefixes[entity]}-${String(number).padStart(4, '0')}`}, true, 1, ${JSON.stringify(normalised)}::jsonb, ${actor.id}, ${actor.id})`.execute(
        transaction,
      )
      return { objectId, objectRevision: '1', enabled: true }
    })
  }

  async ensureE2ESettlementMethod(
    data: unknown,
    actor: AuxActor & { trusted?: boolean },
  ): Promise<AuxMutationResult> {
    if (actor.trusted !== true) applicationError('forbidden')
    return this.db.transaction().execute(async (transaction) => {
      await this.lock(transaction)
      const normalised = await this.validateData(
        transaction,
        'settlement-method',
        null,
        data,
      )
      const existing = await sql<{
        id: string
        revision: string | number | bigint
        enabled: boolean
      }>`
        SELECT id, revision, enabled FROM aux_objects
        WHERE entity = 'settlement-method'
          AND data->>'termCode' = ${String(normalised.termCode)}
          AND data->>'name' = ${String(normalised.name)}
        FOR UPDATE
      `.execute(transaction)
      if (existing.rows[0]) {
        const row = existing.rows[0]
        return {
          objectId: row.id,
          objectRevision: objectRevision(row.revision),
          enabled: row.enabled,
        }
      }
      const counter = await sql<{ last_value: number }>`
        INSERT INTO object_number_counters(domain, entity, last_value)
        VALUES ('aux', 'settlement-method', 1)
        ON CONFLICT (domain, entity) DO UPDATE
          SET last_value = object_number_counters.last_value + 1
          WHERE object_number_counters.last_value < 9999
        RETURNING last_value
      `.execute(transaction)
      const number = counter.rows[0]?.last_value
      if (!number) applicationError('conflict')
      const objectId = ulid()
      await sql`INSERT INTO aux_objects(id, entity, code, enabled, revision, data, created_by, updated_by)
        VALUES (${objectId}, 'settlement-method', ${`${codePrefixes['settlement-method']}-${String(number).padStart(4, '0')}`}, true, 1, ${JSON.stringify(normalised)}::jsonb, ${actor.id}, ${actor.id})`.execute(
        transaction,
      )
      return { objectId, objectRevision: '1', enabled: true }
    })
  }

  async save(
    entity: AuxEntity,
    objectId: string,
    expectedRevision: RevisionInput,
    data: unknown,
    actor: AuxActor,
  ): Promise<AuxMutationResult> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/save`)
    optionalId(objectId) ?? applicationError('validation_failed')
    const expected = revision(expectedRevision)
    return this.db.transaction().execute(async (transaction) => {
      await this.lock(transaction)
      const current = await this.lockObject(transaction, entity, objectId)
      if (revision(current.revision) !== expected)
        applicationError('conflict', {
          objectRevision: objectRevision(current.revision),
        })
      const normalised = await this.validateData(
        transaction,
        entity,
        objectId,
        data,
        asRecord(current.data),
      )
      await sql`UPDATE aux_objects SET data = ${JSON.stringify(normalised)}::jsonb, revision = revision + 1, updated_at = now(), updated_by = ${actor.id} WHERE id = ${objectId} AND entity = ${entity}`.execute(
        transaction,
      )
      return {
        objectId,
        objectRevision: objectRevision(revision(current.revision) + 1n),
        enabled: current.enabled,
      }
    })
  }

  async enable(
    entity: AuxEntity,
    objectId: string,
    expectedRevision: RevisionInput,
    actor: AuxActor,
  ): Promise<AuxMutationResult> {
    return this.setEnabled(entity, objectId, expectedRevision, true, actor)
  }

  async disable(
    entity: AuxEntity,
    objectId: string,
    expectedRevision: RevisionInput,
    actor: AuxActor,
  ): Promise<AuxMutationResult> {
    return this.setEnabled(entity, objectId, expectedRevision, false, actor)
  }

  async delete(
    entity: AuxEntity,
    objectId: string,
    expectedRevision: RevisionInput,
    actor: AuxActor,
  ): Promise<void> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/delete`)
    if (entity === 'settlement-method') applicationError('validation_failed')
    optionalId(objectId) ?? applicationError('validation_failed')
    const expected = revision(expectedRevision)
    await this.db.transaction().execute(async (transaction) => {
      await this.lock(transaction)
      const current = await this.lockObject(transaction, entity, objectId)
      if (revision(current.revision) !== expected)
        applicationError('conflict', {
          objectRevision: objectRevision(current.revision),
        })
      const blockers = await sql<{
        source: string
        count: string | number
      }>`SELECT source, count(*)::bigint AS count FROM aux_reference_facts WHERE aux_object_id = ${objectId} GROUP BY source ORDER BY source`.execute(
        transaction,
      )
      if (blockers.rows.length > 0)
        applicationError('conflict', {
          blockers: blockers.rows.map((row) => ({
            source: row.source,
            count: Number(row.count),
          })),
        })
      await sql`DELETE FROM aux_objects WHERE id = ${objectId} AND entity = ${entity}`.execute(
        transaction,
      )
    })
  }

  async queryReferenceCandidates(
    input: AuxReferenceQueryInput,
    actor: AuxActor,
  ): Promise<AuxReferenceCandidate[]> {
    const { entity } = input
    if (
      !(
        [
          'settlement-method',
          'payment-method',
          'dictionary-item',
          'product-type',
          'product-category',
          'employee-category',
          'department',
          'position',
          'measurement-unit',
        ] as const
      ).includes(entity)
    )
      applicationError('validation_failed')
    assertPermission(actor, `/aux/${entity}/query`)
    const where = [sql`entity = ${entity}`, sql`enabled = true`]
    if (input.keyword?.trim()) {
      const keyword = `%${input.keyword.trim()}%`
      where.push(
        sql`(code ILIKE ${keyword} OR COALESCE(data->>'name', '') ILIKE ${keyword})`,
      )
    }
    if (input.dictionaryTypeCode?.trim())
      where.push(
        sql`data->>'dictionaryTypeCode' = ${input.dictionaryTypeCode.trim()}`,
      )
    const result = await sql<{
      id: string
      code: string
      name: string
      behavior_profile: AuxReferenceCandidate['behaviorProfile'] | null
      quantity_scale: number | null
      symbol: string | null
      data: unknown
    }>`SELECT id, code, data, COALESCE(data->>'name', '') AS name,
      CASE WHEN entity = 'product-type' THEN data->>'behaviorProfile' END AS behavior_profile,
      CASE WHEN entity = 'measurement-unit' THEN NULLIF(data->>'quantityScale', '')::integer END AS quantity_scale,
      CASE WHEN entity = 'measurement-unit' THEN data->>'symbol' END AS symbol
      FROM aux_objects WHERE ${sql.join(where, sql` AND `)} ORDER BY COALESCE((data->>'sortOrder')::integer, 2147483647), code, id LIMIT 20`.execute(
      this.db,
    )
    return result.rows.map((row) => {
      const data = normaliseReferenceData(entity, row.data)
      const common = {
        objectId: row.id,
        code: row.code,
        name: row.name,
      }
      if (entity === 'product-type') {
        const behaviorProfile = data.behaviorProfile
        if (
          behaviorProfile !== 'RAW_MATERIAL' &&
          behaviorProfile !== 'STANDARD_FINISHED' &&
          behaviorProfile !== 'CUSTOM_FINISHED' &&
          behaviorProfile !== 'PACKAGING'
        )
          applicationError('validation_failed')
        return { ...common, behaviorProfile }
      }
      if (entity === 'measurement-unit') {
        if (row.quantity_scale === null || row.symbol === null)
          applicationError('validation_failed')
        const symbol = optionalString(row.symbol, 64)
        if (!symbol) applicationError('validation_failed')
        return {
          ...common,
          quantityScale: row.quantity_scale,
          symbol,
        }
      }
      if (entity === 'settlement-method')
        return {
          ...common,
          termCode: settlementTermCode(data.termCode),
          ruleType: settlementRuleType(data.ruleType),
          monthOffset: integer(data.monthOffset, 0, 3),
          dayOfMonth: integer(data.dayOfMonth, 0, 31),
          dayOffset: integer(data.dayOffset, 0, 30),
          defaultSalesSurcharge: fixedMoney(data.defaultSalesSurcharge),
        }
      if (entity === 'payment-method')
        return {
          ...common,
          defaultSalesSurcharge: fixedMoney(data.defaultSalesSurcharge),
        }
      return common
    })
  }

  private async setEnabled(
    entity: AuxEntity,
    objectId: string,
    expectedRevision: RevisionInput,
    enabled: boolean,
    actor: AuxActor,
  ): Promise<AuxMutationResult> {
    assertEntity(entity)
    assertPermission(actor, `/aux/${entity}/${enabled ? 'enable' : 'disable'}`)
    optionalId(objectId) ?? applicationError('validation_failed')
    const expected = revision(expectedRevision)
    return this.db.transaction().execute(async (transaction) => {
      await this.lock(transaction)
      const current = await this.lockObject(transaction, entity, objectId)
      if (
        revision(current.revision) !== expected ||
        current.enabled === enabled
      )
        applicationError('conflict', {
          objectRevision: objectRevision(current.revision),
          enabled: current.enabled,
        })
      await sql`UPDATE aux_objects SET enabled = ${enabled}, revision = revision + 1, updated_at = now(), updated_by = ${actor.id} WHERE id = ${objectId} AND entity = ${entity}`.execute(
        transaction,
      )
      return {
        objectId,
        objectRevision: objectRevision(revision(current.revision) + 1n),
        enabled,
      }
    })
  }

  private async lock(transaction: Transaction<DB>): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(${auxiliaryWriteLockKey})`.execute(
      transaction,
    )
  }

  private async lockObject(
    transaction: Transaction<DB>,
    entity: AuxEntity,
    objectId: string,
  ): Promise<StoredAuxObject> {
    const result =
      await sql<StoredAuxObject>`SELECT id, entity, code, enabled, revision, data, updated_at, updated_by FROM aux_objects WHERE id = ${objectId} AND entity = ${entity} FOR UPDATE`.execute(
        transaction,
      )
    const row = result.rows[0]
    if (!row) applicationError('validation_failed')
    return row
  }

  private async validateData(
    transaction: Transaction<DB>,
    entity: AuxEntity,
    objectId: string | null,
    source: unknown,
    current?: AuxData,
  ): Promise<AuxData> {
    const data = normaliseData(entity, source)
    if (
      entity === 'product-category' ||
      entity === 'department' ||
      entity === 'income-expense-type'
    ) {
      const parentId = optionalId(data.parentId)
      if (parentId)
        await this.validateParent(
          transaction,
          entity,
          objectId,
          parentId,
          entity === 'income-expense-type' ? String(data.direction) : undefined,
        )
    }
    if (entity === 'dictionary-item') {
      const dictionary = await sql<{
        code: string
        name: string
      }>`SELECT code, COALESCE(data->>'name', '') AS name FROM aux_objects WHERE id = ${String(data.dictionaryTypeId)} AND entity = 'dictionary-type' AND enabled = true FOR SHARE`.execute(
        transaction,
      )
      const row = dictionary.rows[0]
      if (!row) applicationError('validation_failed')
      return {
        ...data,
        dictionaryTypeCode: row.code,
        dictionaryTypeName: row.name,
      }
    }
    if (entity === 'settlement-method' && current) {
      for (const field of [
        'name',
        'termCode',
        'ruleType',
        'monthOffset',
        'dayOfMonth',
        'dayOffset',
      ] as const) {
        if (data[field] !== current[field])
          applicationError('validation_failed')
      }
    }
    if (
      entity === 'product-type' &&
      current &&
      data.behaviorProfile !== current.behaviorProfile
    ) {
      const reference = await sql<{
        exists: boolean
      }>`SELECT EXISTS(SELECT 1 FROM aux_reference_facts WHERE aux_object_id = ${objectId} AND source = 'dcl_product_versions') AS exists`.execute(
        transaction,
      )
      if (reference.rows[0]?.exists) applicationError('validation_failed')
    }
    return data
  }

  private async validateParent(
    transaction: Transaction<DB>,
    entity: AuxEntity,
    objectId: string | null,
    parentId: string,
    direction?: string,
  ): Promise<void> {
    if (parentId === objectId) applicationError('validation_failed')
    const parent = await sql<{
      data: unknown
    }>`SELECT data FROM aux_objects WHERE id = ${parentId} AND entity = ${entity} AND enabled = true FOR SHARE`.execute(
      transaction,
    )
    const parentDataValue = parent.rows[0]
    if (
      !parentDataValue ||
      (direction && asRecord(parentDataValue.data).direction !== direction)
    )
      applicationError('validation_failed')
    if (!objectId) return
    const cycle = await sql<{
      cycle: boolean
    }>`WITH RECURSIVE ancestors(id) AS ( SELECT ${parentId}::varchar UNION ALL SELECT NULLIF(parent.data->>'parentId', '') FROM aux_objects parent JOIN ancestors ON parent.id = ancestors.id WHERE parent.entity = ${entity} AND NULLIF(parent.data->>'parentId', '') IS NOT NULL ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = ${objectId}) AS cycle`.execute(
      transaction,
    )
    if (cycle.rows[0]?.cycle) applicationError('validation_failed')
  }
}
