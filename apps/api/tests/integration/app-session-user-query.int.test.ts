import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { serve } from '@hono/node-server'
import { argon2idAsync } from '@noble/hashes/argon2.js'

import { createApp } from '../../src/app.ts'
import { ManagementService } from '../../src/app/management.ts'
import { SessionService } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { modelBuildId } from '@zerp/model'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('real HTTP preserves session, CSRF, exact permissions, and PostgreSQL facts', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const suffix = randomBytes(8).toString('hex')
  const id = `T${suffix}`.toUpperCase().padEnd(26, '0')
  const roleId = `R${suffix}`.toUpperCase().padEnd(26, '0')
  const bookId = `B${suffix}`.toUpperCase().padEnd(26, '0')
  const vouEntityId = `V${suffix}`.toUpperCase().padEnd(26, '0')
  const subjectId = `S${suffix}`.toUpperCase().padEnd(26, '0')
  const mappingSubjectId = `M${suffix}`.toUpperCase().padEnd(26, '0')
  const mappingV1Id = `A${suffix}`.toUpperCase().padEnd(26, '0')
  const mappingV2Id = `Z${suffix}`.toUpperCase().padEnd(26, '0')
  const username = `target-${suffix}`
  context.after(async () => {
    try {
      await db
        .deleteFrom('approval_events')
        .where('entry_id', 'in', [mappingV1Id, mappingV2Id])
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', [mappingV1Id, mappingV2Id])
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', '=', mappingSubjectId)
        .execute()
      await db
        .deleteFrom('dcl_acc_subject_facts')
        .where('id', '=', subjectId)
        .execute()
      await db
        .deleteFrom('dcl_acc_vou_entity_facts')
        .where('id', '=', vouEntityId)
        .execute()
      await db
        .deleteFrom('dcl_acc_book_facts')
        .where('id', '=', bookId)
        .execute()
      await db.deleteFrom('app_sessions').where('user_id', '=', id).execute()
      await db.deleteFrom('app_user_roles').where('user_id', '=', id).execute()
      await db
        .deleteFrom('app_role_permissions')
        .where('role_id', '=', roleId)
        .execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
      await db.deleteFrom('app_users').where('id', '=', id).execute()
    } finally {
      await db.destroy()
    }
  })
  const password = randomBytes(20).toString('base64url')
  const salt = randomBytes(16)
  const hash = Buffer.from(
    await argon2idAsync(password, salt, {
      m: 64 * 1024,
      t: 3,
      p: 2,
      dkLen: 32,
    }),
  ).toString('base64url')
  const encoded = `$argon2id$v=19$m=65536,t=3,p=2$${salt.toString('base64url')}$${hash}`
  await db
    .insertInto('app_users')
    .values({
      id,
      username,
      display_name: 'Target integration user',
      password_hash: encoded,
      status: 'ENABLED',
      password_changed_at: new Date(),
      password_change_required: false,
    })
    .execute()
  await db
    .insertInto('dcl_acc_book_facts')
    .values({ id: bookId, code: 'HTTP-BOOK', name: 'HTTP账簿', enabled: true })
    .execute()
  await db
    .insertInto('dcl_acc_vou_entity_facts')
    .values({
      id: vouEntityId,
      code: 'HTTP-SALE',
      name: 'HTTP销售',
      enabled: true,
      field_catalog: JSON.stringify({
        headerFields: ['status'],
        lineFields: ['amount'],
      }),
    })
    .execute()
  await db
    .insertInto('dcl_acc_subject_facts')
    .values({
      id: subjectId,
      book_id: bookId,
      code: '1001',
      name: '现金',
      leaf: true,
      enabled: true,
      required_dimensions: JSON.stringify(['customer']),
    })
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values({
      id: mappingSubjectId,
      entity: 'acc-mapping',
      code: null,
      created_at: new Date(),
      created_by: id,
    })
    .execute()
  const mappingDefinition = {
    defaultTemplateId: null,
    rules: [],
    templates: [],
    assetConfiguration: null,
  }
  await db
    .insertInto('approval_entries')
    .values([
      {
        id: mappingV1Id,
        domain: 'dcl',
        entity: 'acc-mapping',
        subject_id: mappingSubjectId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: id,
        submitted_at: new Date(),
        approved_by: id,
        approved_at: new Date(),
        updated_by: id,
        updated_at: new Date(),
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
      },
      {
        id: mappingV2Id,
        domain: 'dcl',
        entity: 'acc-mapping',
        subject_id: mappingSubjectId,
        version_no: 2,
        status: 'APPROVED',
        revision: 2,
        submitted_by: id,
        submitted_at: new Date(),
        approved_by: id,
        approved_at: new Date(),
        updated_by: id,
        updated_at: new Date(),
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_acc_mapping_versions')
    .values([
      {
        approval_entry_id: mappingV1Id,
        book_id: bookId,
        vou_entity_id: vouEntityId,
        book_snapshot: JSON.stringify({
          id: bookId,
          code: 'HTTP-BOOK',
          name: 'HTTP账簿',
        }),
        vou_entity_snapshot: JSON.stringify({
          id: vouEntityId,
          code: 'HTTP-SALE',
          name: 'HTTP销售',
        }),
        default_result: 'POST',
        mapping_definition: JSON.stringify(mappingDefinition),
      },
      {
        approval_entry_id: mappingV2Id,
        book_id: bookId,
        vou_entity_id: vouEntityId,
        book_snapshot: JSON.stringify({
          id: bookId,
          code: 'HTTP-BOOK',
          name: 'HTTP账簿',
        }),
        vou_entity_snapshot: JSON.stringify({
          id: vouEntityId,
          code: 'HTTP-SALE',
          name: 'HTTP销售',
        }),
        default_result: 'UN_POST',
        mapping_definition: JSON.stringify(mappingDefinition),
      },
    ])
    .execute()
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    database: {
      ping: async () =>
        db
          .selectFrom('app_users')
          .select('id')
          .limit(1)
          .execute()
          .then(() => undefined),
    },
    session: new SessionService(db, config),
    management: new ManagementService(db, config),
    accMappingCatalog: new AccMappingCatalogService(db),
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })
  await started
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const headers = {
    'content-type': 'application/json',
    'x-zerp-model-build': modelBuildId,
    connection: 'close',
  }

  const unknown = await fetch(`${origin}/app/user/signin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password, unexpected: true }),
  })
  assert.equal(unknown.status, 200)
  assert.equal((await unknown.json()).errorKey, 'validation_failed')

  const signin = await fetch(`${origin}/app/user/signin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password }),
  })
  assert.equal(signin.status, 200)
  const cookie = signin.headers.getSetCookie()[0]
  assert.ok(cookie)
  const signinPayload = await signin.json()
  assert.equal(signinPayload.code, 0)
  assert.equal(
    await db
      .selectFrom('app_sessions')
      .select('id')
      .where('user_id', '=', id)
      .execute()
      .then((rows) => rows.length),
    1,
  )

  const beforeRestore = new Date(Date.now() + 1_000)
  await db
    .updateTable('app_sessions')
    .set({ idle_expires_at: beforeRestore })
    .where('user_id', '=', id)
    .execute()
  const session = await fetch(`${origin}/app/user/session`, {
    method: 'POST',
    headers: { ...headers, cookie },
    body: '{}',
  })
  const sessionPayload = await session.json()
  assert.equal(sessionPayload.code, 0)
  assert.equal(typeof sessionPayload.data.csrfToken, 'string')
  assert.ok(
    (
      await db
        .selectFrom('app_sessions')
        .select('idle_expires_at')
        .where('user_id', '=', id)
        .executeTakeFirstOrThrow()
    ).idle_expires_at > beforeRestore,
  )

  const invalidProfile = await fetch(`${origin}/app/user/profile`, {
    method: 'POST',
    headers: {
      ...headers,
      cookie,
      'x-csrf-token': sessionPayload.data.csrfToken,
    },
    body: JSON.stringify({
      avatarUrl: 'https://images.example.com/avatar.png',
    }),
  })
  assert.equal(invalidProfile.status, 200)
  assert.equal((await invalidProfile.json()).errorKey, 'validation_failed')

  const query = {
    page: 1,
    pageSize: 20,
    filters: { search: username, status: 'ENABLED' },
    sort: [{ field: 'username', order: 'asc' }],
  }
  const denied = await fetch(`${origin}/app/user/query`, {
    method: 'POST',
    headers: {
      ...headers,
      cookie,
      'x-csrf-token': sessionPayload.data.csrfToken,
    },
    body: JSON.stringify(query),
  })
  assert.equal((await denied.json()).errorKey, 'forbidden')
  const catalogDenied = await fetch(`${origin}/acc/mapping/catalog`, {
    method: 'POST',
    headers: {
      ...headers,
      cookie,
      'x-csrf-token': sessionPayload.data.csrfToken,
    },
    body: '{}',
  })
  assert.equal((await catalogDenied.json()).errorKey, 'forbidden')
  const permission = await db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/app/user/query')
    .executeTakeFirstOrThrow()
  const catalogPermission = await db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/acc/mapping/catalog')
    .executeTakeFirstOrThrow()
  const mappingQueryPermission = await db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/acc/mapping/query')
    .executeTakeFirstOrThrow()
  const mappingGetPermission = await db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/acc/mapping/get')
    .executeTakeFirstOrThrow()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `target-${suffix}`,
      name: 'Target reader',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values([
      { role_id: roleId, permission_id: permission.id },
      { role_id: roleId, permission_id: catalogPermission.id },
      { role_id: roleId, permission_id: mappingQueryPermission.id },
      { role_id: roleId, permission_id: mappingGetPermission.id },
    ])
    .execute()
  await db
    .insertInto('app_user_roles')
    .values({ user_id: id, role_id: roleId })
    .execute()
  const beforeQuery = new Date(Date.now() + 1_000)
  await db
    .updateTable('app_sessions')
    .set({ idle_expires_at: beforeQuery })
    .where('user_id', '=', id)
    .execute()
  const allowed = await fetch(`${origin}/app/user/query`, {
    method: 'POST',
    headers: {
      ...headers,
      cookie,
      'x-csrf-token': sessionPayload.data.csrfToken,
    },
    body: JSON.stringify(query),
  })
  const allowedPayload = await allowed.json()
  assert.equal(allowedPayload.code, 0)
  assert.ok(
    allowedPayload.data.items.some((item: { id: string }) => item.id === id),
  )
  assert.deepEqual(Object.keys(allowedPayload.data.items[0]).sort(), [
    'createdAt',
    'displayName',
    'id',
    'manageable',
    'revision',
    'status',
    'system',
    'updatedAt',
    'username',
  ])
  assert.equal(allowedPayload.data.pageSize, 20)
  const catalog = await fetch(`${origin}/acc/mapping/catalog`, {
    method: 'POST',
    headers: {
      ...headers,
      cookie,
      'x-csrf-token': sessionPayload.data.csrfToken,
    },
    body: '{}',
  })
  const catalogPayload = await catalog.json()
  assert.equal(catalogPayload.code, 0)
  assert.deepEqual(catalogPayload.data.books.filter((item: { id: string }) => item.id === bookId), [
    { id: bookId, code: 'HTTP-BOOK', name: 'HTTP账簿' },
  ])
  assert.deepEqual(catalogPayload.data.vouEntities.filter((item: { id: string }) => item.id === vouEntityId), [
    {
      id: vouEntityId,
      code: 'HTTP-SALE',
      name: 'HTTP销售',
      fieldCatalog: { headerFields: ['status'], lineFields: ['amount'] },
    },
  ])
  assert.ok(catalogPayload.data.vouEntities.some((item: { id: string }) => item.id === 'sale-pricing'))
  assert.deepEqual(catalogPayload.data.subjects.filter((item: { id: string }) => item.id === subjectId), [
    { id: subjectId, bookId, code: '1001', name: '现金', requiredDimensions: ['customer'] },
  ])
  const mappingQuery = await fetch(`${origin}/acc/mapping/query`, {
    method: 'POST',
    headers: {
      ...headers,
      cookie,
      'x-csrf-token': sessionPayload.data.csrfToken,
    },
    body: JSON.stringify({ bookId, page: 1, pageSize: 20 }),
  })
  const mappingQueryPayload = await mappingQuery.json()
  assert.equal(mappingQueryPayload.code, 0)
  assert.equal(mappingQueryPayload.data.total, 1)
  assert.equal(mappingQueryPayload.data.items[0].approvalEntryId, mappingV2Id)
  assert.equal(mappingQueryPayload.data.items[0].defaultResult, 'UN_POST')
  const mappingGet = async () =>
    fetch(`${origin}/acc/mapping/get`, {
      method: 'POST',
      headers: {
        ...headers,
        cookie,
        'x-csrf-token': sessionPayload.data.csrfToken,
      },
      body: JSON.stringify({ bookId, vouEntity: 'HTTP-SALE' }),
    })
  assert.equal(
    (await (await mappingGet()).json()).data.approvalEntryId,
    mappingV2Id,
  )
  await db
    .updateTable('approval_entries')
    .set({
      status: 'PENDING',
      revision: 3,
      updated_at: new Date(),
      updated_by: id,
    })
    .where('id', '=', mappingV2Id)
    .execute()
  const fallback = await (await mappingGet()).json()
  assert.equal(fallback.code, 0)
  assert.equal(fallback.data.approvalEntryId, mappingV1Id)
  assert.equal(fallback.data.defaultResult, 'POST')
  assert.ok(
    (
      await db
        .selectFrom('app_sessions')
        .select('idle_expires_at')
        .where('user_id', '=', id)
        .executeTakeFirstOrThrow()
    ).idle_expires_at > beforeQuery,
  )
  assert.ok(permission.id)
})
