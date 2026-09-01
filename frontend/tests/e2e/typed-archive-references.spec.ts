import { request, type APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'

test.describe.configure({ mode: 'serial' })
test.use({ storageState: { cookies: [], origins: [] } })

interface Envelope<T> {
  code: number | string
  message: string
  data: T
}

interface ReferenceCandidate {
  objectId: string
  customerId?: string
  approvalEntryId: string
  code: string
  name: string
}

interface ApprovalMutation {
  documentId: string
  approval: { revision: number }
}

interface ApprovalMeta {
  status: 'DRAFT' | 'PENDING' | 'APPROVED'
  revision: number
}

interface ServiceContractView {
  documentId: string
  data: {
    serviceContract: {
      counterparty: ReferenceCandidate & { entity: string }
      handler: ReferenceCandidate & { entity: string }
    }
  }
}

interface BookView {
  bookId: string
}

interface SubjectView {
  subjectId: string
}

interface OpeningView {
  approval: ApprovalMeta
  lines: Array<{
    dimensionReferences: Record<
      string,
      ReferenceCandidate & { entity: string }
    >
  }>
}

interface UserPage {
  items: Array<{ id: string; username: string }>
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
    expect(
      String(envelope.code),
      `${path}: ${envelope.message}; request=${JSON.stringify(data)}`,
    ).toBe('0')
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

async function oneReference(
  api: Api,
  entity: string,
  keyword: string,
): Promise<ReferenceCandidate> {
  const candidates = await api.post<ReferenceCandidate[]>(
    'bob/reference/query',
    { entity, keyword },
  )
  const candidate = candidates[0]
  if (!candidate) throw new Error(`${entity} E2E 缺少可用的类型化档案。`)
  return candidate
}

test('真实 API 保存服务合同类型化对手方精确快照', async ({
  workerState,
}) => {
  const operator = await apiSession(workerState.operator)
  try {
    const counterparty = await oneReference(
      operator.api,
      'other-unit',
      workerState.fixtures.carrier,
    )
    const handler = await oneReference(
      operator.api,
      'employee',
      workerState.fixtures.employee,
    )
    const created = await operator.api.post<ApprovalMutation>(
      'vou/service-contract/create',
      {
        data: {
          businessDate: '2098-01-01',
          currency: 'CNY',
          counterpartyType: 'other-unit',
          counterparty: {
            objectId: counterparty.objectId,
            approvalEntryId: counterparty.approvalEntryId,
          },
          handler: {
            objectId: handler.objectId,
            approvalEntryId: handler.approvalEntryId,
          },
          serviceContract: { terms: 'E2E 类型化档案快照' },
        },
      },
    )
    const view = await operator.api.post<ServiceContractView>(
      'vou/service-contract/get',
      { documentId: created.documentId },
    )
    expect(view.data.serviceContract.counterparty).toMatchObject({
      entity: 'other-unit',
      objectId: counterparty.objectId,
      approvalEntryId: counterparty.approvalEntryId,
      code: counterparty.code,
      name: counterparty.name,
    })
    expect(view.data.serviceContract.handler).toMatchObject({
      entity: 'employee',
      objectId: handler.objectId,
      approvalEntryId: handler.approvalEntryId,
    })
  } finally {
    await operator.dispose()
  }
})

test('真实 API 保存并历史读取 ACC Customer Account 类型化维度', async ({
  workerState,
}) => {
  const operator = await apiSession(workerState.operator)
  const reviewer = await apiSession(workerState.reviewer)
  try {
    const account = await oneReference(
      operator.api,
      'customer-account',
      workerState.fixtures.customer,
    )
    if (!account.customerId) {
      throw new Error('Customer Account E2E 缺少 customerId。')
    }
    const users = await operator.api.post<UserPage>('app/user/query', {
      page: 1,
      pageSize: 20,
      filters: { search: workerState.reviewer.username },
      sort: [{ field: 'username', order: 'asc' }],
    })
    const reviewerUser = users.items.find(
      (item) => item.username === workerState.reviewer.username,
    )
    if (!reviewerUser) throw new Error('ACC E2E 未找到复核员。')

    const suffix = `${Date.now()}-${test.info().parallelIndex}`
    const book = await operator.api.post<BookView>('acc/book/create', {
      name: `E2E 类型化期初 ${suffix}`,
      startMonth: '2098-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [reviewerUser.id],
      operateUserIds: [reviewerUser.id],
    })
    const receivable = await operator.api.post<SubjectView>(
      'acc/subject/create',
      {
        bookId: book.bookId,
        code: '119901',
        name: 'E2E 客户应收',
        balanceDirection: 'DEBIT',
        enabled: true,
        requiredDimensions: ['CUSTOMER_ACCOUNT'],
        inventoryQuantity: false,
        settlementPurpose: 'RECEIVABLE',
      },
    )
    const equity = await operator.api.post<SubjectView>('acc/subject/create', {
      bookId: book.bookId,
      code: '399901',
      name: 'E2E 期初平衡',
      balanceDirection: 'CREDIT',
      enabled: true,
      requiredDimensions: [],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
    })
    const reference = {
      entity: 'customer-account',
      objectId: account.objectId,
      customerId: account.customerId,
      approvalEntryId: account.approvalEntryId,
      code: account.code,
      name: account.name,
    }
    const saved = await operator.api.post<OpeningView>('acc/opening/save', {
      bookId: book.bookId,
      revision: 0,
      lines: [
        {
          subjectId: receivable.subjectId,
          currency: 'CNY',
          debitAmount: '100.00',
          creditAmount: '0.00',
          dimensions: { CUSTOMER_ACCOUNT: account.objectId },
          dimensionReferences: { CUSTOMER_ACCOUNT: reference },
        },
        {
          subjectId: equity.subjectId,
          currency: 'CNY',
          debitAmount: '0.00',
          creditAmount: '100.00',
          dimensions: {},
          dimensionReferences: {},
        },
      ],
      assets: [],
      bills: [],
      containers: [],
    })
    const pending = await operator.api.post<OpeningView>(
      'acc/opening/submit',
      { bookId: book.bookId, revision: saved.approval.revision },
    )
    await reviewer.api.post<OpeningView>('acc/opening/approve', {
      bookId: book.bookId,
      revision: pending.approval.revision,
    })
    const historical = await operator.api.post<OpeningView>(
      'acc/opening/query',
      { bookId: book.bookId },
    )
    expect(historical.approval.status).toBe('APPROVED')
    expect(historical.lines[0]?.dimensionReferences.CUSTOMER_ACCOUNT).toEqual(
      reference,
    )
  } finally {
    await reviewer.dispose()
    await operator.dispose()
  }
})
