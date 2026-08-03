import { effectScope } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useProductReferenceSearch } from '@/composables/use-product-reference-search'

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

const mockedPost = vi.mocked(apiClient.post)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('useProductReferenceSearch', () => {
  it('keeps selected references and ignores stale search responses', async () => {
    const first = deferred<{
      data: { items: never[]; total: number; page: number; pageSize: number }
    }>()
    const second = deferred<{
      data: {
        items: Array<{
          objectId: string
          code: string
          currentVersion: {
            versionId: string
            summary: { name: string; productKind: string }
          }
        }>
        total: number
        page: number
        pageSize: number
      }
    }>()
    mockedPost
      .mockReturnValueOnce(first.promise as ReturnType<typeof apiClient.post>)
      .mockReturnValueOnce(second.promise as ReturnType<typeof apiClient.post>)

    const selected = {
      objectId: 'SELECTED',
      versionId: 'SELECTED-V1',
      entity: 'product',
      code: 'RM-001',
      name: '已选原料',
    }
    const scope = effectScope()
    const search = scope.run(() =>
      useProductReferenceSearch('RAW_MATERIAL', () => [selected]),
    )!

    const staleRequest = search.search('old')
    const currentRequest = search.search('new')
    second.resolve({
      data: {
        items: [
          {
            objectId: 'NEW',
            code: 'RM-002',
            currentVersion: {
              versionId: 'NEW-V1',
              summary: { name: '新原料', productKind: 'RAW_MATERIAL' },
            },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 100,
      },
    })
    await currentRequest
    first.resolve({ data: { items: [], total: 0, page: 1, pageSize: 100 } })
    await staleRequest

    expect(search.options.value.map((item) => item.objectId)).toEqual([
      'SELECTED',
      'NEW',
    ])
    expect(mockedPost).toHaveBeenLastCalledWith(
      'bob/product/query',
      expect.objectContaining({
        filters: expect.objectContaining({ keyword: 'new' }),
      }),
    )
    scope.stop()
  })
})
