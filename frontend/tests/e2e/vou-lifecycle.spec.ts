import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  e2eEnv,
  readWflBootstrapState,
  wflBootstrapEnabled,
} from './wfl-runtime'

const requiredVouFixtureNames = [
  'E2E_VOU_CUSTOMER_KEYWORD',
  'E2E_VOU_SUPPLIER_KEYWORD',
  'E2E_VOU_EMPLOYEE_KEYWORD',
  'E2E_VOU_WAREHOUSE_KEYWORD',
  'E2E_VOU_PRODUCT_KEYWORD',
  'E2E_VOU_PLATFORM_KEYWORD',
  'E2E_VOU_VEHICLE_KEYWORD',
  'E2E_VOU_FUND_ACCOUNT_KEYWORD',
  'E2E_VOU_CURRENCY',
] as const

const missingVouFixtureNames = requiredVouFixtureNames.filter(
  (name) => !e2eEnv(name),
)

if (!wflBootstrapEnabled() && missingVouFixtureNames.length > 0) {
  throw new Error(
    `VOU Playwright 用例缺少真实测试后端资料：${missingVouFixtureNames.join(', ')}`,
  )
}

const credentials = {
  username: e2eEnv('E2E_USERNAME'),
  password: e2eEnv('E2E_PASSWORD'),
}

function vouFixture() {
  if (wflBootstrapEnabled()) {
    const state = readWflBootstrapState()
    return {
      customer: state.fixtures.customer,
      supplier: state.fixtures.supplier,
      employee: state.fixtures.employee,
      warehouse: state.fixtures.warehouse,
      product: state.fixtures.solventProduct,
      platform: state.fixtures.platform,
      vehicle: state.fixtures.vehicle,
      fundAccount: state.fixtures.fundAccount,
      currency: 'CNY',
    }
  }
  return {
    customer: e2eEnv('E2E_VOU_CUSTOMER_KEYWORD'),
    supplier: e2eEnv('E2E_VOU_SUPPLIER_KEYWORD'),
    employee: e2eEnv('E2E_VOU_EMPLOYEE_KEYWORD'),
    warehouse: e2eEnv('E2E_VOU_WAREHOUSE_KEYWORD'),
    product: e2eEnv('E2E_VOU_PRODUCT_KEYWORD'),
    platform: e2eEnv('E2E_VOU_PLATFORM_KEYWORD'),
    vehicle: e2eEnv('E2E_VOU_VEHICLE_KEYWORD'),
    fundAccount: e2eEnv('E2E_VOU_FUND_ACCOUNT_KEYWORD'),
    currency: e2eEnv('E2E_VOU_CURRENCY'),
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名').fill(credentials.username)
  await page.getByLabel('密码').fill(credentials.password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).not.toHaveURL(/\/signin/)
}

async function selectReference(
  page: Page,
  label: string | RegExp,
  keyword: string,
  scope: Page | Locator = page,
): Promise<void> {
  const input = scope.getByRole('combobox', { name: label }).first()
  await input.click()
  await input.fill(keyword)
  const option = page.getByRole('option').filter({ hasText: keyword }).first()
  await expect(option).toBeVisible()
  await option.click()
}

async function reverse(page: Page, button: string): Promise<void> {
  await page.getByRole('button', { name: button, exact: true }).click()
  await page.getByLabel('原因').fill(`E2E ${button}`)
  await page.getByRole('button', { name: `确认${button}`, exact: true }).click()
}

async function expectDraftCreated(
  workspace: Locator,
  documentNo: RegExp,
): Promise<void> {
  await expect(workspace.getByText('草稿', { exact: true })).toBeVisible()
  await expect(
    workspace.locator('.voucher-document-header__number'),
  ).toHaveText(documentNo)
}

async function expectNoPageHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    )
    .toEqual({
      clientWidth: page.viewportSize()!.width,
      scrollWidth: page.viewportSize()!.width,
    })
}

