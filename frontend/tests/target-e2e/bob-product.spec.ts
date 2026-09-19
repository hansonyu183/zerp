import { openArchive, findArchive } from './archive-navigation.ts'
import { confirmCollection } from './collection-helpers.ts'
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
async function select(
  page: Page,
  scope: Locator,
  label: string,
  name: string,
  search = false,
) {
  const control = scope
    .locator('.v-select, .v-autocomplete')
    .filter({ has: page.getByLabel(label, { exact: true }) })
  if (search) {
    // Reference candidates are paginated; search instead of assuming page one.
    const input = control.getByLabel(label, { exact: true })
    const candidates = page.waitForResponse(
      (response) =>
        new URL(response.url()).searchParams.get('keyword') === name,
    )
    await input.fill(name)
    await candidates
    await expect(control).not.toHaveClass(/v-input--loading/)
    if ((await input.getAttribute('aria-expanded')) !== 'true')
      await input.click()
  } else {
    await control.locator('.v-field').click()
  }
  await page.getByRole('option').filter({ hasText: name }).click()
}
async function approve(page: Page, name: string) {
  await openArchive(page, 'dcl', 'product')
  const dialog = page.getByRole('dialog').last()
  await findArchive(page, name)
  await page.getByRole('button', { name: '查看', exact: true }).click()
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
    const kgName = `kg-${tag}`,
      tonName = `吨-${tag}`
    for (const [entity, data] of [
      ['measurement-unit', { name: unitName, fixedFactor: null }],
      ['measurement-unit', { name: kgName, fixedFactor: '1' }],
      ['measurement-unit', { name: tonName, fixedFactor: '1000' }],
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
    await openArchive(page, 'dcl', 'product')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    let dialog = page.getByRole('dialog').last()
    await dialog.getByLabel('名称', { exact: true }).fill('关闭即丢弃')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '新增', exact: true }).click()
    dialog = page.getByRole('dialog').last()
    await expect(dialog.getByLabel('名称', { exact: true })).toHaveValue('')
    await dialog.getByRole('button', { name: '提交', exact: true }).click()
    await expect(dialog).toContainText('名称：请填写名称。')
    await dialog.getByLabel('名称', { exact: true }).fill(name)
    await dialog.getByLabel('条码', { exact: true }).fill(`BROWSER-${tag}`)
    await dialog.getByLabel('规格', { exact: true }).fill('规格完整')
    await dialog.getByLabel('型号', { exact: true }).fill('型号完整')
    await select(page, dialog, '产品类型', typeName)
    await select(page, dialog, '产品分类', categoryName, true)
    await select(page, dialog, '计价单位', kgName)
    await select(page, dialog, '默认录入单位', tonName)
    await dialog
      .getByLabel('默认包装规格（基准数量）', { exact: true })
      .fill('1.000001')
    await dialog
      .locator('.collection-block[aria-label="单位换算"] > .collection-heading')
      .getByRole('button', { name: '新增', exact: true })
      .click()
    await select(page, dialog, '录入单位', unitName)
    await dialog.getByLabel('换算系数', { exact: true }).fill('200')
    await confirmCollection(page)
    for (const fixedName of [kgName, tonName]) {
      await dialog
        .locator(
          '.collection-block[aria-label="单位换算"] > .collection-heading',
        )
        .getByRole('button', { name: '新增', exact: true })
        .click()
      await select(page, dialog, '录入单位', fixedName)
      await expect(dialog.getByLabel('换算系数', { exact: true })).toHaveCount(
        0,
      )
      await expect(dialog).toContainText('单位固定系数：')
      await confirmCollection(page)
    }
    for (const [fixedName, amount] of [
      [kgName, '1000'],
      [tonName, '1'],
    ]) {
      await select(page, dialog, '试算单位', fixedName!)
      await dialog.getByLabel('试算录入数量', { exact: true }).fill(amount!)
      await expect(dialog).toContainText('建议基准数量：1000。')
    }
    await select(page, dialog, '试算单位', unitName)
    await dialog
      .getByLabel('试算录入数量', { exact: true })
      .fill('9007199254740993.01')
    await expect(dialog).toContainText('1801439850948198602')
    await dialog.getByRole('button', { name: '提交', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await approve(reviewer, name)
    await page.reload()
    await findArchive(page, name)
    const row = page
      .locator('tr, .list-card')
      .filter({ has: page.getByRole('button', { name: '查看', exact: true }) })
    await openArchive(page, 'bob', 'product')
    await findArchive(page, name)
    await row.getByRole('button', { name: '停用', exact: true }).click()
    await expect(
      row.getByRole('button', { name: '启用', exact: true }),
    ).toBeVisible()
    await openArchive(page, 'dcl', 'product')
    await findArchive(page, name)
    await row.getByRole('button', { name: '提交变更', exact: true }).click()
    dialog = page.getByRole('dialog').last()
    await expect(dialog.getByLabel('规格', { exact: true })).toHaveValue(
      '规格完整',
    )
    await dialog.getByLabel('备注', { exact: true }).fill('批准候选不覆盖停用')
    await dialog.getByRole('button', { name: '提交', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await approve(reviewer, name)
    await openArchive(page, 'bob', 'product', 390)
    await findArchive(page, name)
    await expect(
      row.getByRole('button', { name: '启用', exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await openArchive(page, 'dcl', 'product')
    await findArchive(page, name)
    await row.getByRole('button', { name: '查看', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '克隆为新档案', exact: true })
      .click()
    dialog = page.getByRole('dialog').last()
    await select(page, dialog, '产品类型', finishedName)
    await dialog.getByRole('button', { name: '确认切换', exact: true }).click()
    await dialog.getByRole('button', { name: '填写配方', exact: true }).click()
    await dialog
      .getByLabel('配方产量基准数量', { exact: true })
      .fill('9007199254740993.000001')
    await dialog
      .locator('.collection-block[aria-label="配方原料"] > .collection-heading')
      .getByRole('button', { name: '新增', exact: true })
      .click()
    await expect(
      dialog.getByLabel('原料基准用量', { exact: true }),
    ).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(
      dialog.getByLabel('配方产量基准数量', { exact: true }),
    ).toHaveValue('9007199254740993.000001')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  } finally {
    await reviewerContext.close()
  }
})
