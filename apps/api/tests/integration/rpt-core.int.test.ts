import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { serve } from '@hono/node-server'
import { argon2idAsync } from '@noble/hashes/argon2.js'
import { modelBuildId } from '@zerp/model'
import pg from 'pg'
import { ulid } from 'ulid'

import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'
import {
  PgRptDefinitionValidator,
  RptApplicationError,
  RptService,
  type RptDefinition,
} from '../../src/rpt/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = Buffer.from(
    await argon2idAsync(password, salt, {
      m: 64 * 1024,
      t: 3,
      p: 2,
      dkLen: 32,
    }),
  ).toString('base64url')
  return `$argon2id$v=19$m=65536,t=3,p=2$${salt.toString('base64url')}$${hash}`
}

test('RPT validation rejects incomplete ENUM and REFERENCE parameter contracts before preparing SQL', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const validationPool = new pg.Pool({ connectionString: databaseUrl })
  context.after(async () => {
    await validationPool.end()
    await db.destroy()
  })
  const validator = new PgRptDefinitionValidator(validationPool, db)
  const base: Omit<RptDefinition, 'parameters'> = {
    subjectId: ulid(),
    approvalEntryId: ulid(),
    code: 'rpt-900000',
    name: '参数契约',
    sql: 'SELECT :value AS value WHERE false',
    columns: [
      {
        alias: 'value',
        name: '值',
        order: 1,
        type: 'TEXT',
        width: 120,
        visible: true,
        format: '',
      },
    ],
  }
  for (const parameter of [
    { key: 'value', name: '状态', type: 'ENUM', required: true },
    { key: 'value', name: '客户', type: 'REFERENCE', required: true },
  ] as const) {
    await assert.rejects(
      validator.validate({ ...base, parameters: [parameter] }),
      (error: unknown) =>
        error instanceof RptApplicationError &&
        error.errorKey === 'rpt_parameter_contract_mismatch',
    )
  }
})

