import {
  expect,
  test,
  type Locator,
  type Page,
  type WflWorkerState,
} from './fixtures'

function vouFixture(workerState: WflWorkerState) {
  return {
    customer: workerState.fixtures.customer,
    supplier: workerState.fixtures.supplier,
    employee: workerState.fixtures.employee,
    warehouse: workerState.fixtures.warehouse,
    product: workerState.fixtures.solventProduct,
    platform: workerState.fixtures.platform,
    vehicle: workerState.fixtures.vehicle,
    fundAccount: workerState.fixtures.fundAccount,
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

async function approveCurrentDraft(workspace: Locator): Promise<void> {
  await workspace.getByRole('button', { name: '取消编辑' }).click()
  await workspace.getByRole('button', { name: '核对', exact: true }).click()
  await workspace.getByRole('button', { name: '批准', exact: true }).click()
  await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()
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
  await workspace.getByRole('button', { name: '检查', exact: true }).click()
  await workspace.getByRole('button', { name: '批准', exact: true }).click()
  await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()
})

async function verifyEmployeeLoanLifecycle(
  page: Page,
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
    await approveCurrentDraft(workspace)
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
  await approveCurrentDraft(workspace)
}

test(
  '员工借还核销及收款单批准后入账',
  { tag: '@mobile' },
  async ({ page, workerState }) => {
    test.setTimeout(180_000)
    const fixture = vouFixture(workerState)
    await signIn(page)
    if (test.info().project.name !== 'mobile-chromium') {
      await verifyEmployeeLoanLifecycle(page, fixture)
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
    let workbenchRow = page
      .locator('tbody tr')
      .filter({ hasText: documentNo! })
    await expect(workbenchRow).toContainText('待核对')
    await workbenchRow.getByLabel(`编辑 ${documentNo}`).click()
    await expect(page).toHaveURL(
      new RegExp(`/vou/sales-receipt\\?documentId=[^&]+&mode=edit`),
    )
    await page.goto('/home/dashboard')
    await page.getByRole('tab', { name: '待办单据' }).click()
    await page.getByRole('textbox', { name: '单号或往来方' }).fill(documentNo!)
    await page.getByRole('button', { name: '查询', exact: true }).click()
    workbenchRow = page.locator('tbody tr').filter({ hasText: documentNo! })
    await expect(workbenchRow).toContainText('待核对')
    await workbenchRow.getByLabel(`核对 ${documentNo}`).click()
    await expect(workbenchRow).toContainText('待批准')
    await workbenchRow.getByLabel(`反核对 ${documentNo}`).click()
    const uncheckDialog = page.getByRole('dialog').filter({
      hasText: '反核对',
    })
    await expect(uncheckDialog.getByLabel('原因')).toHaveCount(0)
    await uncheckDialog.getByRole('button', { name: '确认反核对' }).click()
    await expect(workbenchRow).toContainText('待核对')
    await workbenchRow.getByLabel(`核对 ${documentNo}`).click()
    await expect(workbenchRow).toContainText('待批准')
    await workbenchRow.getByLabel(`批准 ${documentNo}`).click()
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
    await page.getByRole('button', { name: '反核对', exact: true }).click()
    await expect(page.getByLabel('原因')).toHaveCount(0)
    await expect(workspace.getByText('草稿', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: '审计' }).click()
    await expect(
      workspace.getByText('反批准', { exact: true }).first(),
    ).toBeVisible()
    await expect(
      workspace.getByText('反核对', { exact: true }).first(),
    ).toBeVisible()
    await page.getByRole('tab', { name: '附件' }).click()
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

  await reverse(page, '反批准')
})

test('销售订单独立流转并由流程事件自动生成出库草稿', async ({
  page,
  workerState,
}) => {
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
  await expect(
    page.getByRole('columnheader', { name: '流程完成情况' }),
  ).toHaveCount(0)
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
  await expect(mobileProcess).not.toContainText('流程完成情况')
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
  await desktopProcessRow
    .getByRole('button', { name: '查看流程', exact: true })
    .click()
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
  await expect(outboundWorkbenchRow).toContainText('待核对')
  await outboundWorkbenchRow.getByLabel(`核对 ${outboundNo}`).click()
  await expect(outboundWorkbenchRow).toContainText('待批准')
  await outboundWorkbenchRow.getByLabel(`批准 ${outboundNo}`).click()
  await expect(outboundWorkbenchRow).toHaveCount(0, { timeout: 15_000 })
})

test('采购流程列表展示中文阶段和按单位履约数据', async ({
  page,
  workerState,
}) => {
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
  await processRow
    .getByRole('button', { name: '查看流程', exact: true })
    .click()
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
