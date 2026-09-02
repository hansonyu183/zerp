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

interface CustomerSubunit {
  subunitId: string
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
    subunits: CustomerSubunit[]
    implicitSubunitId: string | null
  }
}

interface ReferenceCandidate {
  objectId: string
  code: string
}

interface Permission {
  id: string
  path: string
  status: string
}

interface Role {
  id: string
}

interface User {
  id: string
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

async function createExactPermissionUser(
  administrator: Api,
  permissionCatalog: Map<string, string>,
  label: string,
  paths: readonly string[],
): Promise<{ username: string; password: string }> {
  const suffix = randomBytes(8).toString('hex')
  const initialPassword = `Zerp!${randomBytes(12).toString('hex')}Aa9`
  const password = `Zerp!${randomBytes(12).toString('hex')}Bb9`
  const permissionIds = paths.map((path) => {
    const id = permissionCatalog.get(path)
    if (!id) throw new Error(`Customer E2E 权限目录缺少 ${path}。`)
    return id
  })
  const role = await administrator.post<Role>('app/role/create', {
    name: `${label}角色-${suffix}`,
    description: 'Customer 最小权限矩阵 E2E',
    permissionIds,
  })
  const username = `e2e-customer-${suffix}`
  await administrator.post<User>('app/user/create', {
    username,
    displayName: `${label}-${suffix}`,
    password: initialPassword,
    roleIds: [role.id],
  })
  const initialSession = await apiSession({
    username,
    password: initialPassword,
  })
  try {
    await initialSession.api.post<undefined>('app/user/change-password', {
      currentPassword: initialPassword,
      newPassword: password,
    })
  } finally {
    await initialSession.dispose()
  }
  return { username, password }
}

async function permissionCatalog(
  administrator: Api,
): Promise<Map<string, string>> {
  const permissions: Permission[] = []
  let page = 1
  let total = 1
  while (permissions.length < total) {
    const result = await administrator.post<{
      items: Permission[]
      total: number
    }>('app/permission/query', {
      page: page++,
      pageSize: 20,
      sort: [{ field: 'path', order: 'asc' }],
    })
    permissions.push(...result.items)
    total = result.total
    if (result.items.length === 0) break
  }
  return new Map(
    permissions
      .filter((permission) => permission.status === 'ENABLED')
      .map((permission) => [permission.path, permission.id]),
  )
}

async function signInFresh(
  page: Page,
  credentials: { username: string; password: string },
): Promise<void> {
  await page.context().clearCookies()
  await signIn(page, credentials)
}

async function openCustomerAction(
  page: Page,
  customerName: string,
  label: string,
): Promise<void> {
  await assertCustomerAction(page, customerName, label)
  const row = page.getByRole('row').filter({ hasText: customerName })
  await row.getByRole('button', { name: label, exact: true }).click()
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

test('Customer 根资料与子单位独立保存并呈现四种操作状态', async ({
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
    const subunit = (subunitName: string) => ({
      enabled: true,
      name: subunitName,
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
      subunits: [subunit(`${name} 总部`), subunit(`${name} 项目部`)],
    }

    const created = await operator.api.post<CustomerMutation>(
      'dcl/customer/create',
      {
        data: {
          root: {
            kind: input.kind,
            legalName: input.legalName,
            displayName: input.displayName,
            legalIdentifier: input.legalIdentifier,
            remittanceProfiles: input.remittanceProfiles,
            defaultOperatingEntityId: input.defaultOperatingEntityId,
            enabled: input.enabled,
          },
          subunits: input.subunits,
        },
      },
    )
    const createdView = await operator.api.post<CustomerView>(
      'dcl/customer/get',
      { objectId: created.objectId },
    )
    expect(createdView.data.subunits).toHaveLength(2)
    expect(createdView.data.implicitSubunitId).toBeNull()
    expect(
      new Set(createdView.data.subunits.map((item) => item.subunitId)).size,
    ).toBe(2)
    expect(createdView.data.kind).toBe('MAINLAND_ENTERPRISE')
    expect(createdView.data.legalIdentifier).toBe(input.legalIdentifier)
    expect(createdView.data.remittanceProfiles).toEqual([
      { accountName: `${name} 基本户` },
    ])
    expect(createdView.data.subunits[0]?.creditLimits).toEqual(
      subunit('').creditLimits,
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
          kind: input.kind,
          legalName: input.legalName,
          displayName: input.displayName,
          legalIdentifier: input.legalIdentifier,
          remittanceProfiles: input.remittanceProfiles,
          defaultOperatingEntityId: input.defaultOperatingEntityId,
          enabled: input.enabled,
        },
      },
    )
    const subunitsSaved = await operator.api.post<CustomerMutation>(
      'dcl/customer/save-subunits',
      {
        objectId: saved.objectId,
        approvalEntryId: saved.approval.approvalEntryId,
        approvalRevision: saved.approval.revision,
        subunits: input.subunits.map((item, index) => ({
          ...item,
          subunitId: createdView.data.subunits[index]!.subunitId,
          name: `${item.name} 已保存`,
        })),
      },
    )
    const pending = await operator.api.post<CustomerMutation>(
      'dcl/customer/submit',
      {
        objectId: subunitsSaved.objectId,
        approvalEntryId: subunitsSaved.approval.approvalEntryId,
        approvalRevision: subunitsSaved.approval.revision,
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
        kind: input.kind,
        legalName: input.legalName,
        displayName: `${name} V2`,
        legalIdentifier: input.legalIdentifier,
        remittanceProfiles: input.remittanceProfiles,
        defaultOperatingEntityId: input.defaultOperatingEntityId,
        enabled: input.enabled,
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
      subunits: [
        {
          enabled: true,
          name: `${name} 总部`,
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
    const createData = (
      name: string,
      kind: 'MAINLAND_ENTERPRISE' | 'MAINLAND_INDIVIDUAL' | 'OTHER',
      legalIdentifier: string | null,
    ) => {
      const { subunits, ...root } = customerInput(name, kind, legalIdentifier)
      return { root, subunits }
    }

    const enterpriseIdentifier = mainlandEnterpriseIdentifier()
    const enterprise = await operator.api.post<CustomerMutation>(
      'dcl/customer/create',
      {
        data: createData(
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
        data: createData(
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
        data: createData(
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
      data: createData(
        `E2E 其他客户 ${suffix}`,
        'OTHER',
        ` ${otherIdentifier} `,
      ),
    })
    await operator.api.expectBusinessError(
      'dcl/customer/create',
      {
        data: createData(
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
        data: createData(
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

test(
  'Customer 根维护者、子单位维护者、只读用户和审批人按真实最小权限协作 @system-serial',
  { tag: '@system-serial' },
  async ({ page, workerState }) => {
    test.setTimeout(180_000)
    const administrator = await apiSession({
      username: process.env.E2E_USERNAME!,
      password: process.env.E2E_PASSWORD!,
    })
    const operator = await apiSession(workerState.operator)
    const reviewer = await apiSession(workerState.reviewer)
    const sessions: Array<{ dispose: () => Promise<void> }> = []
    try {
      const catalog = await permissionCatalog(administrator.api)
      const readPaths = ['/dcl/customer/query', '/dcl/customer/get'] as const
      const referencePaths = [
        '/bob/operating-entity/query',
        '/aux/reference/query',
        '/bob/reference/query',
      ] as const
      const rootMaintainer = await createExactPermissionUser(
        administrator.api,
        catalog,
        '客户根维护者',
        [...readPaths, ...referencePaths, '/dcl/customer/save'],
      )
      const subunitMaintainer = await createExactPermissionUser(
        administrator.api,
        catalog,
        '客户子单位维护者',
        [...readPaths, ...referencePaths, '/dcl/customer/save-subunits'],
      )
      const readonlyUser = await createExactPermissionUser(
        administrator.api,
        catalog,
        '客户只读用户',
        readPaths,
      )
      const approver = await createExactPermissionUser(
        administrator.api,
        catalog,
        '客户审批人',
        ['/dcl/customer/approve'],
      )

      const [employee] = await operator.api.post<ReferenceCandidate[]>(
        'bob/reference/query',
        { entity: 'employee', keyword: workerState.fixtures.employee },
      )
      if (!employee) throw new Error('Customer 权限 E2E 缺少员工引用。')
      const suffix = `${Date.now()}-${test.info().parallelIndex}`
      const name = `E2E 客户权限矩阵 ${suffix}`
      const initialSubunitName = `${name} 总部`
      const root = {
        kind: 'MAINLAND_ENTERPRISE' as const,
        legalName: name,
        displayName: name,
        legalIdentifier: mainlandEnterpriseIdentifier(),
        remittanceProfiles: [],
        defaultOperatingEntityId: workerState.fixtures.operatingEntityId,
        enabled: true,
      }
      const subunit = {
        enabled: true,
        name: initialSubunitName,
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
      }
      let mutation = await operator.api.post<CustomerMutation>(
        'dcl/customer/create',
        { data: { root, subunits: [subunit] } },
      )
      mutation = await operator.api.post<CustomerMutation>(
        'dcl/customer/submit',
        {
          objectId: mutation.objectId,
          approvalEntryId: mutation.approval.approvalEntryId,
          approvalRevision: mutation.approval.revision,
        },
      )
      mutation = await reviewer.api.post<CustomerMutation>(
        'dcl/customer/approve',
        {
          objectId: mutation.objectId,
          approvalEntryId: mutation.approval.approvalEntryId,
          approvalRevision: mutation.approval.revision,
        },
      )

      const rootSession = await apiSession(rootMaintainer)
      sessions.push(rootSession)
      await signInFresh(page, rootMaintainer)
      await openCustomerAction(page, name, '发起变更')
      let drawer = page.locator('.v-navigation-drawer--right')
      await expect(
        drawer.getByLabel('法定名称', { exact: true }),
      ).toBeEditable()
      await expect(
        drawer.getByRole('button', { name: '新增子单位', exact: true }),
      ).toHaveCount(0)
      await expect(
        drawer.getByRole('button', { name: '保存客户资料', exact: true }),
      ).toBeVisible()
      await expect(
        drawer.getByRole('button', { name: '保存客户子单位', exact: true }),
      ).toHaveCount(0)
      await drawer.getByLabel('联系电话', { exact: true }).fill('021-3510001')
      await drawer
        .getByRole('button', { name: '保存客户资料', exact: true })
        .click()
      await expect(page.getByText('客户资料已保存。')).toBeVisible()
      let view = await rootSession.api.post<CustomerView>('dcl/customer/get', {
        objectId: mutation.objectId,
      })
      expect(view.data.subunits[0]?.name).toBe(initialSubunitName)
      await rootSession.api.expectBusinessError(
        'dcl/customer/save-subunits',
        {
          objectId: view.objectId,
          approvalEntryId: view.approval.approvalEntryId,
          approvalRevision: view.approval.revision,
          subunits: [
            {
              ...subunit,
              subunitId: view.data.subunits[0]!.subunitId,
            },
          ],
        },
        'forbidden',
      )

      const subunitSession = await apiSession(subunitMaintainer)
      sessions.push(subunitSession)
      await signInFresh(page, subunitMaintainer)
      await openCustomerAction(page, name, '继续编辑草稿')
      drawer = page.locator('.v-navigation-drawer--right')
      await expect(
        drawer.getByLabel('法定名称', { exact: true }),
      ).not.toBeEditable()
      await expect(
        drawer.getByRole('button', { name: '新增子单位', exact: true }),
      ).toBeVisible()
      await expect(
        drawer.getByRole('button', { name: '保存客户资料', exact: true }),
      ).toHaveCount(0)
      const changedSubunitName = `${initialSubunitName} 已维护`
      view = await subunitSession.api.post<CustomerView>('dcl/customer/get', {
        objectId: mutation.objectId,
      })
      await subunitSession.api.post<CustomerMutation>(
        'dcl/customer/save-subunits',
        {
          objectId: view.objectId,
          approvalEntryId: view.approval.approvalEntryId,
          approvalRevision: view.approval.revision,
          subunits: [
            {
              ...subunit,
              subunitId: view.data.subunits[0]!.subunitId,
              name: changedSubunitName,
            },
          ],
        },
      )
      view = await subunitSession.api.post<CustomerView>('dcl/customer/get', {
        objectId: mutation.objectId,
      })
      await page.reload()
      await openCustomerAction(page, name, '继续编辑草稿')
      drawer = page.locator('.v-navigation-drawer--right')
      await expect(drawer).toContainText(changedSubunitName)
      expect(view.data.subunits[0]?.name).toBe(changedSubunitName)
      await subunitSession.api.expectBusinessError(
        'dcl/customer/save',
        {
          objectId: view.objectId,
          approvalEntryId: view.approval.approvalEntryId,
          approvalRevision: view.approval.revision,
          data: root,
        },
        'forbidden',
      )

      const readonlySession = await apiSession(readonlyUser)
      sessions.push(readonlySession)
      await signInFresh(page, readonlyUser)
      await openCustomerAction(page, name, '查看')
      drawer = page.locator('.v-navigation-drawer--right')
      await expect(
        drawer.getByLabel('法定名称', { exact: true }),
      ).not.toBeEditable()
      await expect(
        drawer.getByRole('button', { name: '保存客户资料', exact: true }),
      ).toHaveCount(0)
      await expect(
        drawer.getByRole('button', {
          name: '保存客户子单位',
          exact: true,
        }),
      ).toHaveCount(0)
      await expect(
        drawer.getByRole('button', { name: '查看', exact: true }),
      ).toBeVisible()
      await expect(drawer).toContainText(changedSubunitName)
      await readonlySession.api.expectBusinessError(
        'dcl/customer/save',
        {
          objectId: view.objectId,
          approvalEntryId: view.approval.approvalEntryId,
          approvalRevision: view.approval.revision,
          data: root,
        },
        'forbidden',
      )
      await readonlySession.api.expectBusinessError(
        'dcl/customer/save-subunits',
        {
          objectId: view.objectId,
          approvalEntryId: view.approval.approvalEntryId,
          approvalRevision: view.approval.revision,
          subunits: [
            {
              ...subunit,
              subunitId: view.data.subunits[0]!.subunitId,
              name: changedSubunitName,
            },
          ],
        },
        'forbidden',
      )

      mutation = await operator.api.post<CustomerMutation>(
        'dcl/customer/submit',
        {
          objectId: view.objectId,
          approvalEntryId: view.approval.approvalEntryId,
          approvalRevision: view.approval.revision,
        },
      )
      const approverSession = await apiSession(approver)
      sessions.push(approverSession)
      const approverView = await approverSession.api.post<CustomerView>(
        'dcl/customer/get',
        { objectId: mutation.objectId },
      )
      expect(approverView.data.subunits[0]?.name).toBe(changedSubunitName)
      await signInFresh(page, approver)
      await assertCustomerAction(page, name, '批准')
      await approverSession.api.post<CustomerMutation>('dcl/customer/approve', {
        objectId: mutation.objectId,
        approvalEntryId: mutation.approval.approvalEntryId,
        approvalRevision: mutation.approval.revision,
      })
      await page.reload()
      await assertCustomerAction(page, name, '查看')
      const row = page.getByRole('row').filter({ hasText: name })
      await expect(row).toContainText('已批准')
    } finally {
      for (const session of sessions.reverse()) await session.dispose()
      await reviewer.dispose()
      await operator.dispose()
      await administrator.dispose()
    }
  },
)
