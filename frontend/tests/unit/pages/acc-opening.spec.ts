import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { createAccountingOpeningViewModel } from '@/pages/acc/opening/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn() } }))

const mockedPost = vi.mocked(apiClient.post)
const book = {
  bookId: '01JACC00000000000000000001',
  code: 'ACC-0001',
  name: '管理账簿',
  description: '',
  startMonth: '2026-08',
  baseCurrency: 'CNY',
  subjectTemplate: 'EMPTY' as const,
  controlBook: true,
  revision: 1,
  queryUserIds: [],
  operateUserIds: [],
}
const subjects = [
  {
    subjectId: '01JACC00000000000000000002',
    bookId: book.bookId,
    code: '1001',
    name: '库存现金',
    parentSubjectId: null,
    balanceDirection: 'DEBIT' as const,
    enabled: true,
    leaf: true,
    requiredDimensions: ['FUND_ACCOUNT'] as const,
    inventoryQuantity: false,
    settlementPurpose: 'NONE' as const,
    referenced: false,
    revision: 1,
  },
]
const draft = {
  bookId: book.bookId,
  state: 'DRAFT' as const,
  voucherId: null,
  revision: 0,
  approvedAt: null,
  approvedBy: null,
  lines: [],
}

describe('ACC opening view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useSessionStore().permissions = [
      '/acc/book/query',
      '/acc/subject/query',
      '/acc/opening/query',
      '/acc/opening/save',
      '/acc/opening/approve',
      '/acc/opening/unapprove',
    ]
  })

  it('loads one book opening and permits explicit zero approval', async () => {
    mockedPost
      .mockResolvedValueOnce({ data: { items: [book], total: 1 } })
      .mockResolvedValueOnce({ data: { items: subjects, total: 1 } })
      .mockResolvedValueOnce({ data: draft })
      .mockResolvedValueOnce({
        data: {
          ...draft,
          state: 'APPROVED',
          voucherId: '01JACC00000000000000000003',
          revision: 1,
        },
      })
    const vm = createAccountingOpeningViewModel()

    await vm.initialize()
    expect(vm.canApprove).toBe(true)
    await vm.approve()

    expect(mockedPost).toHaveBeenNthCalledWith(4, 'acc/opening/approve', {
      bookId: book.bookId,
      revision: 0,
    })
    expect(vm.opening?.state).toBe('APPROVED')
  })

  it('requires complete dimensions and a balanced saved draft', async () => {
    mockedPost
      .mockResolvedValueOnce({ data: { items: [book], total: 1 } })
      .mockResolvedValueOnce({ data: { items: subjects, total: 1 } })
      .mockResolvedValueOnce({ data: draft })
      .mockResolvedValueOnce({ data: { ...draft, revision: 1 } })
    const vm = createAccountingOpeningViewModel()
    await vm.initialize()
    vm.addLine()
    vm.changeSubject(vm.lines[0]!, subjects[0]!.subjectId)
    vm.lines[0]!.debitAmount = '100.00'
    expect(vm.validationError).toContain('辅助核算')
    vm.lines[0]!.dimensions.FUND_ACCOUNT = '01JACC00000000000000000901'

    await vm.save()

    expect(mockedPost).toHaveBeenNthCalledWith(4, 'acc/opening/save', {
      bookId: book.bookId,
      revision: 0,
      lines: [
        {
          subjectId: subjects[0]!.subjectId,
          currency: 'CNY',
          debitAmount: '100.00',
          creditAmount: '0.00',
          dimensions: {
            FUND_ACCOUNT: '01JACC00000000000000000901',
          },
        },
      ],
    })
  })
})
