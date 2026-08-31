import { expect, test, type Page, type WflWorkerState } from './fixtures'
import {
  approveVouAsReviewer,
  approveWorkflowDefinitionAsReviewer,
} from './wfl-global-setup'

interface DefinitionMutation {
  definitionId: string
  code: string
  revision: number
  approval: {
    approvalEntryId: string
    revision: number
  }
}

interface VouMutation {
  documentId: string
  approval: {
    revision: number
  }
}

interface Envelope<T> {
  code: number | string
  message: string
  data: T
}

const standardPurchaseCode = 'purchase-fulfillment'

function standardPurchaseScript(workerState: WflWorkerState): string {
  const { supplierObjectId, warehouseObjectId } = workerState.fixtures
  return `purchase = node(key="purchase-order", name="采购订单", entity="purchase-order")
inbound = node(key="purchase-inbound", name="采购入库", entity="purchase-inbound")
workflow(code="purchase-fulfillment", name="采购履约", root=purchase, when=lambda source: source["data"]["supplier"]["objectId"] == "${supplierObjectId}", edges=[
  edge(source=purchase, target=inbound, relation="inbound", action=purchase_inbound(initial=lambda source: {
    "warehouseObjectId": "${warehouseObjectId}",
    "businessDate": source["data"]["businessDate"],
    "lines": [{"sourceLineId": line["lineId"], "baseQuantity": line["baseQuantity"]} for line in source["data"]["productLines"]],
  })),
])`
}

async function openDefinition(page: Page, code: string) {
  await page.goto('/dcl/wfl-process-definition')
  await page
    .getByRole('textbox', {
      name: '编码搜索',
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

test('标准采购脚本经编辑、试算和批准后支持手工重建下级 @system-serial', async ({
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
    .getByLabel('Starlark 脚本', { exact: true })
    .fill(standardPurchaseScript(workerState))
  const saveButton = definition.getByRole('button', {
    name: '保存草稿',
    exact: true,
  })
  const saveResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/dcl/wfl-process-definition/save'),
  )
  await saveButton.click()
  const saveResponse = await saveResponsePromise
  expect(saveResponse.ok()).toBe(true)
  await expect(saveButton).toBeEnabled()
  await expect(
    page.getByText('流程定义草稿已保存。', { exact: true }),
  ).toBeVisible()
  await expect(definition.getByText('采购入库', { exact: true })).toBeVisible()

  const trialDocumentId = definition.getByLabel('源单据 ID', { exact: true })
  await trialDocumentId.fill(workerState.fixtures.purchaseTrialDocumentId)
  await expect(trialDocumentId).toHaveValue(
    workerState.fixtures.purchaseTrialDocumentId,
  )
  const trialResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/wfl/process-definition/trial'),
  )
  await definition.getByRole('button', { name: '试运行', exact: true }).click()
  const trialResponse = await trialResponsePromise
  expect(trialResponse.ok()).toBe(true)
  await expect(definition.getByText('匹配：是', { exact: true })).toBeVisible()
  const submitResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/dcl/wfl-process-definition/submit'),
  )
  await definition.getByRole('button', { name: '提交', exact: true }).click()
  const submitEnvelope = (await (
    await submitResponsePromise
  ).json()) as Envelope<DefinitionMutation>
  expect(String(submitEnvelope.code), submitEnvelope.message).toBe('0')
  await expect(
    definition.locator('.definition-editor__sidebar .text-caption').first(),
  ).toContainText('待批准')
  await expect(
    definition.getByRole('button', { name: '撤回', exact: true }),
  ).toBeVisible()
  await expect(
    definition.getByRole('button', { name: '批准', exact: true }),
  ).toHaveCount(0)
  await expect(
    definition.getByRole('button', { name: '驳回', exact: true }),
  ).toHaveCount(0)
  await approveWorkflowDefinitionAsReviewer(
    process.env.E2E_API_BASE_URL!,
    workerState.reviewer,
    {
      code: submitEnvelope.data.code,
      approvalEntryId: submitEnvelope.data.approval.approvalEntryId,
      revision: submitEnvelope.data.approval.revision,
    },
  )
  await definition.locator('.v-toolbar button').first().click()
  await expect(definition).toBeHidden()

  const approvedDefinition = await openDefinition(page, standardPurchaseCode)
  await expect(
    approvedDefinition
      .locator('.definition-editor__sidebar .text-caption')
      .first(),
  ).toContainText('已批准')
  await approvedDefinition
    .getByRole('button', { name: '启用', exact: true })
    .click()
  await approvedDefinition.locator('.v-toolbar button').first().click()
  await expect(approvedDefinition).toBeHidden()

  await page.goto('/wfl/process-definition')
  await page
    .getByRole('textbox', { name: '流程编码或名称', exact: true })
    .fill(standardPurchaseCode)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const currentRow = page
    .locator('tbody tr')
    .filter({ hasText: standardPurchaseCode })
  await expect(currentRow).toHaveCount(1)
  await currentRow.getByRole('button', { name: '维护', exact: true }).click()
  await expect(page).toHaveURL(
    new RegExp(`/dcl/wfl-process-definition\\?code=${standardPurchaseCode}$`),
  )
  const maintenanceDialog = page.getByRole('dialog')
  await expect(maintenanceDialog).toBeVisible()
  await maintenanceDialog.locator('.v-toolbar button').first().click()
  await expect(maintenanceDialog).toBeHidden()

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
  const submitOrderResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/vou/purchase-order/submit'),
  )
  await orderWorkspace
    .getByRole('button', { name: '提交审核', exact: true })
    .click()
  const submitOrderEnvelope = (await (
    await submitOrderResponsePromise
  ).json()) as Envelope<VouMutation>
  expect(String(submitOrderEnvelope.code), submitOrderEnvelope.message).toBe(
    '0',
  )
  await approveVouAsReviewer(
    process.env.E2E_API_BASE_URL!,
    workerState.reviewer,
    'purchase-order',
    submitOrderEnvelope.data.documentId,
    submitOrderEnvelope.data.approval.revision,
  )
  await page.goto(
    `/vou/purchase-order?documentId=${submitOrderEnvelope.data.documentId}&mode=view`,
  )
  await expect(
    page.locator('.voucher-workspace').getByText('已批准', { exact: true }),
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
  await expect(inboundWorkspace).toBeHidden()

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
  const targetSelect = processDialog.getByRole('combobox', {
    name: '当前可创建目标',
    exact: true,
  })
  await targetSelect.focus()
  await targetSelect.press('ArrowDown')
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
