import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { request, type APIRequestContext } from '@playwright/test'
import type {
  OpeningMutationResult,
  OpeningSaveRequest,
  OpeningView,
} from '../../src/pages/led/opening/types'
import {
  e2eEnv,
  wflBootstrapEnabled,
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
}

function localDate(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function reference(value: { objectId: string; versionId: string }) {
  return {
    objectId: value.objectId,
    versionId: value.versionId,
  }
}

async function ensureLedgerActive(
  api: RealApi,
  warehouse: BobMutation,
  product: BobMutation,
): Promise<void> {
  let opening = await api.post<OpeningView>('led/opening/get', {})
  const inventoryExists = opening.inventory.some(
    (item) =>
      item.warehouse.objectId === warehouse.objectId &&
      item.product.objectId === product.objectId,
  )
  if (opening.status === 'ACTIVE' && inventoryExists) return

  if (opening.status === 'ACTIVE') {
    await api.post<OpeningMutationResult>('led/opening/reopen', {
      revision: opening.revision,
      reason: 'Playwright 隔离测试更新期初资料',
    })
    opening = await api.post<OpeningView>('led/opening/get', {})
  }
  if (opening.status !== 'DRAFT' && opening.status !== 'REOPENING') {
    throw new Error(`隔离账簿处于无法预置的状态：${opening.status}`)
  }

  const payload: OpeningSaveRequest = {
    revision: opening.revision,
    cutoverDate: opening.cutoverDate ?? localDate(),
    inventory: opening.inventory.map((item) => ({
      warehouse: reference(item.warehouse),
      product: reference(item.product),
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? '1.00',
      currency: item.currency ?? 'CNY',
    })),
    fund: opening.fund.map((item) => ({
      fundAccount: reference(item.fundAccount),
      balanceType: item.balanceType,
      amount: item.amount,
    })),
    party: opening.party.map((item) => ({
      counterpartyType: item.counterpartyType,
      counterparty: reference(item.counterparty),
      currency: item.currency,
      balanceType: item.balanceType,
      amount: item.amount,
    })),
    container: opening.container.map((item) => ({
      customer: reference(item.customer),
      containerType: item.containerType,
      quantity: item.quantity,
    })),
  }
  if (!inventoryExists) {
    payload.inventory.push({
      warehouse: reference(warehouse),
      product: reference(product),
      quantity: '1000',
      unitPrice: '1.00',
      currency: 'CNY',
    })
  }

  const saved = await api.post<OpeningMutationResult>(
    'led/opening/save',
    payload,
  )
  await api.post<OpeningMutationResult>('led/opening/activate', {
    revision: saved.revision,
  })
}

class RealApi {
  constructor(
    private readonly context: APIRequestContext,
    private readonly csrfToken = '',
  ) {}

  async post<T>(path: string, data: unknown): Promise<T> {
    const response = await this.context.post(path, {
      data,
      headers: this.csrfToken
        ? { 'X-CSRF-Token': this.csrfToken }
        : undefined,
    })
    if (response.status() !== 200) {
      throw new Error(`WFL 预置接口 ${path} 返回 HTTP ${response.status()}。`)
    }
    const envelope = await response.json() as Envelope<T>
    if (envelope.code !== 0 && envelope.code !== '0') {
      const requestId = envelope.requestId
        ? `（请求编号：${envelope.requestId}）`
        : ''
      throw new Error(`WFL 预置接口 ${path} 失败：${envelope.message}${requestId}`)
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
  return reviewer.post<BobMutation>(`bob/${entity}/approve`, {
    objectId: submitted.objectId,
    versionId: submitted.versionId,
    revision: submitted.revision,
    comment: 'WFL 隔离测试自动预置',
  })
}

async function createAuxiliary(
  operator: RealApi,
  entity: string,
  data: Record<string, unknown>,
): Promise<BobMutation> {
  return operator.post<BobMutation>(`aux/${entity}/create`, { data })
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
      (item) =>
        item.status === 'ENABLED' &&
        bobReviewerActions.has(item.path),
    )

    const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
      .toUpperCase()
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

    const code = (kind: string) => `WFL-${kind}-${suffix}`
    const employee = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'employee',
      { code: code('EMP'), name: `WFL 员工 ${suffix}` },
    )
    const settlement = await createAuxiliary(
      operatorSession.api,
      'settlement-method',
      {
        code: code('SET'),
        name: `WFL 结算方式 ${suffix}`,
        ruleType: 'DUE_DAYS',
        dueDays: 30,
        defaultSalesSurcharge: '0.00',
      },
    )
    const customerCode = code('CUS')
    await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'customer',
      {
        code: customerCode,
        name: `WFL 客户 ${suffix}`,
        customerType: 'END_USER',
        salespersonEmployeeId: employee.objectId,
        settlementMethodId: settlement.objectId,
      },
    )
    const supplierCode = code('SUP')
    await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'supplier',
      {
        code: supplierCode,
        name: `WFL 普通供应商 ${suffix}`,
        supplierType: 'GENERAL',
        salespersonEmployeeId: employee.objectId,
        settlementMethodId: settlement.objectId,
      },
    )
    const platformCode = code('PLT')
    const platform = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'supplier',
      {
        code: platformCode,
        name: `WFL 物流平台 ${suffix}`,
        supplierType: 'LOGISTICS_PLATFORM',
        salespersonEmployeeId: employee.objectId,
        settlementMethodId: settlement.objectId,
      },
    )
    const solventProductCode = code('SOL')
    const solventProduct = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'product',
      {
        code: solventProductCode,
        name: `WFL 溶剂桶产品 ${suffix}`,
        unit: 'KG',
        productKind: 'RAW_MATERIAL',
        inventoryUnitId: '01JAVX00000000000000000011',
        pricingUnitId: '01JAVX00000000000000000011',
        pricingQuantityPerInventoryUnit: '1',
      },
    )
    const resinProductCode = code('RES')
    await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'product',
      {
        code: resinProductCode,
        name: `WFL 树脂桶产品 ${suffix}`,
        unit: 'KG',
        productKind: 'RAW_MATERIAL',
        inventoryUnitId: '01JAVX00000000000000000011',
        pricingUnitId: '01JAVX00000000000000000011',
        pricingQuantityPerInventoryUnit: '1',
      },
    )
    const vehicleCode = code('VEH')
    await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'vehicle',
      {
        code: vehicleCode,
        name: `WFL 测试车辆 ${suffix}`,
        plateNumber: `E2E-${suffix.slice(-8)}`,
        vehicleType: 'BOX_TRUCK',
        platformObjectId: platform.objectId,
      },
    )
    const warehouseCode = code('WHS')
    const warehouse = await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'warehouse',
      {
        code: warehouseCode,
        name: `WFL 测试仓库 ${suffix}`,
      },
    )
    const fundAccountCode = code('FUND')
    await createEffectiveBob(
      operatorSession.api,
      reviewerSession.api,
      'fund-account',
      {
        code: fundAccountCode,
        name: `WFL 测试资金账户 ${suffix}`,
        currency: 'CNY',
      },
    )

    await ensureLedgerActive(
      operatorSession.api,
      warehouse,
      solventProduct,
    )

    const state: WflBootstrapState = {
      reviewer: {
        username: reviewerUsername,
        password: reviewerPassword,
      },
      fixtures: {
        customer: customerCode,
        supplier: supplierCode,
        employee: code('EMP'),
        solventProduct: solventProductCode,
        resinProduct: resinProductCode,
        platform: platformCode,
        vehicle: vehicleCode,
        warehouse: warehouseCode,
        fundAccount: fundAccountCode,
      },
    }
    await mkdir(dirname(wflBootstrapStatePath), { recursive: true })
    await writeFile(
      wflBootstrapStatePath,
      `${JSON.stringify(state)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  } finally {
    await Promise.all(contexts.map((context) => context.dispose()))
  }
}
