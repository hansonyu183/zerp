import { expect, test, type Page } from '@playwright/test'
import { e2eEnv, reviewerCredentials, type E2ECredentials } from './wfl-runtime'

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
  await expect(page.getByRole('textbox', { name: '客户关键字' })).toBeVisible()
}

async function searchCustomer(page: Page, code: string): Promise<void> {
  await page.getByRole('textbox', { name: '客户关键字' }).fill(code)
  await page.getByRole('button', { name: '查询' }).click()
  await expect(customerRow(page, code)).toBeVisible()
}

async function openMore(page: Page, code: string): Promise<void> {
  await page.getByLabel(`更多操作 ${code}`).click()
}

function customerRow(page: Page, code: string) {
  return page.locator('tbody tr').filter({
    has: page.locator('td[data-label="编码"]').filter({ hasText: code }),
  })
}

test('使用双账号完成客户反向流转、启禁用和历史核验', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const reviewer = reviewerCredentials()
  const customerName = `E2E 生命周期客户 ${testInfo.project.name}`

  await signIn(page, submitter)
  await openCustomer(page)
  await page.getByRole('button', { name: '新增' }).click()
  await expect(page.locator('[data-field="code"]')).toHaveCount(0)
  await page.getByLabel('客户名称').fill(customerName)
  await page.getByRole('combobox', { name: '业务员' }).fill('张伟')
  await page.getByRole('option', { name: /张伟/ }).click()
  await page.getByRole('button', { name: '保存' }).click()
  const createdRow = page.locator('tbody tr').filter({
    hasText: customerName,
  })
  await expect(createdRow).toHaveCount(1)
  const code = (await createdRow.locator('td').first().textContent())?.trim()
  expect(code).toMatch(/^CUS-\d{4}$/)
  await searchCustomer(page, code!)
  await expect(
    customerRow(page, code!).getByText('提交审核', { exact: true }),
  ).toBeHidden()
  await customerRow(page, code!).getByLabel('提交审核').click()
  await expect(
    customerRow(page, code!).getByText('待审核', { exact: true }),
  ).toBeVisible()
  await customerRow(page, code!).getByLabel('撤回提交').click()
  const unsubmitDialog = page.getByRole('dialog').filter({
    hasText: '撤回提交',
  })
  await unsubmitDialog.getByLabel('原因').fill('E2E 验证撤回提交')
  await unsubmitDialog.getByRole('button', { name: '确认' }).click()
  await expect(
    customerRow(page, code!).getByText('草稿', { exact: true }),
  ).toBeVisible()
  await customerRow(page, code!).getByLabel('提交审核').click()
  await signOut(page)

  await signIn(page, reviewer)
  await openCustomer(page)
  await searchCustomer(page, code!)
  await customerRow(page, code!).getByLabel('审核驳回').click()
  await page.getByLabel('驳回意见').fill('E2E 验证驳回后重提')
  await page.getByRole('button', { name: '确认驳回' }).click()
  await expect(
    customerRow(page, code!).getByText('草稿', { exact: true }),
  ).toBeVisible()
  await signOut(page)

  await signIn(page, submitter)
  await openCustomer(page)
  await searchCustomer(page, code!)
  await page.getByLabel(`编辑 ${code}`).click()
  await page.getByLabel('联系人').fill('E2E 重提联系人')
  await page.getByRole('button', { name: '保存' }).click()
  await searchCustomer(page, code!)
  await customerRow(page, code!).getByLabel('提交审核').click()
  await signOut(page)

  await signIn(page, reviewer)
  await openCustomer(page)
  await searchCustomer(page, code!)
  await customerRow(page, code!).getByLabel('审核通过').click()
  await expect(
    customerRow(page, code!).getByText('有效', { exact: true }),
  ).toBeVisible()
  await customerRow(page, code!).getByLabel('禁用').click()
  await expect(
    customerRow(page, code!).getByText('禁用', { exact: true }),
  ).toBeVisible()
  await customerRow(page, code!).getByLabel('启用').click()
  await expect(
    customerRow(page, code!).getByText('启用', { exact: true }),
  ).toBeVisible()
  await customerRow(page, code!).getByLabel('撤销批准').click()
  const unapproveDialog = page.getByRole('dialog').filter({
    hasText: '撤销批准',
  })
  await unapproveDialog.getByLabel('原因').fill('E2E 验证撤销批准')
  await unapproveDialog.getByRole('button', { name: '确认' }).click()
  await expect(
    customerRow(page, code!).getByText('待审核', { exact: true }),
  ).toBeVisible()
  await customerRow(page, code!).getByLabel('审核通过').click()
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
  await expect(versionsDialog.getByText('V2', { exact: true })).toBeVisible()
  await versionsDialog.getByRole('button', { name: '关闭' }).click()

  await openMore(page, code!)
  await page.getByText('审核历史', { exact: true }).click()
  const auditDialog = page.getByRole('dialog').filter({
    hasText: '审核历史',
  })
  await expect(auditDialog).toBeVisible()
  await expect(auditDialog.getByText('REJECTED', { exact: true })).toBeVisible()
  await expect(
    auditDialog.getByText('UNAPPROVED', { exact: true }),
  ).toBeVisible()
  await expect(auditDialog.getByText('APPROVED', { exact: true })).toHaveCount(
    2,
  )
})
