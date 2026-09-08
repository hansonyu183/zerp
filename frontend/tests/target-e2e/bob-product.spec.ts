import { randomBytes } from 'node:crypto'
import { modelBuildId } from '@zerp/model'
import { expect, test, type Page, type Locator } from '@playwright/test'

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
async function select(page: Page, scope: Locator, label: string, name: string) {
  await scope
    .locator('.v-select')
    .filter({ has: page.getByLabel(label, { exact: true }) })
    .locator('.v-field')
    .click()
  await page.getByRole('option', { name, exact: true }).click()
}
async function approve(page: Page, name: string) {
  await page.goto('/bob/product')
  await page.getByRole('button', { name: '提交记录', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('搜索编码或名称', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: '搜索', exact: true }).click()
  await dialog
    .getByRole('button', { name: '查看', exact: true })
    .first()
    .click()
  await dialog.getByRole('button', { name: '批准', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: '反批准', exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
}

test('product temporary form, exact quantity trial, approval and independent enablement work on desktop and mobile', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000)
  const reviewerContext = await browser.newContext()
  const reviewer = await reviewerContext.newPage()
  try {
    await signin(page)
    await signin(reviewer, true)
    const tag = randomBytes(6).toString('hex')
    const name = `浏览器产品${tag}`
    const unitName = `产品单位${tag}`,
      categoryName = `产品分类${tag}`,
      typeName = `产品原料${tag}`,
      finishedName = `产品成品${tag}`
    const restored = await page.request.post(
      `${process.env.TARGET_API_BASE_URL}/session/auth/restore`,
      { data: {}, headers: { 'x-zerp-model-build': modelBuildId } },
    )
    const { data: session } = await restored.json()
    for (const [entity, data] of [
      ['measurement-unit', { name: unitName, symbol: 'kg', quantityScale: 6 }],
      ['product-category', { name: categoryName, description: '' }],
      [
        'product-type',
        { name: typeName, description: '', behaviorProfile: 'RAW_MATERIAL' },
      ],
      [
        'product-type',
        {
          name: finishedName,
          description: '',
          behaviorProfile: 'STANDARD_FINISHED',
        },
      ],
    ] as const) {
      const response = await page.request.post(
        `${process.env.TARGET_API_BASE_URL}/aux/${entity}/create`,
        {
          data,
          headers: {
            'x-zerp-model-build': modelBuildId,
            'x-csrf-token': session.csrfToken,
          },
        },
      )
      expect((await response.json()).code).toBe(0)
    }
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto('/bob/product')
    await page.getByRole('button', { name: '新增产品', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('名称', { exact: true }).fill('关闭即丢弃')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '新增产品', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('')
    await dialog.getByRole('button', { name: '提交', exact: true }).click()
    await expect(dialog).toContainText('名称：请填写名称。')
    await dialog.getByLabel('名称', { exact: true }).fill(name)
    await dialog.getByLabel('条码', { exact: true }).fill(`BROWSER-${tag}`)
    await dialog.getByLabel('规格', { exact: true }).fill('规格完整')
    await dialog.getByLabel('型号', { exact: true }).fill('型号完整')
    await select(page, dialog, '产品类型', typeName)
    await select(page, dialog, '产品分类', categoryName)
    await select(page, dialog, '计价单位', unitName)
    await select(page, dialog, '默认录入单位', unitName)
    await dialog
      .getByLabel('默认包装规格（基准数量）', { exact: true })
      .fill('1.000001')
    await dialog.getByRole('button', { name: '添加换算', exact: true }).click()
    await select(page, dialog, '录入单位', unitName)
    await dialog.getByLabel('换算系数', { exact: true }).fill('2.5')
    await select(page, dialog, '试算单位', unitName)
    await dialog
      .getByLabel('试算录入数量', { exact: true })
      .fill('9007199254740993.000001')
    await expect(dialog).toContainText('22517998136852482.5000025')
    await dialog.getByRole('button', { name: '提交', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await approve(reviewer, name)
    await page.reload()
    await page.getByLabel('编码、拼音或名称', { exact: true }).fill(name)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: name })
    await row.getByRole('button', { name: '停用', exact: true }).click()
    await expect(
      row.getByRole('button', { name: '启用', exact: true }),
    ).toBeVisible()
    await row.getByRole('button', { name: '提交变更', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('规格', { exact: true })).toHaveValue(
      '规格完整',
    )
    await dialog.getByLabel('备注', { exact: true }).fill('批准候选不覆盖停用')
    await dialog.getByRole('button', { name: '提交', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await approve(reviewer, name)
    await page.setViewportSize({ width: 390, height: 960 })
    await page.reload()
    await page.getByLabel('编码、拼音或名称', { exact: true }).fill(name)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await expect(
      row.getByRole('button', { name: '启用', exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await row.getByRole('button', { name: '克隆', exact: true }).click()
    dialog = page.getByRole('dialog')
    await select(page, dialog, '产品类型', finishedName)
    await dialog.getByRole('button', { name: '确认切换', exact: true }).click()
    await dialog.getByRole('button', { name: '填写配方', exact: true }).click()
    await dialog
      .getByLabel('产量基准数量', { exact: true })
      .fill('9007199254740993.000001')
    await dialog.getByRole('button', { name: '添加原料', exact: true }).click()
    await expect(
      dialog.getByLabel('用量基准数量', { exact: true }),
    ).toBeVisible()
    await expect(
      dialog.getByLabel('产量基准数量', { exact: true }),
    ).toHaveValue('9007199254740993.000001')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  } finally {
    await reviewerContext.close()
  }
})
