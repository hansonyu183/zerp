import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

test('payment methods use typed fields through menu on desktop and 390px', async ({
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
      await page.request.post(`${base}/aux/payment-method/${action}`, {
        data,
        headers: { ...headers, 'x-csrf-token': restored.data.csrfToken },
      })
    ).json()
  const created = await post('create', {
    name: `HTTP-${tag}`,
    defaultSalesSurcharge: '9007199254740993.12',
    description: 'original',
  })
  expect(created.code).toBe(0)
  const before = await post('get', { id: created.data.id })
  expect(before.data.defaultSalesSurcharge).toBe('9007199254740993.12')
  for (const amount of ['-1', '0.001', '1e2', '01.00', '']) {
    const rejected = await post('save', {
      id: created.data.id,
      revision: created.data.revision,
      name: 'must not persist',
      description: 'changed',
      defaultSalesSurcharge: amount,
    })
    expect(rejected.errorKey).toBe('validation_failed')
    expect((await post('get', { id: created.data.id })).data).toEqual(
      before.data,
    )
  }
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
      .filter({ has: page.locator('a[href="/aux/payment-method"]') })
    if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
      await group.locator('.v-list-group__header').click()
    await drawer.locator('a[href="/aux/payment-method"]').click()
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
        .getByRole('button', { name: '新增收款方式', exact: true })
        .click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('说明', { exact: true }).fill('收款说明')
      await dialog
        .getByLabel('名称', { exact: true })
        .fill(`现金${tag}-${width}-${index}`)
      await dialog
        .getByLabel('默认销售加价（元/kg）', { exact: true })
        .fill(width === 1440 ? '0.01' : '0.02')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }
    const name = `现金${tag}-1440-20`
    for (const keyword of [name, `xianjin${tag}-1440-20`]) {
      await page.getByLabel('编码、拼音或名称', { exact: true }).fill(keyword)
      await page.getByRole('button', { name: '查询', exact: true }).click()
      await expect(
        page.getByRole('row').filter({ hasText: name }),
      ).toBeVisible()
    }
    const row = page.getByRole('row').filter({ hasText: name })
    const code = (await row.innerText()).match(/PMT-\d+/)![0]
    await page.getByLabel('编码、拼音或名称', { exact: true }).fill(code)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('说明', { exact: true })).toHaveValue(
      '收款说明',
    )
    await dialog
      .getByLabel('默认销售加价（元/kg）', { exact: true })
      .fill('0.02')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await row.getByRole('button', { name: '停用', exact: true }).click()
    await row.getByRole('button', { name: '启用', exact: true }).click()
    await expect(
      row.getByRole('button', { name: '停用', exact: true }),
    ).toBeVisible()
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    await dialog
      .getByLabel('默认销售加价（元/kg）', { exact: true })
      .fill('-0.01')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(
      dialog.getByText('请输入有效的销售加价（非负，最多两位小数）。'),
    ).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(
      dialog.getByLabel('默认销售加价（元/kg）', { exact: true }),
    ).toHaveValue('0.02')
    await page.route('**/aux/payment-method/save', (route) =>
      route.fulfill({
        json: {
          code: 3001,
          errorKey: 'conflict',
          message: 'conflict',
          data: null,
          requestId: 'browser-conflict',
        },
      }),
    )
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(
      dialog.getByText('当前辅助资料状态已变化，请刷新列表后重试。'),
    ).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.unroute('**/aux/payment-method/save')
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue(name)
    await page.route('**/aux/payment-method/query', (route) => route.abort())
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('操作已成功，但列表刷新失败。')).toBeVisible()
    await page.unroute('**/aux/payment-method/query')
  }
})
