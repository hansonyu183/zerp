import { randomBytes } from 'node:crypto'
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
  option: string,
) {
  await scope
    .locator('.v-select')
    .filter({ has: page.getByLabel(label, { exact: true }) })
    .locator('.v-field')
    .click()
  await page.getByRole('option').filter({ hasText: option }).click()
}
async function approve(page: Page, name: string, compare = false) {
  await page.goto('/bob/customer')
  await page.getByRole('button', { name: '提交记录', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('搜索编码或名称', { exact: true }).fill(name)
  const queried = page.waitForResponse(
    (response) =>
      response.url().endsWith('/bob/customer/submission-query') &&
      response.request().postDataJSON()?.filters?.keyword === name,
  )
  await dialog.getByRole('button', { name: '搜索', exact: true }).click()
  await queried
  const detailResponse = page.waitForResponse((response) =>
    response.url().endsWith('/bob/customer/submission-get'),
  )
  await dialog
    .getByRole('row')
    .filter({ hasText: '待批准' })
    .getByRole('button', { name: '查看', exact: true })
    .click()
  const detail = await (await detailResponse).json()
  expect(detail.data.availableApprovalActions).toContain('approve')
  await expect(dialog).toContainText('汇款识别')
  if (compare) {
    await expect(dialog).toContainText('与上一版本的定价差异')
    await expect(dialog).toContainText('金额变化')
  }
  await dialog.getByRole('button', { name: '批准', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: '反批准', exact: true }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
}

test('customer full temporary form, two subunits, history and independent enablement work in the real browser', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const reviewerContext = await browser.newContext()
  const reviewer = await reviewerContext.newPage()
  try {
    await signin(page)
    await signin(reviewer, true)
    let staged = 0
    page.on('response', (response) => {
      if (response.url().endsWith('/bob/customer/attachment-stage')) staged += 1
    })
    const tag = randomBytes(5).toString('hex'),
      name = `浏览器客户${tag}`
    await page.goto('/bob/customer')
    await page.getByRole('button', { name: '新增客户', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('身份类型', { exact: true })).toHaveValue(
      '大陆企业',
    )
    await dialog.getByLabel('显示名称', { exact: true }).fill('关闭即丢弃')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '新增客户', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('显示名称', { exact: true })).toHaveValue('')
    await select(page, dialog, '身份类型', '其他')
    for (const [label, value] of [
      ['法定名称', name],
      ['显示名称', name],
      ['法定识别号', `BROWSER-${tag}`],
      ['联系电话', '13900000000'],
      ['邮箱', 'customer@example.test'],
      ['地址', '客户联系地址'],
      ['开票抬头', name],
      ['开票地址', '税务地址'],
      ['开票电话', '05920000000'],
      ['开票开户行', '测试银行'],
      ['开票账号', '12345678'],
    ])
      await dialog.getByLabel(label!, { exact: true }).fill(value!)
    await dialog
      .getByRole('button', { name: '添加汇款识别', exact: true })
      .click()
    await dialog.getByLabel('付款户名', { exact: true }).fill('汇款识别户名')
    await dialog.getByLabel('付款银行', { exact: true }).fill('来款银行')
    await dialog.getByLabel('付款账号', { exact: true }).fill('87654321')
    await dialog
      .locator('input[type=file]')
      .first()
      .setInputFiles({
        name: '税务.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n%%EOF'),
      })
    await expect(dialog).toContainText('税务.pdf')
    expect(staged).toBe(0)
    await dialog
      .getByRole('button', { name: '添加子单位', exact: true })
      .click()
    const subunits = dialog
      .locator('fieldset > .v-card')
      .filter({ has: page.getByLabel('子单位名称', { exact: true }) })
    await expect(subunits).toHaveCount(2)
    for (let i = 0; i < 2; i++) {
      const sub = subunits.nth(i)
      await sub
        .getByLabel('子单位名称', { exact: true })
        .fill(i ? '分部' : '总部')
      await sub.getByLabel('联系人', { exact: true }).fill(`联系人${i}`)
      await sub.getByLabel('业务地址', { exact: true }).fill(`业务地址${i}`)
      await select(page, sub, '客户类型', process.env.TARGET_E2E_CUSTOMER_TYPE!)
      await select(page, sub, '业务归属类型', '渠道商')
      await select(
        page,
        sub,
        '主要业务归属',
        process.env.TARGET_E2E_CUSTOMER_PARTNER!,
      )
      await sub.getByLabel('默认加价单价', { exact: true }).fill('0.10')
      await sub.getByLabel('内部提醒', { exact: true }).fill('内部提醒内容')
      await sub
        .getByLabel('默认销售订单备注', { exact: true })
        .fill('订单默认内容')
      await sub
        .getByRole('button', { name: '添加信用额度', exact: true })
        .click()
      await sub.getByLabel('信用额度', { exact: true }).fill('10000.00')
      await sub.getByRole('button', { name: '添加成本项', exact: true }).click()
      await sub.getByLabel('成本名称', { exact: true }).fill('装卸')
      await sub.getByLabel('成本单价', { exact: true }).fill('0.20')
    }
    await dialog.getByRole('button', { name: '提交', exact: true }).click()
    await expect
      .poll(() =>
        dialog
          .locator('.v-alert')
          .allTextContents()
          .then((texts) => texts.filter((text) => !text.includes('克隆预填'))),
      )
      .toEqual([])
    await expect(dialog).toHaveCount(0)
    expect(staged).toBe(1)
    await approve(reviewer, name)
    await page.reload()
    await page.getByLabel('编码、拼音或名称', { exact: true }).fill(name)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    let row = page.getByRole('row').filter({ hasText: name })
    await row.getByRole('button', { name: '停用', exact: true }).click()
    await expect(
      row.getByRole('button', { name: '启用', exact: true }),
    ).toBeVisible()
    await row.getByRole('button', { name: '提交变更', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('子单位名称', { exact: true })).toHaveCount(
      2,
    )
    await expect(dialog.getByLabel('开票账号', { exact: true })).toHaveValue(
      '12345678',
    )
    await dialog
      .getByLabel('默认加价单价', { exact: true })
      .first()
      .fill('0.30')
    await dialog.getByRole('button', { name: '提交', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await approve(reviewer, name, true)
    await page.reload()
    await page.getByLabel('编码、拼音或名称', { exact: true }).fill(name)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    row = page.getByRole('row').filter({ hasText: name })
    await expect(
      row.getByRole('button', { name: '启用', exact: true }),
    ).toBeVisible()
    await row.getByRole('button', { name: '启用', exact: true }).click()
    await expect(
      row.getByRole('button', { name: '停用', exact: true }),
    ).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await row.getByRole('button', { name: '查看', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('SUB-0002')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '关闭', exact: true })
      .click()
  } finally {
    await reviewerContext.close()
  }
})
