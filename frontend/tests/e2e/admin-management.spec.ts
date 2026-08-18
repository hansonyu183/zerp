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
  draft: MenuTree
  published: MenuTree
  navigation: MenuTree
}

interface MenuTree {
  revision: number
  items: Array<{
    id: string
    parentId: string | null
    type: 'GROUP' | 'ROUTE'
    order: number
    displayName: string
    icon: string | null
    enabled: boolean
    routeKey: string | null
  }>
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
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
  const select = page.getByRole('combobox', {
    name: '选择要应用的菜单方式',
    exact: true,
  })
  await select.focus()
  await select.press('ArrowDown')
  await page.getByRole('option', { name: label, exact: true }).click()
  const applyButton = page.getByRole('button', {
    name: '应用菜单方式',
    exact: true,
  })
  await expect(applyButton).toBeEnabled()
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/app/menu/activate'),
  )
  await applyButton.click()
  await page.getByRole('button', { name: '确认应用', exact: true }).click()
  const response = await responsePromise
  const envelope = (await response.json()) as Envelope<MenuData>
  expect([0, '0']).toContain(envelope.code)
  await expect(page.getByText(`当前：${label}`, { exact: true })).toBeVisible()
}

async function expectNavigationGroup(page: Page, label: string): Promise<void> {
  const group = page.getByRole('navigation').getByText(label, { exact: true })
  if (!(await group.isVisible())) {
    await page.getByRole('button', { name: '切换导航', exact: true }).click()
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

    try {
      const pages = [
        ['/app/user', '用户管理'],
        ['/app/role', '角色管理'],
        ['/app/permission', '权限管理'],
        ['/app/system-parameter', '系统参数'],
        ['/app/menu', '菜单管理'],
      ] as const
      for (const [path, title] of pages) {
        await page.goto(path)
        await expect(page).toHaveURL(new RegExp(`${path}$`))
        await expect(page.locator('.page-heading__breadcrumb')).toHaveText(
          `ZERP / ${title}`,
        )
        await expect(page.getByText('页面不存在', { exact: true })).toHaveCount(
          0,
        )
        await expect(page.getByText('无权访问', { exact: true })).toHaveCount(0)
      }

      await page.goto('/app/permission')
      await expect(
        page.getByRole('button', { name: '新增', exact: true }),
      ).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: '编辑', exact: true }),
      ).toHaveCount(0)
      await page
        .getByRole('button', { name: '查看', exact: true })
        .first()
        .click()
      await expect(page.getByText('权限详情', { exact: true })).toBeVisible()
      await expect(
        page.getByText('直接关联角色数', { exact: true }),
      ).toBeVisible()
      await page.getByRole('button', { name: '关闭', exact: true }).click()

      await page.goto('/app/system-parameter')
      await page
        .getByLabel('参数键或名称', { exact: true })
        .fill('e2e.display-mode')
      await page.getByRole('button', { name: '查询', exact: true }).click()
      await expect(
        page.getByText('e2e.display-mode', { exact: true }),
      ).toBeVisible()
      await page
        .getByRole('button', { name: '查看并编辑', exact: true })
        .click()
      await page.locator('.v-navigation-drawer .v-select .v-field').click()
      await page
        .getByRole('option', { name: 'COMFORTABLE', exact: true })
        .click()
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(
        page.getByText('保存成功，立即生效。', { exact: true }),
      ).toBeVisible()
      await page
        .getByRole('button', { name: '恢复默认值', exact: true })
        .click()
      await page.getByRole('button', { name: '确认恢复', exact: true }).click()
      await expect(
        page.getByText('恢复默认值成功，立即生效。', { exact: true }),
      ).toBeVisible()

      for (const path of [
        '/admin/user',
        '/admin/role',
        '/admin/permission',
        '/admin/system-parameter',
        '/admin/menu',
      ]) {
        await page.goto(path)
        await expect(
          page.getByText('页面不存在', { exact: true }),
        ).toBeVisible()
      }

      await page.goto('/app/menu')
      const beforeSave = await menuRequest(api, 'app/menu/get', {}, csrfToken)
      await page.getByRole('button', { name: '新增分组', exact: true }).click()
      await page
        .getByLabel('分组名称', { exact: true })
        .last()
        .fill('E2E 未发布草稿')
      const saveResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('/app/menu/save-business-template'),
      )
      await page.getByRole('button', { name: '保存草稿', exact: true }).click()
      const savedEnvelope = (await (
        await saveResponse
      ).json()) as Envelope<MenuData>
      expect([0, '0'], savedEnvelope.message).toContain(savedEnvelope.code)
      await expect(
        page.getByText('草稿已保存，尚未发布。', { exact: true }),
      ).toBeVisible()

      const afterSave = await menuRequest(api, 'app/menu/get', {}, csrfToken)
      expect(afterSave.draft.revision).toBe(beforeSave.draft.revision + 1)
      expect(
        afterSave.draft.items.some(
          (item) => item.displayName === 'E2E 未发布草稿',
        ),
      ).toBe(true)
      expect(afterSave.published).toEqual(beforeSave.published)
      expect(afterSave.navigation).toEqual(beforeSave.navigation)

      const publishResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('/app/menu/publish-business-template'),
      )
      await page.getByRole('button', { name: '发布草稿', exact: true }).click()
      await page.getByRole('button', { name: '确认发布', exact: true }).click()
      const publishedEnvelope = (await (
        await publishResponse
      ).json()) as Envelope<MenuData>
      expect([0, '0'], publishedEnvelope.message).toContain(
        publishedEnvelope.code,
      )
      const afterPublish = await menuRequest(api, 'app/menu/get', {}, csrfToken)
      expect(afterPublish.published.revision).toBe(
        beforeSave.published.revision + 1,
      )
      expect(
        afterPublish.published.items.some(
          (item) => item.displayName === 'E2E 未发布草稿',
        ),
      ).toBe(true)
      expect(afterPublish.mode).toBe(beforeSave.mode)

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
          {
            mode: originalMenu.mode,
            revision: currentMenu.modeRevision,
            catalogRevision: currentMenu.catalogRevision,
          },
          csrfToken,
        )
      }
      await api.dispose()
    }
  },
)
