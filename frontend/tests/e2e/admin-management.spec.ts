import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

const username = process.env.E2E_USERNAME!
const password = process.env.E2E_PASSWORD!
const apiBaseUrl = process.env.E2E_API_BASE_URL!

interface Envelope<T> {
  code: number | string
  message: string
  data: T
}

interface MenuData {
  mode: 'DEFAULT' | 'BUSINESS_TEMPLATE'
  modeRevision: number
  catalogRevision: string
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/home\/dashboard$/)
}

async function menuRequest(
  api: APIRequestContext,
  path: string,
  data: unknown,
  csrfToken: string,
): Promise<MenuData> {
  const response = await api.post(path, {
    data,
    headers: { 'X-CSRF-Token': csrfToken },
  })
  expect(response.ok()).toBe(true)
  const envelope = (await response.json()) as Envelope<MenuData>
  expect([0, '0']).toContain(envelope.code)
  return envelope.data
}

async function createApiSession(): Promise<{
  api: APIRequestContext
  csrfToken: string
}> {
  const api = await request.newContext({ baseURL: apiBaseUrl })
  const response = await api.post('app/user/signin', {
    data: { username, password },
  })
  expect(response.ok()).toBe(true)
  const envelope = (await response.json()) as Envelope<{ csrfToken: string }>
  expect([0, '0']).toContain(envelope.code)
  return { api, csrfToken: envelope.data.csrfToken }
}

async function selectMode(page: Page, label: string): Promise<void> {
  const select = page.getByRole('combobox', { name: '当前菜单方式' })
  await select.focus()
  await select.press('ArrowDown')
  await page.getByRole('option', { name: label, exact: true }).click()
  const applyButton = page.getByRole('button', { name: '应用菜单方式' })
  await expect(applyButton).toBeEnabled()
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/app/menu/activate'),
  )
  await applyButton.click()
  const response = await responsePromise
  const envelope = (await response.json()) as Envelope<MenuData>
  expect([0, '0']).toContain(envelope.code)
  await expect(page.getByText(`当前：${label}`, { exact: true })).toBeVisible()
}

async function expectNavigationGroup(page: Page, label: string): Promise<void> {
  const group = page.getByRole('navigation').getByText(label, { exact: true })
  if (!(await group.isVisible())) {
    await page.getByRole('button', { name: '切换导航' }).click()
  }
  await expect(group).toBeVisible()
}

test(
  '系统管理页面连接真实 APP API，菜单模式切换后立即刷新主导航',
  { tag: '@system-serial' },
  async ({ page }) => {
    test.setTimeout(60_000)
    const { api, csrfToken } = await createApiSession()
    const originalMenu = await menuRequest(api, 'app/menu/get', {}, csrfToken)
    await signIn(page)

    const pages = [
      ['/admin/user', '用户管理'],
      ['/admin/role', '角色管理'],
      ['/admin/permission', '权限管理'],
      ['/admin/system-parameter', '系统参数'],
      ['/admin/menu', '菜单管理'],
    ] as const
    for (const [path, title] of pages) {
      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.locator('.page-heading__breadcrumb')).toHaveText(
        `ZERP / ${title}`,
      )
      await expect(page.getByText('页面不存在', { exact: true })).toHaveCount(0)
      await expect(page.getByText('无权访问', { exact: true })).toHaveCount(0)
    }

    try {
      if (originalMenu.mode === 'DEFAULT') {
        await selectMode(page, '业务归类模板')
        await expectNavigationGroup(page, '基础资料')
      } else {
        await selectMode(page, '系统默认')
        await expectNavigationGroup(page, '业务对象')
      }
    } finally {
      const currentMenu = await menuRequest(api, 'app/menu/get', {}, csrfToken)
      if (currentMenu.mode !== originalMenu.mode) {
        await menuRequest(
          api,
          'app/menu/activate',
          { mode: originalMenu.mode, revision: currentMenu.modeRevision },
          csrfToken,
        )
      }
      await api.dispose()
    }
  },
)
