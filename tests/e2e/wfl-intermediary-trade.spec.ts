import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test'
import {
  e2eEnv,
  readWflBootstrapState,
  wflBootstrapEnabled,
} from './wfl-runtime'

const enabled = wflBootstrapEnabled()
let completedDocumentNo = ''

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
  await page.goto('/wfl/intermediary-trade')
  await page.getByText('筛选条件', { exact: true }).click()
  await page
    .getByRole('textbox', { name: '流程单号关键字', exact: true })
    .fill(documentNo)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await page.getByLabel(`打开 ${documentNo}`).click()
  const workspace = page.locator('.wfl-workspace')
  await expect(workspace).toBeVisible()
  return workspace
}

async function openStageTab(
  workspace: Locator,
  name: '居间采购' | '分批收货' | '分批送货' | '客户签收' | '审计',
): Promise<void> {
  await workspace.getByRole('tab', { name }).click()
}

async function runReasonAction(
  page: Page,
  workspace: Locator,
  action: string,
  reason: string,
): Promise<void> {
  await workspace.getByRole('button', { name: action, exact: true }).click()
  const dialog = page.getByRole('dialog').filter({
    hasText: '填写操作原因',
  })
  await dialog.getByLabel('原因').fill(reason)
  await dialog.getByRole('button', { name: '确认操作' }).click()
  await expect(dialog).not.toBeVisible()
}

