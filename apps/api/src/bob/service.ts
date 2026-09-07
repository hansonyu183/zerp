import { searchPinyin } from '../platform/pinyin.ts'
import { changeEnablement } from '../enablement/service.ts'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

import type { DB } from '../db/generated.ts'

export const bobEntities = [
  'customer',
  'supplier',
  'other-unit',
  'sales-partner',
  'product',
] as const

export const managedBobEntities = [
  'supplier',
  'other-unit',
  'sales-partner',
] as const
export type ManagedBobEntity = (typeof managedBobEntities)[number]
export function isManagedBobEntity(entity: string): entity is ManagedBobEntity {
  return managedBobEntities.some((value) => value === entity)
}

export type BobEntity = (typeof bobEntities)[number]
export type BobReferenceEntity =
  'customer-subunit' | 'other-unit' | 'supplier' | 'sales-partner' | 'product'
export type BobActor = { id: string; permissions: readonly string[] }
export type BobData = Record<string, unknown>

export interface BobObjectView {
  objectId: string
  entity: BobEntity
  code: string
  enabled: boolean
  sourceApprovalEntryId: string
  sourceVersionNo: number
  data: BobData
  updatedAt: string
  revision?: string
  name?: string
  py?: string
}

export interface BobQueryInput {
  page: number
  pageSize: number
  filters?: {
    keyword?: string
    enabled?: boolean
    categoryId?: string
    defaultPurchaserEmployeeId?: string
    operatingEntityId?: string
    productTypeId?: string
  }
  sort?: Array<{ field: 'updatedAt' | 'code' | 'name'; order: 'asc' | 'desc' }>
}

export interface BobReferenceQueryInput {
  entity: BobReferenceEntity
  keyword?: string
  sourceObjectId?: string
  behaviorProfile?: string
  operatingEntityId?: string
}

export interface BobReferenceCandidate {
  objectId: string
  code: string
  name: string
  sourceApprovalEntryId: string
  sourceVersionNo: number
  data: BobData
}

export class BobApplicationError extends Error {
  readonly errorKey:
    | 'validation_failed'
    | 'forbidden'
    | 'internal_error'
    | 'conflict'
    | 'not_found'
  readonly data: {
    blockers: Array<{
      kind: 'AUX_CURRENT_REFERENCE'
      entity: 'vehicle'
      objectId: string
    }>
  } | null

  constructor(
    errorKey: BobApplicationError['errorKey'],
    data: BobApplicationError['data'] = null,
  ) {
    super(errorKey)
    this.name = 'BobApplicationError'
    this.errorKey = errorKey
    this.data = data
  }
}

interface StoredBobObject {
  object_id: string
  entity: string
  code: string
  enabled: boolean
  source_approval_entry_id: string
  source_version_no: number
  data: unknown
  updated_at: Date | string
  revision?: string
}

interface StoredCustomerSubunit extends Omit<StoredBobObject, 'object_id'> {
  object_id: string
  customer_id: string
}

