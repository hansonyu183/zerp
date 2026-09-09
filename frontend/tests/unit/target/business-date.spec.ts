import { afterEach, expect, it, vi } from 'vitest'
import { businessDate } from '../../../src/target/components/document-page/business-date.ts'
import { emptyOrder } from '../../../src/target/components/document-page/order-data.ts'
import { permissionTitle } from '../../../src/target/components/direct-page/permission-presentation.ts'

afterEach(() => vi.useRealTimers())

it.each([
  ['2026-09-08T15:59:59Z', '2026-09-08'],
  ['2026-09-08T16:00:00Z', '2026-09-09'],
  ['2026-12-31T16:00:00Z', '2027-01-01'],
])(
  'defaults new orders to the Shanghai business date at %s',
  (instant, expected) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(instant))
    expect(businessDate()).toBe(expected)
    expect(emptyOrder('sale-order').businessDate).toBe(expected)
  },
)

it('presents the inventory book balance permission in Chinese', () => {
  expect(
    permissionTitle({
      id: 'balance',
      domain: 'vou',
      entity: 'inventory-count',
      action: 'book-balance',
      path: '/vou/inventory-count/book-balance',
      status: 'ENABLED',
      description: null,
    }),
  ).toContain('查询账面库存')
})
