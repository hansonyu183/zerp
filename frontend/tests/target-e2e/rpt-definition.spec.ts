import { expect, test, type Page } from '@playwright/test'
import { modelBuildId } from '@zerp/model'
async function signin(page: Page) {
  const response = await page.request.post(
    `${process.env.TARGET_API_BASE_URL}/session/auth/signin`,
    {
      headers: { 'X-ZERP-Model-Build': modelBuildId },
      data: {
        code: process.env.TARGET_E2E_REPORT_USERNAME,
        password: process.env.TARGET_E2E_REPORT_PASSWORD,
      },
    },
  )
  expect((await response.json()).code).toBe(0)
}
for (const width of [1280, 390]) {
  test(`RPT definition maintenance and current navigation names at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await signin(page)
    await page.goto('/rpt/definition')
    if (width === 390)
      await page.getByRole('button', { name: '切换导航' }).click()
    await page.locator('.v-navigation-drawer a[href="/rpt/definition"]').click()
    if (width === 390)
      await page.getByRole('button', { name: '切换导航' }).click()
    await expect(
      page.locator('.management-page > .v-card > .v-card-title'),
    ).toBeVisible()
    const name = `任意报表名称${width}-${Date.now()}`
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const editor = page
      .getByRole('dialog')
      .filter({ has: page.getByLabel('SQL', { exact: true }) })
    await editor.getByLabel('名称', { exact: true }).fill(name)
    await editor
      .getByLabel('SQL', { exact: true })
      .fill('SELECT 1::integer AS total')
    await editor
      .getByRole('region', { name: '结果列' })
      .getByRole('button', { name: '新增', exact: true })
      .click()
    const child = page.getByRole('dialog', { name: '新增', exact: true })
    await child.getByLabel('列别名', { exact: true }).fill('total')
    await child.getByLabel('中文名称', { exact: true }).fill('总数')
    await child.getByLabel('类型', { exact: true }).press('ArrowDown')
    await page.getByRole('option', { name: '整数', exact: true }).click()
    await child.getByRole('button', { name: '确定', exact: true }).click()
    await editor.getByRole('button', { name: '验证保存', exact: true }).click()
    await expect(editor).toContainText('已保存，当前定义已生效')
    const code = (await editor.textContent())!.match(/rpt-\d{6}/)![0]
    await editor
      .getByLabel('SQL', { exact: true })
      .fill('DELETE FROM rpt_definitions')
    await editor.getByRole('button', { name: '验证保存', exact: true }).click()
    await expect(editor).toContainText('定义验证失败')
    await expect(editor.getByLabel('SQL', { exact: true })).toHaveValue(
      'DELETE FROM rpt_definitions',
    )
    await editor.getByRole('button', { name: '取消', exact: true }).click()
    await page.reload()
    await page.getByLabel('关键词', { exact: true }).fill(name)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    const row = page.locator('tbody tr, .list-card').filter({ hasText: name })
    await row.getByRole('button', { name: '查看', exact: true }).click()
    const viewer = page.getByRole('dialog').filter({ hasText: '查看报表定义' })
    await expect(viewer.getByLabel('SQL', { exact: true })).toHaveValue(
      'SELECT 1::integer AS total',
    )
    await viewer.getByRole('button', { name: '关闭', exact: true }).click()
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    const editing = page.getByRole('dialog').filter({ hasText: '编辑报表定义' })
    await editing.getByLabel('名称', { exact: true }).fill(`${name}改名`)
    await editing.getByRole('button', { name: '验证保存', exact: true }).click()
    await expect(editing).toContainText('已保存')
    await editing.getByRole('button', { name: '取消', exact: true }).click()
    // Existing Session grants retain their identity while the saved name refreshes.
    if (width === 390)
      await page.getByRole('button', { name: '切换导航' }).click()
    const link = page.locator(`.v-navigation-drawer a[href="/rpt/${code}"]`)
    await expect(link).toContainText(`${name}改名`)
    await link.click()
    await expect(page.getByTestId('report-page')).toContainText(`${name}改名`)
    await expect(
      page.getByText(`ZERP / ${name}改名`, { exact: true }),
    ).toContainText(`${name}改名`)
    await expect(
      page.getByTestId('report-page').locator('tbody tr, .list-card'),
    ).toHaveCount(1)
    if (
      width === 390 &&
      (await page.locator('.v-navigation-drawer--active').count())
    ) {
      await page.getByRole('button', { name: '切换导航' }).click()
      await expect(page.locator('.v-navigation-drawer--active')).toHaveCount(0)
    }
    await page.screenshot({
      animations: 'disabled',
      path: `../.scratch/456/rpt-${width}.png`,
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  })
}
