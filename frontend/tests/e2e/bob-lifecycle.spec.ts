import { expect, test, type Locator, type Page } from './fixtures'

test.use({ storageState: { cookies: [], origins: [] } })

async function signIn(
  page: Page,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名').fill(credentials.username)
  await page.getByLabel('密码').fill(credentials.password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).not.toHaveURL(/\/signin/)
}

async function signOut(page: Page): Promise<void> {
  await page.locator('.account-button').click()
  await page.getByText('退出登录').click()
  await expect(page).toHaveURL(/\/signin/)
}

async function openSupplier(page: Page): Promise<void> {
  await page.goto('/dcl/supplier')
  await expect(
    page.getByRole('textbox', { name: '供应商编码或主体名称' }),
  ).toBeVisible()
}

function supplierRow(page: Page, code: string) {
  return page.locator('tbody tr').filter({
    has: page.locator('td[data-label="编码"]').filter({ hasText: code }),
  })
}

async function searchSupplier(page: Page, code: string): Promise<void> {
  await page.getByRole('textbox', { name: '供应商编码或主体名称' }).fill(code)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(supplierRow(page, code)).toBeVisible()
}

async function selectSupplierLifecycleAction(
  page: Page,
  code: string,
  label: string,
): Promise<void> {
  const row = supplierRow(page, code)
  const directAction = row.getByRole('button', { name: label, exact: true })
  if (await directAction.count()) {
    await directAction.click()
    return
  }
  const moreButton = row.getByLabel('更多操作')
  const activeMenu = page.locator('.v-overlay.v-menu.v-overlay--active').last()
  let menuOpened = false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await moreButton.click()
    try {
      await activeMenu.waitFor({ state: 'visible', timeout: 1_500 })
      menuOpened = true
      break
    } catch {
      // 浮层退出动画可能把第一次点击解释为关闭；再次点击当前行按钮。
    }
  }
  expect(menuOpened).toBe(true)
  const menuItem = activeMenu.getByRole('listitem').filter({ hasText: label })
  await expect(menuItem).toBeVisible()
  await menuItem.click()
}

async function dismissSupplierNotice(
  page: Page,
  message: string,
): Promise<void> {
  await expect(
    page.getByRole('status').filter({ hasText: message }),
  ).toBeVisible()
  await page.getByRole('button', { name: '关闭提示' }).click()
}

async function selectAutocomplete(
  page: Page,
  editor: Locator,
  label: string,
  keyword: string,
): Promise<void> {
  await editor.getByRole('combobox', { name: label }).fill(keyword)
  const option = page.getByRole('option').filter({ hasText: keyword }).first()
  await expect(option).toBeVisible()
  await option.click()
}

async function openBobCurrentPage(page: Page, path: string): Promise<void> {
  const currentRead = page.waitForResponse((response) =>
    response.url().endsWith(`${path}/query`),
  )
  await page.goto(path)
  const payload = (await (await currentRead).json()) as {
    code: number | string
    message: string
  }
  expect(String(payload.code), payload.message).toBe('0')
}

function partyDeclarationRow(page: Page, partyName: string): Locator {
  return page.locator('tbody tr').filter({ hasText: partyName })
}

function relationshipDeclarationRow(page: Page, code: string): Locator {
  return page.locator('tbody tr').filter({
    has: page.locator('td[data-label="编码"]').filter({ hasText: code }),
  })
}

async function openOtherUnitDeclaration(
  page: Page,
  code: string,
): Promise<Locator> {
  await page.goto('/dcl/other-unit')
  await page.getByRole('textbox', { name: '其他单位编码或主体名称' }).fill(code)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = relationshipDeclarationRow(page, code)
  await expect(row).toHaveCount(1)
  return row
}

async function openPartyDeclarations(
  page: Page,
  partyName: string,
): Promise<Locator> {
  await page.goto('/dcl/party')
  await page
    .getByRole('textbox', { name: '名称、电话、邮箱或地址' })
    .fill(partyName)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = partyDeclarationRow(page, partyName)
  await expect(row).toHaveCount(1)
  return row
}

