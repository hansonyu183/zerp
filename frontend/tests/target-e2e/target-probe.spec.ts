import { expect, test } from '@playwright/test'

test('browser signs in through the typed Hono client and queries target PostgreSQL users', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByLabel('用户名').fill(process.env.TARGET_E2E_USERNAME!)
  await page.getByLabel('密码').fill(process.env.TARGET_E2E_PASSWORD!)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('status')).toContainText('当前用户：')
  await page.getByRole('button', { name: '查询用户' }).click()
  await expect(page.getByRole('status')).toContainText('已查询')
  await expect(page.getByRole('list', { name: '用户列表' })).toContainText(
    process.env.TARGET_E2E_USERNAME!,
  )
})
