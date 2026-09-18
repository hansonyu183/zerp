import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword, type SessionService } from '../../src/app/session.ts'
import { AuxService } from '../../src/aux/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

test('basic AUX HTTP maintenance keeps stable relationships, pagination and transactional blockers', async (t) => {
  const url = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(url)
  const db = createDatabase(url)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = ulid()
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `basic-${suffix}`,
    passwordHash: await hashPassword(`Test!${suffix}`),
  }
  const entities = [
    'department',
    'product-category',
    'dictionary-type',
    'dictionary-item',
    'income-expense-type',
  ] as const
  const apiPaths = entities.flatMap((entity) =>
    ['query', 'get', 'create', 'save', 'enable', 'disable', 'delete'].map(
      (action) => `/aux/${entity}/${action}`,
    ),
  )
  await bootstrap.createE2EPrincipal(principal, false, apiPaths)
  t.after(async () => {
    await bootstrap.deleteE2EPrincipal(principal)
    await db.destroy()
  })
  const app = createApp({
    aux: new AuxService(db),
    session: {
      authenticate: async () => ({
        sessionId: ulid(),
        user: {
          id: principal.userId,
          code: principal.username,
          name: '维护者',
        },
        csrfToken: 'csrf',
        apiPaths,
        passwordChangeRequired: false,
        passwordMinLength: 12,
        absoluteExpiresAt: new Date('2030-01-01'),
      }),
    } as unknown as SessionService,
    config: loadConfig({
      DATABASE_URL: url,
      APP_SESSION_COOKIE_SECURE: 'false',
    }),
  })
  async function post(entity: string, action: string, input: object) {
    return (
      await app.request(`/aux/${entity}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
    ).json()
  }
  async function ok(entity: string, action: string, input: object) {
    const response = await post(entity, action, input)
    assert.equal(response.code, 0, JSON.stringify(response))
    return response.data
  }
  // The audit event store is the existing observable audit sink; business facts
  // are always read through HTTP below.
  const auditEvents = (id: string) =>
    db
      .selectFrom('app_audit_events')
      .select(['event_type', 'summary'])
      .where('target_id', '=', id)
      .orderBy('created_at')
      .orderBy('id')
      .execute()
  const type = await ok('dictionary-type', 'create', { name: `类型${suffix}` })
  for (let i = 0; i < 22; i++)
    await ok('dictionary-item', 'create', {
      name: `字典${suffix}-${i}`,
      dictionaryTypeId: type.id,
      sortOrder: i,
    })
  const first = await ok('dictionary-item', 'query', {
    dictionaryTypeId: type.id,
    keyword: `zidian${suffix.toLowerCase()}`,
    page: 1,
    pageSize: 20,
  })
  assert.equal(first.total, 22)
  assert.equal(first.items.length, 20)
  assert.equal(first.items[0].dictionaryTypeName, `类型${suffix}`)
  assert.ok(first.items[0].availableActions.includes('delete'))
  const second = await ok('dictionary-item', 'query', {
    dictionaryTypeId: type.id,
    page: 2,
    pageSize: 20,
  })
  assert.equal(second.items.length, 2)
  assert.equal(
    (await post('dictionary-type', 'delete', type)).errorKey,
    'validation_failed',
  ) // strict mutation inputs
  const blocked = await post('dictionary-type', 'delete', {
    id: type.id,
    revision: type.revision,
  })
  assert.equal(blocked.errorKey, 'conflict')
  assert.ok(blocked.data.blockers.length)
  await ok('dictionary-type', 'get', { id: type.id })
  const disabledType = await ok('dictionary-type', 'disable', {
    id: type.id,
    revision: type.revision,
  })
  const item = first.items[0]
  const savedItem = await ok('dictionary-item', 'save', {
    id: item.id,
    revision: item.revision,
    name: '保留停用类型',
    dictionaryTypeId: type.id,
    sortOrder: 5,
  })
  assert.equal(savedItem.revision, '2')
  assert.equal(
    (
      await post('dictionary-item', 'create', {
        name: '拒绝新采用',
        dictionaryTypeId: type.id,
        sortOrder: 0,
      })
    ).errorKey,
    'validation_failed',
  )
  const options = await (
    await app.request(
      `/aux/dictionary-type/options?ids=${type.id}&page=1&pageSize=20`,
    )
  ).json()
  assert.equal(options.code, 0)
  assert.equal(options.data.items[0].enabled, false)
  await ok('dictionary-type', 'enable', {
    id: type.id,
    revision: disabledType.revision,
  })
  await ok('dictionary-type', 'save', {
    id: type.id,
    revision: '3',
    name: `改名类型${suffix}`,
  })
  const renamedItems = await ok('dictionary-item', 'query', {
    dictionaryTypeId: type.id,
    page: 1,
    pageSize: 20,
  })
  assert.equal(renamedItems.total, 22)
  assert.ok(
    renamedItems.items.every(
      (row: { dictionaryTypeId: string; dictionaryTypeName: string }) =>
        row.dictionaryTypeId === type.id &&
        row.dictionaryTypeName === `改名类型${suffix}`,
    ),
  )
  const preserved = await ok('dictionary-item', 'get', { id: item.id })
  assert.equal(preserved.dictionaryTypeName, `类型${suffix}`)
  await ok('dictionary-item', 'save', {
    id: item.id,
    revision: preserved.revision,
    name: '只改字典名称',
    dictionaryTypeId: type.id,
    sortOrder: 8,
  })
  assert.equal(
    (await ok('dictionary-item', 'get', { id: item.id })).dictionaryTypeName,
    `类型${suffix}`,
  )
  for (const entity of [
    'department',
    'product-category',
    'income-expense-type',
  ] as const) {
    const extra =
      entity === 'income-expense-type' ? { direction: 'INCOME' } : {}
    const parent = await ok(entity, 'create', {
      name: `上级${suffix}`,
      ...extra,
    })
    const child = await ok(entity, 'create', {
      name: `子级${suffix}`,
      parentId: parent.id,
      ...extra,
    })
    const result = await ok(entity, 'query', {
      keyword: `子级${suffix}`,
      page: 1,
      pageSize: 20,
    })
    assert.equal(result.items[0].parentId, parent.id)
    assert.equal(result.items[0].parentName, `上级${suffix}`)
    const parentAudit = await auditEvents(parent.id)
    assert.equal(
      (
        await post(entity, 'save', {
          id: parent.id,
          revision: parent.revision,
          name: '循环',
          parentId: child.id,
          ...extra,
        })
      ).errorKey,
      'validation_failed',
    )
    if (entity === 'income-expense-type') {
      assert.equal(
        (
          await post(entity, 'save', {
            id: parent.id,
            revision: parent.revision,
            name: '错误方向',
            direction: 'EXPENSE',
          })
        ).errorKey,
        'validation_failed',
      )
      assert.equal(
        (
          await post(entity, 'create', {
            name: '错误子项',
            parentId: parent.id,
            direction: 'EXPENSE',
          })
        ).errorKey,
        'validation_failed',
      )
    }
    assert.equal(
      (
        await post(entity, 'delete', {
          id: parent.id,
          revision: parent.revision,
        })
      ).errorKey,
      'conflict',
    )
    assert.equal(
      (await ok(entity, 'get', { id: parent.id })).revision,
      parent.revision,
    )
    assert.deepEqual(await auditEvents(parent.id), parentAudit)
    await ok(entity, 'disable', { id: parent.id, revision: parent.revision })
    await ok(entity, 'save', {
      id: child.id,
      revision: child.revision,
      name: '保留历史上级',
      parentId: parent.id,
      ...extra,
    })
    assert.equal(
      (
        await post(entity, 'create', {
          name: '停用不得新采用',
          parentId: parent.id,
          ...extra,
        })
      ).errorKey,
      'validation_failed',
    )
  }
  for (const entity of entities) {
    const fields =
      entity === 'dictionary-item'
        ? { dictionaryTypeId: type.id, sortOrder: -3 }
        : entity === 'income-expense-type'
          ? { direction: 'EXPENSE', description: '支出' }
          : { description: '资料' }
    const created = await ok(entity, 'create', {
      name: `完整维护${suffix}`,
      ...fields,
    })
    const saved = await ok(entity, 'save', {
      id: created.id,
      revision: created.revision,
      name: `已修改${suffix}`,
      ...fields,
    })
    assert.equal(saved.revision, '2')
    const before = await ok(entity, 'get', { id: created.id })
    const audit = await auditEvents(created.id)
    assert.equal(
      (
        await post(entity, 'save', {
          id: created.id,
          revision: '1',
          name: '旧版写入',
          ...fields,
        })
      ).errorKey,
      'conflict',
    )
    assert.deepEqual(await ok(entity, 'get', { id: created.id }), before)
    assert.deepEqual(await auditEvents(created.id), audit)
    const disabled = await ok(entity, 'disable', {
      id: created.id,
      revision: saved.revision,
    })
    assert.equal(disabled.enabled, false)
    const disabledAudit = await auditEvents(created.id)
    assert.equal(
      (
        await post(entity, 'disable', {
          id: created.id,
          revision: disabled.revision,
        })
      ).errorKey,
      'conflict',
    )
    assert.deepEqual(await auditEvents(created.id), disabledAudit)
    const enabled = await ok(entity, 'enable', {
      id: created.id,
      revision: disabled.revision,
    })
    assert.equal(enabled.revision, '4')
    assert.equal(
      (
        await ok(entity, 'delete', {
          id: created.id,
          revision: enabled.revision,
        })
      ).deleted,
      true,
    )
    assert.equal(
      (await post(entity, 'get', { id: created.id })).errorKey,
      'validation_failed',
    )
    const actions = (await auditEvents(created.id)).map(
      (event) => event.event_type,
    )
    assert.deepEqual(actions.map((action) => action.split('_').at(-1)).sort(), [
      'CREATED',
      'DELETED',
      'DISABLED',
      'ENABLED',
      'SAVED',
    ])
  }
  apiPaths.splice(0, apiPaths.length, '/aux/dictionary-type/get')
  const readOnly = await ok('dictionary-type', 'get', { id: type.id })
  assert.deepEqual(readOnly.availableActions, [])
  assert.equal(
    (
      await post('dictionary-type', 'save', {
        id: type.id,
        revision: readOnly.revision,
        name: '无权修改',
      })
    ).errorKey,
    'forbidden',
  )
  const candidate = await (
    await app.request(`/aux/income-expense-type/options?page=1&pageSize=20`)
  ).json()
  assert.equal(candidate.code, 0)
  assert.equal(
    (await post('income-expense-type', 'query', { page: 1, pageSize: 20 }))
      .errorKey,
    'forbidden',
  )
})