test('收款单完成附件、完整生命周期、反向流转和审计', async ({ page }) => {
  test.setTimeout(180_000)
  const fixture = vouFixture()
  await signIn(page)
  await page.goto('/vou/customer-receipt')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')
  await expect(workspace.getByText('币种', { exact: true })).toHaveCount(0)
  await expect(workspace.getByText('更多设置', { exact: true })).toHaveCount(0)

  await selectReference(page, '客户', fixture.customer, workspace)
  await selectReference(page, '经办人', fixture.employee, workspace)
  await selectReference(page, '资金账户', fixture.fundAccount, workspace)
  await page.getByLabel('金额').fill('100.00')
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  await expectDraftCreated(workspace, /^REC-\d{8}-\d{4}$/)
  const documentNo = (
    await workspace.locator('.voucher-document-header__number').textContent()
  )?.trim()
  expect(documentNo).toMatch(/^REC-\d{8}-\d{4}$/)

  await page.getByRole('tab', { name: '附件' }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'vou-e2e.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nE2E\n%%EOF'),
  })
  await expect(workspace.getByText('已上传', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByLabel('下载 vou-e2e.pdf').click()
  expect((await download).suggestedFilename()).toBe('vou-e2e.pdf')

  await page.getByRole('tab', { name: '单据' }).click()
  await page.getByRole('button', { name: '取消编辑' }).click()
  await page.goto('/home/dashboard')
  await page.getByRole('tab', { name: '待处理单据' }).click()
  await page.getByRole('textbox', { name: '单号或往来方' }).fill(documentNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const workbenchRow = page.locator('tbody tr').filter({ hasText: documentNo! })
  await expect(workbenchRow).toContainText('待核对')
  await workbenchRow.getByLabel(`核对 ${documentNo}`).click()
  await expect(workbenchRow).toContainText('待批准')
  await workbenchRow.getByLabel(`批准 ${documentNo}`).click()
  await expect(workbenchRow).toContainText('待完成')
  await workbenchRow.getByLabel(`完成 ${documentNo}`).click()
  await expect(workbenchRow).toHaveCount(0)

  await page.goto('/vou/customer-receipt')
  await page
    .getByRole('textbox', { name: '单号或往来方关键字' })
    .fill(documentNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const documentRow = page.locator('tbody tr').filter({ hasText: documentNo! })
  await expect(documentRow).toBeVisible()
  await documentRow.getByLabel(`查看 ${documentNo}`).click()
  await expect(workspace.getByText('已完成', { exact: true })).toBeVisible()

  await reverse(page, '撤销完成')
  await reverse(page, '反批准')
  await reverse(page, '反核对')
  await expect(workspace.getByText('草稿', { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: '审计' }).click()
  await expect(
    workspace.getByText('撤销完成', { exact: true }).first(),
  ).toBeVisible()
  await expect(
    workspace.getByText('反核对', { exact: true }).first(),
  ).toBeVisible()
  await page.getByRole('tab', { name: '附件' }).click()
  await page.getByLabel('移除 vou-e2e.pdf').click()
  await expect(workspace.getByText('暂无附件')).toBeVisible()
})

test('库存盘点加载账面库存并按完成时差异过账', async ({ page }) => {
  test.setTimeout(180_000)
  const fixture = vouFixture()
  await signIn(page)
  await page.goto('/vou/inventory-count')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')

  await selectReference(page, '仓库', fixture.warehouse, workspace)
  await workspace
    .getByRole('button', { name: '加载非零库存', exact: true })
    .click()
  const countLine = workspace
    .locator('.inventory-count-lines__table tbody tr')
    .filter({ hasText: fixture.product })
    .first()
  await expect(countLine).toBeVisible()
  const bookQuantity = Number(
    (
      await countLine.locator('td[data-label="账面数量"]').textContent()
    )?.trim(),
  )
  expect(Number.isFinite(bookQuantity)).toBe(true)
  await countLine
    .locator('input')
    .nth(1)
    .fill(String(bookQuantity + 1))
  await expect(countLine.locator('td[data-label="差异"]')).toHaveText('1')

  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  await expectDraftCreated(workspace, /^IVC-\d{8}-\d{4}$/)
  await workspace.getByRole('button', { name: '取消编辑' }).click()
  await workspace.getByRole('button', { name: '核对', exact: true }).click()
  await workspace.getByRole('button', { name: '批准', exact: true }).click()
  await workspace.getByRole('button', { name: '完成盘点', exact: true }).click()
  await expect(workspace.getByText(/^已盘点 · r\d+$/)).toBeVisible()
  await expect
    .poll(async () =>
      Number(
        await countLine.locator('td[data-label="账面数量"]').textContent(),
      ),
    )
    .toBe(bookQuantity)
  await expect
    .poll(async () =>
      Number(await countLine.locator('td[data-label="差异"]').textContent()),
    )
    .toBe(1)

  await reverse(page, '撤销盘点')
})

test('销售订单独立流转并由流程事件自动生成出库草稿', async ({ page }) => {
  test.skip(
    test.info().project.name === 'mobile-chromium',
    '该有状态用例在桌面项目内切换到 390px 验收手机布局',
  )
  test.setTimeout(180_000)
  const fixture = vouFixture()
  await signIn(page)

  await page.goto('/vou/sale-order')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')
  await selectReference(page, '客户', fixture.customer, workspace)
  await selectReference(page, /业务员/, fixture.employee, workspace)
  await selectReference(page, '仓库', fixture.warehouse, workspace)
  await selectReference(page, '产品', fixture.product, workspace)

  const draftLine = workspace.locator('.voucher-lines__table tbody tr').first()
  const originalLineHeight = await draftLine.evaluate(
    (element) => element.getBoundingClientRect().height,
  )
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText(/第 1 行/)).toBeVisible()
  await expect
    .poll(() =>
      draftLine.evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBe(originalLineHeight)
  const draftInputs = draftLine.locator('input')
  await draftInputs.nth(1).fill('2')
  await draftInputs.nth(2).fill('12.50')
  await expect(draftLine).toContainText('25.00')
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  await expectDraftCreated(workspace, /^SOR-\d{8}-\d{4}$/)
  const orderNo = (
    await workspace.locator('.voucher-document-header__number').textContent()
  )?.trim()
  expect(orderNo).toBeTruthy()
  await workspace.getByRole('button', { name: '取消编辑' }).click()
  await workspace.getByRole('button', { name: '核对', exact: true }).click()
  await expect(workspace.getByText('已核对', { exact: true })).toBeVisible()
  await workspace.getByRole('button', { name: '批准', exact: true }).click()
  await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()

  await page.goto('/vou/sale-order')
  await page.getByRole('textbox', { name: '单号' }).fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(
    page.locator('tbody tr').filter({ hasText: orderNo! }),
  ).toContainText('订购 / 出库 / 净签收')

  await page.goto('/wfl/sales-fulfillment')
  await page
    .getByRole('textbox', { name: '产品或往来单位' })
    .fill(fixture.product)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const processRow = page.locator('tbody tr').filter({ hasText: orderNo! })
  await expect(processRow).toHaveCount(1)
  await expect(processRow).toContainText('销售履约')
  await expect(processRow).toContainText(fixture.customer)
  await expect(processRow).toContainText('销售订单 / 销售出库')
  await expect(processRow).toContainText('1/1 / 0/1')
  await expect(
    page.getByRole('columnheader', { name: '流程完成情况' }),
  ).toBeVisible()
  await expect(
    page.getByRole('columnheader', { name: '往来单位' }),
  ).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '根单据' })).toHaveCount(
    0,
  )
  await expect(page.getByRole('columnheader', { name: '状态' })).toHaveCount(0)
  await expect(
    page.getByRole('columnheader', { name: '更新时间' }),
  ).toHaveCount(0)
  await page.getByText('筛选条件', { exact: true }).click()
  await selectReference(page, '往来单位', fixture.customer)
  await page.getByRole('button', { name: '应用筛选', exact: true }).click()
  await expect(processRow).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page
    .getByRole('textbox', { name: '产品或往来单位' })
    .fill(fixture.product)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const mobileProcess = page
    .locator('.instance-card')
    .filter({ hasText: orderNo! })
  await expect(mobileProcess).toBeVisible()
  await expect(mobileProcess).toContainText('销售履约')
  await expect(mobileProcess).toContainText('流程完成情况')
  await expect(mobileProcess).not.toContainText('根单据：')
  await expect(mobileProcess).not.toContainText('更新时间')
  await expect(mobileProcess).not.toContainText('进行中')
  await expectNoPageHorizontalOverflow(page)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.reload()
  await page
    .getByRole('textbox', { name: '产品或往来单位' })
    .fill(fixture.product)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const desktopProcessRow = page
    .locator('tbody tr')
    .filter({ hasText: orderNo! })
  await desktopProcessRow.getByRole('button', { name: '更多操作' }).click()
  await page.getByText('查看流程', { exact: true }).click()
  const composition = page.getByRole('dialog')
  await expect(composition).toContainText(orderNo!)
  const outbound = composition
    .locator('.instance-node')
    .filter({ hasText: '销售出库' })
  await expect(outbound).toContainText(/^.*销售出库.*SOB-\d{8}-\d{4}.*草稿.*$/)
  const outboundNo = (await outbound.textContent())?.match(
    /SOB-\d{8}-\d{4}/,
  )?.[0]
  expect(outboundNo).toBeTruthy()

  await outbound.click()
  const outboundWorkspace = page.locator('.voucher-workspace')
  await expect(outboundWorkspace).toBeVisible()
  await expect(outboundWorkspace.getByLabel('来源单据')).toHaveAttribute(
    'readonly',
    '',
  )
  await expect(
    page.getByRole('button', { name: '新增', exact: true }),
  ).toHaveCount(0)

  await page.goto('/home/dashboard')
  await page.getByRole('tab', { name: '待处理单据' }).click()
  const keyword = page.getByRole('textbox', { name: '单号或往来方' })
  await keyword.fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const orderWorkbenchRow = page
    .locator('tbody tr')
    .filter({ hasText: orderNo! })
  await expect(orderWorkbenchRow).toContainText('待完成')
  await orderWorkbenchRow.getByLabel(`完成 ${orderNo}`).click()
  await expect(orderWorkbenchRow).toHaveCount(0)

  await keyword.fill(outboundNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const outboundWorkbenchRow = page
    .locator('tbody tr')
    .filter({ hasText: outboundNo! })
  await expect(outboundWorkbenchRow).toContainText('待核对')
  await outboundWorkbenchRow.getByLabel(`核对 ${outboundNo}`).click()
  await expect(outboundWorkbenchRow).toContainText('待批准')
  await outboundWorkbenchRow.getByLabel(`批准 ${outboundNo}`).click()
  await expect(outboundWorkbenchRow).toContainText('待完成')
  await outboundWorkbenchRow.getByLabel(`完成 ${outboundNo}`).click()
  await expect(outboundWorkbenchRow).toHaveCount(0)
})

test('采购流程列表展示中文阶段和按单位履约数据', async ({ page }) => {
  test.skip(
    test.info().project.name === 'mobile-chromium',
    '该有状态用例在桌面项目内切换到 430px 验收手机布局',
  )
  test.setTimeout(180_000)
  const fixture = vouFixture()
  await signIn(page)

  await page.goto('/vou/purchase-order')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')
  await selectReference(page, '供应商', fixture.supplier, workspace)
  await selectReference(page, /采购员/, fixture.employee, workspace)
  await selectReference(page, '仓库', fixture.warehouse, workspace)
  await selectReference(page, '产品', fixture.product, workspace)
  const draftInputs = workspace
    .locator('.voucher-lines__table tbody tr')
    .first()
    .locator('input')
  await draftInputs.nth(1).fill('3')
  await draftInputs.nth(2).fill('10')
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  await expectDraftCreated(workspace, /^POR-\d{8}-\d{4}$/)
  const orderNo = (
    await workspace.locator('.voucher-document-header__number').textContent()
  )?.trim()
  expect(orderNo).toBeTruthy()
  await workspace.getByRole('button', { name: '取消编辑' }).click()
  await workspace.getByRole('button', { name: '核对', exact: true }).click()
  await workspace.getByRole('button', { name: '批准', exact: true }).click()
  await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()

  await page.goto('/vou/purchase-order')
  await page.getByRole('textbox', { name: '单号' }).fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(
    page.locator('tbody tr').filter({ hasText: orderNo! }),
  ).toContainText('订购 / 净入库')

  await page.goto('/wfl/purchase-fulfillment')
  await page
    .getByRole('textbox', { name: '产品或往来单位' })
    .fill(fixture.product)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const processRow = page.locator('tbody tr').filter({ hasText: orderNo! })
  await expect(processRow).toHaveCount(1)
  await expect(processRow).toContainText('采购履约')
  await expect(processRow).toContainText(fixture.supplier)
  await expect(processRow).toContainText('采购订单 / 采购入库')
  await expect(processRow).toContainText('1/1 / 0/1')
  await processRow.getByRole('button', { name: '更多操作' }).click()
  await page.getByText('查看流程', { exact: true }).click()
  const processDialog = page.getByRole('dialog')
  await expect(processDialog).toContainText('采购订单')
  await expect(processDialog).toContainText('采购入库')
  await page.keyboard.press('Escape')
  await expect(processDialog).toBeHidden()
  await page.setViewportSize({ width: 430, height: 932 })
  await page.reload()
  await page
    .getByRole('textbox', { name: '产品或往来单位' })
    .fill(fixture.product)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const mobileProcess = page
    .locator('.instance-card')
    .filter({ hasText: orderNo! })
  await expect(mobileProcess).toBeVisible()
  await expect(mobileProcess).toContainText('采购履约')
  await expectNoPageHorizontalOverflow(page)
})