test('RPT executes only latest approved enabled valid definition and enforces columns', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const validationPool = new pg.Pool({ connectionString: databaseUrl })
  const service = new RptService(
    db,
    new PgRptDefinitionValidator(validationPool, db),
  )
  const actorId = ulid(),
    subjectId = ulid(),
    entryId = ulid(),
    roleId = ulid(),
    permissionId = ulid(),
    bookId = ulid()
  const username = `rpt-${randomBytes(5).toString('hex')}`
  const password = randomBytes(18).toString('base64url')
  context.after(async () => {
    try {
      await db
        .deleteFrom('rpt_execution_audits')
        .where('definition_subject_id', '=', subjectId)
        .execute()
      await db
        .deleteFrom('app_sessions')
        .where('user_id', '=', actorId)
        .execute()
      await db
        .deleteFrom('app_user_roles')
        .where('user_id', '=', actorId)
        .execute()
      await db
        .deleteFrom('app_role_permissions')
        .where('role_id', '=', roleId)
        .execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
      await db
        .deleteFrom('app_permissions')
        .where('id', '=', permissionId)
        .execute()
      await db.deleteFrom('acc_periods').where('book_id', '=', bookId).execute()
      await db.deleteFrom('acc_books').where('id', '=', bookId).execute()
      await db
        .deleteFrom('approval_events')
        .where('entity', '=', 'rpt-definition')
        .where('subject_id', '=', subjectId)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', '=', entryId)
        .execute()
      await db.deleteFrom('dcl_subjects').where('id', '=', subjectId).execute()
      await db.deleteFrom('app_users').where('id', '=', actorId).execute()
    } finally {
      await validationPool.end()
      await db.destroy()
    }
  })
  const now = new Date()
  await db
    .insertInto('app_users')
    .values({
      id: actorId,
      username,
      display_name: 'RPT actor',
      password_hash: await passwordHash(password),
      status: 'ENABLED',
      password_changed_at: now,
      password_change_required: false,
    })
    .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: username,
      name: 'RPT actor',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_permissions')
    .values({
      id: permissionId,
      path: '/rpt/rpt-900001/query',
      domain: 'rpt',
      entity: 'rpt-900001',
      action: 'query',
      description: '会计月份',
      status: 'ENABLED',
      created_by: actorId,
      updated_by: actorId,
    })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values({ role_id: roleId, permission_id: permissionId })
    .execute()
  await db
    .insertInto('app_user_roles')
    .values({ user_id: actorId, role_id: roleId })
    .execute()
  await db
    .insertInto('acc_books')
    .values({
      id: bookId,
      code: 'ACC-9001',
      name: 'RPT 测试账簿',
      description: '',
      start_month: '2026-01',
      base_currency: 'CNY',
      control_book: false,
      created_at: now,
      created_by: actorId,
      updated_at: now,
      updated_by: actorId,
    })
    .execute()
  await db
    .insertInto('acc_periods')
    .values([
      {
        book_id: bookId,
        period_month: '2026-01',
        locked: false,
        revision: 1,
        updated_at: now,
        updated_by: actorId,
      },
      {
        book_id: bookId,
        period_month: '2026-02',
        locked: false,
        revision: 1,
        updated_at: now,
        updated_by: actorId,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values({
      id: subjectId,
      entity: 'rpt-definition',
      code: 'rpt-900001',
      created_at: now,
      created_by: actorId,
    })
    .execute()
  await db
    .insertInto('approval_entries')
    .values({
      id: entryId,
      domain: 'dcl',
      entity: 'rpt-definition',
      subject_id: subjectId,
      version_no: 1,
      status: 'APPROVED',
      revision: 2,
      submitted_by: actorId,
      submitted_at: now,
      approved_by: actorId,
      approved_at: now,
      updated_by: actorId,
      updated_at: now,
    })
    .execute()
  await db
    .insertInto('dcl_rpt_definition_versions')
    .values({
      approval_entry_id: entryId,
      name: '会计月份',
      description: '',
      enabled: true,
      sql_text:
        'SELECT period_month AS month, locked FROM acc_periods WHERE :bookId::varchar IS NOT NULL ORDER BY period_month',
      parameters: JSON.stringify([
        {
          key: 'bookId',
          name: '账簿',
          type: 'REFERENCE',
          required: true,
          referenceType: 'ACCOUNTING_BOOK',
        },
      ]),
      columns: JSON.stringify([
        {
          alias: 'month',
          name: '月份',
          order: 1,
          type: 'TEXT',
          width: 120,
          visible: true,
          format: '',
        },
        {
          alias: 'locked',
          name: '已锁定',
          order: 2,
          type: 'BOOLEAN',
          width: 80,
          visible: true,
          format: '',
        },
      ]),
    })
    .execute()
  await db
    .insertInto('rpt_definition_validities')
    .values({
      approval_entry_id: entryId,
      status: 'VALID',
      diagnostic: null,
      validated_at: now,
      validated_by: actorId,
    })
    .execute()
  await service.assertAllEnabled()
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    session: new SessionService(db, config),
    rpt: service,
    config,
  })
  let listening: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    listening = resolve
  })
  const server = serve(
    { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
    () => listening?.(),
  )
  context.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })
  await started
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const signin = await fetch(`${origin}/app/user/signin`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      connection: 'close',
    },
    body: JSON.stringify({ username, password }),
  })
  const signedIn = await signin.json()
  assert.equal(signedIn.code, 0)
  const response = await fetch(`${origin}/rpt/rpt-900001/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': signedIn.data.csrfToken,
      cookie: signin.headers.getSetCookie()[0]!,
      connection: 'close',
    },
    body: JSON.stringify({ parameters: { bookId }, page: 1, pageSize: 1 }),
  })
  const envelope = await response.json()
  assert.equal(envelope.code, 0, JSON.stringify(envelope))
  assert.deepEqual(
    envelope.data.columns.map((column: { alias: string }) => column.alias),
    ['month', 'locked'],
  )
  assert.equal(envelope.data.rows.length, 1)
  assert.equal(envelope.data.hasMore, true)
  const secondPageResponse = await fetch(`${origin}/rpt/rpt-900001/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': signedIn.data.csrfToken,
      cookie: signin.headers.getSetCookie()[0]!,
      connection: 'close',
    },
    body: JSON.stringify({ parameters: { bookId }, page: 2, pageSize: 1 }),
  })
  const secondPageEnvelope = await secondPageResponse.json()
  assert.equal(secondPageEnvelope.code, 0, JSON.stringify(secondPageEnvelope))
  assert.equal(secondPageEnvelope.data.rows.length, 1)
  assert.equal(secondPageEnvelope.data.hasMore, false)
  const candidates = await fetch(`${origin}/rpt/rpt-900001/reference-query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': signedIn.data.csrfToken,
      cookie: signin.headers.getSetCookie()[0]!,
      connection: 'close',
    },
    body: JSON.stringify({ parameterKey: 'bookId', selectedId: bookId }),
  })
  const candidateEnvelope = await candidates.json()
  assert.equal(candidateEnvelope.code, 0)
  assert.deepEqual(
    candidateEnvelope.data.items.map((item: { id: string }) => item.id),
    [bookId],
  )
  assert.equal(
    (
      await db
        .selectFrom('rpt_execution_audits')
        .select('id')
        .where('definition_subject_id', '=', subjectId)
        .execute()
    ).length,
    2,
  )
})

test('RPT readiness rejects latest enabled VALID definitions whose zero-row metadata breaks column names or types', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl),
    validationPool = new pg.Pool({ connectionString: databaseUrl })
  const service = new RptService(
    db,
    new PgRptDefinitionValidator(validationPool, db),
  )
  const actorId = ulid(),
    subjectIds = [ulid(), ulid(), ulid()],
    entryIds = [ulid(), ulid(), ulid(), ulid()],
    now = new Date()
  context.after(async () => {
    try {
      await db
        .deleteFrom('rpt_definition_validities')
        .where('approval_entry_id', 'in', entryIds)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', entryIds)
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', 'in', subjectIds)
        .execute()
      await db.deleteFrom('app_users').where('id', '=', actorId).execute()
    } finally {
      await validationPool.end()
      await db.destroy()
    }
  })
  await db
    .insertInto('app_users')
    .values({
      id: actorId,
      username: `rpt-readiness-${actorId}`,
      display_name: 'RPT readiness actor',
      password_hash: 'unused',
      status: 'ENABLED',
      password_changed_at: now,
      password_change_required: false,
    })
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values(
      subjectIds.map((id, index) => ({
        id,
        entity: 'rpt-definition',
        code: `rpt-90000${index + 2}`,
        created_at: now,
        created_by: actorId,
      })),
    )
    .execute()
  const entrySubjectIds = [
    subjectIds[0]!,
    subjectIds[0]!,
    subjectIds[1]!,
    subjectIds[2]!,
  ]
  await db
    .insertInto('approval_entries')
    .values(
      entryIds.map((id, index) => ({
        id,
        domain: 'dcl',
        entity: 'rpt-definition',
        subject_id: entrySubjectIds[index]!,
        version_no: index === 1 ? 2 : 1,
        status: 'APPROVED' as const,
        revision: 2,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: actorId,
        approved_at: now,
        updated_by: actorId,
        updated_at: now,
      })),
    )
    .execute()
  await db
    .insertInto('dcl_rpt_definition_versions')
    .values([
      {
        approval_entry_id: entryIds[0]!,
        name: '被新版替代的兼容版本',
        description: '',
        enabled: true,
        sql_text: 'SELECT 1::integer AS reported_total WHERE false',
        parameters: '[]',
        columns: JSON.stringify([
          {
            alias: 'reported_total',
            name: '总数',
            order: 1,
            type: 'INTEGER',
            width: 120,
            visible: true,
            format: '',
          },
        ]),
      },
      {
        approval_entry_id: entryIds[1]!,
        name: '零行列名失配',
        description: '',
        enabled: true,
        sql_text: 'SELECT 1::integer AS actual_total WHERE false',
        parameters: '[]',
        columns: JSON.stringify([
          {
            alias: 'reported_total',
            name: '总数',
            order: 1,
            type: 'INTEGER',
            width: 120,
            visible: true,
            format: '',
          },
        ]),
      },
      {
        approval_entry_id: entryIds[2]!,
        name: '零行类型失配',
        description: '',
        enabled: true,
        sql_text: 'SELECT 1::integer AS total WHERE false',
        parameters: '[]',
        columns: JSON.stringify([
          {
            alias: 'total',
            name: '总数',
            order: 1,
            type: 'TEXT',
            width: 120,
            visible: true,
            format: '',
          },
        ]),
      },
      {
        approval_entry_id: entryIds[3]!,
        name: '全部类型化参数',
        description: '',
        enabled: true,
        sql_text:
          'SELECT :text_value AS text_value, :integer_value AS integer_value, :decimal_value AS decimal_value, :boolean_value AS boolean_value, :date_value AS date_value, :date_range[1] AS range_start, :enum_value AS enum_value, :reference_value AS reference_value WHERE false',
        parameters: JSON.stringify([
          { key: 'text_value', name: '文本', type: 'TEXT', required: true },
          {
            key: 'integer_value',
            name: '整数',
            type: 'INTEGER',
            required: true,
          },
          {
            key: 'decimal_value',
            name: '小数',
            type: 'DECIMAL',
            required: true,
          },
          {
            key: 'boolean_value',
            name: '布尔',
            type: 'BOOLEAN',
            required: true,
          },
          { key: 'date_value', name: '日期', type: 'DATE', required: true },
          {
            key: 'date_range',
            name: '日期范围',
            type: 'DATE_RANGE',
            required: true,
          },
          {
            key: 'enum_value',
            name: '枚举',
            type: 'ENUM',
            required: true,
            enumValues: ['OPEN'],
          },
          {
            key: 'reference_value',
            name: '引用',
            type: 'REFERENCE',
            required: true,
            referenceType: 'CUSTOMER_SUBUNIT',
          },
        ]),
        columns: JSON.stringify([
          {
            alias: 'text_value',
            name: '文本',
            order: 1,
            type: 'TEXT',
            width: 120,
            visible: true,
            format: '',
          },
          {
            alias: 'integer_value',
            name: '整数',
            order: 2,
            type: 'INTEGER',
            width: 120,
            visible: true,
            format: '',
          },
          {
            alias: 'decimal_value',
            name: '小数',
            order: 3,
            type: 'DECIMAL',
            width: 120,
            visible: true,
            format: '',
          },
          {
            alias: 'boolean_value',
            name: '布尔',
            order: 4,
            type: 'BOOLEAN',
            width: 120,
            visible: true,
            format: '',
          },
          {
            alias: 'date_value',
            name: '日期',
            order: 5,
            type: 'DATE',
            width: 120,
            visible: true,
            format: '',
          },
          {
            alias: 'range_start',
            name: '范围开始',
            order: 6,
            type: 'DATE',
            width: 120,
            visible: true,
            format: '',
          },
          {
            alias: 'enum_value',
            name: '枚举',
            order: 7,
            type: 'TEXT',
            width: 120,
            visible: true,
            format: '',
          },
          {
            alias: 'reference_value',
            name: '引用',
            order: 8,
            type: 'TEXT',
            width: 120,
            visible: true,
            format: '',
          },
        ]),
      },
    ])
    .execute()
  await db
    .insertInto('rpt_definition_validities')
    .values(
      entryIds.map((approval_entry_id) => ({
        approval_entry_id,
        status: 'VALID',
        diagnostic: null,
        validated_at: now,
        validated_by: actorId,
      })),
    )
    .execute()
  await assert.rejects(
    service.assertAllEnabled(),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('rpt-900002') &&
      error.message.includes('rpt_result_columns_mismatch') &&
      error.message.includes('rpt-900003') &&
      error.message.includes('rpt_result_column_type_mismatch'),
  )
})
