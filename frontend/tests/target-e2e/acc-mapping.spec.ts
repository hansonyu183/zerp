import { expect, test, type Locator, type Page } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

async function select(page: Page, scope: Locator, label: string, name: string) {
  await scope
    .locator('.v-select')
    .filter({ has: page.getByLabel(label, { exact: true }) })
    .locator('.v-field')
    .click()
  await page.getByRole('option', { name, exact: true }).click()
}

test('ACC current mapping saves through the real resource page and discards temporary edits on mobile', async ({
  page,
}) => {
  const facts = JSON.parse(process.env.TARGET_E2E_ACC_FACTS_JSON!) as {
    book: { id: string; name: string }
    vouEntity: { code: string; name: string }
  }
  const auth = await page.request.post(
    `${process.env.TARGET_API_BASE_URL}/session/auth/signin`,
    {
      headers: { 'X-ZERP-Model-Build': modelBuildId },
      data: {
        code: process.env.TARGET_E2E_USERNAME,
        password: process.env.TARGET_E2E_PASSWORD,
      },
    },
  )
  expect((await auth.json()).code).toBe(0)
  await page.goto('/acc/mapping')
  await expect(
    page.getByRole('button', { name: '新增映射', exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('.v-navigation-drawer a[href="/acc/mapping"]'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: '新增映射', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await select(page, dialog, '映射账簿', facts.book.name)
  await select(page, dialog, '单据类型', facts.vouEntity.name)
  await select(page, dialog, '未命中规则时', '记账')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toContainText('映射配置无效')
  await expect(dialog.getByLabel('映射账簿', { exact: true })).toHaveValue(
    facts.book.name,
  )
  await select(page, dialog, '未命中规则时', '不记账')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toContainText('已保存，后续记账使用此配置。')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await select(page, page.locator('main'), '账簿', facts.book.name)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: facts.vouEntity.name })
  await expect(row).toContainText('不记账')
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await expect(dialog).not.toContainText('批准')
  await expect(dialog.getByLabel('映射账簿', { exact: true })).toBeDisabled()
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog.getByRole('button', { name: '添加规则', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: '删除规则', exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: '删除规则', exact: true }),
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', { name: '保存', exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  const width = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }))
  expect(width.content).toBeLessThanOrEqual(width.viewport)
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
