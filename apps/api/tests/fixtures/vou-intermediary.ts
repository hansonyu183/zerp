import type { Kysely } from 'kysely'
import type { DB } from '../../src/db/generated.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import assert from 'node:assert/strict'
import { ulid } from 'ulid'
import { VouService } from '../../src/vou/service.ts'

type VouActor = Parameters<VouService['getIntermediaryScript']>[0]
export async function approveEmptyIntermediaryMonth(
  db: Kysely<DB>,
  vou: VouService,
  businessDate: string,
  submitter: VouActor,
  reviewer: VouActor,
) {
  const books = await db.selectFrom('acc_books').select('id').execute()
  for (const book of books)
    await new AccMappingCatalogService(db).save(
      {
        bookId: book.id,
        vouEntity: 'intermediary-calculation',
        expectedRevision: null,
        defaultResult: 'UN_POST',
        definition: {
          defaultTemplateId: null,
          rules: [],
          templates: [],
          assetConfiguration: null,
        },
      },
      {
        ...submitter,
        permissions: [...submitter.permissions, '/acc/mapping/save'],
      },
    )
  const current = await vou.getIntermediaryScript(submitter)
  const script = await vou.saveIntermediaryScript(
    {
      expectedRevision: current?.revision ?? null,
      name: '空来源月度计算',
      source: 'globalThis.calculate = () => ({lines:[], summaries:[]})',
    },
    submitter,
  )
  const source = await vou.getIntermediarySource(businessDate, submitter)
  assert.deepEqual(source.source.lines, [])
  assert.deepEqual(source.source.bills, [])
  const id = ulid()
  const pending = await vou.submit(
    'intermediary-calculation',
    'submit-new',
    {
      documentId: ulid(),
      submissionId: id,
      idempotencyKey: id,
      expectedRevision: null,
      payload: {
        businessDate,
        currency: 'CNY',
        remark: '月度结账前置计算',
        attachments: [],
        intermediaryCalculation: {
          ...source,
          script,
          result: { lines: [], summaries: [] },
        },
      },
    },
    submitter,
    'empty-month',
  )
  return vou.review(
    'intermediary-calculation',
    'approve',
    {
      documentId: pending.documentId,
      submissionId: id,
      expectedRevision: pending.revision,
    },
    reviewer,
    'empty-month',
  )
}
