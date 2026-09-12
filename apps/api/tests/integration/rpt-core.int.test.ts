import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { sql } from 'kysely'
import pg from 'pg'
import { ulid } from 'ulid'
import { randomBytes } from 'node:crypto'
import { modelBuildId } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { AuxService } from '../../src/aux/service.ts'
import { SessionService, hashPassword } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { createDatabase } from '../../src/db/database.ts'
import {
  PgRptDefinitionValidator,
  RptApplicationError,
  RptService,
  type RptDefinition,
} from '../../src/rpt/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
const totalColumn = {
  alias: 'total',
  name: '总数',
  order: 1,
  type: 'INTEGER' as const,
  width: 120,
  visible: true,
}
const isError = (key: string) => (error: unknown) =>
  error instanceof RptApplicationError && error.errorKey === key

async function fixture(context: TestContext) {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl),
    pool = new pg.Pool({ connectionString: databaseUrl })
  const actorId = ulid(),
    roleId = ulid(),
    ids: string[] = []
  const service = new RptService(db, new PgRptDefinitionValidator(pool, db))
  await db
    .insertInto('app_users')
    .values({
      id: actorId,
      username: `rpt-${actorId}`,
      display_name: '报表测试',
      py: 'bbcs',
      password_hash: 'unused',
      status: 'ENABLED',
      password_changed_at: new Date(),
      password_change_required: false,
    })
    .execute()
  context.after(async () => {
    try {
      await db.transaction().execute(async (tx) => {
        if (ids.length) {
          const definitions = await tx
            .selectFrom('rpt_definitions')
            .select(['code'])
            .where('id', 'in', ids)
            .execute()
          const codes = definitions.map((row) => row.code)
          if (codes.length) {
            await tx
              .deleteFrom('app_role_permissions')
              .where(
                'permission_id',
                'in',
                tx
                  .selectFrom('app_permissions')
                  .select('id')
                  .where('domain', '=', 'rpt')
                  .where('entity', 'in', codes),
              )
              .execute()
            await tx
              .deleteFrom('app_permissions')
              .where('domain', '=', 'rpt')
              .where('entity', 'in', codes)
              .execute()
          }
          await tx
            .deleteFrom('rpt_execution_audits')
            .where('definition_subject_id', 'in', ids)
            .execute()
          await tx
            .deleteFrom('rpt_definition_audits')
            .where('definition_id', 'in', ids)
            .execute()
          await tx
            .deleteFrom('rpt_definitions')
            .where('id', 'in', ids)
            .execute()
        }
        await tx
          .deleteFrom('app_sessions')
          .where('user_id', '=', actorId)
          .execute()
        await tx
          .deleteFrom('app_user_roles')
          .where('user_id', '=', actorId)
          .execute()
        await tx
          .deleteFrom('app_role_permissions')
          .where('role_id', '=', roleId)
          .execute()
        await tx.deleteFrom('app_roles').where('id', '=', roleId).execute()
        await tx
          .deleteFrom('aux_objects')
          .where('created_by', '=', actorId)
          .execute()
        await tx.deleteFrom('app_users').where('id', '=', actorId).execute()
      })
    } finally {
      await pool.end()
      await db.destroy()
    }
  })
  const actor = {
    id: actorId,
    permissions: ['/rpt/definition/get', '/rpt/definition/save'],
  }
  const input = () => {
    const subjectId = ulid()
    ids.push(subjectId)
    return {
      subjectId,
      expectedRevision: null as string | null,
      name: '报表测试',
      description: '',
      enabled: true,
      sql: 'SELECT 1::integer AS total',
      parameters: [],
      columns: [totalColumn],
    }
  }
  return { db, pool, service, actor, input, roleId }
}

