import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type {
  BobEntityConfig,
  BobFieldContext,
  BobFilterField,
  BobForm,
  BobListItem,
  BobStatus,
} from './types'
import { bobListActiveVersion } from './types'

export const statusText: Record<BobStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待批准',
  APPROVED: '已批准',
}

export const statusOptions: readonly BusinessObjectFieldOption[] = [
  { title: '草稿', value: 'DRAFT' },
  { title: '待批准', value: 'PENDING' },
  { title: '已批准', value: 'APPROVED' },
]

export const customerTypeOptions: readonly BusinessObjectFieldOption[] = [
  { title: '终端客户', value: 'DIT-0001' },
]

export const settlementRuleOptions: readonly BusinessObjectFieldOption[] = [
  { title: '相对天数', value: 'RELATIVE_DAYS' },
  { title: '月末', value: 'MONTH_END' },
  { title: '指定日', value: 'FIXED_DAY' },
]

export const targetEntityOptions: readonly BusinessObjectFieldOption[] = [
  { title: '客户', value: 'customer' },
  { title: '供应商', value: 'supplier' },
  { title: '员工', value: 'employee' },
  { title: '产品', value: 'product' },
  { title: '仓库', value: 'warehouse' },
  { title: '车辆', value: 'vehicle' },
  { title: '资金账户', value: 'fund-account' },
  { title: '部门', value: 'department' },
  { title: '岗位', value: 'position' },
]

export const phonePattern = /^[+0-9() -]+$/
export const emailPattern = /^[^@\s]+@[^@\s]+$/
export const taxNumberPattern = /^[A-Za-z0-9-]+$/
export const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/
export const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/
export const quantityPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/

export const containerTypeOptions: readonly BusinessObjectFieldOption[] = [
  { title: '无桶包装', value: 'NONE' },
  { title: '溶剂桶', value: 'SOLVENT' },
  { title: '树脂桶', value: 'RESIN' },
]

export const productBehaviorProfileOptions: readonly BusinessObjectFieldOption[] =
  [
    { title: '原材料（可销售）', value: 'RAW_MATERIAL' },
    { title: '自制成品（固定配方）', value: 'STANDARD_FINISHED' },
    { title: '定制成品（订单配方）', value: 'CUSTOM_FINISHED' },
    { title: '包装物', value: 'PACKAGING' },
  ]

export function lengthOf(value: unknown): number {
  return typeof value === 'string' ? Array.from(value).length : 0
}

export function maxLength(label: string, maximum: number) {
  return (value: unknown): true | string =>
    lengthOf(value) <= maximum || `${label}不能超过 ${maximum} 个字符。`
}

export function patternRule(pattern: RegExp, message: string) {
  return (value: unknown): true | string => {
    if (typeof value !== 'string' || value.trim() === '') return true
    return pattern.test(value.trim()) || message
  }
}

export function commonFields(
  context: BobFieldContext,
  codeLabel: string,
  nameLabel: string,
): BusinessObjectField<BobForm>[] {
  return [
    ...(context.mode === 'create'
      ? []
      : [
          {
            key: 'code',
            label: codeLabel,
            type: 'readonly',
            required: true,
          } as BusinessObjectField<BobForm>,
        ]),
    {
      key: 'name',
      label: nameLabel,
      type: 'text',
      required: true,
      rules: [maxLength(nameLabel, 200)],
    },
  ]
}

export function text(
  key: string,
  label: string,
  maximum?: number,
  options: Partial<BusinessObjectField<BobForm>> = {},
): BusinessObjectField<BobForm> {
  return {
    key,
    label,
    type: 'text',
    ...options,
    ...(maximum
      ? { rules: [...(options.rules ?? []), maxLength(label, maximum)] }
      : {}),
  }
}

export function textarea(
  key: string,
  label: string,
  maximum = 1000,
): BusinessObjectField<BobForm> {
  return {
    key,
    label,
    type: 'textarea',
    span: 2,
    rules: [maxLength(label, maximum)],
  }
}

export function reference(
  key: string,
  label: string,
  context: BobFieldContext,
  required = false,
): BusinessObjectField<BobForm> {
  const error = context.referenceErrors[key]
  return {
    key,
    label,
    type: 'autocomplete',
    required,
    clearable: !required,
    disabled: Boolean(error),
    loading: context.referenceLoading[key],
    options: context.referenceOptions[key] ?? [],
    ...(error ? { hint: error } : {}),
  }
}

export function baseFilters(
  extra: readonly BobFilterField[] = [],
): BobFilterField[] {
  return [
    {
      key: 'status',
      label: '状态',
      type: 'select',
      multiple: true,
      options: statusOptions,
    },
    {
      key: 'enabled',
      label: '启停状态',
      type: 'select',
      options: [
        { title: '启用', value: true },
        { title: '禁用', value: false },
      ],
    },
    ...extra,
  ]
}

export function baseColumns(
  codeLabel: string,
  nameLabel: string,
  extra: readonly BusinessObjectColumn<BobListItem>[] = [],
): readonly BusinessObjectColumn<BobListItem>[] {
  return [
    {
      key: 'code',
      label: codeLabel,
      value: (row) => row.code,
      sizing: 'compact',
    },
    {
      key: 'name',
      label: nameLabel,
      value: (row) => bobListActiveVersion(row).summary.name,
      sizing: 'fluid',
    },
    ...extra,
    {
      key: 'status',
      label: '状态',
      value: (row) => bobListActiveVersion(row).approval.status,
      format: (value) => statusText[value as BobStatus] ?? String(value),
      sizing: 'compact',
    },
  ]
}

export function emptyForm(values: Record<string, unknown>): BobForm {
  return { code: '', name: '', ...values }
}

export interface BobEntityDefinition extends Omit<
  BobEntityConfig,
  'emptyForm' | 'detailKeys'
> {
  defaults: Record<string, unknown>
}

export function defineBobEntityConfig(
  definition: BobEntityDefinition,
): BobEntityConfig {
  const { defaults, ...metadata } = definition
  const detailKeys = ['name', ...Object.keys(defaults)]
  const emptyContext: BobFieldContext = {
    mode: 'create',
    referenceOptions: {},
    referenceLoading: {},
    referenceErrors: {},
  }
  const fieldKeys = new Set(
    metadata.fields(emptyContext).map((field) => String(field.key)),
  )

  const unknownReferences = Object.keys(metadata.references ?? {}).filter(
    (key) => !fieldKeys.has(key),
  )
  if (unknownReferences.length > 0) {
    throw new Error(
      `BOB ${metadata.entity} references 包含未定义字段：${unknownReferences.join(', ')}`,
    )
  }

  return {
    ...metadata,
    emptyForm: () => ({
      code: '',
      name: '',
      ...structuredClone(defaults),
    }),
    detailKeys,
  }
}

export function getStatusText(status?: BobStatus): string {
  return status ? (statusText[status] ?? status) : '未标记'
}
