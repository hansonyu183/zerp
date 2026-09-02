import { randomBytes } from 'node:crypto'
import { request, type APIRequestContext } from '@playwright/test'
import { expect, test, type Page } from './fixtures'

test.describe.configure({ mode: 'serial' })
test.use({ storageState: { cookies: [], origins: [] } })

interface Envelope<T> {
  code: number | string
  errorKey: string
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
    kind: 'MAINLAND_ENTERPRISE' | 'MAINLAND_INDIVIDUAL' | 'OTHER'
    legalIdentifier: string | null
    remittanceProfiles: Array<{
      accountName: string
      bankName?: string
      accountNumber?: string
    }>
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

  async expectBusinessError(
    path: string,
    data: unknown,
    errorKey: string,
  ): Promise<void> {
    const response = await this.context.post(path, {
      data,
      headers: { 'X-CSRF-Token': this.csrfToken },
    })
    expect(response.status(), `${path} HTTP status`).toBe(200)
    const envelope = (await response.json()) as Envelope<unknown>
    expect(String(envelope.code), `${path}: ${envelope.message}`).not.toBe('0')
    expect(envelope.errorKey).toBe(errorKey)
  }
}

const mainlandUnifiedSocialCreditCharset = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const mainlandUnifiedSocialCreditWeights = [
  1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28,
]

function mainlandEnterpriseIdentifier(): string {
  const base = `91${randomBytes(8).toString('hex').toUpperCase().slice(0, 15)}`
  const sum = [...base].reduce(
    (total, character, index) =>
      total +
      mainlandUnifiedSocialCreditCharset.indexOf(character) *
        mainlandUnifiedSocialCreditWeights[index]!,
    0,
  )
  return `${base}${mainlandUnifiedSocialCreditCharset[(31 - (sum % 31)) % 31]}`
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
  await expect(
    row.getByRole('button', { name: label, exact: true }),
  ).toBeVisible()
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
      kind: 'MAINLAND_ENTERPRISE',
      legalName: name,
      displayName: name,
      legalIdentifier: mainlandEnterpriseIdentifier(),
      remittanceProfiles: [{ accountName: `${name} 基本户` }],
      defaultOperatingEntityId: workerState.fixtures.operatingEntityId,
      enabled: true,
      accounts: [
        account(`${name} 默认账户`, true),
        account(`${name} 项目账户`, false),
      ],
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
    expect(
      new Set(createdView.data.accounts.map((item) => item.accountId)).size,
    ).toBe(2)
    expect(createdView.data.kind).toBe('MAINLAND_ENTERPRISE')
    expect(createdView.data.legalIdentifier).toBe(input.legalIdentifier)
    expect(createdView.data.remittanceProfiles).toEqual([
      { accountName: `${name} 基本户` },
    ])
    expect(createdView.data.accounts[0]?.creditLimits).toEqual(
      account('', true).creditLimits,
    )

    await signIn(page, workerState.operator)
    await assertCustomerAction(page, name, '编辑草稿')

    const saved = await operator.api.post<CustomerMutation>(
      'dcl/customer/save',
      {
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
      },
    )
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

test('Customer 在真实全栈中校验三类法定识别号、OTHER 占用和提交必填', async ({
  workerState,
}) => {
  const operator = await apiSession(workerState.operator)
  try {
    const [employee] = await operator.api.post<ReferenceCandidate[]>(
      'bob/reference/query',
      { entity: 'employee', keyword: workerState.fixtures.employee },
    )
    if (!employee) throw new Error('Customer E2E 缺少员工销售归属引用。')

    const suffix = `${Date.now()}-${test.info().parallelIndex}`
    const customerInput = (
      name: string,
      kind: 'MAINLAND_ENTERPRISE' | 'MAINLAND_INDIVIDUAL' | 'OTHER',
      legalIdentifier: string | null,
    ) => ({
      kind,
      legalName: name,
      displayName: name,
      legalIdentifier,
      remittanceProfiles: [],
      defaultOperatingEntityId: workerState.fixtures.operatingEntityId,
      enabled: true,
      accounts: [
        {
          enabled: true,
          isDefault: true,
          name: `${name} 账户`,
          customerTypeId: '01JAVX00000000000000000005',
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
            subjectObjectId: employee.objectId,
          },
        },
      ],
    })

    const enterpriseIdentifier = mainlandEnterpriseIdentifier()
    const enterprise = await operator.api.post<CustomerMutation>(
      'dcl/customer/create',
      {
        data: customerInput(
          `E2E 大陆企业 ${suffix}`,
          'MAINLAND_ENTERPRISE',
          enterpriseIdentifier,
        ),
      },
    )
    const enterpriseView = await operator.api.post<CustomerView>(
      'dcl/customer/get',
      {
        objectId: enterprise.objectId,
      },
    )
    expect(enterpriseView.data).toMatchObject({
      kind: 'MAINLAND_ENTERPRISE',
      legalIdentifier: enterpriseIdentifier,
    })

    await operator.api.expectBusinessError(
      'dcl/customer/create',
      {
        data: customerInput(
          `E2E 无效信用代码 ${suffix}`,
          'MAINLAND_ENTERPRISE',
          '91350211M000100Y47',
        ),
      },
      'invalid_legal_identifier',
    )

    const individual = await operator.api.post<CustomerMutation>(
      'dcl/customer/create',
      {
        data: customerInput(
          `E2E 大陆个人 ${suffix}`,
          'MAINLAND_INDIVIDUAL',
          '11010519491231002x',
        ),
      },
    )
    const individualView = await operator.api.post<CustomerView>(
      'dcl/customer/get',
      {
        objectId: individual.objectId,
      },
    )
    expect(individualView.data).toMatchObject({
      kind: 'MAINLAND_INDIVIDUAL',
      legalIdentifier: '11010519491231002X',
    })

    const otherIdentifier = `OTHER-${suffix}`
    await operator.api.post<CustomerMutation>('dcl/customer/create', {
      data: customerInput(
        `E2E 其他客户 ${suffix}`,
        'OTHER',
        ` ${otherIdentifier} `,
      ),
    })
    await operator.api.expectBusinessError(
      'dcl/customer/create',
      {
        data: customerInput(
          `E2E 重复其他客户 ${suffix}`,
          'OTHER',
          otherIdentifier,
        ),
      },
      'customer_legal_identifier_claimed',
    )

    const draft = await operator.api.post<CustomerMutation>(
      'dcl/customer/create',
      {
        data: customerInput(
          `E2E 空号码草稿 ${suffix}`,
          'MAINLAND_ENTERPRISE',
          null,
        ),
      },
    )
    await operator.api.expectBusinessError(
      'dcl/customer/submit',
      {
        objectId: draft.objectId,
        approvalEntryId: draft.approval.approvalEntryId,
        approvalRevision: draft.approval.revision,
      },
      'legal_identifier_required',
    )
  } finally {
    await operator.dispose()
  }
})
