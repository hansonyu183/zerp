import { randomBytes } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

async function signin(page: Page, reviewer = false) {
  await page.goto('/signin')
  await page
    .getByLabel('用户编码', { exact: true })
    .fill(
      process.env[
        reviewer ? 'TARGET_E2E_REVIEWER_USERNAME' : 'TARGET_E2E_USERNAME'
      ]!,
    )
  await page
    .getByLabel('密码', { exact: true })
    .fill(
      process.env[
        reviewer ? 'TARGET_E2E_REVIEWER_PASSWORD' : 'TARGET_E2E_PASSWORD'
      ]!,
    )
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
}

async function open(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 960 })
  await page.goto(path)
  await expect(
    page.getByLabel('编码、拼音或名称', { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
}

async function records(page: Page, name: string) {
  const tab = page.getByRole('button', { name: '提交记录', exact: true })
  if (await tab.isEnabled()) await tab.click()
  await page.getByLabel('编码、拼音或名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '查看', exact: true }),
  ).toHaveCount(1)
  await page.getByRole('button', { name: '查看', exact: true }).click()
  return page.getByRole('dialog')
}

for (const [entity, title] of [
  ['supplier', '供应商'],
  ['other-unit', '其他单位'],
  ['sales-partner', '销售合作方'],
] as const) {
  test(`${title} separates submissions, approved current data and enablement on desktop and mobile`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000)
    const reviewContext = await browser.newContext()
    const reviewer = await reviewContext.newPage()
    try {
      await signin(page)
      await signin(reviewer, true)
      const tag = randomBytes(8).toString('hex').toUpperCase()
      const name = `浏览器${title}${tag}`
      const path = `/bob/${entity}`
      await open(page, path, 1440)
      await page
        .getByRole('button', { name: `新增${title}`, exact: true })
        .click()
      let dialog = page.getByRole('dialog')
      await dialog.getByLabel('法定名称', { exact: true }).fill('应丢弃的输入')
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await page
        .getByRole('button', { name: `新增${title}`, exact: true })
        .click()
      dialog = page.getByRole('dialog')
      await expect(dialog.getByLabel('法定名称', { exact: true })).toHaveValue(
        '',
      )
      await dialog.getByLabel('法定名称', { exact: true }).fill(name)
      await dialog.getByLabel('显示名称', { exact: true }).fill(name)
      await dialog
        .getByLabel('法定识别号', { exact: true })
        .fill(`BROWSER${tag}`)
      await dialog.getByLabel('联系人', { exact: true }).fill('浏览器联系人')
      await dialog.getByLabel('联系电话', { exact: true }).fill('1234567')
      await dialog.getByLabel('地址', { exact: true }).fill('浏览器地址')
      await dialog.getByLabel('备注', { exact: true }).fill('首个版本')
      if (entity === 'sales-partner') {
        await dialog
          .locator('.v-select')
          .filter({ hasText: '合作能力' })
          .locator('.v-field')
          .click()
        await page.getByRole('option').filter({ hasText: '渠道商' }).click()
        await page.keyboard.press('Escape')
      }
      await dialog.getByRole('button', { name: '提交', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await page.getByLabel('编码、拼音或名称', { exact: true }).fill(name)
      await page.getByRole('button', { name: '查询', exact: true }).click()
      await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(
        0,
      )
      await open(reviewer, path, 1440)
      const approval = await records(reviewer, name)
      await expect(approval).toContainText('浏览器联系人')
      await approval.getByRole('button', { name: '批准', exact: true }).click()
      await expect(
        approval.getByRole('button', { name: '反批准', exact: true }),
      ).toBeVisible()
      await approval.getByRole('button', { name: '关闭', exact: true }).click()
      await open(page, path, 390)
      await page.getByLabel('编码、拼音或名称', { exact: true }).fill(name)
      await page.getByRole('button', { name: '查询', exact: true }).click()
      const row = page.getByRole('row').filter({ hasText: name })
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: '查看', exact: true }).click()
      await expect(page.getByRole('dialog')).toContainText('浏览器联系人')
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '关闭', exact: true })
        .click()
      await row.getByRole('button', { name: '停用', exact: true }).click()
      await expect(
        row.getByRole('button', { name: '启用', exact: true }),
      ).toBeVisible()
      await row.getByRole('button', { name: '提交变更', exact: true }).click()
      dialog = page.getByRole('dialog')
      await expect(dialog.getByLabel('法定名称', { exact: true })).toHaveValue(
        name,
      )
      await dialog.getByLabel('备注', { exact: true }).fill('第二个版本')
      await dialog.getByRole('button', { name: '提交', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const revision = await records(reviewer, name)
      await expect(revision).toContainText('第二个版本')
      await revision.getByRole('button', { name: '批准', exact: true }).click()
      await expect(
        revision.getByRole('button', { name: '反批准', exact: true }),
      ).toBeVisible()
      await revision.getByRole('button', { name: '关闭', exact: true }).click()
      await page.getByRole('button', { name: '查询', exact: true }).click()
      await expect(
        row.getByRole('button', { name: '启用', exact: true }),
      ).toBeVisible()
      await row.getByRole('button', { name: '克隆', exact: true }).click()
      dialog = page.getByRole('dialog')
      await expect(dialog.getByLabel('法定名称', { exact: true })).toHaveValue(
        name,
      )
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      const history = await records(page, name)
      await expect(
        history.getByRole('button', { name: /^查看版本 / }),
      ).toHaveCount(2)
      await history
        .getByRole('button', { name: '查看版本 1', exact: true })
        .click()
      await expect(history).toContainText('首个版本')
      await history.getByRole('button', { name: '关闭', exact: true }).click()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    } finally {
      await reviewContext.close()
    }
  })
}
