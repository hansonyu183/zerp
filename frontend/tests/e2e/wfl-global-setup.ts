import { randomBytes } from 'node:crypto'
import { mkdir, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request, type APIRequestContext } from '@playwright/test'

interface Envelope<T> {
  code: number | string
  message: string
  data: T
  requestId?: string
}

interface SessionData {
  csrfToken: string
}

interface PermissionView {
  id: string
  path: string
  status: string
}

interface Page<T> {
  items: T[]
  total: number
}

interface RoleView {
  id: string
  name: string
  description: string | null
  revision: number
  permissions: Array<{ id: string }>
}

interface UserView {
  id: string
}

interface AccountingBookView {
  bookId: string
  name: string
  description: string
  baseCurrency: string
  controlBook: boolean
  revision: number
  queryUserIds: string[]
  operateUserIds: string[]
}

interface AccountingOpeningView {
  state: 'DRAFT' | 'APPROVED'
  revision: number
}

interface AccountingSubjectView {
  subjectId: string
  code: string
}

interface AccountingMappingView {
  mappingId: string
  state: 'DRAFT' | 'APPROVED'
  revision: number
}

interface BobMutation {
  objectId: string
  objectRevision: number
  versionId: string
  revision: number
  code: string
}

interface CustomerCreateMutation extends BobMutation {
  defaultAccount: {
    objectId: string
    objectRevision: number
    code: string
    candidate: {
      version: {
        versionId: string
        revision: number
      }
    }
  }
}

interface AuxQueryItem {
  objectId: string
  currentVersion: {
    data: { termCode?: string }
  }
}

interface BobReferenceQueryItem {
  objectId: string
}

const accMappingEntities = new Set([
  'sale-pricing',
  'sale-order',
  'sale-outbound',
  'sale-delivery',
  'sale-signoff',
  'sale-return',
  'purchase-order',
  'purchase-inbound',
  'purchase-return',
  'purchase-inquiry',
  'order-production',
  'self-production',
  'inventory-count',
  'sales-receipt',
  'purchase-refund',
  'other-receipt',
  'sales-refund',
  'purchase-payment',
  'other-payment',
  'employee-loan',
  'employee-repayment',
  'employee-loan-writeoff',
  'expense-reimbursement',
  'expense-payment',
  'other-income',
  'asset-acquisition',
  'asset-sale',
  'asset-liquidation',
  'bill-receipt',
  'bill-payment',
  'bill-issue',
  'bill-discount',
  'bill-maturity',
  'intermediary-calculation',
  'service-contract',
  'service-acceptance',
])

interface AuxMutation {
  objectId: string
}

interface VouMutation {
  documentId: string
  documentNo?: string
  revision: number
}

interface WflDefinitionView {
  definitionId: string
  code: string
  status: 'DRAFT' | 'ENABLED' | 'DISABLED'
  revision: number
  publishedRevision?: number
}

interface WflInstanceListItem {
  processId: string
  rootDocumentId: string
}

interface WflInstanceView {
  nodes: Array<{
    documentId: string
    documentEntity: string
    documentRevision: number
  }>
}

export interface E2ECredentials {
  username: string
  password: string
}

export interface WflFixtures {
  customer: string
  supplier: string
  employee: string
  solventProduct: string
  resinProduct: string
  carrier: string
  vehicle: string
  warehouse: string
  fundAccount: string
  purchaseProcessCode: string
  salesProcessCode: string
  purchaseTrialDocumentId: string
  supplierObjectId: string
  warehouseObjectId: string
}

export interface WflWorkerState {
  operator: E2ECredentials
  reviewer: E2ECredentials
  fixtures: WflFixtures
  storageState: Awaited<ReturnType<APIRequestContext['storageState']>>
  grantWorkflowPermissions: (processCodes: string[]) => Promise<void>
}

class RealApi {
  constructor(
    private readonly context: APIRequestContext,
    private readonly csrfToken = '',
  ) {}

  async post<T>(path: string, data: unknown): Promise<T> {
    const response = await this.context.post(path, {
      data,
      headers: this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : undefined,
    })
    if (response.status() !== 200) {
      throw new Error(`WFL 预置接口 ${path} 返回 HTTP ${response.status()}。`)
    }
    const envelope = (await response.json()) as Envelope<T>
    if (envelope.code !== 0 && envelope.code !== '0') {
      const requestId = envelope.requestId
        ? `（请求编号：${envelope.requestId}）`
        : ''
      throw new Error(
        `WFL 预置接口 ${path} 失败：${envelope.message}${requestId}`,
      )
    }
    return envelope.data
  }
}

async function signIn(
  baseURL: string,
  username: string,
  password: string,
): Promise<{ api: RealApi; context: APIRequestContext }> {
  const anonymous = await request.newContext({ baseURL })
  try {
    const session = await new RealApi(anonymous).post<SessionData>(
      'app/user/signin',
      { username, password },
    )
    return {
      api: new RealApi(anonymous, session.csrfToken),
      context: anonymous,
    }
  } catch (error) {
    await anonymous.dispose()
    throw error
  }
}

