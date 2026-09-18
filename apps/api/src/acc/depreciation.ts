import { moneyCent as cent, roundMoneyUnits as roundMoney } from './money.ts'
import { intermediaryUnits, intermediaryDecimal } from '@zerp/model'
import { sql, type Transaction } from 'kysely'
import { ulid } from 'ulid'
import type { DB, JsonValue } from '../db/generated.ts'
import type { AccMappingDefinition } from './mapping-catalog.ts'
import { readVouPersistence } from '../vou/service.ts'
import { AccApplicationError } from './service.ts'

const units = (value: string) => intermediaryUnits(value, 8)
const decimal = (value: bigint) => intermediaryDecimal(value, 8)
const monthNumber = (month: string) =>
  Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7))

async function validateDepreciationSubjects(
  tx: Transaction<DB>,
  bookId: string,
  assetId: string,
  pairs: ReadonlyArray<readonly [string, Record<string, string>]>,
): Promise<void> {
  const ids = pairs.map(([id]) => id)
  const subjects = await tx
    .selectFrom('acc_subjects')
    .select(['id', 'enabled', 'required_dimensions'])
    .where('book_id', '=', bookId)
    .where('id', 'in', ids)
    .forShare()
    .execute()
  const parents = await tx
    .selectFrom('acc_subjects')
    .select('parent_id')
    .where('parent_id', 'in', ids)
    .execute()
  for (const [id, dimensions] of pairs) {
    const subject = subjects.find((s) => s.id === id),
      required = subject?.required_dimensions as string[] | undefined
    if (
      !subject?.enabled ||
      parents.some((s) => s.parent_id === id) ||
      required?.some((d) => !dimensions[d]) ||
      Object.keys(dimensions).some((d) => !required?.includes(d))
    )
      throw new AccApplicationError('acc_period_depreciation_mapping_invalid', [
        { kind: 'ASSET', objectId: assetId, bookId, subjectId: id },
      ])
  }
}

export async function adoptDepreciationBasis(
  tx: Transaction<DB>,
  input: {
    assetId: string
    bookId: string
    acquiredOn: string
    usefulLifeMonths: number
    residualRate: string
    currency: string
    facts: Record<string, unknown>
    configuration: AccMappingDefinition['assetConfiguration']
  },
): Promise<void> {
  const config = input.configuration
  if (!config)
    throw new AccApplicationError('acc_period_depreciation_mapping_invalid', [
      { kind: 'ASSET', objectId: input.assetId },
    ])
  const dimensions = (paths: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(paths).map(([dimension, path]) => {
        let value: unknown = input.facts
        for (const key of path.split('.'))
          value =
            typeof value === 'object' && value !== null
              ? (value as Record<string, unknown>)[key]
              : undefined
        if (typeof value !== 'string' || !value)
          throw new AccApplicationError(
            'acc_period_depreciation_mapping_invalid',
            [{ kind: 'ASSET', objectId: input.assetId }],
          )
        return [dimension, value]
      }),
    )
  const accumulatedDimensions = dimensions(
    config.accumulatedDepreciationDimensions,
  )
  const expenseDimensions = dimensions(config.depreciationExpenseDimensions)
  await validateDepreciationSubjects(tx, input.bookId, input.assetId, [
    [config.accumulatedDepreciationSubjectId, accumulatedDimensions],
    [config.depreciationExpenseSubjectId, expenseDimensions],
  ])
  await tx
    .insertInto('acc_asset_depreciation_basis')
    .values({
      asset_id: input.assetId,
      book_id: input.bookId,
      acquired_on: new Date(`${input.acquiredOn}T00:00:00Z`),
      useful_life_months: input.usefulLifeMonths,
      residual_rate: input.residualRate,
      currency: input.currency,
      accumulated_subject_id: config.accumulatedDepreciationSubjectId,
      accumulated_dimensions: accumulatedDimensions,
      expense_subject_id: config.depreciationExpenseSubjectId,
      expense_dimensions: expenseDimensions,
    })
    .execute()
}

