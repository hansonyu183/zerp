import { expect, test, type Page } from '@playwright/test'
const facts = JSON.parse(process.env.TARGET_E2E_OPENING_JSON ?? '{}')
test.skip(!process.env.TARGET_E2E_OPENING_JSON, 'Requires opening fixture')
async function signIn(page: Page, reviewer = false) {
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
  const drawer = page.locator('.v-navigation-drawer')
  const group = drawer.locator('.v-list-group').filter({ hasText: '业务单据' })
  if (!(await group.getAttribute('class'))?.includes('v-list-group--open'))
    await group.locator('.v-list-group__header').click()
  await drawer.locator('a[href="/vou/opening"]').click()
  await expect(page.getByTestId('vou-list-page')).toBeVisible()
}
async function create(page: Page) {
  await page.getByRole('button', { name: '新建', exact: true }).click()
  const editor = page.getByTestId('opening-editor')
  await editor.getByLabel('账簿', { exact: true }).fill(facts.book.name)

  await page.getByRole('option', { name: facts.book.name, exact: true }).click()
  return editor
}
async function open(page: Page) {
  await page
    .getByTestId(`vou-row-${facts.book.id}`)
    .getByRole('button', { name: '打开', exact: true })
    .click()
  await expect(page.getByTestId('opening-snapshot')).toBeVisible()
}
async function review(page: Page, action: string, reason?: string) {
  await page
    .getByTestId('vou-detail')
    .getByRole('button', { name: action, exact: true })
    .click()
  if (reason) await page.getByLabel('操作原因').fill(reason)
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
      `/vou/opening/${action === '批准' ? 'approve' : 'unapprove'}`,
  )
  await page.getByRole('button', { name: '确定', exact: true }).click()
  expect((await (await response).json()).code).toBe(0)
}
test('real opening page submits zero, another operator approves, then replaces explicitly with balanced nonzero input', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000)
  await signIn(page)
  let editor = await create(page)
  await editor.getByRole('button', { name: '提交零期初', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await open(page)
  await expect(page.getByTestId('opening-snapshot')).toContainText('零余额期初')
  const context = await browser.newContext({
    baseURL: process.env.TARGET_WEB_BASE_URL,
  })
  const reviewer = await context.newPage()
  try {
    await signIn(reviewer, true)
    await open(reviewer)
    await review(reviewer, '批准')
    await expect(reviewer.getByTestId('vou-detail')).toContainText('已批准')
    await review(reviewer, '反批准', '重新录入期初')
  } finally {
    await context.close()
  }
  await page.reload()
  await open(page)
  await page.getByRole('button', { name: '删除开放提交', exact: true }).click()
  await page.getByRole('button', { name: '确定删除', exact: true }).click()
  await expect(page.getByTestId('vou-detail')).toHaveCount(0)
  editor = await create(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await editor.getByRole('button', { name: '添加明细', exact: true }).click()
  const debit = page.getByTestId('opening-line-0')
  await debit.getByLabel('科目', { exact: true }).fill('1001')
  await page.getByRole('option').filter({ hasText: '期初借方' }).click()
  await debit.getByLabel('金额', { exact: true }).fill('12.30')
  await editor.getByRole('button', { name: '提交期初', exact: true }).click()
  await expect(editor).toContainText('期初必须逐币种借贷平衡')
  await expect(debit.getByLabel('金额', { exact: true })).toHaveValue('12.30')
  await editor.getByRole('button', { name: '添加明细', exact: true }).click()
  const credit = page.getByTestId('opening-line-1')
  await credit.getByLabel('科目', { exact: true }).fill('3001')
  await page.getByRole('option').filter({ hasText: '期初贷方' }).click()
  await credit.locator('.v-select .v-field').click()
  await page.getByRole('option', { name: '贷方', exact: true }).click()
  await credit.getByLabel('金额', { exact: true }).fill('12.30')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false)
  await editor.getByRole('button', { name: '提交期初', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await open(page)
  await expect(page.getByTestId('opening-snapshot')).toContainText('12.30')
  await page
    .getByTestId('vou-detail')
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.reload()
  await expect(page.getByTestId('opening-editor')).toHaveCount(0)
})

test('approve-only menu does not send unauthorized opening or reference reads', async ({
  page,
}) => {
  await page.goto('/signin')
  await page
    .getByLabel('用户编码', { exact: true })
    .fill(process.env.TARGET_E2E_CREATE_ONLY_USERNAME!)
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TARGET_E2E_CREATE_ONLY_PASSWORD!)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
  const reads: string[] = []
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname
    if (/^\/(vou|acc)\/[^/]+\/(query|get)$/.test(path)) reads.push(path)
  })
  await page.goto('/vou/opening')
  await expect(page.getByTestId('vou-list-page')).toContainText(
    '当前账号没有查询权限',
  )
  await expect(
    page.getByRole('button', { name: '新建', exact: true }),
  ).toHaveCount(0)
  expect(reads).toEqual([])
})
