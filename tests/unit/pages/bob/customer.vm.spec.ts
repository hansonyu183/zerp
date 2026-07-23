import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useCustomerViewModel } from '@/pages/bob/customer/vm'

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}))

const mockedApiClient = vi.mocked(apiClient)

describe('useCustomerViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('通过 bob/customer/query 查询客户列表', async () => {
    mockedApiClient.post.mockResolvedValue({
      data: {
        items: [{ id: 'C-1', code: 'C001', name: '华东客户', status: 'EFFECTIVE' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })

    const vm = useCustomerViewModel()
    vm.keyword.value = '华东'
    await vm.query()

    expect(mockedApiClient.post).toHaveBeenCalledWith('bob/customer/query', {
      page: 1,
      pageSize: 20,
      filters: { keyword: '华东' },
      sort: [{ field: 'updatedAt', order: 'desc' }],
    })
    expect(vm.rows.value).toHaveLength(1)
    expect(vm.total.value).toBe(1)
    expect(vm.getStatusText('EFFECTIVE')).toBe('有效')
  })

  it('查询失败时清空列表并暴露错误', async () => {
    mockedApiClient.post.mockRejectedValue(new Error('network down'))

    const vm = useCustomerViewModel()
    vm.rows.value = [{ id: 'C-1' }]
    await vm.query()

    expect(vm.rows.value).toEqual([])
    expect(vm.total.value).toBe(0)
    expect(vm.errorMessage.value).toBe('network down')
  })
})
