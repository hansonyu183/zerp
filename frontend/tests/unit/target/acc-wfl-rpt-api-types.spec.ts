import { describe, expectTypeOf, it } from 'vitest'

import type {
  actionTargetWflInstance,
  queryTargetAccBooks,
  queryTargetAccSubjects,
  queryTargetRpt,
  queryTargetWflCurrentDefinitions,
  queryTargetWflInstances,
} from '@/target/api.ts'

describe('ACC, WFL and RPT Hono-derived frontend contracts', () => {
  it('preserves paged query inputs and typed success data', () => {
    expectTypeOf<Parameters<typeof queryTargetAccBooks>[1]>().toMatchTypeOf<{
      page?: number
      pageSize?: number
      keyword?: string
    }>()
    expectTypeOf<Parameters<typeof queryTargetAccSubjects>[1]>().toMatchTypeOf<{
      bookId: string
      page?: number
      keyword?: string
    }>()
    expectTypeOf<
      Parameters<typeof queryTargetWflCurrentDefinitions>[1]
    >().toMatchTypeOf<{
      page?: number
      pageSize?: number
      code?: string
      keyword?: string
    }>()
    expectTypeOf<
      Parameters<typeof queryTargetWflInstances>[1]
    >().toMatchTypeOf<{ page?: number; code?: string; keyword?: string }>()
    expectTypeOf<
      Parameters<typeof actionTargetWflInstance>[1]['action']
    >().toEqualTypeOf<
      | 'OPEN_DOCUMENT'
      | 'CREATE_CHILD'
      | 'APPROVE_CHILD'
      | 'REJECT_CHILD'
      | 'RETRY_CHILD'
      | 'CANCEL_CHILD'
    >()
    expectTypeOf<
      Awaited<ReturnType<typeof queryTargetRpt>>['hasMore']
    >().toEqualTypeOf<boolean>()
  })
})
