import { expect, test, type Page } from '@playwright/test'

const administrator = {
  username: process.env.E2E_USERNAME!,
  password: process.env.E2E_PASSWORD!,
}

function uniquePassword(): string {
  return `Zerp!${crypto.randomUUID()}Aa9`
}

async function signIn(
  page: Page,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名').fill(credentials.username)
  await page.getByLabel('密码').fill(credentials.password)
  await page.getByRole('button', { name: '登录' }).click()
}

async function signOut(page: Page): Promise<void> {
  await page.locator('.account-button').click()
  await page.getByText('退出登录', { exact: true }).click()
  await expect(page).toHaveURL(/\/signin/)
}

async function changeRequiredPassword(
  page: Page,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await expect(page).toHaveURL(/\/change-password$/)
  await page.goto('/admin/user')
  await expect(page).toHaveURL(/\/change-password$/)
  await page.getByLabel('当前密码').fill(currentPassword)
  await page.getByLabel('新密码').fill(newPassword)
  await page.getByRole('button', { name: '确认修改' }).click()
  await expect(page).toHaveURL(/\/signin\?passwordChanged=1/)
}

/**
 * This serial test intentionally keeps every generated password in local process
 * variables only. It never logs, screenshots, attaches, or interpolates them.
 */
test(
  '管理员创建和重置用户均进入强制改密闭环',
  { tag: '@system-serial' },
  async ({ page }) => {
    test.setTimeout(90_000)
    const username = `e2e-user-${crypto.randomUUID().slice(0, 12)}`
    const initialPassword = uniquePassword()
    const changedPassword = uniquePassword()
    const resetChangedPassword = uniquePassword()

    await signIn(page, administrator)
    await expect(page).toHaveURL(/\/home\/dashboard$/)
    await page.goto('/admin/user')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    await page.getByLabel('用户名').fill(username)
    await page.getByLabel('显示名称').fill('E2E 生命周期用户')
    await page.getByLabel('初始密码').fill(initialPassword)
    await page.getByLabel('角色').click()
    await page
      .locator('[role="option"]:not([aria-disabled="true"])')
      .first()
      .click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('用户已创建。', { exact: true })).toBeVisible()

    await signOut(page)
    await signIn(page, { username, password: initialPassword })
    await changeRequiredPassword(page, initialPassword, changedPassword)
    await signIn(page, { username, password: changedPassword })
    await expect(page).toHaveURL(/\/home\/dashboard$/)

    await signOut(page)
    await signIn(page, administrator)
    await page.goto('/admin/user')
    await page.getByLabel('用户名或名称').fill(username)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    await page
      .getByLabel(`操作 ${username}`)
      .getByRole('button', { name: '重置密码' })
      .click()
    await page.getByRole('button', { name: '确认', exact: true }).click()
    const temporaryPassword = await page.getByLabel('临时密码').inputValue()
    await page.getByLabel('我已安全保存临时密码').check()
    await page.getByRole('button', { name: '关闭', exact: true }).last().click()

    await signOut(page)
    await signIn(page, { username, password: changedPassword })
    await expect(
      page.getByText('用户名或密码错误', { exact: false }),
    ).toBeVisible()
    await signIn(page, { username, password: temporaryPassword })
    await changeRequiredPassword(page, temporaryPassword, resetChangedPassword)
    await signIn(page, { username, password: resetChangedPassword })
    await expect(page).toHaveURL(/\/home\/dashboard$/)
  },
)
