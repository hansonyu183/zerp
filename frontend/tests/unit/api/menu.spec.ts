import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  activateMenu,
  getMenu,
  resetBusinessMenu,
  saveBusinessMenu,
} from '@/api/menu'

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

describe('menu API', () => {
  beforeEach(() => vi.mocked(apiClient.post).mockReset())

  it('使用固定 APP 菜单端点读取、保存、切换和恢复', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: null })

    await getMenu()
    await saveBusinessMenu({ revision: 2, items: [] })
    await activateMenu({ mode: 'BUSINESS_TEMPLATE', revision: 3 })
    await resetBusinessMenu({ revision: 4 })

    expect(apiClient.post).toHaveBeenNthCalledWith(1, 'app/menu/get', {})
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      'app/menu/save-business-template',
      { revision: 2, items: [] },
    )
    expect(apiClient.post).toHaveBeenNthCalledWith(3, 'app/menu/activate', {
      mode: 'BUSINESS_TEMPLATE',
      revision: 3,
    })
    expect(apiClient.post).toHaveBeenNthCalledWith(
      4,
      'app/menu/reset-business-template',
      { revision: 4 },
    )
  })
})