test.describe('WFL 居间贸易五阶段真实后端', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(
    !enabled,
    '自动预置和真实 WFL 流程只允许在 E2E_WFL_BOOTSTRAP=true 的隔离后端运行',
  )

  test('双账号完成五阶段、子单附件、空桶与审计', async ({ browser }) => {
    test.setTimeout(480_000)
    const bootstrap = readWflBootstrapState()
    const fixtures = bootstrap.fixtures
    const operator = await signedInPage(
      browser,
      e2eEnv('E2E_USERNAME'),
      e2eEnv('E2E_PASSWORD'),
    )
    const reviewer = await signedInPage(
      browser,
      bootstrap.reviewer.username,
      bootstrap.reviewer.password,
    )

    await operator.goto('/wfl/intermediary-trade')
    await operator.getByRole('button', { name: '新建流程' }).click()
    let workspace = operator.locator('.wfl-workspace')
    await selectReference(
      operator,
      '客户',
      fixtures.customer,
      workspace,
    )
    await selectReference(
      operator,
      /业务员/,
      fixtures.employee,
      workspace,
    )

    await workspace.getByRole('button', { name: '添加产品' }).click()
    await workspace.getByRole('button', { name: '添加产品' }).click()
    const orderRows = workspace.locator('.intermediary-lines__table tbody tr')
    await selectReference(
      operator,
      '产品',
      fixtures.solventProduct,
      orderRows.nth(0),
    )
    await selectReference(
      operator,
      '产品',
      fixtures.resinProduct,
      orderRows.nth(1),
    )
    await orderRows.nth(0).locator('input').nth(1).fill('360')
    await orderRows.nth(0).locator('input').nth(2).fill('10.00')
    await orderRows.nth(1).locator('input').nth(1).fill('440')
    await orderRows.nth(1).locator('input').nth(2).fill('20.00')
    await workspace.getByRole('button', { name: '创建草稿' }).click()
    const documentTitle = workspace.locator('.v-toolbar-title')
    await expect(documentTitle).toHaveText(/^CO-\d{8}-\d{6}$/)
    const documentNo = (await documentTitle.innerText()).trim()
    completedDocumentNo = documentNo
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
    await workspace.getByRole('button', { name: '新建居间采购' }).click()
    await selectReference(
      operator,
      '普通供应商',
      fixtures.supplier,
    )
    await selectReference(
      operator,
      /采购员/,
      fixtures.employee,
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
    await workspace.getByRole('button', { name: '新建收货' }).click()
    dialog = operator.getByRole('dialog').last()
    const receiptRows = dialog.locator('tbody tr')
    await receiptRows.nth(0).locator('input').nth(0).fill('360')
    await receiptRows.nth(1).locator('input').nth(0).fill('440')
    await dialog.getByRole('button', { name: '保存草稿' }).click()
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'receipt-e2e.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nWFL receipt\n%%EOF'),
    })
    await expect(dialog.getByText('已上传', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await workspace.getByRole('button', { name: '核对', exact: true }).click()

    workspace = await openOrder(reviewer, documentNo)
    await openStageTab(workspace, '分批收货')
    await workspace.getByRole('button', { name: '确认', exact: true }).click()

    workspace = await openOrder(operator, documentNo)
    await openStageTab(workspace, '分批送货')
    await workspace.getByRole('button', { name: '新建送货' }).click()
    await selectReference(
      operator,
      '物流平台',
      fixtures.platform,
    )
    await selectReference(
      operator,
      '送货车辆',
      fixtures.vehicle,
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
    await workspace.getByRole('button', { name: '刷新' }).click()
    await expect(workspace.getByText('SIGNOFF_CONFIRM')).toBeVisible()
    await expect(workspace.getByText('DELIVERY_EXECUTE')).toBeVisible()
  })

  test('采购脱敏账号不获得采购正文和数量', async ({ browser }) => {
    const bootstrap = readWflBootstrapState()
    const page = await signedInPage(
      browser,
      bootstrap.redacted.username,
      bootstrap.redacted.password,
    )
    const workspace = await openOrder(page, completedDocumentNo)
    await openStageTab(workspace, '居间采购')

    await expect(
      workspace.getByText(
        '当前账号没有采购详情权限，供应商、采购价格和采购数量已由后端脱敏。',
      ),
    ).toBeVisible()
    await expect(
      workspace.getByLabel(/^打开 PO-/),
    ).toHaveCount(0)
  })

  test('按下游顺序完成反向、草稿删除和双人短结', async ({ browser }) => {
    test.setTimeout(480_000)
    const bootstrap = readWflBootstrapState()
    const operator = await signedInPage(
      browser,
      e2eEnv('E2E_USERNAME'),
      e2eEnv('E2E_PASSWORD'),
    )
    const reviewer = await signedInPage(
      browser,
      bootstrap.reviewer.username,
      bootstrap.reviewer.password,
    )

    let workspace = await openOrder(operator, completedDocumentNo)
    await openStageTab(workspace, '分批送货')
    await workspace.getByRole('button', { name: '反执行', exact: true }).click()
    const blockedDialog = operator.getByRole('dialog').filter({
      hasText: '填写操作原因',
    })
    await blockedDialog.getByLabel('原因').fill('验证下游签收阻断')
    await blockedDialog.getByRole('button', { name: '确认操作' }).click()
    await expect(blockedDialog).toBeVisible()
    await blockedDialog.getByRole('button', { name: '取消' }).click()

    await openStageTab(workspace, '客户签收')
    await runReasonAction(operator, workspace, '反确认', '验证签收反确认')
    await runReasonAction(operator, workspace, '反核对', '验证签收反核对')
    await runReasonAction(operator, workspace, '删除', '删除签收草稿')

    await openStageTab(workspace, '分批送货')
    await runReasonAction(operator, workspace, '反执行', '验证送货反执行')
    await runReasonAction(operator, workspace, '反核对', '验证送货反核对')
    await runReasonAction(operator, workspace, '删除', '删除送货草稿')

    await openStageTab(workspace, '分批收货')
    await runReasonAction(operator, workspace, '反确认', '验证收货反确认')
    await runReasonAction(operator, workspace, '反核对', '验证收货反核对')
    await runReasonAction(operator, workspace, '删除', '删除收货草稿')

    await openStageTab(workspace, '居间采购')
    await runReasonAction(operator, workspace, '反下单', '验证采购反下单')
    await runReasonAction(operator, workspace, '反核对', '验证采购反核对')
    await runReasonAction(operator, workspace, '删除', '删除采购草稿')

    await workspace.getByRole('button', { name: '申请短结' }).click()
    let reasonDialog = operator.getByRole('dialog').filter({
      hasText: '申请短结',
    })
    await reasonDialog.getByLabel('原因').fill('客户终止剩余履约')
    await reasonDialog.getByRole('button', { name: '提交申请' }).click()
    await expect(reasonDialog).not.toBeVisible()

    workspace = await openOrder(reviewer, completedDocumentNo)
    await runReasonAction(reviewer, workspace, '确认短结', '复核并确认短结')
    await expect(workspace.getByText(/已短结 · r\d+/)).toBeVisible()

    workspace = await openOrder(operator, completedDocumentNo)
    await runReasonAction(operator, workspace, '反确认短结', '验证短结反确认')
    await runReasonAction(operator, workspace, '撤销短结申请', '恢复正常履约')
    await expect(workspace.getByText(/履约中 · r\d+/)).toBeVisible()

    await openStageTab(workspace, '客户订单')
    await runReasonAction(operator, workspace, '反批准', '验证客户订单反批准')
    await runReasonAction(operator, workspace, '反核对', '验证客户订单反核对')
    await expect(workspace.getByText(/客户订单草稿 · r\d+/)).toBeVisible()
  })

  test('历史 V1 居间销售单仍是纯 VOU 页面', async ({ browser }) => {
    const page = await signedInPage(
      browser,
      e2eEnv('E2E_USERNAME'),
      e2eEnv('E2E_PASSWORD'),
    )
    await page.goto('/vou/intermediary-sale-order')
    await expect(page.getByText('VOU · 业务单据')).toBeVisible()
    await expect(page.getByRole('heading', { name: '居间销售单' })).toBeVisible()
    await expect(page.getByRole('button', { name: '新建流程' })).toHaveCount(0)
  })
})
