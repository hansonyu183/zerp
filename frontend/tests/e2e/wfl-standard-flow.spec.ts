import { expect, test, type Page, type WflWorkerState } from './fixtures'

const standardPurchaseCode = 'purchase-fulfillment'

function standardPurchaseScript(workerState: WflWorkerState): string {
  const { supplierObjectId, warehouseObjectId } = workerState.fixtures
  return `purchase = node(key="purchase-order", name="采购订单", entity="purchase-order")
inbound = node(key="purchase-inbound", name="采购入库", entity="purchase-inbound")
workflow(code="purchase-fulfillment", name="采购履约", root=purchase, when=lambda source: source["data"]["supplier"]["objectId"] == "${supplierObjectId}", edges=[
  edge(source=purchase, target=inbound, relation="inbound", action=purchase_inbound(initial=lambda source: {
    "warehouseObjectId": "${warehouseObjectId}",
    "businessDate": source["data"]["businessDate"],
    "lines": [{"sourceLineId": line["lineId"], "quantity": line["orderedQuantity"]} for line in source["data"]["productLines"]],
  })),
])`
}

async function openDefinition(page: Page, code: string) {
  await page.goto('/wfl/process-definition')
  await page
    .getByRole('textbox', {
      name: '流程编码或名称',
      exact: true,
    })
    .fill(code)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = page.locator('tbody tr').filter({ hasText: code })
  await expect(row).toHaveCount(1)
  await row.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function signInAgain(page: Page, workerState: WflWorkerState) {
  await page.locator('.account-button').click()
  await page.getByText('退出登录', { exact: true }).click()
  await expect(page).toHaveURL(/\/signin$/)
  await page
    .getByLabel('用户名', { exact: true })
    .fill(workerState.operator.username)
  await page
    .getByLabel('密码', { exact: true })
    .fill(workerState.operator.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/home\/dashboard$/)
}

test('标准采购脚本经编辑、试算和发布后支持手工重建下级 @system-serial', async ({
  page,
  workerState,
}) => {
  test.setTimeout(240_000)

  const dynamicDefinition = await openDefinition(
    page,
    workerState.fixtures.purchaseProcessCode,
  )
  await dynamicDefinition
    .getByRole('button', { name: '停用', exact: true })
    .click()
  await expect(
    dynamicDefinition.getByRole('button', { name: '停用', exact: true }),
  ).toHaveCount(0)
  await dynamicDefinition.locator('.v-toolbar button').first().click()

  const definition = await openDefinition(page, standardPurchaseCode)
  await definition
    .getByLabel('流程脚本', { exact: true })
    .fill(standardPurchaseScript(workerState))
  await definition
    .getByRole('button', { name: '保存草稿', exact: true })
    .click()
  await expect(definition.getByText('采购入库', { exact: true })).toBeVisible()

  await definition
    .getByLabel('已有源单据 ID', { exact: true })
    .fill(workerState.fixtures.purchaseTrialDocumentId)
  await definition
    .getByRole('button', { name: '试算当前草稿', exact: true })
    .click()
  await expect(
    definition.getByText('试算完成（零写入）', { exact: true }),
  ).toBeVisible()
  await definition
    .getByRole('button', { name: '发布修订', exact: true })
    .click()
  await definition.getByRole('button', { name: '启用', exact: true }).click()

  await workerState.grantWorkflowPermissions([standardPurchaseCode])
  await signInAgain(page, workerState)

  await page.goto(
    `/vou/purchase-order?documentId=${workerState.fixtures.purchaseTrialDocumentId}`,
  )
  const orderWorkspace = page.locator('.voucher-workspace')
  await expect(orderWorkspace).toBeVisible()
  const orderNo = (
    await orderWorkspace
      .locator('.voucher-document-header__number')
      .textContent()
  )?.trim()
  expect(orderNo).toMatch(/^POR-\d{8}-\d{4}$/)
  await orderWorkspace
    .getByRole('button', { name: '核对', exact: true })
    .click()
  await orderWorkspace
    .getByRole('button', { name: '批准', exact: true })
    .click()
  await expect(
    orderWorkspace.getByText('已批准', { exact: true }),
  ).toBeVisible()

  await page.goto(`/wfl/${standardPurchaseCode}`)
  await page.getByRole('textbox', { name: '单号', exact: true }).fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const processRow = page.locator('tbody tr').filter({ hasText: orderNo! })
  await expect(processRow).toHaveCount(1)
  await processRow
    .getByRole('button', { name: '查看流程', exact: true })
    .click()

  let processDialog = page.getByRole('dialog')
  const generatedInbound = processDialog
    .locator('.instance-node')
    .filter({ hasText: '采购入库' })
  await expect(generatedInbound).toContainText(/^.*PIN-\d{8}-\d{4}.*$/)
  await generatedInbound.click()
  await processDialog
    .getByRole('button', { name: '打开单据', exact: true })
    .click()

  const inboundWorkspace = page.locator('.voucher-workspace')
  await expect(inboundWorkspace).toBeVisible()
  await inboundWorkspace
    .getByRole('button', { name: '删除草稿', exact: true })
    .click()
  const deleteDialog = page.getByRole('dialog')
  await deleteDialog
    .getByLabel('原因', { exact: true })
    .fill('E2E 手工创建下级前删除自动草稿')
  await deleteDialog.getByRole('button', { name: '确认', exact: true }).click()

  await page.goto(`/wfl/${standardPurchaseCode}`)
  await page.getByRole('textbox', { name: '单号', exact: true }).fill(orderNo!)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await page
    .locator('tbody tr')
    .filter({ hasText: orderNo! })
    .getByRole('button', { name: '查看流程', exact: true })
    .click()

  processDialog = page.getByRole('dialog')
  await processDialog
    .locator('.instance-node')
    .filter({ hasText: '采购订单' })
    .click()
  await processDialog
    .getByRole('combobox', { name: '当前可创建目标', exact: true })
    .click()
  await page.getByRole('option', { name: '采购入库', exact: true }).click()
  await processDialog
    .getByLabel('请求键', { exact: true })
    .fill(`manual-${Date.now()}-e2e`)
  await processDialog
    .getByRole('button', { name: '创建下级', exact: true })
    .click()
  await expect(
    processDialog.locator('.instance-node').filter({ hasText: '采购入库' }),
  ).toContainText(/^.*PIN-\d{8}-\d{4}.*$/)
})
