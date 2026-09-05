import { describe, expect, it, vi } from 'vitest'

import { createWflProcessDefinitionViewModel } from '@/target/pages/wfl/process-definition/vm.ts'

const definition = {
  subjectId: '01K4A000000000000000000001',
  approvalEntryId: '01K4A000000000000000000002',
  code: 'purchase-flow',
  name: '采购流程',
  enabled: true,
  compiledGraph: {
    code: 'purchase-flow',
    name: '采购流程',
    rootKey: 'order',
    nodes: [{ key: 'order', name: '采购订单', entity: 'purchase-order' }],
    edges: [],
  },
}

describe('WFL current definition public view-model seam', () => {
  it('passes fixed pagination and keyword, then opens the exact current definition', async () => {
    const ports = {
      query: vi.fn().mockResolvedValue({
        items: [definition],
        total: 1,
        page: 2,
        pageSize: 20,
      }),
      get: vi.fn().mockResolvedValue(definition),
    }
    const vm = createWflProcessDefinitionViewModel(
      {
        csrfToken: 'csrf-token',
        permissions: [
          '/wfl/process-definition/query',
          '/wfl/process-definition/get',
        ],
      },
      ports,
    )

    vm.keyword.value = ' 采购 '
    await vm.query(2)
    await vm.open(definition)

    expect(ports.query).toHaveBeenCalledWith('csrf-token', {
      page: 2,
      pageSize: 20,
      keyword: '采购',
    })
    expect(ports.get).toHaveBeenCalledWith('csrf-token', 'purchase-flow')
    expect(vm.selected.value).toEqual(definition)
  })
})
