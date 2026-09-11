import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

async function signIn(
  page: Page,
  code = process.env.TARGET_E2E_USERNAME!,
  password = process.env.TARGET_E2E_PASSWORD!,
): Promise<string[]> {
  await page.goto('/signin')
  await page.getByLabel('用户编码', { exact: true }).fill(code)
  await page.getByLabel('密码', { exact: true }).fill(password)
  const response = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/session/auth/signin',
  )
  await page.getByRole('button', { name: '登录', exact: true }).click()
  const { data } = (await (await response).json()) as {
    data: { apiPaths: string[] }
  }
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
  return data.apiPaths
}

test('all authorized resources have one menu entry and unregistered pages send no business requests', async ({
  page,
}) => {
  const businessRequests: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && !path.startsWith('/session/'))
      businessRequests.push(path)
  })
  const apiPaths = await signIn(page)
  const expected = [
    ...new Set(
      apiPaths
        .filter((path) => !path.startsWith('/session/'))
        .map((path) => path.slice(0, path.lastIndexOf('/'))),
    ),
  ].sort()
  expect(expected).toContain('/bob/customer')
  expect(expected).toContain('/app/user')
  const drawer = page.locator('.v-navigation-drawer')
  for (const group of await drawer
    .locator('.v-list-group > .v-list-group__header')
    .all())
    await group.click()
  const links = await drawer
    .locator('a[href]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('href')!).sort(),
    )
  expect(links).toEqual(expected)
  expect(links).not.toContain('/acc/opening')
  expect(links).toContain('/vou/opening')
  await expect(
    drawer.locator('a[href="/bob/customer"] .mdi-account-group-outline'),
  ).toHaveCount(1)
  await expect(
    drawer.locator('a[href="/aux/measurement-unit"] .mdi-ruler'),
  ).toHaveCount(1)
  const query = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/aux/measurement-unit/query',
  )
  await drawer.locator('a[href="/aux/measurement-unit"]').click()
  expect((await query).ok()).toBe(true)
  await expect(page.getByTestId('list-page-shell')).toBeVisible()
  await expect(
    page
      .getByRole('button', { name: '新增计量单位', exact: true })
      .locator('.mdi-plus'),
  ).toHaveCount(1)
  businessRequests.length = 0
  await page.goto('/app/no-such-resource')
  await expect(page.getByText('无权访问', { exact: true })).toBeVisible()
  expect(businessRequests).toEqual([])
})

test('real create-only permissions expose the user page without unauthorized queries', async ({
  page,
}) => {
  const businessRequests: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && !path.startsWith('/session/'))
      businessRequests.push(path)
  })
  const paths = await signIn(
    page,
    process.env.TARGET_E2E_CREATE_ONLY_USERNAME!,
    process.env.TARGET_E2E_CREATE_ONLY_PASSWORD!,
  )
  expect(paths.filter((path) => !path.startsWith('/session/'))).toEqual([
    '/app/user/create',
  ])
  await page.goto('/app/user')
  await expect(page.getByTestId('list-page-shell')).toBeVisible()
  await expect(page.getByLabel('编码、拼音或名称')).toBeDisabled()
  await expect(
    page.getByText('当前账号没有查询权限，仅显示已授权操作。'),
  ).toBeVisible()
  await page.getByRole('button', { name: '新增用户', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('角色查询权限')
  await expect(
    dialog.getByRole('button', { name: '保存', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(businessRequests).toEqual([])

  // A known resource without any granted action must not mount or query.
  await page.goto('/app/role')
  await expect(page.getByText('无权访问', { exact: true })).toBeVisible()
  expect(businessRequests).toEqual([])
})

test('navigation and Host retain the shell at desktop and 390px in both themes', async ({
  browser,
}) => {
  const directory = resolve(process.cwd(), '..', '.scratch', 'issue-418')
  mkdirSync(directory, { recursive: true })
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 800 },
    })
    try {
      const page = await context.newPage()
      await signIn(page)
      await page.goto('/bob/customer')
      await expect(
        page.getByRole('button', { name: '新增客户', exact: true }),
      ).toBeVisible()
      await expect(page.getByRole('table')).toBeVisible()
      for (const name of ['新增客户', '正式资料', '提交记录'])
        await expect(
          page.getByRole('button', { name, exact: true }),
        ).toBeInViewport({ ratio: 1 })
      for (const theme of ['light', 'dark']) {
        if (theme === 'dark') await page.getByLabel('切换深色模式').click()
        await expect(page.locator('.topbar')).toBeVisible()
        const toggle = page.getByRole('button', {
          name: '切换导航',
          exact: true,
        })
        await expect(toggle.locator('.mdi-menu')).toBeVisible()
        await expect(
          page
            .getByRole('button', {
              name: theme === 'light' ? '切换深色模式' : '切换浅色模式',
              exact: true,
            })
            .locator('.v-icon'),
        ).toBeVisible()
        await toggle.focus()
        await expect(
          page.getByRole('tooltip').filter({ hasText: '切换导航' }),
        ).toBeVisible()
        await toggle.blur()
        await expect(
          page
            .getByRole('button', { name: '新增客户', exact: true })
            .locator('.v-icon'),
        ).toHaveAttribute('aria-hidden', 'true')
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        await page.screenshot({
          animations: 'disabled',
          path: resolve(directory, `${width}-${theme}-host.png`),
        })
        if (width === 390) await page.getByLabel('切换导航').click()
        const drawer = page.locator('.v-navigation-drawer')
        await expect(drawer).toBeVisible()
        await page.screenshot({
          animations: 'disabled',
          path: resolve(directory, `${width}-${theme}-navigation.png`),
        })
        if (width === 390) await page.getByLabel('切换导航').click()
        await page
          .getByRole('button', { name: '新增客户', exact: true })
          .click()
        const candidate = page.getByRole('dialog')
        const submit = candidate.getByRole('button', {
          name: '提交',
          exact: true,
        })
        await submit.scrollIntoViewIfNeeded()
        await expect(submit).toBeInViewport({ ratio: 1 })
        await expect(submit.locator('.mdi-send-outline')).toBeVisible()
        await page.screenshot({
          animations: 'disabled',
          path: resolve(directory, `${width}-${theme}-candidate.png`),
        })
        await candidate
          .getByRole('button', { name: '取消', exact: true })
          .click()
        await page.goto('/vou/intermediary-calculation')
        await page.getByRole('button', { name: '新建', exact: true }).click()
        const editor = page.getByRole('dialog')
        await expect(
          editor
            .getByRole('button', { name: '读取计算脚本', exact: true })
            .locator('.v-icon'),
        ).toBeVisible()
        await editor
          .getByRole('button', { name: '试运行脚本', exact: true })
          .scrollIntoViewIfNeeded()
        await expect(
          editor.getByRole('button', { name: '保存计算脚本', exact: true }),
        ).toBeInViewport({ ratio: 1 })
        await page.screenshot({
          animations: 'disabled',
          path: resolve(directory, `${width}-${theme}-intermediary.png`),
        })
        await editor.getByRole('button', { name: '取消', exact: true }).click()
        await page.goto('/bob/customer')
        await expect(
          page.getByRole('button', { name: '新增客户', exact: true }),
        ).toBeVisible()
      }
    } finally {
      await context.close()
    }
  }
})
