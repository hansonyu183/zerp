import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useBobCustomerViewModel } from '@/pages/bob/customer/vm'
import { useBobCustomerAccountViewModel } from '@/pages/bob/customer-account/vm'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

describe('BOB customer current views', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('customer page only calls current query/get', async () => {
    mockedPost
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
      .mockResolvedValueOnce({ data: null })
    const vm = useBobCustomerViewModel()
    await vm.query()
    await vm.openById('CUR-1')

    expect(mockedPost.mock.calls.map(([path]) => String(path))).toEqual([
      'bob/customer/query',
      'bob/customer/get',
    ])
    expect('save' in vm).toBe(false)
    expect('openCreate' in vm).toBe(false)
  })

  it('account page never exposes an open candidate', async () => {
    mockedPost
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
      .mockResolvedValueOnce({ data: null })
    const vm = useBobCustomerAccountViewModel()
    await vm.query()
    await vm.openById('CAC-1')

    expect(mockedPost.mock.calls.map(([path]) => String(path))).toEqual([
      'bob/customer-account/query',
      'bob/customer-account/get',
    ])
    expect('runAction' in vm).toBe(false)
  })
})