async function signInAfterForcedPasswordChange(
  baseURL: string,
  username: string,
  initialPassword: string,
  password: string,
): Promise<{ api: RealApi; context: APIRequestContext }> {
  const initialSession = await signIn(baseURL, username, initialPassword)
  try {
    await initialSession.api.post('app/user/change-password', {
      currentPassword: initialPassword,
      newPassword: password,
    })
  } finally {
    await initialSession.context.dispose()
  }
  return signIn(baseURL, username, password)
}

async function allPermissions(api: RealApi): Promise<PermissionView[]> {
  const result: PermissionView[] = []
  for (let page = 1; ; page += 1) {
    const data = await api.post<Page<PermissionView>>('app/permission/query', {
      page,
      pageSize: 20,
      filters: { status: 'ENABLED' },
      sort: [{ field: 'path', order: 'asc' }],
    })
    result.push(...data.items)
    if (result.length >= data.total) return result
  }
}

const bobReviewerActions = new Set([
  '/app/user/signout',
  '/app/user/query',
  '/acc/book/query',
  '/acc/book/get',
  '/acc/book/save',
  '/bob/customer/query',
  '/bob/customer/get',
  '/bob/customer/approve',
  '/bob/customer/reject',
  '/bob/customer/unapprove',
  '/bob/customer/enable',
  '/bob/customer/disable',
  '/bob/customer/versions',
  '/bob/customer/audit-history',
  '/bob/customer-account/approve',
  '/bob/customer-account/reject',
  '/bob/customer-account/enable',
  '/bob/customer-account/disable',
  ...[
    'employee',
    'supplier',
    'other-unit',
    'sales-partner',
    'product',
    'vehicle',
    'warehouse',
    'fund-account',
    'operating-entity',
  ].flatMap((entity) => [
    `/bob/${entity}/query`,
    `/bob/${entity}/get`,
    `/bob/${entity}/approve`,
  ]),
])

async function createEffectiveBob(
  operator: RealApi,
  reviewer: RealApi,
  entity: string,
  data: Record<string, unknown>,
): Promise<BobMutation> {
  const created = await operator.post<BobMutation>(`bob/${entity}/create`, {
    data,
  })
  const submitted = await operator.post<BobMutation>(`bob/${entity}/submit`, {
    objectId: created.objectId,
    versionId: created.versionId,
    revision: created.revision,
  })
  const approved = await reviewer.post<BobMutation>(`bob/${entity}/approve`, {
    objectId: submitted.objectId,
    versionId: submitted.versionId,
    revision: submitted.revision,
  })
  const view = await operator.post<{ code: string }>(`bob/${entity}/get`, {
    objectId: approved.objectId,
  })
  return { ...approved, code: view.code }
}

async function createEffectiveEmployment(
  operator: RealApi,
  reviewer: RealApi,
  name: string,
  operatingEntityId: string,
): Promise<BobMutation> {
  const created = await operator.post<BobMutation>('bob/employee/create', {
    newParty: { kind: 'PERSON', legalName: name, strongIdentifiers: [] },
    data: { operatingEntityId },
  })
  return approveBob(operator, reviewer, 'employee', created)
}

async function createEffectiveSupplier(
  operator: RealApi,
  reviewer: RealApi,
  name: string,
  operatingEntityId: string,
  settlementMethodId: string,
  purchaserObjectId: string,
): Promise<BobMutation> {
  const created = await operator.post<BobMutation>('bob/supplier/create', {
    newParty: {
      kind: 'ORGANIZATION',
      legalName: name,
      strongIdentifiers: [],
    },
    data: {
      operatingEntityId,
      settlementMethodId,
      defaultPurchaserEmployeeId: purchaserObjectId,
    },
  })
  return approveBob(operator, reviewer, 'supplier', created)
}

async function createEffectiveOtherUnit(
  operator: RealApi,
  reviewer: RealApi,
  name: string,
  operatingEntityId: string,
  settlementMethodId: string,
): Promise<BobMutation> {
  const created = await operator.post<BobMutation>('bob/other-unit/create', {
    newParty: {
      kind: 'ORGANIZATION',
      legalName: name,
      strongIdentifiers: [],
    },
    data: { operatingEntityId, settlementMethodId },
  })
  return approveBob(operator, reviewer, 'other-unit', created)
}

async function approveBob(
  operator: RealApi,
  reviewer: RealApi,
  entity: string,
  created: BobMutation,
): Promise<BobMutation> {
  const submitted = await operator.post<BobMutation>(`bob/${entity}/submit`, {
    objectId: created.objectId,
    versionId: created.versionId,
    revision: created.revision,
  })
  const approved = await reviewer.post<BobMutation>(`bob/${entity}/approve`, {
    objectId: submitted.objectId,
    versionId: submitted.versionId,
    revision: submitted.revision,
  })
  const view = await operator.post<{ code: string }>(`bob/${entity}/get`, {
    objectId: approved.objectId,
  })
  return { ...approved, code: view.code }
}

