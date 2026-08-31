import {
  expect,
  test,
  type Locator,
  type Page,
  type WflWorkerState,
} from './fixtures'
import { approveVouAsReviewer } from './wfl-global-setup'

interface VouMutation {
  documentId: string
  documentNo?: string
  approval: {
    revision: number
  }
}

interface Envelope<T> {
  code: number | string
  message: string
  data: T
}

function vouFixture(workerState: WflWorkerState) {
  return {
    customer: workerState.fixtures.customer,
    supplier: workerState.fixtures.supplier,
    employee: workerState.fixtures.employee,
    warehouse: workerState.fixtures.warehouse,
    product: workerState.fixtures.solventProduct,
    vehicle: workerState.fixtures.vehicle,
    fundAccount: workerState.fixtures.fundAccount,
    purchaseProcessCode: workerState.fixtures.purchaseProcessCode,
    salesProcessCode: workerState.fixtures.salesProcessCode,
    currency: 'CNY',
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/home/dashboard')
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
  await expect(option).toBeVisible({ timeout: 15_000 })
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
    workspace
      .locator(
        '.voucher-document-header__number, .voucher-workspace__title > span',
      )
      .first(),
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

async function submitVou(
  page: Page,
  entity: string,
  submitButton: Locator,
): Promise<VouMutation> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/vou/${entity}/submit`),
  )
  await submitButton.click()
  const response = await responsePromise
  const payload = (await response.json()) as Envelope<VouMutation>
  expect(String(payload.code), payload.message).toBe('0')
  return payload.data
}

async function approveSubmittedVou(
  workerState: WflWorkerState,
  entity: string,
  mutation: VouMutation,
): Promise<void> {
  const baseURL = process.env.E2E_API_BASE_URL
  if (!baseURL) throw new Error('VOU E2E 缺少 API 地址。')
  await approveVouAsReviewer(
    baseURL,
    workerState.reviewer,
    entity,
    mutation.documentId,
    mutation.approval.revision,
  )
}

async function approveCurrentDraft(
  page: Page,
  workspace: Locator,
  workerState: WflWorkerState,
  entity: string,
): Promise<void> {
  const cancelEdit = workspace.getByRole('button', { name: '取消编辑' })
  if (await cancelEdit.isVisible()) await cancelEdit.click()
  const submitted = await submitVou(
    page,
    entity,
    workspace.getByRole('button', { name: '提交审核', exact: true }),
  )
  await approveSubmittedVou(workerState, entity, submitted)
  await page.goto(`/vou/${entity}?documentId=${submitted.documentId}&mode=view`)
  if (await workspace.isVisible()) {
    await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()
    return
  }
  expect(submitted.documentNo).toBeTruthy()
  await expect(
    page.locator('tbody tr').filter({ hasText: submitted.documentNo! }),
  ).toContainText('已批准')
}

function isoDateOffset(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

test('票据收入批准后进入真实票据台账', async ({ page, workerState }) => {
  test.skip(
    test.info().project.name === 'mobile-chromium',
    '桌面批量表格流程已覆盖，移动端由响应式单元测试与完整门禁覆盖。',
  )
  test.setTimeout(180_000)
  const fixture = vouFixture(workerState)
  const billNo = `E2E-${Date.now()}`
  await signIn(page)
  await page.goto('/vou/bill-receipt')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')
  await selectReference(page, '客户', fixture.customer, workspace)
  await selectReference(page, '经办人', fixture.employee, workspace)

  const row = workspace.locator('.voucher-bill-lines__desktop tbody tr').first()
  await row.locator('td').nth(1).locator('input').fill(billNo)
  await row.locator('td').nth(4).locator('input').fill(fixture.currency)
  await row.locator('td').nth(5).locator('input').fill('100.00')
  await row.locator('td').nth(6).locator('input').fill(isoDateOffset(0))
  await row.locator('td').nth(7).locator('input').fill(isoDateOffset(30))
  await row.locator('td').nth(8).locator('input').fill('E2E 出票人')
  await row.locator('td').nth(9).locator('input').fill('E2E 承兑人')
  await row.locator('td').nth(10).locator('input').fill('E2E 收款人')
  await row.locator('td').nth(11).locator('input').fill('365')
  await expect(workspace.getByText('客户净结算额').locator('..')).toContainText(
    '100.00',
  )

  const billCreateResponse = page.waitForResponse((response) =>
    response.url().endsWith('/vou/bill-receipt/create'),
  )
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  const billCreate = await billCreateResponse
  const billCreatePayload = (await billCreate.json()) as {
    code: number | string
    message: string
  }
  expect(String(billCreatePayload.code), billCreatePayload.message).toBe('0')
  await expectDraftCreated(workspace, /^BRE-\d{8}-\d{4}$/)
  await approveCurrentDraft(page, workspace, workerState, 'bill-receipt')
})

test('资产购置打开新增即加载已批准供应商候选', async ({
  page,
  workerState,
}) => {
  test.skip(
    test.info().project.name === 'mobile-chromium',
    '引用主动加载由桌面真实数据链路覆盖。',
  )
  const fixture = vouFixture(workerState)
  await signIn(page)
  await page.goto('/vou/asset-acquisition')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const supplier = page
    .locator('.voucher-workspace')
    .getByRole('combobox', { name: '普通供应商' })
  await supplier.click()
  await expect(
    page.getByRole('option').filter({ hasText: fixture.supplier }).first(),
  ).toBeVisible({ timeout: 15_000 })
})

async function verifyEmployeeLoanLifecycle(
  page: Page,
  workerState: WflWorkerState,
  fixture: ReturnType<typeof vouFixture>,
): Promise<void> {
  for (const document of [
    { entity: 'employee-loan', prefix: 'ELN', amount: '100.00' },
    { entity: 'employee-repayment', prefix: 'ERP', amount: '30.00' },
  ]) {
    await page.goto(`/vou/${document.entity}`)
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const workspace = page.locator('.voucher-workspace')
    await selectReference(page, '借款员工', fixture.employee, workspace)
    await selectReference(page, '经办人', fixture.employee, workspace)
    await selectReference(page, '资金账户', fixture.fundAccount, workspace)
    await workspace.getByLabel('金额').fill(document.amount)
    await workspace.getByRole('button', { name: '保存', exact: true }).click()
    await expectDraftCreated(
      workspace,
      new RegExp(`^${document.prefix}-\\d{8}-\\d{4}$`),
    )
    await approveCurrentDraft(page, workspace, workerState, document.entity)
  }

  await page.goto('/vou/employee-loan-writeoff')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')
  await selectReference(page, '员工', fixture.employee, workspace)
  const expenseInputs = workspace
    .locator('.voucher-expense-lines__table tbody tr')
    .first()
    .locator('input')
  await expenseInputs.nth(0).fill('员工借款核销')
  await expenseInputs.nth(1).fill('E2E 核销明细')
  await expenseInputs.nth(2).fill('50.00')
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  await expectDraftCreated(workspace, /^ELW-\d{8}-\d{4}$/)
  await approveCurrentDraft(
    page,
    workspace,
    workerState,
    'employee-loan-writeoff',
  )
}

test(
  '员工借还核销及收款单批准后入账',
  { tag: '@mobile' },
  async ({ page, workerState }) => {
    test.setTimeout(180_000)
    const fixture = vouFixture(workerState)
    await signIn(page)
    if (test.info().project.name !== 'mobile-chromium') {
      await verifyEmployeeLoanLifecycle(page, workerState, fixture)
    }
    await page.goto('/vou/sales-receipt')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    const workspace = page.locator('.voucher-workspace')
    await expect(workspace.getByText('币种', { exact: true })).toHaveCount(0)
    await expect(workspace.getByText('更多设置', { exact: true })).toHaveCount(
      0,
    )

    await selectReference(page, '客户', fixture.customer, workspace)
    await selectReference(page, '经办人', fixture.employee, workspace)
    await selectReference(page, '资金账户', fixture.fundAccount, workspace)
    await page.getByLabel('金额').fill('100.00')
    await workspace.getByRole('button', { name: '保存', exact: true }).click()
    await expectDraftCreated(workspace, /^SRC-\d{8}-\d{4}$/)
    const documentNo = (
      await workspace.locator('.voucher-document-header__number').textContent()
    )?.trim()
    expect(documentNo).toMatch(/^SRC-\d{8}-\d{4}$/)

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
    await page.getByRole('tab', { name: '待办单据' }).click()
    await page.getByRole('textbox', { name: '单号或往来方' }).fill(documentNo!)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    let workbenchRow = page.locator('tbody tr').filter({ hasText: documentNo! })
    await expect(workbenchRow).toContainText('待提交审核')
    await workbenchRow.getByLabel(`编辑 ${documentNo}`).click()
    await expect(page).toHaveURL(
      new RegExp(`/vou/sales-receipt\\?documentId=[^&]+&mode=edit`),
    )
    await page.goto('/home/dashboard')
    await page.getByRole('tab', { name: '待办单据' }).click()
    await page.getByRole('textbox', { name: '单号或往来方' }).fill(documentNo!)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    workbenchRow = page.locator('tbody tr').filter({ hasText: documentNo! })
    await expect(workbenchRow).toContainText('待提交审核')
    await workbenchRow.getByLabel(`提交审核 ${documentNo}`).click()
    await expect(workbenchRow).toContainText('待批准')
    await workbenchRow.getByLabel(`查看 ${documentNo}`).click()
    await expect(page).toHaveURL(
      new RegExp(`/vou/sales-receipt\\?documentId=[^&]+&mode=view`),
    )
    await page.goto('/home/dashboard')
    await page.getByRole('tab', { name: '待办单据' }).click()
    await page.getByRole('textbox', { name: '单号或往来方' }).fill(documentNo!)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    workbenchRow = page.locator('tbody tr').filter({ hasText: documentNo! })
    await expect(workbenchRow).toContainText('待批准')
    await workbenchRow.getByLabel(`撤回提交 ${documentNo}`).click()
    const unsubmitDialog = page.getByRole('dialog').filter({
      hasText: '撤回提交',
    })
    await expect(unsubmitDialog.getByLabel('原因')).toHaveCount(0)
    await unsubmitDialog.getByRole('button', { name: '确认撤回' }).click()
    await expect(workbenchRow).toContainText('待提交审核')
    const submitted = await submitVou(
      page,
      'sales-receipt',
      workbenchRow.getByLabel(`提交审核 ${documentNo}`),
    )
    await expect(workbenchRow).toContainText('待批准')
    await approveSubmittedVou(workerState, 'sales-receipt', submitted)
    await page.reload()
    await page.getByRole('tab', { name: '待办单据' }).click()
    await page.getByRole('textbox', { name: '单号或往来方' }).fill(documentNo!)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    workbenchRow = page.locator('tbody tr').filter({ hasText: documentNo! })
    await expect(workbenchRow).toHaveCount(0, { timeout: 15_000 })

    await page.goto('/vou/sales-receipt')
    await page
      .getByRole('textbox', { name: '单号或往来方关键字' })
      .fill(documentNo!)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    const documentRow = page
      .locator('tbody tr')
      .filter({ hasText: documentNo! })
    await expect(documentRow).toBeVisible()
    await documentRow.getByLabel(`查看 ${documentNo}`).click()
    await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()

    await reverse(page, '反批准')
    await page.getByRole('button', { name: '撤回提交', exact: true }).click()
    await expect(workspace.getByText('草稿', { exact: true })).toBeVisible()

    // Re-enter from the list's authoritative read before exercising the
    // attachment action. Lifecycle completion also refreshes workbench/audit
    // data in the background, so keeping the pre-transition component instance
    // here can make the remove affordance race those independent reads in CI.
    await page.reload()
    await page
      .getByRole('textbox', { name: '单号或往来方关键字' })
      .fill(documentNo!)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    const draftRow = page.locator('tbody tr').filter({ hasText: documentNo! })
    await expect(draftRow).toContainText('草稿')
    await draftRow.getByLabel(`编辑 ${documentNo}`).click()
    await expect(workspace.getByText('草稿', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: '审计' }).click()
    await expect(
      workspace.getByText('反批准', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      workspace.getByText('撤回提交', { exact: true }).first(),
    ).toBeVisible()
    await page.getByRole('tab', { name: '附件' }).click()
    await expect(
      workspace.getByText('vou-e2e.pdf', { exact: true }),
    ).toBeVisible()
    await page.getByLabel('移除 vou-e2e.pdf').click()
    await expect(workspace.getByText('暂无附件')).toBeVisible()
  },
)

test('库存盘点加载账面库存并按批准时差异过账', async ({
  page,
  workerState,
}) => {
  test.setTimeout(180_000)
  const fixture = vouFixture(workerState)
  await signIn(page)
  await page.goto('/vou/inventory-count')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')

  await selectReference(page, '仓库', fixture.warehouse, workspace)
  const balanceResponse = page.waitForResponse((response) =>
    response.url().endsWith('/vou/inventory-count/book-balance'),
  )
  await workspace
    .getByRole('button', { name: '加载非零库存', exact: true })
    .click()
  const balancePayload = (await (await balanceResponse).json()) as {
    code: number | string
    message: string
  }
  expect(String(balancePayload.code), balancePayload.message).toBe('0')
  const countLine = workspace
    .locator('.inventory-count-lines__table tbody tr')
    .filter({ hasText: fixture.product })
    .first()
  await expect(countLine).toBeVisible()
  const bookQuantity = Number(
    (
      await countLine
        .locator('td[data-label="账面 Base Quantity"]')
        .textContent()
    )?.trim(),
  )
  expect(Number.isFinite(bookQuantity)).toBe(true)
  await countLine
    .locator('td[data-label="录入数量"] input')
    .fill(String(bookQuantity + 1))
  await countLine
    .locator('td[data-label="实际 Base Quantity"] input')
    .fill(String(bookQuantity + 1))
  await expect(countLine.locator('td[data-label="差异"]')).toHaveText('1')

  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  await expectDraftCreated(workspace, /^IVC-\d{8}-\d{4}$/)
  await workspace.getByRole('button', { name: '取消编辑' }).click()
  const submitted = await submitVou(
    page,
    'inventory-count',
    workspace.getByRole('button', { name: '提交审核', exact: true }),
  )
  await approveSubmittedVou(workerState, 'inventory-count', submitted)
  await page.goto(
    `/vou/inventory-count?documentId=${submitted.documentId}&mode=view`,
  )
  await expect(workspace.getByText(/^已盘点 · r\d+$/)).toBeVisible()
  await expect
    .poll(async () =>
      Number(
        await countLine
          .locator('td[data-label="账面 Base Quantity"]')
          .textContent(),
      ),
    )
    .toBe(bookQuantity)
  await expect
    .poll(async () =>
      Number(await countLine.locator('td[data-label="差异"]').textContent()),
    )
    .toBe(1)

  await reverse(page, '反批准')
})

test('销售订单经动态流程生成出库草稿', async ({ page, workerState }) => {
  test.skip(
    test.info().project.name === 'mobile-chromium',
    '该有状态用例在桌面项目内切换到 390px 验收手机布局',
  )
  test.setTimeout(180_000)
  const fixture = vouFixture(workerState)
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
  await draftLine.locator('td[data-label="录入数量"] input').fill('2')
  await draftLine.locator('td[data-label="基础售价"] input').fill('12.50')
  await expect(draftLine).toContainText('25.00')
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  await expectDraftCreated(workspace, /^SOR-\d{8}-\d{4}$/)
  const orderNo = (
    await workspace.locator('.voucher-document-header__number').textContent()
  )?.trim()
  expect(orderNo).toBeTruthy()
  await expect(
    page.getByText(`${orderNo} 已保存。`, { exact: true }).first(),
  ).toBeVisible()
  await workspace.getByLabel('关闭单据工作区').click()
  await expect(workspace).not.toBeVisible()
  let orderRow = page.locator('tbody tr').filter({ hasText: orderNo! })
  const submittedOrder = await submitVou(
    page,
    'sale-order',
    orderRow.getByLabel(`提交审核 ${orderNo}`),
  )
  await expect(orderRow).toContainText('待审核')
  await approveSubmittedVou(workerState, 'sale-order', submittedOrder)
  await page.reload()
  orderRow = page.locator('tbody tr').filter({ hasText: orderNo! })
  await expect(orderRow).toContainText('已批准')

  await page.goto(`/wfl/${fixture.salesProcessCode}`)
  await page.getByRole('textbox', { name: '单号' }).fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const processRow = page.locator('tbody tr').filter({ hasText: orderNo! })
  await expect(processRow).toHaveCount(1)
  await expect(processRow).toContainText(fixture.salesProcessCode)
  await expect(processRow).toContainText(fixture.customer)
  await expect(page.getByRole('columnheader', { name: '流程' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '根单号' })).toBeVisible()
  await expect(
    page.getByRole('columnheader', { name: '往来单位' }),
  ).toBeVisible()
  await selectReference(page, '往来单位', fixture.customer)
  await page.getByRole('button', { name: '应用筛选', exact: true }).click()
  await expect(processRow).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByRole('textbox', { name: '单号' }).fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const mobileProcess = page
    .locator('.instance-card')
    .filter({ hasText: orderNo! })
  await expect(mobileProcess).toBeVisible()
  await expectNoPageHorizontalOverflow(page)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.reload()
  await page.getByRole('textbox', { name: '单号' }).fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const desktopProcessRow = page
    .locator('tbody tr')
    .filter({ hasText: orderNo! })
  await desktopProcessRow
    .getByRole('button', { name: '查看流程', exact: true })
    .click()
  const composition = page.getByRole('dialog')
  await expect(composition).toContainText(orderNo!)
  const root = composition
    .locator('.instance-node')
    .filter({ hasText: '销售订单' })
  await expect(root).toContainText(orderNo!)
  const outbound = composition
    .locator('.instance-node')
    .filter({ hasText: '销售出库' })
  await expect(outbound).toContainText('销售出库')
  const outboundNo = (await outbound.textContent())?.match(
    /SOB-\d{8}-\d{4}/,
  )?.[0]
  expect(outboundNo).toBeTruthy()

  await outbound.click()
  await page.getByRole('button', { name: '打开单据', exact: true }).click()
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
  await page.getByRole('tab', { name: '待办单据' }).click()
  const keyword = page.getByRole('textbox', { name: '单号或往来方' })
  await keyword.fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const orderWorkbenchRow = page
    .locator('tbody tr')
    .filter({ hasText: orderNo! })
  await expect(orderWorkbenchRow).toHaveCount(0)

  await keyword.fill(outboundNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const outboundWorkbenchRow = page
    .locator('tbody tr')
    .filter({ hasText: outboundNo! })
  await expect(outboundWorkbenchRow).toContainText('待提交审核')
  const submittedOutbound = await submitVou(
    page,
    'sale-outbound',
    outboundWorkbenchRow.getByLabel(`提交审核 ${outboundNo}`),
  )
  await expect(outboundWorkbenchRow).toContainText('待批准')
  await approveSubmittedVou(workerState, 'sale-outbound', submittedOutbound)
  await page.reload()
  await page.getByRole('tab', { name: '待办单据' }).click()
  await keyword.fill(outboundNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await expect(outboundWorkbenchRow).toHaveCount(0, { timeout: 15_000 })
})

test('采购订单经动态流程显示实例树', async ({ page, workerState }) => {
  test.skip(
    test.info().project.name === 'mobile-chromium',
    '该有状态用例在桌面项目内切换到 430px 验收手机布局',
  )
  test.setTimeout(180_000)
  const fixture = vouFixture(workerState)
  await signIn(page)

  await page.goto('/vou/purchase-order')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')
  await selectReference(page, '供应商', fixture.supplier, workspace)
  await selectReference(page, /采购员/, fixture.employee, workspace)
  await selectReference(page, '仓库', fixture.warehouse, workspace)
  await selectReference(page, '产品', fixture.product, workspace)
  const draftLine = workspace.locator('.voucher-lines__table tbody tr').first()
  await draftLine.locator('td[data-label="录入数量"] input').fill('3')
  await draftLine.locator('td[data-label="单价"] input').fill('10')
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  await expectDraftCreated(workspace, /^POR-\d{8}-\d{4}$/)
  const orderNo = (
    await workspace.locator('.voucher-document-header__number').textContent()
  )?.trim()
  expect(orderNo).toBeTruthy()
  await workspace.getByRole('button', { name: '取消编辑' }).click()
  const submitted = await submitVou(
    page,
    'purchase-order',
    workspace.getByRole('button', { name: '提交审核', exact: true }),
  )
  await approveSubmittedVou(workerState, 'purchase-order', submitted)
  await page.goto(
    `/vou/purchase-order?documentId=${submitted.documentId}&mode=view`,
  )
  await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()

  await page.goto(`/wfl/${fixture.purchaseProcessCode}`)
  await page.getByRole('textbox', { name: '单号' }).fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const processRow = page.locator('tbody tr').filter({ hasText: orderNo! })
  await expect(processRow).toHaveCount(1)
  await expect(processRow).toContainText(fixture.purchaseProcessCode)
  await expect(processRow).toContainText(fixture.supplier)
  await processRow
    .getByRole('button', { name: '查看流程', exact: true })
    .click()
  const processDialog = page.getByRole('dialog')
  const root = processDialog
    .locator('.instance-node')
    .filter({ hasText: '采购订单' })
  await expect(root).toContainText(orderNo!)
  const inbound = processDialog
    .locator('.instance-node')
    .filter({ hasText: '采购入库' })
  await expect(inbound).toContainText('采购入库')
  await page.keyboard.press('Escape')
  await expect(processDialog).toBeHidden()

  await page.setViewportSize({ width: 430, height: 932 })
  await page.reload()
  await page.getByRole('textbox', { name: '单号' }).fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const mobileProcess = page
    .locator('.instance-card')
    .filter({ hasText: orderNo! })
  await expect(mobileProcess).toBeVisible()
  await expectNoPageHorizontalOverflow(page)
})