async function selectPartyLifecycleAction(
  page: Page,
  row: Locator,
  label: string,
): Promise<void> {
  const directAction = row.getByRole('button', { name: label, exact: true })
  if (await directAction.count()) {
    await directAction.click()
    return
  }
  await row.getByRole('button', { name: '更多操作', exact: true }).click()
  await page
    .locator('.v-overlay.v-menu.v-overlay--active')
    .getByRole('listitem')
    .filter({ hasText: label })
    .click()
}

async function selectRelationshipLifecycleAction(
  page: Page,
  row: Locator,
  label: string,
): Promise<void> {
  const directAction = row.getByRole('button', { name: label, exact: true })
  if (await directAction.count()) {
    await directAction.click()
    return
  }
  await row.getByRole('button', { name: /更多操作/ }).click()
  await page
    .locator('.v-overlay.v-menu.v-overlay--active')
    .getByRole('listitem')
    .filter({ hasText: label })
    .click()
}

test(
  '原子创建 Party 与其他单位，候选不泄漏且批准后显示当前关系卡片',
  { tag: '@mobile' },
  async ({ page, workerState }, testInfo) => {
    test.setTimeout(120_000)
    const suffix = `${testInfo.project.name}-${testInfo.parallelIndex}`
    const partyName = `E2E 服务主体 ${suffix}`

    await signIn(page, workerState.operator)
    await page.goto('/dcl/other-unit')
    await expect(
      page.getByRole('textbox', { name: '其他单位编码或主体名称' }),
    ).toBeVisible()
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const editor = page.locator('.dcl-relationship-drawer')
    await editor.getByText('选择已有主体', { exact: true }).click()
    await page.getByRole('option', { name: '新建主体', exact: true }).click()
    await editor.getByLabel('法定名称').fill(partyName)
    await selectAutocomplete(page, editor, '经营主体', '上海示例')
    await editor.getByLabel('联系人').fill('E2E 联系人')
    await editor.getByRole('button', { name: '保存', exact: true }).click()

    const createdRow = page.locator('tbody tr').filter({ hasText: partyName })
    await expect(createdRow).toHaveCount(1)
    const code = (
      await createdRow.locator('td[data-label="编码"]').textContent()
    )?.trim()
    expect(code).toMatch(/^OUT-\d{4}$/)

    let partyRow = await openPartyDeclarations(page, partyName)
    await partyRow
      .getByRole('button', { name: new RegExp(`编辑 ${partyName}`) })
      .click()
    const partyDrawer = page.locator('.dcl-party-drawer')
    await expect(partyDrawer).toContainText('没有当前权限可见的受影响关系。')
    await expect(partyDrawer).not.toContainText(`${code} · 服务关系`)
    await partyDrawer.getByRole('button', { name: '关闭', exact: true }).click()

    await selectPartyLifecycleAction(page, partyRow, '提交审核')
    await expect(partyDeclarationRow(page, partyName)).toContainText('待批准')
    await signOut(page)

    await signIn(page, workerState.reviewer)
    partyRow = await openPartyDeclarations(page, partyName)
    await selectPartyLifecycleAction(page, partyRow, '审核通过')
    await expect(partyDeclarationRow(page, partyName)).toContainText('已批准')
    await signOut(page)

    await signIn(page, workerState.operator)
    let relationshipRow = await openOtherUnitDeclaration(page, code!)
    await selectRelationshipLifecycleAction(page, relationshipRow, '提交审核')
    await dismissSupplierNotice(page, '已提交审核')
    await signOut(page)

    await signIn(page, workerState.reviewer)
    relationshipRow = await openOtherUnitDeclaration(page, code!)
    await selectRelationshipLifecycleAction(page, relationshipRow, '审核通过')
    await dismissSupplierNotice(page, '已审核通过')
    await expect(relationshipDeclarationRow(page, code!)).toContainText(
      '已批准',
    )
    await signOut(page)

    await signIn(page, workerState.operator)
    partyRow = await openPartyDeclarations(page, partyName)
    await partyRow
      .getByRole('button', { name: new RegExp(`编辑 ${partyName}`) })
      .click()
    await expect(partyDrawer).toContainText(`${code} · 服务关系`)
    await expect(partyDrawer).toContainText('上海示例')
  },
)

