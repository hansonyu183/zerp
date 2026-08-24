import { request, type APIRequestContext } from '@playwright/test'
import { expect, test, type Locator, type Page } from './fixtures'
import type { WflWorkerState } from './wfl-global-setup'

/**
 * This suite deliberately talks to the disposable backend.  It does not route,
 * mock, or intercept application requests: API calls below establish narrowly
 * scoped cross-domain facts which the browser then consumes through the real UI.
 */
test.describe.configure({ mode: 'serial' })
test.use({ storageState: { cookies: [], origins: [] } })

interface Envelope<T> {
  code: number | string
  message: string
  data: T
}

interface Mutation {
  objectId: string
  objectRevision: number
  versionId: string
  revision: number
  code?: string
}

interface BobObjectMutation extends Mutation {
  objectRevision: number
  enabled: boolean
}

interface Party {
  partyId: string
  revision: number
  displayName: string
}

interface VoucherMutation {
  documentId: string
  documentNo?: string
  revision: number
}

interface BobView {
  objectId: string
  code: string
  objectRevision: number
  enabled: boolean
  version: {
    versionId: string
    revision: number
    status: string
  }
  data: Record<string, unknown> & {
    name?: string
    managerEmployeeId?: string
  }
}

interface BobListItem {
  objectId: string
  code: string
  objectRevision: number
  enabled: boolean
  effective: {
    versionId: string
    status: string
    summary: Record<string, unknown>
  } | null
  candidate: {
    versionId: string
    status: string
    revision: number
    summary: Record<string, unknown>
  } | null
}

interface VoucherView extends VoucherMutation {
  status: string
  data: Record<string, unknown> & {
    productLines?: Array<{ lineId: string; baseQuantity: string }>
    carrierType?: string
    carrier?: ReferenceMutation
    carrierOperatingEntity?: ReferenceMutation
    vehicle?: ReferenceMutation & { name?: string }
    vehicleBulkLiquidCapable?: boolean
  }
}

interface CustomerCreateMutation {
  defaultAccount: {
    objectId: string
    code: string
    candidate: { version: { versionId: string; revision: number } }
  }
}

interface ReferenceMutation {
  objectId: string
  versionId: string
  code?: string
}

interface WflDefinition {
  definitionId: string
  revision: number
  status: string
  publishedRevision?: number
}

interface WflInstance {
  processId: string
  rootDocumentId: string
  nodes: Array<{
    documentId: string
    documentEntity: string
    documentRevision: number
  }>
}

interface IntermediaryDocument {
  revision: number
  data: {
    intermediaryCalculation: {
      source: {
        lines: Array<{
          salesContractStatus: string
          salesContract?: { documentId: string }
        }>
      }
    }
  }
}

class Api {
  constructor(
    private readonly context: APIRequestContext,
    private readonly csrfToken: string,
  ) {}

  async post<T>(path: string, data: unknown): Promise<Envelope<T>> {
    const response = await this.context.post(path, {
      data,
      headers: { 'X-CSRF-Token': this.csrfToken },
    })
    expect(response.status(), `${path} HTTP status`).toBe(200)
    return (await response.json()) as Envelope<T>
  }

  async ok<T>(path: string, data: unknown): Promise<T> {
    const envelope = await this.post<T>(path, data)
    if (String(envelope.code) !== '0') {
      throw new Error(`${path}: ${envelope.message}`)
    }
    return envelope.data
  }
}

async function operatorApi(credentials: {
  username: string
  password: string
}): Promise<{ api: Api; dispose: () => Promise<void> }> {
  const context = await request.newContext({
    baseURL: process.env.E2E_API_BASE_URL,
  })
  const session = await context.post('app/user/signin', { data: credentials })
  expect(session.status()).toBe(200)
  const envelope = (await session.json()) as Envelope<{ csrfToken: string }>
  expect(String(envelope.code), envelope.message).toBe('0')
  return {
    api: new Api(context, envelope.data.csrfToken),
    dispose: () => context.dispose(),
  }
}

async function signIn(
  page: Page,
  credentials: {
    username: string
    password: string
  },
): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名', { exact: true }).fill(credentials.username)
  await page.getByLabel('密码', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).not.toHaveURL(/\/signin/)
}

async function selectReference(
  page: Page,
  label: string,
  keyword: string,
  scope: Page | Locator = page,
): Promise<void> {
  const input = scope
    .getByRole('combobox', { name: label, exact: true })
    .first()
  await input.click()
  await input.fill(keyword)
  const option = page
    .locator('[role="option"]')
    .filter({ hasText: keyword })
    .first()
  await expect(option).toBeVisible({ timeout: 15_000 })
  await option.click()
}

async function selectValue(
  page: Page,
  label: string,
  text: string,
): Promise<void> {
  await page
    .getByRole('combobox', { name: label, exact: true })
    .locator('..')
    .click()
  await page.getByRole('option', { name: text, exact: true }).click()
}

async function approve(
  operator: Api,
  reviewer: Api,
  entity: string,
  mutation: Mutation,
): Promise<Mutation> {
  const submitted = await operator.ok<Mutation>(`bob/${entity}/submit`, {
    objectId: mutation.objectId,
    versionId: mutation.versionId,
    revision: mutation.revision,
  })
  return reviewer.ok<Mutation>(`bob/${entity}/approve`, {
    objectId: submitted.objectId,
    versionId: submitted.versionId,
    revision: submitted.revision,
  })
}