test('RPT save validates current configuration, rejects stale edits and keeps execution separate from maintenance', async (context) => {
  const { service, actor, input } = await fixture(context)
  const command = input()
  const current = await service.save(command, actor, 'create-current')
  assert.equal(current.revision, '1')
  assert.equal(current.validity, 'VALID')
  assert.equal('approvalEntryId' in current, false)
  const reader = { id: actor.id, permissions: [`/rpt/${current.code}/query`] }
  assert.deepEqual(
    (await service.directory(reader)).map((row) => row.code),
    [current.code],
  )
  assert.deepEqual(
    await service.directory({ id: actor.id, permissions: [] }),
    [],
  )
  await assert.rejects(
    service.get(current.subjectId, reader),
    isError('rpt_permission_denied'),
  )
  await assert.rejects(
    service.save({ ...command, expectedRevision: '1' }, reader, 'denied-save'),
    isError('rpt_permission_denied'),
  )
  await assert.rejects(
    service.export(current.code, {}, reader, 'denied-export'),
    isError('rpt_permission_denied'),
  )
  assert.deepEqual(
    (
      await service.query(
        current.code,
        { parameters: {}, page: 1, pageSize: 10 },
        reader,
        'query-current',
      )
    ).rows,
    [{ total: 1 }],
  )
  await assert.rejects(
    service.save(
      {
        ...command,
        expectedRevision: '1',
        sql: 'SELECT absent_column FROM absent_table',
      },
      actor,
      'invalid-save',
    ),
    isError('rpt_definition_invalid_data'),
  )
  assert.equal((await service.get(current.subjectId, actor)).revision, '1')
  const updated = await service.save(
    { ...command, expectedRevision: '1', sql: 'SELECT 2::integer AS total' },
    actor,
    'update-current',
  )
  assert.equal(updated.subjectId, current.subjectId)
  assert.equal(updated.code, current.code)
  assert.equal(updated.revision, '2')
  await assert.rejects(
    service.save({ ...command, expectedRevision: '1' }, actor, 'stale-save'),
    isError('rpt_revision_conflict'),
  )
  assert.deepEqual(
    (
      await service.query(
        current.code,
        { parameters: {}, page: 1, pageSize: 10 },
        reader,
        'updated-query',
      )
    ).rows,
    [{ total: 2 }],
  )
})

test('RPT binds multiple parameters, preserves decimal/false/zero and reuses the column contract for export', async (context) => {
  const { service, actor, input } = await fixture(context)
  const command = {
    ...input(),
    sql: 'SELECT n::integer AS total, :name::text AS name, :amount::numeric AS amount, :flag::boolean AS flag FROM generate_series(1,3) n WHERE n >= :minimum::integer ORDER BY n',
    parameters: [
      { key: 'name', name: '名称', type: 'TEXT' as const, required: true },
      { key: 'amount', name: '金额', type: 'DECIMAL' as const, required: true },
      { key: 'flag', name: '标记', type: 'BOOLEAN' as const, required: true },
      {
        key: 'minimum',
        name: '最小值',
        type: 'INTEGER' as const,
        required: true,
      },
    ],
    columns: [
      totalColumn,
      {
        alias: 'name',
        name: '名称',
        order: 2,
        type: 'TEXT' as const,
        width: 120,
        visible: true,
      },
      {
        alias: 'amount',
        name: '金额',
        order: 3,
        type: 'DECIMAL' as const,
        width: 120,
        visible: true,
      },
      {
        alias: 'flag',
        name: '标记',
        order: 4,
        type: 'BOOLEAN' as const,
        width: 80,
        visible: true,
      },
    ],
  }
  const current = await service.save(command, actor, 'multi-save')
  const reader = {
    id: actor.id,
    permissions: [`/rpt/${current.code}/query`, `/rpt/${current.code}/export`],
  }
  const parameters = {
    name: "历史客户子单位 ' OR true --",
    amount: '9007199254740993.00',
    flag: false,
    minimum: 0,
  }
  const first = await service.query(
    current.code,
    { parameters, page: 1, pageSize: 2 },
    reader,
    'multi-first',
  )
  assert.equal(first.hasMore, true)
  assert.deepEqual(first.rows, [
    {
      total: 1,
      name: parameters.name,
      amount: '9007199254740993.00',
      flag: false,
    },
    {
      total: 2,
      name: parameters.name,
      amount: '9007199254740993.00',
      flag: false,
    },
  ])
  const second = await service.query(
    current.code,
    { parameters, page: 2, pageSize: 2 },
    reader,
    'multi-second',
  )
  assert.equal(second.hasMore, false)
  assert.deepEqual(
    second.rows.map((row) => row.total),
    [3],
  )
  const exported = await service.export(
    current.code,
    parameters,
    reader,
    'multi-export',
  )
  assert.deepEqual(exported.rows, [...first.rows, ...second.rows])
  assert.deepEqual(exported.columns, first.columns)
  await assert.rejects(
    service.query(
      current.code,
      { parameters: { ...parameters, other: 1 }, page: 1, pageSize: 1 },
      reader,
      'extra',
    ),
    isError('rpt_parameter_unknown'),
  )
  const exporter = {
    id: actor.id,
    permissions: [`/rpt/${current.code}/export`],
  }
  assert.equal((await service.directory(exporter)).length, 1)
  await assert.rejects(
    service.query(
      current.code,
      { parameters, page: 1, pageSize: 1 },
      exporter,
      'no-query',
    ),
    isError('rpt_permission_denied'),
  )
})

