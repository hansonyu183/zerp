import { randomBytes } from 'node:crypto'
import { mkdir, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request, type APIRequestContext } from '@playwright/test'
import type {
  DclEmployeeCreateRequest,
  DclOtherUnitCreateRequest,
  DclSalesPartnerCreateRequest,
  DclSupplierCreateRequest,
} from '../../src/api/generated'

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
  approval: {
    status: 'DRAFT' | 'PENDING' | 'APPROVED'
    revision: number
  }
}

interface AccountingSubjectView {
  subjectId: string
  code: string
}

interface AccountingMappingView {
  bookId: string
  vouEntity: string
  approval: {
    approvalEntryId: string
    status: 'DRAFT' | 'PENDING' | 'APPROVED'
    revision: number
  }
}

interface BobMutation {
  objectId: string
  customerObjectId?: string
  customerCode?: string
  customerLookup?: string
  enabled: boolean
  approval: {
    approvalEntryId: string
    revision: number
  }
  code: string
}

interface AuxQueryItem {
  objectId: string
  data: { termCode?: string }
}

interface BobReferenceQueryItem {
  objectId: string
  customerId?: string
  approvalEntryId?: string
  code?: string
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
  objectRevision: number
  enabled: boolean
}

interface VouMutation {
  documentId: string
  documentNo?: string
  approval: {
    approvalEntryId: string
    revision: number
  }
}

