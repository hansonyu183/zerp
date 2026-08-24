import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  activateMenu,
  getMenu,
  resetBusinessMenu,
  saveBusinessMenu,
} from '@/api/menu'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn() },
}))

describe('menu API', () => {
  beforeEach(() => vi.mocked(apiClient.postContract).mockReset())

  it('使用固定 APP 菜单端点读取、保存、切换和恢复', async () => {
    vi.mocked(apiClient.postContract).mockResolvedValue({ data: null })

    await getMenu()
    await saveBusinessMenu({ revision: 2, items: [] })
    await activateMenu({ mode: 'BUSINESS', revision: 3 })
    await resetBusinessMenu({ revision: 4 })

    expect(apiClient.postContract).toHaveBeenNthCalledWith(
      1,
      'app/menu/get',
      {},
    )
    expect(apiClient.postContract).toHaveBeenNthCalledWith(
      2,
      'app/menu/save-business',
      { revision: 2, items: [] },
    )
    expect(apiClient.postContract).toHaveBeenNthCalledWith(
      3,
      'app/menu/activate',
      { mode: 'BUSINESS', revision: 3 },
    )
    expect(apiClient.postContract).toHaveBeenNthCalledWith(
      4,
      'app/menu/reset-business',
      { revision: 4 },
    )
  })
})
