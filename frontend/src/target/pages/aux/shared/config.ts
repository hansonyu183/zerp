import type { TargetAuxEntity } from '../../../api.ts'

export type AuxFieldKind =
  'text' | 'textarea' | 'integer' | 'decimal' | 'select' | 'relation'

export interface AuxFieldConfig {
  key: string
  label: string
  kind: AuxFieldKind
  required?: boolean
  readonlyOnEdit?: boolean
  options?: ReadonlyArray<{ title: string; value: string }>
  relationEntity?: TargetAuxEntity
}

export interface AuxEntityConfig {
  title: string
  fields: readonly AuxFieldConfig[]
  canCreate: boolean
  canDelete: boolean
  defaults: Readonly<Record<string, string | number>>
}

const description: AuxFieldConfig = {
  key: 'description',
  label: '说明',
  kind: 'textarea',
}
const name: AuxFieldConfig = {
  key: 'name',
  label: '名称',
  kind: 'text',
  required: true,
}
const behaviorProfiles = [
  { title: '原材料', value: 'RAW_MATERIAL' },
  { title: '标准成品', value: 'STANDARD_FINISHED' },
  { title: '定制成品', value: 'CUSTOM_FINISHED' },
  { title: '包装物', value: 'PACKAGING' },
] as const

export const auxEntityConfigs: Record<TargetAuxEntity, AuxEntityConfig> = {
  'product-category': {
    title: '产品分类',
    fields: [
      name,
      {
        key: 'parentId',
        label: '上级分类',
        kind: 'relation',
        relationEntity: 'product-category',
      },
      description,
    ],
    canCreate: true,
    canDelete: true,
    defaults: { name: '', parentId: '', description: '' },
  },
  'product-type': {
    title: '产品类型',
    fields: [
      name,
      {
        key: 'behaviorProfile',
        label: '行为模板',
        kind: 'select',
        required: true,
        options: behaviorProfiles,
      },
      description,
    ],
    canCreate: true,
    canDelete: true,
    defaults: {
      name: '',
      behaviorProfile: 'STANDARD_FINISHED',
      description: '',
    },
  },
  'employee-category': {
    title: '员工分类',
    fields: [name, description],
    canCreate: true,
    canDelete: true,
    defaults: { name: '', description: '' },
  },
  department: {
    title: '部门',
    fields: [
      name,
      {
        key: 'parentId',
        label: '上级部门',
        kind: 'relation',
        relationEntity: 'department',
      },
      description,
    ],
    canCreate: true,
    canDelete: true,
    defaults: { name: '', parentId: '', description: '' },
  },
  position: {
    title: '岗位',
    fields: [name, description],
    canCreate: true,
    canDelete: true,
    defaults: { name: '', description: '' },
  },
  'settlement-method': {
    title: '结算方式',
    fields: [
      { ...name, readonlyOnEdit: true },
      {
        key: 'termCode',
        label: '期限代码',
        kind: 'text',
        readonlyOnEdit: true,
      },
      {
        key: 'ruleType',
        label: '到期规则',
        kind: 'select',
        readonlyOnEdit: true,
        options: [
          { title: '相对天数', value: 'RELATIVE_DAYS' },
          { title: '月末规则', value: 'MONTH_END' },
        ],
      },
      {
        key: 'monthOffset',
        label: '月偏移',
        kind: 'integer',
        readonlyOnEdit: true,
      },
      {
        key: 'dayOfMonth',
        label: '月内日',
        kind: 'integer',
        readonlyOnEdit: true,
      },
      {
        key: 'dayOffset',
        label: '日偏移',
        kind: 'integer',
        readonlyOnEdit: true,
      },
      {
        key: 'defaultSalesSurcharge',
        label: '默认销售加价（元/kg）',
        kind: 'decimal',
        required: true,
      },
      description,
    ],
    canCreate: false,
    canDelete: false,
    defaults: {},
  },
  'payment-method': {
    title: '收款方式',
    fields: [
      name,
      {
        key: 'defaultSalesSurcharge',
        label: '默认销售加价（元/kg）',
        kind: 'decimal',
        required: true,
      },
      description,
    ],
    canCreate: true,
    canDelete: true,
    defaults: { name: '', defaultSalesSurcharge: '0.00', description: '' },
  },
  'dictionary-type': {
    title: '字典类型',
    fields: [name, description],
    canCreate: true,
    canDelete: true,
    defaults: { name: '', description: '' },
  },
  'dictionary-item': {
    title: '字典项',
    fields: [
      name,
      {
        key: 'dictionaryTypeId',
        label: '字典类型',
        kind: 'relation',
        required: true,
        relationEntity: 'dictionary-type',
      },
      { key: 'sortOrder', label: '排序', kind: 'integer', required: true },
    ],
    canCreate: true,
    canDelete: true,
    defaults: { name: '', dictionaryTypeId: '', sortOrder: 0 },
  },
  'measurement-unit': {
    title: '计量单位',
    fields: [
      name,
      { key: 'symbol', label: '符号', kind: 'text', required: true },
      {
        key: 'quantityScale',
        label: '数量小数位',
        kind: 'integer',
        required: true,
      },
    ],
    canCreate: true,
    canDelete: true,
    defaults: { name: '', symbol: '', quantityScale: 0 },
  },
  'income-expense-type': {
    title: '收支类型',
    fields: [
      name,
      {
        key: 'direction',
        label: '方向',
        kind: 'select',
        required: true,
        options: [
          { title: '收入', value: 'INCOME' },
          { title: '支出', value: 'EXPENSE' },
        ],
      },
      {
        key: 'parentId',
        label: '上级类型',
        kind: 'relation',
        relationEntity: 'income-expense-type',
      },
      description,
    ],
    canCreate: true,
    canDelete: true,
    defaults: { name: '', direction: 'INCOME', parentId: '', description: '' },
  },
  'asset-category': {
    title: '资产分类',
    fields: [
      name,
      {
        key: 'defaultUsefulLifeMonths',
        label: '默认使用月数',
        kind: 'integer',
        required: true,
      },
      {
        key: 'defaultResidualRate',
        label: '默认残值率（%）',
        kind: 'decimal',
        required: true,
      },
      description,
    ],
    canCreate: true,
    canDelete: true,
    defaults: {
      name: '',
      defaultUsefulLifeMonths: 60,
      defaultResidualRate: '5.00',
      description: '',
    },
  },
}