test('RPT rejects zero-row column mismatches and incomplete enum/reference declarations', async (context) => {
  const { service, actor, input, pool, db } = await fixture(context)
  const command = input()
  await assert.rejects(
    service.save(
      { ...command, sql: 'SELECT 1::integer AS wrong_alias WHERE false' },
      actor,
      'wrong-name',
    ),
    isError('rpt_definition_invalid_data'),
  )
  await assert.rejects(
    service.save(
      { ...command, sql: "SELECT '1'::text AS total WHERE false" },
      actor,
      'wrong-type',
    ),
    isError('rpt_definition_invalid_data'),
  )
  const validator = new PgRptDefinitionValidator(pool, db)
  for (const type of ['ENUM', 'REFERENCE'] as const) {
    const definition: RptDefinition = {
      subjectId: command.subjectId,
      revision: '1',
      code: 'rpt-900000',
      name: '非法参数',
      sql: 'SELECT :value AS value WHERE false',
      parameters: [{ key: 'value', name: '值', type, required: true }],
      columns: [{ ...totalColumn, alias: 'value', type: 'TEXT' }],
    }
    await assert.rejects(
      validator.validate(definition),
      isError('rpt_parameter_contract_mismatch'),
    )
  }
})

test('RPT deterministic schema drift stops current execution; a validated correction restores the same identity', async (context) => {
  const { service, actor, input, db } = await fixture(context)
  const table = `rpt_test_${ulid().toLowerCase()}`
  await sql.raw(`CREATE TABLE ${table}(old_total integer)`).execute(db)
  context.after(async () => {
    const cleanup = createDatabase(databaseUrl!)
    try {
      await sql.raw(`DROP TABLE ${table}`).execute(cleanup)
    } finally {
      await cleanup.destroy()
    }
  })
  const command = { ...input(), sql: `SELECT old_total AS total FROM ${table}` }
  const current = await service.save(command, actor, 'drift-create')
  const reader = { id: actor.id, permissions: [`/rpt/${current.code}/query`] }
  await sql
    .raw(`ALTER TABLE ${table} RENAME COLUMN old_total TO new_total`)
    .execute(db)
  await assert.rejects(
    service.referenceQuery(current.code, {
      parameterKey: 'department',
      page: 1,
      pageSize: 20,
    }),
    isError('rpt_definition_not_executable'),
  )
  assert.equal(
    (await service.get(current.subjectId, actor)).validity,
    'VALID',
    'auxiliary read must not invalidate the definition',
  )
  await assert.rejects(
    service.query(
      current.code,
      { parameters: {}, page: 1, pageSize: 10 },
      reader,
      'drift-query',
    ),
    isError('rpt_definition_not_executable'),
  )
  assert.equal(
    (await service.get(current.subjectId, actor)).validity,
    'INVALID',
  )
  assert.deepEqual(await service.directory(reader), [])
  const repaired = await service.save(
    {
      ...command,
      expectedRevision: '1',
      sql: `SELECT new_total AS total FROM ${table}`,
    },
    actor,
    'drift-repair',
  )
  assert.equal(repaired.revision, '2')
  assert.equal(repaired.validity, 'VALID')
  assert.deepEqual(
    (
      await service.query(
        current.code,
        { parameters: {}, page: 1, pageSize: 10 },
        reader,
        'repaired-query',
      )
    ).rows,
    [],
  )
})

