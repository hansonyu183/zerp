import {
  checkIntermediaryResult,
  type VouIntermediaryCalculationInput,
} from '@zerp/model'
import type { Transaction } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../db/generated.ts'
import { intermediaryCalculation } from './contract.ts'
import { canonical, intermediarySource } from './intermediary-source.ts'
import { IntermediaryScriptService } from './intermediary-script-service.ts'
import { VouApplicationError } from './service.ts'

type Calculation = VouIntermediaryCalculationInput
export async function validateIntermediaryCalculation(
  tx: Transaction<DB>,
  documentId: string,
  businessDate: string,
  calculation: Calculation,
  checkScript = true,
) {
  const current = await intermediarySource(tx, businessDate)
  if (
    current.sourceHash !== calculation.sourceHash ||
    canonical(current.source) !== canonical(calculation.source)
  )
    throw new VouApplicationError('vou_intermediary_source_changed')
  if (checkScript) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('vou:intermediary-script:GLOBAL', 0))`.execute(
      tx,
    )
    const script = await new IntermediaryScriptService(tx).read(tx)
    if (!script)
      throw new VouApplicationError('vou_intermediary_script_required')
    if (canonical(script) !== canonical(calculation.script))
      throw new VouApplicationError('vou_intermediary_script_changed')
  }
  const existing = await sql<{
    document_id: string
  }>`SELECT document_id FROM vou_intermediary_calculation_details WHERE period_end = ${businessDate}::date AND document_id <> ${documentId}`.execute(
    tx,
  )
  if (existing.rows.length)
    throw new VouApplicationError(
      'vou_intermediary_month_exists',
      existing.rows.map((row) => ({ documentId: row.document_id })),
    )
  if (!intermediaryCalculation.safeParse(calculation).success)
    throw new VouApplicationError('vou_intermediary_result_invalid')
  const checked = checkIntermediaryResult(
    calculation.source,
    calculation.result,
  )
  if (!checked.ok)
    throw new VouApplicationError('vou_intermediary_result_invalid')
  const amount = checked.amount
  return { ...current, amount }
}

export async function validateIntermediaryClosing(
  tx: Transaction<DB>,
  month: string,
): Promise<void> {
  const { intermediaryControlBook } = await import('./intermediary-source.ts')
  const book = await intermediaryControlBook(tx)
  for (let period = book.start_month; period <= month;) {
    const result = await sql<{
      document_id: string
      approval_entry_id: string
      business_date: string
    }>`
      SELECT detail.document_id, detail.approval_entry_id, detail.business_date::text
      FROM vou_intermediary_calculation_details detail JOIN approval_entries entry ON entry.id = detail.approval_entry_id
      WHERE entry.status = 'APPROVED' AND detail.period_start = ${`${period}-01`}::date
    `.execute(tx)
    const row = result.rows[0]
    if (!row || result.rows.length !== 1)
      throw new VouApplicationError('vou_intermediary_month_required', [
        { month: period },
      ])
    const { readVouPersistence } = await import('./service.ts')
    const persisted = await readVouPersistence(tx, {
      approvalEntryId: row.approval_entry_id,
    })
    if (!('intermediaryCalculation' in persisted.payload))
      throw new VouApplicationError('vou_intermediary_result_invalid')
    await validateIntermediaryCalculation(
      tx,
      row.document_id,
      row.business_date,
      persisted.payload.intermediaryCalculation,
      false,
    )
    const [year, number] = period.split('-').map(Number)
    period = new Date(Date.UTC(year!, number!, 1)).toISOString().slice(0, 7)
  }
}
