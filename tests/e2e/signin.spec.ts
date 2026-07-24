import { expect, test, type Page } from '@playwright/test'

const username = process.env.E2E_USERNAME!
const password = process.env.E2E_PASSWORD!

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).not.toHaveURL(/\/signin/)
  await expect(page.locator('.account-button')).toBeVisible()
}

async function openCustomer(page: Page, isMobile: boolean): Promise<void> {
  await page.goto('/home/dashboard')
  if (isMobile) await page.getByLabel('切换导航').click()

  const customerLink = page.getByRole('link', { name: /客户/ })
  if (!await customerLink.isVisible()) {
    await page.getByText('基础业务对象').click()
  }
  await expect(customerLink).toBeVisible()
  await customerLink.click()
  await expect(page).toHaveURL(/\/bob\/customer/)
}

test('使用真实后端会话登录并进入系统', async ({ page }) => {
  await signIn(page)
})

test('登录后进入客户业务页面并在退出后退时保护旧页面', async ({
  page,
  isMobile,
}) => {
  await signIn(page)
  await openCustomer(page, isMobile)
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

  await signIn(page)
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
  await expect(page.getByText('基础业务对象')).toBeVisible()
  await page.getByText('基础业务对象').click()
  await expect(page.getByRole('link', { name: /客户/ })).toBeVisible()
  await expect(page.getByText('系统能力')).toHaveCount(0)
})
