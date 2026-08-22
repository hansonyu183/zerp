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
    const first = deferred<{ data: never[] }>()
    const second = deferred<{
      data: Array<{
        objectId: string
        versionId: string
        code: string
        name: string
        behaviorProfile: 'RAW_MATERIAL'
      }>
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
      data: [
        {
          objectId: 'NEW',
          versionId: 'NEW-V1',
          code: 'RM-002',
          name: '新原料',
          behaviorProfile: 'RAW_MATERIAL',
        },
      ],
    })
    await currentRequest
    first.resolve({ data: [] })
    await staleRequest

    expect(search.options.value.map((item) => item.objectId)).toEqual([
      'SELECTED',
      'NEW',
    ])
    expect(mockedPost).toHaveBeenLastCalledWith(
      'bob/reference/query',
      expect.objectContaining({
        entity: 'product',
        behaviorProfile: 'RAW_MATERIAL',
        keyword: 'new',
      }),
    )
    scope.stop()
  })
})
