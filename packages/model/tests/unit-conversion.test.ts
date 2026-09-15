import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeProductData } from '../src/archives.ts'

const unit = { id: 'u', code: 'U', name: '吨', fixedFactor: '1000' }
function product(factor: string | null, fixedFactor: string | null = '1000') {
  const adopted = { ...unit, fixedFactor }
  return {
    name: '原料',
    barcode: '',
    specification: '',
    model: '',
    productType: {
      id: 't',
      code: 'T',
      name: '原材料',
      behaviorProfile: 'RAW_MATERIAL' as const,
    },
    productCategory: { id: 'c', code: 'C', name: '分类' },
    pricingUnit: adopted,
    defaultInputUnit: adopted,
    unitConversions: [{ unit: adopted, factor }],
    defaultPackagingSpec: '200',
    recyclable: false,
    fixedFormula: null,
    remark: '',
  }
}
test('products adopt fixed units without a second writable factor and retain product-specific factors', () => {
  assert.ok(normalizeProductData(product(null)))
  assert.equal(normalizeProductData(product('1000')), undefined)
  assert.equal(normalizeProductData(product('180')), undefined)
  assert.ok(normalizeProductData(product('200', null)))
  assert.ok(normalizeProductData(product('180', null)))
  assert.equal(normalizeProductData(product(null, null)), undefined)
})

test('fixed and product-specific units suggest the same stable internal quantity without rounding', async () => {
  const { suggestProductBaseQuantity } = await import('../src/archives.ts')
  assert.equal(suggestProductBaseQuantity('1', { unit, factor: null }), '1000')
  assert.equal(
    suggestProductBaseQuantity('1000', {
      unit: { ...unit, name: 'kg', fixedFactor: '1' },
      factor: null,
    }),
    '1000',
  )
  assert.equal(
    suggestProductBaseQuantity('1', {
      unit: { ...unit, name: '桶', fixedFactor: null },
      factor: '200',
    }),
    '200',
  )
  assert.equal(
    suggestProductBaseQuantity('1', {
      unit: { ...unit, name: '桶', fixedFactor: null },
      factor: '180',
    }),
    '180',
  )
  assert.equal(
    suggestProductBaseQuantity('1.23', {
      unit: { ...unit, fixedFactor: '0.0001' },
      factor: null,
    }),
    '0.000123',
  )
  assert.equal(
    suggestProductBaseQuantity('1.234', { unit, factor: null }),
    undefined,
  )
})
