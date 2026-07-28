import { expect, test, type Page } from '@playwright/test'
import {
  e2eEnv,
  reviewerCredentials,
  type E2ECredentials,
} from './wfl-runtime'

const submitter: E2ECredentials = {
  username: e2eEnv('E2E_USERNAME'),
  password: e2eEnv('E2E_PASSWORD'),
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

async function openCustomer(page: Page): Promise<void> {
  await page.goto('/bob/customer')
  await expect(
    page.getByRole('textbox', { name: '客户关键字' }),
  ).toBeVisible()
}

async function searchCustomer(page: Page, code: string): Promise<void> {
  await page.getByRole('textbox', { name: '客户关键字' }).fill(code)
  await page.getByRole('button', { name: '查询' }).click()
  await expect(
    page.getByRole('cell', { name: code, exact: true }),
  ).toBeVisible()
}

async function openMore(page: Page, code: string): Promise<void> {
  await page.getByLabel(`更多操作 ${code}`).click()
}

function customerRow(page: Page, code: string) {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name: code, exact: true }),
  })
}

test('使用双账号完成客户驳回、重提、通过和历史核验', async ({ page }) => {
  test.setTimeout(120_000)
  const reviewer = reviewerCredentials()

  await signIn(page, submitter)
  await openCustomer(page)
  await page.getByRole('button', { name: '新增' }).click()
  const code = (
    await page
      .locator('[data-field="code"] .business-object-editor__value')
      .textContent()
  )?.trim()
  expect(code).toMatch(/^BOB-CUSTOMER-\d{17}-[A-Z0-9]{6}$/)
  await page.getByLabel('客户名称').fill('E2E 生命周期客户')
  await page.getByRole('combobox', { name: '业务员' }).fill('DEMO-EMP-001')
  await page.getByRole('option', { name: /DEMO-EMP-001/ }).click()
  await page.getByRole('button', { name: '保存' }).click()
  await searchCustomer(page, code!)
  await openMore(page, code!)
  await page.getByText('提交审核', { exact: true }).click()
  await page.getByRole('button', { name: '提交审核' }).click()
  await expect(
    customerRow(page, code!).getByText('待审核', { exact: true }),
  ).toBeVisible()
  await signOut(page)

  await signIn(page, reviewer)
  await openCustomer(page)
  await searchCustomer(page, code!)
  await openMore(page, code!)
  await page.getByText('审核驳回', { exact: true }).click()
  await page.getByLabel('驳回意见').fill('E2E 验证驳回后重提')
  await page.getByRole('button', { name: '确认驳回' }).click()
  await expect(
    customerRow(page, code!).getByText('已驳回', { exact: true }),
  ).toBeVisible()
  await signOut(page)

  await signIn(page, submitter)
  await openCustomer(page)
  await searchCustomer(page, code!)
  await page.getByLabel(`编辑 ${code}`).click()
  await page.getByLabel('联系人').fill('E2E 重提联系人')
  await page.getByRole('button', { name: '保存' }).click()
  await searchCustomer(page, code!)
  await openMore(page, code!)
  await page.getByText('提交审核', { exact: true }).click()
  await page.getByRole('button', { name: '提交审核' }).click()
  await signOut(page)

  await signIn(page, reviewer)
  await openCustomer(page)
  await searchCustomer(page, code!)
  await openMore(page, code!)
  await page.getByText('审核通过', { exact: true }).click()
  await page.getByLabel('审核意见（可选）').fill('E2E 审核通过')
  await page.getByRole('button', { name: '确认通过' }).click()
  await expect(
    customerRow(page, code!).getByText('有效', { exact: true }),
  ).toBeVisible()

  await openMore(page, code!)
  await page.getByText('版本历史', { exact: true }).click()
  const versionsDialog = page.getByRole('dialog').filter({
    hasText: '版本历史',
  })
  await expect(versionsDialog).toBeVisible()
  await expect(versionsDialog.getByText('V1', { exact: true })).toBeVisible()
  await versionsDialog.getByRole('button', { name: '关闭' }).click()

  await openMore(page, code!)
  await page.getByText('审核历史', { exact: true }).click()
  const auditDialog = page.getByRole('dialog').filter({
    hasText: '审核历史',
  })
  await expect(auditDialog).toBeVisible()
  await expect(auditDialog.getByText('REJECTED', { exact: true })).toBeVisible()
  await expect(auditDialog.getByText('APPROVED', { exact: true })).toBeVisible()
})
