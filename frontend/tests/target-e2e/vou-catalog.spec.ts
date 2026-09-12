import { setDateRange } from './collection-helpers.ts'
import { expect, test, type Page } from '@playwright/test'
import {
  vouEntities,
  vouEntityPresentation,
  systemGeneratedVouEntities,
} from '@zerp/model'

const facts = JSON.parse(
  process.env.TARGET_E2E_VOU_CATALOG_JSON ?? '{}',
) as Record<
  string,
  { documentId: string; documentNo: string; businessDate: string }
>
if (!process.env.TARGET_E2E_VOU_CATALOG_JSON)
  throw new Error('TARGET_E2E_VOU_CATALOG_JSON fixture is required')
async function signIn(page: Page, code: string, password: string) {
  await page.goto('/signin')
  await page.getByLabel('用户编码', { exact: true }).fill(code)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
}
async function openMenu(page: Page, entity: string) {
  const drawer = page.locator('.v-navigation-drawer')
  const group = drawer.locator('.v-list-group').filter({ hasText: '业务单据' })
  if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
    await group.locator('.v-list-group__header').click()
  await drawer.locator(`a[href="/vou/${entity}"]`).click()
  await expect(page.getByTestId('vou-list-page')).toBeVisible()
}
test('all 36 real menus query their own summaries and open readable snapshots', async ({
  page,
}) => {
  test.setTimeout(180000)
  await signIn(
    page,
    process.env.TARGET_E2E_REVIEWER_USERNAME!,
    process.env.TARGET_E2E_REVIEWER_PASSWORD!,
  )
  for (const entity of vouEntities) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openMenu(page, entity)
    const list = page.getByTestId('vou-list-page'),
      fact = facts[entity]!
    await expect(list).toContainText(vouEntityPresentation[entity].label)
    await expect(page.getByTestId('list-create')).toHaveCount(0)
    if (
      [
        'intermediary-calculation',
        'sale-order',
        'purchase-order',
        'sale-return',
        'purchase-inbound',
        'purchase-return',
        'purchase-inquiry',
        'sale-pricing',
        'service-contract',
        'service-acceptance',
        'order-production',
        'self-production',
        'inventory-count',
        'sales-receipt',
        'purchase-refund',
        'other-receipt',
        'sales-refund',
        'purchase-payment',
        'other-payment',
        'employee-loan',
        'employee-repayment',
        'employee-loan-writeoff',
        'expense-reimbursement',
        'other-income',
        'asset-acquisition',
        'asset-sale',
        'asset-liquidation',
        'bill-receipt',
        'bill-payment',
        'bill-issue',
        'bill-discount',
        'bill-maturity',
      ].includes(entity)
    ) {
      await expect(list).not.toContainText('专用单据编辑器尚未实施')
      await expect(
        page.getByRole('button', { name: '新建', exact: true }),
      ).toHaveCount(0)
    } else {
      await expect(list).toContainText('专用单据编辑器尚未实施')
      await expect(
        page.getByRole('button', { name: '新建', exact: true }),
      ).toHaveCount(0)
    }
    if (systemGeneratedVouEntities.some((value) => value === entity))
      await expect(
        page.getByText('此类型由系统生成，不支持人工新建。'),
      ).toBeVisible()
    await setDateRange(page, '期间', fact.businessDate, fact.businessDate)
    await page.getByLabel('单号', { exact: true }).fill(fact.documentNo)
    const response = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/vou/${entity}/query` &&
        r.request().postDataJSON()?.filters?.documentNo === fact.documentNo,
    )
    await page.getByTestId('list-search').click()
    const result = await (await response).json()
    expect(result.code, entity).toBe(0)
    expect(result.data.total, entity).toBe(1)
    expect(result.data.items[0].vouType).toBe(entity)
    expect(result.data.items[0]).not.toHaveProperty('payload')
    if (entity === 'employee-loan') {
      await expect(list).toContainText('HTTP 销售员')
      await expect(list).toContainText('12.30')
    }
    if (entity === 'sale-pricing')
      await expect(list.locator('.list-surface')).toContainText('—')
    if (
      entity === 'bill-discount' ||
      entity === 'employee-loan' ||
      entity === 'sale-outbound'
    )
      await page.setViewportSize({ width: 390, height: 844 })
    const row = page.getByTestId(`vou-row-${fact.documentId}`)
    await row.getByRole('button', { name: '打开', exact: true }).click()
    const detail = page.getByTestId('vou-detail')
    await expect(detail).toBeVisible()
    await expect(detail).not.toContainText('未登记字段')
    await expect(detail).not.toContainText('未知选项')
    await expect(detail).toContainText(
      entity === 'sale-order'
        ? '销售完整备注'
        : entity === 'purchase-order'
          ? '采购完整备注'
          : '目录只读完整备注',
    )
    if (entity === 'service-contract')
      await expect(detail).toContainText('渠道合作方')
    if (entity === 'bill-discount') await expect(detail).toContainText('否')
    if (entity === 'bill-receipt') {
      await detail
        .locator('.collection-block[aria-label="票据明细"]')
        .getByRole('button', { name: '查看', exact: true })
        .first()
        .click()
      const bill = page.getByRole('dialog').last()
      await expect(bill).toContainText('2026-12-04')
      await bill.getByRole('button', { name: '关闭', exact: true }).click()
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      entity,
    ).toBe(false)
    await detail.getByRole('button', { name: '关闭', exact: true }).click()
  }
})
test('approval-only catalog resources remain visible without query, get or reference requests', async ({
  page,
}) => {
  test.setTimeout(120000)
  await signIn(
    page,
    process.env.TARGET_E2E_CREATE_ONLY_USERNAME!,
    process.env.TARGET_E2E_CREATE_ONLY_PASSWORD!,
  )
  const reads: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (/\/(vou|bob)\/[^/]+\/(query|get)$/.test(path)) reads.push(path)
  })
  for (const entity of vouEntities) {
    await openMenu(page, entity)
    await expect(page.getByTestId('vou-list-page')).toContainText(
      '当前账号没有查询权限',
    )
  }
  expect(reads).toEqual([])
})
