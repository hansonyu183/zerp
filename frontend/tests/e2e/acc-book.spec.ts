import { expect, test, type Page } from './fixtures'

test.use({ storageState: { cookies: [], origins: [] } })

async function signIn(
  page: Page,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名').fill(credentials.username)
  await page.getByLabel('密码').fill(credentials.password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).not.toHaveURL(/\/signin/)
}

async function signOut(page: Page): Promise<void> {
  await page.locator('.account-button').click()
  await page.getByText('退出登录').click()
  await expect(page).toHaveURL(/\/signin/)
}

test('两个用户通过产品界面按独立范围维护账簿且首本控制身份稳定', async ({
  page,
  workerState,
}) => {
  await signIn(page, workerState.operator)
  await page.goto('/acc/book')
  await expect(page).toHaveURL(/\/acc\/book$/)
  await expect(page.locator('.page-heading__breadcrumb')).toHaveText(
    'ZERP / 会计账簿',
  )
  const controlRow = page
    .locator('tbody tr')
    .filter({ hasText: 'E2E 控制账簿' })
  await expect(controlRow).toContainText('业务控制')
  await expect(
    controlRow.getByRole('button', { name: '更多操作' }),
  ).toHaveCount(0)

  await page.getByRole('button', { name: '新增', exact: true }).click()
  const drawer = page.locator('.v-navigation-drawer--right')
  await drawer.getByLabel('名称').fill('E2E 管理账簿')
  await drawer.getByLabel('开始月份').fill('2026-08')
  await drawer.getByLabel('基础币种').fill('CNY')
  await drawer.getByLabel('说明').fill('跨用户访问范围')
  await drawer
    .getByRole('combobox', { name: '可查询用户' })
    .fill(workerState.reviewer.username)
  await page
    .getByRole('option', { name: new RegExp(workerState.reviewer.username) })
    .last()
    .click()
  await drawer
    .getByRole('combobox', { name: '可操作用户' })
    .fill(workerState.reviewer.username)
  await page
    .getByRole('option', { name: new RegExp(workerState.reviewer.username) })
    .last()
    .click()
  await drawer.getByRole('button', { name: '保存', exact: true }).click()

  await expect(page.getByText('账簿已创建。', { exact: true })).toBeVisible()
  const row = page.locator('tbody tr').filter({ hasText: 'E2E 管理账簿' })
  await expect(row).toContainText('E2E 管理账簿')
  const code = (await row.locator('td').first().textContent())?.trim()
  expect(code).toMatch(/^ACC-\d{4}$/)
  await expect(row).toContainText('独立核算')
  await expect(row).toContainText('2026-08')
  await expect(row).toContainText('CNY')
  await expect(row).toContainText('跨用户访问范围')
  await expect(row.getByRole('button', { name: '编辑' })).toBeVisible()
  await expect(row.getByRole('button', { name: '删除' })).toBeVisible()
  await expect(row.getByRole('button', { name: '更多操作' })).toHaveCount(0)

  await page.getByRole('button', { name: '新增', exact: true }).click()
  await drawer.getByLabel('名称').fill('E2E 独立账簿')
  await drawer.getByLabel('开始月份').fill('2026-09')
  await drawer.getByLabel('基础币种').fill('CNY')
  await drawer.getByRole('button', { name: '保存', exact: true }).click()
  const secondRow = page.locator('tbody tr').filter({ hasText: 'E2E 独立账簿' })
  await expect(secondRow).toBeVisible()
  const secondCode = (
    await secondRow.locator('td').first().textContent()
  )?.trim()
  expect(secondCode).toMatch(/^ACC-\d{4}$/)

  await page.goto('/acc/subject')
  await expect(page).toHaveURL(/\/acc\/subject$/)
  await page.getByLabel('会计账簿').click({ force: true })
  await page.getByRole('option', { name: /E2E 管理账簿/ }).click()
  await expect(
    page.locator('tbody tr').filter({ hasText: '1405' }),
  ).toContainText('库存商品')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const subjectDrawer = page.locator('.v-navigation-drawer--right')
  await subjectDrawer.getByLabel('科目编码').fill('1901')
  await subjectDrawer.getByLabel('科目名称').fill('E2E 待摊费用')
  await subjectDrawer.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('科目已创建。', { exact: true })).toBeVisible()
  await expect(
    page.locator('tbody tr').filter({ hasText: '1901' }),
  ).toContainText('E2E 待摊费用')
  await page.goto('/acc/opening')
  await expect(page).toHaveURL(/\/acc\/opening$/)
  await expect(page.getByText('已批准', { exact: true })).toBeVisible()
  await page.getByLabel('会计账簿').click({ force: true })
  await page.getByRole('option', { name: /E2E 管理账簿/ }).click()
  await expect(page.getByText('零期初也需要明确批准')).toBeVisible()
  await expect(page.getByText('草稿', { exact: true })).toBeVisible()

  await signOut(page)
  await signIn(page, workerState.reviewer)
  await page.goto('/acc/book')
  await expect(
    page.locator('tbody tr').filter({ hasText: code! }),
  ).toBeVisible()
  await expect(
    page.locator('tbody tr').filter({ hasText: secondCode! }),
  ).toHaveCount(0)
  await page
    .locator('tbody tr')
    .filter({ hasText: code! })
    .getByRole('button', { name: '编辑' })
    .click()
  const reviewerDrawer = page.locator('.v-navigation-drawer--right')
  await expect(reviewerDrawer).toBeVisible()
  await expect(reviewerDrawer.getByLabel('名称')).toHaveValue('E2E 管理账簿')
  await reviewerDrawer.getByLabel('名称').fill('E2E 复核员维护账簿')
  await reviewerDrawer
    .getByRole('button', { name: '保存', exact: true })
    .click()
  const reviewerRow = page.locator('tbody tr').filter({ hasText: code! })
  await expect(reviewerRow).toContainText('E2E 复核员维护账簿')
  await expect(reviewerRow).toContainText('独立核算')
})
