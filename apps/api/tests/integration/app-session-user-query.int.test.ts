import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { serve } from '@hono/node-server'
import { argon2idAsync } from '@noble/hashes/argon2.js'

import { createApp } from '../../src/app.ts'
import { ManagementService } from '../../src/app/management.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { searchPinyin } from '../../src/platform/pinyin.ts'
import { createDatabase } from '../../src/db/database.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { modelBuildId } from '@zerp/model'
import { createTargetApiClient } from '../../../../packages/api-client/src/index.ts'
import { ulid } from 'ulid'

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
      await db
        .deleteFrom('app_audit_events')
        .where('actor_user_id', '=', id)
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
      py: searchPinyin('Target integration user'),
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

  const invalidSession = await fetch(`${origin}/session/auth/restore`, {
    method: 'POST',
    headers: { ...headers, cookie: 'zerp_session=invalid-session' },
    body: '{}',
  })
  assert.equal(invalidSession.status, 200)
  assert.equal((await invalidSession.json()).errorKey, 'unauthenticated')
  assert.match(invalidSession.headers.getSetCookie()[0] ?? '', /Max-Age=0/)

  const invalidIndependentRoute = await fetch(
    `${origin}/app/system-parameter/query`,
    {
    method: 'POST',
    headers: {
      ...headers,
      cookie: 'zerp_session=invalid-session',
      'x-csrf-token': 'invalid-csrf',
    },
      body: JSON.stringify({ page: 1, pageSize: 20 }),
    },
  )
  assert.equal(
    (await invalidIndependentRoute.json()).errorKey,
    'unauthenticated',
  )
  assert.match(
    invalidIndependentRoute.headers.getSetCookie()[0] ?? '',
    /Max-Age=0/,
  )

  const unknown = await fetch(`${origin}/session/auth/signin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: username, password, unexpected: true }),
  })
  assert.equal(unknown.status, 200)
  assert.equal((await unknown.json()).errorKey, 'validation_failed')

  let cookie = ''
  const client = createTargetApiClient({
    baseUrl: origin,
    modelBuildId,
    fetch: async (input, init) => {
      const requestHeaders = new Headers(init?.headers)
      if (cookie) requestHeaders.set('cookie', cookie)
      const response = await fetch(input, { ...init, headers: requestHeaders })
      cookie = response.headers.getSetCookie()[0] ?? cookie
      return response
    },
  })
  const startup = await client.session.app.get.$post({ json: {} })
  assert.equal(startup.status, 200)
  assert.equal((await startup.json()).code, 0)

  for (const legacyRoute of [
    '/app/branding/get',
    '/app/user/change-password',
    '/app/user/profile',
    '/app/user/session',
    '/app/user/signin',
    '/app/user/signout',
  ]) {
    const response = await fetch(`${origin}${legacyRoute}`, {
      method: 'POST',
      headers,
      body: '{}',
    })
    assert.equal(response.status, 404, `${legacyRoute} must not remain an alias`)
  }
  const signin = await client.session.auth.signin.$post({
    json: { code: username, password },
  })
  assert.equal(signin.status, 200)
  cookie = signin.headers.getSetCookie()[0] ?? cookie
  assert.ok(cookie)
  const signinPayload = await signin.json()
  assert.equal(signinPayload.code, 0)
  assert.deepEqual(Object.keys(signinPayload.data).sort(), [
    'apiPaths',
    'csrfToken',
    'passwordChangeRequired',
    'passwordMinLength',
    'user',
  ])
  assert.deepEqual(Object.keys(signinPayload.data.user).sort(), [
    'code',
    'id',
    'name',
  ])
  assert.deepEqual(signinPayload.data.apiPaths, [])
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
  const session = await client.session.auth.restore.$post({ json: {} })
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

  const invalidProfile = await fetch(`${origin}/session/user/save`, {
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

  const outOfBoundsProfile = await fetch(`${origin}/session/user/save`, {
    method: 'POST',
    headers: {
      ...headers,
      cookie,
      'x-csrf-token': sessionPayload.data.csrfToken,
    },
    body: JSON.stringify({
      name: 'attempted escalation',
      avatarUrl: null,
      id: '01J00000000000000000000001',
      code: 'other-user',
      roleIds: [],
      enabled: true,
      mode: 'ADMIN',
    }),
  })
  assert.equal(outOfBoundsProfile.status, 200)
  assert.equal((await outOfBoundsProfile.json()).errorKey, 'validation_failed')

  const csrfHeaders = { headers: { 'X-CSRF-Token': sessionPayload.data.csrfToken } }
  const initialProfile = await (
    await client.session.user.get.$post({ json: {} }, csrfHeaders)
  ).json()
  assert.equal(initialProfile.code, 0)
  assert.deepEqual(Object.keys(initialProfile.data).sort(), [
    'avatarUrl',
    'code',
    'id',
    'name',
    'passwordChangedAt',
    'revision',
  ])
  const avatarProfile = await (
    await client.session.user.save.$post(
      {
        json: {
          name: initialProfile.data.name,
          avatarUrl: 'https://images.example.com/avatar.png',
        },
      },
      csrfHeaders,
    )
  ).json()
  assert.equal(avatarProfile.code, 0)
  assert.equal(
    BigInt(avatarProfile.data.revision),
    BigInt(initialProfile.data.revision) + 1n,
  )
  const clearedProfile = await (
    await client.session.user.save.$post(
      { json: { name: initialProfile.data.name, avatarUrl: null } },
      csrfHeaders,
    )
  ).json()
  assert.equal(clearedProfile.code, 0)
  assert.equal(clearedProfile.data.avatarUrl, null)
  assert.equal(
    BigInt(clearedProfile.data.revision),
    BigInt(avatarProfile.data.revision) + 1n,
  )
  const unchangedProfile = await (
    await client.session.user.save.$post(
      { json: { name: initialProfile.data.name, avatarUrl: null } },
      csrfHeaders,
    )
  ).json()
  assert.equal(unchangedProfile.code, 0)
  assert.equal(unchangedProfile.data.revision, clearedProfile.data.revision)

  const query = {
    keyword: username,
    page: 1,
    pageSize: 20,
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
    'availableActions',
    'code',
    'enabled',
    'id',
    'name',
    'py',
    'revision',
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

  await db
    .deleteFrom('app_role_permissions')
    .where('role_id', '=', roleId)
    .where('permission_id', '=', permission.id)
    .execute()
  const revokedQuery = await fetch(`${origin}/app/user/query`, {
    method: 'POST',
    headers: {
      ...headers,
      cookie,
      'x-csrf-token': sessionPayload.data.csrfToken,
    },
    body: JSON.stringify(query),
  })
  assert.equal((await revokedQuery.json()).errorKey, 'forbidden')
  const revokedRestore = await client.session.auth.restore.$post({ json: {} })
  const revokedRestorePayload = await revokedRestore.json()
  assert.equal(revokedRestorePayload.code, 0)
  assert.ok(!revokedRestorePayload.data.apiPaths.includes('/app/user/query'))
  await db
    .insertInto('app_role_permissions')
    .values({ role_id: roleId, permission_id: permission.id })
    .execute()

  await db
    .updateTable('app_sessions')
    .set({ idle_expires_at: new Date(Date.now() - 1_000) })
    .where('user_id', '=', id)
    .execute()
  const expiredIndependentRoute = await fetch(`${origin}/session/user/get`, {
    method: 'POST',
    headers: {
      ...headers,
      cookie,
      'x-csrf-token': sessionPayload.data.csrfToken,
    },
    body: '{}',
  })
  assert.equal(
    (await expiredIndependentRoute.json()).errorKey,
    'unauthenticated',
  )
  assert.match(
    expiredIndependentRoute.headers.getSetCookie()[0] ?? '',
    /Max-Age=0/,
  )

  const renewed = await client.session.auth.signin.$post({
    json: { code: username, password },
  })
  const renewedPayload = await renewed.json()
  assert.equal(renewedPayload.code, 0)
  const firstSessionCookie = cookie
  const secondSession = await client.session.auth.signin.$post({
    json: { code: username, password },
  })
  assert.equal((await secondSession.json()).code, 0)
  await db
    .updateTable('app_users')
    .set({ password_change_required: true })
    .where('id', '=', id)
    .execute()
  const restricted = await client.session.auth.restore.$post({ json: {} })
  const restrictedPayload = await restricted.json()
  assert.equal(restrictedPayload.code, 0)
  assert.equal(restrictedPayload.data.passwordChangeRequired, true)
  const restrictedHeaders = {
    headers: { 'X-CSRF-Token': restrictedPayload.data.csrfToken },
  }
  const restrictedGet = await client.session.user.get.$post(
    { json: {} },
    restrictedHeaders,
  )
  assert.equal((await restrictedGet.json()).errorKey, 'forbidden')
  const restrictedSave = await client.session.user.save.$post(
    { json: { name: 'not allowed', avatarUrl: null } },
    restrictedHeaders,
  )
  assert.equal((await restrictedSave.json()).errorKey, 'forbidden')
  const restrictedQuery = await fetch(`${origin}/app/user/query`, {
    method: 'POST',
    headers: {
      ...headers,
      cookie,
      'x-csrf-token': restrictedPayload.data.csrfToken,
    },
    body: JSON.stringify(query),
  })
  assert.equal((await restrictedQuery.json()).errorKey, 'forbidden')
  const passwordAttempt = await client.session.user['change-password'].$post(
    {
      json: {
        currentPassword: 'not the current password',
        newPassword: 'Target!ReplacementPassword1',
      },
    },
    restrictedHeaders,
  )
  const passwordAttemptPayload = await passwordAttempt.json()
  assert.equal(passwordAttemptPayload.errorKey, 'invalid_current_password')
  const changedPassword = 'Target!ReplacementPassword1'
  const passwordChange = await client.session.user['change-password'].$post(
    { json: { currentPassword: password, newPassword: changedPassword } },
    restrictedHeaders,
  )
  assert.equal((await passwordChange.json()).code, 0)
  assert.equal(
    await db
      .selectFrom('app_sessions')
      .select('id')
      .where('user_id', '=', id)
      .where('revoked_at', 'is not', null)
      .execute()
      .then((rows) => rows.length),
    3,
  )
  for (const oldCookie of [firstSessionCookie, cookie]) {
    const oldRestore = await fetch(`${origin}/session/auth/restore`, {
      method: 'POST',
      headers: { ...headers, cookie: oldCookie },
      body: '{}',
    })
    assert.equal((await oldRestore.json()).errorKey, 'unauthenticated')
  }
  const newSignin = await client.session.auth.signin.$post({
    json: { code: username, password: changedPassword },
  })
  const newSigninPayload = await newSignin.json()
  assert.equal(newSigninPayload.code, 0)
  const signout = await client.session.auth.signout.$post(
    { json: {} },
    { headers: { 'X-CSRF-Token': newSigninPayload.data.csrfToken } },
  )
  assert.equal((await signout.json()).code, 0)
  assert.match(signout.headers.getSetCookie()[0] ?? '', /Max-Age=0/)

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const badSignin = await fetch(`${origin}/session/auth/signin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: username, password: 'incorrect password' }),
    })
    assert.equal(
      (await badSignin.json()).errorKey,
      attempt === 5 ? 'account_locked' : 'invalid_credentials',
    )
  }
  const lockedSignin = await fetch(`${origin}/session/auth/signin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: username, password: changedPassword }),
  })
  assert.equal((await lockedSignin.json()).errorKey, 'account_locked')
  await db
    .updateTable('app_users')
    .set({ status: 'DISABLED' })
    .where('id', '=', id)
    .execute()
  const disabledSignin = await fetch(`${origin}/session/auth/signin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: username, password: changedPassword }),
  })
  assert.equal((await disabledSignin.json()).errorKey, 'account_disabled')
})

