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

test('收款单完成附件、完整生命周期、反向流转和审计', async ({ page }) => {
  test.setTimeout(180_000)
  const fixture = vouFixture()
  await signIn(page)
  await page.goto('/vou/receipt')
  await page.getByRole('button', { name: '新建单据' }).click()
  const workspace = page.locator('.voucher-workspace')

  await selectReference(page, '客户', fixture.customer, workspace)
  await selectReference(page, '经办人', fixture.employee, workspace)
  await selectReference(page, '资金账户', fixture.fundAccount, workspace)
  await expect(workspace.getByLabel('币种')).not.toBeVisible()
  await workspace.getByRole('button', { name: '更多设置' }).click()
  await expect(workspace.getByLabel('币种')).toHaveValue(fixture.currency)
  await page.getByLabel('金额').fill('100.00')
  await page.getByRole('button', { name: '创建草稿' }).click()
  await expectDraftCreated(workspace, /^REC-\d{8}-\d{6}$/)

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
  await page.getByRole('button', { name: '核对', exact: true }).click()
  await expect(workspace.getByText('已核对', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '批准', exact: true }).click()
  await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '完成', exact: true }).click()
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

test('销售履约按批准结果自动生成出库、配送和签收草稿', async ({ page }) => {
  test.setTimeout(180_000)
  const fixture = vouFixture()
  await signIn(page)

  await page.goto('/wfl/sales-fulfillment')
  await page.getByRole('button', { name: '新建销售履约' }).click()
  let editor = page.getByRole('dialog')
  await expect(editor.getByLabel('币种')).not.toBeVisible()
  await editor.getByRole('button', { name: '更多设置' }).click()
  await expect(editor.getByLabel('币种')).toHaveValue('CNY')
  await selectReference(page, '客户', fixture.customer, editor)
  await selectReference(page, /业务员/, fixture.employee, editor)
  await selectReference(page, '产品', fixture.product, editor)

  const draftLine = editor.locator('.voucher-lines__table tbody tr').first()
  const originalLineHeight = await draftLine.evaluate(
    (element) => element.getBoundingClientRect().height,
  )
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText(/第 1 行/)).toBeVisible()
  await expect.poll(
    () => draftLine.evaluate((element) => element.getBoundingClientRect().height),
  ).toBe(originalLineHeight)
  const draftInputs = draftLine.locator('input')
  await draftInputs.nth(1).fill('2')
  await draftInputs.nth(2).fill('12.50')
  await expect(draftLine).toContainText('25.00')
  await editor.getByRole('button', { name: '保存', exact: true }).click()

  const stages = page.locator('.sales-fulfillment__stages')
  const stageCard = (name: string) =>
    stages.locator('.v-card').filter({ hasText: name }).first()
  const order = stageCard('销售订单')
  await expect(order).toContainText(/SO-\d{8}-\d{6}/)
  await order.getByRole('button', { name: '核对', exact: true }).click()
  await order.getByRole('button', { name: '批准', exact: true }).click()

  const outbound = stageCard('出库')
  await expect(outbound).toContainText('草稿')
  await expect(outbound.getByText(/来源：/)).toBeVisible()
  await outbound.getByRole('button', { name: '编辑', exact: true }).click()
  editor = page.getByRole('dialog')
  await expect(editor.getByLabel('来源单据')).toHaveAttribute('readonly', '')
  await selectReference(page, '仓库', fixture.warehouse, editor)
  await editor.getByRole('button', { name: '保存', exact: true }).click()

  await order.getByRole('button', { name: '完成', exact: true }).click()
  await outbound.getByRole('button', { name: '核对', exact: true }).click()
  await outbound.getByRole('button', { name: '批准', exact: true }).click()
  await outbound.getByRole('button', { name: '完成', exact: true }).click()

  const delivery = stageCard('配送')
  await expect(delivery).toContainText('草稿')
  await delivery.getByRole('button', { name: '编辑', exact: true }).click()
  editor = page.getByRole('dialog')
  await selectReference(page, '物流平台', fixture.platform, editor)
  await selectReference(page, '车辆', fixture.vehicle, editor)
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await delivery.getByRole('button', { name: '核对', exact: true }).click()
  await delivery.getByRole('button', { name: '批准', exact: true }).click()
  await delivery.getByRole('button', { name: '完成', exact: true }).click()

  const signoff = stageCard('签收')
  await expect(signoff).toContainText('草稿')
  await signoff.getByRole('button', { name: '编辑', exact: true }).click()
  editor = page.getByRole('dialog')
  await expect(editor.getByLabel('来源单据')).toHaveAttribute('readonly', '')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await signoff.getByRole('button', { name: '核对', exact: true }).click()
  await signoff.getByRole('button', { name: '批准', exact: true }).click()
  await signoff.getByRole('button', { name: '完成', exact: true }).click()
  await expect(signoff).toContainText('已完成')
})
