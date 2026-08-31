import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient } from '@/api/client'
import { useBrandingStore } from '@/stores/branding'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn() },
}))

describe('branding store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(apiClient.postContract).mockReset()
  })

  it('读取公开企业名称并复用已加载结果', async () => {
    vi.mocked(apiClient.postContract).mockResolvedValue({
      data: { enterpriseName: '测试企业' },
      requestId: 'REQ-BRANDING-1',
    } as never)
    const branding = useBrandingStore()

    await branding.load()
    await branding.load()

    expect(apiClient.postContract).toHaveBeenCalledOnce()
    expect(apiClient.postContract).toHaveBeenCalledWith(
      'app/branding/get',
      {},
    )
    expect(branding.enterpriseName).toBe('测试企业')
    expect(branding.errorMessage).toBeNull()
  })

  it('失败时不伪造企业名称并允许强制重试', async () => {
    vi.mocked(apiClient.postContract)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        data: { enterpriseName: '恢复企业' },
        requestId: 'REQ-BRANDING-2',
      } as never)
    const branding = useBrandingStore()

    await branding.load()

    expect(branding.enterpriseName).toBe('')
    expect(branding.errorMessage).toContain('企业名称加载失败')

    await branding.load(true)

    expect(branding.enterpriseName).toBe('恢复企业')
    expect(branding.errorMessage).toBeNull()
  })
})
