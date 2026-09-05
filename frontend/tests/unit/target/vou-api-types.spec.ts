import { describe, expectTypeOf, it } from 'vitest'

import type { VouPayloadFor } from '@zerp/model'

import type {
  TargetVouPageFor,
  TargetVouReferenceResult,
  TargetVouSourceLineResult,
  TargetVouSubmitInputFor,
  TargetVouViewFor,
} from '@/target/api.ts'

describe('VOU Hono-derived frontend contract types', () => {
  it('preserves exact view, page, reference and source-line success data', () => {
    expectTypeOf<TargetVouViewFor<'sale-order'>>().not.toBeNever()
    expectTypeOf<TargetVouViewFor<'sale-order'>['payload']>().toEqualTypeOf<
      VouPayloadFor<'sale-order'>
    >()
    expectTypeOf<
      TargetVouSubmitInputFor<'sale-order'>['payload']
    >().toEqualTypeOf<VouPayloadFor<'sale-order'>>()
    expectTypeOf<
      TargetVouPageFor<'sale-order'>['pageSize']
    >().toEqualTypeOf<20>()
    expectTypeOf<TargetVouReferenceResult['items'][number]>().toMatchTypeOf<{
      objectId: string
      code: string
      name: string
    }>()
    expectTypeOf<TargetVouSourceLineResult['items'][number]>().toMatchTypeOf<{
      sourceDocumentId: string
      sourceDocumentNo: string
      sourceLineId: string
      availableBaseQuantity: string
    }>()
  })
})