interface WflDefinitionView {
  definitionId: string
  code: string
  enabled: boolean
  approval: {
    approvalEntryId: string
    status: 'DRAFT' | 'PENDING' | 'APPROVED'
    revision: number
  }
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
  customerAggregate: string
  supplier: string
  employee: string
  salesPartner: string
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
  operatingEntityId: string
  operatingEntity: string
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

export async function approveVouAsReviewer(
  baseURL: string,
  credentials: E2ECredentials,
  entity: string,
  documentId: string,
  revision: number,
): Promise<void> {
  const session = await signIn(
    baseURL,
    credentials.username,
    credentials.password,
  )
  try {
    await session.api.post<VouMutation>(`vou/${entity}/approve`, {
      documentId,
      revision,
    })
  } finally {
    await session.context.dispose()
  }
}

export async function approveWorkflowDefinitionAsReviewer(
  baseURL: string,
  credentials: E2ECredentials,
  definition: {
    code: string
    approvalEntryId: string
    revision: number
  },
): Promise<void> {
  const session = await signIn(
    baseURL,
    credentials.username,
    credentials.password,
  )
  try {
    await session.api.post<WflDefinitionView>(
      'dcl/wfl-process-definition/approve',
      {
        code: definition.code,
        approvalEntryId: definition.approvalEntryId,
        approvalRevision: definition.revision,
      },
    )
  } finally {
    await session.context.dispose()
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
  '/acc/opening/query',
  '/acc/opening/approve',
  '/acc/opening/reject',
  '/acc/subject/query',
  '/dcl/acc-mapping/approve',
  '/dcl/wfl-process-definition/approve',
  '/bob/customer/query',
  '/bob/customer/get',
  ...[
    'employee',
    'supplier',
    'other-unit',
    'sales-partner',
    'customer',
  ].flatMap((entity) => [
    `/dcl/${entity}/query`,
    `/dcl/${entity}/get`,
    `/dcl/${entity}/approve`,
    `/dcl/${entity}/reject`,
    `/dcl/${entity}/unapprove`,
    `/dcl/${entity}/versions`,
    `/dcl/${entity}/audit-history`,
  ]),
  ...['employee', 'supplier', 'other-unit', 'sales-partner'].flatMap(
    (entity) => [`/bob/${entity}/query`, `/bob/${entity}/get`],
  ),
  '/bob/operating-entity/query',
  '/bob/operating-entity/get',
  '/dcl/operating-entity/query',
  '/dcl/operating-entity/get',
  '/dcl/operating-entity/approve',
  '/dcl/operating-entity/reject',
  '/dcl/warehouse/query',
  '/dcl/warehouse/get',
  '/dcl/warehouse/approve',
  '/dcl/vehicle/query',
  '/dcl/vehicle/get',
  '/dcl/vehicle/approve',
  '/dcl/fund-account/query',
  '/dcl/fund-account/get',
  '/dcl/fund-account/approve',
  '/dcl/product/query',
  '/dcl/product/get',
  '/dcl/product/approve',
])

async function assertBobReference(
  operator: RealApi,
  entity: 'employee' | 'supplier' | 'other-unit' | 'sales-partner',
  record: Pick<BobMutation, 'objectId' | 'code'>,
): Promise<void> {
  const candidates = await operator.post<BobReferenceQueryItem[]>(
    'bob/reference/query',
    { entity, keyword: record.code },
  )
  if (!candidates.some((candidate) => candidate.objectId === record.objectId)) {
    throw new Error(`${entity} 批准后未进入 BOB 引用候选。`)
  }
}

async function createEffectiveBob(
  operator: RealApi,
  reviewer: RealApi,
  entity: string,
  data: Record<string, unknown>,
): Promise<BobMutation> {
  if (
    entity === 'operating-entity' ||
    entity === 'warehouse' ||
    entity === 'vehicle' ||
    entity === 'fund-account' ||
    entity === 'product'
  ) {
    const declarationData =
      entity === 'product'
        ? {
            categoryId: null,
            specification: null,
            model: null,
            barcode: null,
            remark: null,
            returnable: false,
            defaultPackagingSpec: null,
            formula: null,
            ...data,
          }
        : data
    const created = await operator.post<BobMutation>(`dcl/${entity}/create`, {
      data: declarationData,
    })
    const submitted = await operator.post<BobMutation>(`dcl/${entity}/submit`, {
      objectId: created.objectId,
      approvalEntryId: created.approval.approvalEntryId,
      approvalRevision: created.approval.revision,
    })
    const approved = await reviewer.post<BobMutation>(`dcl/${entity}/approve`, {
      objectId: submitted.objectId,
      approvalEntryId: submitted.approval.approvalEntryId,
      approvalRevision: submitted.approval.revision,
    })
    const view = await operator.post<{ code: string }>(`dcl/${entity}/get`, {
      objectId: approved.objectId,
      approvalEntryId: approved.approval.approvalEntryId,
    })
    return { ...approved, code: view.code }
  }
  throw new Error(`Unsupported DCL seed entity: ${entity}`)
}

async function createEffectiveEmployment(
  operator: RealApi,
  reviewer: RealApi,
  name: string,
  operatingEntityId: string,
): Promise<BobMutation> {
  const request: DclEmployeeCreateRequest = {
    data: {
      kind: 'PERSON',
      legalName: name,
      displayName: name,
      strongIdentifiers: [],
      enabled: true,
      currentOperatingEntityId: operatingEntityId,
    },
  }
  const created = await operator.post<BobMutation>(
    'dcl/employee/create',
    request,
  )
  const submitted = await operator.post<BobMutation>('dcl/employee/submit', {
    objectId: created.objectId,
    approvalEntryId: created.approval.approvalEntryId,
    approvalRevision: created.approval.revision,
  })
  const approved = await reviewer.post<BobMutation>('dcl/employee/approve', {
    objectId: submitted.objectId,
    approvalEntryId: submitted.approval.approvalEntryId,
    approvalRevision: submitted.approval.revision,
  })
  const view = await operator.post<{ code: string }>('bob/employee/get', {
    objectId: approved.objectId,
  })
  const record = { ...approved, code: view.code }
  await assertBobReference(operator, 'employee', record)
  return record
}

async function createEffectiveSupplier(
  operator: RealApi,
  reviewer: RealApi,
  name: string,
  operatingEntityId: string,
  settlementMethodId: string,
  purchaserObjectId: string,
): Promise<BobMutation> {
  const request: DclSupplierCreateRequest = {
    data: {
      kind: 'ORGANIZATION',
      legalName: name,
      displayName: name,
      strongIdentifiers: [],
      enabled: true,
      operatingEntityIds: [operatingEntityId],
      defaultOperatingEntityId: operatingEntityId,
      settlementMethodId,
      defaultPurchaserEmployeeId: purchaserObjectId,
    },
  }
  const created = await operator.post<BobMutation>(
    'dcl/supplier/create',
    request,
  )
  const submitted = await operator.post<BobMutation>('dcl/supplier/submit', {
    objectId: created.objectId,
    approvalEntryId: created.approval.approvalEntryId,
    approvalRevision: created.approval.revision,
  })
  const approved = await reviewer.post<BobMutation>('dcl/supplier/approve', {
    objectId: submitted.objectId,
    approvalEntryId: submitted.approval.approvalEntryId,
    approvalRevision: submitted.approval.revision,
  })
  const view = await operator.post<{ code: string }>('bob/supplier/get', {
    objectId: approved.objectId,
  })
  const record = { ...approved, code: view.code }
  await assertBobReference(operator, 'supplier', record)
  return record
}

async function createEffectiveOtherUnit(
  operator: RealApi,
  reviewer: RealApi,
  name: string,
  operatingEntityId: string,
  settlementMethodId: string,
): Promise<BobMutation> {
  const request: DclOtherUnitCreateRequest = {
    data: {
      kind: 'ORGANIZATION',
      legalName: name,
      displayName: name,
      strongIdentifiers: [],
      enabled: true,
      operatingEntityIds: [operatingEntityId],
      defaultOperatingEntityId: operatingEntityId,
      settlementMethodId,
    },
  }
  const created = await operator.post<BobMutation>(
    'dcl/other-unit/create',
    request,
  )
  const submitted = await operator.post<BobMutation>('dcl/other-unit/submit', {
    objectId: created.objectId,
    approvalEntryId: created.approval.approvalEntryId,
    approvalRevision: created.approval.revision,
  })
  const approved = await reviewer.post<BobMutation>('dcl/other-unit/approve', {
    objectId: submitted.objectId,
    approvalEntryId: submitted.approval.approvalEntryId,
    approvalRevision: submitted.approval.revision,
  })
  const view = await operator.post<{ code: string }>('bob/other-unit/get', {
    objectId: approved.objectId,
  })
  const record = { ...approved, code: view.code }
  await assertBobReference(operator, 'other-unit', record)
  return record
}

async function createEffectiveSalesPartner(
  operator: RealApi,
  reviewer: RealApi,
  name: string,
  operatingEntityId: string,
): Promise<BobMutation> {
  const request: DclSalesPartnerCreateRequest = {
    data: {
      kind: 'ORGANIZATION',
      legalName: name,
      displayName: name,
      strongIdentifiers: [],
      enabled: true,
      operatingEntityIds: [operatingEntityId],
      defaultOperatingEntityId: operatingEntityId,
      capabilities: ['EXTERNAL_PART_TIME'],
    },
  }
  const created = await operator.post<BobMutation>(
    'dcl/sales-partner/create',
    request,
  )
  const submitted = await operator.post<BobMutation>(
    'dcl/sales-partner/submit',
    {
      objectId: created.objectId,
      approvalEntryId: created.approval.approvalEntryId,
      approvalRevision: created.approval.revision,
    },
  )
  const approved = await reviewer.post<BobMutation>(
    'dcl/sales-partner/approve',
    {
      objectId: submitted.objectId,
      approvalEntryId: submitted.approval.approvalEntryId,
      approvalRevision: submitted.approval.revision,
    },
  )
  const view = await operator.post<{ code: string }>('bob/sales-partner/get', {
    objectId: approved.objectId,
  })
  const record = { ...approved, code: view.code }
  await assertBobReference(operator, 'sales-partner', record)
  return record
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
    (candidate) => candidate.data.termCode === 'MONTHLY_CURRENT',
  )
  if (!item) throw new Error('WFL 预置未找到系统固定当月结结算方式。')
  return { objectId: item.objectId }
}

