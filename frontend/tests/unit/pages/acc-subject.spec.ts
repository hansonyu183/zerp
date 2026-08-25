import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { createAccountingSubjectViewModel } from '@/pages/acc/subject/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn() },
}))

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
const subject = {
  subjectId: '01JACC00000000000000000002',
  bookId: book.bookId,
  code: '1405',
  name: '库存商品',
  parentSubjectId: null,
  balanceDirection: 'DEBIT' as const,
  enabled: true,
  leaf: true,
  requiredDimensions: ['PRODUCT', 'WAREHOUSE'] as const,
  inventoryQuantity: true,
  settlementPurpose: 'NONE' as const,
  referenced: false,
  revision: 1,
}

describe('ACC accounting subject view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useSessionStore().permissions = [
      '/acc/book/query',
      '/acc/subject/query',
      '/acc/subject/get',
      '/acc/subject/create',
      '/acc/subject/save',
      '/acc/subject/delete',
    ]
  })

  it('loads visible books then queries subjects within the selected book', async () => {
    mockedPost
      .mockResolvedValueOnce({
        data: { items: [book], total: 1, page: 1, pageSize: 200 },
      })
      .mockResolvedValueOnce({
        data: { items: [subject], total: 1, page: 1, pageSize: 200 },
      })
    const vm = createAccountingSubjectViewModel()

    await vm.initialize()

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'acc/book/query', {
      page: 1,
      pageSize: 200,
    })
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'acc/subject/query', {
      bookId: book.bookId,
      page: 1,
      pageSize: 200,
    })
    expect(vm.rows).toEqual([subject])
  })

  it('validates quantity dimensions and creates a leaf subject', async () => {
    mockedPost
      .mockResolvedValueOnce({
        data: { items: [book], total: 1, page: 1, pageSize: 200 },
      })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 200 },
      })
      .mockResolvedValueOnce({ data: subject })
      .mockResolvedValueOnce({
        data: { items: [subject], total: 1, page: 1, pageSize: 200 },
      })
    const vm = createAccountingSubjectViewModel()
    await vm.initialize()
    vm.openCreate()
    vm.form.code = '1405'
    vm.form.name = '库存商品'
    vm.form.inventoryQuantity = true
    vm.form.requiredDimensions = ['PRODUCT']
    expect(vm.validationError).toContain('商品和仓库')
    vm.form.requiredDimensions = ['PRODUCT', 'WAREHOUSE']

    await vm.save()

    expect(mockedPost).toHaveBeenNthCalledWith(3, 'acc/subject/create', {
      bookId: book.bookId,
      code: '1405',
      name: '库存商品',
      balanceDirection: 'DEBIT',
      enabled: true,
      requiredDimensions: ['PRODUCT', 'WAREHOUSE'],
      inventoryQuantity: true,
      settlementPurpose: 'NONE',
    })
  })
})
