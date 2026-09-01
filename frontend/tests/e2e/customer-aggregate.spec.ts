import { request, type APIRequestContext } from '@playwright/test'
import { expect, test, type Page } from './fixtures'

test.describe.configure({ mode: 'serial' })
test.use({ storageState: { cookies: [], origins: [] } })

interface Envelope<T> {
  code: number | string
  message: string
  data: T
}

interface CustomerMutation {
  objectId: string
  approval: {
    approvalEntryId: string
    revision: number
    status: string
  }
}

interface CustomerAccount {
  accountId: string
  code: string
  name: string
  creditLimits: Array<{ currency: string; amount: string }>
}

interface CustomerView extends CustomerMutation {
  code: string
  data: {
    strongIdentifiers: Array<{ type: string; value: string }>
    remittanceProfiles: Array<{ accountName: string; bankName?: string; accountNumber?: string }>
    accounts: CustomerAccount[]
  }
}

interface ReferenceCandidate {
  objectId: string
  code: string
}

class Api {
  constructor(
    private readonly context: APIRequestContext,
    private readonly csrfToken: string,
  ) {}

  async post<T>(path: string, data: unknown): Promise<T> {
    const response = await this.context.post(path, {
      data,
      headers: { 'X-CSRF-Token': this.csrfToken },
    })
    expect(response.status(), `${path} HTTP status`).toBe(200)
    const envelope = (await response.json()) as Envelope<T>
    expect(String(envelope.code), `${path}: ${envelope.message}`).toBe('0')
    return envelope.data
  }
}

async function apiSession(credentials: {
  username: string
  password: string
}): Promise<{ api: Api; dispose: () => Promise<void> }> {
  const context = await request.newContext({
    baseURL: process.env.E2E_API_BASE_URL,
  })
  const response = await context.post('app/user/signin', { data: credentials })
  expect(response.status()).toBe(200)
  const envelope = (await response.json()) as Envelope<{ csrfToken: string }>
  expect(String(envelope.code), envelope.message).toBe('0')
  return {
    api: new Api(context, envelope.data.csrfToken),
    dispose: () => context.dispose(),
  }
}

async function signIn(
  page: Page,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('用户名', { exact: true }).fill(credentials.username)
  await page.getByLabel('密码', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).not.toHaveURL(/\/signin/)
}

async function assertCustomerAction(
  page: Page,
  customerName: string,
  label: string,
): Promise<void> {
  await page.goto('/dcl/customer')
  await page.getByLabel('客户编码或名称', { exact: true }).fill(customerName)
  await page.getByRole('button', { name: '查询', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: customerName })
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('button', { name: label, exact: true })).toBeVisible()
}

test('Customer 多账户通过一个聚合保存审批并呈现四种操作状态', async ({
  page,
  workerState,
}) => {
  const operator = await apiSession(workerState.operator)
  const reviewer = await apiSession(workerState.reviewer)
  try {
    const [employee] = await operator.api.post<ReferenceCandidate[]>(
      'bob/reference/query',
      { entity: 'employee', keyword: workerState.fixtures.employee },
    )
    if (!employee) throw new Error('Customer E2E 缺少员工销售归属引用。')

    const suffix = `${Date.now()}-${test.info().parallelIndex}`
    const name = `E2E 聚合客户 ${suffix}`
    const account = (accountName: string, isDefault: boolean) => ({
      enabled: true,
      isDefault,
      name: accountName,
      customerTypeId: '01JAVX00000000000000000005',
      transportSurcharge: '0.00',
      pricingPolicy: {
        defaultPremiumUnitPrice: '0.00',
        defaultDiscountUnitPrice: '0.00',
        costItems: [],
        thirdPartyIntermediaryFixedUnitCost: '0.00',
        thirdPartyIntermediaryVariableUnitCost: '0.00',
      },
      creditLimits: [
        { currency: 'CNY', amount: '1000.00' },
        { currency: 'USD', amount: '200.00' },
      ],
      primarySalesAttribution: {
        type: 'INTERNAL_EMPLOYEE',
        subjectObjectId: employee.objectId,
      },
    })
    const input = {
      kind: 'ORGANIZATION',
      legalName: name,
      displayName: name,
      strongIdentifiers: [
        { type: 'UNIFIED_SOCIAL_CREDIT_CODE', value: `9135${Date.now()}` },
        { type: 'PERSON_ID', value: `ID${Date.now()}` },
      ],
      remittanceProfiles: [{ accountName: `${name} 基本户` }],
      defaultOperatingEntityId: workerState.fixtures.operatingEntityId,
      enabled: true,
      accounts: [account(`${name} 默认账户`, true), account(`${name} 项目账户`, false)],
    }

    const created = await operator.api.post<CustomerMutation>(
      'dcl/customer/create',
      { data: input },
    )
    const createdView = await operator.api.post<CustomerView>(
      'dcl/customer/get',
      { objectId: created.objectId },
    )
    expect(createdView.data.accounts).toHaveLength(2)
    expect(new Set(createdView.data.accounts.map((item) => item.accountId)).size).toBe(2)
    expect(createdView.data.strongIdentifiers).toEqual(input.strongIdentifiers)
    expect(createdView.data.remittanceProfiles).toEqual([
      { accountName: `${name} 基本户` },
    ])
    expect(createdView.data.accounts[0]?.creditLimits).toEqual(account('', true).creditLimits)

    await signIn(page, workerState.operator)
    await assertCustomerAction(page, name, '编辑草稿')

    const saved = await operator.api.post<CustomerMutation>('dcl/customer/save', {
      objectId: created.objectId,
      approvalEntryId: created.approval.approvalEntryId,
      approvalRevision: created.approval.revision,
      data: {
        ...input,
        accounts: input.accounts.map((item, index) => ({
          ...item,
          accountId: createdView.data.accounts[index]!.accountId,
          name: `${item.name} 已保存`,
        })),
      },
    })
    const pending = await operator.api.post<CustomerMutation>(
      'dcl/customer/submit',
      {
        objectId: saved.objectId,
        approvalEntryId: saved.approval.approvalEntryId,
        approvalRevision: saved.approval.revision,
      },
    )
    await assertCustomerAction(page, name, '查看')

    const approved = await reviewer.api.post<CustomerMutation>(
      'dcl/customer/approve',
      {
        objectId: pending.objectId,
        approvalEntryId: pending.approval.approvalEntryId,
        approvalRevision: pending.approval.revision,
      },
    )
    await assertCustomerAction(page, name, '发起变更')

    const v2 = await operator.api.post<CustomerMutation>('dcl/customer/save', {
      objectId: approved.objectId,
      approvalEntryId: approved.approval.approvalEntryId,
      approvalRevision: approved.approval.revision,
      data: {
        ...input,
        displayName: `${name} V2`,
        accounts: input.accounts.map((item, index) => ({
          ...item,
          accountId: createdView.data.accounts[index]!.accountId,
          name: `${item.name} V2`,
        })),
      },
    })
    expect(v2.approval.status).toBe('DRAFT')
    await assertCustomerAction(page, name, '继续编辑草稿')

    await page.context().clearCookies()
    await signIn(page, workerState.reviewer)
    await assertCustomerAction(page, name, '查看')
  } finally {
    await reviewer.dispose()
    await operator.dispose()
  }
})
