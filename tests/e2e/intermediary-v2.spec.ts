import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test'
import { loadEnv } from 'vite'

const localEnv = loadEnv('e2e', process.cwd(), '')
const enabled =
  (process.env.E2E_INTERMEDIARY_V2 ??
    localEnv.E2E_INTERMEDIARY_V2 ??
    '').toLowerCase() === 'true'

const required = [
  'E2E_USERNAME',
  'E2E_PASSWORD',
  'E2E_REVIEWER_USERNAME',
  'E2E_REVIEWER_PASSWORD',
  'E2E_VOU_CUSTOMER_KEYWORD',
  'E2E_VOU_SUPPLIER_KEYWORD',
  'E2E_VOU_EMPLOYEE_KEYWORD',
  'E2E_VOU_PRODUCT_KEYWORD',
  'E2E_VOU_RESIN_PRODUCT_KEYWORD',
  'E2E_VOU_PLATFORM_KEYWORD',
  'E2E_VOU_VEHICLE_KEYWORD',
] as const

for (const name of required) {
  if (process.env[name] === undefined && localEnv[name] !== undefined) {
    process.env[name] = localEnv[name]
  }
}

if (enabled) {
  const missing = required.filter((name) => !process.env[name])
  if (missing.length) {
    throw new Error(
      `居间订单 V2 Playwright 缺少真实测试资料：${missing.join(', ')}`,
    )
  }
}

async function signIn(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).not.toHaveURL(/\/signin/)
}

async function signedInPage(
  browser: Browser,
  username: string,
  password: string,
): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, username, password)
  return page
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

async function openOrder(page: Page, documentNo: string): Promise<Locator> {
  await page.goto('/vou/intermediary-sale-order')
  await page.getByText('筛选条件', { exact: true }).click()
  await page
    .getByRole('textbox', { name: '单号或往来方关键字', exact: true })
    .fill(documentNo)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await page.getByLabel(`打开 ${documentNo}`).click()
  const workspace = page.locator('.intermediary-workspace')
  await expect(workspace).toBeVisible()
  return workspace
}

async function openStageTab(
  workspace: Locator,
  name: '居间采购' | '分批收货' | '分批送货' | '客户签收' | '审计',
): Promise<void> {
  await workspace.getByRole('tab', { name }).click()
}