test('user query searches code, pinyin, and name with stable fixed pagination and literal wildcard characters', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const suffix = randomBytes(6).toString('hex')
  const actorId = ulid()
  const roleId = ulid()
  const pageUsers = Array.from({ length: 23 }, (_, index) => ({
    id: ulid(),
    code: `page-${suffix}-${String(index).padStart(2, '0')}`,
    name: `分页用户 ${index}`,
  }))
  const specialUsers = [
    { id: ulid(), code: `code-hit-${suffix}`, name: '普通用户' },
    { id: ulid(), code: `py-hit-${suffix}`, name: '张三' },
    { id: ulid(), code: `name-hit-${suffix}`, name: '精确李四资料' },
    { id: ulid(), code: `percent-${suffix}`, name: 'literal%marker' },
    { id: ulid(), code: `underscore-${suffix}`, name: 'literal_marker' },
  ]
  const users = [...pageUsers, ...specialUsers]
  const password = `Aa1!${randomBytes(18).toString('base64url')}`
  context.after(async () => {
    try {
      const ids = [actorId, ...users.map((user) => user.id)]
      await db
        .deleteFrom('app_audit_events')
        .where((eb) =>
          eb.or([eb('actor_user_id', 'in', ids), eb('target_id', 'in', ids)]),
        )
        .execute()
      await db.deleteFrom('app_sessions').where('user_id', 'in', ids).execute()
      await db
        .deleteFrom('app_user_roles')
        .where('user_id', 'in', ids)
        .execute()
      await db
        .deleteFrom('app_role_permissions')
        .where('role_id', '=', roleId)
        .execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
      await db.deleteFrom('app_users').where('id', 'in', ids).execute()
    } finally {
      await db.destroy()
    }
  })
  await db
    .insertInto('app_users')
    .values([
      {
        id: actorId,
        username: `query-actor-${suffix}`,
        display_name: '查询操作人',
        py: searchPinyin('查询操作人'),
        password_hash: await hashPassword(password),
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      },
      ...users.map((user) => ({
        id: user.id,
        username: user.code,
        display_name: user.name,
        py: searchPinyin(user.name),
        password_hash: 'unused',
        status: 'ENABLED' as const,
        password_changed_at: new Date(),
        password_change_required: false,
      })),
    ])
    .execute()
  const queryPermission = await db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/app/user/query')
    .executeTakeFirstOrThrow()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `query-role-${suffix}`,
      name: 'User query role',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values({ role_id: roleId, permission_id: queryPermission.id })
    .execute()
  await db
    .insertInto('app_user_roles')
    .values({ user_id: actorId, role_id: roleId })
    .execute()

  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    session: new SessionService(db, config),
    management: new ManagementService(db, config),
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
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  await started
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const headers = {
    'content-type': 'application/json',
    'x-zerp-model-build': modelBuildId,
    connection: 'close',
  }
  const signin = await fetch(`${origin}/session/auth/signin`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ code: `query-actor-${suffix}`, password }),
  })
  const signinPayload = await signin.json()
  assert.equal(signinPayload.code, 0)
  const authHeaders = {
    ...headers,
    cookie: signin.headers.getSetCookie()[0] ?? '',
    'x-csrf-token': signinPayload.data.csrfToken,
  }
  async function query(keyword: string, page = 1) {
    const response = await fetch(`${origin}/app/user/query`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ keyword, page, pageSize: 20 }),
    })
    const payload = await response.json()
    assert.equal(payload.code, 0)
    return payload.data as {
      items: Array<{ id: string; code: string; py: string; name: string }>
      total: number
      page: number
      pageSize: 20
    }
  }

  const first = await query(`page-${suffix}`)
  const second = await query(`page-${suffix}`, 2)
  assert.equal(first.total, 23)
  assert.equal(first.items.length, 20)
  assert.equal(second.items.length, 3)
  assert.deepEqual(
    [...first.items, ...second.items].map((user) => user.code),
    pageUsers.map((user) => user.code).sort(),
  )
  assert.deepEqual(
    (await query(`code-hit-${suffix}`)).items.map((u) => u.id),
    [specialUsers[0]!.id],
  )
  assert.deepEqual(
    (await query('zhangsan')).items.map((u) => u.id),
    [specialUsers[1]!.id],
  )
  assert.deepEqual(
    (await query('李四')).items.map((u) => u.id),
    [specialUsers[2]!.id],
  )
  assert.deepEqual(
    (await query('%')).items.map((u) => u.id),
    [specialUsers[3]!.id],
  )
  assert.deepEqual(
    (await query('_')).items.map((u) => u.id),
    [specialUsers[4]!.id],
  )

  const renamed = await fetch(`${origin}/session/user/save`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: '重庆本人', avatarUrl: null }),
  })
  assert.equal((await renamed.json()).code, 0)
  assert.deepEqual(
    (await query('chongqingbenren')).items.map((u) => u.id),
    [actorId],
  )
  assert.equal((await query('chaxuncaozuoren')).total, 0)
})
