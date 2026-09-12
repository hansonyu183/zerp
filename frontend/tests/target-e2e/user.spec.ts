import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'
import { modelBuildId } from '@zerp/model'

const targetE2ERoleName = 'Target E2E Role'
const targetE2ERoleText = `${process.env.TARGET_E2E_USERNAME!} · ${targetE2ERoleName}`

function password(): string {
  return `Aa1!${randomBytes(24).toString('base64url')}`
}

async function signIn(
  page: Page,
  code = process.env.TARGET_E2E_USERNAME!,
  currentPassword = process.env.TARGET_E2E_PASSWORD!,
): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户编码', { exact: true }).fill(code)
  await page.getByLabel('密码', { exact: true }).fill(currentPassword)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toHaveCount(0)
}

async function openUserManagement(page: Page): Promise<void> {
  const drawer = page.locator('.v-navigation-drawer')
  const closed = drawer.locator(
    '.v-list-group:not(.v-list-group--open) > .v-list-group__header',
  )
  while (await closed.count()) await closed.first().click()
  await drawer.locator('a[href="/app/user"]').click()
  await expect(
    page.getByLabel('编码、拼音或名称', { exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('business-unimplemented')).toHaveCount(0)
}

async function openRoleManagement(page: Page): Promise<void> {
  const drawer = page.locator('.v-navigation-drawer')
  if (
    !(await drawer.getAttribute('class'))?.includes(
      'v-navigation-drawer--active',
    )
  )
    await page.getByRole('button', { name: '切换导航', exact: true }).click()
  await expect(drawer).toHaveClass(/v-navigation-drawer--active/)
  const closed = drawer.locator(
    '.v-list-group:not(.v-list-group--open) > .v-list-group__header',
  )
  while (await closed.count()) await closed.first().click()
  await drawer.locator('a[href="/app/role"]').click()
  await expect(
    page.getByLabel('编码、拼音或名称', { exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('business-unimplemented')).toHaveCount(0)
}

async function toggleVirtualOption(page: Page, title: string): Promise<void> {
  const option = page.getByRole('option').filter({ hasText: title })
  const chip = page
    .getByRole('dialog')
    .locator('.v-chip')
    .filter({ hasText: title })
  const search = page.getByRole('dialog').getByRole('combobox')
  await search.fill(
    title === '系统管理 · 用户管理 · 新增'
      ? '/app/user/create'
      : title === '系统管理 · 用户管理 · 查看'
        ? '/app/user/get'
        : title === targetE2ERoleText
          ? targetE2ERoleName
          : title,
  )
  await expect(option).toBeVisible()
  const wasSelected = (await option.getAttribute('aria-selected')) === 'true'
  await option.click()
  await expect(chip).toHaveCount(wasSelected ? 0 : 1)
}

async function closeOpenListbox(page: Page): Promise<void> {
  const listbox = page.locator('[role="listbox"]:visible')
  if (!(await listbox.count())) return
  await page.keyboard.press('Escape')
  await expect(listbox).toHaveCount(0)
}

async function createRole(
  page: Page,
  input: { name: string; permissionText: string },
): Promise<void> {
  await page.getByRole('button', { name: '新增角色', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('名称', { exact: true }).fill(input.name)
  await dialog.locator('.v-autocomplete .v-field').click()
  await toggleVirtualOption(page, input.permissionText)
  await closeOpenListbox(page)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function findRoleRow(page: Page, name: string) {
  const keyword = page.getByLabel('编码、拼音或名称', { exact: true })
  await keyword.fill(name)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible()
  return row
}

async function createUser(
  page: Page,
  input: { code: string; name: string; password: string },
): Promise<void> {
  await page.getByRole('button', { name: '新增用户', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('用户编码', { exact: true }).fill(input.code)
  await dialog.getByLabel('名称', { exact: true }).fill(input.name)
  await dialog.locator('.v-autocomplete .v-field').click()
  const targetE2ERole = page
    .locator('[role="option"]:not(.v-list-item--disabled)')
    .filter({ hasText: targetE2ERoleText })
  await expect(targetE2ERole).toHaveCount(1)
  await targetE2ERole.click()
  await closeOpenListbox(page)
  await dialog.getByLabel('初始密码', { exact: true }).fill(input.password)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function findUserRow(page: Page, code: string, query = code) {
  const keyword = page.getByLabel('编码、拼音或名称', { exact: true })
  await keyword.fill(query)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: code })
  await expect(row).toBeVisible()
  return row
}

async function completeRequiredPasswordChange(
  page: Page,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await expect(page).toHaveURL(/\/change-password$/)
  await page.getByLabel('当前密码', { exact: true }).fill(currentPassword)
  await page.getByLabel('新密码', { exact: true }).fill(newPassword)
  await page.getByLabel('确认新密码', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: '保存新密码', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toBeVisible()
}

async function changeOwnPassword(
  page: Page,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await page.locator('.account-button').click()
  await page.getByText('更改密码', { exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('当前密码', { exact: true }).fill(currentPassword)
  await dialog.getByLabel('新密码', { exact: true }).fill(newPassword)
  await dialog.getByLabel('确认新密码', { exact: true }).fill(newPassword)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByLabel('用户编码', { exact: true })).toBeVisible()
}

// All writes use the visible target UI against the disposable HTTP service.
// It takes no screenshots or traces and emits no password, cookie, or CSRF value.
test('a created user completes self-service and cannot regain a revoked session', async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000)
  const code = `ui-${randomBytes(6).toString('hex')}`
  const initialPassword = password()
  const requiredChangePassword = password()
  const selfServicePassword = password()
  const administratorUpdatedName = '北京测试用户'
  const profileName = '用户自助资料已更新'

  await signIn(page)
  await openUserManagement(page)
  await createUser(page, {
    code,
    name: '用户自助测试',
    password: initialPassword,
  })
  await expect(await findUserRow(page, code)).toContainText('用户自助测试')
  await (
    await findUserRow(page, code)
  )
    .getByRole('button', { name: '编辑', exact: true })
    .click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByLabel('用户编码', { exact: true })).toBeDisabled()
  await expect(editor.getByLabel('初始密码', { exact: true })).toHaveCount(0)
  await editor
    .getByLabel('名称', { exact: true })
    .fill(administratorUpdatedName)
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(
    await findUserRow(page, code, 'beijingceshiyonghu'),
  ).toContainText(administratorUpdatedName)

  const userContext = await browser.newContext()
  const staleSessionContext = await browser.newContext()
  try {
    const userPage = await userContext.newPage()
    await signIn(userPage, code, initialPassword)
    await completeRequiredPasswordChange(
      userPage,
      initialPassword,
      requiredChangePassword,
    )
    await signIn(userPage, code, requiredChangePassword)
    await expect(userPage.locator('.account-button')).toBeVisible()

    await userPage.reload()
    await expect(userPage.locator('.account-button')).toBeVisible()

    await userPage.locator('.account-button').click()
    await userPage.getByText('名称与头像', { exact: true }).click()
    const profileDialog = userPage.getByRole('dialog')
    await expect(
      profileDialog.getByLabel('名称', { exact: true }),
    ).toBeVisible()
    await profileDialog.getByLabel('名称', { exact: true }).fill(profileName)
    await profileDialog
      .getByRole('button', { name: '保存', exact: true })
      .click()
    await expect(profileDialog).toHaveCount(0)
    await expect(userPage.locator('.account-button')).toContainText(profileName)

    await changeOwnPassword(
      userPage,
      requiredChangePassword,
      selfServicePassword,
    )
    await signIn(userPage, code, selfServicePassword)
    await expect(userPage.locator('.account-button')).toContainText(profileName)

    const staleSessionPage = await staleSessionContext.newPage()
    await signIn(staleSessionPage, code, selfServicePassword)
    await expect(staleSessionPage.locator('.account-button')).toContainText(
      profileName,
    )

    const row = await findUserRow(page, code)
    await expect(row).toContainText(profileName)
    await row.getByRole('button', { name: '停用', exact: true }).click()
    await expect(
      row.getByRole('button', { name: '启用', exact: true }),
    ).toBeVisible()

    // This context retains its original revoked session cookie until after the
    // administrator enables the account again.
    await userPage.reload()
    await expect(userPage.getByLabel('用户编码', { exact: true })).toBeVisible()
    await row.getByRole('button', { name: '启用', exact: true }).click()
    await expect(
      row.getByRole('button', { name: '停用', exact: true }),
    ).toBeVisible()
    await staleSessionPage.reload()
    await expect(
      staleSessionPage.getByLabel('用户编码', { exact: true }),
    ).toBeVisible()
    await signIn(staleSessionPage, code, selfServicePassword)
    await expect(staleSessionPage.locator('.account-button')).toContainText(
      profileName,
    )
  } finally {
    await staleSessionContext.close()
    await userContext.close()
  }
})

test('user management searches and pages a real result set larger than one page', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const prefix = `page-${randomBytes(6).toString('hex')}`
  const users = Array.from({ length: 21 }, (_, index) => ({
    code: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    name: `分页测试用户${index + 1}`,
    password: password(),
  }))

  await signIn(page)
  await openUserManagement(page)
  for (const user of users) await createUser(page, user)

  await page.getByLabel('编码、拼音或名称', { exact: true }).fill(prefix)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const shell = page.getByTestId('list-page-shell')
  await expect(shell).toContainText('共 21 项')
  await expect(shell.locator('[data-testid^="list-row-"]')).toHaveCount(20)
  await expect(page.getByText(users[0]!.code, { exact: true })).toBeVisible()

  await page
    .locator('.v-pagination__item')
    .filter({ hasText: '2' })
    .locator('button')
    .click()
  await expect(page.getByText(users[20]!.code, { exact: true })).toBeVisible()
  await expect(shell.locator('[data-testid^="list-row-"]')).toHaveCount(1)
})

test('user list and reused editor remain usable at desktop and 390px in both themes', async ({
  browser,
}) => {
  const directory = resolve(process.cwd(), '..', '.scratch', 'issue-381-user')
  mkdirSync(directory, { recursive: true })
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 800 },
    })
    try {
      const page = await context.newPage()
      await signIn(page)
      await page.goto('/app/user')
      await expect(
        page.locator('[data-testid^="list-row-"]').first(),
      ).toBeAttached()
      for (const theme of ['light', 'dark']) {
        if (theme === 'dark') await page.getByLabel('切换深色模式').click()
        await expect(
          page.getByRole('button', { name: '新增用户', exact: true }),
        ).toBeVisible()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        await expect(
          page
            .getByRole('button', { name: '新增用户', exact: true })
            .locator('.mdi-plus'),
        ).toHaveAttribute('aria-hidden', 'true')
        await expect(
          page
            .getByRole('button', { name: '查询', exact: true })
            .locator('.mdi-magnify'),
        ).toHaveAttribute('aria-hidden', 'true')
        await page.screenshot({
          animations: 'disabled',
          path: resolve(directory, `${width}-${theme}-list.png`),
        })
        await page
          .getByRole('button', { name: '新增用户', exact: true })
          .click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByLabel('角色', { exact: true })).toBeEnabled()
        await expect(
          dialog.getByRole('button', { name: '保存', exact: true }),
        ).toBeVisible()
        await expect(
          dialog.getByLabel('初始密码', { exact: true }),
        ).toHaveValue('')
        await expect(
          dialog
            .getByRole('button', { name: '保存', exact: true })
            .locator('.mdi-content-save-outline'),
        ).toHaveAttribute('aria-hidden', 'true')
        await expect(dialog.locator('form')).toHaveCount(1)
        await page.screenshot({
          animations: 'disabled',
          path: resolve(directory, `${width}-${theme}-editor.png`),
        })
        await dialog.getByRole('button', { name: '取消', exact: true }).click()
        await expect(dialog).toHaveCount(0)
      }
    } finally {
      await context.close()
    }
  }
})

test('role management creates, edits and changes enablement at desktop and 390px', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const directory = resolve(process.cwd(), '..', '.scratch', 'issue-385-role')
  mkdirSync(directory, { recursive: true })

  for (const width of [1280, 390]) {
    const roleName = `角色页-${width}-${randomBytes(6).toString('hex')}`
    const updatedName = `${roleName}-已编辑`
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 800 },
    })
    try {
      const page = await context.newPage()
      await signIn(page)
      await openRoleManagement(page)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)

      if (width === 390) {
        await expect(
          page.getByRole('button', { name: '新增角色', exact: true }),
        ).toBeVisible()
        await page.screenshot({
          animations: 'disabled',
          path: resolve(directory, '390-list.png'),
        })
      }
      await createRole(page, {
        name: roleName,
        permissionText: '系统管理 · 用户管理 · 新增',
      })
      const row = await findRoleRow(page, roleName)
      await row.getByRole('button', { name: '编辑', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByLabel('权限', { exact: true })).toBeEnabled()
      if (width === 390)
        await page.screenshot({
          animations: 'disabled',
          path: resolve(directory, '390-editor.png'),
        })
      await dialog.getByLabel('名称', { exact: true }).fill(updatedName)
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const updated = await findRoleRow(page, updatedName)
      await updated.getByRole('button', { name: '停用', exact: true }).click()
      await expect(
        updated.getByRole('button', { name: '启用', exact: true }),
      ).toBeVisible()
      await updated.getByRole('button', { name: '启用', exact: true }).click()
      await expect(
        updated.getByRole('button', { name: '停用', exact: true }),
      ).toBeVisible()
    } finally {
      await context.close()
    }
  }
})

