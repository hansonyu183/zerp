import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/signin')
  await page
    .getByLabel('用户编码', { exact: true })
    .fill(process.env.TARGET_E2E_USERNAME!)
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TARGET_E2E_PASSWORD!)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
}

// All writes go through the visible user page and real isolated HTTP service.
// Screenshots are taken only before any password has been entered.
test('menu opens a real user list and creates, renames, disables and enables a user', async ({
  page,
}) => {
  await signIn(page)
  const drawer = page.locator('.v-navigation-drawer')
  const closed = drawer.locator(
    '.v-list-group:not(.v-list-group--open) > .v-list-group__header',
  )
  while (await closed.count()) await closed.first().click()
  await drawer.locator('a[href="/app/user"]').click()
  const keyword = page.getByLabel('编码、拼音或名称', { exact: true })
  await expect(keyword).toBeVisible()
  await expect(page.getByTestId('business-unimplemented')).toHaveCount(0)
  const code = `ui-${randomBytes(6).toString('hex')}`
  await page.getByRole('button', { name: '新增用户', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('用户编码', { exact: true }).fill(code)
  await dialog.getByLabel('名称', { exact: true }).fill('上海测试用户')
  await dialog.locator('.v-select .v-field').click()
  await page
    .locator('[role="option"]:not(.v-list-item--disabled)')
    .filter({ hasText: 'Target E2E Role' })
    .first()
    .click()
  await page.keyboard.press('Escape')
  await dialog
    .getByLabel('初始密码', { exact: true })
    .fill(`Aa1!${randomBytes(24).toString('base64url')}`)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await keyword.fill(code)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: code })
  await expect(row).toContainText('上海测试用户')
  await row.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(dialog.getByLabel('用户编码', { exact: true })).toBeDisabled()
  await expect(dialog.getByLabel('初始密码', { exact: true })).toHaveCount(0)
  await dialog.getByLabel('名称', { exact: true }).fill('北京测试用户')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(row).toContainText('北京测试用户')
  await keyword.fill('beijingceshiyonghu')
  await keyword.press('Enter')
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '停用', exact: true }).click()
  await expect(
    row.getByRole('button', { name: '启用', exact: true }),
  ).toBeVisible()
  await row.getByRole('button', { name: '启用', exact: true }).click()
  await expect(
    row.getByRole('button', { name: '停用', exact: true }),
  ).toBeVisible()
})

test('user list and reused editor remain usable at desktop and 390px in both themes', async ({
  browser,
}) => {
  const directory = resolve(process.cwd(), '..', '.scratch', 'issue-381-user')
  mkdirSync(directory, { recursive: true })
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 800 },
    })
    try {
      const page = await context.newPage()
      await signIn(page)
      await page.goto('/app/user')
      await expect(
        page
          .getByRole('cell', { name: 'Target E2E User', exact: true })
          .first(),
      ).toBeVisible()
      for (const theme of ['light', 'dark']) {
        if (theme === 'dark') await page.getByLabel('切换深色模式').click()
        await expect(
          page.getByRole('button', { name: '新增用户', exact: true }),
        ).toBeVisible()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        await page.screenshot({
          animations: 'disabled',
          path: resolve(directory, `${width}-${theme}-list.png`),
        })
        await page
          .getByRole('button', { name: '新增用户', exact: true })
          .click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByLabel('角色', { exact: true })).toBeEnabled()
        await expect(
          dialog.getByRole('button', { name: '保存', exact: true }),
        ).toBeVisible()
        await expect(
          dialog.getByLabel('初始密码', { exact: true }),
        ).toHaveValue('')
        await page.screenshot({
          animations: 'disabled',
          path: resolve(directory, `${width}-${theme}-editor.png`),
        })
        await dialog.getByRole('button', { name: '取消', exact: true }).click()
        await expect(dialog).toHaveCount(0)
      }
    } finally {
      await context.close()
    }
  }
})
