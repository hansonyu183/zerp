import type { ApprovalStatus } from '@/api/generated'
import type { BusinessObjectField } from '@/components/business-object'
import { maxLength } from '@/pages/dcl/shared/bob-config-helpers'
import {
  approvalStatusOptions,
  approvalStatusPresentation,
} from '@/shared/approval'
import {
  dclSupplierActiveVersion,
  type DclSupplierConfig,
  type DclSupplierForm,
} from './types'
const fields: readonly BusinessObjectField<DclSupplierForm>[] = [
  { key: 'code', label: '供应商编码', type: 'readonly' },
  {
    key: 'kind',
    label: '身份类型',
    type: 'select',
    required: true,
    options: [
      { title: '个人', value: 'PERSON' },
      { title: '组织', value: 'ORGANIZATION' },
    ],
  },
  {
    key: 'legalName',
    label: '法定名称',
    type: 'text',
    required: true,
    rules: [maxLength('法定名称', 200)],
  },
  {
    key: 'displayName',
    label: '显示名称',
    type: 'text',
    rules: [maxLength('显示名称', 200)],
  },
  {
    key: 'legalIdentifier',
    label: '法定识别号',
    type: 'text',
    rules: [maxLength('法定识别号', 100)],
  },
  {
    key: 'operatingEntityIds',
    label: '适用经营主体',
    type: 'autocomplete',
    required: true,
    multiple: true,
  },
  {
    key: 'defaultOperatingEntityId',
    label: '默认经营主体',
    type: 'autocomplete',
    required: true,
    clearable: false,
  },
  {
    key: 'shortName',
    label: '简称',
    type: 'text',
    rules: [maxLength('简称', 200)],
  },
  { key: 'contactName', label: '联系人', type: 'text' },
  { key: 'contactPhone', label: '联系电话', type: 'text' },
  { key: 'email', label: '邮箱', type: 'text' },
  { key: 'address', label: '地址', type: 'textarea', span: 2 },
  { key: 'settlementMethodId', label: '结算方式', type: 'autocomplete' },
  {
    key: 'defaultPurchaserEmployeeId',
    label: '默认采购员',
    type: 'autocomplete',
  },
  { key: 'enabled', label: '启用', type: 'switch' },
  {
    key: 'remark',
    label: '备注',
    type: 'textarea',
    span: 2,
    rules: [maxLength('备注', 1000)],
  },
]
export const dclSupplierConfig: DclSupplierConfig = {
  fields,
  emptyForm: () => ({
    code: '',
    kind: 'ORGANIZATION',
    legalName: '',
    displayName: '',
    legalIdentifier: '',
    enabled: true,
    operatingEntityIds: [],
    defaultOperatingEntityId: '',
    shortName: '',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    remark: '',
    settlementMethodId: '',
    defaultPurchaserEmployeeId: '',
  }),
  columns: [
    { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
    {
      key: 'name',
      label: '名称',
      value: (row) => row.displayName,
      sizing: 'fluid',
    },
    {
      key: 'operatingEntity',
      label: '默认经营主体',
      value: (row) =>
        `${row.defaultOperatingEntity.code} · ${row.defaultOperatingEntity.name}`,
    },
    {
      key: 'status',
      label: '状态',
      value: (row) => dclSupplierActiveVersion(row).approval.status,
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