test.describe('居间订单 V2 五阶段真实后端', () => {
  test.skip(!enabled, '需要已部署 PR #11 后端及 E2E_INTERMEDIARY_V2=true')

  test('双账号完成五阶段、子单附件、空桶与审计', async ({ browser }) => {
    test.setTimeout(480_000)
    const operator = await signedInPage(
      browser,
      process.env.E2E_USERNAME!,
      process.env.E2E_PASSWORD!,
    )
    const reviewer = await signedInPage(
      browser,
      process.env.E2E_REVIEWER_USERNAME!,
      process.env.E2E_REVIEWER_PASSWORD!,
    )

    await operator.goto('/vou/intermediary-sale-order')
    await operator.getByRole('button', { name: '新建 V2 客户订单' }).click()
    let workspace = operator.locator('.intermediary-workspace')
    await selectReference(
      operator,
      '客户',
      process.env.E2E_VOU_CUSTOMER_KEYWORD!,
      workspace,
    )
    await selectReference(
      operator,
      /业务员/,
      process.env.E2E_VOU_EMPLOYEE_KEYWORD!,
      workspace,
    )

    await workspace.getByRole('button', { name: '添加产品' }).click()
    await workspace.getByRole('button', { name: '添加产品' }).click()
    const orderRows = workspace.locator('.intermediary-lines__table tbody tr')
    await selectReference(
      operator,
      '产品',
      process.env.E2E_VOU_PRODUCT_KEYWORD!,
      orderRows.nth(0),
    )
    await selectReference(
      operator,
      '产品',
      process.env.E2E_VOU_RESIN_PRODUCT_KEYWORD!,
      orderRows.nth(1),
    )
    await orderRows.nth(0).locator('input').nth(1).fill('360')
    await orderRows.nth(0).locator('input').nth(2).fill('10.00')
    await orderRows.nth(1).locator('input').nth(1).fill('440')
    await orderRows.nth(1).locator('input').nth(2).fill('20.00')
    await workspace.getByRole('button', { name: '创建草稿' }).click()
    const documentTitle = workspace.locator('.v-toolbar-title')
    await expect(documentTitle).toHaveText(/^ISO-\d{8}-\d{6}$/)
    const documentNo = (await documentTitle.innerText()).trim()
    const orderCheck = workspace.getByRole('button', {
      name: '核对',
      exact: true,
    })
    await expect(orderCheck).toBeEnabled()
    await orderCheck.click()
    await expect(
      workspace.getByText(/客户订单已核对 · r\d+/),
    ).toBeVisible()

    workspace = await openOrder(reviewer, documentNo)
    await workspace.getByRole('button', { name: '批准', exact: true }).click()
    await expect(workspace.getByText(/履约中 · r\d+/)).toBeVisible()

    workspace = await openOrder(operator, documentNo)
    await openStageTab(workspace, '居间采购')
    await workspace.getByRole('button', { name: '新建居间采购子单' }).click()
    await selectReference(
      operator,
      '普通供应商',
      process.env.E2E_VOU_SUPPLIER_KEYWORD!,
    )
    await selectReference(
      operator,
      /采购员/,
      process.env.E2E_VOU_EMPLOYEE_KEYWORD!,
    )
    let dialog = operator.getByRole('dialog').last()
    const procurementRows = dialog.locator('tbody tr')
    await procurementRows.nth(0).locator('input').nth(0).fill('360')
    await procurementRows.nth(0).locator('input').nth(1).fill('8.00')
    await procurementRows.nth(1).locator('input').nth(0).fill('440')
    await procurementRows.nth(1).locator('input').nth(1).fill('16.00')
    await dialog.getByRole('button', { name: '保存草稿' }).click()
    await expect(
      procurementRows.nth(0).locator('input').nth(1),
    ).toHaveValue(/^8(?:\.0+)?$/)
    await expect(
      procurementRows.nth(1).locator('input').nth(1),
    ).toHaveValue(/^16(?:\.0+)?$/)
    await dialog.getByRole('button', { name: '关闭' }).click()
    await workspace.getByRole('button', { name: '核对', exact: true }).click()

    workspace = await openOrder(reviewer, documentNo)
    await openStageTab(workspace, '居间采购')
    await workspace.getByRole('button', { name: '下单', exact: true }).click()

    workspace = await openOrder(operator, documentNo)
    await openStageTab(workspace, '分批收货')
    await workspace.getByRole('button', { name: '新建收货子单' }).click()
    dialog = operator.getByRole('dialog').last()
    const receiptRows = dialog.locator('tbody tr')
    await receiptRows.nth(0).locator('input').nth(0).fill('360')
    await receiptRows.nth(1).locator('input').nth(0).fill('440')
    await dialog.getByRole('button', { name: '保存草稿' }).click()
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'receipt-e2e.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nV2 receipt\n%%EOF'),
    })
    await expect(dialog.getByText('已上传', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await workspace.getByRole('button', { name: '核对', exact: true }).click()

    workspace = await openOrder(reviewer, documentNo)
    await openStageTab(workspace, '分批收货')
    await workspace.getByRole('button', { name: '确认', exact: true }).click()

    workspace = await openOrder(operator, documentNo)
    await openStageTab(workspace, '分批送货')
    await workspace.getByRole('button', { name: '新建送货子单' }).click()
    await selectReference(
      operator,
      '物流平台',
      process.env.E2E_VOU_PLATFORM_KEYWORD!,
    )
    await selectReference(
      operator,
      '送货车辆',
      process.env.E2E_VOU_VEHICLE_KEYWORD!,
    )
    dialog = operator.getByRole('dialog').last()
    await dialog.getByRole('button', { name: '保存草稿' }).click()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await workspace.getByRole('button', { name: '核对', exact: true }).click()

    workspace = await openOrder(reviewer, documentNo)
    await openStageTab(workspace, '分批送货')
    await workspace.getByRole('button', { name: '执行', exact: true }).click()

    workspace = await openOrder(operator, documentNo)
    await openStageTab(workspace, '分批送货')
    await workspace.getByRole('button', { name: '创建签收', exact: true }).click()
    dialog = operator.getByRole('dialog').last()
    await dialog.getByRole('button', { name: '保存草稿' }).click()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await openStageTab(workspace, '客户签收')
    await workspace.getByRole('button', { name: '核对', exact: true }).click()

    workspace = await openOrder(reviewer, documentNo)
    await openStageTab(workspace, '客户签收')
    await workspace.getByRole('button', { name: '确认', exact: true }).click()
    await expect(workspace.getByText(/已完成 · r\d+/)).toBeVisible()

    await openStageTab(workspace, '审计')
    await workspace.getByRole('button', { name: '加载审计' }).click()
    await expect(workspace.getByText('SIGNOFF_CONFIRM')).toBeVisible()
    await expect(workspace.getByText('DELIVERY_EXECUTE')).toBeVisible()
  })
})
