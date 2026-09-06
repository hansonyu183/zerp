import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page): Promise<string[]> {
  await page.goto('/signin')
  await page
    .getByLabel('用户编码', { exact: true })
    .fill(process.env.TARGET_E2E_USERNAME!)
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.TARGET_E2E_PASSWORD!)
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
  expect(expected).toContain('/dcl/customer')
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
  for (const path of [
    '/bob/customer',
    '/dcl/customer',
    '/acc/opening',
    '/vou/sale-order',
  ]) {
    const closedGroups = drawer.locator(
      '.v-list-group:not(.v-list-group--open) > .v-list-group__header',
    )
    while (await closedGroups.count()) await closedGroups.first().click()
    await drawer.locator(`a[href="${path}"]`).click()
    await expect(page.getByTestId('business-unimplemented')).toBeVisible()
    await expect(page.getByTestId('business-unimplemented')).toContainText(
      '功能尚未实现',
    )
    await page.reload()
    await expect(page.getByTestId('business-unimplemented')).toBeVisible()
  }
  await page.goto('/app/no-such-resource')
  await expect(page.getByText('无权访问', { exact: true })).toBeVisible()
  expect(businessRequests).toEqual([])
})

test('navigation and Host retain the shell at desktop and 390px in both themes', async ({
  browser,
}) => {
  const directory = resolve(
    process.cwd(),
    '..',
    '.scratch',
    'issue-381-navigation',
  )
  mkdirSync(directory, { recursive: true })
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 800 },
    })
    try {
      const page = await context.newPage()
      await signIn(page)
      await page.goto('/bob/customer')
      await expect(page.getByTestId('business-unimplemented')).toBeVisible()
      for (const theme of ['light', 'dark']) {
        if (theme === 'dark') await page.getByLabel('切换深色模式').click()
        await expect(page.locator('.topbar')).toBeVisible()
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
      }
    } finally {
      await context.close()
    }
  }
})
