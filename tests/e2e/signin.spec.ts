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

test('登录后进入客户业务页面并在退出后退时保护旧页面', async ({ page }) => {
  test.skip(
    !apiUrl || !username || !password,
    '需要 E2E_API_BASE_URL、E2E_USERNAME 和 E2E_PASSWORD 才能执行真实 API 测试。',
  )

  await page.goto('/signin')
  await page.getByLabel('用户名').fill(username!)
  await page.getByLabel('密码').fill(password!)
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page.getByText('企业资源管理系统').first()).toBeVisible()
  await page.getByRole('link', { name: /客户/ }).click()
  await expect(page).toHaveURL(/\/bob\/customer/)
  await expect(page.getByRole('button', { name: '查询' })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/bob\/customer/)

  await page.locator('.account-button').click()
  await page.getByText('退出登录').click()
  await expect(page).toHaveURL(/\/signin/)

  await page.goBack()
  await expect(page).toHaveURL(/\/signin/)
  await expect(page.getByLabel('客户关键字')).not.toBeVisible()
})

test('移动端首次进入仪表盘时导航抽屉默认关闭', async ({ page, isMobile }) => {
  test.skip(!isMobile, '仅在移动端项目验证抽屉初始状态。')

  await page.route('**/mock-api/app/user/session', async (route) => {
    await route.fulfill({
      json: {
        code: 0,
        message: 'ok',
        data: {
          user: { id: '1', username: 'admin', displayName: '管理员' },
          csrfToken: 'csrf-token',
          menus: [
            {
              domain: 'bob',
              title: '基础资料',
              children: [{ entity: 'customer', title: '客户', actions: ['query'] }],
            },
          ],
        },
      },
    })
  })

  await page.goto('/home/dashboard')

  await expect(page.getByText('业务工作区')).toBeVisible()
  const closedBox = await page.locator('.sidebar').boundingBox()
  expect(closedBox).not.toBeNull()
  expect(closedBox!.x + closedBox!.width).toBeLessThanOrEqual(1)

  await page.getByLabel('切换导航').click()
  await expect.poll(async () => {
    const openBox = await page.locator('.sidebar').boundingBox()
    return openBox?.x ?? -999
  }).toBeGreaterThanOrEqual(0)
})
