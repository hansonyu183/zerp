import { expect, type Page } from '@playwright/test'
export async function confirmCollection(page: Page) {
  const dialog = page.getByRole('dialog', { name: /^编辑/ }).last()
  const element = await dialog.elementHandle()
  await dialog.getByRole('button', { name: '确定', exact: true }).click()
  await element!.waitForElementState('hidden')
}
export async function confirmCollections(page: Page) {
  for (let depth = 0; depth < 8; depth++) {
    if (!(await page.getByRole('dialog', { name: /^编辑/ }).count())) return
    await confirmCollection(page)
  }
  throw new Error('子项编辑弹窗未关闭')
}
export async function editCollection(page: Page, caption: string, index = 0) {
  await page
    .getByRole('dialog')
    .last()
    .locator(`.collection-block[aria-label="${caption}"]`)
    .getByRole('button', { name: '编辑', exact: true })
    .nth(index)
    .click()
  await expect(
    page.getByRole('dialog', { name: `编辑${caption}`, exact: true }).last(),
  ).toBeVisible()
}
export async function setDateRange(
  page: Page,
  caption: string,
  from: string,
  to: string,
) {
  await page.getByLabel(caption, { exact: true }).click()
  const menu = page.locator('.v-menu.v-overlay--active')
  await menu.getByLabel('开始日期', { exact: true }).fill(from)
  await menu.getByLabel('结束日期', { exact: true }).fill(to)
  await menu.getByRole('button', { name: '完成', exact: true }).click()
  await expect(page.getByLabel(caption, { exact: true })).toHaveValue(
    `${from || '不限'} 至 ${to || '不限'}`,
  )
}
