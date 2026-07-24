import { expect, test, type Page } from '@playwright/test'

const submitter = {
  username: process.env.E2E_USERNAME!,
  password: process.env.E2E_PASSWORD!,
}
const reviewer = {
  username: process.env.E2E_REVIEWER_USERNAME!,
  password: process.env.E2E_REVIEWER_PASSWORD!,
}

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

async function openSupplier(page: Page): Promise<void> {
  await page.goto('/bob/supplier')
  await expect(
    page.getByRole('textbox', { name: '供应商关键字' }),
  ).toBeVisible()
}

async function searchSupplier(page: Page, code: string): Promise<void> {
  await page.getByRole('textbox', { name: '供应商关键字' }).fill(code)
  await page.getByRole('button', { name: '查询' }).click()
  await expect(page.getByText(code, { exact: true })).toBeVisible()
}

async function openMore(page: Page, code: string): Promise<void> {
  await page.getByLabel(`更多操作 ${code}`).click()
}

test('使用双账号完成供应商驳回、重提、通过和历史核验', async ({ page }) => {
  test.setTimeout(120_000)
  const code = `E2E-SUP-${Date.now().toString(36).toUpperCase()}`

  await signIn(page, submitter)
  await openSupplier(page)
  await page.getByRole('button', { name: '新增' }).click()
  await page.getByLabel('供应商编码').fill(code)
  await page.getByLabel('供应商名称').fill('E2E 生命周期供应商')
  await page.getByRole('combobox', { name: '业务员' }).fill('DEMO-EMP-001')
  await page.getByRole('option', { name: /DEMO-EMP-001/ }).click()
  await page.getByRole('button', { name: '保存' }).click()
  await searchSupplier(page, code)
  await openMore(page, code)
  await page.getByText('提交审核', { exact: true }).click()
  await page.getByRole('button', { name: '提交审核' }).click()
  await expect(page.getByText('待审核', { exact: true })).toBeVisible()
  await signOut(page)

  await signIn(page, reviewer)
  await openSupplier(page)
  await searchSupplier(page, code)
  await openMore(page, code)
  await page.getByText('审核驳回', { exact: true }).click()
  await page.getByLabel('驳回意见').fill('E2E 验证驳回后重提')
  await page.getByRole('button', { name: '确认驳回' }).click()
  await expect(page.getByText('已驳回', { exact: true })).toBeVisible()
  await signOut(page)

  await signIn(page, submitter)
  await openSupplier(page)
  await searchSupplier(page, code)
  await page.getByLabel(`编辑 ${code}`).click()
  await page.getByLabel('供应商简称').fill('E2E重提')
  await page.getByRole('button', { name: '保存' }).click()
  await searchSupplier(page, code)
  await openMore(page, code)
  await page.getByText('提交审核', { exact: true }).click()
  await page.getByRole('button', { name: '提交审核' }).click()
  await signOut(page)

  await signIn(page, reviewer)
  await openSupplier(page)
  await searchSupplier(page, code)
  await openMore(page, code)
  await page.getByText('审核通过', { exact: true }).click()
  await page.getByLabel('审核意见（可选）').fill('E2E 审核通过')
  await page.getByRole('button', { name: '确认通过' }).click()
  await expect(page.getByText('有效', { exact: true })).toBeVisible()

  await openMore(page, code)
  await page.getByText('版本历史', { exact: true }).click()
  await expect(page.getByRole('heading', { name: '版本历史' })).toBeVisible()
  await expect(page.getByText('V1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()

  await openMore(page, code)
  await page.getByText('审核历史', { exact: true }).click()
  await expect(page.getByRole('heading', { name: '审核历史' })).toBeVisible()
  await expect(page.getByText('REJECTED', { exact: true })).toBeVisible()
  await expect(page.getByText('APPROVED', { exact: true })).toBeVisible()
})
