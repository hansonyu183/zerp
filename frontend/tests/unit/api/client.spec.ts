import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiClient, type ApiPostPath } from '@/api/client'
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
      http.post('https://api.test/vou/sale-order/save', () =>
        HttpResponse.json({
          code: 42201,
          message: '订单字段校验失败',
          data: null,
          requestId: 'req-2',
        }),
      ),
    )

    const client = new ApiClient({ baseUrl: 'https://api.test/' })
    const request = client.post('vou/sale-order/save', {
      documentId: 'SO-1',
      revision: 1,
      data: {},
    })

    await expect(request).rejects.toMatchObject<ApiError>({
      kind: 'business',
      code: 42201,
      requestId: 'req-2',
    })
  })

  it('拒绝不符合 domain/entity/action 的路径', async () => {
    const client = new ApiClient({ baseUrl: 'https://api.test/' })

    await expect(
      client.post('saleorder/save' as ApiPostPath, {}),
    ).rejects.toMatchObject<ApiError>({
      kind: 'configuration',
    })
  })

  it('将生成契约中的实体模板展开为真实 BOB 路径', async () => {
    let requestedPath = ''
    mockServer.use(
      http.post('https://api.test/bob/customer/query', ({ request }) => {
        requestedPath = new URL(request.url).pathname
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { items: [], total: 0, page: 1, pageSize: 20 },
          requestId: 'req-bob',
        })
      }),
    )
    const client = new ApiClient({ baseUrl: 'https://api.test/' })

    await client.post('bob/customer/query', {
      page: 1,
      pageSize: 20,
      filters: {},
      sort: [],
    })

    expect(requestedPath).toBe('/bob/customer/query')
  })

  it('通过受限技术端点上传和下载附件', async () => {
    let uploadedType: string | null = null
    let uploaded = false
    mockServer.use(
      http.put(
        'https://api.test/files/attachments/upload/token-1',
        async ({ request }) => {
          uploadedType = request.headers.get('Content-Type')
          await request.arrayBuffer()
          uploaded = true
          return new HttpResponse(null, { status: 204 })
        },
      ),
      http.get(
        'https://api.test/files/attachments/download/token-2',
        () =>
          new HttpResponse('pdf-content', {
            status: 200,
            headers: { 'Content-Type': 'application/pdf' },
          }),
      ),
    )

    const client = new ApiClient({ baseUrl: 'https://api.test/' })
    await client.uploadAttachment(
      '/files/attachments/upload/token-1',
      new File(['png-content'], 'sample.png', { type: 'image/png' }),
    )
    const downloaded = await client.fetchAttachment(
      '/files/attachments/download/token-2',
    )

    expect(uploadedType).toBe('image/png')
    expect(uploaded).toBe(true)
    expect(await downloaded.text()).toBe('pdf-content')
  })

  it('在同源部署中从相对 API 基址解析附件地址', async () => {
    let uploaded = false
    mockServer.use(
      http.put(
        `${window.location.origin}/files/attachments/upload/token-relative`,
        async ({ request }) => {
          await request.arrayBuffer()
          uploaded = true
          return new HttpResponse(null, { status: 204 })
        },
      ),
    )

    const client = new ApiClient({ baseUrl: '/api/' })
    await client.uploadAttachment(
      '/files/attachments/upload/token-relative',
      new File(['pdf-content'], 'sample.pdf', { type: 'application/pdf' }),
    )

    expect(uploaded).toBe(true)
  })

  it('通过反馈专用技术端点上传截图', async () => {
    let uploadedType: string | null = null
    mockServer.use(
      http.put(
        'https://api.test/files/feedback/attachments/upload/feedback-token',
        async ({ request }) => {
          uploadedType = request.headers.get('Content-Type')
          await request.arrayBuffer()
          return new HttpResponse(null, { status: 204 })
        },
      ),
    )

    const client = new ApiClient({ baseUrl: 'https://api.test/' })
    await client.uploadFeedbackAttachment(
      '/files/feedback/attachments/upload/feedback-token',
      new File(['jpeg-content'], 'screen.jpg', { type: 'image/jpeg' }),
    )

    expect(uploadedType).toBe('image/jpeg')
  })

  it('拒绝跨源或错误前缀的附件令牌地址', async () => {
    const client = new ApiClient({ baseUrl: 'https://api.test/' })
    const file = new File(['x'], 'x.png', { type: 'image/png' })

    await expect(
      client.uploadAttachment(
        'https://evil.test/files/attachments/upload/x',
        file,
      ),
    ).rejects.toMatchObject<ApiError>({ kind: 'configuration' })
    await expect(
      client.fetchAttachment('/files/attachments/upload/x'),
    ).rejects.toMatchObject<ApiError>({ kind: 'configuration' })
    await expect(
      client.uploadFeedbackAttachment('/files/attachments/upload/x', file),
    ).rejects.toMatchObject<ApiError>({ kind: 'configuration' })
  })

  it('保留文件端点业务错误中的 requestId', async () => {
    mockServer.use(
      http.put('https://api.test/files/attachments/upload/expired', () =>
        HttpResponse.json(
          {
            error: 'upload token is invalid or expired',
            requestId: 'file-req',
          },
          { status: 400 },
        ),
      ),
    )
    const client = new ApiClient({ baseUrl: 'https://api.test/' })

    await expect(
      client.uploadAttachment(
        '/files/attachments/upload/expired',
        new File(['x'], 'x.png', { type: 'image/png' }),
      ),
    ).rejects.toMatchObject<ApiError>({
      kind: 'business',
      requestId: 'file-req',
    })
  })
})
