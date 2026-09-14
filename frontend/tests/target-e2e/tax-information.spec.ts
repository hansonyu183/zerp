import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'

for (const width of [1280, 390])
  test(`tax information validates and persists through the actual menu at ${width}px`, async ({
    page,
  }) => {
    await page.goto('/signin')
    await page
      .getByLabel('用户编码', { exact: true })
      .fill(process.env.TARGET_E2E_USERNAME!)
    await page
      .getByLabel('密码', { exact: true })
      .fill(process.env.TARGET_E2E_PASSWORD!)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
    const drawer = page.locator('.v-navigation-drawer')
    const group = drawer
      .locator('.v-list-group')
      .filter({ has: page.locator('a[href="/aux/tax-information"]') })
    if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
      await group.locator('.v-list-group__header').click()
    await drawer.locator('a[href="/aux/tax-information"]').click()
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const dialog = page.getByRole('dialog').last()
    const tag = randomBytes(5).toString('hex')
    await dialog.getByLabel('正式名称', { exact: true }).fill(`境外税务${tag}`)
    await dialog.getByLabel('税号', { exact: true }).fill(` hk ${tag} `)
    await dialog.getByLabel('基本户开户行', { exact: true }).fill('测试银行')
    const rejected = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/aux/tax-information/create',
    )
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    expect((await (await rejected).json()).errorKey).toBe('validation_failed')
    await dialog.getByLabel('基本户账号', { exact: true }).fill('123456')
    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/aux/tax-information/create',
    )
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    const result = await (await created).json()
    expect(result.code, result.errorKey).toBe(0)
    await expect(dialog).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false)
  })
