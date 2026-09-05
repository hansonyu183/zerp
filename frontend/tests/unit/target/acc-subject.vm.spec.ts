import { describe, expect, it, vi } from 'vitest'

import { createAccSubjectViewModel } from '@/target/pages/acc/subject/vm.ts'

const book = {
  id: '01K4A000000000000000000001',
  code: 'ACC-0001',
  name: '业务控制账簿',
  description: '',
  startMonth: '2026-08',
  baseCurrency: 'CNY',
  controlBook: true,
  revision: '1',
  queryUserIds: [],
  operateUserIds: [],
}
const subject = {
  id: '01K4A000000000000000000002',
  bookId: book.id,
  code: '1405',
  name: '库存商品',
  parentId: null,
  balanceDirection: 'DEBIT' as const,
  enabled: true,
  requiredDimensions: ['PRODUCT', 'WAREHOUSE'] as const,
  inventoryQuantity: true,
  settlementPurpose: 'NONE' as const,
  revision: '1',
}

function ports() {
  return {
    books: vi
      .fn()
      .mockResolvedValue({ items: [book], total: 1, page: 1, pageSize: 200 }),
    query: vi
      .fn()
      .mockResolvedValue({ items: [subject], total: 1, page: 1, pageSize: 20 }),
    create: vi.fn().mockResolvedValue(subject),
    save: vi.fn().mockResolvedValue(subject),
    delete: vi
      .fn()
      .mockResolvedValue({ id: subject.id, deleted: true as const }),
    id: () => '01K4A000000000000000000099',
  }
}

describe('ACC subject public view-model seam', () => {
  it('queries the selected book and enforces the closed inventory and settlement dimensions', async () => {
    const api = ports()
    const vm = createAccSubjectViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: [
          '/acc/book/query',
          '/acc/subject/query',
          '/acc/subject/create',
        ],
      },
      api,
    )
    await vm.initialize()
    vm.openCreate()
    Object.assign(vm.form, {
      code: '1405',
      name: '库存商品',
      inventoryQuantity: true,
      requiredDimensions: ['PRODUCT'],
      settlementPurpose: 'NONE',
    })
    expect(vm.validationError.value).toBe(
      '数量核算必须同时选择商品和仓库辅助核算。',
    )

    vm.form.inventoryQuantity = false
    vm.form.settlementPurpose = 'OTHER'
    vm.form.requiredDimensions = ['DEPARTMENT']
    expect(vm.validationError.value).toBe(
      '其他往来必须选择一种明确业务档案辅助核算。',
    )

    vm.form.requiredDimensions = ['OTHER_UNIT']
    expect(vm.validationError.value).toBe('')
  })

  it('retains the editor values when a subject mutation fails', async () => {
    const api = ports()
    api.create.mockRejectedValue(new Error('科目编码重复'))
    const vm = createAccSubjectViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: [
          '/acc/book/query',
          '/acc/subject/query',
          '/acc/subject/create',
        ],
      },
      api,
    )
    await vm.initialize()
    vm.openCreate()
    Object.assign(vm.form, {
      code: '1122',
      name: '应收账款',
      requiredDimensions: ['CUSTOMER_SUBUNIT'],
      settlementPurpose: 'RECEIVABLE',
    })

    await vm.submit()

    expect(vm.editorOpen.value).toBe(true)
    expect(vm.form.name).toBe('应收账款')
    expect(vm.error.value).toBe('科目编码重复')
  })
})