test('a role with one non-query permission grants the menu without an overbroad request and is revoked on Session restore', async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000)
  const suffix = randomBytes(6).toString('hex')
  const roleName = `单项权限-${suffix}`
  const userCode = `role-ui-${suffix}`
  const initialPassword = password()
  const changedPassword = password()

  await signIn(page)
  await openRoleManagement(page)
  await createRole(page, {
    name: roleName,
    permissionText: '系统管理 · 用户管理 · 查看',
  })
  await openUserManagement(page)
  await createUser(page, {
    code: userCode,
    name: '角色权限测试用户',
    password: initialPassword,
  })

  const row = await findUserRow(page, userCode)
  await row.getByRole('button', { name: '编辑', exact: true }).click()
  const editor = page.getByRole('dialog')
  await expect(editor.getByRole('combobox', { name: '角色' })).toBeEnabled()
  await editor.getByRole('combobox', { name: '角色' }).press('ArrowDown')
  await toggleVirtualOption(page, targetE2ERoleText)
  await toggleVirtualOption(page, roleName)
  await closeOpenListbox(page)
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor).toHaveCount(0)

  const userContext = await browser.newContext()
  try {
    const userPage = await userContext.newPage()
    await signIn(userPage, userCode, initialPassword)
    await completeRequiredPasswordChange(
      userPage,
      initialPassword,
      changedPassword,
    )
    await signIn(userPage, userCode, changedPassword)
    const requests: string[] = []
    userPage.on('request', (request) => requests.push(request.url()))
    await userPage.goto('/app/user')
    await expect(
      userPage.locator('.management-page .v-card-title'),
    ).toContainText('用户管理')
    await expect(userPage.locator('a[href="/app/user"]')).toHaveCount(1)
    expect(requests.some((url) => url.endsWith('/app/user/query'))).toBe(false)

    const restored = await userPage.request.post(
      `${process.env.TARGET_API_BASE_URL}/session/auth/restore`,
      { data: {}, headers: { 'X-ZERP-Model-Build': modelBuildId } },
    )
    const restoreBody = (await restored.json()) as {
      code: number
      data?: { csrfToken: string; user: { id: string } }
    }
    expect(restoreBody.code).toBe(0)
    const csrfToken = restoreBody.data!.csrfToken
    const userId = restoreBody.data!.user.id

    await openRoleManagement(page)
    const roleRow = await findRoleRow(page, roleName)
    await roleRow.getByRole('button', { name: '停用', exact: true }).click()
    await expect(
      roleRow.getByRole('button', { name: '启用', exact: true }),
    ).toBeVisible()

    const revokedGet = await userPage.request.post(
      `${process.env.TARGET_API_BASE_URL}/app/user/get`,
      {
        data: { id: userId },
        headers: {
          'X-CSRF-Token': csrfToken,
          'X-ZERP-Model-Build': modelBuildId,
        },
      },
    )
    const revokedBody = (await revokedGet.json()) as {
      code: number
      errorKey: string
    }
    expect(revokedBody.code).not.toBe(0)
    expect(revokedBody.errorKey).toBe('forbidden')

    await userPage.reload()
    await expect(userPage.locator('a[href="/app/user"]')).toHaveCount(0)
    await userPage.goto('/app/user')
    await expect(userPage.getByText('无权访问', { exact: true })).toBeVisible()
  } finally {
    await userContext.close()
  }
})
