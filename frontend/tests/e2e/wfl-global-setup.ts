import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { request, type APIRequestContext } from '@playwright/test'
import type { ClosingView } from '../../src/pages/led/opening/types'
import {
  e2eEnv,
  wflBootstrapEnabled,
  wflOperatorAuthStatePath,
  wflBootstrapStatePath,
  type WflBootstrapState,
} from './wfl-runtime'

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
}

interface BobMutation {
  objectId: string
  objectRevision: number
  versionId: string
  revision: number
  code: string
}

interface BobQueryItem {
  objectId: string
  currentVersion: {
    versionId: string
    summary: { termCode?: string }
  }
}

interface VouMutation {
  documentId: string
  revision: number
}

interface VouDocumentView {
  data: {
    productLines?: Array<{ lineId: string }>
  }
}

async function ensureLedgerReady(api: RealApi): Promise<void> {
  await api.post<ClosingView>('led/closing/get', {})
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
  const session = await new RealApi(anonymous).post<SessionData>(
    'app/user/signin',
    { username, password },
  )
  return {
    api: new RealApi(anonymous, session.csrfToken),
    context: anonymous,
  }
}

async function allPermissions(api: RealApi): Promise<PermissionView[]> {
  const result: PermissionView[] = []
  for (let page = 1; ; page += 1) {
    const data = await api.post<Page<PermissionView>>('app/permission/query', {
      page,
      pageSize: 200,
      filters: { status: 'ENABLED' },
      sort: [{ field: 'path', order: 'asc' }],
    })
    result.push(...data.items)
    if (result.length >= data.total) return result
  }
}

