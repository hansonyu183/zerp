import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test'
import { loadEnv } from 'vite'

const localE2EEnv = loadEnv('e2e', process.cwd(), '')
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

for (const name of requiredVouFixtureNames) {
  if (process.env[name] === undefined && localE2EEnv[name] !== undefined) {
    process.env[name] = localE2EEnv[name]
  }
}

const missingVouFixtureNames = requiredVouFixtureNames.filter(
  (name) => !process.env[name],
)

if (missingVouFixtureNames.length > 0) {
  throw new Error(
    `VOU Playwright 用例缺少真实测试后端资料：${missingVouFixtureNames.join(', ')}`,
  )
}

const credentials = {
  username: process.env.E2E_USERNAME!,
  password: process.env.E2E_PASSWORD!,
}

const fixture = {
  customer: process.env.E2E_VOU_CUSTOMER_KEYWORD!,
  supplier: process.env.E2E_VOU_SUPPLIER_KEYWORD!,
  employee: process.env.E2E_VOU_EMPLOYEE_KEYWORD!,
  warehouse: process.env.E2E_VOU_WAREHOUSE_KEYWORD!,
  product: process.env.E2E_VOU_PRODUCT_KEYWORD!,
  platform: process.env.E2E_VOU_PLATFORM_KEYWORD!,
  vehicle: process.env.E2E_VOU_VEHICLE_KEYWORD!,
  fundAccount: process.env.E2E_VOU_FUND_ACCOUNT_KEYWORD!,
  currency: process.env.E2E_VOU_CURRENCY!,
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

async function reverse(
  page: Page,
  button: '反执行' | '反批准' | '反审核',
): Promise<void> {
  await page.getByRole('button', { name: button, exact: true }).click()
  await page.getByLabel('原因').fill(`E2E ${button}`)
  await page.getByRole('button', { name: `确认${button}` }).click()
}

function localDate(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

async function expectDraftCreated(
  workspace: Locator,
  documentNo: RegExp,
  isMobile: boolean,
): Promise<void> {
  await expect(workspace.getByText('草稿', { exact: true })).toBeVisible()
  if (!isMobile) await expect(workspace.getByText(documentNo)).toBeVisible()
}

test('收款单完成附件、完整生命周期、反向流转和审计', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(180_000)
  await signIn(page)
  await page.goto('/vou/receipt')
  await page.getByRole('button', { name: '新建单据' }).click()
  const workspace = page.locator('.voucher-workspace')

  await selectReference(page, '客户', fixture.customer, workspace)
  await selectReference(page, '经办人', fixture.employee, workspace)
  await selectReference(page, '资金账户', fixture.fundAccount, workspace)
  await expect(page.getByLabel('币种')).toHaveValue(fixture.currency)
  await page.getByLabel('金额').fill('100.00')
  await page.getByRole('button', { name: '创建草稿' }).click()
  await expectDraftCreated(workspace, /^REC-\d{8}-\d{6}$/, isMobile)

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
  await page.getByRole('button', { name: '审核', exact: true }).click()
  await expect(workspace.getByText('已审核', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '批准', exact: true }).click()
  await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '执行', exact: true }).click()
  await page.getByRole('button', { name: '确认执行' }).click()
  await expect(workspace.getByText('已执行', { exact: true })).toBeVisible()

  await reverse(page, '反执行')
  await reverse(page, '反批准')
  await reverse(page, '反审核')
  await expect(workspace.getByText('草稿', { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: '审计' }).click()
  await expect(workspace.getByText('反执行', { exact: true }).first()).toBeVisible()
  await expect(workspace.getByText('反审核', { exact: true }).first()).toBeVisible()
  await page.getByRole('tab', { name: '附件' }).click()
  await page.getByLabel('移除 vou-e2e.pdf').click()
  await expect(workspace.getByText('暂无附件')).toBeVisible()
})

test('销售单完成产品明细、审核批准、签收执行和反执行', async ({
  page,
  isMobile,
}) => {
  test.setTimeout(180_000)
  await signIn(page)
  await page.goto('/vou/sale-order')
  await page.getByRole('button', { name: '新建单据' }).click()
  const workspace = page.locator('.voucher-workspace')

  await selectReference(page, '客户', fixture.customer, workspace)
  await selectReference(page, /业务员/, fixture.employee, workspace)
  await selectReference(page, '仓库', fixture.warehouse, workspace)
  await selectReference(page, '产品', fixture.product, workspace)

  const draftLine = page.locator('.voucher-lines__table tbody tr').first()
  const draftInputs = draftLine.locator('input')
  await draftInputs.nth(1).fill('2')
  await draftInputs.nth(2).fill('12.50')
  await expect(draftLine).toContainText('25.00')
  await page.getByRole('button', { name: '创建草稿' }).click()
  await expectDraftCreated(workspace, /^SO-\d{8}-\d{6}$/, isMobile)
  await page.getByRole('button', { name: '取消编辑' }).click()

  await page.getByRole('button', { name: '审核', exact: true }).click()
  await page.getByRole('button', { name: '批准', exact: true }).click()
  await page.getByRole('button', { name: '执行', exact: true }).click()
  await selectReference(page, '物流平台', fixture.platform)
  await selectReference(page, '送货车辆', fixture.vehicle)
  const today = localDate()
  await page.getByLabel('出库日期').fill(today)
  await page.getByLabel('签收日期').fill(today)
  await page.getByRole('button', { name: '确认执行' }).click()
  await expect(workspace.getByText('已执行', { exact: true })).toBeVisible()

  await reverse(page, '反执行')
  await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()
})