async function createApprovedSharedRelationships(
  operator: Api,
  reviewer: Api,
  suffix: string,
): Promise<{
  party: Party
  otherUnit: Mutation
  salesPartner: Mutation
  operatingEntityId: string
  settlementMethodId: string
}> {
  const operatingEntities = await operator.ok<{
    items: Array<{ objectId: string }>
  }>('bob/operating-entity/query', {
    page: 1,
    pageSize: 20,
    filters: { status: ['EFFECTIVE'], enabled: true },
  })
  const operatingEntityId = operatingEntities.items[0]?.objectId
  expect(operatingEntityId).toBeTruthy()
  const settlementMethods = await operator.ok<{
    items: Array<{
      objectId: string
      currentVersion: { data: { termCode?: string } }
    }>
  }>('aux/settlement-method/query', {
    page: 1,
    pageSize: 20,
    filters: { enabled: true },
    sort: [{ field: 'code', order: 'asc' }],
  })
  const settlementMethodId = settlementMethods.items.find(
    (item) => item.currentVersion.data.termCode === 'MONTHLY_CURRENT',
  )?.objectId
  expect(settlementMethodId).toBeTruthy()

  const name = `E2E 跨域主体 ${suffix}`
  const otherUnit = await operator.ok<Mutation>('bob/other-unit/create', {
    newParty: {
      kind: 'ORGANIZATION',
      legalName: name,
      displayName: name,
      strongIdentifiers: [
        { type: 'UNIFIED_SOCIAL_CREDIT_CODE', value: `91310000${suffix}` },
      ],
    },
    data: { operatingEntityId, settlementMethodId, contactName: 'E2E' },
  })
  const approvedOtherUnit = await approve(
    operator,
    reviewer,
    'other-unit',
    otherUnit,
  )
  const otherUnitView = await operator.ok<{ code: string }>(
    'bob/other-unit/get',
    { objectId: approvedOtherUnit.objectId },
  )
  const parties = await operator.ok<{ items: Party[] }>('bob/party/query', {
    page: 1,
    pageSize: 20,
    filters: { keyword: name },
  })
  const party = parties.items.find((item) => item.displayName === name)
  expect(party).toBeTruthy()

  const salesPartner = await operator.ok<Mutation>('bob/sales-partner/create', {
    partyId: party!.partyId,
    data: {
      operatingEntityId,
      capabilities: ['CHANNEL_PARTNER'],
      contactName: 'E2E',
      contactPhone: '',
      email: '',
      address: '',
      remark: '',
    },
  })
  const approvedSalesPartner = await approve(
    operator,
    reviewer,
    'sales-partner',
    salesPartner,
  )
  const salesPartnerView = await operator.ok<{ code: string }>(
    'bob/sales-partner/get',
    { objectId: approvedSalesPartner.objectId },
  )
  return {
    party: party!,
    otherUnit: { ...approvedOtherUnit, code: otherUnitView.code },
    salesPartner: { ...approvedSalesPartner, code: salesPartnerView.code },
    operatingEntityId: operatingEntityId!,
    settlementMethodId: settlementMethodId!,
  }
}

async function createAndApproveContract(
  page: Page,
  counterparty: { type: '服务关系' | '销售合作关系'; code: string },
  handlerCode: string,
  applicableFrom = '2026-01-01',
): Promise<string> {
  await page.goto('/vou/service-contract')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')
  await selectValue(page, '往来方类型', counterparty.type)
  await selectReference(
    page,
    counterparty.type === '销售合作关系' ? '销售合作方' : '其他单位',
    counterparty.code,
    workspace,
  )
  await selectReference(page, '经办人', handlerCode, workspace)
  if (counterparty.type === '销售合作关系') {
    await selectValue(page, '覆盖能力', '渠道商')
    await workspace
      .getByLabel('适用开始日期', { exact: true })
      .fill(applicableFrom)
  }
  await workspace
    .getByLabel('合同条款', { exact: true })
    .fill('E2E 跨域服务合同')
  const created = page.waitForResponse((response) =>
    response.url().endsWith('/vou/service-contract/create'),
  )
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  const envelope = (await (await created).json()) as Envelope<VoucherMutation>
  expect(String(envelope.code), envelope.message).toBe('0')
  await workspace.getByRole('button', { name: '取消编辑', exact: true }).click()
  await workspace.getByRole('button', { name: '核对', exact: true }).click()
  await workspace.getByRole('button', { name: '批准', exact: true }).click()
  await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()
  return envelope.data.documentId
}

async function createAndApproveAcceptance(
  page: Page,
  contractDocumentId: string,
): Promise<void> {
  await page.goto('/vou/service-acceptance')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  const workspace = page.locator('.voucher-workspace')
  await workspace
    .getByLabel('已批准服务合同 ID', { exact: true })
    .fill(contractDocumentId)
  await workspace.getByLabel('履约日期', { exact: true }).fill('2026-02-01')
  await workspace.getByLabel('验收日期', { exact: true }).fill('2026-02-02')
  await selectValue(page, '结算方向', '其他应付')
  await workspace.getByLabel('履约事实', { exact: true }).fill('E2E 履约')
  await workspace.getByLabel('验收事实', { exact: true }).fill('E2E 验收')
  await workspace.getByLabel('金额', { exact: true }).fill('100.00')
  await workspace.getByRole('button', { name: '保存', exact: true }).click()
  await workspace.getByRole('button', { name: '取消编辑', exact: true }).click()
  await workspace.getByRole('button', { name: '核对', exact: true }).click()
  await workspace.getByRole('button', { name: '批准', exact: true }).click()
  await expect(workspace.getByText('已批准', { exact: true })).toBeVisible()
}

function reference(value: { objectId: string; versionId: string }) {
  return { objectId: value.objectId, versionId: value.versionId }
}

async function referenceByCode(
  api: Api,
  entity: string,
  code: string,
): Promise<ReferenceMutation> {
  if (['warehouse', 'vehicle', 'fund-account'].includes(entity)) {
    const page = await api.ok<{
      items: Array<{
        objectId: string
        code: string
        effective: { versionId: string; status: string } | null
      }>
    }>(`bob/${entity}/query`, {
      page: 1,
      pageSize: 20,
      filters: { status: ['EFFECTIVE'], keyword: code },
      sort: [{ field: 'name', order: 'asc' }],
    })
    const item = page.items.find(
      (candidate) =>
        candidate.code === code && candidate.effective?.status === 'EFFECTIVE',
    )
    expect(item, `${entity} ${code} reference`).toBeTruthy()
    return {
      objectId: item!.objectId,
      versionId: item!.effective!.versionId,
      code: item!.code,
    }
  }
  const candidates = await api.ok<ReferenceMutation[]>('bob/reference/query', {
    entity,
    keyword: code,
  })
  const candidate = candidates.find((item) => item.code === code)
  expect(candidate, `${entity} ${code} reference`).toBeTruthy()
  return candidate!
}