const bobReviewerActions = new Set([
  '/app/user/signout',
  '/bob/customer/query',
  '/bob/customer/get',
  '/bob/customer/approve',
  '/bob/customer/reject',
  '/bob/customer/unapprove',
  '/bob/customer/enable',
  '/bob/customer/disable',
  '/bob/customer/versions',
  '/bob/customer/audit-history',
  ...[
    'employee',
    'supplier',
    'product',
    'vehicle',
    'warehouse',
    'fund-account',
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

async function fixedSettlementMethod(operator: RealApi): Promise<BobMutation> {
  const page = await operator.post<Page<BobQueryItem>>(
    'bob/settlement-method/query',
    {
      page: 1,
      pageSize: 20,
      filters: { status: ['EFFECTIVE'], enabled: true },
      sort: [{ field: 'code', order: 'asc' }],
    },
  )
  const item = page.items.find(
    (candidate) =>
      candidate.currentVersion.summary.termCode === 'MONTHLY_CURRENT',
  )
  if (!item) throw new Error('WFL 预置未找到系统固定当月结结算方式。')
  return {
    objectId: item.objectId,
    objectRevision: 1,
    versionId: item.currentVersion.versionId,
    revision: 1,
    code: 'MONTHLY_CURRENT',
  }
}

async function seedInventoryThroughLifecycle(
  operator: RealApi,
  supplier: BobMutation,
  purchaser: BobMutation,
  warehouse: BobMutation,
  product: BobMutation,
): Promise<void> {
  const reference = (value: BobMutation) => ({
    objectId: value.objectId,
    versionId: value.versionId,
  })
  const order = await operator.post<VouMutation>('vou/purchase-order/create', {
    data: {
      businessDate: new Date().toISOString().slice(0, 10),
      currency: 'CNY',
      supplier: reference(supplier),
      purchaser: reference(purchaser),
      warehouse: reference(warehouse),
      productLines: [
        {
          product: reference(product),
          orderedQuantity: '1000',
          unitPrice: '1.00',
        },
      ],
    },
  })
  const checkedOrder = await operator.post<VouMutation>(
    'vou/purchase-order/check',
    { documentId: order.documentId, revision: order.revision },
  )
  await operator.post<VouMutation>('vou/purchase-order/approve', {
    documentId: checkedOrder.documentId,
    revision: checkedOrder.revision,
  })
  const orderView = await operator.post<VouDocumentView>(
    'vou/purchase-order/get',
    { documentId: order.documentId },
  )
  const sourceLineId = orderView.data.productLines?.[0]?.lineId
  if (!sourceLineId) {
    throw new Error('WFL 库存预置未取得采购订单明细。')
  }
  const inbound = await operator.post<VouMutation>(
    'vou/purchase-inbound/create',
    {
      parentEntity: 'purchase-order',
      parentDocumentId: order.documentId,
      data: {
        businessDate: new Date().toISOString().slice(0, 10),
        warehouse: reference(warehouse),
        sourceLines: [{ sourceLineId, quantity: '1000' }],
      },
    },
  )
  const checkedInbound = await operator.post<VouMutation>(
    'vou/purchase-inbound/check',
    { documentId: inbound.documentId, revision: inbound.revision },
  )
  const approvedInbound = await operator.post<VouMutation>(
    'vou/purchase-inbound/approve',
    {
      documentId: checkedInbound.documentId,
      revision: checkedInbound.revision,
    },
  )
  await operator.post<VouMutation>('vou/purchase-inbound/finalize', {
    documentId: approvedInbound.documentId,
    revision: approvedInbound.revision,
  })
}

export default async function globalSetup(): Promise<void> {
  if (!wflBootstrapEnabled()) return

  const baseURL = e2eEnv('E2E_API_BASE_URL')
  const username = e2eEnv('E2E_USERNAME')
  const password = e2eEnv('E2E_PASSWORD')
  if (!baseURL || !username || !password) {
    throw new Error(
      'E2E_WFL_BOOTSTRAP=true 时必须配置隔离后端地址和管理员账号。',
    )
  }

  const operatorSession = await signIn(baseURL, username, password)
  const contexts: APIRequestContext[] = [operatorSession.context]
  try {
    const permissions = await allPermissions(operatorSession.api)
    const selected = permissions.filter(
      (item) => item.status === 'ENABLED' && bobReviewerActions.has(item.path),
    )

    const suffix =
      `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`.toUpperCase()
    const reviewerPassword = `Wfl!${randomBytes(12).toString('base64url')}Aa1`
    const role = await operatorSession.api.post<RoleView>('app/role/create', {
      code: `e2e-wfl-${suffix}`.toLowerCase(),
      name: `E2E WFL ${suffix}`,
      description: '隔离测试临时精确权限角色',
      permissionIds: selected.map((item) => item.id),
    })
    const reviewerUsername = `e2e-wfl-${suffix}`.toLowerCase()
    await operatorSession.api.post('app/user/create', {
      username: reviewerUsername,
      displayName: `E2E WFL 复核 ${suffix}`,
      password: reviewerPassword,
      roleIds: [role.id],
    })
    const reviewerSession = await signIn(
      baseURL,
      reviewerUsername,
      reviewerPassword,
    )
    contexts.push(reviewerSession.context)

    const employee = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'employee',
      { name: `WFL 员工 ${suffix}` },
    )
    const settlement = await fixedSettlementMethod(operatorSession.api)
    const customer = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'customer',
      {
        name: `WFL 客户 ${suffix}`,
        customerType: 'DIT-0001',
        salespersonEmployeeId: employee.objectId,
        settlementMethodId: settlement.objectId,
      },
    )
    const supplier = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'supplier',
      {
        name: `WFL 普通供应商 ${suffix}`,
        supplierType: 'GENERAL',
        salespersonEmployeeId: employee.objectId,
        settlementMethodId: settlement.objectId,
      },
    )
    const platform = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'supplier',
      {
        name: `WFL 物流平台 ${suffix}`,
        supplierType: 'LOGISTICS_PLATFORM',
        salespersonEmployeeId: employee.objectId,
        settlementMethodId: settlement.objectId,
      },
    )
    const solventProduct = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'product',
      {
        name: `WFL 溶剂桶产品 ${suffix}`,
        unit: 'KG',
        productKind: 'RAW_MATERIAL',
        inventoryUnitId: '01JAVX00000000000000000011',
        pricingUnitId: '01JAVX00000000000000000011',
        pricingQuantityPerInventoryUnit: '1',
      },
    )
    const resinProduct = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'product',
      {
        name: `WFL 树脂桶产品 ${suffix}`,
        unit: 'KG',
        productKind: 'RAW_MATERIAL',
        inventoryUnitId: '01JAVX00000000000000000011',
        pricingUnitId: '01JAVX00000000000000000011',
        pricingQuantityPerInventoryUnit: '1',
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
        platformObjectId: platform.objectId,
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
      },
    )

    await ensureLedgerReady(operatorSession.api)
    await seedInventoryThroughLifecycle(
      operatorSession.api,
      supplier,
      employee,
      warehouse,
      solventProduct,
    )

    const state: WflBootstrapState = {
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
        platform: platform.code,
        vehicle: vehicle.code,
        warehouse: warehouse.code,
        fundAccount: fundAccount.code,
      },
    }
    await mkdir(dirname(wflBootstrapStatePath), { recursive: true })
    await operatorSession.context.storageState({
      path: wflOperatorAuthStatePath,
    })
    await writeFile(wflBootstrapStatePath, `${JSON.stringify(state)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
  } finally {
    await Promise.all(contexts.map((context) => context.dispose()))
  }
}
