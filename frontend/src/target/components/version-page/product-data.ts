import { normalizeProductData } from '@zerp/model'
import type { TargetProductSubmitInput } from '../../api.ts'
export type ProductSnapshot = TargetProductSubmitInput['snapshot']
export const productBehaviorLabels = {
  RAW_MATERIAL: '原材料',
  STANDARD_FINISHED: '自制成品',
  CUSTOM_FINISHED: '定制成品',
  PACKAGING: '包装物',
} as const
export const formulaResolutionLabels = {
  CURRENT: '已确认',
  UNRESOLVED: '待处理',
} as const
export const emptyUnit = () => ({
  id: '',
  code: '',
  name: '',
  symbol: '',
  quantityScale: 6,
})
export function emptyProduct(): ProductSnapshot {
  return {
    name: '',
    barcode: '',
    specification: '',
    model: '',
    productType: {
      id: '',
      code: '',
      name: '',
      behaviorProfile: 'RAW_MATERIAL',
    },
    productCategory: { id: '', code: '', name: '' },
    pricingUnit: emptyUnit(),
    defaultInputUnit: emptyUnit(),
    unitConversions: [],
    defaultPackagingSpec: '',
    recyclable: false,
    fixedFormula: null,
    remark: '',
  }
}

export function validateProduct(snapshot: ProductSnapshot): string | null {
  let field = ''
  if (
    normalizeProductData(snapshot, (value) => {
      field = value
    })
  )
    return null
  const captions: Record<string, string> = {
    name: '名称：请填写名称。',
    productType: '产品类型：请选择可用类型。',
    productCategory: '产品分类：请选择分类。',
    pricingUnit: '计价单位：请选择单位。',
    defaultInputUnit: '默认录入单位：请选择单位。',
    unitConversions:
      '单位换算：须包含计价单位和默认录入单位，系数为正数且单位不重复。',
    defaultPackagingSpec:
      '默认包装规格：非包装物须填写正数；包装物须留空且计价单位与录入单位相同。',
    fixedFormula: '固定配方：自制成品须填写完整配方，其他类型不可填写。',
    'fixedFormula.output':
      '配方产量：填写正数录入数量、录入单位和正数基准数量。',
    'fixedFormula.components': '配方原料：须填写 1 至 200 行。',
  }
  const conversion = /^unitConversions\[(\d+)\]$/.exec(field)
  if (conversion)
    return `单位换算第 ${Number(conversion[1]) + 1} 行：请选择单位并填写正数系数，单位不可重复。`
  const component = /^fixedFormula.components\[(\d+)\]$/.exec(field)
  if (component)
    return `配方原料第 ${Number(component[1]) + 1} 行：请选择已确认且不重复的原材料，并完整填写正数录入数量、录入单位和正数基准数量。`
  return captions[field] ?? '请检查产品内容。'
}
