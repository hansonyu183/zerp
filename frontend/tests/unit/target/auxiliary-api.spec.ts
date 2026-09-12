import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})
it('没有客户历史订单的成功空值经真实推导客户端保留为 null', async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        code: 0,
        errorKey: '',
        message: 'ok',
        data: null,
        requestId: 'test',
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  )
  vi.stubGlobal('fetch', request)
  vi.resetModules()
  const api = await import('@/target/api.ts')
  expect(
    await api.queryTargetCustomerLatestLine('subunit', 'product'),
  ).toBeNull()
  expect(request.mock.calls[0]![1].method).toBe('GET')
  expect(String(request.mock.calls[0]![0])).toContain(
    '/vou/sale-order/customer-latest-line?',
  )
  expect(request.mock.calls[0]![1].headers).not.toHaveProperty('x-csrf-token')
})