test('RPT HTTP uses current contracts and exact grants; removed DCL routes are absent', async (context) => {
  const { db, service, actor, input, roleId } = await fixture(context)
  const password = randomBytes(18).toString('base64url')
  await db
    .updateTable('app_users')
    .set({ password_hash: await hashPassword(password) })
    .where('id', '=', actor.id)
    .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `rpt-http-${roleId}`,
      name: '报表 HTTP 测试',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_user_roles')
    .values({ user_id: actor.id, role_id: roleId })
    .execute()
  const grant = async (paths: string[]) => {
    await db
      .deleteFrom('app_role_permissions')
      .where('role_id', '=', roleId)
      .execute()
    const permissions = await db
      .selectFrom('app_permissions')
      .select('id')
      .where('path', 'in', paths)
      .execute()
    assert.equal(permissions.length, paths.length)
    await db
      .insertInto('app_role_permissions')
      .values(
        permissions.map((permission) => ({
          role_id: roleId,
          permission_id: permission.id,
        })),
      )
      .execute()
  }
  await grant(['/rpt/definition/save', '/rpt/definition/get'])
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    rpt: service,
  })
  const signin = await app.request('/session/auth/signin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
    },
    body: JSON.stringify({ code: `rpt-${actor.id}`, password }),
  })
  const auth = await signin.json()
  assert.equal(auth.code, 0)
  const headers = {
    'content-type': 'application/json',
    'x-zerp-model-build': modelBuildId,
    'x-csrf-token': auth.data.csrfToken,
    cookie: signin.headers.getSetCookie()[0]!,
  }
  const post = async (path: string, body: unknown) =>
    (
      await app.request(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    ).json()
  const command = input()
  const saved = await post('/rpt/definition/save', command)
  assert.equal(saved.code, 0)
  assert.equal(saved.data.revision, '1')
  assert.equal('approvalEntryId' in saved.data, false)
  await grant([`/rpt/${saved.data.code}/query`])
  const directory = await (
    await app.request('/rpt/directory/options', {
      headers: { cookie: headers.cookie, 'x-zerp-model-build': modelBuildId },
    })
  ).json()
  assert.equal(directory.code, 0)
  assert.deepEqual(
    directory.data.map((item: { code: string }) => item.code),
    [saved.data.code],
  )
  const queried = await post(`/rpt/${saved.data.code}/query`, {
    parameters: {},
    page: 1,
    pageSize: 20,
  })
  assert.equal(queried.code, 0)
  assert.deepEqual(queried.data.rows, [{ total: 1 }])
  assert.equal(
    (await post('/rpt/definition/get', { subjectId: command.subjectId }))
      .errorKey,
    'rpt_permission_denied',
  )
  assert.equal(
    (await post('/rpt/definition/save', { ...command, expectedRevision: '1' }))
      .errorKey,
    'rpt_permission_denied',
  )
  assert.equal(
    (await post(`/rpt/${saved.data.code}/export`, { parameters: {} })).errorKey,
    'rpt_permission_denied',
  )
  for (const action of [
    'get',
    'query',
    'submit-new',
    'submit-change',
    'approve',
    'reject',
    'unreject',
    'unapprove',
    'delete',
    'versions',
  ]) {
    const response = await app.request(`/dcl/rpt-definition/${action}`, {
      method: 'POST',
      headers,
      body: '{}',
    })
    assert.equal(response.status, 404)
  }
})

