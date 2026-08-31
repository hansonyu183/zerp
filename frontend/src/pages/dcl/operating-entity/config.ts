import type { BusinessObjectField } from '@/components/business-object'
import type { components } from '@/api/generated/schema'
import {
  dclOperatingEntityActiveVersion,
  type DclOperatingEntityConfig,
  type DclOperatingEntityForm,
} from './types'

type ApprovalStatus = components['schemas']['ApprovalVersionMeta']['status']

export const dclStatusText: Record<ApprovalStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待批准',
  APPROVED: '已批准',
}

const maxLength = (label: string, maximum: number) => (value: unknown) =>
  typeof value !== 'string' || Array.from(value).length <= maximum
    ? true
    : `${label}不能超过 ${maximum} 个字符。`
const pattern = (expression: RegExp, message: string) => (value: unknown) =>
  typeof value !== 'string' || value.trim() === '' || expression.test(value.trim())
    ? true
    : message

const fields: readonly BusinessObjectField<DclOperatingEntityForm>[] = [
  { key: 'code', label: '经营主体编码', type: 'readonly' },
  {
    key: 'name',
    label: '法定公司名称',
    type: 'text',
    required: true,
    rules: [maxLength('法定公司名称', 200)],
  },
  { key: 'shortName', label: '简称', type: 'text', rules: [maxLength('简称', 100)] },
  {
    key: 'taxNumber',
    label: '税号',
    type: 'text',
    rules: [
      maxLength('税号', 50),
      pattern(/^[A-Za-z0-9-]+$/, '税号只能包含字母、数字和连字符。'),
    ],
  },
  { key: 'address', label: '地址', type: 'textarea', span: 2, rules: [maxLength('地址', 500)] },
  {
    key: 'phone',
    label: '电话',
    type: 'text',
    rules: [
      maxLength('电话', 32),
      pattern(/^[+0-9() -]+$/, '电话格式不正确。'),
    ],
  },
  { key: 'remark', label: '备注', type: 'textarea', span: 2, rules: [maxLength('备注', 1000)] },
]

export const dclOperatingEntityConfig: DclOperatingEntityConfig = {
  title: '经营主体变更',
  fields,
  emptyForm: () => ({
    code: '',
    name: '',
    shortName: '',
    taxNumber: '',
    address: '',
    phone: '',
    remark: '',
  }),
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '法定公司名称',
      value: (row) => dclOperatingEntityActiveVersion(row).data.name,
      sizing: 'fluid',
    },
    {
      key: 'taxNumber',
      label: '税号',
      value: (row) => dclOperatingEntityActiveVersion(row).data.taxNumber ?? '',
    },
    {
      key: 'status',
      label: '状态',
      value: (row) => dclOperatingEntityActiveVersion(row).approval.status,
      format: (value) => dclStatusText[value as ApprovalStatus],
      sizing: 'compact',
    },
  ],
  filters: [
    {
      key: 'status',
      label: '状态',
      type: 'select',
      multiple: true,
      options: [
        { title: '草稿', value: 'DRAFT' },
        { title: '待批准', value: 'PENDING' },
        { title: '已批准', value: 'APPROVED' },
      ],
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
  ],
}
