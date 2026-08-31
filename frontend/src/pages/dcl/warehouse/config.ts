import type { BusinessObjectField } from '@/components/business-object'
import type { ApprovalStatus } from '@/api/generated'
import {
  approvalStatusOptions,
  approvalStatusPresentation,
} from '@/shared/approval'
import {
  dclWarehouseActiveVersion,
  type DclWarehouseConfig,
  type DclWarehouseForm,
} from './types'

const maxLength = (label: string, maximum: number) => (value: unknown) =>
  typeof value !== 'string' || Array.from(value).length <= maximum
    ? true
    : `${label}不能超过 ${maximum} 个字符。`
const phonePattern = (value: unknown) =>
  typeof value !== 'string' ||
  value.trim() === '' ||
  /^[+0-9() -]+$/.test(value.trim())
    ? true
    : '联系电话格式不正确。'

const fields: readonly BusinessObjectField<DclWarehouseForm>[] = [
  { key: 'code', label: '仓库编码', type: 'readonly' },
  {
    key: 'name',
    label: '仓库名称',
    type: 'text',
    required: true,
    rules: [maxLength('仓库名称', 200)],
  },
  {
    key: 'managerEmployeeId',
    label: '仓库负责人',
    type: 'text',
    rules: [maxLength('仓库负责人', 26)],
  },
  {
    key: 'address',
    label: '地址',
    type: 'textarea',
    span: 2,
    rules: [maxLength('地址', 500)],
  },
  {
    key: 'contactName',
    label: '联系人',
    type: 'text',
    rules: [maxLength('联系人', 100)],
  },
  {
    key: 'contactPhone',
    label: '联系电话',
    type: 'text',
    rules: [maxLength('联系电话', 32), phonePattern],
  },
  {
    key: 'remark',
    label: '备注',
    type: 'textarea',
    span: 2,
    rules: [maxLength('备注', 1000)],
  },
]

export const dclWarehouseConfig: DclWarehouseConfig = {
  title: '仓库变更',
  fields,
  emptyForm: () => ({
    code: '',
    name: '',
    managerEmployeeId: '',
    address: '',
    contactName: '',
    contactPhone: '',
    remark: '',
  }),
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '名称',
      value: (row) => dclWarehouseActiveVersion(row).data.name,
      sizing: 'fluid',
    },
    {
      key: 'address',
      label: '地址',
      value: (row) => dclWarehouseActiveVersion(row).data.address ?? '',
    },
    {
      key: 'contactName',
      label: '联系人',
      value: (row) => dclWarehouseActiveVersion(row).data.contactName ?? '',
    },
    {
      key: 'status',
      label: '状态',
      value: (row) => dclWarehouseActiveVersion(row).approval.status,
      format: (value) =>
        approvalStatusPresentation[value as ApprovalStatus].label,
      sizing: 'compact',
    },
  ],
  filters: [
    {
      key: 'status',
      label: '状态',
      type: 'select',
      multiple: true,
      options: approvalStatusOptions,
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
