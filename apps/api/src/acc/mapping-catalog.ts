import { sql, type Kysely } from 'kysely'

import type { DB, JsonValue } from '../db/generated.ts'

export type AccMappingCatalogActor = {
  permissions: readonly string[]
}

export type AccMappingQueryInput = {
  bookId: string
  vouEntity?: string
  page: number
  pageSize: number
}

export type AccMappingCatalog = {
  books: Array<{ id: string; code: string; name: string }>
  vouEntities: Array<{
    id: string
    code: string
    name: string
    fieldCatalog: { headerFields: string[]; lineFields: string[] }
  }>
  subjects: Array<{
    id: string
    bookId: string
    code: string
    name: string
    requiredDimensions: string[]
  }>
}

export type AccMappingCurrent = {
  subjectId: string
  approvalEntryId: string
  approvalRevision: string
  book: { id: string; code: string; name: string }
  vouEntity: { id: string; code: string; name: string }
  defaultResult: string
  definition: AccMappingDefinition
}

export type AccMappingDefinition = {
  defaultTemplateId: string | null
  rules: Array<{
    conditions: Array<{
      field: string
      operator: 'EQ' | 'NE' | 'IN' | 'NOT_IN' | 'IS_EMPTY' | 'IS_NOT_EMPTY'
      values: string[]
    }>
    result: 'POST' | 'UN_POST'
    templateId: string | null
  }>
  templates: Array<{
    templateId: string
    collection: string | null
    lines: Array<{
      subjectSource: 'FIXED' | 'FIELD'
      subjectValue: string
      direction: 'DEBIT' | 'CREDIT'
      amountField: string
      currencyField: string
      dimensions: Record<string, string>
      quantityField: string | null
      costCounterpartSubjectId: string | null
      costCounterpartDimensions: Record<string, string>
    }>
  }>
  assetConfiguration: {
    assetSubjectId: string
    assetDimensions: Record<string, string>
    accumulatedDepreciationSubjectId: string
    accumulatedDepreciationDimensions: Record<string, string>
    depreciationExpenseSubjectId: string
    depreciationExpenseDimensions: Record<string, string>
  } | null
}

type CurrentMappingRow = {
  subject_id: string
  approval_entry_id: string
  revision: string | number | bigint
  book_id: string
  book_snapshot: JsonValue
  vou_entity_snapshot: JsonValue
  default_result: string
  mapping_definition: JsonValue
}

export class AccMappingCatalogError extends Error {
  readonly errorKey: 'forbidden' | 'not_found'

  constructor(errorKey: 'forbidden' | 'not_found') {
    super(errorKey)
    this.errorKey = errorKey
  }
}

function object(value: JsonValue | unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function definition(value: JsonValue): AccMappingDefinition {
  return object(value) as AccMappingDefinition
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export class AccMappingCatalogService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async catalog(actor: AccMappingCatalogActor): Promise<AccMappingCatalog> {
    if (!actor.permissions.includes('/acc/mapping/catalog'))
      throw new AccMappingCatalogError('forbidden')
    const [books, vouEntities, subjects] = await Promise.all([
      this.db
        .selectFrom('dcl_acc_book_facts')
        .select(['id', 'code', 'name'])
        .where('enabled', '=', true)
        .orderBy('code')
        .execute(),
      this.db
        .selectFrom('dcl_acc_vou_entity_facts')
        .select(['id', 'code', 'name', 'field_catalog'])
        .where('enabled', '=', true)
        .orderBy('code')
        .execute(),
      this.db
        .selectFrom('dcl_acc_subject_facts')
        .select(['id', 'book_id', 'code', 'name', 'required_dimensions'])
        .where('enabled', '=', true)
        .where('leaf', '=', true)
        .orderBy('book_id')
        .orderBy('code')
        .execute(),
    ])
    return {
      books,
      vouEntities: vouEntities.map((item) => {
        const catalog = object(item.field_catalog)
        return {
          id: item.id,
          code: item.code,
          name: item.name,
          fieldCatalog: {
            headerFields: strings(catalog.headerFields),
            lineFields: strings(catalog.lineFields),
          },
        }
      }),
      subjects: subjects.map((item) => ({
        id: item.id,
        bookId: item.book_id,
        code: item.code,
        name: item.name,
        requiredDimensions: strings(item.required_dimensions),
      })),
    }
  }

  async query(
    input: AccMappingQueryInput,
    actor: AccMappingCatalogActor,
  ): Promise<{
    items: AccMappingCurrent[]
    total: number
    page: number
    pageSize: number
  }> {
    this.require(actor, 'query')
    const rows = await this.currentRows(input.bookId, input.vouEntity)
    const start = (input.page - 1) * input.pageSize
    return {
      items: rows
        .slice(start, start + input.pageSize)
        .map((row) => this.current(row)),
      total: rows.length,
      page: input.page,
      pageSize: input.pageSize,
    }
  }

  async get(
    bookId: string,
    vouEntity: string,
    actor: AccMappingCatalogActor,
  ): Promise<AccMappingCurrent> {
    this.require(actor, 'get')
    const row = await this.currentRows(bookId, vouEntity).then(
      (rows) => rows[0],
    )
    if (!row) throw new AccMappingCatalogError('not_found')
    return this.current(row)
  }

  private require(actor: AccMappingCatalogActor, action: string): void {
    if (!actor.permissions.includes(`/acc/mapping/${action}`))
      throw new AccMappingCatalogError('forbidden')
  }

  private async currentRows(bookId: string, vouEntity?: string) {
    const vouFilter = vouEntity
      ? sql`AND current_mapping.vou_entity_snapshot->>'code' = ${vouEntity}`
      : sql``
    const result = await sql<CurrentMappingRow>`
      SELECT current_mapping.subject_id,
             current_mapping.approval_entry_id,
             current_mapping.revision,
             current_mapping.book_id,
             current_mapping.book_snapshot,
             current_mapping.vou_entity_snapshot,
             current_mapping.default_result,
             current_mapping.mapping_definition
      FROM (
        SELECT DISTINCT ON (e.subject_id)
               e.subject_id,
               e.id AS approval_entry_id,
               e.revision,
               m.book_id,
               m.book_snapshot,
               m.vou_entity_snapshot,
               m.default_result,
               m.mapping_definition
        FROM dcl_acc_mapping_versions AS m
        INNER JOIN approval_entries AS e ON e.id = m.approval_entry_id
        WHERE e.domain = 'dcl'
          AND e.entity = 'acc-mapping'
          AND e.status = 'APPROVED'
        ORDER BY e.subject_id, e.version_no DESC
      ) AS current_mapping
      WHERE current_mapping.book_id = ${bookId}
      ${vouFilter}
      ORDER BY current_mapping.subject_id
    `.execute(this.db)
    return result.rows
  }

  private current(row: CurrentMappingRow): AccMappingCurrent {
    const book = object(row.book_snapshot)
    const vouEntity = object(row.vou_entity_snapshot)
    return {
      subjectId: row.subject_id,
      approvalEntryId: row.approval_entry_id,
      approvalRevision: String(row.revision),
      book: {
        id: String(book.id ?? ''),
        code: String(book.code ?? ''),
        name: String(book.name ?? ''),
      },
      vouEntity: {
        id: String(vouEntity.id ?? ''),
        code: String(vouEntity.code ?? ''),
        name: String(vouEntity.name ?? ''),
      },
      defaultResult: row.default_result,
      definition: definition(row.mapping_definition),
    }
  }
}
