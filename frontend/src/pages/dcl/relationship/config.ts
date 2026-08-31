import type { ApprovalStatus } from '@/api/generated'
import type { BusinessObjectField } from '@/components/business-object'
import { maxLength } from '@/pages/bob/shared/config-helpers'
import {
  approvalStatusOptions,
  approvalStatusPresentation,
} from '@/shared/approval'
import {
  dclRelationshipActiveVersion,
  type DclRelationshipConfig,
  type DclRelationshipEntity,
  type DclRelationshipForm,
} from './types'

const commonFields: readonly BusinessObjectField<DclRelationshipForm>[] = [
  { key: 'code', label: '编码', type: 'readonly' },
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
    key: 'taxNumber',
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
    key: 'operatingEntityId',
    label: '经营主体',
    type: 'autocomplete',
    required: true,
    clearable: false,
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
]

export function dclRelationshipConfig(
  entity: DclRelationshipEntity,
): DclRelationshipConfig {
  const fields: readonly BusinessObjectField<DclRelationshipForm>[] = [
    ...commonFields,
    ...(entity === 'other-unit'
      ? ([
          {
            key: 'settlementMethodId',
            label: '结算方式',
            type: 'autocomplete',
          },
        ] satisfies BusinessObjectField<DclRelationshipForm>[])
      : ([
          {
            key: 'capabilities',
            label: '能力',
            type: 'select',
            multiple: true,
            options: [
              { title: '外部兼职销售', value: 'EXTERNAL_PART_TIME' },
              { title: '渠道商', value: 'CHANNEL_PARTNER' },
            ],
          },
        ] satisfies BusinessObjectField<DclRelationshipForm>[])),
    {
      key: 'remark',
      label: '备注',
      type: 'textarea',
      span: 2,
      rules: [maxLength('备注', 1000)],
    },
  ]
  return {
    fields,
    emptyForm: () => ({
      code: '',
      partyDisplayName: '',
      partyMode: 'EXISTING',
      partyId: '',
      partyKind: 'ORGANIZATION',
      legalName: '',
      displayName: '',
      taxNumber: '',
      identifierType: 'UNIFIED_SOCIAL_CREDIT_CODE',
      identifierValue: '',
      operatingEntityId: '',
      contactName: '',
      contactPhone: '',
      email: '',
      address: '',
      settlementMethodId: '',
      capabilities: [],
      remark: '',
    }),
    columns: [
      {
        key: 'code',
        label: '编码',
        value: (row) => row.code,
        sizing: 'compact',
      },
      {
        key: 'party',
        label: '主体',
        value: (row) => row.partyDisplayName,
        sizing: 'fluid',
      },
      {
        key: 'operatingEntity',
        label: '经营主体',
        value: (row) =>
          `${row.operatingEntityCode} · ${row.operatingEntityName}`,
      },
      {
        key: 'status',
        label: '状态',
        value: (row) => dclRelationshipActiveVersion(row).approval.status,
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
}
