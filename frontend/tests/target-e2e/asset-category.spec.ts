import { randomBytes } from 'node:crypto'

import { expect, test } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

test('asset categories preserve typed defaults through menu on desktop and 390px', async ({
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
  const base = process.env.TARGET_API_BASE_URL!
  const headers = { 'x-zerp-model-build': modelBuildId }
  const restored = await (
    await page.request.post(`${base}/session/auth/restore`, {
      data: {},
      headers,
    })
  ).json()
  const post = async (action: string, data: Record<string, unknown>) =>
    (
      await page.request.post(`${base}/aux/asset-category/${action}`, {
        data,
        headers: { ...headers, 'x-csrf-token': restored.data.csrfToken },
      })
    ).json()

  const created = await post('create', {
    name: `HTTP资产${tag}`,
    defaultUsefulLifeMonths: 1,
    defaultResidualRate: '99.99',
    description: 'original',
  })
  expect(created.code).toBe(0)
  const before = await post('get', { id: created.data.id })
  expect(before.data.defaultUsefulLifeMonths).toBe(1)
  expect(before.data.defaultResidualRate).toBe('99.99')
  for (const fields of [
    { defaultUsefulLifeMonths: 0, defaultResidualRate: '5.00' },
    { defaultUsefulLifeMonths: 1201, defaultResidualRate: '5.00' },
    { defaultUsefulLifeMonths: 1.5, defaultResidualRate: '5.00' },
    { defaultUsefulLifeMonths: 120, defaultResidualRate: '-0.01' },
    { defaultUsefulLifeMonths: 120, defaultResidualRate: '100.00' },
    { defaultUsefulLifeMonths: 120, defaultResidualRate: '5.001' },
  ]) {
    const rejected = await post('save', {
      id: created.data.id,
      revision: created.data.revision,
      name: 'must not persist',
      description: 'changed',
      ...fields,
    })
    expect(rejected.errorKey).toBe('validation_failed')
    expect((await post('get', { id: created.data.id })).data).toEqual(
      before.data,
    )
  }

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.reload()
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
      .filter({ has: page.locator('a[href="/aux/asset-category"]') })
    if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
      await group.locator('.v-list-group__header').click()
    await drawer.locator('a[href="/aux/asset-category"]').click()
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

    for (let index = 0; index < (width === 1440 ? 21 : 1); index += 1) {
      await page
        .getByRole('button', { name: '新增资产类别', exact: true })
        .click()
      const dialog = page.getByRole('dialog')
      await dialog
        .getByLabel('名称', { exact: true })
        .fill(`机器设备${tag}-${width}-${index}`)
      await dialog.getByLabel('默认使用期限（月）', { exact: true }).fill('120')
      await dialog.getByLabel('默认残值率（%）', { exact: true }).fill('5.00')
      await dialog.getByLabel('说明', { exact: true }).fill('资产说明')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }

    if (width === 1440) {
      await page.getByLabel('编码、拼音或名称', { exact: true }).fill(tag)
      await page.getByRole('button', { name: '查询', exact: true }).click()
      await expect(page.getByText('共 22 项', { exact: true })).toBeVisible()
      await expect(page.locator('tr, .list-card')).toHaveCount(21)
      await page.locator('.v-pagination__item').nth(1).click()
      await expect(
        page
          .locator('tr, .list-card')
          .filter({ hasText: `机器设备${tag}-1440-20` }),
      ).toBeVisible()
    }

    const name = `机器设备${tag}-${width}-${width === 1440 ? 20 : 0}`
    for (const keyword of [name, name.replace('机器设备', 'jiqishebei')]) {
      await page.getByLabel('编码、拼音或名称', { exact: true }).fill(keyword)
      await page.getByRole('button', { name: '查询', exact: true }).click()
      await expect(
        page.locator('tr, .list-card').filter({ hasText: name }),
      ).toBeVisible()
    }
    const row = page.locator('tr, .list-card').filter({ hasText: name })
    const code = (await row.innerText()).match(/ACT-\d+/)![0]
    await page.getByLabel('编码、拼音或名称', { exact: true }).fill(code)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByLabel('默认使用期限（月）', { exact: true }),
    ).toHaveValue('120')
    await dialog.getByLabel('默认使用期限（月）', { exact: true }).fill('240')
    await dialog.getByLabel('默认残值率（%）', { exact: true }).fill('3.25')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await row.getByRole('button', { name: '停用', exact: true }).click()
    await row.getByRole('button', { name: '启用', exact: true }).click()

    await row.getByRole('button', { name: '编辑', exact: true }).click()
    await dialog.getByLabel('默认使用期限（月）', { exact: true }).fill('0')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog.getByText(/1–1200/)).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()

    await row.getByRole('button', { name: '编辑', exact: true }).click()
    await page.route('**/aux/asset-category/save', (route) =>
      route.fulfill({
        json: {
          code: 3001,
          errorKey: 'conflict',
          message: 'conflict',
          data: null,
          requestId: 'asset-category-conflict',
        },
      }),
    )
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog.getByText(/状态已变化/)).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.unroute('**/aux/asset-category/save')

    await row.getByRole('button', { name: '编辑', exact: true }).click()
    await page.route('**/aux/asset-category/query', (route) => route.abort())
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('操作已成功，但列表刷新失败。')).toBeVisible()
    await page.unroute('**/aux/asset-category/query')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
})