test(
  'BOB 客户与客户结算子账户只读取当前有效资料',
  { tag: '@mobile' },
  async ({ page, workerState }) => {
    await signIn(page, workerState.operator)
    const legacyLifecycleRequests: string[] = []
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (/^\/bob\/customer(?:-account)?\/(?!query$|get$)/.test(pathname)) {
        legacyLifecycleRequests.push(pathname)
      }
    })
    await openBobCurrentPage(page, '/bob/customer')
    await openBobCurrentPage(page, '/bob/customer-account')
    expect(legacyLifecycleRequests).toEqual([])
  },
)

test(
  '供应商申报经 DCL 批准后可创建候选版本',
  { tag: '@mobile' },
  async ({ page, workerState }, testInfo) => {
    test.setTimeout(120_000)
    const supplierName = `E2E 已批准供应商 ${testInfo.project.name} ${testInfo.parallelIndex}`

    await signIn(page, workerState.operator)
    await openSupplier(page)
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const editor = page.locator('.dcl-supplier-drawer')
    await editor.getByText('选择已有主体', { exact: true }).click()
    await page.getByRole('option', { name: '新建主体', exact: true }).click()
    await editor.getByLabel('法定名称').fill(supplierName)
    await selectAutocomplete(page, editor, '经营主体', '上海示例')
    await selectAutocomplete(page, editor, '结算方式', '当月结')
    await selectAutocomplete(
      page,
      editor,
      '默认采购员',
      workerState.fixtures.employee,
    )
    await editor.getByRole('button', { name: '保存', exact: true }).click()

    const createdRow = page
      .locator('tbody tr')
      .filter({ hasText: supplierName })
    await expect(createdRow).toHaveCount(1)
    const code = (
      await createdRow.locator('td[data-label="编码"]').textContent()
    )?.trim()
    expect(code).toMatch(/^SUP-\d{4}$/)
    await page.getByRole('button', { name: '关闭提示' }).click()

    let partyRow = await openPartyDeclarations(page, supplierName)
    await selectPartyLifecycleAction(page, partyRow, '提交审核')
    await expect(partyDeclarationRow(page, supplierName)).toContainText(
      '待批准',
    )
    await signOut(page)

    await signIn(page, workerState.reviewer)
    partyRow = await openPartyDeclarations(page, supplierName)
    await selectPartyLifecycleAction(page, partyRow, '审核通过')
    await expect(partyDeclarationRow(page, supplierName)).toContainText(
      '已批准',
    )
    await signOut(page)

    await signIn(page, workerState.operator)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await selectSupplierLifecycleAction(page, code!, '提交审核')
    await dismissSupplierNotice(page, '已提交审核')
    await signOut(page)

    await signIn(page, workerState.reviewer)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await selectSupplierLifecycleAction(page, code!, '审核通过')
    await dismissSupplierNotice(page, '已审核通过')
    await expect(supplierRow(page, code!)).toContainText('已批准')
    await signOut(page)

    await signIn(page, workerState.operator)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await supplierRow(page, code!).getByRole('button', { name: /编辑/ }).click()
    await editor.getByLabel('联系人').fill('候选联系人')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '关闭提示' }).click()
    await editor.getByRole('button', { name: '取消', exact: true }).click()
    await searchSupplier(page, code!)
    await expect(supplierRow(page, code!)).toContainText('草稿')
    await expect(supplierRow(page, code!)).toContainText('有')
  },
)
