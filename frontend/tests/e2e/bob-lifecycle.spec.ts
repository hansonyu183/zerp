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

async function openCustomer(page: Page): Promise<void> {
  await page.goto('/bob/customer')
  await expect(page.getByRole('textbox', { name: '客户关键字' })).toBeVisible()
}

async function openSupplier(page: Page): Promise<void> {
  await page.goto('/bob/supplier')
  await expect(
    page.getByRole('textbox', { name: '供应商关键字' }),
  ).toBeVisible()
}

function customerRow(page: Page, code: string) {
  return page.locator('tbody tr').filter({
    has: page.locator('td[data-label="编码"]').filter({ hasText: code }),
  })
}

function supplierRow(page: Page, code: string) {
  return page.locator('tbody tr').filter({
    has: page.locator('td[data-label="编码"]').filter({ hasText: code }),
  })
}

async function searchCustomer(page: Page, code: string): Promise<void> {
  await page.getByRole('textbox', { name: '客户关键字' }).fill(code)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(customerRow(page, code)).toBeVisible()
}

async function searchSupplier(page: Page, code: string): Promise<void> {
  await page.getByRole('textbox', { name: '供应商关键字' }).fill(code)
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
  await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible()
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

async function confirmReason(
  page: Page,
  title: string,
  reason: string,
): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: title })
  await dialog.getByLabel('操作原因').fill(reason)
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
}

test(
  '使用双账号完成客户创建、审核与启禁用',
  { tag: '@mobile' },
  async ({ page, workerState }, testInfo) => {
    test.setTimeout(120_000)
    const customerName = `E2E 生命周期客户 ${testInfo.project.name} ${testInfo.parallelIndex}`

    await signIn(page, workerState.operator)
    await openCustomer(page)
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const editor = page.locator('.customer-workspace__drawer')
    await editor.getByLabel('集团公司名称').fill(`${customerName}集团`)
    await editor.getByLabel('客户名称').fill(customerName)
    await selectAutocomplete(page, editor, '默认经营主体', '上海示例')
    await selectAutocomplete(page, editor, '结算方式', '当月结')
    await selectAutocomplete(page, editor, '收款方式', 'WFL 银行转账')
    await editor.getByLabel('默认运输方式编码').fill('SELF_PICKUP')
    await editor.getByLabel('默认运输方式名称').fill('客户自提')
    await selectAutocomplete(
      page,
      editor,
      '主要业务归属主体',
      workerState.fixtures.employee,
    )
    await editor.getByRole('button', { name: '保存', exact: true }).click()

    const createdRow = page
      .locator('tbody tr')
      .filter({ hasText: customerName })
    await expect(createdRow).toHaveCount(1)
    const code = (
      await createdRow.locator('td[data-label="编码"]').textContent()
    )?.trim()
    expect(code).toMatch(/^CUS-\d{4}$/)
    await searchCustomer(page, code!)
    await expect(customerRow(page, code!)).toContainText('草稿')

    await customerRow(page, code!).getByLabel('提交审核').click()
    await expect(customerRow(page, code!)).toContainText('待审核')
    await customerRow(page, code!).getByLabel('撤回提交').click()
    await confirmReason(page, '撤回提交', 'E2E 验证撤回提交')
    await expect(customerRow(page, code!)).toContainText('草稿')
    await customerRow(page, code!).getByLabel('提交审核').click()
    await signOut(page)

    await signIn(page, workerState.reviewer)
    await openCustomer(page)
    await searchCustomer(page, code!)
    await customerRow(page, code!).getByLabel('审核驳回').click()
    await confirmReason(page, '审核驳回', 'E2E 验证驳回后重提')
    await expect(customerRow(page, code!)).toContainText('草稿')
    await signOut(page)

    await signIn(page, workerState.operator)
    await openCustomer(page)
    await searchCustomer(page, code!)
    await customerRow(page, code!).getByLabel('查看 / 编辑').click()
    await editor.getByLabel('业务联系人').fill('E2E 重提联系人')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await searchCustomer(page, code!)
    await customerRow(page, code!).getByLabel('提交审核').click()
    await signOut(page)

    await signIn(page, workerState.reviewer)
    await openCustomer(page)
    await searchCustomer(page, code!)
    await customerRow(page, code!).getByLabel('审核通过').click()
    let dialog = page.getByRole('dialog').filter({ hasText: '审核通过' })
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await expect(customerRow(page, code!)).toContainText('已生效')

    await customerRow(page, code!).getByLabel('禁用').click()
    dialog = page.getByRole('dialog').filter({ hasText: '确认禁用客户' })
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await expect(customerRow(page, code!).getByLabel('启用')).toBeVisible()
    await customerRow(page, code!).getByLabel('启用').click()
    await expect(customerRow(page, code!).getByLabel('禁用')).toBeVisible()

    await expect(
      customerRow(page, code!).getByLabel('撤销批准'),
    ).toHaveCount(0)
  },
)

test(
  '供应商连续生效、候选启停与删除保持旧有效版本',
  { tag: '@mobile' },
  async ({ page, workerState }, testInfo) => {
    test.setTimeout(120_000)
    const supplierName = `E2E 连续生效供应商 ${testInfo.project.name} ${testInfo.parallelIndex}`

    await signIn(page, workerState.operator)
    await openSupplier(page)
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const editor = page.locator('.supplier-workspace__drawer')
    await editor.getByLabel('供应商名称').fill(supplierName)
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
    await searchSupplier(page, code!)
    await selectSupplierLifecycleAction(page, code!, '提交审核')
    await dismissSupplierNotice(page, '已提交审核')
    await signOut(page)

    await signIn(page, workerState.reviewer)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await selectSupplierLifecycleAction(page, code!, '审核通过')
    let dialog = page.getByRole('dialog').filter({ hasText: '审核通过' })
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await dismissSupplierNotice(page, '已审核通过')
    await expect(supplierRow(page, code!)).toContainText('有效')
    await signOut(page)

    await signIn(page, workerState.operator)
    await openSupplier(page)
    await searchSupplier(page, code!)
    await supplierRow(page, code!).getByLabel('查看 / 编辑').click()
    await editor.getByLabel('联系人').fill('候选联系人')
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '关闭提示' }).click()
    await editor.getByRole('button', { name: '取消', exact: true }).click()
    await searchSupplier(page, code!)
    await expect(supplierRow(page, code!)).toContainText('草稿')
    await expect(supplierRow(page, code!)).toContainText('有')

    await selectSupplierLifecycleAction(page, code!, '禁用')
    dialog = page.getByRole('dialog').filter({ hasText: '确认禁用供应商' })
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await dismissSupplierNotice(page, '已禁用')
    await selectSupplierLifecycleAction(page, code!, '启用')
    await dismissSupplierNotice(page, '已启用')
    await expect(supplierRow(page, code!)).toContainText('草稿')
    await searchSupplier(page, code!)

    await selectSupplierLifecycleAction(page, code!, '删除候选版本')
    dialog = page.getByRole('dialog').filter({ hasText: '确认删除候选版本' })
    await dialog.getByRole('button', { name: '确认', exact: true }).click()
    await dismissSupplierNotice(page, '候选版本已删除')
    await expect(dialog).toHaveCount(0)
    await expect(supplierRow(page, code!)).toContainText('有效')
    await expect(supplierRow(page, code!)).toContainText('—')
  },
)