async function createAttributedCustomer(
  operator: Api,
  reviewer: Api,
  facts: Awaited<ReturnType<typeof createApprovedSharedRelationships>>,
  suffix: string,
): Promise<ReferenceMutation> {
  const paymentMethod = await operator.ok<{ objectId: string }>(
    'aux/payment-method/create',
    {
      data: {
        name: `E2E 渠道客户付款 ${suffix}`,
        defaultSalesSurcharge: '0.00',
        description: '跨域居间 E2E',
      },
    },
  )
  const created = await operator.ok<CustomerCreateMutation>(
    'bob/customer/create',
    {
      newParty: {
        kind: 'ORGANIZATION',
        legalName: `E2E 渠道客户 ${suffix}`,
        strongIdentifiers: [],
      },
      data: {
        name: `E2E 渠道客户 ${suffix}`,
        customerTypeCode: 'DIT-0001',
        operatingEntityId: facts.operatingEntityId,
        settlementMethodId: facts.settlementMethodId,
        paymentMethodId: paymentMethod.objectId,
        defaultTransportMethodCode: 'SELF_PICKUP',
        defaultTransportMethodName: '客户自提',
        transportSurcharge: '0.00',
        pricingPolicy: {
          defaultPremiumUnitPrice: '0.00',
          defaultDiscountUnitPrice: '0.00',
          costItems: [],
          thirdPartyIntermediaryFixedUnitCost: '0.00',
          thirdPartyIntermediaryVariableUnitCost: '0.00',
        },
        creditLimits: [],
        primarySalesAttribution: {
          type: 'CHANNEL_PARTNER',
          subjectObjectId: facts.salesPartner.objectId,
        },
      },
    },
  )
  const submitted = await operator.ok<Mutation>('bob/customer-account/submit', {
    objectId: created.defaultAccount.objectId,
    versionId: created.defaultAccount.candidate.version.versionId,
    revision: created.defaultAccount.candidate.version.revision,
  })
  const approved = await reviewer.ok<Mutation>('bob/customer-account/approve', {
    objectId: submitted.objectId,
    versionId: submitted.versionId,
    revision: submitted.revision,
  })
  return { ...approved, code: created.defaultAccount.code }
}

async function createEnabledWorkflow(
  api: Api,
  code: string,
  script: string,
  trialDocumentId: string,
): Promise<void> {
  const created = await api.ok<WflDefinition>('wfl/process-definition/create', {
    script,
  })
  expect(created.status).toBe('DRAFT')
  const saved = await api.ok<WflDefinition>('wfl/process-definition/save', {
    definitionId: created.definitionId,
    revision: created.revision,
    script: `${script}\n`,
  })
  const trial = await api.ok<{ matched: boolean; plannedActions: unknown[] }>(
    'wfl/process-definition/trial',
    {
      definitionId: saved.definitionId,
      revision: saved.revision,
      source: { entity: 'sale-order', documentId: trialDocumentId },
    },
  )
  expect(trial.matched).toBe(true)
  expect(trial.plannedActions).toHaveLength(1)
  const published = await api.ok<WflDefinition>(
    'wfl/process-definition/publish',
    { definitionId: saved.definitionId, revision: saved.revision },
  )
  expect(published.publishedRevision).toBeTruthy()
  const enabled = await api.ok<WflDefinition>('wfl/process-definition/enable', {
    definitionId: published.definitionId,
    revision: published.revision,
  })
  expect(enabled.status).toBe('ENABLED')
}

async function approveVou(
  api: Api,
  entity: string,
  input: VoucherMutation,
): Promise<VoucherMutation> {
  const checked = await api.ok<VoucherMutation>(`vou/${entity}/check`, {
    documentId: input.documentId,
    revision: input.revision,
  })
  return api.ok<VoucherMutation>(`vou/${entity}/approve`, {
    documentId: checked.documentId,
    revision: checked.revision,
  })
}

async function approveWorkflowNode(
  api: Api,
  processCode: string,
  processId: string,
  entity: string,
): Promise<VoucherMutation> {
  const instance = await api.ok<WflInstance>(`wfl/${processCode}/get`, {
    processId,
  })
  const node = instance.nodes.find((item) => item.documentEntity === entity)
  expect(node, `${entity} workflow node`).toBeTruthy()
  return approveVou(api, entity, {
    documentId: node!.documentId,
    revision: node!.documentRevision,
  })
}

async function createCollectedSale(
  operator: Api,
  workerState: WflWorkerState,
  customer: ReferenceMutation,
  suffix: string,
): Promise<{
  deliveryDocumentId: string
  signoffDocumentId: string
  businessDate: string
}> {
  const businessDate = new Date().toISOString().slice(0, 10)
  const employee = await referenceByCode(
    operator,
    'employee',
    workerState.fixtures.employee,
  )
  const product = await referenceByCode(
    operator,
    'product',
    workerState.fixtures.solventProduct,
  )
  const warehouse = await referenceByCode(
    operator,
    'warehouse',
    workerState.fixtures.warehouse,
  )
  const carrier = await referenceByCode(
    operator,
    'other-unit',
    workerState.fixtures.carrier,
  )
  const vehicle = await referenceByCode(
    operator,
    'vehicle',
    workerState.fixtures.vehicle,
  )
  const fundAccount = await referenceByCode(
    operator,
    'fund-account',
    workerState.fixtures.fundAccount,
  )
  const order = await operator.ok<VoucherMutation>('vou/sale-order/create', {
    data: {
      businessDate,
      currency: 'CNY',
      customer: reference(customer),
      salesperson: reference(employee),
      warehouse: reference(warehouse),
      productLines: [
        {
          product: { objectId: product.objectId },
          enteredQuantity: '1',
          enteredUnit: { objectId: '01JAVX00000000000000000011' },
          baseQuantity: '1',
          unitPrice: '100.00',
        },
      ],
    },
  })
  expect(order.documentNo).toBeTruthy()
  const processCode = `e2e-channel-sale-${suffix}`.toLowerCase()
  const script = `order = node(key="order", name="渠道销售订单", entity="sale-order")
outbound = node(key="outbound", name="渠道销售出库", entity="sale-outbound")
delivery = node(key="delivery", name="渠道销售送货", entity="sale-delivery")
signoff = node(key="signoff", name="渠道销售签收", entity="sale-signoff")
workflow(code="${processCode}", name="${processCode}", root=order, when=lambda source: source["data"]["customer"]["objectId"] == "${customer.objectId}", edges=[
  edge(source=order, target=outbound, relation="outbound", action=sale_outbound(initial=lambda source: {
    "warehouseObjectId": "${warehouse.objectId}",
    "businessDate": source["data"]["businessDate"],
    "lines": [{"sourceLineId": line["lineId"], "baseQuantity": line["baseQuantity"]} for line in source["data"]["productLines"]],
  })),
  edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial=lambda source: {
    "carrierServiceRelationshipObjectId": "${carrier.objectId}",
    "vehicleObjectId": "${vehicle.objectId}",
    "businessDate": source["data"]["businessDate"],
  })),
  edge(source=delivery, target=signoff, relation="signoff", action=sale_signoff(initial=lambda source: {
    "businessDate": source["data"]["businessDate"],
    "lines": [{"sourceLineId": line["lineId"], "signedBaseQuantity": line["baseQuantity"], "rejectedBaseQuantity": "0"} for line in source["data"]["productLines"]],
  })),
])`
  await createEnabledWorkflow(operator, processCode, script, order.documentId)
  await workerState.grantWorkflowPermissions([processCode])
  await approveVou(operator, 'sale-order', order)
  const processPage = await operator.ok<{
    items: Array<{ processId: string; rootDocumentId: string }>
  }>(`wfl/${processCode}/query`, {
    page: 1,
    pageSize: 20,
    keyword: order.documentNo,
  })
  const process = processPage.items.find(
    (item) => item.rootDocumentId === order.documentId,
  )
  expect(process).toBeTruthy()
  await approveWorkflowNode(
    operator,
    processCode,
    process!.processId,
    'sale-outbound',
  )
  const delivery = await approveWorkflowNode(
    operator,
    processCode,
    process!.processId,
    'sale-delivery',
  )
  const signoff = await approveWorkflowNode(
    operator,
    processCode,
    process!.processId,
    'sale-signoff',
  )
  const receipt = await operator.ok<VoucherMutation>(
    'vou/sales-receipt/create',
    {
      data: {
        businessDate,
        currency: 'CNY',
        counterpartyType: 'customer-account',
        counterparty: reference(customer),
        fundAccount: reference(fundAccount),
        handler: reference(employee),
        amount: '100.00',
      },
    },
  )
  await approveVou(operator, 'sales-receipt', receipt)
  return {
    deliveryDocumentId: delivery.documentId,
    signoffDocumentId: signoff.documentId,
    businessDate,
  }
}

