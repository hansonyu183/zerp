import type { ApprovalStatus } from '@/api/generated'
import type { BusinessObjectField } from '@/components/business-object'
import { maxLength } from '@/pages/bob/shared/config-helpers'
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
    key: 'partyDisplayName',
    label: '主体',
    type: 'readonly',
    visible: (form) => Boolean(form.code),
  },
  {
    key: 'partyMode',
    label: '主体来源',
    type: 'select',
    required: true,
    visible: (form) => !form.code,
    options: [
      { title: '选择已有主体', value: 'EXISTING' },
      { title: '新建主体', value: 'NEW' },
    ],
  },
  {
    key: 'partyId',
    label: '已有主体',
    type: 'autocomplete',
    required: true,
    visible: (form) => !form.code && form.partyMode === 'EXISTING',
  },
  {
    key: 'partyKind',
    label: '主体类型',
    type: 'select',
    required: true,
    visible: (form) => !form.code && form.partyMode === 'NEW',
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
    visible: (form) => !form.code && form.partyMode === 'NEW',
    rules: [maxLength('法定名称', 200)],
  },
  {
    key: 'displayName',
    label: '显示名称',
    type: 'text',
    visible: (form) => !form.code && form.partyMode === 'NEW',
    rules: [maxLength('显示名称', 200)],
  },
  {
    key: 'partyTaxNumber',
    label: '主体税号',
    type: 'text',
    visible: (form) => !form.code && form.partyMode === 'NEW',
    rules: [maxLength('主体税号', 64)],
  },
  {
    key: 'identifierType',
    label: '强标识类型',
    type: 'select',
    visible: (form) => !form.code && form.partyMode === 'NEW',
    options: [
      { title: '身份证件号', value: 'PERSON_ID' },
      { title: '统一社会信用代码', value: 'UNIFIED_SOCIAL_CREDIT_CODE' },
    ],
  },
  {
    key: 'identifierValue',
    label: '强标识（可选）',
    type: 'text',
    visible: (form) => !form.code && form.partyMode === 'NEW',
    rules: [maxLength('强标识', 128)],
  },
  {
    key: 'taxNumber',
    label: '供应商税号',
    type: 'text',
    rules: [maxLength('供应商税号', 64)],
  },
  {
    key: 'operatingEntityId',
    label: '经营主体',
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
    rules: [maxLength('联系电话', 32)],
  },
  {
    key: 'email',
    label: '邮箱',
    type: 'text',
    rules: [maxLength('邮箱', 254)],
  },
  {
    key: 'address',
    label: '地址',
    type: 'textarea',
    span: 2,
    rules: [maxLength('地址', 500)],
  },
  { key: 'settlementMethodId', label: '结算方式', type: 'autocomplete' },
  {
    key: 'defaultPurchaserEmployeeId',
    label: '默认采购员',
    type: 'autocomplete',
  },
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
    partyDisplayName: '',
    partyMode: 'EXISTING',
    partyId: '',
    partyKind: 'ORGANIZATION',
    legalName: '',
    displayName: '',
    partyTaxNumber: '',
    taxNumber: '',
    identifierType: 'UNIFIED_SOCIAL_CREDIT_CODE',
    identifierValue: '',
    operatingEntityId: '',
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
      key: 'party',
      label: '主体',
      value: (row) => row.partyDisplayName,
      sizing: 'fluid',
    },
    {
      key: 'operatingEntity',
      label: '经营主体',
      value: (row) => `${row.operatingEntityCode} · ${row.operatingEntityName}`,
    },
    {
      key: 'settlementMethod',
      label: '结算方式',
      value: (row) =>
        dclSupplierActiveVersion(row).data.settlementMethod?.name ?? '—',
    },
    {
      key: 'defaultPurchaser',
      label: '默认采购员',
      value: (row) => {
        const value = dclSupplierActiveVersion(row).data.defaultPurchaser
        return value ? `${value.code} · ${value.name}` : '—'
      },
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
