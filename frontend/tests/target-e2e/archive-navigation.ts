import { expect, type Page } from '@playwright/test'
export async function openArchive(
  page: Page,
  domain: 'bob' | 'dcl',
  entity: string,
  width?: number,
) {
  if (width) await page.setViewportSize({ width, height: 960 })
  await page.goto('/')
  const drawer = page.locator('.v-navigation-drawer')
  if (
    !(await drawer.getAttribute('class'))?.includes(
      'v-navigation-drawer--active',
    )
  )
    await page.getByRole('button', { name: '切换导航', exact: true }).click()
  const path = `/${domain}/${entity}`
  const group = drawer
    .locator('.v-list-group')
    .filter({ has: page.locator(`a[href="${path}"]`) })
  if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
    await group.locator('.v-list-group__header').click()
  await drawer.locator(`a[href="${path}"]`).click()
  await page.waitForURL(`**${path}`)
  await expect(
    page.getByLabel('编码、拼音或名称', { exact: true }),
  ).toBeVisible()
}
export async function findArchive(page: Page, name: string) {
  await page.getByLabel('编码、拼音或名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(
    page.locator('tr, .list-card').filter({ hasText: name }),
  ).toHaveCount(1)
}
