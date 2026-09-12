import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const facts = JSON.parse(process.env.TARGET_E2E_ORDER_FACTS_JSON ?? '{}') as {
  sale: {
    documentId: string
    documentNo: string
    businessDate: string
    counterpartyName: string
  }
  purchase: {
    documentId: string
    documentNo: string
    businessDate: string
    counterpartyName: string
  }
}
async function signIn(page: Page, username: string, password: string) {
  await page.goto('/signin')
  await page.getByLabel('用户编码', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
}
async function openMenu(page: Page, path: string, query = true) {
  const drawer = page.locator('.v-navigation-drawer')
  const group = drawer.locator('.v-list-group').filter({ hasText: '业务单据' })
  if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
    await group.locator('.v-list-group__header').click()
  const loaded = query
    ? page.waitForResponse(
        (response) => new URL(response.url()).pathname === `${path}/query`,
      )
    : null
  await drawer.locator(`a[href="${path}"]`).click()
  if (loaded) await loaded
  await expect(page.getByTestId('vou-list-page')).toBeVisible()
}

test('sales and purchases open from menus, share date range fields, show immutable details and approve at 390px', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
  )
  for (const [entity, row, name] of [
    ['sale-order', facts.sale, facts.sale.counterpartyName],
    ['purchase-order', facts.purchase, facts.purchase.counterpartyName],
  ] as const) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openMenu(page, `/vou/${entity}`)
    await expect(
      page.getByText('专用单据编辑器尚未实施', { exact: false }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '新建', exact: true }),
    ).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByLabel('期间起', { exact: true }).fill(row.businessDate)
    await page.getByLabel('期间止', { exact: true }).fill(row.businessDate)
    await expect(
      page.getByLabel('提交日期起', { exact: true }),
    ).toHaveAttribute('type', 'date')
    await expect(page.getByLabel('期间起', { exact: true })).toHaveAttribute(
      'type',
      'date',
    )
    await expect(page.getByLabel('期间起', { exact: true })).toHaveValue(
      row.businessDate,
    )
    await expect(page.getByLabel('期间止', { exact: true })).toHaveValue(
      row.businessDate,
    )
    await page.getByLabel('单号', { exact: true }).fill(row.documentNo)
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/vou/${entity}/query` &&
        r.request().postDataJSON()?.filters?.documentNo === row.documentNo,
    )
    await page.getByTestId('list-search').click()
    expect(await page.getByTestId('field-error').allTextContents()).toEqual([])
    const queried = await response
    expect(new URL(queried.url()).pathname).toBe(`/vou/${entity}/query`)
    const envelope = await queried.json()
    expect(envelope.code).toBe(0)
    expect(envelope.data.total).toBe(1)
    expect(envelope.data.items[0].handlerName).toBeNull()
    expect(envelope.data.items[0]).not.toHaveProperty('payload')
    await expect(page.getByTestId('vou-list-page')).toContainText(name)
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(wide).toBe(false)
    await page
      .getByTestId(`vou-row-${row.documentId}`)
      .getByRole('button', { name: '打开', exact: true })
      .click()
    const detail = page.getByTestId('vou-detail')
    await expect(detail.getByTestId('vou-order-snapshot')).toBeVisible()
    await expect(detail).toContainText(
      entity === 'sale-order' ? '销售完整备注' : '采购完整备注',
    )
    await expect(detail).toContainText('基本数量')
    await expect(detail.locator('input,textarea')).toHaveCount(0)
    await detail.getByRole('button', { name: '批准', exact: true }).click()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(detail).toContainText('待批准')
    await detail.getByRole('button', { name: '批准', exact: true }).click()
    const approval = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/vou/${entity}/approve`,
    )
    await page.getByRole('button', { name: '确定', exact: true }).click()
    expect((await (await approval).json()).code).toBe(0)
    await expect(
      page.getByRole('button', { name: '确定', exact: true }),
    ).toHaveCount(0)
    await expect(detail).toContainText('已批准')
    await expect(
      detail.getByRole('button', { name: '反批准', exact: true }),
    ).toBeVisible()
    if (process.env.TARGET_E2E_ORDER_SCREENSHOTS) {
      const output = resolve(process.env.TARGET_E2E_ORDER_SCREENSHOTS)
      mkdirSync(output, { recursive: true })
      await page.screenshot({
        path: resolve(output, `${entity}-390.png`),
        fullPage: true,
      })
    }
    await detail.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(page.getByTestId('vou-list-page')).toContainText('已批准')
  }
})

test('approval-only order resource does not request lists or current reference options', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.TARGET_E2E_ORDER_NO_QUERY_USERNAME!,
    process.env.TARGET_E2E_ORDER_NO_QUERY_PASSWORD!,
  )
  const requests: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && !path.startsWith('/session/'))
      requests.push(path)
  })
  await openMenu(page, '/vou/sale-order', false)
  await expect(
    page.getByText('当前账号没有查询权限，仅显示已授权操作。'),
  ).toBeVisible()
  await expect(page.getByTestId('list-search')).toBeDisabled()
  expect(requests).toEqual([])
})