async function fixedSettlementMethod(
  operator: RealApi,
): Promise<Pick<BobMutation, 'objectId'>> {
  const page = await operator.post<Page<AuxQueryItem>>(
    'aux/settlement-method/query',
    {
      page: 1,
      pageSize: 20,
      filters: { enabled: true },
      sort: [{ field: 'code', order: 'asc' }],
    },
  )
  const item = page.items.find(
    (candidate) => candidate.currentVersion.data.termCode === 'MONTHLY_CURRENT',
  )
  if (!item) throw new Error('WFL 预置未找到系统固定当月结结算方式。')
  return { objectId: item.objectId }
}

async function fixedOperatingEntity(operator: RealApi): Promise<string> {
  const page = await operator.post<Page<BobReferenceQueryItem>>(
    'bob/operating-entity/query',
    {
      page: 1,
      pageSize: 20,
      filters: {
        status: ['EFFECTIVE'],
        enabled: true,
      },
      sort: [{ field: 'code', order: 'asc' }],
    },
  )
  const item = page.items[0]
  if (!item) throw new Error('WFL 预置未找到演示经营主体。')
  return item.objectId
}

async function createPaymentMethod(
  operator: RealApi,
  name: string,
): Promise<string> {
  const result = await operator.post<AuxMutation>('aux/payment-method/create', {
    data: { name, defaultSalesSurcharge: '0.00', description: 'E2E 测试' },
  })
  return result.objectId
}

