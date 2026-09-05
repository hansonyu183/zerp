import { describe, expect, it, vi } from 'vitest'

vi.mock('@/target/api.ts', () => ({
  getTargetAccMappingCurrent: vi.fn(),
  queryTargetAccBooks: vi.fn(),
  queryTargetAccMappingCatalog: vi.fn(),
  queryTargetAccMappingCurrent: vi.fn(),
}))
vi.mock('@/target/session/vm.ts', () => ({ useTargetSession: vi.fn() }))

import { createAccMappingViewModel } from '@/target/pages/acc/mapping/vm.ts'

function ports() {
  return {
    books: vi.fn().mockResolvedValue({
      items: [
        {
          id: '01K4A000000000000000000001',
          code: 'ACC-0001',
          name: '控制账簿',
          description: '',
          startMonth: '2026-08',
          baseCurrency: 'CNY',
          controlBook: true,
          revision: '1',
          queryUserIds: [],
          operateUserIds: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 200,
    }),
    catalog: vi.fn().mockResolvedValue({
      books: [],
      vouEntities: [{ id: 'sale-order', code: 'sale-order', name: '销售订单' }],
      subjects: [],
    }),
    query: vi.fn().mockResolvedValue({
      items: [
        {
          subjectId: '01K4A000000000000000000003',
          approvalEntryId: '01K4A000000000000000000002',
          approvalRevision: '1',
          book: {
            id: '01K4A000000000000000000001',
            code: 'ACC-0001',
            name: '控制账簿',
          },
          vouEntity: {
            id: 'sale-order',
            code: 'sale-order',
            name: '销售订单',
          },
          defaultResult: 'POST',
          definition: {
            defaultTemplateId: 'default',
            rules: [],
            templates: [],
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
    get: vi.fn().mockResolvedValue({
      subjectId: '01K4A000000000000000000003',
      approvalEntryId: '01K4A000000000000000000002',
      approvalRevision: '1',
      book: {
        id: '01K4A000000000000000000001',
        code: 'ACC-0001',
        name: '控制账簿',
      },
      vouEntity: { id: 'sale-order', code: 'sale-order', name: '销售订单' },
      defaultResult: 'POST',
      definition: { defaultTemplateId: 'default', rules: [], templates: [] },
    }),
  }
}

describe('ACC current mapping public view-model seam', () => {
  it('queries only current approved mappings and reads the selected typed definition', async () => {
    const api = ports()
    const vm = createAccMappingViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: [
          '/acc/book/query',
          '/acc/mapping/query',
          '/acc/mapping/get',
          '/acc/mapping/catalog',
          '/dcl/acc-mapping/query',
        ],
      },
      api,
    )
    await vm.initialize()
    vm.vouEntity.value = 'sale-order'
    await vm.query(1)
    await vm.open(vm.items.value[0]!)

    expect(api.query).toHaveBeenLastCalledWith('csrf-token', {
      bookId: '01K4A000000000000000000001',
      vouEntity: 'sale-order',
      page: 1,
      pageSize: 20,
    })
    expect(vm.detail.value?.definition.defaultTemplateId).toBe('default')
    expect(vm.canMaintain.value).toBe(true)
    expect(vm.maintenanceRoute).toBe('/dcl/acc-mapping')
    expect(Object.keys(vm)).not.toContain('save')
    expect(Object.keys(vm)).not.toContain('approve')
  })
})
