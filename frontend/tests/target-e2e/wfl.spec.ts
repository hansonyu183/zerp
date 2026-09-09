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
  const ownerToken = await signin(page)
  const documentResponse = await page.request.post(
    `${process.env.TARGET_API_BASE_URL}/vou/sale-order/get`,
    {
      headers: {
        'X-ZERP-Model-Build': modelBuildId,
        'X-CSRF-Token': ownerToken,
      },
      data: { documentId: facts.documentId },
    },
  )
  const documentResult = await documentResponse.json()
  expect(documentResult.code).toBe(0)
  async function selectTrial() {
    await dialog
      .getByLabel('试算单据', { exact: true })
      .fill(documentResult.data.documentNo)
    await page
      .getByRole('option', {
        name: documentResult.data.documentNo,
        exact: true,
      })
      .click()
  }
  await page.goto('/wfl/process-definition')
  await expect(
    page.locator('.v-navigation-drawer a[href="/wfl/process-definition"]'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: '新增流程定义', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Starlark 脚本').fill(facts.script)
  await selectTrial()
  await dialog.getByRole('button', { name: '编译并试算', exact: true }).click()
  await expect(dialog).toContainText('编译与试算成功')
  const submitted = page.waitForResponse((r) =>
    r.url().endsWith('/wfl/process-definition/submit-new'),
  )
  await dialog.getByRole('button', { name: '提交', exact: true }).click()
  const v1 = (await (await submitted).json()).data
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: '提交记录', exact: true }).click()
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
        .getByRole('button', { name: '查看', exact: true })
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
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page
      .getByRole('row')
      .filter({ hasText: '浏览器初版' })
      .getByRole('button', { name: '提交变更', exact: true })
      .click()
    await dialog
      .getByLabel('Starlark 脚本')
      .fill(facts.script.replace('浏览器初版', '浏览器新版'))
    await selectTrial()
    await dialog
      .getByRole('button', { name: '编译并试算', exact: true })
      .click()
    await expect(dialog).toContainText('编译与试算成功')
    await dialog.getByRole('button', { name: '提交', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await reviewer.reload()
    await approve()
    await reviewer.getByRole('button', { name: '停用', exact: true }).click()
    await reviewer.goto('/wfl/process-instance')
    await reviewer
      .locator('.v-navigation-drawer a[href="/wfl/process-instance"]')
      .click()
    await reviewer.setViewportSize({ width: 390, height: 844 })
    await reviewer.getByText(/浏览器初版 · /).click()
    await expect(reviewer.locator('main')).toContainText(v1.submissionId)
    await reviewer
      .getByRole('button', { name: '创建 出库', exact: true })
      .click()
    await expect(reviewer.locator('main')).toContainText('待批准')
    await expect(
      reviewer.getByRole('region', { name: '运行审计' }),
    ).toContainText('创建下级')
    expect(
      await reviewer.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await reviewer
      .getByRole('button', { name: '打开单据', exact: true })
      .first()
      .click()
    await expect(reviewer.getByRole('dialog')).toContainText('销售订单')
    await reviewer
      .getByRole('dialog')
      .getByRole('button', { name: '关闭', exact: true })
      .click()
    await reviewer.setViewportSize({ width: 1280, height: 900 })
    await expect(
      reviewer.getByRole('region', { name: '运行审计' }),
    ).toContainText('打开单据')
    await expect(reviewer.locator('main')).toContainText('浏览器初版')
    await page
      .getByRole('button', { name: '新增流程定义', exact: true })
      .click()
    await dialog.getByLabel('Starlark 脚本').fill('未提交输入')
    await page.reload()
    await expect(dialog).toHaveCount(0)
    await page
      .getByRole('button', { name: '新增流程定义', exact: true })
      .click()
    await expect(dialog.getByLabel('Starlark 脚本')).not.toHaveValue(
      '未提交输入',
    )
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
  } finally {
    await reviewerContext.close()
  }
})
