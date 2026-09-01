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

function typedArchiveRow(page: Page, code: string): Locator {
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
  const row = typedArchiveRow(page, code)
  await expect(row).toHaveCount(1)
  return row
}

async function selectTypedArchiveLifecycleAction(
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
  '其他单位独立申报并在 DCL 批准后保持当前档案可见',
  { tag: '@mobile' },
  async ({ page, workerState }, testInfo) => {
    test.setTimeout(120_000)
    const suffix = `${testInfo.project.name}-${testInfo.parallelIndex}`
    const archiveName = `E2E 其他单位 ${suffix}`

    await signIn(page, workerState.operator)
    await page.goto('/dcl/other-unit')
    await expect(
      page.getByRole('textbox', { name: '其他单位编码或主体名称' }),
    ).toBeVisible()
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const editor = page.locator('.dcl-typed-archive-drawer')
    await editor.getByLabel('法定名称').fill(archiveName)
    await editor.getByLabel('显示名称').fill(archiveName)
    await selectAutocomplete(page, editor, '适用经营主体', '上海示例')
    await selectAutocomplete(page, editor, '默认经营主体', '上海示例')
    await editor.getByLabel('联系人').fill('E2E 联系人')
    await editor.getByRole('button', { name: '保存', exact: true }).click()

    const createdRow = page.locator('tbody tr').filter({ hasText: archiveName })
    await expect(createdRow).toHaveCount(1)
    const code = (
      await createdRow.locator('td[data-label="编码"]').textContent()
    )?.trim()
    expect(code).toMatch(/^OTU-\d{4}$/)

    let archiveRow = await openOtherUnitDeclaration(page, code!)
    await selectTypedArchiveLifecycleAction(page, archiveRow, '提交')
    await dismissSupplierNotice(page, '已提交')
    await expect(typedArchiveRow(page, code!)).toContainText('待批准')
    await signOut(page)

    await signIn(page, workerState.reviewer)
    archiveRow = await openOtherUnitDeclaration(page, code!)
    await selectTypedArchiveLifecycleAction(page, archiveRow, '批准')
    await dismissSupplierNotice(page, '已批准')
    await expect(typedArchiveRow(page, code!)).toContainText('已批准')
    await expect(typedArchiveRow(page, code!)).toContainText(archiveName)
  },
)

test(
  '供应商变更经 DCL 批准后可创建候选版本',
  { tag: '@mobile' },
  async ({ page, workerState }, testInfo) => {
    test.setTimeout(120_000)
    const supplierName = `E2E 已批准供应商 ${testInfo.project.name} ${testInfo.parallelIndex}`

    await signIn(page, workerState.operator)
    await openSupplier(page)
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const editor = page.locator('.dcl-supplier-drawer')
    await editor.getByLabel('法定名称').fill(supplierName)
    await editor.getByLabel('显示名称').fill(supplierName)
    await selectAutocomplete(page, editor, '适用经营主体', '上海示例')
    await selectAutocomplete(page, editor, '默认经营主体', '上海示例')
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
    await editor.getByRole('button', { name: '取消', exact: true }).click()

    await selectSupplierLifecycleAction(page, code!, '提交')
    await dismissSupplierNotice(page, '已提交')
    const unsubmitRequest = page.waitForRequest((request) =>
      request.url().endsWith('/dcl/supplier/unsubmit'),
    )
    await selectSupplierLifecycleAction(page, code!, '撤回')
    const unsubmitBody = (await unsubmitRequest).postDataJSON() as Record<
      string,
      unknown
    >
    expect(unsubmitBody).not.toHaveProperty('reason')
    await dismissSupplierNotice(page, '已撤回')
    await expect(supplierRow(page, code!)).toContainText('草稿')
    await selectSupplierLifecycleAction(page, code!, '提交')
    await dismissSupplierNotice(page, '已提交')
    await signOut(page)

    await signIn(page, workerState.reviewer)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await selectSupplierLifecycleAction(page, code!, '驳回')
    const rejectDialog = page.getByRole('dialog').filter({ hasText: '驳回' })
    await expect(
      rejectDialog.getByRole('button', { name: '确认驳回', exact: true }),
    ).toBeDisabled()
    await rejectDialog.getByLabel('驳回意见').fill('资料需要补充')
    await rejectDialog
      .getByRole('button', { name: '确认驳回', exact: true })
      .click()
    await dismissSupplierNotice(page, '已驳回')
    await expect(supplierRow(page, code!)).toContainText('草稿')
    await signOut(page)

    await signIn(page, workerState.operator)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await selectSupplierLifecycleAction(page, code!, '提交')
    await dismissSupplierNotice(page, '已提交')
    await signOut(page)

    await signIn(page, workerState.reviewer)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await selectSupplierLifecycleAction(page, code!, '批准')
    await dismissSupplierNotice(page, '已批准')
    await expect(supplierRow(page, code!)).toContainText('已批准')
    await selectSupplierLifecycleAction(page, code!, '反批准')
    const unapproveDialog = page
      .getByRole('dialog')
      .filter({ hasText: '反批准' })
    await expect(
      unapproveDialog.getByRole('button', { name: '确认', exact: true }),
    ).toBeDisabled()
    await unapproveDialog.getByLabel('原因').fill('需要重新确认资料')
    await unapproveDialog
      .getByRole('button', { name: '确认', exact: true })
      .click()
    await dismissSupplierNotice(page, '已反批准')
    await expect(supplierRow(page, code!)).toContainText('待批准')
    await signOut(page)

    await signIn(page, workerState.operator)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await selectSupplierLifecycleAction(page, code!, '撤回')
    await dismissSupplierNotice(page, '已撤回')
    await expect(supplierRow(page, code!)).toContainText('草稿')
    await selectSupplierLifecycleAction(page, code!, '提交')
    await dismissSupplierNotice(page, '已提交')
    await signOut(page)

    await signIn(page, workerState.reviewer)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await selectSupplierLifecycleAction(page, code!, '批准')
    await dismissSupplierNotice(page, '已批准')
    await signOut(page)

    await signIn(page, workerState.operator)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await supplierRow(page, code!)
      .getByRole('button', { name: '发起变更', exact: true })
      .click()
    await editor.getByLabel('联系人').fill('候选联系人')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '关闭提示' }).click()
    await editor.getByRole('button', { name: '取消', exact: true }).click()
    await searchSupplier(page, code!)
    await expect(supplierRow(page, code!)).toContainText('草稿')
    await expect(supplierRow(page, code!)).toContainText('有')
  },
)
