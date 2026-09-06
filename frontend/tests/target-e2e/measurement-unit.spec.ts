import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('measurement units use typed fields through menu on desktop and 390px', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.goto('/signin')
  await page
    .getByLabel('用户编码', { exact: true })
    .fill(process.env.TARGET_E2E_USERNAME!)
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TARGET_E2E_PASSWORD!)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
  const tag = randomBytes(4).toString('hex')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.reload()
    await expect(
      page.getByRole('button', { name: '切换导航', exact: true }),
    ).toBeVisible()
    const drawer = page.locator('.v-navigation-drawer')
    if (
      !(await drawer.getAttribute('class'))?.includes(
        'v-navigation-drawer--active',
      )
    )
      await page.getByRole('button', { name: '切换导航', exact: true }).click()
    await expect(drawer).toHaveClass(/v-navigation-drawer--active/)
    const group = drawer
      .locator('.v-list-group')
      .filter({ has: page.locator('a[href="/aux/measurement-unit"]') })
    if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
      await group.locator('.v-list-group__header').click()
    await drawer.locator('a[href="/aux/measurement-unit"]').click()
    if (
      width === 390 &&
      (await drawer.getAttribute('class'))?.includes(
        'v-navigation-drawer--active',
      )
    ) {
      await page.getByRole('button', { name: '切换导航', exact: true }).click()
      await expect(drawer).not.toHaveClass(/v-navigation-drawer--active/)
    }
    await expect(page.getByTestId('business-unimplemented')).toHaveCount(0)
    for (let index = 0; index < (width === 1440 ? 21 : 1); index++) {
      await page
        .getByRole('button', { name: '新增计量单位', exact: true })
        .click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByLabel('说明', { exact: true })).toHaveCount(0)
      await dialog
        .getByLabel('名称', { exact: true })
        .fill(`千克${tag}-${width}-${index}`)
      await dialog.getByLabel('符号', { exact: true }).fill('kg')
      await dialog
        .getByLabel('数量精度', { exact: true })
        .fill(width === 1440 ? '0' : '6')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
    const name = `千克${tag}-1440-20`
    for (const keyword of [name, `qianke${tag}-1440-20`]) {
      await page.getByLabel('编码、拼音或名称', { exact: true }).fill(keyword)
      await page.getByRole('button', { name: '查询', exact: true }).click()
      await expect(
        page.getByRole('row').filter({ hasText: name }),
      ).toBeVisible()
    }
    const row = page.getByRole('row').filter({ hasText: name })
    const code = (await row.innerText()).match(/UNT-\d+/)![0]
    await page.getByLabel('编码、拼音或名称', { exact: true }).fill(code)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('符号', { exact: true })).toHaveValue('kg')
    await dialog.getByLabel('数量精度', { exact: true }).fill('6')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await row.getByRole('button', { name: '停用', exact: true }).click()
    await row.getByRole('button', { name: '启用', exact: true }).click()
    await expect(
      row.getByRole('button', { name: '停用', exact: true }),
    ).toBeVisible()
  }
})
