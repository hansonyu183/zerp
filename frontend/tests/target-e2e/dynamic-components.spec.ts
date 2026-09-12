import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  confirmCollection,
  editCollection,
  setDateRange,
} from './collection-helpers.ts'

test('shared mobile cards, form spacing, nested draft cancellation and compact date filters', async ({
  page,
}) => {
  test.setTimeout(120000)
  await page.goto('/signin')
  await page
    .getByLabel('用户编码', { exact: true })
    .fill(process.env.TARGET_E2E_USERNAME!)
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TARGET_E2E_PASSWORD!)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
  await page.goto('/bob/customer')
  for (const width of [375, 599, 600, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    if (width < 600) {
      await expect(page.locator('.list-card').first()).toBeVisible()
      await expect(page.locator('.list-surface table')).toHaveCount(0)
    } else {
      await expect(page.locator('.list-surface table')).toBeVisible()
      await expect(page.locator('.list-card')).toHaveCount(0)
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
  await page.setViewportSize({ width: 375, height: 844 })
  await page.getByRole('button', { name: '新增客户', exact: true }).click()
  const parent = page.getByRole('dialog').last()
  const fields = parent
    .locator('.form-block')
    .first()
    .locator(':scope > .form-control')
  await expect
    .poll(async () => {
      const first = await fields.nth(0).boundingBox()
      const second = await fields.nth(1).boundingBox()
      return second!.y - first!.y - first!.height
    })
    .toBeGreaterThanOrEqual(15)
  const edit = parent
    .locator('.collection-block[aria-label="客户子单位"]')
    .getByRole('button', { name: '编辑', exact: true })
  await editCollection(page, '客户子单位')
  await expect(
    page.locator('.v-dialog--fullscreen.v-overlay--active'),
  ).toBeVisible()
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: '添加信用额度', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .last()
    .getByRole('textbox', { name: '信用额度', exact: true })
    .fill('123.45')
  await confirmCollection(page)
  await expect(
    page
      .getByRole('dialog')
      .last()
      .locator('.collection-block[aria-label="信用额度"]'),
  ).toContainText('123.45')
  const directory = resolve(
    process.cwd(),
    '..',
    '.scratch',
    'dynamic-components',
  )
  mkdirSync(directory, { recursive: true })
  await page.screenshot({
    path: resolve(directory, 'mobile-subunit.png'),
    animations: 'disabled',
  })
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: '取消', exact: true })
    .click()
  await expect(edit).toBeFocused()
  await editCollection(page, '客户子单位')
  await expect(
    page
      .getByRole('dialog')
      .last()
      .locator('.collection-block[aria-label="信用额度"]'),
  ).not.toContainText('123.45')
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: '取消', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: '取消', exact: true })
    .click()

  const loaded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/vou/purchase-order/query',
  )
  await page.goto('/vou/purchase-order')
  await loaded
  let queries = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/vou/purchase-order/query')
      queries++
  })
  await expect(page.locator('.extra-filters')).not.toBeVisible()
  await setDateRange(page, '期间', '2026-09-10', '2026-09-01')
  await page.getByTestId('list-search').click()
  await expect(page.getByTestId('field-error')).toBeVisible()
  expect(queries).toBe(0)
  await setDateRange(page, '期间', '2026-09-01', '2026-09-01')
  expect(
    await page
      .getByLabel('期间', { exact: true })
      .evaluate((input) => input.scrollWidth <= input.clientWidth),
  ).toBe(true)
  await page.getByTestId('more-filters').click()
  await setDateRange(page, '提交日期', '', '2026-09-30')
  await page.getByTestId('more-filters').click()
  await expect(page.getByTestId('more-filters')).toContainText('1')
  expect(queries).toBe(0)
  const searched = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === '/vou/purchase-order/query',
  )
  await page.getByTestId('list-search').click()
  const filters = (await searched).postDataJSON().filters
  expect(filters).toMatchObject({
    dateFrom: '2026-09-01',
    dateTo: '2026-09-01',
    submittedTo: '2026-09-30',
  })
  expect(filters.submittedFrom).toBeUndefined()
  await page.screenshot({
    path: resolve(directory, 'mobile-filters.png'),
    animations: 'disabled',
  })
})