export async function settleDepreciation(
  tx: Transaction<DB>,
  bookId: string,
  month: string,
): Promise<void> {
  const rows = await sql<{
    asset_id: string
    acquired_on: string
    useful_life_months: number
    residual_rate: string
    currency: string
    original_value: string
    accumulated_depreciation: string
    accumulated_subject_id: string
    expense_subject_id: string
    accumulated_dimensions: Record<string, string>
    expense_dimensions: Record<string, string>
    status: string
    state_vou_approval_entry_id: string | null
  }>`SELECT basis.*, basis.acquired_on::text, value.original_value::text, value.accumulated_depreciation::text,
    asset.status, asset.state_vou_approval_entry_id FROM acc_asset_depreciation_basis basis
    JOIN acc_asset_book_values value USING(asset_id,book_id)
    JOIN acc_asset_registers asset ON asset.id=basis.asset_id WHERE basis.book_id=${bookId}
    ORDER BY basis.asset_id FOR UPDATE OF value`.execute(tx)
  for (const asset of rows.rows) {
    const age = monthNumber(month) - monthNumber(asset.acquired_on)
    if (age <= 0) continue
    if (asset.status !== 'ACTIVE' && asset.state_vou_approval_entry_id) {
      const disposal = await readVouPersistence(tx, {
        approvalEntryId: asset.state_vou_approval_entry_id,
      })
      if (disposal.businessDate.slice(0, 7) < month) continue
    }
    const blocker = { kind: 'ASSET', objectId: asset.asset_id, bookId, month }
    const original = units(asset.original_value),
      accumulated = units(asset.accumulated_depreciation)
    const residual = roundMoney(
      original * units(asset.residual_rate),
      10_000_000_000n,
    )
    const remaining = original - residual - accumulated
    if (remaining === 0n) continue
    if (
      remaining < 0n ||
      original % cent !== 0n ||
      accumulated % cent !== 0n ||
      asset.currency !== 'CNY'
    )
      throw new AccApplicationError('acc_period_depreciation_basis_invalid', [
        blocker,
      ])
    const scheduled = roundMoney(
      original - residual,
      BigInt(asset.useful_life_months),
    )
    const amount =
      age >= asset.useful_life_months || scheduled > remaining
        ? remaining
        : scheduled
    if (amount === 0n) continue
    await validateDepreciationSubjects(tx, bookId, asset.asset_id, [
      [asset.accumulated_subject_id, asset.accumulated_dimensions],
      [asset.expense_subject_id, asset.expense_dimensions],
    ])
    const journalId = ulid()
    const end = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
    )
    await tx
      .insertInto('acc_journal_entries')
      .values({
        id: journalId,
        book_id: bookId,
        source_kind: 'DEPRECIATION',
        business_date: end,
        currency: asset.currency,
        created_at: new Date(),
      })
      .execute()
    await tx
      .insertInto('acc_journal_lines')
      .values([
        {
          id: ulid(),
          journal_entry_id: journalId,
          subject_id: asset.expense_subject_id,
          direction: 'DEBIT',
          amount: decimal(amount),
          dimensions: asset.expense_dimensions as JsonValue,
        },
        {
          id: ulid(),
          journal_entry_id: journalId,
          subject_id: asset.accumulated_subject_id,
          direction: 'CREDIT',
          amount: decimal(amount),
          dimensions: asset.accumulated_dimensions as JsonValue,
        },
      ])
      .execute()
    await tx
      .insertInto('acc_asset_depreciation_entries')
      .values({
        asset_id: asset.asset_id,
        book_id: bookId,
        period_month: month,
        amount: decimal(amount),
        journal_entry_id: journalId,
      })
      .execute()
    await tx
      .updateTable('acc_asset_book_values')
      .set({ accumulated_depreciation: decimal(accumulated + amount) })
      .where('asset_id', '=', asset.asset_id)
      .where('book_id', '=', bookId)
      .execute()
  }
}

export async function removeDepreciation(
  tx: Transaction<DB>,
  bookId: string,
  month: string,
): Promise<void> {
  await sql`UPDATE acc_asset_book_values value SET accumulated_depreciation=value.accumulated_depreciation-entry.amount
    FROM acc_asset_depreciation_entries entry WHERE entry.asset_id=value.asset_id AND entry.book_id=value.book_id
    AND entry.book_id=${bookId} AND entry.period_month=${month}`.execute(tx)
  await sql`DELETE FROM acc_journal_entries WHERE id IN (SELECT journal_entry_id FROM acc_asset_depreciation_entries WHERE book_id=${bookId} AND period_month=${month})`.execute(
    tx,
  )
}
