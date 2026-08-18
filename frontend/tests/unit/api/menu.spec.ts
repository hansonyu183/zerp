import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  activateMenu,
  getMenu,
  publishBusinessMenu,
  resetBusinessMenu,
  saveBusinessMenu,
} from '@/api/menu'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn() },
}))

describe('menu API', () => {
  beforeEach(() => vi.mocked(apiClient.postContract).mockReset())

  it('使用固定 APP 菜单端点读取、保存草稿、发布、切换和恢复草稿', async () => {
    vi.mocked(apiClient.postContract).mockResolvedValue({ data: null })

    await getMenu()
    await saveBusinessMenu({
      revision: 2,
      catalogRevision: 'catalog-1',
      items: [],
    })
    await publishBusinessMenu({ revision: 2, catalogRevision: 'catalog-1' })
    await activateMenu({
      mode: 'BUSINESS_TEMPLATE',
      revision: 3,
      catalogRevision: 'catalog-1',
    })
    await resetBusinessMenu({ revision: 4, catalogRevision: 'catalog-1' })

    expect(apiClient.postContract).toHaveBeenNthCalledWith(
      1,
      'app/menu/get',
      {},
    )
    expect(apiClient.postContract).toHaveBeenNthCalledWith(
      2,
      'app/menu/save-business-template',
      { revision: 2, catalogRevision: 'catalog-1', items: [] },
    )
    expect(apiClient.postContract).toHaveBeenNthCalledWith(
      3,
      'app/menu/publish-business-template',
      {
        revision: 2,
        catalogRevision: 'catalog-1',
      },
    )
    expect(apiClient.postContract).toHaveBeenNthCalledWith(
      4,
      'app/menu/activate',
      {
        mode: 'BUSINESS_TEMPLATE',
        revision: 3,
        catalogRevision: 'catalog-1',
      },
    )
    expect(apiClient.postContract).toHaveBeenNthCalledWith(
      5,
      'app/menu/reset-business-template',
      { revision: 4, catalogRevision: 'catalog-1' },
    )
  })
})
