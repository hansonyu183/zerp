import type { components } from '@/api/generated/schema'
import type { BusinessObjectField } from '@/components/business-object'
import { maxLength } from '@/pages/bob/shared/config-helpers'
import {
  dclEmployeeActiveVersion,
  type DclEmployeeConfig,
  type DclEmployeeForm,
} from './types'

type ApprovalStatus = components['schemas']['ApprovalVersionMeta']['status']

export const dclEmployeeStatusText: Record<ApprovalStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待批准',
  APPROVED: '已批准',
}

const fields: readonly BusinessObjectField<DclEmployeeForm>[] = [
  { key: 'code', label: '人员编码', type: 'readonly' },
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
    options: [
      { title: '选择已有主体', value: 'EXISTING' },
      { title: '新建主体', value: 'NEW' },
    ],
    visible: (form) => !form.code,
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
    key: 'taxNumber',
    label: '税号',
    type: 'text',
    visible: (form) => !form.code && form.partyMode === 'NEW',
    rules: [maxLength('税号', 64)],
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
    key: 'operatingEntityId',
    label: '经营主体',
    type: 'autocomplete',
    required: true,
    clearable: false,
  },
  { key: 'employeeCategoryId', label: '人员类别', type: 'autocomplete' },
  { key: 'departmentId', label: '部门', type: 'autocomplete' },
  { key: 'positionId', label: '岗位', type: 'autocomplete' },
  { key: 'phone', label: '电话', type: 'text', rules: [maxLength('电话', 32)] },
  {
    key: 'email',
    label: '邮箱',
    type: 'text',
    rules: [maxLength('邮箱', 254)],
  },
  { key: 'hireDate', label: '入职日期', type: 'date' },
  {
    key: 'remark',
    label: '备注',
    type: 'textarea',
    span: 2,
    rules: [maxLength('备注', 1000)],
  },
]

export const dclEmployeeConfig: DclEmployeeConfig = {
  title: '人员申报',
  fields,
  emptyForm: () => ({
    code: '',
    partyDisplayName: '',
    partyMode: 'EXISTING',
    partyId: '',
    partyKind: 'PERSON',
    legalName: '',
    displayName: '',
    taxNumber: '',
    identifierType: 'PERSON_ID',
    identifierValue: '',
    operatingEntityId: '',
    employeeCategoryId: '',
    departmentId: '',
    positionId: '',
    phone: '',
    email: '',
    hireDate: '',
    remark: '',
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
      key: 'employeeCategory',
      label: '人员类别',
      value: (row) =>
        dclEmployeeActiveVersion(row).data.employeeCategoryName ?? '—',
    },
    {
      key: 'department',
      label: '部门',
      value: (row) => dclEmployeeActiveVersion(row).data.departmentName ?? '—',
    },
    {
      key: 'position',
      label: '岗位',
      value: (row) => dclEmployeeActiveVersion(row).data.positionName ?? '—',
    },
    {
      key: 'status',
      label: '状态',
      value: (row) => dclEmployeeActiveVersion(row).approval.status,
      format: (value) => dclEmployeeStatusText[value as ApprovalStatus],
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
