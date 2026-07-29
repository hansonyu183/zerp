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

async function openProfile(page: Page) {
  await page.locator('.account-button').click()
  await page.getByText('名称与头像', { exact: true }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('显示名称')).toBeEnabled()
  return dialog
}

async function openCustomer(page: Page, isMobile: boolean): Promise<void> {
  await page.goto('/home/dashboard')
  if (isMobile) await page.getByLabel('切换导航').click()

  const customerLink = page.getByRole('link', { name: /客户/ })
  if (!(await customerLink.isVisible())) {
    await page.getByText('业务对象', { exact: true }).click()
  }
  await expect(customerLink).toBeVisible()
  await customerLink.click()
  await expect(page).toHaveURL(/\/bob\/customer/)
}

test('使用真实后端会话登录并进入系统', async ({ page }) => {
  await signIn(page)
})

test('使用真实后端读取、保存并恢复个人资料', async ({ page }) => {
  await signIn(page)
  let originalDisplayName = ''
  let originalAvatarUrl = ''

  try {
    let dialog = await openProfile(page)
    originalDisplayName = await dialog.getByLabel('显示名称').inputValue()
    originalAvatarUrl = await dialog.getByLabel('头像地址').inputValue()
    const updatedDisplayName = `E2E 资料 ${Date.now()}`

    await dialog.getByLabel('显示名称').fill(updatedDisplayName)
    await dialog.getByLabel('头像地址').fill('')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.account-button')).toContainText(
      updatedDisplayName,
    )

    dialog = await openProfile(page)
    await expect(dialog.getByLabel('显示名称')).toHaveValue(updatedDisplayName)
    await expect(dialog.getByLabel('头像地址')).toHaveValue('')
  } finally {
    if (originalDisplayName && !page.url().includes('/signin')) {
      let dialog = page.getByRole('dialog')
      if (!(await dialog.isVisible())) dialog = await openProfile(page)
      await dialog.getByLabel('显示名称').fill(originalDisplayName)
      await dialog.getByLabel('头像地址').fill(originalAvatarUrl)
      await dialog.getByRole('button', { name: '保存' }).click()
      await expect(dialog).not.toBeVisible()
      await expect(page.locator('.account-button')).toContainText(
        originalDisplayName,
      )
    }
  }
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

test('辅助对象菜单使用中文并导航到真实页面', async ({ page, isMobile }) => {
  await signIn(page)
  await page.goto('/home/dashboard')
  if (isMobile) await page.getByLabel('切换导航').click()

  await expect(page.getByText('Aux', { exact: true })).toHaveCount(0)
  await page.getByText('辅助对象', { exact: true }).click()
  const productCategoryLink = page.getByRole('link', { name: /产品分类/ })
  await expect(productCategoryLink).toBeVisible()
  await productCategoryLink.click()

  await expect(page).toHaveURL(/\/aux\/product-category/)
  await expect(
    page.getByRole('textbox', { name: '产品分类关键字', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '查询', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '新增', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '新增', exact: true }).click()
  await expect(
    page.locator('.aux-entity-drawer [data-field="code"]'),
  ).toHaveCount(0)
  await page
    .locator('.aux-entity-drawer')
    .getByRole('button', { name: '取消', exact: true })
    .click()
  await page.getByText('筛选条件', { exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: '状态', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '重置', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '应用筛选', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.page-heading__breadcrumb')).toHaveText(
    'ZERP / 产品分类',
  )
})

test('五个业务域只显示面包屑而不显示页面大标题', async ({ page }) => {
  await signIn(page)

  const pages = [
    ['/bob/customer', '客户'],
    ['/aux/product-category', '产品分类'],
    ['/vou/sale-order', '销售订单'],
    ['/wfl/sales-fulfillment', '销售履约'],
    ['/led/inventory', '库存台账'],
  ] as const

  for (const [path, title] of pages) {
    await page.goto(path)
    await expect(page.locator('.page-heading__breadcrumb')).toHaveText(
      `ZERP / ${title}`,
    )
    const controls = page.locator('.entity-list-controls')
    await expect(controls).toHaveCount(1)
    await expect(
      controls.getByRole('button', { name: '查询', exact: true }),
    ).toBeVisible()
    await expect(page.locator('main h1')).toHaveCount(0)
  }
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
  await expect
    .poll(async () => {
      const openBox = await page.locator('.sidebar').boundingBox()
      return openBox?.x ?? -999
    })
    .toBeGreaterThanOrEqual(0)
  await expect(page.getByText('业务对象', { exact: true })).toBeVisible()
  await page.getByText('业务对象', { exact: true }).click()
  await expect(page.getByRole('link', { name: /客户/ })).toBeVisible()
  await expect(page.getByText('系统能力')).toHaveCount(0)
})