test('RPT user parameter errors and export limits never invalidate a valid definition', async (context) => {
  const { service, actor, input } = await fixture(context)
  const command = {
    ...input(),
    sql: 'SELECT n::integer AS total FROM generate_series(1,100001) n',
  }
  const current = await service.save(command, actor, 'large-report')
  const exporter = {
    id: actor.id,
    permissions: [`/rpt/${current.code}/export`],
  }
  await assert.rejects(
    service.export(current.code, {}, exporter, 'too-large'),
    isError('rpt_export_limit_exceeded'),
  )
  assert.equal((await service.get(current.subjectId, actor)).validity, 'VALID')
  assert.equal((await service.directory(exporter)).length, 1)
})

test('RPT date and datetime results have stable wire values and enum captions are validated', async (context) => {
  const { service, actor, input } = await fixture(context)
  const current = await service.save(
    {
      ...input(),
      sql: "SELECT (:dates::date[])[1] AS report_date, TIMESTAMPTZ '2026-09-07 08:00:00+08' AS report_time, :status::text AS report_status",
      parameters: [
        { key: 'dates', name: '日期范围', type: 'DATE_RANGE', required: true },
        {
          key: 'status',
          name: '状态',
          type: 'ENUM',
          required: true,
          enumValues: ['OPEN', 'CLOSED'],
          enumCaptions: { OPEN: '开放', CLOSED: '关闭' },
        },
      ],
      columns: [
        { ...totalColumn, alias: 'report_date', type: 'DATE' },
        { ...totalColumn, alias: 'report_time', type: 'DATETIME', order: 2 },
        { ...totalColumn, alias: 'report_status', type: 'TEXT', order: 3 },
      ],
    },
    actor,
    'date-save',
  )
  const reader = { id: actor.id, permissions: [`/rpt/${current.code}/query`] }
  const result = await service.query(
    current.code,
    {
      parameters: { dates: ['2026-09-01', '2026-09-30'], status: 'OPEN' },
      page: 1,
      pageSize: 20,
    },
    reader,
    'date-query',
  )
  assert.deepEqual(result.rows, [
    {
      report_date: '2026-09-01',
      report_time: '2026-09-07T00:00:00.000Z',
      report_status: 'OPEN',
    },
  ])
})

test('RPT readiness remains unavailable for an INVALID current definition until validated save', async (context) => {
  const { service, actor, input, db } = await fixture(context)
  const command = input(),
    current = await service.save(command, actor, 'readiness-create')
  await db
    .updateTable('rpt_definitions')
    .set({ validity: 'INVALID' })
    .where('id', '=', current.subjectId)
    .execute()
  await assert.rejects(
    service.assertAllEnabled(),
    (error) =>
      error instanceof RptApplicationError &&
      error.errorKey.startsWith('rpt_validation_failed:'),
  )
  await service.save(
    { ...command, expectedRevision: current.revision },
    actor,
    'readiness-repair',
  )
  await service.assertAllEnabled()
})