/** Read each entity from its owning subject and highest approved typed version. */
function currentSource(entity: BobEntity) {
  if (isManagedBobEntity(entity)) return businessIdentityCurrent(entity)
  return sql<StoredBobObject>`
    SELECT * FROM (
      SELECT subject.id AS object_id, subject.entity, subject.code,
        snapshot.enabled, entry.id AS source_approval_entry_id,
        entry.version_no AS source_version_no, entry.updated_at,
        jsonb_strip_nulls(jsonb_build_object(
          'displayName', snapshot.display_name,
          'kind', snapshot.kind,
          'legalIdentifier', snapshot.legal_identifier,
          'defaultOperatingEntityId', snapshot.default_operating_entity_id
        )) AS data
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT * FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'customer' AND subject_id = subject.id
          AND status = 'APPROVED'
        ORDER BY version_no DESC LIMIT 1
      ) entry ON true
      JOIN dcl_customer_versions snapshot ON snapshot.approval_entry_id = entry.id
      WHERE subject.entity = 'customer'

      UNION ALL
      SELECT subject.id, subject.entity, subject.code, snapshot.enabled, entry.id,
        entry.version_no, entry.updated_at,
        jsonb_strip_nulls(jsonb_build_object(
          'name', snapshot.name, 'categoryId', snapshot.category_id,
          'productTypeId', snapshot.product_type_id,
          'behaviorProfile', snapshot.behavior_profile,
          'defaultInputUnitId', snapshot.default_input_unit_id,
          'pricingUnitId', snapshot.pricing_unit_id
        ))
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT * FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'product' AND subject_id = subject.id
          AND status = 'APPROVED'
        ORDER BY version_no DESC LIMIT 1
      ) entry ON true
      JOIN dcl_product_versions snapshot ON snapshot.approval_entry_id = entry.id
      WHERE subject.entity = 'product'

    ) typed_current
    WHERE typed_current.entity = ${entity}`
}

/** One typed query; neither current queries nor references issue per-row reads. */
function businessIdentityCurrent(entity: ManagedBobEntity) {
  const tables = {
    supplier: [
      'bob_supplier_versions',
      'bob_supplier_version_operating_entities',
    ],
    'other-unit': [
      'bob_other_unit_versions',
      'bob_other_unit_version_operating_entities',
    ],
    'sales-partner': [
      'bob_sales_partner_versions',
      'bob_sales_partner_version_operating_entities',
    ],
  } as const
  const [versions, operatingEntities] = tables[entity]
  const specific =
    entity === 'supplier'
      ? sql`jsonb_build_object('settlementMethod',v.settlement_method_snapshot,'defaultPurchaser',
        CASE WHEN v.default_purchaser_employee_id IS NULL THEN NULL ELSE jsonb_build_object('objectId',v.default_purchaser_employee_id,'code',COALESCE(v.default_purchaser_code,''),'name',COALESCE(v.default_purchaser_name,'')) END)`
      : entity === 'other-unit'
        ? sql`jsonb_build_object('settlementMethod',v.settlement_method_snapshot)`
        : sql`jsonb_build_object('capabilities',v.capabilities)`
  return sql<StoredBobObject>`SELECT subject.id AS object_id,subject.entity,subject.code,subject.enabled,
    subject.revision::text AS revision,entry.id AS source_approval_entry_id,entry.version_no AS source_version_no,entry.updated_at,
    jsonb_build_object(
      'identityKind',v.kind,'legalName',v.legal_name,'displayName',v.display_name,'legalIdentifier',COALESCE(v.legal_identifier,''),
      'contactName',COALESCE(v.contact_name,''),'phone',COALESCE(v.contact_phone,''),'address',COALESCE(v.address,''),
      'defaultOperatingEntityId',v.default_operating_entity_id,'remark',COALESCE(v.remark,''),
      'operatingEntities',COALESCE((SELECT jsonb_agg(jsonb_build_object('objectId',r.operating_entity_id,'code',r.operating_entity_code,'name',r.operating_entity_name) ORDER BY r.operating_entity_id)
        FROM ${sql.table(operatingEntities)} r WHERE r.approval_entry_id=entry.id),'[]'::jsonb)
    ) || ${specific} AS data
    FROM bob_subjects subject
    JOIN LATERAL (SELECT id,version_no,updated_at FROM approval_entries WHERE domain='bob' AND entity=${entity} AND subject_id=subject.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) entry ON true
    JOIN ${sql.table(versions)} v ON v.approval_entry_id=entry.id
    WHERE subject.entity=${entity}`
}

function fail(errorKey: BobApplicationError['errorKey']): never {
  throw new BobApplicationError(errorKey)
}

function isEntity(value: string): value is BobEntity {
  return (bobEntities as readonly string[]).includes(value)
}

function assertEntity(value: string): asserts value is BobEntity {
  if (!isEntity(value)) fail('validation_failed')
}