async function createApprovedBob(
  operator: Api,
  reviewer: Api,
  entity: string,
  data: Record<string, unknown>,
): Promise<BobView> {
  const created = await operator.ok<Mutation>(`bob/${entity}/create`, { data })
  const approved = await approve(operator, reviewer, entity, created)
  return operator.ok<BobView>(`bob/${entity}/get`, {
    objectId: approved.objectId,
  })
}

async function createApprovedEmployee(
  operator: Api,
  reviewer: Api,
  name: string,
  operatingEntityId: string,
): Promise<BobView> {
  const created = await operator.ok<Mutation>('bob/employee/create', {
    newParty: { kind: 'PERSON', legalName: name, strongIdentifiers: [] },
    data: { operatingEntityId },
  })
  const approved = await approve(operator, reviewer, 'employee', created)
  return operator.ok<BobView>('bob/employee/get', {
    objectId: approved.objectId,
  })
}

async function createEmployeeAttributedCustomer(
  operator: Api,
  reviewer: Api,
  name: string,
  operatingEntityId: string,
  settlementMethodId: string,
  employeeObjectId: string,
): Promise<ReferenceMutation> {
  const paymentMethod = await operator.ok<{ objectId: string }>(
    'aux/payment-method/create',
    {
      data: {
        name: `${name}付款方式`,
        defaultSalesSurcharge: '0.00',
        description: '连续生效跨主体 E2E',
      },
    },
  )
  const created = await operator.ok<CustomerCreateMutation>(
    'bob/customer/create',
    {
      newParty: {
        kind: 'ORGANIZATION',
        legalName: name,
        strongIdentifiers: [],
      },
      data: {
        name,
        customerTypeCode: 'DIT-0001',
        operatingEntityId,
        settlementMethodId,
        paymentMethodId: paymentMethod.objectId,
        defaultTransportMethodCode: 'SELF_PICKUP',
        defaultTransportMethodName: '客户自提',
        transportSurcharge: '0.00',
        pricingPolicy: {
          defaultPremiumUnitPrice: '0.00',
          defaultDiscountUnitPrice: '0.00',
          costItems: [],
          thirdPartyIntermediaryFixedUnitCost: '0.00',
          thirdPartyIntermediaryVariableUnitCost: '0.00',
        },
        creditLimits: [],
        primarySalesAttribution: {
          type: 'INTERNAL_EMPLOYEE',
          subjectObjectId: employeeObjectId,
        },
      },
    },
  )
  const candidate = created.defaultAccount.candidate.version
  const approved = await approve(operator, reviewer, 'customer-account', {
    objectId: created.defaultAccount.objectId,
    versionId: candidate.versionId,
    revision: candidate.revision,
  })
  return { ...approved, code: created.defaultAccount.code }
}

async function createSaleOrderDraft(
  api: Api,
  customer: ReferenceMutation,
  warehouse: ReferenceMutation,
  product: ReferenceMutation,
  businessDate: string,
  salesperson?: ReferenceMutation,
): Promise<VoucherMutation> {
  return api.ok<VoucherMutation>('vou/sale-order/create', {
    data: {
      businessDate,
      currency: 'CNY',
      customer: reference(customer),
      ...(salesperson ? { salesperson: reference(salesperson) } : {}),
      warehouse: reference(warehouse),
      productLines: [
        {
          product: { objectId: product.objectId },
          enteredQuantity: '1',
          enteredUnit: { objectId: '01JAVX00000000000000000011' },
          baseQuantity: '1',
          unitPrice: '100.00',
          deliverySpecificationType: 'PACKAGED',
        },
      ],
    },
  })
}

async function createApprovedDirectDelivery(
  api: Api,
  workerState: WflWorkerState,
  suffix: string,
  input: {
    customer: ReferenceMutation
    warehouse: ReferenceMutation
    product: ReferenceMutation
    salesperson: ReferenceMutation
    vehicle: ReferenceMutation
    businessDate: string
  },
): Promise<VoucherView> {
  const order = await createSaleOrderDraft(
    api,
    input.customer,
    input.warehouse,
    input.product,
    input.businessDate,
    input.salesperson,
  )
  const orderView = await api.ok<VoucherView>('vou/sale-order/get', {
    documentId: order.documentId,
  })
  const line = orderView.data.productLines?.[0]
  expect(line, 'sale order product line').toBeTruthy()
  expect(line!.lineId, 'sale order line id').toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  expect(line!.baseQuantity, 'sale order line base quantity').toBe('1.0')
  const processCode = `e2e-internal-delivery-${suffix}`.toLowerCase()
  const script = `order = node(key="order", name="自有车辆销售订单", entity="sale-order")
outbound = node(key="outbound", name="自有车辆销售出库", entity="sale-outbound")
delivery = node(key="delivery", name="自有车辆销售送货", entity="sale-delivery")
workflow(code="${processCode}", name="${processCode}", root=order, when=lambda source: source["data"]["customer"]["objectId"] == "${input.customer.objectId}", edges=[
  edge(source=order, target=outbound, relation="outbound", action=sale_outbound(initial=lambda source: {
    "warehouseObjectId": "${input.warehouse.objectId}",
    "businessDate": source["data"]["businessDate"],
    "lines": [{"sourceLineId": line["lineId"], "baseQuantity": line["baseQuantity"]} for line in source["data"]["productLines"]],
  })),
  edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial=lambda source: {
    "vehicleObjectId": "${input.vehicle.objectId}",
    "businessDate": source["data"]["businessDate"],
  })),
])`
  await createEnabledWorkflow(api, processCode, script, order.documentId)
  await workerState.grantWorkflowPermissions([processCode])
  await approveVou(api, 'sale-order', order)
  const processPage = await api.ok<{
    items: Array<{ processId: string; rootDocumentId: string }>
  }>(`wfl/${processCode}/query`, {
    page: 1,
    pageSize: 20,
    keyword: order.documentNo,
  })
  const process = processPage.items.find(
    (item) => item.rootDocumentId === order.documentId,
  )
  expect(process, 'internal delivery workflow instance').toBeTruthy()
  await approveWorkflowNode(
    api,
    processCode,
    process!.processId,
    'sale-outbound',
  )
  const delivery = await approveWorkflowNode(
    api,
    processCode,
    process!.processId,
    'sale-delivery',
  )
  return api.ok<VoucherView>('vou/sale-delivery/get', {
    documentId: delivery.documentId,
  })
}

