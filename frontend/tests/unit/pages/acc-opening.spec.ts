import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { createAccountingOpeningViewModel } from '@/pages/acc/opening/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))

const mockedPost = vi.mocked(apiClient.postContract)
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
function createDraftOpening() {
  return {
    bookId: book.bookId,
    approval: {
      status: 'DRAFT' as const,
      revision: 1,
      createdBy: '01JACC00000000000000000009',
      createdAt: '2026-01-01T00:00:00Z',
      updatedBy: '01JACC00000000000000000009',
      updatedAt: '2026-01-01T00:00:00Z',
      submittedBy: null,
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
    },
    availableApprovalActions: ['submit'] as const,
    voucherId: null,
    lines: [],
    assets: [],
    bills: [],
    containers: [],
  }
}

let draft: ReturnType<typeof createDraftOpening>

describe.sequential('ACC opening view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockedPost.mockReset()
    draft = createDraftOpening()
    useSessionStore().permissions = [
      '/acc/book/query',
      '/acc/subject/query',
      '/acc/opening/query',
      '/acc/opening/save',
      '/acc/opening/submit',
      '/acc/opening/approve',
      '/acc/opening/unapprove',
    ]
  })

  it.sequential(
    'loads one book opening and permits explicit zero approval',
    async () => {
      mockedPost
        .mockResolvedValueOnce({ data: { items: [book], total: 1 } })
        .mockResolvedValueOnce({ data: { items: subjects, total: 1 } })
        .mockResolvedValueOnce({ data: draft })
        .mockResolvedValueOnce({
          data: {
            ...draft,
            approval: { ...draft.approval, status: 'PENDING', revision: 2 },
            availableApprovalActions: [],
          },
        })
        .mockResolvedValueOnce({
          data: {
            ...draft,
            approval: { ...draft.approval, status: 'APPROVED', revision: 3 },
            voucherId: '01JACC00000000000000000003',
          },
        })
      const vm = createAccountingOpeningViewModel()

      await vm.initialize()
      expect(vm.availableApprovalActions).toEqual(['submit'])
      await vm.approvalAction('submit')

      expect(mockedPost).toHaveBeenNthCalledWith(4, 'acc/opening/submit', {
        bookId: book.bookId,
        revision: 1,
      })
      expect(vm.opening?.approval.status).toBe('PENDING')
      expect(vm.canEdit).toBe(false)
      expect(vm.availableApprovalActions).toEqual([])
    },
  )

  it.sequential(
    'never restores a lifecycle action from local status or permission',
    async () => {
      mockedPost
        .mockResolvedValueOnce({ data: { items: [book], total: 1 } })
        .mockResolvedValueOnce({ data: { items: subjects, total: 1 } })
        .mockResolvedValueOnce({
          data: { ...draft, availableApprovalActions: [] },
        })
      const vm = createAccountingOpeningViewModel()

      await vm.initialize()

      expect(vm.availableApprovalActions).toEqual([])
    },
  )

  it.sequential(
    'keeps server submit eligibility while requiring unsaved edits to save first',
    async () => {
      mockedPost.mockImplementation(async (path) => {
        if (path === 'acc/book/query')
          return { data: { items: [book], total: 1 } } as never
        if (path === 'acc/subject/query')
          return { data: { items: subjects, total: 1 } } as never
        if (path === 'acc/opening/query') return { data: draft } as never
        return {
          data: { ...draft, approval: { ...draft.approval, revision: 2 } },
        } as never
      })
      const vm = createAccountingOpeningViewModel()
      await vm.initialize()
      expect(vm.availableApprovalActions).toEqual(['submit'])
      vm.subjects = [...subjects] as typeof vm.subjects
      vm.addLine()
      vm.changeSubject(vm.lines[0]!, subjects[0]!.subjectId)
      vm.lines[0]!.debitAmount = '100.00'
      expect(vm.validationError).toContain('辅助核算')
      expect(vm.availableApprovalActions).toEqual(['submit'])

      await vm.approvalAction('submit')

      expect(mockedPost).toHaveBeenCalledTimes(3)
      expect(vm.errorMessage).toBe('请先保存当前期初修改。')
      vm.lines[0]!.dimensions.FUND_ACCOUNT = '01JACC00000000000000000901'

      expect(vm.validationError).toBe('')
    },
  )

  it.sequential(
    'saves opening global register values with the draft',
    async () => {
      mockedPost.mockImplementation(async (path) => {
        if (path === 'acc/book/query')
          return { data: { items: [book], total: 1 } } as never
        if (path === 'acc/subject/query')
          return { data: { items: subjects, total: 1 } } as never
        if (path === 'acc/opening/query') return { data: draft } as never
        return {
          data: { ...draft, approval: { ...draft.approval, revision: 2 } },
        } as never
      })
      const vm = createAccountingOpeningViewModel()
      await vm.initialize()
      vm.addContainer()
      vm.containers[0]!.customerId = '01JACC00000000000000000901'
      vm.containers[0]!.quantity = 8

      await vm.save()

      expect(mockedPost).toHaveBeenNthCalledWith(
        4,
        'acc/opening/save',
        expect.objectContaining({
          assets: [],
          bills: [],
          containers: [
            {
              customerId: '01JACC00000000000000000901',
              containerType: 'SOLVENT',
              quantity: 8,
            },
          ],
        }),
      )
    },
  )
})
