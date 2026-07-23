import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import { mockServer } from '../../mocks/server'

describe('ApiClient', () => {
  it('通过 POST、Cookie 凭证和 CSRF 调用三级真实 API 契约', async () => {
    let credentials: RequestCredentials | undefined
    let csrfToken: string | null = null

    mockServer.use(
      http.post('https://api.test/app/user/session', ({ request }) => {
        credentials = request.credentials
        csrfToken = request.headers.get('X-CSRF-Token')
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { user: { id: '1' } },
          requestId: 'req-1',
        })
      }),
    )

    const client = new ApiClient({ baseUrl: 'https://api.test/' })
    client.setCsrfToken('csrf-test')

    const result = await client.post<{ user: { id: string } }>(
      'app/user/session',
      {},
    )

    expect(result.data.user.id).toBe('1')
    expect(result.requestId).toBe('req-1')
    expect(credentials).toBe('include')
    expect(csrfToken).toBe('csrf-test')
  })

  it('将非零业务码转换为包含 requestId 的业务错误', async () => {
    mockServer.use(
      http.post('https://api.test/vou/saleorder/save', () =>
        HttpResponse.json({
          code: 42201,
          message: '订单字段校验失败',
          data: null,
          requestId: 'req-2',
        }),
      ),
    )

    const client = new ApiClient({ baseUrl: 'https://api.test/' })
    const request = client.post('vou/saleorder/save', { id: 'SO-1' })

    await expect(request).rejects.toMatchObject<ApiError>({
      kind: 'business',
      code: 42201,
      requestId: 'req-2',
    })
  })

  it('拒绝不符合 domain/entity/action 的路径', async () => {
    const client = new ApiClient({ baseUrl: 'https://api.test/' })

    await expect(client.post('saleorder/save', {})).rejects.toMatchObject<ApiError>({
      kind: 'configuration',
    })
  })
})
