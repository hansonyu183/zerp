import type { Kysely } from 'kysely'
import { sql } from 'kysely'

import type { DB } from '../db/generated.ts'

export const bobEntities = [
  'customer',
  'supplier',
  'other-unit',
  'employee',
  'sales-partner',
  'product',
  'warehouse',
  'vehicle',
  'fund-account',
  'operating-entity',
] as const

export type BobEntity = (typeof bobEntities)[number]
export type BobReferenceEntity =
  | 'customer-subunit'
  | 'operating-entity'
  | 'employee'
  | 'other-unit'
  | 'supplier'
  | 'sales-partner'
  | 'product'
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
  readonly errorKey: 'validation_failed' | 'forbidden' | 'internal_error'

  constructor(errorKey: BobApplicationError['errorKey']) {
    super(errorKey)
    this.name = 'BobApplicationError'
    this.errorKey = errorKey
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
}

interface StoredCustomerSubunit extends Omit<StoredBobObject, 'object_id'> {
  object_id: string
  customer_id: string
}

/**
 * BOB returns effective read-only business data from the DCL-owned stable
 * subject, its highest APPROVED entry, and that entry's typed snapshot. No BOB
 * table stores a second copy, so approval rollback changes the next result.
 */
function dclCurrent(entity: BobEntity) {
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
          'displayName', snapshot.display_name, 'legalName', snapshot.legal_name,
          'kind', snapshot.kind, 'legalIdentifier', snapshot.legal_identifier,
          'defaultOperatingEntityId', snapshot.default_operating_entity_id,
          'defaultPurchaserEmployeeId', snapshot.default_purchaser_employee_id
        ))
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT * FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'supplier' AND subject_id = subject.id
          AND status = 'APPROVED'
        ORDER BY version_no DESC LIMIT 1
      ) entry ON true
      JOIN dcl_supplier_versions snapshot ON snapshot.approval_entry_id = entry.id
      WHERE subject.entity = 'supplier'

      UNION ALL
      SELECT subject.id, subject.entity, subject.code, snapshot.enabled, entry.id,
        entry.version_no, entry.updated_at,
        jsonb_strip_nulls(jsonb_build_object(
          'displayName', snapshot.display_name, 'legalName', snapshot.legal_name,
          'kind', snapshot.kind, 'legalIdentifier', snapshot.legal_identifier,
          'defaultOperatingEntityId', snapshot.default_operating_entity_id
        ))
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT * FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'other-unit' AND subject_id = subject.id
          AND status = 'APPROVED'
        ORDER BY version_no DESC LIMIT 1
      ) entry ON true
      JOIN dcl_other_unit_versions snapshot ON snapshot.approval_entry_id = entry.id
      WHERE subject.entity = 'other-unit'

      UNION ALL
      SELECT subject.id, subject.entity, subject.code, snapshot.enabled, entry.id,
        entry.version_no, entry.updated_at,
        jsonb_strip_nulls(jsonb_build_object(
          'name', snapshot.display_name,
          'employeeCategoryId', snapshot.employee_category_id,
          'departmentId', snapshot.department_id, 'positionId', snapshot.position_id,
          'operatingEntityId', snapshot.operating_entity_id
        ))
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT * FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'employee' AND subject_id = subject.id
          AND status = 'APPROVED'
        ORDER BY version_no DESC LIMIT 1
      ) entry ON true
      JOIN dcl_employee_versions snapshot ON snapshot.approval_entry_id = entry.id
      WHERE subject.entity = 'employee'

      UNION ALL
      SELECT subject.id, subject.entity, subject.code, snapshot.enabled, entry.id,
        entry.version_no, entry.updated_at,
        jsonb_strip_nulls(jsonb_build_object(
          'displayName', snapshot.display_name, 'legalName', snapshot.legal_name,
          'kind', snapshot.kind, 'legalIdentifier', snapshot.legal_identifier,
          'defaultOperatingEntityId', snapshot.default_operating_entity_id
        ))
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT * FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'sales-partner' AND subject_id = subject.id
          AND status = 'APPROVED'
        ORDER BY version_no DESC LIMIT 1
      ) entry ON true
      JOIN dcl_sales_partner_versions snapshot ON snapshot.approval_entry_id = entry.id
      WHERE subject.entity = 'sales-partner'

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

      UNION ALL
      SELECT subject.id, subject.entity, subject.code, snapshot.enabled, entry.id,
        entry.version_no, entry.updated_at,
        jsonb_strip_nulls(jsonb_build_object(
          'name', snapshot.name, 'address', snapshot.address,
          'contactName', snapshot.contact_name, 'contactPhone', snapshot.contact_phone,
          'managerEmployeeId', snapshot.manager_employee_id, 'remark', snapshot.remark
        ))
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT * FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'warehouse' AND subject_id = subject.id
          AND status = 'APPROVED'
        ORDER BY version_no DESC LIMIT 1
      ) entry ON true
      JOIN dcl_warehouse_versions snapshot ON snapshot.approval_entry_id = entry.id
      WHERE subject.entity = 'warehouse'

      UNION ALL
      SELECT subject.id, subject.entity, subject.code, snapshot.enabled, entry.id,
        entry.version_no, entry.updated_at,
        jsonb_strip_nulls(jsonb_build_object(
          'name', snapshot.name, 'plateNumber', snapshot.plate_number,
          'vehicleTypeObjectId', snapshot.vehicle_type_object_id,
          'carrierAffiliationType', snapshot.carrier_affiliation_type,
          'carrierOperatingEntityId', snapshot.carrier_operating_entity_id,
          'carrierOtherUnitObjectId', snapshot.carrier_other_unit_object_id,
          'bulkLiquidCapable', snapshot.bulk_liquid_capable
        ))
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT * FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'vehicle' AND subject_id = subject.id
          AND status = 'APPROVED'
        ORDER BY version_no DESC LIMIT 1
      ) entry ON true
      JOIN dcl_vehicle_versions snapshot ON snapshot.approval_entry_id = entry.id
      WHERE subject.entity = 'vehicle'

      UNION ALL
      SELECT subject.id, subject.entity, subject.code, snapshot.enabled, entry.id,
        entry.version_no, entry.updated_at,
        jsonb_strip_nulls(jsonb_build_object(
          'name', snapshot.name, 'currency', snapshot.currency,
          'accountName', snapshot.account_name, 'accountNumber', snapshot.account_number,
          'bankName', snapshot.bank_name,
          'operatingEntityId', snapshot.operating_entity_id
        ))
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT * FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'fund-account' AND subject_id = subject.id
          AND status = 'APPROVED'
        ORDER BY version_no DESC LIMIT 1
      ) entry ON true
      JOIN dcl_fund_account_versions snapshot ON snapshot.approval_entry_id = entry.id
      WHERE subject.entity = 'fund-account'

      UNION ALL
      SELECT subject.id, subject.entity, subject.code, snapshot.enabled, entry.id,
        entry.version_no, entry.updated_at,
        jsonb_strip_nulls(jsonb_build_object(
          'name', snapshot.legal_name, 'legalName', snapshot.legal_name,
          'legalIdentifier', snapshot.legal_identifier
        ))
      FROM dcl_subjects subject
      JOIN LATERAL (
        SELECT * FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'operating-entity' AND subject_id = subject.id
          AND status = 'APPROVED'
        ORDER BY version_no DESC LIMIT 1
      ) entry ON true
      JOIN dcl_operating_entity_versions snapshot ON snapshot.approval_entry_id = entry.id
      WHERE subject.entity = 'operating-entity'
    ) typed_current
    WHERE typed_current.entity = ${entity}`
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
      'operating-entity',
      'employee',
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
  includeFundAccountNumber = true,
): BobObjectView {
  assertEntity(row.entity)
  if (!Number.isInteger(row.source_version_no) || row.source_version_no < 1)
    fail('internal_error')
  const data = asData(row.data)
  if (row.entity === 'fund-account' && !includeFundAccountNumber)
    delete data.accountNumber
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
    const filter = input.filters ?? {}
    for (const value of [
      filter.categoryId,
      filter.defaultPurchaserEmployeeId,
      filter.operatingEntityId,
      filter.productTypeId,
    ]) {
      if (value !== undefined && !validId(value)) fail('validation_failed')
    }
    if (entity === 'fund-account' && filter.keyword?.trim())
      fail('validation_failed')
    const where = [sql`TRUE`]
    if (filter.keyword?.trim()) {
      const keyword = `%${filter.keyword.trim()}%`
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
    const source = dclCurrent(entity)
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
          items: rows.rows.map((row) => parseCurrent(row, false)),
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
    const source = dclCurrent(entity)
    const result =
      await sql<StoredBobObject>`SELECT current.* FROM (${source}) current WHERE object_id = ${objectId}`.execute(
        this.db,
      )
    const row = result.rows[0]
    if (!row) fail('validation_failed')
    return parseCurrent(row)
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
    const source = dclCurrent(input.entity)
    const where = [sql`enabled = true`]
    if (input.keyword?.trim()) {
      const keyword = `%${input.keyword.trim()}%`
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
        sql`(data->>'operatingEntityId' = ${input.operatingEntityId} OR data->>'defaultOperatingEntityId' = ${input.operatingEntityId} OR data->'defaultOperatingEntity'->>'sourceObjectId' = ${input.operatingEntityId} OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(data->'operatingEntityIds', '[]'::jsonb)) AS item WHERE item = ${input.operatingEntityId}))`,
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
      const keyword = `%${input.keyword.trim()}%`
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
