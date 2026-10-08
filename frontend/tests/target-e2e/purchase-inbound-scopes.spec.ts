import { setDateRange } from './collection-helpers.ts'
import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'

for (const width of [1280, 390]) {
  test(`receipt permission scope through ordinary roles and receipt pages at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const api = process.env.TARGET_API_BASE_URL!
    const order = JSON.parse(process.env.TARGET_E2E_RECEIPT_SCOPE_JSON!).order
    const modelHeaders = { 'x-zerp-model-build': modelBuildId }
    async function signin(code: string, password: string) {
      const result = await (
        await page.request.post(`${api}/session/auth/signin`, {
          headers: modelHeaders,
          data: { code, password },
        })
      ).json()
      expect(result.code).toBe(0)
      return { ...modelHeaders, 'x-csrf-token': result.data.csrfToken }
    }
    let headers = await signin(
      process.env.TARGET_SCOPE_MANAGER_USERNAME!,
      process.env.TARGET_SCOPE_MANAGER_PASSWORD!,
    )
    async function post(path: string, data: unknown) {
      return (await page.request.post(api + path, { headers, data })).json()
    }
    const original = await post('/vou/purchase-order/get', {
      documentId: order.documentId,
    })
    expect(original.code).toBe(0)
    if (original.data.status === 'PENDING') {
      headers = await signin(
        process.env.TARGET_E2E_REVIEWER_USERNAME!,
        process.env.TARGET_E2E_REVIEWER_PASSWORD!,
      )
      expect(
        (
          await post('/vou/purchase-order/approve', {
            documentId: order.documentId,
            submissionId: order.submissionId,
            expectedRevision: original.data.revision,
          })
        ).code,
      ).toBe(0)
      headers = await signin(
        process.env.TARGET_SCOPE_MANAGER_USERNAME!,
        process.env.TARGET_SCOPE_MANAGER_PASSWORD!,
      )
    }
    const permissions = await (
      await page.request.get(
        `${api}/app/permission/options?page=1&pageSize=20&keyword=/vou/purchase-inbound/`,
        { headers: modelHeaders },
      )
    ).json()
    expect(permissions.code).toBe(0)
    const ids = new Map<string, string>(
      permissions.data.items.map((item: { id: string; action: string }) => [
        item.action,
        item.id,
      ]),
    )
    const suffix = randomBytes(5).toString('hex')
    async function actor(
      mode: 'ORDER_REFERENCE' | 'INDEPENDENT_PRIOR',
      mixed = false,
    ) {
      const actions = ['query', 'get', 'submit-new', 'approve']
      const scopes = Object.fromEntries(
        actions.map((action) => [
          ids.get(action)!,
          mixed && ['query', 'get'].includes(action) ? 'ALL' : mode,
        ]),
      )
      const role = await post('/app/role/create', {
        name: `${mode}-${suffix}-${mixed}`,
        description: null,
        permissionIds: actions.map((action) => ids.get(action)!),
        purchaseInboundScopes: scopes,
      })
      expect(role.code).toBe(0)
      const username = `scope-${suffix}-${mode === 'ORDER_REFERENCE' ? 'ab' : mixed ? 'mixed' : 'ah'}`,
        password = `ScopeAa1!${suffix}`
      const user = await post('/app/user/create', {
        code: username,
        name: username,
        password,
        roleIds: [role.data.id],
      })
      expect(user.code).toBe(0)
      return { username, password }
    }
    const ah = await actor('INDEPENDENT_PRIOR'),
      ab = await actor('ORDER_REFERENCE'),
      mixed = await actor('INDEPENDENT_PRIOR', true)
    const priorFact = {
      sourceClosed: false,
      sourceInstanceId: 'browser-scope-fixture',
      sourceSchema: 'fixture',
      sourceDocumentType: 'AH',
      sourceDocumentKey: suffix,
      sourceDocumentNo: `AH-${suffix}`,
      capturedAt: '2026-09-30T23:59:59.123456Z',
      snapshotDigest: 'a'.repeat(64),
    }
    const independentPayload = {
      businessDate: '2026-09-11',
      currency: 'CNY',
      attachments: [],
      supplier: order.payload.supplier,
      warehouse: order.payload.warehouse,
      priorFact,
      productLines: [
        {
          ...order.payload.productLines[0],
          lineId: ulid(),
          enteredQuantity: '10',
          baseQuantity: '10',
          unitPrice: '7.500000',
          agreedAmount: '75.00',
        },
      ],
    }
    const ahLine = independentPayload.productLines[0]!.lineId
    const data = (payload: unknown) => {
      const id = ulid()
      return {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload,
      }
    }
    const receivedAH = await post(
      '/vou/purchase-inbound/submit-new',
      data({
        ...independentPayload,
        priorLineOrigins: [
          {
            lineId: ahLine,
            sourceDocumentType: 'BB',
            sourceDocumentKey: `BB-${suffix}`,
            sourceLineKey: '1',
          },
        ],
      }),
    )
    const receivedAB = await post(
      '/vou/purchase-inbound/submit-new',
      data({
        businessDate: '2026-09-11',
        currency: 'CNY',
        attachments: [],
        supplier: order.payload.supplier,
        warehouse: order.payload.warehouse,
        parentEntity: 'purchase-order',
        parentDocumentId: order.documentId,
        sourceLines: [
          {
            sourceLineId: order.payload.productLines[0].lineId,
            baseQuantity: '0.1',
          },
        ],
      }),
    )
    expect(receivedAH.code).toBe(0)
    expect(receivedAB.code).toBe(0)
    async function loginActor(user: typeof ah) {
      headers = await signin(user.username, user.password)
      expect(
        (
          await post('/session/user/change-password', {
            currentPassword: user.password,
            newPassword: user.password + '-Changed1!',
          })
        ).code,
      ).toBe(0)
      headers = await signin(user.username, user.password + '-Changed1!')
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto('/vou/purchase-inbound')
      await expect(page.getByTestId('vou-list-page')).toBeVisible()
      await setDateRange(page, '期间', '2026-09-01', '2026-09-30')
      await page.getByTestId('list-search').click()
      await page.setViewportSize({ width, height: 900 })
    }
    await loginActor(ah)
    await expect(
      page.getByTestId(`vou-row-${receivedAH.data.documentId}`),
    ).toBeVisible()
    await expect(
      page.getByTestId(`vou-row-${receivedAB.data.documentId}`),
    ).toHaveCount(0)
    expect(
      (
        await post('/vou/purchase-inbound/get', {
          documentId: receivedAB.data.documentId,
        })
      ).errorKey,
    ).toBe('forbidden')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const editor = page.getByRole('dialog').last()
    await expect(
      editor.getByRole('region', { name: '独立此前收货录入' }),
    ).toBeVisible()
    await expect(
      editor.getByRole('button', { name: '按采购订单收货', exact: true }),
    ).toHaveCount(0)
    await editor.getByRole('button', { name: '取消', exact: true }).click()
    await loginActor(ab)
    await expect(
      page.getByTestId(`vou-row-${receivedAB.data.documentId}`),
    ).toBeVisible()
    await expect(
      page.getByTestId(`vou-row-${receivedAH.data.documentId}`),
    ).toHaveCount(0)
    await page.getByRole('button', { name: '新增', exact: true }).click()
    await expect(
      page
        .getByRole('dialog')
        .last()
        .getByRole('button', { name: '登记独立此前收货', exact: true }),
    ).toHaveCount(0)
    await page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: '取消', exact: true })
      .click()
    await loginActor(mixed)
    for (const [receipt, allowed] of [
      [receivedAB.data, false],
      [receivedAH.data, true],
    ] as const) {
      await page
        .getByTestId(`vou-row-${receipt.documentId}`)
        .getByRole('button', { name: '打开', exact: true })
        .click()
      const detail = page.getByTestId('vou-detail')
      await expect(
        detail.getByRole('button', { name: '批准', exact: true }),
      ).toHaveCount(allowed ? 1 : 0)
      await expect(
        detail.getByRole('button', { name: '复制到临时表单', exact: true }),
      ).toHaveCount(allowed ? 1 : 0)
      await detail.getByRole('button', { name: '关闭', exact: true }).click()
    }
    expect(
      (
        await post('/vou/purchase-inbound/approve', {
          documentId: receivedAB.data.documentId,
          submissionId: receivedAB.data.submissionId,
          expectedRevision: receivedAB.data.revision,
        })
      ).errorKey,
    ).toBe('forbidden')
  })
}
