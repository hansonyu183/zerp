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

export interface AuxEntityConfig {
  entity: AuxApiEntity
  title: string
  fields: readonly AuxField[]
  defaults: () => Record<string, unknown>
}

const text = (
  key: string,
  label: string,
  options: Partial<AuxField> = {},
): AuxField => ({ key, label, type: 'text', ...options })

const description = text('description', '说明', { type: 'textarea' })

export const auxConfigs: Readonly<Record<AuxApiEntity, AuxEntityConfig>> = {
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
  'settlement-method': {
    entity: 'settlement-method',
    title: '结算方式',
    defaults: () => ({
      name: '',
      ruleType: 'DUE_DAYS',
      dueDays: 0,
      cutoffDay: 25,
      monthOffset: 0,
      defaultSalesSurcharge: '0.00',
      description: '',
    }),
    fields: [
      text('name', '名称', { required: true }),
      {
        key: 'ruleType',
        label: '规则',
        type: 'select',
        required: true,
        options: [
          { title: '到期天数', value: 'DUE_DAYS' },
          { title: '截止日月结', value: 'MONTH_END' },
        ],
      },
      {
        key: 'dueDays',
        label: '到期天数',
        type: 'number',
        required: true,
        visible: (form) => form.ruleType === 'DUE_DAYS',
      },
      {
        key: 'cutoffDay',
        label: '截止日',
        type: 'number',
        required: true,
        visible: (form) => form.ruleType === 'MONTH_END',
      },
      {
        key: 'monthOffset',
        label: '结算月偏移',
        type: 'number',
        required: true,
        visible: (form) => form.ruleType === 'MONTH_END',
      },
      text('defaultSalesSurcharge', '销售加价（元/kg）', {
        required: true,
      }),
      description,
    ],
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
      accountSubjectId: '',
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
      {
        key: 'accountSubjectId',
        label: '会计科目',
        type: 'reference',
        required: true,
        reference: { entity: 'account-subject', value: 'objectId' },
      },
      description,
    ],
  },
  'account-subject': {
    entity: 'account-subject',
    title: '会计科目',
    defaults: () => ({
      name: '',
      direction: 'ASSET',
      parentId: '',
      description: '',
    }),
    fields: [
      text('name', '科目名称', { required: true }),
      {
        key: 'direction',
        label: '科目方向',
        type: 'select',
        required: true,
        options: [
          { title: '资产', value: 'ASSET' },
          { title: '负债', value: 'LIABILITY' },
          { title: '权益', value: 'EQUITY' },
          { title: '收入', value: 'REVENUE' },
          { title: '费用', value: 'EXPENSE' },
          { title: '成本', value: 'COST' },
        ],
      },
      {
        key: 'parentId',
        label: '上级科目',
        type: 'reference',
        reference: { entity: 'account-subject', value: 'objectId' },
      },
      description,
    ],
  },
}
