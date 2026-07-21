import { expect, test } from '@playwright/test'

const apiUrl = process.env.E2E_API_BASE_URL
const username = process.env.E2E_USERNAME
const password = process.env.E2E_PASSWORD

test('使用真实后端会话登录并进入系统', async ({ page }) => {
  test.skip(
    !apiUrl || !username || !password,
    '需要 E2E_API_BASE_URL、E2E_USERNAME 和 E2E_PASSWORD 才能执行真实 API 测试。',
  )

  await page.goto('/signin')
  await page.getByLabel('用户名').fill(username!)
  await page.getByLabel('密码').fill(password!)
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).not.toHaveURL(/\/signin/)
  await expect(page.getByText('企业资源管理系统').first()).toBeVisible()
})