async function createEffectiveCustomer(
  operator: RealApi,
  reviewer: RealApi,
  name: string,
  employeeObjectId: string,
  operatingEntityId: string,
  settlementMethodId: string,
  paymentMethodId: string,
): Promise<BobMutation> {
  const created = await operator.post<CustomerCreateMutation>(
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
        paymentMethodId,
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
  const account = created.defaultAccount
  const submitted = await operator.post<BobMutation>(
    'bob/customer-account/submit',
    {
      objectId: account.objectId,
      versionId: account.candidate.version.versionId,
      revision: account.candidate.version.revision,
    },
  )
  const approved = await reviewer.post<BobMutation>(
    'bob/customer-account/approve',
    {
      objectId: submitted.objectId,
      versionId: submitted.versionId,
      revision: submitted.revision,
    },
  )
  return { ...approved, code: account.code }
}

function workflowScript(options: {
  code: string
  name: string
  rootEntity: 'purchase-order' | 'sale-order'
  rootName: string
  childEntity: 'purchase-inbound' | 'sale-outbound'
  childName: string
  action: 'purchase_inbound' | 'sale_outbound'
  warehouseObjectId: string
  partyField: 'supplier' | 'customer'
  partyObjectId: string
}): string {
  return `root = node(key="order", name="${options.rootName}", entity="${options.rootEntity}")
child = node(key="fulfillment", name="${options.childName}", entity="${options.childEntity}")
workflow(code="${options.code}", name="${options.name}", root=root, when=lambda source: source["data"]["${options.partyField}"]["objectId"] == "${options.partyObjectId}", edges=[
  edge(source=root, target=child, relation="fulfillment", action=${options.action}(initial=lambda source: {
    "warehouseObjectId": "${options.warehouseObjectId}",
    "businessDate": source["data"]["businessDate"],
    "lines": [{"sourceLineId": line["lineId"], "baseQuantity": line["baseQuantity"]} for line in source["data"]["productLines"]],
  })),
])`
}

async function createEnabledWorkflowDefinition(
  operator: RealApi,
  options: {
    code: string
    name: string
    script: string
    trialSource: { entity: 'purchase-order' | 'sale-order'; documentId: string }
  },
): Promise<WflDefinitionView> {
  const created = await operator.post<WflDefinitionView>(
    'wfl/process-definition/create',
    { script: options.script },
  )
  if (created.status !== 'DRAFT') {
    throw new Error(`WFL 预置流程定义 ${options.code} 未以草稿创建。`)
  }
  const edited = await operator.post<WflDefinitionView>(
    'wfl/process-definition/save',
    {
      definitionId: created.definitionId,
      revision: created.revision,
      script: `${options.script}\n`,
    },
  )
  const trial = await operator.post<{
    matched: boolean
    plannedActions: unknown[]
  }>('wfl/process-definition/trial', {
    definitionId: edited.definitionId,
    revision: edited.revision,
    source: options.trialSource,
  })
  if (!trial.matched || trial.plannedActions.length !== 1) {
    throw new Error(`WFL 预置流程定义 ${options.code} 试算未生成预期动作。`)
  }
  const published = await operator.post<WflDefinitionView>(
    'wfl/process-definition/publish',
    { definitionId: edited.definitionId, revision: edited.revision },
  )
  if (!published.publishedRevision) {
    throw new Error(`WFL 预置流程定义 ${options.code} 未发布。`)
  }
  const enabled = await operator.post<WflDefinitionView>(
    'wfl/process-definition/enable',
    { definitionId: published.definitionId, revision: published.revision },
  )
  if (enabled.status !== 'ENABLED') {
    throw new Error(`WFL 预置流程定义 ${options.code} 未启用。`)
  }
  return enabled
}

async function createWorkflowTrialOrder(
  operator: RealApi,
  entity: 'purchase-order' | 'sale-order',
  references: {
    customer: BobMutation
    supplier: BobMutation
    employee: BobMutation
    warehouse: BobMutation
    product: BobMutation
    quantity?: string
  },
): Promise<VouMutation> {
  const reference = (value: BobMutation) => ({
    objectId: value.objectId,
    versionId: value.versionId,
  })
  const data = {
    businessDate: new Date().toISOString().slice(0, 10),
    currency: 'CNY',
    ...(entity === 'purchase-order'
      ? {
          supplier: reference(references.supplier),
          purchaser: reference(references.employee),
        }
      : {
          customer: reference(references.customer),
          salesperson: reference(references.employee),
        }),
    warehouse: reference(references.warehouse),
    productLines: [
      {
        product: { objectId: references.product.objectId },
        enteredQuantity: references.quantity ?? '1',
        enteredUnit: { objectId: '01JAVX00000000000000000011' },
        baseQuantity: references.quantity ?? '1',
        unitPrice: '1.00',
      },
    ],
  }
  return operator.post<VouMutation>(`vou/${entity}/create`, { data })
}

async function addWorkflowPermissionsToOperatorRole(
  bootstrap: RealApi,
  operatorRole: RoleView,
  processCodes: string[],
): Promise<void> {
  const paths = new Set(
    processCodes.flatMap((code) => [
      `/wfl/${code}/query`,
      `/wfl/${code}/get`,
      `/wfl/${code}/audit-history`,
      `/wfl/${code}/create-child`,
    ]),
  )
  const dynamicPermissionIds = (await allPermissions(bootstrap))
    .filter((permission) => paths.has(permission.path))
    .map((permission) => permission.id)
  if (dynamicPermissionIds.length !== paths.size) {
    throw new Error('WFL 预置流程未生成完整动态权限。')
  }
  await bootstrap.post<RoleView>('app/role/save', {
    id: operatorRole.id,
    name: operatorRole.name,
    description: operatorRole.description,
    permissionIds: [
      ...new Set([
        ...operatorRole.permissions.map((permission) => permission.id),
        ...dynamicPermissionIds,
      ]),
    ],
    revision: operatorRole.revision,
  })
}

async function grantWorkflowPermissionsToRole(
  baseURL: string,
  bootstrap: E2ECredentials,
  roleId: string,
  processCodes: string[],
): Promise<void> {
  const session = await signIn(baseURL, bootstrap.username, bootstrap.password)
  try {
    const role = await session.api.post<RoleView>('app/role/get', {
      id: roleId,
    })
    await addWorkflowPermissionsToOperatorRole(session.api, role, processCodes)
  } finally {
    await session.context.dispose()
  }
}

async function seedInventoryThroughLifecycle(
  operator: RealApi,
  processCode: string,
  supplier: BobMutation,
  purchaser: BobMutation,
  warehouse: BobMutation,
  product: BobMutation,
): Promise<void> {
  const order = await createWorkflowTrialOrder(operator, 'purchase-order', {
    customer: supplier,
    supplier,
    employee: purchaser,
    warehouse,
    product,
    quantity: '1000',
  })
  const checkedOrder = await operator.post<VouMutation>(
    'vou/purchase-order/check',
    { documentId: order.documentId, revision: order.revision },
  )
  await operator.post<VouMutation>('vou/purchase-order/approve', {
    documentId: checkedOrder.documentId,
    revision: checkedOrder.revision,
  })
  const processes = await operator.post<Page<WflInstanceListItem>>(
    `wfl/${processCode}/query`,
    { page: 1, pageSize: 20, keyword: order.documentNo },
  )
  const process = processes.items.find(
    (item) => item.rootDocumentId === order.documentId,
  )
  if (!process) {
    throw new Error('WFL 库存预置未取得采购流程实例。')
  }
  const instance = await operator.post<WflInstanceView>(
    `wfl/${processCode}/get`,
    { processId: process.processId },
  )
  const inbound = instance.nodes.find(
    (node) => node.documentEntity === 'purchase-inbound',
  )
  if (!inbound) {
    throw new Error('WFL 库存预置未取得采购入库节点。')
  }
  const checkedInbound = await operator.post<VouMutation>(
    'vou/purchase-inbound/check',
    { documentId: inbound.documentId, revision: inbound.documentRevision },
  )
  await operator.post<VouMutation>('vou/purchase-inbound/approve', {
    documentId: checkedInbound.documentId,
    revision: checkedInbound.revision,
  })
}

async function ensureAccountingControlBook(
  api: RealApi,
  queryUserIds: string[],
  operateUserIds: string[],
  vouEntities: string[],
): Promise<void> {
  const books = await api.post<Page<AccountingBookView>>('acc/book/query', {
    page: 1,
    pageSize: 200,
  })
  let book = books.items.find((item) => item.controlBook)
  if (!book) {
    book = await api.post<AccountingBookView>('acc/book/create', {
      name: 'E2E 控制账簿',
      description: '隔离 E2E 显式会计前置配置',
      startMonth: new Date().toISOString().slice(0, 7),
      baseCurrency: 'CNY',
      subjectTemplate: 'ENTERPRISE',
      queryUserIds,
      operateUserIds,
    })
  } else {
    book = await api.post<AccountingBookView>('acc/book/get', {
      bookId: book.bookId,
    })
    const nextQueryUserIds = [
      ...new Set([...book.queryUserIds, ...queryUserIds]),
    ]
    const nextOperateUserIds = [
      ...new Set([...book.operateUserIds, ...operateUserIds]),
    ]
    if (
      nextQueryUserIds.length !== book.queryUserIds.length ||
      nextOperateUserIds.length !== book.operateUserIds.length
    ) {
      book = await api.post<AccountingBookView>('acc/book/save', {
        bookId: book.bookId,
        name: book.name,
        description: book.description,
        baseCurrency: book.baseCurrency,
        revision: book.revision,
        queryUserIds: nextQueryUserIds,
        operateUserIds: nextOperateUserIds,
      })
    }
  }

  const opening = await api.post<AccountingOpeningView>('acc/opening/query', {
    bookId: book.bookId,
  })
  if (opening.state === 'DRAFT') {
    await api.post<AccountingOpeningView>('acc/opening/approve', {
      bookId: book.bookId,
      revision: opening.revision,
    })
  }

  const subjects = await api.post<Page<AccountingSubjectView>>(
    'acc/subject/query',
    { bookId: book.bookId, page: 1, pageSize: 200 },
  )
  const subjectIdByCode = new Map(
    subjects.items.map((subject) => [subject.code, subject.subjectId]),
  )
  for (const subject of [
    {
      code: '600199',
      name: 'E2E 销售收入',
      parentCode: '6001',
      balanceDirection: 'CREDIT',
    },
    {
      code: '660199',
      name: 'E2E 居间销售费用',
      parentCode: '6601',
      balanceDirection: 'DEBIT',
    },
  ]) {
    if (subjectIdByCode.has(subject.code)) continue
    const created = await api.post<AccountingSubjectView>(
      'acc/subject/create',
      {
        bookId: book.bookId,
        code: subject.code,
        name: subject.name,
        parentSubjectId: subjectIdByCode.get(subject.parentCode),
        balanceDirection: subject.balanceDirection,
        enabled: true,
        requiredDimensions: [],
        inventoryQuantity: false,
        settlementPurpose: 'NONE',
      },
    )
    subjectIdByCode.set(created.code, created.subjectId)
  }

  for (const vouEntity of vouEntities) {
    const mappings = await api.post<Page<AccountingMappingView>>(
      'acc/mapping/query',
      { bookId: book.bookId, vouEntity, page: 1, pageSize: 200 },
    )
    if (mappings.items.some((item) => item.state === 'APPROVED')) continue
    const inventorySubjectId = subjectIdByCode.get('1405')
    const payableSubjectId = subjectIdByCode.get('2202')
    if (
      vouEntity === 'purchase-inbound' &&
      (!inventorySubjectId || !payableSubjectId)
    ) {
      throw new Error('ACC E2E inventory subjects are missing.')
    }
    const purchaseInboundTemplate = {
      defaultTemplateId: 'e2e-purchase-inbound',
      rules: [],
      templates: [
        {
          templateId: 'e2e-purchase-inbound',
          collection: 'productLines',
          lines: [
            {
              subjectSource: 'FIXED',
              subjectValue: inventorySubjectId,
              direction: 'DEBIT',
              amountField: 'lineAmount',
              currencyField: 'currency',
              dimensions: {
                PRODUCT: 'product.objectId',
                WAREHOUSE: 'warehouse.objectId',
              },
              quantityField: 'baseQuantity',
              costCounterpartSubjectId: null,
              costCounterpartDimensions: {},
            },
            {
              subjectSource: 'FIXED',
              subjectValue: payableSubjectId,
              direction: 'CREDIT',
              amountField: 'lineAmount',
              currencyField: 'currency',
              dimensions: { SUPPLIER_RELATIONSHIP: 'supplier.objectId' },
              quantityField: null,
              costCounterpartSubjectId: null,
              costCounterpartDimensions: {},
            },
          ],
        },
      ],
    }
    const saleSignoffTemplate = {
      defaultTemplateId: 'e2e-sale-signoff',
      rules: [],
      templates: [
        {
          templateId: 'e2e-sale-signoff',
          collection: 'signoffLines',
          lines: [
            {
              subjectSource: 'FIXED',
              subjectValue: subjectIdByCode.get('1122'),
              direction: 'DEBIT',
              amountField: 'lineAmount',
              currencyField: 'currency',
              dimensions: { CUSTOMER_ACCOUNT: 'customer.objectId' },
              quantityField: null,
              costCounterpartSubjectId: null,
              costCounterpartDimensions: {},
            },
            {
              subjectSource: 'FIXED',
              subjectValue: subjectIdByCode.get('600199'),
              direction: 'CREDIT',
              amountField: 'lineAmount',
              currencyField: 'currency',
              dimensions: {},
              quantityField: null,
              costCounterpartSubjectId: null,
              costCounterpartDimensions: {},
            },
          ],
        },
      ],
    }
    const salesReceiptTemplate = {
      defaultTemplateId: 'e2e-sales-receipt',
      rules: [],
      templates: [
        {
          templateId: 'e2e-sales-receipt',
          collection: null,
          lines: [
            {
              subjectSource: 'FIXED',
              subjectValue: subjectIdByCode.get('1002'),
              direction: 'DEBIT',
              amountField: 'amount',
              currencyField: 'currency',
              dimensions: { FUND_ACCOUNT: 'fundAccount.objectId' },
              quantityField: null,
              costCounterpartSubjectId: null,
              costCounterpartDimensions: {},
            },
            {
              subjectSource: 'FIXED',
              subjectValue: subjectIdByCode.get('1122'),
              direction: 'CREDIT',
              amountField: 'amount',
              currencyField: 'currency',
              dimensions: { CUSTOMER_ACCOUNT: 'counterparty.objectId' },
              quantityField: null,
              costCounterpartSubjectId: null,
              costCounterpartDimensions: {},
            },
          ],
        },
      ],
    }
    const intermediaryTemplate = {
      defaultTemplateId: 'e2e-intermediary-sales-partner-payable',
      rules: [],
      templates: [
        {
          templateId: 'e2e-intermediary-sales-partner-payable',
          collection: 'intermediarySalesPartnerPayables',
          lines: [
            {
              subjectSource: 'FIXED',
              subjectValue: subjectIdByCode.get('660199'),
              direction: 'DEBIT',
              amountField: 'amount',
              currencyField: 'currency',
              dimensions: {},
              quantityField: null,
              costCounterpartSubjectId: null,
              costCounterpartDimensions: {},
            },
            {
              subjectSource: 'FIXED',
              subjectValue: subjectIdByCode.get('2241'),
              direction: 'CREDIT',
              amountField: 'amount',
              currencyField: 'currency',
              dimensions: {
                SALES_RELATIONSHIP: 'payee.objectId',
              },
              quantityField: null,
              costCounterpartSubjectId: null,
              costCounterpartDimensions: {},
            },
          ],
        },
      ],
    }
    const postDefinitions: Readonly<Record<string, unknown>> = {
      'purchase-inbound': purchaseInboundTemplate,
      'sale-signoff': saleSignoffTemplate,
      'sales-receipt': salesReceiptTemplate,
      'intermediary-calculation': intermediaryTemplate,
    }
    const definition = postDefinitions[vouEntity] ?? {
      defaultTemplateId: null,
      rules: [],
      templates: [],
    }
    const defaultResult = vouEntity in postDefinitions ? 'POST' : 'UN_POST'
    const draft =
      mappings.items.find((item) => item.state === 'DRAFT') ??
      (await api.post<AccountingMappingView>('acc/mapping/create', {
        bookId: book.bookId,
        vouEntity,
        defaultResult,
        definition,
      }))
    await api.post<AccountingMappingView>('acc/mapping/approve', {
      bookId: book.bookId,
      mappingId: draft.mappingId,
      revision: draft.revision,
    })
  }
}

async function withLedgerProvisioningLock<T>(
  work: () => Promise<T>,
): Promise<T> {
  const runId = (process.env.E2E_RUN_ID ?? 'local').replaceAll(
    /[^A-Za-z0-9_-]/g,
    '_',
  )
  const lockDirectory = join(tmpdir(), `zerp-e2e-ledger-${runId}.lock`)
  const deadline = Date.now() + 120_000
  for (;;) {
    try {
      await mkdir(lockDirectory)
      break
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error
      }
      if (Date.now() >= deadline) {
        throw new Error('等待 E2E 共享账本初始化锁超时。', {
          cause: error,
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  try {
    return await work()
  } finally {
    await rmdir(lockDirectory)
  }
}

export async function createWflWorkerState(options: {
  baseURL: string
  bootstrap: E2ECredentials
  parallelIndex: number
}): Promise<WflWorkerState> {
  const bootstrapSession = await signIn(
    options.baseURL,
    options.bootstrap.username,
    options.bootstrap.password,
  )
  const contexts: APIRequestContext[] = [bootstrapSession.context]
  try {
    const permissions = await allPermissions(bootstrapSession.api)
    const enabledPermissions = permissions.filter(
      (item) => item.status === 'ENABLED',
    )
    const selectedReviewerPermissions = enabledPermissions.filter(
      (item) => item.status === 'ENABLED' && bobReviewerActions.has(item.path),
    )

    const suffix =
      `${options.parallelIndex.toString(36)}${Date.now().toString(36)}${randomBytes(2).toString('hex')}`.toUpperCase()
    const operatorInitialPassword = `Wfl!${randomBytes(12).toString('base64url')}Aa1`
    const operatorPassword = `Wfl!${randomBytes(12).toString('base64url')}Bb2`
    const reviewerInitialPassword = `Wfl!${randomBytes(12).toString('base64url')}Aa1`
    const reviewerPassword = `Wfl!${randomBytes(12).toString('base64url')}Bb2`
    const operatorRole = await bootstrapSession.api.post<RoleView>(
      'app/role/create',
      {
        name: `E2E Operator ${suffix}`,
        description: '隔离测试 worker 全权限操作角色',
        permissionIds: enabledPermissions.map((item) => item.id),
      },
    )
    const operatorUsername = `e2e-operator-${suffix}`.toLowerCase()
    const operatorUser = await bootstrapSession.api.post<UserView>(
      'app/user/create',
      {
        username: operatorUsername,
        displayName: `E2E 操作员 ${suffix}`,
        password: operatorInitialPassword,
        roleIds: [operatorRole.id],
      },
    )
    const operatorSession = await signInAfterForcedPasswordChange(
      options.baseURL,
      operatorUsername,
      operatorInitialPassword,
      operatorPassword,
    )
    contexts.push(operatorSession.context)

    const reviewerRole = await bootstrapSession.api.post<RoleView>(
      'app/role/create',
      {
        name: `E2E WFL ${suffix}`,
        description: '隔离测试临时精确权限角色',
        permissionIds: selectedReviewerPermissions.map((item) => item.id),
      },
    )
    const reviewerUsername = `e2e-wfl-${suffix}`.toLowerCase()
    const reviewerUser = await bootstrapSession.api.post<UserView>(
      'app/user/create',
      {
        username: reviewerUsername,
        displayName: `E2E WFL 复核 ${suffix}`,
        password: reviewerInitialPassword,
        roleIds: [reviewerRole.id],
      },
    )
    const reviewerSession = await signInAfterForcedPasswordChange(
      options.baseURL,
      reviewerUsername,
      reviewerInitialPassword,
      reviewerPassword,
    )
    contexts.push(reviewerSession.context)

    const settlement = await fixedSettlementMethod(operatorSession.api)
    const operatingEntityId = await fixedOperatingEntity(operatorSession.api)
    const employee = await createEffectiveEmployment(
      operatorSession.api,
      reviewerSession.api,
      `WFL 员工 ${suffix}`,
      operatingEntityId,
    )
    const employeeReferences = await operatorSession.api.post<
      BobReferenceQueryItem[]
    >('bob/reference/query', {
      entity: 'employee',
      keyword: employee.code,
    })
    if (
      !employeeReferences.some((item) => item.objectId === employee.objectId)
    ) {
      throw new Error(`WFL 预置员工 ${employee.code} 未进入雇佣关系引用候选。`)
    }
    const paymentMethodId = await createPaymentMethod(
      operatorSession.api,
      `WFL 银行转账 ${suffix}`,
    )
    const customer = await createEffectiveCustomer(
      operatorSession.api,
      reviewerSession.api,
      `WFL 客户 ${suffix}`,
      employee.objectId,
      operatingEntityId,
      settlement.objectId,
      paymentMethodId,
    )
    const supplier = await createEffectiveSupplier(
      operatorSession.api,
      reviewerSession.api,
      `WFL 普通供应商 ${suffix}`,
      operatingEntityId,
      settlement.objectId,
      employee.objectId,
    )
    const carrier = await createEffectiveOtherUnit(
      operatorSession.api,
      reviewerSession.api,
      `WFL 物流服务单位 ${suffix}`,
      operatingEntityId,
      settlement.objectId,
    )
    const solventProduct = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'product',
      {
        name: `WFL 溶剂桶产品 ${suffix}`,
        productTypeId: '01JPTP00000000000000000001',
        defaultInputUnitId: '01JAVX00000000000000000011',
        pricingUnitId: '01JAVX00000000000000000011',
        unitConversions: [
          { unit: { objectId: '01JAVX00000000000000000011' }, factor: '1' },
        ],
        defaultPackagingSpec: '1',
      },
    )
    const resinProduct = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'product',
      {
        name: `WFL 树脂桶产品 ${suffix}`,
        productTypeId: '01JPTP00000000000000000001',
        defaultInputUnitId: '01JAVX00000000000000000011',
        pricingUnitId: '01JAVX00000000000000000011',
        unitConversions: [
          { unit: { objectId: '01JAVX00000000000000000011' }, factor: '1' },
        ],
        defaultPackagingSpec: '1',
      },
    )
    const vehicle = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'vehicle',
      {
        name: `WFL 测试车辆 ${suffix}`,
        plateNumber: `E2E-${suffix.slice(-8)}`,
        vehicleType: 'DIT-0003',
        carrierAffiliation: {
          type: 'EXTERNAL',
          serviceRelationshipObjectId: carrier.objectId,
        },
      },
    )
    const warehouse = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'warehouse',
      {
        name: `WFL 测试仓库 ${suffix}`,
      },
    )
    const fundAccount = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'fund-account',
      {
        name: `WFL 测试资金账户 ${suffix}`,
        currency: 'CNY',
        operatingEntityId,
      },
    )

    const purchaseProcessCode = `e2e-purchase-${suffix}`.toLowerCase()
    const salesProcessCode = `e2e-sales-${suffix}`.toLowerCase()
    const trialReferences = {
      customer,
      supplier,
      employee,
      warehouse,
      product: solventProduct,
    }
    const purchaseTrial = await createWorkflowTrialOrder(
      operatorSession.api,
      'purchase-order',
      trialReferences,
    )
    const salesTrial = await createWorkflowTrialOrder(
      operatorSession.api,
      'sale-order',
      trialReferences,
    )
    await createEnabledWorkflowDefinition(operatorSession.api, {
      code: purchaseProcessCode,
      name: purchaseProcessCode,
      script: workflowScript({
        code: purchaseProcessCode,
        name: purchaseProcessCode,
        rootEntity: 'purchase-order',
        rootName: '采购订单',
        childEntity: 'purchase-inbound',
        childName: '采购入库',
        action: 'purchase_inbound',
        warehouseObjectId: warehouse.objectId,
        partyField: 'supplier',
        partyObjectId: supplier.objectId,
      }),
      trialSource: {
        entity: 'purchase-order',
        documentId: purchaseTrial.documentId,
      },
    })
    await createEnabledWorkflowDefinition(operatorSession.api, {
      code: salesProcessCode,
      name: salesProcessCode,
      script: workflowScript({
        code: salesProcessCode,
        name: salesProcessCode,
        rootEntity: 'sale-order',
        rootName: '销售订单',
        childEntity: 'sale-outbound',
        childName: '销售出库',
        action: 'sale_outbound',
        warehouseObjectId: warehouse.objectId,
        partyField: 'customer',
        partyObjectId: customer.objectId,
      }),
      trialSource: {
        entity: 'sale-order',
        documentId: salesTrial.documentId,
      },
    })
    await addWorkflowPermissionsToOperatorRole(
      bootstrapSession.api,
      operatorRole,
      [purchaseProcessCode, salesProcessCode],
    )

    await withLedgerProvisioningLock(async () => {
      const vouEntities = enabledPermissions
        .map(
          (permission) =>
            /^\/vou\/([^/]+)\/approve$/.exec(permission.path)?.[1],
        )
        .filter(
          (entity): entity is string =>
            Boolean(entity) && accMappingEntities.has(entity ?? ''),
        )
      await ensureAccountingControlBook(
        bootstrapSession.api,
        [operatorUser.id, reviewerUser.id],
        [operatorUser.id, reviewerUser.id],
        vouEntities,
      )
      await seedInventoryThroughLifecycle(
        operatorSession.api,
        purchaseProcessCode,
        supplier,
        employee,
        warehouse,
        solventProduct,
      )
    })

    return {
      operator: {
        username: operatorUsername,
        password: operatorPassword,
      },
      reviewer: {
        username: reviewerUsername,
        password: reviewerPassword,
      },
      fixtures: {
        customer: customer.code,
        supplier: supplier.code,
        employee: employee.code,
        solventProduct: solventProduct.code,
        resinProduct: resinProduct.code,
        carrier: carrier.code,
        vehicle: vehicle.code,
        warehouse: warehouse.code,
        fundAccount: fundAccount.code,
        purchaseProcessCode,
        salesProcessCode,
        purchaseTrialDocumentId: purchaseTrial.documentId,
        supplierObjectId: supplier.objectId,
        warehouseObjectId: warehouse.objectId,
      },
      storageState: await operatorSession.context.storageState(),
      grantWorkflowPermissions: (processCodes) =>
        grantWorkflowPermissionsToRole(
          options.baseURL,
          options.bootstrap,
          operatorRole.id,
          processCodes,
        ),
    }
  } finally {
    await Promise.all(contexts.map((context) => context.dispose()))
  }
}
