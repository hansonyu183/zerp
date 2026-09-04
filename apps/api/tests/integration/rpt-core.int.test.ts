import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'

import { createDatabase } from '../../src/db/database.ts'
import { RptService } from '../../src/rpt/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('RPT executes only latest approved enabled valid definition and enforces columns', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const service = new RptService(db)
  const actorId = ulid(), subjectId = ulid(), entryId = ulid()
  const actor = { id: actorId, permissions: ['/rpt/rpt-900001/query'], trusted: false }
  context.after(async () => {
    try {
      await db.deleteFrom('rpt_execution_audits').where('definition_subject_id', '=', subjectId).execute()
      await db.deleteFrom('approval_events').where('entity', '=', 'rpt-definition').where('subject_id', '=', subjectId).execute()
      await db.deleteFrom('approval_entries').where('id', '=', entryId).execute()
      await db.deleteFrom('dcl_subjects').where('id', '=', subjectId).execute()
      await db.deleteFrom('app_users').where('id', '=', actorId).execute()
    } finally { await db.destroy() }
  })
  const now = new Date()
  await db.insertInto('app_users').values({
    id: actorId, username: `rpt-${actorId}`, display_name: 'RPT actor', password_hash: 'unused',
    status: 'ENABLED', password_changed_at: now, password_change_required: false,
  }).execute()
  await db.insertInto('dcl_subjects').values({ id: subjectId, entity: 'rpt-definition', code: 'rpt-900001', created_at: now, created_by: actorId }).execute()
  await db.insertInto('approval_entries').values({
    id: entryId, domain: 'dcl', entity: 'rpt-definition', subject_id: subjectId,
    version_no: 1, status: 'APPROVED', revision: 2, submitted_by: actorId, submitted_at: now,
    approved_by: actorId, approved_at: now, updated_by: actorId, updated_at: now,
  }).execute()
  await db.insertInto('dcl_rpt_definition_versions').values({
    approval_entry_id: entryId, name: '会计月份', description: '', enabled: true,
    sql_text: "SELECT period_month AS month, locked FROM acc_periods ORDER BY period_month",
    parameters: '[]', columns: JSON.stringify([
      { alias: 'month', label: '月份', order: 1, type: 'TEXT', width: 120, visible: true, format: '' },
      { alias: 'locked', label: '已锁定', order: 2, type: 'BOOLEAN', width: 80, visible: true, format: '' },
    ]),
  }).execute()
  await db.insertInto('rpt_definition_validities').values({
    approval_entry_id: entryId, status: 'VALID', diagnostic: null, validated_at: now, validated_by: actorId,
  }).execute()
  await service.assertAllEnabled()
  const result = await service.query('rpt-900001', { parameters: {}, page: 1, pageSize: 100 }, actor, 'rpt-query')
  assert.deepEqual(result.columns.map((column) => column.alias), ['month', 'locked'])
  assert.equal(Array.isArray(result.rows), true)
  assert.equal((await db.selectFrom('rpt_execution_audits').select('id').where('definition_subject_id', '=', subjectId).execute()).length, 1)
})