function assertReferenceEntity(
  value: string,
): asserts value is BobReferenceEntity {
  if (
    ![
      'customer-subunit',
      'other-unit',
      'supplier',
      'sales-partner',
      'product',
    ].includes(value)
  )
    fail('validation_failed')
}

function assertPermission(
  actor: BobActor,
  entity: BobEntity | BobReferenceEntity,
  action: 'query' | 'get',
): void {
  const permissionEntity = entity === 'customer-subunit' ? 'customer' : entity
  assertExactPermission(actor, `/bob/${permissionEntity}/${action}`)
}

function assertExactPermission(actor: BobActor, permission: string): void {
  if (!actor.permissions.includes(permission)) fail('forbidden')
}

function asData(value: unknown): BobData {
  if (typeof value === 'string') {
    try {
      return asData(JSON.parse(value))
    } catch {
      fail('internal_error')
    }
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object')
    fail('internal_error')
  return { ...value } as BobData
}

function timestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

function validId(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)
}

function parseCurrent(
  row: StoredBobObject,
  _includeFundAccountNumber = true,
): BobObjectView {
  assertEntity(row.entity)
  if (!Number.isInteger(row.source_version_no) || row.source_version_no < 1)
    fail('internal_error')
  const data = asData(row.data)
  return {
    objectId: row.object_id,
    entity: row.entity,
    code: row.code,
    enabled: row.enabled,
    sourceApprovalEntryId: row.source_approval_entry_id,
    sourceVersionNo: row.source_version_no,
    data,
    updatedAt: timestamp(row.updated_at),
  }
}

