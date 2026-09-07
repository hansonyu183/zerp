import { expect, test, type Page } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

async function signin(page: Page, reviewer = false) {
  const response = await page.request.post(
    `${process.env.TARGET_API_BASE_URL}/session/auth/signin`,
    {
      headers: { 'X-ZERP-Model-Build': modelBuildId },
      data: {
        code: process.env[
          reviewer ? 'TARGET_E2E_REVIEWER_USERNAME' : 'TARGET_E2E_USERNAME'
        ],
        password:
          process.env[
            reviewer ? 'TARGET_E2E_REVIEWER_PASSWORD' : 'TARGET_E2E_PASSWORD'
          ],
      },
    },
  )
  const result = await response.json()
  expect(result.code).toBe(0)
  return result.data.csrfToken as string
}

test('WFL definition page edits, trials, submits, approves and preserves an old instance after a new version', async ({
  page,
  browser,
}) => {
  const facts = JSON.parse(process.env.TARGET_E2E_WFL_FACTS_JSON!) as {
    documentId: string
    submissionId: string
    script: string
  }
  await signin(page)
  await page.goto('/wfl/process-definition')
  await expect(
    page.locator('.v-navigation-drawer a[href="/wfl/process-definition"]'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: '新建定义', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Starlark 脚本').fill(facts.script)
  await dialog.getByLabel('已提交的试算单据 ID').fill(facts.documentId)
  await dialog.getByRole('button', { name: '编译并试算', exact: true }).click()
  await expect(dialog).toContainText('编译与试算成功')
  const submitted = page.waitForResponse((r) =>
    r.url().endsWith('/wfl/process-definition/submit-new'),
  )
  await dialog.getByRole('button', { name: '提交审批', exact: true }).click()
  const v1 = (await (await submitted).json()).data
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('main')).toContainText('待批准')
  const reviewerContext = await browser.newContext()
  const reviewer = await reviewerContext.newPage()
  try {
    const token = await signin(reviewer, true)
    await reviewer.goto('/wfl/process-definition')
    async function approve() {
      await reviewer
        .getByRole('button', { name: '提交记录', exact: true })
        .click()
      await reviewer
        .getByRole('row')
        .filter({ hasText: v1.code })
        .getByRole('button', { name: '打开', exact: true })
        .click()
      await reviewer.getByRole('button', { name: '批准', exact: true }).click()
      await expect(reviewer.locator('main')).toContainText('操作成功')
    }
    await approve()
    await reviewer.getByRole('button', { name: '启用', exact: true }).click()
    await expect(
      reviewer.getByRole('button', { name: '停用', exact: true }),
    ).toBeVisible()
    const root = await reviewer.request.post(
      `${process.env.TARGET_API_BASE_URL}/vou/sale-order/approve`,
      {
        headers: { 'X-ZERP-Model-Build': modelBuildId, 'X-CSRF-Token': token },
        data: {
          documentId: facts.documentId,
          submissionId: facts.submissionId,
          expectedRevision: '1',
        },
      },
    )
    expect((await root.json()).code).toBe(0)
    await page.reload()
    await page
      .getByRole('row')
      .filter({ hasText: '浏览器初版' })
      .getByRole('button', { name: '打开', exact: true })
      .click()
    await page
      .getByRole('button', { name: '查看提交与维护', exact: true })
      .click()
    await page.getByRole('button', { name: '提交新版本', exact: true }).click()
    await dialog
      .getByLabel('Starlark 脚本')
      .fill(facts.script.replace('浏览器初版', '浏览器新版'))
    await dialog.getByLabel('已提交的试算单据 ID').fill(facts.documentId)
    await dialog
      .getByRole('button', { name: '编译并试算', exact: true })
      .click()
    await expect(dialog).toContainText('编译与试算成功')
    await dialog.getByRole('button', { name: '提交审批', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await reviewer.reload()
    await approve()
    await reviewer.getByRole('button', { name: '停用', exact: true }).click()
    await reviewer.goto('/wfl/process-instance')
    await reviewer.getByText(/浏览器初版 · /).click()
    await expect(reviewer.locator('main')).toContainText(v1.submissionId)
    await reviewer
      .getByRole('button', { name: '创建 出库', exact: true })
      .click()
    await expect(reviewer.locator('main')).toContainText('待批准')
    await expect(reviewer.locator('main')).toContainText('浏览器初版')
    await page.getByRole('button', { name: '新建定义', exact: true }).click()
    await dialog.getByLabel('Starlark 脚本').fill('未提交输入')
    await page.reload()
    await expect(dialog).toHaveCount(0)
    await page.getByRole('button', { name: '新建定义', exact: true }).click()
    await expect(dialog.getByLabel('Starlark 脚本')).not.toHaveValue(
      '未提交输入',
    )
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  } finally {
    await reviewerContext.close()
  }
})
