import { describe, expect, it } from 'vitest'
import {
  defineVouPage,
  naturalMonth,
} from '@/target/components/document-page/list-contract.ts'

const input = {
  vouType: 'sale-order' as const,
  title: '销售订单',
  columns: [
    { key: 'documentNo', type: 'text', caption: '单号' },
    { key: 'handlerName', type: 'text', caption: '经办人' },
    { key: '$actions', type: 'actions', caption: '操作' },
  ] as const,
  filters: [
    { key: 'businessDate', type: 'date', range: true, caption: '期间' },
    { key: 'documentNo', type: 'text', caption: '单号' },
  ] as const,
}
const row = {
  vouType: 'sale-order' as const,
  documentId: '01J00000000000000000000001',
  documentNo: 'XS01',
  handlerName: null,
  revision: '9007199254740993',
}
describe('independent voucher page contract', () => {
  it('accepts real document identity without catalog fields and preserves revision precision', () => {
    expect(() => defineVouPage(input).validateRows([row])).not.toThrow()
  })
  it('rejects missing fields, wrong types, duplicate identities and mismatched voucher type', () => {
    const page = defineVouPage(input)
    for (const bad of [
      { ...row, revision: 1 },
      { ...row, handlerName: undefined },
      { ...row, documentId: '' },
      { ...row, vouType: 'purchase-order' },
    ])
      expect(() => page.validateRows([bad] as never)).toThrow()
    expect(() => page.validateRows([row, row])).toThrow()
    for (const filters of [
      input.filters.slice(1),
      [{ ...input.filters[0], range: false }, input.filters[1]],
    ])
      expect(() => defineVouPage({ ...input, filters } as never)).toThrow()
    expect(() =>
      defineVouPage({
        ...input,
        columns: [...input.columns, input.columns[0]],
      } as never),
    ).toThrow()
  })
  it('calculates an independent Shanghai business month per instance including leap years', () => {
    expect(naturalMonth(new Date('2024-02-29T16:00:00Z'))).toEqual({
      from: '2024-03-01',
      to: '2024-03-31',
    })
    expect(naturalMonth(new Date('2024-02-01T00:00:00Z'))).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    })
    const a = naturalMonth(new Date('2024-02-01T00:00:00Z'))
    a.from = null
    expect(naturalMonth(new Date('2024-02-01T00:00:00Z')).from).toBe(
      '2024-02-01',
    )
  })
})