async function fixedOperatingEntity(
  operator: RealApi,
): Promise<{ objectId: string; code: string }> {
  const page = await operator.post<Page<BobReferenceQueryItem>>(
    'bob/operating-entity/query',
    {
      page: 1,
      pageSize: 20,
      filters: {
        enabled: true,
      },
      sort: [{ field: 'code', order: 'asc' }],
    },
  )
  const item = page.items[0]
  if (!item?.code) throw new Error('WFL 预置未找到演示经营主体。')
  return { objectId: item.objectId, code: item.code }
}

async function createPaymentMethod(
  operator: RealApi,
  name: string,
): Promise<string> {
  const created = await operator.post<AuxMutation>(
    'aux/payment-method/create',
    {
      data: { name, defaultSalesSurcharge: '0.00', description: 'E2E 测试' },
    },
  )
  return created.objectId
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
  const created = await operator.post<BobMutation>('dcl/customer/create', {
    data: {
      kind: 'ORGANIZATION',
      legalName: name,
      displayName: name,
      strongIdentifiers: [],
      remittanceProfiles: [],
      defaultOperatingEntityId: operatingEntityId,
      enabled: true,
      accounts: [
        {
          enabled: true,
          isDefault: true,
          name,
          customerTypeId: '01JAVX00000000000000000005',
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
      ],
    },
  })
  const submittedCustomer = await operator.post<BobMutation>(
    'dcl/customer/submit',
    {
      objectId: created.objectId,
      approvalEntryId: created.approval.approvalEntryId,
      approvalRevision: created.approval.revision,
    },
  )
  const approvedCustomer = await reviewer.post<BobMutation>(
    'dcl/customer/approve',
    {
      objectId: submittedCustomer.objectId,
      approvalEntryId: submittedCustomer.approval.approvalEntryId,
      approvalRevision: submittedCustomer.approval.revision,
    },
  )
  const customerView = await operator.post<{ code: string }>(
    'dcl/customer/get',
    {
      objectId: approvedCustomer.objectId,
      approvalEntryId: approvedCustomer.approval.approvalEntryId,
    },
  )
  const candidates = await operator.post<BobReferenceQueryItem[]>(
    'bob/reference/query',
    { entity: 'customer-account', keyword: name },
  )
  const account = candidates.find(
    (candidate) => candidate.customerId === approvedCustomer.objectId,
  )
  if (!account?.approvalEntryId || !account.code) {
    throw new Error('客户批准后未生成可引用的默认结算账户。')
  }
  return {
    objectId: account.objectId,
    enabled: true,
    approval: {
      approvalEntryId: account.approvalEntryId,
      revision: approvedCustomer.approval.revision,
    },
    code: account.code,
    customerObjectId: approvedCustomer.objectId,
    customerCode: customerView.code,
    customerLookup: name,
  }
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
  reviewer: RealApi,
  options: {
    code: string
    name: string
    script: string
    trialSource: { entity: 'purchase-order' | 'sale-order'; documentId: string }
  },
): Promise<WflDefinitionView> {
  const created = await operator.post<WflDefinitionView>(
    'dcl/wfl-process-definition/create',
    { script: options.script },
  )
  if (created.approval.status !== 'DRAFT') {
    throw new Error(`WFL 预置流程定义 ${options.code} 未以草稿创建。`)
  }
  const edited = await operator.post<WflDefinitionView>(
    'dcl/wfl-process-definition/save',
    {
      code: created.code,
      approvalEntryId: created.approval.approvalEntryId,
      approvalRevision: created.approval.revision,
      script: `${options.script}\n`,
    },
  )
  const trial = await operator.post<{
    matched: boolean
    plannedActions: unknown[]
  }>('wfl/process-definition/trial', {
    definitionId: edited.definitionId,
    approvalEntryId: edited.approval.approvalEntryId,
    revision: edited.approval.revision,
    source: options.trialSource,
  })
  if (!trial.matched || trial.plannedActions.length !== 1) {
    throw new Error(`WFL 预置流程定义 ${options.code} 试算未生成预期动作。`)
  }
  const submitted = await operator.post<WflDefinitionView>(
    'dcl/wfl-process-definition/submit',
    {
      code: edited.code,
      approvalEntryId: edited.approval.approvalEntryId,
      approvalRevision: edited.approval.revision,
    },
  )
  const approved = await reviewer.post<WflDefinitionView>(
    'dcl/wfl-process-definition/approve',
    {
      code: submitted.code,
      approvalEntryId: submitted.approval.approvalEntryId,
      approvalRevision: submitted.approval.revision,
    },
  )
  if (approved.approval.status !== 'APPROVED') {
    throw new Error(`WFL 预置流程定义 ${options.code} 未批准。`)
  }
  const enabled = await operator.post<WflDefinitionView>(
    'dcl/wfl-process-definition/enable',
    {
      code: approved.code,
      approvalEntryId: approved.approval.approvalEntryId,
      approvalRevision: approved.approval.revision,
    },
  )
  if (!enabled.enabled) {
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
    approvalEntryId: value.approval.approvalEntryId,
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
  reviewer: RealApi,
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
  const submittedOrder = await operator.post<VouMutation>(
    'vou/purchase-order/submit',
    { documentId: order.documentId, revision: order.approval.revision },
  )
  await reviewer.post<VouMutation>('vou/purchase-order/approve', {
    documentId: submittedOrder.documentId,
    revision: submittedOrder.approval.revision,
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
  const submittedInbound = await operator.post<VouMutation>(
    'vou/purchase-inbound/submit',
    { documentId: inbound.documentId, revision: inbound.documentRevision },
  )
  await reviewer.post<VouMutation>('vou/purchase-inbound/approve', {
    documentId: submittedInbound.documentId,
    revision: submittedInbound.approval.revision,
  })
}

async function ensureAccountingControlBook(
  api: RealApi,
  reviewer: RealApi,
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
  let openingCandidate = opening
  if (openingCandidate.approval.status === 'DRAFT') {
    if (openingCandidate.approval.revision === 0) {
      openingCandidate = await api.post<AccountingOpeningView>(
        'acc/opening/save',
        {
          bookId: book.bookId,
          revision: 0,
          lines: [],
          assets: [],
          bills: [],
          containers: [],
        },
      )
    }
    openingCandidate = await api.post<AccountingOpeningView>(
      'acc/opening/submit',
      {
        bookId: book.bookId,
        revision: openingCandidate.approval.revision,
      },
    )
  }
  if (openingCandidate.approval.status === 'PENDING') {
    await reviewer.post<AccountingOpeningView>('acc/opening/approve', {
      bookId: book.bookId,
      revision: openingCandidate.approval.revision,
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
      'dcl/acc-mapping/query',
      {
        bookId: book.bookId,
        page: 1,
        pageSize: 100,
        filters: { vouEntity },
        sort: [{ field: 'vouEntity', order: 'asc' }],
      },
    )
    if (mappings.items.some((item) => item.approval.status === 'APPROVED'))
      continue
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
              dimensions: { SUPPLIER: 'supplier.objectId' },
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
          collection: 'accountAllocations',
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
              amountField: 'receivableApplied',
              currencyField: 'currency',
              dimensions: { CUSTOMER_ACCOUNT: 'account.objectId' },
              quantityField: null,
              costCounterpartSubjectId: null,
              costCounterpartDimensions: {},
            },
            {
              subjectSource: 'FIXED',
              subjectValue: subjectIdByCode.get('2203'),
              direction: 'CREDIT',
              amountField: 'advanceReceipt',
              currencyField: 'currency',
              dimensions: { CUSTOMER_ACCOUNT: 'account.objectId' },
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
                SALES_PARTNER: 'payee.objectId',
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
    let candidate =
      mappings.items.find((item) => item.approval.status !== 'APPROVED') ??
      (await api.post<AccountingMappingView>('dcl/acc-mapping/create', {
        bookId: book.bookId,
        vouEntity,
        data: { defaultResult, definition },
      }))
    if (candidate.approval.status === 'DRAFT') {
      candidate = await api.post<AccountingMappingView>(
        'dcl/acc-mapping/submit',
        {
          bookId: book.bookId,
          vouEntity,
          approvalEntryId: candidate.approval.approvalEntryId,
          approvalRevision: candidate.approval.revision,
        },
      )
    }
    await reviewer.post<AccountingMappingView>('dcl/acc-mapping/approve', {
      bookId: book.bookId,
      vouEntity,
      approvalEntryId: candidate.approval.approvalEntryId,
      approvalRevision: candidate.approval.revision,
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
      (item) =>
        item.status === 'ENABLED' &&
        (bobReviewerActions.has(item.path) ||
          item.path === '/app/workbench/query' ||
          /^\/vou\/[^/]+\/(?:query|get|reject|approve)$/.test(item.path)),
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
    const operatingEntity = await fixedOperatingEntity(operatorSession.api)
    const operatingEntityId = operatingEntity.objectId
    const employee = await createEffectiveEmployment(
      operatorSession.api,
      reviewerSession.api,
      `WFL 员工 ${suffix}`,
      operatingEntityId,
    )
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
    if (
      !customer.customerObjectId ||
      !customer.customerCode ||
      !customer.customerLookup
    ) {
      throw new Error('WFL 预置客户聚合引用不完整。')
    }
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
    const salesPartner = await createEffectiveSalesPartner(
      operatorSession.api,
      reviewerSession.api,
      `WFL 销售合作方 ${suffix}`,
      operatingEntityId,
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
          otherUnitObjectId: carrier.objectId,
        },
        bulkLiquidCapable: false,
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
    await createEnabledWorkflowDefinition(
      operatorSession.api,
      reviewerSession.api,
      {
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
      },
    )
    await createEnabledWorkflowDefinition(
      operatorSession.api,
      reviewerSession.api,
      {
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
      },
    )
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
        reviewerSession.api,
        [operatorUser.id, reviewerUser.id],
        [operatorUser.id, reviewerUser.id],
        vouEntities,
      )
      await seedInventoryThroughLifecycle(
        operatorSession.api,
        reviewerSession.api,
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
        customer: customer.customerLookup,
        customerAggregate: customer.customerCode,
        supplier: supplier.code,
        employee: employee.code,
        salesPartner: salesPartner.code,
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
        operatingEntityId,
        operatingEntity: operatingEntity.code,
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