test('RPT auxiliary HTTP reads need only Session, paginate controlled candidates and resolve a later selected identity', async (context) => {
  const { db, service, actor, input } = await fixture(context)
  const aux = new AuxService(db)
  const suffix = randomBytes(6).toString('hex')
  const departments = []
  for (let index = 0; index < 205; index++) {
    departments.push(
      await aux.create(
        'department',
        {
          name: `RPT${suffix}-${String(index).padStart(3, '0')}`,
          parentId: '',
          description: '',
        },
        { id: actor.id, permissions: ['/aux/department/create'] },
      ),
    )
  }
  const command = {
    ...input(),
    sql: "SELECT count(*)::integer AS total FROM aux_objects WHERE entity = 'department' AND (:department::varchar IS NULL OR id = :department)",
    parameters: [
      {
        key: 'department',
        name: '部门',
        type: 'REFERENCE' as const,
        referenceType: 'DEPARTMENT' as const,
        required: false,
      },
    ],
  }
  const definition = await service.save(command, actor, 'rpt-get-create')
  const password = randomBytes(18).toString('base64url')
  await db
    .updateTable('app_users')
    .set({ password_hash: await hashPassword(password) })
    .where('id', '=', actor.id)
    .execute()
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    TARGET_DATABASE_SCOPE: 'isolated',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    rpt: service,
  })
  const signin = await app.request('/session/auth/signin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
    },
    body: JSON.stringify({ code: `rpt-${actor.id}`, password }),
  })
  const auth = await signin.json()
  assert.equal(auth.code, 0)
  const headers = {
    cookie: signin.headers.getSetCookie()[0]!,
    'x-zerp-model-build': modelBuildId,
  }
  const path = `/rpt/${definition.code}/reference-query`
  const get = async (query: string, authenticated = true) =>
    (
      await app.request(`${path}?${query}`, {
        headers: authenticated
          ? headers
          : { 'x-zerp-model-build': modelBuildId },
      })
    ).json()
  assert.equal(
    (await get('parameterKey=department', false)).errorKey,
    'unauthenticated',
  )
  const first = await get(
    `parameterKey=department&keyword=RPT${suffix}&page=1&pageSize=20`,
  )
  assert.equal(first.code, 0)
  assert.equal(first.data.total, 205)
  assert.equal(first.data.items.length, 20)
  assert.deepEqual(Object.keys(first.data.items[0]).sort(), [
    'code',
    'id',
    'name',
  ])
  const later = await get(
    `parameterKey=department&keyword=RPT${suffix}&page=11&pageSize=20`,
  )
  assert.equal(later.code, 0)
  assert.equal(later.data.items.length, 5)
  assert.equal(later.data.items[4].id, departments[204]!.id)
  const selected = await get(
    `parameterKey=department&selectedId=${departments[204]!.id}&page=1&pageSize=20`,
  )
  assert.equal(selected.code, 0)
  assert.deepEqual(selected.data.items, [later.data.items[4]])
  for (const query of [
    'parameterKey=unknown',
    'parameterKey=department&page=0',
    'parameterKey=department&page=1.5',
    'parameterKey=department&page=1e2',
    'parameterKey=department&page=100001',
    'parameterKey=department&pageSize=51',
    'parameterKey=department&page=1&page=2',
    'parameterKey=department&arbitrary=true',
    'page=1',
  ]) {
    const rejected = await get(query)
    assert.notEqual(rejected.code, 0, query)
    assert.ok(
      ['validation_failed', 'rpt_reference_parameter_invalid'].includes(
        rejected.errorKey,
      ),
      query,
    )
    assert.equal(rejected.data, null)
    assert.equal(typeof rejected.requestId, 'string')
  }
  assert.deepEqual(
    (await (await app.request('/rpt/directory/options', { headers })).json())
      .data,
    [],
  )
  const postHeaders = {
    ...headers,
    'content-type': 'application/json',
    'x-csrf-token': auth.data.csrfToken,
  }
  for (const action of ['query', 'export']) {
    const denied = await (
      await app.request(`/rpt/${definition.code}/${action}`, {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify({
          parameters: {},
          ...(action === 'query' ? { page: 1, pageSize: 20 } : {}),
        }),
      })
    ).json()
    assert.equal(denied.errorKey, 'rpt_permission_denied')
  }
  for (const oldPath of [path, '/rpt/directory/query']) {
    const removed = await app.request(oldPath, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify(
        oldPath === path
          ? { parameterKey: 'department', page: 1, pageSize: 20 }
          : {},
      ),
    })
    if (removed.status !== 404) assert.notEqual((await removed.json()).code, 0)
    assert.equal(removed.headers.get('location'), null)
  }
  assert.deepEqual(await service.get(definition.subjectId, actor), definition)
  await service.save(
    { ...command, expectedRevision: '1', enabled: false },
    actor,
    'disable-report',
  )
  assert.equal(
    (await get('parameterKey=department')).errorKey,
    'rpt_definition_not_executable',
  )
})