test('creates and clones sales and purchase orders from real menu candidates, including attachments at 390px', async ({
  page,
}) => {
  test.setTimeout(180000)
  const references = JSON.parse(
    process.env.TARGET_E2E_VOU_REFERENCE_FACTS_JSON ?? '{}',
  ) as Record<string, { name: string; code: string }>
  await signIn(
    page,
    process.env.TARGET_E2E_USERNAME!,
    process.env.TARGET_E2E_PASSWORD!,
  )
  for (const entity of ['purchase-order', 'sale-order'] as const) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openMenu(page, `/vou/${entity}`)
    await page.getByRole('button', { name: '新建', exact: true }).click()
    const editor = page.getByTestId('document-editor')
    await expect(editor).toBeVisible()
    const choose = async (label: string, name: string) => {
      const field = editor.getByLabel(label, { exact: true })
      await expect(field).toBeEnabled()
      if (label === '原材料') {
        await field
          .locator('xpath=ancestor::*[contains(@class,"v-input")][1]')
          .locator('.v-field__clearable .v-icon')
          .click()
        await expect(field).toHaveValue('')
      }
      const candidates = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return (
          response.request().method() === 'GET' &&
          url.pathname.endsWith('options') &&
          url.searchParams.get('keyword') === name
        )
      })
      await field.fill(name)
      const result = await (await candidates).json()
      expect(result.code, `候选 ${label}: ${result.errorKey}`).toBe(0)
      expect(
        result.data.items.some(
          (item: { name: string; code: string }) =>
            item.name.includes(name) || item.code.includes(name),
        ),
      ).toBe(true)
      await page.getByRole('option').filter({ hasText: name }).first().click()
    }
    await choose(
      entity === 'sale-order' ? '客户子单位' : '供应商',
      references[entity === 'sale-order' ? 'customerSubunit' : 'supplier']!
        .name,
    )
    await choose('仓库', references.warehouse!.name)
    if (entity === 'sale-order')
      await choose('经营主体', references.operatingEntity!.code)
    await editor.getByLabel('业务日期', { exact: true }).fill('2026-09-09')
    await editor.getByLabel('备注', { exact: true }).fill(`动态录入${entity}`)
    await editor
      .getByRole('button', { name: '添加商品行', exact: true })
      .click()
    await choose('产品', references.product!.name)
    if (entity === 'sale-order') {
      await expect(editor).toContainText('已采用最近有效订单')
      await choose('原材料', references.rawMaterial!.name)
    }
    await expect(editor.getByLabel('录入数量', { exact: true })).toBeEnabled()
    await editor.getByLabel('录入数量', { exact: true }).fill('2')
    await editor.getByLabel('基准数量', { exact: true }).fill('2')
    await editor.getByLabel('基础单价', { exact: true }).fill('12.50')
    await editor.getByLabel('添加附件', { exact: true }).setInputFiles({
      name: 'order.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\norder fixture\n%%EOF'),
    })
    await expect(editor).toContainText('待提交时上传')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false)
    const submitted = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/vou/${entity}/submit-new`,
    )
    await editor.getByRole('button', { name: '提交', exact: true }).click()
    const envelope = await (
      await submitted.catch(async () => {
        throw new Error(await editor.innerText())
      })
    ).json()
    expect(envelope.code, JSON.stringify(envelope)).toBe(0)
    await expect(editor).toHaveCount(0)
    const id = envelope.data.documentId as string
    await page
      .getByTestId(`vou-row-${id}`)
      .getByRole('button', { name: '打开', exact: true })
      .click()
    const detail = page.getByTestId('vou-detail')
    await expect(detail).toContainText(`动态录入${entity}`)
    await expect(detail).toContainText('order.pdf')
    await expect(detail).toContainText('12.50')
    await expect(detail).toContainText('已提交内容只读')
    await detail
      .getByRole('button', { name: '复制到临时表单', exact: true })
      .click()
    await expect(editor).toBeVisible()
    await expect(editor).toContainText('请重新上传')
    await expect(editor.getByLabel('录入数量', { exact: true })).toHaveValue(
      envelope.data.payload.productLines[0].enteredQuantity,
    )
    await expect(
      editor.getByRole('button', { name: '提交', exact: true }),
    ).toBeEnabled()
    if (entity === 'sale-order')
      await choose('原材料', references.rawMaterial!.name)
    await editor.getByLabel('备注', { exact: true }).fill('克隆重新提交')
    const cloned = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/vou/${entity}/submit-new`,
    )
    await editor.getByRole('button', { name: '提交', exact: true }).click()
    const cloneEnvelope = await (await cloned).json()
    expect(cloneEnvelope.code, JSON.stringify(cloneEnvelope)).toBe(0)
    expect(cloneEnvelope.data.documentId).not.toBe(id)
    expect(cloneEnvelope.data.payload.attachments).toEqual([])
    await expect(editor).toHaveCount(0)
    await page
      .getByTestId(`vou-row-${id}`)
      .getByRole('button', { name: '打开', exact: true })
      .click()
    await expect(detail).toContainText(`动态录入${entity}`)
    await detail.getByRole('button', { name: '关闭', exact: true }).click()
  }
})