function name(data: BobData): string {
  for (const candidate of [data.name, data.displayName, data.legalName]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return ''
}

export class BobService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async query(
    entity: BobEntity,
    input: BobQueryInput,
    actor: BobActor,
  ): Promise<{
    items: BobObjectView[]
    total: number
    page: number
    pageSize: number
  }> {
    assertEntity(entity)
    assertPermission(actor, entity, 'query')
    if (
      !Number.isInteger(input.page) ||
      !Number.isInteger(input.pageSize) ||
      input.page < 1 ||
      input.pageSize < 1 ||
      input.pageSize > 100 ||
      (input.sort?.length ?? 0) > 1
    )
      fail('validation_failed')
    if (isManagedBobEntity(entity)) return this.queryManaged(entity, input)
    const filter = input.filters ?? {}
    for (const value of [
      filter.categoryId,
      filter.defaultPurchaserEmployeeId,
      filter.operatingEntityId,
      filter.productTypeId,
    ]) {
      if (value !== undefined && !validId(value)) fail('validation_failed')
    }
    const where = [sql`TRUE`]
    if (filter.keyword?.trim()) {
      const keyword = `%${filter.keyword.trim().replace(/[\\%_]/g, '\\$&')}%`
      where.push(
        sql`(code ILIKE ${keyword} OR COALESCE(data->>'name', data->>'displayName', '') ILIKE ${keyword})`,
      )
    }
    if (filter.enabled !== undefined)
      where.push(sql`enabled = ${filter.enabled}`)
    if (filter.categoryId)
      where.push(sql`data->>'categoryId' = ${filter.categoryId}`)
    if (filter.defaultPurchaserEmployeeId)
      where.push(
        sql`data->>'defaultPurchaserEmployeeId' = ${filter.defaultPurchaserEmployeeId}`,
      )
    if (filter.productTypeId)
      where.push(sql`data->>'productTypeId' = ${filter.productTypeId}`)
    if (filter.operatingEntityId)
      where.push(
        sql`(data->>'operatingEntityId' = ${filter.operatingEntityId} OR data->>'defaultOperatingEntityId' = ${filter.operatingEntityId} OR data->'defaultOperatingEntity'->>'sourceObjectId' = ${filter.operatingEntityId})`,
      )
    const order = input.sort?.[0]
    const sortField =
      order?.field === 'code'
        ? sql.raw('code')
        : order?.field === 'name'
          ? sql.raw("COALESCE(data->>'name', data->>'displayName', '')")
          : sql.raw('updated_at')
    const sortOrder = order?.order === 'asc' ? sql.raw('ASC') : sql.raw('DESC')
    const offset = (input.page - 1) * input.pageSize
    const source = currentSource(entity)
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (transaction) => {
        const count = await sql<{
          total: string | number
        }>`SELECT count(*)::bigint AS total FROM (${source}) current${where.length ? sql` WHERE ${sql.join(where, sql` AND `)}` : sql``}`.execute(
          transaction,
        )
        const rows =
          await sql<StoredBobObject>`SELECT current.* FROM (${source}) current${where.length ? sql` WHERE ${sql.join(where, sql` AND `)}` : sql``} ORDER BY ${sortField} ${sortOrder}, object_id ${sortOrder} LIMIT ${input.pageSize} OFFSET ${offset}`.execute(
            transaction,
          )
        return {
          items: rows.rows.map((row) => this.objectView(row)),
          total: Number(count.rows[0]?.total ?? 0),
          page: input.page,
          pageSize: input.pageSize,
        }
      })
  }

  async get(
    entity: BobEntity,
    objectId: string,
    actor: BobActor,
  ): Promise<BobObjectView> {
    assertEntity(entity)
    assertPermission(actor, entity, 'get')
    if (!validId(objectId)) fail('validation_failed')
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (tx) => {
        const source = currentSource(entity)
        const result =
          await sql<StoredBobObject>`SELECT current.* FROM (${source}) current WHERE object_id = ${objectId}`.execute(
            tx,
          )
        const row = result.rows[0]
        if (!row)
          fail(isManagedBobEntity(entity) ? 'not_found' : 'validation_failed')
        return this.objectView(row)
      })
  }

  private async queryManaged(entity: ManagedBobEntity, input: BobQueryInput) {
    const filters = input.filters ?? {}
    for (const key of Object.keys(filters))
      if (
        ![
          'keyword',
          'enabled',
          'defaultPurchaserEmployeeId',
          'operatingEntityId',
        ].includes(key)
      )
        fail('validation_failed')
    for (const value of [
      filters.defaultPurchaserEmployeeId,
      filters.operatingEntityId,
    ])
      if (value !== undefined && !validId(value)) fail('validation_failed')
    if (filters.defaultPurchaserEmployeeId && entity !== 'supplier')
      fail('validation_failed')
    return this.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (tx) => {
        const rows =
          await sql<StoredBobObject>`SELECT * FROM (${currentSource(entity)}) current ORDER BY updated_at DESC, object_id DESC`.execute(
            tx,
          )
        const views = rows.rows.map((row) => this.objectView(row))
        const keyword = filters.keyword?.trim().toLocaleLowerCase()
        const filtered = views.filter(
          (view) =>
            (!keyword ||
              [view.code, view.name!, view.py!].some((value) =>
                value.toLocaleLowerCase().includes(keyword),
              )) &&
            (filters.enabled === undefined ||
              view.enabled === filters.enabled) &&
            (!filters.defaultPurchaserEmployeeId ||
              (view.data.defaultPurchaser as { objectId?: string } | null)
                ?.objectId === filters.defaultPurchaserEmployeeId) &&
            (!filters.operatingEntityId ||
              (view.data.operatingEntities as Array<{ objectId: string }>).some(
                (reference) => reference.objectId === filters.operatingEntityId,
              )),
        )
        const order = input.sort?.[0]
        if (order)
          filtered.sort((left, right) => {
            const field =
              order.field === 'name'
                ? 'name'
                : order.field === 'code'
                  ? 'code'
                  : 'updatedAt'
            return (
              ((left[field] ?? '').localeCompare(right[field] ?? '') ||
                left.objectId.localeCompare(right.objectId)) *
              (order.order === 'asc' ? 1 : -1)
            )
          })
        return {
          items: filtered.slice(
            (input.page - 1) * input.pageSize,
            input.page * input.pageSize,
          ),
          total: filtered.length,
          page: input.page,
          pageSize: input.pageSize,
        }
      })
  }

  private objectView(row: StoredBobObject): BobObjectView {
    const view = parseCurrent(row)
    if (!isManagedBobEntity(view.entity)) return view
    const displayName = String(view.data.displayName)
    if (!row.revision) fail('internal_error')
    return {
      ...view,
      revision: row.revision,
      name: displayName,
      py: searchPinyin(displayName),
    }
  }

  async setEnabled(
    entity: ManagedBobEntity,
    input: { objectId: string; expectedRevision: string },
    enabled: boolean,
    actor: BobActor,
    requestId: string,
  ) {
    if (!isManagedBobEntity(entity)) fail('validation_failed')
    assertExactPermission(
      actor,
      `/bob/${entity}/${enabled ? 'enable' : 'disable'}`,
    )
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bob:archive:${entity}:${input.objectId}`}, 0))`.execute(
        tx,
      )
      await changeEnablement(
        tx,
        { id: input.objectId, revision: input.expectedRevision, enabled },
        {
          domain: 'bob',
          entity,
          actorId: actor.id,
          requestId,
          eventType: `BOB_${entity.replaceAll('-', '_').toUpperCase()}_${enabled ? 'ENABLED' : 'DISABLED'}`,
          changedError: 'conflict',
        },
        {
          read: async (executor, id) => {
            const row = await executor
              .selectFrom('bob_subjects')
              .select(['id', 'enabled', 'revision'])
              .where('id', '=', id)
              .where('entity', '=', entity)
              .forUpdate()
              .executeTakeFirst()
            return row ? { ...row, revision: String(row.revision) } : undefined
          },
          write: async (executor, current, nextEnabled, revision) => {
            const result = await executor
              .updateTable('bob_subjects')
              .set({ enabled: nextEnabled, revision })
              .where('id', '=', current.id)
              .where('entity', '=', entity)
              .where('revision', '=', current.revision)
              .executeTakeFirst()
            return result.numUpdatedRows === 1n
          },
        },
        {
          beforeWrite: async () => {
            if (!enabled && entity === 'other-unit') {
              const references = await sql<{
                id: string
              }>`SELECT id FROM aux_objects WHERE entity='vehicle' AND enabled AND data->'carrier'->>'otherUnitId'=${input.objectId}`.execute(
                tx,
              )
              if (references.rows.length)
                throw new BobApplicationError('conflict', {
                  blockers: references.rows.map((row) => ({
                    kind: 'AUX_CURRENT_REFERENCE',
                    entity: 'vehicle',
                    objectId: row.id,
                  })),
                })
            }
          },
          afterWrite: async () => {},
        },
      )
      const current = await tx
        .selectFrom('bob_subjects')
        .select(['id', 'enabled', 'revision'])
        .where('id', '=', input.objectId)
        .executeTakeFirstOrThrow()
      return { ...current, revision: String(current.revision) }
    })
  }

  async queryReferenceCandidates(
    input: BobReferenceQueryInput,
    actor: BobActor,
  ): Promise<BobReferenceCandidate[]> {
    assertReferenceEntity(input.entity)
    assertExactPermission(actor, '/bob/reference/query')
    if (input.sourceObjectId !== undefined && !validId(input.sourceObjectId))
      fail('validation_failed')
    if (
      input.operatingEntityId !== undefined &&
      !validId(input.operatingEntityId)
    )
      fail('validation_failed')
    if (
      input.behaviorProfile !== undefined &&
      (input.entity !== 'product' ||
        ![
          'RAW_MATERIAL',
          'STANDARD_FINISHED',
          'CUSTOM_FINISHED',
          'PACKAGING',
        ].includes(input.behaviorProfile))
    )
      fail('validation_failed')
    if (input.entity === 'customer-subunit')
      return this.customerSubunitReferences(input)
    const source = currentSource(input.entity)
    const where = [sql`enabled = true`]
    if (input.keyword?.trim()) {
      const keyword = `%${input.keyword.trim().replace(/[\\%_]/g, '\\$&')}%`
      where.push(
        sql`(code ILIKE ${keyword} OR COALESCE(data->>'name', data->>'displayName', '') ILIKE ${keyword})`,
      )
    }
    if (input.entity === 'product' && input.sourceObjectId)
      where.push(sql`object_id <> ${input.sourceObjectId}`)
    if (input.behaviorProfile)
      where.push(sql`data->>'behaviorProfile' = ${input.behaviorProfile}`)
    if (input.operatingEntityId)
      where.push(
        sql`(data->>'operatingEntityId' = ${input.operatingEntityId} OR data->>'defaultOperatingEntityId' = ${input.operatingEntityId} OR data->'defaultOperatingEntity'->>'sourceObjectId' = ${input.operatingEntityId} OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(data->'operatingEntities', '[]'::jsonb)) AS item WHERE item->>'objectId' = ${input.operatingEntityId}))`,
      )
    const result =
      await sql<StoredBobObject>`SELECT current.* FROM (${source}) current WHERE ${sql.join(where, sql` AND `)} ORDER BY code, object_id LIMIT 200`.execute(
        this.db,
      )
    return result.rows.map((row) => this.referenceCandidate(row))
  }

  private async customerSubunitReferences(
    input: BobReferenceQueryInput,
  ): Promise<BobReferenceCandidate[]> {
    const where = [sql`customer.enabled = true`, sql`subunit.enabled = true`]
    if (input.keyword?.trim()) {
      const keyword = `%${input.keyword.trim().replace(/[\\%_]/g, '\\$&')}%`
      where.push(
        sql`(root.code ILIKE ${keyword} OR subunit.name ILIKE ${keyword})`,
      )
    }
    const result = await sql<StoredCustomerSubunit>`
        SELECT root.subunit_id AS object_id, root.customer_id,
          'customer-subunit' AS entity, root.code, subunit.enabled,
          entry.id AS source_approval_entry_id, entry.version_no AS source_version_no,
          jsonb_strip_nulls(jsonb_build_object(
            'customerId', root.customer_id, 'name', subunit.name,
            'customerTypeId', subunit.customer_type_id,
            'settlementMethodId', subunit.settlement_method_id,
            'primarySalesAttributionType', subunit.primary_sales_attribution_type,
            'primarySalesAttributionObjectId', subunit.primary_sales_attribution_object_id
          )) AS data, entry.updated_at
        FROM dcl_customer_subunit_roots root
        JOIN LATERAL (
          SELECT * FROM approval_entries
          WHERE domain = 'dcl' AND entity = 'customer'
            AND subject_id = root.customer_id AND status = 'APPROVED'
          ORDER BY version_no DESC LIMIT 1
        ) entry ON true
        JOIN dcl_customer_versions customer ON customer.approval_entry_id = entry.id
        JOIN dcl_customer_version_subunits subunit
          ON subunit.customer_approval_entry_id = entry.id
          AND subunit.subunit_id = root.subunit_id
        WHERE ${sql.join(where, sql` AND `)}
        ORDER BY root.code, root.subunit_id LIMIT 200`.execute(this.db)
    return result.rows.map((row) => this.referenceCandidate(row))
  }

  private referenceCandidate(row: StoredBobObject): BobReferenceCandidate {
    const data = asData(row.data)
    const result: BobReferenceCandidate = {
      objectId: row.object_id,
      code: row.code,
      name: name(data),
      sourceApprovalEntryId: row.source_approval_entry_id,
      sourceVersionNo: row.source_version_no,
      data,
    }
    return result
  }
}
