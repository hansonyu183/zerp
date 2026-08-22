import type { AuxApiEntity } from '@/api/client'

export interface AuxField {
  key: string
  label: string
  type?: 'text' | 'number' | 'textarea' | 'select' | 'reference'
  required?: boolean
  options?: readonly { title: string; value: string }[]
  visible?: (form: Record<string, unknown>) => boolean
  reference?: {
    entity: AuxApiEntity
    value: 'objectId' | 'code'
  }
}

export interface AuxFilter {
  key: string
  label: string
  options: readonly { title: string; value: string }[]
}

export interface AuxListField {
  key: string
  label: string
  format?: (value: unknown) => string
}

export interface AuxEntityConfig {
  entity: AuxApiEntity
  title: string
  fields: readonly AuxField[]
  filters?: readonly AuxFilter[]
  listFields?: readonly AuxListField[]
  defaults: () => Record<string, unknown>
}

const text = (
  key: string,
  label: string,
  options: Partial<AuxField> = {},
): AuxField => ({ key, label, type: 'text', ...options })

const description = text('description', '说明', { type: 'textarea' })

const productBehaviorProfileOptions = [
  { title: '原材料', value: 'RAW_MATERIAL' },
  { title: '标准成品', value: 'STANDARD_FINISHED' },
  { title: '定制成品', value: 'CUSTOM_FINISHED' },
  { title: '包装物', value: 'PACKAGING' },
] as const

const productBehaviorProfileLabel = (value: unknown): string =>
  productBehaviorProfileOptions.find((option) => option.value === value)
    ?.title ?? String(value)

export const auxConfigs: Readonly<Record<AuxApiEntity, AuxEntityConfig>> = {
  'settlement-method': {
    entity: 'settlement-method',
    title: '结算方式',
    defaults: () => ({ defaultSalesSurcharge: '0.00', description: '' }),
    fields: [
      text('defaultSalesSurcharge', '默认销售加价（元/kg）', {
        required: true,
      }),
      description,
    ],
  },
  'payment-method': {
    entity: 'payment-method',
    title: '收款方式',
    defaults: () => ({
      name: '',
      defaultSalesSurcharge: '0.00',
      description: '',
    }),
    fields: [
      text('name', '名称', { required: true }),
      text('defaultSalesSurcharge', '默认销售加价（元/kg）', {
        required: true,
      }),
      description,
    ],
  },
  'asset-category': {
    entity: 'asset-category',
    title: '资产类别',
    defaults: () => ({
      name: '',
      defaultUsefulLifeMonths: 60,
      defaultResidualRate: '5.00',
      description: '',
    }),
    fields: [
      text('name', '名称', { required: true }),
      {
        key: 'defaultUsefulLifeMonths',
        label: '默认使用月数',
        type: 'number',
        required: true,
      },
      text('defaultResidualRate', '默认残值率（%）', { required: true }),
      description,
    ],
  },
  'product-category': {
    entity: 'product-category',
    title: '产品分类',
    defaults: () => ({ name: '', parentId: '', description: '' }),
    fields: [
      text('name', '名称', { required: true }),
      {
        key: 'parentId',
        label: '上级分类',
        type: 'reference',
        reference: { entity: 'product-category', value: 'objectId' },
      },
      description,
    ],
  },
  'product-type': {
    entity: 'product-type',
    title: '产品类型',
    defaults: () => ({
      name: '',
      behaviorProfile: 'RAW_MATERIAL',
      description: '',
    }),
    fields: [
      text('name', '名称', { required: true }),
      {
        key: 'behaviorProfile',
        label: '行为模板',
        type: 'select',
        required: true,
        options: productBehaviorProfileOptions,
      },
      description,
    ],
    filters: [
      {
        key: 'behaviorProfile',
        label: '行为模板',
        options: productBehaviorProfileOptions,
      },
    ],
    listFields: [
      {
        key: 'behaviorProfile',
        label: '行为模板',
        format: productBehaviorProfileLabel,
      },
    ],
  },
  department: {
    entity: 'department',
    title: '部门',
    defaults: () => ({ name: '', parentId: '', description: '' }),
    fields: [
      text('name', '名称', { required: true }),
      {
        key: 'parentId',
        label: '上级部门',
        type: 'reference',
        reference: { entity: 'department', value: 'objectId' },
      },
      description,
    ],
  },
  position: {
    entity: 'position',
    title: '岗位',
    defaults: () => ({ name: '', description: '' }),
    fields: [text('name', '名称', { required: true }), description],
  },
  'dictionary-type': {
    entity: 'dictionary-type',
    title: '字典类型',
    defaults: () => ({ name: '', description: '' }),
    fields: [text('name', '名称', { required: true }), description],
  },
  'dictionary-item': {
    entity: 'dictionary-item',
    title: '字典项',
    defaults: () => ({
      name: '',
      dictionaryTypeCode: '',
      sortOrder: 10,
    }),
    fields: [
      text('name', '名称', { required: true }),
      {
        key: 'dictionaryTypeCode',
        label: '字典类型',
        type: 'reference',
        required: true,
        reference: { entity: 'dictionary-type', value: 'code' },
      },
      {
        key: 'sortOrder',
        label: '排序',
        type: 'number',
        required: true,
      },
    ],
  },
  'measurement-unit': {
    entity: 'measurement-unit',
    title: '计量单位',
    defaults: () => ({ name: '', symbol: '', quantityScale: 6 }),
    fields: [
      text('name', '名称', { required: true }),
      text('symbol', '符号', { required: true }),
      {
        key: 'quantityScale',
        label: '数量小数位',
        type: 'number',
        required: true,
      },
    ],
  },
  'income-expense-type': {
    entity: 'income-expense-type',
    title: '收支类型',
    defaults: () => ({
      name: '',
      direction: 'EXPENSE',
      parentId: '',
      description: '',
    }),
    fields: [
      text('name', '名称', { required: true }),
      {
        key: 'direction',
        label: '方向',
        type: 'select',
        required: true,
        options: [
          { title: '收入', value: 'INCOME' },
          { title: '支出', value: 'EXPENSE' },
        ],
      },
      {
        key: 'parentId',
        label: '上级类型',
        type: 'reference',
        reference: { entity: 'income-expense-type', value: 'objectId' },
      },
      description,
    ],
  },
}
