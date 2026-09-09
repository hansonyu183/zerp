import { ulid } from 'ulid'
import { quantityMovementEntities } from './service.ts'
import {
  prepareAccMappingSave,
  vouEntities,
  vouEntityInputDescriptors,
  type AccMappingData,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'

import type { DB, JsonValue } from '../db/generated.ts'

export type AccMappingCatalogActor = {
  id: string
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
    fieldCatalog: {
      headerFields: string[]
      lineFields: string[]
      collections: string[]
    }
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
  revision: string
  book: { id: string; code: string; name: string }
  vouEntity: { id: string; code: string; name: string }
  defaultResult: 'POST' | 'UN_POST'
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
  revision: string | number | bigint
  book_id: string
  book_snapshot: JsonValue
  vou_entity_snapshot: JsonValue
  default_result: 'POST' | 'UN_POST'
  mapping_definition: JsonValue
}

export class AccMappingCatalogError extends Error {
  readonly errorKey: string

  constructor(errorKey: string) {
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
        .selectFrom('acc_books as b')
        .innerJoin('acc_book_access as a', 'a.book_id', 'b.id')
        .select(['b.id', 'b.code', 'b.name'])
        .where('a.user_id', '=', actor.id)
        .where('a.can_query', '=', true)
        .orderBy('code')
        .execute(),
      this.db
        .selectFrom('acc_mapping_vou_entities')
        .select(['id', 'code', 'name', 'field_catalog'])
        .where('enabled', '=', true)
        .orderBy('code')
        .execute(),
      this.db
        .selectFrom('acc_subjects as s')
        .innerJoin('acc_book_access as a', 'a.book_id', 's.book_id')
        .select([
          's.id',
          's.book_id',
          's.code',
          's.name',
          's.required_dimensions',
        ])
        .where('a.user_id', '=', actor.id)
        .where('a.can_query', '=', true)
        .where('enabled', '=', true)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('acc_subjects as child')
                .select('child.id')
                .whereRef('child.parent_id', '=', 's.id'),
            ),
          ),
        )
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
            collections: mappingCollections(item.code),
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
    await this.requireBook(this.db, input.bookId, actor, false)
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
    await this.requireBook(this.db, bookId, actor, false)
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

  private async requireBook(
    executor: Kysely<DB> | Transaction<DB>,
    bookId: string,
    actor: AccMappingCatalogActor,
    operate: boolean,
  ) {
    const access = await executor
      .selectFrom('acc_book_access')
      .selectAll()
      .where('book_id', '=', bookId)
      .where('user_id', '=', actor.id)
      .forShare()
      .executeTakeFirst()
    if (!access || !(operate ? access.can_operate : access.can_query))
      throw new AccMappingCatalogError('acc_book_access_denied')
  }

  async save(
    input: {
      bookId: string
      vouEntity: string
      expectedRevision: string | null
      defaultResult: 'POST' | 'UN_POST'
      definition: AccMappingDefinition
    },
    actor: AccMappingCatalogActor,
  ): Promise<AccMappingCurrent> {
    this.require(actor, 'save')
    return this.db.transaction().execute(async (tx) => {
      await this.requireBook(tx, input.bookId, actor, true)
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`acc:mapping:${input.bookId}:${input.vouEntity}`}, 0))`.execute(
        tx,
      )
      const existing = (
        await this.currentRows(input.bookId, input.vouEntity, tx, true)
      )[0]
      if (
        (existing ? String(existing.revision) : null) !== input.expectedRevision
      )
        throw new AccMappingCatalogError('acc_mapping_stale_revision')
      const book = await tx
        .selectFrom('acc_books')
        .select(['id', 'code', 'name'])
        .where('id', '=', input.bookId)
        .executeTakeFirst()
      const vouEntity = await tx
        .selectFrom('acc_mapping_vou_entities')
        .selectAll()
        .where('code', '=', input.vouEntity)
        .executeTakeFirst()
      if (!book)
        throw new AccMappingCatalogError('acc_mapping_book_unavailable')
      if (!vouEntity)
        throw new AccMappingCatalogError('acc_mapping_vou_entity_unavailable')
      // Lock the real subjects used by subject maintenance, not just catalog copies.
      const subjects = await tx
        .selectFrom('acc_subjects')
        .selectAll()
        .where('book_id', '=', input.bookId)
        .orderBy('id')
        .forUpdate()
        .execute()
      const parents = new Set(
        subjects.flatMap((subject) =>
          subject.parent_id ? [subject.parent_id] : [],
        ),
      )
      const catalog = object(vouEntity.field_catalog)
      const result = prepareAccMappingSave(
        {
          book,
          vouEntity,
          defaultResult: input.defaultResult,
          definition: input.definition,
        },
        {
          book: { ...book, enabled: true },
          vouEntity,
          fieldCatalog: {
            collections: mappingCollections(vouEntity.code),
            headerFields: strings(catalog.headerFields),
            lineFields: strings(catalog.lineFields),
          },
          accounts: subjects.map((subject) => ({
            id: subject.id,
            bookId: subject.book_id,
            enabled: subject.enabled,
            leaf: !parents.has(subject.id),
            requiredDimensions: strings(subject.required_dimensions),
          })),
        },
      )
      if (!result.ok) throw new AccMappingCatalogError(result.error.errorKey)
      const id = existing?.subject_id ?? ulid()
      const revision = existing ? BigInt(existing.revision) + 1n : 1n
      const data = result.data
      await sql`INSERT INTO acc_mappings(id, book_id, vou_entity_id, vou_entity, book_snapshot, vou_entity_snapshot, default_result, mapping_definition, revision, created_at, created_by, updated_at, updated_by)
        VALUES(${id}, ${book.id}, ${vouEntity.id}, ${vouEntity.code}, ${JSON.stringify(data.book)}::jsonb, ${JSON.stringify(data.vouEntity)}::jsonb, ${data.defaultResult}, ${JSON.stringify(data.definition)}::jsonb, ${revision}, now(), ${actor.id}, now(), ${actor.id})
        ON CONFLICT(id) DO UPDATE SET book_snapshot=excluded.book_snapshot, vou_entity_snapshot=excluded.vou_entity_snapshot, default_result=excluded.default_result, mapping_definition=excluded.mapping_definition, revision=excluded.revision, updated_at=excluded.updated_at, updated_by=excluded.updated_by`.execute(
        tx,
      )
      await syncMappingSubjectUsages(tx, id, data)
      await tx
        .insertInto('app_audit_events')
        .values({
          id: ulid(),
          event_type: 'ACC_MAPPING_SAVED',
          actor_user_id: actor.id,
          target_type: 'acc/mapping',
          target_id: id,
          result: 'SUCCESS',
          summary: JSON.stringify({
            revision: String(revision),
            data,
          }) as unknown as JsonValue,
        })
        .execute()
      return this.current(
        (await this.currentRows(book.id, vouEntity.code, tx))[0]!,
      )
    })
  }

  private async currentRows(
    bookId: string,
    vouEntity?: string,
    executor: Kysely<DB> | Transaction<DB> = this.db,
    lock = false,
  ) {
    const filter = vouEntity ? sql`AND vou_entity = ${vouEntity}` : sql``
    return (
      await sql<CurrentMappingRow>`SELECT id AS subject_id, revision, book_id, book_snapshot, vou_entity_snapshot, default_result, mapping_definition FROM acc_mappings WHERE book_id = ${bookId} ${filter} ORDER BY vou_entity ${lock ? sql`FOR UPDATE` : sql``}`.execute(
        executor,
      )
    ).rows
  }

  private current(row: CurrentMappingRow): AccMappingCurrent {
    const book = object(row.book_snapshot)
    const vouEntity = object(row.vou_entity_snapshot)
    return {
      subjectId: row.subject_id,
      revision: String(row.revision),
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

export async function syncMappingSubjectUsages(
  tx: Transaction<DB>,
  mappingId: string,
  data: AccMappingData,
) {
  const ids = new Set<string>()
  for (const template of data.definition.templates)
    for (const line of template.lines) {
      if (line.subjectSource === 'FIXED') ids.add(line.subjectValue)
      if (line.costCounterpartSubjectId) ids.add(line.costCounterpartSubjectId)
    }
  const asset = data.definition.assetConfiguration
  if (asset) {
    ids.add(asset.assetSubjectId)
    ids.add(asset.accumulatedDepreciationSubjectId)
    ids.add(asset.depreciationExpenseSubjectId)
  }
  await sql`DELETE FROM acc_mapping_subject_usages WHERE mapping_id=${mappingId}`.execute(
    tx,
  )
  for (const id of [...ids].sort())
    await sql`INSERT INTO acc_mapping_subject_usages(mapping_id,subject_id) VALUES(${mappingId},${id})`.execute(
      tx,
    )
}

function mappingCollections(code: string): string[] {
  if (quantityMovementEntities.includes(code)) return ['inventoryMovements']
  const entity = vouEntities.find((entity) => entity === code)
  return entity
    ? vouEntityInputDescriptors[entity]
        .filter(
          (field) => field.kind === 'array' && field.key !== 'attachments',
        )
        .map((field) => field.key)
    : []
}
