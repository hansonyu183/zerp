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
async function openMenu(page: Page, path: string) {
  const drawer = page.locator('.v-navigation-drawer')
  const group = drawer.locator('.v-list-group').filter({ hasText: '业务单据' })
  if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
    await group.locator('.v-list-group__header').click()
  await drawer.locator(`a[href="${path}"]`).click()
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
    ).toBeVisible()
    await expect(page.getByTestId('list-create')).toHaveCount(0)
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
    await page.getByLabel('单号', { exact: true }).fill(row.documentNo)
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/vou/${entity}/query`,
    )
    await page.getByTestId('list-search').click()
    const envelope = await (await response).json()
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
  await openMenu(page, '/vou/sale-order')
  await expect(
    page.getByText('当前账号没有查询权限，仅显示已授权操作。'),
  ).toBeVisible()
  await expect(page.getByTestId('list-search')).toBeDisabled()
  expect(requests).toEqual([])
})
