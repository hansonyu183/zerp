import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

test('无角色管理权限从真实用户表单分页选择第 201 条，正式查询仍拒绝', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const base = process.env.TARGET_API_BASE_URL!
  const headers = { 'x-zerp-model-build': modelBuildId }
  const login = await (
    await page.request.post(`${base}/session/auth/signin`, {
      headers,
      data: {
        code: process.env.TARGET_E2E_USERNAME!,
        password: process.env.TARGET_E2E_PASSWORD!,
      },
    })
  ).json()
  expect(login.code).toBe(0)
  const prefix = `引用分页${randomBytes(5).toString('hex')}`
  const permissions = await (
    await page.request.get(
      `${base}/app/permission/options?page=1&pageSize=20&keyword=/app/user/create`,
      { headers },
    )
  ).json()
  expect(permissions.code).toBe(0)
  for (let index = 0; index < 205; index++) {
    const created = await (
      await page.request.post(`${base}/app/role/create`, {
        headers: { ...headers, 'x-csrf-token': login.data.csrfToken },
        data: {
          name: `${prefix}${String(index).padStart(3, '0')}`,
          description: '',
          permissionIds: [permissions.data.items[0].id],
        },
      })
    ).json()
    expect(created.code).toBe(0)
  }
  await page.goto('/signin')
  // Start the restricted session through HTTP, then enter the actual Host.
  const restricted = await (
    await page.request.post(`${base}/session/auth/signin`, {
      headers,
      data: {
        code: process.env.TARGET_E2E_CREATE_ONLY_USERNAME!,
        password: process.env.TARGET_E2E_CREATE_ONLY_PASSWORD!,
      },
    })
  ).json()
  expect(restricted.code).toBe(0)
  await page.goto('/app/user')
  await expect(page.locator('a[href="/app/role"]')).toHaveCount(0)
  await expect(
    page.locator(
      'a[href="/aux/reference"], a[href="/bob/reference"], a[href="/vou/reference"]',
    ),
  ).toHaveCount(0)
  const candidateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/app/role/options' &&
      response.request().method() === 'GET',
  )
  await page.getByRole('button', { name: '新增用户', exact: true }).click()
  expect((await (await candidateResponse).json()).code).toBe(0)
  const dialog = page.getByRole('dialog')
  const input = dialog.getByRole('combobox', { name: '角色', exact: true })
  const searched = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.pathname === '/app/role/options' &&
      url.searchParams.get('keyword') === prefix
    )
  })
  await input.fill(prefix)
  expect((await (await searched).json()).data.total).toBe(205)
  await expect(dialog.getByText('1 / 11', { exact: true })).toBeVisible()
  for (let next = 2; next <= 11; next++) {
    const changed = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        url.pathname === '/app/role/options' &&
        url.searchParams.get('page') === String(next) &&
        response.request().method() === 'GET'
      )
    })
    // Close the overlay before using the picker pagination controls.
    await page.keyboard.press('Escape')
    await dialog.getByRole('button', { name: '下一页', exact: true }).click()
    const body = await (await changed).json()
    expect(body.code).toBe(0)
    expect(body.data.total).toBe(205)
  }
  await input.click()
  await page
    .getByRole('option')
    .filter({ hasText: `${prefix}200` })
    .click()
  await expect(
    dialog.locator('.v-chip').filter({ hasText: `${prefix}200` }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await input.fill(`${prefix}204`)
  await page
    .getByRole('option')
    .filter({ hasText: `${prefix}204` })
    .click()
  await expect(dialog.locator('.v-chip')).toHaveCount(2)
  const rejected = await (
    await page.request.post(`${base}/app/role/query`, {
      headers: { ...headers, 'x-csrf-token': restricted.data.csrfToken },
      data: { keyword: '', page: 1, pageSize: 20 },
    })
  ).json()
  expect(rejected.errorKey).toBe('forbidden')
})