function monthRange(businessDate: string): {
  start: string
  end: string
} {
  const [year, month] = businessDate.split('-').map(Number)
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10),
  }
}

async function accountJournalRows(
  api: Api,
  sourceDocumentId: string,
  dateRange: { start: string; end: string },
): Promise<Array<Record<string, unknown>>> {
  const books = await api.ok<{ items: Array<{ bookId: string }> }>(
    'acc/book/query',
    { page: 1, pageSize: 200 },
  )
  const bookId = books.items[0]?.bookId
  expect(bookId).toBeTruthy()
  const subjects = await api.ok<{
    items: Array<{ subjectId: string; code: string }>
  }>('acc/subject/query', { bookId, page: 1, pageSize: 200 })
  const subjectId = subjects.items.find(
    (item) => item.code === '2241',
  )?.subjectId
  expect(subjectId).toBeTruthy()
  const journal = await api.ok<{
    items: Array<Record<string, unknown>>
  }>('rpt/account-journal/query', {
    parameters: {
      bookId,
      subjectId,
      currency: 'CNY',
      dateRange: [dateRange.start, dateRange.end],
    },
    page: 1,
    pageSize: 100,
  })
  return journal.items.filter(
    (item) => item.source_document_id === sourceDocumentId,
  )
}

test(
  'Party 复用跨关系、合同验收及合并历史引用均走真实后端',
  { tag: '@system-serial' },
  async ({ page, workerState }, testInfo) => {
    test.setTimeout(600_000)
    const suffix =
      `${testInfo.parallelIndex}${Date.now().toString(36)}`.toUpperCase()
    const session = await operatorApi(workerState.operator)
    const reviewerSession = await operatorApi(workerState.reviewer)
    try {
      const facts = await createApprovedSharedRelationships(
        session.api,
        reviewerSession.api,
        suffix,
      )

      // UI proves the single Party exposes both independently-effective cards.
      await signIn(page, workerState.operator)
      await page.goto('/bob/party')
      await page
        .getByRole('textbox', { name: '名称、电话、邮箱或地址', exact: true })
        .fill(`E2E 跨域主体 ${suffix}`)
      await page.getByRole('button', { name: '查询', exact: true }).click()
      const partyRow = page
        .locator('tbody tr')
        .filter({ hasText: `E2E 跨域主体 ${suffix}` })
      await partyRow
        .getByRole('button', { name: '查看 / 编辑', exact: true })
        .click()
      const partyDialog = page
        .getByRole('dialog')
        .filter({ hasText: '主体共享身份' })
      await expect(partyDialog).toContainText(
        `${facts.otherUnit.code} · 服务关系`,
      )
      await expect(partyDialog).toContainText(
        `${facts.salesPartner.code} · 销售合作关系`,
      )
      await partyDialog
        .getByRole('button', { name: '关闭', exact: true })
        .click()

      const serviceContractDocumentId = await createAndApproveContract(
        page,
        {
          type: '服务关系',
          code: facts.otherUnit.code!,
        },
        workerState.fixtures.employee,
      )
      await createAndApproveAcceptance(page, serviceContractDocumentId)
      const customer = await createAttributedCustomer(
        session.api,
        reviewerSession.api,
        facts,
        suffix,
      )
      const sale = await createCollectedSale(
        session.api,
        workerState,
        customer,
        suffix,
      )

      // One real-backend journey now proves the final BOB/Warehouse/Vehicle
      // model as a whole. No application request is mocked or intercepted.
      const product = await referenceByCode(
        session.api,
        'product',
        workerState.fixtures.solventProduct,
      )
      const salesperson = await referenceByCode(
        session.api,
        'employee',
        workerState.fixtures.employee,
      )
      const deliveryWarehouse = await referenceByCode(
        session.api,
        'warehouse',
        workerState.fixtures.warehouse,
      )
      const manager = await createApprovedEmployee(
        session.api,
        reviewerSession.api,
        `E2E 仓库负责人 ${suffix}`,
        facts.operatingEntityId,
      )
      const managedWarehouse = await createApprovedBob(
        session.api,
        reviewerSession.api,
        'warehouse',
        {
          name: `E2E 全局仓库 ${suffix}`,
          managerEmployeeId: manager.objectId,
        },
      )
      const warehouseCandidate = await session.api.ok<Mutation>(
        'bob/warehouse/save',
        {
          objectId: managedWarehouse.objectId,
          versionId: managedWarehouse.version.versionId,
          revision: managedWarehouse.version.revision,
          data: { name: `E2E 全局仓库候选 ${suffix}` },
        },
      )
      const warehousePage = await session.api.ok<{
        items: BobListItem[]
      }>('bob/warehouse/query', {
        page: 1,
        pageSize: 20,
        filters: { keyword: managedWarehouse.code },
        sort: [{ field: 'code', order: 'asc' }],
      })
      const warehouseRow = warehousePage.items.find(
        (item) => item.objectId === managedWarehouse.objectId,
      )
      expect(warehouseRow?.effective?.versionId).toBe(
        managedWarehouse.version.versionId,
      )
      expect(warehouseRow?.candidate?.versionId).toBe(
        warehouseCandidate.versionId,
      )
      expect(warehouseRow?.candidate?.status).toBe('DRAFT')
      await approve(
        session.api,
        reviewerSession.api,
        'warehouse',
        warehouseCandidate,
      )

      const disabledManager = await session.api.ok<BobObjectMutation>(
        'bob/employee/disable',
        {
          objectId: manager.objectId,
          objectRevision: manager.objectRevision,
        },
      )
      expect(disabledManager.enabled).toBe(false)
      const cleanedWarehouse = await session.api.ok<BobView>(
        'bob/warehouse/get',
        { objectId: managedWarehouse.objectId },
      )
      expect(cleanedWarehouse.data.managerEmployeeId ?? null).toBeNull()

      const secondOperatingEntity = await createApprovedBob(
        session.api,
        reviewerSession.api,
        'operating-entity',
        {
          name: `E2E 第二经营主体 ${suffix}`,
          taxNumber: `TAX-${suffix}`,
        },
      )
      const secondEmployee = await createApprovedEmployee(
        session.api,
        reviewerSession.api,
        `E2E 第二主体员工 ${suffix}`,
        secondOperatingEntity.objectId,
      )
      const secondCustomer = await createEmployeeAttributedCustomer(
        session.api,
        reviewerSession.api,
        `E2E 第二主体客户 ${suffix}`,
        secondOperatingEntity.objectId,
        facts.settlementMethodId,
        secondEmployee.objectId,
      )
      const sharedWarehouse = {
        objectId: cleanedWarehouse.objectId,
        versionId: cleanedWarehouse.version.versionId,
        code: cleanedWarehouse.code,
      }
      const firstEntityDraft = await createSaleOrderDraft(
        session.api,
        customer,
        sharedWarehouse,
        product,
        sale.businessDate,
        salesperson,
      )
      const secondEntityDraft = await createSaleOrderDraft(
        session.api,
        secondCustomer,
        sharedWarehouse,
        product,
        sale.businessDate,
      )
      const blockedWarehouse = await session.api.ok<{
        inventory: unknown[]
        inProgressDocuments: Array<{ documentId: string }>
        executableSources: unknown[]
      }>('bob/warehouse/disable-precheck', {
        objectId: managedWarehouse.objectId,
      })
      expect(
        new Set(
          blockedWarehouse.inProgressDocuments.map((item) => item.documentId),
        ),
      ).toEqual(
        new Set([firstEntityDraft.documentId, secondEntityDraft.documentId]),
      )
      for (const draft of [firstEntityDraft, secondEntityDraft]) {
        await session.api.ok<VoucherMutation>('vou/sale-order/delete', {
          documentId: draft.documentId,
          revision: draft.revision,
          reason: 'E2E 修复仓库停用阻断',
        })
      }
      const clearWarehouse = await session.api.ok<{
        inventory: unknown[]
        inProgressDocuments: unknown[]
        executableSources: unknown[]
      }>('bob/warehouse/disable-precheck', {
        objectId: managedWarehouse.objectId,
      })
      expect(clearWarehouse.inventory).toEqual([])
      expect(clearWarehouse.inProgressDocuments).toEqual([])
      expect(clearWarehouse.executableSources).toEqual([])
      const disabledWarehouse = await session.api.ok<BobObjectMutation>(
        'bob/warehouse/disable',
        {
          objectId: managedWarehouse.objectId,
          objectRevision: cleanedWarehouse.objectRevision,
        },
      )
      expect(disabledWarehouse.enabled).toBe(false)
      const disabledWarehouseOrder = await session.api.post<VoucherMutation>(
        'vou/sale-order/create',
        {
          data: {
            businessDate: sale.businessDate,
            currency: 'CNY',
            customer: reference(customer),
            salesperson: reference(salesperson),
            warehouse: reference(sharedWarehouse),
            productLines: [
              {
                product: { objectId: product.objectId },
                enteredQuantity: '1',
                enteredUnit: { objectId: '01JAVX00000000000000000011' },
                baseQuantity: '1',
                unitPrice: '100.00',
                deliverySpecificationType: 'PACKAGED',
              },
            ],
          },
        },
      )
      expect(String(disabledWarehouseOrder.code)).not.toBe('0')

      const internalVehicle = await createApprovedBob(
        session.api,
        reviewerSession.api,
        'vehicle',
        {
          name: `E2E 自有车辆 ${suffix}`,
          plateNumber: `E2E-I-${suffix.slice(-8)}`,
          vehicleType: 'DIT-0003',
          carrierAffiliation: {
            type: 'INTERNAL',
            operatingEntityId: facts.operatingEntityId,
          },
          bulkLiquidCapable: false,
        },
      )
      const internalCustomer = await createEmployeeAttributedCustomer(
        session.api,
        reviewerSession.api,
        `E2E 自有配送客户 ${suffix}`,
        facts.operatingEntityId,
        facts.settlementMethodId,
        salesperson.objectId,
      )
      const internalDelivery = await createApprovedDirectDelivery(
        session.api,
        workerState,
        suffix,
        {
          customer: internalCustomer,
          warehouse: deliveryWarehouse,
          product,
          salesperson,
          vehicle: internalVehicle,
          businessDate: sale.businessDate,
        },
      )
      expect(internalDelivery.data.carrierType).toBe('INTERNAL')
      expect(internalDelivery.data.carrier).toBeUndefined()
      expect(internalDelivery.data.carrierOperatingEntity?.objectId).toBe(
        facts.operatingEntityId,
      )
      expect(internalDelivery.data.vehicle?.versionId).toBe(
        internalVehicle.version.versionId,
      )
      const internalVehicleSnapshot = {
        versionId: internalDelivery.data.vehicle?.versionId,
        name: internalDelivery.data.vehicle?.name,
      }

      const externalDelivery = await session.api.ok<VoucherView>(
        'vou/sale-delivery/get',
        { documentId: sale.deliveryDocumentId },
      )
      expect(externalDelivery.data.carrierType).toBe('EXTERNAL')
      expect(externalDelivery.data.carrier?.objectId).toBeTruthy()
      expect(externalDelivery.data.vehicle?.objectId).toBeTruthy()

      const vehicleCandidate = await session.api.ok<Mutation>(
        'bob/vehicle/save',
        {
          objectId: internalVehicle.objectId,
          versionId: internalVehicle.version.versionId,
          revision: internalVehicle.version.revision,
          data: {
            name: `E2E 自有车辆候选 ${suffix}`,
            plateNumber: internalVehicle.data.plateNumber,
            vehicleType: internalVehicle.data.vehicleType,
            carrierAffiliation: internalVehicle.data.carrierAffiliation,
            bulkLiquidCapable: internalVehicle.data.bulkLiquidCapable,
          },
        },
      )
      const vehicleDisabled = await session.api.ok<BobObjectMutation>(
        'bob/vehicle/disable',
        {
          objectId: internalVehicle.objectId,
          objectRevision: vehicleCandidate.objectRevision,
        },
      )
      const vehicleEnabled = await session.api.ok<BobObjectMutation>(
        'bob/vehicle/enable',
        {
          objectId: internalVehicle.objectId,
          objectRevision: vehicleDisabled.objectRevision,
        },
      )
      expect(vehicleEnabled.enabled).toBe(true)
      const vehiclePage = await session.api.ok<{ items: BobListItem[] }>(
        'bob/vehicle/query',
        {
          page: 1,
          pageSize: 20,
          filters: { keyword: internalVehicle.code },
          sort: [{ field: 'code', order: 'asc' }],
        },
      )
      const vehicleRow = vehiclePage.items.find(
        (item) => item.objectId === internalVehicle.objectId,
      )
      expect(vehicleRow?.enabled).toBe(true)
      expect(vehicleRow?.effective?.versionId).toBe(
        internalVehicle.version.versionId,
      )
      expect(vehicleRow?.candidate?.versionId).toBe(vehicleCandidate.versionId)
      await approve(
        session.api,
        reviewerSession.api,
        'vehicle',
        vehicleCandidate,
      )
      const stableInternalDelivery = await session.api.ok<VoucherView>(
        'vou/sale-delivery/get',
        { documentId: internalDelivery.documentId },
      )
      expect({
        versionId: stableInternalDelivery.data.vehicle?.versionId,
        name: stableInternalDelivery.data.vehicle?.name,
      }).toEqual(internalVehicleSnapshot)

      const period = monthRange(sale.businessDate)
      const sourceProbe = await session.api.ok<{
        source: {
          lines: Array<{
            salesContractStatus: string
            signoffDocumentId: string
          }>
        }
      }>('vou/intermediary-calculation/source', { businessDate: period.end })
      expect(
        sourceProbe.source.lines.some(
          (line) =>
            line.signoffDocumentId === sale.signoffDocumentId &&
            line.salesContractStatus === 'MISSING',
        ),
      ).toBe(true)

      // The browser executes the real calculation script before any applicable
      // sales contract exists. The draft is valid, but lifecycle validation
      // must expose a repairable missing-contract blocker.
      await page.goto('/vou/intermediary-calculation')
      await page.getByRole('button', { name: '新增', exact: true }).click()
      let calculationWorkspace = page.locator('.voucher-workspace')
      await calculationWorkspace
        .getByLabel('汇总期间（月末）', { exact: true })
        .fill(period.end)
      const sourceResponse = page.waitForResponse((response) =>
        response.url().endsWith('/vou/intermediary-calculation/source'),
      )
      const scriptResponse = page.waitForResponse((response) =>
        response.url().endsWith('/vou/intermediary-calculation/script-get'),
      )
      await calculationWorkspace
        .getByRole('button', { name: '执行计算', exact: true })
        .click()
      for (const response of await Promise.all([
        sourceResponse,
        scriptResponse,
      ])) {
        expect(response.status()).toBe(200)
        const envelope = (await response.json()) as Envelope<unknown>
        expect(String(envelope.code), envelope.message).toBe('0')
      }
      const calculationMessage = page
        .locator('.v-snackbar--active .app-snackbar__content span')
        .first()
      await expect(calculationMessage).toBeVisible({ timeout: 60_000 })
      const calculationMessageText = await calculationMessage.textContent()
      if (!calculationMessageText?.startsWith('已按脚本')) {
        throw new Error(
          `intermediary browser calculation: ${calculationMessageText}`,
        )
      }
      await expect(
        calculationWorkspace.getByText('渠道差价', { exact: true }),
      ).toBeVisible({ timeout: 60_000 })
      await calculationWorkspace
        .getByRole('button', { name: '详情', exact: true })
        .click()
      const calculationDetail = page
        .getByRole('dialog')
        .filter({ hasText: '居间计算稿详情' })
      await expect(calculationDetail).toContainText('缺少合同')
      await calculationDetail
        .getByRole('button', { name: '关闭详情', exact: true })
        .click()
      await expect(calculationDetail).toBeHidden()
      const createCalculation = page.waitForResponse((response) =>
        response.url().endsWith('/vou/intermediary-calculation/create'),
      )
      await calculationWorkspace
        .getByRole('button', { name: '保存', exact: true })
        .click()
      const calculationCreatedEnvelope = (await (
        await createCalculation
      ).json()) as Envelope<VoucherMutation>
      expect(
        String(calculationCreatedEnvelope.code),
        calculationCreatedEnvelope.message,
      ).toBe('0')
      const calculationCreated = calculationCreatedEnvelope.data
      await calculationWorkspace
        .getByRole('button', { name: '取消编辑', exact: true })
        .click()
      const calculationChecked = await session.api.post(
        'vou/intermediary-calculation/check',
        {
          documentId: calculationCreated.documentId,
          revision: calculationCreated.revision,
        },
      )
      expect(String(calculationChecked.code), calculationChecked.message).toBe(
        '0',
      )
      const checkedCalculation = calculationChecked.data as VoucherMutation
      const missingContract = await session.api.post(
        'vou/intermediary-calculation/approve',
        {
          documentId: checkedCalculation.documentId,
          revision: checkedCalculation.revision,
        },
      )
      expect(String(missingContract.code)).not.toBe('0')
      expect(missingContract.message).toContain(
        'missing applicable sales contract',
      )
      const calculationUnchecked = await session.api.post(
        'vou/intermediary-calculation/uncheck',
        {
          documentId: checkedCalculation.documentId,
          revision: checkedCalculation.revision,
        },
      )
      expect(
        String(calculationUnchecked.code),
        calculationUnchecked.message,
      ).toBe('0')

      const salesContractDocumentId = await createAndApproveContract(
        page,
        {
          type: '销售合作关系',
          code: facts.salesPartner.code!,
        },
        workerState.fixtures.employee,
        '2026-01-01',
      )
      // The second approved sales contract deliberately overlaps the first.
      const latestSalesContractDocumentId = await createAndApproveContract(
        page,
        {
          type: '销售合作关系',
          code: facts.salesPartner.code!,
        },
        workerState.fixtures.employee,
        period.start,
      )

      // Editing and recalculating repairs the draft. The detail table proves
      // the deterministic latest applicable contract was snapshotted.
      await page.goto(
        `/vou/intermediary-calculation?documentId=${calculationCreated.documentId}&mode=edit`,
      )
      calculationWorkspace = page.locator('.voucher-workspace')
      const repairedSourceResponse = page.waitForResponse((response) =>
        response.url().endsWith('/vou/intermediary-calculation/source'),
      )
      await calculationWorkspace
        .getByRole('button', { name: '重新计算', exact: true })
        .click()
      const repairedSourceEnvelope = (await (
        await repairedSourceResponse
      ).json()) as Envelope<unknown>
      expect(
        String(repairedSourceEnvelope.code),
        repairedSourceEnvelope.message,
      ).toBe('0')
      await expect(
        calculationWorkspace.getByText('渠道差价', { exact: true }),
      ).toBeVisible({ timeout: 60_000 })
      await calculationWorkspace
        .getByRole('button', { name: '详情', exact: true })
        .click()
      const repairedDetail = page
        .getByRole('dialog')
        .filter({ hasText: '居间计算稿详情' })
      await expect(repairedDetail).toContainText(latestSalesContractDocumentId)
      await expect(repairedDetail).not.toContainText('缺少合同')
      await repairedDetail
        .getByRole('button', { name: '关闭详情', exact: true })
        .click()
      await expect(repairedDetail).toBeHidden()
      const saveCalculation = page.waitForResponse((response) =>
        response.url().endsWith('/vou/intermediary-calculation/save'),
      )
      await calculationWorkspace
        .getByRole('button', { name: '保存', exact: true })
        .click()
      const calculationSavedEnvelope = (await (
        await saveCalculation
      ).json()) as Envelope<VoucherMutation>
      expect(
        String(calculationSavedEnvelope.code),
        calculationSavedEnvelope.message,
      ).toBe('0')
      await calculationWorkspace
        .getByRole('button', { name: '取消编辑', exact: true })
        .click()
      await calculationWorkspace
        .getByRole('button', { name: '核对', exact: true })
        .click()
      await calculationWorkspace
        .getByRole('button', { name: '批准', exact: true })
        .click()
      await expect(
        calculationWorkspace.getByText('已批准', { exact: true }),
      ).toBeVisible()
      const calculation = await session.api.ok<IntermediaryDocument>(
        'vou/intermediary-calculation/get',
        { documentId: calculationCreated.documentId },
      )
      expect(
        calculation.data.intermediaryCalculation.source.lines.some(
          (line) =>
            line.salesContractStatus === 'APPLICABLE' &&
            line.salesContract?.documentId === latestSalesContractDocumentId,
        ),
      ).toBe(true)
      const journalBeforeMerge = await accountJournalRows(
        session.api,
        calculationCreated.documentId,
        period,
      )
      expect(journalBeforeMerge).toEqual([
        expect.objectContaining({
          subject_code: '2241',
          direction: 'CREDIT',
          source_entity: 'intermediary-calculation',
          source_document_id: calculationCreated.documentId,
        }),
      ])

      // Sales-partner contracts are selected by intermediary calculation and
      // must not be used as a service-acceptance contract.
      await page.goto('/vou/service-acceptance')
      await page.getByRole('button', { name: '新增', exact: true }).click()
      const invalidAcceptance = page.locator('.voucher-workspace')
      await invalidAcceptance
        .getByLabel('已批准服务合同 ID', { exact: true })
        .fill(salesContractDocumentId)
      await invalidAcceptance
        .getByLabel('履约日期', { exact: true })
        .fill('2026-02-01')
      await invalidAcceptance
        .getByLabel('验收日期', { exact: true })
        .fill('2026-02-02')
      await selectValue(page, '结算方向', '其他应付')
      await invalidAcceptance.getByLabel('金额', { exact: true }).fill('100.00')
      const rejected = page.waitForResponse((response) =>
        response.url().endsWith('/vou/service-acceptance/create'),
      )
      await invalidAcceptance
        .getByRole('button', { name: '保存', exact: true })
        .click()
      const rejectedEnvelope = (await (
        await rejected
      ).json()) as Envelope<unknown>
      expect(String(rejectedEnvelope.code)).not.toBe('0')

      // The rule is enforced by the real Customer command, not client-side filtering.
      const selfAttribution = await session.api.post('bob/customer/create', {
        partyId: facts.party.partyId,
        data: {
          name: `E2E 自归属客户 ${suffix}`,
          customerTypeCode: 'DIT-0001',
          operatingEntityId: facts.operatingEntityId,
          pricingPolicy: {
            defaultPremiumUnitPrice: '0.00',
            defaultDiscountUnitPrice: '0.00',
            costItems: [],
            thirdPartyIntermediaryFixedUnitCost: '0.00',
            thirdPartyIntermediaryVariableUnitCost: '0.00',
          },
          creditLimits: [],
          primarySalesAttribution: {
            type: 'CHANNEL_PARTNER',
            subjectObjectId: facts.salesPartner.objectId,
          },
        },
      })
      expect(String(selfAttribution.code)).not.toBe('0')
      expect(selfAttribution.message).toBe(
        'customer cannot attribute sales to itself',
      )

      // A duplicate target creates a service-relationship conflict; the source
      // sales relationship moves while its approved contract keeps the same ID.
      const target = await session.api.ok<Mutation>('bob/other-unit/create', {
        newParty: {
          kind: 'ORGANIZATION',
          legalName: `E2E 合并保留 ${suffix}`,
          displayName: `E2E 合并保留 ${suffix}`,
          strongIdentifiers: [],
        },
        data: {
          operatingEntityId: facts.operatingEntityId,
          settlementMethodId: facts.settlementMethodId,
          contactName: '',
          contactPhone: '',
          email: '',
          address: '',
          remark: '',
        },
      })
      const approvedTarget = await approve(
        session.api,
        reviewerSession.api,
        'other-unit',
        target,
      )
      const targetParty = (
        await session.api.ok<{ items: Party[] }>('bob/party/query', {
          page: 1,
          pageSize: 20,
          filters: { keyword: `E2E 合并保留 ${suffix}` },
        })
      ).items[0]!
      const preflight = await session.api.ok<{
        preflightId: string
        relationshipConflicts: Array<{
          relationshipType: string
          operatingEntityId: string
        }>
      }>('bob/party/merge-preflight', {
        sourcePartyId: facts.party.partyId,
        targetPartyId: targetParty.partyId,
        sourceRevision: facts.party.revision,
        targetRevision: targetParty.revision,
      })
      expect(
        preflight.relationshipConflicts.some(
          (item) => item.relationshipType === 'other-unit',
        ),
      ).toBe(true)
      const merged = await session.api.ok('bob/party/merge-confirm', {
        preflightId: preflight.preflightId,
        sourcePartyId: facts.party.partyId,
        targetPartyId: targetParty.partyId,
        sourceRevision: facts.party.revision,
        targetRevision: targetParty.revision,
        conflictResolutions: preflight.relationshipConflicts.map((item) => ({
          relationshipType: item.relationshipType,
          operatingEntityId: item.operatingEntityId,
          retainObjectId:
            item.relationshipType === 'other-unit'
              ? approvedTarget.objectId
              : facts.salesPartner.objectId,
        })),
      })
      expect(merged).toBeTruthy()
      const contract = await session.api.ok<{
        data: { counterparty: { objectId: string } }
      }>('vou/service-contract/get', {
        documentId: latestSalesContractDocumentId,
      })
      expect(contract.data.counterparty.objectId).toBe(
        facts.salesPartner.objectId,
      )
      expect(
        await accountJournalRows(
          session.api,
          calculationCreated.documentId,
          period,
        ),
      ).toEqual(journalBeforeMerge)
    } finally {
      await reviewerSession.dispose()
      await session.dispose()
    }
  },
)
